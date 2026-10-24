/**
 * Branded nominal type helper to prevent accidental ID cross-assignment at compile time.
 */
declare const __brand: unique symbol;
export type Brand<B> = { readonly [__brand]: B };
export type Branded<T, B> = T & Brand<B>;

export type TenantId = Branded<string, 'TenantId'>;
export type BranchId = Branded<string, 'BranchId'>;
export type RestaurantId = Branded<string, 'RestaurantId'>;
export type SessionId = Branded<string, 'SessionId'>;
export type UserRef = Branded<string, 'UserRef'>;
export type ProposalId = Branded<string, 'ProposalId'>;
export type CartId = Branded<string, 'CartId'>;
export type OrderId = Branded<string, 'OrderId'>;
export type ItemId = Branded<string, 'ItemId'>;
export type VariantId = Branded<string, 'VariantId'>;
export type OptionId = Branded<string, 'OptionId'>;
export type TurnId = Branded<string, 'TurnId'>;

export const asTenantId = (id: string): TenantId => id as TenantId;
export const asBranchId = (id: string): BranchId => id as BranchId;
export const asRestaurantId = (id: string): RestaurantId => id as RestaurantId;
export const asSessionId = (id: string): SessionId => id as SessionId;
export const asUserRef = (id: string): UserRef => id as UserRef;
export const asProposalId = (id: string): ProposalId => id as ProposalId;
export const asCartId = (id: string): CartId => id as CartId;
export const asOrderId = (id: string): OrderId => id as OrderId;
export const asItemId = (id: string): ItemId => id as ItemId;
export const asVariantId = (id: string): VariantId => id as VariantId;
export const asOptionId = (id: string): OptionId => id as OptionId;
export const asTurnId = (id: string): TurnId => id as TurnId;
