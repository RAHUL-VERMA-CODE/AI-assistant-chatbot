export class AudioRecorder {
  /**
   * Downsamples Float32Array from browser audio context to 16kHz mono linear PCM 16-bit buffer.
   */
  public static downsampleTo16kPCM(
    inputBuffer: Float32Array,
    inputSampleRate = 44100,
  ): Int16Array {
    if (inputSampleRate === 16000) {
      const output = new Int16Array(inputBuffer.length);
      for (let i = 0; i < inputBuffer.length; i++) {
        const s = Math.max(-1, Math.min(1, inputBuffer[i]!));
        output[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
      return output;
    }

    const ratio = inputSampleRate / 16000;
    const outputLength = Math.round(inputBuffer.length / ratio);
    const result = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const originalIndex = Math.floor(i * ratio);
      const s = Math.max(-1, Math.min(1, inputBuffer[originalIndex] || 0));
      result[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    return result;
  }
}
