import { Currency } from '../../wallet/enums/currency.enum.js';

export interface IExchangeRateProvider {
  getLatestRates(base: Currency): Promise<Record<string, number>>;
}
