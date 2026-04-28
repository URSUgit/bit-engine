use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;

#[derive(Debug, Error)]
pub enum RiskError {
    #[error("position size ${requested} exceeds max ${max}")]
    PositionSizeExceeded { requested: f64, max: f64 },
    #[error("portfolio drawdown {pct:.1}% breaches limit {limit:.1}%")]
    DrawdownBreached { pct: f64, limit: f64 },
    #[error("daily loss limit reached: {pct:.1}% of portfolio")]
    DailyLossLimitReached { pct: f64 },
    #[error("trader allocation {allocated} + {new} exceeds max {max}")]
    TraderAllocationExceeded { allocated: f64, new: f64, max: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub max_position_size_usd: f64,
    pub max_portfolio_drawdown_pct: f64,
    pub max_daily_loss_pct: f64,
    pub max_per_trader_allocation_usd: f64,
    pub max_open_positions: usize,
    pub stop_loss_pct: Option<f64>,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_position_size_usd: 5_000.0,
            max_portfolio_drawdown_pct: 20.0,
            max_daily_loss_pct: 5.0,
            max_per_trader_allocation_usd: 10_000.0,
            max_open_positions: 20,
            stop_loss_pct: Some(5.0),
        }
    }
}

pub struct RiskEngine {
    config: RiskConfig,
}

impl RiskEngine {
    pub fn new(config: RiskConfig) -> Self {
        Self { config }
    }

    pub fn check_order(&self, size_usd: f64) -> Result<(), RiskError> {
        if size_usd > self.config.max_position_size_usd {
            return Err(RiskError::PositionSizeExceeded {
                requested: size_usd,
                max: self.config.max_position_size_usd,
            });
        }
        Ok(())
    }

    pub fn check_drawdown(&self, portfolio_value: f64, peak_value: f64) -> Result<(), RiskError> {
        if peak_value == 0.0 { return Ok(()); }
        let drawdown_pct = (peak_value - portfolio_value) / peak_value * 100.0;
        if drawdown_pct >= self.config.max_portfolio_drawdown_pct {
            warn!("drawdown circuit breaker triggered: {:.1}%", drawdown_pct);
            return Err(RiskError::DrawdownBreached {
                pct: drawdown_pct,
                limit: self.config.max_portfolio_drawdown_pct,
            });
        }
        Ok(())
    }

    pub fn check_daily_loss(&self, daily_pnl_pct: f64) -> Result<(), RiskError> {
        if daily_pnl_pct.abs() >= self.config.max_daily_loss_pct && daily_pnl_pct < 0.0 {
            return Err(RiskError::DailyLossLimitReached { pct: daily_pnl_pct.abs() });
        }
        Ok(())
    }
}
