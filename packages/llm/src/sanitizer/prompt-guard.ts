export interface PromptSanitizationResult {
  readonly sanitizedText: string;
  readonly injectionDetected: boolean;
  readonly detectedPatterns: readonly string[];
}

export class PromptGuard {
  private static readonly INJECTION_PATTERNS: readonly RegExp[] = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
    /disregard\s+(?:all\s+)?(?:previous|prior)\s+directions/i,
    /system\s*:\s*/i,
    /system\s+prompt\s*:/i,
    /you\s+are\s+now\s+(?:in\s+)?(?:developer|dan|jailbreak|unrestricted)\s+mode/i,
    /reveal\s+(?:the\s+|your\s+)?(?:system\s+prompt|instructions|secret)/i,
    /print\s+(?:the\s+)?system\s+instructions/i,
    /bypass\s+(?:all\s+)?(?:content\s+filters|safety\s+rules)/i,
  ];

  private static readonly DELIMITER_TAGS: readonly RegExp[] = [
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<\/SYS>/gi,
    /<system>/gi,
    /<\/system>/gi,
  ];

  /**
   * Sanitizes user utterance and customer inputs, neutralizing injection attempts and delimiter tokens.
   */
  public static sanitize(rawInput: string): PromptSanitizationResult {
    let text = rawInput;
    const detectedPatterns: string[] = [];
    let injectionDetected = false;

    // 1. Strip raw delimiter tags
    for (const tag of this.DELIMITER_TAGS) {
      if (tag.test(text)) {
        injectionDetected = true;
        detectedPatterns.push('DELIMITER_TAG');
        text = text.replace(tag, '');
      }
    }

    // 2. Detect and neutralize injection instructions
    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        injectionDetected = true;
        detectedPatterns.push(pattern.source);
        // Replace with inert text to preserve query length without executing instruction
        text = text.replace(pattern, '[neutralized]');
      }
    }

    return {
      sanitizedText: text.trim(),
      injectionDetected,
      detectedPatterns,
    };
  }
}
