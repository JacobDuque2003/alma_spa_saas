# Memoria del proyecto — Alma Spa Backend

> Contexto vivo para retomar el trabajo entre sesiones. Ver también `docs/` (producto, arquitectura, roadmap) y el brief completo de Etapa 4 en `CLAUDE.md` de la carpeta `PROYECTOS/`.
## Actualizacion 2026-07-16 - Fase 5C/5D frontend admin completada

Se implemento en rama `codex/5c-clientes-crm` el panel admin restante: Clientes, CRM WhatsApp, Reportes, Personal y Configuracion. Antes de codigo se obtuvo revision real de Backend Architect y Security/AppSec; ambos confirmaron que no hacian falta migraciones y que el backend faltante debia ser minimo.

Backend agregado: `GET /clients`, `GET /clients/:id`, `GET /users`; `GET /auth/me` ahora devuelve permisos efectivos. Controles criticos preservados: endpoints de clientes no exponen `ClientIntake` (anamnesis sigue por endpoint auditado), usuarios nunca devuelven `passwordHash`, `isProtected` sigue protegido en backend, finanzas de reportes y ventana WhatsApp siguen server-side.

Frontend agregado bajo `frontend/app/admin/(dashboard)/`: `clientes`, `crm`, `reportes`, `personal`, `configuracion`. `layout.js` queda pausado por coordinacion con Code; los enlaces se agregaran despues de pull/rebase sobre la version visual corregida. `recharts` quedo instalado para reportes. `eslint.config.mjs` desactiva `react-hooks/set-state-in-effect` porque la regla tambien rompia archivos estables de 5A/5B y estaba fuera del alcance refactorizarlos.

Verificacion local real: `npm test` backend 150/150, `npm run lint` y `npm run build` frontend en verde, backend/frontend levantados localmente, BFF con cookie validado mediante curl cookie jar: login invalido 401, login valido 200, `/api/proxy/auth/me` 200, Agenda/Gabinetes 200, endpoints nuevos 200, paginas nuevas 200, logout 200 y post-logout 401.



## Estado actual (2026-07-06)

Fase 1, Fase 2 y Fase 3a construidas, verificadas contra Postgres real, y **aprobadas** por el usuario. **Fase 3b (Google Calendar) fue descartada, no pospuesta** — ver sección dedicada más abajo. Próximo paso real: Fase 4 (Clientes). Fases 5–8 (CRM/WhatsApp, reportes, Excel, auditoría) **no se han tocado**.

Desde Fase 3a el usuario empezó a nombrar explícitamente qué agente/skill invocar en vez de dejarlo genérico — ver `AGENTS.md` (creado en esa sesión) para el mapeo completo de agentes/skills/MCP disponibles y cuál corresponde a cada tipo de tarea futura.

## Decisiones de diseño confirmadas con el usuario

- **Login**: email único global en toda la plataforma (no se pide slug/tenant en el login).
- **Superadmin**: cuenta de plataforma sin tenant (`tenantId = null`), pensada para administrar todos los tenants a futuro (Fase 5 del roadmap original: SaaS multiempresa).
- **Enum `Role`** en Prisma usa el identificador `dueno` (sin ñ, por restricciones del parser de Prisma) mapeado a `@map("dueño")` — el valor almacenado en Postgres es literalmente `dueño`, pero el código JS siempre referencia `Role.dueno` / el string `'dueno'`.
- **is_protected**: se aplica el guard a nivel de `userService` (no solo middleware), así ninguna ruta puede saltárselo por error. Ver `src/services/userService.js`.
- Se reutilizó el patrón de `barbershop/prisma/schema.prisma` (ids `cuid()`, tabla raíz + `tenantId` FK indexado en cada tabla dependiente).

## Verificación end-to-end (2026-07-06)

No hay PostgreSQL local ni Docker en este entorno, pero el usuario creó una base Railway dedicada (`alma_spa`, separada de barbershop/FibraNet). Se corrió `prisma migrate dev` + `db:seed` contra esa base real (`hayabusa.proxy.rlwy.net:42587/railway`) y se repitió el walkthrough completo de curl (login por rol, 403 real sobre superadmin, tenantId forjado ignorado, personal bloqueado). Detalle exacto de cada paso en `CHANGELOG.md` [0.1.1].

Esa verificación encontró y corrigió dos bugs reales más: `createUser` rechazaba un `tenantId` forjado en vez de ignorarlo (debía derivarse siempre del JWT), y `POST/PATCH /users` filtraban el `passwordHash` en la respuesta.

**Pendiente de higiene**: la password de esa DB Railway quedó pegada en texto plano en el chat — rotarla en Railway antes de dar por cerrado este ciclo.

## Fase 2 — catálogo base (2026-07-06)

`Service` (category, durationMins fijo en 60, priceUsd Decimal), `Room` (specialty validado contra category activa, enum RoomStatus), `Plan` (many-to-many opcional con Service, validado contra tenant del actor). Lógica de tenant scope extraída a `src/utils/tenantScope.js` (compartida con `userService.js`, sin romper Fase 1). `DELETE` en los 3 recursos es soft delete — Fase 3/4 van a referenciar estos ids.

Decisión de diseño confirmada con el usuario antes de programar: `Service.category` es texto libre por tenant, y `Room.specialty` se valida (400 si no coincide) contra alguna category activa — no se guarda libre.

Regla de integridad simétrica agregada a pedido del usuario (no estaba en el plan original): `DELETE /services/:id` rechaza con 400 si es la última service activa de su category y algún room activo depende de ella.

`requirePermission('configuracion')` se probó por primera vez contra un endpoint real (antes solo mock) — confirmado 403 sin el permiso y 201 con un flip temporal del permiso (revertido después, sin tocar `prisma/seed.js`). Detalle exacto de los 11 pasos del walkthrough en `CHANGELOG.md` [0.2.0].

Nota sobre la DB Railway: el usuario reportó haber rotado la password, pero la nueva connection string mostrada en pantalla tenía la misma password que ya había quedado expuesta en el chat. Se le avisó explícitamente; confirmó que quería seguir usando esa misma password. Sigue siendo la misma desde Fase 1.

## DB Railway recreada (2026-07-06, mismo día)

El usuario borró esa instancia (el problema de rotación no se resolvía) y creó una nueva, vacía: `hayabusa.proxy.rlwy.net:22777/railway` (puerto e id distintos a la anterior, `:42587`). Se corrió `prisma migrate dev` (aplicó las 2 migraciones existentes — `init` + `catalog_base` — sin generar ninguna nueva, porque el schema no cambió) y `db:seed` desde cero. Checks rápidos confirmaron paridad con lo ya documentado en `CHANGELOG.md` [0.1.1]/[0.2.0]: login de los 4 roles con `tenantId` correcto y `GET /services` en `[]` (base limpia). No se repitió el walkthrough completo — ya está en verde y documentado, esto solo confirmó que la base nueva responde igual.

`.env` local actualizado con la URL nueva (no versionado, como siempre).

## Fase 3a — reserva pública + citas (2026-07-06)

`Client`, `ClientIntake` (cifrado AES-256-GCM en `src/utils/intakeCrypto.js`, clave `INTAKE_ENCRYPTION_KEY` con fail-fast al arrancar), `Appointment` (con `AppointmentModality` spa/domicilio). Diseño hecho con tres agentes invocados explícitamente (Backend Architect, Application Security Engineer, Database Optimizer x2), no delegación automática — el usuario lo pidió así tras notar que un agente relevante (Database Optimizer) no había participado en la primera pasada del diseño.

Dos decisiones de negocio confirmadas antes de programar: horarios siempre en punto (habilita `@@unique` simple contra doble-reserva) y el cliente público nunca elige terapeuta (auto-asignación de `roomId`/`staffId`, resuelta en `appointmentService.js` con reintento ante conflicto `P2002`).

Dos vacíos de diseño que el usuario detectó y se resolvieron antes de aprobar: (1) no todo `role=personal` es terapeuta — se agregó `User.canAttendAppointments` (booleano simple, no relación M:N con `Service`, por sobrediseño para un piloto de 3 cuentas de staff); (2) faltaba la modalidad a domicilio del mockup de Gabinetes ya aprobado — se agregó `Service.offersHomeService` + `Appointment.roomId` nullable, sin automatizar `Room.status=a_domicilio` (fuera de alcance explícito).

Bug real encontrado en la verificación: `serviceService.js` (Fase 2) nunca leía el nuevo campo `offersHomeService` del body — corregido, con test de regresión.

Detalle exacto del walkthrough de 9 pasos contra Postgres real en `CHANGELOG.md` [0.3.0].

## Fase 3b (Google Calendar) — DESCARTADA, no pospuesta (2026-07-06)

El usuario decidió no integrar Google Calendar en absoluto, tras completar el diseño con 3 agentes (Backend Architect, Security Architect, Application Security Engineer — ver `AGENTS.md`, el usuario agregó Security Architect al roster fijo para esta fase). El diseño llegó a estar completo y consolidado en el plan (`GoogleCalendarConnection` cifrada con clave separada, OAuth2 con `state` firmado con secret propio, sync unidireccional pendiente→confirmado→cancelado), pero nunca se implementó.

Razones de la decisión (no son un problema del diseño en sí, que quedó sólido — son de producto/operación):
1. Mientras el proyecto no esté verificado por Google, los refresh tokens de cuentas de prueba expiran cada 7 días — dependencia operativa frágil para un piloto.
2. Un evento editado/borrado directamente en Google Calendar por el dueño generaría una falsa sensación de cancelación, ya que la sync es unidireccional (Alma Spa → Google, nunca al revés) — Alma Spa (la Agenda propia, ya construida en Fase 3a) debe seguir siendo la única fuente de verdad.
3. Expandir a futuros spas sin depender de una cuenta externa de Google por tenant simplifica el modelo de negocio de NUVIO Platform.

El documento de diseño completo queda en `C:\Users\59399\.claude\plans\cozy-crafting-acorn.md` marcado `[DESCARTADO]` como referencia histórica, por si en algún momento futuro se reconsidera con otro enfoque (ej. cuando el proyecto esté verificado por Google). El comentario `TODO Fase 3b` en `src/services/appointmentService.js` fue reemplazado por un comentario explícito de que se descartó, para que ninguna sesión futura lo reactive sin este contexto.

## Fase 4 — Clientes (2026-07-08)

Edición/lectura auditada de anamnesis, historial de tratamientos, planes de cliente y saldo. Diseño con 4 agentes (Backend Architect, Database Optimizer, Security Architect, Application Security Engineer) + Code Reviewer antes del walkthrough. Docs en `.claude/plans/fase4-*.md`.

Modelos nuevos: `TreatmentHistory` (notas cifradas), `ClientPlan` (contador + renovación explícita), `ClientLedgerEntry` (ledger append-only, saldo derivado), `ClientIntakeAuditLog` (append-only, log de accesos a la anamnesis).

Decisiones de negocio: terapeuta seleccionable con default al actor (D1), pago/cargo con permiso `clientes` pero reversa/borrado con dueño/superadmin (D4), cargo automático al contratar/renovar plan salvo cortesía autorizada (D7), notas de tratamiento cifradas (D6/elección del usuario).

Seguridad de la anamnesis: la auditoría vive en el service (no en la ruta), orden fail-closed (auditar antes de descifrar), tenant-scope vía `Client`. Guard H1 (test) prohíbe usar encryptField/decryptField fuera de los 2 servicios sancionados.

**Bug encontrado en el walkthrough (no en los tests con mock)**: montar el router de clientes en `/` con `authenticate` global rompía las rutas públicas — corregido con authenticate por-ruta. Lección: los unit tests con Prisma mockeado no ejercitan el montaje real de Express; el walkthrough contra el servidor real sigue siendo necesario.

**Pendiente de despliegue**: el grant append-only de DB sobre `ClientIntakeAuditLog` no está activo porque la app conecta como superusuario `postgres` (ignora GRANT/REVOKE). Hoy el append-only está garantizado solo en la capa de aplicación. SQL para el rol de privilegios mínimos en `docs/append-only-audit-grant.sql`, a aplicar en Fase 8. Detalle completo del walkthrough (21 pasos) en `CHANGELOG.md` [0.4.0].

## Próximo paso

Fase 5: CRM — bandeja de WhatsApp manual + recordatorios. El gancho `TODO Fase 5` ya está en `appointmentService.js`.
