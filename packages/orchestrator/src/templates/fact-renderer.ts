import type { CartProposal } from '../../../policy-engine/src/index.ts';
import type { VerifiedTrackingReport } from '../../../policy-food/src/index.ts';

export class FactRenderer {
  /**
   * Deterministically formats a cart proposal summary for speech and text display.
   */
  public static renderProposal(proposal: CartProposal): string {
    const itemSummaries = proposal.items.map((i) => {
      const variantStr = i.variantName ? ` (${i.variantName})` : '';
      const unitFormatted = `${proposal.currency} ${(i.unitPriceMinor / 100).toFixed(2)}`;
      return `${i.quantity}x ${i.itemName}${variantStr} at ${unitFormatted}`;
    });

    const totalFormatted = `${proposal.currency} ${(proposal.charges.totalMinor / 100).toFixed(2)}`;

    let response = `${itemSummaries.join(', ')}. `;
    if (proposal.charges.deliveryFeeMinor > 0) {
      const deliveryFormatted = `${proposal.currency} ${(proposal.charges.deliveryFeeMinor / 100).toFixed(2)}`;
      response += `Delivery fee is ${deliveryFormatted}. `;
    }

    response += `Total payable is ${totalFormatted}. Shall I confirm and add this to your cart?`;
    return response;
  }

  /**
   * Formats cart confirmation success.
   */
  public static renderCartConfirmed(
    cartId: string,
    newCartVersion: number,
    totalMinor: number,
    currency: string,
  ): string {
    const totalFormatted = `${currency} ${(totalMinor / 100).toFixed(2)}`;
    return `Cart updated successfully (Total: ${totalFormatted}). You can proceed to checkout when ready.`;
  }

  /**
   * Formats live tracking status.
   */
  public static renderTracking(report: VerifiedTrackingReport): string {
    return report.formattedSummary;
  }

  /**
   * Formats clarification question with clickable or spoken choices.
   */
  public static renderClarification(
    question: string,
    options: readonly string[],
  ): string {
    return `${question} Options: ${options.join(', ')}.`;
  }
}
