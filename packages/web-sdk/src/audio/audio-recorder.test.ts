import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRecorder } from './audio-recorder.ts';

describe('AudioRecorder Downsampler', () => {
  it('converts 16kHz Float32Array to 16kHz Int16Array directly with clamping', () => {
    const input = new Float32Array([0.0, 1.0, -1.0, 0.5, -0.5, 2.0, -2.5]);
    const output = AudioRecorder.downsampleTo16kPCM(input, 16000);

    assert.equal(output.length, input.length);
    assert.equal(output[0], 0);
    assert.equal(output[1], 0x7fff); // Clamped max
    assert.equal(output[2], -0x8000); // Clamped min
    assert.equal(Math.round(output[3]!), Math.round(0.5 * 0x7fff));
    assert.equal(Math.round(output[4]!), Math.round(-0.5 * 0x8000));
    assert.equal(output[5], 0x7fff); // Clamped max
    assert.equal(output[6], -0x8000); // Clamped min
  });

  it('downsamples from 48kHz to 16kHz (3:1 ratio)', () => {
    // 4800 samples at 48kHz is 100ms
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) {
      // 100Hz sine wave
      input[i] = Math.sin((2 * Math.PI * 100 * i) / 48000);
    }

    const output = AudioRecorder.downsampleTo16kPCM(input, 48000);
    assert.equal(output.length, 1600); // exactly 1600 samples at 16kHz
    assert.equal(output instanceof Int16Array, true);
    // Non-zero values generated
    assert.ok(output.some(sample => sample !== 0));
  });

  it('downsamples from 44.1kHz to 16kHz', () => {
    // 4410 samples at 44.1kHz is 100ms
    const input = new Float32Array(4410);
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.8;
    }

    const output = AudioRecorder.downsampleTo16kPCM(input, 44100);
    // 4410 / (44100/16000) = 1600
    assert.equal(output.length, 1600);
    for (let i = 0; i < output.length; i++) {
      assert.equal(output[i], Math.round(0.8 * 0x7fff));
    }
  });
});
