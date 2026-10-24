export class ToolRepair {
  /**
   * Safely parses and repairs common LLM JSON syntax errors in tool call arguments.
   */
  public static parseAndRepair(rawArgs: unknown): Record<string, unknown> {
    if (typeof rawArgs === 'object' && rawArgs !== null) {
      return rawArgs as Record<string, unknown>;
    }

    if (typeof rawArgs !== 'string') {
      return {};
    }

    let text = rawArgs.trim();

    // 1. Strip markdown code fence if present
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    // Try standard JSON parse first
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      // Proceed to single-turn deterministic repair
    }

    // 2. Strip trailing comma at end of string
    let repaired = text.replace(/,\s*$/g, '');

    // 3. Repair unescaped newlines inside string literals
    repaired = repaired.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');

    // 4. Repair missing closing brace
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += '}'.repeat(openBraces - closeBraces);
    }

    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/]/g) || []).length;
    if (openBrackets > closeBrackets) {
      repaired += ']'.repeat(openBrackets - closeBrackets);
    }

    // 5. Clean up any remaining trailing commas before closing braces/brackets
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(repaired);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // If still invalid, throw structured error
      throw new Error(`Failed to parse or repair malformed tool arguments: ${text}`);
    }

    return {};
  }
}
