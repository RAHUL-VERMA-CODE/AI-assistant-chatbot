# ADR 0005: Redis Ephemeral Session State, Caching, and Pub/Sub Turn Cancellation

## Status
Accepted

## Context
High-concurrency realtime voice interactions require sub-millisecond session retrieval, strict rate limiting, single-flight deduplication, and distributed turn cancellation across multiple WebSocket gateway nodes. PostgreSQL is ideal as the durable system of record (tenants, API keys, preferences, audit logs), but writing every transient audio frame, turn state, or 120-second cart proposal to PostgreSQL would exhaust database write IOPS and introduce unacceptable latency.

## Decision
We utilize **Redis 7+** as the distributed ephemeral state layer, strictly bounded by TTLs and namespaced by tenant:
1. **Tenant Namespacing:**
   - Every Redis key follows the pattern: `tenant:{tenant_id}:{subsystem}:{entity_id}` (e.g. `tenant:t_arpzo:session:as_7`).
   - Completely prevents key collisions and supports tenant-scoped cache purging.
2. **Ephemeral Assistant Sessions:**
   - Active session state is serialized as compact JSON.
   - Max 10 conversation turns retained per session; older turns summarized into rolling context.
   - TTL: 2 hours sliding window. Expired sessions are automatically reclaimed.
3. **Immutable Cart Proposals:**
   - Proposals stored with key `tenant:{id}:proposal:{proposal_id}`.
   - TTL: Exactly 120 seconds (2 minutes). After 2 minutes, the proposal key expires and any subsequent confirm returns 409 Stale Proposal.
4. **Distributed Turn Cancellation via Pub/Sub:**
   - When a client interrupts speech, taps "Cancel", or reconnects, a message is published to `tenant:{id}:session:{session_id}:cancel`.
   - All `apps/realtime` gateway nodes listen to active session channels and immediately abort in-flight LLM token streaming and TTS generation via `AbortController`.
5. **Catalog Caching & Single-Flight Coalescing:**
   - Branch catalog cached under `tenant:{id}:branch:{id}:menu:v{version}` with 15-minute TTL.
   - Single-flight lock (`single-flight:{hash}`) prevents cache stampedes when many users query the same item simultaneously.
6. **Zero Source of Order Truth in Redis:**
   - Order truth, payment records, and committed carts reside exclusively on the tenant platform. Redis stores only short-lived proposals and locks.

## Consequences
- **Positive:** Sub-millisecond state lookups; stateless Node.js gateway nodes; immediate cross-node turn cancellation; memory is self-pruning via TTLs.
- **Negative:** Requires Redis cluster high-availability; cache invalidation logic must handle signed tenant webhooks gracefully.
