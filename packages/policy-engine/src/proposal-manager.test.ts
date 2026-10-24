import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalManager } from './proposal-manager.ts';

describe('ProposalManager (Immutability & Lifecycle)', () => {
  it('creates an immutable proposal with charges and status ACTIVE', () => {
    const manager = new ProposalManager(120_000);
    const proposal = manager.createProposal({
      tenantId: 'tenant_arpzo',
      userRef: 'usr_01',
      branchId: 'branch_koramangala',
      cartVersion: 1,
      items: [
        {
          itemId: 'paneer_tikka_jain',
          itemName: 'Jain Paneer Tikka',
          optionIds: [],
          quantity: 1,
          unitPriceMinor: 28000,
          lineTotalMinor: 28000,
        },
      ],
      rawChoices: [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }],
      currency: 'INR',
      charges: {
        subtotalMinor: 28000,
        deliveryFeeMinor: 4000,
        packagingFeeMinor: 1500,
        taxMinor: 1400,
        discountMinor: 0,
        totalMinor: 34900,
      },
      summaryText: 'One Jain Paneer Tikka for INR 349.00 total. Confirm?',
    });

    assert.ok(proposal.proposalId.startsWith('prop_'));
    assert.equal(proposal.status, 'ACTIVE');
    assert.equal(proposal.charges.totalMinor, 34900);
  });

  it('marks proposal APPLIED on confirmation and blocks second application', () => {
    const manager = new ProposalManager();
    const proposal = manager.createProposal({
      tenantId: 'tenant_arpzo',
      userRef: 'usr_01',
      branchId: 'branch_koramangala',
      cartVersion: 1,
      items: [
        {
          itemId: 'paneer_tikka_jain',
          itemName: 'Jain Paneer Tikka',
          optionIds: [],
          quantity: 1,
          unitPriceMinor: 28000,
          lineTotalMinor: 28000,
        },
      ],
      rawChoices: [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }],
      currency: 'INR',
      charges: {
        subtotalMinor: 28000,
        deliveryFeeMinor: 0,
        packagingFeeMinor: 0,
        taxMinor: 0,
        discountMinor: 0,
        totalMinor: 28000,
      },
      summaryText: 'Summary',
    });

    const applied = manager.markApplied(proposal.proposalId);
    assert.equal(applied.status, 'APPLIED');

    // Second apply must throw ConflictError
    assert.throws(
      () => manager.markApplied(proposal.proposalId),
      /has already been applied/,
    );
  });

  it('rejects confirmation when proposal has expired', async () => {
    const manager = new ProposalManager(10); // 10ms TTL
    const proposal = manager.createProposal({
      tenantId: 'tenant_arpzo',
      userRef: 'usr_01',
      branchId: 'branch_koramangala',
      cartVersion: 1,
      items: [
        {
          itemId: 'paneer_tikka_jain',
          itemName: 'Jain Paneer Tikka',
          optionIds: [],
          quantity: 1,
          unitPriceMinor: 28000,
          lineTotalMinor: 28000,
        },
      ],
      rawChoices: [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }],
      currency: 'INR',
      charges: {
        subtotalMinor: 28000,
        deliveryFeeMinor: 0,
        packagingFeeMinor: 0,
        taxMinor: 0,
        discountMinor: 0,
        totalMinor: 28000,
      },
      summaryText: 'Summary',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.throws(
      () => manager.markApplied(proposal.proposalId),
      /has expired/,
    );
  });
});
