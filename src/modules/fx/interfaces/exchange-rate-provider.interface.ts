import { Currency } from '../../wallet/enums/currency.enum';

export interface IExchangeRateProvider {
  getLatestRates(base: Currency): Promise<Record<string, number>>;
}

