# ChefZaika AI — Enterprise Voice Commerce & Culinary Concierge Platform
## Technical Architecture, Tech Stack, AI Models & File Directory Reference

---

## 1. Executive Summary

**ChefZaika AI** is an enterprise-grade, multilingual voice commerce and restaurant concierge platform designed for seamless food ordering, multi-turn culinary assistance, and real-time cart and order lifecycle management. The application features a hybrid AI pipeline that pairs ultra-low latency LLM inference (via Groq) and LangGraph stateful workflow execution with a deterministic, zero-latency TypeScript orchestrator and persistent MongoDB-compatible database engine.

---

## 2. Technology Stack Breakdown

| Layer / Subsystem | Technology / Library | Version / Runtime | Key Purpose & Responsibilities |
| :--- | :--- | :--- | :--- |
| **Frontend UI / Client** | HTML5, CSS3, Modern ES6+ JavaScript | Vanilla / Zero-Dependency | Ultra-responsive, mobile-first dining UI with glassmorphism, dynamic theme engine (Light/Dark), and live MongoDB inspector modal. |
| **Voice Interface (STT/TTS)** | Native Web Speech API (`SpeechRecognition`, `SpeechSynthesis`) | Browser Native (Chrome/Edge/Safari) | Push-to-talk dual-language speech recognition (English `en-IN` & Hindi `hi-IN`) and markdown-scrubbed natural voice playback. |
| **Frontend SDK** | `@voice-commerce/web-sdk` | Node.js 20+ / ES Modules | Manages audio waveforms, microphone visualizer, session storage synchronization, and REST client calls. |
| **API Gateway / Backend** | Node.js Express & TypeScript | Node.js v22+ (Native `--experimental-strip-types`) | Exposes high-throughput REST APIs (`/api/chat`, `/api/cart/*`, `/api/orders/*`, `/api/database/*`), handles CORS, and routes traffic. |
| **Orchestrator Engine** | `@voice-commerce/orchestrator` | TypeScript | Deterministic fallback conversational agent with phonetic normalizer, multi-constraint solver, and Flipkart-style cancellation flows. |
| **AI Agent Microservice** | Python FastAPI & Uvicorn | Python 3.12+ (FastAPI 0.115+, Uvicorn) | High-performance asynchronous AI backend exposing `POST /agent/turn` on port 8000 for complex conversational reasoning. |
| **Agentic Workflow Framework** | LangGraph & LangChain Core | `langgraph >= 0.2`, `langchain-core` | StateGraph execution pipeline managing cyclic agentic state transitions: `intent_routing_node` $\rightarrow$ `execution_node`. |
| **LLM Provider & Cloud Engine** | Groq Cloud API | REST / OpenAI-Compatible SDK | Sub-second high-speed inference for semantic classification, dietary inquiries, and natural language understanding. |
| **Database & Persistence** | MongoDB-Compatible JSON Data Store | TypeScript / Node.js File System | Persistent collections for `menu`, `carts`, `orders`, `tables`, and `customer_preferences` with live transactional updates. |
| **Package Management** | PNPM Monorepo | PNPM Workspaces | Monorepo structure managing isolated packages (`@voice-commerce/web-sdk`, `@voice-commerce/orchestrator`, `@voice-commerce/platform`). |

---

## 3. Active AI Models & Agent Pipeline

| Model / AI Subsystem | Provider | Role & Capability | Latency & Fallback Strategy |
| :--- | :--- | :--- | :--- |
| **`openai/gpt-oss-120b`** | Groq Cloud | Primary high-intelligence reasoning model for complex multi-turn dialogues, multi-constraint group ordering, and nuanced multilingual intent matching. | ~350ms streaming latency. If rate-limited or unavailable, immediately falls back to `llama-3.3-70b-versatile`. |
| **`llama-3.3-70b-versatile`** | Groq Cloud | High-speed semantic router and conversational generator supporting English, Hindi (Devanagari), and Hinglish with zero hallucination. | ~180ms latency. High token efficiency and reliable JSON structured tool calling. |
| **LangGraph Agentic StateGraph** | Local Microservice (Python) | Governs structured state transitions, order proposal lifecycle (`propose_cart` $\rightarrow$ `confirm_cart`), and safe tool execution without unauthorized cart mutations. | Local in-process execution (< 15ms). Guarantees cart integrity and prevents random item addition. |
| **Deterministic TypeScript Engine** | Embedded in Node Orchestrator | Edge-fast phonetic and semantic classifier with typo correction (`coldrik` $\rightarrow$ `coldrink`, `jucie` $\rightarrow$ `juice`, `piza` $\rightarrow$ `pizza`). | **0ms latency (local memory)**. Active as resilient fallback whenever external AI network is unreachable. |

---

## 4. File-by-File Directory Map

### Root Configuration & Control
- `start-all.js` — Master process manager that boots all system services concurrently (Express REST API on 8080, Platform microservices on 4000/3000/8081) with port cleanup and health monitoring.
- `package.json` — Root npm monorepo configuration declaring project dependencies, workspaces, and scripts.
- `pnpm-workspace.yaml` — PNPM workspace boundaries grouping `packages/*` and `apps/*`.
- `.env` — Secure environment configuration containing `PORT`, `GROQ_API_KEY`, database paths, and API host endpoints.
- `PROJECT_DOCUMENTATION.md` — This master architecture, tech stack, and codebase documentation file.

### Backend Microservices (`services/agent-py`)
- `services/agent-py/main.py` — Core Python FastAPI microservice powered by LangGraph. Implements `AgentState`, `intent_routing_node`, `normalize_user_text`, `execution_node`, beverage carousels, Flipkart-style cancellations, and Groq LLM integration.
- `services/agent-py/requirements.txt` — Python dependencies including `fastapi`, `uvicorn`, `langgraph`, `langchain-core`, and `requests`.

### API & Routing (`apps/api`)
- `apps/api/src/server.ts` — Main Express HTTP server configuration, middleware, CORS setup, and route mounting.
- `apps/api/src/restaurant-router.ts` — Comprehensive REST router exposing endpoints for `/api/chat`, `/api/cart/*`, `/api/orders/*`, and `/api/database/*`. Handles bi-directional synchronization between the frontend and database.

### Conversational Orchestrator (`packages/orchestrator`)
- `packages/orchestrator/src/restaurant/restaurant-orchestrator.ts` — TypeScript conversational engine handling multilingual query classification (English, Hindi, Hinglish), phonetic normalizer, Flipkart-style cancellation flows, dietary advisory, and 12-hour AM/PM timestamps.
- `packages/orchestrator/src/restaurant/restaurant-tools.ts` — Executable restaurant tools for `searchMenu`, `addToCart`, `removeFromCart`, `viewCart`, `placeOrder`, `cancelOrder`, `bookTable`, and `applyCoupon`.

### Web Client & SDK (`packages/web-sdk`)
- `packages/web-sdk/src/demo/index.html` — Production-grade single-page client interface. Contains:
  - Glassmorphic chat stream with 12-hour AM/PM timestamps.
  - Swiggy & Zomato style `[ - ] QTY [ + ]` stepper controls on all dish cards with optimistic UI updates and live 2-way cart synchronization.
  - Senior Designer Concierge Hub (luxury 2-column card grid with micro-tags, custom gradient icon badges, and rich subtitles).
  - Flipkart / Amazon style cancellation reason pickers with automated refund initiation.
  - Listen (TTS) speech synthesis with closures and live audio pulsing animation.
  - Push-to-talk speech recognition with dynamic language toggle (EN / HI).
  - Top header with live MongoDB Inspector modal, Theme Toggle (Light/Dark), and persistent Cart drawer.
- `packages/web-sdk/src/demo/server.ts` — Dedicated static demo server for the web client interface.

### Database & Persistence (`database/`)
- `database/restaurant-db.ts` — Central transactional database controller managing memory and JSON file persistence with full ACID-like atomic updates.
- `database/data/menu.json` — Verified restaurant catalog containing 46 chef-curated dishes with authentic high-definition food images, prices, dietary tags, calorie counts, spice levels, and phonetic aliases.
- `database/data/carts.json` — Active customer cart sessions. Automatically wiped clean upon order placement or cart clearing.
- `database/data/orders.json` — Completed and active orders with lifecycle states (`Confirmed`, `Preparing`, `Out for Delivery`, `Delivered`, `Cancelled`).
- `database/data/tables.json` — Table reservation records with guest counts, dates, and booking slots.
- `database/data/customer_preferences.json` — Consented dietary preferences (e.g. Jain, Veg-only, Mild spice) stored per user session.

---

