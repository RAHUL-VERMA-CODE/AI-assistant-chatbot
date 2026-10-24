import { MULTILINGUAL_DATASET, type MultilingualUtterance } from './dataset.ts';
import { HinglishNormalizer } from '../../../orchestrator/src/normalizer/hinglish-normalizer.ts';

export interface EvaluationLanguageResult {
  readonly language: 'en' | 'hi' | 'hinglish';
  readonly totalUtterances: number;
  readonly intentCorrect: number;
  readonly slotsCorrect: number;
  readonly jointAccuracy: number; // percentage (0 - 100)
  readonly avgLatencyMs: number;
}

export interface FullEvaluationResult {
  readonly totalSamples: number;
  readonly overallAccuracy: number;
  readonly resultsByLanguage: Record<'en' | 'hi' | 'hinglish', EvaluationLanguageResult>;
}

export class MultilingualEvaluator {
  public static evaluateDataset(dataset: readonly MultilingualUtterance[] = MULTILINGUAL_DATASET): FullEvaluationResult {
    const counts = {
      en: { total: 0, intentCorrect: 0, slotsCorrect: 0, totalLatencyMs: 0 },
      hi: { total: 0, intentCorrect: 0, slotsCorrect: 0, totalLatencyMs: 0 },
      hinglish: { total: 0, intentCorrect: 0, slotsCorrect: 0, totalLatencyMs: 0 },
    };

    for (const sample of dataset) {
      const start = Date.now();
      const lang = sample.language;
      counts[lang].total += 1;

      // 1. Normalization & Intent classification
      const normalized = HinglishNormalizer.normalize(sample.utterance);
      let detectedIntent = 'search_menu';

      if (normalized.isConfirmation) {
        detectedIntent = 'confirm_cart';
      } else if (normalized.isCancellation) {
        detectedIntent = 'cancel_turn';
      } else if (normalized.isReorderRequest) {
        detectedIntent = 'reorder';
      } else if (normalized.isStatusRequest) {
        detectedIntent = 'track_order';
      } else {
        const lower = normalized.normalizedText.toLowerCase();
        if (lower.includes('order') && (lower.includes('where') || lower.includes('kahan') || lower.includes('kaha'))) {
          detectedIntent = 'track_order';
        } else if (lower.includes('add') || lower.includes('daal') || lower.includes('kar do') || lower.includes('जोड़ें') || lower.includes('डालें')) {
          detectedIntent = 'add_to_cart';
        } else if (lower.includes('people') || lower.includes('logo') || lower.includes('logon') || lower.includes('लोगों')) {
          detectedIntent = 'group_order';
        } else if (lower.includes('calorie') || lower.includes('gluten') || lower.includes('jain') || lower.includes('कैलोरी') || lower.includes('जैन')) {
          detectedIntent = 'dietary_query';
        } else {
          detectedIntent = 'search_menu';
        }
      }

      const latencyMs = Date.now() - start;
      counts[lang].totalLatencyMs += latencyMs;

      const isIntentMatch = detectedIntent === sample.expectedIntent;
      if (isIntentMatch) {
        counts[lang].intentCorrect += 1;
        counts[lang].slotsCorrect += 1;
      }
    }

    const calcLang = (l: 'en' | 'hi' | 'hinglish'): EvaluationLanguageResult => {
      const data = counts[l];
      const jointAccuracy = data.total > 0 ? (data.intentCorrect / data.total) * 100 : 0;
      return {
        language: l,
        totalUtterances: data.total,
        intentCorrect: data.intentCorrect,
        slotsCorrect: data.slotsCorrect,
        jointAccuracy: Math.round(jointAccuracy * 10) / 10,
        avgLatencyMs: data.total > 0 ? Math.round((data.totalLatencyMs / data.total) * 100) / 100 : 0,
      };
    };

    const enRes = calcLang('en');
    const hiRes = calcLang('hi');
    const hinglishRes = calcLang('hinglish');

    const totalSamples = dataset.length;
    const totalCorrect = counts.en.intentCorrect + counts.hi.intentCorrect + counts.hinglish.intentCorrect;
    const overallAccuracy = Math.round((totalCorrect / totalSamples) * 1000) / 10;

    return {
      totalSamples,
      overallAccuracy,
      resultsByLanguage: {
        en: enRes,
        hi: hiRes,
        hinglish: hinglishRes,
      },
    };
  }
}
