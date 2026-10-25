# Universal Integration Guide: Voice Commerce Assistant & MongoDB

This guide explains how **ANY** external application or e-commerce platform (Shopify, WooCommerce, Next.js, Node.js/Express, Python/FastAPI/Django, Go, PHP, etc.) can seamlessly integrate the **Voice Commerce Assistant** SaaS and its dedicated **MongoDB database layer**.

---

## 1. Architecture & Integration Overview

```
┌────────────────────────────────────────────────────────┐
│               End Customer Browser / App               │
│   (Web, Mobile Web, React Native, iOS/Android WebView)  │
└───────────────────────────┬────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               │                         │
               ▼                         ▼
   ┌───────────────────────┐  ┌───────────────────────┐
   │  Voice Assistant SDK  │  │   Tenant Website /    │
   │   (voice-widget.js)   │  │   Mobile Frontend     │
   └───────────┬───────────┘  └───────────┬───────────┘
               │                          │
               │ WS / REST (Turns)        │ Order Placement
               ▼                          ▼
   ┌───────────────────────┐  ┌───────────────────────┐
   │ Voice Assistant SaaS  │  │  Tenant Own Backend   │
   │ Gateway (8080 / 8081) │  │  (Node, Python, PHP)  │
   └───────────┬───────────┘  └───────────┬───────────┘
               │                          │
               │ HMAC Signed Connector    │ Internal Queries
               ▼                          ▼
   ┌──────────────────────────────────────────────────┐
   │          Tenant Connector Endpoints              │
   │  (/catalog, /stock-price, /cart/validate, ...)   │
   └──────────────────────────┬───────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────┐
   │             Platform MongoDB Layer               │
   │    (Tenants, Catalogs, Orders, Preferences)      │
   └──────────────────────────────────────────────────┘
```

---

## 2. Option A: 1-Line Embed via `voice-widget.js`

If you have an existing website or storefront, embed the voice assistant with a single `<script>` tag:

```html
<!-- Add before </body> tag on any page -->
<script
  src="http://localhost:3000/voice-widget.js"
  data-tenant-id="your_tenant_id"
  data-branch-id="your_branch_id"
  data-api-url="http://localhost:8080"
  data-ws-url="ws://localhost:8081"
  data-user-ref="logged_in_user_id"
  data-primary-color="#6366f1"
  data-lang="en-IN">
</script>
```

### Listening to Assistant Events on Your Host Website
When the customer confirms a cart proposal by voice or click, the widget dispatches a native DOM event:

```javascript
window.addEventListener('vca:order-confirmed', (event) => {
  const { proposalId, result } = event.detail;
  console.log('Voice order confirmed by assistant:', result);

  // Redirect to your store's native checkout page
  window.location.href = `/checkout?cartId=${result.cartId}&total=${result.totalMinor}`;
});
```

---

## 3. Option B: Direct Connector Contract (Connecting Your Own Backend)

To allow the Voice Assistant to search your catalog, validate dietary constraints, check prices, and commit carts, implement the 5 HMAC-signed Connector Endpoints in your backend.

### Required Connector Endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/branches/:branchId/catalog` | `GET` | Return live menu, variants, recipe facts, and prices. |
| `/branches/:branchId/items/:itemId/stock-price` | `GET` | Real-time stock status and current price version. |
| `/cart/validate` | `POST` | Deterministic server calculation of line items, options, subtotal, and tax. |
| `/cart/commit` | `POST` | Atomically apply confirmed items into tenant cart with idempotency check. |
| `/orders/:orderId/status` | `GET` | Live order delivery tracking and rider status. |

### HMAC Signature Verification (Node.js Example)
Every incoming request from the Voice Assistant Gateway includes security headers:
- `x-connector-signature`: HMAC-SHA256 signature
- `x-connector-timestamp`: ISO 8601 timestamp (rejected if older than 300s)
- `x-connector-nonce`: Unique UUID

```javascript
import crypto from 'node:crypto';

function verifyConnectorRequest(req, secret) {
  const signature = req.headers['x-connector-signature'];
  const timestamp = req.headers['x-connector-timestamp'];
  const nonce = req.headers['x-connector-nonce'];
  const method = req.method.toUpperCase();
  const path = req.originalUrl;
  const bodyString = req.body ? JSON.stringify(req.body) : '';

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${nonce}.${method}.${path}.${bodyString}`);
  const expected = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## 4. Option C: Dedicated MongoDB Database Integration

The platform provides a dedicated MongoDB layer located in `packages/platform/src/database/mongodb/`.

### Checking Database Health
```bash
curl http://localhost:8080/v1/db/status
```
**Response:**
```json
{
  "status": "connected",
  "engine": "MongoDB",
  "database": "voice_commerce",
  "collections": {
    "tenants": 4,
    "apiKeys": 4,
    "connectors": 4,
    "catalogs": 4,
    "sessions": 12,
    "carts": 8,
    "orders": 5,
    "preferences": 3,
    "auditLogs": 24,
    "usageEvents": 15
  },
  "timestamp": "2026-10-25T10:20:00.000Z"
}
```

### Connecting to MongoDB from External Services
You can directly import and query collections using `mongoRepos`:

```typescript
import { mongoRepos } from '@vca/platform';

// 1. Fetch all active tenants
const activeTenants = await mongoRepos.tenants.find({ status: 'ACTIVE' });

// 2. Query orders for a specific customer
const userOrders = await mongoRepos.orders.find({
  tenantId: 'tenant_arpzo',
  userRef: 'usr_cust_01',
});

// 3. Update customer preferences (GDPR-compliant)
await mongoRepos.preferences.updateOne(
  { tenantId: 'tenant_arpzo', userRef: 'usr_cust_01' },
  { $set: { 'preferences.isJain': true, 'preferences.isVeg': true } },
  { upsert: true }
);
```

---

## 5. Multi-Vertical Support (Generic Architecture)

The system works across **any commerce vertical** out of the box:

1. **🍕 Food & Restaurant**:
   - Handles allergens (dairy, gluten, nuts), Jain compliance (no root vegetables), spice levels, portion sizing, and multi-person group budget splitting.
2. **🛒 Grocery & Supermarket**:
   - Handles units (kg, litres, packets), fresh produce, organic badges, expiration and cold-chain constraints.
3. **⚡ Electronics & Retail**:
   - Handles technical specifications, warranty tiers, color/storage variants, and accessory bundles.
4. **💊 Pharmacy & Health**:
   - Handles OTC medicine categorization, active pharmaceutical ingredients, dosage strengths, and doctor consultation handoffs.

---

## 6. Testing & Verifying Your Integration

Run the conformance and integration test suites:

```bash
# Run all tests
npm test

# Launch all servers and test interactive UI
node start-all.js
```
Open your browser to `http://localhost:3000` to interactively speak in English, Hindi, or Hinglish with any store vertical.
