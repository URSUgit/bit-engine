"""BotDataStore implementation backed by this repo's live bot registry,
strategy schemas and trade ledger.

Two impedance mismatches are handled here, and nowhere else:

* **Fills vs. positions.** The ledger records individual fills (a BUY, later a
  SELL). The copilot reasons about round-trip outcomes — win/loss, realized
  P&L, what closed the position — so fills are paired into positions below.
  Bots are long-only and hold at most one position at a time (see
  `CryptoBot._handle_signal`), which makes the pairing unambiguous.

* **Schema vs. live values.** A strategy declares its tunables in
  `params_schema` (bounds, labels, types); the bot carries the values actually
  in use in `config.strategy_params`. A ConfigParam merges the two.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.backtest.strategies import STRATEGIES
from app.cryptobot.bot import get_bot
from app.cryptobot.ledger import get_ledger

from .types import BotSnapshot, ConfigParam, Mode, TradeRecord

# Sizing knobs that live on BotConfig itself rather than in the strategy's
# params_schema, but are just as tunable — surfaced so the copilot can reason
# about position size, not only strategy thresholds.
_BOT_LEVEL_PARAMS = {
    "position_size_usd": {
        "label": "Position size (USD)", "min": 5.0, "max": 1000.0, "step": 5.0,
        "icon": "coins",
    },
}


def _control_type(spec: dict) -> str:
    """Map a params_schema entry onto one of the panel's control shapes."""
    if spec.get("type") == "bool":
        return "toggle"
    lo, hi = spec.get("min"), spec.get("max")
    # A 0/1 int range is a flag in practice (e.g. "trend_filter"), so render it
    # as a toggle rather than a two-stop slider.
    if spec.get("type") == "int" and lo == 0 and hi == 1:
        return "toggle"
    if spec.get("type") == "int":
        return "stepper"
    return "slider"


def _default_step(spec: dict) -> float | None:
    if "step" in spec:
        return spec["step"]
    return 1 if spec.get("type") == "int" else None


class BitEngineBotStore:
    """Adapts the running CryptoBot registry + ledger to the copilot's seam."""

    def get_bot_snapshot(self, bot_id: str) -> BotSnapshot:
        bot = get_bot(bot_id)
        if bot is None:
            raise KeyError(f"Unknown bot: {bot_id}")
        cfg = bot.config

        params: list[ConfigParam] = []
        schema = getattr(STRATEGIES.get(cfg.strategy_key), "params_schema", {}) or {}
        live = cfg.strategy_params or {}
        for key, spec in schema.items():
            params.append(ConfigParam(
                key=key,
                display_name=spec.get("label", key),
                category="strategy",
                control_type=_control_type(spec),
                current_value=live.get(key, spec.get("default")),
                min_value=spec.get("min"),
                max_value=spec.get("max"),
                step=_default_step(spec),
            ))

        for key, meta in _BOT_LEVEL_PARAMS.items():
            params.append(ConfigParam(
                key=key,
                display_name=meta["label"],
                category="sizing",
                control_type="slider",
                current_value=getattr(cfg, key),
                min_value=meta["min"],
                max_value=meta["max"],
                step=meta["step"],
                icon=meta["icon"],
            ))

        return BotSnapshot(
            bot_id=bot_id,
            name=f"{cfg.trader} · {cfg.strategy_key}",
            mode=Mode(cfg.mode),
            config=params,
            symbol=cfg.symbol,
            strategy_key=cfg.strategy_key,
        )

    # ── fills -> round-trip positions ────────────────────────────────────────

    def _positions(self, bot_id: str, limit: int) -> list[TradeRecord]:
        bot = get_bot(bot_id)
        # `for_bot` returns newest-first; pair in chronological order.
        fills = list(reversed(get_ledger().for_bot(bot_id, n=max(limit * 2, 200))))

        positions: list[TradeRecord] = []
        open_buy: dict | None = None
        for f in fills:
            if f["side"] == "BUY":
                # A second BUY without an intervening SELL shouldn't happen for
                # a long-only single-position bot; keep the earlier one rather
                # than silently dropping a position if the invariant ever slips.
                if open_buy is None:
                    open_buy = f
                continue
            if f["side"] == "SELL" and open_buy is not None:
                positions.append(TradeRecord(
                    symbol=f.get("symbol", ""),
                    entry_price=open_buy["price"],
                    exit_price=f["price"],
                    size_usd=open_buy["quote_usd"],
                    realized_pnl_usd=f.get("pnl_usd"),
                    unrealized_pnl_usd=None,
                    exit_trigger=f.get("reason"),
                    opened_at=datetime.fromtimestamp(open_buy["at"], tz=timezone.utc),
                    closed_at=datetime.fromtimestamp(f["at"], tz=timezone.utc),
                    is_open=False,
                    dry_run=bool(f.get("dry_run", True)),
                ))
                open_buy = None

        # A trailing unmatched BUY is the position the bot is holding now.
        if open_buy is not None:
            live_pos = bot.status().position if bot else None
            unrealized = None
            if live_pos and bot is not None:
                last = bot.status().last_price
                if last:
                    unrealized = (last - live_pos["entry_price"]) * live_pos["size"]
            positions.append(TradeRecord(
                symbol=open_buy.get("symbol", ""),
                entry_price=open_buy["price"],
                exit_price=None,
                size_usd=open_buy["quote_usd"],
                realized_pnl_usd=None,
                unrealized_pnl_usd=round(unrealized, 4) if unrealized is not None else None,
                exit_trigger=None,
                opened_at=datetime.fromtimestamp(open_buy["at"], tz=timezone.utc),
                closed_at=None,
                is_open=True,
                dry_run=bool(open_buy.get("dry_run", True)),
            ))

        positions.reverse()  # newest first, matching the tool's contract
        return positions[:limit]

    def get_recent_trades(self, bot_id: str, limit: int = 100) -> list[TradeRecord]:
        return self._positions(bot_id, limit)

    def get_open_positions(self, bot_id: str) -> list[TradeRecord]:
        return [t for t in self._positions(bot_id, limit=200) if t.is_open]

    # ── writes (human-confirmed only) ────────────────────────────────────────

    def apply_config_change(self, bot_id: str, parameter_key: str, new_value) -> ConfigParam:
        bot = get_bot(bot_id)
        if bot is None:
            raise KeyError(f"Unknown bot: {bot_id}")

        if parameter_key in _BOT_LEVEL_PARAMS:
            setattr(bot.config, parameter_key, float(new_value))
        else:
            schema = getattr(STRATEGIES.get(bot.config.strategy_key), "params_schema", {}) or {}
            if parameter_key not in schema:
                raise KeyError(f"Unknown parameter key: {parameter_key}")
            bot.set_strategy_params({**(bot.config.strategy_params or {}), parameter_key: new_value})

        return next(p for p in self.get_bot_snapshot(bot_id).config if p.key == parameter_key)
