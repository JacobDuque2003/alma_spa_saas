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

  if (res.status === 401) {
    window.location.href = "/admin/login";
    throw new Error("Sesión expirada");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || "Error inesperado");
    err.status = res.status;
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
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/admin/login";
}
