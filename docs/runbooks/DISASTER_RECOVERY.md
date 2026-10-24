# Production Runbook: Disaster Recovery & Key Revocation (DISASTER_RECOVERY.md)

This runbook specifies the disaster recovery (DR), cryptographic key rotation, and emergency tenant isolation procedures for the Voice Commerce Assistant SaaS platform.

---

## 1. RTO and RPO Targets

- **Recovery Point Objective (RPO):** $< 5$ minutes (Continuous WAL archiving in PostgreSQL and Redis AOF).
- **Recovery Time Objective (RTO):** $< 15$ minutes (Containerized stateless services with PgBouncer pooling).

---

## 2. PostgreSQL Point-in-Time Recovery (PITR)

### Scenario: Database corruption or accidental drop
1. **Stop ingress traffic:**
   ```bash
   docker compose stop api realtime worker
   ```
2. **Identify target recovery timestamp:**
   Select the UTC timestamp immediately preceding the incident (e.g. `2026-10-25 00:00:00 UTC`).
3. **Initiate restore from base backup + WAL:**
   ```bash
   # Restore base snapshot
   pg_restore -h postgres -U postgres -d voice_assistant /backups/base_backup_latest.tar
   # Replay WAL logs to target recovery point
   recovery_target_time = '2026-10-25 00:00:00 UTC'
   ```
4. **Verify RLS policies and tenant schemas:**
   ```sql
   SELECT count(*) FROM tenants;
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```
5. **Restart application services.**

---

## 3. Cryptographic Key Rotation & Compromise Response

### Scenario: Tenant Shared Connector Secret or SaaS Master Key Compromise
1. **Immediate Revocation via Admin API:**
   ```bash
   # Revoke the compromised API key
   curl -X DELETE http://localhost:8080/v1/admin/tenants/<tenantId>/keys/<keyId> \
        -H "X-Admin-Key: $MASTER_ADMIN_KEY"
   ```
2. **Issue New Key:**
   ```bash
   curl -X POST http://localhost:8080/v1/admin/tenants/<tenantId>/keys \
        -H "X-Admin-Key: $MASTER_ADMIN_KEY" \
        -H "Content-Type: application/json" \
        -d '{"label": "Emergency Rotated Key"}'
   ```
3. **KMS Master Key Rotation:**
   - Generate a new Data Encryption Key (DEK) version in the KMS adapter.
   - Encrypted fields (`preferences`, `stored_tokens`) use envelope encryption: existing data remains decryptable by previous DEK, new writes use the new DEK.
   - Run asynchronous re-encryption job via background worker:
     ```bash
     node --experimental-strip-types apps/worker/src/index.ts --job reencrypt-dek
     ```

---

## 4. Emergency Tenant Suspension (Isolation Protocol)
If a tenant connector exhibits malicious SSRF attempts, spam, or payment compromise:
```bash
curl -X PATCH http://localhost:8080/v1/admin/tenants/<tenantId> \
     -H "X-Admin-Key: $MASTER_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{"status": "SUSPENDED"}'
```
All active WebSocket sessions for the tenant are immediately severed with close code 4003 (Tenant Suspended), and subsequent session creation returns HTTP 403 Forbidden.
