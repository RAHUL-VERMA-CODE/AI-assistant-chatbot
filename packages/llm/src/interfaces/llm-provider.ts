/**
 * Unified LLM Provider Interface
 * Model-agnostic port: Any LLM (Groq, xAI Grok, OpenAI, Gemini) implements this interface.
 */

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly name?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface LLMRequestOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ToolDefinition[];
  readonly abortSignal?: AbortSignal;
}

export interface LLMResponse {
  readonly text: string;
  readonly toolCalls?: ToolCall[];
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly model: string;
}

export interface LLMStreamChunk {
  readonly deltaText?: string;
  readonly toolCallDelta?: Partial<ToolCall>;
  readonly isDone: boolean;
}

export interface LLMProvider {
  readonly providerName: string;
  readonly modelId: string;

  chat(messages: ChatMessage[], options?: LLMRequestOptions): Promise<LLMResponse>;
  streamChat(messages: ChatMessage[], options?: LLMRequestOptions): AsyncIterable<LLMStreamChunk>;
  extractStructured<T>(messages: ChatMessage[], schemaName: string, schema: Record<string, unknown>, options?: LLMRequestOptions): Promise<T>;
}
