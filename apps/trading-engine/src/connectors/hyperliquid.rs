use anyhow::Result;
use reqwest::Client;
use tracing::info;

use super::{ExchangeConnector, OrderRequest, OrderResponse, Position};

pub struct HyperliquidConnector {
    client: Client,
    base_url: String,
    private_key: String,
}

impl HyperliquidConnector {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: std::env::var("HYPERLIQUID_API_URL")
                .unwrap_or_else(|_| "https://api.hyperliquid.xyz".into()),
            private_key: std::env::var("HYPERLIQUID_PRIVATE_KEY").unwrap_or_default(),
        }
    }
}

impl ExchangeConnector for HyperliquidConnector {
    fn name(&self) -> &'static str {
        "hyperliquid"
    }

    async fn place_order(&self, order: OrderRequest) -> Result<OrderResponse> {
        // TODO: sign EIP-712 typed data and POST to /exchange
        info!("hyperliquid: placing {:?} {:?} {}", order.side, order.order_type, order.symbol);
        Ok(OrderResponse {
            id: uuid::Uuid::new_v4().to_string(),
            status: "filled".into(),
            filled_qty: order.size,
            avg_price: order.price.unwrap_or(0.0),
        })
    }

    async fn cancel_order(&self, order_id: &str) -> Result<()> {
        info!("hyperliquid: cancelling {}", order_id);
        Ok(())
    }

    async fn get_positions(&self) -> Result<Vec<Position>> {
        Ok(vec![])
    }

    async fn subscribe_fills(&self, _tx: tokio::sync::mpsc::Sender<OrderResponse>) -> Result<()> {
        // TODO: connect to wss://api.hyperliquid.xyz/ws and stream fills
        Ok(())
    }
}
