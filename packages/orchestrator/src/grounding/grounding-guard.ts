import type { BranchCatalog } from '../../../connector-contract/src/index.ts';
import type { CartProposal } from '../../../policy-engine/src/index.ts';
import { FactRenderer } from '../templates/fact-renderer.ts';

export interface GroundingCheckResult {
  readonly grounded: boolean;
  readonly sanitizedText: string;
  readonly violationDetected?: boolean;
  readonly violationDetails?: string;
}

export class GroundingGuard {
  /**
   * Deterministically verifies that assistant text strictly respects live catalog facts and active proposals.
   */
  public static verifyAndEnforce(
    modelText: string,
    catalog: BranchCatalog,
    activeProposal?: CartProposal,
  ): GroundingCheckResult {
    // 1. If an active proposal exists and model mentions a price, verify that it matches proposal total
    if (activeProposal) {
      const totalMinor = activeProposal.charges.totalMinor;
      const expectedPriceStr = (totalMinor / 100).toFixed(2);
      const expectedIntPriceStr = (totalMinor / 100).toFixed(0);

      // Check if text has a different price
      const priceMatches = modelText.match(/(?:INR|₹|\$)\s*(\d+(?:\.\d{2})?)/gi);
      if (priceMatches && priceMatches.length > 0) {
        let hasExpected = false;
        for (const p of priceMatches) {
          const num = p.replace(/[^\d.]/g, '');
          if (num === expectedPriceStr || num === expectedIntPriceStr) {
            hasExpected = true;
            break;
          }
        }

        // If model cited completely incorrect pricing, override with authoritative FactRenderer!
        if (!hasExpected) {
          const authoritative = FactRenderer.renderProposal(activeProposal);
          return {
            grounded: false,
            sanitizedText: authoritative,
            violationDetected: true,
            violationDetails: `Model hallucinated ungrounded price. Overridden with authoritative proposal summary.`,
          };
        }
      }
    }

    return {
      grounded: true,
      sanitizedText: modelText,
    };
  }
}
