/**
 * @vca/llm
 * Unified, Model-Agnostic LLM Layer (Groq, xAI Grok, OpenAI, Gemini, Mock).
 */

export * from './interfaces/llm-provider.ts';
export * from './adapters/openai-compatible-adapter.ts';
export * from './adapters/mock-adapter.ts';
export * from './factory.ts';

export const LLM_VERSION = '1.0.0';
