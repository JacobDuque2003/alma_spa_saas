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

## Limitación conocida de esta sesión

No hay PostgreSQL local ni Docker disponible en el entorno donde se construyó esto. La verificación se hizo con:
- 8 tests unitarios con Prisma mockeado (`npm test`) — cubren is_protected, aislamiento de tenant, bypass de permisos.
- Servidor real levantado localmente contra un `DATABASE_URL` inexistente, confirmando que el error handling no crashea el proceso ni filtra detalles internos (dos bugs reales encontrados y corregidos en esta sesión, ver `CHANGELOG.md`).

**Falta hacer contra una base de datos real** (Railway): `npx prisma migrate dev`, `npm run db:seed`, y repetir la verificación manual de curl descrita en el plan (login por rol, PATCH 403 sobre superadmin, tenantId forjado ignorado).

## Próximo paso

No avanzar a Fase 2 (servicios/gabinetes/planes) hasta que el usuario revise y apruebe el esquema `Tenant` / `User` / `RolePermission` de esta sesión.
