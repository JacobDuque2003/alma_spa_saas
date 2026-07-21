"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/auth-client";
import { Loader2, X } from "lucide-react";

const ROLE_LABELS = {
  superadmin: "Super Admin",
  dueno: "Dueña",
  admin: "Administradora",
  personal: "Terapeuta",
};

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

function getInitials(name) {
  if (!name) return "??";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function PerfilPage() {
  const { user } = useAuth();
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleChangePassword(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError("Todos los campos son obligatorios");
      return;
    }
    if (newPassword.length < 10) {
      setError("La nueva contraseña debe tener al menos 10 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña y la confirmación no coinciden");
      return;
    }
    if (currentPassword === newPassword) {
      setError("La nueva contraseña debe ser diferente a la actual");
      return;
    }

    setSaving(true);
    try {
      await authFetch("/auth/me/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPwForm(false);
    } catch (err) {
      setError(err.message || "Error al cambiar contraseña");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#8C6E50" }} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", maxWidth: 600 }}>
      <div>
        <h1 className="font-heading" style={{ fontSize: 26, fontWeight: 600, color: "#6B5540", margin: "0 0 4px" }}>Mi perfil</h1>
        <p style={{ margin: 0, fontSize: 14, color: "#A89A87" }}>Datos de tu cuenta y seguridad</p>
      </div>

      <div className="alma-card" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "#C9A876", color: "#F7F5F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 600, flexShrink: 0 }}>
            {getInitials(user.name)}
          </span>
          <div>
            <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: 0 }}>{user.name}</h2>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "#A89A87" }}>{ROLE_LABELS[user.role] || user.role}</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={labelStyle}>Correo electrónico</div>
            <div style={{ fontSize: 14, color: "#6B5540" }}>{user.email}</div>
          </div>
          <div>
            <div style={labelStyle}>Rol</div>
            <div style={{ fontSize: 14, color: "#6B5540" }}>{ROLE_LABELS[user.role] || user.role}</div>
          </div>
        </div>
      </div>

      <div className="alma-card" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 className="font-heading" style={{ fontSize: 20, fontWeight: 600, color: "#6B5540", margin: 0 }}>Seguridad</h3>
        </div>

        {success && (
          <div style={{ padding: 12, borderRadius: 8, background: "rgba(140,110,80,0.12)", color: "#6B5540", fontSize: 13, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Contraseña actualizada correctamente.</span>
            <button onClick={() => setSuccess(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}><X size={14} /></button>
          </div>
        )}

        {!showPwForm ? (
          <button onClick={() => { setShowPwForm(true); setError(null); setSuccess(false); }} style={{ padding: "10px 22px", borderRadius: 999, border: "1px solid #8C6E50", background: "transparent", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Cambiar contraseña
          </button>
        ) : (
          <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
            <div>
              <label style={labelStyle}>Contraseña actual</label>
              <input type="password" style={inputStyle} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <label style={labelStyle}>Nueva contraseña (mínimo 10 caracteres)</label>
              <input type="password" style={inputStyle} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label style={labelStyle}>Confirmar nueva contraseña</label>
              <input type="password" style={inputStyle} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p style={{ fontSize: 13, color: "#C25450", margin: 0 }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => { setShowPwForm(false); setError(null); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }} style={{ padding: "10px 0", borderRadius: 999, border: "1px solid #8C6E50", background: "none", color: "#8C6E50", fontSize: 14, fontWeight: 500, cursor: "pointer", flex: 1 }}>
                Cancelar
              </button>
              <button type="submit" disabled={saving} style={{ padding: "10px 0", borderRadius: 999, border: "none", background: "#8C6E50", color: "#F7F5F0", fontSize: 14, fontWeight: 500, cursor: saving ? "wait" : "pointer", flex: 1, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
