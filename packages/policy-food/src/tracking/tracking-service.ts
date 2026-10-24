import { ForbiddenError, NotFoundError } from '../../../core/src/index.ts';
import type { OrderStatusResponse } from '../../../connector-contract/src/index.ts';

export interface VerifiedTrackingReport {
  readonly orderId: string;
  readonly status: string;
  readonly branchName: string;
  readonly itemsSummary: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly etaMinutes?: number;
  readonly isStale: boolean;
  readonly formattedSummary: string;
  readonly eligibleContactActions: readonly {
    readonly type: string;
    readonly label: string;
    readonly actionPayload: Record<string, unknown>;
  }[];
}

export class TrackingService {
  /**
   * Enforces customer ownership and extracts verified live order status.
   * Contact actions are passed through as opaque payloads; the assistant never places phone calls.
   */
  public static verifyAndFormatStatus(
    status: OrderStatusResponse,
    authenticatedUserRef: string,
    staleThresholdMinutes = 15,
  ): VerifiedTrackingReport {
    // 1. Strict ownership enforcement (Req A14)
    if (status.userRef !== authenticatedUserRef) {
      throw new ForbiddenError(
        `Access denied: Order '${status.orderId}' belongs to another customer account.`,
      );
    }

    // 2. Stale timestamp detection
    const updateTime = new Date(status.updatedAt).getTime();
    const ageMinutes = (Date.now() - updateTime) / (1000 * 60);
    const isStale = ageMinutes > staleThresholdMinutes || status.isStale;

    // 3. Human-readable voice-friendly summary
    let formattedSummary = `Order ${status.orderId} from ${status.branchName} is currently ${status.status.replace(/_/g, ' ').toLowerCase()}.`;

    if (status.etaMinutes !== undefined && status.etaMinutes > 0) {
      formattedSummary += ` Estimated delivery time is approximately ${status.etaMinutes} minutes.`;
    }

    if (isStale) {
      formattedSummary +=
        ' Note: Tracking updates from the kitchen have not refreshed recently.';
    }

    return {
      orderId: status.orderId,
      status: status.status,
      branchName: status.branchName,
      itemsSummary: status.itemsSummary,
      totalMinor: status.totalMinor,
      currency: status.currency,
      etaMinutes: status.etaMinutes,
      isStale,
      formattedSummary,
      eligibleContactActions: status.eligibleContactActions || [],
    };
  }
}
