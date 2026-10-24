import { ProviderRegistry } from '../../../llm/src/registry/provider-registry.ts';

export interface ModelBakeoffResult {
  readonly modelId: string;
  readonly providerName: string;
  readonly latencyTier: string;
  readonly ttftMsEstimated: number;
  readonly totalTurnMsEstimated: number;
  readonly costPer1kTurnsInr: number;
  readonly recommendation: string;
}

export class ModelBakeoff {
  public static runBakeoff(): ModelBakeoffResult[] {
    const results: ModelBakeoffResult[] = [];
    const models = ProviderRegistry.getAllModels();

    for (const meta of models) {
      // Calculate estimated cost for typical turn: 400 prompt tokens + 150 completion tokens
      const promptCostMinor = (400 * meta.costPerMillionInputTokensMinor) / 1000;
      const completionCostMinor = (150 * meta.costPerMillionOutputTokensMinor) / 1000;
      const costPerTurnMinor = promptCostMinor + completionCostMinor;
      const costPer1kTurnsInr = Math.round((costPerTurnMinor * 1000) / 100);

      let ttftMs = 800;
      let totalMs = 1500;
      let recommendation = 'General conversational use';

      if (meta.latencyTier === 'ULTRA_FAST') {
        ttftMs = 280;
        totalMs = 650;
        recommendation = 'PRIMARY: Best for Realtime Voice Streaming (<3s budget)';
      } else if (meta.latencyTier === 'FAST') {
        ttftMs = 500;
        totalMs = 1100;
        recommendation = 'BACKUP: Excellent for complex reasoning and fallback';
      }

      results.push({
        modelId: meta.modelId,
        providerName: meta.provider,
        latencyTier: meta.latencyTier,
        ttftMsEstimated: ttftMs,
        totalTurnMsEstimated: totalMs,
        costPer1kTurnsInr,
        recommendation,
      });
    }

    return results;
  }

  public static formatMarkdownTable(results: readonly ModelBakeoffResult[]): string {
    const rows = [
      '| Provider | Model ID | Latency Tier | Est. TTFT | Est. Turn Duration | Cost / 1k Turns | Recommendation |',
      '| :--- | :--- | :---: | :---: | :---: | :---: | :--- |',
    ];

    for (const r of results) {
      rows.push(
        `| ${r.providerName} | \`${r.modelId}\` | ${r.latencyTier} | ${r.ttftMsEstimated}ms | ${r.totalTurnMsEstimated}ms | INR ${r.costPer1kTurnsInr} | ${r.recommendation} |`,
      );
    }

    return rows.join('\n');
  }
}
