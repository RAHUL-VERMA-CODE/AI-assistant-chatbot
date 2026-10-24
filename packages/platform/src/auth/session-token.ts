import crypto from 'node:crypto';
import { UnauthorizedError } from '../../../core/src/index.ts';
import type { TenantId, UserRef, SessionId, BranchId, CartId } from '../../../core/src/index.ts';

export interface ClientSessionClaims {
  readonly sub: UserRef;
  readonly tid: TenantId;
  readonly sid: SessionId;
  readonly bid: BranchId;
  readonly cid: CartId;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly aud: 'vca:assistant';
  readonly iss: 'vca:platform';
}

export class SessionTokenService {
  private readonly secret: Buffer;
  private readonly ttlSeconds: number;

  constructor(secretHex: string, ttlSeconds = 7200) {
    this.secret = Buffer.from(secretHex, 'utf8');
    this.ttlSeconds = ttlSeconds;
  }

  public sign(claims: {
    userRef: UserRef;
    tenantId: TenantId;
    sessionId: SessionId;
    branchId: BranchId;
    cartId: CartId;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: ClientSessionClaims = {
      sub: claims.userRef,
      tid: claims.tenantId,
      sid: claims.sessionId,
      bid: claims.branchId,
      cid: claims.cartId,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + this.ttlSeconds,
      aud: 'vca:assistant',
      iss: 'vca:platform',
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  public verify(token: string): ClientSessionClaims {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedError('Missing session token');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedError('Malformed session token');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      throw new UnauthorizedError('Invalid session token format');
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    // Constant-time signature comparison to prevent timing attacks
    const sigA = Buffer.from(signatureB64, 'utf8');
    const sigB = Buffer.from(expectedSignature, 'utf8');
    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      throw new UnauthorizedError('Invalid session token signature');
    }

    try {
      const payload: ClientSessionClaims = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        throw new UnauthorizedError('Session token has expired');
      }

      if (payload.aud !== 'vca:assistant' || payload.iss !== 'vca:platform') {
        throw new UnauthorizedError('Invalid token audience or issuer');
      }

      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        throw err;
      }
      throw new UnauthorizedError('Failed to parse session token claims');
    }
  }
}
