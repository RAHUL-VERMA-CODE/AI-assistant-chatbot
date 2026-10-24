export class SentenceChunker {
  private buffer = '';
  private readonly minWordsForClause: number;

  constructor(minWordsForClause = 4) {
    this.minWordsForClause = minWordsForClause;
  }

  /**
   * Appends incoming text delta from LLM stream and yields complete sentences or clauses.
   */
  public push(token: string): string[] {
    this.buffer += token;
    const readyChunks: string[] = [];

    while (true) {
      // 1. Look for hard sentence boundaries: '.', '?', '!', '\n'
      const sentenceEndMatch = this.buffer.match(/^([\s\S]*?[.?!।\n]+)(?:\s+|$)([\s\S]*)$/);
      if (sentenceEndMatch) {
        const sentence = sentenceEndMatch[1]!.trim();
        this.buffer = sentenceEndMatch[2] || '';
        if (sentence.length > 0) {
          readyChunks.push(sentence);
        }
        continue;
      }

      // 2. Look for soft clause boundaries (',', ';', ':') only if minimum word count reached
      const words = this.buffer.trim().split(/\s+/);
      if (words.length >= this.minWordsForClause) {
        const clauseMatch = this.buffer.match(/^([\s\S]*?[,;:])(?:\s+)([\s\S]*)$/);
        if (clauseMatch) {
          const clause = clauseMatch[1]!.trim();
          this.buffer = clauseMatch[2] || '';
          if (clause.length > 0) {
            readyChunks.push(clause);
          }
          continue;
        }
      }

      break;
    }

    return readyChunks;
  }

  /**
   * Flushes whatever remains in the buffer when the LLM stream terminates.
   */
  public flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }
}
