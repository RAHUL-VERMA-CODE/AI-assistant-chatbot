/**
 * @vca/policy-food
 * Food domain pack: Jain validation, gluten-free, allergens, nutrition, group budget solver, reorder mapper, live tracking, pairing.
 */

export * from './rules/jain-validator.ts';
export * from './rules/allergen-validator.ts';
export * from './rules/nutrition-validator.ts';
export * from './solver/group-budget-solver.ts';
export * from './reorder/reorder-mapper.ts';
export * from './tracking/tracking-service.ts';
export * from './pairing/pairing-recommender.ts';

export const POLICY_FOOD_VERSION = '1.0.0';
