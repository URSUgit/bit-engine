from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/sentiment/{asset}")
async def get_asset_sentiment(asset: str, period: str = Query("24h")):
    """Aggregated sentiment score for an asset over the given period."""
    return {
        "asset": asset,
        "period": period,
        "score": 0.0,
        "positive_pct": 0.0,
        "negative_pct": 0.0,
        "neutral_pct": 0.0,
        "signal_count": 0,
    }


@router.get("/on-chain/{asset}")
async def get_on_chain_analytics(asset: str):
    """On-chain analytics: whale flows, funding rate, open interest, liquidations."""
    return {
        "asset": asset,
        "whale_inflow_usd": 0.0,
        "whale_outflow_usd": 0.0,
        "funding_rate": 0.0,
        "open_interest_usd": 0.0,
        "long_short_ratio": 1.0,
        "liquidations_24h_usd": 0.0,
    }


@router.get("/correlation")
async def get_correlation_matrix(assets: str = Query(..., description="Comma-separated asset list")):
    """Return pairwise correlation matrix for the given assets."""
    asset_list = [a.strip() for a in assets.split(",")]
    return {
        "assets": asset_list,
        "matrix": [],
        "period": "30d",
    }
