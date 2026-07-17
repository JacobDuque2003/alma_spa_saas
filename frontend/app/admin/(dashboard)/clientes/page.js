"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Search } from "lucide-react";

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

  async function registerPayment() {
    if (!selectedId) return;
    const amountUsd = window.prompt("Monto del pago en USD");
    if (!amountUsd) return;
    const method = window.prompt("Método de pago (efectivo, transferencia, tarjeta)") || "no especificado";
    await authFetch(`/clients/${selectedId}/payments`, {
      method: "POST",
      body: { amountUsd: Number(amountUsd), method, description: "Pago registrado desde panel" },
    });
    await fetchDetail();
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
                  href="/admin/agenda"
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
                <IntakeCard intake={intake} />
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

function IntakeCard({ intake }) {
  return (
    <div style={{ background: "#F7F5F0", border: "1px solid rgba(168,154,135,0.4)", borderRadius: 12, padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 className="font-heading" style={{ fontSize: 21, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          Ficha de anamnesis estética
        </h3>
        <span style={{ fontSize: 13, color: "#8C6E50", textDecoration: "underline", cursor: "pointer" }}>Editar</span>
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
