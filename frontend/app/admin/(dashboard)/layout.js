"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/use-mobile";

const NAV_ITEMS = [
  { href: "/admin/agenda", label: "Agenda", enabled: true },
  { href: "/admin/gabinetes", label: "Gabinetes", enabled: true },
  { href: "/admin/clientes", label: "Clientes", enabled: true },
  { href: "/admin/crm", label: "CRM", enabled: true },
  { href: "/admin/reportes", label: "Reportes", enabled: true },
  { href: "/admin/personal", label: "Personal", enabled: true },
  { href: "/admin/configuracion", label: "Configuración", enabled: true },
  { href: "/admin/logs", label: "Logs", enabled: true, roles: ["superadmin", "dueno"] },
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

function Shell({ children }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const navItems = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  const navContent = (
    <>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {navItems.map((item) => {
          const active = item.enabled && pathname.startsWith(item.href);
          return (
            <NavItem key={item.label} item={item} active={active} isMobile={isMobile} />
          );
        })}
      </nav>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 10px",
          borderTop: "1px solid rgba(168,154,135,0.35)",
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
                flex: 1,
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
            </Link>
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
        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(58,47,38,0.4)",
            }}
          >
            <aside
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
                <button
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    width: 44,
                    height: 44,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#A89A87",
                    borderRadius: 8,
                  }}
                  aria-label="Cerrar menú"
                >
                  <X size={20} />
                </button>
              </div>
              {navContent}
            </aside>
          </div>
        )}

        {/* Main content */}
        <main style={{ flex: 1, overflowY: "auto", background: "var(--background, #FDFCFA)" }}>{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className="flex flex-col"
        style={{
          width: 190,
          flex: "0 0 190px",
          background: "#F7F5F0",
          borderRight: "1px solid rgba(168,154,135,0.35)",
          padding: "24px 12px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, padding: "0 10px 22px" }}>
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
        {navContent}
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}

function NavItem({ item, active, isMobile }) {
  const baseStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: isMobile ? "14px 16px" : "9px 12px",
    borderRadius: 8,
    fontSize: isMobile ? 15 : 13,
    textDecoration: "none",
    transition: "background 0.15s, color 0.15s",
    minHeight: isMobile ? 44 : "auto",
  };

  const dotStyle = {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  };

  if (!item.enabled) {
    return (
      <div style={{ ...baseStyle, color: "rgba(168,154,135,0.5)", cursor: "not-allowed" }}>
        <span style={{ ...dotStyle, border: "1px solid rgba(168,154,135,0.4)" }} />
        {item.label}
      </div>
    );
  }

  if (active) {
    return (
      <Link
        href={item.href}
        style={{
          ...baseStyle,
          background: "#8C6E50",
          color: "#F7F5F0",
          fontWeight: 500,
        }}
      >
        <span style={{ ...dotStyle, background: "#EBCDB5" }} />
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      style={{ ...baseStyle, color: "#6B5540" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(235,205,181,0.35)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ ...dotStyle, border: "1px solid #A89A87" }} />
      {item.label}
    </Link>
  );
}

export default function DashboardLayout({ children }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
