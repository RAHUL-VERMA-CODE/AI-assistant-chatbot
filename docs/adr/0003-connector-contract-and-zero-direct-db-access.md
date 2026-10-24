# ADR 0003: Connector Contract Architecture and Zero Direct Tenant Database Access

## Status
Accepted

## Context
A major architectural flaw in single-company voice assistant designs is coupling the assistant directly to a specific backend database schema. For a generic B2B SaaS platform sold to heterogeneous food platforms (aggregators, POS providers, custom e-commerce backends):
1. Tenants will never grant direct SQL database access to a third-party SaaS due to data privacy, PCI-DSS, and credential risk.
2. Tenant databases vary wildly (PostgreSQL, MongoDB, MySQL, SAP, proprietary APIs).
3. The SaaS must never become the source of truth for dynamic pricing, kitchen inventory, branch open/close state, or cart checkout.

## Decision
We enforce a **Zero Direct Database Access** architectural principle. Tenants integrate with our platform exclusively through a standardized, versioned, signed HTTPS **Connector API**:
1. **Connector Contract (`packages/connector-contract`):**
   - Published as an OpenAPI 3.1 specification and TypeBox/TypeScript schemas.
   - Core operations:
     - `GET /connector/v1/branches/:id/catalog`: Branch menu, items, variants, options, verified dietary facts, stock states, and `menu_version`.
     - `POST /connector/v1/cart/validate`: Validates items, modifiers, stock, and returns authoritative tenant-computed totals.
     - `POST /connector/v1/cart/commit`: Atomically applies a validated proposal to the customer's cart with version checking and idempotency.
     - `GET /connector/v1/users/:user_ref/orders/latest`: Returns past completed orders for re-ordering.
     - `GET /connector/v1/orders/:id/status`: Returns live delivery/kitchen status, timestamps, and opaque contact actions.
2. **SSRF Guard & Cryptographic Signing (`packages/connector-sdk`):**
   - All outbound connector requests are signed with HMAC-SHA256 (`X-Connector-Signature`, `X-Connector-Timestamp`, `X-Connector-Nonce`).
   - Outbound HTTP agent implements custom DNS resolution and IP pinning, rejecting RFC 1918 private ranges, loopback (`127.0.0.1`), link-local (`169.254.169.254`), and cloud metadata services.
   - Redirects are strictly disabled (`maxRedirections: 0`).
3. **Tenant Authority:**
   - The tenant backend is the 100% source of truth for catalog, pricing, and cart state.
   - Our SaaS only stores short-lived (2-minute), immutable **Cart Proposals** containing tenant-validated totals, cart versions, and menu versions.

## Consequences
- **Positive:** Universal compatibility across any tenant tech stack; zero credential exposure; tenant retains complete sovereignty over pricing and fulfillment; eliminates liability for pricing bugs.
- **Negative:** Adds network hops (~100–300ms) for catalog and cart validation; requires caching, keep-alive pooling, and single-flight coalescing to meet latency budgets.
