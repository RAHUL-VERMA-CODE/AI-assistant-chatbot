/**
 * @vca/orchestrator
 * State machine, fast paths, intent/slot extraction, grounding guard, Hinglish normalization.
 */

export * from './normalizer/hinglish-normalizer.ts';
export * from './templates/fact-renderer.ts';
export * from './clarification/clarification-policy.ts';
export * from './grounding/grounding-guard.ts';
export * from './intent/slot-extractor.ts';
export * from './context/bounded-context.ts';
export * from './fast-paths/fast-path-router.ts';
export * from './state-machine/machine.ts';

export const ORCHESTRATOR_VERSION = '1.0.0';
