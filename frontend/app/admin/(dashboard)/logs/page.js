"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { ChevronDown, Loader2 } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";

const ENTITY_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "user", label: "Usuarios" },
  { value: "service", label: "Servicios" },
  { value: "room", label: "Cabinas" },
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
  create: { bg: "rgba(111,127,69,0.12)", color: "#6F7F45" },
  update: { bg: "rgba(201,168,118,0.16)", color: "#8C6E50" },
  activate: { bg: "rgba(111,127,69,0.12)", color: "#6F7F45" },
  deactivate: { bg: "rgba(154,78,72,0.10)", color: "#9A4E48" },
  purge: { bg: "rgba(154,78,72,0.12)", color: "#9A4E48" },
  permissionsChanged: { bg: "rgba(168,154,135,0.18)", color: "#6B5540" },
};

// Verbos en pasado, coherentes con AuditAction del backend.
const ACTION_VERBS = {
  create: "creó",
  update: "editó",
  activate: "activó",
  deactivate: "desactivó",
  purge: "eliminó",
  permissionsChanged: "cambió los permisos de",
};

// Sustantivo entity + artículo con género correcto en español.
const ENTITY_LABELS = {
  service: { article: "el", noun: "servicio" },
  room: { article: "la", noun: "cabina" },
  category: { article: "la", noun: "categoría" },
  user: { article: "la", noun: "cuenta" },
};

// El actor viene como email (siempre presente en la fila del audit log).
// Preferimos la parte local capitalizada — "jacob@almaspa.com" → "Jacob".
function actorName(email) {
  if (!email) return "Alguien";
  const local = String(email).split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// Nombre legible de la entidad afectada: `detail.name` para service/room/category,
// `detail.email` o `detail.name` para user. Fallback: id truncado.
function entityLabel(row) {
  const detail = row.detail || {};
  if (row.entity === "user") return detail.name || detail.email || (row.entityId ? `${row.entityId.slice(0, 8)}…` : "una cuenta");
  return detail.name || (row.entityId ? `${row.entityId.slice(0, 8)}…` : "un registro");
}

function formatActivity(row) {
  const who = actorName(row.actorEmail);
  const verb = ACTION_VERBS[row.action] || row.action;
  const entity = ENTITY_LABELS[row.entity] || { article: "el", noun: row.entity };
  const name = entityLabel(row);
  return `${who} ${verb} ${entity.article} ${entity.noun} "${name}"`;
}

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

const DETAIL_LABELS = {
  name: "nombre",
  email: "correo",
  role: "rol",
  active: "estado",
  canAttendAppointments: "atiende citas",
  isProtected: "protegida",
  category: "categoría",
  priceUsd: "precio",
  durationMins: "duración",
  bufferMins: "pausa",
  colorHex: "color",
  offersHomeService: "domicilio",
  specialty: "especialidad",
  sortOrder: "orden",
  opensAt: "abre",
  closesAt: "cierra",
  status: "estado",
};

function formatDetailValue(key, value) {
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (key === "priceUsd") return `$${Number(value || 0).toFixed(2)}`;
  if (key === "durationMins" || key === "bufferMins") return `${value} min`;
  return String(value);
}

function DetailCell({ detail }) {
  if (!detail || typeof detail !== "object") return <span style={{ color: "#A89A87" }}>—</span>;
  return (
    <span style={{ fontSize: 12, color: "#6B5540" }}>
      {Object.entries(detail).map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ", "}
          <b>{DETAIL_LABELS[k] || k}</b>: {formatDetailValue(k, v)}
        </span>
      ))}
    </span>
  );
}

export default function LogsPage() {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
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

  const mobileHeaders = ["Fecha", "Acción", "Actividad"];
  const desktopHeaders = ["Fecha", "Acción", "Actividad"];
  const headers = isMobile ? mobileHeaders : desktopHeaders;

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "28px 32px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ marginBottom: isMobile ? 14 : 20 }}>
        <h1 className="font-heading" style={{ fontSize: isMobile ? 22 : 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
          Registro de actividad
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>
          Historial de cambios administrativos del spa
        </p>
      </div>

      <div
        className="alma-card"
        style={{ padding: isMobile ? "10px 12px" : "14px 18px", marginBottom: isMobile ? 10 : 16, display: "flex", gap: isMobile ? 8 : 12, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Tipo</label>
          <select
            value={entity}
            onChange={(e) => { setEntity(e.target.value); setOffset(0); }}
            style={{ ...inputStyle, cursor: "pointer", appearance: "none", minWidth: isMobile ? 100 : 130 }}
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(168,154,135,0.3)" }}>
                {isMobile && <th style={{ width: 32 }} />}
                {headers.map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: isMobile ? "10px 6px" : "12px 14px", fontSize: 11, color: "#A89A87", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ac = ACTION_COLORS[row.action] || { bg: "#eee", color: "#666" };
                const isExpanded = expandedId === row.id;
                return isMobile ? (
                  <MobileRow key={row.id} row={row} ac={ac} isExpanded={isExpanded} onToggle={() => setExpandedId(isExpanded ? null : row.id)} />
                ) : (
                  <tr key={row.id} style={{ borderBottom: "1px solid rgba(168,154,135,0.15)" }}>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#6B5540" }}>{formatDate(row.createdAt)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, background: ac.bg, color: ac.color, fontSize: 11, fontWeight: 600 }}>
                        {ACTION_LABELS[row.action] || row.action}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6B5540", lineHeight: 1.4 }}>
                      <div>{formatActivity(row)}</div>
                      <div style={{ fontSize: 11, color: "#A89A87", marginTop: 4 }}>
                        <DetailCell detail={row.detail} />
                      </div>
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

function MobileRow({ row, ac, isExpanded, onToggle }) {
  const hasDetail = row.detail && typeof row.detail === "object" && Object.keys(row.detail).length > 0;
  return (
    <>
      <tr
        style={{ borderBottom: isExpanded ? "none" : "1px solid rgba(168,154,135,0.15)", cursor: hasDetail ? "pointer" : "default" }}
        onClick={hasDetail ? onToggle : undefined}
      >
        <td style={{ padding: "10px 4px", width: 32, textAlign: "center" }}>
          {hasDetail && (
            <ChevronDown
              size={16}
              style={{
                color: "#A89A87",
                transition: `transform var(--motion-fast) var(--ease-out-quart)`,
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </td>
        <td style={{ padding: "10px 6px", whiteSpace: "nowrap", color: "#6B5540", fontSize: 11 }}>{formatDate(row.createdAt)}</td>
        <td style={{ padding: "10px 6px" }}>
          <span style={{ padding: "2px 8px", borderRadius: 999, background: ac.bg, color: ac.color, fontSize: 10, fontWeight: 600 }}>
            {ACTION_LABELS[row.action] || row.action}
          </span>
        </td>
        <td style={{ padding: "10px 6px", color: "#6B5540", fontSize: 11, lineHeight: 1.35 }}>
          {formatActivity(row)}
        </td>
      </tr>
      {hasDetail && (
        <tr style={{ borderBottom: "1px solid rgba(168,154,135,0.15)" }}>
          <td colSpan={4} style={{ padding: 0 }}>
            <div className={`alma-accordion-body${isExpanded ? " alma-accordion-open" : ""}`}>
              <div style={{ padding: "8px 12px 12px", background: "rgba(168,154,135,0.06)" }}>
                <div style={{ fontSize: 11, color: "#A89A87", marginBottom: 4 }}>
                  <b>ID:</b> <span style={{ fontFamily: "monospace" }}>{row.entityId?.slice(0, 16)}…</span>
                </div>
                <div style={{ fontSize: 11, color: "#6B5540" }}>
                  <b style={{ color: "#A89A87" }}>Detalle:</b>{" "}
                  <DetailCell detail={row.detail} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
