"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";

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

function isNowBetween(startsAt, endsAt, nowMs) {
  return nowMs >= new Date(startsAt).getTime() && nowMs < new Date(endsAt).getTime();
}

function formatNow() {
  return new Date().toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Guayaquil",
  }) + ", " + new Date().toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Guayaquil",
  });
}

function sortByStart(appts) {
  return [...appts].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function statusLabel(status) {
  return status === "confirmado" ? "Confirm\u00f3" : "Sin confirmar";
}

export default function GabinetesPage() {
  const isMobile = useIsMobile();
  const [rooms, setRooms] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timestamp, setTimestamp] = useState("");
  const [nowMs, setNowMs] = useState(0);
  const [expandedRoomId, setExpandedRoomId] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = toLocalDate(new Date());
      const [roomsData, apptsData] = await Promise.all([
        authFetch("/rooms"),
        authFetch("/appointments", {
          query: { from: today + "T00:00:00", to: today + "T23:59:59" },
        }),
      ]);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setAppointments(Array.isArray(apptsData) ? apptsData : []);
      setTimestamp(formatNow());
      setNowMs(Date.now());
    } catch {
      setRooms([]);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeRooms = useMemo(() => rooms.filter((r) => r.active), [rooms]);
  const activeAppts = useMemo(
    () => sortByStart(appointments.filter((a) => a.status === "pendiente" || a.status === "confirmado")),
    [appointments]
  );
  const roomAppts = useMemo(
    () => activeAppts.filter((a) => a.roomId),
    [activeAppts]
  );
  const occupiedCount = useMemo(
    () => activeRooms.filter((room) => roomAppts.some((a) => a.roomId === room.id && isNowBetween(a.startsAt, a.endsAt, nowMs))).length,
    [activeRooms, roomAppts, nowMs]
  );
  const freeCount = Math.max(activeRooms.length - occupiedCount, 0);

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "28px 32px", display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20, overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 18 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: isMobile ? 24 : 28, fontWeight: 600, color: "#6B5540", margin: "0 0 5px" }}>
            Cabinas
          </h1>
          <p style={{ margin: 0, fontSize: isMobile ? 12 : 14, color: "#A89A87" }}>
            Estado en tiempo real &middot; {timestamp || "actualizando..."}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            border: "1px solid rgba(140,110,80,0.45)",
            borderRadius: 999,
            background: loading ? "rgba(201,168,118,0.16)" : "#F7F5F0",
            color: "#8C6E50",
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            boxShadow: "0 8px 20px rgba(80, 62, 42, 0.06)",
          }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, minmax(150px, 1fr))", gap: isMobile ? 10 : 12 }}>
        <SummaryTile label="Libres" value={freeCount} tone="soft" />
        <SummaryTile label="Ocupados" value={occupiedCount} tone="dark" />
        <SummaryTile label="Citas hoy" value={roomAppts.length} tone="line" />
      </section>

      {loading && activeRooms.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : activeRooms.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(230px, 290px))", gap: isMobile ? 12 : 16, alignItems: "start", justifyContent: isMobile ? "stretch" : "start" }}>
          {activeRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              appointments={roomAppts.filter((a) => a.roomId === room.id)}
              isMobile={isMobile}
              nowMs={nowMs}
            expanded={expandedRoomId === room.id}
              onToggle={() => setExpandedRoomId((current) => current === room.id ? null : room.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  const styles = {
    soft: { bg: "rgba(201,168,118,0.18)", dot: "#C9A876", border: "rgba(201,168,118,0.32)" },
    dark: { bg: "rgba(107,85,64,0.1)", dot: "#6B5540", border: "rgba(107,85,64,0.24)" },
    line: { bg: "rgba(235,232,225,0.62)", dot: "#A89A87", border: "rgba(168,154,135,0.28)" },
    dash: { bg: "rgba(247,245,240,0.76)", dot: "transparent", border: "rgba(140,110,80,0.36)" },
  }[tone];

  return (
    <div style={{ border: "1px solid " + styles.border, background: styles.bg, borderRadius: 18, padding: "14px 16px", minHeight: 82, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8C6E50", fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: styles.dot, border: tone === "dash" ? "1.5px dashed #8C6E50" : "none" }} />
        {label}
      </span>
      <strong className="font-heading" style={{ color: "#6B5540", fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{value}</strong>
    </div>
  );
}

function RoomCard({ room, appointments, isMobile = false, nowMs = 0, expanded = false, onToggle }) {
  const current = appointments.find((a) => isNowBetween(a.startsAt, a.endsAt, nowMs));
  const next = appointments.find((a) => new Date(a.startsAt).getTime() > nowMs) || appointments[0];
  const isOccupied = !!current;
  const progress = current
    ? Math.min(100, Math.max(0, ((nowMs - new Date(current.startsAt).getTime()) / (new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime())) * 100))
    : 0;

  return (
    <article
      className="alma-card"
      style={{
        padding: 0,
        overflow: "hidden",
        minHeight: isMobile ? 186 : 202,
        border: isOccupied ? "1px solid rgba(107,85,64,0.48)" : "1px solid rgba(168,154,135,0.28)",
        boxShadow: isOccupied ? "0 16px 34px rgba(80,62,42,0.12)" : "0 10px 26px rgba(80,62,42,0.07)",
      }}
    >
      <div style={{ padding: isMobile ? 16 : 18, background: isOccupied ? "linear-gradient(135deg, rgba(107,85,64,0.96), rgba(140,110,80,0.88))" : "linear-gradient(135deg, #fffdf8, #f3eee5)", color: isOccupied ? "#F7F5F0" : "#6B5540" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="font-heading" style={{ fontSize: isMobile ? 20 : 22, fontWeight: 600, margin: "0 0 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {room.name}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: isOccupied ? "rgba(247,245,240,0.78)" : "#A89A87", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {room.specialty} &middot; {room.opensAt || "09:00"}-{room.closesAt || "19:00"}
            </p>
          </div>
          <StatusPill occupied={isOccupied} />
        </div>

        <div style={{ marginTop: 18 }}>
          {current ? (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "rgba(247,245,240,0.82)" }}>En curso hasta {formatTime(current.endsAt)}</p>
              <strong style={{ display: "block", fontSize: 15, color: "#FFFFFF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {current.client?.fullName || "Cliente"}
              </strong>
              <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "rgba(247,245,240,0.76)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {current.service?.name || "Servicio"}
              </span>
              <div style={{ height: 4, borderRadius: 999, background: "rgba(247,245,240,0.22)", marginTop: 13 }}>
                <div style={{ width: progress + "%", height: "100%", borderRadius: 999, background: "#EBCDB5", transition: "width 1s" }} />
              </div>
            </>
          ) : next ? (
            <>
              <p style={{ margin: "0 0 7px", fontSize: 12, color: "#A89A87" }}>{"Pr\u00f3xima cita"} &middot; {formatTime(next.startsAt)}</p>
              <strong style={{ display: "block", fontSize: 15, color: "#6B5540", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {next.client?.fullName || "Cliente"}
              </strong>
              <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "#A89A87", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {next.service?.name || "Servicio"}
              </span>
            </>
          ) : (
            <div style={{ display: "flex", minHeight: 58, alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#A89A87" }}>Sin citas programadas hoy</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? "13px 16px 15px" : "14px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <MiniTimeline appointments={appointments} nowMs={nowMs} />
        {appointments.length > 0 && (
          <button
            onClick={onToggle}
            style={{
              alignSelf: "flex-start",
              border: "1px solid rgba(140,110,80,0.46)",
              borderRadius: 999,
              background: expanded ? "#8C6E50" : "transparent",
              color: expanded ? "#F7F5F0" : "#8C6E50",
              padding: "8px 13px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {expanded ? "Ocultar d\u00eda" : "Ver d\u00eda"}
          </button>
        )}
        {expanded && <AppointmentList appointments={appointments} nowMs={nowMs} />}
      </div>
    </article>
  );
}

function StatusPill({ occupied }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 999, background: occupied ? "rgba(247,245,240,0.16)" : "rgba(201,168,118,0.22)", color: occupied ? "#F7F5F0" : "#8C6E50", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: occupied ? "#EBCDB5" : "#C9A876" }} />
      {occupied ? "Ocupado" : "Libre"}
    </span>
  );
}

function MiniTimeline({ appointments, nowMs }) {
  if (appointments.length === 0) {
    return <div style={{ height: 6, borderRadius: 999, background: "rgba(168,154,135,0.16)" }} />;
  }

  return (
    <div style={{ display: "flex", gap: 5, height: 7 }} aria-label="Citas del d\u00eda">
      {appointments.slice(0, 6).map((appt) => {
        const active = isNowBetween(appt.startsAt, appt.endsAt, nowMs);
        return (
          <span
            key={appt.id}
            title={(appt.client?.fullName || "Cliente") + " \u00b7 " + formatTime(appt.startsAt)}
            style={{ flex: 1, minWidth: 16, borderRadius: 999, background: active ? "#6B5540" : appt.status === "confirmado" ? "#C9A876" : "rgba(168,154,135,0.32)" }}
          />
        );
      })}
      {appointments.length > 6 && <span style={{ fontSize: 11, color: "#A89A87", lineHeight: "7px" }}>+{appointments.length - 6}</span>}
    </div>
  );
}

function AppointmentList({ appointments, nowMs }) {
  return (
    <div style={{ borderTop: "1px solid rgba(168,154,135,0.26)", paddingTop: 4 }}>
      {appointments.map((appt, i) => {
        const isCurrent = isNowBetween(appt.startsAt, appt.endsAt, nowMs);
        return (
          <div key={appt.id} style={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: i < appointments.length - 1 ? "1px solid rgba(168,154,135,0.18)" : "none" }}>
            <span style={{ fontSize: 12, color: isCurrent ? "#6B5540" : "#A89A87", fontWeight: isCurrent ? 700 : 500 }}>{formatTime(appt.startsAt)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#6B5540", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{appt.client?.fullName || "Cliente"}</div>
              <div style={{ fontSize: 12, color: "#A89A87", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{appt.service?.name || "Servicio"}</div>
            </div>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: appt.status === "confirmado" ? "rgba(201,168,118,0.2)" : "transparent", border: appt.status === "confirmado" ? "none" : "1px solid rgba(168,154,135,0.45)", color: appt.status === "confirmado" ? "#8C6E50" : "#A89A87", fontSize: 11, whiteSpace: "nowrap" }}>
              {appt.status === "confirmado" ? "\u2713 " : ""}{statusLabel(appt.status)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="alma-card" style={{ padding: "34px 28px", maxWidth: 520, textAlign: "center", alignSelf: "center", marginTop: 40 }}>
      <h2 className="font-heading" style={{ margin: "0 0 8px", color: "#6B5540", fontSize: 24 }}>Sin cabinas activas</h2>
      <p style={{ margin: 0, color: "#A89A87", fontSize: 14 }}>{"Cuando agregues cabinas activas, aparecerán aquí como cuadros pequeños."}</p>
    </div>
  );
}
