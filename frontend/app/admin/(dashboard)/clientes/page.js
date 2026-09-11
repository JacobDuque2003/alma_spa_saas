"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Search, X, ArrowLeft, Pencil, Trash2, Download, Upload, ArrowUpDown, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { ClientForm } from "@/components/client-form";
import { NewClientModal } from "@/components/new-client-modal";
import { ClientImportModal } from "@/components/client-import-modal";
import { useToast } from "@/components/toast-provider";
import { formatEcuadorPhone } from "@/lib/phone-format";

// Cache breve en memoria del navegador: al volver a Clientes no hay que
// descargar de nuevo las cientos de fichas si nada cambió. Nunca sustituye a
// la base de datos y se invalida en cuanto se crea, edita, importa o cambia
// el estado de una clienta.
const CLIENT_DIRECTORY_CACHE_TTL_MS = 30_000;
const CLIENT_DIRECTORY_PAGE_SIZE = 15;
const clientDirectoryCache = new Map();

function directoryCacheKey(tenantId, query, active, sortKey, sortDirection, pageSize, offset) {
  return [
    tenantId || "current",
    String(query || "").trim().toLocaleLowerCase("es-EC"),
    active || "all",
    sortKey || "fullName",
    sortDirection || "asc",
    pageSize,
    offset,
  ].join(":");
}

function invalidateClientDirectoryCache() {
  clientDirectoryCache.clear();
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "CL";
}

// Reservado para la futura Caja Alma. La ficha ya no muestra movimientos,
// pero este formateador mantiene consistentes los componentes diferidos.
function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function shortDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Guayaquil" });
}

function birthdayDateLabel(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "UTC" });
}

function birthdayCaptionFromDays(daysUntil) {
  if (daysUntil === 0) return "Hoy";
  if (daysUntil === 1) return "Mañana";
  return `En ${daysUntil} días`;
}

const clientSortCollator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
  ignorePunctuation: true,
});

function sortValue(client, key) {
  if (key === "recordNumber") return String(client.recordNumber || "");
  if (key === "whatsapp") return String(client.whatsapp || "").replace(/\D/g, "");
  if (key === "birthday") return client.daysUntil ?? client.birthday ?? "";
  if (key === "active") return client.active === false ? "Deshabilitada" : "Activa";
  return String(client[key] || "");
}

function sortClients(rows, key, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  const isInitialRecordOrder = key === "recordNumber" && direction === "asc";
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aIsEmpty = av === "" || av == null;
    const bIsEmpty = bv === "" || bv == null;

    // Al entrar al directorio se atienden primero las fichas pendientes; a
    // continuación aparecen 1, 2, 3… Para los otros órdenes se conserva el
    // comportamiento habitual: datos vacíos al final.
    if (aIsEmpty !== bIsEmpty) {
      if (isInitialRecordOrder) return aIsEmpty ? -1 : 1;
      return aIsEmpty ? 1 : -1;
    }
    if (aIsEmpty) return clientSortCollator.compare(String(a.fullName || ""), String(b.fullName || ""));

    const comparison = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : clientSortCollator.compare(String(av), String(bv));
    if (comparison !== 0) return comparison * multiplier;

    return clientSortCollator.compare(String(a.fullName || ""), String(b.fullName || ""));
  });
}

function exportFilename() {
  const today = new Date().toISOString().slice(0, 10);
  return `clientes-alma-spa-${today}.csv`;
}

function hasClientPermission(user, key) {
  return !!user && (["superadmin", "dueno"].includes(user.role) || !!user.permissions?.[key]);
}

function ClientFilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 13px",
        borderRadius: 999,
        border: active ? "1px solid rgba(140,110,80,0.0)" : "1px solid rgba(168,154,135,0.35)",
        background: active ? "#8C6E50" : "rgba(253,252,250,0.72)",
        color: active ? "#F7F5F0" : "#8C6E50",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function SortButton({ label, sortKey, activeKey, direction, onSort }) {
  const active = sortKey === activeKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        border: "none",
        background: "none",
        padding: 0,
        color: active ? "#6B5540" : "#A89A87",
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        cursor: "pointer",
      }}
    >
      {label}
      <ArrowUpDown size={12} style={{ opacity: active ? 1 : 0.55, transform: active && direction === "desc" ? "rotate(180deg)" : "none" }} />
    </button>
  );
}

function pageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  if (currentPage <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (currentPage >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page));

  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("gap");
    result.push(page);
  });
  return result;
}

function PaginationButton({ active = false, disabled = false, onClick, children, label }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 34,
        height: 34,
        padding: "0 11px",
        borderRadius: 10,
        border: active ? "1px solid rgba(140,110,80,0)" : "1px solid rgba(168,154,135,0.35)",
        background: active ? "#8C6E50" : "#FDFCFA",
        color: active ? "#F7F5F0" : "#6B5540",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.42 : 1,
        boxShadow: active ? "0 10px 22px rgba(107,85,64,0.14)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function ClientDirectoryRow({ client, selected, view, onSelect, onCopyEmail, isMobile }) {
  const birthdayLabel = client.birthday
    ? `${birthdayDateLabel(client.birthday)}${client.age != null ? ` · ${client.age} años` : client.birthdayYearKnown === false ? " · año pendiente" : ""}`
    : "Sin cumpleaños";
  const statusLabel = client.active === false ? "Deshabilitada" : "Activa";
  const birthdayHint = client.daysUntil !== undefined ? birthdayCaptionFromDays(client.daysUntil) : birthdayLabel;
  const emailValue = client.email || "—";
  const birthdayToday = view === "cumples" && client.daysUntil === 0;
  const confetti = birthdayToday ? <BirthdayRowConfetti /> : null;

  if (isMobile) {
    return (
      <button
        onClick={onSelect}
        className={birthdayToday ? "alma-birthday-row" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 12px",
          borderRadius: 14,
          background: selected ? "linear-gradient(135deg, rgba(235,205,181,0.68), #FDFCFA)" : "linear-gradient(135deg, #FFFFFF, rgba(253,252,250,0.86))",
          border: selected ? "1px solid rgba(201,168,118,0.62)" : "1px solid rgba(201,168,118,0.28)",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
          boxShadow: selected ? "0 16px 34px rgba(107,85,64,0.14)" : "0 10px 24px rgba(107,85,64,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {confetti}
        <span style={{ width: 38, height: 38, borderRadius: "50%", background: selected ? "#C9A876" : "rgba(201,168,118,0.32)", color: selected ? "#F7F5F0" : "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {initials(client.fullName)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.fullName}</div>
          <div style={{ fontSize: 12, color: "#A89A87", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.recordNumber ? `Ficha ${client.recordNumber} · ` : ""}{formatEcuadorPhone(client.whatsapp)}{client.email ? ` · ${client.email}` : ""}
          </div>
          {view === "cumples" && <div style={{ marginTop: 2, fontSize: 12, color: "#8C6E50", fontWeight: 700 }}>{birthdayHint}</div>}
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={birthdayToday ? "alma-birthday-row" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "82px minmax(210px,1.25fr) minmax(150px,0.8fr) minmax(220px,1fr) minmax(140px,0.7fr) 104px",
        gap: 12,
        alignItems: "center",
        minWidth: 980,
        minHeight: 62,
        padding: "10px 12px",
        borderRadius: 16,
        border: selected ? "1px solid rgba(201,168,118,0.62)" : "1px solid rgba(201,168,118,0.24)",
        background: selected ? "linear-gradient(135deg, rgba(235,205,181,0.56), rgba(253,252,250,0.98))" : "linear-gradient(135deg, #FFFFFF, rgba(253,252,250,0.82))",
        boxShadow: selected ? "0 18px 38px rgba(107,85,64,0.15), inset 0 1px 0 rgba(255,255,255,0.82)" : "0 12px 28px rgba(107,85,64,0.07), inset 0 1px 0 rgba(255,255,255,0.92)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {confetti}
      <div style={{ fontSize: 12, color: client.recordNumber ? "#6B5540" : "#A89A87", fontWeight: 700 }}>
        {client.recordNumber || "—"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: selected ? "#C9A876" : "rgba(201,168,118,0.28)", color: selected ? "#F7F5F0" : "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
          {initials(client.fullName)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "#6B5540", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.fullName}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#8C6E50", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatEcuadorPhone(client.whatsapp)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: client.email ? "#6B5540" : "#A89A87", fontWeight: client.email ? 650 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {emailValue}
        </span>
        {client.email && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopyEmail(client.email); }}
            aria-label={`Copiar correo de ${client.fullName}`}
            style={{ width: 28, height: 28, borderRadius: 10, border: "1px solid rgba(168,154,135,0.22)", background: "rgba(247,245,240,0.74)", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <Copy size={13} />
          </button>
        )}
      </div>
      <div>
        <div style={{ fontSize: 12, color: "#6B5540", fontWeight: 700 }}>{view === "cumples" ? birthdayHint : birthdayLabel}</div>
        {view === "cumples" && client.birthday && <div style={{ fontSize: 11, color: "#A89A87" }}>{birthdayDateLabel(client.birthday)}</div>}
      </div>
      <span style={{ justifySelf: "start", padding: "5px 10px", borderRadius: 999, background: client.active === false ? "rgba(168,79,74,0.08)" : "rgba(92,122,64,0.10)", color: client.active === false ? "#A84F4A" : "#5C7A40", fontSize: 11, fontWeight: 800 }}>
        {statusLabel}
      </span>
    </div>
  );
}

function BirthdayRowConfetti() {
  return (
    <span className="alma-birthday-row-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
    </span>
  );
}

function ClientTabButton({ active, label, meta, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "13px 16px",
        border: "none",
        borderBottom: active ? "3px solid #8C6E50" : "3px solid transparent",
        background: active ? "rgba(253,252,250,0.9)" : "transparent",
        color: active ? "#6B5540" : "#8C6E50",
        fontSize: 13,
        fontWeight: active ? 800 : 650,
        cursor: "pointer",
        whiteSpace: "nowrap",
        minHeight: 48,
      }}
    >
      <span>{label}</span>
      {meta !== undefined && (
        <span style={{ fontSize: 11, color: active ? "#F7F5F0" : "#8C6E50", background: active ? "#8C6E50" : "rgba(201,168,118,0.18)", borderRadius: 999, padding: "2px 7px", fontWeight: 800 }}>
          {meta}
        </span>
      )}
    </button>
  );
}

function PersonalInfoItem({ label, value, action }) {
  return (
    <div style={{ padding: "13px 14px", borderRadius: 14, background: "rgba(253,252,250,0.74)", border: "1px solid rgba(168,154,135,0.18)", minWidth: 0 }}>
      <div style={{ color: "#A89A87", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.45, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <strong style={{ color: "#6B5540", fontSize: 14, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || "—"}</strong>
        {action}
      </div>
    </div>
  );
}

const ANTECEDENT_OPTIONS = [
  "Epilepsia",
  "Diabetes",
  "Artritis",
  "Hirsutismo",
  "Melanomas",
  "Dermatitis",
  "Lupus",
  "Alergias",
  "Insuficiencia renal",
  "Problemas respiratorios",
  "Problemas hepáticos",
  "Dispositivo anticonceptivo",
  "Problemas de tiroides",
  "Hipertensión",
  "Problemas gástricos",
  "Lactancia",
  "Embarazo",
  "Vitíligo",
  "Vértigo",
  "Cáncer",
  "Asma",
  "Várices",
  "Ovario poliquístico",
];

function parseChecklistText(value = "") {
  const text = String(value || "");
  const answerMatch = text.match(/Antecedentes:\s*([^\n]+)/i);
  const markedMatch = text.match(/Antecedentes marcados:\s*([^\n]+)/i);
  const notesMatch = text.match(/Observaciones:\s*([\s\S]+)/i);
  const answers = {};
  if (answerMatch) {
    answerMatch[1].split(";").forEach((part) => {
      const [rawName, rawValue] = part.split("=");
      const name = rawName?.trim();
      const value = rawValue?.trim()?.toUpperCase();
      if (name && ["SI", "NO"].includes(value)) answers[name] = value;
    });
  }
  const selected = markedMatch
    ? markedMatch[1].split(";").map((x) => x.trim()).filter(Boolean)
    : Object.entries(answers).filter(([, v]) => v === "SI").map(([k]) => k);
  return {
    selected,
    answers,
    notes: notesMatch ? notesMatch[1].trim() : (!markedMatch && !answerMatch ? text.trim() : ""),
  };
}

function buildChecklistText(answers, notes) {
  const parts = [];
  const answered = Object.entries(answers || {}).filter(([, value]) => ["SI", "NO"].includes(value));
  if (answered.length) parts.push(`Antecedentes: ${answered.map(([key, value]) => `${key}=${value}`).join("; ")}`);
  if (notes.trim()) parts.push(`Observaciones: ${notes.trim()}`);
  return parts.join("\n");
}

export default function ClientesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  // Preselección desde <GlobalSearch>: /admin/clientes?client=<id>
  const preselectedId = searchParams.get("client");
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(preselectedId || null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [birthdayList, setBirthdayList] = useState([]);
  const [birthdayLoading, setBirthdayLoading] = useState(false);
  const [clientTotal, setClientTotal] = useState(0);
  const [clientPage, setClientPage] = useState(1);
  const [clientLoadError, setClientLoadError] = useState("");
  const [detail, setDetail] = useState(null);
  const [intake, setIntake] = useState(null);
  const [treatments, setTreatments] = useState([]);
  const [clientAppointments, setClientAppointments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSectionsLoaded, setDetailSectionsLoaded] = useState({ summary: false, intake: false, timeline: false });
  const isMobile = useIsMobile();
  const toast = useToast();
  const [mobileShowDetail, setMobileShowDetail] = useState(Boolean(preselectedId));
  const [sortKey, setSortKey] = useState("recordNumber");
  const [sortDirection, setSortDirection] = useState("asc");
  const [actionClient, setActionClient] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState("resumen");
  const canEditClients = hasClientPermission(user, "clientesEditar");
  const canEditIntake = hasClientPermission(user, "clientesAnamnesis");
  const canEditHistory = hasClientPermission(user, "clientesHistorial");
  const canToggleClientStatus = hasClientPermission(user, "clientesEstado");
  // clientesExportar es exclusivo — igual que el backend, sin fallbacks a
  // reportes/configuracion, para que el toggle en Equipo controle exactamente
  // la accion que promete.
  const canExportClients = hasClientPermission(user, "clientesExportar");
  const clientActiveQuery = statusFilter === "activas" ? "true" : statusFilter === "deshabilitadas" ? "false" : "all";

  const fetchClients = useCallback(async ({ force = false } = {}) => {
    const offset = (clientPage - 1) * CLIENT_DIRECTORY_PAGE_SIZE;
    const cacheKey = directoryCacheKey(user?.tenantId, query, clientActiveQuery, sortKey, sortDirection, CLIENT_DIRECTORY_PAGE_SIZE, offset);
    const cached = clientDirectoryCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.savedAt < CLIENT_DIRECTORY_CACHE_TTL_MS) {
      setClients(cached.rows);
      setClientTotal(cached.total);
      setClientLoadError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setClientLoadError("");
    try {
      const data = await authFetch("/clients", {
        query: {
          active: clientActiveQuery,
          limit: CLIENT_DIRECTORY_PAGE_SIZE,
          offset,
          total: "true",
          sortKey,
          sortDirection,
          ...(query ? { q: query } : {}),
        },
      });
      const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : rows.length;
      clientDirectoryCache.set(cacheKey, { rows, total, savedAt: Date.now() });
      setClients(rows);
      setClientTotal(total);
    } catch (err) {
      setClientLoadError(err.message || "No se pudo cargar clientes.");
      setClients([]);
      setClientTotal(0);
    } finally {
      setLoading(false);
    }
  }, [clientActiveQuery, clientPage, query, sortDirection, sortKey, user?.tenantId]);

  useEffect(() => {
    if (view === "cumples") return undefined;
    const t = setTimeout(() => fetchClients(), 250);
    return () => clearTimeout(t);
  }, [fetchClients, view]);

  const fetchBirthdays = useCallback(async () => {
    setBirthdayLoading(true);
    try {
      const rows = await authFetch("/clients/birthdays", { query: { days: 8 } });
      setBirthdayList(Array.isArray(rows) ? rows : []);
    } catch {
      setBirthdayList([]);
    } finally {
      setBirthdayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "cumples") fetchBirthdays();
  }, [view, fetchBirthdays]);

  useEffect(() => {
    setDetail(null);
    setIntake(null);
    setTreatments([]);
    setClientAppointments([]);
    setDetailSectionsLoaded({ summary: false, intake: false, timeline: false });
  }, [selectedId]);

  const fetchDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      const [clientData, appointmentData] = await Promise.all([
        authFetch(`/clients/${selectedId}`),
        authFetch("/appointments", { query: { clientId: selectedId } }).catch(() => []),
      ]);
      setDetail(clientData);
      setClientAppointments(Array.isArray(appointmentData) ? appointmentData : []);
      setDetailSectionsLoaded((prev) => ({ ...prev, summary: true }));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const fetchIntake = useCallback(async ({ force = false } = {}) => {
    if (!selectedId || (!force && detailSectionsLoaded.intake)) return;
    try {
      const intakeData = await authFetch(`/clients/${selectedId}/intake`).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
      setIntake(intakeData);
      setDetailSectionsLoaded((prev) => ({ ...prev, intake: true }));
    } catch {
      setIntake(null);
      setDetailSectionsLoaded((prev) => ({ ...prev, intake: true }));
    }
  }, [detailSectionsLoaded.intake, selectedId]);

  const fetchTimeline = useCallback(async ({ force = false } = {}) => {
    if (!selectedId || (!force && detailSectionsLoaded.timeline)) return;
    try {
      const [treatmentsData, appointmentData] = await Promise.all([
        authFetch(`/clients/${selectedId}/treatments`).catch(() => []),
        authFetch("/appointments", { query: { clientId: selectedId } }).catch(() => []),
      ]);
      setTreatments(Array.isArray(treatmentsData) ? treatmentsData : []);
      setClientAppointments(Array.isArray(appointmentData) ? appointmentData : []);
      setDetailSectionsLoaded((prev) => ({ ...prev, timeline: true }));
    } catch {
      setTreatments([]);
      setClientAppointments([]);
      setDetailSectionsLoaded((prev) => ({ ...prev, timeline: true }));
    }
  }, [detailSectionsLoaded.timeline, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (activeTab === "anamnesis") fetchIntake();
    if (activeTab === "historial") fetchTimeline();
  }, [activeTab, fetchIntake, fetchTimeline, selectedId]);

  const [showEditClient, setShowEditClient] = useState(false);
  const [showDeleteClient, setShowDeleteClient] = useState(false);
  const [showEditIntake, setShowEditIntake] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [showImportClients, setShowImportClients] = useState(false);
  const editClientAnim = useAnimatedMount(showEditClient, 220);
  const deleteClientAnim = useAnimatedMount(showDeleteClient, 220);
  const editIntakeAnim = useAnimatedMount(showEditIntake, 220);
  const newClientAnim = useAnimatedMount(showNewClient, 220);
  const importClientsAnim = useAnimatedMount(showImportClients, 220);
  const mobileDetailAnim = useAnimatedMount(isMobile && mobileShowDetail, 220);

  function openClientDetail(clientId) {
    setSelectedId(clientId);
    setActiveTab("resumen");
    if (isMobile) setMobileShowDetail(true);
    router.push(`/admin/clientes?client=${encodeURIComponent(clientId)}`, { scroll: false });
  }

  function closeClientDetail() {
    router.push("/admin/clientes", { scroll: false });
    setSelectedId(null);
    setDetail(null);
    setIntake(null);
    setTreatments([]);
    setClientAppointments([]);
    setMobileShowDetail(false);
    setActiveTab("resumen");
  }

  useEffect(() => {
    if (preselectedId) {
      setSelectedId(preselectedId);
      setActiveTab("resumen");
      if (isMobile) setMobileShowDetail(true);
      return;
    }
    setSelectedId(null);
    setDetail(null);
    setIntake(null);
    setTreatments([]);
    setClientAppointments([]);
    setMobileShowDetail(false);
    setActiveTab("resumen");
  }, [isMobile, preselectedId]);

  const visibleClients = useMemo(() => {
    const source = view === "cumples" ? birthdayList : clients;
    const filtered = source.filter((client) => {
      if (statusFilter === "activas") return client.active !== false;
      if (statusFilter === "deshabilitadas") return client.active === false;
      return true;
    });
    if (view !== "cumples") return filtered;
    return sortClients(filtered, sortKey === "birthday" ? "birthday" : sortKey, sortDirection);
  }, [birthdayList, clients, sortDirection, sortKey, statusFilter, view]);
  const currentCount = visibleClients.length;
  const directoryTotal = view === "cumples" ? currentCount : clientTotal;
  const totalPages = view === "cumples" ? 1 : Math.max(1, Math.ceil(clientTotal / CLIENT_DIRECTORY_PAGE_SIZE));
  const directoryPageStart = view === "cumples" || currentCount === 0 ? 0 : ((clientPage - 1) * CLIENT_DIRECTORY_PAGE_SIZE) + 1;
  const directoryPageEnd = view === "cumples" ? currentCount : currentCount === 0 ? 0 : Math.min(clientTotal, directoryPageStart + currentCount - 1);
  const paginationItems = view === "cumples" ? [] : pageNumbers(clientPage, totalPages);
  const listLoading = view === "cumples" ? birthdayLoading : loading;
  const statusFilterLabel = statusFilter === "activas" ? "Activas" : statusFilter === "deshabilitadas" ? "Deshabilitadas" : "Todas";

  useEffect(() => {
    if (view !== "cumples" && clientTotal > 0 && clientPage > totalPages) {
      setClientPage(totalPages);
    }
  }, [clientPage, clientTotal, totalPages, view]);

  function changeSort(key) {
    setClientPage(1);
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(key === "createdAt" || key === "birthday" ? "desc" : "asc");
      return key;
    });
  }

  function cycleStatusFilter() {
    setClientPage(1);
    setStatusFilter((current) => {
      if (current === "todas") return "activas";
      if (current === "activas") return "deshabilitadas";
      return "todas";
    });
  }

  async function handleExportClients() {
    if (!canExportClients || exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/proxy/clients/export", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "No se pudo exportar clientes");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Exportación de clientas lista");
    } catch (err) {
      toast.error(err.message || "No se pudo exportar clientes");
    } finally {
      setExporting(false);
    }
  }

  async function handleEnableClient(clientId = selectedId) {
    if (!clientId) return;
    try {
      await authFetch(`/clients/${clientId}/enable`, { method: "PATCH" });
      toast.success("Clienta habilitada");
      setView("todas");
      setSelectedId(clientId);
      invalidateClientDirectoryCache();
      fetchClients({ force: true });
      fetchDetail();
    } catch (err) {
      toast.error(err.message || "No se pudo habilitar la clienta");
    }
  }

  async function handleCopyEmail(email) {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Correo copiado");
    } catch {
      toast.error("No se pudo copiar el correo");
    }
  }

  const appointmentCount = clientAppointments.length;
  const treatmentCount = treatments.length;
  const tabItems = [
    { key: "resumen", label: "Resumen", meta: appointmentCount },
    { key: "anamnesis", label: "Anamnesis", meta: intake?.consentSigned ? "Firmada" : "Sin firma" },
    { key: "historial", label: "Historial", meta: treatmentCount + appointmentCount },
  ];

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {newClientAnim.shouldRender && (
        <NewClientModal
          phase={newClientAnim.phase}
          onClose={() => setShowNewClient(false)}
          onSaved={(created) => {
            setShowNewClient(false);
            invalidateClientDirectoryCache();
            setClientTotal((total) => total + 1);
            setClientPage(1);
            setClients((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
            openClientDetail(created.id);
          }}
        />
      )}
      {importClientsAnim.shouldRender && (
        <ClientImportModal
          phase={importClientsAnim.phase}
          onClose={() => setShowImportClients(false)}
          onImported={() => { invalidateClientDirectoryCache(); setClientPage(1); fetchClients({ force: true }); }}
        />
      )}
      {/* Sidebar list */}
      {(!selectedId || (isMobile && !mobileShowDetail)) && (
      <div
        style={{
          width: "100%",
          flex: "1 1 auto",
          borderRight: "none",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, rgba(247,245,240,0.78), rgba(253,252,250,0.55))",
        }}
      >
        <div style={{ padding: isMobile ? "22px 16px 14px" : "28px 34px 16px" }}>
          <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: 16, marginBottom: 18, flexDirection: isMobile ? "column" : "row" }}>
            <div>
              <h1 className="font-heading" style={{ fontSize: isMobile ? 28 : 34, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                Clientes
              </h1>
              <span style={{ display: "block", marginTop: 4, fontSize: 13, color: "#A89A87" }}>
                {directoryTotal} {directoryTotal === 1 ? "clienta" : "clientas"} en total
                {view !== "cumples" && directoryTotal > 0 ? ` · mostrando ${directoryPageStart}-${directoryPageEnd}` : ""}
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
              {canExportClients && (
                <button
                  type="button"
                  onClick={handleExportClients}
                  disabled={exporting}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid rgba(140,110,80,0.38)",
                    background: "#FDFCFA",
                    color: "#8C6E50",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: exporting ? "wait" : "pointer",
                    opacity: exporting ? 0.65 : 1,
                    whiteSpace: "nowrap",
                    flex: isMobile ? 1 : "initial",
                  }}
                >
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Exportar
                </button>
              )}
              {canEditClients && (
                <button type="button" onClick={() => setShowImportClients(true)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 16px", borderRadius: 999, border: "1px solid rgba(140,110,80,0.38)", background: "#FDFCFA", color: "#8C6E50", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", flex: isMobile ? 1 : "initial" }}><Upload size={14} />Importar Excel</button>
              )}
              {canEditClients && (
                <button
                  onClick={() => setShowNewClient(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 18px",
                    borderRadius: 999,
                    border: "none",
                    background: "#8C6E50",
                    color: "#F7F5F0",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    flex: isMobile ? 1 : "initial",
                  }}
                >
                  + Nueva clienta
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 420px) 1fr", gap: 12, alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#FDFCFA",
                border: "1px solid rgba(168,154,135,0.5)",
                borderRadius: 999,
                padding: "11px 16px",
              }}
            >
              <Search size={13} style={{ color: "#A89A87", flexShrink: 0 }} />
              <input
                style={{
                  border: "none",
                  background: "none",
                  outline: "none",
                  fontSize: 14,
                  color: "#6B5540",
                  width: "100%",
                }}
                placeholder="Busca por nombre, ficha, teléfono, correo o cédula..."
                value={query}
                onChange={(e) => {
                  setClientPage(1);
                  setSortKey("recordNumber");
                  setSortDirection("asc");
                  setQuery(e.target.value);
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, justifyContent: isMobile ? "flex-start" : "flex-end" }}>
              <ClientFilterButton active={view === "todas"} onClick={() => { setClientPage(1); setView("todas"); }}>
                Todas
              </ClientFilterButton>
              <ClientFilterButton active={view === "cumples"} onClick={() => { setClientPage(1); setView("cumples"); }}>
                Cumpleaños
              </ClientFilterButton>
              <ClientFilterButton active={statusFilter !== "todas"} onClick={cycleStatusFilter}>
                Estado: {statusFilterLabel}
              </ClientFilterButton>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", margin: isMobile ? "0 12px 12px" : "0 34px 28px", padding: 0, overflow: "hidden", gap: 6, minHeight: 0 }}>
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "82px minmax(210px,1.25fr) minmax(150px,0.8fr) minmax(220px,1fr) minmax(140px,0.7fr) 104px",
                gap: 12,
                minWidth: 980,
                padding: "0 12px 12px",
                alignItems: "center",
                borderBottom: "1px solid rgba(168,154,135,0.22)",
                marginBottom: 8,
              }}
            >
              <SortButton label="Ficha" sortKey="recordNumber" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Clienta" sortKey="fullName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Teléfono" sortKey="whatsapp" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Email" sortKey="email" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Cumpleaños" sortKey="birthday" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Estado" sortKey="active" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 7, paddingRight: isMobile ? 0 : 4 }}>
          {listLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
            </div>
          ) : clientLoadError ? (
            <p style={{ textAlign: "center", padding: "40px 12px", fontSize: 13, color: "#C25450" }}>
              {clientLoadError}
            </p>
          ) : visibleClients.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 12px", fontSize: 13, color: "#A89A87" }}>
              {view === "cumples" ? "Sin cumpleaños en los próximos 8 días." : "Sin resultados."}
            </p>
          ) : (
            <>
              {visibleClients.map((client) => (
                <ClientDirectoryRow
                  key={client.id}
                  client={client}
                  view={view}
                  selected={client.id === selectedId}
                  isMobile={isMobile}
                  onSelect={() => openClientDetail(client.id)}
                  onCopyEmail={handleCopyEmail}
                />
              ))}
            </>
          )}
          </div>
          {view !== "cumples" && directoryTotal > CLIENT_DIRECTORY_PAGE_SIZE && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: isMobile ? "10px 2px 0" : "12px 4px 0",
                borderTop: "1px solid rgba(168,154,135,0.20)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 12, color: "#A89A87", fontWeight: 700 }}>
                Página {clientPage} de {totalPages} · {CLIENT_DIRECTORY_PAGE_SIZE} por página
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 2 }}>
                <PaginationButton
                  label="Página anterior"
                  disabled={clientPage <= 1 || loading}
                  onClick={() => setClientPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft size={15} />
                </PaginationButton>
                {paginationItems.map((item, index) => item === "gap" ? (
                  <span key={`gap-${index}`} style={{ width: 18, textAlign: "center", color: "#A89A87", fontWeight: 800 }}>...</span>
                ) : (
                  <PaginationButton
                    key={item}
                    active={item === clientPage}
                    disabled={loading}
                    label={`Página ${item}`}
                    onClick={() => setClientPage(item)}
                  >
                    {item}
                  </PaginationButton>
                ))}
                <PaginationButton
                  label="Página siguiente"
                  disabled={clientPage >= totalPages || loading}
                  onClick={() => setClientPage((page) => Math.min(totalPages, page + 1))}
                >
                  <ChevronRight size={15} />
                </PaginationButton>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Detail panel */}
      {selectedId && (!isMobile || mobileDetailAnim.shouldRender) && (
      <div key={isMobile ? undefined : selectedId} className={isMobile ? `alma-slide-right alma-anim-${mobileDetailAnim.phase}` : "alma-stagger"} style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "26px 34px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", background: "linear-gradient(135deg, rgba(247,245,240,0.62), rgba(253,252,250,0.55))" }}>
        <button
            onClick={closeClientDetail}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 4px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#8C6E50",
              fontSize: 14,
              fontWeight: 500,
              minHeight: 44,
              alignSelf: "flex-start",
            }}
          >
            <ArrowLeft size={18} />
            Volver a clientes
          </button>
        {!selectedId ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A89A87", fontSize: 14 }}>
            Selecciona una clienta para ver su ficha.
          </div>
        ) : detailLoading && !detail ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Loader2 size={24} className="animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : detail ? (
          <>
            {editClientAnim.shouldRender && (
              <EditClientModal
                client={actionClient || detail}
                phase={editClientAnim.phase}
                onClose={() => { setShowEditClient(false); setActionClient(null); }}
                onSaved={() => { setShowEditClient(false); setActionClient(null); invalidateClientDirectoryCache(); fetchDetail(); fetchClients({ force: true }); }}
              />
            )}
            {deleteClientAnim.shouldRender && (
              <DeleteClientModal
                client={actionClient || detail}
                phase={deleteClientAnim.phase}
                onClose={() => { setShowDeleteClient(false); setActionClient(null); }}
                onDeleted={() => {
                  setShowDeleteClient(false);
                  setActionClient(null);
                  setDetail(null);
                  setSelectedId(null);
                  setClientTotal((total) => Math.max(total - 1, 0));
                  invalidateClientDirectoryCache();
                  fetchClients({ force: true });
                }}
              />
            )}
            {editIntakeAnim.shouldRender && (
              <EditIntakeModal
                clientId={selectedId}
                intake={intake}
                phase={editIntakeAnim.phase}
                onClose={() => setShowEditIntake(false)}
                onSaved={() => { setShowEditIntake(false); fetchIntake({ force: true }); }}
              />
            )}
            {/* Header */}
            <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16 }}>
                <span
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "#C9A876",
                    color: "#F7F5F0",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 600,
                  }}
                >
                  {initials(detail.fullName)}
                </span>
                <div>
                  <h2 className="font-heading" style={{ fontSize: isMobile ? 22 : 28, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                    {detail.fullName}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#A89A87" }}>
                    <span style={{ display: "inline-flex", marginTop: 6, alignItems: "center", width: "fit-content", borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800, color: detail.active === false ? "#9A4E48" : "#5C7A40", background: detail.active === false ? "rgba(194,84,80,0.08)" : "rgba(92,122,64,0.10)" }}>
                      {detail.active === false ? "Deshabilitada" : "Activa"}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {canEditClients && (
                  <button
                    onClick={() => setShowEditClient(true)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "9px 20px",
                      borderRadius: 999,
                      border: "1px solid rgba(168,154,135,0.5)",
                      background: "rgba(253,252,250,0.72)",
                      color: "#6B5540",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Editar datos
                  </button>
                )}
                {canToggleClientStatus && detail.active === false ? (
                  <button
                    onClick={handleEnableClient}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "9px 16px",
                      borderRadius: 999,
                      border: "1px solid rgba(92,122,64,0.38)",
                      background: "rgba(92,122,64,0.08)",
                      color: "#5C7A40",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Habilitar
                  </button>
                ) : canToggleClientStatus ? (
                  <button
                    onClick={() => setShowDeleteClient(true)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "9px 16px",
                      borderRadius: 999,
                      border: "1px solid rgba(194,84,80,0.38)",
                      background: "rgba(194,84,80,0.06)",
                      color: "#9A4E48",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Deshabilitar
                  </button>
                ) : null}
                <Link
                  href="/admin/crm"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "9px 20px",
                    borderRadius: 999,
                    border: "1px solid #8C6E50",
                    color: "#8C6E50",
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Abrir chat
                </Link>
                <Link
                  href={`/admin/agenda?clientId=${selectedId}&clientName=${encodeURIComponent(detail.fullName)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "9px 20px",
                    borderRadius: 999,
                    background: "#8C6E50",
                    color: "#F7F5F0",
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  + Nueva reserva
                </Link>
              </div>
            </div>

            <div className="alma-card" style={{ padding: 0, overflow: "hidden", border: "1px solid rgba(168,154,135,0.24)", background: "rgba(253,252,250,0.82)" }}>
              <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid rgba(168,154,135,0.22)", background: "rgba(235,232,225,0.34)" }}>
                {tabItems.map((tab) => (
                  <ClientTabButton
                    key={tab.key}
                    active={activeTab === tab.key}
                    label={tab.label}
                    meta={tab.meta}
                    onClick={() => setActiveTab(tab.key)}
                  />
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              {activeTab === "resumen" && <ClientPersonalSummaryCard client={detail} appointments={clientAppointments} canEdit={canEditClients} onEdit={() => setShowEditClient(true)} onCopyEmail={handleCopyEmail} />}
              {activeTab === "anamnesis" && <IntakeCard intake={intake} canEdit={canEditIntake} onEdit={() => setShowEditIntake(true)} />}
              {activeTab === "historial" && <TreatmentsCard treatments={treatments} appointments={clientAppointments} clientId={selectedId} canEdit={canEditHistory} onSaved={() => fetchTimeline({ force: true })} />}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A89A87", fontSize: 14 }}>
            No se pudo cargar el cliente.
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function ClientPersonalSummaryCard({ client, appointments, canEdit, onEdit, onCopyEmail }) {
  const birthday = client?.birthday ? birthdayDateLabel(client.birthday) : "Sin fecha";
  const age = client?.age != null ? `${client.age} años` : client?.birthday && client?.birthdayYearKnown === false ? "Año pendiente" : "Sin edad";
  const email = client?.email || "Sin correo";
  const orderedAppointments = [...(appointments || [])].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const nextAppointment = orderedAppointments.find((appointment) => new Date(appointment.startsAt) >= new Date() && appointment.status !== "cancelado");
  const previousAppointments = orderedAppointments.filter((appointment) => new Date(appointment.startsAt) < new Date() && appointment.status !== "cancelado");
  const lastAppointment = previousAppointments[previousAppointments.length - 1];

  return (
    <div style={{ display: "flex", minWidth: 0 }}>
      <div
        className="alma-card"
        onClick={canEdit ? onEdit : undefined}
        title={canEdit ? "Editar información de la clienta" : undefined}
        style={{ width: "100%", padding: 24, background: "linear-gradient(135deg, rgba(253,252,250,0.98), rgba(235,205,181,0.16))", border: "1px solid rgba(201,168,118,0.24)", boxShadow: "0 22px 55px rgba(107,85,64,0.08)", cursor: canEdit ? "pointer" : "default" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <h3 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>Perfil de la clienta</h3>
            <p style={{ margin: "4px 0 0", color: "#A89A87", fontSize: 13 }}>Contacto, ficha y seguimiento de atención.</p>
          </div>
          <span style={{ borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 800, color: client?.active === false ? "#9A4E48" : "#5C7A40", background: client?.active === false ? "rgba(194,84,80,0.08)" : "rgba(92,122,64,0.10)" }}>
            {client?.active === false ? "Deshabilitada" : "Activa"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <PersonalInfoItem label="Ficha" value={client?.recordNumber || "Sin número"} />
          <PersonalInfoItem label="Teléfono" value={formatEcuadorPhone(client?.whatsapp) || "Sin teléfono"} />
          <PersonalInfoItem label="Cédula" value={client?.cedula || "Sin cédula"} />
          <PersonalInfoItem
            label="Correo"
            value={email}
            action={client?.email ? (
              <button type="button" onClick={(event) => { event.stopPropagation(); onCopyEmail(client.email); }} title="Copiar correo" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(168,154,135,0.28)", background: "#FDFCFA", color: "#8C6E50", cursor: "pointer", flexShrink: 0 }}>
                <Copy size={13} />
              </button>
            ) : null}
          />
          <PersonalInfoItem label="Cumpleaños" value={`${birthday} · ${age}`} />
          <PersonalInfoItem label="Clienta desde" value={shortDate(client?.createdAt)} />
          <PersonalInfoItem label="Dirección" value={client?.address || "Sin dirección"} />
          <PersonalInfoItem label="Próxima reserva" value={nextAppointment ? `${shortDate(nextAppointment.startsAt)} · ${nextAppointment.service?.name || "Reserva"}` : "Sin reserva próxima"} />
          <PersonalInfoItem label="Última atención" value={lastAppointment ? `${shortDate(lastAppointment.startsAt)} · ${lastAppointment.service?.name || "Reserva"}` : "Sin atenciones aún"} />
        </div>
      </div>
    </div>
  );
}

function intakeTone(value) {
  if (value === "SI") {
    return { bg: "rgba(142,36,170,0.08)", border: "rgba(142,36,170,0.18)", chipBg: "#8E24AA", chipColor: "#FFFFFF" };
  }
  if (value === "NO") {
    return { bg: "rgba(92,122,64,0.075)", border: "rgba(92,122,64,0.18)", chipBg: "rgba(92,122,64,0.16)", chipColor: "#5C7A40" };
  }
  return { bg: "rgba(168,154,135,0.08)", border: "rgba(168,154,135,0.18)", chipBg: "rgba(168,154,135,0.18)", chipColor: "#8C6E50" };
}

function IntakeCard({ intake, canEdit, onEdit }) {
  const parsedConditions = parseChecklistText(intake?.conditions || "");
  const antecedents = ANTECEDENT_OPTIONS
    .map((item) => ({ item, value: parsedConditions.answers[item] || (parsedConditions.selected.includes(item) ? "SI" : "NO") }));
  const notes = [intake?.allergies, parsedConditions.notes].filter(Boolean).join(" · ");
  return (
    <div className="alma-card" style={{ padding: 24, border: "1px solid rgba(142,36,170,0.12)", background: "linear-gradient(135deg, #fffdf8, rgba(142,36,170,0.035))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          Ficha de anamnesis
        </h3>
        {canEdit && <button onClick={onEdit} style={{ fontSize: 13, color: "#8C6E50", textDecoration: "underline", cursor: "pointer", background: "none", border: "none" }}>Editar ficha</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#A89A87", marginBottom: 8 }}>Antecedentes clínicos · marque SI/NO</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 8 }}>
              {antecedents.map(({ item, value }) => {
                const tone = intakeTone(value);
                return (
                  <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 10, padding: "7px 9px" }}>
                    <span style={{ fontSize: 12, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "3px 7px", background: tone.chipBg, color: tone.chipColor }}>
                      {value || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(168,154,135,0.18)", background: "rgba(253,252,250,0.68)" }}>
            <div style={{ fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Indicaciones / observaciones</div>
            <div style={{ fontSize: 14, color: "#6B5540", lineHeight: 1.45 }}>
              {notes || "Sin indicaciones registradas"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          {intake?.consentSigned ? (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, background: "#C9A876", color: "#F7F5F0", fontSize: 11 }}>✓</span>
              <span style={{ fontSize: 13, color: "#6B5540" }}>Consentimiento firmado</span>
            </>
          ) : (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, border: "1px solid #A89A87" }} />
              <span style={{ fontSize: 13, color: "#A89A87" }}>Consentimiento pendiente</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// La interfaz de caja queda fuera de la ficha hasta construir Caja Alma como módulo propio.
function AccountMovementsPanel({ plans, balance, canEditPayments, onPayment }) {
  const activePlan = (plans || []).find((p) => p.active) || plans?.[0];
  const balanceAmount = Number(balance?.balanceUsd || 0);
  const entries = Array.isArray(balance?.entries) ? balance.entries : [];
  const balanceLabel = balanceAmount > 0
    ? `Por cobrar: ${money(balanceAmount)}`
    : balanceAmount < 0
      ? `Saldo a favor: ${money(Math.abs(balanceAmount))}`
      : "Cuenta al día";

  return (
    <div className="alma-card" style={{ padding: 24, flex: 1, background: "linear-gradient(135deg, rgba(253,252,250,0.96), rgba(92,122,64,0.055))" }}>
      <div style={{ borderRadius: 22, padding: 20, color: "#FDF8EF", background: "linear-gradient(135deg, #8C6E50 0%, #6B5540 58%, #4F3F31 100%)", boxShadow: "0 22px 45px rgba(107,85,64,0.22)", position: "relative", overflow: "hidden", marginBottom: 16 }}>
        <div style={{ position: "absolute", inset: "auto -55px -70px auto", width: 220, height: 220, borderRadius: "50%", border: "1px solid rgba(253,248,239,0.13)" }} />
        <div style={{ position: "absolute", inset: "-85px auto auto 42%", width: 230, height: 230, borderRadius: "50%", border: "1px solid rgba(253,248,239,0.11)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", position: "relative" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", opacity: 0.78 }}>Cuenta</div>
            <div className="font-heading" style={{ marginTop: 10, fontSize: 30, lineHeight: 1, color: "#FDF8EF" }}>{balanceAmount === 0 ? "Al día" : money(Math.abs(balanceAmount))}</div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.82 }}>{balanceLabel}</div>
          </div>
          {canEditPayments && (
            <button
              onClick={onPayment}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "9px 15px",
                borderRadius: 999,
                background: "#FDF8EF",
                color: "#6B5540",
                fontSize: 12,
                fontWeight: 850,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 10px 20px rgba(0,0,0,0.10)",
                whiteSpace: "nowrap",
              }}
            >
              + Abono
            </button>
          )}
        </div>
      </div>
      {activePlan ? (
        <div style={{ background: "rgba(235,205,181,0.26)", border: "1px solid rgba(201,168,118,0.28)", borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#6B5540" }}>
              {activePlan.sessionsIncluded} sesiones
            </span>
            {activePlan.renewsAt && (
              <span style={{ fontSize: 12, color: "#8C6E50" }}>renueva {shortDate(activePlan.renewsAt)}</span>
            )}
          </div>
          <div style={{ height: 5, borderRadius: 999, background: "rgba(168,154,135,0.3)", marginBottom: 6 }}>
            <div
              style={{
                width: `${Math.min(100, ((activePlan.sessionsUsed || 0) / Math.max(activePlan.sessionsIncluded || 1, 1)) * 100)}%`,
                height: "100%",
                borderRadius: 999,
                background: "#C9A876",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "#8C6E50" }}>
            {activePlan.sessionsUsed || 0} de {activePlan.sessionsIncluded} sesiones usadas
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "#A89A87", marginBottom: 14 }}>Sin planes activos.</p>
      )}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#6B5540" }}>{"Movimientos de cuenta"}</span>
          <span style={{ fontSize: 11, color: "#A89A87" }}>{entries.length} registros</span>
        </div>
        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "#A89A87" }}>Todavía no hay abonos ni cargos registrados.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 150, overflowY: "auto", paddingRight: 2 }}>
            {entries.slice(0, 8).map((entry) => {
              const isPayment = entry.type === "pago";
              return (
                <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderRadius: 9, background: "rgba(253,252,250,0.72)", border: "1px solid rgba(168,154,135,0.18)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6B5540" }}>{isPayment ? "Entró dinero" : "Cargo generado"}</div>
                    <div style={{ fontSize: 11, color: "#A89A87", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.description || entry.method || shortDate(entry.createdAt)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: isPayment ? "#5C7A40" : "#9A6A42", whiteSpace: "nowrap" }}>
                    {isPayment ? "+" : ""}{money(entry.amountUsd)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


const modalInputStyle = { width: "100%", padding: "10px 14px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 14, color: "#6B5540", background: "#FDFCFA", outline: "none", boxSizing: "border-box" };
const modalLabelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 };

function PaymentFormModal({ clientName, clientId, phase, onClose, onSaved }) {
  const [amountUsd, setAmountUsd] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!Number(amountUsd) || Number(amountUsd) <= 0) {
      setValidation("Ingresa un monto válido");
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      await authFetch(`/clients/${clientId}/payments`, {
        method: "POST",
        body: { amountUsd: Number(amountUsd), method, description: "Abono de caja" },
      });
      toast.success(`Abono de ${Number(amountUsd).toFixed(2)} guardado`);
      onSaved();
    } catch (err) {
      toast.error(err.message || "Error al guardar el abono");
      setSaving(false);
    }
  }

  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 400, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}>
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 6px" }}>{"Registrar abono"}</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#A89A87" }}>{clientName}</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={modalLabelStyle}>Monto (USD)</label>
            <input type="number" step="0.01" min="0.01" style={modalInputStyle} value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="45.00" autoFocus />
          </div>
          <div>
            <label style={modalLabelStyle}>Forma de pago</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...modalInputStyle, appearance: "none", cursor: "pointer" }}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando\u2026" : "Guardar abono"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientModalShell({ title, phase, onClose, children }) {
  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 400, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={20} /></button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function EditClientModal({ client, phase, onClose, onSaved }) {
  const toast = useToast();
  return (
    <ClientModalShell title="Editar clienta" phase={phase} onClose={onClose}>
      <ClientForm
        initial={{ fullName: client.fullName, whatsapp: client.whatsapp, email: client.email, recordNumber: client.recordNumber, address: client.address, cedula: client.cedula, birthday: client.birthday, birthdayYearKnown: client.birthdayYearKnown }}
        onCancel={onClose}
        submitLabel="Guardar"
        onSubmit={async (payload) => {
          await authFetch(`/clients/${client.id}`, { method: "PATCH", body: payload });
          toast.success("Cambios guardados");
          onSaved();
        }}
      />
    </ClientModalShell>
  );
}

function DeleteClientModal({ client, phase, onClose, onDeleted }) {
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleDelete() {
    setSaving(true);
    try {
      await authFetch(`/clients/${client.id}/disable`, { method: "PATCH" });
      toast.success("Clienta deshabilitada");
      onDeleted();
    } catch (err) {
      toast.error(err.message || "No se pudo eliminar la clienta");
      setSaving(false);
    }
  }

  return (
    <ClientModalShell title="Deshabilitar clienta" phase={phase} onClose={onClose}>
      <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.5, color: "#6B5540" }}>
        Vas a deshabilitar a <strong>{client.fullName}</strong>. Ya no aparecerá en la lista activa, cumpleaños ni recordatorios masivos. Su historial queda guardado para auditoría y recuperación.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
        <button type="button" disabled={saving} onClick={handleDelete} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#9A4E48", color: "#FDFBf7", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer", flex: 1, opacity: saving ? 0.65 : 1 }}>
          {saving ? "Deshabilitando..." : "Deshabilitar"}
        </button>
      </div>
    </ClientModalShell>
  );
}

function EditIntakeModal({ clientId, intake, phase, onClose, onSaved }) {
  const parsed = parseChecklistText(intake?.conditions || "");
  const [allergies, setAllergies] = useState(intake?.allergies || "");
  const [antecedentAnswers, setAntecedentAnswers] = useState(() => {
    const initial = { ...parsed.answers };
    parsed.selected.forEach((item) => { if (!initial[item]) initial[item] = "SI"; });
    return initial;
  });
  const [conditionNotes, setConditionNotes] = useState(parsed.notes);
  const [consentSigned, setConsentSigned] = useState(intake?.consentSigned || false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await authFetch(`/clients/${clientId}/intake`, {
        method: "PUT",
        body: { allergies, conditions: buildChecklistText(antecedentAnswers, conditionNotes), consentSigned },
      });
      toast.success("Ficha guardada");
      onSaved();
    } catch (err) { toast.error(err.message || "Error al guardar"); setSaving(false); }
  }

  function setAntecedent(item, value) {
    setAntecedentAnswers((current) => ({ ...current, [item]: value }));
  }

  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 420, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={20} /></button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>Ficha de anamnesis</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={modalLabelStyle}>Alergias</label><textarea style={{ ...modalInputStyle, minHeight: 60, resize: "vertical" }} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Ninguna conocida" /></div>
          <div>
            <label style={modalLabelStyle}>Antecedentes clínicos — marcar SI/NO</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 7, maxHeight: 260, overflowY: "auto", padding: "2px 2px 4px" }}>
              {ANTECEDENT_OPTIONS.map((item) => {
                const answer = antecedentAnswers[item] || "";
                const tone = intakeTone(answer);
                return (
                  <div
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      border: `1px solid ${tone.border}`,
                      background: tone.bg,
                      borderRadius: 10,
                      padding: "7px 8px 7px 10px",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: "#6B5540", fontWeight: 500 }}>{item}</span>
                    <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
                      {["SI", "NO"].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAntecedent(item, value)}
                          style={{
                            border: "none",
                            borderRadius: 999,
                            padding: "5px 10px",
                            background: answer === value ? (value === "SI" ? "#8E24AA" : "rgba(92,122,64,0.18)") : "rgba(168,154,135,0.14)",
                            color: answer === value ? (value === "SI" ? "#FFFFFF" : "#5C7A40") : "#8C6E50",
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {value}
                        </button>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div><label style={modalLabelStyle}>Observaciones relevantes</label><textarea style={{ ...modalInputStyle, minHeight: 60, resize: "vertical" }} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="Notas adicionales o condiciones no listadas" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={consentSigned} onChange={(e) => setConsentSigned(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#8C6E50" }} />
            <span style={{ fontSize: 13, color: "#6B5540" }}>Consentimiento firmado</span>
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TreatmentDeleteModal({ treatment, phase, onClose, onDeleted }) {
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleDelete() {
    setSaving(true);
    try {
      await authFetch(`/treatments/${treatment.id}`, { method: "DELETE" });
      toast.success("Tratamiento eliminado");
      onDeleted();
    } catch (err) {
      toast.error(err.message || "No se pudo eliminar el tratamiento");
      setSaving(false);
    }
  }

  return (
    <ClientModalShell title="Eliminar tratamiento" phase={phase} onClose={onClose}>
      <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.5, color: "#6B5540" }}>
        Vas a eliminar este registro del historial de tratamientos. Esta acción no cambia la ficha de la clienta ni sus pagos.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
        <button type="button" disabled={saving} onClick={handleDelete} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#9A4E48", color: "#FDFBf7", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer", flex: 1, opacity: saving ? 0.65 : 1 }}>
          {saving ? "Eliminando..." : "Eliminar"}
        </button>
      </div>
    </ClientModalShell>
  );
}

function TreatmentsCard({ treatments, appointments = [], clientId, canEdit, onSaved }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTreatment, setEditingTreatment] = useState(null);
  const [treatmentToDelete, setTreatmentToDelete] = useState(null);
  const [services, setServices] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [therapistId, setTherapistId] = useState("");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const deleteTreatmentAnim = useAnimatedMount(Boolean(treatmentToDelete), 220);

  useEffect(() => {
    if (!showForm || !canEdit) return;
    Promise.all([
      authFetch("/services").catch(() => []),
      authFetch("/clients/therapists").catch(() => []),
    ]).then(([serviceRows, therapistRows]) => {
      setServices(Array.isArray(serviceRows) ? serviceRows.filter((x) => x.active) : []);
      setTherapists(Array.isArray(therapistRows) ? therapistRows : []);
    });
  }, [showForm, canEdit]);

  function resetForm() {
    setEditingTreatment(null);
    setServiceId("");
    setTherapistId("");
    setSessionDate(new Date().toISOString().split("T")[0]);
    setNotes("");
    setError("");
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(treatment) {
    setEditingTreatment(treatment);
    setServiceId(treatment.serviceId || treatment.service?.id || "");
    setTherapistId(treatment.therapistId || treatment.therapist?.id || "");
    setSessionDate(treatment.sessionDate ? new Date(treatment.sessionDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]);
    setNotes(treatment.notes || "");
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceId || !sessionDate) { setError("Servicio y fecha son requeridos"); return; }
    setSaving(true);
    setError("");
    try {
      if (editingTreatment) {
        await authFetch(`/treatments/${editingTreatment.id}`, { method: "PATCH", body: { sessionDate, notes: notes || null, therapistId: therapistId || undefined } });
        toast.success("Tratamiento actualizado");
      } else {
        await authFetch(`/clients/${clientId}/treatments`, { method: "POST", body: { serviceId, sessionDate, notes: notes || undefined, therapistId: therapistId || undefined } });
        toast.success("Tratamiento agregado");
      }
      setShowForm(false);
      resetForm();
      onSaved?.();
    } catch (err) {
      setError(err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const inputSt = { width: "100%", padding: "8px 12px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 13, color: "#6B5540", background: "#FDFCFA", outline: "none", boxSizing: "border-box" };
  const statusInfo = {
    pendiente: { label: "Reservó, falta confirmar", color: "#A89A87", bg: "rgba(168,154,135,0.14)" },
    pendiente_bot: { label: "Confirmada por clienta vía WhatsApp", color: "#8C6E50", bg: "rgba(201,168,118,0.15)" },
    confirmado: { label: "Confirmada", color: "#6F7F45", bg: "rgba(111,127,69,0.12)" },
    cancelado: { label: "Cancelada", color: "#9A4E48", bg: "rgba(154,78,72,0.10)" },
    no_show: { label: "No asistió", color: "#B85A56", bg: "rgba(194,84,80,0.12)" },
  };
  const historyRows = [
    ...(treatments || []).map((t) => ({ type: "treatment", date: t.sessionDate, treatment: t })),
    ...(appointments || []).map((a) => ({ type: "appointment", date: a.startsAt, appointment: a })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 14);

  return (
    <div className="alma-card" style={{ padding: 22, display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid rgba(121,134,203,0.16)", background: "linear-gradient(135deg, #fffdf8, rgba(121,134,203,0.035))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>Historial de la clienta</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#A89A87" }}>{(treatments || []).length} tratamientos · {(appointments || []).length} reservas</span>
          {canEdit && <button onClick={() => (showForm ? (setShowForm(false), resetForm()) : openCreate())} style={{ padding: "4px 14px", borderRadius: 999, border: "1px solid #8C6E50", background: showForm ? "#8C6E50" : "none", color: showForm ? "#F7F5F0" : "#8C6E50", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>{showForm ? "Cancelar" : "+ Agregar"}</button>}
        </div>
      </div>
      {deleteTreatmentAnim.shouldRender && treatmentToDelete && (
        <TreatmentDeleteModal
          treatment={treatmentToDelete}
          phase={deleteTreatmentAnim.phase}
          onClose={() => setTreatmentToDelete(null)}
          onDeleted={() => { setTreatmentToDelete(null); onSaved?.(); }}
        />
      )}

      {canEdit && showForm && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, padding: 14, background: "rgba(201,168,118,0.08)", borderRadius: 10 }}>
          <div><label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Servicio</label><select value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={Boolean(editingTreatment)} style={{ ...inputSt, appearance: "none", cursor: editingTreatment ? "not-allowed" : "pointer", opacity: editingTreatment ? 0.72 : 1 }}><option value="">Seleccionar...</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Terapeuta que atendió</label><select value={therapistId} onChange={(e) => setTherapistId(e.target.value)} style={{ ...inputSt, appearance: "none", cursor: "pointer" }}><option value="">Usar mi usuario si soy terapeuta</option>{therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}</select></div>
          <div><label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Fecha</label><input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} style={inputSt} /></div>
          <div><label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Notas (opcional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputSt, resize: "vertical" }} placeholder="Observaciones del tratamiento..." /></div>
          {error && <p style={{ fontSize: 12, color: "#C25450", margin: 0 }}>{error}</p>}
          <button type="submit" disabled={saving} style={{ padding: "8px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando..." : editingTreatment ? "Guardar cambios" : "Guardar tratamiento"}</button>
        </form>
      )}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
        {historyRows.length === 0 ? (
          <p style={{ textAlign: "center", padding: "60px 0", fontSize: 13, color: "#A89A87" }}>Sin historial registrado todavía.</p>
        ) : (
          historyRows.map((row, index) => {
            if (row.type === "appointment") {
              const a = row.appointment;
              const info = statusInfo[a.status] || statusInfo.pendiente;
              const color = a.service?.colorHex || info.color;
              return (
                <div key={`appt-${a.id}`} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, padding: "14px 0", borderBottom: index < historyRows.length - 1 ? "1px solid rgba(168,154,135,0.22)" : "none" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 5, background: color, boxShadow: `0 0 0 4px ${info.bg}` }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <strong style={{ fontSize: 14, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.service?.name || "Reserva"}</strong>
                      <span style={{ fontSize: 11, color: info.color, background: info.bg, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>{info.label}</span>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 12, color: "#A89A87" }}>{shortDate(a.startsAt)} · {a.room?.name || "Sin cabina"}</div>
                    {a.indications && <div style={{ marginTop: 3, fontSize: 12, color: "#8C6E50" }}>{a.indications}</div>}
                  </div>
                </div>
              );
            }
            const t = row.treatment;
            const color = t.service?.colorHex || "#7986CB";
            return (
              <div key={`treatment-${t.id}`} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, padding: "14px 0", borderBottom: index < historyRows.length - 1 ? "1px solid rgba(168,154,135,0.22)" : "none" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 5, background: color, boxShadow: "0 0 0 4px rgba(121,134,203,0.14)" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.service?.name || "Tratamiento"}</span>
                      <span style={{ fontSize: 12, color: "#A89A87" }}>{shortDate(t.sessionDate)} · Tratamiento registrado</span>
                      {t.therapist?.name && <span style={{ display: "block", fontSize: 12, color: "#8C6E50", marginTop: 2 }}>Atendió: {t.therapist.name}</span>}
                    </div>
                    {canEdit && <div style={{ display: "flex", gap: 6 }}>
                      <button className="alma-pencil-button" type="button" onClick={() => openEdit(t)} aria-label="Editar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(168,154,135,0.35)", background: "#FDFCFA", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Pencil className="alma-pencil-icon" size={14} /></button>
                      <button type="button" onClick={() => setTreatmentToDelete(t)} aria-label="Eliminar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(194,84,80,0.28)", background: "rgba(194,84,80,0.06)", color: "#9A4E48", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Trash2 size={14} /></button>
                    </div>}
                  </div>
                  {t.notes && <div style={{ fontSize: 13, color: "#8C6E50", marginBottom: 6 }}>{t.notes}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
