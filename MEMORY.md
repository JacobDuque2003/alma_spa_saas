# Memoria del proyecto — Alma Spa Backend

> Contexto vivo para retomar el trabajo entre sesiones. Ver también `docs/` (producto, arquitectura, roadmap) y el brief completo de Etapa 4 en `CLAUDE.md` de la carpeta `PROYECTOS/`.

## Estado actual (2026-07-06)

Fase 1, Fase 2 y Fase 3a construidas y verificadas contra Postgres real. Fases 1 y 2 ya aprobadas por el usuario con evidencia real. Fase 3a (reserva pública + `Client`/`ClientIntake`/`Appointment`, sin Google Calendar) está pendiente de esa misma aprobación. Fases 3b–8 (Google Calendar, resto de clientes/CRM, reportes, Excel, auditoría) **no se han tocado**.

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

## Próximo paso

No avanzar a Fase 3b (Google Calendar) hasta que el usuario revise y apruebe el esquema `Client`/`ClientIntake`/`Appointment` de esta sesión.
