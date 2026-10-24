# Specification Coverage Matrix

This matrix maps every requirement, customer journey rule, data entity, and acceptance test from [docs/SPEC.md](file:///C:/Users/Rahul/.gemini/antigravity/scratch/voice-commerce-assistant/docs/SPEC.md) (Part A) to the system features (F01–F15), architectural packages, implementation phases, and automated verification suites.

---

## 1. Requirement to Feature & Phase Mapping

| Part A Req | Description | Priority | Feature ID | Target Package(s) | Implementation Phase | Verification Suite |
| :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| **A01** | Voice & text turns (EN, HI, Hinglish), push-to-talk, editable transcript, typing fallback | P0 | F01 | `packages/speech`, `apps/realtime`, `packages/orchestrator`, `packages/web-sdk` | Phase 5, Phase 6, Phase 7 | Multilingual harness (A10), Audio frame tests, SDK unit/e2e tests |
| **A02** | Search & menu questions (branch-scoped, verified facts only; spice, creaminess, calories) | P0 | F02 | `packages/connector-contract`, `packages/policy-food`, `packages/orchestrator` | Phase 2, Phase 3, Phase 5 | Grounding guard tests, Catalog search unit tests, Test A02 |
| **A03** | Diet & allergy constraints (tri-state logic: true, false, unknown; Jain, GF, allergens, protein) | P0 | F03 | `packages/policy-engine`, `packages/policy-food` | Phase 3 | Deterministic constraint tests, Property-based safety tests, Tests A03, A04, A05 |
| **A04** | Cart assistance (propose, preview, explicit confirm, idempotent commit, version checks) | P0 | F04 | `packages/policy-engine`, `packages/orchestrator`, `apps/api` | Phase 1, Phase 2, Phase 3, Phase 5 | Idempotency tests, Proposal lifecycle tests, Concurrency tests, Tests A07, A08 |
| **A05** | Group ordering (deterministic allocation & budget solver, label preferences, fee handling) | P0 | F05 | `packages/policy-food`, `packages/policy-engine` | Phase 3 | Combinatorial knapsack/allocation solver tests, Infeasibility tests, Test A09 |
| **A06** | Preference memory (opt-in consent, review, edit, delete, one-order override, encrypted storage) | P0 | F06 | `packages/platform`, `packages/core`, `apps/api` | Phase 1, Phase 3, Phase 5 | Consent versioning tests, Cryptographic storage tests, Test A06 |
| **A07** | Re-order (load own past order, validate against live menu/price, propose differences) | P0 | F07 | `packages/connector-contract`, `packages/policy-food`, `packages/orchestrator` | Phase 2, Phase 3, Phase 5 | Re-order mapper tests, Price delta detection tests, Test A10 |
| **A08** | Order tracking (ownership-checked, live status, timestamp, opaque contact actions, clarify multiple) | P0 | F08 | `packages/connector-contract`, `packages/orchestrator`, `apps/api` | Phase 2, Phase 3, Phase 5 | Tracking service tests, Stale data tests, Ownership boundary tests, Test A11 |
| **A09** | Pairing suggestion (at most 1 relevant compatible add-on per order, never silent addition) | P1 | F09 | `packages/policy-food`, `packages/orchestrator` | Phase 3, Phase 5 | Pairing rule tests, Decline idempotency tests, Test A13 |
| **A10** | Checkout hand-off (assistant emits hand-off event; tenant checkout confirms address, fees, payment) | P0 | F10 | `packages/orchestrator`, `packages/web-sdk` | Phase 5, Phase 7 | Hand-off event contract tests, No-autonomous-payment tests, Test A12 |
| **N01** | Operational quality (tenant isolation, observability, evaluation, cost limits, retention, rollout) | P0 | F11, F12, F13, F14, F15 | `packages/platform`, `apps/worker`, `packages/eval`, `apps/api` | Phase 1, Phase 8, Phase 9, Phase 10, Phase 11 | RLS audit, Load/chaos tests, Red-team prompt injection suite, Drain tests |

---

## 2. Acceptance Test (A01–A15) Traceability Matrix

| Test ID | Spec Ref | Description | Primary Invariant / Assertion | Target Module | Phase |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **A01** | A01 | Voice & text turns across EN, HI, Hinglish; editable transcript | Transcript editable before dispatch; normalized Hindi numbers, Hinglish synonyms recognized | `packages/orchestrator`, `packages/speech`, `packages/web-sdk` | Phase 5, 6, 7, 11 |
| **A02** | A02 | Verified branch items & facts only; prompt injection immunity | Untrusted menu descriptions cannot alter system prompt or tool rules; zero hallucinated items | `packages/orchestrator/grounding`, `packages/policy-food` | Phase 3, 5, 11 |
| **A03** | A03 | Verified Jain recipes; root vegetables & onion/garlic rule | Excludes potato, onion, garlic, carrot, radish, etc.; verifies rule version; rejects uncertified items | `packages/policy-food/jain` | Phase 3, 11 |
| **A04** | A03 | Unknown allergy or cross-contact cannot become safe/GF | Tri-state logic: `UNKNOWN` triggers safety warning and support route; never evaluated as `SAFE` | `packages/policy-engine/tri-state` | Phase 3, 11 |
| **A05** | A02, A03 | Missing nutrition or texture stated as unavailable | Null fields return explicit "unavailable" response; no numeric guessing | `packages/policy-food`, `packages/orchestrator` | Phase 3, 5, 11 |
| **A06** | A06 | Opted-in memory persists; one-order override & deletion work | Preferences require consent; override applies to 1 order only; DELETE purges persisted data | `packages/core/preferences`, `apps/api` | Phase 3, 5, 11 |
| **A07** | A04 | Repeated confirm adds once; option charge & undo correct | Idempotency-Key guarantees single commit; proposal commits atomically with correct price delta | `packages/platform/idempotency`, `apps/api` | Phase 1, 3, 5, 11 |
| **A08** | A04, A10 | Stale stock, menu price, or cart version forces new proposal | 409 Conflict returned on stale `cart_version` or `menu_version`; fresh preview required | `packages/orchestrator`, `packages/connector-sdk` | Phase 2, 3, 5, 11 |
| **A09** | A05 | Group allocation labeled, full total within budget | Deterministic solver outputs labeled partition; includes known fees; detects infeasibility | `packages/policy-food/group-solver` | Phase 3, 11 |
| **A10** | A07 | Re-order shows current prices, missing items, no history fallback | Maps past line items to current catalog version; highlights missing items & price changes | `packages/policy-food/reorder` | Phase 3, 5, 11 |
| **A11** | A08 | Own-order tracking with timestamp; disambiguates multiple orders | Returns authenticated status with UTC timestamp; lists active orders when > 1 without guessing | `packages/orchestrator/tracking`, `apps/api` | Phase 2, 5, 11 |
| **A12** | A10 | Customer explicitly submits through tenant checkout | Assistant contains zero payment/charge capabilities; emits navigation event to tenant web/app | `packages/web-sdk`, `packages/orchestrator` | Phase 5, 7, 11 |
| **A13** | A09 | At most one compatible optional suggestion (P1) | Evaluates cart contents; suggests at most 1 item; decline leaves cart completely unchanged | `packages/policy-food/pairing` | Phase 3, 5, 11 |
| **A14** | A04, N01 | Tampered identity, sessions, tools cannot cross tenants/users | RLS & token validation reject forged `user_ref`, `tenant_id`, or cross-session proposal commits | `packages/platform/auth`, `apps/api` | Phase 1, 5, 11 |
| **A15** | A01 | Noise, denied mic, interruption, offline failures handle gracefully | Client falls back to typing; server handles `turn_cancel` and network interruptions cleanly | `apps/realtime`, `packages/web-sdk` | Phase 6, 7, 11 |

---

## 3. Data Entity Coverage

| Entity Name | Required Fields (Spec A7) | Storage Authority | Implementation Package & Schema |
| :--- | :--- | :--- | :--- |
| **Menu Item & Variant** | `tenant_id`, `restaurant_id`, `branch_id`, `item_id`, `variant_id`, `name`, `aliases`, `description`, `price_minor`, `currency`, `stock_state`, `menu_version`, `active` | Tenant Platform (cached locally in Redis with version key) | `packages/connector-contract/catalog` |
| **Recipe Facts** | `is_veg`, `jain_verification`, `jain_rule_version`, `ingredients`, `allergens_present`, `cross_contact_state`, `gluten_state`, `spice_level`, `creaminess` (Tri-state) | Tenant Platform via Connector | `packages/policy-food/recipe-facts` |
| **Nutrition** | `kcal`, `protein_g`, `serving_size`, `source`, `verification_status`, `updated_at` | Tenant Platform via Connector | `packages/policy-food/nutrition` |
| **Modifiers** | `option_id`, `allowed_variant_combinations`, `min_choices`, `max_choices`, `price_delta`, `stock`, `changed_allergens`, `changed_diet` | Tenant Platform via Connector | `packages/connector-contract/modifiers` |
| **Preferences** | `user_reference`, `structured_diet`, `allergies`, `language`, `consent_version`, `consent_at`, `source`, `updated_at` | SaaS DB (RLS + Field Encryption) or Tenant via Connector | `packages/core/preferences`, `apps/api` |
| **Assistant Session** | `session_id`, `tenant_id`, `user_reference`, `branch_id`, `cart_id`, `language`, `bounded_turn_state`, `expires_at`, `redacted_trace_id` | SaaS Redis / PostgreSQL (bounded) | `packages/core/session`, `packages/orchestrator` |
| **Cart Proposal** | `proposal_id`, `tenant_id`, `user_reference`, `branch_id`, `items`, `backend_totals`, `cart_version`, `menu_version`, `expires_at`, `confirmed_action_id` | SaaS Redis / PostgreSQL (immutable, 2 min TTL) | `packages/policy-engine/proposal` |
| **Order Integration** | `order_id`, `user_reference`, `items`, `status`, `timestamp`, `eta`, `contact_actions` | Tenant Platform via Connector | `packages/connector-contract/orders` |

---

## 4. Phase Delivery Gates

- **Phase 0–1**: Foundational security, tenancy, RLS, token auth, concurrency limits, idempotency.
- **Phase 2–3**: Tenant connector contract, food policy engine, tri-state dietary validation, budget solver.
- **Phase 4–5**: LLM registry & router, orchestrator state machine, fast paths, grounding guard, REST endpoints.
- **Phase 6–7**: Streaming speech adapters, realtime WebSocket gateway, Web SDK & demo client.
- **Phase 8–9**: Metering, spend caps, tenant admin API, API key rotation.
- **Phase 10–12**: Load testing, SLOs, multilingual evaluation (A10), security penetration audit, release documentation.
