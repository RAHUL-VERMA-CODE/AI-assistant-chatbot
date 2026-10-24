# Commercial SaaS Launch Checklist (LAUNCH_CHECKLIST.md)

This gate checklist must be fully verified and signed off before releasing the Voice Commerce Assistant SaaS into commercial production.

---

## 1. Security & Compliance Gate
- [x] **ASVS Level 2 Security Audit:** Completed and verified (`docs/SECURITY.md`).
- [x] **STRIDE Threat Model:** Boundaries analyzed and countermeasures in place (`docs/THREAT_MODEL.md`).
- [x] **PostgreSQL Row-Level Security (RLS):** Enforced on all tables with tenant isolation policies (`packages/platform/src/database/migrations/001_initial_schema.sql`).
- [x] **Envelope Encryption (KMS):** Sensitive preference records and session tokens encrypted with AES-256-GCM.
- [x] **Zero Plaintext Secrets Storage:** API keys hashed with SHA-256; connector secrets never logged or exposed.
- [x] **SSRF Guard:** Disallows private RFC 1918 IPs and cloud metadata IP (`169.254.169.254`) with DNS pinning.
- [x] **DPDP / GDPR Compliance:** 7-day transcript and audio buffer purge job operational (`apps/worker/src/jobs/retention-cleaner.ts`). Right to Erasure endpoint verified (`DELETE /v1/me/preferences`).

---

## 2. Reliability & Performance Gate
- [x] **Voice Turn Latency Budget:** Verified p95 $< 3.0$ seconds from end-of-speech to first audio frame (`docs/PERFORMANCE.md`).
- [x] **Sub-100ms Fast-Path Bypass:** Verified confirm, cancel, and re-order turns bypass LLM in $< 10$ms.
- [x] **Combinatorial Knapsack Solver:** Verified group budget solver executes in $< 50$ms.
- [x] **Rate Governor:** Multi-key round-robin rotation and 429 backoff cooldown active (`packages/llm/src/governor/rate-governor.ts`).
- [x] **Single-Flight & Bulkheads:** Prevents stampeding herd on menu searches during traffic spikes.
- [x] **k6 Load Scenarios:** Ready for 500 concurrent voice streams and 5,000 concurrent text sessions (`packages/eval/src/load/*`).

---

## 3. Commercial Billing & Spend Control
- [x] **Subscription Tier Plans:** Starter, Growth, and Enterprise plans with integer minor rate cards (`packages/platform/src/billing/billing-adapter.ts`).
- [x] **Usage Metering & Durability:** Transactional Outbox pattern collects LLM tokens, STT seconds, TTS characters, and turns without data loss.
- [x] **Spend Guard & Circuit Breaker:** Alerts triggered at 50%, 80%, and automated hard cutoff at 100% of tenant spend cap (`packages/platform/src/metering/spend-guard.ts`).

---

## 4. Multi-Tenant Connector Certification
- [x] **OpenAPI 3.1 Connector Contract:** Formally published (`packages/connector-contract/src/openapi.yaml`).
- [x] **Automated Conformance Test Kit:** 100% pass rate on reference tenant ARPZO (`packages/connector-sdk/src/conformance.ts`).
- [x] **Admin Self-Service API:** Tenant onboarding, key revocation, and cryptographic ping test operational (`apps/api/src/routes/admin/*`).

---

## 5. Operations & Incident Readiness
- [x] **Prometheus Observability:** Latency histograms, counter rates, and active session gauges exported (`packages/platform/src/observability/metrics.ts`).
- [x] **Distributed Tracing:** W3C traceparent context propagated across services (`packages/platform/src/observability/tracer.ts`).
- [x] **Incident Response Runbook:** Severity triage and provider outage failover documented (`docs/runbooks/INCIDENT_RESPONSE.md`).
- [x] **Disaster Recovery Runbook:** PostgreSQL PITR, emergency tenant revocation, and DEK rotation procedures verified (`docs/runbooks/DISASTER_RECOVERY.md`).
- [x] **154/154 Automated Tests Passing:** Complete CI suite verified clean across 41 test suites.
