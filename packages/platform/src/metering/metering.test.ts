import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsageMeter } from './usage-meter.ts';
import { OutboxPublisher } from './outbox-publisher.ts';
import { SpendGuard, SpendLimitExceededError, type SpendAlertPayload } from './spend-guard.ts';
import { BillingAdapter, DEFAULT_PLANS } from '../billing/billing-adapter.ts';
import { MeteringRollupJob } from '../../../../apps/worker/src/jobs/metering-rollup.ts';

describe('Phase 8: Metering, Plans, and Cost Control', () => {
  it('records LLM, STT, TTS, and turn usage accurately', async () => {
    const outbox = new OutboxPublisher();
    const meter = new UsageMeter({ batchSize: 10, sink: outbox });

    meter.recordLLMUsage({
      tenantId: 'tenant_arpzo',
      sessionId: 'sess_123',
      promptTokens: 400,
      completionTokens: 150,
      model: 'llama-3.3-70b-versatile',
    });

    meter.recordSTTUsage({
      tenantId: 'tenant_arpzo',
      sessionId: 'sess_123',
      durationSeconds: 15,
      provider: 'deepgram',
    });

    meter.recordTTSUsage({
      tenantId: 'tenant_arpzo',
      sessionId: 'sess_123',
      characterCount: 120,
      provider: 'elevenlabs',
    });

    meter.recordTurn({
      tenantId: 'tenant_arpzo',
      sessionId: 'sess_123',
      mode: 'voice',
    });

    assert.equal(meter.getPendingCount(), 5);
    await meter.flush();
    assert.equal(meter.getPendingCount(), 0);
    assert.equal(outbox.getTotalCount(), 5);
  });

  it('calculates exact integer minor costs deterministically', () => {
    const rates = DEFAULT_PLANS.starter.rates;

    // 1000 prompt tokens at 15 minor/1k = 15 minor
    const promptCost = UsageMeter.calculateCostMinor(
      {
        eventId: '1',
        tenantId: 't1',
        sessionId: 's1',
        type: 'llm_tokens',
        quantity: 1000,
        unit: 'tokens',
        metadata: { role: 'prompt' },
        timestampIso: new Date().toISOString(),
      },
      rates,
    );
    assert.equal(promptCost, 15);

    // 500 completion tokens at 60 minor/1k = 30 minor
    const compCost = UsageMeter.calculateCostMinor(
      {
        eventId: '2',
        tenantId: 't1',
        sessionId: 's1',
        type: 'llm_tokens',
        quantity: 500,
        unit: 'tokens',
        metadata: { role: 'completion' },
        timestampIso: new Date().toISOString(),
      },
      rates,
    );
    assert.equal(compCost, 30);

    // 120 seconds (2 minutes) STT at 50 minor/min = 100 minor
    const sttCost = UsageMeter.calculateCostMinor(
      {
        eventId: '3',
        tenantId: 't1',
        sessionId: 's1',
        type: 'stt_audio_seconds',
        quantity: 120,
        unit: 'seconds',
        timestampIso: new Date().toISOString(),
      },
      rates,
    );
    assert.equal(sttCost, 100);

    // 2000 chars TTS at 150 minor/1k = 300 minor
    const ttsCost = UsageMeter.calculateCostMinor(
      {
        eventId: '4',
        tenantId: 't1',
        sessionId: 's1',
        type: 'tts_characters',
        quantity: 2000,
        unit: 'characters',
        timestampIso: new Date().toISOString(),
      },
      rates,
    );
    assert.equal(ttsCost, 300);

    // Voice turn platform fee = 10 minor
    const voiceCost = UsageMeter.calculateCostMinor(
      {
        eventId: '5',
        tenantId: 't1',
        sessionId: 's1',
        type: 'turn_voice',
        quantity: 1,
        unit: 'count',
        timestampIso: new Date().toISOString(),
      },
      rates,
    );
    assert.equal(voiceCost, 10);
  });

  it('evaluates spend caps and triggers 50%, 80%, and 100% circuit breaker alerts', () => {
    const spendGuard = new SpendGuard();
    const plan = DEFAULT_PLANS.starter; // cap is 1,000,000 minor units
    const alerts: SpendAlertPayload[] = [];

    spendGuard.on('alert', (alert) => alerts.push(alert));

    // Under 50%: spend 300,000 minor (30%)
    const level1 = spendGuard.recordSpend('tenant_demo', 300000, plan);
    assert.equal(level1, 'NORMAL');
    assert.equal(alerts.length, 0);
    assert.doesNotThrow(() => spendGuard.assertCanExecute('tenant_demo', plan));

    // Reach 55%: spend +250,000 (total 550,000) -> WARNING_50
    const level2 = spendGuard.recordSpend('tenant_demo', 250000, plan);
    assert.equal(level2, 'WARNING_50');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.level, 'WARNING_50');
    assert.equal(alerts[0]!.percentageUsed, 55);

    // Reach 85%: spend +300,000 (total 850,000) -> ALERT_80
    const level3 = spendGuard.recordSpend('tenant_demo', 300000, plan);
    assert.equal(level3, 'ALERT_80');
    assert.equal(alerts.length, 2);
    assert.equal(alerts[1]!.level, 'ALERT_80');
    assert.equal(alerts[1]!.percentageUsed, 85);

    // Reach 105%: spend +200,000 (total 1,050,000) -> CIRCUIT_BROKEN_100
    const level4 = spendGuard.recordSpend('tenant_demo', 200000, plan);
    assert.equal(level4, 'CIRCUIT_BROKEN_100');
    assert.equal(alerts.length, 3);
    assert.equal(alerts[2]!.level, 'CIRCUIT_BROKEN_100');
    assert.equal(spendGuard.isCircuitBroken('tenant_demo', plan), true);

    // Verify circuit breaker blocks further execution
    assert.throws(
      () => spendGuard.assertCanExecute('tenant_demo', plan),
      (err: any) => err instanceof SpendLimitExceededError && err.tenantId === 'tenant_demo',
    );

    // Reset billing cycle recovers execution
    spendGuard.resetBillingCycle('tenant_demo');
    assert.equal(spendGuard.isCircuitBroken('tenant_demo', plan), false);
    assert.doesNotThrow(() => spendGuard.assertCanExecute('tenant_demo', plan));
  });

  it('aggregates usage through background worker job and drains transactional outbox', async () => {
    const outbox = new OutboxPublisher();
    const meter = new UsageMeter({ batchSize: 2, sink: outbox });
    const billing = new BillingAdapter();
    const spendGuard = new SpendGuard();

    billing.setTenantPlan('tenant_arpzo', 'growth');

    // Trigger auto-flush with 2 events
    meter.recordTurn({ tenantId: 'tenant_arpzo', sessionId: 's1', mode: 'voice' });
    meter.recordTurn({ tenantId: 'tenant_arpzo', sessionId: 's2', mode: 'text' });

    assert.equal(outbox.getPendingCount(), 2);

    const job = new MeteringRollupJob({ outbox, billing, spendGuard });
    const result = await job.run();

    assert.equal(result.eventsProcessed, 2);
    // Growth rates: turnVoice = 8, turnText = 4 -> total = 12 minor
    assert.equal(result.totalBilledMinor, 12);
    assert.equal(result.tenantBreakdown['tenant_arpzo'], 12);
    assert.equal(outbox.getPendingCount(), 0);
    assert.equal(spendGuard.getCurrentSpend('tenant_arpzo'), 12);
  });
});
