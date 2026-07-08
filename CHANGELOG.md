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

## [0.3.0] - 2026-07-06

Fase 3a del brief: reserva pública + modelo de citas (`Client`, `ClientIntake`, `Appointment`), sin Google Calendar (Fase 3b). Diseñado con tres agentes invocados explícitamente (Backend Architect, Application Security Engineer, Database Optimizer — consultado dos veces) siguiendo el mapeo de `AGENTS.md`, no delegación automática.

### Agregado
- `Client` (`@@unique([tenantId, whatsapp])`, clave de cliente nuevo vs. recurrente), `ClientIntake` (alergias/condiciones cifradas AES-256-GCM en columnas `Bytes` separadas: ciphertext/IV/auth-tag), `Appointment` (`AppointmentStatus`, `AppointmentModality`, `confirmationToken` único, `priceUsd` como snapshot).
- `Service.offersHomeService` y `User.canAttendAppointments` (+ índices `(tenantId, category, active)`, `(tenantId, specialty, active)`, `(tenantId, role, active, canAttendAppointments)`) — distinguen qué servicios se ofrecen a domicilio y qué personal puede quedar asignado a una cita (no todo `role=personal` es terapeuta).
- `src/utils/intakeCrypto.js`: `encryptField`/`decryptField` con `node:crypto` nativo (no pgcrypto, para que la clave nunca viaje a Postgres), más `assertEncryptionKeyOrExit()` — el servidor se niega a arrancar si `INTAKE_ENCRYPTION_KEY` falta o no decodifica a 32 bytes.
- `src/middleware/resolvePublicTenant.js`: deriva el tenant exclusivamente del `slug` en la URL para las rutas públicas (sin JWT), nunca de body/query; 404 genérico si el slug no existe o el tenant está inactivo.
- `src/middleware/publicRateLimit.js`: rate limit propio para HTTP público (no se reusó `barbershop/src/middleware/rateLimit.js` tal cual — su `getClientKey()` está hardcodeado al shape del webhook de WhatsApp). Dos estrategias: IP simple (lectura) e IP+tenantSlug agresivo (escritura y el oráculo de `/clients/lookup`).
- Auto-asignación de `roomId`/`staffId`: el cliente público nunca elige terapeuta, solo servicio/horario/modalidad. `appointmentService.js` resuelve candidatos en 3 queries (2 para `domicilio`), cruza en memoria, e inserta con reintento ante conflicto `P2002` contra los `@@unique([roomId, startsAt])`/`@@unique([staffId, startsAt])`.
- Modalidad `domicilio`: `roomId` nullable (Postgres no compara `NULL` como duplicado, así que varias citas domicilio conviven sin chocar por gabinete), `homeAddress` requerido en el service. `Room.status = a_domicilio` (enum de Fase 2) **no** se deriva automáticamente — explícitamente fuera de alcance.
- Rutas públicas bajo `/public/:tenantSlug/...` (services, availability, clients/lookup, bookings) y `/public/bookings/:token` (ver/cancelar, sin slug). Rutas autenticadas bajo `/appointments` con `requirePermission('agenda')`.
- 19 tests unitarios nuevos (54 en total).

### Corregido (encontrado durante la verificación contra DB real)
- `serviceService.createService`/`updateService` (Fase 2) nunca leían `offersHomeService` del body — el campo se agregó al schema en esta fase pero se olvidó wire-earlo en el service ya existente. Confirmado en vivo: se creó un servicio con `offersHomeService: true` en el body y la respuesta devolvía `false`. Corregido y cubierto con 2 tests de regresión.

### Verificado — PostgreSQL real (Railway, misma DB dedicada `alma_spa`)

`npx prisma migrate dev --name booking_flow` aplicada sin errores. `npm test` → 54/54 en verde. Seed actualizado: `terapeuta@almaspa.test` con `canAttendAppointments: true`, el resto en `false` (default).

Walkthrough de curl (catálogo de prueba: `Masaje relajante` con `offersHomeService:true`, `Limpieza facial` con `offersHomeService:false`, un `Room` de masajes):

1. `GET /public/alma-spa/availability?serviceId=masaje&date=2026-08-10` → `200`, 10 slots en punto (09:00–18:00).
2. `POST /public/alma-spa/bookings` con cliente nuevo + anamnesis (`allergies`, `conditions`, `consentSigned:true`) → `201`. Confirmado por lectura directa en DB: `allergiesEnc` es binario opaco (no el texto original), `allergiesIv` de 12 bytes, `allergiesTag` de 16 bytes. El `Appointment` creado tiene `roomId`/`staffId` asignados aunque el payload nunca los mandó.
3. Reservar el **mismo slot exacto** con otro cliente (mismo servicio, único room+staff elegible) → `409 {"error":"Este horario ya no está disponible"}`.
4. `GET /public/bookings/:token` → `200`, resumen sin exponer `ClientIntake` ni qué staff quedó asignado.
5. `POST /bookings` con `serviceId` inexistente/de otro tenant → `400 {"error":"serviceId inválido para este tenant"}`.
6. `modality: "domicilio"` sobre el servicio con `offersHomeService:false` → `400 {"error":"Este servicio no ofrece modalidad a domicilio"}`.
7. `modality: "domicilio"` sobre el servicio con `offersHomeService:true` → `201`; confirmado en DB `roomId: null`, `homeAddress` guardado.
8. `POST /clients/lookup` repetido rápido → dispara `429` tras superar el límite agresivo IP+tenantSlug (compartido con las escrituras de booking sobre el mismo tenant, por diseño).
9. Confirmado en DB: en **todas** las citas creadas durante la verificación, el `staffId` asignado fue siempre la cuenta `terapeuta` (`canAttendAppointments:true`) — nunca `recepcion`.

Limpieza posterior: se borraron los `Client`/`ClientIntake`/`Appointment` de prueba (2 clientes, 1 intake, 2 citas). Quedó el catálogo base (2 `Service`, 1 `Room`) para continuidad de fases futuras.

### Qué queda validado solo con mock
- Los 19 tests nuevos (`appointmentService.test.js`, `clientService.test.js`, `intakeCrypto.test.js`) cubren los mismos casos que el walkthrough real, con Prisma mockeado, para correr en CI sin DB.

### Fuera de alcance de esta sesión
- Google Calendar (Fase 3b — los `TODO` ya están en `appointmentService.js`), edición de `ClientIntake` desde el panel/historial de tratamientos/planes de cliente/saldo (Fase 4), CRM/WhatsApp real (Fase 5), reportes (Fase 6), Excel (Fase 7), auditoría final (Fase 8).

## [Decisión de alcance] Fase 3b (Google Calendar) descartada — 2026-07-06

No es una entrega de código — es un registro de decisión de producto. **Fase 3b queda descartada, no pospuesta.**

### Contexto
El diseño se completó con 3 agentes invocados explícitamente (Backend Architect: flujo OAuth2 + sincronización con `Appointment`; Security Architect: cifrado de tokens con clave separada `GOOGLE_TOKEN_ENCRYPTION_KEY`; Application Security Engineer: revisión del flujo OAuth — encontró y corrigió que el documento de Security Architect no se había persistido a disco en la primera pasada, y señaló 4 hallazgos ALTO: falta de especificación del disparador de refresh de `access_token`, distinción imprecisa entre `invalid_grant` real y errores transitorios, riesgo de reusar el mismo secret JWT para el `state` de OAuth que para sesiones de usuario, y riesgo de fuga de `access_token` en logs de error sin sanear). El plan consolidado, con las 4 correcciones ya incorporadas, quedó completo y aprobable — pero el usuario decidió no implementarlo.

### Razones de la decisión
1. **Verificación de Google**: mientras el proyecto no esté verificado por Google, los refresh tokens de cuentas de prueba expiran cada 7 días — dependencia operativa fuera del control del proyecto para un piloto en producción.
2. **Fuente de verdad única**: la sincronización diseñada era unidireccional (Alma Spa → Google, nunca al revés); un evento editado o borrado directamente en Google Calendar por el dueño generaría una falsa sensación de cancelación sin que el sistema se enterara. Alma Spa (la Agenda propia, construida y funcionando desde Fase 3a) debe seguir siendo la única fuente de verdad del calendario.
3. **Simplicidad de expansión**: crecer a futuros spas sin depender de una cuenta externa de Google por tenant simplifica el modelo operativo de NUVIO Platform.

### Qué queda
- El documento de diseño completo permanece en `C:\Users\59399\.claude\plans\cozy-crafting-acorn.md`, marcado `[DESCARTADO]` al inicio, como referencia histórica por si se reconsidera en el futuro con otro enfoque (ej. una vez el proyecto esté verificado por Google).
- El comentario `// TODO Fase 3b: crear evento en Google Calendar` en `src/services/appointmentService.js` fue reemplazado por `// Descartado: no se integra Google Calendar (decisión de alcance, ver CHANGELOG/MEMORY.md)`, para que ninguna sesión futura lo reactive sin este contexto.
- No se agregó ninguna dependencia (`googleapis`), tabla, ni ruta nueva al proyecto — cero superficie de código añadida y luego revertida.

### Próximo paso
Fase 4: Clientes (edición de ficha de anamnesis desde el panel, historial de tratamientos, planes de cliente y saldo) — orden original del brief.

## [0.4.0] - 2026-07-08

Fase 4 del brief: Clientes — edición/lectura auditada de la anamnesis, historial de tratamientos, planes de cliente y saldo. Diseñada con 4 agentes invocados explícitamente (Backend Architect, Database Optimizer, Security Architect, Application Security Engineer) y revisada por Code Reviewer antes del walkthrough.

### Agregado
- Modelos `TreatmentHistory`, `ClientPlan`, `ClientLedgerEntry`, `ClientIntakeAuditLog` (+ enums `LedgerEntryType`, `IntakeAuditField`, `IntakeAuditAction`) + relaciones inversas. `ClientIntake` sin cambios de schema.
- Anamnesis editable desde el panel (`GET`/`PUT /clients/:clientId/intake`, permiso `clientes`) con **auditoría a nivel de service**: cada lectura y edición fuera del flujo público registra actor/cliente/campo/acción/timestamp. Orden **fail-closed** (H2): cargar Client → validar tenant → escribir auditoría → recién ahí descifrar. Tenant-scope vía `Client` (H3), nunca vía `ClientIntake` (que puede no existir). Lector del log (`GET .../intake/audit`) restringido a dueño/superadmin.
- Historial de tratamientos con **notas cifradas** (mismo AES-256-GCM que la anamnesis, D6), terapeuta seleccionable con default al actor y validado `canAttendAppointments`, `createdById`/`updatedById` separados (D8).
- Planes de cliente: contratar/renovar generan el **cargo automáticamente en la misma transacción** (D7), cortesía (`isComplimentary`) solo honrada para dueño/superadmin. Consumo de sesiones atómico (no sobrepasa el límite bajo concurrencia).
- Saldo como **ledger append-only** (`ClientLedgerEntry`, tipo cargo/pago): saldo = suma derivada, reversa = contra-asiento (nunca borra), cobros con `clientes` y reversa con dueño/superadmin.
- Guard H1: test que prohíbe usar `encryptField`/`decryptField` fuera de `clientIntakeService`/`treatmentHistoryService` (falla el CI si alguien lo intenta; se eligió test en vez de ESLint porque el proyecto no tiene ESLint y traerlo por una sola regla era desproporcionado).
- 21 tests unitarios nuevos (75 en total).

### Corregido
- **Bug de wiring encontrado en el walkthrough (no lo atraparon los tests con mock)**: el router de clientes se montó en `/` con `router.use(authenticate)` global; al estar registrado antes de las rutas públicas, interceptaba **todas** las requests (incluida la reserva pública) exigiendo token. Corregido aplicando `authenticate` por-ruta. Los tests con Prisma mockeado no ejercitan el montaje real de Express — por eso el walkthrough contra el servidor real sigue siendo necesario aunque los unit tests estén en verde.
- Hallazgos de Code Reviewer aplicados: **M1** refs del ledger (`appointmentId`/`treatmentHistoryId`/`clientPlanId`) ahora validadas contra el tenant/cliente antes de crear el asiento; **B1** `amountUsd` no numérico → 400 (antes 500); **B2** reversa concurrente → 400 amable en vez de P2002 crudo; **B3** consumo de sesiones atómico vía `updateMany` condicional; **B4** `loadClientForActor` extraído a `clientService` (dejaba de estar duplicado en 4 servicios).

### Verificado — PostgreSQL real (Railway)

`npx prisma migrate dev --name client_module` aplicada. `npm test` → 75/75. Walkthrough de 21 pasos contra la base real, todos OK:
- Lectura de anamnesis (200, descifrada) → fila `read` en el audit log; edición → fila `update`; lector del log 403 para personal-con-clientes / 200 para dueño (3 filas en orden correcto).
- Notas de tratamiento y anamnesis confirmadas cifradas en reposo (binario, IV 12 / tag 16).
- Tratamiento cargado por recepción en nombre del terapeuta → `therapistId`=terapeuta, `createdById`=recepción; `therapistId` no-terapeuta → 400; `PATCH` → `updatedById` seteado.
- Cross-tenant: dueño de alma-spa leyendo intake de otro tenant → 403, registrado en log de seguridad, **cero** filas en el audit log del cliente ajeno.
- Contratar plan → auto-cargo (saldo 80); cortesía por dueño → sin cargo; cortesía por recepción → bandera ignorada, cargo generado (saldo 160).
- Consumir 4/4 sesiones → 5a rechazada (400); renovar → contador a 0 + nuevo cargo.
- Pago 100 → saldo 140; reversa por recepción → 403; por dueño → 201 (contra-asiento), saldo vuelve a 240; segunda reversa del mismo asiento → 400.

Limpieza posterior: se borraron el cliente de prueba y el segundo tenant; quedó el catálogo (1 tenant, 2 servicios, 1 gabinete, 1 plan), sin clientes.

### Seguridad — grant append-only pendiente de despliegue
La app conecta como el rol `postgres` (superusuario), que **ignora los GRANT/REVOKE**, así que el append-only del audit log está hoy garantizado solo en la capa de aplicación (ningún servicio/ruta expone UPDATE/DELETE sobre `ClientIntakeAuditLog`). La garantía a nivel de DB requiere un rol de app de privilegios mínimos — SQL exacto documentado en `docs/append-only-audit-grant.sql`, a aplicar como paso de despliegue (Fase 8).

### Diferido con nota explícita
Logging de *acceso* a notas de tratamiento (solo el cifrado entró en esta fase), URLs firmadas para fotos before/after, historial de periodos pasados de `ClientPlan`, política de retención del audit log, y el tradeoff de hard-delete de `TreatmentHistory` (borrar un registro clínico deja `ledger.treatmentHistoryId` colgando; gated a dueño/superadmin).

### Próximo paso
Fase 5: CRM (bandeja de WhatsApp manual + recordatorios) — el gancho `TODO Fase 5` ya está en `appointmentService.js`.
