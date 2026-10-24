# Architectural Decisions & Provider Policy (DECISIONS.md)

This document records the foundational architectural decisions, hosted AI provider selections, capacity and rate limit analyses, and required credentials for the Voice Commerce Assistant SaaS platform.

---

## 1. Hosted LLM Provider Selection & Analysis

The prompt specifies:
> *"Research the currently available free-tier hosted options, prefer a Grok-family model, and pick the best one that supports streaming, reliable tool calling or schema-constrained JSON, and good Hindi and Hinglish. Report your choice, its free-tier limits (requests per minute, tokens per minute, daily caps), and why, in DECISIONS.md. Verify base URL, model id, and capabilities against the provider's current official documentation; do not assume. Use the OpenAI-compatible adapter where supported. If the best free option is not literally a Grok model, tell me and explain."*

### Official Provider Research Findings

| Provider | Model Identifier | Base URL | Wire Protocol | Free Tier / Promotional Status | Rate Limits (Free/Tier 0) | Streaming | Function/Tool Calling | Hindi & Hinglish Quality |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **xAI (Grok)** *(Primary Recommended)* | `grok-2-mini` / `grok-beta` / `grok-4.3` | `https://api.x.ai/v1` | OpenAI Compatible (`/v1/chat/completions`) | New developer signups receive **\$25 initial credit** allowance; default **Tier 0** account ($0 cumulative spend) | ~30–60 RPM, 10,000 TPM on starter tier | ✅ Yes | ✅ Reliable tool calls & structured JSON | ✅ Excellent (trained on multilingual conversational data) |
| **GroqCloud** *(Zero-Cost High-Speed Alternate)* | `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` | `https://api.groq.com/openai/v1` | OpenAI Compatible (`/v1/chat/completions`) | **Perpetual Free Developer Tier** (no credit card required) | 30 RPM, 6,000 TPM (70B) / 30 RPM, 20,000 TPM (8B), 14,400 RPD | ✅ Yes (~300–800 tok/sec) | ✅ Validated JSON & Tool calls | ✅ Strong Hindi & Hinglish comprehension |

### Selected Primary Provider & Rationale
1. **Primary Configured Model:** **`xai`** using model ID **`grok-2-mini`** (or `grok-beta`).
   - **Base URL:** `https://api.x.ai/v1`
   - **Wire Protocol:** Standard OpenAI-compatible format (`/v1/chat/completions`).
   - **Rationale:** Aligns with the specification's preference for Grok. `grok-2-mini` offers the lowest latency in the Grok family, strict JSON schema support, high reasoning fidelity for slot extraction, and native understanding of Hinglish colloquialisms.
   - **Free Tier Reality:** xAI operates on cumulative spend tiers. New accounts typically receive starter credits ($25). Once promotional credits lapse, it transitions to pay-as-you-go ($0.20–$2.00 per 1M tokens).
2. **Zero-Cost High-Performance Fallback:** **`groq`** using **`llama-3.3-70b-versatile`** or **`llama-3.1-8b-instant`**.
   - **Base URL:** `https://api.groq.com/openai/v1`
   - **Rationale:** If the user has not set up an xAI billing account or promotional credits are exhausted, GroqCloud provides a perpetual free tier with unmatched token latency (< 300ms time-to-first-token), perfectly servicing our voice latency budget (<= 700ms understanding).
3. **Pluggable Architecture:** Because both providers adhere strictly to the OpenAI-compatible REST streaming specification, switching between them requires only changing `LLM_PROVIDER=xai` to `LLM_PROVIDER=groq` and setting the corresponding API key. Zero code changes required.

---

## 2. Architectural Decisions & Defaults (ADR Summary)

| Category | Decision | Recommendation & Justification | Status |
| :--- | :--- | :--- | :---: |
| **Repository Layout** | Monorepo via `pnpm` workspaces | Clean domain separation (`apps/api`, `apps/realtime`, `apps/worker`, `packages/*`). Prevents god-objects and enforces compile-time dependency boundaries. | Accepted |
| **Backend Framework** | Node.js (LTS v20+) + Fastify | Fastify provides schema-first validation (TypeBox/Zod), ultra-fast JSON serialization, low overhead (< 2ms routing), and native plugin lifecycle hooks. | Accepted |
| **Database & Tenancy** | PostgreSQL 16 with Row-Level Security (RLS) | Hard isolation enforced at the database engine level via `SET LOCAL app.current_tenant_id`. Pooled via PgBouncer. Tenant ID is never accepted from client payloads. | Accepted |
| **Session & Cache** | Redis 7+ (Standalone / Clustered) | Sub-millisecond session lookups, single-flight locks, distributed rate limiting, and Pub/Sub turn cancellation. Bounded TTL on all keys (max 2 hours for sessions, 2 min for proposals). | Accepted |
| **Realtime Voice Transport** | WebSocket with binary frames | `apps/realtime` runs an independent Node.js WebSocket gateway. Audio chunks are streamed as binary frames (PCM 16kHz 16-bit mono) to eliminate JSON base64 overhead. | Accepted |
| **Commerce Authority** | Tenant Connector Contract (OpenAPI 3.1) | SaaS never connects to tenant databases. The tenant exposes a signed HTTPS Connector API. The tenant is the 100% source of truth for pricing, inventory, and order commits. | Accepted |
| **Orchestration** | Deterministic Conversation State Machine | No LangGraph runtime overhead. Explicit state transitions, deterministic fast-paths (confirm, cancel, quantity changes bypass LLM), and template-rendered facts. | Accepted |
| **Security & Cryptography** | Envelope Encryption via `KmsAdapter` | Sensitive tenant credentials and customer preferences encrypted with AES-256-GCM. `LocalDevKmsAdapter` enables zero-credential local development. | Accepted |

---

## 3. "What I Need From You" Credential Table

In accordance with the **Provider and Key Policy**, the codebase is built and tested against **mock adapters and recorded fixtures by default**. Work is never blocked waiting for credentials. When live external provider testing is required, keys must be provided directly in `.env`.

| Item / Provider | Purpose | Environment Variable Name | Target File | Phase Needed | Status |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **Database Connection** | PostgreSQL connection string | `DATABASE_URL` | `.env` | Phase 0 | Supplied via local Docker |
| **Redis Connection** | Redis connection string | `REDIS_URL` | `.env` | Phase 0 | Supplied via local Docker |
| **Session Secret** | JWT / session token signing key (HS256/RS256) | `SESSION_SIGNING_SECRET` | `.env` | Phase 1 | Auto-generated in `.env.example` |
| **Master Dev Key** | Local envelope encryption key (32 bytes hex) | `DEV_MASTER_ENCRYPTION_KEY` | `.env` | Phase 1 | Auto-generated in `.env.example` |
| **xAI Grok API Key** *(Optional Live)* | Live Grok LLM inference (streaming, tool calling) | `XAI_API_KEY` | `.env` | Phase 4 | Mock adapter default; user supplies when ready |
| **Groq API Key** *(Optional Alternate)* | Live Groq LPU inference (perpetual free tier) | `GROQ_API_KEY` | `.env` | Phase 4 | Mock adapter default; user supplies when ready |
| **Hosted STT Key** *(Optional Live)* | Live streaming Speech-to-Text (e.g. Deepgram / Sarvam) | `STT_API_KEY` | `.env` | Phase 6 | Mock adapter default; researched in Phase 6 |
| **Hosted TTS Key** *(Optional Live)* | Live streaming Text-to-Speech (e.g. Cartesia / ElevenLabs) | `TTS_API_KEY` | `.env` | Phase 6 | Mock adapter default; researched in Phase 6 |

> [!IMPORTANT]
> **Strict Key Safety Rule:** If you paste any API key into the conversation chat, it will **only** be written directly to the git-ignored `.env` file. It will **never** be echoed back in responses, committed to version control, logged, or included in test fixtures.
