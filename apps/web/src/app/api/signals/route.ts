import { NextRequest, NextResponse } from "next/server";

const GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString();
  const res = await fetch(`${GATEWAY}/api/v1/signals${params ? `?${params}` : ""}`, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 10 },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
