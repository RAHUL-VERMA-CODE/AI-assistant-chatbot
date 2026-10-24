# ADR 0004: Deterministic Conversation State Machine vs Heavy Agent Frameworks (LangGraph)

## Status
Accepted

## Context
Voice commerce requires ultra-low latency (p95 <= 3.0s voice turnaround, <= 1.5s text first-token), deterministic adherence to safety and dietary rules (Spec Req A03, A04, Non-Negotiable Rules), and zero financial or cart hallucinations.

Modern AI agent frameworks (e.g. LangGraph.js, CrewAI, AutoGen) introduce:
1. Significant runtime overhead (nested graph abstractions, state serialization, complex middleware chains).
2. Autonomous multi-step model loops where the LLM decides which tools to call in what sequence.
3. High vulnerability to runaway token loops, high costs, and unpredictable latency tails.
4. Risk of the model attempting unauthorized writes or hallucinating commerce facts.

## Decision
We reject heavy agent runtimes (like LangGraph) in favor of an **Explicit, Deterministic Conversation State Machine** with constrained task-based model invocation:
1. **Explicit Turn State Machine (`packages/orchestrator`):**
   - States: `GREETING`, `MENU_SEARCH`, `CLARIFICATION`, `PROPOSAL_PENDING`, `CONFIRMED`, `CHECKOUT_HANDOFF`, `ERROR`.
   - Transitions are strictly deterministic and code-governed.
2. **Deterministic Fast Paths:**
   - Common voice commands (`confirm`, `cancel`, `undo`, `increase quantity`, `show cart`, `check status`) bypass the LLM entirely.
   - Response time for fast paths: **<= 15 ms**.
3. **Constrained Model Role:**
   - The LLM is used strictly as a stateless interpreter:
     a) Intent and slot extraction (extract dish name, size, spice, dietary filters from conversational speech).
     b) Polite conversational framing and short wording.
   - The LLM **never** decides prices, availability, dietary compatibility, or commits carts.
4. **Deterministic Template Rendering & Grounding Guard:**
   - Fact representation (dishes, options, prices, totals) is rendered by code templates.
   - The `GroundingGuard` deterministically parses any generated text and verifies that mentioned items and numbers exactly match verified tool output before dispatching to TTS.

## Consequences
- **Positive:** Sub-millisecond state transitions; zero runaway LLM loops; strict safety guarantees; immune to tool-hijacking injection attacks; predictable latency and cost.
- **Negative:** Requires explicit state machine code for new conversational workflows rather than relying on autonomous agent discovery.
