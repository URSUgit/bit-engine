pub mod hyperliquid;
pub mod polymarket;

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRequest {
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub price: Option<f64>,
    pub order_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResponse {
    pub id: String,
    pub status: String,
    pub filled_qty: f64,
    pub avg_price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub entry_price: f64,
    pub unrealized_pnl: f64,
    pub leverage: f64,
}

// Exchange connector trait — implement for each exchange
pub trait ExchangeConnector: Send + Sync {
    fn name(&self) -> &'static str;

    fn place_order(
        &self,
        order: OrderRequest,
    ) -> impl std::future::Future<Output = Result<OrderResponse>> + Send;

    fn cancel_order(
        &self,
        order_id: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    fn get_positions(
        &self,
    ) -> impl std::future::Future<Output = Result<Vec<Position>>> + Send;

    fn subscribe_fills(
        &self,
        tx: tokio::sync::mpsc::Sender<OrderResponse>,
    ) -> impl std::future::Future<Output = Result<()>> + Send;
}
