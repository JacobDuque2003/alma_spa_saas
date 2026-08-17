"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { BarChart3, CalendarDays, ClipboardList, Clock3, Inbox, Loader2, Settings, ShieldCheck, UserCog, Users, X, ArrowLeft, Pencil } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useToast } from "@/components/toast-provider";

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

const PERMISSION_GROUPS = [
  {
    title: "Agenda",
    description: "Reservas, cabinas y atención diaria",
    items: [
      ["agenda", "Ver y gestionar agenda", "Crear, mover y revisar reservas"],
      ["gabinetes", "Ver cabinas", "Estado en tiempo real y reservas por cabina"],
    ],
  },
  {
    title: "Clientes",
    description: "Directorio, ficha y datos sensibles",
    items: [
      ["clientes", "Ver clientas", "Directorio, ficha y datos generales"],
      ["clientesEditar", "Editar resumen", "Crear clientas y editar datos personales"],
      ["clientesAnamnesis", "Editar anamnesis", "Modificar antecedentes, consentimiento e indicaciones"],
      ["clientesHistorial", "Editar historial", "Agregar, editar o eliminar tratamientos y reservas"],
      ["clientesEstado", "Habilitar/deshabilitar", "Activar o pausar clientas"],
      ["clientesEliminar", "Eliminar clienta", "Eliminar clientas de forma completa cuando exista esa acción"],
      ["clientesPagos", "Movimientos de cuenta", "Registrar abonos, cargos, planes y saldos"],
      ["clientesExportar", "Exportar clientas", "Descargar el directorio en Excel"],
    ],
  },
  {
    title: "Bandeja",
    description: "Mensajes y recordatorios",
    items: [
      ["crm", "Conversaciones", "Bandeja de WhatsApp con clientas"],
    ],
  },
  {
    title: "Reportes",
    description: "Métricas del spa",
    items: [
      ["reportes", "Ver reportes", "Ingresos, ocupación y desempeño"],
    ],
  },
  {
    title: "Configuración",
    description: "Servicios, precios y horario",
    items: [
      ["configuracion", "Administrar configuración", "Servicios, precios, cabinas y horario del spa"],
    ],
  },
];

const MODULES = PERMISSION_GROUPS.flatMap((group) => group.items);

function roleLabel(role) {
  return ({ superadmin: "Cuenta de plataforma", dueno: "Dueña", personal: "Terapeuta" })[role] || role;
}
function roleIcon(user, size = 16) {
  if (user?.isProtected || user?.role === "superadmin") return <ShieldCheck size={size} />;
  if (user?.role === "dueno") return <UserCog size={size} />;
  return <Users size={size} />;
}
function groupIcon(title, size = 16) {
  const Icon = ({
    Agenda: CalendarDays,
    Clientes: Users,
    Bandeja: Inbox,
    Reportes: BarChart3,
    Equipo: UserCog,
    Configuración: Settings,
    Cuenta: ClipboardList,
  })[title] || ClipboardList;
  return <Icon size={size} />;
}
function permissionsSummary(user) {
  const rp = user.rolePermission || {};
  if (user.role !== "personal") return "Acceso completo a todas las secciones";
  const enabledGroups = PERMISSION_GROUPS
    .filter((group) => group.items.some(([k]) => rp[k]))
    .map((group) => group.title);
  const enabled = enabledGroups.length ? enabledGroups : MODULES.filter(([k]) => rp[k]).map(([, label]) => label);
  return enabled.length ? enabled.join(", ") : "Sin permisos activos";
}

function PermissionGroupList({ value, onChange, compact = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))", gap: compact ? 10 : 12 }}>
      {PERMISSION_GROUPS.map((group) => {
        const enabledCount = group.items.filter(([key]) => !!value[key]).length;
        return (
          <section
            key={group.title}
            style={{
              border: "1px solid rgba(168,154,135,0.28)",
              borderRadius: compact ? 12 : 16,
              background: "linear-gradient(135deg, rgba(253,252,250,0.92), rgba(247,245,240,0.78))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: compact ? "10px 12px" : "13px 16px",
                borderBottom: "1px solid rgba(168,154,135,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(140,110,80,0.10)", color: "#8C6E50", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {groupIcon(group.title, 15)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: compact ? 13 : 14, fontWeight: 800, color: "#6B5540" }}>
                    {group.title}
                  </span>
                  {!compact && (
                    <span style={{ display: "block", fontSize: 11, color: "#A89A87", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {group.description}
                    </span>
                  )}
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  borderRadius: 999,
                  padding: "3px 9px",
                  background: enabledCount ? "rgba(85,107,47,0.12)" : "rgba(168,154,135,0.14)",
                  color: enabledCount ? "#556B2F" : "#A89A87",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {enabledCount}/{group.items.length}
              </span>
            </div>
            <div style={{ padding: compact ? "4px 12px" : "6px 16px" }}>
              {group.items.map(([key, label, desc], i) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    padding: compact ? "9px 0" : "12px 0",
                    borderBottom: i < group.items.length - 1 ? "1px solid rgba(168,154,135,0.16)" : "none",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#6B5540" }}>{label}</span>
                    {!compact && <span style={{ fontSize: 11, color: "#A89A87" }}>{desc}</span>}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 42,
                      height: 24,
                      borderRadius: 999,
                      padding: 3,
                      background: value[key] ? "#8C6E50" : "rgba(168,154,135,0.25)",
                      border: value[key] ? "1px solid #8C6E50" : "1px solid rgba(168,154,135,0.35)",
                      transition: "background var(--motion-fast) var(--ease-out-quart)",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "#FDFCFA",
                        transform: value[key] ? "translateX(18px)" : "translateX(0)",
                        transition: "transform var(--motion-fast) var(--ease-spring)",
                        boxShadow: "0 2px 6px rgba(58,47,38,0.18)",
                      }}
                    />
                  </span>
                  <input
                    type="checkbox"
                    checked={!!value[key]}
                    onChange={(e) => onChange(key, e.target.checked)}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                  />
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
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

function NewUserModal({ phase, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("personal");
  const [permissions, setPermissions] = useState(
    Object.fromEntries(MODULES.map(([k]) => [k, false]))
  );
  const [canAttendAppointments, setCanAttendAppointments] = useState(false);
  // Guardrail AppSec: al crear una cuenta personal se prellena el horario con
  // el del spa. Es una decisión explícita — checkbox ON por default. Si se
  // desactiva, el schedule queda null y la lista de Personal marca la fila
  // con el badge "Sin horario · 24/7" hasta que se configure.
  const [applyBusinessHours, setApplyBusinessHours] = useState(true);
  const [businessHours, setBusinessHours] = useState(null);
  const [workDays, setWorkDays] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState("");
  const toast = useToast();

  useEffect(() => {
    authFetch("/tenant/config").then((cfg) => {
      setBusinessHours(cfg?.businessHours || null);
      setWorkDays(Array.isArray(cfg?.workDays) ? cfg.workDays : null);
    }).catch(() => {});
  }, []);

  function buildDefaultSchedule() {
    if (!applyBusinessHours || role !== "personal" || !businessHours) return undefined;
    const bh = businessHours;
    const start = bh.morning?.start || bh.start || "09:00";
    const end = bh.afternoon?.end || bh.end || "19:00";
    const isoWorkDays = new Set(Array.isArray(workDays) ? workDays : [1, 2, 3, 4, 5, 6]);
    const isoToName = { 1: "monday", 2: "tuesday", 3: "wednesday", 4: "thursday", 5: "friday", 6: "saturday", 7: "sunday" };
    const s = { alwaysAllowed: false };
    for (let iso = 1; iso <= 7; iso += 1) {
      const name = isoToName[iso];
      s[name] = isoWorkDays.has(iso) ? { start, end } : null;
    }
    return s;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setValidation("Nombre, email y contraseña son requeridos");
      return;
    }
    if (password.length < 8) {
      setValidation("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setSaving(true);
    setValidation("");
    try {
      const accessSchedule = buildDefaultSchedule();
      const created = await authFetch("/users", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          canAttendAppointments,
          permissions: role === "personal" ? permissions : undefined,
          ...(accessSchedule !== undefined ? { accessSchedule } : {}),
        },
      });
      toast.success(`${created.name} agregado`);
      onSaved(created);
    } catch (err) {
      toast.error(err.message || "Error al crear la cuenta");
      setSaving(false);
    }
  }

  return (
    <div
      className={`alma-backdrop alma-anim-${phase}`}
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
        className={`alma-card alma-modal alma-anim-${phase}`}
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
            <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="m?nimo 8 caracteres" />
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

          {role === "personal" && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", background: "rgba(201,168,118,0.08)", borderRadius: 10 }}>
              <input
                type="checkbox"
                checked={applyBusinessHours}
                onChange={(e) => setApplyBusinessHours(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: "#8C6E50", flexShrink: 0, marginTop: 2 }}
              />
              <span style={{ fontSize: 13, color: "#6B5540", lineHeight: 1.4 }}>
                Aplicar horario del spa como restricción de acceso
                <span style={{ display: "block", fontSize: 11, color: "#A89A87", marginTop: 2 }}>
                  Se puede ajustar por día después desde la ficha de la cuenta.
                </span>
              </span>
            </label>
          )}

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
              <PermissionGroupList
                compact
                value={permissions}
                onChange={(key, checked) => setPermissions((p) => ({ ...p, [key]: checked }))}
              />
            </div>
          )}

          {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}

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
  const [loadError, setLoadError] = useState("");
  const [showNewUser, setShowNewUser] = useState(false);
  const [toggling, setToggling] = useState(null);
  const isMobile = useIsMobile();
  const toast = useToast();
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const newUserAnim = useAnimatedMount(showNewUser, 220);
  const mobileDetailAnim = useAnimatedMount(isMobile && mobileShowDetail, 220);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
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
      setLoadError(err.message);
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
    try {
      const updated = await authFetch(`/users/${user.id}`, {
        method: "PATCH",
        body: { active: !user.active },
      });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
      toast.success(updated.active ? `${updated.name} activada` : `${updated.name} desactivada`);
    } catch (err) {
      toast.error(err.message || "No se pudo cambiar el estado");
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
      setUsers((prev) => prev.map((u) => (u.id === selected.id ? { ...u, rolePermission: { ...u.rolePermission, ...draft } } : u)));
      toast.success("Permisos guardados");
    } catch (err) {
      toast.error(err.message || "Error al guardar permisos");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "28px 32px", display: "flex", gap: isMobile ? 0 : 24, overflow: "hidden" }}>
      {/* User list */}
      {(!isMobile || !mobileShowDetail) && (
      <div style={{ width: isMobile ? "100%" : 420, flex: isMobile ? "1" : "0 0 420px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>
              Equipo
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Roles, accesos y permisos del equipo</p>
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
        ) : loadError && users.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{loadError}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1 }}>
            {users.map((user) => {
              const isSelected = user.id === selectedId;
              return (
                <div
                  key={user.id}
                  onClick={() => { setSelectedId(user.id); if (isMobile) setMobileShowDetail(true); }}
                  className="alma-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(user.id); if (isMobile) setMobileShowDetail(true); } }}
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
                    {roleIcon(user, 17)}
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
                        ? "Acceso técnico del sistema"
                        : permissionsSummary(user)}
                    </p>
                  </div>
                  {!user.isProtected && user.role === "personal" && user.accessSchedule == null && (
                    <span
                      title="Sin horario configurado — acceso 24/7"
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: "rgba(201,168,118,0.28)",
                        color: "#856330",
                        border: "1px solid rgba(201,168,118,0.55)",
                        fontSize: 10,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      Sin horario · 24/7
                    </span>
                  )}
                  {!user.isProtected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleActive(user); }}
                        disabled={toggling === user.id}
                        title={user.active ? "Desactivar cuenta" : "Activar cuenta"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid",
                          borderColor: user.active ? "rgba(85,107,47,0.4)" : "rgba(194,84,80,0.4)",
                          background: user.active ? "rgba(85,107,47,0.14)" : "rgba(194,84,80,0.10)",
                          color: user.active ? "#556B2F" : "#B85A56",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: toggling === user.id ? "wait" : "pointer",
                          opacity: toggling === user.id ? 0.5 : 1,
                          transition: "background var(--motion-fast) var(--ease-out-quart), color var(--motion-fast) var(--ease-out-quart), border-color var(--motion-fast) var(--ease-out-quart)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: user.active ? "#556B2F" : "#B85A56",
                          }}
                        />
                        {user.active ? "Activa" : "Inactiva"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(user.id); if (isMobile) setMobileShowDetail(true); }}
                        title="Editar cuenta"
                        aria-label="Editar cuenta"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 30,
                          height: 30,
                          padding: 0,
                          borderRadius: "50%",
                          border: "1px solid rgba(168,154,135,0.5)",
                          background: "transparent",
                          color: "#8C6E50",
                          cursor: "pointer",
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Detail / permissions panel */}
      {(!isMobile || mobileDetailAnim.shouldRender) && (
      <div
        key={isMobile ? undefined : selectedId}
        className={`alma-card${isMobile ? ` alma-slide-right alma-anim-${mobileDetailAnim.phase}` : " alma-stagger"}`}
        style={{
          flex: 1,
          padding: isMobile ? 20 : 28,
          minHeight: isMobile ? 0 : 580,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {selected ? (
          <>
            {isMobile && (
              <button
                onClick={() => setMobileShowDetail(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 0",
                  marginBottom: 12,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#8C6E50",
                  fontSize: 14,
                  fontWeight: 500,
                  minHeight: 44,
                }}
              >
                <ArrowLeft size={18} />
                Equipo
              </button>
            )}
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
                {roleIcon(selected, 22)}
              </span>
              <div>
                <h2 className="font-heading" style={{ fontSize: 24, fontWeight: 600, color: "#6B5540", margin: 0 }}>
                  Permisos de cuenta
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#A89A87" }}>
                  {selected.name} · Rol: {roleLabel(selected.role)} · {selected.email}
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
                El backend bloquea edición, eliminación y cambios de permisos para esta cuenta. Este panel solo muestra el estado.
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
                Las cuentas Dueña/Super Admin no usan permisos por módulo; el backend les concede acceso completo.
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#A89A87", margin: "0 0 20px" }}>
                  Activa solo lo que esta persona necesita para su trabajo. Los cambios aplican al instante.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.25fr) minmax(320px, 0.75fr)", gap: 18, alignItems: "start" }}>
                  <PermissionGroupList
                    value={draft}
                    onChange={(key, checked) => setDraft((d) => ({ ...d, [key]: checked }))}
                  />
                  <AccessScheduleEditor
                    compact
                    user={selected}
                    onSaved={(updated) => setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, accessSchedule: updated.accessSchedule } : u)))}
                  />
                </div>

                {loadError && (
                  <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>
                    {loadError}
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
      )}

      {newUserAnim.shouldRender && (
        <NewUserModal
          phase={newUserAnim.phase}
          onClose={() => setShowNewUser(false)}
          onSaved={(created) => {
            setShowNewUser(false);
            setUsers((prev) => [...prev, created]);
          }}
        />
      )}
    </div>
  );
}

// -- Access Schedule Editor ---------------------------------------------------

const SCHEDULE_DAYS = [
  ["monday", "Lunes"],
  ["tuesday", "Martes"],
  ["wednesday", "Miércoles"],
  ["thursday", "Jueves"],
  ["friday", "Viernes"],
  ["saturday", "Sábado"],
  ["sunday", "Domingo"],
];

function emptyScheduleShape() {
  const s = { alwaysAllowed: false };
  for (const [k] of SCHEDULE_DAYS) s[k] = null;
  return s;
}

function initialDraftFromUser(user) {
  const s = user?.accessSchedule;
  if (!s) return emptyScheduleShape();
  const draft = { alwaysAllowed: !!s.alwaysAllowed };
  for (const [k] of SCHEDULE_DAYS) draft[k] = s[k] || null;
  return draft;
}

function AccessScheduleEditor({ user, onSaved, compact = false }) {
  const toast = useToast();
  const accessSchedule = user?.accessSchedule;
  const [draft, setDraft] = useState(() => initialDraftFromUser(user));
  const [saving, setSaving] = useState(false);
  const [businessHours, setBusinessHours] = useState(null);
  const [workDays, setWorkDays] = useState(null);

  useEffect(() => { setDraft(initialDraftFromUser({ accessSchedule })); }, [user?.id, accessSchedule]);

  useEffect(() => {
    authFetch("/tenant/config").then((cfg) => {
      setBusinessHours(cfg?.businessHours || null);
      setWorkDays(Array.isArray(cfg?.workDays) ? cfg.workDays : null);
    }).catch(() => {});
  }, []);

  function toggleDay(day) {
    setDraft((d) => ({
      ...d,
      [day]: d[day] ? null : { start: "09:00", end: "18:00" },
    }));
  }

  function updateDay(day, field, value) {
    setDraft((d) => ({
      ...d,
      [day]: d[day] ? { ...d[day], [field]: value } : { start: "09:00", end: "18:00", [field]: value },
    }));
  }

  function fillFromBusinessHours() {
    if (!businessHours) return;
    const bh = businessHours;
    const start = bh.morning?.start || bh.start || "09:00";
    const end = bh.afternoon?.end || bh.end || "19:00";
    const isoWorkDays = new Set(Array.isArray(workDays) ? workDays : [1, 2, 3, 4, 5, 6]);
    const isoToName = { 1: "monday", 2: "tuesday", 3: "wednesday", 4: "thursday", 5: "friday", 6: "saturday", 7: "sunday" };
    const next = { alwaysAllowed: false };
    for (let iso = 1; iso <= 7; iso += 1) {
      const name = isoToName[iso];
      next[name] = isoWorkDays.has(iso) ? { start, end } : null;
    }
    setDraft(next);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = draft.alwaysAllowed
        ? { alwaysAllowed: true }
        : draft;
      const updated = await authFetch(`/users/${user.id}`, { method: "PATCH", body: { accessSchedule: payload } });
      toast.success("Horario de acceso guardado");
      if (onSaved) onSaved(updated);
    } catch (err) {
      toast.error(err?.message || "No se pudo guardar el horario");
    } finally {
      setSaving(false);
    }
  }

  async function clearSchedule() {
    setSaving(true);
    try {
      const updated = await authFetch(`/users/${user.id}`, { method: "PATCH", body: { accessSchedule: null } });
      toast.info("Horario removido — acceso 24/7 con badge en la lista");
      if (onSaved) onSaved(updated);
    } catch (err) {
      toast.error(err?.message || "No se pudo actualizar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        marginTop: compact ? 0 : 32,
        padding: compact ? 16 : "24px 0 0",
        borderTop: compact ? "none" : "1px solid rgba(168,154,135,0.35)",
        border: compact ? "1px solid rgba(168,154,135,0.28)" : undefined,
        borderRadius: compact ? 16 : undefined,
        background: compact ? "linear-gradient(135deg, rgba(253,252,250,0.92), rgba(247,245,240,0.78))" : undefined,
        boxShadow: compact ? "0 14px 28px rgba(107,85,64,0.06)" : undefined,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <h3 className="font-heading" style={{ fontSize: compact ? 17 : 18, fontWeight: 600, color: "#6B5540", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
          <Clock3 size={16} />
          Horario de acceso
        </h3>
        <p style={{ margin: 0, fontSize: compact ? 12 : 13, color: "#A89A87" }}>
          Restringe a qué horas puede iniciar sesión esta cuenta. Se aplica en cada request usando la zona horaria del spa.
        </p>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={draft.alwaysAllowed}
          onChange={(e) => setDraft((d) => ({ ...d, alwaysAllowed: e.target.checked }))}
          style={{ width: 18, height: 18, accentColor: "#8C6E50" }}
        />
        <span style={{ fontSize: 13, color: "#6B5540" }}>Acceso 24/7 (sin restricción horaria)</span>
      </label>

      {!draft.alwaysAllowed && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              type="button"
              onClick={fillFromBusinessHours}
              disabled={!businessHours}
              style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: "transparent", color: "#8C6E50", fontSize: 11, cursor: businessHours ? "pointer" : "not-allowed", opacity: businessHours ? 1 : 0.5 }}
            >
              Usar horario del spa
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
            {SCHEDULE_DAYS.map(([key, label]) => {
              const win = draft[key];
              const open = !!win;
              return (
                <div key={key} style={{ display: "flex", alignItems: compact ? "flex-start" : "center", gap: compact ? 8 : 12, flexDirection: compact ? "column" : "row" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, width: compact ? "auto" : 110, cursor: "pointer" }}>
                    <input type="checkbox" checked={open} onChange={() => toggleDay(key)} style={{ width: 16, height: 16, accentColor: "#8C6E50" }} />
                    <span style={{ fontSize: 13, color: open ? "#6B5540" : "#A89A87" }}>{label}</span>
                  </label>
                  {open ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, width: compact ? "100%" : undefined }}>
                      <input type="time" value={win.start} onChange={(e) => updateDay(key, "start", e.target.value)} style={{ padding: "6px 10px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 13, color: "#6B5540", background: "#FDFCFA", outline: "none" }} />
                      <span style={{ fontSize: 12, color: "#A89A87" }}>a</span>
                      <input type="time" value={win.end} onChange={(e) => updateDay(key, "end", e.target.value)} style={{ padding: "6px 10px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 13, color: "#6B5540", background: "#FDFCFA", outline: "none" }} />
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "#A89A87", fontStyle: "italic" }}>Cerrado</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button
          onClick={clearSchedule}
          disabled={saving}
          style={{ padding: "9px 18px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: "transparent", color: "#856330", fontSize: 12, cursor: saving ? "wait" : "pointer" }}
        >
          Remover horario (acceso 24/7)
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{ padding: "9px 22px", borderRadius: 999, background: "#8C6E50", color: "#F7F5F0", border: "none", fontSize: 13, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Guardando…" : "Guardar horario"}
        </button>
      </div>
    </div>
  );
}
