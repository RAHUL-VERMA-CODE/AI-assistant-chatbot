import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from './factory.ts';
import { stripReasoningBlocks } from './adapters/openai-compatible-adapter.ts';

describe('Unified LLM Architecture (Generic Factory & Adapters)', () => {
  it('creates a Mock provider when requested', async () => {
    const provider = createLLMProvider({ provider: 'mock' });
    assert.equal(provider.providerName, 'mock');

    const res = await provider.chat([{ role: 'user', content: 'hello' }]);
    assert.ok(res.text);
    assert.equal(res.model, 'mock-conversational-v1');
  });

  it('creates a generic Groq provider instance with correct model and endpoint', () => {
    const provider = createLLMProvider({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_test_key_dummy',
    });
    assert.equal(provider.providerName, 'groq');
    assert.equal(provider.modelId, 'llama-3.3-70b-versatile');
  });

  it('creates an xAI Grok provider instance with one parameter change', () => {
    const provider = createLLMProvider({
      provider: 'xai',
      model: 'grok-2-mini',
      apiKey: 'xai_test_key_dummy',
    });
    assert.equal(provider.providerName, 'xai');
    assert.equal(provider.modelId, 'grok-2-mini');
  });

  it('creates a Gemini provider instance with one parameter change', () => {
    const provider = createLLMProvider({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey: 'gemini_test_key_dummy',
    });
    assert.equal(provider.providerName, 'gemini');
    assert.equal(provider.modelId, 'gemini-2.0-flash');
  });

  it('creates an OpenAI provider instance with one parameter change', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'openai_test_key_dummy',
    });
    assert.equal(provider.providerName, 'openai');
    assert.equal(provider.modelId, 'gpt-4o-mini');
  });

  it('strips <think>...</think> reasoning blocks cleanly', () => {
    const raw = '<think>\nI should recommend a medium pizza\n</think>One medium cheese burst pizza is INR 399.';
    const cleaned = stripReasoningBlocks(raw);
    assert.equal(cleaned, 'One medium cheese burst pizza is INR 399.');
  });

  it('streams responses chunk by chunk', async () => {
    const mock = createLLMProvider({ provider: 'mock' });
    const chunks: string[] = [];

    for await (const chunk of mock.streamChat([{ role: 'user', content: 'Ek cheese burst pizza' }])) {
      if (chunk.deltaText) {
        chunks.push(chunk.deltaText);
      }
    }

    assert.ok(chunks.length > 0);
    const joined = chunks.join('').trim();
    assert.equal(joined, 'One medium cheese burst pizza is INR 399. Add it?');
  });
});
