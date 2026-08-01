"use client";

import { X } from "lucide-react";
import { authFetch } from "@/lib/auth-client";
import { ClientForm } from "./client-form";

// Standalone "Nueva clienta" modal reused from Clientes and from Agenda's
// "Nueva reserva → + Crear nueva clienta" flow. Same fields, same endpoint,
// same UX in both places.
export function NewClientModal({ phase, initialName = "", onClose, onSaved }) {
  return (
    <div
      className={`alma-backdrop alma-anim-${phase}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(58,47,38,0.4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`alma-card alma-modal alma-anim-${phase}`}
        style={{
          width: "100%",
          maxWidth: 400,
          margin: "0 16px",
          borderRadius: 16,
          padding: 28,
          position: "relative",
          boxShadow: "0 24px 64px rgba(107,85,64,0.18)",
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#A89A87" }}
        >
          <X size={20} />
        </button>
        <h2 className="font-heading" style={{ fontSize: 22, fontWeight: 600, color: "#6B5540", margin: "0 0 20px" }}>
          Nueva clienta
        </h2>
        <ClientForm
          initial={{ fullName: initialName }}
          onCancel={onClose}
          submitLabel="Crear clienta"
          onSubmit={async (payload) => {
            const created = await authFetch("/clients", { method: "POST", body: payload });
            onSaved(created);
          }}
        />
      </div>
    </div>
  );
}
