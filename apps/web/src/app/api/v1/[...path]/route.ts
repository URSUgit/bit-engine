export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow long-running optimize / backtest runs

import { NextRequest } from "next/server";

// Server-side only — never sent to the browser.
const SIG = process.env.SIGNAL_SERVICE_URL ?? "http://localhost:8001";

async function proxy(req: NextRequest, path: string[]) {
  const search = req.nextUrl.search;
  const upstream = `${SIG}/api/v1/${path.join("/")}${search}`;

  const init: RequestInit = { method: req.method };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    init.body = body || undefined;
    init.headers = { "Content-Type": req.headers.get("Content-Type") ?? "application/json" };
  }

  let res: Response;
  try {
    res = await fetch(upstream, { ...init, cache: "no-store" });
  } catch (e) {
    return Response.json(
      { error: "signal_service_unavailable", detail: String(e) },
      { status: 503 },
    );
  }

  const ct = res.headers.get("Content-Type") ?? "application/json";
  const headers: HeadersInit = { "Content-Type": ct, "Cache-Control": "no-store" };

  if (ct.includes("text/event-stream")) {
    // Stream SSE through without buffering
    headers["Cache-Control"] = "no-cache, no-transform";
    headers["X-Accel-Buffering"] = "no";
  }

  return new Response(res.body, { status: res.status, headers });
}

export function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
