# ADR 0001: Modular Monorepo Architecture with Strict Package Boundaries

## Status
Accepted

## Context
The Voice Commerce Assistant platform consists of multiple specialized subsystems:
- Realtime WebSocket streaming audio gateway
- Fastify REST API for sessions, turns, and cart operations
- Background worker for retention, outbox processing, and metering rollups
- Core domain logic (dietary rules, tri-state engine, budget knapsack solver)
- External adapters (LLM, STT, TTS, KMS, tenant connector)
- Client-facing SDKs (headless TypeScript client, React components)

A naive single-application repository creates tight coupling, circular dependencies, and prevents independent scaling of the WebSocket gateway from the REST API. Conversely, multi-repo architectures cause coordination friction, duplicated types, and integration hell during early development.

## Decision
We adopt a **modular monorepo** managed with `pnpm` workspaces:
1. **Runtimes (`apps/`):**
   - `apps/api`: Fastify REST API.
   - `apps/realtime`: Standalone WebSocket audio streaming gateway.
   - `apps/worker`: Asynchronous background worker.
2. **Packages (`packages/`):**
   - `packages/core`: Branded domain types, Result monad, tenant context.
   - `packages/platform`: Database/RLS, Redis, crypto, rate limiting, logging.
   - `packages/connector-contract`: Versioned OpenAPI 3.1 & TypeBox schemas.
   - `packages/connector-sdk`: Signed HTTPS client with SSRF guard.
   - `packages/policy-engine`: Tri-state logic, constraint engine, proposal lifecycle.
   - `packages/policy-food`: Food domain pack (Jain, GF, allergens, budget solver).
   - `packages/llm`: Provider registry, task router, OpenAI-compatible adapter.
   - `packages/speech`: STT & TTS interfaces, chunker, hosted adapters.
   - `packages/orchestrator`: State machine, fast paths, grounding guard.
   - `packages/web-sdk`: TypeScript client & React component.
   - `packages/eval`: Benchmark harness, A01-A15 acceptance tests, load tests.
3. **Tools (`tools/`):**
   - `tools/demo-tenant`: Standalone demo tenant ("ARPZO") for integration tests.

### Boundary Rules
- Packages must never import from `apps/*`.
- `packages/core` has zero runtime dependencies.
- No circular dependencies between packages (enforced via ESLint `import/no-cycle` and TypeScript project references).

## Consequences
- **Positive:** Compile-time boundary enforcement; independent container packaging and scaling; shared domain types without code duplication; clean ports-and-adapters architecture.
- **Negative:** Requires monorepo build orchestration (`pnpm -r build`), strict workspace dependency declarations.
