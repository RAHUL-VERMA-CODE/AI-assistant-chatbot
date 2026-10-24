import { randomUUID } from 'node:crypto';
import type { PlanRates } from '../billing/billing-adapter.ts';

export type UsageEventType =
  | 'llm_tokens'
  | 'stt_audio_seconds'
  | 'tts_characters'
  | 'turn_voice'
  | 'turn_text';

export interface UsageEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly type: UsageEventType;
  readonly quantity: number; // e.g. token count, seconds, char count, 1 for turn
  readonly unit: 'tokens' | 'seconds' | 'characters' | 'count';
  readonly metadata?: Readonly<Record<string, string | number>>;
  readonly timestampIso: string;
}

export interface UsageBatchSink {
  publishBatch(events: readonly UsageEvent[]): Promise<void> | void;
}

export interface UsageMeterOptions {
  readonly batchSize?: number;
  readonly sink: UsageBatchSink;
}

export class UsageMeter {
  private readonly batchSize: number;
  private readonly sink: UsageBatchSink;
  private buffer: UsageEvent[] = [];

  constructor(options: UsageMeterOptions) {
    this.batchSize = options.batchSize ?? 50;
    this.sink = options.sink;
  }

  public recordEvent(event: Omit<UsageEvent, 'eventId' | 'timestampIso'>): UsageEvent {
    const fullEvent: UsageEvent = {
      ...event,
      eventId: `use_${randomUUID()}`,
      timestampIso: new Date().toISOString(),
    };

    this.buffer.push(fullEvent);

    if (this.buffer.length >= this.batchSize) {
      this.flushSync();
    }

    return fullEvent;
  }

  public recordLLMUsage(params: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly model: string;
  }): readonly [UsageEvent, UsageEvent] {
    const promptEvent = this.recordEvent({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      type: 'llm_tokens',
      quantity: params.promptTokens,
      unit: 'tokens',
      metadata: { role: 'prompt', model: params.model },
    });

    const completionEvent = this.recordEvent({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      type: 'llm_tokens',
      quantity: params.completionTokens,
      unit: 'tokens',
      metadata: { role: 'completion', model: params.model },
    });

    return [promptEvent, completionEvent];
  }

  public recordSTTUsage(params: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly durationSeconds: number;
    readonly provider: string;
  }): UsageEvent {
    return this.recordEvent({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      type: 'stt_audio_seconds',
      quantity: Math.max(0, params.durationSeconds),
      unit: 'seconds',
      metadata: { provider: params.provider },
    });
  }

  public recordTTSUsage(params: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly characterCount: number;
    readonly provider: string;
  }): UsageEvent {
    return this.recordEvent({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      type: 'tts_characters',
      quantity: Math.max(0, params.characterCount),
      unit: 'characters',
      metadata: { provider: params.provider },
    });
  }

  public recordTurn(params: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly mode: 'voice' | 'text';
  }): UsageEvent {
    return this.recordEvent({
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      type: params.mode === 'voice' ? 'turn_voice' : 'turn_text',
      quantity: 1,
      unit: 'count',
    });
  }

  public getPendingCount(): number {
    return this.buffer.length;
  }

  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    await this.sink.publishBatch(batch);
  }

  private flushSync(): void {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    this.sink.publishBatch(batch);
  }

  /**
   * Deterministically calculates cost in integer minor units using integer rounding.
   */
  public static calculateCostMinor(event: UsageEvent, rates: PlanRates): number {
    switch (event.type) {
      case 'llm_tokens': {
        const isPrompt = event.metadata?.['role'] === 'prompt';
        const ratePer1k = isPrompt
          ? rates.llmPromptPer1kTokensMinor
          : rates.llmCompletionPer1kTokensMinor;
        // Integer math: ceil(quantity * ratePer1k / 1000)
        return Math.ceil((event.quantity * ratePer1k) / 1000);
      }

      case 'stt_audio_seconds': {
        // e.g. 60 seconds = 1 minute * rate
        const minutes = event.quantity / 60;
        return Math.ceil(minutes * rates.sttPerMinuteMinor);
      }

      case 'tts_characters': {
        return Math.ceil((event.quantity * rates.ttsPer1kCharsMinor) / 1000);
      }

      case 'turn_voice':
        return rates.turnVoiceMinor;

      case 'turn_text':
        return rates.turnTextMinor;

      default:
        return 0;
    }
  }
}
