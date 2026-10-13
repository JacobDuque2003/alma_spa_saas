import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA;
  return NextResponse.json(
    { service: "alma-spa-frontend", commit: commit ? commit.slice(0, 7) : "local" },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
