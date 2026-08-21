import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiFetch } from "@/lib/api-server";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("alma_token")?.value;

  // Notificar al backend para que registre el logout en AdminAuditLog.
  // Best-effort: si falla (backend caído, JWT ya inválido, etc.) igual
  // cerramos la sesión del lado del cliente borrando la cookie.
  if (token) {
    try {
      await apiFetch("/auth/logout", { method: "POST", token });
    } catch {
      // ignorado a propósito — la cookie se borra igual abajo
    }
  }

  cookieStore.delete("alma_token");
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } }
  );
}
