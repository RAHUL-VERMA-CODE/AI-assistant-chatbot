# Production Runbook: Incident Response (INCIDENT_RESPONSE.md)

This runbook defines the triage, containment, resolution, and communication protocols for operational incidents affecting the Voice Commerce Assistant SaaS platform.

---

## 1. Severity Classifications & SLAs

| Severity | Definition | Target Ack | Target Mitigation | Notification Channel |
| :--- | :--- | :---: | :---: | :--- |
| **SEV-1 (Critical)** | Entire voice/text platform down; data corruption; multi-tenant security boundary breach. | $< 5$ min | $< 30$ min | PagerDuty, Executive Alert, Statuspage |
| **SEV-2 (Major)** | Primary LLM/STT provider outage; p95 latency $> 5$s; single large tenant impacted; connector degraded. | $< 15$ min | $< 2$ hours | Slack `#eng-incidents`, Tenant Primary Contact |
| **SEV-3 (Minor)** | Non-blocking metric rollup delay; cosmetic dashboard error; single customer report. | $< 1$ hour | $< 24$ hours | Jira Service Desk |

---

## 2. Standard Operating Procedures (SOP)

### SOP-01: LLM Provider Outage or 429 Rate Limit Storm
- **Symptom:** Prometheus alert `vca_errors_total{error_code="RATE_LIMIT_EXCEEDED"}` or `vca_turn_duration_seconds` spiking.
- **Diagnostic:**
  ```bash
  # Check active LLM health & provider queue
  curl -s http://localhost:8080/health
  # Inspect provider registry metrics
  curl -s http://localhost:8080/metrics | grep vca_llm
  ```
- **Mitigation:**
  1. Trigger dynamic failover to secondary provider in `.env` or Redis configuration:
     - Set `LLM_PROVIDER=groq` -> failover to `xai` or `gemini`.
  2. The `RateGovernor` automatically rotates keys across the round-robin pool. If entire pool is depleted, activate fast-path caching.
  3. Re-verify turn latency $\le 1.5$s via synthetic canary ping.

### SOP-02: Speech STT/TTS Provider Failure
- **Symptom:** WebSocket connections terminating with error code 1011 or audio playback silence.
- **Mitigation:**
  1. Check STT provider status: Deepgram / Sarvam health dashboards.
  2. Switch WebSocket voice server to fallback TTS provider (Cartesia $\leftrightarrow$ ElevenLabs).
  3. Ensure client auto-switches to editable text fallback mode (`sendTextInput`).

### SOP-03: Tenant Connector Latency or Circuit Breaker Trip
- **Symptom:** `CircuitBreakerOpenError` for tenant connector endpoint; cart validations timing out.
- **Mitigation:**
  1. Check tenant connector status via Admin API:
     ```bash
     curl -X POST http://localhost:8080/v1/admin/tenants/<tenantId>/connector/ping \
          -H "X-Admin-Key: $MASTER_ADMIN_KEY"
     ```
  2. If tenant backend is experiencing high load, inform tenant engineering contact.
  3. Assistant informs customer gracefully: *"The restaurant menu is temporarily taking longer to respond. Would you like to retry in a moment?"*

---

## 3. Post-Incident Review (PIR)
Every SEV-1 and SEV-2 incident requires a blameless post-mortem document within 48 hours covering:
1. Incident timeline (Time to Detect, Time to Mitigate).
2. Root cause analysis (5 Whys).
3. Automated regression test added to `packages/eval`.
