"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { authFetch } from "@/lib/auth-client";

const STATUS_META = {
  active: { label: "Activo", color: "#4E7A32", bg: "#EEF5E8" },
  grace: { label: "En gracia", color: "#9A7958", bg: "#F6EBDD" },
  suspended: { label: "Suspendido", color: "#A5483F", bg: "#F9E7E4" },
};

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function fromDateInput(value) {
  return value ? `${value}T12:00:00.000Z` : null;
}

function TenantRow({ tenant, onSaved }) {
  const [draft, setDraft] = useState({
    plan: tenant.plan || "trial",
    billingStatus: tenant.billingStatus || "active",
    billingDueAt: toDateInput(tenant.billingDueAt),
    billingGraceUntil: toDateInput(tenant.billingGraceUntil),
    suspensionReason: tenant.suspensionReason || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => (
    draft.plan !== (tenant.plan || "trial")
    || draft.billingStatus !== (tenant.billingStatus || "active")
    || draft.billingDueAt !== toDateInput(tenant.billingDueAt)
    || draft.billingGraceUntil !== toDateInput(tenant.billingGraceUntil)
    || draft.suspensionReason !== (tenant.suspensionReason || "")
  ), [draft, tenant]);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await authFetch(`/admin/tenants/${tenant.id}/billing`, {
        method: "PATCH",
        body: {
          plan: draft.plan,
          billingStatus: draft.billingStatus,
          billingDueAt: fromDateInput(draft.billingDueAt),
          billingGraceUntil: fromDateInput(draft.billingGraceUntil),
          suspensionReason: draft.suspensionReason,
        },
      });
      onSaved(result.tenant);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  const status = STATUS_META[draft.billingStatus] || STATUS_META.active;

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
        gap: 22,
        padding: 22,
        border: "1px solid rgba(168,154,135,0.26)",
        borderRadius: 8,
        background: "#FFFDF9",
        boxShadow: "0 12px 28px rgba(107,85,64,0.06)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div>
          <h2 className="font-heading" style={{ margin: 0, color: "#6B5540", fontSize: 24 }}>{tenant.name}</h2>
          <p style={{ margin: "4px 0 0", color: "#A89A87", fontSize: 13 }}>{tenant.slug}</p>
        </div>
        <span
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 11px",
            borderRadius: 999,
            color: status.color,
            background: status.bg,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {draft.billingStatus === "suspended" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {status.label}
        </span>
        <div style={{ display: "grid", gap: 5, color: "#8C6E50", fontSize: 13 }}>
          <span>{tenant.usersCount} usuarios</span>
          <span>{tenant.conversationsCount} conversaciones WhatsApp</span>
          <span>{tenant.active ? "Tenant operativo" : "Tenant inactivo"}</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>
            Plan
            <input
              value={draft.plan}
              onChange={(e) => setDraft((d) => ({ ...d, plan: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 6, color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>
            Estado
            <select
              value={draft.billingStatus}
              onChange={(e) => setDraft((d) => ({ ...d, billingStatus: e.target.value }))}
              style={inputStyle}
            >
              <option value="active">Activo</option>
              <option value="grace">En gracia</option>
              <option value="suspended">Suspendido</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>
            Vence
            <input
              type="date"
              value={draft.billingDueAt}
              onChange={(e) => setDraft((d) => ({ ...d, billingDueAt: e.target.value }))}
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>
            Gracia hasta
            <input
              type="date"
              value={draft.billingGraceUntil}
              onChange={(e) => setDraft((d) => ({ ...d, billingGraceUntil: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 6, color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>
            Motivo visible solo para soporte
            <input
              value={draft.suspensionReason}
              onChange={(e) => setDraft((d) => ({ ...d, suspensionReason: e.target.value }))}
              maxLength={300}
              placeholder="Ej. mensualidad pendiente, acuerdo de pago..."
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <p style={{ margin: 0, color: error ? "#A5483F" : saved ? "#4E7A32" : "#A89A87", fontSize: 13 }}>
            {error || (saved ? "Cambios guardados y sesiones actualizadas." : "Al suspender, el panel y reservas públicas se bloquean; WhatsApp sigue guardando mensajes.")}
          </p>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minWidth: 138,
              height: 42,
              borderRadius: 999,
              border: "none",
              background: !dirty || saving ? "rgba(156,134,111,0.35)" : "#9A7958",
              color: "#FFFDF9",
              fontWeight: 800,
              cursor: !dirty || saving ? "default" : "pointer",
            }}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar
          </button>
        </div>
      </div>
    </section>
  );
}

const inputStyle = {
  height: 42,
  border: "1px solid rgba(168,154,135,0.38)",
  borderRadius: 8,
  background: "#FFFDF9",
  color: "#6B5540",
  padding: "0 12px",
  outline: "none",
  fontSize: 14,
};

export default function SistemaPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    authFetch("/admin/tenants")
      .then((data) => {
        if (cancelled) return;
        setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "No se pudo cargar el sistema");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function replaceTenant(next) {
    setTenants((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  const totals = useMemo(() => ({
    active: tenants.filter((t) => t.billingStatus === "active").length,
    grace: tenants.filter((t) => t.billingStatus === "grace").length,
    suspended: tenants.filter((t) => t.billingStatus === "suspended").length,
  }), [tenants]);

  return (
    <main style={{ minHeight: "100%", padding: "30px clamp(20px, 4vw, 46px)", background: "#FDFCFA" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 22 }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18 }}>
          <div>
            <h1 className="font-heading" style={{ margin: 0, color: "#5F4B36", fontSize: "clamp(30px, 4vw, 42px)" }}>Sistema</h1>
            <p style={{ margin: "8px 0 0", color: "#A89A87", fontSize: 15 }}>
              Control comercial de tenants, suspensión reversible y trazabilidad de soporte.
            </p>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              border: "1px solid rgba(168,154,135,0.28)",
              borderRadius: 999,
              color: "#6B5540",
              background: "#FFFDF9",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <ShieldCheck size={17} />
            Solo técnico
          </div>
        </header>

        <section style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SummaryPill label="Activos" value={totals.active} color="#4E7A32" />
          <SummaryPill label="En gracia" value={totals.grace} color="#9A7958" />
          <SummaryPill label="Suspendidos" value={totals.suspended} color="#A5483F" />
        </section>

        {loading && (
          <div style={{ color: "#8C6E50", display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={18} className="animate-spin" />
            Cargando negocios...
          </div>
        )}
        {error && <p style={{ color: "#A5483F", margin: 0 }}>{error}</p>}
        {!loading && !error && tenants.length === 0 && (
          <p style={{ color: "#A89A87", margin: 0 }}>No hay tenants registrados todavía.</p>
        )}
        {!loading && !error && tenants.map((tenant) => (
          <TenantRow key={tenant.id} tenant={tenant} onSaved={replaceTenant} />
        ))}
      </div>
    </main>
  );
}

function SummaryPill({ label, value, color }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 13px",
        borderRadius: 999,
        border: "1px solid rgba(168,154,135,0.28)",
        background: "#FFFDF9",
        color: "#6B5540",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
      {label}: {value}
    </div>
  );
}
