function publishOutOfSchedule(active, nextWindowOpensAt = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("alma:out-of-schedule", {
    detail: { active, nextWindowOpensAt },
  }));
}

export async function authFetch(path, { method = "GET", body, query } = {}) {
  const url = new URL(`/api/proxy${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (res.headers.get("X-Alma-Out-Of-Schedule") === "1") {
    publishOutOfSchedule(true, res.headers.get("X-Alma-Out-Of-Schedule-Next"));
  } else {
    publishOutOfSchedule(false);
  }

  if (res.status === 401) {
    // Clear the (possibly stale) cookie server-side BEFORE redirecting.
    // If we skip this, /admin/login's middleware sees the cookie, bounces
    // us back to /admin/agenda, AuthProvider re-runs /auth/me, gets 401
    // again → reload storm.
    await logout();
    throw new Error("Sesión expirada");
  }

  const data = await res.json().catch(() => null);

  // 403 con reason='outOfSchedule' viene del middleware accessSchedule.
  // En sesión ya iniciada no cerramos sesión: activamos el banner de modo
  // solo lectura y dejamos que la mutación falle con un mensaje claro.
  if (res.status === 403 && data?.reason === "outOfSchedule") {
    publishOutOfSchedule(true, data.nextWindowOpensAt || null);
    const err = new Error(data?.error || "Fuera del horario de acceso permitido");
    err.status = res.status;
    err.reason = data.reason;
    if (data.nextWindowOpensAt) err.nextWindowOpensAt = data.nextWindowOpensAt;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || "Error inesperado");
    err.status = res.status;
    if (data?.reason) err.reason = data.reason;
    if (data?.nextWindowOpensAt) err.nextWindowOpensAt = data.nextWindowOpensAt;
    throw err;
  }
  return data;
}

export async function login(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || "Credenciales inválidas");
    err.status = res.status;
    throw err;
  }
  return data.user;
}

export async function logout() {
  // Best-effort: if the network is down we still want to leave the app.
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  // Limpia flags de session (birthday toast, etc.) para que el próximo
  // login vuelva a mostrar cosas one-shot por sesión.
  try { sessionStorage.removeItem("alma:birthdayToastShown"); } catch { /* noop */ }
  window.location.href = "/admin/login";
}
