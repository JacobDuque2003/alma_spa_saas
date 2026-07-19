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

function PlanFormModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [sessionsIncluded, setSessionsIncluded] = useState("");
  const [period, setPeriod] = useState("mensual");
  const [priceUsd, setPriceUsd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !Number(sessionsIncluded) || !Number(priceUsd)) {
      setError("Nombre, sesiones y precio son requeridos");
      return;
    }
    setSaving(true);
    try {
      await authFetch("/plans", { method: "POST", body: { name: name.trim(), sessionsIncluded: Number(sessionsIncluded), period, priceUsd: Number(priceUsd), appliesToAllServices: true, includesHomeService: false } });
      onSaved();
    } catch (err) {
      setError(err.message || "Error al crear plan");
      setSaving(false);
    }
  }

  return (
    <Modal title="Nuevo plan" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan mensual masajes" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={labelStyle}>Sesiones</label><input type="number" style={inputStyle} value={sessionsIncluded} onChange={(e) => setSessionsIncluded(e.target.value)} placeholder="4" /></div>
          <div>
            <label style={labelStyle}>Periodo</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
              <option value="mensual">Mensual</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
            </select>
          </div>
        </div>
        <div><label style={labelStyle}>Precio (USD)</label><input type="number" step="0.01" style={inputStyle} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="80.00" /></div>
        {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={pillSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} style={{ ...pillPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "Creando…" : "Crear plan"}</button>
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

export default function ConfiguracionPage() {
  const [services, setServices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dbCategories, setDbCategories] = useState([]);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [editCatId, setEditCatId] = useState(null);
  const [editCatName, setEditCatName] = useState("");

  const derivedCategories = useMemo(() => [...new Set(services.filter((s) => s.active).map((s) => s.category))], [services]);
  const categories = useMemo(() => {
    const dbNames = dbCategories.map((c) => c.name);
    const merged = [...dbNames, ...derivedCategories.filter((d) => !dbNames.includes(d))];
    return merged;
  }, [dbCategories, derivedCategories]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, r, p, cats] = await Promise.all([authFetch("/services"), authFetch("/rooms"), authFetch("/plans"), authFetch("/categories").catch(() => [])]);
      setServices(s);
      setRooms(r);
      setPlans(p);
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

  const cardStyle = {
    background: "#F7F5F0",
    border: "1px solid rgba(168,154,135,0.4)",
    borderRadius: 12,
    padding: 24,
    minHeight: 300,
  };

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto" }}>
      <div>
        <h1 className="font-heading" style={{ fontSize: 30, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Configuracion</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Servicios, gabinetes, planes y respaldo de datos</p>
      </div>

      {error && <div style={{ padding: 12, borderRadius: 8, background: "rgba(194,84,80,0.1)", color: "#C25450", fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Servicios y precios */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>Servicios y precios</h3>
              <button onClick={() => setShowServiceForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                <Plus size={14} /> Anadir servicio
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {services.filter((s) => s.active).map((s, i, arr) => (
                <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, color: "#6B5540" }}>{s.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#A89A87" }}>1 h · {s.category}{s.offersHomeService ? " · domicilio" : ""}</p>
                  </div>
                  <input type="number" step="0.01" defaultValue={Number(s.priceUsd).toFixed(2)} onBlur={(e) => { if (Number(e.target.value) !== Number(s.priceUsd)) updateService(s, { priceUsd: Number(e.target.value) }); }} style={{ width: 90, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", textAlign: "right", fontSize: 13, color: "#6B5540", outline: "none" }} />
                  <button onClick={() => updateService(s, { offersHomeService: !s.offersHomeService })} style={{ padding: "5px 14px", borderRadius: 999, border: "1px solid rgba(168,154,135,0.5)", background: s.offersHomeService ? "rgba(201,168,118,0.2)" : "transparent", color: "#8C6E50", fontSize: 12, cursor: "pointer" }}>
                    {s.offersHomeService ? "Domicilio" : "Spa"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Planes y membresias */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>Planes y membresias</h3>
              <button onClick={() => setShowPlanForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                <Plus size={14} /> Crear plan
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {plans.filter((p) => p.active).map((p) => (
                <div key={p.id} style={{ borderRadius: 12, border: "1px solid rgba(235,205,181,0.6)", background: "rgba(235,205,181,0.2)", padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{p.name}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#A89A87" }}>{p.sessionsIncluded} sesiones · {p.period} · {p.appliesToAllServices ? "cualquier servicio" : "servicios seleccionados"}</p>
                    </div>
                    <b style={{ fontSize: 16, color: "#8C6E50" }}>{money(p.priceUsd)}</b>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Categorias */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>Categorias</h3>
              <button onClick={() => setShowCatForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                <Plus size={14} /> Crear categoria
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {categories.map((catName, i) => {
                const dbCat = dbCategories.find((c) => c.name === catName);
                const isEditing = editCatId === (dbCat?.id || catName);
                return (
                  <div key={dbCat?.id || catName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 0", borderBottom: i < categories.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none" }}>
                    {isEditing ? (
                      <input
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
                        style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(201,168,118,0.6)", background: "#FDFCFA", fontSize: 14, color: "#6B5540", outline: "none", flex: 1 }}
                      />
                    ) : (
                      <span style={{ fontSize: 14, color: "#6B5540" }}>{catName}</span>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      {dbCat && (
                        <>
                          <button onClick={() => { setEditCatId(dbCat.id); setEditCatName(catName); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A89A87", padding: 4 }} title="Editar nombre">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => { if (confirm("¿Eliminar esta categoria?")) authFetch(`/categories/${dbCat.id}`, { method: "DELETE" }).then(fetchData); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A89A87", padding: 4 }} title="Eliminar">
                            <X size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {categories.length === 0 && <p style={{ fontSize: 13, color: "#A89A87", margin: 0 }}>No hay categorias. Crea una para empezar.</p>}
            </div>
          </div>

          {/* Gabinetes */}
          <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>Gabinetes</h3>
              <button onClick={() => setShowRoomForm(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 13, cursor: "pointer" }}>
                <Plus size={14} /> Anadir gabinete
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rooms.filter((r) => r.active).map((r, i, arr) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto auto", alignItems: "center", gap: 10, padding: "14px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(168,154,135,0.3)" : "none" }}>
                  <input
                    defaultValue={r.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) updateRoom(r, { name: v }); }}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", fontSize: 14, color: "#6B5540", outline: "none", minWidth: 0 }}
                  />
                  <select value={r.specialty} onChange={(e) => updateRoom(r, { specialty: e.target.value })} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", fontSize: 13, color: "#6B5540", outline: "none" }}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="time" defaultValue={r.opensAt || "09:00"} onBlur={(e) => { if (e.target.value !== r.opensAt) updateRoom(r, { opensAt: e.target.value }); }} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", fontSize: 13, color: "#6B5540", outline: "none" }} title="Hora de apertura" />
                  <span style={{ fontSize: 12, color: "#A89A87" }}>a</span>
                  <input type="time" defaultValue={r.closesAt || "19:00"} onBlur={(e) => { if (e.target.value !== r.closesAt) updateRoom(r, { closesAt: e.target.value }); }} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(168,154,135,0.5)", background: "#FDFCFA", fontSize: 13, color: "#6B5540", outline: "none" }} title="Hora de cierre" />
                  <button onClick={() => { if (confirm("¿Desactivar este gabinete?")) authFetch(`/rooms/${r.id}`, { method: "DELETE" }).then(fetchData); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#A89A87", padding: 4 }} title="Desactivar">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Horario de atencion */}
          <div style={cardStyle}>
            <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 18px" }}>Horario de atencion</h3>
            <BusinessHoursPanel />
          </div>

          {/* Datos en Excel */}
          <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
            <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: "0 0 18px" }}>Datos en Excel</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ExcelBox icon={Upload} title="Subir Excel para actualizar" body="Disponible proximamente." button="Subir Excel" />
              <ExcelBox icon={Download} title="Descargar respaldo completo" body="Disponible proximamente." button="Descargar respaldo" />
            </div>
          </div>
        </div>
      )}

      {showServiceForm && <ServiceFormModal categories={categories} onClose={() => setShowServiceForm(false)} onSaved={() => handleFormSaved(setShowServiceForm)} />}
      {showRoomForm && <RoomFormModal categories={categories} onClose={() => setShowRoomForm(false)} onSaved={() => handleFormSaved(setShowRoomForm)} />}
      {showPlanForm && <PlanFormModal onClose={() => setShowPlanForm(false)} onSaved={() => handleFormSaved(setShowPlanForm)} />}
      {showCatForm && <CategoryFormModal onClose={() => setShowCatForm(false)} onSaved={() => handleFormSaved(setShowCatForm)} />}
    </div>
  );
}

function ExcelBox({ icon: Icon, title, body, button }) {
  return (
    <div style={{ borderRadius: 12, border: "1.5px dashed rgba(168,154,135,0.5)", padding: 20, display: "flex", flexDirection: "column" }}>
      <Icon size={18} style={{ marginBottom: 12, color: "#8C6E50" }} />
      <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{title}</p>
      <p style={{ margin: 0, fontSize: 12, color: "#A89A87" }}>{body}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <button disabled style={{ padding: "7px 16px", borderRadius: 999, background: "#8C6E50", color: "#F7F5F0", border: "none", fontSize: 13, opacity: 0.5, cursor: "not-allowed" }}>{button}</button>
        <span style={{ padding: "3px 10px", borderRadius: 999, background: "rgba(201,168,118,0.2)", color: "#8C6E50", fontSize: 11, fontWeight: 500 }}>Proximamente</span>
      </div>
    </div>
  );
}
