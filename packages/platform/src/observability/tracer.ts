import { randomBytes } from 'node:crypto';

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: string; // '01' sampled
}

export interface SpanRecord {
  readonly name: string;
  readonly context: SpanContext;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly durationMs?: number;
  readonly status: 'OK' | 'ERROR';
  readonly attributes: Record<string, string | number | boolean>;
}

export class Span {
  public readonly context: SpanContext;
  public readonly name: string;
  public readonly startTimeMs: number;
  private endTimeMs?: number;
  private status: 'OK' | 'ERROR' = 'OK';
  private readonly attributes: Record<string, string | number | boolean> = {};

  constructor(name: string, context: SpanContext) {
    this.name = name;
    this.context = context;
    this.startTimeMs = Date.now();
  }

  public setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  public setStatus(status: 'OK' | 'ERROR'): this {
    this.status = status;
    return this;
  }

  public end(): SpanRecord {
    this.endTimeMs = Date.now();
    return {
      name: this.name,
      context: this.context,
      startTimeMs: this.startTimeMs,
      endTimeMs: this.endTimeMs,
      durationMs: this.endTimeMs - this.startTimeMs,
      status: this.status,
      attributes: { ...this.attributes },
    };
  }

  public toTraceparent(): string {
    return `00-${this.context.traceId}-${this.context.spanId}-${this.context.traceFlags}`;
  }
}

export class Tracer {
  private readonly completedSpans: SpanRecord[] = [];

  public startSpan(name: string, options?: { parentTraceparent?: string }): Span {
    let traceId: string;
    let parentSpanId: string | undefined;

    if (options?.parentTraceparent) {
      const parsed = Tracer.parseTraceparent(options.parentTraceparent);
      if (parsed) {
        traceId = parsed.traceId;
        parentSpanId = parsed.spanId;
      } else {
        traceId = randomBytes(16).toString('hex');
      }
    } else {
      traceId = randomBytes(16).toString('hex');
    }

    const spanId = randomBytes(8).toString('hex');
    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId,
      traceFlags: '01',
    };

    return new Span(name, context);
  }

  public recordCompletedSpan(spanRecord: SpanRecord): void {
    this.completedSpans.push(spanRecord);
  }

  public getCompletedSpans(): readonly SpanRecord[] {
    return this.completedSpans;
  }

  public static parseTraceparent(header: string): { traceId: string; spanId: string } | null {
    const parts = header.trim().split('-');
    if (parts.length === 4 && parts[0] === '00' && parts[1]?.length === 32 && parts[2]?.length === 16) {
      return {
        traceId: parts[1]!,
        spanId: parts[2]!,
      };
    }
    return null;
  }
}

export const defaultTracer = new Tracer();
