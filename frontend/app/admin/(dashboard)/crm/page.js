"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import {
  Loader2, Send, Settings, X, ArrowLeft, Bot, UserRound, Search,
  MessageSquare, StickyNote, Tag, Phone, Calendar, Hash, ChevronRight,
  Plus, Trash2, RefreshCw,
} from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useToast } from "@/components/toast-provider";

const LABEL_CONFIG = {
  consulta:          { text: "Consulta",          bg: "bg-blue-100",    fg: "text-blue-700",    dot: "bg-blue-500" },
  reserva_pendiente: { text: "Reserva pendiente", bg: "bg-amber-100",   fg: "text-amber-700",   dot: "bg-amber-500" },
  cita_confirmada:   { text: "Cita confirmada",   bg: "bg-emerald-100", fg: "text-emerald-700", dot: "bg-emerald-500" },
  seguimiento:       { text: "Seguimiento",        bg: "bg-purple-100",  fg: "text-purple-700",  dot: "bg-purple-500" },
  queja:             { text: "Queja",              bg: "bg-red-100",     fg: "text-red-700",     dot: "bg-red-500" },
  nueva_clienta:     { text: "Nueva clienta",     bg: "bg-sky-100",     fg: "text-sky-700",     dot: "bg-sky-500" },
};

const FILTERS = [
  { id: "all",        label: "Todos" },
  { id: "pending",    label: "Pendientes" },
  { id: "bot_active", label: "Bot activo" },
  { id: "bot_off",    label: "Resueltos" },
];

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "WA";
}

function timeStr(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-EC", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil",
  });
}

function dateStr(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-EC", {
    day: "2-digit", month: "short", timeZone: "America/Guayaquil",
  });
}

const QUICK_REPLIES_DEFAULT = [
  { icon: "👋", title: "Saludo", text: "Hola, gracias por escribir a Alma Spa. ¿En qué podemos ayudarte?" },
  { icon: "✅", title: "Confirmar", text: "Perfecto, tu cita queda confirmada. Te esperamos con mucho gusto." },
  { icon: "🕐", title: "Horario", text: "Nuestro horario es de lunes a sábado de 9:00 a 19:00." },
  { icon: "💆", title: "Agendar", text: "Claro, podemos ayudarte a agendar una cita. ¿Qué día y horario te queda mejor?" },
  { icon: "🎂", title: "Cumple", text: "¡Feliz cumpleaños! En Alma Spa tenemos un detalle especial para ti." },
];

export default function CRMPage() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [showPanel, setShowPanel] = useState("info"); // info | notes | labels
  const toast = useToast();
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState("list"); // list | chat | panel
  const mobileChat = useAnimatedMount(isMobile && mobileView === "chat", 220);
  const mobilePanel = useAnimatedMount(isMobile && mobileView === "panel", 220);
  const messagesEndRef = useRef(null);
  const [quickReplies] = useState(QUICK_REPLIES_DEFAULT);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await authFetch("/crm/conversations", {
        query: {
          ...(filter === "pending" ? { filter: "sin_confirmar_hoy" } : {}),
          ...(filter === "bot_active" ? { filter: "bot_active" } : {}),
          ...(filter === "bot_off" ? { filter: "bot_off" } : {}),
          ...(q ? { q } : {}),
        },
      });
      const items = data.items || [];
      setConversations(items);
      if (!isMobile) setSelectedId((cur) => cur || items[0]?.id || null);
    } catch (err) {
      setLoadError(err.message);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [filter, q, isMobile]);

  useEffect(() => {
    const t = setTimeout(fetchConversations, 200);
    const interval = setInterval(fetchConversations, 30_000);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [fetchConversations]);

  const fetchConversation = useCallback(async () => {
    if (!selectedId) return;
    try {
      const [conv, msgs] = await Promise.all([
        authFetch(`/crm/conversations/${selectedId}`),
        authFetch(`/crm/conversations/${selectedId}/messages`),
      ]);
      setSelected(conv);
      setMessages(msgs.items || []);
      authFetch(`/crm/conversations/${selectedId}/mark-read`, { method: "POST" }).catch(() => null);
    } catch (err) {
      toast.error(err.message);
    }
  }, [selectedId, toast]);

  useEffect(() => {
    fetchConversation();
    const interval = setInterval(fetchConversation, 30_000);
    return () => clearInterval(interval);
  }, [fetchConversation]);

  const fetchNotes = useCallback(async () => {
    if (!selectedId) return;
    try {
      const data = await authFetch(`/crm/conversations/${selectedId}/notes`);
      setNotes(data || []);
    } catch { setNotes([]); }
  }, [selectedId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Actions ─────────────────────────────────────────────────
  async function sendText() {
    if (!body.trim() || !selectedId) return;
    setSending(true);
    try {
      await authFetch(`/crm/conversations/${selectedId}/messages`, { method: "POST", body: { body } });
      setBody("");
      toast.success("Mensaje enviado");
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      toast.error(err.message || "No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  async function sendReminder() {
    if (!selectedId) return;
    setSending(true);
    try {
      await authFetch(`/crm/conversations/${selectedId}/reminder`, { method: "POST" });
      toast.success("Recordatorio enviado");
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      toast.error(err.message || "No se pudo enviar el recordatorio");
    } finally {
      setSending(false);
    }
  }

  async function reactivateBot() {
    if (!selectedId) return;
    try {
      await authFetch(`/crm/conversations/${selectedId}/reactivate-bot`, { method: "POST" });
      toast.success("Bot reactivado");
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      toast.error(err.message || "No se pudo reactivar el bot");
    }
  }

  async function toggleLabel(label) {
    if (!selected) return;
    const current = selected.labels || [];
    const next = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label];
    try {
      await authFetch(`/crm/conversations/${selectedId}/labels`, {
        method: "PUT",
        body: { labels: next },
      });
      setSelected((s) => ({ ...s, labels: next }));
      fetchConversations();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addNote() {
    if (!noteText.trim() || !selectedId) return;
    try {
      const note = await authFetch(`/crm/conversations/${selectedId}/notes`, {
        method: "POST",
        body: { content: noteText },
      });
      setNotes((prev) => [note, ...prev]);
      setNoteText("");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteNote(noteId) {
    try {
      await authFetch(`/crm/notes/${noteId}`, { method: "DELETE" });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function markUnread() {
    if (!selectedId) return;
    try {
      await authFetch(`/crm/conversations/${selectedId}`, {
        method: "PATCH",
        body: { unreadCount: 1 },
      });
      toast.success("Marcada como no leída");
      fetchConversations();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function selectConversation(id) {
    setSelectedId(id);
    if (isMobile) setMobileView("chat");
  }

  // ─── Render helpers ──────────────────────────────────────────
  function ConversationCard({ c }) {
    const isSelected = c.id === selectedId;
    const name = c.clientName || c.customerName || c.customerWaId;
    const labels = c.labels || [];
    return (
      <button
        onClick={() => selectConversation(c.id)}
        className={`
          w-full flex items-start gap-3 p-3 rounded-xl text-left
          transition-colors duration-150
          ${isSelected
            ? "bg-glow/40"
            : "hover:bg-cream/60"
          }
        `}
      >
        <span className={`
          w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center
          text-xs font-semibold
          ${isSelected ? "bg-gold text-white" : "bg-gold/30 text-bronze"}
        `}>
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold text-bronze-deep truncate">{name}</span>
            <span className="text-[11px] text-warm-gray flex-shrink-0">{timeStr(c.lastMessageAt)}</span>
          </div>
          <p className="text-xs text-bronze truncate mt-0.5">
            {c.lastMessagePreview || "Sin mensajes"}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {c.botActive === false && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bronze-deep/10 text-bronze-deep text-[10px] font-medium">
                <UserRound size={10} /> Humano
              </span>
            )}
            {c.botStatus === "escalated" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/20 text-bronze-deep text-[10px] font-semibold">
                Escalado
              </span>
            )}
            {!c.withinWindow && (
              <span className="inline-flex px-2 py-0.5 rounded-full bg-bronze-deep text-cream text-[10px] font-medium">
                Usar plantilla
              </span>
            )}
            {labels.slice(0, 2).map((l) => {
              const cfg = LABEL_CONFIG[l];
              if (!cfg) return null;
              return (
                <span key={l} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${cfg.bg} ${cfg.fg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.text}
                </span>
              );
            })}
          </div>
        </div>
        {c.unreadCount > 0 && (
          <span className="mt-2 w-2.5 h-2.5 rounded-full bg-gold flex-shrink-0" />
        )}
      </button>
    );
  }

  function MessageBubble({ m }) {
    const isOutbound = m.direction === "outbound";
    const isBot = isOutbound && !m.sentByUserId;
    const isHuman = isOutbound && !!m.sentByUserId;

    return (
      <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
        <div className={`
          max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm
          ${isBot
            ? "bg-emerald-50 border border-emerald-200 text-bronze-deep"
            : isHuman
              ? "bg-glow/60 text-bronze-deep"
              : "bg-white text-bronze-deep"
          }
        `}>
          {isOutbound && (
            <div className="flex items-center gap-1.5 mb-1">
              {isBot ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                  <Bot size={11} /> Almita
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-bronze">
                  <UserRound size={11} /> Equipo
                </span>
              )}
            </div>
          )}
          <p className="whitespace-pre-wrap leading-relaxed">
            {m.body || (m.type === "template" ? "Recordatorio enviado" : `Mensaje ${m.type === "image" ? "con imagen" : ""}`)}
          </p>
          <p className="text-right text-[10px] text-warm-gray mt-1.5">
            {timeStr(m.createdAt)} {m.status ? `· ${m.status}` : ""}
          </p>
        </div>
      </div>
    );
  }

  // ─── Column 1: Conversations List ──────────────────────────
  function ConversationList() {
    return (
      <div className={`
        flex flex-col h-full bg-[rgba(247,245,240,0.6)]
        ${isMobile ? "w-full" : "w-[360px] flex-shrink-0 border-r border-border"}
      `}>
        <div className="p-5 pb-3">
          <h1 className="font-heading text-2xl font-semibold text-bronze-deep mb-3">
            Bandeja
          </h1>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nombre o teléfono…"
              className="w-full pl-9 pr-4 py-2 rounded-full border border-border bg-white text-sm text-bronze-deep
                         placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
                  transition-colors duration-150
                  ${filter === f.id
                    ? "bg-gold text-white"
                    : "border border-warm-gray/40 text-bronze-deep hover:bg-cream/60"
                  }
                `}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={20} className="animate-spin text-warm-gray" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-center py-10 text-sm text-warm-gray">No hay conversaciones.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {conversations.map((c) => <ConversationCard key={c.id} c={c} />)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Column 2: Chat ───────────────────────────────────────
  function ChatColumn() {
    if (!selected) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-warm-gray bg-cream/40">
          <MessageSquare size={40} className="mb-3 text-warm-gray/40" />
          Selecciona una conversación
        </div>
      );
    }

    const name = selected.customerName || selected.customerWaId;

    return (
      <div className="flex-1 flex flex-col min-w-0 bg-cream/40">
        {/* Chat header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {isMobile && (
              <button
                onClick={() => setMobileView("list")}
                className="flex-shrink-0 p-1 -ml-1 text-bronze"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <span className="w-9 h-9 rounded-full bg-gold text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-bronze-deep truncate">{name}</div>
              <div className="text-xs text-warm-gray">{selected.customerWaId}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {selected.botActive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                <Bot size={12} /> Bot activo
              </span>
            ) : (
              <button
                onClick={reactivateBot}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bronze text-white text-[11px] font-semibold
                           hover:bg-bronze-deep transition-colors duration-150"
              >
                <RefreshCw size={12} /> Reactivar bot
              </button>
            )}
            {!isMobile ? (
              <button
                onClick={sendReminder}
                disabled={sending}
                className="px-4 py-1.5 rounded-full bg-bronze-deep text-white text-xs font-medium
                           hover:bg-bronze transition-colors duration-150 disabled:opacity-60"
              >
                Recordatorio
              </button>
            ) : (
              <button
                onClick={() => setMobileView("panel")}
                className="p-2 rounded-full bg-cream text-bronze"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-gold/15 text-bronze text-sm">{loadError}</div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick replies popover */}
        {showQuickReplies && (
          <div className="mx-4 mb-2 p-3 rounded-2xl bg-white/95 border border-border shadow-lg backdrop-blur-sm">
            <p className="text-[11px] font-semibold text-bronze-deep mb-2">Respuestas rápidas</p>
            <div className="grid gap-1.5">
              {quickReplies.map((r, i) => (
                <button
                  key={i}
                  onClick={() => { setBody(r.text); setShowQuickReplies(false); }}
                  className="flex items-center gap-2.5 p-2.5 rounded-xl bg-cream/50 hover:bg-cream text-left transition-colors"
                >
                  <span className="w-8 h-8 rounded-full bg-glow/40 flex items-center justify-center text-sm">{r.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-bronze-deep">{r.title}</div>
                    <div className="text-[11px] text-bronze truncate">{r.text}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-white/80 backdrop-blur-sm">
          <button
            onClick={() => setShowQuickReplies(!showQuickReplies)}
            className={`
              w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0
              transition-colors duration-150
              ${showQuickReplies ? "bg-gold text-white" : "bg-gold/20 text-bronze"}
            `}
          >
            {"✨"}
          </button>
          <input
            className="flex-1 px-4 py-2.5 rounded-full border border-border bg-white text-sm text-bronze-deep
                       placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40
                       disabled:opacity-50"
            placeholder={selected.withinWindow ? "Escribe tu respuesta…" : "Han pasado más de 24h — envía un recordatorio"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!selected.withinWindow || sending}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
          />
          <button
            onClick={sendText}
            disabled={!selected.withinWindow || sending || !body.trim()}
            className="w-9 h-9 rounded-full bg-bronze text-white flex items-center justify-center flex-shrink-0
                       hover:bg-bronze-deep transition-colors duration-150 disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    );
  }

  // ─── Column 3: Client Panel ────────────────────────────────
  function ClientPanel() {
    if (!selected) return null;
    const name = selected.customerName || selected.customerWaId;
    const labels = selected.labels || [];

    return (
      <div className={`
        flex flex-col h-full bg-white
        ${isMobile ? "w-full" : "w-[320px] flex-shrink-0 border-l border-border"}
      `}>
        {isMobile && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <button onClick={() => setMobileView("chat")} className="p-1 text-bronze">
              <ArrowLeft size={20} />
            </button>
            <span className="text-sm font-semibold text-bronze-deep">Ficha de cliente</span>
          </div>
        )}

        {/* Client card */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-12 h-12 rounded-full bg-gold text-white flex items-center justify-center text-lg font-semibold">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <div className="text-base font-semibold text-bronze-deep truncate">{name}</div>
              <div className="flex items-center gap-1 text-xs text-warm-gray">
                <Phone size={11} /> {selected.customerWaId}
              </div>
            </div>
          </div>
          {selected.clientId && (
            <div className="flex items-center gap-4 text-xs text-warm-gray">
              <span className="flex items-center gap-1"><Hash size={11} /> {selected.clientId.slice(-6)}</span>
              <span className="flex items-center gap-1"><Calendar size={11} /> {dateStr(selected.createdAt)}</span>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border">
          {[
            { id: "info", icon: Tag, label: "Etiquetas" },
            { id: "notes", icon: StickyNote, label: "Notas" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setShowPanel(tab.id)}
              className={`
                flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium
                border-b-2 transition-colors duration-150
                ${showPanel === tab.id
                  ? "border-gold text-gold"
                  : "border-transparent text-warm-gray hover:text-bronze"
                }
              `}
            >
              <tab.icon size={13} /> {tab.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-4">
          {showPanel === "info" && (
            <div>
              <p className="text-[11px] font-semibold text-warm-gray uppercase tracking-wider mb-3">Etiquetas</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(LABEL_CONFIG).map(([key, cfg]) => {
                  const active = labels.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleLabel(key)}
                      className={`
                        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                        transition-all duration-150 border
                        ${active
                          ? `${cfg.bg} ${cfg.fg} border-current`
                          : "bg-cream/60 text-warm-gray border-border hover:bg-cream"
                        }
                      `}
                    >
                      <span className={`w-2 h-2 rounded-full ${active ? cfg.dot : "bg-warm-gray/40"}`} />
                      {cfg.text}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showPanel === "notes" && (
            <div>
              <p className="text-[11px] font-semibold text-warm-gray uppercase tracking-wider mb-3">Notas internas</p>
              <div className="flex gap-2 mb-4">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                  placeholder="Agregar nota…"
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-cream/40 text-sm text-bronze-deep
                             placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
                <button
                  onClick={addNote}
                  disabled={!noteText.trim()}
                  className="px-3 py-2 rounded-lg bg-bronze text-white text-sm font-medium
                             hover:bg-bronze-deep transition-colors disabled:opacity-40"
                >
                  <Plus size={15} />
                </button>
              </div>
              {notes.length === 0 ? (
                <p className="text-xs text-warm-gray text-center py-4">Sin notas aún.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {notes.map((n) => (
                    <div key={n.id} className="p-3 rounded-xl bg-cream/60 border border-border">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-bronze-deep leading-relaxed flex-1">{n.content}</p>
                        <button
                          onClick={() => deleteNote(n.id)}
                          className="p-1 text-warm-gray hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="text-[10px] text-warm-gray mt-1.5">
                        {n.author?.name || "?"} · {dateStr(n.createdAt)} {timeStr(n.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border flex flex-col gap-2">
          {!selected.botActive && (
            <button
              onClick={reactivateBot}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                         bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold
                         hover:bg-emerald-100 transition-colors duration-150"
            >
              <RefreshCw size={14} /> Reactivar bot
            </button>
          )}
          <button
            onClick={sendReminder}
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                       bg-bronze text-white text-sm font-medium
                       hover:bg-bronze-deep transition-colors duration-150 disabled:opacity-50"
          >
            <Send size={14} /> Enviar recordatorio
          </button>
          <button
            onClick={markUnread}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                       bg-cream border border-border text-bronze text-sm font-medium
                       hover:bg-glow/40 transition-colors duration-150"
          >
            Marcar no leída
          </button>
        </div>
      </div>
    );
  }

  // ─── Layout ───────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        {mobileView === "list" && <ConversationList />}
        {mobileChat.shouldRender && (
          <div className={`flex-1 flex flex-col alma-slide-right alma-anim-${mobileChat.phase}`}>
            <ChatColumn />
          </div>
        )}
        {mobilePanel.shouldRender && (
          <div className={`flex-1 flex flex-col alma-slide-right alma-anim-${mobilePanel.phase}`}>
            <ClientPanel />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ConversationList />
      <ChatColumn />
      <ClientPanel />
    </div>
  );
}
