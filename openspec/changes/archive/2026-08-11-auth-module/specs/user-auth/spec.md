## ADDED Requirements

### Requirement: User Registration
The system SHALL allow a new user to register with `email`, `username`, and `password`. The system SHALL reject registration if `email` or `username` already exists, and SHALL store only the bcrypt hash of the password, never the plaintext.

#### Scenario: Successful registration
- **WHEN** a client submits `POST /auth/register` with a unique `email`, unique `username`, and a valid `password`
- **THEN** the system creates a new `User` record with a bcrypt-hashed password and returns the created user's public fields (excluding password hash)

#### Scenario: Duplicate email or username
- **WHEN** a client submits `POST /auth/register` with an `email` or `username` that already exists
- **THEN** the system rejects the request with a 4xx error and does not create a new record

#### Scenario: Invalid input
- **WHEN** a client submits `POST /auth/register` with a malformed `email`, empty `username`, or a `password` that fails the minimum strength rule
- **THEN** the system rejects the request with a validation error before touching the database

### Requirement: Password Hashing
The system SHALL hash passwords with `bcryptjs` using a salt rounds value of 10 before persisting, and SHALL verify passwords by comparing the hash, never by comparing plaintext.

#### Scenario: Password hashed on registration
- **WHEN** a user registers with a plaintext password
- **THEN** the value persisted to the `users.password` column is a bcrypt hash, not the original plaintext

#### Scenario: Password verified on login
- **WHEN** a user logs in with a plaintext password
- **THEN** the system compares the submitted password against the stored bcrypt hash using bcrypt's compare function, and never logs or returns the plaintext or hash

### Requirement: User Login
The system SHALL authenticate a user by `email`/`username` and `password`, and upon success SHALL issue an Access Token and a Refresh Token.

#### Scenario: Successful login
- **WHEN** a client submits `POST /auth/login` with a valid identifier (`email` or `username`) and correct `password`
- **THEN** the system returns a short-lived Access Token in the response body and sets a `httpOnly` Refresh Token cookie

#### Scenario: Wrong password
- **WHEN** a client submits `POST /auth/login` with a valid identifier but incorrect `password`
- **THEN** the system rejects the request with a 401 error and issues no tokens

#### Scenario: Unknown identifier
- **WHEN** a client submits `POST /auth/login` with an `email`/`username` that does not exist
- **THEN** the system rejects the request with a 401 error using the same generic error message as a wrong-password failure, to avoid leaking which identifiers are registered

### Requirement: Access Token Issuance
The system SHALL issue Access Tokens as HS256-signed JWTs with a 15-minute expiration, signed and verified via `jose`, containing at minimum the user's `id` as the subject claim.

#### Scenario: Access token expiration
- **WHEN** an Access Token issued at time T is used to access a protected resource after T + 15 minutes
- **THEN** the system rejects the request as unauthorized due to token expiration

#### Scenario: Access token algorithm enforcement
- **WHEN** the system verifies an incoming Access Token
- **THEN** verification SHALL explicitly restrict accepted algorithms to `HS256` and reject tokens signed with any other algorithm (including `none`)

### Requirement: Refresh Token Issuance and Rotation
The system SHALL issue Refresh Tokens as HS256-signed JWTs with a 7-to-30-day expiration, delivered via an `httpOnly`, `secure`, `sameSite=lax` cookie scoped to `path=/auth` (covering all `/auth/*` endpoints, so that `login`, `register`, `refresh`, and `logout` can all read the cookie). Each successful use of a Refresh Token SHALL invalidate that token and issue a new one (rotation), and the set of valid Refresh Tokens SHALL be tracked in a Redis allowlist keyed by user id and token id (`jti`).

#### Scenario: Successful token refresh
- **WHEN** a client calls `POST /auth/refresh` with a valid, non-expired, allowlisted Refresh Token cookie
- **THEN** the system issues a new Access Token, invalidates the old Refresh Token in the Redis allowlist, issues a new Refresh Token, and sets the new Refresh Token cookie

#### Scenario: Reused (already rotated) refresh token
- **WHEN** a client calls `POST /auth/refresh` with a Refresh Token whose `jti` is no longer present in the Redis allowlist (already rotated or revoked)
- **THEN** the system rejects the request with a 401 error and does not issue new tokens

#### Scenario: Expired refresh token
- **WHEN** a client calls `POST /auth/refresh` with a Refresh Token past its expiration
- **THEN** the system rejects the request with a 401 error, requiring the user to log in again

### Requirement: Logout and Token Revocation
The system SHALL allow a logged-in user to log out, which invalidates their current Refresh Token in the Redis allowlist and clears the Refresh Token cookie. Logout SHALL NOT affect Refresh Tokens issued to other sessions/devices of the same user.

#### Scenario: Successful logout
- **WHEN** a client calls `POST /auth/logout` with a valid Refresh Token cookie
- **THEN** the system removes the corresponding entry from the Redis allowlist and clears the Refresh Token cookie in the response

#### Scenario: Logout does not affect other sessions
- **WHEN** a user with two active sessions (two Refresh Tokens) logs out from one session
- **THEN** the Refresh Token belonging to the other session remains valid in the Redis allowlist
