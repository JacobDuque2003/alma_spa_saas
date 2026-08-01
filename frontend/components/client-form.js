"use client";

import { useState } from "react";

// Shared fields for creating or editing a client. Used from Clientes
// (Nueva/Editar) AND from Agenda's "Nueva reserva → + Crear nueva clienta".
// Kept in one place so both flows collect exactly the same info.

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid rgba(168,154,135,0.5)",
  borderRadius: 8,
  fontSize: 14,
  color: "#6B5540",
  background: "#FDFCFA",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle = { display: "block", fontSize: 12, color: "#A89A87", marginBottom: 5 };

export function ClientForm({
  initial = {},
  onSubmit,
  onCancel,
  submitLabel = "Guardar",
  cancelLabel = "Cancelar",
  compact = false,
}) {
  const [fullName, setFullName] = useState(initial.fullName || "");
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp || "");
  const [email, setEmail] = useState(initial.email || "");
  const [birthday, setBirthday] = useState(initial.birthday || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fullName.trim() || !whatsapp.trim()) {
      setError("Nombre y WhatsApp son obligatorios");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim() || null,
        birthday: birthday || null,
      });
    } catch (err) {
      setError(err?.message || "Error al guardar");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
      <div>
        <label style={labelStyle}>Nombre completo</label>
        <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ej: Camila Andrade" />
      </div>
      <div>
        <label style={labelStyle}>WhatsApp</label>
        <input style={inputStyle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+593999000000" />
      </div>
      <div>
        <label style={labelStyle}>Correo (opcional)</label>
        <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ejemplo@correo.com" />
      </div>
      <div>
        <label style={labelStyle}>Cumpleaños (opcional)</label>
        <input type="date" style={inputStyle} value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </div>
      {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
