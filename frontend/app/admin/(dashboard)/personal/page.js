"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2, ShieldCheck, X, ToggleLeft, ToggleRight } from "lucide-react";

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
  if (user.role !== "personal") return "Acceso completo a todas las secciones";
  const enabled = MODULES.filter(([k]) => rp[k]).map(([, label]) => label);
  return enabled.length ? enabled.join(", ") : "Sin permisos activos";
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
  boxSizing: "border-box",
};
const labelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 };
const pillPrimary = { padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 };
const pillSecondary = { padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 };

function NewUserModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("personal");
  const [permissions, setPermissions] = useState(
    Object.fromEntries(MODULES.map(([k]) => [k, false]))
  );
  const [canAttendAppointments, setCanAttendAppointments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setError("Nombre, email y contraseña son requeridos");
      return;
    }
    if (password.length < 10) {
      setError("La contraseña debe tener al menos 10 caracteres");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await authFetch("/users", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          canAttendAppointments,
          permissions: role === "personal" ? permissions : undefined,
        },
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Error al crear la cuenta");
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
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
        onClick={(e) => e.stopPropagation()}
        className="alma-card"
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "90vh",
          overflowY: "auto",
          margin: "0 16px",
          borderRadius: 16,
          padding: "24px 24px 20px",
          position: "relative",
          boxShadow: "0 24px 64px rgba(107,85,64,0.18)",
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}
        >
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>
          Agregar usuario
        </h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Nombre</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
          </div>
          <div>
            <label style={labelStyle}>Contraseña</label>
            <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 10 caracteres" />
          </div>
          <div>
            <label style={labelStyle}>Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
            >
              <option value="personal">Terapeuta</option>
              <option value="dueno">Dueña</option>
            </select>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={canAttendAppointments}
              onChange={(e) => setCanAttendAppointments(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "#8C6E50" }}
            />
            <span style={{ fontSize: 13, color: "#6B5540" }}>Puede atender citas</span>
          </label>

          {role === "personal" && (
            <div>
              <label style={{ ...labelStyle, marginBottom: 8 }}>Permisos por módulo</label>
              <div
                style={{
                  border: "1px solid rgba(168,154,135,0.4)",
                  borderRadius: 8,
                  padding: "4px 14px",
                }}
              >
                {MODULES.map(([key, label], i) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 0",
                      borderBottom: i < MODULES.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#6B5540" }}>{label}</span>
                    <input
                      type="checkbox"
                      checked={!!permissions[key]}
                      onChange={(e) => setPermissions((p) => ({ ...p, [key]: e.target.checked }))}
                      style={{ width: 18, height: 18, accentColor: "#8C6E50" }}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={pillSecondary}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creando…" : "Crear cuenta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PersonalPage() {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showNewUser, setShowNewUser] = useState(false);
  const [toggling, setToggling] = useState(null);

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

  async function toggleActive(user) {
    if (user.isProtected) return;
    setToggling(user.id);
    setError("");
    try {
      await authFetch(`/users/${user.id}`, {
        method: "PATCH",
        body: { active: !user.active },
      });
      await fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(null);
    }
  }

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
            <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
              Personal
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Cuentas del spa y permisos</p>
          </div>
          <button
            onClick={() => setShowNewUser(true)}
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
            + Agregar usuario
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
                <div
                  key={user.id}
                  onClick={() => setSelectedId(user.id)}
                  className="alma-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(user.id); } }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 18px",
                    border: isSelected ? "1px solid rgba(235,205,181,0.7)" : undefined,
                    background: isSelected ? "rgba(235,205,181,0.3)" : undefined,
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
                  {!user.isProtected && !user.active && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(194,84,80,0.12)",
                        color: "#C25450",
                        fontSize: 10,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      Inactiva
                    </span>
                  )}
                  {!user.isProtected && (
                    <button
                      title={user.active ? "Desactivar cuenta" : "Activar cuenta"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActive(user);
                      }}
                      disabled={toggling === user.id}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: toggling === user.id ? "wait" : "pointer",
                        padding: 4,
                        flexShrink: 0,
                        color: user.active ? "#8C6E50" : "#A89A87",
                        opacity: toggling === user.id ? 0.5 : 1,
                      }}
                    >
                      {user.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail / permissions panel */}
      <div
        className="alma-card"
        style={{
          flex: 1,
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

      {showNewUser && (
        <NewUserModal
          onClose={() => setShowNewUser(false)}
          onSaved={() => {
            setShowNewUser(false);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}
