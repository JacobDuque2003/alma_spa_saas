"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Brain, CheckCircle2, Cloud, Database, Loader2, MessageCircle, RefreshCw, Server, Wifi } from "lucide-react";
import { authFetch } from "@/lib/auth-client";

const STATUS_STYLES = {
  ok: { label: "Operativo", color: "#4E7A32", bg: "#EEF5E8", icon: CheckCircle2 },
  warning: { label: "Revisar", color: "#9A7958", bg: "#F6EBDD", icon: AlertTriangle },
  error: { label: "Caído", color: "#A5483F", bg: "#F9E7E4", icon: AlertTriangle },
  active: { label: "Activo", color: "#4E7A32", bg: "#EEF5E8", icon: CheckCircle2 },
  stale: { label: "Sin actividad reciente", color: "#9A7958", bg: "#F6EBDD", icon: AlertTriangle },
  inactive: { label: "Sin actividad", color: "#A5483F", bg: "#F9E7E4", icon: AlertTriangle },
  unknown: { label: "Sin datos", color: "#9A7958", bg: "#F6EBDD", icon: AlertTriangle },
};

function formatDate(value) {
  if (!value) return "Sin datos";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin datos";
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function statusForCheck(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.warning;
}

function StatusPill({ status, label }) {
  const meta = statusForCheck(status);
  const Icon = meta.icon;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 10px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.color,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={14} />
      {label || meta.label}
    </span>
  );
}

function SignalCard({ icon, title, status, children }) {
  const Icon = icon;
  return (
    <section
      style={{
        border: "1px solid rgba(168,154,135,0.24)",
        borderRadius: 8,
        background: "#FFFDF9",
        padding: 18,
        display: "grid",
        gap: 14,
        minWidth: 0,
        boxShadow: "0 10px 24px rgba(107,85,64,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              background: "rgba(201,168,118,0.16)",
              color: "#8C6E50",
              flexShrink: 0,
            }}
          >
            <Icon size={18} />
          </span>
          <h2 style={{ margin: 0, color: "#6B5540", fontSize: 16, fontWeight: 800 }}>{title}</h2>
        </div>
        <StatusPill status={status} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </section>
  );
}

function Detail({ label, value }) {
  const displayValue = value === null || value === undefined || value === "" ? "Sin datos" : value;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderTop: "1px solid rgba(168,154,135,0.14)", paddingTop: 8 }}>
      <span style={{ color: "#A89A87", fontSize: 12, fontWeight: 700 }}>{label}</span>
      <span style={{ color: "#6B5540", fontSize: 13, fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
        {displayValue}
      </span>
    </div>
  );
}

function checkStatus(data, key) {
  return data?.checks?.find((check) => check.key === key)?.status || "warning";
}

export default function EstadoPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load({ soft = false } = {}) {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await authFetch("/system/status");
      setStatus(data);
    } catch (err) {
      setError(err.message || "No se pudo cargar el estado");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const overall = useMemo(() => statusForCheck(status?.overall || "warning"), [status]);
  const OverallIcon = overall.icon;

  return (
    <main style={{ minHeight: "100%", background: "#FDFCFA", padding: "30px clamp(18px, 4vw, 46px)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 22 }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 className="font-heading" style={{ margin: 0, color: "#5F4B36", fontSize: "clamp(30px, 4vw, 42px)" }}>Estado</h1>
            <p style={{ margin: "8px 0 0", color: "#A89A87", fontSize: 15 }}>
              Integraciones, mensajes, IA, backups y despliegue actual.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load({ soft: true })}
            disabled={loading || refreshing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 42,
              padding: "0 16px",
              borderRadius: 999,
              border: "1px solid rgba(168,154,135,0.34)",
              background: "#FFFDF9",
              color: "#8C6E50",
              fontWeight: 800,
              cursor: loading || refreshing ? "default" : "pointer",
            }}
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
        </header>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#8C6E50", fontWeight: 700 }}>
            <Loader2 size={18} className="animate-spin" />
            Cargando estado...
          </div>
        )}
        {error && <p style={{ margin: 0, color: "#A5483F", fontWeight: 700 }}>{error}</p>}

        {!loading && !error && status && (
          <>
            <section
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                flexWrap: "wrap",
                padding: 20,
                borderRadius: 8,
                border: "1px solid rgba(168,154,135,0.24)",
                background: "linear-gradient(135deg, rgba(253,252,250,0.98), rgba(235,205,181,0.22))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 46, height: 46, borderRadius: "50%", display: "grid", placeItems: "center", color: overall.color, background: overall.bg }}>
                  <OverallIcon size={22} />
                </span>
                <div>
                  <p style={{ margin: 0, color: "#6B5540", fontSize: 17, fontWeight: 900 }}>{overall.label}</p>
                  <p style={{ margin: "3px 0 0", color: "#A89A87", fontSize: 13 }}>
                    {status.tenant?.name || "Tenant"} · {formatDate(status.generatedAt)}
                  </p>
                </div>
              </div>
              <StatusPill status={status.overall} />
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14 }}>
              <SignalCard icon={MessageCircle} title="WhatsApp API" status={checkStatus(status, "whatsapp")}>
                <Detail label="Estado" value={status.whatsapp.connected ? status.whatsapp.status : "desconectado"} />
                <Detail label="Número" value={status.whatsapp.displayPhone || status.whatsapp.phoneNumberId} />
                <Detail label="Validado" value={formatDate(status.whatsapp.lastVerifiedAt)} />
                {status.whatsapp.lastError && <Detail label="Error" value={status.whatsapp.lastError} />}
              </SignalCard>

              <SignalCard icon={Wifi} title="Webhook" status={status.webhook.status}>
                <Detail label="Actividad" value={statusForCheck(status.webhook.status).label} />
                <Detail label="Último mensaje" value={formatDate(status.webhook.lastInbound?.createdAt)} />
                <Detail label="Vista previa" value={status.webhook.lastInbound?.body} />
              </SignalCard>

              <SignalCard icon={Bot} title="Bot" status={status.bot.lastReply ? "ok" : "warning"}>
                <Detail label="Última respuesta" value={formatDate(status.bot.lastReply?.createdAt)} />
                <Detail label="Tipo" value={status.bot.lastReply?.type} />
                <Detail label="Vista previa" value={status.bot.lastReply?.body} />
              </SignalCard>

              <SignalCard icon={Brain} title="IA" status={checkStatus(status, "ai")}>
                <Detail label="Configuración" value={status.ai.configured ? "Configurada" : "No configurada"} />
                <Detail label="Modelo" value={status.ai.model} />
                <Detail label="Costo hoy" value={money(status.ai.todayCostUsd)} />
                <Detail label="Interacciones hoy" value={status.ai.todayInteractions} />
              </SignalCard>

              <SignalCard icon={Database} title="Base de datos" status={checkStatus(status, "database")}>
                <Detail label="Conexión" value={status.database.connected ? "Conectada" : "No disponible"} />
                <Detail label="Latencia" value={`${status.database.latencyMs || 0} ms`} />
              </SignalCard>

              <SignalCard icon={Cloud} title="GCS / Backups" status={checkStatus(status, "backups")}>
                <Detail label="Bucket" value={status.backups.bucketConfigured ? status.backups.bucket : "No configurado"} />
                <Detail label="Cuenta GCS" value={status.backups.serviceAccountConfigured ? "Configurada" : "No configurada"} />
                <Detail label="Base origen" value={status.backups.databaseUrlConfigured ? "Configurada" : "No configurada"} />
              </SignalCard>

              <SignalCard icon={Server} title="Railway" status="ok">
                <Detail label="Versión" value={status.railway.commit} />
                <Detail label="Ambiente" value={status.railway.nodeEnv} />
                <Detail label="Inicio" value={formatDate(status.railway.deployedAt)} />
              </SignalCard>
            </section>

            <section style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h2 className="font-heading" style={{ margin: 0, color: "#6B5540", fontSize: 24 }}>Errores recientes de Meta</h2>
                <StatusPill status={status.metaErrors.count ? "warning" : "ok"} label={status.metaErrors.count ? `${status.metaErrors.count} recientes` : "Sin errores"} />
              </div>
              {status.metaErrors.items.length === 0 ? (
                <p style={{ margin: 0, color: "#A89A87" }}>No hay errores recientes registrados.</p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {status.metaErrors.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(130px, 180px) 1fr",
                        gap: 12,
                        padding: 14,
                        borderRadius: 8,
                        border: "1px solid rgba(165,72,63,0.22)",
                        background: "#FFFDF9",
                        color: "#6B5540",
                      }}
                    >
                      <span style={{ color: "#A89A87", fontSize: 12, fontWeight: 800 }}>{formatDate(item.createdAt)}</span>
                      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                        <strong style={{ color: "#A5483F", fontSize: 13 }}>{item.errorCode || "Meta"}</strong>
                        <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>{item.errorTitle || item.body || "Error sin detalle"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
