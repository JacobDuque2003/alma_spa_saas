# Memoria del proyecto — Alma Spa Backend

> Contexto vivo para retomar el trabajo entre sesiones. Ver también `docs/` (producto, arquitectura, roadmap) y el brief completo de Etapa 4 en `CLAUDE.md` de la carpeta `PROYECTOS/`.

## Estado actual (2026-07-05)

Backend recién iniciado. Antes de esta sesión solo existía la demo estática (`index.html`) y docs de producto. Se construyó **Fase 1** del brief de Etapa 4: esquema multi-tenant + autenticación + permisos. Fases 2–8 (catálogo, reserva pública, clientes/CRM, reportes, Excel, auditoría) **no se han tocado** — están pendientes de que el usuario apruebe el esquema de Fase 1.

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

Lo que sigue validado solo con mock (no hay endpoint real de Fase 1 que lo ejercite todavía): bypass de `requirePermission` para dueño/superadmin y la negación/permiso para personal — porque los módulos agenda/gabinetes/clientes/crm/reportes/configuracion son de Fase 2 en adelante.

## Próximo paso

No avanzar a Fase 2 (servicios/gabinetes/planes) hasta que el usuario revise y apruebe el esquema `Tenant` / `User` / `RolePermission` de esta sesión.
