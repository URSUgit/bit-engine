"""Live price forecasting API: composable strategies, live forecasts at
5s/30s/1m/5m/10m horizons, and error validation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.forecast.analysis import benford_test, narrate
from app.forecast.service import HORIZONS_S, forecast_service
from app.forecast.strategies import strategy_catalog

router = APIRouter()


@router.get("/strategies")
async def list_strategies():
    """Available building blocks for composing a forecaster."""
    return strategy_catalog()


@router.get("/compositions")
async def list_compositions():
    return [c.to_dict() for c in forecast_service.compositions.values()]


class MemberIn(BaseModel):
    strategy: str
    weight: float = Field(1.0, gt=0)
    params: dict = Field(default_factory=dict)


class CompositionIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    members: list[MemberIn] = Field(min_length=1)
    active: bool = True


@router.post("/compositions")
async def create_composition(body: CompositionIn):
    """Create (or replace) a composed forecaster."""
    try:
        comp = forecast_service.add_composition(
            body.name, [m.model_dump() for m in body.members], active=body.active
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return comp.to_dict()


@router.delete("/compositions/{name}")
async def delete_composition(name: str):
    if name in ("baseline",):
        raise HTTPException(status_code=400, detail="The baseline composition cannot be deleted")
    if not forecast_service.remove_composition(name):
        raise HTTPException(status_code=404, detail=f"No composition named '{name}'")
    return {"deleted": name}


@router.post("/compositions/{name}/active")
async def set_composition_active(name: str, active: bool = Query(True)):
    if not forecast_service.set_active(name, active):
        raise HTTPException(status_code=404, detail=f"No composition named '{name}'")
    return {"name": name, "active": active}


@router.get("/symbols")
async def list_symbols():
    return {"symbols": forecast_service.symbols, "horizons_s": list(HORIZONS_S)}


@router.post("/symbols/{symbol}")
async def track_symbol(symbol: str):
    forecast_service.track(symbol)
    return {"symbols": forecast_service.symbols}


@router.get("/live")
async def live(symbol: str = Query("BTCUSDT"), tick_tail: int = Query(600, ge=10, le=2400)):
    """Everything the chart needs: recent ticks, open forecasts, recent scored ones."""
    return forecast_service.live(symbol, tick_tail=tick_tail)


@router.get("/narrate")
async def narrator(symbol: str = Query("BTCUSDT")):
    """Plain-language commentary on the live forecast state (rule-based)."""
    return {"symbol": symbol.upper(), "messages": narrate(forecast_service, symbol)}


@router.get("/benford")
async def benford(
    symbol: str = Query("BTCUSDT"),
    position: int = Query(1, ge=1, le=4),
    source: str = Query("delta", pattern="^(delta|price)$"),
):
    """Benford's-law test on the k-th significant digit of tick moves.

    source=delta (default) tests tick-to-tick price changes — they span
    orders of magnitude, which Benford requires. source=price tests raw
    levels, which cluster tightly and generally will not conform.
    """
    ticks = list(forecast_service.ticks.get(symbol.upper(), ()))
    if source == "delta":
        values = [p2 - p1 for (_, p1), (_, p2) in zip(ticks, ticks[1:]) if p2 != p1]
    else:
        values = [p for _, p in ticks]
    result = benford_test(values, position)
    result["symbol"] = symbol.upper()
    result["source"] = source
    return result


@router.get("/accuracy")
async def accuracy(
    symbol: str | None = Query(None),
    composition: str | None = Query(None),
    horizon_s: int | None = Query(None),
):
    """Error-validation stats per (composition, horizon): MAE, RMSE, MAPE, bias, direction hit rate."""
    return forecast_service.accuracy(symbol=symbol, composition=composition, horizon_s=horizon_s)
