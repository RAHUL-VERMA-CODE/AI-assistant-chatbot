import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceChunker } from './sentence-chunker.ts';

describe('SentenceChunker (Early Clause Splitting for < 3s Voice Latency)', () => {
  it('splits text immediately on sentence boundary for early TTS playback', () => {
    const chunker = new SentenceChunker(4);

    const c1 = chunker.push('One medium Cheese Burst Pizza is INR 399. ');
    assert.equal(c1.length, 1);
    assert.equal(c1[0], 'One medium Cheese Burst Pizza is INR 399.');

    const c2 = chunker.push('Shall I confirm this item?');
    assert.equal(c2.length, 1);
    assert.equal(c2[0], 'Shall I confirm this item?');

    assert.equal(chunker.flush(), null);
  });

  it('splits on clause punctuation when minimum word count is met', () => {
    const chunker = new SentenceChunker(4);

    const c1 = chunker.push('I found three matching dishes for your order, including paneer tikka and dal tadka.');
    assert.ok(c1.length >= 1);
    assert.match(c1[0]!, /I found three matching dishes/);
  });

  it('flushes unpunctuated text on stream end', () => {
    const chunker = new SentenceChunker(4);
    chunker.push('Thank you for ordering with us');
    const flushed = chunker.flush();
    assert.equal(flushed, 'Thank you for ordering with us');
  });
});
