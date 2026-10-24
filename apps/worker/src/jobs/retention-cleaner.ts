export interface RetentionCleanerOptions {
  readonly retentionDays?: number;
  readonly storageAdapter?: RetentionStorageAdapter;
}

export interface RetentionStorageAdapter {
  purgeOldTranscripts(cutoffDate: Date): Promise<number>;
  purgeOldAudioBuffers(cutoffDate: Date): Promise<number>;
  dropExpiredPartitions(cutoffDate: Date): Promise<string[]>;
}

export interface RetentionResult {
  readonly transcriptsPurged: number;
  readonly audioBuffersPurged: number;
  readonly partitionsDropped: readonly string[];
  readonly cutoffDateIso: string;
  readonly durationMs: number;
}

export class InMemoryRetentionStorageAdapter implements RetentionStorageAdapter {
  public transcripts: { id: string; timestamp: Date }[] = [];
  public audioBuffers: { id: string; timestamp: Date }[] = [];
  public partitions: { name: string; date: Date }[] = [];

  public async purgeOldTranscripts(cutoffDate: Date): Promise<number> {
    const initial = this.transcripts.length;
    this.transcripts = this.transcripts.filter((t) => t.timestamp >= cutoffDate);
    return initial - this.transcripts.length;
  }

  public async purgeOldAudioBuffers(cutoffDate: Date): Promise<number> {
    const initial = this.audioBuffers.length;
    this.audioBuffers = this.audioBuffers.filter((a) => a.timestamp >= cutoffDate);
    return initial - this.audioBuffers.length;
  }

  public async dropExpiredPartitions(cutoffDate: Date): Promise<string[]> {
    const dropped: string[] = [];
    this.partitions = this.partitions.filter((p) => {
      if (p.date < cutoffDate) {
        dropped.push(p.name);
        return false;
      }
      return true;
    });
    return dropped;
  }
}

export class RetentionCleanerJob {
  private readonly retentionDays: number;
  private readonly storage: RetentionStorageAdapter;

  constructor(options?: RetentionCleanerOptions) {
    this.retentionDays = options?.retentionDays ?? 7;
    this.storage = options?.storageAdapter ?? new InMemoryRetentionStorageAdapter();
  }

  public async run(): Promise<RetentionResult> {
    const start = Date.now();
    const cutoffDate = new Date(Date.now() - this.retentionDays * 86400000);

    const [transcriptsPurged, audioBuffersPurged, partitionsDropped] = await Promise.all([
      this.storage.purgeOldTranscripts(cutoffDate),
      this.storage.purgeOldAudioBuffers(cutoffDate),
      this.storage.dropExpiredPartitions(cutoffDate),
    ]);

    return {
      transcriptsPurged,
      audioBuffersPurged,
      partitionsDropped,
      cutoffDateIso: cutoffDate.toISOString(),
      durationMs: Date.now() - start,
    };
  }
}
