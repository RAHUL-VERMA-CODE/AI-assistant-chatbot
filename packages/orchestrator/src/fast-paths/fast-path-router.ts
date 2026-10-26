import type { ConnectorClient } from '../../../connector-sdk/src/index.ts';
import type { ProposalManager } from '../../../policy-engine/src/index.ts';
import type { BoundedSessionContext } from '../context/bounded-context.ts';
import { HinglishNormalizer } from '../normalizer/hinglish-normalizer.ts';
import { FactRenderer } from '../templates/fact-renderer.ts';
import { ReorderMapper, TrackingService } from '../../../policy-food/src/index.ts';
import crypto from 'node:crypto';

export interface FastPathResult {
  readonly handled: boolean;
  readonly assistantReply: string;
  readonly stateChanged: boolean;
  readonly proposalCommitted?: boolean;
  readonly committedCart?: {
    cartId: string;
    newCartVersion: number;
    totalMinor: number;
    currency: string;
    items: readonly any[];
    charges: any;
  };
}

export class FastPathRouter {
  public static async evaluateAndExecute(
    utterance: string,
    session: BoundedSessionContext,
    connector: ConnectorClient,
    proposalManager: ProposalManager,
  ): Promise<FastPathResult> {
    const normalized = HinglishNormalizer.normalize(utterance);

    // 1. Fast-Path: CONFIRM ACTIVE PROPOSAL
    if (normalized.isConfirmation && session.activeProposal && session.activeProposal.status === 'ACTIVE') {
      const proposal = session.activeProposal;

      // Idempotent commit directly to connector
      const commitRes = await connector.commitCart({
        branchId: session.branchId,
        userRef: session.userRef,
        proposalId: proposal.proposalId,
        expectedCartVersion: session.cartVersion,
        items: proposal.rawChoices,
        idempotencyKey: `ik_confirm_${proposal.proposalId}`,
      });

      proposalManager.markApplied(proposal.proposalId);
      session.cartVersion = commitRes.newCartVersion;
      session.state = 'CONFIRMED';
      session.activeProposal = undefined;

      const reply = FactRenderer.renderCartConfirmed(
        commitRes.cartId,
        commitRes.newCartVersion,
        commitRes.totalMinor,
        commitRes.currency,
      );

      const committedCart = {
        cartId: commitRes.cartId,
        newCartVersion: commitRes.newCartVersion,
        totalMinor: commitRes.totalMinor,
        currency: commitRes.currency,
        items: proposal.items,
        charges: proposal.charges,
      };

      return {
        handled: true,
        assistantReply: reply,
        stateChanged: true,
        proposalCommitted: true,
        committedCart,
      };
    }

    // 2. Fast-Path: CANCEL PROPOSAL
    if (normalized.isCancellation && session.activeProposal) {
      session.activeProposal = undefined;
      session.state = 'SEARCHING';
      return {
        handled: true,
        assistantReply: 'Cancelled your proposed items. What else would you like to search or order?',
        stateChanged: true,
      };
    }

    // 3. Fast-Path: REORDER LATEST COMPLETED ORDER
    if (normalized.isReorderRequest) {
      const pastOrder = await connector.getLatestOrder(session.userRef, session.branchId);
      if (!pastOrder) {
        return {
          handled: true,
          assistantReply: 'No past completed orders were found for your account at this branch.',
          stateChanged: false,
        };
      }

      const catalog = await connector.getCatalog(session.branchId);
      const mapped = ReorderMapper.mapToCurrentCatalog(pastOrder, catalog);

      return {
        handled: true,
        assistantReply: mapped.summaryMessage,
        stateChanged: true,
      };
    }

    // 4. Fast-Path: TRACK LIVE ORDER STATUS
    if (normalized.isStatusRequest) {
      // Find active order or prompt for order reference
      const reply = 'To track your order, please provide your Order ID (for example, ORD-123).';
      return {
        handled: true,
        assistantReply: reply,
        stateChanged: false,
      };
    }

    return {
      handled: false,
      assistantReply: '',
      stateChanged: false,
    };
  }
}
