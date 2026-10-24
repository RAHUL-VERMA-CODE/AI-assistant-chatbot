# System Architecture (ARCHITECTURE.md)

This document provides the formal architectural specification, C4 model diagrams, sequence workflows, security topologies, and scaling models for the Voice Commerce Assistant SaaS platform.

---

## 1. System Context (C4 Level 1)

The platform is a multi-tenant, hosted AI voice commerce engine. Tenants (online food ordering platforms) integrate the assistant into their customer-facing apps via our Web SDK and expose an HTTPS Connector API. The platform never connects directly to tenant databases and relies on deterministic policy engines for all commerce validation.

```mermaid
graph TD
    classDef user fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef saas fill:#ede7f6,stroke:#512da8,stroke-width:2px;
    classDef tenant fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef external fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    Customer["End Customer<br/>(Browser / Mobile Web)"]:::user
    TenantPlatform["Tenant Ordering Platform<br/>(Backend & Database)"]:::tenant
    VoicePlatform["Voice Commerce Assistant SaaS<br/>(API, Realtime Gateway, Worker)"]:::saas
    HostedAI["Hosted AI Providers<br/>(xAI Grok / Groq / Hosted STT & TTS)"]:::external

    Customer -- "1. Opens restaurant page" --> TenantPlatform
    TenantPlatform -- "2. Authenticates & creates session (API Key)" --> VoicePlatform
    VoicePlatform -- "3. Returns short-lived client session token" --> TenantPlatform
    TenantPlatform -- "4. Hands token & Web SDK to customer" --> Customer
    Customer -- "5. Voice audio streams & text turns" --> VoicePlatform
    VoicePlatform -- "6. Verifies menu, stock, prices & commits carts" --> TenantPlatform
    VoicePlatform -- "7. Streaming STT, Intent LLM, Streaming TTS" --> HostedAI
    Customer -- "8. Checkout hand-off event to complete order" --> TenantPlatform
```

---

## 2. Container Diagram (C4 Level 2)

The system is deployed as a modular monolith with independently scalable runtimes.

```mermaid
graph TD
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef runtime fill:#ede7f6,stroke:#512da8,stroke-width:2px;
    classDef data fill:#fce4ec,stroke:#c2185b,stroke-width:2px;
    classDef external fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;

    subgraph Client Tier
        WebSDK["Web SDK & React Client<br/>(Push-to-Talk, PCM Audio, Cards)"]:::client
    end

    subgraph SaaS Compute Runtimes
        LB["Cloud Load Balancer / Reverse Proxy<br/>(TLS Termination, Path Routing)"]:::runtime
        RealtimeGW["apps/realtime<br/>(WebSocket Gateway, Audio Streaming)"]:::runtime
        RestAPI["apps/api<br/>(Fastify REST Gateway, Sessions, Turns, Admin)"]:::runtime
        WorkerApp["apps/worker<br/>(Background Outbox, Rollups, Retention)"]:::runtime
    end

    subgraph SaaS Data Tier
        PgBouncer["PgBouncer Connection Pooler"]:::data
        PostgreSQL[("PostgreSQL 16 (RLS)<br/>Tenants, Keys, Preferences, Usage")]:::data
        RedisCluster[("Redis 7<br/>Session State, Rate Limits, Pub/Sub")]:::data
    end

    subgraph External Boundaries
        TenantConnector["Tenant Connector API<br/>(HTTPS, HMAC Signed, SSRF Guarded)"]:::external
        AIProviders["Hosted AI Providers<br/>(OpenAI-Compatible LLM, STT, TTS)"]:::external
    end

    WebSDK -- "WSS /v1/assistant/stream (Binary PCM)" --> LB
    WebSDK -- "HTTPS /v1/assistant/*, /v1/cart/*" --> LB
    LB -- "WSS upgrade" --> RealtimeGW
    LB -- "HTTP REST" --> RestAPI

    RealtimeGW -- "Session auth & state" --> RedisCluster
    RealtimeGW -- "Pub/Sub turn cancellation" --> RedisCluster
    RealtimeGW -- "Audio frames & completion" --> AIProviders
    RealtimeGW -- "Dispatches turns to core engine" --> RestAPI

    RestAPI -- "Transaction pool (RLS)" --> PgBouncer
    PgBouncer --> PostgreSQL
    RestAPI -- "Ephemeral proposal & rate limits" --> RedisCluster
    RestAPI -- "Catalog, Pricing & Cart commits" --> TenantConnector
    RestAPI -- "Structured intent & wording" --> AIProviders
    RestAPI -- "Outbox usage events" --> PostgreSQL

    WorkerApp -- "Reads outbox events" --> PostgreSQL
    WorkerApp -- "Aggregates usage & purges logs" --> PostgreSQL
```

---

## 3. Component Architecture (Inside `apps/api` and Core Packages)

```mermaid
graph TD
    classDef core fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef platform fill:#ede7f6,stroke:#512da8,stroke-width:2px;
    classDef policy fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef llm fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    subgraph apps/api
        Routes["HTTP Routes<br/>(/sessions, /turns, /proposals, /admin)"]
        AuthMiddleware["Tenant & Session Auth Middleware"]
        IdempotencyMW["Idempotency Middleware"]
    end

    subgraph packages/orchestrator
        StateMachine["Conversation State Machine"]:::core
        FastPathRouter["Deterministic Fast Path Router"]:::core
        GroundingGuard["Grounding Guard & Safety Verifier"]:::core
        SlotExtractor["Intent & Slot Extractor"]:::core
        FactRenderer["Template-Rendered Fact Generator"]:::core
    end

    subgraph packages/policy-engine & policy-food
        PolicyEngine["Tri-State Constraint Engine"]:::policy
        FoodPack["Food Domain Pack (Jain, GF, Allergens)"]:::policy
        GroupSolver["Group Budget Knapsack Solver (<=50ms)"]:::policy
        ProposalManager["Proposal Lifecycle Manager"]:::policy
    end

    subgraph packages/connector-sdk
        ConnectorClient["Signed HTTPS Connector Client"]:::platform
        SSRFGuard["DNS Pinning & SSRF Guard"]:::platform
    end

    subgraph packages/llm
        ProviderRegistry["Provider Registry & Matrix"]:::llm
        TaskRouter["Task-Based LLM Router"]:::llm
        RateGovernor["Rate Governor & Key Pool"]:::llm
        OpenAIAdapter["OpenAI-Compatible Adapter (xAI/Groq)"]:::llm
    end

    Routes --> AuthMiddleware --> IdempotencyMW --> StateMachine
    StateMachine --> FastPathRouter
    FastPathRouter -- "Non-trivial turn" --> SlotExtractor
    FastPathRouter -- "Fast path match (confirm/cancel)" --> ProposalManager

    SlotExtractor --> TaskRouter --> RateGovernor --> OpenAIAdapter
    SlotExtractor --> PolicyEngine
    PolicyEngine --> FoodPack
    FoodPack --> GroupSolver

    StateMachine --> ConnectorClient --> SSRFGuard
    StateMachine --> GroundingGuard
    GroundingGuard --> FactRenderer
```

---

## 4. Sequence Diagram: Voice Streaming & Turn Execution

This sequence details the push-to-talk voice interaction from audio frame capture to first spoken audio chunk.

```mermaid
sequenceDiagram
    autonumber
    actor User as End Customer (Web SDK)
    participant GW as apps/realtime (WS Gateway)
    participant Redis as Redis 7 (Session/PubSub)
    participant STT as Hosted Streaming STT
    participant Orch as packages/orchestrator
    participant Conn as Tenant Connector API
    participant LLM as Hosted LLM (Grok / Groq)
    participant TTS as Hosted Streaming TTS

    User->>GW: WS Connect (Header: Authorization Bearer session_token)
    GW->>Redis: Validate session token & load bounded state
    GW-->>User: WS Connected (Ready)

    User->>GW: ClientTurnStart (turn_id: 101)
    User->>GW: Binary Audio Frames (PCM 16kHz mono)
    GW->>STT: Stream PCM audio chunks
    STT-->>GW: Partial transcripts ("ek cheese burst...")
    GW-->>User: TranscriptUpdate (partial: "ek cheese burst...")

    User->>GW: ClientTurnEnd (Microphone release)
    STT-->>GW: Final transcript: "Ek cheese burst pizza add kar do medium"
    GW-->>User: TranscriptUpdate (final: "Ek cheese burst pizza add kar do medium")

    GW->>Orch: ProcessTurn(session_id, transcript)
    Note over Orch: Fast-path check fails (Requires menu search)

    par Parallel Work
        Orch->>Conn: SearchMenu(branch_id, query="cheese burst pizza")
        Orch->>LLM: ExtractSlots(transcript, schema)
    end
    Conn-->>Orch: Item details (ID: pizza_12, medium: INR 399, in_stock: true)
    LLM-->>Orch: Intent: ADD_TO_CART, slots: {item: "cheese burst", size: "medium"}

    Orch->>Orch: Validate constraints & build immutable Proposal (cp_9)
    Orch->>Redis: Store Proposal cp_9 (TTL 120s, cart_version: 4)
    Orch->>Orch: FactRenderer formats grounded reply: "One medium cheese burst pizza is INR 399. Add it?"
    Orch->>Orch: GroundingGuard validates numbers & item presence

    Orch->>TTS: StreamTextChunk("One medium cheese burst pizza is INR 399. Add it?")
    TTS-->>GW: First Audio Chunk (Opus / PCM)
    GW-->>User: Binary Spoken Audio Chunk (p95 <= 3.0s)
    GW-->>User: TurnComplete (proposal_id: "cp_9", total_minor: 39900, cards: [...])
```

---

## 5. Sequence Diagram: Cart Confirmation & Checkout Hand-Off

```mermaid
sequenceDiagram
    autonumber
    actor User as End Customer (Web SDK)
    participant API as apps/api (REST Gateway)
    participant Redis as Redis 7 (Idempotency & Locks)
    participant Policy as packages/policy-engine
    participant Conn as Tenant Connector API
    participant TenantUI as Tenant Checkout UI

    User->>API: POST /v1/cart/confirm<br/>Headers: Idempotency-Key: ik_88, Bearer session_token<br/>Body: { proposal_id: "cp_9", expected_cart_version: 4 }
    
    API->>Redis: SETNX idempotency:ik_88 (Lock)
    Redis-->>API: OK (First attempt)

    API->>Redis: GET proposal:cp_9
    Redis-->>API: Proposal Record (Owner: usr_1, branch_1, cart_v4, expires_at)
    
    API->>Policy: Validate proposal unexpired & user ownership
    Policy-->>API: Valid

    API->>Conn: POST /connector/v1/cart/commit<br/>HMAC-SHA256 Signed<br/>{ proposal_id: "cp_9", expected_version: 4, items: [...] }
    
    alt Cart Version Conflict (Stale Cart)
        Conn-->>API: 409 Conflict (current_version: 5)
        API-->>User: 409 Conflict (Stale cart. Please preview updated total.)
    else Commit Success
        Conn-->>API: 200 OK (new_cart_version: 5, total_minor: 39900)
        API->>Redis: Store idempotency response (ik_88)
        API-->>User: 200 OK { cart_version: 5, total_minor: 39900, status: "COMMITTED" }
    end

    User->>TenantUI: Emits onCheckoutHandoff(cart_version: 5)<br/>Opens tenant checkout modal/page
    Note over TenantUI: Tenant handles Address, Delivery Fees, Taxes, and Payment Gateway
```

---

## 6. Multi-Tenant Isolation & Security Topology

```mermaid
graph TD
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef boundary fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
    classDef secure fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef storage fill:#fff3e0,stroke:#e65100,stroke-width:2px;

    ClientReq["Client Request<br/>(Bearer: session_jwt)"]:::client
    ServerAuth["API Gateway Auth Middleware<br/>(Extracts & verifies tenant_id, user_ref)"]:::boundary
    ALS["AsyncLocalStorage Tenant Context<br/>(Immutable per request)"]:::boundary

    subgraph PostgreSQL Row-Level Security
        DBConn["Database Connection<br/>(From Pool)"]:::secure
        SetTenant["SET LOCAL app.current_tenant_id = 't_xyz'"]:::secure
        TableTenant["tenants table"]:::storage
        TableKeys["tenant_api_keys table"]:::storage
        TablePrefs["user_preferences table (RLS filter: tenant_id)"]:::storage
        TableAudit["audit_log table (RLS filter: tenant_id)"]:::storage
    end

    subgraph Redis Namespacing
        RedisKey1["t_xyz:session:as_7"]:::storage
        RedisKey2["t_xyz:ratelimit:ip_1.2.3.4"]:::storage
        RedisKey3["t_xyz:proposal:cp_9"]:::storage
    end

    subgraph Connector Outbound SSRF Guard
        HTTPClient["Connector HTTP Client"]:::boundary
        DNSCheck["Custom DNS Resolver & IP Pinning<br/>(Blocks 127.0.0.1, 169.254.169.254, RFC1918)"]:::secure
        RemoteTenant["Verified Tenant HTTPS Host"]:::client
    end

    ClientReq --> ServerAuth --> ALS
    ALS --> DBConn --> SetTenant
    SetTenant --> TablePrefs
    SetTenant --> TableAudit
    ALS --> RedisKey1
    ALS --> RedisKey2
    ALS --> RedisKey3
    ALS --> HTTPClient --> DNSCheck --> RemoteTenant
```

---

## 7. Horizontal Scaling & Fault-Tolerant Topology

- **Stateless Gateway Nodes:** `apps/api` and `apps/realtime` hold no in-memory session truth. All conversational context is persisted in Redis with bounded TTLs. Any client can reconnect to any gateway node seamlessly.
- **Distributed Turn Cancellation:** When a user interrupts speech or re-connects, a Pub/Sub message (`session:{id}:cancel`) is published. All cluster nodes inspect active connections and cancel in-flight STT/LLM tasks immediately.
- **Bulkheads & Circuit Breakers:** Separate connection pools and concurrency limiters are maintained for LLM inference, STT/TTS providers, and Tenant Connector endpoints. A tenant connector failure never cascades into global platform instability.

```mermaid
graph TD
    classDef ext fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef node fill:#ede7f6,stroke:#512da8,stroke-width:2px;
    classDef shared fill:#fce4ec,stroke:#c2185b,stroke-width:2px;

    LB["AWS ALB / NGINX Ingress<br/>(Round Robin + WebSocket Support)"]:::ext
    RT1["apps/realtime Node 1"]:::node
    RT2["apps/realtime Node 2"]:::node
    API1["apps/api Node 1"]:::node
    API2["apps/api Node 2"]:::node

    RedisPubSub[("Redis 7 Cluster<br/>Session State + Cancel Pub/Sub")]:::shared
    PgCluster[("PostgreSQL 16 Cluster<br/>Primary + Read Replica with RLS")]:::shared

    LB --> RT1
    LB --> RT2
    LB --> API1
    LB --> API2

    RT1 <--> RedisPubSub
    RT2 <--> RedisPubSub
    API1 <--> RedisPubSub
    API2 <--> RedisPubSub

    API1 --> PgCluster
    API2 --> PgCluster
```
