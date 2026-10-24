import { ProviderRegistry } from '../registry/provider-registry.ts';

export type TaskType =
  | 'INTENT_CLASSIFICATION'
  | 'MENU_SEARCH_EXPANSION'
  | 'CONVERSATION_TURN'
  | 'COMPLEX_DIET_REASONING';

export interface RouteDecision {
  readonly provider: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly isFastTier: boolean;
}

export class TaskRouter {
  private readonly defaultProvider: string;
  private readonly primaryModel: string;
  private readonly fastModel?: string;

  constructor(options: {
    defaultProvider: string;
    primaryModel: string;
    fastModel?: string;
  }) {
    this.defaultProvider = options.defaultProvider;
    this.primaryModel = options.primaryModel;
    this.fastModel = options.fastModel;
  }

  public route(taskType: TaskType): RouteDecision {
    const fastest =
      this.fastModel ||
      ProviderRegistry.getFastestModel(this.defaultProvider)?.modelId ||
      this.primaryModel;

    switch (taskType) {
      case 'INTENT_CLASSIFICATION':
      case 'MENU_SEARCH_EXPANSION':
        return {
          provider: this.defaultProvider,
          modelId: fastest,
          maxTokens: 256,
          temperature: 0.0, // Zero temperature for deterministic intent extraction
          isFastTier: true,
        };

      case 'CONVERSATION_TURN':
        return {
          provider: this.defaultProvider,
          modelId: this.primaryModel,
          maxTokens: 512,
          temperature: 0.1, // Near-zero for factual grounded responses
          isFastTier: false,
        };

      case 'COMPLEX_DIET_REASONING':
        return {
          provider: this.defaultProvider,
          modelId: this.primaryModel,
          maxTokens: 1024,
          temperature: 0.0,
          isFastTier: false,
        };
    }
  }
}
