"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/auth-client";
import { Loader2, X, Search } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useGridTransition } from "@/lib/use-grid-transition";
import { NewClientModal } from "@/components/new-client-modal";
import { useToast } from "@/components/toast-provider";

const HOURS = [8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19];
const STATUS_COLORS = {
  pendiente: { bg: "rgba(168,154,135,0.2)", border: "#A89A87", text: "#A89A87" },
  confirmado: { bg: "rgba(201,168,118,0.2)", border: "transparent", text: "#8C6E50" },
  cancelado: { bg: "rgba(194,84,80,0.1)", border: "#C25450", text: "#C25450" },
  no_show: { bg: "rgba(194,84,80,0.10)", border: "#C25450", text: "#B85A56" },
};
const STATUS_LABELS = {
  pendiente: "Sin confirmar",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  no_show: "No asistió",
};
function appointmentColor(appt, roomColorMap) {
  return appt.service?.colorHex || (appt.room ? roomColorMap[appt.room.id] : null) || "#8C6E50";
}

function appointmentRoomId(appt) {
  return appt.roomId || appt.room?.id || "__sin-cabina";
}

function titleCaseText(text = "") {
  return String(text)
    .toLocaleLowerCase("es-EC")
    .split(" ")
    .map((word) => (word ? word.charAt(0).toLocaleUpperCase("es-EC") + word.slice(1) : word))
    .join(" ");
}

function cabinDisplayName(name = "") {
  const parts = String(name).split(" - ");
  if (parts.length < 2) return String(name);
  const [prefix, ...rest] = parts;
  return `${prefix} - ${titleCaseText(rest.join(" - "))}`;
}

function hexToRgb(hex = "") {
  const value = String(hex).replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

function mixColors(hex, target = "#6B5540", amount = 0.28) {
  const source = hexToRgb(hex);
  const dest = hexToRgb(target);
  if (!source || !dest) return hex || "#8C6E50";
  return rgbToHex({
    r: source.r * (1 - amount) + dest.r * amount,
    g: source.g * (1 - amount) + dest.g * amount,
    b: source.b * (1 - amount) + dest.b * amount,
  });
}

function premiumCabinColor(color = "#8C6E50") {
  const rgb = hexToRgb(color);
  if (!rgb) return "#8C6E50";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.62 ? mixColors(color, "#5E4938", 0.42) : mixColors(color, "#6B5540", 0.18);
}

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
  const isMobile = useIsMobile();
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(today);
  const [appointments, setAppointments] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [slotGroup, setSlotGroup] = useState(null);
  const [showNewForm, setShowNewForm] = useState(!!preClientId);
  const [staffList, setStaffList] = useState([]);
  const [navDirection, setNavDirection] = useState(0);
  const [agendaQuery, setAgendaQuery] = useState("");

  const detailAnim = useAnimatedMount(!!selected, 220);
  const slotGroupAnim = useAnimatedMount(!!slotGroup, 220);
  const [lastSelected, setLastSelected] = useState(null);
  const [lastSlotGroup, setLastSlotGroup] = useState(null);
  useEffect(() => {
    if (selected) setLastSelected(selected);
  }, [selected]);
  useEffect(() => {
    if (slotGroup) setLastSlotGroup(slotGroup);
  }, [slotGroup]);
  const newFormAnim = useAnimatedMount(showNewForm, 220);
  const { gridClass, onAnimationEnd } = useGridTransition(navDirection, loading);

  const effectiveView = isMobile ? "day" : view;
  const filteredAppointments = useMemo(() => {
    const query = agendaQuery.trim().toLocaleLowerCase("es-EC");
    if (!query) return appointments;
    return appointments.filter((appt) => {
      const client = appt.client || {};
      const haystack = [
        client.fullName,
        client.whatsapp,
        client.recordNumber,
        appt.service?.name,
        appt.room?.name,
        appt.staff?.name,
        appt.indications,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es-EC");
      return haystack.includes(query);
    });
  }, [agendaQuery, appointments]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let from, to;
      if (effectiveView === "day") {
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
  }, [selectedDate, effectiveView]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function navigate(dir) {
    setNavDirection(dir);
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + (effectiveView === "day" ? dir : dir * 7));
    setSelectedDate(toLocalDate(d));
  }

  function handleCreated() {
    setShowNewForm(false);
    fetchData();
  }

  const roomColorMap = {};
  rooms.forEach((r, i) => {
    roomColorMap[r.id] = r.colorHex || ROOM_COLORS[i % ROOM_COLORS.length];
  });

  const navBtnStyle = {
    width: isMobile ? 44 : 30,
    height: isMobile ? 44 : 30,
    border: "1px solid #A89A87",
    borderRadius: "50%",
    background: "none",
    cursor: "pointer",
    color: "#8C6E50",
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          padding: isMobile ? "16px 16px 12px" : "24px 32px",
          gap: isMobile ? 12 : 0,
          borderBottom: "1px solid rgba(168,154,135,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flex: isMobile ? "1 1 auto" : "0 1 520px" }}>
            <h1
              className="font-heading"
              style={{ fontSize: isMobile ? 22 : 26, fontWeight: 600, color: "#6B5540", margin: 0, flexShrink: 0 }}
            >
              Agenda
            </h1>
            <label
              style={{
                flex: 1,
                minWidth: isMobile ? 0 : 260,
                maxWidth: isMobile ? "none" : 360,
                display: "flex",
                alignItems: "center",
                gap: 9,
                border: "1px solid rgba(168,154,135,0.42)",
                borderRadius: 999,
                padding: "9px 13px",
                background: "rgba(253,252,250,0.86)",
                boxShadow: "0 10px 26px rgba(107,85,64,0.06)",
              }}
            >
              <Search size={16} style={{ color: "#A89A87", flexShrink: 0 }} />
              <input
                value={agendaQuery}
                onChange={(e) => setAgendaQuery(e.target.value)}
                placeholder="Buscar por clienta o ficha..."
                style={{
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "#6B5540",
                  fontSize: 13,
                  width: "100%",
                  minWidth: 0,
                }}
              />
            </label>
          </div>
          {isMobile && (
            <button
              onClick={() => setShowNewForm(true)}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "#8C6E50",
                color: "#F7F5F0",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              +
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <button onClick={() => navigate(-1)} style={navBtnStyle}>‹</button>
          <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 500, color: "#6B5540", textAlign: "center", flex: isMobile ? 1 : undefined }}>
            {effectiveView === "week" ? formatWeekRange(selectedDate) : formatDayFull(selectedDate)}
          </span>
          <button onClick={() => navigate(1)} style={navBtnStyle}>›</button>
        </div>

        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
        )}
      </div>

      {/* Grid */}
      <div className={gridClass || undefined} onAnimationEnd={onAnimationEnd}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : isMobile ? (
          <MobileCardList
            appointments={filteredAppointments}
            date={selectedDate}
            roomColorMap={roomColorMap}
            rooms={rooms}
            onSelect={setSelected}
            onSelectGroup={setSlotGroup}
          />
        ) : effectiveView === "week" ? (
          <WeekGrid
            appointments={filteredAppointments}
            selectedDate={selectedDate}
            today={today}
            roomColorMap={roomColorMap}
            onSelect={setSelected}
            onSelectGroup={setSlotGroup}
          />
        ) : (
          <CabinDayGrid
            appointments={filteredAppointments}
            rooms={rooms}
            date={selectedDate}
            today={today}
            roomColorMap={roomColorMap}
            onSelect={setSelected}
            onSelectGroup={setSlotGroup}
          />
        )}
      </div>

      {slotGroupAnim.shouldRender && (
        <SlotGroupModal
          appointments={slotGroup || lastSlotGroup || []}
          phase={slotGroupAnim.phase}
          onClose={() => setSlotGroup(null)}
          onSelect={(appt) => {
            setSlotGroup(null);
            setSelected(appt);
          }}
        />
      )}
      {detailAnim.shouldRender && (
        <AppointmentDetail
          appt={selected || lastSelected}
          phase={detailAnim.phase}
          rooms={rooms}
          staffList={staffList}
          onClose={() => setSelected(null)}
          onUpdated={(updated, options = {}) => {
            const merged = (source) => (source?.id === updated.id ? { ...source, ...updated } : source);
            setAppointments((prev) => prev.map((a) => merged(a)));
            if (options.close === false) {
              setSelected((current) => merged(current));
            } else {
              setSelected(null);
            }
          }}
        />
      )}
      {newFormAnim.shouldRender && (
        <NewAppointmentForm
          defaultDate={selectedDate}
          phase={newFormAnim.phase}
          onClose={() => setShowNewForm(false)}
          onCreated={handleCreated}
          preSelectedClient={preClientId ? { id: preClientId, fullName: preClientName || "" } : null}
        />
      )}
    </div>
  );
}

function MobileCardList({ appointments, date, roomColorMap, rooms, onSelect }) {
  const active = appointments
    .filter((a) => a.status !== "cancelado" && toLocalDate(new Date(a.startsAt)) === date)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  if (active.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, color: "#A89A87", fontSize: 14 }}>
        No hay citas para este día
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {active.map((appt) => {
        const color = appointmentColor(appt, roomColorMap);
        const statusInfo = STATUS_COLORS[appt.status] || STATUS_COLORS.pendiente;
        const statusLabel = STATUS_LABELS[appt.status] || appt.status;
        const time = formatTime(appt.startsAt);
        const dur = appt.service?.durationMins || 60;
        return (
          <button
            key={appt.id}
            onClick={() => onSelect(appt)}
            style={{
              display: "flex",
              alignItems: "stretch",
              border: "1px solid rgba(168,154,135,0.35)",
              borderRadius: 12,
              background: "#F7F5F0",
              overflow: "hidden",
              cursor: "pointer",
              padding: 0,
              textAlign: "left",
              minHeight: 72,
              textDecoration: appt.status === "no_show" ? "line-through" : "none",
              textDecorationColor: "rgba(194,84,80,0.55)",
              textDecorationThickness: 1.5,
            }}
          >
            <div
              style={{
                width: 5,
                flexShrink: 0,
                background: color,
              }}
            />
            <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "#6B5540" }}>
                  {appt.client?.fullName || "Cliente"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: statusInfo.bg,
                    color: statusInfo.text,
                    fontWeight: 500,
                  }}
                >
                  {statusLabel}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#8C6E50" }}>
                {appt.service?.name}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#A89A87" }}>
                <span>{time} · {dur} min</span>
                {appt.room && <span>{appt.room.name}</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function appointmentSlotKey(appt) {
  return [toLocalDate(new Date(appt.startsAt)), getEcuadorHour(appt.startsAt), getEcuadorMinutes(appt.startsAt)].join("-");
}

function groupAppointmentsBySlot(items) {
  const groups = new Map();
  for (const appt of items) {
    const key = appointmentSlotKey(appt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(appt);
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    appointments: group.sort((a, b) => (a.room?.name || "").localeCompare(b.room?.name || "")),
  }));
}

function buildSlotLanes(items) {
  const lanes = new Map();
  for (const { appointments: group } of groupAppointmentsBySlot(items)) {
    group.forEach((appt, index) => lanes.set(appt.id, { index, total: group.length }));
  }
  return lanes;
}

function visibleScheduleEntries(items) {
  return groupAppointmentsBySlot(items).flatMap(({ key, appointments }) => {
    if (appointments.length > 3) return [{ type: "group", key, appointments }];
    return appointments.map((appt) => ({ type: "appointment", key: appt.id, appointment: appt }));
  });
}

function lanePosition(lane, inset = 3) {
  if (!lane || lane.total <= 1) return { left: inset, right: inset };
  const width = 100 / lane.total;
  return { left: "calc(" + (lane.index * width) + "% + " + inset + "px)", width: "calc(" + width + "% - " + (inset * 2) + "px)" };
}

function WeekGrid({ appointments, selectedDate, today, roomColorMap, onSelect, onSelectGroup }) {
  const days = getWeekDays(selectedDate);
  const HOUR_HEIGHT = 66;

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
          const dayAppointments = (appointments || []).filter((a) => {
            if (a.status === "cancelado") return false;
            return toLocalDate(new Date(a.startsAt)) === d;
          });
          const laneMap = buildSlotLanes(dayAppointments);
          const entries = visibleScheduleEntries(dayAppointments);
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
              {entries.map((entry) => {
                const appt = entry.type === "group" ? entry.appointments[0] : entry.appointment;
                const h = getEcuadorHour(appt.startsAt);
                const m = parseInt(getEcuadorMinutes(appt.startsAt), 10) || 0;
                const topOffset = (h - HOURS[0]) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
                const duration = appt.service?.durationMins || 60;
                const height = (duration / 60) * HOUR_HEIGHT;

                if (entry.type === "group") {
                  const names = entry.appointments.slice(0, 2).map((a) => a.client?.fullName || "Cliente").join(", ");
                  return (
                    <button
                      key={entry.key}
                      onClick={() => onSelectGroup(entry.appointments)}
                      style={{
                        position: "absolute",
                        top: topOffset + 3,
                        left: 4,
                        right: 4,
                        height: Math.max(Math.min(height - 6, 58), 38),
                        borderRadius: 8,
                        padding: "6px 9px",
                        border: "1px solid rgba(140,110,80,0.24)",
                        background: "rgba(140,110,80,0.86)",
                        color: "#F7F5F0",
                        textAlign: "left",
                        cursor: "pointer",
                        zIndex: 3,
                        boxShadow: "0 8px 20px rgba(64,51,39,0.14)",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.appointments.length} citas · {formatTime(appt.startsAt)}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.82, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                        {names}{entry.appointments.length > 2 ? ` +${entry.appointments.length - 2} más` : ""}
                      </div>
                    </button>
                  );
                }

                const color = appointmentColor(appt, roomColorMap);
                const lane = laneMap.get(appt.id);

                return (
                  <button
                    key={appt.id}
                    onClick={() => onSelect(appt)}
                    style={{
                      position: "absolute",
                      top: topOffset + 1,
                      ...lanePosition(lane, 3),
                      height: Math.max(height - 2, 20),
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 11,
                      lineHeight: "1.3",
                      overflow: "hidden",
                      cursor: "pointer",
                      border: "none",
                      background: color || "#8C6E50",
                      color: "#F7F5F0",
                      textAlign: "left",
                      zIndex: 1,
                      textDecoration: appt.status === "no_show" ? "line-through" : "none",
                      textDecorationColor: "rgba(194,84,80,0.85)",
                      textDecorationThickness: 1.5,
                      opacity: appt.status === "no_show" ? 0.75 : 1,
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

function CabinDayGrid({ appointments, rooms, date, today, roomColorMap, onSelect }) {
  const HOUR_HEIGHT = 66;
  const active = (appointments || [])
    .filter((a) => a.status !== "cancelado" && toLocalDate(new Date(a.startsAt)) === date)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const configuredRooms = (rooms || []).filter((room) => room.active !== false);
  const configuredIds = new Set(configuredRooms.map((room) => room.id));
  const fallbackRooms = active
    .filter((appt) => appt.room && !configuredIds.has(appt.room.id))
    .map((appt) => appt.room);
  const columns = [...configuredRooms, ...fallbackRooms];
  const visibleColumns = columns.length ? columns : [{ id: "__sin-cabina", name: "Sin cabinas", specialty: "configuración" }];
  const minWidth = visibleColumns.length > 7 ? 0 : Math.max(720, 56 + visibleColumns.length * 168);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "0 clamp(12px, 2vw, 32px) 28px", maxWidth: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${visibleColumns.length}, minmax(${visibleColumns.length > 7 ? 128 : 158}px, 1fr))`,
          border: "1px solid rgba(168,154,135,0.4)",
          borderRadius: 12,
          background: "#F7F5F0",
          overflow: "hidden",
          minWidth,
          width: "100%",
        }}
      >
        <div style={{ borderBottom: "1px solid rgba(168,154,135,0.32)", background: date === today ? "rgba(235,205,181,0.18)" : "rgba(247,245,240,0.75)" }} />
        {visibleColumns.map((room) => {
          const roomColor = roomColorMap[room.id] || room.colorHex || "#8C6E50";
          const premiumColor = premiumCabinColor(roomColor);
          return (
            <div
              key={room.id}
              style={{
                minHeight: 78,
                padding: "12px 14px",
                borderLeft: "1px solid rgba(168,154,135,0.20)",
                borderBottom: `2px solid ${premiumColor}`,
                background: "linear-gradient(180deg, rgba(253,252,250,0.98) 0%, rgba(247,245,240,0.88) 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.75)",
              }}
            >
              <strong
                className="font-heading"
                style={{
                  color: premiumColor,
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1.12,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  textShadow: "0 1px 0 rgba(255,255,255,0.55)",
                }}
              >
                {cabinDisplayName(room.name)}
              </strong>
            </div>
          );
        })}

        <div style={{ position: "relative", height: HOURS.length * HOUR_HEIGHT }}>
          {HOURS.map((h, i) => (
            <div key={h} style={{ position: "absolute", top: i * HOUR_HEIGHT, right: 8, fontSize: 11, color: "#A89A87" }}>
              {h}:00
            </div>
          ))}
        </div>

        {visibleColumns.map((room) => {
          const roomAppointments = active.filter((appt) => appointmentRoomId(appt) === room.id);
          return (
            <div
              key={room.id}
              style={{
                position: "relative",
                borderLeft: "1px solid rgba(168,154,135,0.22)",
                height: HOURS.length * HOUR_HEIGHT,
                background: date === today ? "rgba(235,205,181,0.07)" : "transparent",
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
                    borderTop: i > 0 ? "1px solid rgba(168,154,135,0.14)" : "none",
                  }}
                />
              ))}
              {roomAppointments.map((appt) => {
                const h = getEcuadorHour(appt.startsAt);
                const m = parseInt(getEcuadorMinutes(appt.startsAt), 10) || 0;
                const hourIndex = HOURS.indexOf(h);
                if (hourIndex === -1) return null;
                const topOffset = hourIndex * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
                const duration = appt.service?.durationMins || 60;
                const height = (duration / 60) * HOUR_HEIGHT;
                const color = appointmentColor(appt, roomColorMap);
                const noShow = appt.status === "no_show";

                return (
                  <button
                    key={appt.id}
                    onClick={() => onSelect(appt)}
                    style={{
                      position: "absolute",
                      top: topOffset + 4,
                      left: 8,
                      right: 8,
                      height: Math.max(height - 8, 42),
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 12,
                      overflow: "hidden",
                      cursor: "pointer",
                      border: noShow ? "1px solid rgba(194,84,80,0.55)" : "1px solid rgba(255,255,255,0.22)",
                      background: noShow ? "rgba(194,84,80,0.12)" : color,
                      color: noShow ? "#B85A56" : "#F7F5F0",
                      textAlign: "left",
                      zIndex: 1,
                      boxShadow: "0 8px 18px rgba(64,51,39,0.10)",
                      textDecoration: noShow ? "line-through" : "none",
                      textDecorationColor: "rgba(194,84,80,0.75)",
                      textDecorationThickness: 1.5,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appt.client?.fullName || "Cliente"}</strong>
                      <span style={{ opacity: noShow ? 0.9 : 0.72, flexShrink: 0 }}>{formatTime(appt.startsAt)}</span>
                    </div>
                    <div style={{ marginTop: 3, opacity: noShow ? 0.85 : 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {appt.service?.name}
                    </div>
                    {appt.indications && (
                      <div style={{ marginTop: 3, opacity: noShow ? 0.75 : 0.78, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                        {appt.indications}
                      </div>
                    )}
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

function DayGrid({ appointments, date, today, roomColorMap, onSelect, onSelectGroup }) {
  const HOUR_HEIGHT = 66;
  const active = appointments.filter((a) => a.status !== "cancelado" && toLocalDate(new Date(a.startsAt)) === date);
  const laneMap = buildSlotLanes(active);
  const entries = visibleScheduleEntries(active);

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
          {entries.map((entry) => {
            const appt = entry.type === "group" ? entry.appointments[0] : entry.appointment;
            const h = getEcuadorHour(appt.startsAt);
            const m = parseInt(getEcuadorMinutes(appt.startsAt), 10) || 0;
            const topOffset = (h - HOURS[0]) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
            const duration = appt.service?.durationMins || 60;
            const height = (duration / 60) * HOUR_HEIGHT;

            if (entry.type === "group") {
              const names = entry.appointments.slice(0, 3).map((a) => a.client?.fullName || "Cliente").join(", ");
              return (
                <button
                  key={entry.key}
                  onClick={() => onSelectGroup(entry.appointments)}
                  style={{
                    position: "absolute",
                    top: topOffset + 4,
                    left: 8,
                    right: 8,
                    height: Math.max(Math.min(height - 8, 62), 44),
                    borderRadius: 10,
                    padding: "7px 12px",
                    border: "1px solid rgba(140,110,80,0.24)",
                    background: "rgba(140,110,80,0.86)",
                    color: "#F7F5F0",
                    textAlign: "left",
                    cursor: "pointer",
                    zIndex: 3,
                    boxShadow: "0 10px 24px rgba(64,51,39,0.14)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.appointments.length} citas · {formatTime(appt.startsAt)}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.82, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                    {names}{entry.appointments.length > 3 ? ` +${entry.appointments.length - 3} más` : ""}
                  </div>
                </button>
              );
            }

            const color = appointmentColor(appt, roomColorMap);
            const lane = laneMap.get(appt.id);

            return (
              <button
                key={appt.id}
                onClick={() => onSelect(appt)}
                style={{
                  position: "absolute",
                  top: topOffset + 1,
                  ...lanePosition(lane, 6),
                  height: Math.max(height - 2, 24),
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 13,
                  overflow: "hidden",
                  cursor: "pointer",
                  border: "none",
                  background: color || "#8C6E50",
                  color: "#F7F5F0",
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

function SlotGroupModal({ appointments, phase, onClose, onSelect }) {
  const list = appointments || [];
  const first = list[0];
  if (!first) return null;
  const title = `${list.length} citas · ${formatTime(first.startsAt)}`;
  const dateLabel = formatDayFull(toLocalDate(new Date(first.startsAt)));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: phase === "entered" ? "rgba(64,51,39,0.34)" : "rgba(64,51,39,0)",
        transition: "background 220ms ease",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          maxHeight: "min(620px, 86vh)",
          overflow: "hidden",
          background: "#FDFCFA",
          border: "1px solid rgba(168,154,135,0.35)",
          borderRadius: 18,
          boxShadow: "0 24px 70px rgba(64,51,39,0.24)",
          opacity: phase === "entered" ? 1 : 0,
          transform: phase === "entered" ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
          transition: "opacity 220ms ease, transform 220ms ease",
        }}
      >
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(168,154,135,0.18)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h3 className="font-heading" style={{ margin: 0, color: "#6B5540", fontSize: 24, fontWeight: 600 }}>{title}</h3>
            <p style={{ margin: "6px 0 0", color: "#A89A87", fontSize: 13 }}>{dateLabel}</p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: "#A89A87", cursor: "pointer", height: 30 }} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "8px 18px 18px", overflowY: "auto", maxHeight: "calc(min(620px, 86vh) - 94px)" }}>
          {list.map((appt) => {
            return (
              <button
                key={appt.id}
                onClick={() => onSelect(appt)}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  borderRadius: 12,
                  padding: "13px 10px",
                  display: "grid",
                  gridTemplateColumns: "54px 1fr auto",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(168,154,135,0.14)",
                }}
              >
                <span style={{ color: "#8C6E50", fontSize: 13, fontWeight: 700 }}>{formatTime(appt.startsAt)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "#6B5540", fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appt.client?.fullName || "Cliente"}</span>
                  <span style={{ display: "block", color: "#A89A87", fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appt.service?.name || "Servicio"}</span>
                </span>
                <span style={{ color: "#A89A87", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {appt.room?.name || "Sin cabina"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function AppointmentDetail({ appt, phase, rooms, staffList, onClose, onUpdated }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editRoomId, setEditRoomId] = useState("");
  const [editStaffId, setEditStaffId] = useState("");
  const [editIndications, setEditIndications] = useState("");

  useEffect(() => {
    if (!appt) return;
    setEditDate(toLocalDate(new Date(appt.startsAt)));
    setEditTime(formatTime(appt.startsAt));
    setEditRoomId(appt.room?.id || "");
    setEditStaffId(appt.staff?.id || "");
    setEditIndications(appt.indications || "");
  }, [appt]);

  if (!appt) return null;
  const statusInfo = STATUS_COLORS[appt.status] || STATUS_COLORS.pendiente;

  async function changeStatus(newStatus) {
    setSaving(true);
    try {
      const updated = await authFetch(`/appointments/${appt.id}/status`, { method: "PATCH", body: { status: newStatus } });
      onUpdated({ ...appt, ...updated, service: appt.service, client: appt.client, room: appt.room, staff: appt.staff, indications: updated.indications ?? appt.indications });
      toast.success(`Cita marcada como ${newStatus}`);
    } catch (err) {
      toast.error(err.message || "Error al cambiar estado");
    } finally {
      setSaving(false);
    }
  }

  async function saveIndications(nextValue = editIndications) {
    setSaving(true);
    try {
      const clean = String(nextValue || "").trim();
      const updated = await authFetch(`/appointments/${appt.id}`, {
        method: "PATCH",
        body: { indications: clean || null },
      });
      setEditIndications(updated.indications || clean || "");
      onUpdated({
        ...appt,
        ...updated,
        service: appt.service,
        client: appt.client,
        room: appt.room,
        staff: appt.staff,
        indications: updated.indications ?? (clean || null),
      }, { close: false });
      toast.success(clean ? "Indicaciones guardadas" : "Indicaciones eliminadas");
    } catch (err) {
      toast.error(err.message || "No se pudieron guardar las indicaciones");
    } finally {
      setSaving(false);
    }
  }

  async function saveReschedule() {
    setSaving(true);
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
      toast.success("Cita reprogramada");
    } catch (err) {
      toast.error(err.message || "Error al reprogramar");
    } finally {
      setSaving(false);
    }
  }

  const canChange = appt.status !== "cancelado" && appt.status !== "no_show";
  const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 13, color: "#6B5540", background: "#FDFCFA", outline: "none" };
  const pillBtn = (bg, color, border) => ({ padding: "7px 16px", borderRadius: 999, border: border || "none", background: bg, color, fontSize: 12, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 });

  return (
    <div
      className={`alma-backdrop alma-anim-${phase}`}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 440, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)", maxHeight: "90vh", overflowY: "auto" }}
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
                  <span style={{ color: "#A89A87" }}>Cabina</span>
                  <span>{appt.room.name}</span>
                </div>
              )}
              {appt.staff && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#6B5540" }}>
                  <span style={{ color: "#A89A87" }}>Terapeuta</span>
                  <span>{appt.staff.name}</span>
                </div>
              )}
              {appt.priceUsd != null && (
                <div style={{ textAlign: "right", fontWeight: 600, fontSize: 16, color: "#6B5540", marginTop: 4 }}>
                  ${Number(appt.priceUsd).toFixed(2)}
                </div>
              )}
              <div style={{ border: "1px solid rgba(201,168,118,0.30)", background: "rgba(235,205,181,0.16)", borderRadius: 12, padding: 12, color: "#6B5540", lineHeight: 1.45 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <div style={{ color: "#8C6E50", fontSize: 12, fontWeight: 700 }}>Indicaciones / recomendaciones</div>
                  {(appt.indications || editIndications) && (
                    <button
                      disabled={saving}
                      onClick={() => saveIndications("")}
                      style={{ border: "none", background: "transparent", color: "#C25450", fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
                <textarea
                  value={editIndications}
                  onChange={(e) => setEditIndications(e.target.value)}
                  placeholder="Escribe aquí las indicaciones para esta cita..."
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", minHeight: 78, lineHeight: 1.45 }}
                />
                <button
                  disabled={saving || editIndications.trim() === String(appt.indications || "").trim()}
                  onClick={() => saveIndications()}
                  style={{
                    ...pillBtn("#FDFCFA", "#8C6E50", "1px solid rgba(140,110,80,0.32)"),
                    marginTop: 8,
                    width: "100%",
                    opacity: saving || editIndications.trim() === String(appt.indications || "").trim() ? 0.5 : 1,
                  }}
                >
                  {saving ? "Guardando..." : "Guardar indicaciones"}
                </button>
              </div>
            </div>

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
              <label style={{ display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 }}>Cabina</label>
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
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEditing(false)} style={{ ...pillBtn("transparent", "#8C6E50", "1px solid #8C6E50"), flex: 1 }}>Cancelar</button>
              <button disabled={saving} onClick={saveReschedule} style={{ ...pillBtn("#8C6E50", "#F7F5F0"), flex: 1 }}>{saving ? "Guardando…" : "Guardar"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAppointmentForm({ defaultDate, phase, onClose, onCreated, preSelectedClient }) {
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [clientSearch, setClientSearch] = useState(preSelectedClient?.fullName || "");
  const [clientResults, setClientResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState(preSelectedClient || null);
  const [showNewClient, setShowNewClient] = useState(false);
  const newClientAnim = useAnimatedMount(showNewClient, 220);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [indications, setIndications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();
  const searchTimer = useRef(null);
  const selectedService = useMemo(
    () => services.find((service) => service.id === serviceId) || null,
    [services, serviceId]
  );
  const compatibleRooms = useMemo(
    () => {
      if (!selectedService) return [];
      const linkedIds = new Set((selectedService.rooms || []).map((room) => room.id));
      if (linkedIds.size) return rooms.filter((room) => linkedIds.has(room.id));
      return rooms.filter((room) => room.specialty === selectedService.category);
    },
    [rooms, selectedService]
  );

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
    if (!selectedService) {
      setRoomId("");
      return;
    }
    setRoomId((prev) => compatibleRooms.some((room) => room.id === prev) ? prev : "");
  }, [selectedService, compatibleRooms]);

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
    setValidation(null);
    setSubmitting(true);

    try {
      const clientId = selectedClient?.id;
      if (!clientId) { setValidation("Selecciona o crea un cliente"); setSubmitting(false); return; }
      if (!serviceId) { setValidation("Selecciona un servicio"); setSubmitting(false); return; }
      if (!staffId) { setValidation("Selecciona un terapeuta"); setSubmitting(false); return; }
      if (compatibleRooms.length === 0) { setValidation("Este servicio no tiene cabina compatible activa"); setSubmitting(false); return; }

      await authFetch("/appointments", {
        method: "POST",
        body: { clientId, serviceId, staffId, roomId: roomId || undefined, startsAt: time, modality: "presencial", indications: indications.trim() || undefined },
      });

      toast.success("Reserva creada");
      onCreated();
    } catch (err) {
      toast.error(err.message || "Error al crear la cita");
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
      className={`alma-backdrop alma-anim-${phase}`}
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
        className={`alma-card alma-modal alma-anim-${phase}`}
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 16px",
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
            <div style={{ position: "relative" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: "#A89A87" }} />
                <input
                  style={{ ...inputStyle, paddingLeft: 34 }}
                  placeholder="Buscar por nombre o ficha…"
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
                <button type="button" onClick={() => setShowNewClient(true)} style={{ fontSize: 12, color: "#8C6E50", background: "none", border: "none", cursor: "pointer", marginTop: 6, textDecoration: "underline" }}>+ Crear nueva clienta</button>
              )}
            </div>
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
              <label style={labelStyle} htmlFor="room">Cabina</label>
              <select
                id="room"
                style={selectStyle}
                value={roomId}
                disabled={!selectedService || compatibleRooms.length === 0}
                onChange={(e) => setRoomId(e.target.value)}
              >
                <option value="">{!selectedService ? "Elige servicio" : compatibleRooms.length === 0 ? "Sin cabina compatible" : "Asignar automáticamente"}</option>
                {compatibleRooms.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
              </select>
              {selectedService && compatibleRooms.length === 1 && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8C6E50" }}>
                  {"Disponible para este servicio: "}{compatibleRooms[0].name}
                </p>
              )}
              {selectedService && compatibleRooms.length > 1 && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#A89A87" }}>
                  {"El sistema elige la cabina libre si lo dejas automático."}
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="staff">Terapeuta</label>
              <select id="staff" style={selectStyle} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Seleccionar</option>
                {staff.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="indications">Indicaciones para la agenda</label>
            <textarea
              id="indications"
              style={{ ...inputStyle, minHeight: 74, resize: "vertical", lineHeight: 1.4 }}
              value={indications}
              onChange={(e) => setIndications(e.target.value)}
              placeholder="Ej. traer ficha, preparar equipo, preferencia de cabina..."
            />
          </div>

          {validation && <p style={{ fontSize: 13, color: "#C25450", textAlign: "center", margin: 0 }}>{validation}</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Cancelar</button>
            <button type="submit" disabled={submitting} style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Creando…" : "Crear reserva"}
            </button>
          </div>
        </form>
      </div>
      {newClientAnim.shouldRender && (
        <NewClientModal
          phase={newClientAnim.phase}
          initialName={clientSearch}
          onClose={() => setShowNewClient(false)}
          onSaved={(created) => {
            setShowNewClient(false);
            selectClient(created);
          }}
        />
      )}
    </div>
  );
}
