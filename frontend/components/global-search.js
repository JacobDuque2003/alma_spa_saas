"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { authFetch } from "@/lib/auth-client";

// Búsqueda global en el sidebar. Por ahora solo clientes — el endpoint
// /clients ya está tenant-scoped por el middleware clientes = [authenticate,
// requirePermission('clientes')]. Cuando se quiera agregar servicios/gabinetes,
// se hacen fetches en paralelo y se agrupan por sección.
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await authFetch("/search", { query: { q: query, limit: 10 } });
        setResults(Array.isArray(rows) ? rows : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => timerRef.current && clearTimeout(timerRef.current);
  }, [q]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectClient(client) {
    router.push(`/admin/clientes?client=${encodeURIComponent(client.id)}`);
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <Search size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#A89A87", pointerEvents: "none" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Buscar clienta…"
          style={{
            width: "100%",
            padding: "8px 12px 8px 32px",
            border: "1px solid rgba(168,154,135,0.4)",
            borderRadius: 999,
            fontSize: 12.5,
            color: "#6B5540",
            background: "#FDFCFA",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(""); setResults([]); setOpen(false); }}
            aria-label="Limpiar"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#A89A87", padding: 2, display: "inline-flex" }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && (loading || results.length > 0) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#F7F5F0",
            border: "1px solid rgba(168,154,135,0.4)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(107,85,64,0.14)",
            maxHeight: 260,
            overflowY: "auto",
            zIndex: 40,
          }}
        >
          {loading ? (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "#A89A87", textAlign: "center" }}>Buscando…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "#A89A87", textAlign: "center" }}>Sin coincidencias</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectClient(c)}
                style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", borderBottom: "1px solid rgba(168,154,135,0.15)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, textAlign: "left" }}
              >
                <span style={{ fontSize: 13, color: "#6B5540", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.name}
                </span>
                <span style={{ fontSize: 11, color: "#A89A87", flexShrink: 0 }}>{c.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
