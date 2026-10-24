import type { IsoCurrencyCode } from '../../../core/src/types/currency.ts';

export type SubscriptionTier = 'starter' | 'growth' | 'enterprise';

export interface PlanRates {
  readonly llmPromptPer1kTokensMinor: number;
  readonly llmCompletionPer1kTokensMinor: number;
  readonly sttPerMinuteMinor: number;
  readonly ttsPer1kCharsMinor: number;
  readonly turnVoiceMinor: number;
  readonly turnTextMinor: number;
}

export interface SubscriptionPlan {
  readonly tier: SubscriptionTier;
  readonly name: string;
  readonly currency: IsoCurrencyCode;
  readonly monthlyCapMinor: number; // Integer minor units (e.g. 1000000 = INR 10,000)
  readonly rates: PlanRates;
  readonly rateLimits: {
    readonly maxRps: number;
    readonly maxConcurrentSessions: number;
  };
}

export const DEFAULT_PLANS: Record<SubscriptionTier, SubscriptionPlan> = {
  starter: {
    tier: 'starter',
    name: 'Starter Plan',
    currency: 'INR',
    monthlyCapMinor: 1000000, // INR 10,000.00
    rates: {
      llmPromptPer1kTokensMinor: 15, // INR 0.15 / 1k tokens
      llmCompletionPer1kTokensMinor: 60, // INR 0.60 / 1k tokens
      sttPerMinuteMinor: 50, // INR 0.50 / minute
      ttsPer1kCharsMinor: 150, // INR 1.50 / 1k chars
      turnVoiceMinor: 10, // INR 0.10 / voice turn platform fee
      turnTextMinor: 5, // INR 0.05 / text turn platform fee
    },
    rateLimits: {
      maxRps: 10,
      maxConcurrentSessions: 50,
    },
  },
  growth: {
    tier: 'growth',
    name: 'Growth Plan',
    currency: 'INR',
    monthlyCapMinor: 5000000, // INR 50,000.00
    rates: {
      llmPromptPer1kTokensMinor: 12,
      llmCompletionPer1kTokensMinor: 48,
      sttPerMinuteMinor: 40,
      ttsPer1kCharsMinor: 120,
      turnVoiceMinor: 8,
      turnTextMinor: 4,
    },
    rateLimits: {
      maxRps: 50,
      maxConcurrentSessions: 250,
    },
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise Plan',
    currency: 'INR',
    monthlyCapMinor: 50000000, // INR 500,000.00
    rates: {
      llmPromptPer1kTokensMinor: 10,
      llmCompletionPer1kTokensMinor: 40,
      sttPerMinuteMinor: 30,
      ttsPer1kCharsMinor: 100,
      turnVoiceMinor: 5,
      turnTextMinor: 2,
    },
    rateLimits: {
      maxRps: 200,
      maxConcurrentSessions: 1000,
    },
  },
};

export class BillingAdapter {
  private readonly plans: Map<SubscriptionTier, SubscriptionPlan> = new Map();
  private readonly tenantPlans: Map<string, SubscriptionTier> = new Map();

  constructor(customPlans?: Partial<Record<SubscriptionTier, SubscriptionPlan>>) {
    for (const [tier, plan] of Object.entries(DEFAULT_PLANS)) {
      this.plans.set(tier as SubscriptionTier, plan);
    }
    if (customPlans) {
      for (const [tier, plan] of Object.entries(customPlans)) {
        if (plan) this.plans.set(tier as SubscriptionTier, plan);
      }
    }
  }

  public setTenantPlan(tenantId: string, tier: SubscriptionTier): void {
    if (!this.plans.has(tier)) {
      throw new Error(`Unknown subscription tier: ${tier}`);
    }
    this.tenantPlans.set(tenantId, tier);
  }

  public getTenantPlan(tenantId: string): SubscriptionPlan {
    const tier = this.tenantPlans.get(tenantId) ?? 'starter';
    const plan = this.plans.get(tier);
    if (!plan) {
      throw new Error(`Plan for tier ${tier} not found`);
    }
    return plan;
  }
}
