"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { authFetch } from "@/lib/auth-client";
import { BirthdayToast } from "@/components/birthday-toast";
import { ToastProvider } from "@/components/toast-provider";

const NAV_ITEMS = [
  { href: "/admin/agenda", label: "Agenda", enabled: true, icon: CalendarDays },
  { href: "/admin/clientes", label: "Clientes", enabled: true, icon: Users },
  { href: "/admin/crm", label: "Bandeja", enabled: true, icon: Inbox },
  { href: "/admin/reportes", label: "Reportes", enabled: true, icon: BarChart3 },
  { href: "/admin/personal", label: "Equipo", enabled: true, icon: UserCog },
  { href: "/admin/configuracion", label: "Configuración", enabled: true, icon: Settings },
  { href: "/admin/logs", label: "Registros", enabled: true, roles: ["superadmin", "dueno"], icon: ClipboardList },
];

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
  if (!active) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 65,
        maxWidth: "calc(100vw - 28px)",
        borderRadius: 999,
        border: "1px solid rgba(201,168,118,0.45)",
        background: "#FFF8E8",
        color: "#6B5540",
        boxShadow: "0 14px 32px rgba(107,85,64,0.16)",
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        textAlign: "center",
      }}
    >
      {"Fuera de horario de acceso: modo solo lectura"}
    </div>
  );
}

function Shell({ children }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState([]);
  const [introDone, setIntroDone] = useState(false);
  const [outOfSchedule, setOutOfSchedule] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  useEffect(() => {
    function onOutOfSchedule(event) {
      setOutOfSchedule(!!event.detail?.active);
    }
    window.addEventListener("alma:out-of-schedule", onOutOfSchedule);
    return () => window.removeEventListener("alma:out-of-schedule", onOutOfSchedule);
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

  const navItems = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

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
        <main style={{ flex: 1, overflowY: "auto", background: "var(--background, #FDFCFA)" }}>{children}</main>
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
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title="Ocultar menú"
              aria-label="Ocultar menú"
              style={{
                width: 38,
                height: 38,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                border: "1px solid rgba(168,154,135,0.35)",
                background: "#F7F5F0",
                color: "#8C6E50",
                cursor: "pointer",
              }}
            >
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            title="Mostrar menú"
            aria-label="Mostrar menú"
            style={{
              width: 46,
              height: 42,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              border: "1px solid rgba(168,154,135,0.35)",
              background: "#F7F5F0",
              color: "#8C6E50",
              cursor: "pointer",
              margin: "0 auto 14px",
            }}
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        {navContent}
      </aside>

      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-background">{children}</main>
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
