/**
 * @vca/web-sdk
 * Headless client, AudioWorklet PCM streaming capture, React/Vanilla UI components.
 */

export const WEB_SDK_VERSION = '1.0.0';

export {
  VoiceClient,
  type VoiceClientState,
  type VoiceClientEvents,
  type ProposalPayload,
} from './client/voice-client.ts';

export { AudioRecorder } from './audio/audio-recorder.ts';
