"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/auth-client";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  FlaskConical,
  Gauge,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

const COLORS = {
  ink: "#5F4B36",
  text: "#6B5540",
  muted: "#927F6C",
  line: "rgba(168,154,135,0.28)",
  paper: "#FFFDF9",
  page: "#FDFCFA",
  accent: "#8C6E50",
  accentSoft: "#F2E8DC",
  success: "#4E7A32",
  danger: "#A5483F",
};

const TABS = [
  { id: "overview", label: "Resumen", icon: BarChart3 },
  { id: "knowledge", label: "Información", icon: BookOpen },
  { id: "examples", label: "Ejemplos", icon: MessageSquareText },
  { id: "simulator", label: "Simulador", icon: FlaskConical },
  { id: "settings", label: "Ajustes", icon: Settings2 },
];

const EMPTY_CONFIG = {
  personality: "Cálida, breve, serena y profesional.",
  instructions: "",
  dailyBriefing: "",
  active: true,
};

const fieldStyle = {
  width: "100%",
  minHeight: 42,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  background: COLORS.paper,
  color: COLORS.text,
  padding: "10px 12px",
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",
};

const buttonBase = {
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 8,
  padding: "0 14px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function unwrapOverview(data) {
  const root = data?.overview || data || {};
  return {
    ...root,
    config: { ...EMPTY_CONFIG, ...(root.config || {}) },
    knowledge: asList(root.knowledge || root.knowledgeItems),
    examples: asList(root.examples || root.trainingExamples),
    metrics: root.metrics || root.stats || {},
  };
}

function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(number);
}

function formatDate(value) {
  if (!value) return "Sin actividad";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin actividad";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 14, border: "1px solid rgba(165,72,63,.28)", borderRadius: 8, color: COLORS.danger, background: "#FFF7F5" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}><AlertCircle size={17} />{message}</span>
      {onRetry && <ActionButton variant="secondary" onClick={onRetry}><RefreshCw size={15} />Reintentar</ActionButton>}
    </div>
  );
}

function ActionButton({ variant = "primary", disabled, style, children, ...props }) {
  const variants = {
    primary: { border: "1px solid transparent", background: disabled ? "#C8B8A7" : COLORS.accent, color: "#FFFDF9" },
    secondary: { border: `1px solid ${COLORS.line}`, background: COLORS.paper, color: COLORS.text },
    danger: { border: "1px solid rgba(165,72,63,.25)", background: "#FFF7F5", color: COLORS.danger },
    ghost: { border: "1px solid transparent", background: "transparent", color: COLORS.muted },
  };
  return <button type="button" disabled={disabled} style={{ ...buttonBase, ...variants[variant], cursor: disabled ? "default" : "pointer", ...style }} {...props}>{children}</button>;
}

function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div style={{ minHeight: 230, display: "grid", placeItems: "center", padding: 24, border: `1px dashed ${COLORS.line}`, borderRadius: 8, background: COLORS.paper, textAlign: "center" }}>
      <div style={{ maxWidth: 420 }}>
        <Icon size={30} color={COLORS.accent} />
        <h3 style={{ margin: "12px 0 6px", color: COLORS.text, fontSize: 17 }}>{title}</h3>
        <p style={{ margin: "0 0 16px", color: COLORS.muted, fontSize: 13, lineHeight: 1.6 }}>{text}</p>
        {action}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }) {
  return (
    <div style={{ display: "grid", gap: 10, minHeight: 132, padding: 18, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper }}>
      <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 8, color: COLORS.accent, background: COLORS.accentSoft }}><Icon size={18} /></span>
      <div><strong style={{ display: "block", color: COLORS.ink, fontSize: 23 }}>{value}</strong><span style={{ color: COLORS.text, fontSize: 13, fontWeight: 700 }}>{label}</span></div>
      {detail && <span style={{ color: COLORS.muted, fontSize: 12 }}>{detail}</span>}
    </div>
  );
}

function OverviewTab({ overview, setTab }) {
  const metrics = overview.metrics || {};
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12 }}>
        <Metric icon={BookOpen} label="Fuentes activas" value={metrics.activeKnowledge ?? overview.knowledge.length} detail={`${metrics.knowledgeCount ?? overview.knowledge.length} registradas`} />
        <Metric icon={MessageSquareText} label="Ejemplos aprobados" value={metrics.activeExamples ?? overview.examples.length} detail="Casos que orientan a Almita" />
        <Metric icon={Gauge} label="Aciertos de caché" value={`${metrics.cacheHitRate ?? 0}%`} detail="Respuestas reutilizadas" />
        <Metric icon={CircleDollarSign} label="Costo este mes" value={formatMoney(metrics.monthCostUsd)} detail={`${metrics.monthTokens ?? 0} tokens`} />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 16 }}>
        <div style={{ padding: 20, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div><h2 style={{ margin: 0, color: COLORS.text, fontSize: 18 }}>Preparación de Almita</h2><p style={{ margin: "6px 0 0", color: COLORS.muted, fontSize: 13 }}>Elementos necesarios antes de publicar respuestas.</p></div>
            <Sparkles size={20} color={COLORS.accent} />
          </div>
          <div style={{ display: "grid", gap: 4, marginTop: 16 }}>
            <Readiness label="Personalidad configurada" done={Boolean(overview.config.systemInstructions || overview.config.tone)} onClick={() => setTab("settings")} />
            <Readiness label="Conocimiento cargado" done={overview.knowledge.length > 0} onClick={() => setTab("knowledge")} />
            <Readiness label="Ejemplos de respuesta" done={overview.examples.length > 0} onClick={() => setTab("examples")} />
            <Readiness label="Prueba reciente" done={Boolean(metrics.lastSimulationAt)} onClick={() => setTab("simulator")} />
          </div>
        </div>
        <div style={{ padding: 20, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper }}>
          <h2 style={{ margin: 0, color: COLORS.text, fontSize: 18 }}>Actividad técnica</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px 16px", margin: "18px 0 0", fontSize: 13 }}>
            <dt style={{ color: COLORS.muted }}>Última simulación</dt><dd style={{ margin: 0, color: COLORS.text, fontWeight: 700 }}>{formatDate(metrics.lastSimulationAt)}</dd>
            <dt style={{ color: COLORS.muted }}>Respuestas con IA</dt><dd style={{ margin: 0, color: COLORS.text, fontWeight: 700 }}>{metrics.aiResponses ?? 0}</dd>
            <dt style={{ color: COLORS.muted }}>Respuestas determinísticas</dt><dd style={{ margin: 0, color: COLORS.text, fontWeight: 700 }}>{metrics.deterministicResponses ?? 0}</dd>
            <dt style={{ color: COLORS.muted }}>Transferencias a asesor</dt><dd style={{ margin: 0, color: COLORS.text, fontWeight: 700 }}>{metrics.handoffs ?? 0}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

function Readiness({ label, done, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 6px", border: 0, borderBottom: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.text, cursor: "pointer", textAlign: "left" }}>
      {done ? <CheckCircle2 size={17} color={COLORS.success} /> : <Clock3 size={17} color={COLORS.muted} />}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{label}</span><ChevronRight size={15} color={COLORS.muted} />
    </button>
  );
}

function KnowledgeTab({ rows, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function remove(row) {
    if (!window.confirm(`¿Eliminar “${row.title || row.question || "esta fuente"}”?`)) return;
    setBusyId(row.id); setError("");
    try { await authFetch(`/almita-center/knowledge/${row.id}`, { method: "DELETE" }); onChanged(rows.filter((item) => item.id !== row.id)); }
    catch (err) { setError(err.message || "No se pudo eliminar la fuente"); }
    finally { setBusyId(""); }
  }

  async function save(draft) {
    setBusyId(draft.id || "new"); setError("");
    try {
      const payload = { title: draft.title, category: draft.category, content: draft.content, active: draft.active, priority: draft.priority ?? 50, source: draft.source || "Centro de Almita" };
      const saved = await authFetch(draft.id ? `/almita-center/knowledge/${draft.id}` : "/almita-center/knowledge", { method: draft.id ? "PATCH" : "POST", body: payload });
      const item = saved.knowledge || saved.item || saved;
      onChanged(draft.id ? rows.map((row) => row.id === draft.id ? item : row) : [item, ...rows]);
      setEditing(null);
    } catch (err) { setError(err.message || "No se pudo guardar la fuente"); }
    finally { setBusyId(""); }
  }

  if (editing) return <KnowledgeForm initial={editing === "new" ? {} : editing} onCancel={() => setEditing(null)} onSave={save} saving={Boolean(busyId)} error={error} />;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <SectionToolbar title="Información que Almita puede consultar" text="Fichas aprobadas sobre servicios, políticas y atención. Almita utiliza únicamente las relacionadas con cada pregunta." action={<ActionButton onClick={() => setEditing("new")}><Plus size={16} />Nueva ficha</ActionButton>} />
      <div style={{ display: "flex", gap: 10, padding: 14, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: "#F7F3ED", color: COLORS.text, fontSize: 13, lineHeight: 1.55 }}>
        <Database size={18} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <span><strong>No entrena ni modifica el modelo original.</strong> Estas fichas funcionan como una biblioteca privada: al llegar una consulta, el sistema selecciona unas pocas fuentes relevantes para responder con información real y gastar menos tokens.</span>
      </div>
      <ErrorBanner message={error} />
      {rows.length === 0 ? <EmptyState icon={BookOpen} title="Aún no hay información aprobada" text="Agrega servicios, políticas, preguntas frecuentes o instrucciones operativas." action={<ActionButton onClick={() => setEditing("new")}><Plus size={16} />Agregar primera ficha</ActionButton>} /> : (
        <div style={{ display: "grid", border: `1px solid ${COLORS.line}`, borderRadius: 8, overflow: "hidden", background: COLORS.paper }}>
          {rows.map((row) => <ListRow key={row.id} title={row.title || row.question || "Sin título"} subtitle={row.category || row.type || "General"} body={row.content || row.answer || row.description} active={row.active !== false} busy={busyId === row.id} onEdit={() => setEditing(row)} onDelete={() => remove(row)} />)}
        </div>
      )}
    </div>
  );
}

function KnowledgeForm({ initial, onCancel, onSave, saving, error }) {
  const [draft, setDraft] = useState({ id: initial.id, title: initial.title || initial.question || "", category: initial.category || "General", content: initial.content || initial.answer || "", active: initial.active !== false });
  return <Editor title={initial.id ? "Editar ficha" : "Nueva ficha"} description="Escribe información concreta y aprobada. No incluyas contraseñas, tokens ni claves." onCancel={onCancel} onSave={() => onSave(draft)} saving={saving} valid={draft.title.trim() && draft.content.trim()} error={error}>
    <FormField label="Título"><input style={fieldStyle} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ej. Política de cancelaciones" /></FormField>
    <FormField label="Categoría"><input style={fieldStyle} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Servicios, políticas, preguntas frecuentes..." /></FormField>
    <FormField label="Contenido aprobado" hint="Almita utilizará este texto como fuente, no como una orden del usuario."><textarea rows={9} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></FormField>
    <Toggle checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} label="Fuente activa" />
  </Editor>;
}

function ExamplesTab({ rows, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function save(draft) {
    setBusyId(draft.id || "new"); setError("");
    try {
      const payload = { userMessage: draft.userMessage, expectedIntent: draft.expectedIntent, expectedReply: draft.expectedReply, active: draft.active };
      const saved = await authFetch(draft.id ? `/almita-center/examples/${draft.id}` : "/almita-center/examples", { method: draft.id ? "PATCH" : "POST", body: payload });
      const item = saved.example || saved.item || saved;
      onChanged(draft.id ? rows.map((row) => row.id === draft.id ? item : row) : [item, ...rows]); setEditing(null);
    } catch (err) { setError(err.message || "No se pudo guardar el ejemplo"); }
    finally { setBusyId(""); }
  }
  async function remove(row) {
    if (!window.confirm("¿Eliminar este ejemplo?")) return;
    setBusyId(row.id); setError("");
    try { await authFetch(`/almita-center/examples/${row.id}`, { method: "DELETE" }); onChanged(rows.filter((item) => item.id !== row.id)); }
    catch (err) { setError(err.message || "No se pudo eliminar el ejemplo"); }
    finally { setBusyId(""); }
  }
  if (editing) return <ExampleForm initial={editing === "new" ? {} : editing} onCancel={() => setEditing(null)} onSave={save} saving={Boolean(busyId)} error={error} />;
  return <div style={{ display: "grid", gap: 14 }}>
    <SectionToolbar title="Ejemplos aprobados" text="Enséñale cómo interpretar una frase y cuál sería una respuesta adecuada." action={<ActionButton onClick={() => setEditing("new")}><Plus size={16} />Nuevo ejemplo</ActionButton>} />
    <ErrorBanner message={error} />
    {rows.length === 0 ? <EmptyState icon={MessageSquareText} title="No hay ejemplos todavía" text="Registra casos reales, especialmente frases ambiguas o respuestas que antes fallaron." action={<ActionButton onClick={() => setEditing("new")}><Plus size={16} />Crear ejemplo</ActionButton>} /> : <div style={{ display: "grid", border: `1px solid ${COLORS.line}`, borderRadius: 8, overflow: "hidden", background: COLORS.paper }}>{rows.map((row) => <ListRow key={row.id} title={row.userMessage || "Mensaje sin texto"} subtitle={`Intención: ${row.expectedIntent || "sin clasificar"}`} body={row.expectedReply} active={row.active !== false} busy={busyId === row.id} onEdit={() => setEditing(row)} onDelete={() => remove(row)} />)}</div>}
  </div>;
}

function ExampleForm({ initial, onCancel, onSave, saving, error }) {
  const [draft, setDraft] = useState({ id: initial.id, userMessage: initial.userMessage || "", expectedIntent: initial.expectedIntent || "unclear", expectedReply: initial.expectedReply || "", active: initial.active !== false });
  return <Editor title={initial.id ? "Editar ejemplo" : "Nuevo ejemplo"} description="Usa una frase real y una respuesta breve, útil y segura." onCancel={onCancel} onSave={() => onSave(draft)} saving={saving} valid={draft.userMessage.trim() && draft.expectedIntent.trim() && draft.expectedReply.trim()} error={error}>
    <FormField label="Mensaje del cliente"><textarea rows={3} style={{ ...fieldStyle, resize: "vertical" }} value={draft.userMessage} onChange={(e) => setDraft({ ...draft, userMessage: e.target.value })} placeholder="Quiero reservar un masaje relajante" /></FormField>
    <FormField label="Intención esperada"><select style={fieldStyle} value={draft.expectedIntent} onChange={(e) => setDraft({ ...draft, expectedIntent: e.target.value })}>{["greeting", "list_services", "service_info", "suggest_service", "book_start", "book_service", "my_appointment", "reschedule", "cancel", "business_hours", "location", "farewell", "escalate", "chitchat", "unclear"].map((intent) => <option key={intent} value={intent}>{intent}</option>)}</select></FormField>
    <FormField label="Respuesta ideal"><textarea rows={7} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }} value={draft.expectedReply} onChange={(e) => setDraft({ ...draft, expectedReply: e.target.value })} /></FormField>
    <Toggle checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} label="Ejemplo activo" />
  </Editor>;
}

function SimulatorTab() {
  const [messages, setMessages] = useState([{ role: "assistant", text: "Hola, soy Almita. Escribe un mensaje para probar cómo respondería sin enviarlo a WhatsApp." }]);
  const [input, setInput] = useState("");
  const [diagnostic, setDiagnostic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    const text = input.trim(); if (!text || loading) return;
    const next = [...messages, { role: "user", text }]; setMessages(next); setInput(""); setLoading(true); setError("");
    try {
      const data = await authFetch("/almita-center/simulate", { method: "POST", body: { message: text, history: next.slice(-8).map(({ role, text: content }) => ({ role, content })) } });
      const reply = data.reply || data.response || data.message || "No se generó una respuesta.";
      setMessages([...next, { role: "assistant", text: reply }]); setDiagnostic(data.diagnostic || data.debug || data);
    } catch (err) { setError(err.message || "No se pudo ejecutar la simulación"); }
    finally { setLoading(false); }
  }
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(260px, .7fr)", gap: 16 }} className="almita-simulator-grid">
    <section style={{ minHeight: 560, display: "flex", flexDirection: "column", border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${COLORS.line}`, color: COLORS.text }}><strong>Conversación de prueba</strong><span style={{ display: "block", marginTop: 3, color: COLORS.muted, fontSize: 12 }}>No se envían mensajes ni se crean citas reales.</span></div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: 16, overflowY: "auto", background: "#FAF7F2" }}>
        {messages.map((message, index) => <div key={`${message.role}-${index}`} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", maxWidth: "82%", padding: "10px 12px", borderRadius: 8, background: message.role === "user" ? COLORS.accent : "#FFFFFF", color: message.role === "user" ? "#FFFFFF" : COLORS.text, boxShadow: "0 3px 10px rgba(107,85,64,.07)", whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{message.text}</div>)}
        {loading && <div style={{ alignSelf: "flex-start", display: "flex", gap: 7, padding: 10, color: COLORS.muted }}><Loader2 size={16} className="animate-spin" />Almita está preparando la respuesta...</div>}
      </div>
      <ErrorBanner message={error} />
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${COLORS.line}` }}>
        <textarea aria-label="Mensaje de prueba" rows={2} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ej. ¿Qué fechas tienen disponibles?" style={{ ...fieldStyle, minHeight: 48, resize: "none" }} />
        <ActionButton onClick={send} disabled={!input.trim() || loading} style={{ alignSelf: "stretch", minWidth: 48, padding: 0 }} aria-label="Enviar prueba"><Send size={17} /></ActionButton>
      </div>
    </section>
    <DiagnosticPanel data={diagnostic} onClear={() => { setMessages([{ role: "assistant", text: "Simulación reiniciada. Escribe otro caso para probar." }]); setDiagnostic(null); setError(""); }} />
  </div>;
}

function DiagnosticPanel({ data, onClear }) {
  const sources = asList(data?.sources || data?.knowledgeSources);
  const usage = data?.usage || {};
  return <aside style={{ alignSelf: "start", border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper, overflow: "hidden" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${COLORS.line}` }}><strong style={{ color: COLORS.text }}>Diagnóstico</strong><ActionButton variant="ghost" onClick={onClear} style={{ minHeight: 30, padding: "0 6px" }} title="Limpiar simulación"><RefreshCw size={15} /></ActionButton></div>
    {!data ? <div style={{ padding: 24, color: COLORS.muted, fontSize: 13, lineHeight: 1.6 }}>Aquí aparecerán la intención detectada, fuentes consultadas y consumo estimado.</div> : <div style={{ display: "grid", gap: 0 }}>
      <Diagnostic label="Intención" value={data.intent || data.detectedIntent || "No clasificada"} />
      <Diagnostic label="Ruta" value={data.handler || data.route || data.mode || "IA"} />
      <Diagnostic label="Confianza" value={data.confidence != null ? `${Math.round(Number(data.confidence) * (Number(data.confidence) <= 1 ? 100 : 1))}%` : "No informada"} />
      <Diagnostic label="Tokens" value={usage.totalTokens ?? data.tokens ?? 0} />
      <Diagnostic label="Costo estimado" value={formatMoney(usage.costUsd ?? data.costUsd)} />
      <div style={{ padding: 14, borderTop: `1px solid ${COLORS.line}` }}><span style={{ display: "block", color: COLORS.muted, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Fuentes</span>{sources.length ? <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: COLORS.text, fontSize: 12 }}>{sources.map((source, index) => <li key={source.id || index} style={{ marginBottom: 5 }}>{source.title || source.name || String(source)}</li>)}</ul> : <p style={{ margin: "7px 0 0", color: COLORS.muted, fontSize: 12 }}>No utilizó fuentes registradas.</p>}</div>
    </div>}
  </aside>;
}

function Diagnostic({ label, value }) { return <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "12px 14px", borderTop: `1px solid ${COLORS.line}`, fontSize: 12 }}><span style={{ color: COLORS.muted }}>{label}</span><strong style={{ color: COLORS.text, textAlign: "right", overflowWrap: "anywhere" }}>{String(value)}</strong></div>; }

function SettingsTab({ config, onSaved }) {
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  useEffect(() => setDraft(config), [config]);
  async function save() {
    setSaving(true); setStatus({ type: "", message: "" });
    try {
      const data = await authFetch(draft.id ? `/almita-center/configurations/${draft.id}` : "/almita-center/configurations", { method: draft.id ? "PATCH" : "POST", body: { personality: draft.personality, instructions: draft.instructions, dailyBriefing: draft.dailyBriefing, active: draft.active !== false } });
      onSaved({ ...EMPTY_CONFIG, ...data });
      setStatus({ type: "success", message: "Ajustes guardados." });
    }
    catch (err) { setStatus({ type: "error", message: err.message || "No se pudieron guardar los ajustes" }); }
    finally { setSaving(false); }
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <div style={{ padding: 16, display: "flex", gap: 10, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: "#F7F3ED", color: COLORS.text, fontSize: 13, lineHeight: 1.55 }}><ShieldCheck size={19} style={{ flex: "0 0 auto" }} /><span>Solo soporte técnico puede ver y editar esta configuración. Esta pantalla nunca muestra claves, tokens ni secretos de integración.</span></div>
    <section style={{ display: "grid", gap: 16, padding: 20, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper }}>
      <FormField label="Personalidad y tono"><textarea rows={4} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }} value={draft.personality || ""} onChange={(e) => setDraft({ ...draft, personality: e.target.value })} /></FormField>
      <FormField label="Instrucciones permanentes" hint="Define límites y criterios. No pegues credenciales."><textarea rows={7} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }} value={draft.instructions || ""} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></FormField>
      <FormField label="Briefing diario" hint="Información operativa que debe revisar cada día: prioridades, campañas y avisos temporales."><textarea rows={6} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }} value={draft.dailyBriefing || ""} onChange={(e) => setDraft({ ...draft, dailyBriefing: e.target.value })} /></FormField>
      <Toggle checked={draft.active !== false} onChange={(active) => setDraft({ ...draft, active })} label="Configuración activa" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><span style={{ color: status.type === "error" ? COLORS.danger : COLORS.success, fontSize: 13, fontWeight: 700 }}>{status.message}</span><ActionButton onClick={save} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Guardar ajustes</ActionButton></div>
    </section>
  </div>;
}

function SectionToolbar({ title, text, action }) { return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2 style={{ margin: 0, color: COLORS.text, fontSize: 19 }}>{title}</h2><p style={{ margin: "5px 0 0", color: COLORS.muted, fontSize: 13 }}>{text}</p></div>{action}</div>; }

function ListRow({ title, subtitle, body, active, busy, onEdit, onDelete }) { return <article style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: 16, borderBottom: `1px solid ${COLORS.line}` }}><div style={{ minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><strong style={{ color: COLORS.text, fontSize: 14 }}>{title}</strong><span style={{ padding: "3px 7px", borderRadius: 999, color: active ? COLORS.success : COLORS.muted, background: active ? "#EEF5E8" : "#F1EFEB", fontSize: 10, fontWeight: 800 }}>{active ? "ACTIVO" : "PAUSADO"}</span></div><span style={{ display: "block", marginTop: 4, color: COLORS.muted, fontSize: 11, fontWeight: 700 }}>{subtitle}</span>{body && <p style={{ margin: "8px 0 0", color: COLORS.text, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{body}</p>}</div><div style={{ display: "flex", gap: 4, alignSelf: "center" }}><ActionButton variant="ghost" onClick={onEdit} title="Editar" aria-label="Editar" style={{ minWidth: 38, padding: 0 }}><Pencil size={15} /></ActionButton><ActionButton variant="ghost" onClick={onDelete} disabled={busy} title="Eliminar" aria-label="Eliminar" style={{ minWidth: 38, padding: 0, color: COLORS.danger }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}</ActionButton></div></article>; }

function Editor({ title, description, onCancel, onSave, saving, valid, error, children }) { return <section style={{ display: "grid", gap: 16, maxWidth: 820, padding: 20, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: COLORS.paper }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}><div><h2 style={{ margin: 0, color: COLORS.text, fontSize: 19 }}>{title}</h2><p style={{ margin: "5px 0 0", color: COLORS.muted, fontSize: 13 }}>{description}</p></div><ActionButton variant="ghost" onClick={onCancel} aria-label="Cerrar editor" style={{ minWidth: 38, padding: 0 }}><X size={17} /></ActionButton></div><ErrorBanner message={error} />{children}<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}><ActionButton variant="secondary" onClick={onCancel}>Cancelar</ActionButton><ActionButton onClick={onSave} disabled={!valid || saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Guardar</ActionButton></div></section>; }

function FormField({ label, hint, children }) { return <label style={{ display: "grid", gap: 6, color: COLORS.text, fontSize: 12, fontWeight: 800 }}>{label}{children}{hint && <span style={{ color: COLORS.muted, fontSize: 11, fontWeight: 500, lineHeight: 1.45 }}>{hint}</span>}</label>; }

function Toggle({ checked, onChange, label }) { return <label style={{ display: "inline-flex", alignItems: "center", gap: 9, color: COLORS.text, fontSize: 13, fontWeight: 700, cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 17, height: 17, accentColor: COLORS.accent }} />{label}</label>; }

export default function AlmitaCenterPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [configurationData, knowledgeData, examplesData, metrics] = await Promise.all([
        authFetch("/almita-center/configuration"),
        authFetch("/almita-center/knowledge"),
        authFetch("/almita-center/examples"),
        authFetch("/almita-center/metrics"),
      ]);
      setOverview(unwrapOverview({
        config: configurationData.configuration,
        knowledge: knowledgeData.knowledge,
        examples: examplesData.examples,
        metrics: {
          ...metrics,
          monthCostUsd: metrics.costUsd,
          monthTokens: metrics.totalTokens,
          aiResponses: metrics.interactions,
        },
      }));
    }
    catch (err) { setError(err.message || "No se pudo cargar el Centro de Almita"); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!authLoading && user?.role === "superadmin") load(); else if (!authLoading) setLoading(false); }, [authLoading, user?.role]);

  const activeTab = useMemo(() => TABS.find((item) => item.id === tab), [tab]);
  if (authLoading) return <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: COLORS.muted }}><Loader2 size={24} className="animate-spin" /></div>;
  if (!user || user.role !== "superadmin") return <main style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 24, background: COLORS.page }}><div style={{ maxWidth: 430, textAlign: "center" }}><ShieldCheck size={34} color={COLORS.accent} /><h1 style={{ color: COLORS.text, fontSize: 22 }}>Acceso exclusivo de soporte</h1><p style={{ color: COLORS.muted, lineHeight: 1.6 }}>El Centro de Almita contiene configuración técnica y solo está disponible para el usuario superadministrador.</p></div></main>;

  return <main style={{ minHeight: "100%", padding: "24px clamp(14px, 3vw, 36px) 40px", background: COLORS.page }}>
    <style>{`@media (max-width: 780px){.almita-simulator-grid{grid-template-columns:1fr!important}.almita-tabs{overflow-x:auto;justify-content:flex-start!important}.almita-tabs button{flex:0 0 auto}.almita-header{align-items:flex-start!important}.almita-header-badge{display:none!important}}`}</style>
    <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 18 }}>
      <header className="almita-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 8, color: "#FFF", background: COLORS.accent }}><Bot size={22} /></span><div><h1 className="font-heading" style={{ margin: 0, color: COLORS.ink, fontSize: "clamp(25px, 3vw, 34px)" }}>Centro de Almita</h1><p style={{ margin: "3px 0 0", color: COLORS.muted, fontSize: 13 }}>Configura, enseña y prueba las respuestas del asistente.</p></div></div>
        <span className="almita-header-badge" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 11px", border: `1px solid ${COLORS.line}`, borderRadius: 999, color: COLORS.text, background: COLORS.paper, fontSize: 12, fontWeight: 800 }}><ShieldCheck size={15} />Solo soporte</span>
      </header>
      <nav className="almita-tabs" aria-label="Secciones del Centro de Almita" style={{ display: "flex", justifyContent: "flex-start", gap: 4, padding: 4, border: `1px solid ${COLORS.line}`, borderRadius: 8, background: "#F5F1EB" }}>
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} style={{ flex: 1, minWidth: 120, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: 0, borderRadius: 6, background: tab === id ? COLORS.paper : "transparent", color: tab === id ? COLORS.text : COLORS.muted, boxShadow: tab === id ? "0 2px 8px rgba(107,85,64,.08)" : "none", fontSize: 12, fontWeight: 800, cursor: "pointer" }}><Icon size={15} />{label}</button>)}
      </nav>
      {loading && <div style={{ minHeight: 330, display: "grid", placeItems: "center", color: COLORS.muted }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={19} className="animate-spin" />Cargando configuración...</span></div>}
      {!loading && error && <ErrorBanner message={error} onRetry={load} />}
      {!loading && !error && overview && <section aria-label={activeTab?.label}>
        {tab === "overview" && <OverviewTab overview={overview} setTab={setTab} />}
        {tab === "knowledge" && <KnowledgeTab rows={overview.knowledge} onChanged={(knowledge) => setOverview((current) => ({ ...current, knowledge }))} />}
        {tab === "examples" && <ExamplesTab rows={overview.examples} onChanged={(examples) => setOverview((current) => ({ ...current, examples }))} />}
        {tab === "simulator" && <SimulatorTab />}
        {tab === "settings" && <SettingsTab config={overview.config} onSaved={(config) => setOverview((current) => ({ ...current, config }))} />}
      </section>}
    </div>
  </main>;
}
