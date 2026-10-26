export interface NormalizedTurn {
  readonly originalText: string;
  readonly normalizedText: string;
  readonly extractedQuantities: readonly number[];
  readonly isConfirmation: boolean;
  readonly isCancellation: boolean;
  readonly isReorderRequest: boolean;
  readonly isStatusRequest: boolean;
}

export class HinglishNormalizer {
  private static readonly HINDI_NUMBERS: Record<string, number> = {
    ek: 1,
    aik: 1,
    one: 1,
    do: 2,
    two: 2,
    teen: 3,
    tin: 3,
    three: 3,
    chaar: 4,
    char: 4,
    four: 4,
    paanch: 5,
    panch: 5,
    five: 5,
    chhe: 6,
    che: 6,
    six: 6,
    saat: 7,
    sat: 7,
    seven: 7,
    aath: 8,
    ath: 8,
    eight: 8,
    nau: 9,
    no: 9,
    nine: 9,
    das: 10,
    dus: 10,
    ten: 10,
  };

  private static readonly CONFIRM_PATTERNS: readonly RegExp[] = [
    /^(?:haan|ha|haa|yes|yep|yup|sure|ok|okay|confirm|chalega|theek hai|thik hai|sahi hai|confirm order|proceed|pakka|bilkul|add it|yes please)$/i,
    /\b(?:order confirm|confirm order|confirm karo|confirm kar do|haan confirm|yes confirm)\b/i,
  ];

  private static readonly CANCEL_PATTERNS: readonly RegExp[] = [
    /\b(?:nahi|nahin|no|cancel|rehne do|mat karo|hatao|remove|chhod do|abort|stop)\b/i,
  ];

  private static readonly REORDER_PATTERNS: readonly RegExp[] = [
    /\b(?:same as last time|repeat previous order|repeat last order|pichla order|wahi repeat|same order)\b/i,
  ];

  private static readonly STATUS_PATTERNS: readonly RegExp[] = [
    /\b(?:order status|track order|where is my order|order kaha hai|kaha tak pahuncha|delivery status)\b/i,
  ];

  public static normalize(text: string): NormalizedTurn {
    const originalText = text.trim();
    let lower = originalText.toLowerCase();

    // 1. Detect Intent Flags
    const isConfirmation = this.CONFIRM_PATTERNS.some((p) => p.test(lower));
    const isCancellation = this.CANCEL_PATTERNS.some((p) => p.test(lower));
    const isReorderRequest = this.REORDER_PATTERNS.some((p) => p.test(lower));
    const isStatusRequest = this.STATUS_PATTERNS.some((p) => p.test(lower));

    // 2. Extract Numbers
    const words = lower.split(/\s+/);
    const extractedQuantities: number[] = [];

    for (const w of words) {
      if (this.HINDI_NUMBERS[w] !== undefined) {
        extractedQuantities.push(this.HINDI_NUMBERS[w]);
      } else {
        const num = parseInt(w, 10);
        if (!isNaN(num) && num > 0 && num <= 100) {
          extractedQuantities.push(num);
        }
      }
    }

    // 3. Normalize common synonyms
    lower = lower
      .replace(/\bek\b/g, '1')
      .replace(/\bdo\b/g, '2')
      .replace(/\bteen\b/g, '3')
      .replace(/\bchaar\b/g, '4')
      .replace(/\bpaanch\b/g, '5')
      .replace(/\bpyaaz\b/g, 'onion')
      .replace(/\blehsun\b/g, 'garlic')
      .replace(/\baloo\b/g, 'potato');

    return {
      originalText,
      normalizedText: lower,
      extractedQuantities,
      isConfirmation,
      isCancellation,
      isReorderRequest,
      isStatusRequest,
    };
  }
}
