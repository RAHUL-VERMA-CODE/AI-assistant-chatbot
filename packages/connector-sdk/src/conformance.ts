import { ConnectorClient } from './client.ts';
import { ConnectorSigner } from './signer.ts';

export interface ConformanceTestResult {
  readonly testId: string;
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

export interface ConformanceSuiteReport {
  readonly tenantBaseUrl: string;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly allPassed: boolean;
  readonly results: ConformanceTestResult[];
}

export class ConnectorConformanceKit {
  private readonly client: ConnectorClient;
  private readonly signer: ConnectorSigner;
  private readonly baseUrl: string;

  constructor(options: {
    baseUrl: string;
    signingSecret: string;
    allowLocalhostForTesting?: boolean;
  }) {
    this.baseUrl = options.baseUrl;
    this.client = new ConnectorClient(options);
    this.signer = new ConnectorSigner(options.signingSecret);
  }

  public async runAllTests(sampleBranchId = 'branch_default', sampleUserRef = 'user_test_01'): Promise<ConformanceSuiteReport> {
    const results: ConformanceTestResult[] = [];

    // Test 1: Fetch Catalog and Verify Tri-State Schema
    await this.runTest(results, 'CONF_01', 'Catalog Fetch & Tri-State Field Integrity', async () => {
      const catalog = await this.client.getCatalog(sampleBranchId);
      if (!catalog || !catalog.items || catalog.items.length === 0) {
        throw new Error('Catalog is empty or missing items array');
      }
      if (!catalog.currency || typeof catalog.menuVersion !== 'number') {
        throw new Error('Catalog missing valid currency or menuVersion');
      }
      const first = catalog.items[0]!;
      if (!first.recipe || !['TRUE', 'FALSE', 'UNKNOWN'].includes(first.recipe.isJain)) {
        throw new Error(`Item ${first.id} has invalid tri-state isJain field: ${first.recipe?.isJain}`);
      }
    });

    // Test 2: Reject Tampered HMAC Signature
    await this.runTest(results, 'CONF_02', 'Rejection of Tampered Signature (401/403)', async () => {
      const path = `/branches/${sampleBranchId}/catalog`;
      const url = `${this.baseUrl}${path}`;
      const headers = this.signer.sign('GET', path);
      // Tamper signature
      const tampered = {
        ...headers,
        'X-Connector-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
      };
      const res = await fetch(url, { headers: tampered });
      if (res.status !== 401 && res.status !== 403) {
        throw new Error(`Expected 401/403 on tampered signature, but got HTTP ${res.status}`);
      }
    });

    // Test 3: Reject Replay Attacks with Old Timestamps (> 300s)
    await this.runTest(results, 'CONF_03', 'Rejection of Expired Timestamp / Clock Skew (>300s)', async () => {
      const path = `/branches/${sampleBranchId}/catalog`;
      const url = `${this.baseUrl}${path}`;
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 mins old
      const headers = {
        ...this.signer.sign('GET', path),
        'X-Connector-Timestamp': staleTimestamp,
      };
      const res = await fetch(url, { headers });
      if (res.status !== 401 && res.status !== 403) {
        throw new Error(`Expected 401/403 on stale timestamp replay, but got HTTP ${res.status}`);
      }
    });

    // Test 4: Cart Validation in Integer Minor Units
    await this.runTest(results, 'CONF_04', 'Authoritative Cart Validation & Minor Units', async () => {
      const catalog = await this.client.getCatalog(sampleBranchId);
      const item = catalog.items.find((i) => i.inStock) || catalog.items[0]!;
      const validation = await this.client.validateCart({
        branchId: sampleBranchId,
        userRef: sampleUserRef,
        items: [{ itemId: item.id, quantity: 1, optionIds: [] }],
      });

      if (!validation.valid || typeof validation.totalMinor !== 'number') {
        throw new Error('Validation failed or totalMinor is not a valid number');
      }
      if (!Number.isInteger(validation.totalMinor)) {
        throw new Error(`totalMinor must be an integer, got: ${validation.totalMinor}`);
      }
    });

    // Test 5: Idempotent Cart Commit
    await this.runTest(results, 'CONF_05', 'Idempotent Cart Commit with Versioning', async () => {
      const catalog = await this.client.getCatalog(sampleBranchId);
      const item = catalog.items.find((i) => i.inStock) || catalog.items[0]!;
      const validation = await this.client.validateCart({
        branchId: sampleBranchId,
        userRef: sampleUserRef,
        items: [{ itemId: item.id, quantity: 1, optionIds: [] }],
      });

      const idempotencyKey = `conf_ik_${Date.now()}`;
      const commitRes1 = await this.client.commitCart({
        branchId: sampleBranchId,
        userRef: sampleUserRef,
        proposalId: 'prop_conf_01',
        expectedCartVersion: validation.cartVersion,
        items: [{ itemId: item.id, quantity: 1, optionIds: [] }],
        idempotencyKey,
      });

      if (!commitRes1.success || typeof commitRes1.newCartVersion !== 'number') {
        throw new Error('Cart commit was not successful');
      }

      // Re-send with same idempotency key
      const commitRes2 = await this.client.commitCart({
        branchId: sampleBranchId,
        userRef: sampleUserRef,
        proposalId: 'prop_conf_01',
        expectedCartVersion: validation.cartVersion,
        items: [{ itemId: item.id, quantity: 1, optionIds: [] }],
        idempotencyKey,
      });

      if (commitRes1.newCartVersion !== commitRes2.newCartVersion) {
        throw new Error('Idempotent repeated commit produced different cart versions');
      }
    });

    const passed = results.filter((r) => r.passed).length;
    return {
      tenantBaseUrl: this.baseUrl,
      totalTests: results.length,
      passedTests: passed,
      failedTests: results.length - passed,
      allPassed: passed === results.length,
      results,
    };
  }

  private async runTest(
    results: ConformanceTestResult[],
    testId: string,
    name: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      results.push({
        testId,
        name,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      results.push({
        testId,
        name,
        passed: false,
        durationMs: Date.now() - start,
        error: String(err),
      });
    }
  }
}
