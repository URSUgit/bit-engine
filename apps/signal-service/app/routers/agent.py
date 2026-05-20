from __future__ import annotations

import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent import core as agent_core
from app.agent.memory import get_store

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    thoughts: list[str]
    tool_calls: list[dict]


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """Non-streaming chat. Runs the full ReAct loop and returns the final answer."""
    session_id = body.session_id or str(uuid.uuid4())
    thoughts: list[str] = []
    tool_calls: list[dict] = []
    answer = ""

    async for event in agent_core.run(session_id, body.message):
        if event["type"] == "thought":
            thoughts.append(event["content"])
        elif event["type"] == "action":
            tool_calls.append({"tool": event["tool"], "args": event["args"]})
        elif event["type"] == "answer":
            answer = event["content"]
        elif event["type"] == "error":
            raise HTTPException(status_code=500, detail=event["content"])

    return ChatResponse(
        session_id=session_id,
        answer=answer,
        thoughts=thoughts,
        tool_calls=tool_calls,
    )


@router.get("/stream")
async def chat_stream(
    message: str = Query(..., description="User message"),
    session_id: Optional[str] = Query(None),
):
    """
    Server-Sent Events streaming chat.
    Each SSE event has a JSON payload: {"type": "thought"|"action"|"observation"|"answer"|"error", ...}
    """
    sid = session_id or str(uuid.uuid4())

    async def event_stream():
        # First event: session id
        yield f"data: {json.dumps({'type': 'session', 'session_id': sid})}\n\n"

        async for event in agent_core.run(sid, message):
            yield f"data: {json.dumps(event)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/session/{session_id}", status_code=204)
async def clear_session(session_id: str):
    """Clear conversation history for a session."""
    get_store().clear(session_id)
