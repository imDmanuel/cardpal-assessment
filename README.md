# FX Trading App

A robust NestJS backend for a multi-currency FX trading platform where users can trade currencies, including Naira (NGN) and other international currencies.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL
- Redis

### Setup
1. **Clone the repository**
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure environment**
   - Copy `.env.example` to `.env`
   - Fill in your database and API credentials.
4. **Run the application**
   ```bash
   # Development
   npm run start:dev
   ```
5. **API Documentation**
   - Once running, Swagger UI is available at `http://localhost:3000/api/docs`

---

## 🏗️ Architecture Decisions

### 1. Layered Architecture
We follow the standard NestJS modular architecture split into Controller -> Service -> Entity/Repository. This ensures:
- **Scalability**: Modules are self-contained and can be extracted into microservices if needed.
- **Testability**: Service logic can be tested independently of HTTP concerns.

### 2. Database Design & Reliability
- **PostgreSQL**: Chosen for its ACID compliance and robust transaction support, which is critical for financial applications.
- **Atomic Transactions**: All balance mutations are wrapped in DB transactions using TypeORM `QueryRunner` to ensure atomicity. If any part of a multi-step update (e.g., wallet credit + transaction log) fails, the entire process is rolled back.
- **Pessimistic Locking**: To prevent **race conditions** in high-frequency trading, we use `SELECT FOR UPDATE` when fetching balances for mutation. This ensures that concurrent requests for the same user wallet are serialized at the database level.
- **Idempotency**: All funding requests (`/wallet/fund`) require a unique reference/idempotency key. This prevents double-funding if a user or network retries a request.
- **Precision**: Monetary values are stored as `DECIMAL(18, 4)` to avoid floating-point rounding errors common in standard number types.

### 3. Caching (Redis)
- FX rates are fetched from External APIs and cached in Redis with a 5-minute TTL to stay within API rate limits and reduce latency.

### 4. Email Delivery (Strategy Pattern)
- **Abstraction**: Email delivery is abstracted behind a `MailProvider` interface. This allows seamless switching between providers (SMTP, Resend, SES) without modifying business logic.
- **Tradeoff - Sync vs Async Email**: To maintain a low-complexity infrastructure for the MVP, OTP emails are sent **synchronously**.
    - **Pros**: Immediate client-side feedback if the provider is down; no need for message brokers (Redis/BullMQ) or separate worker processes.
    - **Cons**: Higher request latency during registration.
    - **Decision**: Deferred background workers until infrastructure scale justifies the overhead of managing a persistent queue.

### 5. Identity & Access Control (RBAC)
- **Global Protection**: All routes are protected by `JwtAuthGuard` by default.
- **Public Access**: Specific endpoints (e.g., registration, health check) are explicitly white-listed using a custom `@Public()` decorator.
- **Role System**: Simple `USER` / `ADMIN` hierarchy.
    - **Promotion**: A hardcoded `SUPERADMIN_EMAIL` (config via `.env`) is automatically treated as an `ADMIN` upon login. This superadmin is the only one who can promote other users to `ADMIN` status via the `/users/:id/promote` endpoint.
- **JWT Strategy**: Stateless authentication using signed JWTs.

### 6. Consistent API Responses
- **Response Wrapper**: All successful responses are intercepted and wrapped in a standard JSON envelope: `{ "success": true, "statusCode": 200, "message": "...", "data": [...] }`.
- **Error Filtering**: A global `HttpExceptionFilter` ensures that even errors follow a predictable structure, aiding frontend integration.

---

## 🛠️ Key Assumptions
1. **Base Funding**: Users can only fund their wallets in **Naira (NGN)**. All other currencies must be acquired via conversion or trading.
2. **Exchange Rates**: ExchangeRate-API is used as the primary source of truth for real-time rates.
3. **Multi-currency**: A user's wallet supports NGN, USD, EUR, and GBP by default.

---

## 📊 Flow Diagrams

### Currency Conversion Flow
```mermaid
sequenceDiagram
    participant User
    participant API
    participant FxService
    participant Cache
    participant DB

    User->>API: POST /wallet/convert
    API->>FxService: getRates(NGN)
    FxService->>Cache: Check for cached rates
    alt Cache Miss
        FxService->>ExternalAPI: Fetch Rates
        FxService->>Cache: Save to Redis
    end
    API->>DB: Start Transaction
    DB->>DB: Check balance
    DB->>DB: Debit NGN / Credit USD
    DB->>DB: Record Transaction
    DB->>API: Commit Transaction
    API-->>User: Success (201)
```

### Wallet Management Flow
```mermaid
graph TD
    A[User Verified] --> B{Create Wallets}
    B --> C[NGN Wallet: 0]
    B --> D[USD Wallet: 0]
    B --> E[EUR Wallet: 0]
    B --> F[GBP Wallet: 0]
    G[Fund NGN] --> H[Update Balance]
    H --> I[Log FUND Transaction]
```

---

## 📝 Features & Progress
See [fx-trading-app.md](./fx-trading-app.md) for the detailed implementation plan and feature-by-feature progress.
