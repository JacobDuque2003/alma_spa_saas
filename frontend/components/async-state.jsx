"use client";

import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";

export function LoadingState({ title = "Cargando información", body = "Estamos preparando los datos.", compact = false }) {
  return (
    <div className="alma-state" data-variant="loading" data-compact={compact ? "true" : "false"} role="status">
      <Loader2 className="alma-state-icon animate-spin" size={compact ? 18 : 24} />
      <div>
        <p className="alma-state-title">{title}</p>
        {body && <p className="alma-state-body">{body}</p>}
      </div>
    </div>
  );
}

export function ErrorState({ title = "No pudimos cargar esta parte", body, actionLabel = "Intentar de nuevo", onAction, compact = false }) {
  return (
    <div className="alma-state" data-variant="error" data-compact={compact ? "true" : "false"} role="alert">
      <AlertTriangle className="alma-state-icon" size={compact ? 18 : 24} />
      <div>
        <p className="alma-state-title">{title}</p>
        {body && <p className="alma-state-body">{body}</p>}
        {onAction && (
          <button type="button" className="alma-state-action" onClick={onAction}>
            <RefreshCw size={14} />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title = "Todavía no hay contenido", body, actionLabel, onAction, compact = false }) {
  return (
    <div className="alma-state" data-variant="empty" data-compact={compact ? "true" : "false"}>
      <div className="alma-state-empty-icon" aria-hidden="true">
        {icon || <Inbox size={compact ? 18 : 24} />}
      </div>
      <div>
        <p className="alma-state-title">{title}</p>
        {body && <p className="alma-state-body">{body}</p>}
        {onAction && actionLabel && (
          <button type="button" className="alma-state-action" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
