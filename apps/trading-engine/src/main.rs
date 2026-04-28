mod engine;
mod connectors;
mod risk;

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "trading_engine=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port: u16 = std::env::var("TRADING_ENGINE_PORT")
        .unwrap_or_else(|_| "9090".into())
        .parse()?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(engine::ws_handler))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("trading-engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
