import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SIGNAL_SERVICE =
  process.env.NEXT_PUBLIC_SIGNAL_SERVICE_URL ?? "http://localhost:8001";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(
      `${SIGNAL_SERVICE}/api/v1/signals${params ? `?${params}` : ""}`,
      { headers: { "Content-Type": "application/json" } },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
