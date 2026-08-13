"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Search, X, ArrowLeft, Pencil, Trash2, Download, MoreHorizontal, ArrowUpDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { ClientForm } from "@/components/client-form";
import { NewClientModal } from "@/components/new-client-modal";
import { useToast } from "@/components/toast-provider";

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "CL";
}

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

function sortValue(client, key) {
  if (key === "recordNumber") return client.recordNumber || "";
  if (key === "birthday") return client.daysUntil ?? client.birthday ?? 9999;
  if (key === "createdAt") return client.createdAt || "";
  return String(client[key] || "").toLowerCase();
}

function sortClients(rows, key, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return -1 * multiplier;
    if (av > bv) return 1 * multiplier;
    return String(a.fullName || "").localeCompare(String(b.fullName || ""), "es") * multiplier;
  });
}

function exportFilename() {
  const today = new Date().toISOString().slice(0, 10);
  return `clientes-alma-spa-${today}.csv`;
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

function ClientDirectoryRow({ client, selected, view, menuOpen, onSelect, onMenu, onEdit, onDisable, onEnable, isMobile }) {
  const birthdayLabel = client.birthday
    ? `${birthdayDateLabel(client.birthday)}${client.age != null ? ` · ${client.age} años` : ""}`
    : "Sin cumpleaños";
  const statusLabel = client.active === false ? "Deshabilitada" : "Activa";
  const birthdayHint = client.daysUntil !== undefined ? birthdayCaptionFromDays(client.daysUntil) : birthdayLabel;

  if (isMobile) {
    return (
      <button
        onClick={onSelect}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 12px",
          borderRadius: 14,
          background: selected ? "rgba(235,205,181,0.48)" : "#FDFCFA",
          border: selected ? "1px solid rgba(201,168,118,0.35)" : "1px solid rgba(168,154,135,0.18)",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
          boxShadow: selected ? "0 10px 26px rgba(107,85,64,0.08)" : "none",
        }}
      >
        <span style={{ width: 38, height: 38, borderRadius: "50%", background: selected ? "#C9A876" : "rgba(201,168,118,0.32)", color: selected ? "#F7F5F0" : "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {initials(client.fullName)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.fullName}</div>
          <div style={{ fontSize: 12, color: "#A89A87", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.recordNumber ? `Ficha ${client.recordNumber} · ` : ""}{client.whatsapp}
          </div>
          {view === "cumples" && <div style={{ marginTop: 2, fontSize: 12, color: "#8C6E50", fontWeight: 700 }}>{birthdayHint}</div>}
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "82px minmax(180px,1.2fr) minmax(130px,0.9fr) minmax(118px,0.8fr) 94px 44px",
        gap: 12,
        alignItems: "center",
        minHeight: 58,
        padding: "10px 12px",
        borderRadius: 14,
        border: selected ? "1px solid rgba(201,168,118,0.55)" : "1px solid transparent",
        background: selected ? "linear-gradient(135deg, rgba(235,205,181,0.52), rgba(253,252,250,0.9))" : "transparent",
        cursor: "pointer",
        position: "relative",
      }}
    >
      <div style={{ fontSize: 12, color: client.recordNumber ? "#6B5540" : "#A89A87", fontWeight: 700 }}>
        {client.recordNumber || "—"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: selected ? "#C9A876" : "rgba(201,168,118,0.28)", color: selected ? "#F7F5F0" : "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
          {initials(client.fullName)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "#6B5540", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.fullName}</div>
          <div style={{ fontSize: 11, color: "#A89A87", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.email || client.address || "Sin email/dirección"}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#8C6E50", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.whatsapp}</div>
      <div>
        <div style={{ fontSize: 12, color: "#6B5540", fontWeight: 700 }}>{view === "cumples" ? birthdayHint : birthdayLabel}</div>
        {view === "cumples" && client.birthday && <div style={{ fontSize: 11, color: "#A89A87" }}>{birthdayDateLabel(client.birthday)}</div>}
      </div>
      <span style={{ justifySelf: "start", padding: "5px 10px", borderRadius: 999, background: client.active === false ? "rgba(168,79,74,0.08)" : "rgba(92,122,64,0.10)", color: client.active === false ? "#A84F4A" : "#5C7A40", fontSize: 11, fontWeight: 800 }}>
        {statusLabel}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMenu(); }}
        style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(168,154,135,0.25)", background: "#FDFCFA", color: "#8C6E50", display: "grid", placeItems: "center", cursor: "pointer" }}
        aria-label={`Acciones de ${client.fullName}`}
      >
        <MoreHorizontal size={17} />
      </button>
      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", right: 10, top: 48, zIndex: 6, minWidth: 156, padding: 6, borderRadius: 12, background: "#FDFCFA", border: "1px solid rgba(168,154,135,0.28)", boxShadow: "0 18px 42px rgba(107,85,64,0.18)" }}
        >
          <button type="button" onClick={onEdit} style={menuActionStyle}>Editar</button>
          {client.active === false ? (
            <button type="button" onClick={onEnable} style={menuActionStyle}>Habilitar</button>
          ) : (
            <button type="button" onClick={onDisable} style={{ ...menuActionStyle, color: "#A84F4A" }}>Deshabilitar</button>
          )}
        </div>
      )}
    </div>
  );
}

const menuActionStyle = {
  width: "100%",
  textAlign: "left",
  padding: "9px 10px",
  borderRadius: 9,
  border: "none",
  background: "transparent",
  color: "#6B5540",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
};

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

function SummaryTile({ label, value, hint, tone = "gold" }) {
  const tones = {
    gold: { bg: "linear-gradient(135deg, rgba(235,205,181,0.72), rgba(253,252,250,0.88))", border: "rgba(201,168,118,0.42)", dot: "#C9A876" },
    olive: { bg: "linear-gradient(135deg, rgba(92,122,64,0.12), rgba(253,252,250,0.9))", border: "rgba(92,122,64,0.22)", dot: "#5C7A40" },
    rose: { bg: "linear-gradient(135deg, rgba(142,36,170,0.08), rgba(253,252,250,0.9))", border: "rgba(142,36,170,0.16)", dot: "#8E24AA" },
    clay: { bg: "linear-gradient(135deg, rgba(140,110,80,0.12), rgba(253,252,250,0.9))", border: "rgba(140,110,80,0.22)", dot: "#8C6E50" },
  };
  const theme = tones[tone] || tones.gold;
  return (
    <div className="alma-card" style={{ padding: 18, border: `1px solid ${theme.border}`, background: theme.bg, minHeight: 112 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#8C6E50", fontSize: 12, fontWeight: 800, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: theme.dot }} />
        {label}
      </div>
      <div className="font-heading" style={{ fontSize: 28, color: "#6B5540", lineHeight: 1, marginBottom: 8 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#A89A87", lineHeight: 1.35 }}>{hint}</div>
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
  const { user } = useAuth();
  // Preselección desde <GlobalSearch>: /admin/clientes?client=<id>
  const preselectedId = searchParams.get("client");
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(preselectedId || null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("todas");
  const [birthdayList, setBirthdayList] = useState([]);
  const [birthdayLoading, setBirthdayLoading] = useState(false);
  const [disabledClients, setDisabledClients] = useState([]);
  const [disabledLoading, setDisabledLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [intake, setIntake] = useState(null);
  const [treatments, setTreatments] = useState([]);
  const [clientAppointments, setClientAppointments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [balance, setBalance] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const isMobile = useIsMobile();
  const toast = useToast();
  const [mobileShowDetail, setMobileShowDetail] = useState(Boolean(preselectedId));
  const [sortKey, setSortKey] = useState("fullName");
  const [sortDirection, setSortDirection] = useState("asc");
  const [openMenuId, setOpenMenuId] = useState(null);
  const [actionClient, setActionClient] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState("resumen");
  const canExportClients = !!user && (["superadmin", "dueno"].includes(user.role) || user.permissions?.reportes || user.permissions?.configuracion);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authFetch("/clients", { query: query ? { q: query } : undefined });
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(fetchClients, 250);
    return () => clearTimeout(t);
  }, [fetchClients]);

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
  const fetchDisabledClients = useCallback(async () => {
    setDisabledLoading(true);
    try {
      const data = await authFetch("/clients", { query: { active: "false", ...(query ? { q: query } : {}) } });
      setDisabledClients(Array.isArray(data) ? data : []);
    } catch {
      setDisabledClients([]);
    } finally {
      setDisabledLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (view === "deshabilitadas") fetchDisabledClients();
  }, [view, fetchDisabledClients]);

  const fetchDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      const [clientData, intakeData, treatmentsData, appointmentData, plansData, balanceData] = await Promise.all([
        authFetch(`/clients/${selectedId}`),
        authFetch(`/clients/${selectedId}/intake`).catch((err) => (err.status === 404 ? null : Promise.reject(err))),
        authFetch(`/clients/${selectedId}/treatments`).catch(() => []),
        authFetch("/appointments", { query: { clientId: selectedId } }).catch(() => []),
        authFetch(`/clients/${selectedId}/plans`).catch(() => []),
        authFetch(`/clients/${selectedId}/balance`).catch(() => null),
      ]);
      setDetail(clientData);
      setIntake(intakeData);
      setTreatments(Array.isArray(treatmentsData) ? treatmentsData : []);
      setClientAppointments(Array.isArray(appointmentData) ? appointmentData : []);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setBalance(balanceData);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [showDeleteClient, setShowDeleteClient] = useState(false);
  const [showEditIntake, setShowEditIntake] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const paymentAnim = useAnimatedMount(showPaymentForm, 220);
  const editClientAnim = useAnimatedMount(showEditClient, 220);
  const deleteClientAnim = useAnimatedMount(showDeleteClient, 220);
  const editIntakeAnim = useAnimatedMount(showEditIntake, 220);
  const newClientAnim = useAnimatedMount(showNewClient, 220);
  const mobileDetailAnim = useAnimatedMount(isMobile && mobileShowDetail, 220);

  function registerPayment() {
    if (!selectedId) return;
    setShowPaymentForm(true);
  }

  function openClientDetail(clientId) {
    setSelectedId(clientId);
    setOpenMenuId(null);
    setActiveTab("resumen");
    if (isMobile) setMobileShowDetail(true);
  }

  function closeClientDetail() {
    setSelectedId(null);
    setDetail(null);
    setIntake(null);
    setTreatments([]);
    setClientAppointments([]);
    setPlans([]);
    setBalance(null);
    setMobileShowDetail(false);
    setActiveTab("resumen");
  }

  const selectedBirthdayInfo = useMemo(() => birthdayList.find((b) => b.id === selectedId) || null, [birthdayList, selectedId]);
  const visibleClients = useMemo(() => {
    if (view === "cumples") return sortClients(birthdayList, sortKey === "birthday" ? "birthday" : sortKey, sortDirection);
    if (view === "deshabilitadas") return sortClients(disabledClients, sortKey, sortDirection);
    return sortClients(clients, sortKey, sortDirection);
  }, [birthdayList, clients, disabledClients, sortDirection, sortKey, view]);
  const currentCount = visibleClients.length;
  const listLoading = view === "cumples" ? birthdayLoading : view === "deshabilitadas" ? disabledLoading : loading;

  function changeSort(key) {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(key === "createdAt" || key === "birthday" ? "desc" : "asc");
      return key;
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
      fetchClients();
      fetchDisabledClients();
      fetchDetail();
    } catch (err) {
      toast.error(err.message || "No se pudo habilitar la clienta");
    }
  }

  const balanceAmount = Number(balance?.balanceUsd || 0);
  const appointmentCount = clientAppointments.length;
  const treatmentCount = treatments.length;
  const sortedAppointments = useMemo(
    () => [...clientAppointments].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()),
    [clientAppointments],
  );
  const lastAppointment = sortedAppointments[0] || null;
  const tabItems = [
    { key: "resumen", label: "Resumen" },
    { key: "anamnesis", label: "Anamnesis", meta: intake?.consentSigned ? "OK" : "Pend." },
    { key: "historial", label: "Historial", meta: treatmentCount + appointmentCount },
    { key: "reservas", label: "Reservas", meta: appointmentCount },
    { key: "cuenta", label: "Cuenta", meta: balanceAmount > 0 ? money(balanceAmount) : undefined },
    { key: "estadisticas", label: "Estadísticas" },
  ];

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {newClientAnim.shouldRender && (
        <NewClientModal
          phase={newClientAnim.phase}
          onClose={() => setShowNewClient(false)}
          onSaved={(created) => {
            setShowNewClient(false);
            setClients((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
            openClientDetail(created.id);
          }}
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
                Directorio general · {currentCount} {currentCount === 1 ? "clienta" : "clientas"}
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
                placeholder="Busca por nombre o WhatsApp..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, justifyContent: isMobile ? "flex-start" : "flex-end" }}>
              <ClientFilterButton active={view === "todas"} onClick={() => setView("todas")}>
                Todas
              </ClientFilterButton>
              <ClientFilterButton active={view === "cumples"} onClick={() => setView("cumples")}>
                Cumpleaños
              </ClientFilterButton>
              <ClientFilterButton active={view === "deshabilitadas"} onClick={() => setView("deshabilitadas")}>
                Deshabilitadas
              </ClientFilterButton>
            </div>
          </div>
        </div>
        <div className="alma-card" style={{ flex: 1, display: "flex", flexDirection: "column", margin: isMobile ? "0 12px 12px" : "0 34px 28px", padding: isMobile ? "12px" : "18px", overflowY: "auto", gap: 6, minHeight: 0 }}>
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "82px minmax(180px,1.2fr) minmax(130px,0.9fr) minmax(118px,0.8fr) 94px 44px",
                gap: 12,
                padding: "0 12px 12px",
                alignItems: "center",
                borderBottom: "1px solid rgba(168,154,135,0.22)",
                marginBottom: 8,
              }}
            >
              <SortButton label="Ficha" sortKey="recordNumber" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Clienta" sortKey="fullName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="WhatsApp" sortKey="whatsapp" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortButton label="Cumpleaños" sortKey="birthday" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#A89A87", textTransform: "uppercase", letterSpacing: 0.5 }}>Estado</span>
              <span />
            </div>
          )}
          {listLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
            </div>
          ) : visibleClients.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 12px", fontSize: 13, color: "#A89A87" }}>
              {view === "cumples" ? "Sin cumpleaños en los próximos 8 días." : view === "deshabilitadas" ? "No hay clientas deshabilitadas." : "Sin resultados."}
            </p>
          ) : (
            visibleClients.map((client) => (
              <ClientDirectoryRow
                key={client.id}
                client={client}
                view={view}
                selected={client.id === selectedId}
                menuOpen={openMenuId === client.id}
                isMobile={isMobile}
                onSelect={() => openClientDetail(client.id)}
                onMenu={() => setOpenMenuId((id) => (id === client.id ? null : client.id))}
                onEdit={() => { setActionClient(client); openClientDetail(client.id); setShowEditClient(true); }}
                onDisable={() => { setActionClient(client); openClientDetail(client.id); setShowDeleteClient(true); }}
                onEnable={() => { setSelectedId(client.id); setOpenMenuId(null); handleEnableClient(client.id); }}
              />
            ))
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
            {paymentAnim.shouldRender && (
              <PaymentFormModal
                clientName={detail.fullName}
                phase={paymentAnim.phase}
                onClose={() => setShowPaymentForm(false)}
                onSaved={() => { setShowPaymentForm(false); fetchDetail(); }}
                clientId={selectedId}
              />
            )}
            {editClientAnim.shouldRender && (
              <EditClientModal
                client={actionClient || detail}
                phase={editClientAnim.phase}
                onClose={() => { setShowEditClient(false); setActionClient(null); }}
                onSaved={() => { setShowEditClient(false); setActionClient(null); fetchDetail(); fetchClients(); fetchDisabledClients(); }}
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
                  fetchClients();
                  fetchDisabledClients();
                }}
              />
            )}
            {editIntakeAnim.shouldRender && (
              <EditIntakeModal
                clientId={selectedId}
                intake={intake}
                phase={editIntakeAnim.phase}
                onClose={() => setShowEditIntake(false)}
                onSaved={() => { setShowEditIntake(false); fetchDetail(); }}
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
                    <span>{detail.whatsapp}</span>
                    <span>·</span>
                    <span>Clienta desde {shortDate(detail.createdAt)}</span>
                    {detail.recordNumber && (
                      <>
                        <span>·</span>
                        <span>Ficha {detail.recordNumber}</span>
                      </>
                    )}
                    {detail.age != null && (
                      <>
                        <span>·</span>
                        <span>{detail.age} años</span>
                      </>
                    )}
                    {detail.birthday && (
                      <>
                        <span>{"\uD83C\uDF82"}</span>
                        <span>Cumple: {birthdayDateLabel(detail.birthday)}{selectedBirthdayInfo ? ` (${birthdayCaptionFromDays(selectedBirthdayInfo.daysUntil)})` : ""}</span>
                      </>
                    )}
                  </div>
                  {detail.address && (
                    <div style={{ marginTop: 4, fontSize: 12, color: "#8C6E50" }}>
                      Dirección: {detail.address}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => setShowEditClient(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "9px 20px",
                    borderRadius: 999,
                    border: "1px solid rgba(168,154,135,0.5)",
                    background: "none",
                    color: "#6B5540",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Editar
                </button>
                {detail.active === false ? (
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
                ) : (
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
                )}
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
              {activeTab === "resumen" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 14 }}>
                    <SummaryTile
                      label="Reservas"
                      value={appointmentCount}
                      hint={lastAppointment ? `Última: ${shortDate(lastAppointment.startsAt)}` : "Sin reservas registradas"}
                      tone="gold"
                    />
                    <SummaryTile
                      label="Tratamientos"
                      value={treatmentCount}
                      hint={treatmentCount ? "Historial clínico-estético activo" : "Sin tratamientos todavía"}
                      tone="rose"
                    />
                    <SummaryTile
                      label="Cuenta"
                      value={balanceAmount > 0 ? money(balanceAmount) : "Al día"}
                      hint={balanceAmount > 0 ? "Saldo por cobrar" : balanceAmount < 0 ? "Tiene saldo a favor" : "Sin saldo pendiente"}
                      tone={balanceAmount > 0 ? "clay" : "olive"}
                    />
                    <SummaryTile
                      label="Cumpleaños"
                      value={detail.birthday ? birthdayDateLabel(detail.birthday) : "—"}
                      hint={detail.age != null ? `${detail.age} años` : "Sin fecha registrada"}
                      tone="gold"
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 18 }}>
                    <IntakeCard intake={intake} onEdit={() => setShowEditIntake(true)} compact />
                    <PlansBalanceCard plans={plans} balance={balance} onPayment={registerPayment} compact />
                  </div>
                </div>
              )}
              {activeTab === "anamnesis" && <IntakeCard intake={intake} onEdit={() => setShowEditIntake(true)} />}
              {activeTab === "historial" && <TreatmentsCard treatments={treatments} appointments={clientAppointments} clientId={selectedId} onSaved={fetchDetail} />}
              {activeTab === "reservas" && <ReservationsCard appointments={clientAppointments} />}
              {activeTab === "cuenta" && <PlansBalanceCard plans={plans} balance={balance} onPayment={registerPayment} />}
              {activeTab === "estadisticas" && <ClientStatsCard client={detail} appointments={clientAppointments} treatments={treatments} balance={balance} />}
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

function IntakeCard({ intake, onEdit, compact = false }) {
  const parsedConditions = parseChecklistText(intake?.conditions || "");
  const answeredAntecedents = ANTECEDENT_OPTIONS
    .map((item) => ({ item, value: parsedConditions.answers[item] || (parsedConditions.selected.includes(item) ? "SI" : null) }))
    .filter((row) => row.value);
  return (
    <div className="alma-card" style={{ padding: compact ? 20 : 24, border: "1px solid rgba(142,36,170,0.12)", background: "linear-gradient(135deg, #fffdf8, rgba(142,36,170,0.035))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          Ficha de anamnesis
        </h3>
        <button onClick={onEdit} style={{ fontSize: 13, color: "#8C6E50", textDecoration: "underline", cursor: "pointer", background: "none", border: "none" }}>Editar</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#A89A87", marginBottom: 3 }}>Alergias que debemos conocer</div>
          <div style={{ fontSize: 14, color: "#6B5540" }}>{intake?.allergies || "Sin alergias registradas"}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#A89A87", marginBottom: 8 }}>Antecedentes clínicos</div>
          {answeredAntecedents.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
              {answeredAntecedents.slice(0, 8).map(({ item, value }) => (
                <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: "1px solid rgba(168,154,135,0.2)", background: value === "SI" ? "rgba(142,36,170,0.08)" : "rgba(168,154,135,0.08)", borderRadius: 10, padding: "7px 9px" }}>
                  <span style={{ fontSize: 12, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "3px 7px", background: value === "SI" ? "#8E24AA" : "rgba(168,154,135,0.24)", color: value === "SI" ? "#FFFFFF" : "#8C6E50" }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ fontSize: 14, color: "#6B5540", marginTop: answeredAntecedents.length ? 8 : 0 }}>
            {parsedConditions.notes || (!answeredAntecedents.length ? "Sin antecedentes registrados" : "")}
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

function PlansBalanceCard({ plans, balance, onPayment, compact = false }) {
  const activePlan = (plans || []).find((p) => p.active) || plans?.[0];
  const balanceAmount = Number(balance?.balanceUsd || 0);
  const entries = Array.isArray(balance?.entries) ? balance.entries : [];
  const balanceLabel = balanceAmount > 0
    ? `Por cobrar: ${money(balanceAmount)}`
    : balanceAmount < 0
      ? `Saldo a favor: ${money(Math.abs(balanceAmount))}`
      : "Cuenta al día";

  return (
    <div className="alma-card" style={{ padding: compact ? 20 : 24, flex: 1 }}>
      <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: "0 0 14px" }}>
        Cuenta de la clienta
      </h3>
      {activePlan ? (
        <div style={{ background: "rgba(235,205,181,0.4)", border: "1px solid rgba(201,168,118,0.5)", borderRadius: 10, padding: 16, marginBottom: 14 }}>
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#6B5540",
          borderRadius: 10,
          padding: "14px 16px",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#EBE8E1" }}>
            {balanceLabel}
          </div>
        </div>
        <button
          onClick={onPayment}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "7px 16px",
            borderRadius: 999,
            background: "#EBE8E1",
            color: "#6B5540",
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          Registrar abono
        </button>
      </div>
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
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#6B5540" }}>{isPayment ? "Abono recibido" : "Cargo generado"}</div>
                    <div style={{ fontSize: 11, color: "#A89A87", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.description || entry.method || shortDate(entry.createdAt)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isPayment ? "#6F7F45" : "#8C6E50", whiteSpace: "nowrap" }}>
                    {isPayment ? "-" : "+"}{money(entry.amountUsd)}
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

function ReservationsCard({ appointments = [] }) {
  const statusInfo = {
    pendiente: { label: "Pendiente", color: "#8C6E50", bg: "rgba(201,168,118,0.16)" },
    confirmado: { label: "Confirmada", color: "#5C7A40", bg: "rgba(92,122,64,0.12)" },
    cancelado: { label: "Cancelada", color: "#9A4E48", bg: "rgba(154,78,72,0.10)" },
    no_show: { label: "No asistió", color: "#B85A56", bg: "rgba(194,84,80,0.12)" },
  };
  const rows = [...appointments].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  return (
    <div className="alma-card" style={{ padding: 24, minHeight: 360 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <h3 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>Reservas</h3>
          <p style={{ margin: "4px 0 0", color: "#A89A87", fontSize: 13 }}>Agenda histórica de esta clienta.</p>
        </div>
        <span style={{ color: "#A89A87", fontSize: 13 }}>{rows.length} registros</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ textAlign: "center", padding: "70px 0", fontSize: 13, color: "#A89A87" }}>Todavía no hay reservas registradas.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((appointment) => {
            const info = statusInfo[appointment.status] || statusInfo.pendiente;
            return (
              <div key={appointment.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(168,154,135,0.2)", background: "rgba(253,252,250,0.76)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: appointment.service?.colorHex || "#C9A876" }} />
                    <strong style={{ color: "#6B5540", fontSize: 14 }}>{appointment.service?.name || "Reserva"}</strong>
                  </div>
                  <div style={{ color: "#A89A87", fontSize: 12 }}>
                    {shortDate(appointment.startsAt)} · {appointment.room?.name || "Sin cabina"}{appointment.staff?.fullName ? ` · ${appointment.staff.fullName}` : ""}
                  </div>
                  {appointment.indications && <div style={{ marginTop: 5, color: "#8C6E50", fontSize: 12 }}>{appointment.indications}</div>}
                </div>
                <span style={{ padding: "5px 10px", borderRadius: 999, color: info.color, background: info.bg, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {info.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientStatsCard({ client, appointments = [], treatments = [], balance }) {
  const confirmed = appointments.filter((a) => a.status === "confirmado").length;
  const noShows = appointments.filter((a) => a.status === "no_show").length;
  const balanceAmount = Number(balance?.balanceUsd || 0);
  const firstVisit = appointments.length
    ? [...appointments].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <SummaryTile label="Asistencias" value={confirmed} hint="Reservas confirmadas / asistidas" tone="olive" />
        <SummaryTile label="No asistió" value={noShows} hint="Citas marcadas como no-show" tone="clay" />
        <SummaryTile label="Tratamientos" value={treatments.length} hint="Registros clínico-estéticos" tone="rose" />
        <SummaryTile label="Saldo" value={balanceAmount === 0 ? "Al día" : money(Math.abs(balanceAmount))} hint={balanceAmount > 0 ? "Por cobrar" : balanceAmount < 0 ? "A favor" : "Sin pendiente"} tone={balanceAmount > 0 ? "clay" : "olive"} />
      </div>
      <div className="alma-card" style={{ padding: 24, background: "linear-gradient(135deg, #fffdf8, rgba(201,168,118,0.08))" }}>
        <h3 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: "0 0 16px" }}>Lectura rápida</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: 14, background: "rgba(253,252,250,0.7)", border: "1px solid rgba(168,154,135,0.2)" }}>
            <div style={{ color: "#A89A87", fontSize: 12, marginBottom: 4 }}>Cliente desde</div>
            <strong style={{ color: "#6B5540", fontSize: 14 }}>{shortDate(client?.createdAt)}</strong>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "rgba(253,252,250,0.7)", border: "1px solid rgba(168,154,135,0.2)" }}>
            <div style={{ color: "#A89A87", fontSize: 12, marginBottom: 4 }}>Primera reserva registrada</div>
            <strong style={{ color: "#6B5540", fontSize: 14 }}>{firstVisit ? shortDate(firstVisit.startsAt) : "Sin reservas"}</strong>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "rgba(253,252,250,0.7)", border: "1px solid rgba(168,154,135,0.2)" }}>
            <div style={{ color: "#A89A87", fontSize: 12, marginBottom: 4 }}>Cumpleaños</div>
            <strong style={{ color: "#6B5540", fontSize: 14 }}>{client?.birthday ? `${birthdayDateLabel(client.birthday)} · ${client.age ?? "—"} años` : "Sin fecha"}</strong>
          </div>
        </div>
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
        initial={{ fullName: client.fullName, whatsapp: client.whatsapp, email: client.email, recordNumber: client.recordNumber, address: client.address, birthday: client.birthday }}
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
                return (
                  <div
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      border: "1px solid rgba(168,154,135,0.24)",
                      background: answer === "SI" ? "rgba(142,36,170,0.07)" : "#FDFCFA",
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
                            background: answer === value ? (value === "SI" ? "#8E24AA" : "#A89A87") : "rgba(168,154,135,0.14)",
                            color: answer === value ? "#FFFFFF" : "#8C6E50",
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

function TreatmentsCard({ treatments, appointments = [], clientId, onSaved }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTreatment, setEditingTreatment] = useState(null);
  const [treatmentToDelete, setTreatmentToDelete] = useState(null);
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const deleteTreatmentAnim = useAnimatedMount(Boolean(treatmentToDelete), 220);

  useEffect(() => {
    if (!showForm) return;
    authFetch("/services").then((s) => setServices(Array.isArray(s) ? s.filter((x) => x.active) : [])).catch(() => {});
  }, [showForm]);

  function resetForm() {
    setEditingTreatment(null);
    setServiceId("");
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
        await authFetch(`/treatments/${editingTreatment.id}`, { method: "PATCH", body: { sessionDate, notes: notes || null } });
        toast.success("Tratamiento actualizado");
      } else {
        await authFetch(`/clients/${clientId}/treatments`, { method: "POST", body: { serviceId, sessionDate, notes: notes || undefined } });
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
    confirmado: { label: "Asistió / confirmada", color: "#6F7F45", bg: "rgba(111,127,69,0.12)" },
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
          <button onClick={() => (showForm ? (setShowForm(false), resetForm()) : openCreate())} style={{ padding: "4px 14px", borderRadius: 999, border: "1px solid #8C6E50", background: showForm ? "#8C6E50" : "none", color: showForm ? "#F7F5F0" : "#8C6E50", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>{showForm ? "Cancelar" : "+ Agregar"}</button>
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

      {showForm && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, padding: 14, background: "rgba(201,168,118,0.08)", borderRadius: 10 }}>
          <div><label style={{ display: "block", fontSize: 11, color: "#A89A87", marginBottom: 4 }}>Servicio</label><select value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={Boolean(editingTreatment)} style={{ ...inputSt, appearance: "none", cursor: editingTreatment ? "not-allowed" : "pointer", opacity: editingTreatment ? 0.72 : 1 }}><option value="">Seleccionar...</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
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
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => openEdit(t)} aria-label="Editar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(168,154,135,0.35)", background: "#FDFCFA", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Pencil size={14} /></button>
                      <button type="button" onClick={() => setTreatmentToDelete(t)} aria-label="Eliminar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(194,84,80,0.28)", background: "rgba(194,84,80,0.06)", color: "#9A4E48", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Trash2 size={14} /></button>
                    </div>
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

