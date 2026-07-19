"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/auth-client";
import { Loader2, X, Search } from "lucide-react";

const HOURS = Array.from({ length: 11 }, (_, i) => i + 9);
const STATUS_COLORS = {
  pendiente: { bg: "rgba(168,154,135,0.2)", border: "#A89A87", text: "#A89A87" },
  confirmado: { bg: "rgba(201,168,118,0.2)", border: "transparent", text: "#8C6E50" },
  cancelado: { bg: "rgba(194,84,80,0.1)", border: "#C25450", text: "#C25450" },
  no_show: { bg: "rgba(168,154,135,0.15)", border: "#A89A87", text: "#A89A87" },
};
const STATUS_LABELS = {
  pendiente: "Sin confirmar",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  no_show: "No asistió",
};
const ROOM_COLORS = ["#8C6E50", "#C9A876", "#A89A87", "#EBCDB5"];
const DAY_NAMES = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

function toLocalDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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

function getEcuadorMinutes(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    minute: "numeric",
    hour12: false,
    timeZone: "America/Guayaquil",
  });
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDate(d);
}

function getWeekDays(dateStr) {
  const ws = getWeekStart(dateStr);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws + "T12:00:00");
    d.setDate(d.getDate() + i);
    days.push(toLocalDate(d));
  }
  return days;
}

function formatWeekRange(dateStr) {
  const days = getWeekDays(dateStr);
  const first = new Date(days[0] + "T12:00:00");
  const last = new Date(days[6] + "T12:00:00");
  const fDay = first.getDate();
  const lDay = last.getDate();
  const month = first.toLocaleDateString("es-EC", { month: "long", timeZone: "America/Guayaquil" });
  const year = first.getFullYear();
  return `${fDay} – ${lDay} de ${month}, ${year}`;
}

function formatDayFull(dateStr) {
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
  const searchParams = useSearchParams();
  const preClientId = searchParams.get("clientId");
  const preClientName = searchParams.get("clientName");
  const [view, setView] = useState("week");
  const [selectedDate, setSelectedDate] = useState(today);
  const [appointments, setAppointments] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNewForm, setShowNewForm] = useState(!!preClientId);
  const [staffList, setStaffList] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let from, to;
      if (view === "day") {
        from = `${selectedDate}T00:00:00`;
        to = `${selectedDate}T23:59:59`;
      } else {
        const days = getWeekDays(selectedDate);
        from = `${days[0]}T00:00:00`;
        to = `${days[6]}T23:59:59`;
      }
      const [appts, roomList, userList] = await Promise.all([
        authFetch("/appointments", { query: { from, to } }).catch(() => []),
        authFetch("/rooms").catch(() => []),
        authFetch("/users").catch(() => []),
      ]);
      setAppointments(appts);
      setRooms(roomList.filter((r) => r.active));
      setStaffList(Array.isArray(userList) ? userList.filter((u) => u.canAttendAppointments && u.active) : []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, view]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function navigate(dir) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + (view === "day" ? dir : dir * 7));
    setSelectedDate(toLocalDate(d));
  }

  function handleCreated() {
    setShowNewForm(false);
    fetchData();
  }

  const roomColorMap = {};
  rooms.forEach((r, i) => {
    roomColorMap[r.id] = ROOM_COLORS[i % ROOM_COLORS.length];
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 32px",
          borderBottom: "1px solid rgba(168,154,135,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <h1
            className="font-heading"
            style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: 0 }}
          >
            Agenda
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                width: 30,
                height: 30,
                border: "1px solid #A89A87",
                borderRadius: "50%",
                background: "none",
                cursor: "pointer",
                color: "#8C6E50",
                fontSize: 14,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ‹
            </button>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#6B5540" }}>
              {view === "week" ? formatWeekRange(selectedDate) : formatDayFull(selectedDate)}
            </span>
            <button
              onClick={() => navigate(1)}
              style={{
                width: 30,
                height: 30,
                border: "1px solid #A89A87",
                borderRadius: "50%",
                background: "none",
                cursor: "pointer",
                color: "#8C6E50",
                fontSize: 14,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ›
            </button>
          </div>
          <div
            style={{
              display: "flex",
              background: "#F7F5F0",
              border: "1px solid rgba(168,154,135,0.4)",
              borderRadius: 999,
              padding: 3,
            }}
          >
            <button
              onClick={() => setView("week")}
              style={{
                padding: "7px 20px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: view === "week" ? 500 : 400,
                background: view === "week" ? "#8C6E50" : "transparent",
                color: view === "week" ? "#F7F5F0" : "#8C6E50",
              }}
            >
              Semana
            </button>
            <button
              onClick={() => setView("day")}
              style={{
                padding: "7px 20px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: view === "day" ? 500 : 400,
                background: view === "day" ? "#8C6E50" : "transparent",
                color: view === "day" ? "#F7F5F0" : "#8C6E50",
              }}
            >
              Día
            </button>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 22px",
              background: "#8C6E50",
              color: "#F7F5F0",
              borderRadius: 999,
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Nueva reserva
          </button>
        </div>
      </div>

      {/* Room legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "14px 32px",
          fontSize: 12,
          color: "#6B5540",
        }}
      >
        {rooms.map((r, i) => (
          <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: ROOM_COLORS[i % ROOM_COLORS.length],
              }}
            />
            {r.name}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              border: "1.5px dashed #8C6E50",
              boxSizing: "border-box",
            }}
          />
          A domicilio
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : view === "week" ? (
        <WeekGrid
          appointments={appointments}
          selectedDate={selectedDate}
          today={today}
          roomColorMap={roomColorMap}
          onSelect={setSelected}
        />
      ) : (
        <DayGrid
          appointments={appointments}
          date={selectedDate}
          today={today}
          roomColorMap={roomColorMap}
          onSelect={setSelected}
        />
      )}

      {selected && (
        <AppointmentDetail
          appt={selected}
          rooms={rooms}
          staffList={staffList}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setAppointments((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
            setSelected(null);
          }}
        />
      )}
      {showNewForm && (
        <NewAppointmentForm
          defaultDate={selectedDate}
          onClose={() => setShowNewForm(false)}
          onCreated={handleCreated}
          preSelectedClient={preClientId ? { id: preClientId, fullName: preClientName || "" } : null}
        />
      )}
    </div>
  );
}

function WeekGrid({ appointments, selectedDate, today, roomColorMap, onSelect }) {
  const days = getWeekDays(selectedDate);
  const HOUR_HEIGHT = 66;

  const byDayHour = {};
  for (const appt of appointments) {
    if (appt.status === "cancelado") continue;
    const d = toLocalDate(new Date(appt.startsAt));
    const h = getEcuadorHour(appt.startsAt);
    const key = `${d}-${h}`;
    if (!byDayHour[key]) byDayHour[key] = [];
    byDayHour[key].push(appt);
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "0 32px 28px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${days.length}, 1fr)`,
          border: "1px solid rgba(168,154,135,0.4)",
          borderRadius: 12,
          background: "#F7F5F0",
          overflow: "hidden",
          minHeight: "100%",
        }}
      >
        {/* Header row */}
        <div style={{ borderBottom: "1px solid rgba(168,154,135,0.35)" }} />
        {days.map((d) => {
          const date = new Date(d + "T12:00:00");
          const dayNum = date.getDate();
          const dayName = DAY_NAMES[date.getDay()];
          const isToday = d === today;
          return (
            <div
              key={d}
              style={{
                textAlign: "center",
                padding: "12px 0",
                borderBottom: "1px solid rgba(168,154,135,0.35)",
                borderLeft: "1px solid rgba(168,154,135,0.25)",
                background: isToday ? "rgba(235,205,181,0.28)" : "transparent",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: isToday ? "#8C6E50" : "#A89A87",
                  letterSpacing: 1,
                }}
              >
                {isToday ? `${dayName} · HOY` : dayName}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: "#6B5540",
                  fontWeight: isToday ? 600 : 500,
                }}
              >
                {dayNum}
              </div>
            </div>
          );
        })}

        {/* Time column + cells */}
        <div style={{ position: "relative" }}>
          {HOURS.map((h, i) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: i * HOUR_HEIGHT,
                right: 8,
                fontSize: 11,
                color: "#A89A87",
              }}
            >
              {h}:00
            </div>
          ))}
        </div>
        {days.map((d) => {
          const isToday = d === today;
          return (
            <div
              key={d}
              style={{
                position: "relative",
                borderLeft: "1px solid rgba(168,154,135,0.25)",
                background: isToday ? "rgba(235,205,181,0.12)" : "transparent",
                height: HOURS.length * HOUR_HEIGHT,
              }}
            >
              {HOURS.map((h, i) => (
                <div
                  key={h}
                  style={{
                    position: "absolute",
                    top: i * HOUR_HEIGHT,
                    left: 0,
                    right: 0,
                    height: HOUR_HEIGHT,
                    borderTop: i > 0 ? "1px solid rgba(168,154,135,0.15)" : "none",
                  }}
                />
              ))}
              {(appointments || [])
                .filter((a) => {
                  if (a.status === "cancelado") return false;
                  return toLocalDate(new Date(a.startsAt)) === d;
                })
                .map((appt) => {
                  const h = getEcuadorHour(appt.startsAt);
                  const m = parseInt(getEcuadorMinutes(appt.startsAt), 10) || 0;
                  const topOffset = (h - HOURS[0]) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
                  const duration = appt.service?.durationMins || 60;
                  const height = (duration / 60) * HOUR_HEIGHT;
                  const color = appt.room ? roomColorMap[appt.room.id] || "#8C6E50" : undefined;
                  const isDomicilio = appt.modality === "domicilio";

                  return (
                    <button
                      key={appt.id}
                      onClick={() => onSelect(appt)}
                      style={{
                        position: "absolute",
                        top: topOffset + 1,
                        left: 3,
                        right: 3,
                        height: Math.max(height - 2, 20),
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        lineHeight: "1.3",
                        overflow: "hidden",
                        cursor: "pointer",
                        border: isDomicilio ? "1.5px dashed #8C6E50" : "none",
                        background: isDomicilio ? "rgba(235,205,181,0.3)" : color || "#8C6E50",
                        color: isDomicilio ? "#6B5540" : "#F7F5F0",
                        textAlign: "left",
                        zIndex: 1,
                      }}
                    >
                      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {appt.client?.fullName || "Cliente"}
                      </div>
                      <div style={{ opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {appt.service?.name}
                      </div>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayGrid({ appointments, date, today, roomColorMap, onSelect }) {
  const HOUR_HEIGHT = 66;
  const active = appointments.filter((a) => a.status !== "cancelado" && toLocalDate(new Date(a.startsAt)) === date);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "0 32px 28px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr",
          border: "1px solid rgba(168,154,135,0.4)",
          borderRadius: 12,
          background: "#F7F5F0",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", height: HOURS.length * HOUR_HEIGHT }}>
          {HOURS.map((h, i) => (
            <div
              key={h}
              style={{ position: "absolute", top: i * HOUR_HEIGHT, right: 8, fontSize: 11, color: "#A89A87" }}
            >
              {h}:00
            </div>
          ))}
        </div>
        <div
          style={{
            position: "relative",
            borderLeft: "1px solid rgba(168,154,135,0.25)",
            height: HOURS.length * HOUR_HEIGHT,
          }}
        >
          {HOURS.map((h, i) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: i * HOUR_HEIGHT,
                left: 0,
                right: 0,
                height: HOUR_HEIGHT,
                borderTop: i > 0 ? "1px solid rgba(168,154,135,0.15)" : "none",
              }}
            />
          ))}
          {active.map((appt) => {
            const h = getEcuadorHour(appt.startsAt);
            const m = parseInt(getEcuadorMinutes(appt.startsAt), 10) || 0;
            const topOffset = (h - HOURS[0]) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
            const duration = appt.service?.durationMins || 60;
            const height = (duration / 60) * HOUR_HEIGHT;
            const color = appt.room ? roomColorMap[appt.room.id] || "#8C6E50" : undefined;
            const isDomicilio = appt.modality === "domicilio";

            return (
              <button
                key={appt.id}
                onClick={() => onSelect(appt)}
                style={{
                  position: "absolute",
                  top: topOffset + 1,
                  left: 6,
                  right: 6,
                  height: Math.max(height - 2, 24),
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 13,
                  overflow: "hidden",
                  cursor: "pointer",
                  border: isDomicilio ? "1.5px dashed #8C6E50" : "none",
                  background: isDomicilio ? "rgba(235,205,181,0.3)" : color || "#8C6E50",
                  color: isDomicilio ? "#6B5540" : "#F7F5F0",
                  textAlign: "left",
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{ fontWeight: 600 }}>{appt.client?.fullName || "Cliente"}</span>
                <span style={{ opacity: 0.85 }}>{appt.service?.name}</span>
                <span style={{ opacity: 0.7, marginLeft: "auto" }}>{formatTime(appt.startsAt)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppointmentDetail({ appt, rooms, staffList, onClose, onUpdated }) {
  const statusInfo = STATUS_COLORS[appt.status] || STATUS_COLORS.pendiente;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editDate, setEditDate] = useState(toLocalDate(new Date(appt.startsAt)));
  const [editTime, setEditTime] = useState(formatTime(appt.startsAt));
  const [editRoomId, setEditRoomId] = useState(appt.room?.id || "");
  const [editStaffId, setEditStaffId] = useState(appt.staff?.id || "");

  async function changeStatus(newStatus) {
    setSaving(true);
    setError(null);
    try {
      const updated = await authFetch(`/appointments/${appt.id}/status`, { method: "PATCH", body: { status: newStatus } });
      onUpdated({ ...appt, ...updated, service: appt.service, client: appt.client, room: appt.room, staff: appt.staff });
    } catch (err) {
      setError(err.message || "Error al cambiar estado");
    } finally {
      setSaving(false);
    }
  }

  async function saveReschedule() {
    setSaving(true);
    setError(null);
    try {
      const body = {};
      const newStartsAt = `${editDate}T${editTime}:00`;
      if (newStartsAt !== appt.startsAt) body.startsAt = newStartsAt;
      if (editRoomId && editRoomId !== appt.room?.id) body.roomId = editRoomId;
      if (editStaffId && editStaffId !== appt.staff?.id) body.staffId = editStaffId;
      if (Object.keys(body).length === 0) { setEditing(false); return; }
      const updated = await authFetch(`/appointments/${appt.id}`, { method: "PATCH", body });
      const newRoom = rooms.find((r) => r.id === (updated.roomId || editRoomId));
      const newStaff = staffList.find((s) => s.id === (updated.staffId || editStaffId));
      onUpdated({ ...appt, ...updated, service: appt.service, client: appt.client, room: newRoom || appt.room, staff: newStaff || appt.staff });
    } catch (err) {
      setError(err.message || "Error al reprogramar");
    } finally {
      setSaving(false);
    }
  }

  const canChange = appt.status !== "cancelado" && appt.status !== "no_show";
  const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 13, color: "#6B5540", background: "#FDFCFA", outline: "none" };
  const pillBtn = (bg, color, border) => ({ padding: "7px 16px", borderRadius: 999, border: border || "none", background: bg, color, fontSize: 12, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 });

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, margin: "0 16px", background: "#F7F5F0", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}>
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: "0 0 6px" }}>
          {appt.service?.name || "Servicio"}
        </h2>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: statusInfo.bg, border: statusInfo.border !== "transparent" ? `1px solid ${statusInfo.border}` : "none", color: statusInfo.text, fontSize: 12, fontWeight: 500 }}>
          {STATUS_LABELS[appt.status]}
        </span>

        <div style={{ borderTop: "1px solid rgba(168,154,135,0.3)", margin: "18px 0" }} />

        {!editing ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                <span style={{ color: "#A89A87" }}>Horario</span>
                <span>{formatTime(appt.startsAt)} – {formatTime(appt.endsAt)}{appt.service?.durationMins && <span style={{ color: "#A89A87", marginLeft: 8 }}>({appt.service.durationMins} min)</span>}</span>
              </div>
              {appt.client && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                  <span style={{ color: "#A89A87" }}>Cliente</span>
                  <div style={{ textAlign: "right" }}>
                    <div>{appt.client.fullName}</div>
                    {appt.client.whatsapp && <div style={{ fontSize: 12, color: "#A89A87" }}>{appt.client.whatsapp}</div>}
                  </div>
                </div>
              )}
              {appt.room && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                  <span style={{ color: "#A89A87" }}>Gabinete</span>
                  <span>{appt.room.name}</span>
                </div>
              )}
              {appt.staff && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                  <span style={{ color: "#A89A87" }}>Terapeuta</span>
                  <span>{appt.staff.name}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                <span style={{ color: "#A89A87" }}>Modalidad</span>
                <span>{appt.modality === "domicilio" ? "A domicilio" : "En gabinete"}</span>
              </div>
              {appt.priceUsd != null && (
                <div style={{ textAlign: "right", fontWeight: 600, fontSize: 16, color: "#6B5540", marginTop: 4 }}>
                  ${Number(appt.priceUsd).toFixed(2)}
                </div>
              )}
            </div>

            {error && <p style={{ fontSize: 13, color: "#C25450", margin: "12px 0 0", textAlign: "center" }}>{error}</p>}

            {canChange && (
              <>
                <div style={{ borderTop: "1px solid rgba(168,154,135,0.3)", margin: "18px 0" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {appt.status !== "confirmado" && (
                      <button disabled={saving} onClick={() => changeStatus("confirmado")} style={pillBtn("rgba(201,168,118,0.2)", "#8C6E50", "1px solid rgba(201,168,118,0.4)")}>Confirmar</button>
                    )}
                    <button disabled={saving} onClick={() => changeStatus("cancelado")} style={pillBtn("rgba(194,84,80,0.1)", "#C25450", "1px solid rgba(194,84,80,0.3)")}>Cancelar cita</button>
                    <button disabled={saving} onClick={() => changeStatus("no_show")} style={pillBtn("rgba(168,154,135,0.15)", "#A89A87", "1px solid rgba(168,154,135,0.4)")}>No asistió</button>
                  </div>
                  <button disabled={saving} onClick={() => setEditing(true)} style={pillBtn("#8C6E50", "#F7F5F0")}>Reprogramar</button>
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Fecha</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Hora</label>
                <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Gabinete</label>
              <select value={editRoomId} onChange={(e) => setEditRoomId(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
                <option value="">Sin cambio</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Terapeuta</label>
              <select value={editStaffId} onChange={(e) => setEditStaffId(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
                <option value="">Sin cambio</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setEditing(false); setError(null); }} style={{ ...pillBtn("transparent", "#8C6E50", "1px solid #8C6E50"), flex: 1 }}>Cancelar</button>
              <button disabled={saving} onClick={saveReschedule} style={{ ...pillBtn("#8C6E50", "#F7F5F0"), flex: 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAppointmentForm({ defaultDate, onClose, onCreated, preSelectedClient }) {
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [clientSearch, setClientSearch] = useState(preSelectedClient?.fullName || "");
  const [clientResults, setClientResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState(preSelectedClient || null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    Promise.all([
      authFetch("/services").catch(() => []),
      authFetch("/rooms").catch(() => []),
      authFetch("/users").catch(() => []),
    ]).then(([s, r, u]) => {
      setServices(Array.isArray(s) ? s.filter((x) => x.active) : []);
      setRooms(Array.isArray(r) ? r.filter((x) => x.active) : []);
      setStaff(Array.isArray(u) ? u.filter((x) => x.canAttendAppointments && x.active) : []);
    });
  }, []);

  useEffect(() => {
    if (!serviceId || !date) {
      setAvailableSlots([]);
      setTime("");
      return;
    }
    setSlotsLoading(true);
    authFetch(`/appointments/availability`, { query: { serviceId, date, modality: "presencial" } })
      .then((data) => {
        const raw = Array.isArray(data?.slots) ? data.slots : Array.isArray(data) ? data : [];
        const slots = raw.map((s) => (typeof s === "string" ? s : new Date(s).toISOString()));
        setAvailableSlots(slots);
        setTime((prev) => (slots.includes(prev) ? prev : slots[0] || ""));
      })
      .catch(() => setAvailableSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [serviceId, date]);

  function searchClients(q) {
    setClientSearch(q);
    setSelectedClient(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setClientResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await authFetch("/clients", { query: { q, limit: 8 } });
        setClientResults(Array.isArray(results) ? results : []);
      } catch {
        setClientResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function selectClient(c) {
    setSelectedClient(c);
    setClientSearch(c.fullName);
    setClientResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      let clientId = selectedClient?.id;

      if (showNewClient) {
        if (!newClientName.trim() || !newClientPhone.trim()) {
          setError("Nombre y WhatsApp del nuevo cliente son requeridos");
          setSubmitting(false);
          return;
        }
        const newClient = await authFetch("/clients", {
          method: "POST",
          body: { fullName: newClientName.trim(), whatsapp: newClientPhone.trim() },
        });
        clientId = newClient.id;
      }

      if (!clientId) { setError("Selecciona o crea un cliente"); setSubmitting(false); return; }
      if (!serviceId) { setError("Selecciona un servicio"); setSubmitting(false); return; }
      if (!staffId) { setError("Selecciona un terapeuta"); setSubmitting(false); return; }
      if (!roomId) { setError("Selecciona un gabinete"); setSubmitting(false); return; }

      await authFetch("/appointments", {
        method: "POST",
        body: { clientId, serviceId, staffId, roomId, startsAt: time, modality: "presencial" },
      });

      onCreated();
    } catch (err) {
      setError(err.message || "Error al crear la cita");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid rgba(168,154,135,0.5)",
    borderRadius: 8,
    fontSize: 14,
    color: "#6B5540",
    background: "#FDFCFA",
    outline: "none",
  };
  const selectStyle = { ...inputStyle, appearance: "none", cursor: "pointer" };
  const labelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 6 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(58,47,38,0.4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 16px",
          background: "#F7F5F0",
          borderRadius: 16,
          padding: 28,
          position: "relative",
          boxShadow: "0 24px 64px rgba(107,85,64,0.18)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}
        >
          <X size={20} />
        </button>
        <h2
          className="font-heading"
          style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}
        >
          Nueva reserva
        </h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Client */}
          <div>
            <label style={labelStyle}>Cliente</label>
            {showNewClient ? (
              <div style={{ padding: 14, border: "1px solid rgba(168,154,135,0.4)", borderRadius: 10, background: "rgba(247,245,240,0.5)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#A89A87" }}>Nuevo cliente</span>
                  <button type="button" onClick={() => setShowNewClient(false)} style={{ fontSize: 12, color: "#8C6E50", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Buscar existente</button>
                </div>
                <input style={inputStyle} placeholder="Nombre completo" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                <input style={inputStyle} placeholder="WhatsApp (+593...)" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: "#A89A87" }} />
                  <input
                    style={{ ...inputStyle, paddingLeft: 34 }}
                    placeholder="Buscar por nombre o WhatsApp…"
                    value={clientSearch}
                    onChange={(e) => searchClients(e.target.value)}
                  />
                </div>
                {clientResults.length > 0 && !selectedClient && (
                  <div style={{ position: "absolute", zIndex: 20, width: "100%", marginTop: 4, border: "1px solid rgba(168,154,135,0.4)", borderRadius: 10, background: "#F7F5F0", boxShadow: "0 8px 24px rgba(107,85,64,0.12)", maxHeight: 180, overflowY: "auto" }}>
                    {clientResults.map((c) => (
                      <button key={c.id} type="button" onClick={() => selectClient(c)} style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid rgba(168,154,135,0.2)", cursor: "pointer", display: "flex", justifyContent: "space-between", fontSize: 14, color: "#6B5540" }}>
                        <span>{c.fullName}</span>
                        <span style={{ fontSize: 12, color: "#A89A87" }}>{c.whatsapp}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searching && (
                  <div style={{ position: "absolute", zIndex: 20, width: "100%", marginTop: 4, border: "1px solid rgba(168,154,135,0.4)", borderRadius: 10, background: "#F7F5F0", padding: 14, textAlign: "center" }}>
                    <Loader2 size={16} className="animate-spin" style={{ color: "#A89A87", margin: "0 auto" }} />
                  </div>
                )}
                {selectedClient && <p style={{ fontSize: 12, color: "#8C6E50", marginTop: 6 }}>{selectedClient.whatsapp}</p>}
                {!selectedClient && clientSearch.length >= 2 && clientResults.length === 0 && !searching && (
                  <button type="button" onClick={() => { setShowNewClient(true); setNewClientName(clientSearch); }} style={{ fontSize: 12, color: "#8C6E50", background: "none", border: "none", cursor: "pointer", marginTop: 6, textDecoration: "underline" }}>+ Crear nueva clienta</button>
                )}
              </div>
            )}
          </div>

          {/* Service */}
          <div>
            <label style={labelStyle} htmlFor="service">Servicio</label>
            <select id="service" style={selectStyle} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Seleccionar servicio</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.durationMins} min — ${Number(s.priceUsd).toFixed(2)}</option>
              ))}
            </select>
          </div>

          {/* Date + Time */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle} htmlFor="date">Fecha</label>
              <input id="date" type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="time">Hora</label>
              {slotsLoading ? (
                <div style={{ ...inputStyle, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={14} className="animate-spin" style={{ color: "#A89A87" }} /></div>
              ) : availableSlots.length > 0 ? (
                <select id="time" style={{ ...inputStyle, appearance: "none", cursor: "pointer" }} value={time} onChange={(e) => setTime(e.target.value)}>
                  {availableSlots.map((s) => <option key={s} value={s}>{formatTime(s)}</option>)}
                </select>
              ) : (
                <div style={{ ...inputStyle, color: "#A89A87", fontSize: 13 }}>{serviceId ? "Sin horarios" : "Elige servicio"}</div>
              )}
            </div>
          </div>

          {/* Room + Staff */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle} htmlFor="room">Gabinete</label>
              <select id="room" style={selectStyle} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Seleccionar</option>
                {rooms.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="staff">Terapeuta</label>
              <select id="staff" style={selectStyle} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Seleccionar</option>
                {staff.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>

          {error && <p style={{ fontSize: 13, color: "#C25450", textAlign: "center", margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Cancelar</button>
            <button type="submit" disabled={submitting} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Creando…" : "Crear reserva"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
