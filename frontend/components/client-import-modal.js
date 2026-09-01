"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { authFetch } from "@/lib/auth-client";
import { useToast } from "./toast-provider";

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const base64 = String(reader.result || "").split(",")[1];
      if (!base64) return reject(new Error("El archivo no tiene datos válidos"));
      resolve(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`);
    };
    reader.readAsDataURL(file);
  });
}

export function ClientImportModal({ phase, onClose, onImported }) {
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [fileData, setFileData] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  async function selectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Selecciona un archivo .xlsx");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("El archivo debe pesar máximo 5 MB");
      return;
    }
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const data = await readExcelFile(file);
      const nextPreview = await authFetch("/clients/import/preview", { method: "POST", body: { fileData: data } });
      setFileName(file.name);
      setFileData(data);
      setPreview(nextPreview);
    } catch (err) {
      setFileData("");
      setError(err?.message || "No se pudo preparar la vista previa");
    } finally {
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!fileData || !preview?.validRows) return;
    setImporting(true);
    setError("");
    try {
      const result = await authFetch("/clients/import", { method: "POST", body: { fileData } });
      toast.success(`${result.created} creadas · ${result.completed} fichas completadas`);
      onImported?.(result);
      onClose();
    } catch (err) {
      setError(err?.message || "No se pudo importar el archivo");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className={`alma-backdrop alma-anim-${phase}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(58,47,38,0.4)" }}>
      <div onClick={(event) => event.stopPropagation()} className={`alma-card alma-modal alma-anim-${phase}`} style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflow: "auto", borderRadius: 18, padding: 26, position: "relative", background: "#FDFCFA" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 15, right: 15, border: "none", background: "none", color: "#A89A87", cursor: "pointer" }} aria-label="Cerrar"><X size={20} /></button>
        <h2 className="font-heading" style={{ color: "#6B5540", fontSize: 23, margin: "0 0 6px" }}>Importar clientas desde Excel</h2>
        <p style={{ color: "#8C6E50", fontSize: 13, margin: "0 0 18px", lineHeight: 1.45 }}>Primero revisaremos el archivo. La importación solo crea fichas nuevas o completa campos vacíos; nunca reemplaza datos ya registrados.</p>
        <label style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", padding: 18, border: "1px dashed rgba(140,110,80,0.55)", borderRadius: 14, color: "#8C6E50", cursor: loading ? "wait" : "pointer", background: "rgba(235,205,181,0.14)" }}>
          {loading ? <Loader2 size={19} className="animate-spin" /> : <FileSpreadsheet size={19} />}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{loading ? "Leyendo archivo…" : fileName || "Seleccionar archivo .xlsx (máx. 5 MB)"}</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={loading || importing} style={{ display: "none" }} />
        </label>
        {error && <p style={{ color: "#C25450", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
        {preview && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 9, marginTop: 18 }}>
              {[["Filas válidas", preview.validRows], ["Fichas completas", preview.completeRows], ["Para completar", preview.incompleteRows], ["Con errores", preview.invalidRows]].map(([label, value]) => (
                <div key={label} style={{ borderRadius: 12, padding: "11px 12px", background: "rgba(235,205,181,0.18)", color: "#6B5540" }}><strong style={{ display: "block", fontSize: 18 }}>{value}</strong><span style={{ fontSize: 11 }}>{label}</span></div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "#8C6E50", margin: "14px 0 8px" }}>Columnas reconocidas: {preview.recognized.join(", ") || "ninguna"}</p>
            <div style={{ overflowX: "auto", border: "1px solid rgba(168,154,135,0.24)", borderRadius: 12 }}>
              <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse", fontSize: 12, color: "#6B5540" }}>
                <thead><tr style={{ background: "rgba(235,205,181,0.18)" }}>{["Fila", "Nombre", "Celular", "Cédula", "Dirección", "Estado"].map((label) => <th key={label} style={{ textAlign: "left", padding: "9px 10px" }}>{label}</th>)}</tr></thead>
                <tbody>{preview.rows.map((row) => <tr key={row.rowNumber} style={{ borderTop: "1px solid rgba(168,154,135,0.18)" }}><td style={{ padding: "8px 10px" }}>{row.rowNumber}</td><td style={{ padding: "8px 10px" }}>{row.fullName || "—"}</td><td style={{ padding: "8px 10px" }}>{row.whatsapp || "—"}</td><td style={{ padding: "8px 10px" }}>{row.cedula || "—"}</td><td style={{ padding: "8px 10px" }}>{row.address || "—"}</td><td style={{ padding: "8px 10px", color: row.issues?.length ? "#C25450" : "#5C7A40" }}>{row.issues?.length ? row.issues.join(", ") : "Lista"}</td></tr>)}</tbody>
              </table>
            </div>
            {preview.truncated && <p style={{ color: "#8C6E50", fontSize: 12 }}>Se revisarán las primeras 1.000 filas.</p>}
            <button type="button" onClick={confirmImport} disabled={importing || preview.validRows === 0} style={{ width: "100%", marginTop: 16, display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "11px 16px", border: "none", borderRadius: 999, background: "#8C6E50", color: "#F7F5F0", fontSize: 13, fontWeight: 800, cursor: importing ? "wait" : "pointer", opacity: importing || preview.validRows === 0 ? 0.6 : 1 }}>{importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{importing ? "Importando…" : `Confirmar importación de ${preview.validRows} filas`}</button>
          </>
        )}
      </div>
    </div>
  );
}
