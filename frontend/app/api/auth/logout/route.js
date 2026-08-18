import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete("alma_token");
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } }
  );
}
