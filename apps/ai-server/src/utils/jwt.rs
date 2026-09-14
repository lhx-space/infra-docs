//! 本地校验 access token（见 design.md 决策 3）：与 `apps/collab-server` 的 `utils/jwt.rs`
//! 完全一致，共享同一份 `JWT_SECRET`，不新增第二套鉴权体系。
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;

/// 与 `apps/api` `services/token.ts` 里的 `AccessTokenPayload` 保持一致的最小字段集合
/// （只取 `sub`，即 userId）。
#[derive(Debug, Deserialize)]
pub struct AccessTokenClaims {
    pub sub: String,
}

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error("token invalid or expired")]
    Invalid,
}

/// 本地校验 access token 的签名与过期时间，不发起任何网络调用。
pub fn verify_access_token(token: &str, secret: &str) -> Result<AccessTokenClaims, JwtError> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let validation = Validation::new(Algorithm::HS256);
    decode::<AccessTokenClaims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|_| JwtError::Invalid)
}
