"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Search, X, ArrowLeft, Pencil, Trash2 } from "lucide-react";
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
  const markedMatch = text.match(/Antecedentes marcados:\s*([^\n]+)/i);
  const notesMatch = text.match(/Observaciones:\s*([\s\S]+)/i);
  return {
    selected: markedMatch ? markedMatch[1].split(";").map((x) => x.trim()).filter(Boolean) : [],
    notes: notesMatch ? notesMatch[1].trim() : (!markedMatch ? text.trim() : ""),
  };
}

function buildChecklistText(selected, notes) {
  const parts = [];
  if (selected.length) parts.push(`Antecedentes marcados: ${selected.join("; ")}`);
  if (notes.trim()) parts.push(`Observaciones: ${notes.trim()}`);
  return parts.join("\n");
}

export default function ClientesPage() {
  const searchParams = useSearchParams();
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
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authFetch("/clients", { query: query ? { q: query } : undefined });
      setClients(Array.isArray(data) ? data : []);
      setSelectedId((current) => current || (Array.isArray(data) && data[0]?.id) || null);
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
      if (view === "deshabilitadas") {
        setSelectedId((current) => (Array.isArray(data) && data.some((c) => c.id === current) ? current : data[0]?.id || null));
      }
    } catch {
      setDisabledClients([]);
    } finally {
      setDisabledLoading(false);
    }
  }, [query, view]);

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

  const selectedBirthdayInfo = useMemo(() => birthdayList.find((b) => b.id === selectedId) || null, [birthdayList, selectedId]);
  async function handleEnableClient() {
    if (!selectedId) return;
    try {
      await authFetch(`/clients/${selectedId}/enable`, { method: "PATCH" });
      toast.success("Clienta habilitada");
      setView("todas");
      fetchClients();
      fetchDisabledClients();
      fetchDetail();
    } catch (err) {
      toast.error(err.message || "No se pudo habilitar la clienta");
    }
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar list */}
      {(!isMobile || !mobileShowDetail) && (
      <div
        style={{
          width: isMobile ? "100%" : 330,
          flex: isMobile ? "1" : "0 0 330px",
          borderRight: isMobile ? "none" : "1px solid rgba(168,154,135,0.35)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(247,245,240,0.6)",
        }}
      >
        <div style={{ padding: "24px 20px 14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: 0 }}>
              Clientes
            </h1>
            <span style={{ fontSize: 13, color: "#A89A87" }}>{view === "deshabilitadas" ? disabledClients.length : view === "cumples" ? birthdayList.length : clients.length} clientas</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#FDFCFA",
              border: "1px solid rgba(168,154,135,0.5)",
              borderRadius: 999,
              padding: "10px 16px",
            }}
          >
            <Search size={12} style={{ color: "#A89A87", flexShrink: 0 }} />
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
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button
              onClick={() => setView("todas")}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(168,154,135,0.4)",
                background: view === "todas" ? "#8C6E50" : "transparent",
                color: view === "todas" ? "#F7F5F0" : "#8C6E50",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Todas
            </button>
            <button
              onClick={() => setView("cumples")}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(168,154,135,0.4)",
                background: view === "cumples" ? "#8C6E50" : "transparent",
                color: view === "cumples" ? "#F7F5F0" : "#8C6E50",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {"\uD83C\uDF82 Cumplea\u00f1os"}
            </button>
            <button
              onClick={() => setView("deshabilitadas")}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(168,154,135,0.4)",
                background: view === "deshabilitadas" ? "#8C6E50" : "transparent",
                color: view === "deshabilitadas" ? "#F7F5F0" : "#8C6E50",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Deshabilitadas
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 12px", overflowY: "auto" }}>
          {view === "cumples" ? (
            birthdayLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
              </div>
            ) : birthdayList.length === 0 ? (
              <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>{"Sin cumplea\u00f1os en los pr\u00f3ximos 8 d\u00edas"}</p>
            ) : (
              birthdayList.map((b) => {
                const isSelected = b.id === selectedId;
                const caption = `${birthdayCaptionFromDays(b.daysUntil)} - ${birthdayDateLabel(b.birthday)}`;
                return (
                  <button
                    key={b.id}
                    onClick={() => { setSelectedId(b.id); if (isMobile) setMobileShowDetail(true); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 12px",
                      borderRadius: 10,
                      background: isSelected ? "rgba(235,205,181,0.45)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#C9A876", color: "#F7F5F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                      {initials(b.fullName)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.fullName}
                      </div>
                      <div style={{ fontSize: 12, color: b.daysUntil === 0 ? "#8C6E50" : "#A89A87", fontWeight: b.daysUntil === 0 ? 600 : 400 }}>
                        {caption}
                      </div>
                    </div>
                  </button>
                );
              })
            )
          ) : view === "deshabilitadas" ? (
            disabledLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
              </div>
            ) : disabledClients.length === 0 ? (
              <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>No hay clientas deshabilitadas.</p>
            ) : (
              disabledClients.map((client) => {
                const isSelected = client.id === selectedId;
                return (
                  <button
                    key={client.id}
                    onClick={() => { setSelectedId(client.id); if (isMobile) setMobileShowDetail(true); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 12px",
                      borderRadius: 10,
                      background: isSelected ? "rgba(235,205,181,0.45)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      opacity: 0.72,
                    }}
                  >
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(168,154,135,0.32)", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                      {initials(client.fullName)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {client.fullName}
                      </div>
                      <div style={{ fontSize: 12, color: "#A89A87" }}>
                        Deshabilitada · {client.whatsapp}
                      </div>
                    </div>
                  </button>
                );
              })
            )
          ) : loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
            </div>
          ) : clients.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>Sin resultados</p>
          ) : (
            clients.map((client) => {
              const isSelected = client.id === selectedId;
              return (
                <button
                  key={client.id}
                  onClick={() => { setSelectedId(client.id); if (isMobile) setMobileShowDetail(true); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "13px 12px",
                    borderRadius: 10,
                    background: isSelected ? "rgba(235,205,181,0.45)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: isSelected ? "#C9A876" : "rgba(201,168,118,0.35)",
                      color: isSelected ? "#F7F5F0" : "#8C6E50",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {initials(client.fullName)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {client.fullName}
                    </div>
                    <div style={{ fontSize: 12, color: isSelected ? "#8C6E50" : "#A89A87" }}>
                      {client.whatsapp}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(168,154,135,0.35)" }}>
          <button
            onClick={() => setShowNewClient(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "9px 18px",
              borderRadius: 999,
              border: "1px solid #8C6E50",
              background: "none",
              color: "#8C6E50",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Nueva clienta
          </button>
        </div>
      </div>
      )}

      {/* Detail panel */}
      {(!isMobile || mobileDetailAnim.shouldRender) && (
      <div key={isMobile ? undefined : selectedId} className={isMobile ? `alma-slide-right alma-anim-${mobileDetailAnim.phase}` : "alma-stagger"} style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "26px 30px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto" }}>
        {isMobile && (
          <button
            onClick={() => setMobileShowDetail(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 0",
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
            Clientes
          </button>
        )}
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
                client={detail}
                phase={editClientAnim.phase}
                onClose={() => setShowEditClient(false)}
                onSaved={() => { setShowEditClient(false); fetchDetail(); fetchClients(); fetchDisabledClients(); }}
              />
            )}
            {deleteClientAnim.shouldRender && (
              <DeleteClientModal
                client={detail}
                phase={deleteClientAnim.phase}
                onClose={() => setShowDeleteClient(false)}
                onDeleted={() => {
                  setShowDeleteClient(false);
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
            {newClientAnim.shouldRender && (
              <NewClientModal
                phase={newClientAnim.phase}
                onClose={() => setShowNewClient(false)}
                onSaved={(created) => {
                  setShowNewClient(false);
                  setClients((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
                  setSelectedId(created.id);
                }}
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
                        <span>🎂</span>
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

            {/* Content grid */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr", gap: 18, flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
                <IntakeCard intake={intake} onEdit={() => setShowEditIntake(true)} />
                <PlansBalanceCard plans={plans} balance={balance} onPayment={registerPayment} />
                <ClientTimelineCard appointments={clientAppointments} />
              </div>
              <TreatmentsCard treatments={treatments} clientId={selectedId} onSaved={fetchDetail} />
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

function IntakeCard({ intake, onEdit }) {
  const parsedConditions = parseChecklistText(intake?.conditions || "");
  return (
    <div className="alma-card" style={{ padding: 22 }}>
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
          <div style={{ fontSize: 12, color: "#A89A87", marginBottom: 3 }}>Condiciones relevantes para su tratamiento</div>
          {parsedConditions.selected.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {parsedConditions.selected.map((item) => (
                <span key={item} style={{ padding: "4px 9px", borderRadius: 999, background: "rgba(201,168,118,0.16)", color: "#6B5540", fontSize: 12 }}>
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          <div style={{ fontSize: 14, color: "#6B5540", marginTop: parsedConditions.selected.length ? 8 : 0 }}>
            {parsedConditions.notes || (!parsedConditions.selected.length ? "Sin condiciones registradas" : "")}
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

function PlansBalanceCard({ plans, balance, onPayment }) {
  const activePlan = (plans || []).find((p) => p.active) || plans?.[0];
  const balanceAmount = Number(balance?.balanceUsd || 0);
  const entries = Array.isArray(balance?.entries) ? balance.entries : [];
  const balanceLabel = balanceAmount > 0
    ? `Por cobrar: ${money(balanceAmount)}`
    : balanceAmount < 0
      ? `Saldo a favor: ${money(Math.abs(balanceAmount))}`
      : "Cuenta al día";

  return (
    <div className="alma-card" style={{ padding: 22, flex: 1 }}>
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

function ClientTimelineCard({ appointments }) {
  const rows = Array.isArray(appointments)
    ? [...appointments].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()).slice(0, 8)
    : [];
  const statusInfo = {
    pendiente: { label: "Reservó, falta confirmar", color: "#A89A87", bg: "rgba(168,154,135,0.14)" },
    confirmado: { label: "Asistió / confirmada", color: "#6F7F45", bg: "rgba(111,127,69,0.12)" },
    cancelado: { label: "Cancelada", color: "#9A4E48", bg: "rgba(154,78,72,0.10)" },
    no_show: { label: "No asistió", color: "#B85A56", bg: "rgba(194,84,80,0.12)" },
  };

  return (
    <div className="alma-card" style={{ padding: 22 }}>
      <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: "0 0 14px" }}>
        Historial de reservas
      </h3>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#A89A87" }}>Todavía no hay reservas registradas.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((appt) => {
            const info = statusInfo[appt.status] || statusInfo.pendiente;
            return (
              <div key={appt.id} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 5, background: info.color, boxShadow: "0 0 0 4px " + info.bg }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <strong style={{ fontSize: 13, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {appt.service?.name || "Servicio"}
                    </strong>
                    <span style={{ fontSize: 11, color: info.color, background: info.bg, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>
                      {info.label}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "#A89A87" }}>
                    {shortDate(appt.startsAt)} · {appt.room?.name || "Sin cabina"}
                  </div>
                  {appt.indications && (
                    <div style={{ marginTop: 3, fontSize: 12, color: "#8C6E50", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {appt.indications}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [selectedAntecedents, setSelectedAntecedents] = useState(parsed.selected);
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
        body: { allergies, conditions: buildChecklistText(selectedAntecedents, conditionNotes), consentSigned },
      });
      toast.success("Ficha guardada");
      onSaved();
    } catch (err) { toast.error(err.message || "Error al guardar"); setSaving(false); }
  }

  function toggleAntecedent(item) {
    setSelectedAntecedents((current) => current.includes(item) ? current.filter((x) => x !== item) : [...current, item]);
  }

  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 420, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={20} /></button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>Ficha de anamnesis</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={modalLabelStyle}>Alergias</label><textarea style={{ ...modalInputStyle, minHeight: 60, resize: "vertical" }} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Ninguna conocida" /></div>
          <div>
            <label style={modalLabelStyle}>Antecedentes clínicos</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7, maxHeight: 220, overflowY: "auto", padding: "2px 2px 4px" }}>
              {ANTECEDENT_OPTIONS.map((item) => {
                const checked = selectedAntecedents.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleAntecedent(item)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      border: "1px solid " + (checked ? "rgba(201,168,118,0.62)" : "rgba(168,154,135,0.32)"),
                      background: checked ? "rgba(201,168,118,0.16)" : "#FDFCFA",
                      color: checked ? "#6B5540" : "#8C6E50",
                      borderRadius: 10,
                      padding: "7px 8px",
                      fontSize: 12,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, border: "1px solid rgba(140,110,80,0.45)", background: checked ? "#C9A876" : "transparent", color: "#F7F5F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>
                      {checked ? "✓" : ""}
                    </span>
                    <span>{item}</span>
                  </button>
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
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
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

function TreatmentsCard({ treatments, clientId, onSaved }) {
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

  return (
    <div className="alma-card" style={{ padding: 22, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>Historial de tratamientos</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#A89A87" }}>{treatments.length} sesiones</span>
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
        {treatments.length === 0 ? (
          <p style={{ textAlign: "center", padding: "60px 0", fontSize: 13, color: "#A89A87" }}>Sin tratamientos registrados todavia.</p>
        ) : (
          treatments.slice(0, 10).map((t) => (
            <div key={t.id} style={{ padding: "14px 0", borderBottom: "1px solid rgba(168,154,135,0.25)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <div style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#6B5540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.service?.name || "Tratamiento"}</span><span style={{ fontSize: 12, color: "#A89A87" }}>{shortDate(t.sessionDate)}</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => openEdit(t)} aria-label="Editar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(168,154,135,0.35)", background: "#FDFCFA", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Pencil size={14} /></button>
                  <button type="button" onClick={() => setTreatmentToDelete(t)} aria-label="Eliminar tratamiento" style={{ width: 30, height: 30, borderRadius: 999, border: "1px solid rgba(194,84,80,0.28)", background: "rgba(194,84,80,0.06)", color: "#9A4E48", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Trash2 size={14} /></button>
                </div>
              </div>
              {t.notes && <div style={{ fontSize: 13, color: "#8C6E50", marginBottom: 6 }}>{t.notes}</div>}
              {Array.isArray(t.productsUsed) && t.productsUsed.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {t.productsUsed.map((p) => <span key={p} style={{ padding: "3px 10px", borderRadius: 999, background: "rgba(168,154,135,0.2)", color: "#6B5540", fontSize: 11 }}>{p}</span>)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
