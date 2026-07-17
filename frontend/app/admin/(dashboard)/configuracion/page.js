"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Download, Loader2, Plus, Upload } from "lucide-react";

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

export default function ConfiguracionPage() {
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const categories = useMemo(() => [...new Set(services.filter((s) => s.active).map((s) => s.category))], [services]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, r, p] = await Promise.all([authFetch("/services"), authFetch("/rooms"), authFetch("/plans")]);
      setServices(s);
      setRooms(r);
      setPlans(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function addService() {
    const name = window.prompt("Nombre del servicio");
    if (!name) return;
    const category = window.prompt("Categoria/especialidad");
    if (!category) return;
    const priceUsd = Number(window.prompt("Precio USD") || 0);
    if (!priceUsd) return;
    await authFetch("/services", { method: "POST", body: { name, category, priceUsd, offersHomeService: false } });
    await fetchData();
  }

  async function updateService(service, changes) {
    await authFetch(`/services/${service.id}`, { method: "PATCH", body: changes });
    await fetchData();
  }

  async function addRoom() {
    const name = window.prompt("Nombre del gabinete");
    if (!name) return;
    const specialty = window.prompt(`Especialidad (${categories.join(", ")})`);
    if (!specialty) return;
    await authFetch("/rooms", { method: "POST", body: { name, specialty } });
    await fetchData();
  }

  async function updateRoom(room, specialty) {
    await authFetch(`/rooms/${room.id}`, { method: "PATCH", body: { specialty } });
    await fetchData();
  }

  async function createPlan() {
    const name = window.prompt("Nombre del plan");
    if (!name) return;
    const sessionsIncluded = Number(window.prompt("Sesiones incluidas") || 0);
    if (!sessionsIncluded) return;
    const period = window.prompt("Periodo (mensual, trimestral, anual)") || "mensual";
    const priceUsd = Number(window.prompt("Precio USD") || 0);
    if (!priceUsd) return;
    await authFetch("/plans", {
      method: "POST",
      body: { name, sessionsIncluded, period, priceUsd, appliesToAllServices: true, includesHomeService: false },
    });
    await fetchData();
  }

  const cardStyle = {
    background: "#F7F5F0",
    border: "1px solid rgba(168,154,135,0.4)",
    borderRadius: 12,
    padding: 24,
    minHeight: 300,
  };

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto" }}>
      {/* Header */}
      <div>
        <h1 className="font-heading" style={{ fontSize: 30, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
          Configuracion
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Servicios, gabinetes, planes y respaldo de datos</p>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Servicios y precios */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                Servicios y precios
              </h3>
              <button
                onClick={addService}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 16px",
                  borderRadius: 999,
                  border: "1px solid #8C6E50",
                  background: "transparent",
                  color: "#8C6E50",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Anadir servicio
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {services
                .filter((s) => s.active)
                .map((s, i, arr) => (
                  <div
                    key={s.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 0",
                      borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none",
                    }}
                  >
                    <div>
                      <p style={{ margin: 0, fontSize: 14, color: "#6B5540" }}>{s.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#A89A87" }}>
                        1 h · {s.category}
                        {s.offersHomeService ? " · domicilio" : ""}
                      </p>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={Number(s.priceUsd).toFixed(2)}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== Number(s.priceUsd))
                          updateService(s, { priceUsd: Number(e.target.value) });
                      }}
                      style={{
                        width: 90,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(168,154,135,0.5)",
                        background: "#FDFCFA",
                        textAlign: "right",
                        fontSize: 13,
                        color: "#6B5540",
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={() => updateService(s, { offersHomeService: !s.offersHomeService })}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(168,154,135,0.5)",
                        background: s.offersHomeService ? "rgba(201,168,118,0.2)" : "transparent",
                        color: "#8C6E50",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {s.offersHomeService ? "Domicilio" : "Spa"}
                    </button>
                  </div>
                ))}
            </div>
          </div>

          {/* Planes y membresias */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                Planes y membresias
              </h3>
              <button
                onClick={createPlan}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 16px",
                  borderRadius: 999,
                  border: "1px solid #8C6E50",
                  background: "transparent",
                  color: "#8C6E50",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Crear plan
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {plans
                .filter((p) => p.active)
                .map((p) => (
                  <div
                    key={p.id}
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(235,205,181,0.6)",
                      background: "rgba(235,205,181,0.2)",
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{p.name}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#A89A87" }}>
                          {p.sessionsIncluded} sesiones · {p.period} ·{" "}
                          {p.appliesToAllServices ? "cualquier servicio" : "servicios seleccionados"}
                        </p>
                      </div>
                      <b style={{ fontSize: 16, color: "#8C6E50" }}>{money(p.priceUsd)}</b>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Gabinetes */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                Gabinetes
              </h3>
              <button
                onClick={addRoom}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 16px",
                  borderRadius: 999,
                  border: "1px solid #8C6E50",
                  background: "transparent",
                  color: "#8C6E50",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Anadir gabinete
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rooms
                .filter((r) => r.active)
                .map((r, i, arr) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 0",
                      borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 14, color: "#6B5540" }}>{r.name}</span>
                    <select
                      value={r.specialty}
                      onChange={(e) => updateRoom(r, e.target.value)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(168,154,135,0.5)",
                        background: "#FDFCFA",
                        fontSize: 13,
                        color: "#6B5540",
                        outline: "none",
                      }}
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          </div>

          {/* Datos en Excel */}
          <div style={cardStyle}>
            <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 18px" }}>
              Datos en Excel
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ExcelBox
                icon={Upload}
                title="Subir Excel para actualizar"
                body="Fase 7 esta pausada hasta recibir el archivo real."
                button="Subir Excel"
              />
              <ExcelBox
                icon={Download}
                title="Descargar respaldo completo"
                body="Exportacion pendiente de Fase 7."
                button="Descargar respaldo"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExcelBox({ icon: Icon, title, body, button }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1.5px dashed rgba(168,154,135,0.5)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Icon size={18} style={{ marginBottom: 12, color: "#8C6E50" }} />
      <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{title}</p>
      <p style={{ margin: 0, fontSize: 12, color: "#A89A87" }}>{body}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <button
          disabled
          style={{
            padding: "7px 16px",
            borderRadius: 999,
            background: "#8C6E50",
            color: "#F7F5F0",
            border: "none",
            fontSize: 13,
            opacity: 0.5,
            cursor: "not-allowed",
          }}
        >
          {button}
        </button>
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            background: "rgba(201,168,118,0.2)",
            color: "#8C6E50",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          Pausado
        </span>
      </div>
    </div>
  );
}
