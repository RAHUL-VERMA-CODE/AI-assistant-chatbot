export interface TTSOptions {
  readonly voiceId?: string;
  readonly sampleRateHertz?: number; // default 16000
  readonly speed?: number; // 0.8 - 1.2
  readonly abortSignal?: AbortSignal;
}

export interface TextToSpeechProvider {
  readonly providerName: string;

  /**
   * Synthesizes text into streaming 16kHz 16-bit linear PCM audio buffers.
   */
  synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncIterable<Buffer>;
}
