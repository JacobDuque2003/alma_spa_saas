"use client";

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useAnimatedMount } from "@/lib/use-animated-mount";

// Sistema global de toasts.
// Uso:
//   const toast = useToast();
//   toast.success("Guardado");
//   toast.error(err.message);
//   toast.info("Cumpleaños en 3 días");
// Cada toast se auto-cierra a los 4s. Se pueden apilar.
// Animación via useAnimatedMount (mismo patrón que el resto del sistema).

const ToastContext = createContext(null);

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((level, message, opts = {}) => {
    const id = ++nextId.current;
    const duration = opts.duration ?? DEFAULT_DURATION_MS;
    setToasts((prev) => [...prev, { id, level, message, duration }]);
    return id;
  }, []);

  const api = useMemo(() => ({
    push,
    success: (message, opts) => push("success", message, opts),
    error:   (message, opts) => push("error",   message, opts),
    info:    (message, opts) => push("info",    message, opts),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() debe usarse dentro de <ToastProvider/>");
  return ctx;
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 24,
        right: 24,
        // z-index deliberadamente muy alto: modales usan 50, drawer 50,
        // NewClientModal (Agenda over) 60, BirthdayToast 70. Los toasts
        // globales siempre deben ganar la disputa de stacking.
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
        maxWidth: "calc(100vw - 48px)",
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [open, setOpen] = useState(true);
  const anim = useAnimatedMount(open, 220);

  useEffect(() => {
    const t = setTimeout(() => setOpen(false), toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration]);

  useEffect(() => {
    if (!anim.shouldRender) onDismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim.shouldRender]);

  if (!anim.shouldRender) return null;

  return (
    <div
      className={`alma-toast-item alma-toast-${toast.level} alma-anim-${anim.phase}`}
      style={{ pointerEvents: "auto" }}
      role={toast.level === "error" ? "alert" : "status"}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => setOpen(false)}
        aria-label="Cerrar"
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, padding: 4, display: "inline-flex" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
