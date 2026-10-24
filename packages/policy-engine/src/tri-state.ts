/**
 * Tri-state boolean logic (Kleene 3-valued logic).
 * Critical for food safety: UNKNOWN can NEVER be treated as TRUE or safe.
 */

export type TriStateBool = 'TRUE' | 'FALSE' | 'UNKNOWN';

export class TriState {
  /**
   * Logical AND in Kleene 3-valued logic:
   * FALSE and anything = FALSE
   * TRUE and TRUE = TRUE
   * TRUE and UNKNOWN = UNKNOWN
   * UNKNOWN and UNKNOWN = UNKNOWN
   */
  public static and(a: TriStateBool, b: TriStateBool): TriStateBool {
    if (a === 'FALSE' || b === 'FALSE') return 'FALSE';
    if (a === 'UNKNOWN' || b === 'UNKNOWN') return 'UNKNOWN';
    return 'TRUE';
  }

  /**
   * Logical OR in Kleene 3-valued logic:
   * TRUE or anything = TRUE
   * FALSE or FALSE = FALSE
   * FALSE or UNKNOWN = UNKNOWN
   * UNKNOWN and UNKNOWN = UNKNOWN
   */
  public static or(a: TriStateBool, b: TriStateBool): TriStateBool {
    if (a === 'TRUE' || b === 'TRUE') return 'TRUE';
    if (a === 'UNKNOWN' || b === 'UNKNOWN') return 'UNKNOWN';
    return 'FALSE';
  }

  /**
   * Logical NOT in Kleene logic:
   * TRUE -> FALSE
   * FALSE -> TRUE
   * UNKNOWN -> UNKNOWN
   */
  public static not(a: TriStateBool): TriStateBool {
    if (a === 'TRUE') return 'FALSE';
    if (a === 'FALSE') return 'TRUE';
    return 'UNKNOWN';
  }

  public static isDefiniteTrue(a: TriStateBool): boolean {
    return a === 'TRUE';
  }

  public static isDefiniteFalse(a: TriStateBool): boolean {
    return a === 'FALSE';
  }

  public static isUnknown(a: TriStateBool): boolean {
    return a === 'UNKNOWN';
  }

  /**
   * Evaluates if a constraint is guaranteed safe.
   * Safety rule: Only definite 'TRUE' is safe. 'UNKNOWN' must be treated as unsafe/unverified.
   */
  public static evaluateSafety(
    value: TriStateBool,
    claimName: string,
  ): { safe: boolean; limitation?: string } {
    if (value === 'TRUE') {
      return { safe: true };
    }
    if (value === 'FALSE') {
      return {
        safe: false,
        limitation: `Item is explicitly not ${claimName}.`,
      };
    }
    return {
      safe: false,
      limitation: `Restaurant has not certified ${claimName} for this recipe (unknown/unverified cross-contact).`,
    };
  }
}
