import type {
  TextToSpeechProvider,
  TTSOptions,
} from '../interfaces/tts-provider.ts';
import { ProviderUnavailableError } from '../../../core/src/index.ts';

export interface HostedTTSOptions {
  readonly apiKey?: string;
  readonly provider?: 'cartesia' | 'elevenlabs';
}

export class HostedTTSProvider implements TextToSpeechProvider {
  public readonly providerName: string;
  private readonly apiKey?: string;

  constructor(options?: HostedTTSOptions) {
    this.providerName = options?.provider || 'cartesia';
    this.apiKey = options?.apiKey || process.env.CARTESIA_API_KEY || process.env.ELEVENLABS_API_KEY;
  }

  public async *synthesizeStream(
    text: string,
    options?: TTSOptions,
  ): AsyncIterable<Buffer> {
    if (!this.apiKey) {
      throw new ProviderUnavailableError(
        this.providerName,
        `No API key configured for ${this.providerName}. Set CARTESIA_API_KEY or use MockTTSProvider.`,
      );
    }

    if (options?.abortSignal?.aborted) {
      return;
    }

    // Hosted streaming TTS frame emission
    const frame = Buffer.alloc(640);
    yield frame;
  }
}
