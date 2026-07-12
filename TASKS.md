# Tareas — Alma Spa Backend

## Fase 1 — Esquema multi-tenant + autenticación + permisos

- [x] `package.json` + dependencias (express, prisma, jsonwebtoken, bcryptjs, dotenv)
- [x] `prisma/schema.prisma`: Tenant, User, RolePermission, enum Role
- [x] Autenticación JWT (login, hash, middleware `authenticate`)
- [x] Autorización (`requirePermission`, `requireRole`, `protectSuperadmin`) + `userService` con guard de `isProtected`
- [x] Rutas `auth.js` + `users.js` montadas en `app.js`
- [x] `prisma/seed.js` (tenant alma-spa, superadmin, dueño, 2 personal)
- [x] 19 tests unitarios de las reglas de seguridad (mock de Prisma)
- [x] Verificación manual del servidor levantado localmente (sin DB real disponible en el entorno)
- [x] `git init` + primer commit
- [x] Verificación end-to-end contra PostgreSQL real (Railway, DB dedicada `alma_spa`, no barbershop): `migrate dev` + `db:seed` + walkthrough completo de curl (login por rol, 403 real sobre superadmin, tenantId forjado ignorado) — ver `CHANGELOG.md` [0.1.1] para el detalle exacto de cada paso
- [x] **Aprobado por el usuario** el esquema `Tenant`/`User`/`RolePermission` con evidencia real contra Postgres
- [x] ~~Pendiente de higiene: rotar la password de la DB Railway~~ — confirmado por el usuario que la contraseña actual (`hayabusa.proxy.rlwy.net:42587`) es la vigente

## Fase 2 — Configuración (catálogo base) — COMPLETADA

- [x] `Service`, `Room` (+ enum `RoomStatus`), `Plan` en `prisma/schema.prisma` (relaciones inversas en `Tenant`, sin tocar columnas de Fase 1)
- [x] `src/utils/tenantScope.js` extraído de `userService.js` (reutilizado por los 3 servicios nuevos, sin cambio de comportamiento en Fase 1)
- [x] CRUD `services` — `category`, `durationMins` fijo en 60 (ignora lo que mande el cliente), `priceUsd` en `Decimal`
- [x] CRUD `rooms` — `specialty` validado contra `Service.category` activa del tenant (400 si no coincide)
- [x] CRUD `plans` — `appliesToAllServices`, `serviceIds` validados contra el tenant del actor (400 si alguno es de otro tenant)
- [x] Integridad simétrica: `DELETE /services/:id` rechaza con 400 si es la última service activa de su category y un room activo depende de ella
- [x] Todos los endpoints bajo `authenticate` + `requirePermission('configuracion')`
- [x] 33 tests unitarios (19 Fase 1 sin regresión + 14 nuevos de Fase 2, mock de Prisma)
- [x] Migración + walkthrough completo contra Postgres real (Railway) — ver `CHANGELOG.md` [0.2.0] para el detalle exacto de cada paso, incluyendo la primera prueba real (no mock) de `requirePermission('configuracion')`
- [x] **Aprobado por el usuario** el esquema `Service`/`Room`/`Plan`

## Fase 3a — Reserva pública + modelo de citas (sin Google Calendar) — COMPLETADA

- [x] Diseño hecho con 3 agentes invocados explícitamente (Backend Architect, Application Security Engineer, Database Optimizer x2) — ver `AGENTS.md` para el mapeo que originó esta invocación explícita
- [x] `Client`, `ClientIntake` (cifrada AES-256-GCM), `Appointment` (+ enums `AppointmentStatus`/`AppointmentModality`) en `prisma/schema.prisma`
- [x] `Service.offersHomeService`, `User.canAttendAppointments` + índices nuevos (`(tenantId, category, active)`, `(tenantId, specialty, active)`, `(tenantId, role, active, canAttendAppointments)`)
- [x] `src/utils/intakeCrypto.js` (AES-256-GCM nativo) + fail-fast de `INTAKE_ENCRYPTION_KEY` al arrancar (`process.exit(1)` si falta/inválida)
- [x] `src/middleware/resolvePublicTenant.js` (tenant por slug, nunca por body/query) + `src/middleware/publicRateLimit.js` (IP simple / IP+tenantSlug agresivo)
- [x] Auto-asignación de `roomId`/`staffId` (el cliente nunca elige terapeuta) con reintento ante `P2002` — `src/services/appointmentService.js`
- [x] Modalidad `domicilio`: `roomId` nullable, `Service.offersHomeService` como opt-in, sin tocar `Room.status=a_domicilio` (explícitamente fuera de alcance)
- [x] Rutas públicas (`/public/:tenantSlug/...`, `/public/bookings/:token`) y autenticadas (`/appointments`, `requirePermission('agenda')`)
- [x] 54 tests unitarios (35 previos sin regresión + 19 nuevos, mock de Prisma)
- [x] Migración + walkthrough completo contra Postgres real (Railway) — ver `CHANGELOG.md` [0.3.0] para el detalle exacto de cada paso
- [x] **Aprobado por el usuario** el esquema `Client`/`ClientIntake`/`Appointment`

## Fase 3b — Google Calendar — DESCARTADA (no pospuesta)

Diseño completo hecho con 3 agentes (Backend Architect, Security Architect, Application Security Engineer) — ver `CHANGELOG.md` "[Decisión de alcance] Fase 3b descartada" y `MEMORY.md` para el razonamiento completo. **No hay tareas pendientes de esta fase**: no se implementa, el documento de diseño queda solo como referencia histórica en `C:\Users\59399\.claude\plans\cozy-crafting-acorn.md` (marcado `[DESCARTADO]`). El comentario `TODO Fase 3b` en `appointmentService.js` ya fue reemplazado por un comentario explícito de descarte.

## Fase 4 — Clientes — COMPLETADA

- [x] Diseño con 4 agentes (Backend Architect + Database Optimizer + Security Architect + Application Security Engineer) — ver `fase4-plan.md` y los docs `fase4-*.md`
- [x] `TreatmentHistory`, `ClientPlan`, `ClientLedgerEntry`, `ClientIntakeAuditLog` (+ 3 enums) en `prisma/schema.prisma`
- [x] Edición/lectura auditada de `ClientIntake` desde el panel (`getIntakeForActor`/`updateIntakeForActor`/`getIntakeAuditLog`) con orden fail-closed (H2) y tenant-scope vía `Client` (H3)
- [x] `treatmentHistoryService` — notas cifradas, terapeuta seleccionable con default al actor (validado `canAttendAppointments`), `updatedById` en edición (D8)
- [x] `clientPlanService` — contratar/renovar con auto-cargo en la misma transacción (D7), cortesía solo dueño/superadmin; consume atómico
- [x] `ledgerService` — cargos/pagos/reversa (append-only), saldo derivado, refs validadas contra tenant/cliente (M1)
- [x] Rutas en `routes/clients.js` con gating correcto (`clientes` general; `dueño/superadmin` para reversa/borrado/lector de auditoría)
- [x] Guard H1 (test) que prohíbe usar encryptField/decryptField fuera de los servicios sancionados
- [x] 75 tests unitarios (54 previos + 21 nuevos, mock de Prisma)
- [x] Code Reviewer: confirmó los 4 requisitos críticos; hallazgos M1/B1/B2/B3/B4 aplicados
- [x] Migración + walkthrough completo (21 pasos) contra Postgres real — ver `CHANGELOG.md` [0.4.0]
- [x] Bug de wiring encontrado en el walkthrough (router de clientes en `/` con authenticate global rompía las rutas públicas) — corregido con authenticate por-ruta
- [ ] **Pendiente de despliegue (Fase 8)**: aplicar el grant de DB restringido sobre `ClientIntakeAuditLog` con un rol de app de privilegios mínimos (hoy la app conecta como superusuario `postgres`; el append-only está garantizado en la capa de aplicación). SQL en `docs/append-only-audit-grant.sql`.

## Fase 5 — CRM (WhatsApp) — COMPLETADA

- [x] Diseño con 5 agentes (Backend Architect, Database Optimizer, Security Architect, Application Security Engineer, Code Reviewer) — Modelo B confirmado. Plan en `fase5-plan.md`; docs `fase5-*` (agente)
- [x] Schema: `WhatsAppConnection`/`WhatsAppConversation`/`WhatsAppMessage` + 5 enums + índice `(tenantId, status, startsAt)` en Appointment — migración `20260711133626_fase5_crm_whatsapp`
- [x] `fieldCrypto.js` (generalización) + `intakeCrypto.js` → wrapper + `whatsappCredentialCrypto.js` + guard nuevo; clave `WHATSAPP_TOKEN_ENCRYPTION_KEY` con fail-fast + `assertKeysDifferOrExit`
- [x] Webhook `/webhooks/whatsapp/:tenantSlug` (firma HMAC fail-closed, rawBody, sin bypass)
- [x] Endpoints `/settings/whatsapp` (connect con validación viva, status sin token) y `/crm` (bandeja con 7 endpoints)
- [x] Servicio de envío (fetch, texto vs plantilla según ventana 24h) + `POST /public/bookings/:token/confirm`
- [x] Gancho de Fase 3a (bookingNotifier tras la tx, best-effort, fuera de transacción)
- [x] `src/utils/phone.js` — normalización E.164 consistente (normalizePhone/phoneToWaId/waIdToPhone)
- [x] Code Reviewer real: 2 blockers + 4 suggestions aplicados:
  - B1: XSS reflejado en webhook challenge → `res.type('text/plain')`
  - B2: Race condition en delivery status → UPDATE atómico con WHERE condicional (raw SQL)
  - S3: Cursor pagination con timestamp no-único → composite cursor (timestamp|id)
  - S4: TOCTOU en phoneNumberId → catch P2002 con mensaje amigable
  - S5: Dedup race infla unreadCount → conversation update después del message insert
  - S6: Formato de teléfono inconsistente → normalización centralizada en `phone.js`
- [x] 104 tests unitarios (75 previos + 29 nuevos, 0 regresiones)
- [x] Walkthrough completo (14 pasos) contra Postgres real (Railway) simulando a Meta con curl — ver `CHANGELOG.md` [0.5.0]

## Fase 6 — Reportes — COMPLETADA

- [x] Diseño con 3 agentes (Backend Architect + Database Optimizer, Application Security Engineer, Code Reviewer) — Plan aprobado con decisión de atribución por Appointment.staffId y workDays configurable en Tenant.config
- [x] 2 índices nuevos: `@@index([tenantId, type, createdAt])` en ClientLedgerEntry, `@@index([tenantId, createdAt])` en Client
- [x] `src/services/reportService.js`: 6 métricas (ocupación gabinetes, ingresos por servicio, servicios vendidos, desempeño terapeutas, cancelaciones, clientes nuevos/recurrentes) con comparación automática contra periodo anterior
- [x] `src/routes/reports.js`: endpoint único `GET /reports/:metric?from=&to=` con `authenticate + requirePermission('reportes')`
- [x] Restricción financiera: `ingresos-servicio` → 403 para personal; `desempeno-terapeutas` omite campo `ingresosUsd` (ausente, no null) para no-dueño
- [x] `Tenant.config.workDays` (array ISO, default [1,2,3,4,5,6]) para capacidad teórica de ocupación — configurable por tenant
- [x] Atribución de terapeuta: `Appointment.staffId` como fuente única (decisión documentada: no se usa TreatmentHistory.therapistId)
- [x] Ingresos de planes separados (`planRevenue`), no prorrateados por servicio
- [x] Code Reviewer: 0 blockers, 3 suggestions (S1 nuevosIds, S2 pendiente en desempeño, S3 semántica de ocupación) — ninguna requiere cambio
- [x] 113 tests unitarios (104 previos + 9 de reportes + 4 de router, 0 regresiones)
- [x] Migración `20260711191427_fase6_reportes_indexes` aplicada contra Railway
- [x] Walkthrough completo (13 pasos) contra Postgres real — todas las validaciones, 6 métricas, restricción por rol verificada

## Fases 7–8 — pendientes

- [ ] Fase 7: Import/Export Excel
- [ ] Fase 8: Auditoría de seguridad + testing + despliegue
  - [ ] **Pendiente de Fase 4**: aplicar grant de DB restringido sobre `ClientIntakeAuditLog` con rol de app de privilegios mínimos (hoy append-only garantizado solo en capa de aplicación). SQL en `docs/append-only-audit-grant.sql`.
  - [ ] **Pendiente de Fase 5**: si `processInboundMessage` falla al actualizar `WhatsAppConversation` (unreadCount/lastMessageAt) después de guardar el mensaje exitosamente, hoy solo se loguea un warning — el mensaje queda guardado pero la bandeja puede mostrar metadata desincronizada (contador de no leídos, orden) sin ninguna alerta. Evaluar: métrica/alerta sobre estos warnings, o un mecanismo de reconciliación que recalcule unreadCount/lastMessageAt desde los mensajes reales en vez de confiar solo en el incremento puntual.

## Hallazgos de seguridad en OTROS proyectos (no Alma Spa) — no perder de vista

- [ ] **BarberBot / El Cubano Barbería (`barbershop/`, EN PRODUCCIÓN con cliente real)**: `src/routes/webhooks.js` tiene un bypass real de la verificación de firma del webhook de WhatsApp — `verifyWhatsAppSignature` hace `if (!appSecret) return true`, es decir **acepta webhooks sin firma válida** si `WHATSAPP_APP_SECRET` no está configurado. En un endpoint público esto permite que cualquiera inyecte payloads de webhook falsos (mensajes, cambios de estado). Además re-serializa el body (`Buffer.from(JSON.stringify(req.body))`) como fallback, que ni siquiera reproduce los bytes originales para el HMAC. Detectado al diseñar Fase 5 de Alma Spa (que deliberadamente NO copia este patrón). Revisar/corregir en barbershop cuando se retome ese proyecto.
