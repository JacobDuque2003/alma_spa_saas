const API_URL = process.env.API_URL || "http://localhost:3001";

export async function apiFetch(path, { method = "GET", body, token, query } = {}) {
  const url = new URL(path, API_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error || "Error inesperado";
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}
