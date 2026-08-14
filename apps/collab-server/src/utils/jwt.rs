use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;

/// 与 `apps/api` `services/token.ts` 里的 `AccessTokenPayload` 保持一致的最小字段集合
/// （只取 `sub`，即 userId；access token 本身不需要 `jti`，那是 refresh token 才有的字段）。
#[derive(Debug, Deserialize)]
pub struct AccessTokenClaims {
    pub sub: String,
}

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error("token invalid or expired")]
    Invalid,
}

/// 本地校验 access token 的签名与过期时间，不发起任何网络调用
/// （见 design.md 决策 3：纯密码学校验、无业务状态，跟 `apps/api` 共享同一份 `JWT_SECRET`，
/// 没有跨语言重复实现业务逻辑的漂移风险）。
///
/// TODO（tasks.md 3.5）：接入实际的连接鉴权流程——WS 升级请求里取出 token 调用这个函数。
pub fn verify_access_token(token: &str, secret: &str) -> Result<AccessTokenClaims, JwtError> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let validation = Validation::new(Algorithm::HS256);
    decode::<AccessTokenClaims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|_| JwtError::Invalid)
}
