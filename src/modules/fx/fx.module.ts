import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';
import { FxRate } from './entities/fx-rate.entity';
import { EXCHANGE_RATE_PROVIDER } from './constants/fx.constants';
import { ExchangeRateApiProvider } from './providers/exchangerate-api.provider';

@Module({
  imports: [TypeOrmModule.forFeature([FxRate]), HttpModule],
  controllers: [FxController],
  providers: [
    FxService,
    {
      provide: EXCHANGE_RATE_PROVIDER,
      useClass: ExchangeRateApiProvider,
    },
  ],
  exports: [FxService],
})
export class FxModule {}

