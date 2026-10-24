export type SupportedLanguage = 'en' | 'hi' | 'hinglish';

export interface TranscriptEvent {
  readonly text: string;
  readonly isFinal: boolean;
  readonly confidence: number;
  readonly detectedLanguage?: SupportedLanguage;
  readonly durationMs?: number;
}

export interface STTOptions {
  readonly language?: SupportedLanguage;
  readonly sampleRateHertz?: number; // default 16000
  readonly encoding?: 'LINEAR16' | 'OPUS';
  readonly endpointingMs?: number; // silence threshold to declare turn complete (e.g. 400ms)
}

export interface SpeechToTextProvider {
  readonly providerName: string;

  /**
   * Transcribes incoming binary audio frames into streaming partial and final transcripts.
   */
  transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    options?: STTOptions,
  ): AsyncIterable<TranscriptEvent>;
}
