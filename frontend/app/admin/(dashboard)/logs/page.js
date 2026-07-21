"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";

const ENTITY_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "user", label: "Usuarios" },
  { value: "service", label: "Servicios" },
  { value: "room", label: "Gabinetes" },
  { value: "category", label: "Categorías" },
];

const ACTION_LABELS = {
  create: "Creado",
  update: "Editado",
  activate: "Activado",
  deactivate: "Desactivado",
  purge: "Eliminado",
  permissionsChanged: "Permisos",
};

const ACTION_COLORS = {
  create: { bg: "rgba(76,175,80,0.12)", color: "#2E7D32" },
  update: { bg: "rgba(33,150,243,0.12)", color: "#1565C0" },
  activate: { bg: "rgba(76,175,80,0.12)", color: "#2E7D32" },
  deactivate: { bg: "rgba(255,152,0,0.12)", color: "#E65100" },
  purge: { bg: "rgba(244,67,54,0.12)", color: "#C62828" },
  permissionsChanged: { bg: "rgba(156,39,176,0.12)", color: "#7B1FA2" },
};

const inputStyle = {
  padding: "8px 12px",
  border: "1px solid rgba(168,154,135,0.5)",
  borderRadius: 8,
  fontSize: 13,
  color: "#6B5540",
  background: "#FDFCFA",
  outline: "none",
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

function DetailCell({ detail }) {
  if (!detail || typeof detail !== "object") return <span style={{ color: "#A89A87" }}>—</span>;
  return (
    <span style={{ fontSize: 12, color: "#6B5540" }}>
      {Object.entries(detail).map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ", "}
          <b>{k}</b>: {String(v)}
        </span>
      ))}
    </span>
  );
}

export default function LogsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (entity) params.set("entity", entity);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to + "T23:59:59").toISOString());
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const data = await authFetch(`/audit-log?${params}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [entity, from, to, offset]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function applyFilters() {
    setOffset(0);
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
          Registro de actividad
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>
          Historial de cambios administrativos del spa
        </p>
      </div>

      <div
        className="alma-card"
        style={{ padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Tipo</label>
          <select
            value={entity}
            onChange={(e) => { setEntity(e.target.value); setOffset(0); }}
            style={{ ...inputStyle, cursor: "pointer", appearance: "none", minWidth: 130 }}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Desde</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Hasta</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} style={inputStyle} />
        </div>
        {(entity || from || to) && (
          <button
            onClick={() => { setEntity(""); setFrom(""); setTo(""); setOffset(0); }}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(168,154,135,0.5)",
              background: "transparent",
              color: "#6B5540",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="alma-card" style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#A89A87", fontSize: 14 }}>
            No hay registros para los filtros seleccionados.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(168,154,135,0.3)" }}>
                {["Fecha", "Acción", "Entidad", "ID", "Actor", "Detalle"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "12px 14px", fontSize: 11, color: "#A89A87", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ac = ACTION_COLORS[row.action] || { bg: "#eee", color: "#666" };
                return (
                  <tr key={row.id} style={{ borderBottom: "1px solid rgba(168,154,135,0.15)" }}>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#6B5540" }}>{formatDate(row.createdAt)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, background: ac.bg, color: ac.color, fontSize: 11, fontWeight: 600 }}>
                        {ACTION_LABELS[row.action] || row.action}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6B5540", textTransform: "capitalize" }}>{row.entity}</td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: "#A89A87", fontFamily: "monospace" }}>
                      {row.entityId?.slice(0, 10)}…
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6B5540" }}>{row.actorEmail}</td>
                    <td style={{ padding: "10px 14px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <DetailCell detail={row.detail} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button
            disabled={currentPage <= 1}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            style={{ ...inputStyle, cursor: currentPage <= 1 ? "default" : "pointer", opacity: currentPage <= 1 ? 0.4 : 1 }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 13, color: "#6B5540" }}>
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setOffset(offset + limit)}
            style={{ ...inputStyle, cursor: currentPage >= totalPages ? "default" : "pointer", opacity: currentPage >= totalPages ? 0.4 : 1 }}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
