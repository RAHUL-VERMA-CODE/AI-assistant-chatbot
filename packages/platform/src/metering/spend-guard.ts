import { EventEmitter } from 'node:events';
import type { SubscriptionPlan } from '../billing/billing-adapter.ts';

export type SpendAlertLevel = 'NORMAL' | 'WARNING_50' | 'ALERT_80' | 'CIRCUIT_BROKEN_100';

export interface SpendAlertPayload {
  readonly tenantId: string;
  readonly level: SpendAlertLevel;
  readonly currentSpendMinor: number;
  readonly capMinor: number;
  readonly percentageUsed: number;
  readonly currency: string;
}

export class SpendLimitExceededError extends Error {
  public readonly tenantId: string;
  public readonly currentSpendMinor: number;
  public readonly capMinor: number;

  constructor(tenantId: string, currentSpendMinor: number, capMinor: number) {
    super(
      `Tenant ${tenantId} has exceeded their monthly spend cap: ${currentSpendMinor} >= ${capMinor} minor units. Circuit breaker active.`,
    );
    this.name = 'SpendLimitExceededError';
    this.tenantId = tenantId;
    this.currentSpendMinor = currentSpendMinor;
    this.capMinor = capMinor;
  }
}

export class SpendGuard extends EventEmitter {
  // tenantId -> current spend in minor units
  private readonly spendMap: Map<string, number> = new Map();
  // tenantId -> highest alert level triggered in current cycle to prevent duplicate alert storms
  private readonly alertStateMap: Map<string, SpendAlertLevel> = new Map();

  constructor() {
    super();
  }

  public recordSpend(
    tenantId: string,
    minorUnitsToAdd: number,
    plan: SubscriptionPlan,
  ): SpendAlertLevel {
    const current = this.spendMap.get(tenantId) ?? 0;
    const newTotal = current + Math.max(0, minorUnitsToAdd);
    this.spendMap.set(tenantId, newTotal);

    const cap = plan.monthlyCapMinor;
    const percent = (newTotal / cap) * 100;

    let newLevel: SpendAlertLevel = 'NORMAL';
    if (percent >= 100) {
      newLevel = 'CIRCUIT_BROKEN_100';
    } else if (percent >= 80) {
      newLevel = 'ALERT_80';
    } else if (percent >= 50) {
      newLevel = 'WARNING_50';
    }

    const prevLevel = this.alertStateMap.get(tenantId) ?? 'NORMAL';
    if (this.shouldTriggerAlert(prevLevel, newLevel)) {
      this.alertStateMap.set(tenantId, newLevel);
      const payload: SpendAlertPayload = {
        tenantId,
        level: newLevel,
        currentSpendMinor: newTotal,
        capMinor: cap,
        percentageUsed: Math.round(percent * 10) / 10,
        currency: plan.currency,
      };
      this.emit('alert', payload);
    }

    return newLevel;
  }

  public assertCanExecute(tenantId: string, plan: SubscriptionPlan): void {
    const current = this.spendMap.get(tenantId) ?? 0;
    if (current >= plan.monthlyCapMinor) {
      throw new SpendLimitExceededError(tenantId, current, plan.monthlyCapMinor);
    }
  }

  public isCircuitBroken(tenantId: string, plan: SubscriptionPlan): boolean {
    const current = this.spendMap.get(tenantId) ?? 0;
    return current >= plan.monthlyCapMinor;
  }

  public getCurrentSpend(tenantId: string): number {
    return this.spendMap.get(tenantId) ?? 0;
  }

  public resetBillingCycle(tenantId: string): void {
    this.spendMap.set(tenantId, 0);
    this.alertStateMap.set(tenantId, 'NORMAL');
  }

  private shouldTriggerAlert(prev: SpendAlertLevel, current: SpendAlertLevel): boolean {
    const rank: Record<SpendAlertLevel, number> = {
      NORMAL: 0,
      WARNING_50: 1,
      ALERT_80: 2,
      CIRCUIT_BROKEN_100: 3,
    };
    return rank[current] > rank[prev];
  }
}
