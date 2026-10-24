import type { OutboxPublisher } from '../../../../packages/platform/src/metering/outbox-publisher.ts';
import { UsageMeter } from '../../../../packages/platform/src/metering/usage-meter.ts';
import type { BillingAdapter } from '../../../../packages/platform/src/billing/billing-adapter.ts';
import type { SpendGuard } from '../../../../packages/platform/src/metering/spend-guard.ts';

export interface RollupJobResult {
  readonly eventsProcessed: number;
  readonly totalBilledMinor: number;
  readonly tenantBreakdown: Readonly<Record<string, number>>;
}

export class MeteringRollupJob {
  private readonly outbox: OutboxPublisher;
  private readonly billing: BillingAdapter;
  private readonly spendGuard: SpendGuard;

  constructor(dependencies: {
    outbox: OutboxPublisher;
    billing: BillingAdapter;
    spendGuard: SpendGuard;
  }) {
    this.outbox = dependencies.outbox;
    this.billing = dependencies.billing;
    this.spendGuard = dependencies.spendGuard;
  }

  public async run(batchLimit = 500): Promise<RollupJobResult> {
    const entries = this.outbox.drainPending(batchLimit);
    if (entries.length === 0) {
      return {
        eventsProcessed: 0,
        totalBilledMinor: 0,
        tenantBreakdown: {},
      };
    }

    const tenantBreakdown: Record<string, number> = {};
    let totalBilledMinor = 0;
    const processedIds: string[] = [];

    for (const entry of entries) {
      const event = entry.event;
      const plan = this.billing.getTenantPlan(event.tenantId);
      const costMinor = UsageMeter.calculateCostMinor(event, plan.rates);

      totalBilledMinor += costMinor;
      tenantBreakdown[event.tenantId] = (tenantBreakdown[event.tenantId] ?? 0) + costMinor;

      this.spendGuard.recordSpend(event.tenantId, costMinor, plan);
      processedIds.push(entry.id);
    }

    this.outbox.acknowledge(processedIds);

    return {
      eventsProcessed: entries.length,
      totalBilledMinor,
      tenantBreakdown,
    };
  }
}
