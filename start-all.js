import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemoTenantServer } from './tools/demo-tenant/src/server.ts';
import { ApiServer } from './apps/api/src/server.ts';
import { RealtimeServer } from './apps/realtime/src/server.ts';
import { loadConfig } from './packages/platform/src/config/env.ts';
import { mongoRepos } from './packages/platform/src/index.ts';
import { ARPZO_KORAMANGALA_CATALOG } from './tools/demo-tenant/src/seeds/arpzo-menu.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startAll() {
  const config = loadConfig();
  console.log('\n================================================================================');
  console.log('       VOICE COMMERCE ASSISTANT SAAS (MULTI-TENANT & MULTILINGUAL)');
  console.log('================================================================================');

  // 0. Seed & initialize MongoDB Database
  await mongoRepos.seedDefaults(ARPZO_KORAMANGALA_CATALOG);
  console.log('  ✓ 0. MongoDB Storage Engine: database/data/ (Persistent JSON collections)');

  // 1. Start Demo Tenant (port 4000)
  const demoServer = new DemoTenantServer('arpzo_connector_signing_secret_hmac_256');
  const demoPort = await demoServer.start(4000);
  console.log(`  ✓ 1. ARPZO Demo Tenant:   http://localhost:${demoPort}`);

  // 2. Start REST API Gateway (port 8080)
  const apiServer = new ApiServer({
    connectorUrl: `http://localhost:${demoPort}`,
    connectorSecret: 'arpzo_connector_signing_secret_hmac_256',
    adminKey: 'vca_master_admin_secret',
  });
  const apiPort = await apiServer.start(8080);
  console.log(`  ✓ 2. REST API Gateway:    http://localhost:${apiPort}`);

  // 3. Start Realtime Voice Gateway (port 8081)
  const realtimeServer = new RealtimeServer({
    connectorUrl: `http://localhost:${demoPort}`,
    connectorSecret: 'arpzo_connector_signing_secret_hmac_256',
  });
  const wsPort = await realtimeServer.start(8081);
  console.log(`  ✓ 3. Realtime Voice WS:   ws://localhost:${wsPort}`);

  // 4. Start Local Static HTTP Server for Demo UI & Embeddable Widget (port 3000)
  const demoHtmlPath = path.join(__dirname, 'packages', 'web-sdk', 'src', 'demo', 'index.html');
  const widgetJsPath = path.join(__dirname, 'packages', 'web-sdk', 'src', 'widget', 'voice-widget.js');

  const uiServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = (req.url || '/').split('?')[0];
    if (reqUrl === '/voice-widget.js' && fs.existsSync(widgetJsPath)) {
      const content = fs.readFileSync(widgetJsPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(content);
      return;
    }

    if (fs.existsSync(demoHtmlPath)) {
      const content = fs.readFileSync(demoHtmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Demo HTML file not found');
    }
  });

  const uiPort = await new Promise((resolve) => {
    uiServer.listen(3000, () => resolve(3000));
  });
  console.log(`  ✓ 4. Web Demo Client:     http://localhost:${uiPort}  (👈 Open this in your browser!)`);

  console.log('================================================================================');
  console.log(`  LLM Provider Active:     ${config.llm.provider} (${config.llm.model})`);
  console.log('  Press Ctrl+C to gracefully stop all services.');
  console.log('================================================================================\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down all services gracefully...');
    await Promise.all([
      apiServer.stop(),
      realtimeServer.stop(),
      demoServer.stop(),
      new Promise((resolve) => uiServer.close(resolve)),
    ]);
    console.log('All services stopped. Goodbye!\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startAll().catch((err) => {
  console.error('Fatal error starting services:', err);
  process.exit(1);
});
