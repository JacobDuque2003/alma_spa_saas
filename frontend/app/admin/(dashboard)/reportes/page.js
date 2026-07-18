"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Lock } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, Tooltip } from "recharts";

const METRICS = [
  "ocupacion-gabinetes",
  "ingresos-servicio",
  "servicios-vendidos",
  "desempeno-terapeutas",
  "cancelaciones",
  "clientes-nuevos-recurrentes",
];

function toLocalDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}
function money(v) {
  return `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function ReportesPage() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom] = useState(toLocalDate(first));
  const [to, setTo] = useState(toLocalDate(now));
  const [reports, setReports] = useState({});
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => ({ from: `${from}T00:00:00`, to: `${to}T23:59:59` }), [from, to]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const entries = await Promise.all(
      METRICS.map(async (metric) => {
        try {
          return [metric, { ok: true, value: await authFetch(`/reports/${metric}`, { query: range }) }];
        } catch (err) {
          return [metric, { ok: false, error: err.message, status: err.status }];
        }
      }),
    );
    setReports(Object.fromEntries(entries));
    setLoading(false);
  }, [range]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const occ = reports["ocupacion-gabinetes"]?.value?.data?.gabinetes || [];
  const income = reports["ingresos-servicio"];
  const sold = reports["servicios-vendidos"]?.value?.data?.services || [];
  const staff = reports["desempeno-terapeutas"]?.value?.data?.terapeutas || [];
  const canc = reports.cancelaciones?.value?.data;
  const clients = reports["clientes-nuevos-recurrentes"]?.value?.data;

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: 30, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
            Reportes
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>
            Rendimiento de tu spa en el periodo elegido
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: "#F7F5F0" }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ border: "none", background: "transparent", fontSize: 13, color: "#6B5540", outline: "none" }}
          />
          <span style={{ color: "#A89A87" }}>—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ border: "none", background: "transparent", fontSize: 13, color: "#6B5540", outline: "none" }}
          />
          <button
            onClick={fetchReports}
            style={{
              padding: "7px 18px",
              borderRadius: 999,
              background: "#8C6E50",
              color: "#F7F5F0",
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Actualizar
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {/* Ocupacion */}
          <RCard title="Ocupacion por gabinete">
            <Bars
              items={occ.map((r) => ({ name: r.roomName, value: r.porcentaje, suffix: "%" }))}
              note="Horas reservadas sobre horas disponibles del periodo."
            />
          </RCard>

          {/* Ingresos */}
          <RCard
            title="Ingresos por servicio"
            action={income?.ok && <span style={{ fontSize: 18, fontWeight: 600, color: "#8C6E50" }}>{money(income.value.data.grandTotalUsd)}</span>}
          >
            {income?.ok ? (
              <Bars
                items={(income.value.data.byService || []).slice(0, 5).map((r) => ({
                  name: r.serviceName || "Servicio",
                  value: Number(r.totalUsd),
                  label: money(r.totalUsd),
                }))}
                note="Totales autorizados por rol."
              />
            ) : (
              <Restricted text={income?.error} />
            )}
          </RCard>

          {/* Servicios mas vendidos */}
          <RCard title="Servicios mas vendidos">
            <Rank items={sold.slice(0, 5).map((s) => ({ name: s.serviceName || "Servicio", value: `${s.count} sesiones` }))} />
          </RCard>

          {/* Desempeno */}
          <RCard title="Desempeno por terapeuta">
            <Bars
              items={staff.map((s) => ({
                name: s.staffName,
                value: s.citasAtendidas,
                label: s.ingresosUsd ? `${s.citasAtendidas} · ${money(s.ingresosUsd)}` : `${s.citasAtendidas}`,
              }))}
              note="Sesiones atendidas; ingresos visibles solo para la duena."
            />
          </RCard>

          {/* Cancelaciones */}
          <RCard title="Cancelaciones y no-show">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p className="font-heading" style={{ fontSize: 42, fontWeight: 600, color: "#8C6E50", margin: 0 }}>
                {canc ? `${Number((canc.cancelaciones.rate || 0) + (canc.noShow.rate || 0)).toFixed(1)}%` : "—"}
              </p>
              <div style={{ height: 6, borderRadius: 999, background: "rgba(168,154,135,0.3)", overflow: "hidden", display: "flex" }}>
                <div style={{ height: "100%", background: "#8C6E50", width: `${Math.min(100, canc?.cancelaciones.rate || 0)}%` }} />
                <div style={{ height: "100%", background: "#EBCDB5", width: `${Math.min(100, canc?.noShow.rate || 0)}%` }} />
              </div>
              <p style={{ fontSize: 12, color: "#A89A87", margin: 0 }}>
                Cancelaron: {canc?.cancelaciones.count || 0} · No llegaron: {canc?.noShow.count || 0}
              </p>
            </div>
          </RCard>

          {/* Clientes */}
          <RCard title="Clientes nuevas vs. recurrentes">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <span className="font-heading" style={{ fontSize: 42, fontWeight: 600, color: "#8C6E50" }}>
                  {clients?.activos || 0}
                </span>
                <span style={{ fontSize: 13, color: "#A89A87", marginLeft: 8 }}>clientes atendidas</span>
              </div>
              <MiniChart nuevos={clients?.nuevos || 0} recurrentes={clients?.recurrentes || 0} />
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ padding: "4px 12px", borderRadius: 999, background: "rgba(201,168,118,0.2)", color: "#8C6E50", fontSize: 12, fontWeight: 500 }}>
                  Nuevas · {clients?.nuevos || 0}
                </span>
                <span style={{ padding: "4px 12px", borderRadius: 999, background: "#8C6E50", color: "#F7F5F0", fontSize: 12, fontWeight: 500 }}>
                  Recurrentes · {clients?.recurrentes || 0}
                </span>
              </div>
            </div>
          </RCard>
        </div>
      )}
    </div>
  );
}

function RCard({ title, action, children }) {
  return (
    <div
      style={{
        background: "#F7F5F0",
        border: "1px solid rgba(168,154,135,0.4)",
        borderRadius: 12,
        padding: 24,
        minHeight: 260,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          {title}
        </h3>
        {action}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function Bars({ items, note }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.length > 0 ? (
        items.map((item) => (
          <div key={item.name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B5540", marginBottom: 5 }}>
              <span>{item.name}</span>
              <b>{item.label || `${item.value}${item.suffix || ""}`}</b>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: "rgba(168,154,135,0.3)" }}>
              <div style={{ height: "100%", borderRadius: 999, background: "#8C6E50", width: `${Math.min(100, Number(item.value) || 0)}%`, transition: "width 0.4s" }} />
            </div>
          </div>
        ))
      ) : (
        <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>Sin datos en este periodo.</p>
      )}
      {note && <p style={{ fontSize: 11, color: "#A89A87", margin: "8px 0 0" }}>{note}</p>}
    </div>
  );
}

function Rank({ items }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.length > 0 ? (
        items.map((item, idx) => (
          <div
            key={item.name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "12px 0",
              borderBottom: idx < items.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none",
              fontSize: 14,
              color: "#6B5540",
            }}
          >
            <span>
              <b style={{ marginRight: 14, color: "#C9A876" }}>{idx + 1}</b>
              {item.name}
            </span>
            <b>{item.value}</b>
          </div>
        ))
      ) : (
        <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>Sin datos.</p>
      )}
    </div>
  );
}

function MiniChart({ nuevos, recurrentes }) {
  const data = [
    { name: "Nuevas", value: nuevos },
    { name: "Recurrentes", value: recurrentes },
  ];
  return (
    <div style={{ height: 90 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="30%">
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#A89A87" }} />
          <Tooltip
            contentStyle={{ background: "#F7F5F0", border: "1px solid rgba(168,154,135,0.4)", borderRadius: 8, fontSize: 13, color: "#6B5540" }}
            cursor={{ fill: "rgba(201,168,118,0.1)" }}
          />
          <Bar dataKey="value" fill="#8C6E50" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Restricted({ text }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 140, textAlign: "center", fontSize: 13, color: "#A89A87" }}>
      <Lock size={18} style={{ marginBottom: 8, color: "#A89A87" }} />
      {text || "Metrica restringida"}
    </div>
  );
}
