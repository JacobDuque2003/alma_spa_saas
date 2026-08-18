import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:3001";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * La cookie de sesión ya usa SameSite=Lax, pero las mutaciones también deben
 * comprobar su procedencia. Así una página de otro sitio no puede reutilizar
 * la sesión del navegador para crear, editar o eliminar información.
 *
 * Algunos clientes no-browser no mandan Origin; se permiten porque no pueden
 * leer la cookie HttpOnly de esta aplicación y sirven para soporte controlado.
 */
function isTrustedMutation(req) {
  if (!MUTATING_METHODS.has(req.method)) return true;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || new URL(req.url).protocol.replace(":", "");
  return origin === `${protocol}://${host}`;
}

async function proxyRequest(req, { params }) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido" }, { status: 403 });
  }

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
    return NextResponse.json({ error: "Backend no disponible" }, { status: 502 });
  }
  const data = await res.text();

  // Datos de clientes, reservas y permisos nunca deben guardarse en cachés del
  // navegador ni de proxies intermedios.
  const responseHeaders = {
    "Content-Type": res.headers.get("Content-Type") || "application/json",
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  };
  const outOfSchedule = res.headers.get("X-Alma-Out-Of-Schedule");
  const outOfScheduleNext = res.headers.get("X-Alma-Out-Of-Schedule-Next");
  if (outOfSchedule) responseHeaders["X-Alma-Out-Of-Schedule"] = outOfSchedule;
  if (outOfScheduleNext) responseHeaders["X-Alma-Out-Of-Schedule-Next"] = outOfScheduleNext;

  if (res.status === 204 || res.status === 205) {
    delete responseHeaders["Content-Type"];
    return new NextResponse(null, {
      status: res.status,
      headers: responseHeaders,
    });
  }

  return new NextResponse(data, {
    status: res.status,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
