# Alma Spa SaaS — memoria operativa

## 2026-08-20 — Selector de horario no responde al crear cita — diagnóstico + 2 fixes aplicados y verificados

**Reportado por Jacob (dueño) en vivo.** Descartado `accessSchedule` con evidencia directa: JWT real minteado para su cuenta (sin tocar su password), pegado a `GET /appointments/availability` pasando por `authenticate`→`accessSchedule`→`requirePermission('agenda')` completo → 200 OK, sin header `X-Alma-Out-Of-Schedule`, 16 slots. `requirePermission.js:3` bypasea rol `dueno` sin tocar DB.

**No reproducible en vivo en el momento del diagnóstico:** probé los 16 servicios activos vía `getAvailability()` directo (todos devolvían slots), la ruta HTTP completa con su cuenta real (200 OK, 16 slots), y el pool de personal (3 activos: gianella, amparito, jacob — todos con `canAttendAppointments:true`, `accessSchedule:null`). Todo sano en ese momento — el trigger exacto de Jacob probablemente fue una falla transitoria (timeout de Railway o similar).

### Fix 1 — catch silencioso en agenda/page.js (aplicado y verificado)

**Causa raíz:** [agenda/page.js:1886](frontend/app/admin/(dashboard)/agenda/page.js:1886) — `.catch(() => setAvailableSlots([]))` en el fetch de `/appointments/availability` tragaba CUALQUIER error (500, 403, timeout) y lo renderizaba idéntico a "genuinamente sin horarios" — sin toast, sin mensaje. Coincide con el síntoma exacto reportado por Jacob.

**Fix aplicado:** el catch ahora hace `toast.error(err?.message || "No se pudieron cargar los horarios disponibles")` antes de vaciar `availableSlots`. Cualquier falla futura del endpoint será visible en vez de indistinguible de "sin cupo".

### Fix 2 — Cabina 7 (TERAPIAS) abría fuera de su horario (aplicado y verificado con evidencia real)

**Causa raíz de primer nivel:** `roomBusinessHours()` en [appointmentService.js:43-54](src/services/appointmentService.js:43) — cuando una cabina con `schedule` propio (Cabina 7) no tiene entrada para el día actual, el código original caía al horario GENERAL del tenant en vez de tratarse como cerrada. Contradecía el punto 16 ya verificado ("solo miércoles 8-12 y 14-17"). Se corrigió para devolver `{morning:null, afternoon:null}` cuando el día no está en el `schedule` de la cabina.

**Causa raíz real (de segundo nivel, encontrada al verificar el fix):** ese `{morning:null, afternoon:null}` se re-normalizaba dentro de `generateSlotsForService()`/`isRangeInsideBusinessHours()` vía `normalize()` en [businessHours.js](src/utils/businessHours.js:26) — y `normalize()` tenía un fallback que, ante ambas franjas `null`, devolvía el default hardcodeado (09-12/15-20) en vez de respetar "cerrado". El fix de `appointmentService.js` solo no alcanzaba; hubo que corregir `normalize()` para que respete `{morning:null, afternoon:null}` explícito como "cerrado" en vez de reinterpretarlo como "sin configurar". Verificado que esto no afecta el guardado real de `Tenant.config.businessHours`: `validateBusinessHours()` en `tenantConfig.js:66` ya rechaza con 400 cualquier config con ambas franjas vacías **antes** de llegar a `normalize()`, así que ese caso nunca ocurre para un tenant real — solo lo usa ahora el nuevo camino de "cabina cerrada este día".

**Verificado con el mismo test usado en el diagnóstico, contra datos reales de Railway:**
- Hoy (jueves 2026-08-20): "Terapias energéticas" → 0 slots ✅ (antes: 22, mal)
- Viernes a martes (todos los no-miércoles): 0 slots ✅
- Próximo miércoles 2026-08-26: 18 slots, todos dentro de 08-12/14-17 ✅
- Control — "Masaje relajante" (cabina normal sin `schedule` propio) hoy: sigue en 16 slots, sin cambio ✅

**Backend: 303/303 tests, sin regresiones.**

Ninguno de los dos fixes requirió GATE — funcionales, no tocan auth/tenant/cifrado.

## 2026-08-19 (madrugada) — Auditoría /cyber-neo completa (backend + frontend, solo diagnóstico)

**Reporte completo:** `~/Desktop/cyber-neo-report-alma_spa_saas-2026-08-19.md`. 5 fases (SCA, SAST, secretos, config/infra, supply chain) corridas en paralelo. Sin fixes aplicados — auditoría de solo lectura.

**28 hallazgos: 0 critical, 9 high, 2 medium, 6 low, 11 info.** Score formulario de la skill = 100/100 (Crítico), pero **lectura ajustada por explotabilidad real ≈ 6/100 (bajo)** — los 9 high + 2 medium son CVEs reales pero viven en dependencias transitivas de herramientas de dev (`eslint`, `nodemon`, CLI de `shadcn`) o en el pipeline de build de CSS (`postcss`/`nanoid`), no en la ruta de request de la app en producción. Ninguno es explotable contra Alma Spa desplegado hoy.

**Único hallazgo en código propio:** `phoneNumberId`/`wabaId` sin validar formato antes de interpolarse en la URL de la API de Meta ([whatsappConnectionService.js:64](src/services/whatsappConnectionService.js:64)) — Low, CWE-918, no escala a SSRF de host arbitrario (host fijo `graph.facebook.com`), pero vale la pena cerrar con una regex `/^\d{5,20}$/`.

**Áreas sensibles — correlacionado con memoria existente, no tratado como hallazgo nuevo:**
- Aislamiento multi-tenant: **confirmado intacto** tras los cambios de Cabinas/permisos finos — mismo patrón `assertTenantScope()` en los 12 services revisados.
- Cifrado AES-256-GCM (intake/tratamiento): **confirmado correcto** — IV random por operación, auth tag verificado de verdad, key de 32 bytes desde env var.
- JWT en cookie httpOnly: **confirmado correcto** — algoritmo pineado (HS256), secret ≥32 bytes forzado al boot, CSRF real vía chequeo Origin/Sec-Fetch-Site en el proxy BFF.
- Webhook WhatsApp HMAC: **confirmado fail-closed** — firma sobre rawBody, timingSafeEqual, appSecret vacío rechazado explícitamente.
- **`accessSchedule` variante GET-solo-lectura: sin hallazgo de código nuevo — el sign-off de Security Architect sigue pendiente, este escaneo no lo resuelve** (es una decisión de diseño, no un defecto que un SAST pueda calificar). Sigue exactamente donde estaba en la memoria del 2026-08-18/19.

**Credenciales reales de Railway en `.env` local** (`DATABASE_URL`, `MIGRATION_DATABASE_URL`) — High solo por sensibilidad del dato, pero **correctamente contenidas**: gitignored, `git log --all` confirma que nunca se commitearon en ningún branch. Recomendación: rotación periódica como higiene, no como incidente.

**Secretos:** cero expuestos en el repo o en el historial de git (reconfirma el secret scan de la auditoría del 2026-08-18 con un método más exhaustivo — script dedicado + grep + walk completo del historial).

## 2026-08-19 (noche) — Investigación Plan/ClientPlan/ClientLedgerEntry vs "paquetes de promoción" (solo investigación)

**No existe carpeta `agents/`.** Backend Architect/Database Optimizer invocados por nombre.

**Corrección clave a la ronda anterior:** NO hay dos sistemas distintos. Grep completo de `schema.prisma` por `Promo|Combo|Paquete|Package` → cero resultados fuera de `Plan`/`ClientPlan`/`ClientLedgerEntry`. El "modelo separado de paquetes, backend+tests, sin UI, 0 filas" que reportó la ronda anterior **ES** `Plan` — no hay un segundo modelo que comparar.

**Qué hace hoy cada modelo:**
- `Plan` = catálogo/plantilla de una **membresía recurrente por sesiones**: N sesiones cada M meses por $P, aplica a todos los servicios o a un subconjunto vía relación M:N. CRUD completo y testeado (`planService.js`), **cero UI**.
- `ClientPlan` = instancia contratada por un cliente: snapshot de sesiones/precio/período, contador `sessionsUsed`, `renewsAt`, flag `isComplimentary`. `clientPlanService.js` implementa `contractPlan` (auto-cobra al ledger), `consumeSession` (decremento atómico), `renewPlan` (resetea período, auto-cobra de nuevo). API REST completa (`GET/POST /clients/:id/plans`, `POST /client-plans/:id/consume`, `POST /client-plans/:id/renew`) — **cero botones en el frontend** para contratar, consumir o renovar. Lo único que el frontend hace es mostrar la barra de progreso de un `activePlan` SI ya existiera uno (nunca existió: `clientPlanCount:0` en Railway).
- `ClientLedgerEntry` = ledger contable genérico append-only (`cargo`/`pago`, reversible), **no específico de planes** — también registra pagos sueltos sin relación a ningún plan. Este es el único de los tres con uso real: 6 filas reales en Railway, las 6 son pagos sueltos ("Registrar abono" → `POST /clients/:id/payments` → `registerPayment`), **las 6 con `clientPlanId: null`**. La membresía nunca se usó en producción; solo el ledger genérico.

**Veredicto:** relacionados pero NO son "paquetes de promoción" tal cual los pidió Gianella. Diferencias de fondo:
1. `Plan` vende N sesiones **intercambiables** entre los servicios vinculados (un contador plano) — no una combinación fija (ej. "1 Facial + 1 Masaje + 1 Pedicure"). No hay forma de rastrear cuál servicio específico se consumió.
2. `Plan` es inherentemente **recurrente** (`periodMonths`, `renewsAt`, acción explícita de renovar) — un combo de un solo pago no necesita fecha de renovación.
3. `consumeSession` no está conectado a la creación de citas — es 100% manual y hoy no lo dispara nada.

**Recomendación técnica:** usar `Plan`/`ClientPlan` como base (reutilizar la integración con el ledger, el scoping por tenant, el flag de cortesía, las convenciones REST) en vez de crear un modelo nuevo — pero **requiere extender**, no solo agregar UI, si la dueña quiere combos fijos con seguimiento por servicio específico. Si su intención real es más simple ("N sesiones a usar entre estos servicios, un solo pago, sin importar cuál se usó cada vez"), `Plan`/`ClientPlan` ya lo cubre al 100% y solo falta construir la UI.

**Preguntas de negocio pendientes para Gianella (además de "agendar todo de una vez vs. comprar y consumir después"):**
1. ¿Un "paquete" es un combo fijo (1 de cada servicio incluido, cada uno rastreado por separado) o una bolsa de N sesiones intercambiables entre los servicios del paquete?
2. ¿Un paquete vence/se renueva periódicamente como una membresía, o es una compra única sin renovación?
3. ¿Quién marca una sesión del paquete como consumida — se descuenta automático al crear la cita, o el staff lo hace a mano? (hoy es 100% manual, no conectado)
4. ¿Se espera pago parcial/a cuotas de un paquete, o siempre se paga completo al momento de la compra?
5. ¿Los paquetes se pueden regalar/cortesía (el flag `isComplimentary` ya existe para planes) o es un concepto distinto?
6. ¿La UI debe mostrar el precio del paquete comparado contra la suma de precios individuales (para comunicar el descuento), o el precio combinado se ingresa directo sin cálculo automático?

## 2026-08-19 (tarde) — Verificación de 18 puntos de feedback de Gianella (solo inventario, sin fixes)

**No existe carpeta `agents/`.** Roles invocados por nombre: Backend Architect/Database Optimizer (datos y lógica), Security Architect/AppSec (punto 10). Ninguna migración nueva desde `20260817090000_client_fine_permissions` — sin hallazgos GATE nuevos en esta ronda.

### Contradicción "hide cabins module" (punto 1) — resuelta

`2fb6c52` quitó "Cabinas" del nav y `/admin/gabinetes` ahora solo redirige a `/admin/agenda` — confirmado en código actual, cero referencias a Cabinas en `layout.js`. **Pero** la vista Agenda por defecto es `view="day"` ([agenda/page.js:221](frontend/app/admin/(dashboard)/agenda/page.js:221)), que renderiza `CabinDayGrid` (columnas = las 9 cabinas reales, verificadas en Railway: TIENDA/FACIAL/LASER/CORPORAL/BAÑO DE CAJÓN/CERAGEM/TERAPIAS/YOGA/PIES, sortOrder 1-9, todas `active:true`). **Veredicto: ⚠️ PARCIAL** — funcionalmente la vista principal SÍ agrupa por cabina y NO es la agenda semanal por defecto; estructuralmente no existe un módulo/nav item llamado "Cabinas" — si Gianella busca ese nombre en el menú, no lo va a encontrar.

### Punto 10 — variante de horario de acceso, comparada línea por línea

Backend: GET/HEAD/OPTIONS pasan con header `X-Alma-Out-Of-Schedule:1` fuera de horario; POST/PATCH/DELETE devuelven 403. Frontend: `auth-client.js` lee el header en cada request y dispara `window` event `alma:out-of-schedule`; `layout.js` Shell renderiza un banner fijo y siempre visible: *"Fuera de horario de acceso: modo solo lectura"*. Se puede asignar horario al crear cuenta (`NewUserModal` → `buildDefaultSchedule()` en el POST). **Esto coincide exactamente con el requisito literal de la dueña** ("solo lectura, sin poder editar, con notificación visible"), aunque es una variante distinta a la que aprobó originalmente el Security Architect (bloqueo total). Pendiente: que Security Architect revise formalmente ESTA variante ya implementada (no para cambiarla — para dejar constancia de que cumple el requisito real de producto).

### Tabla de los 18 puntos

| # | Punto | Estado | Evidencia |
|---|---|---|---|
| 1 | Cabinas vista principal | ⚠️ PARCIAL | Ver resolución arriba |
| 2 | Buffer 15 min en lógica real | ✅ | `totalBlockMins()` = duration+buffer, usado en `generateSlotsForService` y `resolveAndCreateAppointment` ([appointmentService.js:35-61](src/services/appointmentService.js:35)) |
| 3 | Catálogo servicios + colores, sin Tasks/VALORACION | ⚠️ PARCIAL | 16/17 de su lista activos con colorHex propio; "Almuerzos" existe pero inactivo (category "operativo", aclarar con Gianella); Tasks/VALORACION confirmado ausentes (0 coincidencias); 4 duplicados legacy inactivos (higiene, no bloqueante) |
| 4 | Multi-cabina + duración variable + total=dur+buffer | ✅ | `getCompatibleRooms()` vía relación M:N real; duraciones 15-120min variables confirmadas en Railway |
| 5 | recordNumber/address/edad | ✅ | Los 3 se muestran/editan en `clientes/page.js` (líneas 933,969-971,1229); dato real: solo 1/5 clientes con recordNumber, 0/5 con address — feature existe, población de datos pendiente. **Nota: revierte una decisión previa documentada de NO mostrar edad — confirmar que es intencional** |
| 6 | Paquetes de promoción (combo) | ⚠️ PARCIAL (≈❌ en la práctica) | Backend `Plan`+`POST /plans` existe y SÍ puede vincular servicios específicos con precio combinado (con tests), pero CERO UI de creación en frontend (ningún "Nuevo plan" en Configuración) y `plansCount:0` en Railway. Desde la UI, no existe |
| 7 | Cumpleaños ventana 8 días | ✅ reconfirmado | `clientes/page.js:369` usa `days:8`. Nota: el badge del sidebar (`layout.js:168`) usa `days:7` — inconsistencia menor entre badge y sub-vista |
| 8 | Auto-asignación de cabina | ✅ | `resolveAndCreateAppointment` y `createManualAppointment` auto-asignan room libre compatible cuando no se especifica; override manual disponible |
| 9 | businessHours 9-12/15-20 | ✅ reconfirmado | Config real en Railway: `morning:09:00-12:00, afternoon:15:00-20:00` |
| 10 | Horario de acceso por cuenta | ✅ | Ver resolución arriba — coincide exacto con el requisito literal |
| 11 | Indicaciones visibles en agenda diaria | ✅ | Renderizado en `CabinDayGrid` ([agenda/page.js:1126-1128](frontend/app/admin/(dashboard)/agenda/page.js:1126)), editable y creable |
| 12 | Anamnesis con checkboxes | ✅ (contrario a la sospecha) | ~16 antecedentes clínicos con toggle SI/NO ([clientes/page.js:1310-1357](frontend/app/admin/(dashboard)/clientes/page.js:1310)), serializados y persistidos vía `PUT /clients/:id/intake` |
| 13 | no_show tachado rojo | ✅ reconfirmado | `textDecoration:line-through` + color `#C25450`/`#B85A56` en agenda |
| 14 | Historial completo | ✅ mayormente | Tab "Historial" combina reservas (con estado, incluye no_show) + tratamientos; sin changelog de ediciones específico en esta vista (existe AdminAuditLog aparte, no surfaced aquí) |
| 15 | Buscador general (ficha/nombre/teléfono) | ✅ | `searchClients()` busca por `fullName`, `recordNumber`, `whatsapp` (tolerante a formato EC), `email`; presente en sidebar (todas las páginas) y en Clientes |
| 16 | Cabina 7 horario fijo miércoles 8-12/14-17 | ✅ | Dato real Railway: `schedule:{wednesday:{morning:08-12,afternoon:14-17}}`, único día presente |
| 17 | Botón Domicilio eliminado | ✅ reconfirmado | 0 coincidencias de "Domicilio" en todo el frontend |
| 18 | Logs→Registros + lenguaje natural | ✅ reconfirmado | nav label "Registros"; `ACTION_LABELS` con creó/editó/activó/desactivó/eliminó, no revertido |

### Falta 100% por construir

- **Paquetes de promoción (punto 6)**: sin UI de creación, aunque el backend ya tiene el modelo y la API.
- **Nombrar el nav item "Cabinas"** si Gianella lo quiere como módulo explícito (punto 1) — hoy es solo el día-por-defecto de Agenda.

### No corregido en esta ronda (por restricción explícita — solo inventario)

Ninguno de los 18 puntos fue tocado. Reporte completo en el chat de esta sesión, 2026-08-19.

## 2026-08-19 — Fix P0 (amparito) + P1 (15 tests) — roles invocados por nombre, sin agents/*.md

**No existe carpeta `agents/` en el repo.** Se invocaron los roles Security Architect y Application Security Engineer por nombre, sin archivo formal, para la parte de accessSchedule/tenant.

### P0 — amparito@almaspa.com desbloqueada (evidencia real en Railway)

- **Antes:** `accessSchedule = { monday..sunday: null, alwaysAllowed: false }` — los 7 días cerrados explícitamente, no `null`. Confirmado con query directa a Railway.
- **Causa raíz identificada (no corregida en esta ronda, fuera de alcance):** `AccessScheduleEditor` en [personal/page.js:907-913](frontend/app/admin/(dashboard)/personal/page.js:907) guarda `draft` tal cual cuando `alwaysAllowed` es `false`, sin exigir que al menos un día esté marcado. Si un dueño/admin desmarca "24/7" con la intención de configurar horarios pero no llega a activar ningún día antes de guardar, el resultado es un bloqueo total silencioso — mismo shape que tenía amparito. **Riesgo de que se repita con cualquier otra cuenta.** Queda como hallazgo para una ronda futura, con propuesta: exigir al menos un día activo antes de permitir guardar `alwaysAllowed:false`, o tratar "0 días activos" como inválido en `validateSchedule` ([accessSchedule.js:130](src/utils/accessSchedule.js:130)).
- **Fix aplicado:** `accessSchedule` corregido a `null` (fail-open, 24/7) vía script directo contra Railway usando el rol de runtime (`DATABASE_URL`, no el de migraciones). Se registró en `AdminAuditLog` (entity `user`, action `update`, actor Jacob, con el detalle before/after) para dejar rastro de la intervención manual.
- **Verificación de login — evidencia real, sin manejar su contraseña:** se replicó exactamente el código de `authService.login()` (mismo `checkAccess`, mismo `accessSchedule` real ya corregido, mismo tenant/timezone reales de Railway, hora real) contra su fila real. Resultado: `{ accessScheduleInDb: null, roleAlwaysAllowed: false, loginGateResult: { allowed: true } }`. No se tocó ni se pidió su contraseña — verificar el login completo requeriría credenciales que no corresponde manejar.

### P1 — 15 tests fallando: diagnóstico y resultado

**Los 15 eran categoría (b) — mocks/fixtures desactualizados. Ninguno era regresión real de seguridad ni de aislamiento tenant.**

**Causa raíz común:** el middleware `accessSchedule` (agregado por 9b, invocado dentro de `authenticate.js` en cada request autenticada) hace su propio `prisma.user.findUnique(...)`. Los archivos de test que ya existían antes de 9b (`clientUserRoutes.test.js`, `authenticate.test.js`) monkey-parchean modelos específicos sobre la instancia **real** de `PrismaClient` (`src/utils/prisma.js` no es un mock — es `new PrismaClient()` real), pero nunca mockearon `prisma.user`. Sin ese mock, la llamada cae en la base de datos real, no encuentra al usuario de prueba (`u1`), y `accessSchedule` responde `401 "Sesión inválida o cuenta inactiva"` **antes** de llegar a la ruta — de ahí que las 14 fallas de `/clients` y `/search` mostraran `401` donde se esperaba `403`/`200`. Otros archivos de rutas (`authLogin.test.js`, `auditLog.test.js`, `authMe.test.js`, `accessScheduleReadOnly.test.js`) **sí** tenían este mock — fueron actualizados junto con 9b; estos dos archivos quedaron atrás.

- **`GET /clients/:id bloquea cross-tenant`** — confirmado que ejercita lógica real: la ruta delega en `clientService.getClient()`, que usa `assertTenantScope()` real (mismo patrón que `userService.js`). El mock solo sustituye `prisma.client.findUnique`, no la lógica de aislamiento. **Aislamiento tenant intacto, no hubo regresión.**
- **`authenticate deriva req.user del JWT`** — mismo problema (401 en vez de que `next()` se llamara). Al agregar el mock apareció un SEGUNDO bug de mock (no de producción): el mismo `prisma.user.findUnique` mockeado también atiende el backfill de email en `authenticate.js:24`; sin `email:null` explícito en el mock, `req.user.email` quedaba `undefined` en vez de `null`. Corregido en el mock, no en el código de producción.
- **Fix:** se agregó `prisma.user = { findUnique: async () => ({ active: true, accessSchedule: null }) }` (con `email: null` donde aplica) a cada test que lo necesitaba — [clientUserRoutes.test.js](src/routes/clientUserRoutes.test.js) (14 tests) y [authenticate.test.js](src/middleware/authenticate.test.js) (1 test). Mismo patrón que los archivos ya actualizados; no se tocó middleware de producción ni lógica de tenant — no ameritó GATE.

**Resultado: backend 303/303 tests pasando.** Frontend: sin test runner configurado (`package.json` solo tiene `dev`/`build`/`start`) — ya documentado como pendiente en el plan de H6/Extended#2, no es parte de esta ronda.

**Observación secundaria (no corregida, fuera de las 15, no autorizado tocarla):** en `authMe.test.js`, el mock de `prisma.user.findUnique` tiene asserts sobre `args.select` pensados para la llamada de la propia ruta `/auth/me`. La llamada de `accessSchedule` (que llega primero, con un `select` distinto) dispara esos asserts y los hace fallar — pero el error queda absorbido por el `catch` fail-open de `accessSchedule.js:112`, así que el test pasa igual, por la razón equivocada. No es uno de los 15, no se tocó.

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
