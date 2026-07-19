"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Loader2, Send, Settings, X } from "lucide-react";

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "WA";
}

function time(value) {
  return value ? new Date(value).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" }) : "";
}

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
  const [error, setError] = useState("");
  const [quickReplies, setQuickReplies] = useState([
    "Hola, gracias por escribirnos a Alma Spa. ¿En qué podemos ayudarte?",
    "Tu cita ha sido confirmada. Te esperamos.",
    "Nuestro horario es de lunes a viernes de 9:00 a 19:00.",
    "¿Te gustaría agendar una cita? Puedo ayudarte con eso.",
  ]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showEditReplies, setShowEditReplies] = useState(false);
  const [editingReplyIdx, setEditingReplyIdx] = useState(null);
  const [editReplyText, setEditReplyText] = useState("");
  const [newReplyText, setNewReplyText] = useState("");

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await authFetch("/crm/conversations", {
        query: {
          ...(filter === "pending" ? { filter: "sin_confirmar_hoy" } : {}),
          ...(q ? { q } : {}),
        },
      });
      const items = data.items || [];
      setConversations(items);
      setSelectedId((current) => current || items[0]?.id || null);
    } catch (err) {
      setError(err.message);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => {
    const t = setTimeout(fetchConversations, 200);
    return () => clearTimeout(t);
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
      await authFetch(`/crm/conversations/${selectedId}/mark-read`, { method: "POST" }).catch(() => null);
    } catch (err) {
      setError(err.message);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  async function sendText() {
    if (!body.trim() || !selectedId) return;
    setSending(true);
    try {
      await authFetch(`/crm/conversations/${selectedId}/messages`, { method: "POST", body: { body } });
      setBody("");
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendReminder() {
    if (!selectedId) return;
    setSending(true);
    try {
      await authFetch(`/crm/conversations/${selectedId}/reminder`, { method: "POST" });
      await Promise.all([fetchConversation(), fetchConversations()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function useQuickReply(text) {
    setBody(text);
    setShowQuickReplies(false);
  }

  function deleteQuickReply(idx) {
    setQuickReplies((prev) => prev.filter((_, i) => i !== idx));
    if (editingReplyIdx === idx) {
      setEditingReplyIdx(null);
      setEditReplyText("");
    }
  }

  function startEditQuickReply(idx) {
    setEditingReplyIdx(idx);
    setEditReplyText(quickReplies[idx]);
  }

  function saveEditQuickReply() {
    if (editingReplyIdx === null) return;
    const text = editReplyText.trim();
    if (text) {
      setQuickReplies((prev) => prev.map((r, i) => (i === editingReplyIdx ? text : r)));
    }
    setEditingReplyIdx(null);
    setEditReplyText("");
  }

  function addQuickReply() {
    const text = newReplyText.trim();
    if (!text) return;
    setQuickReplies((prev) => [...prev, text]);
    setNewReplyText("");
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Inbox sidebar */}
      <div
        style={{
          width: 360,
          flex: "0 0 360px",
          borderRight: "1px solid rgba(168,154,135,0.35)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(247,245,240,0.6)",
        }}
      >
        <div style={{ padding: "24px 20px 14px" }}>
          <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 14px" }}>
            CRM · WhatsApp
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setFilter("all")}
              style={{
                padding: "7px 16px",
                borderRadius: 999,
                border: filter === "all" ? "none" : "1px solid rgba(168,154,135,0.5)",
                background: filter === "all" ? "#C9A876" : "transparent",
                color: filter === "all" ? "#F7F5F0" : "#6B5540",
                fontSize: 13,
                fontWeight: filter === "all" ? 500 : 400,
                cursor: "pointer",
              }}
            >
              Todas
            </button>
            <button
              onClick={() => setFilter("pending")}
              style={{
                padding: "7px 16px",
                borderRadius: 999,
                border: filter === "pending" ? "none" : "1px solid rgba(168,154,135,0.5)",
                background: filter === "pending" ? "#C9A876" : "transparent",
                color: filter === "pending" ? "#F7F5F0" : "#6B5540",
                fontSize: 13,
                fontWeight: filter === "pending" ? 500 : 400,
                cursor: "pointer",
              }}
            >
              Sin confirmar hoy
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 12px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={20} className="animate-spin" style={{ color: "#A89A87" }} />
            </div>
          ) : conversations.length === 0 ? (
            <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "#A89A87" }}>No hay conversaciones.</p>
          ) : (
            conversations.map((c) => {
              const isSelected = c.id === selectedId;
              const name = c.clientName || c.customerName || c.customerWaId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "14px 12px",
                    borderRadius: 10,
                    background: isSelected ? "rgba(235,205,181,0.45)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: isSelected ? "#C9A876" : "rgba(201,168,118,0.35)",
                      color: isSelected ? "#F7F5F0" : "#8C6E50",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {initials(name)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#6B5540" }}>{name}</span>
                      <span style={{ fontSize: 11, color: "#A89A87" }}>{time(c.lastMessageAt)}</span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#8C6E50",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.lastMessagePreview || "Sin mensajes"}
                    </div>
                    {!c.withinWindow && (
                      <span
                        style={{
                          display: "inline-flex",
                          marginTop: 5,
                          padding: "2px 9px",
                          borderRadius: 999,
                          background: "#6B5540",
                          color: "#EBE8E1",
                          fontSize: 10,
                          fontWeight: 500,
                        }}
                      >
                        Usar plantilla
                      </span>
                    )}
                  </div>
                  {c.unreadCount > 0 && (
                    <span style={{ marginTop: 8, width: 8, height: 8, borderRadius: "50%", background: "#C9A876" }} />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          background: "#E7E3DC",
          backgroundImage: "radial-gradient(circle, rgba(168,154,135,0.12) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {selected ? (
          <>
            {/* Chat header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 24px",
                borderBottom: "1px solid rgba(168,154,135,0.35)",
                background: "#F7F5F0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "#C9A876",
                    color: "#F7F5F0",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {initials(selected.customerName || selected.customerWaId)}
                </span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#6B5540" }}>
                    {selected.customerName || selected.customerWaId}
                  </div>
                  <div style={{ fontSize: 12, color: "#A89A87" }}>{selected.customerWaId}</div>
                </div>
              </div>
              <button
                onClick={sendReminder}
                disabled={sending}
                style={{
                  padding: "9px 20px",
                  borderRadius: 999,
                  background: "#8C6E50",
                  color: "#F7F5F0",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: sending ? "wait" : "pointer",
                  opacity: sending ? 0.7 : 1,
                }}
              >
                Enviar recordatorio
              </button>
            </div>

            {error && (
              <div style={{ margin: "12px 24px 0", padding: 12, borderRadius: 8, background: "rgba(201,168,118,0.15)", color: "#8C6E50", fontSize: 13 }}>
                {error}
              </div>
            )}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.direction === "outbound" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "70%",
                      borderRadius: 12,
                      padding: 14,
                      fontSize: 14,
                      background: m.direction === "outbound" ? "#E8D8BE" : "#F7F5F0",
                      color: "#6B5540",
                      boxShadow: "0 1px 3px rgba(107,85,64,0.08)",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      {m.body || (m.type === "template" ? `Recordatorio enviado` : `Mensaje ${m.type === "image" ? "con imagen" : ""}`)}
                    </p>
                    <p style={{ margin: "6px 0 0", textAlign: "right", fontSize: 11, color: "#A89A87" }}>
                      {time(m.createdAt)} {m.status ? `· ${m.status}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div
              style={{
                position: "relative",
                display: "flex",
                gap: 12,
                padding: "16px 24px",
                borderTop: "1px solid rgba(168,154,135,0.35)",
                background: "#F7F5F0",
              }}
            >
              {showQuickReplies && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    right: 0,
                    background: "#F7F5F0",
                    borderTop: "1px solid rgba(168,154,135,0.35)",
                    maxHeight: 280,
                    overflowY: "auto",
                    padding: "12px 24px",
                    boxShadow: "0 -4px 16px rgba(107,85,64,0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#6B5540", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Respuestas rapidas
                    </span>
                    <button
                      onClick={() => setShowEditReplies((v) => !v)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: "none",
                        background: showEditReplies ? "#C9A876" : "rgba(201,168,118,0.2)",
                        color: showEditReplies ? "#F7F5F0" : "#8C6E50",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Editar respuestas"
                    >
                      <Settings size={14} />
                    </button>
                  </div>

                  {quickReplies.length === 0 && (
                    <p style={{ fontSize: 13, color: "#A89A87", margin: "10px 0" }}>No hay respuestas guardadas.</p>
                  )}

                  {quickReplies.map((reply, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 0",
                        borderBottom: "1px solid rgba(168,154,135,0.2)",
                        cursor: showEditReplies ? "default" : "pointer",
                        fontSize: 13,
                        color: "#6B5540",
                      }}
                    >
                      {showEditReplies ? (
                        editingReplyIdx === idx ? (
                          <input
                            autoFocus
                            value={editReplyText}
                            onChange={(e) => setEditReplyText(e.target.value)}
                            onBlur={saveEditQuickReply}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditQuickReply();
                              if (e.key === "Escape") {
                                setEditingReplyIdx(null);
                                setEditReplyText("");
                              }
                            }}
                            style={{
                              flex: 1,
                              marginRight: 10,
                              padding: "6px 10px",
                              borderRadius: 6,
                              border: "1px solid rgba(168,154,135,0.5)",
                              fontSize: 13,
                              color: "#6B5540",
                              outline: "none",
                            }}
                          />
                        ) : (
                          <span
                            onClick={() => startEditQuickReply(idx)}
                            style={{ flex: 1, marginRight: 10, cursor: "pointer" }}
                          >
                            {reply}
                          </span>
                        )
                      ) : (
                        <span onClick={() => useQuickReply(reply)} style={{ flex: 1, marginRight: 10 }}>
                          {reply}
                        </span>
                      )}
                      {showEditReplies && (
                        <button
                          onClick={() => deleteQuickReply(idx)}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(194,84,80,0.12)",
                            color: "#C25450",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                          title="Eliminar"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}

                  {showEditReplies && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <input
                        value={newReplyText}
                        onChange={(e) => setNewReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addQuickReply();
                        }}
                        placeholder="Nueva respuesta rapida…"
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: 6,
                          border: "1px solid rgba(168,154,135,0.5)",
                          fontSize: 13,
                          color: "#6B5540",
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={addQuickReply}
                        disabled={!newReplyText.trim()}
                        style={{
                          padding: "8px 16px",
                          borderRadius: 6,
                          border: "none",
                          background: "#C9A876",
                          color: "#F7F5F0",
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: newReplyText.trim() ? "pointer" : "default",
                          opacity: newReplyText.trim() ? 1 : 0.5,
                        }}
                      >
                        Agregar
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setShowQuickReplies(!showQuickReplies)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: showQuickReplies ? "#C9A876" : "rgba(201,168,118,0.2)",
                  color: showQuickReplies ? "#F7F5F0" : "#8C6E50",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
                title="Respuestas rápidas"
              >
                ⚡
              </button>
              <input
                style={{
                  flex: 1,
                  padding: "10px 18px",
                  borderRadius: 999,
                  border: "1px solid rgba(168,154,135,0.5)",
                  background: "#FDFCFA",
                  fontSize: 14,
                  color: "#6B5540",
                  outline: "none",
                }}
                placeholder={selected.withinWindow ? "Escribe tu respuesta…" : "Han pasado mas de 24h — envia un recordatorio"}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!selected.withinWindow || sending}
                onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
              />
              <button
                onClick={sendText}
                disabled={!selected.withinWindow || sending || !body.trim()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "#8C6E50",
                  color: "#F7F5F0",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: !selected.withinWindow || !body.trim() ? 0.5 : 1,
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontSize: 14, color: "#A89A87" }}>
            Selecciona una conversación.
          </div>
        )}
      </div>
    </div>
  );
}
