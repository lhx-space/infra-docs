## Requirements

### Requirement: Rate Limiting on Auth Endpoints in Production
The system SHALL apply request rate limiting to `POST /auth/login` and `POST /auth/register` when `NODE_ENV=production`, using an IP-based window (login: max 5 requests per 15 minutes; register: max 20 requests per 15 minutes).

#### Scenario: Login rate limit exceeded in production
- **WHEN** the same IP sends more than 5 `POST /auth/login` requests within a 15-minute window while `NODE_ENV=production`
- **THEN** subsequent requests within that window are rejected with a 429 error until the window resets

#### Scenario: Register rate limit exceeded in production
- **WHEN** the same IP sends more than 20 `POST /auth/register` requests within a 15-minute window while `NODE_ENV=production`
- **THEN** subsequent requests within that window are rejected with a 429 error until the window resets

### Requirement: Rate Limiting Disabled in Development
The system SHALL NOT apply rate limiting to `POST /auth/login` or `POST /auth/register` when `NODE_ENV` is `development` or `test`, so local development and automated tests are not throttled.

#### Scenario: No throttling in development
- **WHEN** the same IP sends repeated `POST /auth/login` requests while `NODE_ENV=development`
- **THEN** no request is rejected due to rate limiting, regardless of request count
