"use client";

import { useState } from "react";
import { formatEcuadorPhone } from "@/lib/phone-format";
import { useToast } from "./toast-provider";

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
  const [whatsapp, setWhatsapp] = useState(formatEcuadorPhone(initial.whatsapp || ""));
  const [email, setEmail] = useState(initial.email || "");
  const [recordNumber, setRecordNumber] = useState(initial.recordNumber || "");
  const [address, setAddress] = useState(initial.address || "");
  const [birthday, setBirthday] = useState(initial.birthday ? String(initial.birthday).slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const toast = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fullName.trim() || !whatsapp.trim()) {
      setValidation("Nombre y teléfono son obligatorios");
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim() || null,
        recordNumber: recordNumber.trim() || null,
        address: address.trim() || null,
        birthday: birthday || null,
      });
    } catch (err) {
      toast.error(err?.message || "Error al guardar");
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
        <label style={labelStyle}>Teléfono</label>
        <input style={inputStyle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="0993629256" />
      </div>
      <div>
        <label style={labelStyle}>Correo (opcional)</label>
        <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ejemplo@correo.com" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1.4fr", gap: compact ? 10 : 12 }}>
        <div>
          <label style={labelStyle}>N° de ficha</label>
          <input style={inputStyle} value={recordNumber} onChange={(e) => setRecordNumber(e.target.value)} placeholder="Ej: 00125" />
        </div>
        <div>
          <label style={labelStyle}>Dirección</label>
          <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Barrio, calle o referencia" />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Cumpleaños (opcional)</label>
        <input type="date" style={inputStyle} value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </div>
      {validation && <p style={{ fontSize: 13, color: "#C25450", margin: 0, textAlign: "center" }}>{validation}</p>}
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
          style={{
            padding: "10px 0",
            borderRadius: 999,
            border: "1px solid rgba(47,95,138,0.45)",
            background: "linear-gradient(135deg, rgba(47,95,138,0.12), rgba(47,95,138,0.06))",
            color: "#2F5F8A",
            fontSize: 14,
            fontWeight: 800,
            cursor: saving ? "wait" : "pointer",
            flex: 1,
            opacity: saving ? 0.6 : 1,
            boxShadow: "0 10px 22px rgba(47,95,138,0.08)",
          }}
        >
          {saving ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
