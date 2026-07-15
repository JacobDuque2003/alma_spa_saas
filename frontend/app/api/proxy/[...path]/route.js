import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:3001";

async function proxyRequest(req, { params }) {
  const { path } = await params;
  const target = `${API_URL}/${path.join("/")}`;
  const url = new URL(target);

  const reqUrl = new URL(req.url);
  reqUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = { "Content-Type": "application/json" };

  const isPublic = path[0] === "public";
  if (!isPublic) {
    const cookieStore = await cookies();
    const token = cookieStore.get("alma_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOpts = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) fetchOpts.body = body;
  }

  let res;
  try {
    res = await fetch(url, fetchOpts);
  } catch (err) {
    return NextResponse.json({
      error: "Backend no disponible",
      detail: err?.message,
      cause: err?.cause?.message || err?.cause?.code || null,
      target: url.toString(),
    }, { status: 502 });
  }
  const data = await res.text();

  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
