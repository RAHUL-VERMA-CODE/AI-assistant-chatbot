# ADR 0002: PostgreSQL Row-Level Security (RLS) and Tenant Context Isolation

## Status
Accepted

## Context
As a multi-tenant B2B SaaS platform, strict data isolation between tenants is an existential security requirement (OWASP Top 10, ASVS Level 2, Spec Req N01, Test A14). Accidental cross-tenant data leakage (e.g., tenant B reading tenant A's customer preferences, audit logs, or usage metrics) would destroy business trust and violate compliance.

Common tenancy patterns evaluated:
1. **Database-per-tenant:** Maximum isolation, but prohibitive operational overhead, slow onboarding, and connection pool exhaustion at hundreds of tenants.
2. **Schema-per-tenant:** High complexity with migrations across hundreds of schemas; Postgres catalog bloat.
3. **Application-level filtering (`WHERE tenant_id = ?`):** High risk of developer oversight; a single missing `WHERE` clause in a repository leaks data across tenants.
4. **Shared database with PostgreSQL Row-Level Security (RLS):** Single schema, database-engine-level enforcement, pooled connections, highly scalable.

## Decision
We implement **PostgreSQL Row-Level Security (RLS)** as the system of record with transaction-scoped tenant context:
1. **Tenant Context Injection:**
   - Every incoming request derives `tenant_id` exclusively from server-side authentication (Tenant API Key hash or verified session token JWT).
   - Stored in Node.js `AsyncLocalStorage` (`TenantContext`).
   - When a pooled database client executes a query, the pool wrapper automatically executes:
     ```sql
     SET LOCAL app.current_tenant_id = '<authenticated_tenant_id>';
     ```
2. **RLS Policy Enforcement:**
   - Every multi-tenant table (`user_preferences`, `tenant_api_keys`, `audit_log`, `usage_events`, `transcripts`) enables RLS:
     ```sql
     ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation_policy ON user_preferences
       USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
       WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));
     ```
3. **Connection Pooling via PgBouncer:**
   - PgBouncer runs in transaction pooling mode. `SET LOCAL` guarantees that the tenant context is scoped strictly to the current transaction and automatically resets when the transaction commits or aborts.
4. **Primary Indexes:**
   - All multi-tenant tables feature composite indexes with `tenant_id` as the leading column (e.g., `(tenant_id, user_reference)`).

## Consequences
- **Positive:** Defense-in-depth: database engine blocks cross-tenant reads and writes even if an application bug omits a filter; single database schema simplifies migrations; cost-effective scaling.
- **Negative:** Transaction-level setup overhead (~0.5ms per transaction); requires automated test suite verifying that unauthenticated or tampered contexts are strictly rejected.
