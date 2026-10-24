import type { LLMProvider } from './interfaces/llm-provider.ts';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible-adapter.ts';
import { MockLLMProvider } from './adapters/mock-adapter.ts';
import { loadConfig } from '../../platform/src/config/env.ts';

export type SupportedProvider = 'groq' | 'xai' | 'openai' | 'gemini' | 'mock';

export interface CreateLLMProviderOptions {
  provider?: SupportedProvider;
  model?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

const PROVIDER_DEFAULTS: Record<
  SupportedProvider,
  { baseUrl: string; defaultModel: string; fastModel: string }
> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    fastModel: 'llama-3.1-8b-instant',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-mini',
    fastModel: 'grok-2-mini',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    fastModel: 'gpt-4o-mini',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    fastModel: 'gemini-2.0-flash',
  },
  mock: {
    baseUrl: 'mock://local',
    defaultModel: 'mock-conversational-v1',
    fastModel: 'mock-conversational-v1',
  },
};

/**
 * Single Unified LLM Factory
 * Change model and provider in ONE PLACE: via options or directly in .env.
 * The entire application runs seamlessly on any chosen model.
 */
export function createLLMProvider(options?: CreateLLMProviderOptions): LLMProvider {
  const config = loadConfig();

  const provider = (options?.provider || config.llm.provider || 'groq').toLowerCase() as SupportedProvider;

  if (provider === 'mock') {
    return new MockLLMProvider();
  }

  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.groq;
  const modelId = options?.model || config.llm.model || defaults.defaultModel;
  const apiBaseUrl = options?.apiBaseUrl || config.llm.apiBaseUrl || defaults.baseUrl;
  const apiKey = options?.apiKey || config.llm.apiKey;

  if (!apiKey && provider !== 'mock') {
    throw new Error(
      `Missing API Key for LLM provider '${provider}'. Please set LLM_API_KEY (or ${provider.toUpperCase()}_API_KEY) in .env.`,
    );
  }

  return new OpenAICompatibleAdapter({
    providerName: provider,
    modelId,
    apiBaseUrl,
    apiKey,
    timeoutMs: options?.timeoutMs || config.llm.timeoutMs,
  });
}
