/**
 * @vca/speech
 * Streaming STT and TTS interfaces, mock audio adapters, sentence chunking.
 */

export * from './interfaces/stt-provider.ts';
export * from './interfaces/tts-provider.ts';
export * from './chunking/sentence-chunker.ts';
export * from './adapters/mock-speech-adapter.ts';
export * from './adapters/hosted-stt-adapter.ts';
export * from './adapters/hosted-tts-adapter.ts';

export const SPEECH_VERSION = '1.0.0';
