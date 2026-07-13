import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api-server";

export async function POST(req) {
  try {
    const body = await req.json();
    const data = await apiFetch("/auth/login", { method: "POST", body });

    const cookieStore = await cookies();
    cookieStore.set("alma_token", data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return NextResponse.json({ user: data.user });
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: err.status || 500 }
    );
  }
}
