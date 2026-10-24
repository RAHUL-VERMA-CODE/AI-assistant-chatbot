import http from 'node:http';
import { SessionTokenService } from '../../../packages/platform/src/auth/session-token.ts';
import { ConnectorClient } from '../../../packages/connector-sdk/src/client.ts';
import { ProposalManager } from '../../../packages/policy-engine/src/proposal-manager.ts';
import { TurnOrchestrator } from '../../../packages/orchestrator/src/state-machine/machine.ts';
import { MockLLMProvider } from '../../../packages/llm/src/adapters/mock-adapter.ts';
import { createLLMProvider } from '../../../packages/llm/src/factory.ts';
import type { LLMProvider } from '../../../packages/llm/src/interfaces/llm-provider.ts';
import { TrackingService } from '../../../packages/policy-food/src/tracking/tracking-service.ts';
import { AdminService } from './admin/admin-service.ts';
import {
  AppError,
  UnauthorizedError,
  ValidationError,
  asTenantId,
  asUserRef,
  asSessionId,
  asBranchId,
  asCartId,
} from '../../../packages/core/src/index.ts';
import type { CustomerPreferences } from '../../../packages/policy-engine/src/constraint-evaluator.ts';

export class ApiServer {
  private readonly server: http.Server;
  private readonly sessionTokenService: SessionTokenService;
  private readonly connector: ConnectorClient;
  private readonly proposalManager: ProposalManager;
  private readonly orchestrator: TurnOrchestrator;
  private readonly adminService: AdminService;
  private readonly adminKey: string;
  private readonly userPreferences = new Map<string, CustomerPreferences>();

  constructor(options: {
    connectorUrl: string;
    connectorSecret: string;
    jwtSecret?: string;
    adminKey?: string;
    llm?: LLMProvider;
  }) {
    this.sessionTokenService = new SessionTokenService(
      options.jwtSecret || 'vca_api_jwt_secret_32_characters_long_min',
    );
    this.connector = new ConnectorClient({
      baseUrl: options.connectorUrl,
      signingSecret: options.connectorSecret,
      allowLocalhostForTesting: true,
    });
    this.proposalManager = new ProposalManager();

    let llm = options.llm;
    if (!llm) {
      try {
        llm = createLLMProvider();
      } catch {
        llm = new MockLLMProvider();
      }
    }

    this.orchestrator = new TurnOrchestrator({
      connector: this.connector,
      proposalManager: this.proposalManager,
      llm,
    });
    this.adminService = new AdminService();
    this.adminKey = options.adminKey || 'vca_master_admin_secret';

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public getAdminService(): AdminService {
    return this.adminService;
  }

  public async start(port = 8080): Promise<number> {
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
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Admin-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = req.url || '/';
    const parsedUrl = new URL(reqUrl, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    try {
      // 1. Health check
      if (method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), version: '1.0.0' }));
        return;
      }

      // Read JSON body
      const body = await this.readJsonBody(req);

      // --- Admin Endpoints (/v1/admin/*) ---
      if (pathname.startsWith('/v1/admin/')) {
        this.authenticateAdmin(req);
        await this.handleAdminRequest(method, pathname, body, res);
        return;
      }

      // 2. POST /v1/assistant/sessions
      if (method === 'POST' && pathname === '/v1/assistant/sessions') {
        const { tenantId, userRef, branchId } = body as any;
        if (!tenantId || !userRef || !branchId) {
          throw new ValidationError('tenantId, userRef, and branchId are required');
        }

        const sid = asSessionId(`ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        const token = this.sessionTokenService.sign({
          sessionId: sid,
          tenantId: asTenantId(tenantId),
          userRef: asUserRef(userRef),
          branchId: asBranchId(branchId),
          cartId: asCartId(`cart_${userRef}`),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            sessionId: sid,
            token,
            branchId,
            expiresIn: 3600,
          }),
        );
        return;
      }

      // 3. POST /v1/assistant/turns
      if (method === 'POST' && pathname === '/v1/assistant/turns') {
        const authPayload = this.authenticateRequest(req);
        const { utterance } = body as any;
        if (!utterance || typeof utterance !== 'string') {
          throw new ValidationError('Field utterance is required');
        }

        const savedPrefs = this.userPreferences.get(authPayload.userRef);

        const turnResult = await this.orchestrator.processTurn({
          sessionId: authPayload.sessionId,
          tenantId: authPayload.tenantId,
          userRef: authPayload.userRef,
          branchId: authPayload.branchId,
          utterance,
          savedPreferences: savedPrefs,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(turnResult));
        return;
      }

      // 4. POST /v1/cart/confirm
      if (method === 'POST' && pathname === '/v1/cart/confirm') {
        const authPayload = this.authenticateRequest(req);
        const { proposalId, expectedCartVersion } = body as any;
        if (!proposalId) {
          throw new ValidationError('Field proposalId is required');
        }

        const proposal = this.proposalManager.getProposal(proposalId);
        const idempotencyKey =
          (req.headers['idempotency-key'] as string) || `ik_api_confirm_${proposalId}`;

        const commitRes = await this.connector.commitCart({
          branchId: authPayload.branchId,
          userRef: authPayload.userRef,
          proposalId,
          expectedCartVersion: expectedCartVersion ?? proposal.cartVersion,
          items: proposal.rawChoices,
          idempotencyKey,
        });

        this.proposalManager.markApplied(proposalId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(commitRes));
        return;
      }

      // 5. GET /v1/orders/:id/status
      if (method === 'GET' && pathname.startsWith('/v1/orders/') && pathname.endsWith('/status')) {
        const authPayload = this.authenticateRequest(req);
        const parts = pathname.split('/');
        const orderId = parts[3]!;

        const rawStatus = await this.connector.getOrderStatus(orderId, authPayload.userRef);
        const verifiedReport = TrackingService.verifyAndFormatStatus(
          rawStatus,
          authPayload.userRef,
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(verifiedReport));
        return;
      }

      // 6. Preferences: GET, PATCH, DELETE /v1/me/preferences
      if (pathname === '/v1/me/preferences') {
        const authPayload = this.authenticateRequest(req);

        if (method === 'GET') {
          const prefs = this.userPreferences.get(authPayload.userRef) || {
            consented: false,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(prefs));
          return;
        }

        if (method === 'PATCH') {
          const current = this.userPreferences.get(authPayload.userRef) || { consented: true };
          const updated: CustomerPreferences = {
            ...current,
            ...(body as any),
            consented: true, // explicit opt-in
          };
          this.userPreferences.set(authPayload.userRef, updated);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
          return;
        }

        if (method === 'DELETE') {
          this.userPreferences.delete(authPayload.userRef);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Preferences deleted (Right to Erasure)' }));
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
    } catch (err) {
      if (err instanceof AppError) {
        res.writeHead(err.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(err.toJSON()));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  }

  private authenticateAdmin(req: http.IncomingMessage): void {
    const adminKeyHeader = req.headers['x-admin-key'];
    const authHeader = req.headers.authorization;
    const providedKey =
      adminKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null);

    if (!providedKey || providedKey !== this.adminKey) {
      throw new UnauthorizedError('Invalid or missing admin credentials');
    }
  }

  private async handleAdminRequest(
    method: string,
    pathname: string,
    body: any,
    res: http.ServerResponse,
  ): Promise<void> {
    const segments = pathname.split('/').filter(Boolean); // ['v1', 'admin', ...]

    // /v1/admin/tenants
    if (segments.length === 3 && segments[2] === 'tenants') {
      if (method === 'POST') {
        const tenant = this.adminService.createTenant(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tenant));
        return;
      }
      if (method === 'GET') {
        const tenants = this.adminService.listTenants();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tenants));
        return;
      }
    }

    // /v1/admin/tenants/:id
    if (segments.length === 4 && segments[2] === 'tenants') {
      const tenantId = segments[3]!;
      if (method === 'GET') {
        const tenant = this.adminService.getTenant(tenantId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tenant));
        return;
      }
      if (method === 'PATCH') {
        const updated = this.adminService.updateTenant(tenantId, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
        return;
      }
    }

    // /v1/admin/tenants/:id/keys
    if (segments.length === 5 && segments[2] === 'tenants' && segments[4] === 'keys') {
      const tenantId = segments[3]!;
      if (method === 'POST') {
        const keyResult = this.adminService.createApiKey(tenantId, body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(keyResult));
        return;
      }
      if (method === 'GET') {
        const keys = this.adminService.listApiKeys(tenantId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(keys));
        return;
      }
    }

    // DELETE /v1/admin/tenants/:id/keys/:keyId
    if (segments.length === 6 && segments[2] === 'tenants' && segments[4] === 'keys' && method === 'DELETE') {
      const tenantId = segments[3]!;
      const keyId = segments[5]!;
      this.adminService.revokeApiKey(tenantId, keyId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Key ${keyId} revoked` }));
      return;
    }

    // /v1/admin/tenants/:id/connector
    if (segments.length === 5 && segments[2] === 'tenants' && segments[4] === 'connector') {
      const tenantId = segments[3]!;
      if (method === 'POST') {
        const config = this.adminService.configureConnector(tenantId, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        return;
      }
      if (method === 'GET') {
        const config = this.adminService.getConnectorConfig(tenantId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        return;
      }
    }

    // POST /v1/admin/tenants/:id/connector/ping
    if (segments.length === 6 && segments[2] === 'tenants' && segments[4] === 'connector' && segments[5] === 'ping' && method === 'POST') {
      const tenantId = segments[3]!;
      const pingResult = await this.adminService.pingConnector(tenantId, body?.branchId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pingResult));
      return;
    }

    // GET /v1/admin/tenants/:id/audit-log
    if (segments.length === 5 && segments[2] === 'tenants' && segments[4] === 'audit-log' && method === 'GET') {
      const tenantId = segments[3]!;
      const auditLog = this.adminService.getAuditLog(tenantId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(auditLog));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
  }

  private authenticateRequest(req: http.IncomingMessage) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const token = authHeader.slice(7).trim();
    const claims = this.sessionTokenService.verify(token);
    return {
      sessionId: claims.sid,
      tenantId: claims.tid,
      userRef: claims.sub,
      branchId: claims.bid,
      cartId: claims.cid,
    };
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new ValidationError('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }
}
