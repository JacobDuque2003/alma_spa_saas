"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  User,
  LayoutGrid,
  Loader2,
  X,
} from "lucide-react";

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8);
const STATUS_COLORS = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  confirmado: "bg-green-100 text-green-800 border-green-300",
  cancelado: "bg-red-100 text-red-800 border-red-300",
  no_show: "bg-gray-100 text-gray-800 border-gray-300",
};
const STATUS_LABELS = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  no_show: "No asistió",
};

function toLocalDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

function formatHour(h) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Guayaquil",
  });
}

function getEcuadorHour(iso) {
  const parts = new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Guayaquil",
  });
  return parseInt(parts, 10);
}

function getDaysBetween(start, end) {
  const days = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(toLocalDate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDate(d);
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-EC", {
    weekday: "short",
    day: "numeric",
    timeZone: "America/Guayaquil",
  });
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Guayaquil",
  });
}

export default function AgendaPage() {
  const today = toLocalDate(new Date());
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(today);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      let from, to;
      if (view === "day") {
        from = `${selectedDate}T00:00:00`;
        to = `${selectedDate}T23:59:59`;
      } else {
        const ws = getWeekStart(selectedDate);
        const we = new Date(ws + "T12:00:00");
        we.setDate(we.getDate() + 6);
        from = `${ws}T00:00:00`;
        to = `${toLocalDate(we)}T23:59:59`;
      }
      const data = await authFetch("/appointments", { query: { from, to } });
      setAppointments(data);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, view]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  function navigate(dir) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + (view === "day" ? dir : dir * 7));
    setSelectedDate(toLocalDate(d));
  }

  function goToday() {
    setSelectedDate(today);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {view === "day" ? formatDateFull(selectedDate) : `Semana del ${formatDateFull(getWeekStart(selectedDate))}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Hoy
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            variant={view === "day" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("day")}
          >
            Día
          </Button>
          <Button
            variant={view === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("week")}
          >
            Semana
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : view === "day" ? (
        <DayView
          appointments={appointments}
          date={selectedDate}
          onSelect={setSelected}
        />
      ) : (
        <WeekView
          appointments={appointments}
          selectedDate={selectedDate}
          onSelect={setSelected}
        />
      )}

      {selected && (
        <AppointmentDetail appt={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function DayView({ appointments, date, onSelect }) {
  const byHour = {};
  for (const appt of appointments) {
    if (appt.status === "cancelado") continue;
    const h = getEcuadorHour(appt.startsAt);
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(appt);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {HOURS.map((h) => (
        <div key={h} className="flex border-b border-border last:border-b-0 min-h-16">
          <div className="w-20 flex-shrink-0 p-2 text-xs text-muted-foreground text-right border-r border-border bg-muted/30">
            {formatHour(h)}
          </div>
          <div className="flex-1 p-1 flex flex-wrap gap-1">
            {(byHour[h] || []).map((appt) => (
              <button
                key={appt.id}
                onClick={() => onSelect(appt)}
                className={`rounded px-2 py-1 text-xs text-left border cursor-pointer transition-opacity hover:opacity-80 ${STATUS_COLORS[appt.status]}`}
              >
                <span className="font-medium">{appt.service?.name}</span>
                {appt.client && (
                  <span className="ml-1 opacity-70">— {appt.client.fullName}</span>
                )}
                {appt.room && (
                  <span className="ml-1 opacity-60">[{appt.room.name}]</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekView({ appointments, selectedDate, onSelect }) {
  const ws = getWeekStart(selectedDate);
  const we = new Date(ws + "T12:00:00");
  we.setDate(we.getDate() + 6);
  const days = getDaysBetween(new Date(ws + "T12:00:00"), we);

  const byDayHour = {};
  for (const appt of appointments) {
    if (appt.status === "cancelado") continue;
    const d = new Date(appt.startsAt);
    const dayKey = toLocalDate(d);
    const h = getEcuadorHour(appt.startsAt);
    const key = `${dayKey}-${h}`;
    if (!byDayHour[key]) byDayHour[key] = [];
    byDayHour[key].push(appt);
  }

  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full min-w-[700px] table-fixed">
        <thead>
          <tr className="border-b border-border">
            <th className="w-20 p-2 text-xs text-muted-foreground font-normal" />
            {days.map((d) => (
              <th
                key={d}
                className={`p-2 text-xs font-medium text-center ${
                  d === toLocalDate(new Date())
                    ? "text-primary"
                    : "text-foreground"
                }`}
              >
                {formatDateShort(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h} className="border-b border-border last:border-b-0">
              <td className="p-2 text-xs text-muted-foreground text-right border-r border-border bg-muted/30">
                {formatHour(h)}
              </td>
              {days.map((d) => {
                const appts = byDayHour[`${d}-${h}`] || [];
                return (
                  <td key={d} className="p-0.5 align-top">
                    {appts.map((appt) => (
                      <button
                        key={appt.id}
                        onClick={() => onSelect(appt)}
                        className={`block w-full rounded px-1 py-0.5 text-[10px] text-left border mb-0.5 cursor-pointer hover:opacity-80 ${STATUS_COLORS[appt.status]}`}
                      >
                        <span className="font-medium truncate block">
                          {appt.service?.name}
                        </span>
                        <span className="opacity-70">{formatTime(appt.startsAt)}</span>
                      </button>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppointmentDetail({ appt, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-full max-w-md mx-4 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-heading font-bold">
              {appt.service?.name || "Servicio"}
            </h2>
            <Badge className={STATUS_COLORS[appt.status]}>
              {STATUS_LABELS[appt.status]}
            </Badge>
          </div>

          <Separator />

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {formatTime(appt.startsAt)} — {formatTime(appt.endsAt)}
              </span>
              {appt.service?.durationMins && (
                <span className="text-muted-foreground">
                  ({appt.service.durationMins} min)
                </span>
              )}
            </div>

            {appt.client && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{appt.client.fullName}</span>
                {appt.client.whatsapp && (
                  <span className="text-muted-foreground">{appt.client.whatsapp}</span>
                )}
              </div>
            )}

            {appt.room && (
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                <span>{appt.room.name}</span>
              </div>
            )}

            {appt.staff && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Atendido por:</span>
                <span>{appt.staff.name}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span>
                {appt.modality === "domicilio" ? "A domicilio" : "En gabinete"}
              </span>
            </div>

            {appt.priceUsd != null && (
              <div className="text-right font-medium text-primary">
                ${Number(appt.priceUsd).toFixed(2)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
