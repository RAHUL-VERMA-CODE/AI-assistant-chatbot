import type {
  SpeechToTextProvider,
  TranscriptEvent,
  STTOptions,
} from '../interfaces/stt-provider.ts';
import type {
  TextToSpeechProvider,
  TTSOptions,
} from '../interfaces/tts-provider.ts';

export class MockSTTProvider implements SpeechToTextProvider {
  public readonly providerName = 'MockSTT';
  private defaultTranscript: string;

  constructor(defaultTranscript = 'Ek cheese burst pizza add kar do') {
    this.defaultTranscript = defaultTranscript;
  }

  public setDefaultTranscript(transcript: string): void {
    this.defaultTranscript = transcript;
  }

  public async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    _options?: STTOptions,
  ): AsyncIterable<TranscriptEvent> {
    let frameCount = 0;
    // Consume incoming audio frames
    for await (const _frame of audioStream) {
      frameCount++;
      if (frameCount === 1) {
        // Emit partial transcript
        const words = this.defaultTranscript.split(' ');
        const partial = words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(' ');
        yield {
          text: partial,
          isFinal: false,
          confidence: 0.85,
          detectedLanguage: 'hinglish',
        };
      }
    }

    // Emit final transcript
    yield {
      text: this.defaultTranscript,
      isFinal: true,
      confidence: 0.98,
      detectedLanguage: 'hinglish',
      durationMs: frameCount * 20,
    };
  }
}

export class MockTTSProvider implements TextToSpeechProvider {
  public readonly providerName = 'MockTTS';

  public async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncIterable<Buffer> {
    const words = text.trim().split(/\s+/).length;
    // Estimate audio duration: ~150 words per minute => ~400ms per word
    const totalDurationMs = Math.max(200, words * 300);
    const frameDurationMs = 20; // 20ms PCM frame
    const totalFrames = Math.ceil(totalDurationMs / frameDurationMs);

    // 16kHz 16-bit mono PCM: 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
    // 20ms frame = 32000 * 0.02 = 640 bytes per frame
    const frameSize = 640;

    for (let f = 0; f < totalFrames; f++) {
      if (options?.abortSignal?.aborted) {
        break; // Cancelled by user interruption!
      }

      // Generate 20ms PCM audio buffer (sine wave tone / comfort noise)
      const frameBuffer = Buffer.alloc(frameSize);
      for (let i = 0; i < frameSize / 2; i++) {
        // Simple synthetic 440Hz tone
        const sample = Math.sin((2 * Math.PI * 440 * (f * 320 + i)) / 16000) * 10000;
        frameBuffer.writeInt16LE(Math.floor(sample), i * 2);
      }

      yield frameBuffer;
    }
  }
}
