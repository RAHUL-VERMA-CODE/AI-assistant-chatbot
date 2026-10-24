import crypto from 'node:crypto';

export interface SignatureHeaders {
  readonly 'X-Connector-Signature': string;
  readonly 'X-Connector-Timestamp': string;
  readonly 'X-Connector-Nonce': string;
}

export class ConnectorSigner {
  private readonly secret: Buffer;

  constructor(signingSecretHexOrString: string) {
    this.secret = Buffer.from(signingSecretHexOrString, 'utf8');
  }

  public sign(method: string, path: string, body?: unknown): SignatureHeaders {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();

    const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');

    const canonicalString = `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(canonicalString)
      .digest('hex');

    return {
      'X-Connector-Signature': signature,
      'X-Connector-Timestamp': timestamp,
      'X-Connector-Nonce': nonce,
    };
  }

  public verify(
    signature: string,
    timestamp: string,
    nonce: string,
    method: string,
    path: string,
    body?: unknown,
    maxClockSkewSeconds = 300,
  ): boolean {
    const now = Math.floor(Date.now() / 1000);
    const parsedTimestamp = parseInt(timestamp, 10);

    if (isNaN(parsedTimestamp) || Math.abs(now - parsedTimestamp) > maxClockSkewSeconds) {
      return false; // Replay attack or excessive clock skew
    }

    const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('hex');

    const canonicalString = `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(canonicalString)
      .digest('hex');

    const sigA = Buffer.from(signature, 'utf8');
    const sigB = Buffer.from(expectedSignature, 'utf8');

    if (sigA.length !== sigB.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigA, sigB);
  }
}
