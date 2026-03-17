import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { RedisService } from '../src/common/redis/redis.service';
import { Currency } from '../src/modules/wallet/enums/currency.enum';

describe('WalletFlow (e2e)', () => {
  let app: INestApplication<App>;
  let redisService: RedisService;
  let accessToken: string;
  const uniqueId = Date.now();
  const testUser = {
    email: `wallet_test_${uniqueId}@example.com`,
    name: 'Wallet Test User',
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
  });

  afterAll(async () => {
    // Clean up if necessary and close app
    await app.close();
  });

  it('1. Should register a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
      .expect(201);

    expect(res.body.message).toBe(
      'Registration successful. Please verify your email with the OTP sent.',
    );
  });

  it('2. Should verify OTP and get access token', async () => {
    // Get OTP from Redis
    const otp = await redisService.get(`otp:${testUser.email}`);
    expect(otp).toBeDefined();

    const res = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        email: testUser.email,
        otp,
      })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('3. Should get initial wallet balances (all zero)', async () => {
    const res = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Check that balances are 0 initially
    res.body.forEach((wallet: any) => {
      expect(Number(wallet.balance)).toBe(0);
    });
  });

  it('4. Should fund NGN wallet', async () => {
    const idempotencyKey = `fund_${Date.now()}`;
    const fundAmount = 5000;

    const res = await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: fundAmount,
        currency: Currency.NGN,
        idempotencyKey,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(Number(res.body.toAmount)).toBe(fundAmount);
    expect(res.body.fromCurrency).toBe(Currency.NGN);
  });

  it('5. Should reflect funded amount in wallet balances', async () => {
    const res = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const ngnWallet = res.body.find((w: any) => w.currency === Currency.NGN);
    expect(ngnWallet).toBeDefined();
    expect(Number(ngnWallet.balance)).toBe(5000);
  });

  it('6. Should prevent duplicate funding with same idempotency key', async () => {
    const idempotencyKey = `fund_dup_${Date.now()}`;
    const fundAmount = 1000;

    // First request should succeed
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: fundAmount,
        currency: Currency.NGN,
        idempotencyKey,
      })
      .expect(201);

    // Second request with same key should fail with 409 Conflict
    const res = await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: fundAmount,
        currency: Currency.NGN,
        idempotencyKey,
      })
      .expect(409);

    expect(res.body.message).toBe('Duplicate transaction request');
  });

  it('7. Should handle concurrent funding requests gracefully (race conditions)', async () => {
    // Get current balance
    let initialBalance = 0;
    const balanceRes = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const ngnWallet = balanceRes.body.find(
      (w: any) => w.currency === Currency.NGN,
    );
    initialBalance = Number(ngnWallet.balance);

    const concurrentRequests = 5;
    const fundAmount = 500;

    // Create an array of requests
    const requests = Array.from({ length: concurrentRequests }).map((_, i) => {
      // Different idempotency keys to pass the first check
      // but they will hit the database at the same time
      return request(app.getHttpServer())
        .post('/wallet/fund')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          amount: fundAmount,
          currency: Currency.NGN,
          idempotencyKey: `fund_concurrent_${Date.now()}_${i}`,
        });
    });

    // Execute all requests concurrently
    const responses = await Promise.all(requests);

    // Verify all requests succeeded
    responses.forEach((res) => {
      expect(res.status).toBe(201);
    });

    // Verify the final balance is exactly initial + (concurrentRequests * fundAmount)
    const finalBalanceRes = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const finalNgnWallet = finalBalanceRes.body.find(
      (w: any) => w.currency === Currency.NGN,
    );
    const expectedBalance = initialBalance + concurrentRequests * fundAmount;

    expect(Number(finalNgnWallet.balance)).toBe(expectedBalance);
  });
});
