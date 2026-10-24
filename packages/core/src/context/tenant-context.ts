import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantId, UserRef, SessionId } from '../types/id.js';

export interface RequestContext {
  readonly tenantId: TenantId;
  readonly requestId: string;
  readonly userRef?: UserRef;
  readonly sessionId?: SessionId;
  readonly language?: string;
  readonly startTimeMs: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export class TenantContext {
  public static run<R>(context: RequestContext, fn: () => R): R {
    return asyncLocalStorage.run(context, fn);
  }

  public static get(): RequestContext | undefined {
    return asyncLocalStorage.getStore();
  }

  public static getRequired(): RequestContext {
    const context = asyncLocalStorage.getStore();
    if (!context) {
      throw new Error('TenantContext is not set for the current asynchronous call stack.');
    }
    return context;
  }

  public static getTenantId(): TenantId {
    return TenantContext.getRequired().tenantId;
  }

  public static getRequestId(): string {
    return TenantContext.get()?.requestId ?? 'req_anonymous';
  }
}
