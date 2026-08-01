"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAnimatedMount } from "@/lib/use-animated-mount";

const STORAGE_KEY = "alma:birthdayToastShown";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Shown once per calendar day when there's at least one client with birthday today.
// Dismissal or auto-close writes today's date to localStorage; next check
// against the same date is a no-op.
export function BirthdayToast({ todaysBirthdays }) {
  const [open, setOpen] = useState(false);
  const anim = useAnimatedMount(open, 220);

  useEffect(() => {
    if (!todaysBirthdays || todaysBirthdays.length === 0) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === todayKey()) return;
    } catch { /* private mode etc — proceed anyway */ }
    setOpen(true);
    const t = setTimeout(() => close(), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaysBirthdays]);

  function close() {
    try { localStorage.setItem(STORAGE_KEY, todayKey()); } catch { /* noop */ }
    setOpen(false);
  }

  if (!anim.shouldRender || !todaysBirthdays || todaysBirthdays.length === 0) return null;

  const first = todaysBirthdays[0];
  const more = todaysBirthdays.length - 1;
  const message = more > 0
    ? `🎉 ${first.fullName} cumple años hoy — y ${more} más`
    : `🎉 ${first.fullName} cumple años hoy`;

  return (
    <div
      className={`alma-toast alma-anim-${anim.phase}`}
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 70,
        background: "#F7F5F0",
        border: "1px solid rgba(201,168,118,0.5)",
        borderRadius: 12,
        padding: "12px 16px",
        boxShadow: "0 12px 32px rgba(107,85,64,0.18)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 380,
      }}
    >
      <Link
        href="/admin/clientes"
        onClick={close}
        style={{ fontSize: 13, color: "#6B5540", fontWeight: 500, textDecoration: "none", flex: 1 }}
      >
        {message}
      </Link>
      <button
        onClick={close}
        aria-label="Cerrar"
        style={{ background: "none", border: "none", cursor: "pointer", color: "#A89A87", padding: 4, display: "inline-flex" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
