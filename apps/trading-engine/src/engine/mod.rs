use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    PositionOpened { position_id: String, symbol: String, side: String, size: f64, entry_price: f64 },
    PositionClosed { position_id: String, pnl: f64, close_price: f64 },
    OrderFilled { order_id: String, fill_price: f64, fill_qty: f64 },
    RiskBreached { reason: String, position_id: Option<String> },
    SignalReceived { asset: String, direction: String, confidence: f64, source: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub symbol: String,
    pub side: OrderSide,
    pub size: f64,
    pub price: Option<f64>,
    pub order_type: OrderType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderType {
    Market,
    Limit,
}

pub async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    info!("WebSocket client connected");

    while let Some(msg) = socket.recv().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("received: {}", text);
                // Echo back for now; real impl routes to engine
                if socket.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    info!("WebSocket client disconnected");
}
