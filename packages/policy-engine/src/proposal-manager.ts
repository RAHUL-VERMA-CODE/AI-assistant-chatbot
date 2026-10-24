import { ConflictError, NotFoundError, ValidationError } from '../../core/src/index.ts';
import type { LineItemChoice } from '../../connector-contract/src/index.ts';
import crypto from 'node:crypto';

export interface ProposalBreakdown {
  readonly subtotalMinor: number;
  readonly deliveryFeeMinor: number;
  readonly packagingFeeMinor: number;
  readonly taxMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
}

export interface ProposalItemDetail {
  readonly itemId: string;
  readonly itemName: string;
  readonly variantId?: string;
  readonly variantName?: string;
  readonly optionIds: readonly string[];
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly dietaryClassification?: 'VEG' | 'NON_VEG' | 'JAIN' | 'VEGAN';
  readonly allocatedToPerson?: string; // e.g. "Person 1 (Veg)" in group orders
}

export type ProposalStatus = 'ACTIVE' | 'APPLIED' | 'EXPIRED';

export interface CartProposal {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly userRef: string;
  readonly branchId: string;
  readonly cartVersion: number;
  readonly items: readonly ProposalItemDetail[];
  readonly rawChoices: readonly LineItemChoice[];
  readonly currency: string;
  readonly charges: ProposalBreakdown;
  readonly summaryText: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  status: ProposalStatus;
}

export class ProposalManager {
  private readonly proposals = new Map<string, CartProposal>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 120_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  public createProposal(params: {
    tenantId: string;
    userRef: string;
    branchId: string;
    cartVersion: number;
    items: readonly ProposalItemDetail[];
    rawChoices: readonly LineItemChoice[];
    currency: string;
    charges: ProposalBreakdown;
    summaryText: string;
    ttlMs?: number;
  }): CartProposal {
    if (params.items.length === 0) {
      throw new ValidationError('Cannot create a cart proposal with zero items');
    }
    if (!Number.isInteger(params.charges.totalMinor)) {
      throw new ValidationError(`Charges total must be an integer minor unit, got ${params.charges.totalMinor}`);
    }

    const now = Date.now();
    const ttl = params.ttlMs || this.defaultTtlMs;
    const proposalId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const proposal: CartProposal = {
      proposalId,
      tenantId: params.tenantId,
      userRef: params.userRef,
      branchId: params.branchId,
      cartVersion: params.cartVersion,
      items: params.items,
      rawChoices: params.rawChoices,
      currency: params.currency,
      charges: params.charges,
      summaryText: params.summaryText,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      status: 'ACTIVE',
    };

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  public getProposal(proposalId: string): CartProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new NotFoundError('Cart proposal', proposalId);
    }

    // Check expiration
    const expiryTime = new Date(proposal.expiresAt).getTime();
    if (Date.now() > expiryTime && proposal.status === 'ACTIVE') {
      proposal.status = 'EXPIRED';
    }

    return proposal;
  }

  public markApplied(proposalId: string): CartProposal {
    const proposal = this.getProposal(proposalId);

    if (proposal.status === 'EXPIRED') {
      throw new ConflictError(
        `Cart proposal '${proposalId}' has expired. A fresh preview must be confirmed by the customer.`,
      );
    }

    if (proposal.status === 'APPLIED') {
      throw new ConflictError(
        `Cart proposal '${proposalId}' has already been applied. Cannot confirm twice.`,
      );
    }

    proposal.status = 'APPLIED';
    return proposal;
  }

  public clear(): void {
    this.proposals.clear();
  }
}
