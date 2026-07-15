"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  LayoutGrid,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
  Loader2,
  Home,
  RefreshCw,
} from "lucide-react";

function toLocalDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Guayaquil",
  });
}

function isNowBetween(startsAt, endsAt) {
  const now = Date.now();
  return now >= new Date(startsAt).getTime() && now < new Date(endsAt).getTime();
}

export default function GabinetesPage() {
  const [rooms, setRooms] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

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
      setRooms(roomsData);
      setAppointments(apptsData);
      setLastRefresh(new Date());
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
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Gabinetes
          </h1>
          <p className="text-sm text-muted-foreground">
            Estado en tiempo real de cada gabinete
            {lastRefresh && (
              <span className="ml-2">
                · Actualizado {lastRefresh.toLocaleTimeString("es-EC", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Guayaquil",
                })}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {loading && rooms.length === 0 ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                appointments={activeAppts.filter((a) => a.roomId === room.id)}
              />
            ))}
          </div>

          {domicilioAppts.length > 0 && (
            <>
              <Separator />
              <div>
                <h2 className="text-lg font-heading font-semibold flex items-center gap-2 mb-4">
                  <Home className="h-5 w-5 text-muted-foreground" />
                  A domicilio
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {domicilioAppts.map((appt) => (
                    <AppointmentMini key={appt.id} appt={appt} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RoomCard({ room, appointments }) {
  const [expanded, setExpanded] = useState(false);
  const current = appointments.find((a) => isNowBetween(a.startsAt, a.endsAt));
  const isOccupied = !!current;

  return (
    <Card className={`transition-colors ${isOccupied ? "border-destructive/40" : "border-green-400/40"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            {room.name}
          </CardTitle>
          <Badge
            className={
              isOccupied
                ? "bg-red-100 text-red-800 border-red-300"
                : "bg-green-100 text-green-800 border-green-300"
            }
          >
            {isOccupied ? "Ocupado" : "Libre"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {current && (
          <div className="rounded-md bg-destructive/5 p-3 text-sm space-y-1">
            <p className="font-medium">{current.service?.name}</p>
            <p className="text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" />
              {current.client?.fullName}
            </p>
            <p className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(current.startsAt)} — {formatTime(current.endsAt)}
            </p>
          </div>
        )}

        {appointments.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" /> Ocultar citas del día
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" /> Ver {appointments.length} cita{appointments.length !== 1 ? "s" : ""} del día
              </>
            )}
          </Button>
        )}

        {expanded && (
          <div className="space-y-2">
            {appointments.map((appt) => (
              <AppointmentMini key={appt.id} appt={appt} />
            ))}
          </div>
        )}

        {appointments.length === 0 && !isOccupied && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Sin citas programadas hoy
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AppointmentMini({ appt }) {
  const statusBadge = {
    pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
    confirmado: "bg-green-100 text-green-800 border-green-300",
  };
  const statusLabel = {
    pendiente: "Pendiente",
    confirmado: "Confirmado",
  };

  return (
    <div className="rounded-md border border-border p-2 text-sm space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium">{appt.service?.name}</span>
        <Badge className={statusBadge[appt.status] || "bg-gray-100 text-gray-800"}>
          {statusLabel[appt.status] || appt.status}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {formatTime(appt.startsAt)} — {formatTime(appt.endsAt)}
      </p>
      {appt.client && (
        <p className="text-muted-foreground text-xs flex items-center gap-1">
          <User className="h-3 w-3" />
          {appt.client.fullName}
        </p>
      )}
    </div>
  );
}
