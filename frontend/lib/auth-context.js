"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { authFetch, logout as doLogout } from "./auth-client";

const AuthContext = createContext(null);
const DEFAULT_IDLE_MINUTES = 60;
const SESSION_IDLE_TIMEOUT_MS = Math.max(
  5,
  Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES || DEFAULT_IDLE_MINUTES) || DEFAULT_IDLE_MINUTES,
) * 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const idleTimerRef = useRef(null);

  useEffect(() => {
    authFetch("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(() => doLogout(), []);

  useEffect(() => {
    if (!user) return undefined;
    let closed = false;

    function armTimer() {
      if (closed) return;
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        closed = true;
        doLogout({
          reason: "Cerramos tu sesión porque el panel quedó inactivo. Vuelve a ingresar para continuar.",
        });
      }, SESSION_IDLE_TIMEOUT_MS);
    }

    armTimer();
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, armTimer, { passive: true });
    });

    return () => {
      closed = true;
      window.clearTimeout(idleTimerRef.current);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, armTimer);
      });
    };
  }, [user]);

  return (
    <AuthContext value={{ user, loading, logout }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
