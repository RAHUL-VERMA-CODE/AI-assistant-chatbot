export interface TurnLatencyMetrics {
  readonly turnId: string;
  readonly sttDurationMs: number;
  readonly llmTimeToFirstTokenMs: number;
  readonly llmTotalDurationMs: number;
  readonly ttsTimeToFirstAudioChunkMs: number;
  readonly totalTurnDurationMs: number;
  readonly endOfSpeechToFirstAudioMs: number;
  readonly exceeded3sBudget: boolean;
}

export class LatencyTracker {
  private readonly turnId: string;
  private readonly turnStartTime: number;
  private endOfSpeechTime = 0;
  private sttEndTime = 0;
  private llmStartTime = 0;
  private llmFirstTokenTime = 0;
  private llmEndTime = 0;
  private ttsStartTime = 0;
  private ttsFirstAudioTime = 0;
  private turnEndTime = 0;

  constructor(turnId: string) {
    this.turnId = turnId;
    this.turnStartTime = performance.now();
  }

  public markEndOfSpeech(): void {
    this.endOfSpeechTime = performance.now();
  }

  public markSttEnd(): void {
    this.sttEndTime = performance.now();
    this.llmStartTime = performance.now();
  }

  public markLlmFirstToken(): void {
    if (!this.llmFirstTokenTime) {
      this.llmFirstTokenTime = performance.now();
    }
  }

  public markLlmEnd(): void {
    this.llmEndTime = performance.now();
    this.ttsStartTime = performance.now();
  }

  public markTtsFirstAudio(): void {
    if (!this.ttsFirstAudioTime) {
      this.ttsFirstAudioTime = performance.now();
    }
  }

  public markTurnEnd(): TurnLatencyMetrics {
    this.turnEndTime = performance.now();

    const endOfSpeechToFirstAudioMs =
      this.ttsFirstAudioTime && this.endOfSpeechTime
        ? this.ttsFirstAudioTime - this.endOfSpeechTime
        : this.turnEndTime - this.turnStartTime;

    return {
      turnId: this.turnId,
      sttDurationMs: this.sttEndTime - this.turnStartTime,
      llmTimeToFirstTokenMs: this.llmFirstTokenTime ? this.llmFirstTokenTime - this.llmStartTime : 0,
      llmTotalDurationMs: this.llmEndTime - this.llmStartTime,
      ttsTimeToFirstAudioChunkMs: this.ttsFirstAudioTime ? this.ttsFirstAudioTime - this.ttsStartTime : 0,
      totalTurnDurationMs: this.turnEndTime - this.turnStartTime,
      endOfSpeechToFirstAudioMs,
      exceeded3sBudget: endOfSpeechToFirstAudioMs > 3000,
    };
  }
}
