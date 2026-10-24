import type {
  LLMProvider,
  ChatMessage,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
  ToolCall,
} from '../interfaces/llm-provider.ts';
import { ProviderUnavailableError, ValidationError } from '../../../core/src/index.ts';

export interface OpenAICompatibleConfig {
  readonly providerName: string;
  readonly modelId: string;
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

export class OpenAICompatibleAdapter implements LLMProvider {
  public readonly providerName: string;
  public readonly modelId: string;
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.providerName = config.providerName;
    this.modelId = config.modelId;
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs || 8000;
  }

  public async chat(messages: ChatMessage[], options?: LLMRequestOptions): Promise<LLMResponse> {
    const url = `${this.apiBaseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 350,
      stream: false,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = options?.abortSignal
      ? anySignal([controller.signal, options.abortSignal])
      : controller.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new ProviderUnavailableError(this.providerName, `HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      const choice = data.choices?.[0]?.message;
      const rawText = choice?.content || '';
      const scrubbedText = stripReasoningBlocks(rawText);

      const toolCalls: ToolCall[] = (choice?.tool_calls || []).map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          parsedArgs = { raw: tc.function.arguments };
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
        };
      });

      return {
        text: scrubbedText,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        model: this.modelId,
      };
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw err;
      }
      throw new ProviderUnavailableError(this.providerName, String(err));
    } finally {
      clearTimeout(timeout);
    }
  }

  public async *streamChat(messages: ChatMessage[], options?: LLMRequestOptions): AsyncIterable<LLMStreamChunk> {
    const url = `${this.apiBaseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 350,
      stream: true,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.abortSignal,
    });

    if (!response.ok || !response.body) {
      const err = await response.text().catch(() => 'Stream failed');
      throw new ProviderUnavailableError(this.providerName, `HTTP ${response.status}: ${err}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') {
            yield { isDone: true };
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                yield { deltaText: delta, isDone: false };
              }
            } catch {
              // Ignore partial JSON chunks in stream
            }
          }
        }
      }
      yield { isDone: true };
    } finally {
      reader.releaseLock();
    }
  }

  public async extractStructured<T>(
    messages: ChatMessage[],
    schemaName: string,
    schema: Record<string, unknown>,
    options?: LLMRequestOptions,
  ): Promise<T> {
    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `You are a strict JSON data extraction engine. You must output a JSON object adhering to the '${schemaName}' schema. Output pure JSON only. Do not wrap in markdown or backticks.\nSchema: ${JSON.stringify(schema)}`,
    };

    const response = await this.chat([systemPrompt, ...messages], {
      ...options,
      temperature: 0.0,
    });

    const cleaned = response.text.replace(/^```json/m, '').replace(/```$/m, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new ValidationError(`Failed to parse structured JSON from ${this.providerName}: ${cleaned}`);
    }
  }
}

/**
 * Strips reasoning blocks (<think>...</think>) before speech synthesis or response delivery.
 */
export function stripReasoningBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
