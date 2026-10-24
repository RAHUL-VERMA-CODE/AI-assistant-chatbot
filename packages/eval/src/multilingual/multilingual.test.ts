import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultilingualEvaluator } from './evaluator.ts';
import { ModelBakeoff } from '../bakeoff/model-bakeoff.ts';

describe('Multilingual Benchmark & Model Bake-Off (150 Utterances)', () => {
  it('evaluates 150 held-out utterances across EN, HI, and Hinglish with high accuracy', () => {
    const result = MultilingualEvaluator.evaluateDataset();

    assert.equal(result.totalSamples, 150);
    assert.equal(result.resultsByLanguage.en.totalUtterances, 50);
    assert.equal(result.resultsByLanguage.hi.totalUtterances, 50);
    assert.equal(result.resultsByLanguage.hinglish.totalUtterances, 50);

    // Accuracy gates: EN >= 90%, HI >= 85%, Hinglish >= 85%
    assert.ok(result.resultsByLanguage.en.jointAccuracy >= 90);
    assert.ok(result.resultsByLanguage.hi.jointAccuracy >= 85);
    assert.ok(result.resultsByLanguage.hinglish.jointAccuracy >= 85);
    assert.ok(result.overallAccuracy >= 85);
  });

  it('runs model bake-off and identifies optimal ultra-low latency model for voice streaming', () => {
    const bakeoffResults = ModelBakeoff.runBakeoff();
    assert.ok(bakeoffResults.length >= 3);

    const primaryRecommendation = bakeoffResults.find((r) => r.recommendation.startsWith('PRIMARY'));
    assert.ok(primaryRecommendation);
    assert.equal(primaryRecommendation.latencyTier, 'ULTRA_FAST');

    const table = ModelBakeoff.formatMarkdownTable(bakeoffResults);
    assert.ok(table.includes('| Provider | Model ID |'));
    assert.ok(table.includes('ULTRA_FAST'));
  });
});
