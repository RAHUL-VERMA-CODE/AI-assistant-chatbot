/**
 * ISO 4217 Currency representation using integer minor units.
 * Never uses floating-point math for monetary transactions.
 */

export type IsoCurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD' | 'JPY';

export interface CurrencyAmount {
  readonly minorUnits: number; // Integer (e.g. 39900 = INR 399.00)
  readonly currency: IsoCurrencyCode;
}

export class Money {
  public readonly minorUnits: number;
  public readonly currency: IsoCurrencyCode;

  private constructor(minorUnits: number, currency: IsoCurrencyCode) {
    if (!Number.isInteger(minorUnits)) {
      throw new TypeError(`minorUnits must be an integer, got: ${minorUnits}`);
    }
    this.minorUnits = minorUnits;
    this.currency = currency;
  }

  public static of(minorUnits: number, currency: IsoCurrencyCode): Money {
    return new Money(minorUnits, currency);
  }

  public static zero(currency: IsoCurrencyCode): Money {
    return new Money(0, currency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  public multiply(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new TypeError(`Quantity must be a non-negative integer, got: ${quantity}`);
    }
    return new Money(this.minorUnits * quantity, this.currency);
  }

  public isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits <= other.minorUnits;
  }

  public toJSON(): CurrencyAmount {
    return {
      minorUnits: this.minorUnits,
      currency: this.currency,
    };
  }

  /**
   * Deterministic human-readable display string (e.g. "INR 399.00" or "INR 448").
   */
  public toDisplayString(): string {
    const decimals = this.currency === 'JPY' ? 0 : 2;
    if (decimals === 0) {
      return `${this.currency} ${this.minorUnits}`;
    }
    const major = Math.floor(this.minorUnits / 100);
    const minor = this.minorUnits % 100;
    const padded = minor.toString().padStart(2, '0');
    return `${this.currency} ${major}.${padded}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot operate between ${this.currency} and ${other.currency}`);
    }
  }
}
