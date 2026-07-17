"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2, ShieldCheck } from "lucide-react";

const PLATFORM_SUPPORT_USER = {
  id: "platform-support",
  tenantId: null,
  email: "soporte@alma.local",
  name: "Soporte Alma",
  role: "superadmin",
  isProtected: true,
  active: true,
  canAttendAppointments: false,
  rolePermission: null,
};

const MODULES = [
  ["agenda", "Agenda", "Ver y gestionar citas"],
  ["gabinetes", "Gabinetes", "Estado en tiempo real y reservas por gabinete"],
  ["clientes", "Clientes", "Fichas, anamnesis e historial de tratamientos"],
  ["crm", "CRM", "Conversaciones de WhatsApp con clientas"],
  ["reportes", "Reportes", "Ingresos, ocupacion y desempeno"],
  ["configuracion", "Configuracion", "Servicios, precios, gabinetes y planes"],
];

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "US";
}
function roleLabel(role) {
  return ({ superadmin: "Cuenta de plataforma", dueno: "Duena", personal: "Terapeuta" })[role] || role;
}
function permissionsSummary(user) {
  const rp = user.rolePermission || {};
  if (user.role !== "personal") return "Acceso completo a todos los modulos";
  const enabled = MODULES.filter(([k]) => rp[k]).map(([, label]) => label);
  return enabled.length ? enabled.join(", ") : "Sin permisos activos";
}

export default function PersonalPage() {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await authFetch("/users");
      const visibleUsers = data.some((u) => u.isProtected) ? data : [PLATFORM_SUPPORT_USER, ...data];
      setUsers(visibleUsers);
      const editable =
        visibleUsers.find((u) => !u.isProtected && u.role === "personal") ||
        visibleUsers.find((u) => !u.isProtected) ||
        visibleUsers[0];
      setSelectedId((current) => current || editable?.id || null);
    } catch (err) {
      setError(err.message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const selected = useMemo(() => users.find((u) => u.id === selectedId), [users, selectedId]);

  useEffect(() => {
    setDraft(Object.fromEntries(MODULES.map(([k]) => [k, !!selected?.rolePermission?.[k]])));
  }, [selected]);

  async function savePermissions() {
    if (!selected || selected.isProtected || selected.role !== "personal") return;
    setSaving(true);
    try {
      await authFetch(`/users/${selected.id}/permissions`, { method: "PATCH", body: draft });
      await fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", gap: 24, overflow: "hidden" }}>
      {/* User list */}
      <div style={{ width: 420, flex: "0 0 420px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 className="font-heading" style={{ fontSize: 30, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
              Personal
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Cuentas del spa y permisos</p>
          </div>
          <button
            style={{
              padding: "9px 20px",
              borderRadius: 999,
              background: "#8C6E50",
              color: "#F7F5F0",
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Invitar cuenta
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : error && users.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{error}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1 }}>
            {users.map((user) => {
              const isSelected = user.id === selectedId;
              return (
                <button
                  key={user.id}
                  onClick={() => setSelectedId(user.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 18px",
                    borderRadius: 12,
                    border: `1px solid ${isSelected ? "rgba(235,205,181,0.7)" : "rgba(168,154,135,0.4)"}`,
                    background: isSelected ? "rgba(235,205,181,0.3)" : "#F7F5F0",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: "50%",
                      background: user.isProtected ? "#765A3F" : "#C9A876",
                      color: "#F7F5F0",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {user.isProtected ? <ShieldCheck size={16} /> : initials(user.name)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <b style={{ fontSize: 14, color: "#6B5540" }}>{user.name}</b>
                      <span
                        style={{
                          padding: "2px 10px",
                          borderRadius: 999,
                          background: user.isProtected ? "#6B5540" : "rgba(201,168,118,0.25)",
                          color: user.isProtected ? "#EBE8E1" : "#8C6E50",
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {roleLabel(user.role)}
                        {user.isProtected ? " · protegida" : ""}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: "3px 0 0",
                        fontSize: 12,
                        color: "#A89A87",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {user.isProtected
                        ? "Acceso tecnico del sistema"
                        : permissionsSummary(user)}
                    </p>
                  </div>
                  {!user.isProtected && (
                    <span style={{ fontSize: 12, color: "#8C6E50", textDecoration: "underline" }}>Editar</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail / permissions panel */}
      <div
        style={{
          flex: 1,
          background: "#F7F5F0",
          border: "1px solid rgba(168,154,135,0.4)",
          borderRadius: 12,
          padding: 28,
          minHeight: 580,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {selected ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: selected.isProtected ? "#765A3F" : "#C9A876",
                  color: "#F7F5F0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {selected.isProtected ? <ShieldCheck size={22} /> : initials(selected.name)}
              </span>
              <div>
                <h2 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                  Permisos de {selected.name}
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#A89A87" }}>
                  Rol: {roleLabel(selected.role)} · {selected.email}
                </p>
              </div>
            </div>

            {selected.isProtected ? (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(168,154,135,0.4)",
                  background: "rgba(235,232,225,0.5)",
                  padding: 24,
                  fontSize: 14,
                  color: "#A89A87",
                }}
              >
                <ShieldCheck size={22} style={{ marginBottom: 12, color: "#8C6E50" }} />
                <b style={{ display: "block", color: "#6B5540" }}>Cuenta de plataforma protegida</b>
                El backend bloquea edicion, eliminacion y cambios de permisos para esta cuenta. Este panel solo muestra el estado.
              </div>
            ) : selected.role !== "personal" ? (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(168,154,135,0.4)",
                  background: "rgba(235,232,225,0.5)",
                  padding: 24,
                  fontSize: 14,
                  color: "#A89A87",
                }}
              >
                <b style={{ display: "block", color: "#6B5540" }}>Acceso completo</b>
                Las cuentas duena/superadmin no usan permisos por modulo; el backend les concede acceso completo.
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#A89A87", margin: "0 0 20px" }}>
                  Activa solo lo que esta persona necesita para su trabajo. Los cambios aplican al instante.
                </p>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {MODULES.map(([key, label, desc], i) => (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        padding: "16px 0",
                        borderBottom: i < MODULES.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      <span>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{label}</span>
                        <span style={{ fontSize: 12, color: "#A89A87" }}>{desc}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={!!draft[key]}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
                        style={{ width: 40, height: 20, accentColor: "#8C6E50" }}
                      />
                    </label>
                  ))}
                </div>

                {error && (
                  <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>
                    {error}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
                  <button
                    onClick={() => setDraft(Object.fromEntries(MODULES.map(([k]) => [k, !!selected.rolePermission?.[k]])))}
                    style={{
                      padding: "9px 22px",
                      borderRadius: 999,
                      border: "1px solid rgba(168,154,135,0.5)",
                      background: "transparent",
                      color: "#6B5540",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={savePermissions}
                    disabled={saving}
                    style={{
                      padding: "9px 22px",
                      borderRadius: 999,
                      background: "#8C6E50",
                      color: "#F7F5F0",
                      border: "none",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: saving ? "wait" : "pointer",
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontSize: 14, color: "#A89A87" }}>
            Selecciona una cuenta.
          </div>
        )}
      </div>
    </div>
  );
}
