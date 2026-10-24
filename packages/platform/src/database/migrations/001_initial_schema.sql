-- ==============================================================================
-- 001_initial_schema.sql
-- Foundational multi-tenant schema with PostgreSQL Row-Level Security (RLS)
-- ==============================================================================

-- 1. Tenants Table (Global Metadata)
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, DELETED
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD', -- STARTER, STANDARD, ENTERPRISE
    connector_url TEXT NOT NULL,
    connector_signing_secret_encrypted TEXT NOT NULL,
    allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    monthly_spend_cap_cents INT NOT NULL DEFAULT 10000, -- $100 default cap
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tenant API Keys (Admin & Server-to-Server)
CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL, -- e.g. vca_live_
    name VARCHAR(128) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '["assistant:session", "cart:read"]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVOKED
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_lookup ON tenant_api_keys(key_hash) WHERE status = 'ACTIVE';

-- 3. User Preferences (Encrypted, Consented Dietary Restrictions)
CREATE TABLE IF NOT EXISTS user_preferences (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_reference VARCHAR(128) NOT NULL,
    encrypted_dietary_payload JSONB NOT NULL, -- AES-256-GCM envelope encrypted
    consent_version INT NOT NULL DEFAULT 1,
    consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(64) NOT NULL DEFAULT 'voice_opt_in',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_prefs UNIQUE (tenant_id, user_reference)
);

-- Enable Row-Level Security (RLS) on user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user_preferences ON user_preferences
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE INDEX IF NOT EXISTS idx_user_preferences_tenant_user ON user_preferences(tenant_id, user_reference);

-- 4. Audit Log (Append-Only Outbox)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL, -- KEY_ROTATED, CONSENT_GRANTED, PREFERENCE_DELETED
    actor_id VARCHAR(128) NOT NULL,
    actor_type VARCHAR(32) NOT NULL, -- TENANT_ADMIN, END_CUSTOMER, SYSTEM
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_log ON audit_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON audit_log(tenant_id, created_at DESC);

-- 5. Transcripts Table (Time-Partitioned with 7-Day Drop Lifecycles)
CREATE TABLE IF NOT EXISTS transcripts (
    id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id VARCHAR(64) NOT NULL,
    turn_id VARCHAR(64) NOT NULL,
    user_reference VARCHAR(128) NOT NULL,
    speaker VARCHAR(16) NOT NULL, -- USER, ASSISTANT
    language VARCHAR(16) NOT NULL, -- en, hi, hinglish
    scrubbed_text TEXT NOT NULL,
    redacted_trace_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_transcripts ON transcripts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE INDEX IF NOT EXISTS idx_transcripts_tenant_session ON transcripts(tenant_id, session_id, created_at DESC);
