"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authFetch, logout as doLogout } from "./auth-client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(() => authFetch("/auth/me")
    .then((currentUser) => {
      setUser(currentUser);
      return currentUser;
    })
    .catch(() => {
      setUser(null);
      return null;
    })
    .finally(() => setLoading(false)), []);

  useEffect(() => {
    refreshSession();

    // Al volver con Atrás/Adelante, el navegador puede restaurar una captura
    // visual desde memoria sin volver a ejecutar la página. Revalidamos para
    // que nunca parezca iniciada una sesión cuya cookie ya fue eliminada.
    function handlePageShow(event) {
      if (event.persisted) refreshSession();
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refreshSession]);

  const logout = useCallback(() => doLogout(), []);

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
