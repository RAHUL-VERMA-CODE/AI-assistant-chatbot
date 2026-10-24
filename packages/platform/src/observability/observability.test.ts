import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrometheusRegistry } from './metrics.ts';
import { Tracer } from './tracer.ts';
import { RetentionCleanerJob, InMemoryRetentionStorageAdapter } from '../../../../apps/worker/src/jobs/retention-cleaner.ts';

describe('Phase 10: Performance, Scalability, and Operations', () => {
  it('records and formats Prometheus metrics (counters, gauges, histograms)', () => {
    const registry = new PrometheusRegistry();

    registry.registerCounter('vca_test_turns', 'Test turn counter');
    registry.registerGauge('vca_test_sessions', 'Test active sessions');
    registry.registerHistogram('vca_test_latency', 'Test latency', [0.1, 0.5, 1.0, 3.0]);

    registry.incrementCounter('vca_test_turns', { tenant: 'arpzo', mode: 'voice' }, 3);
    registry.setGauge('vca_test_sessions', { tenant: 'arpzo' }, 42);

    registry.observeHistogram('vca_test_latency', { tenant: 'arpzo' }, 0.08); // <= 0.1
    registry.observeHistogram('vca_test_latency', { tenant: 'arpzo' }, 0.45); // <= 0.5
    registry.observeHistogram('vca_test_latency', { tenant: 'arpzo' }, 2.5);  // <= 3.0

    const output = registry.toPrometheusFormat();

    assert.ok(output.includes('# HELP vca_test_turns Test turn counter'));
    assert.ok(output.includes('# TYPE vca_test_turns counter'));
    assert.ok(output.includes('vca_test_turns{mode="voice",tenant="arpzo"} 3'));
    assert.ok(output.includes('vca_test_sessions{tenant="arpzo"} 42'));
    assert.ok(output.includes('vca_test_latency_bucket{tenant="arpzo",le="0.1"} 1'));
    assert.ok(output.includes('vca_test_latency_bucket{tenant="arpzo",le="0.5"} 2'));
    assert.ok(output.includes('vca_test_latency_bucket{tenant="arpzo",le="3"} 3'));
    assert.ok(output.includes('vca_test_latency_count{tenant="arpzo"} 3'));
  });

  it('generates W3C traceparent headers and manages distributed spans', () => {
    const tracer = new Tracer();

    const rootSpan = tracer.startSpan('turn_orchestration');
    rootSpan.setAttribute('tenant.id', 'tenant_arpzo');
    rootSpan.setAttribute('turn.mode', 'voice');

    const traceparent = rootSpan.toTraceparent();
    assert.match(traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

    // Child span propagates traceId
    const childSpan = tracer.startSpan('llm_intent_extraction', {
      parentTraceparent: traceparent,
    });
    assert.equal(childSpan.context.traceId, rootSpan.context.traceId);
    assert.equal(childSpan.context.parentSpanId, rootSpan.context.spanId);

    const childRecord = childSpan.end();
    assert.equal(childRecord.name, 'llm_intent_extraction');
    assert.equal(childRecord.status, 'OK');
    assert.ok(typeof childRecord.durationMs === 'number');

    const rootRecord = rootSpan.end();
    assert.equal(rootRecord.status, 'OK');
  });

  it('purges transcripts, audio buffers, and expired partitions older than 7 days (DPDP)', async () => {
    const storage = new InMemoryRetentionStorageAdapter();
    const now = Date.now();
    const eightDaysAgo = new Date(now - 8 * 86400000);
    const threeDaysAgo = new Date(now - 3 * 86400000);

    // Add old and new items
    storage.transcripts.push(
      { id: 't_old_1', timestamp: eightDaysAgo },
      { id: 't_old_2', timestamp: eightDaysAgo },
      { id: 't_new_1', timestamp: threeDaysAgo },
    );

    storage.audioBuffers.push(
      { id: 'a_old_1', timestamp: eightDaysAgo },
      { id: 'a_new_1', timestamp: threeDaysAgo },
    );

    storage.partitions.push(
      { name: 'session_turns_y2026m10d10', date: eightDaysAgo },
      { name: 'session_turns_y2026m10d22', date: threeDaysAgo },
    );

    const cleaner = new RetentionCleanerJob({ retentionDays: 7, storageAdapter: storage });
    const result = await cleaner.run();

    assert.equal(result.transcriptsPurged, 2);
    assert.equal(result.audioBuffersPurged, 1);
    assert.deepEqual(result.partitionsDropped, ['session_turns_y2026m10d10']);

    // Recent data preserved
    assert.equal(storage.transcripts.length, 1);
    assert.equal(storage.transcripts[0]!.id, 't_new_1');
    assert.equal(storage.audioBuffers.length, 1);
    assert.equal(storage.audioBuffers[0]!.id, 'a_new_1');
    assert.equal(storage.partitions.length, 1);
  });
});
