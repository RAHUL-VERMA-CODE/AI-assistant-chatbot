import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DemoTenantServer } from '../../../tools/demo-tenant/src/server.ts';
import { ConnectorConformanceKit } from './conformance.ts';

describe('ConnectorConformanceKit Certification', () => {
  let server: DemoTenantServer;
  let serverPort: number;

  before(async () => {
    server = new DemoTenantServer('arpzo_conformance_secret_256');
    serverPort = await server.start(0);
  });

  after(async () => {
    await server.stop();
  });

  it('certifies ARPZO Demo Tenant as 100% compliant with Connector Contract', async () => {
    const kit = new ConnectorConformanceKit({
      baseUrl: `http://localhost:${serverPort}`,
      signingSecret: 'arpzo_conformance_secret_256',
      allowLocalhostForTesting: true,
    });

    const report = await kit.runAllTests('branch_koramangala', 'usr_cust_01');

    assert.equal(report.allPassed, true);
    assert.equal(report.failedTests, 0);
    assert.ok(report.totalTests >= 5);
    assert.equal(report.passedTests, report.totalTests);
  });
});
