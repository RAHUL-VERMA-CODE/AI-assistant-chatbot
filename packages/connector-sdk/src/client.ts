import type {
  BranchCatalog,
  CartValidateRequest,
  CartValidateResponse,
  CartCommitRequest,
  CartCommitResponse,
  PastOrder,
  OrderStatusResponse,
} from '../../connector-contract/src/index.ts';
import { ConnectorSigner } from './signer.ts';
import { SsrfGuard } from './ssrf-guard.ts';
import { CircuitBreaker } from '../../platform/src/concurrency/circuit-breaker.ts';
import { SingleFlight } from '../../platform/src/concurrency/single-flight.ts';
import { ProviderUnavailableError, NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../core/src/index.ts';

export interface ConnectorClientOptions {
  readonly baseUrl: string;
  readonly signingSecret: string;
  readonly timeoutMs?: number;
  readonly allowLocalhostForTesting?: boolean;
}

export class ConnectorClient {
  private readonly baseUrl: string;
  private readonly signer: ConnectorSigner;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly singleFlight = new SingleFlight();
  private readonly timeoutMs: number;
  private readonly allowLocalhost: boolean;

  constructor(options: ConnectorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.signer = new ConnectorSigner(options.signingSecret);
    this.circuitBreaker = new CircuitBreaker(`connector:${options.baseUrl}`);
    this.timeoutMs = options.timeoutMs || 4000;
    this.allowLocalhost = options.allowLocalhostForTesting ?? false;
  }

  public async getCatalog(branchId: string): Promise<BranchCatalog> {
    const path = `/branches/${encodeURIComponent(branchId)}/catalog`;
    return this.singleFlight.do(`catalog:${branchId}`, () =>
      this.request<BranchCatalog>('GET', path),
    );
  }

  public async validateCart(request: CartValidateRequest): Promise<CartValidateResponse> {
    const path = '/cart/validate';
    return this.request<CartValidateResponse>('POST', path, request);
  }

  public async commitCart(request: CartCommitRequest): Promise<CartCommitResponse> {
    const path = '/cart/commit';
    const extraHeaders = {
      'Idempotency-Key': request.idempotencyKey,
    };
    return this.request<CartCommitResponse>('POST', path, request, extraHeaders);
  }

  public async getLatestOrder(userRef: string, branchId?: string): Promise<PastOrder | null> {
    let path = `/users/${encodeURIComponent(userRef)}/orders/latest`;
    if (branchId) {
      path += `?branch_id=${encodeURIComponent(branchId)}`;
    }
    try {
      return await this.request<PastOrder>('GET', path);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return null;
      }
      throw err;
    }
  }

  public async getOrderStatus(orderId: string, userRef: string): Promise<OrderStatusResponse> {
    const path = `/orders/${encodeURIComponent(orderId)}/status?user_ref=${encodeURIComponent(userRef)}`;
    return this.request<OrderStatusResponse>('GET', path);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const isCircuitFailure = (err: unknown): boolean => {
      if (
        err instanceof NotFoundError ||
        err instanceof ForbiddenError ||
        err instanceof ConflictError ||
        err instanceof ValidationError
      ) {
        return false;
      }
      return true;
    };

    return this.circuitBreaker.execute(async () => {
      const fullUrl = `${this.baseUrl}${path}`;

      // 1. SSRF & DNS Pinning validation
      await SsrfGuard.validateAndResolveUrl(fullUrl, this.allowLocalhost);

      // 2. Generate HMAC-SHA256 signature headers
      const signatureHeaders = this.signer.sign(method, path, body);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(fullUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...signatureHeaders,
            ...(extraHeaders || {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          redirect: 'error', // Disallow HTTP redirects
        });

        if (response.status === 404) {
          throw new NotFoundError('Connector resource', path);
        }
        if (response.status === 403) {
          const forbiddenBody = await response.text();
          throw new ForbiddenError(forbiddenBody || 'Access denied');
        }
        if (response.status === 409) {
          const conflictBody = await response.text();
          throw new ConflictError(conflictBody || 'Stale version conflict at connector');
        }
        if (response.status === 422) {
          const errBody = await response.text();
          throw new ValidationError(errBody || 'Invalid choices in connector request');
        }
        if (!response.ok) {
          const text = await response.text().catch(() => 'Unknown error');
          throw new ProviderUnavailableError('TenantConnector', `HTTP ${response.status}: ${text}`);
        }

        return (await response.json()) as T;
      } catch (err) {
        if (
          err instanceof NotFoundError ||
          err instanceof ForbiddenError ||
          err instanceof ConflictError ||
          err instanceof ValidationError
        ) {
          throw err;
        }
        throw new ProviderUnavailableError('TenantConnector', String(err));
      } finally {
        clearTimeout(timeout);
      }
    }, isCircuitFailure);
  }
}
