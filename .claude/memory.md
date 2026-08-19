# Alma Spa SaaS — memoria operativa

## 2026-08-19 — Fix P0 (amparito) + P1 (15 tests) — roles invocados por nombre, sin agents/*.md

**No existe carpeta `agents/` en el repo.** Se invocaron los roles Security Architect y Application Security Engineer por nombre, sin archivo formal, para la parte de accessSchedule/tenant.

### P0 — amparito@almaspa.com desbloqueada (evidencia real en Railway)

- **Antes:** `accessSchedule = { monday..sunday: null, alwaysAllowed: false }` — los 7 días cerrados explícitamente, no `null`. Confirmado con query directa a Railway.
- **Causa raíz identificada (no corregida en esta ronda, fuera de alcance):** `AccessScheduleEditor` en [personal/page.js:907-913](frontend/app/admin/(dashboard)/personal/page.js:907) guarda `draft` tal cual cuando `alwaysAllowed` es `false`, sin exigir que al menos un día esté marcado. Si un dueño/admin desmarca "24/7" con la intención de configurar horarios pero no llega a activar ningún día antes de guardar, el resultado es un bloqueo total silencioso — mismo shape que tenía amparito. **Riesgo de que se repita con cualquier otra cuenta.** Queda como hallazgo para una ronda futura, con propuesta: exigir al menos un día activo antes de permitir guardar `alwaysAllowed:false`, o tratar "0 días activos" como inválido en `validateSchedule` ([accessSchedule.js:130](src/utils/accessSchedule.js:130)).
- **Fix aplicado:** `accessSchedule` corregido a `null` (fail-open, 24/7) vía script directo contra Railway usando el rol de runtime (`DATABASE_URL`, no el de migraciones). Se registró en `AdminAuditLog` (entity `user`, action `update`, actor Jacob, con el detalle before/after) para dejar rastro de la intervención manual.
- **Verificación de login — evidencia real, sin manejar su contraseña:** se replicó exactamente el código de `authService.login()` (mismo `checkAccess`, mismo `accessSchedule` real ya corregido, mismo tenant/timezone reales de Railway, hora real) contra su fila real. Resultado: `{ accessScheduleInDb: null, roleAlwaysAllowed: false, loginGateResult: { allowed: true } }`. No se tocó ni se pidió su contraseña — verificar el login completo requeriría credenciales que no corresponde manejar.

### No tocado en esta ronda (por restricción explícita)

Cabinas/Servicios, `Room.colorHex`, diseño GET-solo-lectura de 9b (`7774f2c`), arquitectura multi-tenant.

## 2026-08-18 — Auditoría post-ronda P0/P2 (sesión sin PM presente)

**No es un cierre — es un inventario de lo que hicieron sesiones ajenas después del commit `1ace68e` (feat(personal): accessSchedule) que quedó local esperando GATE #2 del PM.**

### Estado real vs asumido

- **`.claude/memory.md` anterior decía "backend 284/284".** Realidad al 2026-08-18: `npm test` da **303 tests, 288 pass, 15 fail**. Diferencia declarada como no regresión, es regresión.
- **9b (`accessSchedule`) se aplicó a Railway** sin haber recibido explícitamente el GATE #2 del PM en esta memoria (aunque probablemente hubo aprobación en sesión que no quedó registrada).
- **Se aplicaron 4 migraciones desde `1ace68e`**: `access_schedule`, `cabinas_servicios_reales`, `room_color_hex`, `client_fine_permissions`. **Las 3 últimas son scope creep** respecto al loop autónomo cerrado (que prohibía tocar Cabinas/Servicios/anamnesis).

### 15 tests fallando

Dos zonas:
1. **`authenticate deriva req.user del JWT`** — test de seguridad crítico. Falla `false !== true` — muy probablemente introducido por el refactor de `authenticate` para inyectar `accessSchedule`.
2. **`/clients/…` y `/search`** — 14 tests relacionados con permisos finos nuevos (`clientesEditar`, `clientesAnamnesis`, `clientesHistorial`, `clientesEstado`, `clientesEliminar`, `clientesPagos`, `clientesExportar`) más el test `GET /clients/:id bloquea cross-tenant`. Combinación de tests nuevos que asumen infra que no cuadra + tests viejos desactualizados por el refactor de rutas.

### Cambios de schema aplicados a Railway (verificados con `information_schema.columns`)

- `User.accessSchedule JSONB` ✅
- `AuditAction.accessDeniedSchedule` ✅
- `Service.bufferMins INT DEFAULT 15`, `Service.colorHex TEXT DEFAULT '#8C6E50'`
- `Room.sortOrder INT DEFAULT 0`, `Room.colorHex` (posiblemente doble, verificar en psql), `Room.schedule JSONB`, `Room.closesAt` default cambiado a 20:00
- `Client.recordNumber TEXT` (con `@@unique(tenantId, recordNumber)`), `Client.address TEXT`
- `Appointment.indications TEXT`
- Tabla nueva `_RoomServices` (M:N Room↔Service) con backfill por specialty
- `RolePermission` + 7 columnas booleanas nuevas (permisos finos de Clientes)

### Estado de Railway (poblado real)

- rooms 11, services 20, clients 5, appointments 22, users 6
- Tenant `alma-spa` con `businessHours` en shape nuevo 09-12 + 15-20
- Usuarios: `admin@nuvio.tech`, `jacob@almaspa.com`, `gianella@almaspa.com`, `admin@alma.local` (nuevo, superadmin), `amparito@almaspa.com` (personal, **schedule con los 7 días en null → bloqueada 24/7**, revisar), `prueba@almaspa.com` (personal, schedule null → 24/7 open)

### Divergencia del diseño 9b aprobado

Commit `7774f2c` implementa "solo lectura fuera de horario": GET/HEAD/OPTIONS pasan con headers `X-Alma-Out-Of-Schedule`, POST/PATCH/DELETE bloqueados. **La Security Architect no re-validó esta variante**; el diseño aprobado era 403 completo para toda la request.

### Secret scan

Grep de tokens/API keys/passwords hardcoded en `src/`, `frontend/`, `scripts/`: cero matches. `.env` nunca en git log. Sin exposición conocida.

### Verificaciones pendientes históricas

- **Toast cumpleaños al login (Ronda 3):** sigue sin verificación runtime real.
- **Render `/admin/personal`:** múltiples commits refactorizaron Personal después del bug ReferenceError; probablemente resuelto pero sin verificación runtime documentada.
