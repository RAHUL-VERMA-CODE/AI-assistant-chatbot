export type LatencyTier = 'ULTRA_FAST' | 'FAST' | 'STANDARD';

export interface ModelMetadata {
  readonly provider: string;
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsJsonMode: boolean;
  readonly latencyTier: LatencyTier;
  readonly costPerMillionInputTokensMinor: number; // e.g. INR minor units or USD minor cents
  readonly costPerMillionOutputTokensMinor: number;
}

export class ProviderRegistry {
  private static readonly models: ModelMetadata[] = [
    // Groq Models (Ultra-low latency inference)
    {
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'FAST',
      costPerMillionInputTokensMinor: 59, // ~$0.59
      costPerMillionOutputTokensMinor: 79,
    },
    {
      provider: 'groq',
      modelId: 'llama-3.1-8b-instant',
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'ULTRA_FAST',
      costPerMillionInputTokensMinor: 5, // ~$0.05
      costPerMillionOutputTokensMinor: 8,
    },
    {
      provider: 'groq',
      modelId: 'mixtral-8x7b-32768',
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'FAST',
      costPerMillionInputTokensMinor: 24,
      costPerMillionOutputTokensMinor: 24,
    },

    // xAI Grok Models
    {
      provider: 'xai',
      modelId: 'grok-2-1212',
      contextWindowTokens: 131_072,
      maxOutputTokens: 4_096,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'STANDARD',
      costPerMillionInputTokensMinor: 200,
      costPerMillionOutputTokensMinor: 1000,
    },
    {
      provider: 'xai',
      modelId: 'grok-beta',
      contextWindowTokens: 131_072,
      maxOutputTokens: 4_096,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'FAST',
      costPerMillionInputTokensMinor: 500,
      costPerMillionOutputTokensMinor: 1500,
    },

    // OpenAI Models
    {
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'FAST',
      costPerMillionInputTokensMinor: 15,
      costPerMillionOutputTokensMinor: 60,
    },
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'STANDARD',
      costPerMillionInputTokensMinor: 250,
      costPerMillionOutputTokensMinor: 1000,
    },

    // Google Gemini Models
    {
      provider: 'gemini',
      modelId: 'gemini-1.5-flash',
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonMode: true,
      latencyTier: 'FAST',
      costPerMillionInputTokensMinor: 7,
      costPerMillionOutputTokensMinor: 30,
    },
  ];

  public static getModel(provider: string, modelId: string): ModelMetadata | undefined {
    const prov = provider.toLowerCase();
    const model = modelId.toLowerCase();
    return this.models.find(
      (m) => m.provider.toLowerCase() === prov && m.modelId.toLowerCase() === model,
    );
  }

  public static getAllModels(): readonly ModelMetadata[] {
    return this.models;
  }

  public static getFastestModel(provider: string): ModelMetadata | undefined {
    const prov = provider.toLowerCase();
    const providerModels = this.models.filter((m) => m.provider.toLowerCase() === prov);
    return (
      providerModels.find((m) => m.latencyTier === 'ULTRA_FAST') ||
      providerModels.find((m) => m.latencyTier === 'FAST') ||
      providerModels[0]
    );
  }
}
