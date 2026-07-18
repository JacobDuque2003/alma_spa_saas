"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Search, X } from "lucide-react";

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

export default function ClientesPage() {
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [intake, setIntake] = useState(null);
  const [treatments, setTreatments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [balance, setBalance] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const fetchDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      const [clientData, intakeData, treatmentsData, plansData, balanceData] = await Promise.all([
        authFetch(`/clients/${selectedId}`),
        authFetch(`/clients/${selectedId}/intake`).catch((err) => (err.status === 404 ? null : Promise.reject(err))),
        authFetch(`/clients/${selectedId}/treatments`).catch(() => []),
        authFetch(`/clients/${selectedId}/plans`).catch(() => []),
        authFetch(`/clients/${selectedId}/balance`).catch(() => null),
      ]);
      setDetail(clientData);
      setIntake(intakeData);
      setTreatments(Array.isArray(treatmentsData) ? treatmentsData : []);
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
  const [showEditIntake, setShowEditIntake] = useState(false);

  function registerPayment() {
    if (!selectedId) return;
    setShowPaymentForm(true);
  }

  const selected = clients.find((c) => c.id === selectedId);

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar list */}
      <div
        style={{
          width: 330,
          flex: "0 0 330px",
          borderRight: "1px solid rgba(168,154,135,0.35)",
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
            <span style={{ fontSize: 13, color: "#A89A87" }}>{clients.length}</span>
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
              placeholder="Busca por nombre o WhatsApp…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 12px", overflowY: "auto" }}>
          {loading ? (
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
                  onClick={() => setSelectedId(client.id)}
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

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0, padding: "26px 30px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto" }}>
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
            {showPaymentForm && (
              <PaymentFormModal
                clientName={detail.fullName}
                onClose={() => setShowPaymentForm(false)}
                onSaved={() => { setShowPaymentForm(false); fetchDetail(); }}
                clientId={selectedId}
              />
            )}
            {showEditClient && (
              <EditClientModal
                client={detail}
                onClose={() => setShowEditClient(false)}
                onSaved={() => { setShowEditClient(false); fetchDetail(); fetchClients(); }}
              />
            )}
            {showEditIntake && (
              <EditIntakeModal
                clientId={selectedId}
                intake={intake}
                onClose={() => setShowEditIntake(false)}
                onSaved={() => { setShowEditIntake(false); fetchDetail(); }}
              />
            )}
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
                  <h2 className="font-heading" style={{ fontSize: 28, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                    {detail.fullName}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#A89A87" }}>
                    <span>{detail.whatsapp}</span>
                    <span>·</span>
                    <span>Clienta desde {shortDate(detail.createdAt)}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 18, flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
                <IntakeCard intake={intake} onEdit={() => setShowEditIntake(true)} />
                <PlansBalanceCard plans={plans} balance={balance} onPayment={registerPayment} />
              </div>
              <TreatmentsCard treatments={treatments} />
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A89A87", fontSize: 14 }}>
            No se pudo cargar el cliente.
          </div>
        )}
      </div>
    </div>
  );
}

function IntakeCard({ intake, onEdit }) {
  return (
    <div style={{ background: "#F7F5F0", border: "1px solid rgba(168,154,135,0.4)", borderRadius: 12, padding: 22 }}>
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
          <div style={{ fontSize: 14, color: "#6B5540" }}>{intake?.conditions || "Sin condiciones registradas"}</div>
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
  const balanceAmount = balance?.balanceUsd || 0;
  const hasDebt = balanceAmount < 0;

  return (
    <div style={{ background: "#F7F5F0", border: "1px solid rgba(168,154,135,0.4)", borderRadius: 12, padding: 22, flex: 1 }}>
      <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: "0 0 14px" }}>
        Planes y saldo
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
            Saldo pendiente: {money(Math.abs(balanceAmount))}
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
          Registrar pago
        </button>
      </div>
    </div>
  );
}

const modalInputStyle = { width: "100%", padding: "10px 14px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 14, color: "#6B5540", background: "#FDFCFA", outline: "none", boxSizing: "border-box" };
const modalLabelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 };

function PaymentFormModal({ clientName, clientId, onClose, onSaved }) {
  const [amountUsd, setAmountUsd] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!Number(amountUsd) || Number(amountUsd) <= 0) {
      setError("Ingresa un monto válido");
      return;
    }
    setSaving(true);
    try {
      await authFetch(`/clients/${clientId}/payments`, {
        method: "POST",
        body: { amountUsd: Number(amountUsd), method, description: "Pago registrado desde panel" },
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Error al registrar pago");
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, margin: "0 16px", background: "#F7F5F0", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}>
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 6px" }}>Registrar pago</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#A89A87" }}>{clientName}</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={modalLabelStyle}>Monto (USD)</label>
            <input type="number" step="0.01" min="0.01" style={modalInputStyle} value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="45.00" autoFocus />
          </div>
          <div>
            <label style={modalLabelStyle}>Método de pago</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...modalInputStyle, appearance: "none", cursor: "pointer" }}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Registrando…" : "Registrar pago"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditClientModal({ client, onClose, onSaved }) {
  const [fullName, setFullName] = useState(client.fullName || "");
  const [whatsapp, setWhatsapp] = useState(client.whatsapp || "");
  const [email, setEmail] = useState(client.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fullName.trim() || !whatsapp.trim()) { setError("Nombre y WhatsApp son obligatorios"); return; }
    setSaving(true);
    try {
      await authFetch(`/clients/${client.id}`, { method: "PATCH", body: { fullName: fullName.trim(), whatsapp: whatsapp.trim(), email: email.trim() || null } });
      onSaved();
    } catch (err) { setError(err.message || "Error al guardar"); setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, margin: "0 16px", background: "#F7F5F0", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={20} /></button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>Editar clienta</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={modalLabelStyle}>Nombre completo</label><input style={modalInputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div><label style={modalLabelStyle}>WhatsApp</label><input style={modalInputStyle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></div>
          <div><label style={modalLabelStyle}>Correo (opcional)</label><input type="email" style={modalInputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditIntakeModal({ clientId, intake, onClose, onSaved }) {
  const [allergies, setAllergies] = useState(intake?.allergies || "");
  const [conditions, setConditions] = useState(intake?.conditions || "");
  const [consentSigned, setConsentSigned] = useState(intake?.consentSigned || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await authFetch(`/clients/${clientId}/intake`, { method: "PUT", body: { allergies, conditions, consentSigned } });
      onSaved();
    } catch (err) { setError(err.message || "Error al guardar"); setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, margin: "0 16px", background: "#F7F5F0", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={20} /></button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>Ficha de anamnesis</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={modalLabelStyle}>Alergias</label><textarea style={{ ...modalInputStyle, minHeight: 60, resize: "vertical" }} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Ninguna conocida" /></div>
          <div><label style={modalLabelStyle}>Condiciones relevantes</label><textarea style={{ ...modalInputStyle, minHeight: 60, resize: "vertical" }} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Ninguna" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={consentSigned} onChange={(e) => setConsentSigned(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#8C6E50" }} />
            <span style={{ fontSize: 13, color: "#6B5540" }}>Consentimiento firmado</span>
          </label>
          {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TreatmentsCard({ treatments }) {
  return (
    <div style={{ background: "#F7F5F0", border: "1px solid rgba(168,154,135,0.4)", borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          Historial de tratamientos
        </h3>
        <span style={{ fontSize: 13, color: "#A89A87" }}>{treatments.length} sesiones</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
        {treatments.length === 0 ? (
          <p style={{ textAlign: "center", padding: "60px 0", fontSize: 13, color: "#A89A87" }}>
            Sin tratamientos registrados todavía.
          </p>
        ) : (
          treatments.slice(0, 10).map((t) => (
            <div
              key={t.id}
              style={{ padding: "14px 0", borderBottom: "1px solid rgba(168,154,135,0.25)" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#6B5540" }}>Tratamiento</span>
                <span style={{ fontSize: 12, color: "#A89A87" }}>{shortDate(t.sessionDate)}</span>
              </div>
              {t.notes && (
                <div style={{ fontSize: 13, color: "#8C6E50", marginBottom: 6 }}>{t.notes}</div>
              )}
              {Array.isArray(t.productsUsed) && t.productsUsed.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {t.productsUsed.map((p) => (
                    <span
                      key={p}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: "rgba(168,154,135,0.2)",
                        color: "#6B5540",
                        fontSize: 11,
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
