import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { RedisService } from '../src/common/redis/redis.service.js';
import { Currency } from '../src/modules/wallet/enums/currency.enum.js';
import { TransactionType } from '../src/modules/transactions/enums/transaction-type.enum.js';

describe('ExchangeFlow (e2e)', () => {
  let app: INestApplication<App>;
  let redisService: RedisService;
  let accessToken: string;
  const uniqueId = Date.now();
  const testUser = {
    email: `exchange_test_${uniqueId}@example.com`,
    name: 'Exchange Test User',
    password: 'Password123!',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    redisService = app.get<RedisService>(RedisService);

    // Register & Login
    await request(app.getHttpServer()).post('/auth/register').send(testUser);
    const otp = await redisService.get(`otp:${testUser.email}`);
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email: testUser.email, otp });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    accessToken = loginRes.body.accessToken;

    // Fund NGN for tests
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: 10000,
        currency: Currency.NGN,
        idempotencyKey: `init_fund_${uniqueId}`,
      });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Feature 4 — Conversion', () => {
    it('Should convert NGN to USD', async () => {
      const res = await request(app.getHttpServer())
        .post('/wallet/convert')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: Currency.NGN,
          toCurrency: Currency.USD,
          amount: 5000,
          idempotencyKey: `conv_ngn_usd_${uniqueId}`,
        })
        .expect(201);

      expect(res.body.type).toBe(TransactionType.CONVERT);
      expect(Number(res.body.fromAmount)).toBe(5000);
      expect(Number(res.body.rate)).toBeGreaterThan(0);
      expect(Number(res.body.toAmount)).toBeGreaterThan(0);
    });

    it('Should prevent conversion with insufficient balance', async () => {
      await request(app.getHttpServer())
        .post('/wallet/convert')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: Currency.NGN,
          toCurrency: Currency.USD,
          amount: 1000000, // Way more than funded
          idempotencyKey: `conv_fail_bal_${uniqueId}`,
        })
        .expect(409); // ConflictException('Insufficient balance')
    });

    it('Should prevent conversion to the same currency', async () => {
      await request(app.getHttpServer())
        .post('/wallet/convert')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: Currency.USD,
          toCurrency: Currency.USD,
          amount: 10,
          idempotencyKey: `conv_fail_same_${uniqueId}`,
        })
        .expect(400);
    });
  });

  describe('Feature 5 — Trading', () => {
    it('Should trade USD back to NGN', async () => {
      const res = await request(app.getHttpServer())
        .post('/wallet/trade')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: Currency.USD,
          toCurrency: Currency.NGN,
          amount: 1, // Small amount from what we converted earlier
          idempotencyKey: `trade_usd_ngn_${uniqueId}`,
        })
        .expect(201);

      expect(res.body.type).toBe(TransactionType.TRADE);
    });

    it('Should reject trade that does not involve NGN', async () => {
      await request(app.getHttpServer())
        .post('/wallet/trade')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromCurrency: Currency.USD,
          toCurrency: Currency.EUR,
          amount: 1,
          idempotencyKey: `trade_fail_ngn_${uniqueId}`,
        })
        .expect(400); // DTO validation error
    });
  });

  describe('Feature 6 — Transaction History', () => {
    it('Should return paginated transaction history', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(3); // Fund + Convert + Trade
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('Should filter history by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions?type=FUND')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      res.body.data.forEach((tx: any) => {
        expect(tx.type).toBe(TransactionType.FUND);
      });
    });
  });
});
