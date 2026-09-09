"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import {
  Loader2,
  Lock,
  DollarSign,
  Calendar as CalendarIcon,
  Sparkles,
  Percent,
  TrendingUp,
  Clock3,
  Users,
  Award,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";

// Metricas del panel — el backend soporta las 7 en VALID_METRICS. Aqui
// pedimos las que la vista usa. "cancelaciones" fue reemplazada por
// "movimiento-por-dia-hora" en el rediseño, pero la endpoint sigue viva
// en el backend por si algún otro consumidor la necesita mas adelante.
const METRICS = [
  "ocupacion-gabinetes",
  "ingresos-servicio",
  "servicios-vendidos",
  "desempeno-terapeutas",
  "clientes-nuevos-recurrentes",
  "movimiento-por-dia-hora",
];

function toLocalDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}
function money(v) {
  return `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function formatHour(h) {
  if (h == null) return "—";
  const suffix = h < 12 ? "a.m." : "p.m.";
  const twelve = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${twelve} ${suffix}`;
}

export default function ReportesPage() {
  const isMobile = useIsMobile();
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom] = useState(toLocalDate(first));
  const [to, setTo] = useState(toLocalDate(now));
  const [reports, setReports] = useState({});
  const [loading, setLoading] = useState(true);
  const [hasAnimated, setHasAnimated] = useState(false);

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

  useEffect(() => {
    if (!loading) setHasAnimated(true);
  }, [loading]);

  const occ = reports["ocupacion-gabinetes"]?.value?.data?.gabinetes || [];
  const occRaw = reports["ocupacion-gabinetes"]?.value?.data;
  const income = reports["ingresos-servicio"];
  const sold = reports["servicios-vendidos"]?.value?.data?.services || [];
  const staff = reports["desempeno-terapeutas"]?.value?.data?.terapeutas || [];
  const clients = reports["clientes-nuevos-recurrentes"]?.value?.data;
  const movimiento = reports["movimiento-por-dia-hora"]?.value?.data;

  // Resumen del mes — se calculan una sola vez con los datos ya traidos, sin
  // llamada extra al backend. Ocupacion general = promedio ponderado por
  // horas ocupadas / capacidad total. Total citas = suma de citas por cabina
  // (aproximado al conteo de citas del periodo).
  const summary = useMemo(() => {
    const totalIncome = Number(income?.value?.data?.grandTotalUsd || 0);
    const totalAppointments = movimiento?.total ?? occ.reduce((sum, r) => sum + (r.citasCount || 0), 0);
    const newClients = clients?.nuevos ?? 0;
    let occGeneral = 0;
    if (occ.length > 0) {
      const totalCap = occ.reduce((s, r) => s + (r.capacidadHoras || 0), 0);
      const totalUsed = occ.reduce((s, r) => s + (r.horasOcupadas || 0), 0);
      if (totalCap > 0) occGeneral = Math.round((totalUsed / totalCap) * 1000) / 10;
    }
    return { totalIncome, totalAppointments, newClients, occGeneral };
  }, [income, occ, clients, movimiento]);

  const incomeAllowed = income?.ok !== false;

  return (
    <div className="flex flex-1 min-w-0 flex-col gap-6 overflow-y-auto p-4 md:p-8">
      {/* Header + date range */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading m-0 text-2xl font-semibold text-bronze-deep md:text-3xl">
            Reportes
          </h1>
          <p className="m-0 mt-1 text-sm text-warm-gray">
            Rendimiento de tu spa en el periodo elegido
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-warm-gray/40 bg-[#F7F5F0] px-4 py-2 shadow-sm">
          <CalendarIcon size={14} className="text-warm-gray" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border-none bg-transparent text-sm text-bronze-deep outline-none"
          />
          <span className="text-warm-gray">—</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border-none bg-transparent text-sm text-bronze-deep outline-none"
          />
          <button
            onClick={fetchReports}
            className="ml-1 cursor-pointer rounded-full border-none bg-bronze px-4 py-1.5 text-sm font-medium text-[#F7F5F0] transition hover:brightness-110"
          >
            Actualizar
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-bronze" />
        </div>
      ) : (
        <>
          {/* HERO — Resumen del mes */}
          <section aria-labelledby="summary-title" className="flex flex-col gap-3">
            <h2 id="summary-title" className="font-heading m-0 text-lg font-semibold text-bronze-deep md:text-xl">
              Resumen del periodo
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <StatTile
                label="Total facturado"
                value={incomeAllowed ? money(summary.totalIncome) : <Lock size={20} className="text-warm-gray" />}
                sub={incomeAllowed ? "Ingresos del periodo" : "Solo dueña / superadmin"}
                Icon={DollarSign}
                accentClass="from-bronze/12 to-bronze/0 text-bronze"
                stagger={!hasAnimated}
                index={0}
              />
              <StatTile
                label="Citas totales"
                value={summary.totalAppointments.toLocaleString("es-EC")}
                sub="Reservadas o confirmadas"
                Icon={CalendarIcon}
                accentClass="from-gold/20 to-gold/0 text-[#8C6E50]"
                stagger={!hasAnimated}
                index={1}
              />
              <StatTile
                label="Clientas nuevas"
                value={summary.newClients.toLocaleString("es-EC")}
                sub="Alta durante el periodo"
                Icon={Sparkles}
                accentClass="from-glow/40 to-glow/0 text-[#B85A56]"
                stagger={!hasAnimated}
                index={2}
              />
              <StatTile
                label="Ocupación general"
                value={`${summary.occGeneral.toFixed(1)}%`}
                sub="Cabinas usadas vs. disponibles"
                Icon={Percent}
                accentClass="from-[#556B2F]/15 to-[#556B2F]/0 text-[#556B2F]"
                stagger={!hasAnimated}
                index={3}
              />
            </div>
          </section>

          {/* PRIMARY — 2 cards destacadas */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <FeatureCard
              title="Ingresos por servicio"
              subtitle="Top 5 por facturación"
              Icon={TrendingUp}
              stagger={!hasAnimated}
              index={4}
              headline={incomeAllowed ? money(summary.totalIncome) : null}
            >
              {incomeAllowed ? (
                <Bars
                  items={(income.value.data.byService || []).slice(0, 5).map((r) => ({
                    name: r.serviceName || "Servicio",
                    value: Number(r.totalUsd),
                    label: money(r.totalUsd),
                  }))}
                  emptyText="Sin ingresos registrados en este periodo."
                  note="Totales autorizados por rol."
                />
              ) : (
                <Restricted text={income?.error} />
              )}
            </FeatureCard>

            <FeatureCard
              title="Clientas nuevas vs. recurrentes"
              subtitle="Base de clientas activas"
              Icon={Users}
              stagger={!hasAnimated}
              index={5}
              headline={(clients?.activos || 0).toLocaleString("es-EC")}
              headlineSub="atendidas"
            >
              <div className="flex flex-col gap-4">
                <NewVsRecurrentSplit
                  nuevos={clients?.nuevos || 0}
                  recurrentes={clients?.recurrentes || 0}
                />
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-glow/40 px-3 py-1 text-xs font-semibold text-bronze-deep">
                    Nuevas · {clients?.nuevos || 0}
                  </span>
                  <span className="rounded-full bg-bronze px-3 py-1 text-xs font-semibold text-[#F7F5F0]">
                    Recurrentes · {clients?.recurrentes || 0}
                  </span>
                </div>
              </div>
            </FeatureCard>
          </div>

          {/* SECONDARY — 3 cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
            <SecondaryCard
              title="Ocupación por cabina"
              Icon={Percent}
              stagger={!hasAnimated}
              index={6}
              footerNote={
                occRaw
                  ? `${occRaw.hoursPerDay?.toFixed?.(1) ?? occRaw.hoursPerDay ?? 0} h/día · ${occRaw.workDaysCount ?? 0} días laborales`
                  : null
              }
            >
              <Bars
                items={occ.map((r) => ({
                  name: r.roomName,
                  value: r.porcentaje,
                  label: `${r.porcentaje}%`,
                }))}
                emptyText="Sin datos de ocupación."
              />
            </SecondaryCard>

            <SecondaryCard
              title="Servicios más vendidos"
              Icon={Award}
              stagger={!hasAnimated}
              index={7}
            >
              <Rank
                items={sold.slice(0, 5).map((s) => ({
                  name: s.serviceName || "Servicio",
                  value: `${s.count} sesiones`,
                }))}
              />
            </SecondaryCard>

            <SecondaryCard
              title="Desempeño por terapeuta"
              Icon={Users}
              stagger={!hasAnimated}
              index={8}
              footerNote="Ingresos visibles solo para la dueña."
            >
              <Bars
                items={staff.map((s) => ({
                  name: s.staffName,
                  value: s.citasAtendidas,
                  label: s.ingresosUsd ? `${s.citasAtendidas} · ${money(s.ingresosUsd)}` : `${s.citasAtendidas}`,
                }))}
                emptyText="Sin atenciones registradas."
              />
            </SecondaryCard>
          </div>

          {/* MOVIMIENTO — dias + horas */}
          <MovementCard data={movimiento} stagger={!hasAnimated} index={9} />
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, Icon, accentClass, stagger, index }) {
  return (
    <article
      className={`alma-card relative flex flex-col gap-2 overflow-hidden p-4 md:p-5 ${stagger ? "alma-stagger" : ""}`}
      style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      <div className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br opacity-100 ${accentClass}`} />
      <div className="relative z-10 flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-warm-gray md:text-xs">
          {label}
        </span>
        <span className={`opacity-50 ${accentClass?.split(" ").pop()}`}>
          <Icon size={18} />
        </span>
      </div>
      <div className="font-heading relative z-10 mt-1 text-3xl font-semibold leading-none text-bronze-deep md:text-4xl">
        {value}
      </div>
      {sub && (
        <span className="relative z-10 text-[11px] text-warm-gray md:text-xs">{sub}</span>
      )}
    </article>
  );
}

function FeatureCard({ title, subtitle, Icon, children, headline, headlineSub, stagger, index }) {
  return (
    <section
      className={`alma-card flex flex-col gap-4 p-5 md:p-6 ${stagger ? "alma-stagger" : ""}`}
      style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bronze/10 text-bronze">
              <Icon size={16} />
            </span>
            <h3 className="font-heading m-0 text-lg font-semibold text-bronze-deep">{title}</h3>
          </div>
          {subtitle && <p className="m-0 ml-10 text-xs text-warm-gray">{subtitle}</p>}
        </div>
        {headline != null && (
          <div className="text-right">
            <div className="font-heading text-xl font-semibold leading-none text-bronze md:text-2xl">
              {headline}
            </div>
            {headlineSub && <div className="text-[10px] text-warm-gray">{headlineSub}</div>}
          </div>
        )}
      </header>
      <div className="min-h-[140px]">{children}</div>
    </section>
  );
}

function SecondaryCard({ title, Icon, children, footerNote, stagger, index }) {
  return (
    <section
      className={`alma-card flex flex-col gap-3 p-5 ${stagger ? "alma-stagger" : ""}`}
      style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      <header className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-warm-gray/15 text-bronze-deep">
          <Icon size={14} />
        </span>
        <h3 className="font-heading m-0 text-base font-semibold text-bronze-deep">{title}</h3>
      </header>
      <div className="min-h-[140px] flex-1">{children}</div>
      {footerNote && <p className="m-0 text-[11px] text-warm-gray">{footerNote}</p>}
    </section>
  );
}

function Bars({ items, note, emptyText }) {
  if (items.length === 0) {
    return (
      <p className="my-8 text-center text-sm text-warm-gray">
        {emptyText || "Sin datos en este periodo."}
      </p>
    );
  }
  const maxValue = Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return (
    <div className="flex flex-col gap-3.5">
      {items.map((item) => {
        const pct = Math.min(100, Math.round(((Number(item.value) || 0) / maxValue) * 100));
        return (
          <div key={item.name}>
            <div className="mb-1.5 flex justify-between text-xs text-bronze-deep">
              <span className="truncate pr-2">{item.name}</span>
              <b className="whitespace-nowrap">{item.label || `${item.value}${item.suffix || ""}`}</b>
            </div>
            <div className="h-1.5 rounded-full bg-warm-gray/25">
              <div
                className="alma-bar-grow h-full rounded-full bg-bronze"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {note && <p className="mt-2 text-[10px] text-warm-gray">{note}</p>}
    </div>
  );
}

function Rank({ items }) {
  if (items.length === 0) {
    return <p className="my-8 text-center text-sm text-warm-gray">Sin datos.</p>;
  }
  return (
    <ol className="m-0 flex flex-col p-0">
      {items.map((item, idx) => (
        <li
          key={item.name}
          className={`flex items-center justify-between py-2.5 text-sm text-bronze-deep ${
            idx < items.length - 1 ? "border-b border-warm-gray/25" : ""
          }`}
        >
          <span className="flex items-center gap-3 truncate">
            <span
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                idx === 0
                  ? "bg-gold text-[#F7F5F0]"
                  : idx === 1
                    ? "bg-gold/60 text-bronze-deep"
                    : "bg-warm-gray/20 text-bronze-deep"
              }`}
            >
              {idx + 1}
            </span>
            <span className="truncate">{item.name}</span>
          </span>
          <b className="ml-2 whitespace-nowrap">{item.value}</b>
        </li>
      ))}
    </ol>
  );
}

function NewVsRecurrentSplit({ nuevos, recurrentes }) {
  const total = Math.max(nuevos + recurrentes, 1);
  const nuevosPct = Math.round((nuevos / total) * 100);
  const recurrentesPct = 100 - nuevosPct;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-warm-gray">
        <span>Nuevas {nuevosPct}%</span>
        <span>Recurrentes {recurrentesPct}%</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-warm-gray/20">
        <div className="alma-bar-grow h-full bg-glow" style={{ width: `${nuevosPct}%` }} />
        <div className="alma-bar-grow h-full bg-bronze" style={{ width: `${recurrentesPct}%` }} />
      </div>
    </div>
  );
}

function MovementCard({ data, stagger, index }) {
  return (
    <section
      className={`alma-card flex flex-col gap-5 p-5 md:p-6 ${stagger ? "alma-stagger" : ""}`}
      style={stagger ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#556B2F]/12 text-[#556B2F]">
              <Clock3 size={16} />
            </span>
            <h3 className="font-heading m-0 text-lg font-semibold text-bronze-deep">
              Días y horas de más movimiento
            </h3>
          </div>
          <p className="m-0 ml-10 text-xs text-warm-gray">
            En qué momentos del periodo hay más demanda
          </p>
        </div>
        {data?.peak && (
          <div className="rounded-2xl border border-[#556B2F]/25 bg-[#556B2F]/8 px-4 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#556B2F]">
              Pico del periodo
            </div>
            <div className="font-heading text-base font-semibold text-bronze-deep md:text-lg">
              {data.peak.dayLabel} · {formatHour(data.peak.hour)}
            </div>
            <div className="text-[11px] text-warm-gray">{data.peak.count} citas</div>
          </div>
        )}
      </header>

      {!data || data.total === 0 ? (
        <p className="my-8 text-center text-sm text-warm-gray">
          Sin citas en el periodo elegido.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold text-warm-gray">Por día de la semana</div>
            <DayBars items={data.byDay} />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-warm-gray">Por franja horaria</div>
            <HourBars items={data.byHour} />
          </div>
        </div>
      )}
    </section>
  );
}

function DayBars({ items }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="m-0 flex flex-col gap-2 p-0">
      {items.map((it) => {
        const pct = Math.round((it.count / max) * 100);
        return (
          <li key={it.iso} className="flex items-center gap-3">
            <span className="w-16 flex-shrink-0 text-xs text-bronze-deep">{it.label}</span>
            <span className="relative h-2 flex-1 rounded-full bg-warm-gray/25">
              <span
                className="alma-bar-grow absolute left-0 top-0 h-full rounded-full bg-[#556B2F]"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-8 flex-shrink-0 text-right text-xs font-semibold text-bronze-deep">
              {it.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Colapsa las 24 horas en franjas del spa (7am-9pm) para no mostrar 24 filas
// que ademas tendrian mucho vacio en horas cerradas. Las horas fuera de rango
// se agrupan en "Fuera de horario" para no perder registros.
const HOUR_BUCKETS = [
  { label: "7-9 am", from: 7, to: 9 },
  { label: "9-11 am", from: 9, to: 11 },
  { label: "11-1 pm", from: 11, to: 13 },
  { label: "1-3 pm", from: 13, to: 15 },
  { label: "3-5 pm", from: 15, to: 17 },
  { label: "5-7 pm", from: 17, to: 19 },
  { label: "7-9 pm", from: 19, to: 21 },
];

function HourBars({ items }) {
  const buckets = HOUR_BUCKETS.map((b) => {
    const count = items
      .filter((it) => it.hour >= b.from && it.hour < b.to)
      .reduce((s, it) => s + it.count, 0);
    return { label: b.label, count };
  });
  const off = items
    .filter((it) => it.hour < 7 || it.hour >= 21)
    .reduce((s, it) => s + it.count, 0);
  if (off > 0) buckets.push({ label: "Fuera de horario", count: off });
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <ul className="m-0 flex flex-col gap-2 p-0">
      {buckets.map((b) => {
        const pct = Math.round((b.count / max) * 100);
        return (
          <li key={b.label} className="flex items-center gap-3">
            <span className="w-24 flex-shrink-0 text-xs text-bronze-deep">{b.label}</span>
            <span className="relative h-2 flex-1 rounded-full bg-warm-gray/25">
              <span
                className="alma-bar-grow absolute left-0 top-0 h-full rounded-full bg-gold"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-8 flex-shrink-0 text-right text-xs font-semibold text-bronze-deep">
              {b.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Restricted({ text }) {
  return (
    <div className="flex min-h-[140px] flex-col items-center justify-center text-center text-sm text-warm-gray">
      <Lock size={18} className="mb-2 text-warm-gray" />
      {text || "Métrica restringida"}
    </div>
  );
}
