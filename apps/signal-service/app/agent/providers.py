"""LLM provider abstraction — supports OpenAI and Anthropic."""
from __future__ import annotations

import os
from typing import AsyncIterator

import httpx

PROVIDER = os.getenv("LLM_PROVIDER", "openai").lower()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")


async def complete(messages: list[dict], stream: bool = False) -> str | AsyncIterator[str]:
    if PROVIDER == "anthropic":
        return await _anthropic_complete(messages, stream=stream)
    return await _openai_complete(messages, stream=stream)


async def _openai_complete(messages: list[dict], stream: bool = False) -> str | AsyncIterator[str]:
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": stream,
        "temperature": 0.2,
        "max_tokens": 2048,
    }

    if stream:
        async def _stream() -> AsyncIterator[str]:
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream("POST", "https://api.openai.com/v1/chat/completions",
                                         headers=headers, json=payload) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data: ") and line != "data: [DONE]":
                            import json
                            data = json.loads(line[6:])
                            delta = data["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield delta
        return _stream()

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json={**payload, "stream": False},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _anthropic_complete(messages: list[dict], stream: bool = False) -> str | AsyncIterator[str]:
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), None)
    user_messages = [m for m in messages if m["role"] != "system"]

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": os.getenv("LLM_MODEL", "claude-haiku-4-5-20251001"),
        "max_tokens": 2048,
        "messages": user_messages,
    }
    if system_msg:
        payload["system"] = system_msg

    if stream:
        payload["stream"] = True

        async def _stream() -> AsyncIterator[str]:
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream("POST", "https://api.anthropic.com/v1/messages",
                                         headers=headers, json=payload) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            import json
                            data = json.loads(line[6:])
                            if data.get("type") == "content_block_delta":
                                yield data["delta"].get("text", "")
        return _stream()

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post("https://api.anthropic.com/v1/messages",
                                  headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]
