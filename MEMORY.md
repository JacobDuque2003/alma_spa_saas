# Memoria del proyecto — Alma Spa Backend

> Contexto vivo para retomar el trabajo entre sesiones. Ver también `docs/` (producto, arquitectura, roadmap) y el brief completo de Etapa 4 en `CLAUDE.md` de la carpeta `PROYECTOS/`.

## Estado actual (2026-07-06)

Fase 1 (Tenant/User/RolePermission, auth JWT, permisos) y Fase 2 (Service/Room/Plan, catálogo base) construidas y verificadas contra Postgres real. Fase 1 ya fue aprobada por el usuario con evidencia real; Fase 2 está pendiente de esa misma aprobación (esquema + endpoints ya revisados en modo plan antes de escribir código). Fases 3–8 (reserva pública, clientes/CRM, reportes, Excel, auditoría) **no se han tocado**.

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

## Próximo paso

No avanzar a Fase 3 (reserva pública) hasta que el usuario revise y apruebe el esquema `Service`/`Room`/`Plan` de esta sesión.
