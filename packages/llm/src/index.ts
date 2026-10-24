/**
 * @vca/llm
 * Unified, Model-Agnostic LLM Layer (Groq, xAI Grok, OpenAI, Gemini, Mock).
 */

export * from './interfaces/llm-provider.ts';
export * from './adapters/openai-compatible-adapter.ts';
export * from './adapters/mock-adapter.ts';
export * from './factory.ts';
export * from './registry/provider-registry.ts';
export * from './router/task-router.ts';
export * from './governor/rate-governor.ts';
export * from './sanitizer/tool-repair.ts';
export * from './sanitizer/prompt-guard.ts';

export const LLM_VERSION = '1.0.0';
