"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import {
  Loader2, Send, ArrowLeft, Bot, UserRound, Search,
  MessageSquare, StickyNote, Tag, Phone, Calendar, Hash, ChevronRight,
  Plus, Trash2, RefreshCw, CheckCircle2, CircleDot, UserCheck,
  ChevronDown, ArrowDown, Edit3, Settings, Paperclip, Download, FileText,
  ImageIcon, Volume2, Video,
} from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { useAnimatedMount } from "@/lib/use-animated-mount";
import { useToast } from "@/components/toast-provider";

const DEFAULT_LABELS = [
  { key: "consulta", text: "Consulta", tone: "blue" },
  { key: "reserva_pendiente", text: "Reserva pendiente", tone: "amber" },
  { key: "cita_confirmada", text: "Cita confirmada", tone: "emerald" },
  { key: "seguimiento", text: "Seguimiento", tone: "purple" },
  { key: "queja", text: "Queja", tone: "red" },
  { key: "nueva_clienta", text: "Nueva clienta", tone: "sky" },
];

const LABEL_TONES = {
  blue:    { label: "Azul",    bg: "bg-blue-100",    fg: "text-blue-700",    dot: "bg-blue-500",    ring: "border-blue-200" },
  amber:   { label: "Dorado",  bg: "bg-amber-100",   fg: "text-amber-700",   dot: "bg-amber-500",   ring: "border-amber-200" },
  emerald: { label: "Verde",   bg: "bg-emerald-100", fg: "text-emerald-700", dot: "bg-emerald-500", ring: "border-emerald-200" },
  purple:  { label: "Lila",    bg: "bg-purple-100",  fg: "text-purple-700",  dot: "bg-purple-500",  ring: "border-purple-200" },
  red:     { label: "Rojo",    bg: "bg-red-100",     fg: "text-red-700",     dot: "bg-red-500",     ring: "border-red-200" },
  sky:     { label: "Celeste", bg: "bg-sky-100",     fg: "text-sky-700",     dot: "bg-sky-500",     ring: "border-sky-200" },
  rose:    { label: "Rosa",    bg: "bg-rose-100",    fg: "text-rose-700",    dot: "bg-rose-500",    ring: "border-rose-200" },
  neutral: { label: "Arena",   bg: "bg-cream",       fg: "text-bronze",      dot: "bg-warm-gray",   ring: "border-border" },
};

const FILTERS = [
  { id: "all",      label: "Todos" },
  { id: "pending",  label: "Pendientes" },
  { id: "resolved", label: "Resueltos" },
];

const LIVE_REFRESH_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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

function slugLabel(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `etiqueta_${Date.now()}`;
}

function labelMapFrom(items) {
  return Object.fromEntries((items || DEFAULT_LABELS).map((label) => [label.key, {
    ...label,
    ...(LABEL_TONES[label.tone] || LABEL_TONES.neutral),
  }]));
}

const QUICK_REPLIES_DEFAULT = [
  { key: "saludo", icon: "👋", title: "Saludo", text: "Hola, gracias por escribir a Alma Spa. ¿En qué podemos ayudarte?" },
  { key: "confirmar", icon: "✅", title: "Confirmar", text: "Perfecto, tu cita queda confirmada. Te esperamos con mucho gusto." },
  { key: "horario", icon: "🕐", title: "Horario", text: "Nuestro horario es de lunes a sábado de 9:00 a 19:00." },
  { key: "agendar", icon: "💆", title: "Agendar", text: "Claro, podemos ayudarte a agendar una cita. ¿Qué día y horario te queda mejor?" },
  { key: "cumple", icon: "🎂", title: "Cumple", text: "¡Feliz cumpleaños! En Alma Spa tenemos un detalle especial para ti." },
];

export default function CRMPage() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [conversations, setConversations] = useState([]);
  const [counts, setCounts] = useState({ all: 0, pending: 0, resolved: 0 });
  const [assignees, setAssignees] = useState([]);
  const [labelDefs, setLabelDefs] = useState(DEFAULT_LABELS);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const [labelConfigMode, setLabelConfigMode] = useState(false);
  const [labelDraft, setLabelDraft] = useState({ key: "", text: "", tone: "blue" });
  const [editingLabelKey, setEditingLabelKey] = useState(null);
  const [showAssignees, setShowAssignees] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const toast = useToast();
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState("list"); // list | chat | panel
  const mobileChat = useAnimatedMount(isMobile && mobileView === "chat", 220);
  const mobilePanel = useAnimatedMount(isMobile && mobileView === "panel", 220);
  const messagesEndRef = useRef(null);
  const lastMsgIdRef = useRef(null);
  const initialMessageLoadRef = useRef(true);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const headerMenuRef = useRef(null);
  const quickRepliesRef = useRef(null);
  const [quickReplies, setQuickReplies] = useState(QUICK_REPLIES_DEFAULT);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyConfigMode, setQuickReplyConfigMode] = useState(false);
  const [quickReplyDraft, setQuickReplyDraft] = useState({ key: "", icon: "💬", title: "", text: "" });
  const [editingQuickReplyKey, setEditingQuickReplyKey] = useState(null);
  const labelConfig = useMemo(() => labelMapFrom(labelDefs), [labelDefs]);
  const selectedName = selected?.client?.fullName || selected?.customerName || selected?.customerWaId || "";
  const chatMatches = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    if (!term) return [];
    return messages.filter((m) => String(m.body || "").toLowerCase().includes(term));
  }, [messages, chatSearch]);
  const detailsMatch = useMemo(() => {
    const term = chatSearch.trim().toLowerCase();
    if (!term || chatMatches.length > 0 || !selected) return false;
    return [
      selectedName,
      selected.customerWaId,
      selected.client?.recordNumber,
      selected.client?.email,
      selected.assignedTo?.name,
      ...(selected.labels || []).map((key) => labelConfig[key]?.text || key),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
  }, [chatSearch, chatMatches.length, selected, selectedName, labelConfig]);

  // ─── Data fetching ──────────────────────────────────────────
  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError("");
    }
    try {
      const data = await authFetch("/crm/conversations", {
        query: {
          ...(filter === "pending" ? { status: "pending" } : {}),
          ...(filter === "resolved" ? { status: "resolved" } : {}),
          ...(q ? { q } : {}),
        },
      });
      const items = data.items || [];
      setConversations(items);
      setCounts(data.counts || { all: items.length, pending: 0, resolved: 0 });
      if (!isMobile) {
        setSelectedId((cur) => {
          if (!cur) return items[0]?.id || null;
          return items.some((item) => item.id === cur) ? cur : items[0]?.id || null;
        });
      }
    } catch (err) {
      if (!silent) {
        setLoadError(err.message);
        setConversations([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, q, isMobile]);

  useEffect(() => {
    const t = setTimeout(() => fetchConversations(), 200);
    const interval = setInterval(() => fetchConversations(true), LIVE_REFRESH_MS);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [fetchConversations]);

  useEffect(() => {
    authFetch("/crm/assignees")
      .then((data) => setAssignees(data.items || []))
      .catch(() => setAssignees([]));
  }, []);

  useEffect(() => {
    authFetch("/crm/labels")
      .then((data) => setLabelDefs(data.items?.length ? data.items : DEFAULT_LABELS))
      .catch(() => setLabelDefs(DEFAULT_LABELS));
  }, []);

  useEffect(() => {
    authFetch("/crm/quick-replies")
      .then((data) => setQuickReplies(data.items?.length ? data.items : QUICK_REPLIES_DEFAULT))
      .catch(() => setQuickReplies(QUICK_REPLIES_DEFAULT));
  }, []);

  const fetchConversation = useCallback(async (silent = false) => {
    if (!selectedId) return;
    try {
      const [conv, msgs] = await Promise.all([
        authFetch(`/crm/conversations/${selectedId}`),
        authFetch(`/crm/conversations/${selectedId}/messages`),
      ]);
      setSelected(conv);
      setMessages(msgs.items || []);
      const chatIsVisible = typeof document === "undefined"
        || document.visibilityState === "visible";
      const mobileChatIsOpen = !isMobile || mobileView === "chat";
      // "No leído" es una acción explícita del equipo: un refresco no debe deshacerla.
      if (conv.unreadCount > 0 && !conv.manuallyMarkedUnread && chatIsVisible && mobileChatIsOpen) {
        authFetch(`/crm/conversations/${selectedId}/mark-read`, { method: "POST" })
          .then(() => {
            setSelected((cur) => cur?.id === selectedId ? { ...cur, unreadCount: 0, lastReadAt: new Date().toISOString() } : cur);
            setConversations((prev) => prev.map((item) => (
              item.id === selectedId ? { ...item, unreadCount: 0 } : item
            )));
          })
          .catch(() => null);
      }
    } catch (err) {
      if (!silent) toast.error(err.message);
    }
  }, [selectedId, toast, isMobile, mobileView]);

  useEffect(() => {
    fetchConversation();
    const interval = setInterval(() => fetchConversation(true), LIVE_REFRESH_MS);
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
    const source = new EventSource("/api/crm/events");
    const refreshFromEvent = (event) => {
      if (event.type === "crm.ping" || event.type === "crm.connected") return;
      let payload = {};
      try { payload = JSON.parse(event.data || "{}"); } catch { payload = {}; }
      if (event.type === "conversation.labels.config.updated") {
        if (payload.labels?.length) setLabelDefs(payload.labels);
        return;
      }
      if (event.type === "conversation.quick_replies.config.updated") {
        if (payload.quickReplies?.length) setQuickReplies(payload.quickReplies);
        return;
      }
      if (event.type === "conversation.tags.updated" && payload.conversationId) {
        setConversations((prev) => prev.map((item) => (
          item.id === payload.conversationId ? { ...item, labels: payload.labels || [] } : item
        )));
        if (payload.conversationId === selectedId) {
          setSelected((cur) => cur?.id === selectedId ? { ...cur, labels: payload.labels || [] } : cur);
        }
        return;
      }
      fetchConversations(true);
      if (payload.conversationId && payload.conversationId === selectedId) {
        fetchConversation(true);
        if (event.type === "conversation.notes.updated") fetchNotes();
      }
    };
    const eventNames = [
      "conversation.message.created",
      "conversation.status.updated",
      "conversation.marked_read",
      "conversation.marked_unread",
      "conversation.bot.updated",
      "conversation.assigned",
      "conversation.tags.updated",
      "conversation.notes.updated",
      "conversation.updated",
      "conversation.labels.config.updated",
      "conversation.quick_replies.config.updated",
    ];
    eventNames.forEach((name) => source.addEventListener(name, refreshFromEvent));
    source.onerror = () => {
      // El polling de respaldo sigue activo; no mostramos alerta para no ensuciar la Bandeja.
    };
    return () => {
      eventNames.forEach((name) => source.removeEventListener(name, refreshFromEvent));
      source.close();
    };
  }, [fetchConversations, fetchConversation, fetchNotes, selectedId]);

  useEffect(() => {
    lastMsgIdRef.current = null;
    initialMessageLoadRef.current = true;
    setShowScrollBottom(false);
  }, [selectedId]);

  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id;
    if (!lastId || lastId === lastMsgIdRef.current) return;
    const container = messagesContainerRef.current;
    if (initialMessageLoadRef.current) {
      initialMessageLoadRef.current = false;
      lastMsgIdRef.current = lastId;
      if (container) {
        // Al abrir una conversación se debe ver el mensaje más reciente, igual
        // que en WhatsApp. Después de ese primer posicionamiento ya no forzamos
        // el scroll: solo seguimos mensajes nuevos si la persona está al final.
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
          setShowScrollBottom(false);
        });
      }
      return;
    }
    const isNearBottom = !container
      || container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    lastMsgIdRef.current = lastId;
  }, [messages]);

  useEffect(() => {
    setChatSearch("");
    setChatSearchIndex(0);
    setChatSearchOpen(false);
    setShowAssignees(false);
    setLabelDropdownOpen(false);
    setLabelConfigMode(false);
    setShowQuickReplies(false);
    setQuickReplyConfigMode(false);
  }, [selectedId]);

  useEffect(() => {
    function onPointerDown(event) {
      const target = event.target;
      if (headerMenuRef.current && !headerMenuRef.current.contains(target)) {
        setShowAssignees(false);
        setChatSearchOpen(false);
      }
      if (
        showQuickReplies
        && quickRepliesRef.current
        && !quickRepliesRef.current.contains(target)
        && !target.closest?.("[data-quick-replies-trigger]")
      ) {
        setShowQuickReplies(false);
        setQuickReplyConfigMode(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showQuickReplies]);

  useEffect(() => {
    if (!chatMatches.length) return;
    const match = chatMatches[Math.min(chatSearchIndex, chatMatches.length - 1)];
    const node = document.getElementById(`crm-msg-${match.id}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [chatMatches, chatSearchIndex]);

  function scrollToBottom(behavior = "smooth") {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setShowScrollBottom(false);
  }

  function handleMessagesScroll() {
    const container = messagesContainerRef.current;
    if (!container) return;
    setShowScrollBottom(container.scrollHeight - container.scrollTop - container.clientHeight > 180);
  }

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

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  async function sendAttachment(file) {
    if (!file || !selectedId) return;
    if (!selected?.withinWindow) {
      toast.error("Han pasado más de 24h. Para escribir usa una plantilla/recordatorio.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("El archivo supera el límite de 8MB");
      return;
    }
    setSending(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await authFetch(`/crm/conversations/${selectedId}/media`, {
        method: "POST",
        body: {
          dataUrl,
          filename: file.name,
          caption: body.trim(),
        },
      });
      setBody("");
      toast.success("Adjunto enviado");
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      toast.error(err.message || "No se pudo enviar el adjunto");
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
      const updated = await authFetch(`/crm/conversations/${selectedId}/bot/resume`, { method: "POST" });
      toast.success("Bot reactivado");
      setSelected((cur) => cur?.id === selectedId ? { ...cur, ...updated, botStatus: "active" } : cur);
      setConversations((prev) => prev.map((item) => (
        item.id === selectedId ? { ...item, ...updated, botStatus: "active" } : item
      )));
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
      setConversations((prev) => prev.map((item) => (
        item.id === selectedId ? { ...item, labels: next } : item
      )));
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
      const updated = await authFetch(`/crm/conversations/${selectedId}/read-state`, {
        method: "POST",
        body: { unread: true },
      });
      toast.success("Marcada como no leída");
      setSelected((cur) => cur?.id === selectedId ? { ...cur, ...updated } : cur);
      setConversations((prev) => prev.map((item) => (
        item.id === selectedId ? { ...item, ...updated } : item
      )));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changeStatus(status) {
    if (!selectedId) return;
    try {
      const updated = await authFetch(`/crm/conversations/${selectedId}/status`, {
        method: "POST",
        body: { status },
      });
      toast.success(status === "resolved" ? "Conversación resuelta" : "Conversación reabierta");
      setSelected((cur) => cur?.id === selectedId ? { ...cur, ...updated } : cur);
      setConversations((prev) => prev
        .map((item) => item.id === selectedId ? { ...item, ...updated } : item)
        .filter((item) => (
          filter === "all"
          || (filter === "pending" ? ["open", "pending"].includes(item.status) : item.status === filter)
        )));
      fetchConversations(true);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function pauseBot() {
    if (!selectedId) return;
    try {
      const updated = await authFetch(`/crm/conversations/${selectedId}/bot/pause`, { method: "POST" });
      toast.success("Bot pausado");
      setSelected((cur) => cur?.id === selectedId ? { ...cur, ...updated } : cur);
      setConversations((prev) => prev.map((item) => (
        item.id === selectedId ? { ...item, ...updated, botStatus: "handedOff" } : item
      )));
    } catch (err) {
      toast.error(err.message || "No se pudo pausar el bot");
    }
  }

  async function assignConversation(userId) {
    if (!selectedId) return;
    const assignee = assignees.find((u) => u.id === userId) || null;
    try {
      const updated = await authFetch(`/crm/conversations/${selectedId}/assign`, {
        method: "PATCH",
        body: { userId: userId || null },
      });
      const patch = { ...updated, assignedTo: assignee };
      setSelected((cur) => cur?.id === selectedId ? { ...cur, ...patch } : cur);
      setConversations((prev) => prev.map((item) => (
        item.id === selectedId ? { ...item, ...patch } : item
      )));
    } catch (err) {
      toast.error(err.message || "No se pudo asignar");
    }
  }

  async function saveLabelsConfig(nextLabels) {
    const clean = nextLabels.filter((label) => label.text?.trim()).slice(0, 24);
    const saved = await authFetch("/crm/labels", {
      method: "PUT",
      body: { labels: clean },
    });
    setLabelDefs(saved.items || clean);
    return saved.items || clean;
  }

  async function saveLabelDraft() {
    const text = labelDraft.text.trim();
    if (!text) return;
    const key = editingLabelKey || slugLabel(text);
    const next = editingLabelKey
      ? labelDefs.map((label) => label.key === editingLabelKey ? { ...label, text, tone: labelDraft.tone } : label)
      : [...labelDefs, { key, text, tone: labelDraft.tone }];
    try {
      await saveLabelsConfig(next);
      setLabelDraft({ key: "", text: "", tone: "blue" });
      setEditingLabelKey(null);
      toast.success(editingLabelKey ? "Etiqueta actualizada" : "Etiqueta agregada");
    } catch (err) {
      toast.error(err.message || "No se pudo guardar la etiqueta");
    }
  }

  function startEditingLabel(label) {
    setEditingLabelKey(label.key);
    setLabelDraft({ key: label.key, text: label.text, tone: label.tone || "neutral" });
    setLabelConfigMode(true);
  }

  async function removeLabel(key) {
    try {
      await saveLabelsConfig(labelDefs.filter((label) => label.key !== key));
      if (selected?.labels?.includes(key)) {
        await toggleLabel(key);
      }
    } catch (err) {
      toast.error(err.message || "No se pudo eliminar la etiqueta");
    }
  }

  async function saveQuickRepliesConfig(nextQuickReplies) {
    const clean = nextQuickReplies
      .filter((reply) => reply.title?.trim() && reply.text?.trim())
      .slice(0, 20);
    const saved = await authFetch("/crm/quick-replies", {
      method: "PUT",
      body: { quickReplies: clean },
    });
    setQuickReplies(saved.items || clean);
    return saved.items || clean;
  }

  async function saveQuickReplyDraft() {
    const title = quickReplyDraft.title.trim();
    const text = quickReplyDraft.text.trim();
    if (!title || !text) return;
    const key = editingQuickReplyKey || slugLabel(title);
    const next = editingQuickReplyKey
      ? quickReplies.map((reply) => reply.key === editingQuickReplyKey
        ? { ...reply, icon: quickReplyDraft.icon || "💬", title, text }
        : reply)
      : [...quickReplies, { key, icon: quickReplyDraft.icon || "💬", title, text }];
    try {
      await saveQuickRepliesConfig(next);
      setQuickReplyDraft({ key: "", icon: "💬", title: "", text: "" });
      setEditingQuickReplyKey(null);
      toast.success(editingQuickReplyKey ? "Respuesta actualizada" : "Respuesta creada");
    } catch (err) {
      toast.error(err.message || "No se pudo guardar la respuesta");
    }
  }

  function startEditingQuickReply(reply) {
    setEditingQuickReplyKey(reply.key);
    setQuickReplyDraft({
      key: reply.key,
      icon: reply.icon || "💬",
      title: reply.title || "",
      text: reply.text || "",
    });
    setQuickReplyConfigMode(true);
  }

  async function removeQuickReply(key) {
    if (!key) return;
    try {
      await saveQuickRepliesConfig(quickReplies.filter((reply) => reply.key !== key));
      if (editingQuickReplyKey === key) {
        setEditingQuickReplyKey(null);
        setQuickReplyDraft({ key: "", icon: "💬", title: "", text: "" });
      }
    } catch (err) {
      toast.error(err.message || "No se pudo eliminar la respuesta");
    }
  }

  function selectConversation(id) {
    setSelectedId(id);
    if (isMobile) setMobileView("chat");
  }

  function renderHighlightedText(text) {
    const value = text || "";
    const term = chatSearch.trim();
    if (!term) return value;
    const lower = value.toLowerCase();
    const index = lower.indexOf(term.toLowerCase());
    if (index === -1) return value;
    return (
      <>
        {value.slice(0, index)}
        <mark className="rounded bg-gold/30 px-0.5 text-bronze-deep">{value.slice(index, index + term.length)}</mark>
        {value.slice(index + term.length)}
      </>
    );
  }

  function isPlaceholderBody(value = "") {
    return /^\[(imagen|audio|video|documento|sticker|ubicación|interactivo|mensaje)\]$/i.test(String(value).trim());
  }

  function renderMediaContent(m) {
    if (!m.mediaId) return null;
    const mediaUrl = `/api/proxy/crm/messages/${m.id}/media`;
    const label = m.body && !isPlaceholderBody(m.body) ? m.body : "Abrir archivo";

    if (m.type === "image" || m.type === "sticker") {
      return (
        <a href={mediaUrl} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl border border-border/70 bg-white/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl} alt={label} className="max-h-72 w-full object-cover" />
        </a>
      );
    }

    if (m.type === "audio") {
      return (
        <div className="mb-2 rounded-xl border border-border/70 bg-white/50 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-bronze">
            <Volume2 size={13} /> Audio
          </div>
          <audio controls src={mediaUrl} className="w-full" />
        </div>
      );
    }

    if (m.type === "video") {
      return (
        <div className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-white/50">
          <div className="flex items-center gap-1.5 px-2 pt-2 text-xs font-semibold text-bronze">
            <Video size={13} /> Video
          </div>
          <video controls src={mediaUrl} className="mt-2 max-h-72 w-full bg-black" />
        </div>
      );
    }

    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-2 flex items-center gap-2 rounded-xl border border-border/70 bg-white/60 p-3 text-bronze-deep transition-colors hover:bg-white"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-cream text-bronze">
          <FileText size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{label}</span>
          <span className="block text-[10px] text-warm-gray">Documento adjunto</span>
        </span>
        <Download size={15} className="flex-shrink-0" />
      </a>
    );
  }

  // ─── Render helpers ──────────────────────────────────────────
  function renderConversationCard(c) {
    const isSelected = c.id === selectedId;
    const name = c.clientName || c.customerName || c.customerWaId;
    const labels = c.labels || [];
    const pendingMessageCount = Math.max(Number(c.pendingMessageCount || 0), Number(c.unreadCount || 0));
    return (
      <button
        key={c.id}
        onClick={() => selectConversation(c.id)}
        className={`
          relative w-full flex items-start gap-3 p-3 pr-10 rounded-xl text-left
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
            {c.status === "open" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-semibold">
                <CircleDot size={10} /> Abierto
              </span>
            )}
            {c.status === "pending" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                <CircleDot size={10} /> Pendiente
              </span>
            )}
            {c.status === "resolved" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                <CheckCircle2 size={10} /> Resuelto
              </span>
            )}
            {c.assignedTo?.name && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cream text-bronze text-[10px] font-medium">
                <UserCheck size={10} /> {c.assignedTo.name.split(" ")[0]}
              </span>
            )}
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
              const cfg = labelConfig[l];
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
        {pendingMessageCount > 0 && (
          <span className="absolute right-3 top-1/2 flex min-w-5 h-5 -translate-y-1/2 items-center justify-center rounded-full bg-gold px-1.5 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
            {pendingMessageCount > 99 ? "99+" : pendingMessageCount}
          </span>
        )}
      </button>
    );
  }

  function renderMessageBubble(m) {
    const isOutbound = m.direction === "outbound";
    const isBot = m.senderType === "bot" || (isOutbound && !m.sentByUserId);
    const isHuman = m.senderType === "agent" || (isOutbound && !!m.sentByUserId);
    const mediaLabels = {
      image: "Mensaje con imagen",
      audio: "Mensaje de audio",
      document: "Documento adjunto",
      video: "Video recibido",
      sticker: "Sticker",
      location: "Ubicación compartida",
      interactive: "Mensaje interactivo",
      template: "Plantilla enviada",
    };

    return (
      <div id={`crm-msg-${m.id}`} key={m.id} className={`flex scroll-mt-24 ${isOutbound ? "justify-end" : "justify-start"}`}>
        <div className={`
          max-w-[75%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm
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
          {renderMediaContent(m)}
          {m.type === "image" && !m.mediaId && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/50 p-2 text-xs text-bronze">
              <ImageIcon size={14} /> Imagen pendiente
            </div>
          )}
          {(!m.mediaId || (m.body && !isPlaceholderBody(m.body))) && (
            <p className="whitespace-pre-wrap leading-relaxed">
              {renderHighlightedText(m.body || mediaLabels[m.type] || "Mensaje recibido")}
            </p>
          )}
          <p className="text-right text-[10px] text-warm-gray mt-1.5">
            {timeStr(m.createdAt)} {m.status ? `· ${m.status}` : ""}
          </p>
        </div>
      </div>
    );
  }

  // ─── Column 1: Conversations List ──────────────────────────
  function renderConversationList() {
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
                <span className={`ml-1 ${filter === f.id ? "text-white/85" : "text-warm-gray"}`}>
                  ({counts[f.id] ?? 0})
                </span>
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
              {conversations.map((c) => renderConversationCard(c))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Column 2: Chat ───────────────────────────────────────
  function renderChatColumn() {
    if (!selected) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-warm-gray bg-cream/40">
          <MessageSquare size={40} className="mb-3 text-warm-gray/40" />
          Selecciona una conversación
        </div>
      );
    }

    const name = selected.client?.fullName || selected.customerName || selected.customerWaId;

    return (
      <div className="flex-1 flex flex-col min-w-0 bg-cream/40">
        {/* Chat header */}
        <div className="relative z-[100] flex items-center justify-between gap-2 overflow-visible border-b border-border bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
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
          <div ref={headerMenuRef} className="relative z-[120] flex flex-shrink-0 items-center gap-2">
            <button
              onClick={selected.botActive ? pauseBot : reactivateBot}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold shadow-sm transition-colors duration-150 ${
                selected.botActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-border bg-white text-bronze-deep hover:bg-cream"
              }`}
            >
              {selected.botActive ? <Bot size={12} /> : <RefreshCw size={12} />}
              {selected.botActive ? "Bot activo" : "Reactivar bot"}
            </button>
            <div className="relative">
              <button
                onClick={() => {
                  setShowAssignees((v) => !v);
                  setChatSearchOpen(false);
                }}
                className="inline-flex h-8 min-w-[112px] items-center justify-center gap-1.5 rounded-full border border-border bg-white px-3 text-[12px] font-semibold text-bronze-deep shadow-sm transition-colors hover:bg-cream"
              >
                <UserCheck size={12} />
                {selected.assignedTo?.name?.split(" ")[0] || "Asignar"}
                <ChevronDown size={12} />
              </button>
              {showAssignees && (
                <div className="absolute right-0 top-full z-[140] mt-2 w-56 rounded-2xl border border-border bg-white p-2 shadow-xl">
                  <button
                    onClick={() => { assignConversation(""); setShowAssignees(false); }}
                    className="w-full rounded-xl px-3 py-2 text-left text-xs text-warm-gray hover:bg-cream"
                  >
                    Sin asignar
                  </button>
                  {assignees.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => { assignConversation(u.id); setShowAssignees(false); }}
                      className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                        selected.assignedToUserId === u.id
                          ? "bg-gold/15 text-bronze-deep font-semibold"
                          : "text-bronze hover:bg-cream"
                      }`}
                    >
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => {
                  setChatSearchOpen((v) => !v);
                  setShowAssignees(false);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-colors ${
                  chatSearchOpen ? "border-gold bg-gold text-white" : "border-border bg-white text-bronze hover:bg-cream"
                }`}
                title="Buscar en esta conversación"
              >
                <Search size={14} />
              </button>
              {chatSearchOpen && (
                <div className="absolute right-0 top-full z-[140] mt-2 w-72 rounded-2xl border border-border bg-white p-3 shadow-xl">
                  <input
                    autoFocus
                    value={chatSearch}
                    onChange={(e) => { setChatSearch(e.target.value); setChatSearchIndex(0); }}
                    placeholder="Buscar en este chat…"
                    className="w-full rounded-xl border border-border bg-cream/40 px-3 py-2 text-sm text-bronze-deep placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                  {chatSearch.trim() && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-warm-gray">
                      <span>
                        {chatMatches.length > 0
                          ? `${chatMatches.length} coincidencia${chatMatches.length === 1 ? "" : "s"}`
                          : detailsMatch ? "Coincide con la ficha" : "Sin coincidencias"}
                      </span>
                      {chatMatches.length > 1 && (
                        <button
                          onClick={() => setChatSearchIndex((i) => (i + 1) % chatMatches.length)}
                          className="rounded-full bg-cream px-2 py-1 text-bronze hover:bg-glow/40"
                        >
                          Siguiente
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {!isMobile ? (
              null
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
        <div className="relative z-0 flex-1 min-h-0">
          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="h-full overflow-y-auto p-4 flex flex-col gap-3"
          >
            {messages.map((m) => renderMessageBubble(m))}
            <div ref={messagesEndRef} />
          </div>
          {showScrollBottom && (
            <button
              onClick={() => scrollToBottom()}
              className="absolute bottom-4 right-5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-bronze shadow-lg transition-colors hover:bg-cream"
              title="Bajar al último mensaje"
            >
              <ArrowDown size={16} />
            </button>
          )}
        </div>

        {/* Quick replies popover */}
        {showQuickReplies && (
          <div
            ref={quickRepliesRef}
            className="mx-4 mb-2 rounded-2xl border border-border bg-white/95 p-3 shadow-lg backdrop-blur-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-bronze-deep">Respuestas rápidas</p>
              <button
                onClick={() => {
                  setQuickReplyConfigMode((v) => !v);
                  setEditingQuickReplyKey(null);
                  setQuickReplyDraft({ key: "", icon: "💬", title: "", text: "" });
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  quickReplyConfigMode
                    ? "bg-gold text-white"
                    : "bg-cream text-bronze hover:bg-glow/40"
                }`}
                title="Configurar respuestas rápidas"
              >
                <Settings size={13} />
              </button>
            </div>

            {!quickReplyConfigMode ? (
              <div className="grid gap-1.5">
                {quickReplies.map((r, i) => (
                  <button
                    key={r.key || i}
                    onClick={() => { setBody(r.text); setShowQuickReplies(false); }}
                    className="flex items-center gap-2.5 rounded-xl bg-cream/50 p-2.5 text-left transition-colors hover:bg-cream"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-glow/40 text-sm">{r.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-bronze-deep">{r.title}</div>
                      <div className="truncate text-[11px] text-bronze">{r.text}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="max-h-52 overflow-y-auto pr-1">
                  {quickReplies.map((r, i) => (
                    <div
                      key={r.key || i}
                      className="mb-1.5 flex items-center gap-2 rounded-xl bg-cream/50 p-2"
                    >
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-sm">{r.icon}</span>
                      <button
                        onClick={() => startEditingQuickReply(r)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-xs font-semibold text-bronze-deep">{r.title}</div>
                        <div className="truncate text-[11px] text-bronze">{r.text}</div>
                      </button>
                      <button
                        onClick={() => startEditingQuickReply(r)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-warm-gray hover:bg-white hover:text-bronze"
                        title="Editar respuesta"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={() => removeQuickReply(r.key)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-warm-gray hover:bg-red-50 hover:text-red-500"
                        title="Eliminar respuesta"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-border bg-cream/30 p-3">
                  <div className="grid grid-cols-[54px_1fr] gap-2">
                    <input
                      value={quickReplyDraft.icon}
                      onChange={(e) => setQuickReplyDraft((d) => ({ ...d, icon: Array.from(e.target.value).slice(0, 2).join("") }))}
                      className="rounded-xl border border-border bg-white px-3 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                      aria-label="Icono"
                    />
                    <input
                      value={quickReplyDraft.title}
                      onChange={(e) => setQuickReplyDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Nombre"
                      className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-bronze-deep placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
                    />
                  </div>
                  <textarea
                    value={quickReplyDraft.text}
                    onChange={(e) => setQuickReplyDraft((d) => ({ ...d, text: e.target.value }))}
                    placeholder="Texto de la respuesta"
                    rows={2}
                    className="mt-2 w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-bronze-deep placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={saveQuickReplyDraft}
                      className="flex-1 rounded-xl bg-bronze px-3 py-2 text-xs font-semibold text-white hover:bg-bronze-deep"
                    >
                      {editingQuickReplyKey ? "Guardar cambios" : "Crear respuesta"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingQuickReplyKey(null);
                        setQuickReplyDraft({ key: "", icon: "💬", title: "", text: "" });
                      }}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-semibold text-bronze hover:bg-cream"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-white/80 backdrop-blur-sm">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,audio/*,video/mp4,video/3gpp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) sendAttachment(file);
            }}
          />
          <button
            data-quick-replies-trigger
            onClick={() => {
              setShowQuickReplies((v) => !v);
              setShowAssignees(false);
              setChatSearchOpen(false);
            }}
            className={`
              w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0
              transition-colors duration-150
              ${showQuickReplies ? "bg-gold text-white" : "bg-gold/20 text-bronze"}
            `}
          >
            {"✨"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selected.withinWindow || sending}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-cream text-bronze transition-colors hover:bg-glow/40 disabled:opacity-40"
            title="Adjuntar archivo"
          >
            <Paperclip size={16} />
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
  function renderClientPanel() {
    if (!selected) return null;
    const linkedClient = selected.client || null;
    const name = linkedClient?.fullName || selected.customerName || selected.customerWaId;
    const labels = selected.labels || [];
    const isResolved = selected.status === "resolved";
    const isUnreadActive = !isResolved && (selected.unreadCount > 0 || selected.manuallyMarkedUnread);

    return (
      <div className={`
        flex flex-col h-full bg-[#f8fbff]
        ${isMobile ? "w-full" : "w-[300px] flex-shrink-0 border-l border-border"}
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
        <div className="mx-3 mt-3 rounded-2xl border border-border/60 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gold text-base font-semibold text-white shadow-sm">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <div className="text-base font-semibold text-bronze-deep truncate">{name}</div>
              <div className="flex items-center gap-1 text-xs text-warm-gray">
                <Phone size={11} /> {selected.customerWaId}
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-1.5 text-xs text-warm-gray">
            {linkedClient ? (
              <>
                <span className="flex items-center gap-1">
                  <Hash size={11} /> Ficha {linkedClient.recordNumber || linkedClient.id.slice(-6)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={11} /> Cliente desde {dateStr(linkedClient.createdAt || selected.createdAt)}
                </span>
              </>
            ) : (
              <span className="rounded-xl bg-cream/70 px-3 py-2 text-bronze">
                Contacto de WhatsApp aún sin ficha enlazada.
              </span>
            )}
          </div>
        </div>

        {/* Status actions */}
        <div className="mx-3 mt-2 rounded-2xl border border-border/60 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-warm-gray">Acciones</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => changeStatus(isResolved ? "open" : "resolved")}
              className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-semibold transition-colors duration-150 ${
                isResolved
                  ? "bg-emerald-500 border-emerald-500 text-white shadow-sm"
                  : "bg-[#f7f9fe] border-[#e6edf7] text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              <CheckCircle2 size={18} />
              <span>Resolver</span>
            </button>
            <button
              onClick={markUnread}
              className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-semibold transition-colors duration-150 ${
                isUnreadActive
                  ? "bg-sky-500 border-sky-500 text-white shadow-sm"
                  : "bg-[#f7f9fe] border-[#e6edf7] text-slate-600 hover:bg-sky-50 hover:text-sky-700"
              }`}
            >
              <RefreshCw size={18} />
              <span>No leído</span>
            </button>
          </div>
          <button
            onClick={sendReminder}
            disabled={sending}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-bronze px-3 text-sm font-semibold text-white
                       shadow-sm transition-colors duration-150 hover:bg-bronze-deep disabled:opacity-50"
          >
            <Send size={14} /> Enviar recordatorio
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-2.5">
            <section className="rounded-2xl border border-border/60 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-warm-gray">
                  <Tag size={12} /> Etiquetas
                </p>
                <button
                  onClick={() => {
                    setLabelConfigMode((v) => !v);
                    setLabelDropdownOpen(true);
                    setEditingLabelKey(null);
                    setLabelDraft({ key: "", text: "", tone: "blue" });
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    labelConfigMode
                      ? "bg-gold text-white"
                      : "bg-cream text-bronze hover:bg-glow/40"
                  }`}
                  title="Configurar etiquetas"
                >
                  <Settings size={13} />
                </button>
              </div>

              <div className="rounded-2xl border border-border bg-cream/35">
                <button
                  onClick={() => setLabelDropdownOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-bronze-deep">
                    {labels.length
                      ? labels.map((key) => labelConfig[key]?.text || key).join(", ")
                      : "Seleccionar etiquetas"}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    {labels.length > 0 && (
                      <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-bronze">
                        {labels.length}
                      </span>
                    )}
                    <ChevronDown size={14} className={`text-warm-gray transition-transform ${labelDropdownOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>

                {labelDropdownOpen && (
                  <div className="border-t border-border p-3">
                    {!labelConfigMode ? (
                      <div className="flex flex-wrap gap-2">
                        {labelDefs.map((label) => {
                          const key = label.key;
                          const cfg = labelConfig[key] || LABEL_TONES.neutral;
                          const active = labels.includes(key);
                          return (
                            <button
                              key={key}
                              onClick={() => toggleLabel(key)}
                              className={`
                                inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium
                                transition-all duration-150
                                ${active
                                  ? `${cfg.bg} ${cfg.fg} border-current`
                                  : "bg-white text-warm-gray border-border hover:bg-cream"
                                }
                              `}
                            >
                              <span className={`w-2 h-2 rounded-full ${active ? cfg.dot : "bg-warm-gray/40"}`} />
                              {label.text}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        <div className="grid gap-1.5">
                          {labelDefs.map((label) => {
                            const cfg = labelConfig[label.key] || LABEL_TONES.neutral;
                            return (
                              <div
                                key={label.key}
                                className="flex items-center gap-2 rounded-xl bg-white/70 p-2"
                              >
                                <span className={`inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${cfg.bg} ${cfg.fg}`}>
                                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                                  <span className="truncate">{label.text}</span>
                                </span>
                                <button
                                  onClick={() => startEditingLabel(label)}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-warm-gray hover:bg-cream hover:text-bronze"
                                  title="Editar etiqueta"
                                >
                                  <Edit3 size={12} />
                                </button>
                                <button
                                  onClick={() => removeLabel(label.key)}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-warm-gray hover:bg-red-50 hover:text-red-500"
                                  title="Eliminar etiqueta"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="rounded-2xl border border-border bg-white/70 p-3">
                          <input
                            value={labelDraft.text}
                            onChange={(e) => setLabelDraft((d) => ({ ...d, text: e.target.value }))}
                            placeholder="Nombre de etiqueta"
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-bronze-deep placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-gold/40"
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {Object.entries(LABEL_TONES).map(([tone, cfg]) => (
                              <button
                                key={tone}
                                onClick={() => setLabelDraft((d) => ({ ...d, tone }))}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${cfg.bg} ${cfg.fg} ${
                                  labelDraft.tone === tone ? cfg.ring : "border-transparent"
                                }`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                                {cfg.label}
                              </button>
                            ))}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={saveLabelDraft}
                              className="flex-1 rounded-xl bg-bronze px-3 py-2 text-xs font-semibold text-white hover:bg-bronze-deep"
                            >
                              {editingLabelKey ? "Guardar cambios" : "Crear etiqueta"}
                            </button>
                            <button
                              onClick={() => {
                                setEditingLabelKey(null);
                                setLabelDraft({ key: "", text: "", tone: "blue" });
                              }}
                              className="rounded-xl border border-border px-3 py-2 text-xs font-semibold text-bronze hover:bg-cream"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-white p-3 shadow-sm">
              <p className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-warm-gray">
                <StickyNote size={12} /> Notas internas
              </p>
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
            </section>
          </div>
        </div>

      </div>
    );
  }

  // ─── Layout ───────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        {mobileView === "list" && renderConversationList()}
        {mobileChat.shouldRender && (
          <div className={`flex-1 flex flex-col alma-slide-right alma-anim-${mobileChat.phase}`}>
            {renderChatColumn()}
          </div>
        )}
        {mobilePanel.shouldRender && (
          <div className={`flex-1 flex flex-col alma-slide-right alma-anim-${mobilePanel.phase}`}>
            {renderClientPanel()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {renderConversationList()}
      {renderChatColumn()}
      {renderClientPanel()}
    </div>
  );
}
