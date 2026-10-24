# Tenant Connector Integration Guide (INTEGRATION_GUIDE.md)

This guide walks tenant software engineering teams through connecting their existing online ordering platform, product catalog, and order database to the Voice Commerce Assistant SaaS.

---

## 1. Overview & Security Architecture

The Voice Commerce Assistant acts as an AI conversational frontend for your platform. It never owns commerce truth:
- Your backend owns prices, stock, cart modifications, delivery fees, taxes, and payment processing.
- All requests between the Voice Commerce Assistant and your connector are signed via **HMAC-SHA256** using a shared secret.
- The assistant enforces strict **SSRF guards**, disallowing private loopback or cloud metadata IPs in production.

```text
Voice Commerce Assistant ---- Signed HTTPS Request ----> [ Your Connector API ]
                                                                 │
                                                       ┌─────────┴─────────┐
                                                       ▼                   ▼
                                                  Your Catalog DB    Your Order/Cart DB
```

---

## 2. Cryptographic Request Signing Contract

Every HTTP request to your connector includes four security headers:
- `X-Connector-Signature`: Hex-encoded HMAC-SHA256 signature.
- `X-Connector-Timestamp`: ISO 8601 UTC timestamp.
- `X-Connector-Nonce`: Cryptographic random UUID (prevents replay attacks).
- `Idempotency-Key`: Unique idempotency key on write operations.

### Signature Calculation Algorithm
```typescript
const signaturePayload = `${method.toUpperCase()}|${path}|${timestamp}|${nonce}|${bodyString}`;
const computedSignature = crypto
  .createHmac('sha256', sharedSecret)
  .update(signaturePayload)
  .digest('hex');
```

---

## 3. Required Endpoints

Your connector must implement five standard endpoints:

### 1. `GET /branches/:branchId/catalog`
Returns the active menu catalog with verified tri-state dietary flags (`TRUE`, `FALSE`, `UNKNOWN`).
- **Response:**
  ```json
  {
    "tenantId": "tenant_your_company",
    "branchId": "branch_downtown",
    "menuVersion": 1,
    "items": [
      {
        "id": "item_123",
        "name": "Paneer Tikka",
        "basePriceMinor": 39900,
        "inStock": true,
        "recipe": {
          "isVeg": true,
          "isJain": "TRUE",
          "isGlutenFree": "TRUE",
          "allergensPresent": ["dairy"],
          "crossContactRisk": "LOW"
        }
      }
    ]
  }
  ```

### 2. `POST /cart/validate`
Validates line items, checks live stock, applies restaurant rules, and calculates authoritative total minor units.

### 3. `POST /cart/commit`
Atomically applies line items to the customer's cart, incrementing the cart version. Must be idempotent using `Idempotency-Key`.

### 4. `GET /orders/latest?userRef=...&branchId=...`
Returns the customer's most recent completed order for instant re-ordering.

### 5. `GET /orders/:orderId/status?userRef=...`
Returns verified real-time delivery status, driver timestamp, and contact action payloads. Must enforce customer ownership check.

---

## 4. Conformance Certification

Before going live, run the automated Conformance Test Kit against your staging server:
```typescript
import { ConnectorConformanceKit } from '@vca/connector-sdk';

const suite = new ConnectorConformanceKit({
  baseUrl: 'https://staging-api.yourtenant.com/connector',
  signingSecret: process.env.CONNECTOR_SIGNING_SECRET!,
  branchId: 'branch_test_01',
  userRef: 'usr_test_cust',
});

const results = await suite.runCertification();
console.log(`Passed: ${results.passed}/${results.totalTests}`);
```
When all conformance tests pass, your connector is certified for production deployment!
