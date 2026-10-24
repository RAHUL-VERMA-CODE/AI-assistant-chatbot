import type {
  LLMProvider,
  ChatMessage,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
} from '../interfaces/llm-provider.ts';

export class MockLLMProvider implements LLMProvider {
  public readonly providerName = 'mock';
  public readonly modelId = 'mock-conversational-v1';

  private cannedResponses: string[] = [];

  constructor(cannedResponses: string[] = []) {
    this.cannedResponses = cannedResponses;
  }

  public setCannedResponses(responses: string[]): void {
    this.cannedResponses = responses;
  }

  public async chat(messages: ChatMessage[], _options?: LLMRequestOptions): Promise<LLMResponse> {
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';

    let text = this.cannedResponses.shift() || 'Mock response';
    if (text === 'Mock response' && lastUserMessage.includes('cheese burst')) {
      text = 'One medium cheese burst pizza is INR 399. Add it?';
    }

    return {
      text,
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      model: this.modelId,
    };
  }

  public async *streamChat(messages: ChatMessage[], options?: LLMRequestOptions): AsyncIterable<LLMStreamChunk> {
    const full = await this.chat(messages, options);
    const words = full.text.split(' ');

    for (const word of words) {
      yield { deltaText: word + ' ', isDone: false };
    }
    yield { isDone: true };
  }

  public async extractStructured<T>(
    _messages: ChatMessage[],
    _schemaName: string,
    _schema: Record<string, unknown>,
    _options?: LLMRequestOptions,
  ): Promise<T> {
    return {
      intent: 'ADD_TO_CART',
      slots: { itemName: 'cheese burst pizza', size: 'medium', quantity: 1 },
    } as unknown as T;
  }
}
