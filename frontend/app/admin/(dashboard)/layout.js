"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/agenda", label: "Agenda", enabled: true },
  { href: "/admin/gabinetes", label: "Gabinetes", enabled: true },
  { href: "/admin/clientes", label: "Clientes", enabled: true },
  { href: "/admin/crm", label: "CRM", enabled: true },
  { href: "/admin/reportes", label: "Reportes", enabled: true },
  { href: "/admin/personal", label: "Personal", enabled: true },
  { href: "/admin/configuracion", label: "Configuración", enabled: true },
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className="flex flex-col"
        style={{
          width: 240,
          flex: "0 0 240px",
          background: "#F7F5F0",
          borderRight: "1px solid rgba(168,154,135,0.35)",
          padding: "28px 16px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 5, padding: "0 12px 28px" }}>
          <span
            className="font-heading"
            style={{ fontSize: 22, fontWeight: 600, letterSpacing: 3, color: "#6B5540" }}
          >
            ALMA
          </span>
          <span
            style={{
              fontFamily: "var(--font-pinyon), 'Pinyon Script', cursive",
              fontSize: 20,
              color: "#C9A876",
            }}
          >
            Spa
          </span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.enabled && pathname.startsWith(item.href);
            return (
              <NavItem key={item.label} item={item} active={active} />
            );
          })}
        </nav>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderTop: "1px solid rgba(168,154,135,0.35)",
          }}
        >
          {user && (
            <>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "#C9A876",
                  color: "#F7F5F0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {getInitials(user.name)}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
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
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}

function NavItem({ item, active }) {
  const baseStyle = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 14px",
    borderRadius: 8,
    fontSize: 15,
    textDecoration: "none",
    transition: "background 0.15s, color 0.15s",
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
