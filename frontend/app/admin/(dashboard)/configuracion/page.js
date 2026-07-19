"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Download, Edit3, Loader2, Plus, Upload, X } from "lucide-react";

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, margin: "0 16px", background: "#F7F5F0", borderRadius: 16, padding: 28, position: "relative", boxShadow: "0 24px 64px rgba(107,85,64,0.18)" }}>
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

const cardStyle = {
  background: "#F7F5F0",
  border: "1px solid rgba(168,154,135,0.4)",
  borderRadius: 12,
  padding: 24,
};

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: 44, height: 24, borderRadius: 12, border: "none",
        background: checked ? "#C9A876" : "rgba(168,154,135,0.3)",
        position: "relative", cursor: "pointer", transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%",
        background: "#F7F5F0", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }} />
    </button>
  );
}

function ServiceFormModal({ categories, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !category.trim() || !Number(priceUsd)) {
      setError("Nombre, categoría y precio son requeridos");
      return;
    }
    setSaving(true);
    try {
      await authFetch("/services", { method: "POST", body: { name: name.trim(), category: category.trim(), priceUsd: Number(priceUsd), offersHomeService: false } });
      onSaved();
    } catch (err) {
      setError(err.message || "Error al crear servicio");
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuevo servicio" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Masaje relajante" /></div>
        <div>
          <label style={labelStyle}>Categoría / especialidad</label>
          <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="masajes" list="cat-suggestions" />
          {categories.length > 0 && <datalist id="cat-suggestions">{categories.map((c) => <option key={c} value={c} />)}</datalist>}
        </div>
        <div><label style={labelStyle}>Precio (USD)</label><input type="number" step="0.01" style={inputStyle} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="45.00" /></div>
        {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear servicio"}</button>
        </div>
      </form>
    </Modal>
  );
}

function RoomFormModal({ categories, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(categories[0] || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !specialty) {
      setError("Nombre y especialidad son requeridos");
      return;
    }
    setSaving(true);
    try {
      await authFetch("/rooms", { method: "POST", body: { name: name.trim(), specialty } });
      onSaved();
    } catch (err) {
      setError(err.message || "Error al crear gabinete");
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuevo gabinete" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gabinete de masajes" /></div>
        <div>
          <label style={labelStyle}>Especialidad</label>
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear gabinete"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryFormModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("El nombre es requerido"); return; }
    setSaving(true);
    try {
      await authFetch("/categories", { method: "POST", body: { name: name.trim() } });
      onSaved();
    } catch (err) { setError(err.message || "Error al crear categoria"); setSaving(false); }
  }

  return (
    <Modal title="Nueva categoria" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="masajes, faciales, corporales..." autoFocus /></div>
        {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear categoria"}</button>
        </div>
      </form>
    </Modal>
  );
}

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function BusinessHoursPanel({ onRefresh }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("19:00");
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5, 6]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    authFetch("/tenant/config").then((cfg) => {
      if (cfg.businessHours?.start) setStart(cfg.businessHours.start);
      if (cfg.businessHours?.end) setEnd(cfg.businessHours.end);
      if (Array.isArray(cfg.workDays)) setWorkDays(cfg.workDays);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function toggleDay(d) {
    setWorkDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await authFetch("/tenant/config", { method: "PATCH", body: { businessHours: { start, end }, workDays } });
      setSaved(true);
      if (onRefresh) onRefresh();
    } catch {} finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 20, textAlign: "center" }}><Loader2 size={16} className="animate-spin" style={{ color: "#A89A87" }} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Apertura</label>
          <input type="time" value={start} onChange={(e) => { setStart(e.target.value); setSaved(false); }} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Cierre</label>
          <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setSaved(false); }} style={inputStyle} />
        </div>
      </div>
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
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ padding: "8px 22px", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 500, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Guardando…" : "Guardar horario"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "#8C6E50" }}>Guardado</span>}
      </div>
    </div>
  );
}

function RoomRow({ r, categories, expanded, onToggleExpand, onUpdate, isLast }) {
  const [name, setName] = useState(r.name);
  const [specialty, setSpecialty] = useState(r.specialty);
  const [opensAt, setOpensAt] = useState(r.opensAt || "09:00");
  const [closesAt, setClosesAt] = useState(r.closesAt || "19:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(r.name);
    setSpecialty(r.specialty);
    setOpensAt(r.opensAt || "09:00");
    setClosesAt(r.closesAt || "19:00");
  }, [r]);

  const dirty = name !== r.name || specialty !== r.specialty || opensAt !== (r.opensAt || "09:00") || closesAt !== (r.closesAt || "19:00");
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
          <span style={{ fontSize: 12, color: "#A89A87", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.specialty} · {r.opensAt || "09:00"}-{r.closesAt || "19:00"}</span>
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
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dbCategories, setDbCategories] = useState([]);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
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
    setError("");
    try {
      const [s, r, cats] = await Promise.all([authFetch("/services"), authFetch("/rooms"), authFetch("/categories").catch(() => [])]);
      setServices(s);
      setRooms(r);
      setDbCategories(Array.isArray(cats) ? cats : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function updateService(service, changes) {
    await authFetch(`/services/${service.id}`, { method: "PATCH", body: changes });
    await fetchData();
  }

  async function updateRoom(room, changes) {
    await authFetch(`/rooms/${room.id}`, { method: "PATCH", body: changes });
    await fetchData();
  }

  function handleFormSaved(closeFn) {
    closeFn(false);
    fetchData();
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Configuracion</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#A89A87" }}>Servicios, categorias, gabinetes y horario de atencion</p>
        </div>

        {error && <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{error}</div>}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
          </div>
        ) : (
          <>
            {/* Servicios y precios */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 600, color: "#6B5540", margin: 0 }}>Servicios y precios</h3>
                <button onClick={() => setShowServiceForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                  <Plus size={14} /> Anadir servicio
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {services.map((s, i, arr) => {
                  const active = s.active !== false;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none", opacity: active ? 1 : 0.5 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, color: "#6B5540" }}>{s.name}</span>
                          <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(201,168,118,0.18)", color: "#8C6E50" }}>{s.category}</span>
                          {!active && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(194,84,80,0.12)", color: "#C25450" }}>Inactivo</span>}
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#A89A87" }}>1 h{s.offersHomeService ? " · domicilio" : ""}</p>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={Number(s.priceUsd).toFixed(2)}
                        onBlur={(e) => { if (Number(e.target.value) !== Number(s.priceUsd)) updateService(s, { priceUsd: Number(e.target.value) }); }}
                        style={{ width: 84, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", textAlign: "right", fontSize: 13, color: "#6B5540", outline: "none", flexShrink: 0 }}
                      />
                      <button onClick={() => updateService(s, { offersHomeService: !s.offersHomeService })} style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: s.offersHomeService ? "rgba(201,168,118,0.2)" : "transparent", color: "#8C6E50", fontSize: 12, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {s.offersHomeService ? "Domicilio" : "Spa"}
                      </button>
                      <Toggle checked={active} onChange={(val) => updateService(s, { active: val })} />
                    </div>
                  );
                })}
                {services.length === 0 && <p style={{ fontSize: 13, color: "#A89A87", margin: 0 }}>No hay servicios todavia.</p>}
              </div>
            </div>

            {/* Categorias */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 600, color: "#6B5540", margin: 0 }}>Categorias</h3>
                <button onClick={() => setShowCatForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                  <Plus size={14} /> Crear categoria
                </button>
              </div>
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
                            await authFetch(`/categories/${dbCat.id}`, { method: "PATCH", body: { name: v } }).catch(() => null);
                            await fetchData();
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
                          onClick={(e) => { e.stopPropagation(); if (confirm("¿Eliminar esta categoria?")) authFetch(`/categories/${dbCat.id}`, { method: "DELETE" }).then(fetchData); }}
                          style={{ background: "rgba(168,154,135,0.2)", border: "none", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#8C6E50", padding: 0 }}
                          title="Eliminar"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {categories.length === 0 && <p style={{ fontSize: 13, color: "#A89A87", margin: 0 }}>No hay categorias. Crea una para empezar.</p>}
              </div>
            </div>

            {/* Gabinetes */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 600, color: "#6B5540", margin: 0 }}>Gabinetes</h3>
                <button onClick={() => setShowRoomForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                  <Plus size={14} /> Anadir gabinete
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rooms.map((r, i, arr) => (
                  <RoomRow
                    key={r.id}
                    r={r}
                    categories={categories}
                    expanded={expandedRoomId === r.id}
                    onToggleExpand={() => setExpandedRoomId(expandedRoomId === r.id ? null : r.id)}
                    onUpdate={updateRoom}
                    isLast={i === arr.length - 1}
                  />
                ))}
                {rooms.length === 0 && <p style={{ fontSize: 13, color: "#A89A87", margin: 0 }}>No hay gabinetes todavia.</p>}
              </div>
            </div>

            {/* Horario de atencion */}
            <div style={cardStyle}>
              <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 600, color: "#6B5540", margin: "0 0 18px" }}>Horario de atencion</h3>
              <BusinessHoursPanel />
            </div>

            {/* Datos en Excel — mencion breve */}
            <p style={{ fontSize: 13, color: "#A89A87", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <Upload size={13} /> Subir Excel <Download size={13} style={{ marginLeft: 8 }} /> Descargar respaldo — disponible proximamente
            </p>
          </>
        )}
      </div>

      {showServiceForm && <ServiceFormModal categories={categories} onClose={() => setShowServiceForm(false)} onSaved={() => handleFormSaved(setShowServiceForm)} />}
      {showRoomForm && <RoomFormModal categories={categories} onClose={() => setShowRoomForm(false)} onSaved={() => handleFormSaved(setShowRoomForm)} />}
      {showCatForm && <CategoryFormModal onClose={() => setShowCatForm(false)} onSaved={() => handleFormSaved(setShowCatForm)} />}
    </div>
  );
}
