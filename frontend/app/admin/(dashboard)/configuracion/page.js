"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Download, Edit3, Loader2, Plus, Upload, X, Sparkles, Tag, DoorOpen } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useToast } from "@/components/toast-provider";

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
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

function ServiceFormModal({ categories, phase, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [durationMins, setDurationMins] = useState("60");
  const [bufferMins, setBufferMins] = useState("15");
  const [colorHex, setColorHex] = useState("#8C6E50");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !category.trim() || !Number(priceUsd) || !Number(durationMins)) {
      setValidation("Nombre, categoría y precio son requeridos");
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      const created = await authFetch("/services", {
        method: "POST",
        body: {
          name: name.trim(),
          category: category.trim(),
          priceUsd: Number(priceUsd),
          durationMins: Number(durationMins),
          bufferMins: Number(bufferMins || 15),
          colorHex,
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
          <label style={labelStyle}>Categoría / especialidad</label>
          <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="masajes" list="cat-suggestions" />
          {categories.length > 0 && <datalist id="cat-suggestions">{categories.map((c) => <option key={c} value={c} />)}</datalist>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={labelStyle}>Duración</label><input type="number" min="15" step="15" style={inputStyle} value={durationMins} onChange={(e) => setDurationMins(e.target.value)} placeholder="60" /></div>
          <div><label style={labelStyle}>Pausa</label><input type="number" min="0" step="5" style={inputStyle} value={bufferMins} onChange={(e) => setBufferMins(e.target.value)} placeholder="15" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 84px", gap: 10, alignItems: "end" }}>
          <div><label style={labelStyle}>Precio (USD)</label><input type="number" step="0.01" style={inputStyle} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="45.00" /></div>
          <div><label style={labelStyle}>Color</label><input type="color" style={{ ...inputStyle, padding: 5, height: 40 }} value={colorHex} onChange={(e) => setColorHex(e.target.value)} /></div>
        </div>
        {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear servicio"}</button>
        </div>
      </form>
    </Modal>
  );
}

function RoomFormModal({ categories, phase, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(categories[0] || "");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !specialty) {
      setValidation("Nombre y especialidad son requeridos");
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      const created = await authFetch("/rooms", { method: "POST", body: { name: name.trim(), specialty } });
      toast.success(`Cabina "${created.name}" creada`);
      onSaved(created);
    } catch (err) {
      toast.error(err.message || "Error al crear cabina");
      setSaving(false);
    }
  }

  return (
    <Modal title="Nueva cabina" phase={phase} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cabina 4 - CORPORAL" /></div>
        <div>
          <label style={labelStyle}>Especialidad</label>
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear cabina"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryFormModal({ phase, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setValidation("El nombre es requerido"); return; }
    setValidation(null);
    setSaving(true);
    try {
      const created = await authFetch("/categories", { method: "POST", body: { name: name.trim() } });
      toast.success(`Categoría "${created.name}" creada`);
      onSaved(created);
    } catch (err) { toast.error(err.message || "Error al crear la categoría"); setSaving(false); }
  }

  return (
    <Modal title="Nueva categoría" phase={phase} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="masajes, faciales, corporales..." autoFocus /></div>
        {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear categoría"}</button>
        </div>
      </form>
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
          // Shape viejo — se muestra como morning único, afternoon cerrada.
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
          {saving ? "Guardando…" : "Guardar horario"}
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
          {open ? "Abierta" : "Cerrada — activar"}
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

function RoomRow({ r, categories, expanded, onToggleExpand, onUpdate, isLast }) {
  const [name, setName] = useState(r.name);
  const [specialty, setSpecialty] = useState(r.specialty);
  const [opensAt, setOpensAt] = useState(r.opensAt || "09:00");
  const [closesAt, setClosesAt] = useState(r.closesAt || "20:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(r.name);
    setSpecialty(r.specialty);
    setOpensAt(r.opensAt || "09:00");
    setClosesAt(r.closesAt || "20:00");
  }, [r]);

  const dirty = name !== r.name || specialty !== r.specialty || opensAt !== (r.opensAt || "09:00") || closesAt !== (r.closesAt || "20:00");
  const active = r.active !== false;

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onUpdate(r, { name: name.trim(), specialty, opensAt, closesAt });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid rgba(168,154,135,0.3)", opacity: active ? 1 : 0.5 }}>
      <div
        onClick={onToggleExpand}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", cursor: "pointer", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#C9A876", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 500, color: "#6B5540", whiteSpace: "nowrap" }}>{r.name}</span>
          <span style={{ fontSize: 12, color: "#A89A87", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.specialty} · {r.opensAt || "09:00"}-{r.closesAt || "20:00"}</span>
          {!active && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(194,84,80,0.12)", color: "#C25450", flexShrink: 0 }}>Inactivo</span>}
        </div>
        <Toggle checked={active} onChange={(val) => onUpdate(r, { active: val })} />
      </div>
      {expanded && (
        <div style={{ padding: "0 0 18px", display: "flex", flexDirection: "column", gap: 12 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Especialidad</label>
              <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Apertura</label>
              <input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Cierre</label>
              <input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} style={inputStyle} />
            </div>
          </div>
          {dirty && (
            <button onClick={handleSave} disabled={saving} style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
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
  const [dbCategories, setDbCategories] = useState([]);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const serviceAnim = useAnimatedMount(showServiceForm, 220);
  const roomAnim = useAnimatedMount(showRoomForm, 220);
  const catAnim = useAnimatedMount(showCatForm, 220);
  const [editCatId, setEditCatId] = useState(null);
  const [editCatName, setEditCatName] = useState("");
  const [expandedRoomId, setExpandedRoomId] = useState(null);

  const derivedCategories = useMemo(() => [...new Set(services.map((s) => s.category))], [services]);
  const categories = useMemo(() => {
    const dbNames = dbCategories.map((c) => c.name);
    const merged = [...dbNames, ...derivedCategories.filter((d) => !dbNames.includes(d))];
    return merged;
  }, [dbCategories, derivedCategories]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [s, r, cats] = await Promise.all([authFetch("/services"), authFetch("/rooms"), authFetch("/categories").catch(() => [])]);
      setServices(s);
      setRooms(r);
      setDbCategories(Array.isArray(cats) ? cats : []);
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

  async function updateRoom(room, changes) {
    try {
      const updated = await authFetch(`/rooms/${room.id}`, { method: "PATCH", body: changes });
      setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, ...updated } : r)));
      if (changes.active === true) toast.success("Cabina habilitada");
      else if (changes.active === false) toast.warning("Cabina deshabilitada");
      else toast.info("Cabina actualizada");
    } catch (err) {
      toast.error(friendlyConfigError(err.message, "Error al actualizar cabina"));
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "16px" : "28px 32px", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: isMobile ? 14 : 20 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: isMobile ? 24 : 30, fontWeight: 600, color: "#6B5540", margin: "0 0 6px" }}>Configuración</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Servicios, categorías, cabinas y horario de atención del spa.</p>
        </div>

        {loadError && <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{loadError}</div>}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : (
          <>
            {/* Servicios y precios */}
            <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
              <SectionHeader
                title="Servicios y precios"
                subtitle="Cada servicio incluye su duración estándar y el precio que se cobra al cliente."
                onAdd={() => setShowServiceForm(true)}
                addLabel="Añadir servicio"
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                {services.map((s, i, arr) => {
                  const active = s.active !== false;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 10 : 14, padding: "14px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none", opacity: active ? 1 : 0.5, flexDirection: isMobile ? "column" : "row" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, width: "100%" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.colorHex || "#8C6E50", boxShadow: "0 0 0 3px rgba(201,168,118,0.14)" }} />
                            <span style={{ fontSize: 14, color: "#6B5540" }}>{s.name}</span>
                            <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(201,168,118,0.18)", color: "#8C6E50" }}>{s.category}</span>
                            {!active && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(194,84,80,0.12)", color: "#C25450" }}>Inactivo</span>}
                          </div>
                          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#A89A87" }}>
                            {s.durationMins || 60} min de sesión · {s.bufferMins ?? 15} min de pausa · bloque total {(s.durationMins || 60) + (s.bufferMins ?? 15)} min
                          </p>
                          {Array.isArray(s.rooms) && s.rooms.length > 0 && (
                            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#8C6E50" }}>
                              Cabinas: {s.rooms.map((room) => room.name).join(", ")}
                            </p>
                          )}
                        </div>
                        {!isMobile && <Toggle checked={active} onChange={(val) => updateService(s, { active: val })} />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={Number(s.priceUsd).toFixed(2)}
                          onBlur={(e) => { if (Number(e.target.value) !== Number(s.priceUsd)) updateService(s, { priceUsd: Number(e.target.value) }); }}
                          style={{ width: 84, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", textAlign: "right", fontSize: 13, color: "#6B5540", outline: "none", flexShrink: 0 }}
                        />
                        {isMobile && <Toggle checked={active} onChange={(val) => updateService(s, { active: val })} />}
                      </div>
                    </div>
                  );
                })}
                {services.length === 0 && (
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

            {/* Categorías */}
            <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
              <SectionHeader
                title="Categorías"
                subtitle="Agrupa servicios y cabinas por especialidad (facial, láser, corporal, terapias…)."
                onAdd={() => setShowCatForm(true)}
                addLabel="Crear categoría"
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {categories.map((catName) => {
                  const dbCat = dbCategories.find((c) => c.name === catName);
                  const isEditing = editCatId === (dbCat?.id || catName);

                  if (isEditing) {
                    return (
                      <input
                        key={dbCat?.id || catName}
                        autoFocus
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value)}
                        onBlur={async () => {
                          const v = editCatName.trim();
                          if (dbCat && v && v !== catName) {
                            const updated = await authFetch(`/categories/${dbCat.id}`, { method: "PATCH", body: { name: v } }).catch(() => null);
                            if (updated) setDbCategories((prev) => prev.map((c) => (c.id === dbCat.id ? { ...c, ...updated } : c)));
                          }
                          setEditCatId(null);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                        style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid rgba(201,168,118,0.6)", background: "#FDFCFA", fontSize: 13, color: "#6B5540", outline: "none", width: 150 }}
                      />
                    );
                  }

                  return (
                    <div
                      key={dbCat?.id || catName}
                      onClick={() => { if (dbCat) { setEditCatId(dbCat.id); setEditCatName(catName); } }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 14px", borderRadius: 999, background: "rgba(201,168,118,0.15)", border: "1px solid rgba(201,168,118,0.4)", cursor: dbCat ? "pointer" : "default" }}
                    >
                      <span style={{ fontSize: 13, color: "#6B5540" }}>{catName}</span>
                      {dbCat && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!confirm("¿Eliminar esta categoría?")) return;
                            authFetch(`/categories/${dbCat.id}`, { method: "DELETE" })
                              .then(() => { setDbCategories((prev) => prev.filter((c) => c.id !== dbCat.id)); toast.success(`Categoría "${catName}" eliminada`); })
                              .catch((err) => toast.error(err.message || "No se pudo eliminar"));
                          }}
                          style={{ background: "rgba(168,154,135,0.2)", border: "none", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#8C6E50", padding: 0 }}
                          title="Eliminar"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {categories.length === 0 && (
                  <EmptyState
                    icon={<Tag size={26} strokeWidth={1.5} />}
                    title="Sin categorías todavía"
                    body="Crea al menos una categoría antes de añadir servicios o cabinas — se usa para clasificarlos."
                    ctaLabel="Crear categoría"
                    onCta={() => setShowCatForm(true)}
                  />
                )}
              </div>
            </div>

            {/* Cabinas */}
            <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
              <SectionHeader
                title="Cabinas"
                subtitle="Cada servicio puede atenderse en una o varias cabinas. La agenda asigna la cabina libre al reservar."
                onAdd={() => setShowRoomForm(true)}
                addLabel="Añadir cabina"
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rooms.map((r, i, arr) => (
                  <RoomRow
                    key={r.id}
                    r={r}
                    categories={derivedCategories}
                    expanded={expandedRoomId === r.id}
                    onToggleExpand={() => setExpandedRoomId(expandedRoomId === r.id ? null : r.id)}
                    onUpdate={updateRoom}
                    isLast={i === arr.length - 1}
                  />
                ))}
                {rooms.length === 0 && (
                  <EmptyState
                    icon={<DoorOpen size={28} strokeWidth={1.5} />}
                    title="Sin cabinas todavía"
                    body="Cada cabina se vincula con los servicios que puede atender. La agenda elige la cabina disponible al reservar."
                    ctaLabel="Añadir cabina"
                    onCta={() => setShowRoomForm(true)}
                  />
                )}
              </div>
            </div>

            {/* Horario de atención */}
            <div className="alma-card" style={isMobile ? cardPaddingMobile : cardPaddingDesktop}>
              <div style={{ marginBottom: 18 }}>
                <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Horario de atención</h3>
                <p style={{ margin: 0, fontSize: 13, color: "#A89A87" }}>Define cuándo el spa acepta reservas — se aplica a la agenda pública y a la disponibilidad interna.</p>
              </div>
              <BusinessHoursPanel />
            </div>

            {/* Datos en Excel — mención breve */}
            <p style={{ fontSize: 13, color: "#A89A87", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <Upload size={13} /> Subir Excel <Download size={13} style={{ marginLeft: 8 }} /> Descargar respaldo — disponible próximamente
            </p>
          </>
        )}
      </div>

      {serviceAnim.shouldRender && <ServiceFormModal categories={categories} phase={serviceAnim.phase} onClose={() => setShowServiceForm(false)} onSaved={(created) => { setShowServiceForm(false); setServices((prev) => [...prev, created]); }} />}
      {roomAnim.shouldRender && <RoomFormModal categories={derivedCategories} phase={roomAnim.phase} onClose={() => setShowRoomForm(false)} onSaved={(created) => { setShowRoomForm(false); setRooms((prev) => [...prev, created]); }} />}
      {catAnim.shouldRender && <CategoryFormModal phase={catAnim.phase} onClose={() => setShowCatForm(false)} onSaved={(created) => { setShowCatForm(false); setDbCategories((prev) => [...prev, created]); }} />}
    </div>
  );
}
