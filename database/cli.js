#!/usr/bin/env node

/**
 * Database CLI Explorer
 * Interactive command-line utility to inspect, query, seed, and manage platform data.
 *
 * Usage:
 *   node database/cli.js stats
 *   node database/cli.js list <collection> [limit]
 *   node database/cli.js query <collection> '<json_filter>'
 *   node database/cli.js seed
 *   node database/cli.js clear <collection>
 */

import { db } from './client.js';

const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : 'help';

async function run() {
  switch (command) {
    case 'stats': {
      console.log('\n📊 Voice Commerce Assistant - Database Collection Statistics');
      console.log('==============================================================');
      const stats = await db.getStats();
      for (const [col, count] of Object.entries(stats)) {
        const paddedCol = col.padEnd(24, ' ');
        console.log(`  • ${paddedCol}: ${count} document(s)`);
      }
      console.log('==============================================================\n');
      break;
    }

    case 'list': {
      const colName = args[1];
      const limit = parseInt(args[2] || '20', 10);
      if (!colName) {
        console.error('Error: Please specify collection name. Example: node database/cli.js list tenants');
        process.exit(1);
      }
      const col = db[colName];
      if (!col || typeof col.find !== 'function') {
        console.error(`Error: Unknown collection '${colName}'. Available: tenants, apiKeys, connectors, catalogs, sessions, carts, orders, preferences, auditLogs, usageEvents`);
        process.exit(1);
      }
      const docs = await col.find({});
      const slice = docs.slice(0, limit);
      console.log(`\n📂 Listing ${slice.length} of ${docs.length} document(s) from collection: '${colName}':\n`);
      console.log(JSON.stringify(slice, null, 2));
      console.log('');
      break;
    }

    case 'query': {
      const colName = args[1];
      const filterStr = args[2];
      if (!colName || !filterStr) {
        console.error('Error: Please provide collection and JSON filter. Example: node database/cli.js query orders \'{"status":"CONFIRMED"}\'');
        process.exit(1);
      }
      let filter = {};
      try {
        filter = JSON.parse(filterStr);
      } catch (e) {
        console.error('Error: Malformed JSON filter:', e.message);
        process.exit(1);
      }
      const col = db[colName];
      if (!col) {
        console.error(`Error: Unknown collection '${colName}'`);
        process.exit(1);
      }
      const matches = await col.find(filter);
      console.log(`\n🔍 Query returned ${matches.length} matching document(s):\n`);
      console.log(JSON.stringify(matches, null, 2));
      console.log('');
      break;
    }

    case 'seed': {
      console.log('\n🌱 Seeding default multi-vertical tenants and catalogs...');
      await db.seedDefaults();
      console.log('✓ Seeding complete! Run `node database/cli.js stats` to see counts.\n');
      break;
    }

    case 'clear': {
      const colName = args[1];
      if (!colName) {
        console.error('Error: Please specify collection to clear. Example: node database/cli.js clear sessions');
        process.exit(1);
      }
      const col = db[colName];
      if (!col) {
        console.error(`Error: Unknown collection '${colName}'`);
        process.exit(1);
      }
      const res = await col.deleteMany({});
      console.log(`\n🗑️ Deleted ${res.deletedCount} document(s) from '${colName}'.\n`);
      break;
    }

    case 'help':
    default: {
      console.log(`
Voice Commerce Assistant - Database Management CLI
==================================================
Commands:
  node database/cli.js stats                       Display document counts for all collections
  node database/cli.js list <collection> [limit]   List documents (e.g. tenants, orders, sessions)
  node database/cli.js query <col> '<filter_json>' Query documents with MongoDB filter operators
  node database/cli.js seed                        Seed demo tenants and vertical catalogs
  node database/cli.js clear <collection>          Delete all documents in a collection

Available Collections:
  - tenants
  - apiKeys
  - connectors
  - catalogs
  - sessions
  - carts
  - orders
  - preferences
  - auditLogs
  - usageEvents
`);
      break;
    }
  }
}

run().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
