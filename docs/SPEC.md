# PART A: EMBEDDED PRODUCT SPECIFICATION
(Adapted from the "Voice Agent MVP" specification v1.0, assistant module only. "ARPZO" is tenant #1, used only as the demo tenant. Where the original assumes one company's existing backend, this product uses the tenant connector and session model defined in GENERICITY. P0 = required for launch, P1 = optional after P0 passes.)

## A1. BUILD OBJECTIVE
Let a customer speak or type in English, Hindi, or Hinglish to find food, build a suitable cart, repeat a previous order, and check delivery status. The AI assistant proposes actions through controlled backend tools; deterministic commerce services own all commerce truth.
First release outcome: natural language menu search and factual menu questions; dietary and group cart proposals; preference consent; confirmed cart edits; re-order; live order status. Delivery package: API and event contracts, menu metadata, evaluation evidence, monitoring, and runbooks.
Delivery assumptions: the tenant platform supplies customer login, branch menus, cart, checkout and payment, order lifecycle, and status tracking, all reached through the connector. One branch per cart and delivery orders are the MVP defaults. Speech provider and model choices are finalized through early benchmark tasks against the multilingual test set.

## A2. REQUIREMENT MAP
A01 Voice and text. P0. English, Hindi, Hinglish; push-to-talk, editable transcript, spoken reply, and typing fallback.
A02 Search and menu questions. P0. Branch-scoped search; answer spice, creaminess, and calories only from verified menu data.
A03 Diet and allergy constraints. P0. Veg, Jain, gluten-free, protein, and allergies as structured filters with explicit unknown states.
A04 Cart assistance. P0. Add, remove, quantities, and allowed modifiers after a validated preview and explicit confirmation.
A05 Group ordering. P0. Propose a single-branch cart for a group mix and budget, with clear quantities and allocation.
A06 Preference memory. P0. Explicit opt-in, review, edit, and deletion; the current request can override for one order.
A07 Re-order. P0. Load the customer's own completed order, validate current menu and prices, and ask before adding.
A08 Tracking. P0. Read live order status and timestamp; pass through any eligible contact actions supplied by the tenant as opaque data (the assistant itself never places calls).
A09 Pairing suggestion. P1. One relevant optional add-on per order, never a silent cart addition.
A10 Checkout hand-off. P0. The tenant's existing checkout confirms address, fees, payment, and final order submission.
N01 Operational quality. P0. Isolation, observability, evaluation, cost limits, retention, and controlled rollout.

## A3. CUSTOMER JOURNEY AND EXAMPLES
Voice ordering journey:
1. The customer selects a restaurant branch and taps the microphone. Explain voice processing and request microphone permission. Offer a typing option.
2. Capture a short turn and show the final transcript. Detect English, Hindi, or Hinglish, while letting the customer select a language.
3. Extract intent and constraints. Ask one focused question if item, size, quantity, dietary rule, or branch is ambiguous.
4. Fetch live menu facts and available options. Apply deterministic constraints before ranking candidates.
5. Show a cart proposal with item, quantity, variant, modifiers, and a backend-calculated total. Read a short summary.
6. The customer says or taps confirm. Apply the cart action once using proposal ID, cart version, and an idempotency key.
7. Open the tenant's existing checkout. The customer confirms final address, charges, and payment there. The assistant cannot independently charge or submit an order.
Examples that must be supported:
- Customer: "Ek cheese burst pizza add kar do." Assistant: "Which size would you like?" After selection: "One medium cheese burst pizza is INR 399. Add it?" Only a confirmed, supported menu option is added.
- Customer: "Same as last time, make it Jain." The assistant loads the customer's latest completed order for the branch, checks every recipe and modifier, identifies incompatible items, and proposes approved alternatives. It never silently reuses the old cart or its prices.
- Customer: "For 3 people, 2 veg and 1 non veg, under 1500." The proposal labels which items serve each preference. Ask whether the budget includes fees if unclear; default to the full payable total when all fees are known. Do not promise portion adequacy without restaurant serving data.

## A4. DIETARY PRECEDENCE
Apply explicit current constraints first, then consented saved preferences. Allergies remain hard exclusions until the customer explicitly updates the recorded restriction. A conflicting request triggers clarification. Never silently remove a restriction to make a cart fit. Jain is a restaurant-verified recipe rule and may exclude root vegetables (for example potato, onion, garlic, carrot, radish); "no onion, no garlic" alone is insufficient. Gluten-free and allergen safety depend on ingredients and cross-contact information. Unknown data cannot become a safety claim: state the limitation and offer a restaurant support route. Protein thresholds use published grams per serving, never model estimates.

## A5. ASSISTANT ARCHITECTURE AND TOOL CONTRACTS
Use a streaming speech-to-text adapter, a model orchestrator with validated tool calls, deterministic commerce services, and a text-to-speech adapter. Start with push-to-talk and short conversational turns (limits accidental actions, gives a reliable text fallback). Select providers against the multilingual test set rather than language-support claims alone.
Components:
- Customer app (web SDK here): microphone permission, capture and stop controls, transcript editing, proposal cards, confirmation, and checkout navigation.
- Assistant service: authenticated sessions, bounded conversation context, turn cancellation, tool schemas, response streaming, and redaction.
- Commerce tools: branch menu retrieval, verified dietary filtering, stock and price checks, cart versioning, own order history, and tracking.
- Model and speech adapters: speech recognition, constrained intent interpretation, grounded response wording, and spoken output. No direct database writes.
- Platform services (tenant side, via connector): auth, menu and stock, orders, payment, delivery events, preferences.
Tool contracts:
- search_menu: input query and structured constraints; server adds authenticated branch scope; returns canonical item and option IDs and verified facts.
- get_menu_item: input item ID; returns recipe data, unknown flags, live options, and current price version.
- propose_cart: input items or group constraints; validates stock, diet, options, and total; creates an immutable short-lived proposal.
- get_reorder_proposal: input own order reference or latest; maps history to the current menu; returns changes and missing items.
- get_order_status: input order reference when needed; checks ownership; returns source status, timestamp, and optional provider ETA.
- get_preferences: no user-supplied identity; returns only consented preferences belonging to the authenticated customer.
Cart confirmation and preference writes use explicit user-action endpoints. They are not model tools. Never trust model-supplied customer IDs, prices, branch access, or tenant values. Menu descriptions, reviews, and speech are untrusted input and cannot override system policy. Redis is suitable for bounded session state, rate limits, locks, and jobs; it is not the source of order truth.

## A6. ASSISTANT API CONTRACT
All routes require authentication, tenant isolation, and HTTPS. The server derives identity from the access token. Return request_id for tracing. Use UTC timestamps, ISO currency codes, and integer minor units for money.
- POST /v1/assistant/sessions: branch_id, cart_id, language. Returns session_id, streaming configuration, supported language modes.
- POST /v1/assistant/turns: session_id, client_turn_id, text or finalized speech reference. Returns assistant text, structured cards, optional proposal_id, and clarification state.
- WSS /v1/assistant/stream: session-bound audio frames and turn cancel. Returns partial and final transcript, response text, TTS chunks, and explicit turn state.
- POST /v1/cart/proposals: session_id, proposed item choices or group request. Returns validated proposal, totals, warnings, cart_version, menu_version, expires_at.
- POST /v1/cart/confirm: proposal_id, expected_cart_version, Idempotency-Key header. Returns new cart version and total, or a conflict requiring a fresh preview.
- GET, PATCH, DELETE /v1/me/preferences: read, consented field changes, or removal. Returns own structured preference state and consent version.
- GET /v1/orders/{id}/status: own order ID. Returns canonical status, updated_at, eligible contact actions, and source ETA if available.
Cart proposal example:
POST /v1/cart/proposals
{ "session_id": "as_7", "items": [ { "item_id": "pizza_12", "variant_id": "medium", "quantity": 1, "option_ids": ["extra_cheese"] } ] }
200 { "proposal_id": "cp_9", "currency": "INR", "total_minor": 44800, "cart_version": 4, "menu_version": 23, "expires_at": "2026-10-16T12:05:00Z", "requires_confirmation": true }
Example values are illustrative. The tenant system calculates every charge. A proposal lasts at most two minutes by default and is invalidated by relevant menu or cart changes. Confirm repeats all hard checks and commits atomically. A repeated idempotency key returns the original result; the same key with a different body returns conflict. Status codes: 401 invalid login, 403 denied ownership, 409 stale cart or unsupported transition, 422 invalid choices, 429 limits, 503 unavailable providers. Never convert a failed tool response into a successful spoken claim.

## A7. DATA ENTITIES (MINIMUM FIELDS)
- Menu item and variant: tenant_id, restaurant_id, branch_id, item_id, variant_id, name, aliases, description, price_minor, currency, stock state, menu_version, active flag.
- Recipe facts: is_veg, Jain verification and rule version, ingredients, allergens_present, cross_contact state, gluten state, spice level and creaminess when supplied. Unknown is distinct from false.
- Nutrition: kcal, protein_g, and serving size, plus source, verification status, and updated_at. Missing values remain null and cannot satisfy numeric filters.
- Modifiers: option IDs, allowed variant combinations, min and max choices, price delta, stock, and changed allergen or dietary properties. Free text cannot create an unsupported recipe.
- Preferences: user reference, structured diet and allergies, language, consent_version, consent_at, source, updated_at. One-order overrides are kept separate from saved state.
- Assistant session: session_id, user reference, branch_id, cart_id, language, bounded turn state, expiry, and redacted trace IDs. No payment credentials.
- Cart proposal: proposal_id, owner, branch, item options, validation facts, backend totals, cart_version, menu_version, created_at, expires_at, and confirmed action ID.
- Order integration: own history, current pricing lookup, live status, and contact eligibility.

## A8. INTEGRATION EVENTS AND MENU READINESS
Consume durable tenant events (signed, with event_id, occurred_at, and a version) for stock, menu, and order-status changes. Process duplicates idempotently and reject older versions. Client notifications never update order truth. Branch stock and modifier updates invalidate relevant cached results. Re-order creates a fresh proposal rather than copying paid line items. Tracking returns a timestamp and reports stale data explicitly. Multiple active orders require a selection rather than guessing.
Menu readiness gate: restaurant operations must review pilot items and options before launch. Do not infer allergies from dish names or photos. A search index or embedding store is optional for larger menus; exact IDs, structured filters, and live stock checks remain mandatory. Model fine-tuning is unnecessary for the first release unless measured retrieval and prompting failures justify it.

## A9. ASSISTANT ACCEPTANCE TESTS (ALL P0 CASES MUST PASS; A13 ONLY WHEN THE OPTIONAL SUGGESTION IS ENABLED)
A01 (req A01): correct item, quantities, and modifiers in all three language modes; editable transcript.
A02 (A02): only verified branch items and facts; menu text cannot override tool policy.
A03 (A03): verified Jain recipes; root vegetables and "no onion, no garlic" rules handled correctly.
A04 (A03): unknown allergy or cross-contact state cannot become a safe or gluten-free claim.
A05 (A02, A03): missing nutrition or texture data is stated as unavailable.
A06 (A06): only opted-in memory persists; one-order override and delete behave correctly.
A07 (A04): repeated confirmation adds once; option charge and undo are correct.
A08 (A04, A10): stale stock, menu price, or cart version requires a new proposal.
A09 (A05): group allocation is labeled and the full total stays within budget, or infeasibility is explained.
A10 (A07): re-order shows current prices, missing items, and no history fallback.
A11 (A08): own-order tracking with timestamp; clarify multiple orders and report stale status.
A12 (A10): customer explicitly submits through existing checkout; no autonomous payment.
A13 (A09): at most one compatible optional suggestion; decline changes nothing.
A14 (A04, N01): tampered identity, sessions, tools, and prompt attacks cannot read or write other users' data.
A15 (A01): noise, denied microphone, interruption, and offline failure clarify or offer typing.

## A10. MULTILINGUAL EVALUATION
Create at least 150 held-out audio utterances, at least 50 each for English, Hindi, and Hinglish. Include real dish names, Indian accents, mixed scripts where typed, negation, numbers, budget, self-correction, noisy rooms, and ambiguous variants. Keep tuning samples separate from release evaluation samples. Measure correct intent and all required slots together, not transcript word accuracy alone. Release targets: at least 90 percent overall and at least 85 percent in each language group; zero critical dietary constraint violations and zero unauthorized or unconfirmed writes in the safety regression suite. These are engineering targets to validate, not current results.

## A11. TARGETS, DEFINITION OF DONE, RELEASE GATE
- Voice response: p95 first useful text or audio within 3 seconds after end of speech for ordinary queries (separate STT, model, tool, and TTS latency; exclude user thinking time).
- Cart or tracking tool: p95 within 1 second for platform calls under pilot load.
- Pilot load baseline: 50 concurrent assistant sessions (planning baseline only; this product targets much higher, see PERFORMANCE AND SCALABILITY).
- Accuracy and safety: as in A10. Record p50 and p95, traffic size, and network profile for every benchmark.
- Definition of done for every task: reviewed; acceptance rule demonstrated; linked test IDs have evidence; API changes include schema and authorization behavior; new configuration has staging and production defaults; logs are redacted; failure paths are demonstrated.
- Release gate: all P0 tasks and tests pass; no open critical defect for allergies, identity isolation, or unconfirmed cart actions; verified menu, provider benchmark evidence, retention configuration, spend alerts, and a rollback rehearsal; a controlled pilot precedes general availability.

## A12. COST AND RETENTION
Cost = speech-recognition audio minutes + model input and output usage + speech-generation usage + storage and traffic + backend and monitoring. Capture cost per assistant session. Set owner-approved monthly caps with alerts at 50, 80, and 100 percent, bounded turn length and conversation history, idle timeouts, and maximum response size.
Retention defaults: redacted assistant transcripts 7 days; no raw assistant audio retained by default; stored preferences remain until edited or deleted. Apply retention jobs, deletion requests, and backup expiry consistently. Limit model and speech provider retention through configuration and contracts. Redact real phone numbers, addresses, tokens, and signed URLs in logs and crash reports. Add per-user and per-IP abuse limits.
