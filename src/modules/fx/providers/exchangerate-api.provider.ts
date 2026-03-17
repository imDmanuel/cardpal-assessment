import {
  Injectable,
  Logger,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { type ConfigType } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import fxConfig from '../../../common/config/fx.config.js';
import { type IExchangeRateProvider } from '../interfaces/exchange-rate-provider.interface.js';
import { Currency } from '../../wallet/enums/currency.enum.js';

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  conversion_rates: Record<string, number>;
  'error-type'?: string;
}

@Injectable()
export class ExchangeRateApiProvider implements IExchangeRateProvider {
  private readonly logger = new Logger(ExchangeRateApiProvider.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(fxConfig.KEY)
    private readonly fxCfg: ConfigType<typeof fxConfig>,
  ) {}

  async getLatestRates(base: Currency): Promise<Record<string, number>> {
    const { apiKey, apiUrl } = this.fxCfg;
    const url = `${apiUrl}/${apiKey}/latest/${base}`;

    try {
      this.logger.debug(`Fetching rates for ${base} from ExchangeRate-API...`);
      const { data } = await firstValueFrom(
        this.httpService.get<ExchangeRateApiResponse>(url),
      );

      if (data.result === 'success') {
        return data.conversion_rates;
      }

      const errorType = data['error-type'] || 'unknown_error';
      this.logger.error(`ExchangeRate-API returned error: ${errorType}`);
      throw new Error(`API Error: ${errorType}`);
    } catch (error: unknown) {
      let message = 'Unknown error';
      if (error instanceof Error) {
        message = error.message;
      }

      // Safe access to axios error response
      const axiosError = error as {
        response?: { data?: { 'error-type'?: string } };
      };
      if (axiosError.response?.data?.['error-type']) {
        message = axiosError.response.data['error-type'];
      }

      this.logger.error(
        `Failed to fetch rates from ExchangeRate-API: ${message}`,
      );
      throw new ServiceUnavailableException(
        `Exchange rate provider is currently unavailable: ${message}`,
      );
    }
  }
}
