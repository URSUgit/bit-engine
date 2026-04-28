"""FinBERT-based sentiment scoring for financial text."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

SentimentLabel = Literal["positive", "negative", "neutral"]


@lru_cache(maxsize=1)
def _load_pipeline():
    """Lazy-load FinBERT. Called once on first use."""
    from transformers import pipeline  # type: ignore

    model_name = os.getenv("FINBERT_MODEL_PATH", "ProsusAI/finbert")
    return pipeline("text-classification", model=model_name, top_k=None)


class FinBERTScorer:
    """Wraps the FinBERT model to score financial text snippets."""

    def score(self, text: str) -> dict[SentimentLabel, float]:
        """Return a dict of {label: score} for the given text."""
        pipe = _load_pipeline()
        results = pipe(text[:512])[0]  # FinBERT max input is 512 tokens
        return {item["label"].lower(): item["score"] for item in results}

    def sentiment(self, text: str) -> tuple[SentimentLabel, float]:
        """Return (dominant_label, confidence_0_to_1)."""
        scores = self.score(text)
        label = max(scores, key=scores.__getitem__)
        return label, scores[label]  # type: ignore[return-value]

    def to_direction(self, text: str) -> tuple[str, float]:
        """Map sentiment to BUY/SELL/HOLD with confidence score."""
        label, conf = self.sentiment(text)
        direction_map: dict[SentimentLabel, str] = {
            "positive": "buy",
            "negative": "sell",
            "neutral": "hold",
        }
        return direction_map[label], conf


_scorer: FinBERTScorer | None = None


def get_scorer() -> FinBERTScorer:
    global _scorer
    if _scorer is None:
        _scorer = FinBERTScorer()
    return _scorer
