# ADR 0006: Provider-Agnostic LLM and Speech Gateways with Rate Governance

## Status
Accepted

## Context
Third-party AI providers (LLM, STT, TTS) exhibit volatile pricing, varying rate limits, occasional outages, and differing regional strengths (e.g. Hindi/Hinglish accuracy). Coupling the platform to a single AI vendor creates catastrophic vendor lock-in and leaves the platform vulnerable to provider outages. Furthermore, free-tier developer accounts enforce strict RPM/TPM limits that require intelligent rate governance and fallback ladders.

## Decision
We implement a **Ports-and-Adapters Provider Architecture** for all AI capabilities:
1. **Unified `LLMProvider` Interface (`packages/llm`):**
   - Methods: `chat(messages, options)`, `streamChat(messages, options)`, `extractStructured(messages, schema)`.
   - Normalizes all provider responses into standard internal domain objects.
   - Built-in reasoning block stripper: cleanly strips `<think>...</think>` tags before speech synthesis, logging, or tool parsing.
2. **OpenAI-Compatible Adapter (`packages/llm/adapters/openai-compatible.ts`):**
   - Configurable `baseURL`, `apiKey`, and `modelId`.
   - Operates identically with **xAI Grok** (`https://api.x.ai/v1`, model `grok-2-mini`), **GroqCloud** (`https://api.groq.com/openai/v1`, model `llama-3.3-70b-versatile`), and self-hosted/local vLLM/Ollama in test environments.
3. **Provider Registry & Task-Based Router:**
   - Maintains a capability matrix (streaming, tool calling, JSON schema, context length, RPM/TPM limits, cost per token).
   - Routes simple intent extraction to small fast models, and complex dietary/group reasoning to larger models.
4. **Token Bucket Rate Governor & Key Pools:**
   - Manages token buckets per API key.
   - Rotates across multiple keys based on health and remaining quota.
   - Priority queues ensure realtime interactive voice turns preempt background or evaluation tasks.
5. **Circuit Breakers & Automatic Failover:**
   - 3 consecutive 429 or 5xx provider failures trip the circuit breaker.
   - Automatically falls back from primary provider (e.g. xAI Grok) to secondary provider (e.g. Groq Llama) within 50ms without user-visible errors.
6. **Zero External Dependency in CI:**
   - A high-fidelity `MockLLMProvider` and `MockSpeechProvider` with recorded fixtures run in unit, integration, and CI tests. Work is never blocked by external provider keys or internet connectivity.

## Consequences
- **Positive:** Complete vendor neutrality; switching providers requires zero code changes (config only); automated protection against rate-limit crashes and provider downtime; zero CI costs.
- **Negative:** Normalizing tool call syntax and streaming chunks across providers requires careful adapter maintenance and conformance tests.
