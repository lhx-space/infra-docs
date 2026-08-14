//! 连接鉴权路径的熔断保护（见 realtime-collaboration-resilience 相关的
//! system-performance-hardening design.md 决策 5、collab-server-resilience spec.md
//! 「连接鉴权的熔断保护」）。
//!
//! 用简单的滑动窗口计数器（连续失败次数）+ 三态（关闭/开启/半开），不引入
//! `failsafe`/`tower::hedge` 等第三方熔断库——需求很单一，手写一个
//! `Mutex<CircuitState>` 足够，也更容易按场景调整阈值（见 design.md 决策 5）。

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 调用前的决策结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallDecision {
    /// 允许发起实际的 gRPC 调用（关闭态的正常请求，或半开态轮到的一次探测性调用）。
    Allow,
    /// 熔断中，直接快速失败，不发起实际调用。
    Reject,
}

#[derive(Debug, Clone, Copy)]
enum CircuitState {
    Closed {
        consecutive_failures: u32,
    },
    /// `opened_at`：进入开启态的时间点，用于判断是否已经到达探测时机。
    Open {
        opened_at: Instant,
    },
    /// 半开态：已经放出一次探测性调用，结果未知，其它请求在此期间继续快速失败
    /// （避免连接鉴权这种高频路径在半开的瞬间被一大批并发请求同时当成"探测"发出去）。
    HalfOpen,
}

/// 简单的熔断器：连续失败达到 `failure_threshold` 次后进入开启态，等待
/// `open_duration` 后自动尝试一次探测性调用，成功则恢复关闭态，失败则重新开启并重置
/// 等待时长。
pub struct CircuitBreaker {
    state: Mutex<CircuitState>,
    failure_threshold: u32,
    open_duration: Duration,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, open_duration: Duration) -> Self {
        Self {
            state: Mutex::new(CircuitState::Closed {
                consecutive_failures: 0,
            }),
            failure_threshold,
            open_duration,
        }
    }

    /// 初始的熔断阈值/等待时长默认值：保守取值，还没有真实运行数据支撑更精确的调参
    /// （见 design.md 决策 5/Open Questions），后续可以根据线上观察到的真实故障模式
    /// 调整——连续失败 5 次才熔断（避免单次抖动就被误判成"持续故障"），开启后等待
    /// 10 秒才尝试探测（给 `apps/api` 一点自我恢复的时间，也不会让用户等太久）。
    pub fn with_default_thresholds() -> Self {
        Self::new(5, Duration::from_secs(10))
    }

    pub fn before_call(&self) -> CallDecision {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match *state {
            CircuitState::Closed { .. } => CallDecision::Allow,
            CircuitState::Open { opened_at } => {
                if opened_at.elapsed() >= self.open_duration {
                    tracing::info!("circuit breaker half-open, allowing probe call");
                    *state = CircuitState::HalfOpen;
                    CallDecision::Allow
                } else {
                    CallDecision::Reject
                }
            }
            CircuitState::HalfOpen => CallDecision::Reject,
        }
    }

    pub fn on_success(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !matches!(
            *state,
            CircuitState::Closed {
                consecutive_failures: 0
            }
        ) {
            tracing::info!("circuit breaker closed after successful call");
        }
        *state = CircuitState::Closed {
            consecutive_failures: 0,
        };
    }

    pub fn on_failure(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *state = match *state {
            CircuitState::Closed {
                consecutive_failures,
            } => {
                let next = consecutive_failures + 1;
                if next >= self.failure_threshold {
                    tracing::warn!(
                        consecutive_failures = next,
                        "circuit breaker opened after consecutive failures"
                    );
                    CircuitState::Open {
                        opened_at: Instant::now(),
                    }
                } else {
                    CircuitState::Closed {
                        consecutive_failures: next,
                    }
                }
            }
            // 已经是开启态时收到的失败（理论上不该发生，因为 `before_call` 会先拒绝），
            // 保持开启，不重置等待时长——避免并发场景下重复的失败上报把等待时长意外
            // 延长。
            CircuitState::Open { opened_at } => CircuitState::Open { opened_at },
            // 半开态的探测调用失败：重新开启，并重置等待时长，给下一次探测更多缓冲。
            CircuitState::HalfOpen => {
                tracing::warn!("circuit breaker probe failed, reopening");
                CircuitState::Open {
                    opened_at: Instant::now(),
                }
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_closed_below_threshold() {
        let breaker = CircuitBreaker::new(3, Duration::from_millis(50));
        breaker.on_failure();
        breaker.on_failure();
        assert_eq!(breaker.before_call(), CallDecision::Allow);
    }

    #[test]
    fn opens_after_reaching_threshold() {
        let breaker = CircuitBreaker::new(3, Duration::from_millis(50));
        breaker.on_failure();
        breaker.on_failure();
        breaker.on_failure();
        assert_eq!(breaker.before_call(), CallDecision::Reject);
    }

    #[test]
    fn half_opens_after_wait_and_closes_on_success() {
        let breaker = CircuitBreaker::new(1, Duration::from_millis(20));
        breaker.on_failure();
        assert_eq!(breaker.before_call(), CallDecision::Reject);
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(breaker.before_call(), CallDecision::Allow);
        // 半开态期间，其它并发请求继续快速失败
        assert_eq!(breaker.before_call(), CallDecision::Reject);
        breaker.on_success();
        assert_eq!(breaker.before_call(), CallDecision::Allow);
    }

    #[test]
    fn reopens_when_probe_fails() {
        let breaker = CircuitBreaker::new(1, Duration::from_millis(20));
        breaker.on_failure();
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(breaker.before_call(), CallDecision::Allow);
        breaker.on_failure();
        assert_eq!(breaker.before_call(), CallDecision::Reject);
    }
}
