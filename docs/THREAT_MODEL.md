# STRIDE Threat Model & Security Architecture (THREAT_MODEL.md)

This threat model follows Microsoft STRIDE methodology and aligns with **OWASP ASVS Level 2**, **OWASP API Security Top 10 (2023)**, and **OWASP Top 10 for LLM Applications (2025)**.

---

## 1. System Trust Boundaries & Data Flow Diagram

```text
[Trust Boundary 0: Public Internet / Untrusted Client]
  │ (Push-to-talk audio frames, HTTPS turns, client session JWT)
  ▼
[Trust Boundary 1: SaaS Edge & Gateway (apps/api, apps/realtime)]
  │ (Auth derivation, ALS TenantContext, rate limiters, PII Scrubber)
  ├──────────────────────────────┬──────────────────────────────┐
  ▼                              ▼                              ▼
[Trust Boundary 2: SaaS Core]  [Trust Boundary 3: Tenant API] [Trust Boundary 4: Hosted AI]
- Policy & Food Packs          - Connector API (HTTPS)        - xAI Grok / Groq
- PostgreSQL (RLS enabled)     - Signed HMAC-SHA256           - Hosted STT/TTS
- Redis 7 (Namespaced)         - SSRF Guard / DNS Pinning     - Redacted Payloads Only
```

---

## 2. STRIDE Analysis by Boundary & Component

### TB0: Customer Client to Gateway Boundary

| Threat ID | STRIDE Category | Threat Description & Attack Vector | Impact | Architectural Mitigation | ASVS / OWASP Ref |
| :---: | :---: | :--- | :---: | :--- | :---: |
| **T01** | **Spoofing** | Attacker crafts a forged `user_ref` or modifies claims inside the client session JWT. | Critical | Short-lived, HMAC/RSA signed tokens with strict `jti` revocation; `tenant_id` and `user_ref` derived exclusively from server-side verified token. | API1:2023, ASVS 3.1 |
| **T02** | **Tampering** | Attacker intercepts or modifies cart prices, item quantities, or modifiers in client payloads. | Critical | Client payloads contain only item/option IDs. SaaS computes zero prices; tenant connector validates and calculates all prices. Proposals are signed and immutable. | API3:2023 |
| **T03** | **Repudiation** | Attacker claims they never confirmed a cart or revoked their preference consent. | High | Confirmation requires `proposal_id`, `expected_cart_version`, and unique `Idempotency-Key`. Preference changes are logged in the immutable append-only audit outbox. | ASVS 7.1 |
| **T04** | **Info Disclosure** | Attacker inspects server error messages or stack traces during failures. | Medium | Standard error envelope (`AppError`) masks all database, internal network, and stack trace details in non-development environments. | ASVS 13.2 |
| **T05** | **Denial of Service** | Malicious client floods WebSocket with infinite audio chunks or opens 10,000 idle connections. | Critical | Max connection caps per IP and tenant; binary frame size limit (max 64KB); 30s idle timeout; token bucket message rate limiter. | API4:2023 |
| **T06** | **Elevation of Privilege** | End customer attempts to access `/v1/admin/*` routes or modify tenant configuration. | Critical | Dual-role authentication middleware. Client session tokens are forbidden on admin routes; only hashed `TenantApiKey` with admin scope is accepted. | API5:2023, ASVS 4.1 |

---

### TB1: SaaS Gateway to Tenant Connector Boundary

| Threat ID | STRIDE Category | Threat Description & Attack Vector | Impact | Architectural Mitigation | ASVS / OWASP Ref |
| :---: | :---: | :--- | :---: | :--- | :---: |
| **T07** | **Tampering** | Man-in-the-middle alters connector responses (prices, availability, order status). | Critical | Strict HTTPS required; optional mTLS; response payload validated against OpenAPI 3.1 schemas. | API7:2023 |
| **T08** | **Repudiation / Replay**| Attacker captures and replays a signed cart commit event or webhook. | High | Webhooks and connector requests contain `X-Connector-Timestamp` (max 300s clock skew) and a cryptographic `X-Connector-Nonce` deduplicated in Redis. | ASVS 8.3 |
| **T09** | **Elevation of Privilege (SSRF)** | Malicious tenant registers connector URL pointing to `169.254.169.254` (AWS metadata) or internal VPC services (`10.0.0.1`). | Critical | Custom DNS resolver with IP pinning. Rejects loopback, link-local, RFC1918, RFC6598, and multicast. Disables HTTP redirects. | API8:2023 |
| **T10** | **Denial of Service** | Tenant connector hangs indefinitely, exhausting SaaS connection pools and event-loop workers. | High | Strict 2,000ms timeout on connector calls; three-state circuit breaker trips after 3 failures; per-tenant bulkhead isolation. | API4:2023 |

---

### TB2: SaaS Core to Hosted AI Provider Boundary (LLM Top 10)

| Threat ID | STRIDE Category | Threat Description & Attack Vector | Impact | Architectural Mitigation | OWASP LLM Ref |
| :---: | :---: | :--- | :---: | :--- | :---: |
| **T11** | **Prompt Injection (Direct & Indirect)** | Adversary speaks jailbreak commands or menu descriptions contain malicious system prompt overrides. | Critical | Untrusted text wrapped in XML boundary tags; LLM receives minimal tools; Grounding Guard deterministically verifies all numbers, items, and safety claims before TTS. | LLM01:2025 |
| **T12** | **Sensitive Info Disclosure** | Customer speaks phone number or delivery address which gets forwarded to third-party AI APIs. | High | Deterministic PII Scrubber scrubs phone numbers, addresses, PIN codes, emails, and tokens before dispatching to external LLM/STT APIs. | LLM02:2025 |
| **T13** | **Denial of Service (Wallet Exhaustion)** | Adversary triggers complex recursive reasoning turns to burn monthly SaaS LLM spend caps. | Critical | Strict `max_tokens` (150); per-tenant and per-user monthly spend limits with automated circuit breaking at 100% threshold. | LLM04:2025 |
| **T14** | **Supply Chain Vulnerability** | Malicious NPM package compromises runtime environment or leaks API keys. | Critical | Pinned `pnpm` lockfile; automated dependency audit and OSV scanning in CI; minimal non-root Docker images; zero credentials in git. | LLM05:2025 |

---

### TB3: SaaS Multi-Tenant Database & Storage Boundary

| Threat ID | STRIDE Category | Threat Description & Attack Vector | Impact | Architectural Mitigation | ASVS / OWASP Ref |
| :---: | :---: | :--- | :---: | :--- | :---: |
| **T15** | **Cross-Tenant Data Leakage** | Tenant A accesses Tenant B's customer preferences, audit logs, or session records. | Critical | PostgreSQL Row-Level Security (RLS) on all tables; `SET LOCAL app.current_tenant_id` on every pooled transaction; tenant-prefixed Redis keys. | ASVS 4.1 |
| **T16** | **Credential Storage Exposure**| Database dump exposes tenant API keys or KMS master keys. | Critical | Tenant API keys stored hashed with Argon2id / SHA-256; tenant-supplied secrets protected with envelope encryption (AES-256-GCM). | ASVS 6.2 |

---

## 3. Security Verification Checklist & CI Gates

- [x] RLS unit and property tests verifying cross-tenant read/write rejection.
- [x] SSRF guard unit tests with mocked loopback, link-local, and DNS rebinding domains.
- [x] Pre-provider PII scrubber test suite covering Indian phone formats, PIN codes, and addresses.
- [x] Grounding guard regression suite rejecting ungrounded prices and unverified dietary claims.
- [x] Red-team prompt injection test suite verifying tool isolation.
