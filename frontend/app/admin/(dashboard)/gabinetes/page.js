"use client";

import { useState, useEffect, useCallback } from "react";
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

export default function GabinetesPage() {
  const isMobile = useIsMobile();
  const [rooms, setRooms] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timestamp, setTimestamp] = useState("");
  const [nowMs, setNowMs] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = toLocalDate(new Date());
      const [roomsData, apptsData] = await Promise.all([
        authFetch("/rooms"),
        authFetch("/appointments", {
          query: { from: `${today}T00:00:00`, to: `${today}T23:59:59` },
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

  const activeAppts = appointments.filter(
    (a) => a.status === "pendiente" || a.status === "confirmado"
  );
  const domicilioAppts = activeAppts.filter((a) => a.modality === "domicilio");

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "28px 32px", display: "flex", flexDirection: "column", gap: isMobile ? 16 : 22, overflowY: "auto", overflowX: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 18 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: isMobile ? 22 : 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
            Gabinetes
          </h1>
          <p style={{ margin: 0, fontSize: isMobile ? 12 : 14, color: "#A89A87" }}>
            Estado en tiempo real · {timestamp}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, fontSize: 12, color: "#6B5540", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#C9A876" }} />
            Libre
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#6B5540" }} />
            Ocupado
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px dashed #8C6E50", boxSizing: "border-box" }} />
            A domicilio
          </span>
        </div>
      </div>

      {loading && rooms.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: isMobile ? 14 : 20, alignItems: "start" }}>
          {rooms.filter((r) => r.active).map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              appointments={activeAppts.filter((a) => a.roomId === room.id)}
              isMobile={isMobile}
              nowMs={nowMs}
            />
          ))}
          {domicilioAppts.length > 0 && (
            <DomicilioCard appointments={domicilioAppts} isMobile={isMobile} />
          )}
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, appointments, isMobile = false, nowMs = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const current = appointments.find((a) => isNowBetween(a.startsAt, a.endsAt, nowMs));
  const isOccupied = !!current;

  const progress = current
    ? Math.min(
        100,
        ((nowMs - new Date(current.startsAt).getTime()) /
          (new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime())) *
          100
      )
    : 0;

  return (
    <div
      className="alma-card"
      style={{
        padding: isMobile ? 16 : 24,
        border: isOccupied ? "1px solid rgba(107,85,64,0.45)" : undefined,
        gridRow: !isMobile && expanded ? "span 2" : "auto",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h2 className="font-heading" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          {room.name}
        </h2>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 14px",
            borderRadius: 999,
            background: isOccupied ? "#6B5540" : "rgba(201,168,118,0.25)",
            color: isOccupied ? "#EBE8E1" : "#8C6E50",
            fontSize: 12,
            fontWeight: 500,
            transition: "background var(--motion-slow) var(--ease-in-out-quart), color var(--motion-slow) var(--ease-in-out-quart)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isOccupied ? "#EBCDB5" : "#C9A876",
              transition: "background var(--motion-slow) var(--ease-in-out-quart)",
            }}
          />
          {isOccupied ? "Ocupado" : "Libre"}
        </span>
      </div>

      {/* Current appointment info */}
      {current ? (
        <>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#A89A87" }}>
            En curso: {current.service?.name} · {current.client?.fullName} · termina {formatTime(current.endsAt)}
          </p>
          <div style={{ height: 4, borderRadius: 999, background: "rgba(168,154,135,0.3)", marginBottom: 20 }}>
            <div style={{ width: `${progress}%`, height: "100%", borderRadius: 999, background: "#8C6E50", transition: "width 1s" }} />
          </div>
        </>
      ) : (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#A89A87" }}>
          {appointments.length > 0
            ? `Siguiente: ${appointments[0].service?.name} · ${formatTime(appointments[0].startsAt)}`
            : "Sin citas programadas hoy"}
        </p>
      )}

      {/* Expand toggle */}
      {appointments.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 18px",
              borderRadius: 999,
              border: expanded ? "none" : "1px solid #8C6E50",
              background: expanded ? "#8C6E50" : "none",
              color: expanded ? "#F7F5F0" : "#8C6E50",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              marginBottom: expanded ? 18 : 0,
            }}
          >
            {expanded ? "Ocultar clientes reservados ▴" : `Ver ${appointments.length} cita${appointments.length !== 1 ? "s" : ""} del día ▾`}
          </button>

          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid rgba(168,154,135,0.35)" }}>
              {appointments.map((appt, i) => {
                const isCurrent = isNowBetween(appt.startsAt, appt.endsAt, nowMs);
                const isConfirmed = appt.status === "confirmado";
                return (
                  <div
                    key={appt.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "13px 4px",
                      borderBottom: i < appointments.length - 1 ? "1px solid rgba(168,154,135,0.25)" : "none",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "#6B5540" }}>
                        {appt.client?.fullName || "Cliente"}
                      </div>
                      <div style={{ fontSize: 12, color: "#A89A87" }}>
                        {formatTime(appt.startsAt)} · {appt.service?.name}
                      </div>
                    </div>
                    {isConfirmed ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 12px",
                          borderRadius: 999,
                          background: "rgba(201,168,118,0.2)",
                          color: "#8C6E50",
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        ✓ Confirmó{isCurrent ? " · en curso" : ""}
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 12px",
                          borderRadius: 999,
                          border: "1px solid #A89A87",
                          color: "#A89A87",
                          fontSize: 12,
                        }}
                      >
                        Sin confirmar
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DomicilioCard({ appointments, isMobile = false }) {
  return (
    <div
      className="alma-card"
      style={{
        padding: isMobile ? 16 : 24,
        border: "1.5px dashed rgba(140,110,80,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h2 className="font-heading" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>
          A domicilio
        </h2>
        <span style={{ fontSize: 13, color: "#A89A87" }}>{appointments.length} hoy</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {appointments.map((appt, i) => (
          <div
            key={appt.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 4px",
              borderBottom: i < appointments.length - 1 ? "1px solid rgba(168,154,135,0.25)" : "none",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#6B5540" }}>
                {appt.client?.fullName || "Cliente"}
              </div>
              <div style={{ fontSize: 12, color: "#A89A87" }}>
                {formatTime(appt.startsAt)} · {appt.service?.name}
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 999,
                background: appt.status === "confirmado" ? "rgba(201,168,118,0.2)" : "transparent",
                border: appt.status !== "confirmado" ? "1px solid #A89A87" : "none",
                color: appt.status === "confirmado" ? "#8C6E50" : "#A89A87",
                fontSize: 12,
                fontWeight: appt.status === "confirmado" ? 500 : 400,
              }}
            >
              {appt.status === "confirmado" ? "✓ Confirmó" : "Sin confirmar"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
