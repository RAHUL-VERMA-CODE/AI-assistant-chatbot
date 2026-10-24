import type { UsageBatchSink, UsageEvent } from './usage-meter.ts';

export interface OutboxEntry {
  readonly id: string;
  readonly event: UsageEvent;
  readonly status: 'PENDING' | 'PROCESSED' | 'FAILED';
  readonly createdAt: Date;
  readonly processedAt?: Date;
}

export class OutboxPublisher implements UsageBatchSink {
  private entries: OutboxEntry[] = [];
  private sequence = 0;

  public publishBatch(events: readonly UsageEvent[]): void {
    for (const event of events) {
      this.sequence += 1;
      this.entries.push({
        id: `outbox_${this.sequence}_${event.eventId}`,
        event,
        status: 'PENDING',
        createdAt: new Date(),
      });
    }
  }

  public drainPending(limit = 100): OutboxEntry[] {
    const pending = this.entries.filter((e) => e.status === 'PENDING').slice(0, limit);
    return pending;
  }

  public acknowledge(outboxIds: readonly string[]): void {
    const idSet = new Set(outboxIds);
    const now = new Date();
    this.entries = this.entries.map((entry) => {
      if (idSet.has(entry.id)) {
        return {
          ...entry,
          status: 'PROCESSED',
          processedAt: now,
        };
      }
      return entry;
    });
  }

  public getPendingCount(): number {
    return this.entries.filter((e) => e.status === 'PENDING').length;
  }

  public getTotalCount(): number {
    return this.entries.length;
  }

  public clearProcessed(): void {
    this.entries = this.entries.filter((e) => e.status !== 'PROCESSED');
  }
}
