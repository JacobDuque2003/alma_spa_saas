"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatNextWindow(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-EC", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
  } catch {
    return null;
  }
}

// useSearchParams() requiere Suspense boundary durante prerender en Next 16.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [scheduleMessage, setScheduleMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  // Si autoFetch redirigió aquí por 403 outOfSchedule, mostrar el mensaje.
  useEffect(() => {
    if (searchParams.get("outOfSchedule") === "1") {
      const opens = formatNextWindow(searchParams.get("nextOpens"));
      setScheduleMessage(opens
        ? `Fuera de tu horario de acceso. Próxima apertura: ${opens}.`
        : "Fuera de tu horario de acceso. Consulta con la administración del spa.");
    }
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setScheduleMessage(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/admin/agenda");
    } catch (err) {
      if (err.reason === "outOfSchedule") {
        const opens = formatNextWindow(err.nextWindowOpensAt);
        setScheduleMessage(opens
          ? `Tu cuenta está fuera del horario de acceso. Próxima apertura: ${opens}.`
          : "Tu cuenta está fuera del horario de acceso permitido.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm alma-stagger" style={{ boxShadow: "0 2px 8px rgba(107,85,64,0.08)" }}>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 text-3xl font-heading font-bold tracking-tight text-primary">
            ALMA
          </div>
          <CardTitle className="text-lg">Iniciar sesión</CardTitle>
          <CardDescription>Accede al panel de administración</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            {scheduleMessage && (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(201,168,118,0.15)", border: "1px solid rgba(201,168,118,0.4)", color: "#856330", fontSize: 13, textAlign: "center" }}>
                {scheduleMessage}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Ingresando…" : "Ingresar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
