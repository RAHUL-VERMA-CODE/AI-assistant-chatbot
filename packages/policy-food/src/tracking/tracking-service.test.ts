import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrackingService } from './tracking-service.ts';
import type { OrderStatusResponse } from '../../../../packages/connector-contract/src/index.ts';

describe('TrackingService (Ownership & Live Order Tracking)', () => {
  const sampleActiveOrder: OrderStatusResponse = {
    orderId: 'ord_live_123',
    userRef: 'usr_owner_01',
    status: 'OUT_FOR_DELIVERY',
    branchName: 'ARPZO Koramangala',
    itemsSummary: '1x Cheese Burst Pizza',
    totalMinor: 44900,
    currency: 'INR',
    updatedAt: new Date().toISOString(),
    etaMinutes: 12,
    isStale: false,
    eligibleContactActions: [
      {
        type: 'CHAT_SUPPORT',
        label: 'Chat with Rider Support',
        actionPayload: { channel: 'support_live_123' },
      },
    ],
  };

  it('verifies ownership and formats live order status', () => {
    const report = TrackingService.verifyAndFormatStatus(sampleActiveOrder, 'usr_owner_01');
    assert.equal(report.orderId, 'ord_live_123');
    assert.equal(report.status, 'OUT_FOR_DELIVERY');
    assert.equal(report.etaMinutes, 12);
    assert.match(report.formattedSummary, /currently out for delivery/);
    assert.match(report.formattedSummary, /Estimated delivery time is approximately 12 minutes/);
    assert.equal(report.eligibleContactActions.length, 1);
    assert.equal(report.eligibleContactActions[0]!.type, 'CHAT_SUPPORT');
  });

  it('strictly rejects access if authenticated customer does not own the order (Req A14)', () => {
    assert.throws(
      () => TrackingService.verifyAndFormatStatus(sampleActiveOrder, 'usr_attacker_99'),
      /Access denied: Order 'ord_live_123' belongs to another customer account/,
    );
  });

  it('detects stale order updates (> 15 minutes)', () => {
    const staleOrder: OrderStatusResponse = {
      ...sampleActiveOrder,
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 mins old
    };

    const report = TrackingService.verifyAndFormatStatus(staleOrder, 'usr_owner_01');
    assert.equal(report.isStale, true);
    assert.match(report.formattedSummary, /have not refreshed recently/);
  });
});
