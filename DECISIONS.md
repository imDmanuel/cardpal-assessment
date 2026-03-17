# Design Decisions & Assumptions

This document outlines the architectural rationale and key assumptions made during the development of the CardPal FX Trading API.

## 🏗️ FX Rates Architecture

### 1. Provider Abstraction
**Decision**: External API interactions are abstracted behind the `IExchangeRateProvider` interface and the `EXCHANGE_RATE_PROVIDER` injection token.
- **Rationale**: Decouples the core business logic (`FxService`) from vendor-specific HTTP implementations. This allows switching between providers (e.g., ExchangeRate-API, Fixer, OpenExchangeRates) by simply swapping the registration in `FxModule`.
- **Implementation**: Uses `@nestjs/axios` for the concrete `ExchangeRateApiProvider`.

### 2. Multi-Layer Cache & Fallback Strategy
**Decision**: A prioritized retrieval strategy: **Redis Cache** (900s TTL) -> **External Provider** -> **Database (Stale fallback)**.
- **Rationale**: Optimizes performance and high availability.
    - **Redis**: Minimizes latency and protects external API quotas.
    - **Database**: Acts as a "circuit breaker" fallback. If the external API is unreachable, the system can still display rates using the last known data.

### 3. Strict Mutation Guard (The "Anti-Arbitrage" Rule)
**Decision**: Balance-affecting operations (e.g., conversion, trading) **must** use fresh rates.
- **Rationale**: Most critical financial decision. Allowing stale DB data for mutations would expose the platform to "stale price arbitrage," where users could trade against outdated prices during high volatility or API downtime.
- **Implementation**: `FxService.getRateForMutation` strictly queries Cache/API and throws a `503 Service Unavailable` if neither is available, even if stale data exists in the DB.

### 4. Asynchronous Persistence
**Decision**: Rates are persisted to Database and Cache in the background (fire-and-forget) after a successful API fetch.
- **Rationale**: Fetching rates from an external API is already slow. Stalling the response to wait for DB/Redis write operations would double the latency.
- **Side Effect**: Resolved race conditions in E2E tests by adding micro-delays to ensure background tasks complete before test cleanup.

---

## 💳 Wallet & Trading Design

### 1. NGN-Centric Funding
**Assumption**: The platform's primary entry point is Naira (NGN).
- **Rationale**: Simplifies the initial product scope. Users are expected to fund with NGN and then "purchase" other currencies via the trading/conversion features.
- **Rule**: Direct funding (`/wallet/fund`) is restricted to the `NGN` currency.

### 2. Auto-Wallet Provisions
**Decision**: 4 currency wallets (NGN, USD, EUR, GBP) are automatically provisioned upon user verification.
- **Rationale**: Ensures a consistent UX where every user immediately sees their base multi-currency account ready for action.

### 3. Precision Management
**Decision**: All monetary values use `DECIMAL(18, 4)` in the database and the `Decimal.js` library for in-memory arithmetic.
- **Rationale**: IEEE 754 floating-point numbers (standard JS `number`) are unsuitable for financial calculations due to rounding errors (e.g., `0.1 + 0.2 !== 0.3`).

### 4. Atomic Mutations
**Decision**: All multi-step mutations (Debit Wallet A -> Credit Wallet B -> Create Transaction Record) are wrapped in TypeORM Database Transactions.
- **Rationale**: Guarantees data consistency. If any step fails (e.g., network timeout during transaction logging), the balance changes are rolled back automatically.

---

## 🔐 Authentication & Identity

### 1. Decoupled Verification & Sessions
**Decision**: OTP verification only marks an account as `isVerified`. A subsequent `POST /auth/login` is required to obtain a JWT.
- **Rationale**: Enhances security and clarifies intent. The registration/verification flow "activates" the account, while the login flow "authenticates" the user. Avoids issuing tokens unnecessarily before a user has successfully proven their identity once.

### 2. Stateless Auth
**Decision**: Use signed JWTs for authentication.
- **Rationale**: Simplifies scaling by removing the need for session storage on the server-side.

---

## 🛠️ Environmental Assumptions

1. **ExchangeRate-API Consistency**: We assume the external vendor follows ISO currency codes and returns `conversion_rates` as a numeric map.
2. **Redis Reliability**: We assume Redis is available for caching; if Redis is down, the system defaults to fetching from the API directly (with significantly higher latency and quota impact).
3. **UTC Time**: All timestamps (`fetchedAt`, `createdAt`) are stored and retrieved in UTC to avoid time-zone-related discrepancies in rate calculations.
