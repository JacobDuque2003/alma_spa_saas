# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-07-05

### Agregado
- Esquema Prisma inicial: `Tenant`, `User`, `RolePermission`, enum `Role` (superadmin/dueño/personal).
- Autenticación JWT: `POST /auth/login`, hash de password con bcrypt, middleware `authenticate` que deriva `tenantId`/`role` únicamente del token (nunca de params/body/query del cliente).
- Autorización: middleware `requirePermission` (bypass total para dueño/superadmin, chequeo de `RolePermission` para personal) y `requireRole` (gestión de staff limitada a dueño/superadmin).
- Bloqueo duro de cuentas protegidas (`isProtected`): aplicado en `userService.updateUser/deleteUser/updatePermissions`, no solo en middleware — ninguna ruta puede saltárselo.
- `prisma/seed.js`: tenant `alma-spa`, superadmin protegido, un dueño, dos cuentas de personal con permisos distintos.
- 15 tests unitarios (`node:test`) cubriendo las reglas de seguridad de Fase 1.

### Corregido
- `POST /auth/login` no atrapaba errores async: un fallo de Prisma (ej. DB inalcanzable) tumbaba todo el proceso Node en vez de responder 500. Ahora usa try/catch + `next(err)`.
- El error handler global devolvía el mensaje interno completo de Prisma (rutas de archivo del servidor incluidas) al cliente en cualquier error 500. Ahora los errores ≥500 responden `{"error":"Error interno"}` y el detalle solo se loguea en servidor; los errores <500 (403/400/401, todos construidos a propósito en el código) sí exponen su mensaje.

### Pendiente
- Fases 2–8 del brief de Etapa 4 (catálogo, reserva pública, clientes/CRM, reportes, Excel, auditoría).

## [0.1.1] - 2026-07-06

### Corregido (encontrado durante la verificación contra DB real)
- `userService.createUser` validaba el `tenantId` recibido en el body contra el del actor y **rechazaba** con 403 si no coincidían — pero la especificación pedía que ese campo se **ignore por completo** para actores no-superadmin. Ahora `tenantId` nunca se lee del body salvo cuando el actor es `superadmin` (que no tiene tenant propio); para `dueno`/`personal` el body ni se consulta, siempre se usa `actor.tenantId` del JWT.
- `POST /users` y `PATCH /users/:id` devolvían `passwordHash` (el hash bcrypt) en el cuerpo de la respuesta. Se agregó `omitPasswordHash()` en `userService` para que ningún endpoint de usuarios devuelva ese campo.
- 4 tests unitarios nuevos bloquean ambas regresiones (19 tests en total, ver detalle en README de verificación más abajo).

### Verificado — PostgreSQL real (Railway, proyecto `alma_spa`, dedicado, separado de barbershop/FibraNet)

Migración y seed:
- `npx prisma migrate dev --name init` → aplicada sin errores contra `hayabusa.proxy.rlwy.net:42587/railway` (DB confirmada vacía antes de migrar, vía `prisma db pull --print`).
- `npm run db:seed` → creó tenant `alma-spa`, superadmin protegido, 1 dueño, 2 personal.

Walkthrough de curl contra la base real (ver sesión para el detalle completo de cada request/response):

1. **Login superadmin** (`admin@nuvio.tech`) → `200`, JWT payload `{"tenantId":null,"role":"superadmin",...}`. Confirmado: sin tenant.
2. **Login dueño** (`dueno@almaspa.test`) → `200`, JWT payload con `tenantId` = id real del tenant Alma Spa.
3. **Login personal** (`recepcion@almaspa.test`, `terapeuta@almaspa.test`) → `200` ambos, JWT con el mismo `tenantId` del tenant.
4. **PATCH `/users/:id`** sobre la cuenta superadmin protegida, con token de dueño → `403 {"error":"Esta cuenta está protegida y no puede editarse ni eliminarse"}`. Confirmado además por lectura directa en DB: el `name` de la cuenta no cambió.
5. **DELETE `/users/:id`** sobre la misma cuenta protegida, con token de dueño → `403`, mismo mensaje.
6. **POST `/users`** con `tenantId` forjado en el body (un tenant inexistente inventado por el cliente), token de dueño → `201`, y el registro creado quedó con el `tenantId` real del dueño (el del JWT), no el forjado. El valor forjado nunca se usó.
7. **POST `/users`** con token de `personal` (recepción) → `403 {"error":"No tiene permiso para esta acción"}` — la gestión de staff sigue vedada a personal, sin llegar a tocar la DB.

Las dos cuentas creadas durante el paso 6 (`nuevo.forjado@almaspa.test`, `nuevo.forjado2@almaspa.test`) se borraron al terminar; la DB quedó exactamente en el estado del seed (4 usuarios: superadmin, dueño, recepción, terapeuta).

### Qué queda validado solo con mock (no con DB real)
- Bypass de `requirePermission` para dueño/superadmin sin consultar la tabla `RolePermission` — no existe todavía ningún endpoint de Fase 1 gateado por `requirePermission` (los módulos agenda/gabinetes/clientes/crm/reportes/configuracion son Fase 2+), así que esta lógica solo se probó con Prisma mockeado en `requirePermission.test.js`.
- Negación de `requirePermission` a `personal` sin el permiso del módulo, y permiso concedido cuando el módulo está activo — mismo caso, sin endpoint real que lo ejercite todavía.
- Casos borde de `authenticate` (token ausente/inválido) — no dependen de DB, probados solo con JWT firmados localmente en el test, no contra la API real (aunque el paso 7 de arriba sí probó `authenticate` en vivo indirectamente, vía el 401/403 real de las rutas).

### Higiene de seguridad pendiente
- La password de la DB Railway `alma_spa` quedó pegada en texto plano en el chat de esta sesión. Rotarla en Railway → base de datos → Variables antes de considerar cerrado este ciclo.

## [0.2.0] - 2026-07-06

Fase 2 del brief: catálogo base (`services`, `rooms`, `plans`). Esquema y endpoints revisados en modo plan y aprobados por el usuario antes de escribir código.

### Agregado
- `Service` (`category`, `durationMins` fijo en 60, `priceUsd` en `Decimal`), `Room` (`specialty`, enum `RoomStatus`: libre/ocupado/a_domicilio), `Plan` (`sessionsIncluded`, `period`, `appliesToAllServices`, `includesHomeService`, relación many-to-many opcional con `Service`). Relaciones inversas agregadas a `Tenant` (`services`/`rooms`/`plans`) — campos virtuales de Prisma, sin columnas nuevas en la tabla `tenants`.
- `src/utils/tenantScope.js`: `assertTenantScope`, `resolveTenantId`, `ForbiddenTenantError` extraídos de `userService.js` para reutilizar en los 3 servicios nuevos sin duplicar lógica (`userService.js` refactorizado para importarlo, sin cambio de comportamiento — los 19 tests de Fase 1 siguen en verde).
- `src/utils/errors.js` (`BadRequestError`, status 400) — también retrofiteado a validaciones de `userService.js` que antes lanzaban `Error` plano y caían como 500 en vez de 400.
- CRUD de `services`/`rooms`/`plans`, todos bajo `authenticate` + `requirePermission('configuracion')`. `tenantId` siempre derivado del JWT (mismo patrón de Fase 1); listados filtrados por tenant salvo para superadmin.
- Validación `Room.specialty` contra `Service.category` activa del tenant (400 si no coincide).
- Validación de `Plan.serviceIds` contra el tenant del actor (400 si algún id pertenece a otro tenant o no existe).
- **Regla de integridad simétrica** (pedida explícitamente antes de implementar): `DELETE /services/:id` rechaza con 400 si el servicio es la última service activa de su `category` y algún `Room` activo depende de esa `category` — evita dejar gabinetes sin ninguna especialidad activa que los respalde.
- `DELETE` en los 3 recursos es soft delete (`active:false`), no borrado físico — Fase 3 (citas) y Fase 4 (planes de cliente) van a referenciar estos ids.
- 14 tests unitarios nuevos (33 en total: 19 de Fase 1 + 14 de Fase 2).

### Verificado — PostgreSQL real (Railway, misma DB dedicada `alma_spa`)

`npx prisma migrate dev --name catalog_base` aplicada sin errores. `npm test` → 33/33 en verde contra el cliente generado de esta migración.

Walkthrough de curl contra la base real:

1. Crear 3 `Service` (categorías `masajes`, `faciales`, `reflexologia`) con token de dueño → `201` los tres. El primero mandó `durationMins: 999` en el body → quedó guardado en `60` (ignorado, como se esperaba).
2. Crear `Room` con `specialty: "categoria-inventada"` (sin ninguna `Service` activa de esa categoría) → `400 {"error":"specialty \"categoria-inventada\" no coincide con ninguna categoría de servicio activa de este tenant"}`.
3. Crear `Room` con `specialty: "masajes"` (coincide con el `Service` del paso 1) → `201`.
4. Crear `Room` con `specialty: "reflexologia"` (coincide con el único `Service` de esa categoría) → `201` — preparado para la prueba de integridad.
5. **`DELETE /services/:id`** sobre el `Service` de reflexología (única de su categoría, con el `Room` del paso 4 activo dependiendo de ella) → `400 {"error":"No se puede desactivar: el gabinete \"Sala de reflexologia\" depende de la categoría \"reflexologia\" y quedaría sin ningún servicio activo que la respalde"}`.
6. `DELETE /rooms/:id` sobre ese mismo gabinete → `204`.
7. Reintentar el `DELETE /services/:id` del paso 5, ya sin room activo dependiendo → `204` (soft delete exitoso).
8. Crear `Plan` con `serviceIds` que incluye un id de un tenant distinto (creado ex profeso para esta prueba, `spa-ajeno`) → `400 {"error":"Alguno de los serviceIds no existe o no pertenece a este tenant"}`.
9. Crear `Plan` válido con `serviceIds` del propio tenant → `201`.
10. `POST /services` con `tenantId` forjado en el body → `201`, `tenantId` real usado fue el del JWT del dueño, el forjado nunca se leyó.
11. **`requirePermission('configuracion')` contra endpoint real por primera vez** (antes solo probado con mock): `POST /services` con token de `personal` (recepción, `configuracion:false`) → `403 {"error":"Sin permiso para el módulo: configuracion"}`. Se hizo un flip temporal de `configuracion:true` en esa misma cuenta (vía script directo a la DB, sin tocar `prisma/seed.js`) → el mismo `POST /services` con el mismo token → `201`. Se revirtió el flip a `false` inmediatamente después.

Limpieza posterior: se borraron los servicios desechables creados solo para las pruebas (`tenantId` forjado, permiso temporal) y el tenant `spa-ajeno` con su servicio. Quedó en la DB el catálogo real de Alma Spa: 2 `Service` activos (masajes, faciales) + 1 inactivo (reflexología, soft-deleted como evidencia del ciclo completo), 1 `Room` activo (masajes) + 1 inactivo (reflexología), 1 `Plan` activo conectado al servicio de masajes.

### Qué queda validado solo con mock
- Los 14 tests de Fase 2 en `serviceService.test.js`/`roomService.test.js`/`planService.test.js` cubren los mismos casos que el walkthrough real, pero como suite rápida con Prisma mockeado para correr en CI sin DB.

### Fuera de alcance de esta sesión
- Reserva pública, Google Calendar, clientes/anamnesis, CRM/WhatsApp, reportes, Excel — Fase 3 en adelante.
