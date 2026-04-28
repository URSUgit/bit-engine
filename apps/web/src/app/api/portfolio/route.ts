import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${GATEWAY}/api/v1/portfolio`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(session as any).accessToken}`,
    },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
