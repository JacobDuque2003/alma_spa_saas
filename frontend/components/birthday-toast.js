"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAnimatedMount } from "@/lib/use-animated-mount";

// sessionStorage resets when the tab closes. logout() also removes this key,
// so logout + login inside the same tab shows the birthday toast again.
const STORAGE_KEY = "alma:birthdayToastShown";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatNames(items) {
  const names = items.map((b) => b.fullName).filter(Boolean);
  if (names.length <= 1) return names[0] || "una clienta";
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  if (names.length === 3) return `${names[0]} , ${names[1]} y ${names[2]}`.replace(" ,", ",");
  return `${names[0]} , ${names[1]} y ${names.length - 2} más`.replace(" ,", ",");
}

function buildMessage(todayBirthdays) {
  if (todayBirthdays.length === 1) return `Hoy cumple ${formatNames(todayBirthdays)}`;
  return `Hoy cumplen ${formatNames(todayBirthdays)}`;
}

// Shows once per session only when there are birthdays today.
// Tomorrow/upcoming birthdays stay in Clientes/Cumpleanos.
export function BirthdayToast({ nearBirthdays }) {
  const [open, setOpen] = useState(false);
  const anim = useAnimatedMount(open, 260);
  const todayBirthdays = (nearBirthdays || []).filter((b) => b.daysUntil === 0);

  useEffect(() => {
    if (todayBirthdays.length === 0) return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === todayKey()) return;
    } catch { /* private mode etc - proceed anyway */ }
    setOpen(true);
    const t = setTimeout(() => close(), 9000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearBirthdays]);

  function close() {
    try { sessionStorage.setItem(STORAGE_KEY, todayKey()); } catch { /* noop */ }
    setOpen(false);
  }

  if (!anim.shouldRender || todayBirthdays.length === 0) return null;

  return (
    <div className={`alma-birthday-toast alma-anim-${anim.phase}`}>
      <div className="alma-birthday-confetti" aria-hidden="true">
        {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
      </div>
      <Link href="/admin/clientes" onClick={close} className="alma-birthday-link">
        <span className="alma-birthday-icon" aria-hidden="true">{"\u{1F389}"}</span>
        <span>{buildMessage(todayBirthdays)}</span>
      </Link>
      <button onClick={close} aria-label="Cerrar" className="alma-birthday-close">
        <X size={15} />
      </button>
    </div>
  );
}
