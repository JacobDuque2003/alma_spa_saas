"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Inbox,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { authFetch } from "@/lib/auth-client";
import { BirthdayToast } from "@/components/birthday-toast";
import { ToastProvider } from "@/components/toast-provider";

// `permission` / `roles` reflejan EXACTAMENTE el guard que ya aplica el
// backend en la ruta correspondiente. Ocultar un ítem aquí es solo UX: el
// servidor sigue bloqueando por su cuenta si alguien navega directo a la URL.
//   agenda        -> requirePermission('agenda')        en /appointments
//   clientes      -> requirePermission('clientes')      en /clients
//   crm           -> requirePermission('crm')           en /crm
//   reportes      -> requirePermission('reportes')      en /reports
//   personal      -> requireRole('superadmin','dueno')  en /users (no delegable)
//   configuracion -> requirePermission('configuracion') en /services, /rooms, /tenant/config
//   logs          -> requireRole('superadmin','dueno')  en /audit-log
const NAV_ITEMS = [
  { href: "/admin/agenda", label: "Agenda", enabled: true, permission: "agenda", icon: CalendarDays },
  { href: "/admin/clientes", label: "Clientes", enabled: true, permission: "clientes", icon: Users },
  { href: "/admin/crm", label: "Bandeja", enabled: true, permission: "crm", icon: Inbox },
  { href: "/admin/reportes", label: "Reportes", enabled: true, permission: "reportes", icon: BarChart3 },
  { href: "/admin/personal", label: "Equipo", enabled: true, roles: ["superadmin", "dueno"], icon: UserCog },
  { href: "/admin/configuracion", label: "Configuración", enabled: true, permission: "configuracion", icon: Settings },
  { href: "/admin/logs", label: "Registros", enabled: true, roles: ["superadmin", "dueno"], icon: ClipboardList },
];

function canSeeNavItem(item, user) {
  if (!user) return false;
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.permission && !user.permissions?.[item.permission]) return false;
  return true;
}

// Tiempo suficiente para leer el aviso completo sin que quede fijo en pantalla.
const OUT_OF_SCHEDULE_BANNER_MS = 8000;

const ROLE_LABELS = {
  superadmin: "Super Admin",
  dueno: "Dueña",
  admin: "Administradora",
  personal: "Terapeuta",
};

function getInitials(name) {
  if (!name) return "??";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function DrawerOverlay({ drawerOpen, onClose, navContent }) {
  const { shouldRender, phase } = useAnimatedMount(drawerOpen, 300);
  if (!shouldRender) return null;
  return (
    <div
      className={`alma-drawer-overlay alma-anim-${phase}`}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(58,47,38,0.4)" }}
    >
      <aside
        className={`alma-drawer alma-anim-${phase}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 280,
          height: "100%",
          background: "#F7F5F0",
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span className="font-heading" style={{ fontSize: 18, fontWeight: 600, letterSpacing: 2.5, color: "#6B5540" }}>ALMA</span>
            <span style={{ fontFamily: "var(--font-pinyon), 'Pinyon Script', cursive", fontSize: 16, color: "#C9A876" }}>Spa</span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "#A89A87", borderRadius: 8 }}
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>
        {navContent}
      </aside>
    </div>
  );
}

function OutOfScheduleBanner({ active }) {
  const { shouldRender, phase } = useAnimatedMount(active, 260);
  if (!shouldRender) return null;
  return (
    <div role="status" className={`alma-schedule-banner alma-anim-${phase}`}>
      {"Fuera de tu horario de acceso — puedes ver todo, pero no editar, crear ni eliminar hasta la próxima apertura."}
    </div>
  );
}

function Shell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState([]);
  const [introDone, setIntroDone] = useState(false);
  const [outOfSchedule, setOutOfSchedule] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const readOnlyNotifiedRef = useRef(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroDone(true), isMobile ? 2400 : 1400);
    return () => window.clearTimeout(timer);
  }, [isMobile]);


  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
    if (isMobile) setSidebarCollapsed(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile && pathname.startsWith("/admin/agenda")) {
      setSidebarCollapsed(true);
    }
  }, [isMobile, pathname]);

  // El banner es un aviso temporal, no un elemento fijo: se muestra unos
  // segundos y se va. Un intento de escritura bloqueado (kind "blocked")
  // siempre lo vuelve a mostrar, para que el usuario no se quede sin saber
  // por qué falló la acción. Las señales informativas de solo-lectura
  // (cualquier GET fuera de horario, incluido el polling del CRM) solo
  // avisan la primera vez de la sesión — si no, reaparecería cada 30s.
  useEffect(() => {
    let hideTimer;
    function onOutOfSchedule(event) {
      const { active, kind } = event.detail || {};
      if (!active) return;
      if (kind === "readOnly" && readOnlyNotifiedRef.current) return;
      if (kind === "readOnly") readOnlyNotifiedRef.current = true;

      setOutOfSchedule(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setOutOfSchedule(false), OUT_OF_SCHEDULE_BANNER_MS);
    }
    window.addEventListener("alma:out-of-schedule", onOutOfSchedule);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("alma:out-of-schedule", onOutOfSchedule);
    };
  }, []);

  // Cumpleaños próximos (7 días): alimenta el badge en Clientes y el toast diario.
  // 403 (personal sin permiso 'clientes') se ignora silenciosamente.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    authFetch("/clients/birthdays", { query: { days: 7 } })
      .then((rows) => { if (!cancelled) setUpcomingBirthdays(Array.isArray(rows) ? rows : []); })
      .catch(() => { /* sin permiso o error transitorio */ });
    return () => { cancelled = true; };
  }, [user, pathname]);

  const navItems = useMemo(() => NAV_ITEMS.filter((item) => canSeeNavItem(item, user)), [user]);

  // Si el usuario aterriza en una sección para la que no tiene permiso
  // (típicamente /admin/agenda, el destino por defecto tras el login), lo
  // llevamos a la primera que sí puede ver — evita dejarlo mirando el error
  // del backend sin salida. /admin/perfil no está en NAV_ITEMS a propósito:
  // no es una sección del menú y siempre debe seguir accesible.
  useEffect(() => {
    if (!user || navItems.length === 0) return;
    const current = NAV_ITEMS.find((item) => pathname.startsWith(item.href));
    if (current && !canSeeNavItem(current, user)) {
      router.replace(navItems[0].href);
    }
  }, [user, pathname, navItems, router]);

  const badgeCount = upcomingBirthdays.length;
  const nearBirthdays = upcomingBirthdays.filter((b) => b.daysUntil <= 1);

  if (loading || !introDone) {
    return (
      <div className="alma-loading-screen" aria-label="Cargando Alma Spa">
        <div className="alma-loading-orbit" aria-hidden="true">
          <span className="alma-loading-spark alma-loading-spark-a">{"\u2726"}</span>
          <span className="alma-loading-spark alma-loading-spark-b">{"\u2727"}</span>
          <span className="alma-loading-spark alma-loading-spark-c">{"\u2726"}</span>
          <div className="alma-loading-mark">
            <span className="alma-loading-petal">{"\u2736"}</span>
          </div>
        </div>
        <div className="alma-loading-brand">
          <span className="font-heading">ALMA</span>
          <span>Spa</span>
        </div>
        <p>{"Preparando tu espacio de bienestar\u2026"}</p>
      </div>
    );
  }

  // Cuenta sin permiso para ninguna sección: mostramos un mensaje claro en
  // vez del error crudo del backend de la sección que le haya tocado cargar.
  const mainContent = navItems.length === 0
    ? (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-medium text-foreground">Tu cuenta todavía no tiene secciones asignadas</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Pídele a la administración del spa que te habilite los permisos que necesitas para trabajar.
        </p>
      </div>
    )
    : children;

  const navContent = (
    <>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {navItems.map((item) => {
          const active = item.enabled && pathname.startsWith(item.href);
          const badge = item.href === "/admin/clientes" ? badgeCount : 0;
          return (
            <NavItem key={item.label} item={item} active={active} isMobile={isMobile} collapsed={sidebarCollapsed} badge={badge} />
          );
        })}
      </nav>

      {!isMobile && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
          aria-label={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
          style={{
            width: sidebarCollapsed ? 46 : "100%",
            height: sidebarCollapsed ? 42 : undefined,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: sidebarCollapsed ? 0 : 8,
            margin: sidebarCollapsed ? "0 auto 8px" : "0 0 8px",
            padding: "9px 12px",
            borderRadius: sidebarCollapsed ? 16 : 14,
            border: "1px solid rgba(168,154,135,0.35)",
            background: "#F7F5F0",
            color: "#8C6E50",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={16} /> Ocultar menú</>}
        </button>
      )}

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: sidebarCollapsed ? 0 : 8,
          padding: sidebarCollapsed ? "10px 0" : "10px 10px",
          borderTop: "1px solid rgba(168,154,135,0.35)",
          justifyContent: sidebarCollapsed ? "center" : "flex-start",
        }}
      >
        {user && (
          <>
            <Link
              href="/admin/perfil"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
                minWidth: 0,
                flex: sidebarCollapsed ? "0 0 auto" : 1,
              }}
              title="Mi perfil"
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "#C9A876",
                  color: "#F7F5F0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {getInitials(user.name)}
              </span>
              {!sidebarCollapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#6B5540",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user.name}
                </div>
                <div style={{ fontSize: 11, color: "#A89A87" }}>
                  {ROLE_LABELS[user.role] || user.role}
                </div>
              </div>
              )}
            </Link>
            {!sidebarCollapsed && (
            <button
              onClick={logout}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#A89A87",
                padding: 4,
                display: "inline-flex",
              }}
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
            )}
          </>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Mobile header */}
        <header
          style={{
            height: 56,
            flex: "0 0 56px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            background: "#F7F5F0",
            borderBottom: "1px solid rgba(168,154,135,0.35)",
            zIndex: 40,
          }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            style={{
              width: 44,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#6B5540",
              borderRadius: 8,
            }}
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>

          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span
              className="font-heading"
              style={{ fontSize: 16, fontWeight: 600, letterSpacing: 2, color: "#6B5540" }}
            >
              ALMA
            </span>
            <span
              style={{
                fontFamily: "var(--font-pinyon), 'Pinyon Script', cursive",
                fontSize: 14,
                color: "#C9A876",
              }}
            >
              Spa
            </span>
          </div>

          {user ? (
            <Link
              href="/admin/perfil"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "#C9A876",
                color: "#F7F5F0",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                textDecoration: "none",
              }}
              title="Mi perfil"
            >
              {getInitials(user.name)}
            </Link>
          ) : (
            <div style={{ width: 34 }} />
          )}
        </header>

        {/* Drawer overlay */}
        <DrawerOverlay drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} navContent={navContent} />

        {/* Main content */}
        <main style={{ flex: 1, overflowY: "auto", background: "var(--background, #FDFCFA)" }}>{mainContent}</main>
        <OutOfScheduleBanner active={outOfSchedule} />
        <BirthdayToast nearBirthdays={nearBirthdays} />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className="alma-nav-rail flex flex-col"
        style={{
          width: sidebarCollapsed ? 76 : 214,
          flex: `0 0 ${sidebarCollapsed ? 76 : 214}px`,
          padding: sidebarCollapsed ? "16px 10px" : "18px 14px 16px",
          transition: "width var(--motion-base) var(--ease-out-quart), flex-basis var(--motion-base) var(--ease-out-quart)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            gap: 10,
            padding: sidebarCollapsed ? "0 0 16px" : "0 2px 16px",
          }}
        >
          {!sidebarCollapsed ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 4,
                padding: "10px 12px",
                borderRadius: 18,
                background: "#F7F5F0",
                border: "1px solid rgba(168,154,135,0.28)",
                boxShadow: "0 12px 30px rgba(107,85,64,0.08)",
              }}
            >
              <span
                className="font-heading"
                style={{ fontSize: 18, fontWeight: 600, letterSpacing: 2.5, color: "#6B5540" }}
              >
                ALMA
              </span>
              <span
                style={{
                  fontFamily: "var(--font-pinyon), 'Pinyon Script', cursive",
                  fontSize: 16,
                  color: "#C9A876",
                }}
              >
                Spa
              </span>
            </div>
          ) : (
            <div
              className="font-heading"
              style={{
                width: 46,
                height: 46,
                borderRadius: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#F7F5F0",
                border: "1px solid rgba(168,154,135,0.28)",
                boxShadow: "0 12px 30px rgba(107,85,64,0.08)",
                color: "#6B5540",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 1.4,
              }}
            >
              A
            </div>
          )}
        </div>
        {navContent}
      </aside>

      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-background">{mainContent}</main>
      <OutOfScheduleBanner active={outOfSchedule} />
      <BirthdayToast nearBirthdays={nearBirthdays} />
    </div>
  );
}

function NavItem({ item, active, isMobile, collapsed = false, badge = 0 }) {
  const Icon = item.icon;
  const baseStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: collapsed && !isMobile ? "center" : "flex-start",
    gap: collapsed && !isMobile ? 0 : 10,
    padding: isMobile ? "14px 16px" : collapsed ? "12px 0" : "11px 13px",
    borderRadius: active ? 18 : 16,
    fontSize: isMobile ? 15 : 13,
    textDecoration: "none",
    transition: "background var(--motion-fast) var(--ease-out-quart), color var(--motion-fast) var(--ease-out-quart), border-radius var(--motion-fast) var(--ease-out-quart)",
    minHeight: isMobile ? 44 : 46,
    position: "relative",
  };

  if (!item.enabled) {
    return (
      <div style={{ ...baseStyle, color: "rgba(168,154,135,0.5)", cursor: "not-allowed" }}>
        {Icon && <Icon size={18} />}
        {!collapsed && item.label}
      </div>
    );
  }

  if (active) {
    return (
      <Link
        href={item.href}
        style={{
          ...baseStyle,
          background: "linear-gradient(135deg, #9A7958 0%, #7B6045 100%)",
          color: "#F7F5F0",
          fontWeight: 700,
          boxShadow: active ? "0 10px 22px rgba(107,85,64,0.16)" : "none",
        }}
        title={collapsed ? item.label : undefined}
      >
        {Icon && <Icon size={18} strokeWidth={2} />}
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
        {badge > 0 && <span className="alma-badge" style={collapsed ? { position: "absolute", top: 2, right: 3 } : undefined}>{badge}</span>}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      style={{ ...baseStyle, color: "#6B5540" }}
      title={collapsed ? item.label : undefined}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(235,205,181,0.38)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {Icon && <Icon size={18} strokeWidth={1.8} />}
      {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
      {badge > 0 && <span className="alma-badge" style={collapsed ? { position: "absolute", top: 2, right: 3 } : undefined}>{badge}</span>}
    </Link>
  );
}

export default function DashboardLayout({ children }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </AuthProvider>
  );
}
