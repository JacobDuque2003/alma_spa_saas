"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CalendarDays,
  LayoutGrid,
  Users,
  MessageSquare,
  BarChart3,
  UserCog,
  Settings,
  LogOut,
  Loader2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays, enabled: true },
  { href: "/admin/gabinetes", label: "Gabinetes", icon: LayoutGrid, enabled: true },
  { href: "#", label: "Clientes", icon: Users, enabled: false },
  { href: "#", label: "CRM", icon: MessageSquare, enabled: false },
  { href: "#", label: "Reportes", icon: BarChart3, enabled: false },
  { href: "#", label: "Personal", icon: UserCog, enabled: false },
  { href: "#", label: "Configuración", icon: Settings, enabled: false },
];

const ROLE_LABELS = {
  superadmin: "Super Admin",
  dueno: "Dueño",
  admin: "Administrador",
  personal: "Personal",
};

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
      <aside className="w-60 flex-shrink-0 flex flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)]">
        <div className="p-5">
          <span className="text-xl font-heading font-bold tracking-tight text-[var(--sidebar-primary)]">
            ALMA
          </span>
          <span className="ml-1 text-xs text-[var(--sidebar-foreground)]/60">Panel</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map((item, i) => {
            const Icon = item.icon;
            const active = item.enabled && pathname.startsWith(item.href);

            if (i === 2) {
              return (
                <div key="sep">
                  <Separator className="my-3 bg-[var(--sidebar-border)]" />
                  <NavItem item={item} Icon={Icon} active={false} />
                </div>
              );
            }

            return (
              <NavItem key={item.label} item={item} Icon={Icon} active={active} />
            );
          })}
        </nav>

        <div className="p-4 border-t border-[var(--sidebar-border)]">
          {user && (
            <div className="mb-3">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-[var(--sidebar-foreground)]/60">
                {ROLE_LABELS[user.role] || user.role}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[var(--sidebar-foreground)]/80 hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]"
            onClick={logout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}

function NavItem({ item, Icon, active }) {
  const base =
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors";
  const activeClass = "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]";
  const inactiveClass = "text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]";
  const disabledClass = "text-[var(--sidebar-foreground)]/30 cursor-not-allowed";

  if (!item.enabled) {
    return (
      <div className={`${base} ${disabledClass}`}>
        <Icon className="h-4 w-4" />
        {item.label}
      </div>
    );
  }

  return (
    <Link href={item.href} className={`${base} ${active ? activeClass : inactiveClass}`}>
      <Icon className="h-4 w-4" />
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
