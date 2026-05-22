"""
Simple disciplined strategy framework.

Principle from the article: start with ONE market, ONE signal, ONE timeframe.
Only add complexity once the simple version is consistently profitable.

Key math enforced before every trade:
  breakeven_win_rate = cost / (cost + potential_profit)
If your estimated win rate <= breakeven, skip the trade.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Literal

log = logging.getLogger(__name__)

Side = Literal["YES", "NO", "PASS"]


@dataclass
class TradeDecision:
    side: Side
    price: float            # entry price (0–1)
    size_usdc: float        # USDC to risk
    breakeven_win_rate: float
    estimated_win_rate: float
    expected_value: float
    reason: str


def breakeven_win_rate(entry_price: float) -> float:
    """
    At price p you risk p to win (1-p).
    Break-even: p / 1 = p  →  win_rate_needed = entry_price.
    """
    return entry_price


def expected_value(entry_price: float, estimated_win_rate: float) -> float:
    """EV per $1 risked."""
    win_payout = (1 - entry_price) / entry_price   # ratio
    return estimated_win_rate * win_payout - (1 - estimated_win_rate)


@dataclass
class SimpleStrategy:
    """
    One-signal strategy:
      - Buy YES if yes_price < entry_threshold AND sentiment is positive
      - Buy NO  if yes_price > (1 - entry_threshold) AND sentiment is negative
      - Otherwise PASS

    entry_threshold: max price willing to pay (lower = better value)
    min_win_rate_edge: how much above breakeven our estimate must be
    size_usdc: fixed bet size
    """
    entry_threshold: float = 0.40
    min_win_rate_edge: float = 0.08    # need 8% edge over breakeven
    size_usdc: float = 10.0
    dry_run: bool = True

    # rolling stats (updated by bot after each resolved trade)
    _wins: int = field(default=0, repr=False)
    _losses: int = field(default=0, repr=False)

    @property
    def historical_win_rate(self) -> float:
        total = self._wins + self._losses
        return self._wins / total if total else 0.5

    def record_result(self, won: bool) -> None:
        if won:
            self._wins += 1
        else:
            self._losses += 1

    def evaluate(
        self,
        yes_price: float,
        sentiment_score: float,   # -1 (bearish) to +1 (bullish) for YES outcome
        estimated_win_rate: float | None = None,
    ) -> TradeDecision:
        """
        Returns a TradeDecision. side="PASS" means don't trade.
        estimated_win_rate: override historical if you have a model estimate.
        """
        win_est = estimated_win_rate if estimated_win_rate is not None else self.historical_win_rate

        # BUY YES: market underpriced relative to our estimate
        if yes_price <= self.entry_threshold and sentiment_score > 0:
            be = breakeven_win_rate(yes_price)
            ev = expected_value(yes_price, win_est)
            edge = win_est - be
            if edge >= self.min_win_rate_edge:
                return TradeDecision(
                    side="YES",
                    price=yes_price,
                    size_usdc=self.size_usdc,
                    breakeven_win_rate=round(be, 4),
                    estimated_win_rate=round(win_est, 4),
                    expected_value=round(ev, 4),
                    reason=f"YES underpriced at {yes_price:.2f}, edge={edge:.2%}",
                )
            return TradeDecision(
                side="PASS", price=yes_price, size_usdc=0,
                breakeven_win_rate=round(be, 4), estimated_win_rate=round(win_est, 4),
                expected_value=round(ev, 4),
                reason=f"Insufficient edge: {edge:.2%} < {self.min_win_rate_edge:.2%}",
            )

        # BUY NO: YES overpriced (NO is cheap)
        no_price = round(1 - yes_price, 4)
        if no_price <= self.entry_threshold and sentiment_score < 0:
            be = breakeven_win_rate(no_price)
            ev = expected_value(no_price, win_est)
            edge = win_est - be
            if edge >= self.min_win_rate_edge:
                return TradeDecision(
                    side="NO",
                    price=no_price,
                    size_usdc=self.size_usdc,
                    breakeven_win_rate=round(be, 4),
                    estimated_win_rate=round(win_est, 4),
                    expected_value=round(ev, 4),
                    reason=f"NO underpriced at {no_price:.2f}, edge={edge:.2%}",
                )

        return TradeDecision(
            side="PASS", price=yes_price, size_usdc=0,
            breakeven_win_rate=round(yes_price, 4), estimated_win_rate=round(win_est, 4),
            expected_value=0.0,
            reason="No edge found",
        )
