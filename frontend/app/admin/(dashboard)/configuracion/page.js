"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Download, Loader2, Plus, Upload, X, Sparkles, Trash2, ImageIcon, ImageOff } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useToast } from "@/components/toast-provider";
import { compressImageToDataUrl } from "@/lib/image-compress";

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || "#8C6E50").replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = Number.parseInt(value, 16);
  if (Number.isNaN(n)) return `rgba(140,110,80,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function SectionHeader({ title, subtitle, onAdd, addLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>{title}</h3>
        {subtitle && <p style={{ margin: 0, fontSize: 13, color: "#A89A87", lineHeight: 1.4 }}>{subtitle}</p>}
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          <Plus size={14} /> {addLabel}
        </button>
      )}
    </div>
  );
}

function EmptyState({ icon, title, body, ctaLabel, onCta }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "28px 12px 8px", gap: 12 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(201,168,118,0.14)", color: "#8C6E50", display: "grid", placeItems: "center" }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: 15, color: "#6B5540", margin: "0 0 4px", fontWeight: 500 }}>{title}</p>
        <p style={{ fontSize: 13, color: "#A89A87", margin: 0, maxWidth: 380, lineHeight: 1.45 }}>{body}</p>
      </div>
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 500, cursor: "pointer", marginTop: 4 }}
        >
          <Plus size={14} /> {ctaLabel}
        </button>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <div
      className="alma-card"
      style={{
        padding: "18px 20px",
        background: "linear-gradient(135deg, rgba(253,252,250,0.98), rgba(235,205,181,0.20))",
        border: "1px solid rgba(201,168,118,0.32)",
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#A89A87", fontWeight: 700 }}>{label}</p>
      <div className="font-heading" style={{ fontSize: 28, color: "#6B5540", lineHeight: 1 }}>{value}</div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#8C6E50" }}>{detail}</p>
    </div>
  );
}

function Modal({ title, phase, onClose, children }) {
  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "100%", maxWidth: 420, margin: "0 16px", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}>
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 14px", border: "1px solid rgba(168,154,135,0.5)", borderRadius: 8, fontSize: 14, color: "#6B5540", background: "#FDFCFA", outline: "none", boxSizing: "border-box" };
const labelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 };
const pillPrimary = { padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 };
const pillSecondary = { padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 };

const cardPaddingDesktop = { padding: 28 };
const cardPaddingMobile = { padding: 18 };

function friendlyConfigError(message, fallback) {
  const text = String(message || fallback || "");
  const dependentRoom = text.match(/No se puede desactivar: el gabinete "([^"]+)" depende de la categoría "([^"]+)"/);
  if (dependentRoom) {
    return `No se pudo desactivar. La cabina "${dependentRoom[1]}" usa la categoría "${dependentRoom[2]}" y necesita al menos un servicio activo.`;
  }
  return text || fallback;
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: 44, height: 24, borderRadius: 12, border: "none",
        background: checked ? "#C9A876" : "rgba(168,154,135,0.3)",
        position: "relative", cursor: "pointer", transition: "background var(--motion-fast) var(--ease-in-out-quart)",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%",
        background: "#F7F5F0", transition: "left var(--motion-fast) var(--ease-in-out-quart)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }} />
    </button>
  );
}

function ServiceFormModal({ rooms, phase, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [durationMins, setDurationMins] = useState("60");
  const [bufferMins, setBufferMins] = useState("15");
  const [colorHex, setColorHex] = useState("#8C6E50");
  const [description, setDescription] = useState("");
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  const activeRooms = rooms.filter((room) => room.active !== false);
  const selectedRooms = activeRooms.filter((room) => selectedRoomIds.includes(room.id));

  function toggleRoom(roomId) {
    setSelectedRoomIds((prev) => prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]);
    setValidation(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || selectedRoomIds.length === 0 || priceUsd === "" || Number(priceUsd) < 0 || !Number(durationMins)) {
      setValidation("Nombre, precio, duración y al menos una cabina son requeridos");
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      const primaryArea = selectedRooms[0]?.specialty || "general";
      const created = await authFetch("/services", {
        method: "POST",
        body: {
          name: name.trim(),
          category: primaryArea,
          priceUsd: Number(priceUsd),
          durationMins: Number(durationMins),
          bufferMins: Number(bufferMins || 15),
          colorHex,
          description: description.trim() || undefined,
          roomIds: selectedRoomIds,
          offersHomeService: false,
        },
      });
      toast.success(`Servicio "${created.name}" creado`);
      onSaved(created);
    } catch (err) {
      toast.error(err.message || "Error al crear servicio");
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuevo servicio" phase={phase} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Masaje relajante" /></div>
        <div>
          <label style={labelStyle}>Área / cabinas permitidas</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {activeRooms.map((room) => {
              const checked = selectedRoomIds.includes(room.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => toggleRoom(room.id)}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 12,
                    border: checked ? `1px solid ${room.colorHex || "#8C6E50"}` : "1px solid rgba(168,154,135,0.32)",
                    background: checked ? hexToRgba(room.colorHex || "#8C6E50", 0.13) : "#FDFCFA",
                    color: checked ? "#6B5540" : "#8C6E50",
                    fontSize: 12,
                    fontWeight: checked ? 700 : 500,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {room.name}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "7px 0 0", fontSize: 11, color: "#A89A87" }}>
            La agenda asignará automáticamente una cabina disponible entre las seleccionadas.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={labelStyle}>Duración</label><input type="number" min="15" step="15" style={inputStyle} value={durationMins} onChange={(e) => setDurationMins(e.target.value)} placeholder="60" /></div>
          <div><label style={labelStyle}>Pausa</label><input type="number" min="0" step="5" style={inputStyle} value={bufferMins} onChange={(e) => setBufferMins(e.target.value)} placeholder="15" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 84px", gap: 10, alignItems: "end" }}>
          <div><label style={labelStyle}>Precio (USD)</label><input type="number" step="0.01" min="0" style={inputStyle} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="45.00" /></div>
          <div><label style={labelStyle}>Color</label><input type="color" style={{ ...inputStyle, padding: 5, height: 40 }} value={colorHex} onChange={(e) => setColorHex(e.target.value)} /></div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Descripción para clientas (opcional — se puede agregar después)</label>
          <textarea
            className="min-h-20 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            maxLength={500}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Limpieza facial profunda con extracción e hidratación."
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">{description.length}/500</p>
        </div>
        {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando..." : "Crear servicio"}</button>
        </div>
      </form>
    </Modal>
  );
}

// Único lugar para ver/agregar/editar/quitar descripción e imagen de un
// servicio ya creado. GET /services no trae imageData (se sirve aparte por
// /services/:id/image), así que "tiene imagen" se infiere de imageMimeType.
function ServiceMediaModal({ service, phase, onClose, onSaved }) {
  const [description, setDescription] = useState(service?.description || "");
  const [newImagePreview, setNewImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [compressedInfo, setCompressedInfo] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const hadImage = !!service?.imageMimeType;
  const showExistingImage = hadImage && !removeImage && !newImagePreview;
  const showRemoveButton = (hadImage && !removeImage) || !!newImagePreview;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setCompressing(true);
    try {
      const { dataUrl, bytes, width, height } = await compressImageToDataUrl(file);
      setNewImagePreview(dataUrl);
      setRemoveImage(false);
      setCompressedInfo({ bytes, width, height });
    } catch (err) {
      setError(err.message || "No se pudo procesar la imagen");
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  }

  function handleRemoveImage() {
    setNewImagePreview(null);
    setCompressedInfo(null);
    setRemoveImage(true);
  }

  async function handleSave() {
    if (description.trim().length > 500) {
      setError("La descripción no puede superar 500 caracteres");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const body = { description: description.trim() || null };
      if (newImagePreview) body.image = newImagePreview;
      else if (removeImage) body.image = null;
      const updated = await authFetch(`/services/${service.id}`, { method: "PATCH", body });
      toast.success("Descripción y foto actualizadas");
      onSaved(updated);
    } catch (err) {
      setError(err.message || "No se pudo guardar");
      setSaving(false);
    }
  }

  return (
    <Modal title={`Descripción y foto — ${service?.name || ""}`} phase={phase} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Descripción para clientas</label>
          <textarea
            className="min-h-24 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            maxLength={500}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Limpieza facial profunda con extracción e hidratación."
            disabled={saving}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">{description.length}/500</p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Foto del servicio</label>
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {newImagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={newImagePreview} alt="Vista previa" className="h-full w-full object-cover" />
              ) : showExistingImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/proxy/services/${service.id}/image`} alt={service.name} className="h-full w-full object-cover" />
              ) : (
                <ImageOff size={20} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col items-start gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary">
                <Upload size={14} />
                {compressing ? "Comprimiendo…" : "Elegir foto"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                  disabled={compressing || saving}
                />
              </label>
              {showRemoveButton && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  disabled={saving}
                  className="text-sm text-destructive"
                >
                  Quitar foto
                </button>
              )}
            </div>
          </div>
          {compressedInfo && (
            <p className="mt-2 text-xs text-muted-foreground">
              Comprimida a {(compressedInfo.bytes / 1024).toFixed(0)}KB ({compressedInfo.width}×{compressedInfo.height}px)
            </p>
          )}
        </div>

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        <div className="mt-1 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-full border border-primary bg-transparent py-2.5 text-sm font-medium text-primary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || compressing}
            className="flex-1 rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteServiceModal({ service, phase, onClose, onConfirm, saving }) {
  return (
    <Modal title="Eliminar servicio" phase={phase} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#6B5540" }}>
          Vas a quitar <strong>{service?.name}</strong> de la oferta del spa. Ya no aparecerá para nuevas reservas,
          pero las citas e historiales anteriores se conservan.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={saving} style={pillSecondary}>Cancelar</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            style={{
              ...pillPrimary,
              background: "#A84F4A",
              opacity: saving ? 0.65 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function BusinessHoursPanel({ onRefresh }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Nueva estructura: dos franjas independientes con toggle "franja abierta/cerrada".
  // El backend puede devolver el shape viejo {start,end}; el efecto de carga
  // sintetiza morning={start,end} y afternoon=null en ese caso.
  const [morningOpen, setMorningOpen] = useState(true);
  const [morningStart, setMorningStart] = useState("09:00");
  const [morningEnd, setMorningEnd] = useState("12:00");
  const [afternoonOpen, setAfternoonOpen] = useState(true);
  const [afternoonStart, setAfternoonStart] = useState("15:00");
  const [afternoonEnd, setAfternoonEnd] = useState("20:00");
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5, 6]);
  const [validationMsg, setValidationMsg] = useState(null);
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  useEffect(() => {
    authFetch("/tenant/config").then((cfg) => {
      const bh = cfg?.businessHours;
      if (bh) {
        // Shape nuevo: {morning, afternoon}
        if ("morning" in bh || "afternoon" in bh) {
          if (bh.morning) {
            setMorningOpen(true);
            setMorningStart(bh.morning.start);
            setMorningEnd(bh.morning.end);
          } else {
            setMorningOpen(false);
          }
          if (bh.afternoon) {
            setAfternoonOpen(true);
            setAfternoonStart(bh.afternoon.start);
            setAfternoonEnd(bh.afternoon.end);
          } else {
            setAfternoonOpen(false);
          }
        } else if (bh.start && bh.end) {
          // Shape viejo: se muestra como morning único, afternoon cerrada.
          setMorningOpen(true);
          setMorningStart(bh.start);
          setMorningEnd(bh.end);
          setAfternoonOpen(false);
        }
      }
      if (Array.isArray(cfg?.workDays)) setWorkDays(cfg.workDays);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function toggleDay(d) {
    setWorkDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
    setSaved(false);
  }

  async function save() {
    // Validación local mínima antes de enviar (evita round-trip).
    if (!morningOpen && !afternoonOpen) {
      setValidationMsg("Al menos una franja (mañana o tarde) debe estar abierta.");
      return;
    }
    if (morningOpen && morningStart >= morningEnd) {
      setValidationMsg("La apertura de la mañana debe ser antes del cierre.");
      return;
    }
    if (afternoonOpen && afternoonStart >= afternoonEnd) {
      setValidationMsg("La apertura de la tarde debe ser antes del cierre.");
      return;
    }
    if (morningOpen && afternoonOpen && morningEnd > afternoonStart) {
      setValidationMsg("La mañana debe cerrar antes (o al mismo tiempo) que abra la tarde.");
      return;
    }
    setValidationMsg(null);
    setSaving(true);
    setSaved(false);
    try {
      const body = {
        businessHours: {
          morning: morningOpen ? { start: morningStart, end: morningEnd } : null,
          afternoon: afternoonOpen ? { start: afternoonStart, end: afternoonEnd } : null,
        },
        workDays,
      };
      await authFetch("/tenant/config", { method: "PATCH", body });
      setSaved(true);
      toast.success("Horario guardado");
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error(err.message || "No se pudo guardar el horario");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 20, textAlign: "center" }}><Loader2 size={16} className="animate-spin" style={{ color: "#A89A87" }} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <BusinessHoursRow
        label="Mañana"
        open={morningOpen}
        onToggle={() => { setMorningOpen((v) => !v); setSaved(false); setValidationMsg(null); }}
        start={morningStart}
        end={morningEnd}
        onStartChange={(v) => { setMorningStart(v); setSaved(false); setValidationMsg(null); }}
        onEndChange={(v) => { setMorningEnd(v); setSaved(false); setValidationMsg(null); }}
      />
      <BusinessHoursRow
        label="Tarde"
        open={afternoonOpen}
        onToggle={() => { setAfternoonOpen((v) => !v); setSaved(false); setValidationMsg(null); }}
        start={afternoonStart}
        end={afternoonEnd}
        onStartChange={(v) => { setAfternoonStart(v); setSaved(false); setValidationMsg(null); }}
        onEndChange={(v) => { setAfternoonEnd(v); setSaved(false); setValidationMsg(null); }}
      />
      <div>
        <label style={labelStyle}>Días laborables</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAY_LABELS.map((label, i) => (
            <button key={i} type="button" onClick={() => toggleDay(i)} style={{ padding: "7px 14px", borderRadius: 999, border: workDays.includes(i) ? "none" : "1px solid rgba(168,154,135,0.5)", background: workDays.includes(i) ? "#8C6E50" : "transparent", color: workDays.includes(i) ? "#F7F5F0" : "#A89A87", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {validationMsg && <p style={{ fontSize: 13, color: "#C25450", margin: 0 }}>{validationMsg}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ padding: "8px 22px", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Guardando..." : "Guardar horario"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "#8C6E50" }}>Guardado</span>}
      </div>
    </div>
  );
}

function BusinessHoursRow({ label, open, onToggle, start, end, onStartChange, onEndChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#6B5540" }}>{label}</span>
        <button
          type="button"
          onClick={onToggle}
          style={{ padding: "4px 12px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: open ? "rgba(85,107,47,0.12)" : "transparent", color: open ? "#556B2F" : "#A89A87", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
        >
          {open ? "Abierta" : "Cerrada - activar"}
        </button>
      </div>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Apertura</label>
            <input type="time" value={start} onChange={(e) => onStartChange(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Cierre</label>
            <input type="time" value={end} onChange={(e) => onEndChange(e.target.value)} style={inputStyle} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfiguracionPage() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState(null);
  const [deletingService, setDeletingService] = useState(false);
  const [mediaTarget, setMediaTarget] = useState(null);
  const serviceAnim = useAnimatedMount(showServiceForm, 220);
  const deleteServiceAnim = useAnimatedMount(!!deleteServiceTarget, 220);
  const mediaAnim = useAnimatedMount(!!mediaTarget, 220);
  const activeServices = useMemo(() => services.filter((s) => s.active !== false), [services]);
  const visibleServices = activeServices;
  const averagePrice = activeServices.length
    ? activeServices.reduce((sum, s) => sum + Number(s.priceUsd || 0), 0) / activeServices.length
    : 0;
  const averageBlockMins = activeServices.length
    ? Math.round(activeServices.reduce((sum, s) => sum + Number(s.durationMins || 60) + Number(s.bufferMins ?? 15), 0) / activeServices.length)
    : 0;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [s, r] = await Promise.all([authFetch("/services"), authFetch("/rooms")]);
      setServices(s);
      setRooms(r);
    } catch (err) {
      setLoadError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function updateService(service, changes) {
    try {
      const updated = await authFetch(`/services/${service.id}`, { method: "PATCH", body: changes });
      setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, ...updated } : s)));
      if (changes.active === true) toast.success("Servicio habilitado");
      else if (changes.active === false) toast.warning("Servicio deshabilitado");
      else toast.info("Servicio actualizado");
    } catch (err) {
      toast.error(friendlyConfigError(err.message, "Error al actualizar servicio"));
    }
  }

  async function deleteService(service) {
    if (!service || deletingService) return;
    setDeletingService(true);
    try {
      await authFetch(`/services/${service.id}`, { method: "DELETE" });
      setServices((prev) => prev.filter((s) => s.id !== service.id));
      toast.warning(`Servicio "${service.name}" eliminado de la oferta`);
      setDeleteServiceTarget(null);
    } catch (err) {
      toast.error(friendlyConfigError(err.message, "No se pudo eliminar el servicio"));
    } finally {
      setDeletingService(false);
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "30px 34px", overflowY: "auto" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: isMobile ? 14 : 20 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: isMobile ? 24 : 30, fontWeight: 600, color: "#6B5540", margin: "0 0 6px" }}>Configuración</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Servicios, precios y horario de atención del spa.</p>
        </div>

        {loadError && <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{loadError}</div>}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(180px, 1fr))", gap: 14 }}>
              <SummaryCard label="Servicios activos" value={`${activeServices.length}`} detail="Solo oferta visible para reservas" />
              <SummaryCard label="Bloque promedio" value={averageBlockMins ? `${averageBlockMins} min` : "—"} detail="Incluye la pausa entre sesiones" />
              <SummaryCard label="Precio promedio" value={activeServices.length ? money(averagePrice) : "—"} detail="Solo servicios habilitados" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.55fr) minmax(320px, 0.85fr)", gap: isMobile ? 14 : 18, alignItems: "start" }}>
            {/* Servicios y precios */}
            <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
              <SectionHeader
                title="Servicios y precios"
                subtitle="Cada servicio incluye su duración estándar, pausa, precio y cabinas permitidas."
                onAdd={() => setShowServiceForm(true)}
                addLabel="Añadir servicio"
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                {visibleServices.map((s, i, arr) => {
                  const active = s.active !== false;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 10 : 14, padding: "14px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none", opacity: active ? 1 : 0.5, flexDirection: isMobile ? "column" : "row" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, width: "100%" }}>
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted flex items-center justify-center">
                          {s.imageMimeType ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/proxy/services/${s.id}/image`} alt={s.name} className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff size={14} className="text-muted-foreground" />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.colorHex || "#8C6E50", boxShadow: "0 0 0 3px rgba(201,168,118,0.14)" }} />
                            <span style={{ fontSize: 14, color: "#6B5540" }}>{s.name}</span>
                            {!active && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(194,84,80,0.12)", color: "#C25450" }}>Inactivo</span>}
                          </div>
                          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#A89A87" }}>
                            {s.durationMins || 60} min de sesión · {s.bufferMins ?? 15} min de pausa · bloque total {(s.durationMins || 60) + (s.bufferMins ?? 15)} min
                          </p>
                          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8C6E50", opacity: 0.82 }}>
                            Cabinas permitidas: {Array.isArray(s.rooms) && s.rooms.length > 0 ? s.rooms.map((room) => room.name).join(", ") : "sin cabina asignada"}
                          </p>
                          {s.description && (
                            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{s.description}</p>
                          )}
                        </div>
                        {!isMobile && <Toggle checked={active} onChange={(val) => updateService(s, { active: val })} />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          type="color"
                          defaultValue={s.colorHex || "#8C6E50"}
                          title="Color del servicio"
                          onBlur={(e) => { if (e.target.value.toUpperCase() !== String(s.colorHex || "#8C6E50").toUpperCase()) updateService(s, { colorHex: e.target.value }); }}
                          style={{ width: 40, height: 34, padding: 4, borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", cursor: "pointer", flexShrink: 0 }}
                        />
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={Number(s.priceUsd).toFixed(2)}
                          onBlur={(e) => { if (Number(e.target.value) !== Number(s.priceUsd)) updateService(s, { priceUsd: Number(e.target.value) }); }}
                          style={{ width: 84, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", textAlign: "right", fontSize: 13, color: "#6B5540", outline: "none", flexShrink: 0 }}
                        />
                        <button
                          type="button"
                          title="Descripción y foto"
                          onClick={() => setMediaTarget(s)}
                          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-primary/30 bg-primary/5 text-primary"
                        >
                          <ImageIcon size={15} />
                        </button>
                        <button
                          type="button"
                          title="Eliminar servicio"
                          onClick={() => setDeleteServiceTarget(s)}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            border: "1px solid rgba(168,79,74,0.28)",
                            background: "rgba(168,79,74,0.06)",
                            color: "#A84F4A",
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                        {isMobile && <Toggle checked={active} onChange={(val) => updateService(s, { active: val })} />}
                      </div>
                    </div>
                  );
                })}
                {visibleServices.length === 0 && (
                  <EmptyState
                    icon={<Sparkles size={28} strokeWidth={1.5} />}
                    title="Todavía no hay servicios"
                    body="Crea el primer servicio para poder reservar citas y ofrecerlo en la agenda pública."
                    ctaLabel="Añadir servicio"
                    onCta={() => setShowServiceForm(true)}
                  />
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 18 }}>
              {/* Horario de atención */}
              <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
                <div style={{ marginBottom: 18 }}>
                  <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Horario de atención</h3>
                  <p style={{ margin: 0, fontSize: 13, color: "#A89A87" }}>Define cuándo el spa acepta reservas en la agenda y en el link público.</p>
                </div>
                <BusinessHoursPanel />
              </div>

              <div
                className="alma-card"
                style={{
                  ...(isMobile ? cardPaddingMobile : cardPaddingDesktop),
                  background: "linear-gradient(145deg, rgba(253,252,250,0.98), rgba(201,168,118,0.14))",
                }}
              >
                <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Datos y respaldo</h3>
                <p style={{ margin: "0 0 18px", fontSize: 13, color: "#A89A87", lineHeight: 1.45 }}>
                  Próximo paso: respaldos en nube e importación/exportación de información.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                  <button disabled style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 14px", borderRadius: 999, border: "1px solid rgba(140,110,80,0.25)", background: "rgba(253,252,250,0.65)", color: "#A89A87", fontSize: 13 }}>
                    <Upload size={14} /> Subir Excel
                  </button>
                  <button disabled style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 14px", borderRadius: 999, border: "1px solid rgba(140,110,80,0.25)", background: "rgba(253,252,250,0.65)", color: "#A89A87", fontSize: 13 }}>
                    <Download size={14} /> Descargar
                  </button>
                </div>
              </div>
            </div>
            </div>
          </>
        )}
      </div>

      {serviceAnim.shouldRender && <ServiceFormModal rooms={rooms} phase={serviceAnim.phase} onClose={() => setShowServiceForm(false)} onSaved={(created) => { setShowServiceForm(false); setServices((prev) => [...prev, created]); }} />}
      {deleteServiceAnim.shouldRender && deleteServiceTarget && (
        <DeleteServiceModal
          service={deleteServiceTarget}
          phase={deleteServiceAnim.phase}
          saving={deletingService}
          onClose={() => setDeleteServiceTarget(null)}
          onConfirm={() => deleteService(deleteServiceTarget)}
        />
      )}
      {mediaAnim.shouldRender && mediaTarget && (
        <ServiceMediaModal
          service={mediaTarget}
          phase={mediaAnim.phase}
          onClose={() => setMediaTarget(null)}
          onSaved={(updated) => {
            setMediaTarget(null);
            setServices((prev) => prev.map((svc) => (svc.id === updated.id ? { ...svc, ...updated } : svc)));
          }}
        />
      )}
    </div>
  );
}

