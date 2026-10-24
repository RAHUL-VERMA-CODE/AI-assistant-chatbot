import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockSTTProvider, MockTTSProvider } from './mock-speech-adapter.ts';

describe('MockSpeechAdapters (Deterministic Offline Testing)', () => {
  it('transcribes incoming audio stream into partial and final transcripts', async () => {
    const stt = new MockSTTProvider('Ek paneer tikka add karo');

    async function* frameGen() {
      yield Buffer.alloc(640);
      yield Buffer.alloc(640);
      yield Buffer.alloc(640);
    }

    const events = [];
    for await (const ev of stt.transcribeStream(frameGen())) {
      events.push(ev);
    }

    assert.ok(events.length >= 2);
    assert.equal(events[0]!.isFinal, false); // partial
    assert.equal(events[events.length - 1]!.isFinal, true); // final
    assert.equal(events[events.length - 1]!.text, 'Ek paneer tikka add karo');
  });

  it('synthesizes text into 16kHz linear PCM audio frames', async () => {
    const tts = new MockTTSProvider();
    const frames: Buffer[] = [];

    for await (const frame of tts.synthesizeStream('One Cheese Burst Pizza')) {
      frames.push(frame);
    }

    assert.ok(frames.length > 0);
    assert.equal(frames[0]!.length, 640); // 20ms 16kHz 16-bit PCM frame
  });

  it('respects abort signal and terminates audio emission immediately', async () => {
    const tts = new MockTTSProvider();
    const controller = new AbortController();

    const frames: Buffer[] = [];
    let frameCount = 0;

    for await (const frame of tts.synthesizeStream('A very long order confirmation with multiple sentences and paragraphs', {
      abortSignal: controller.signal,
    })) {
      frames.push(frame);
      frameCount++;
      if (frameCount === 2) {
        controller.abort(); // User interrupted!
      }
    }

    assert.equal(frames.length, 2);
  });
});
