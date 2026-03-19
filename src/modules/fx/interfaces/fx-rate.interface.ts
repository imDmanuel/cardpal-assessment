import { Currency } from '../../wallet/enums/currency.enum';
import Decimal from 'decimal.js';

export interface IFxRate {
  base: Currency;
  quote: Currency;
  rate: InstanceType<typeof Decimal>;
  fetchedAt: Date;
}

export interface IFxRatesResponse {
  base: Currency;
  rates: Partial<Record<Currency, number>>;
  fetchedAt: Date;
  stale: boolean;
}

