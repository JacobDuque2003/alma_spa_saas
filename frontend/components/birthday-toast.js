"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAnimatedMount } from "@/lib/use-animated-mount";

// sessionStorage se limpia cuando la pestaña se cierra → cada nuevo tab
// muestra el toast. logout() (auth-client.js) también hace removeItem
// explícito, así que un logout + login dentro de la misma pestaña
// también vuelve a mostrar.
const STORAGE_KEY = "alma:birthdayToastShown";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMessage(items) {
  const today = items.filter((b) => b.daysUntil === 0);
  const tomorrow = items.filter((b) => b.daysUntil === 1);
  if (today.length === 1 && tomorrow.length === 0) return `🎉 ${today[0].fullName} cumple años hoy`;
  if (today.length === 0 && tomorrow.length === 1) return `🎂 ${tomorrow[0].fullName} cumple años mañana`;
  if (today.length > 0 && tomorrow.length === 0) return `🎉 ${today[0].fullName} y ${today.length - 1} más cumplen hoy`;
  if (today.length === 0 && tomorrow.length > 0) return `🎂 ${tomorrow[0].fullName} y ${tomorrow.length - 1} más cumplen mañana`;
  const total = today.length + tomorrow.length;
  return `🎉 ${total} cumpleaños próximos (hoy y mañana)`;
}

// Muestra el toast una vez por sesión de navegador cuando hay clientes
// con cumpleaños hoy o mañana. Dismissal/auto-close escribe la fecha
// de hoy a sessionStorage.
export function BirthdayToast({ nearBirthdays }) {
  const [open, setOpen] = useState(false);
  const anim = useAnimatedMount(open, 220);

  useEffect(() => {
    if (!nearBirthdays || nearBirthdays.length === 0) return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === todayKey()) return;
    } catch { /* private mode etc — proceed anyway */ }
    setOpen(true);
    const t = setTimeout(() => close(), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearBirthdays]);

  function close() {
    try { sessionStorage.setItem(STORAGE_KEY, todayKey()); } catch { /* noop */ }
    setOpen(false);
  }

  if (!anim.shouldRender || !nearBirthdays || nearBirthdays.length === 0) return null;

  return (
    <div
      className={`alma-toast alma-anim-${anim.phase}`}
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 9998,
        background: "#8C6E50",
        border: "1px solid #6B5540",
        borderRadius: 12,
        padding: "14px 18px",
        boxShadow: "0 16px 40px rgba(58,47,38,0.28)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 420,
      }}
    >
      <Link
        href="/admin/clientes"
        onClick={close}
        style={{ fontSize: 13.5, color: "#F7F5F0", fontWeight: 500, textDecoration: "none", flex: 1, lineHeight: 1.35 }}
      >
        {buildMessage(nearBirthdays)}
      </Link>
      <button
        onClick={close}
        aria-label="Cerrar"
        style={{ background: "none", border: "none", cursor: "pointer", color: "#F7F5F0", opacity: 0.75, padding: 4, display: "inline-flex" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
