import http from 'node:http';
import { DemoTenantDatabase } from './database.ts';
import { ConnectorSigner } from '../../../packages/connector-sdk/src/signer.ts';
import type {
  CartValidateRequest,
  CartValidateResponse,
  CartCommitRequest,
  CartCommitResponse,
  ValidatedLineItem,
} from '../../../packages/connector-contract/src/index.ts';

export class DemoTenantServer {
  public readonly signingSecret: string;
  private readonly db = new DemoTenantDatabase();
  private readonly signer: ConnectorSigner;
  private readonly server: http.Server;
  private readonly idempotencyCache = new Map<string, { body: string; status: number }>();

  constructor(signingSecret = 'arpzo_connector_signing_secret_hmac_256') {
    this.signingSecret = signingSecret;
    this.signer = new ConnectorSigner(signingSecret);
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public async start(port = 4000): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reqUrl = req.url || '/';
    const parsedUrl = new URL(reqUrl, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // 1. Read request body
    const bodyString = await this.readBody(req);
    let parsedBody: unknown;
    if (bodyString) {
      try {
        parsedBody = JSON.parse(bodyString);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        return;
      }
    }

    // 2. Validate HMAC Signature and Timestamp
    const signature = req.headers['x-connector-signature'] as string | undefined;
    const timestamp = req.headers['x-connector-timestamp'] as string | undefined;
    const nonce = req.headers['x-connector-nonce'] as string | undefined;

    if (!signature || !timestamp || !nonce) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing connector signature headers' }));
      return;
    }

    const isValid = this.signer.verify(signature, timestamp, nonce, method, reqUrl, parsedBody);
    if (!isValid) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid HMAC signature or expired timestamp' }));
      return;
    }

    // 3. Route Dispatch
    try {
      if (method === 'GET' && pathname.startsWith('/branches/') && pathname.endsWith('/catalog')) {
        const branchId = pathname.split('/')[2];
        const catalog = this.db.getCatalog(branchId || '');
        if (!catalog) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Branch '${branchId}' not found` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(catalog));
        return;
      }

      if (method === 'POST' && pathname === '/cart/validate') {
        const valReq = parsedBody as CartValidateRequest;
        const catalog = this.db.getCatalog(valReq.branchId);
        if (!catalog) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Branch not found' }));
          return;
        }

        const response = this.calculateCartValidation(catalog, valReq);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      }

      if (method === 'POST' && pathname === '/cart/commit') {
        const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
        if (idempotencyKey && this.idempotencyCache.has(idempotencyKey)) {
          const cached = this.idempotencyCache.get(idempotencyKey)!;
          res.writeHead(cached.status, { 'Content-Type': 'application/json' });
          res.end(cached.body);
          return;
        }

        const commitReq = parsedBody as CartCommitRequest;
        const currentCart = this.db.getCart(commitReq.userRef);

        if (currentCart.cartVersion !== commitReq.expectedCartVersion) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Stale cart version',
              expected: commitReq.expectedCartVersion,
              current: currentCart.cartVersion,
            }),
          );
          return;
        }

        const catalog = this.db.getCatalog(commitReq.branchId)!;
        const validated = this.calculateCartValidation(catalog, {
          branchId: commitReq.branchId,
          userRef: commitReq.userRef,
          items: commitReq.items,
        });

        const newVersion = currentCart.cartVersion + 1;
        this.db.setCart(commitReq.userRef, {
          cartId: currentCart.cartId,
          cartVersion: newVersion,
          items: commitReq.items,
          totalMinor: validated.totalMinor,
        });

        const commitRes: CartCommitResponse = {
          success: true,
          cartId: currentCart.cartId,
          newCartVersion: newVersion,
          totalMinor: validated.totalMinor,
          currency: catalog.currency,
          committedAt: new Date().toISOString(),
        };

        const resBody = JSON.stringify(commitRes);
        if (idempotencyKey) {
          this.idempotencyCache.set(idempotencyKey, { body: resBody, status: 200 });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(resBody);
        return;
      }

      if (method === 'GET' && pathname.startsWith('/users/') && pathname.endsWith('/orders/latest')) {
        const parts = pathname.split('/');
        const userRef = parts[2] || '';
        const branchId = parsedUrl.searchParams.get('branch_id') || undefined;

        const latestOrder = this.db.getLatestPastOrder(userRef, branchId);
        if (!latestOrder) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No past completed orders found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(latestOrder));
        return;
      }

      if (method === 'GET' && pathname.startsWith('/orders/') && pathname.endsWith('/status')) {
        const parts = pathname.split('/');
        const orderId = parts[2] || '';
        const userRef = parsedUrl.searchParams.get('user_ref');

        const order = this.db.getActiveOrder(orderId);
        if (!order) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Order '${orderId}' not found` }));
          return;
        }
        if (order.userRef !== userRef) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied: order belongs to another customer' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }

  private calculateCartValidation(catalog: any, req: CartValidateRequest): CartValidateResponse {
    let subtotalMinor = 0;
    const validatedItems: ValidatedLineItem[] = [];

    for (const choice of req.items) {
      const item = catalog.items.find((i: any) => i.id === choice.itemId);
      if (!item) {
        continue;
      }

      let unitPrice = item.basePriceMinor;
      let variantName: string | undefined;

      if (choice.variantId) {
        const variant = item.variants.find((v: any) => v.id === choice.variantId);
        if (variant) {
          unitPrice = variant.priceMinor;
          variantName = variant.name;
        }
      }

      const optionNames: string[] = [];
      for (const optId of choice.optionIds) {
        for (const grp of item.optionGroups) {
          const opt = grp.options.find((o: any) => o.id === optId);
          if (opt) {
            unitPrice += opt.priceDeltaMinor;
            optionNames.push(opt.name);
          }
        }
      }

      const lineTotal = unitPrice * choice.quantity;
      subtotalMinor += lineTotal;

      validatedItems.push({
        itemId: item.id,
        itemName: item.name,
        variantId: choice.variantId,
        variantName,
        optionIds: choice.optionIds,
        optionNames,
        quantity: choice.quantity,
        unitPriceMinor: unitPrice,
        totalMinor: lineTotal,
        inStock: item.inStock,
        warnings: [],
      });
    }

    const taxesMinor = Math.round(subtotalMinor * 0.05); // 5% GST
    const packagingFeeMinor = 2500; // INR 25.00
    const deliveryFeeMinor = 4000; // INR 40.00
    const totalMinor = subtotalMinor + taxesMinor + packagingFeeMinor + deliveryFeeMinor;

    const currentCart = this.db.getCart(req.userRef);

    return {
      valid: true,
      currency: catalog.currency,
      subtotalMinor,
      taxesMinor,
      packagingFeeMinor,
      deliveryFeeMinor,
      totalMinor,
      lineItems: validatedItems,
      menuVersion: catalog.menuVersion,
      cartVersion: currentCart.cartVersion,
      warnings: [],
    };
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
}
