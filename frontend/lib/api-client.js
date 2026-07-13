export async function publicFetch(path, { method = "GET", body, query } = {}) {
  const url = new URL(`/api/proxy/public${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }

  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || "Error inesperado");
    err.status = res.status;
    throw err;
  }
  return data;
}
