/**
 * Deterministic PII Scrubber
 * Scrubs sensitive user information before logging or sending to third-party AI APIs.
 */

const PHONE_REGEX = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PINCODE_REGEX = /\b[1-9][0-9]{2}\s?[0-9]{3}\b/g;
const TOKEN_REGEX = /(?:bearer\s+)?[a-zA-Z0-9_-]{20,}\b/gi;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

export class PiiScrubber {
  public static scrub(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let scrubbed = text;
    scrubbed = scrubbed.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
    scrubbed = scrubbed.replace(PHONE_REGEX, '[REDACTED_PHONE]');
    scrubbed = scrubbed.replace(CREDIT_CARD_REGEX, (match) => {
      // Avoid false positive on small number sequences
      const clean = match.replace(/[\s-]/g, '');
      return clean.length >= 13 && clean.length <= 19 ? '[REDACTED_PAYMENT]' : match;
    });
    return scrubbed;
  }

  public static scrubObject<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return PiiScrubber.scrub(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => PiiScrubber.scrubObject(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('authorization') ||
          lowerKey.includes('api_key') ||
          lowerKey.includes('apikey')
        ) {
          sanitized[key] = '[REDACTED_SECRET]';
        } else if (
          lowerKey.includes('phone') ||
          lowerKey.includes('mobile')
        ) {
          sanitized[key] = '[REDACTED_PHONE]';
        } else if (lowerKey.includes('email')) {
          sanitized[key] = '[REDACTED_EMAIL]';
        } else {
          sanitized[key] = PiiScrubber.scrubObject(val);
        }
      }
      return sanitized as T;
    }

    return obj;
  }
}
