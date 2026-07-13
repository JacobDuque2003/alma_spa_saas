"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { publicFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const STEPS = ["Servicio", "Fecha y hora", "Tus datos", "Confirmación"];

function formatPrice(usd) {
  return `$${Number(usd).toFixed(2)}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/Guayaquil" });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Guayaquil" });
}

function getNextDays(count) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
            i <= current
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}>
            {i < current ? "✓" : i + 1}
          </div>
          <span className={`text-sm hidden sm:inline ${
            i <= current ? "text-foreground font-medium" : "text-muted-foreground"
          }`}>{label}</span>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ServiceStep({ services, selected, onSelect, loading }) {
  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Cargando servicios...</div>;
  }

  if (!services.length) {
    return <div className="text-center py-12 text-muted-foreground">No hay servicios disponibles en este momento.</div>;
  }

  const grouped = {};
  for (const s of services) {
    (grouped[s.category] ||= []).push(s);
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-heading font-semibold text-foreground">Elige tu servicio</h2>
        <p className="text-muted-foreground mt-1">Selecciona el tratamiento que deseas reservar</p>
      </div>
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{cat}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((svc) => (
              <button
                key={svc.id}
                type="button"
                onClick={() => onSelect(svc)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  selected?.id === svc.id
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-foreground">{svc.name}</div>
                    <div className="text-sm text-muted-foreground mt-1">{svc.durationMins} min</div>
                  </div>
                  <div className="text-primary font-semibold">{formatPrice(svc.priceUsd)}</div>
                </div>
                {svc.offersHomeService && (
                  <Badge variant="secondary" className="mt-2 text-xs">A domicilio disponible</Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DateTimeStep({ tenantSlug, service, date, setDate, slot, setSlot }) {
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [modality, setModality] = useState("spa");
  const days = getNextDays(14);

  const fetchSlots = useCallback(async () => {
    if (!date || !service) return;
    setLoadingSlots(true);
    setSlot(null);
    try {
      const data = await publicFetch(`/${tenantSlug}/availability`, {
        query: { serviceId: service.id, date, modality },
      });
      setSlots(data.slots || []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [date, service, modality, tenantSlug, setSlot]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-heading font-semibold text-foreground">Elige fecha y hora</h2>
        <p className="text-muted-foreground mt-1">{service.name} — {service.durationMins} min</p>
      </div>

      {service.offersHomeService && (
        <div className="flex gap-2 justify-center">
          {["spa", "domicilio"].map((m) => (
            <Button
              key={m}
              variant={modality === m ? "default" : "outline"}
              size="sm"
              onClick={() => setModality(m)}
            >
              {m === "spa" ? "En el spa" : "A domicilio"}
            </Button>
          ))}
        </div>
      )}

      <div>
        <Label className="text-sm font-medium mb-2 block">Fecha</Label>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {days.map((d) => {
            const dayDate = new Date(d + "T12:00:00");
            const dayName = dayDate.toLocaleDateString("es-EC", { weekday: "short", timeZone: "America/Guayaquil" });
            const dayNum = dayDate.getDate();
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-lg border text-sm transition-all ${
                  date === d
                    ? "border-primary bg-primary/5 text-primary font-semibold"
                    : "border-border bg-card hover:border-primary/40 text-foreground"
                }`}
              >
                <span className="text-xs uppercase">{dayName}</span>
                <span className="text-lg font-semibold">{dayNum}</span>
              </button>
            );
          })}
        </div>
      </div>

      {date && (
        <div>
          <Label className="text-sm font-medium mb-2 block">Hora disponible</Label>
          {loadingSlots ? (
            <div className="text-center py-6 text-muted-foreground">Consultando disponibilidad...</div>
          ) : slots.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">No hay horarios disponibles este día</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlot(s)}
                  className={`px-3 py-2 rounded-lg border text-sm text-center transition-all ${
                    slot === s
                      ? "border-primary bg-primary text-primary-foreground font-semibold"
                      : "border-border bg-card hover:border-primary/40 text-foreground"
                  }`}
                >
                  {formatTime(s)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClientStep({ form, setForm, modality, service }) {
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-heading font-semibold text-foreground">Tus datos</h2>
        <p className="text-muted-foreground mt-1">Para confirmar tu reserva</p>
      </div>
      <div className="space-y-4 max-w-md mx-auto">
        <div className="space-y-2">
          <Label htmlFor="fullName">Nombre completo *</Label>
          <Input id="fullName" value={form.fullName} onChange={update("fullName")} placeholder="María García" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsapp">WhatsApp *</Label>
          <Input id="whatsapp" type="tel" value={form.whatsapp} onChange={update("whatsapp")} placeholder="+593999000001" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" type="email" value={form.email} onChange={update("email")} placeholder="maria@email.com" />
        </div>
        {modality === "domicilio" && service?.offersHomeService && (
          <div className="space-y-2">
            <Label htmlFor="homeAddress">Dirección para servicio a domicilio *</Label>
            <Input id="homeAddress" value={form.homeAddress} onChange={update("homeAddress")} placeholder="Av. Principal y Calle 2, Zamora" />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmStep({ service, date, slot, form, modality }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-heading font-semibold text-foreground">Confirma tu reserva</h2>
        <p className="text-muted-foreground mt-1">Revisa los datos antes de confirmar</p>
      </div>
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle>{service.name}</CardTitle>
          <CardDescription>{service.durationMins} min — {formatPrice(service.priceUsd)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Fecha</span>
            <span className="font-medium capitalize">{formatDate(date)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Hora</span>
            <span className="font-medium">{formatTime(slot)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Modalidad</span>
            <span className="font-medium">{modality === "domicilio" ? "A domicilio" : "En el spa"}</span>
          </div>
          {modality === "domicilio" && form.homeAddress && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Dirección</span>
              <span className="font-medium text-right max-w-[60%]">{form.homeAddress}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Nombre</span>
            <span className="font-medium">{form.fullName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">WhatsApp</span>
            <span className="font-medium">{form.whatsapp}</span>
          </div>
          {form.email && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Correo</span>
              <span className="font-medium">{form.email}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SuccessView({ result }) {
  const appt = result.appointments?.[0];
  return (
    <div className="text-center space-y-6 py-8">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <span className="text-3xl text-primary">{"✓"}</span>
      </div>
      <div>
        <h2 className="text-2xl font-heading font-semibold text-foreground">Reserva creada</h2>
        <p className="text-muted-foreground mt-2">Te enviaremos un recordatorio por WhatsApp</p>
      </div>
      {appt && (
        <Card className="max-w-sm mx-auto">
          <CardContent className="space-y-2 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Estado</span>
              <Badge>{appt.status}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hora</span>
              <span className="font-medium">{formatTime(appt.startsAt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Precio</span>
              <span className="font-medium">{formatPrice(appt.priceUsd)}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function BookingPage() {
  const { tenantSlug } = useParams();
  const [step, setStep] = useState(0);
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedService, setSelectedService] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [modality, setModality] = useState("spa");
  const [form, setForm] = useState({ fullName: "", whatsapp: "", email: "", homeAddress: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    publicFetch(`/${tenantSlug}/services`)
      .then(setServices)
      .catch(() => setServices([]))
      .finally(() => setLoadingServices(false));
  }, [tenantSlug]);

  const canAdvance = () => {
    if (step === 0) return !!selectedService;
    if (step === 1) return !!date && !!slot;
    if (step === 2) {
      if (!form.fullName.trim() || !form.whatsapp.trim()) return false;
      if (modality === "domicilio" && !form.homeAddress.trim()) return false;
      return true;
    }
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        whatsapp: form.whatsapp.trim(),
        email: form.email.trim() || undefined,
        selections: [{
          serviceId: selectedService.id,
          startsAt: slot,
          modality,
          homeAddress: modality === "domicilio" ? form.homeAddress.trim() : undefined,
        }],
      };
      const data = await publicFetch(`/${tenantSlug}/bookings`, {
        method: "POST",
        body: payload,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <h1 className="text-lg font-heading font-semibold text-primary">ALMA Spa</h1>
          </div>
        </header>
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
          <SuccessView result={result} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-lg font-heading font-semibold text-primary">ALMA Spa</h1>
          <p className="text-sm text-muted-foreground">Reserva tu cita</p>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <StepIndicator current={step} />

        {step === 0 && (
          <ServiceStep
            services={services}
            selected={selectedService}
            onSelect={setSelectedService}
            loading={loadingServices}
          />
        )}

        {step === 1 && (
          <DateTimeStep
            tenantSlug={tenantSlug}
            service={selectedService}
            date={date}
            setDate={setDate}
            slot={slot}
            setSlot={setSlot}
          />
        )}

        {step === 2 && (
          <ClientStep
            form={form}
            setForm={setForm}
            modality={modality}
            service={selectedService}
          />
        )}

        {step === 3 && (
          <ConfirmStep
            service={selectedService}
            date={date}
            slot={slot}
            form={form}
            modality={modality}
          />
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">{error}</div>
        )}

        <div className="flex justify-between mt-8">
          <Button
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            Atrás
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
            >
              Siguiente
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Reservando..." : "Confirmar reserva"}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
