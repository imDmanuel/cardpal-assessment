import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { MailModule } from './common/mail/mail.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
import { FxModule } from './modules/fx/fx.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { envValidationSchema } from './common/config/env.validation.js';
import databaseConfig from './common/config/database.config.js';
import authConfig from './common/config/auth.config.js';
import fxConfig from './common/config/fx.config.js';
import appConfig from './common/config/app.config.js';
import redisConfig from './common/config/redis.config.js';
import smtpConfig from './common/config/smtp.config.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './modules/auth/guards/roles.guard.js';
import { UserActivityInterceptor } from './common/interceptors/user-activity.interceptor.js';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      load: [
        databaseConfig,
        authConfig,
        fxConfig,
        appConfig,
        redisConfig,
        smtpConfig,
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        ssl: config.get<boolean>('database.ssl')
          ? { rejectUnauthorized: false }
          : false,
        autoLoadEntities: true,
        synchronize: config.get<string>('app.nodeEnv') !== 'production',
      }),
    }),
    RedisModule,
    MailModule,
    AuthModule,
    UsersModule,
    WalletModule,
    TransactionsModule,
    FxModule,
    AnalyticsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: UserActivityInterceptor,
    },
  ],
})
export class AppModule {}
