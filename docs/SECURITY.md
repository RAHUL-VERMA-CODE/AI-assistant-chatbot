# Security Policy & Compliance Standard (SECURITY.md)

This document defines the vulnerability reporting guidelines, security standards, and operational controls for the Voice Commerce Assistant SaaS platform.

---

## 1. Vulnerability Reporting & Disclosure

We welcome responsible security disclosures. If you discover a potential security vulnerability:
- **Contact:** Send details to `security@voice-commerce-assistant.internal` (or submit a confidential issue via GitHub Security Advisories).
- **Guidelines:** Do not attempt to access another tenant's data, degrade service performance, or publicly disclose details before a remediation release has been published.
- **SLA:** Initial acknowledgment within 24 hours; severity triage and reproduction within 48 hours; critical fix deployment within 5 business days.

---

## 2. Compliance Baseline: OWASP ASVS Level 2

The codebase is engineered to satisfy **OWASP Application Security Verification Standard (ASVS) Level 2**:

| ASVS Section | Verification Requirement | Implementation in Architecture |
| :--- | :--- | :--- |
| **V1: Architecture** | Multi-tenant logical isolation and threat boundary defense | PostgreSQL Row-Level Security (RLS), AsyncLocalStorage tenant context, SSRF guard with DNS pinning. |
| **V2: Authentication** | Secure token handling, brute-force limits, credential rotation | Hashed tenant API keys (`Argon2id`), short-lived client session JWTs with `jti` revocation, zero secrets in URLs. |
| **V3: Session Mgmt** | Bounded session lifetime, explicit revocation, token entropy | Sliding window 2-hour session TTL in Redis; Pub/Sub distributed turn cancellation on disconnect. |
| **V4: Access Control** | Object-level authorization, deny-by-default permissions | Derived server-side identity; cross-tenant access blocked by database engine; admin route segregation. |
| **V6: Cryptography** | Secure random generation, envelope encryption, key rotation | AES-256-GCM envelope encryption with pluggable `KmsAdapter`; constant-time comparisons (`crypto.timingSafeEqual`). |
| **V7: Errors & Logging** | Structured error envelope, zero secret leakage in logs | Pino async redacting logger with automatic PII scrubbing; non-leaking `AppError` envelopes in production. |
| **V8: Data Protection** | Strict data retention lifecycles, encrypted storage | 7-day transcript TTL with time-partitioned Postgres drops; zero raw audio stored; 120-second proposal expiry. |
| **V13: API Hygiene** | Schema-first validation, rate limiting, idempotency | TypeBox/Zod schemas on all inputs/outputs; atomic distributed rate limiter; idempotency key middleware. |

---

## 3. Secret Management & Key Rotation Policy

1. **Zero Hardcoded Secrets:** Credentials, provider keys, and signing secrets live exclusively in `.env` (development) or a dedicated Secrets Manager (production).
2. **Tenant API Key Lifecycle:**
   - Generated with 32-byte cryptographic entropy, prefixed with `vca_live_` or `vca_test_`.
   - Stored hashed using SHA-256 / Argon2id; the plaintext secret is revealed to the tenant administrator exactly once at creation.
   - Dual-key rotation supported: a tenant can activate a secondary key before revoking the primary key with zero downtime.
3. **Session Token Safety:**
   - Client session tokens are never passed as URL query parameters (which appear in proxy/server logs). They are passed exclusively in the `Authorization: Bearer <token>` header or during the WebSocket connection handshake.

---

## 4. Supply Chain & CI Security Gates

Every pull request and release build must pass automated automated security gates:
- **Dependency Audit:** `pnpm audit --audit-level=high` blocks builds on vulnerabilities with available fixes.
- **Static Analysis (SAST):** ESLint security plugins and strict boundary rules preventing unauthorized package imports.
- **Secret Scanning:** Git hooks and CI actions scan commits for exposed API keys or tokens.
- **Minimal Runtime Containers:** Production container images use Alpine Linux, run as an unprivileged non-root user (`node:node`), and omit build tools from the final layer.
