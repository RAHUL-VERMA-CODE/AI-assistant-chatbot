# Database Access & Architecture Guide

This directory (`/database`) contains the standalone, dedicated **MongoDB Database Layer** for the Voice Commerce Assistant Platform. It manages all platform state: tenants, catalogs, carts, orders, sessions, customer dietary preferences, usage events, and security audit logs.

---

## 1. Storage Location & Directory Structure

```
database/
├── data/                    # JSON/BSON document collections (persistent disk storage)
│   ├── tenants.json
│   ├── catalogs.json
│   ├── orders.json
│   ├── sessions.json
│   ├── carts.json
│   ├── customer_preferences.json
│   └── audit_logs.json
├── client.js                # Universal MongoDB client (ESM / pure JavaScript)
├── client.ts                # TypeScript typed database client
├── models.ts                # Document schema interfaces (TypeScript)
├── cli.js                   # Interactive Terminal CLI tool for queries & management
└── README.md                # This comprehensive access documentation
```

---

## 2. Access Method 1: Interactive Terminal CLI

You can query, inspect, seed, or clear collections directly from your terminal using standard Node:

### 1. View Collection Statistics
```bash
node database/cli.js stats
```

### 2. List Documents in a Collection
```bash
# List first 20 tenants
node database/cli.js list tenants

# List all orders
node database/cli.js list orders

# List active sessions
node database/cli.js list sessions
```

### 3. Query Documents with MongoDB Filter Operators
```bash
# Query active tenants
node database/cli.js query tenants '{"status":"ACTIVE"}'

# Query food or grocery verticals
node database/cli.js query tenants '{"vertical":{"$in":["food","grocery"]}}'

# Query confirmed orders
node database/cli.js query orders '{"status":"CONFIRMED"}'
```

### 4. Seed Default Multi-Vertical Data
```bash
node database/cli.js seed
```

### 5. Clear a Collection
```bash
node database/cli.js clear sessions
```

---

## 3. Access Method 2: REST API Endpoints

The API Gateway (`http://localhost:8080`) provides HTTP endpoints to inspect and query the database:

### 1. Database Health & Statistics
```bash
curl http://localhost:8080/v1/db/status
```
**Output:**
```json
{
  "status": "connected",
  "engine": "MongoDB",
  "database": "voice_commerce",
  "collections": {
    "tenants": 4,
    "catalogs": 4,
    "orders": 12,
    "sessions": 8
  }
}
```

### 2. Query Collection via HTTP
```bash
curl http://localhost:8080/v1/db/collections/tenants
curl http://localhost:8080/v1/db/collections/orders
```

---

## 4. Access Method 3: Direct Code Import (Node.js / TypeScript)

You can import `db` into any internal or external service:

```javascript
import { db } from './database/client.js';

// Insert an order
await db.orders.insertOne({
  orderId: 'ord_12345',
  tenantId: 'tenant_arpzo',
  totalMinor: 49900,
  currency: 'INR',
  status: 'CONFIRMED',
  createdAt: new Date().toISOString()
});

// Find with MongoDB query operators ($eq, $in, $gt, etc.)
const confirmedOrders = await db.orders.find({
  status: 'CONFIRMED',
  totalMinor: { $gte: 20000 }
});

// Update document ($set, $inc)
await db.orders.updateOne(
  { orderId: 'ord_12345' },
  { $set: { status: 'OUT_FOR_DELIVERY' } }
);
```

---

## 5. Access Method 4: Visual Database Explorer (In the Web UI)

Open the web application at **`http://localhost:3000`** and click the **"📊 Database Explorer"** tab in the sidebar. You can inspect all collections, view real-time document counts, examine raw JSON documents, and execute live queries directly in your browser.
