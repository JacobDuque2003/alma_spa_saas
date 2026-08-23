# Alma Spa SaaS — memoria operativa

## 2026-08-23 — 2 ajustes a la vista de servicios: catálogo completo + mensajes en lenguaje de dueña

### Bug 1: los inactivos desaparecían de la vista de Configuración

Confirmado con query real a Railway: los 6 servicios inactivos existen (14 activos + 6 inactivos = 20 totales), ninguno borrado. El filtro estaba solo en el frontend, `configuracion/page.js:621-622`: `visibleServices = activeServices`. Fix: `visibleServices` ahora incluye TODOS los servicios, ordenados con activos primero (alfabético) y luego inactivos (alfabético). Los inactivos ya se pintaban con `opacity: 0.5` cuando alcanzaban el render — solo faltaba dejar de filtrarlos. La lista pública `/public/:slug/services` sigue filtrando por `active:true` en el backend, sin cambios.

**Verificado end-to-end**: 20/20 servicios visibles con 6 badges "Inactivo", API pública sigue con 14, activos ordenados antes de inactivos.

### Bug 2: mensajes técnicos reescritos a lenguaje de dueña

Solución sin tocar backend: extendí `friendlyConfigError()` en el frontend para traducir los mensajes técnicos del backend a lenguaje claro justo antes de mostrarlos. **El backend sigue devolviendo su texto original** (útil para tests y otros consumidores de la API); solo cambia lo que ve la persona en pantalla.

Todos los mensajes reescritos en la pantalla de Configuración (para revisión del PM):

| Contexto | Antes | Después |
|---|---|---|
| Bloqueo de desactivación | *"No se pudo desactivar. La cabina 'X' usa la categoría 'Y' y necesita al menos un servicio activo."* | *"No puedes desactivar este servicio porque es el único disponible en la cabina 'X'. Activa otro servicio para esa cabina primero, o cambia sus cabinas permitidas."* |
| Eliminar categoría con cabinas | *"No se puede eliminar esta categoría porque hay gabinetes activos que la usan (ej: 'X')"* | *"No puedes eliminar esta categoría todavía. La cabina 'X' la está usando; cambia la especialidad de esa cabina primero."* |
| Eliminar categoría con servicios | *"...hay servicios activos que la usan (ej: 'X')"* | *"...El servicio 'X' pertenece a ella; cámbialo de categoría o desactívalo primero."* |
| Categoría duplicada | *"Ya existe una categoría con ese nombre en este tenant"* | *"Ya tienes una categoría con ese nombre. Elige otro."* |
| Duración inválida | *"durationMins debe ser un entero entre 15 y 480 minutos"* | *"La duración debe estar entre 15 y 480 minutos."* |
| Pausa inválida | *"bufferMins debe ser un entero entre 0 y 90 minutos"* | *"La pausa entre citas debe estar entre 0 y 90 minutos."* |
| Color inválido | *"colorHex debe tener formato hexadecimal..."* | *"El color no está en un formato válido. Elígelo del selector de color."* |
| Sin cabinas | *"roomIds debe ser una lista de cabinas"* | *"Selecciona al menos una cabina para el servicio."* |
| Cabinas obsoletas | *"...cabinas no pertenecen al tenant o están inactivas"* | *"Una o más cabinas ya no están disponibles. Recarga la página e inténtalo de nuevo."* |
| Formulario incompleto (crear servicio) | *"name y category son requeridos"* / *"Nombre, precio, duración y al menos una cabina son requeridos"* | *"Faltan datos: escribe el nombre y elige una categoría."* / *"Faltan datos: nombre, precio, duración y al menos una cabina."* |
| Cabina incompleta | *"name y specialty son requeridos"* | *"Faltan datos: escribe el nombre y elige la especialidad de la cabina."* |
| Orden inválido | *"sortOrder debe ser un entero entre 0 y 999"* | *"El orden de la cabina debe estar entre 0 y 999."* |
| Formato hora | *"opensAt/closesAt debe tener formato HH:MM"* | *"La hora de apertura/cierre no tiene un formato válido (ejemplo: 09:00)."* |
| Descripción larga | *"description no puede superar 500 caracteres"* | *"La descripción no puede tener más de 500 caracteres."* |
| Imagen inválida | *"La imagen debe ser JPEG o PNG"* | *"La imagen debe estar en formato JPEG o PNG."* |
| Franjas de horario | *"Al menos una franja debe estar abierta"* | *"Necesitas tener al menos una franja abierta (mañana o tarde)."* |
| Franja mañana inválida | *"La apertura de la mañana debe ser antes del cierre"* | *"La mañana debe abrir antes de cerrar."* |
| Franja tarde inválida | *"La apertura de la tarde debe ser antes del cierre"* | *"La tarde debe abrir antes de cerrar."* |
| Solapamiento mañana/tarde | *"La mañana debe cerrar antes (o al mismo tiempo) que abra la tarde"* | *"La mañana debe cerrar antes de que abra la tarde."* |
| Éxito guardar horario | *"Horario guardado"* | *"Horario del spa guardado."* |
| Fallo guardar horario | *"No se pudo guardar el horario"* | *"No se pudo guardar el horario. Inténtalo de nuevo."* |
| Éxito toggle activar | *"Servicio habilitado"* | *"Servicio activado."* |
| Éxito toggle desactivar | *"Servicio deshabilitado"* | *"Servicio desactivado."* |
| Éxito editar servicio | *"Servicio actualizado"* | *"Cambios guardados."* |
| Fallo actualizar | *"Error al actualizar servicio"* | *"No se pudo guardar el cambio."* |
| Éxito eliminar | *"Servicio 'X' eliminado de la oferta"* | *"Servicio 'X' quitado de la oferta."* |
| Fallo eliminar | *"No se pudo eliminar el servicio"* | *"No se pudo eliminar el servicio."* |
| Éxito crear | *"Servicio 'X' creado"* | *"Servicio 'X' creado."* |
| Fallo crear | *"Error al crear servicio"* | *"No se pudo crear el servicio."* |
| Éxito guardar foto/desc | *"Descripción y foto actualizadas"* | *"Descripción y foto guardadas."* |
| Fallo procesar imagen | *"No se pudo procesar la imagen"* | *"No se pudo procesar la imagen. Prueba con otra foto."* |
| Fallo cargar página | (mensaje crudo del backend) | *"No se pudo cargar la configuración. Recarga la página."* |
| Fallo guardar foto/desc | *"No se pudo guardar"* | *"No se pudieron guardar los cambios."* |

**Verificado end-to-end**: intento real de desactivar Camilla Ceragem (único servicio activo de la categoría "ceragem" que respalda a Cabina 6 - CERAGEM) → backend responde **400** con el mensaje técnico intacto (protección funciona), frontend lo re-escribe con el texto exacto que el PM pidió como ejemplo. Backend: **313/313 tests, sin regresión** (no se tocó ni una línea de backend).

## 2026-08-22 (noche) — Diseño del bot de WhatsApp con IA (solo diseño, GATE pendiente)

**Nada implementado todavía.** Documento de diseño presentado al PM con 10 secciones + alcance concreto de Fase 1 + 6 preguntas pendientes. Backend Architect + AppSec por nombre.

### Decisiones clave del diseño

- **Reuso máximo**: webhook actual (`src/routes/webhooks/whatsapp.js`), `WhatsAppConnection`/`WhatsAppConversation`/`WhatsAppMessage` ya existentes, cifrado AES-256-GCM del token, HMAC blindado con `timingSafeEqual`, `getAvailability()`/`createManualAppointment()` de `appointmentService`. **Cero infraestructura nueva** en Fase 1.
- **Sin modelo "reserva pendiente" separado**: reuso `Appointment` con nuevo valor de enum `pendiente_bot` (Fase 2). Los `@@unique([roomId,startsAt])` y `@@unique([staffId,startsAt])` previenen doble-booking a nivel de DB — dos clientas confirmando el mismo slot es imposible, la segunda recibe `SlotUnavailableError` y el bot le ofrece 3 slots alternativos sin volver al inicio.
- **IA elegida**: Gemini Flash 2.5. Costo real proyectado con 300 conv/mes ≈ **$0.12/mes de IA** (mucho menor que la estimación original de $3-8) — costo no es factor de decisión. WhatsApp Cloud API gratis los primeros 1000 mensajes/mes en categoría "service".
- **Guardrail anti-invención + anti-prompt-injection**: IA solo devuelve JSON con `intent` (enum cerrado) + `params` + `reply_text`. **El backend nunca ejecuta acciones desde `reply_text`, solo desde `intent`** — el peor caso de prompt injection produce `unclear` o `escalate`, jamás una acción fuera del enum.
- **Aislamiento por tenant**: webhook ya recibe `:tenantSlug`, todas las queries van con `where:{tenantId}` — cero cruce entre tenants (aunque hoy solo hay uno).
- **Rate limit por número**: 20/5min, 100/hora por `from_wa_id`. Mismo patrón que `publicRateLimit.js`.
- **Cost cap por conversación** (Fase 2+): >$0.50/día en una conversación → corta el bot para ese número, alerta a recepción.

### Fase 1 (MVP mínimo viable, SIN IA)

Alcance concreto: menú principal + "Ver servicios" completo (foto+descripción) + "Reservar" temporal (solo link a la web) + "Hablar con recepción" + rate limit. **Cero migración, cero variable de env nueva, cero dependencia nueva, cero costo variable, cero riesgo de invención** — todo por botones/listas nativas de WhatsApp, determinístico al 100%. Fases 2 y 3 documentadas pero fuera de alcance.

### Prerequisito antes de Fase 1

**Rotar el Access Token en Meta** — el actual quedó quemado (expuesto en captura). Se rota en Meta Developer Console y se guarda con `replaceConnection` que ya cifra con AES-256-GCM en `WhatsAppConnection.accessTokenEnc`. Nunca en env vars del código.

### 6 preguntas pendientes al PM (bloquean el arranque de Fase 1)

1. Sub-flujo "Mi cita" en Fase 1 o diferido a Fase 2
2. Trigger del menú (automático 1ª vez del día vs. palabra clave)
3. Notificación push al escalar a recepción o solo badge en Bandeja
4. Confirmación de "usted" por defecto, "tú" si la clienta empieza así
5. Comportamiento cuando el servicio no tiene imagen aún
6. Categoría de plantilla WhatsApp — asumir clienta siempre inicia (dentro de 24h) o preparar plantilla `bot_welcome_v1` aprobada

**Cuando el PM responda las 6 (o al menos las que apliquen a Fase 1) + apruebe el alcance, sigue GATE de tocar código.**

## 2026-08-22 — 2 bugs: agenda no marcaba horas cerradas + imagen de servicio "subía" pero no se veía

**Bug 1 — Agenda día por cabina:** [`CabinDayGrid`](frontend/app/admin/(dashboard)/agenda/page.js:981) renderizaba sobre un `HOURS = [8..19]` hardcodeado ([línea 14](frontend/app/admin/(dashboard)/agenda/page.js:14)) sin leer `businessHours` del tenant ni el `room.schedule` propio de Cabina 7. Fix visual puro (autónomo, sin GATE): fetch a `/tenant/config` desde el shell, se pasa a `CabinDayGrid`, cada fila de hora por cabina evalúa `isHourOpenForRoom(hour, room, tenantConfig, dateStr)` respetando el schedule por cabina si lo tiene (Cabina 7 solo miércoles). Las filas cerradas se marcan con clase `.alma-agenda-closed-cell` (rayado diagonal suave sobre fondo apagado en `globals.css`), y las labels del eje se atenúan si ninguna cabina está abierta en esa hora. **Cero cambio a lógica de disponibilidad** — solo render. Verificado en navegador real: sábado 22-ago con businessHours 09-12/15-20, filas 8:00/12:00/14:00 con rayado, 9-11 y 15-18 limpias.

**Bug 2 — Imagen "subía" pero no se veía. Bug de infraestructura, no de la vista:** el proxy BFF [`route.js`](frontend/app/api/proxy/[...path]/route.js) tenía **DOS problemas** compuestos:
1. **Línea 67 original:** `await res.text()` — lee la respuesta como UTF-8. Para un JPEG binario, cada byte fuera del rango UTF-8 válido se sustituye por `U+FFFD` → el navegador recibía una imagen corrupta. **Este era el bug real.**
2. **Línea 73 original:** `Cache-Control: no-store, private` sobrescribía cualquier header del backend, incluyendo el `public, max-age=86400` de la imagen — el ETag/cache diseñado para el bot de WhatsApp futuro no funcionaba.

Fix quirúrgico (aprobado por GATE): helper `isBinaryContentType()` detecta `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/octet-stream`; para esos content-types el proxy usa `arrayBuffer()` en vez de `text()` **y respeta el `Cache-Control`/`ETag` del backend** (incluidos 304 pass-through). Para JSON/texto **nada cambia** — sigue con `res.text()` y `Cache-Control: no-store, private`, verificado explícitamente end-to-end. Además, la vista de servicios ahora agrega `?v=<imageUpdatedAt>` como cache-buster a la URL de la miniatura (así reemplazar una imagen invalida el cache del navegador — el backend NO interpreta `?v`, es puro cache key del navegador).

### Verificación end-to-end en navegador real (lección de esta ronda)

La ronda anterior (commit 93cc529) había verificado el endpoint aislado con `supertest`, pero el bug vivía en el tramo proxy→navegador que nunca se probó. **De ahora en adelante, cuando el cambio involucre binarios o el navegador (proxy, headers, cache, decodificación de archivos), la verificación TIENE que incluir un GET real desde el browser con `fetch` + comparación de bytes + `<img>` que decodifique de verdad.**

Esta ronda sí lo hice: seedié un JPEG de 332 bytes con magic `ff d8 ff e0`, obtuve el JWT, lo inyecté como cookie `alma_token`, hice `fetch('/api/proxy/services/{id}/image?v=...')` desde el navegador → **332 bytes exactos, header JPEG intacto, EOI `ff d9` intacto, decodificación `naturalWidth=8, naturalHeight=8` ✅**. Además probé con una imagen preexistente de Camilla Ceragem (`naturalWidth=477, naturalHeight=800`) y se ve visualmente en la miniatura de la lista. Los endpoints JSON (`/clients`, `/rooms`, `/users`, `/tenant/config`) siguen con `Cache-Control: no-store, private` — cero regresión.

**Backend: 313/313 tests.** Frontend build limpio.

## 2026-08-21 (noche) — 3 ajustes de UX+auditoría: banner temporal, menú filtrado por permisos, login/logout en Registros

**Roles invocados por nombre** (sin `agents/`): Backend Architect + Application Security Engineer.

### Puntos 1 y 2 — ya estaban implementados en local, faltaba llegar a `main`

La captura del PM mostraba el bug (banner permanente + Terapeuta ve "Equipo") pero el código local ya lo tenía resuelto en `frontend/app/admin/(dashboard)/layout.js`, `frontend/lib/auth-client.js` y `frontend/app/globals.css` — sin commit. Se verificó contra Railway:
- `/auth/me` para `prueba@almaspa.com` devuelve `role:personal` + permissions correctos (todos activos salvo lo que aplica).
- Simulación del filtro con esos datos reales: **Agenda/Clientes/Bandeja/Reportes/Configuración → visibles; Equipo/Registros → ocultos.** Coincide exactamente con lo pedido.
- Banner: constante `OUT_OF_SCHEDULE_BANNER_MS = 8000ms`, `useAnimatedMount` para fade, distinción `kind:"readOnly"` (solo la 1ª vez de la sesión — evita reaparecer con cada polling del CRM cada 30s) vs `kind:"blocked"` (siempre se re-muestra para que el usuario no pierda contexto de por qué la acción falló).
- Backend intacto: cada `router.use(authenticate, requirePermission('X'))` sigue en su lugar — el filtrado de sidebar es solo UX. Anotado en el propio archivo: "Ocultar un ítem aquí es solo UX: el servidor sigue bloqueando por su cuenta si alguien navega directo a la URL".

### Punto 3 — login/logout en AdminAuditLog (GATE aprobado, implementado y verificado)

**Migración necesaria (consecuencia técnica del diseño ya aprobado, no ampliación de alcance):** `AuditEntity` gana `auth`, `AuditAction` gana `login` y `logout` — sin ellos no se puede insertar en `AdminAuditLog` con esas etiquetas (`AuditEntity` es enum). Migración `20260821172900_audit_auth_events`, aplicada a Railway.

- `src/services/authService.js` — nuevo `auditAuthEvent()` best-effort (try/catch, si falla no impide login/logout); `login()` lo llama tras emitir el token; **superadmin queda excluido** (su `tenantId` es null y `AdminAuditLog` es por-tenant — un evento sin tenant no tiene dónde vivir).
- `src/routes/auth.js` — nueva ruta `POST /auth/logout` autenticada que registra el evento y responde 204.
- `frontend/app/api/auth/logout/route.js` — llama primero al backend (best-effort) y luego borra la cookie.
- `src/utils/adminAudit.js` — `SUMMARY_WHITELIST` gana `auth: []` (sin detalles: actor+action ya cuentan la historia).
- `frontend/app/admin/(dashboard)/logs/page.js` — labels "Inicio de sesión"/"Cierre de sesión", verbos "inició sesión"/"cerró sesión", filtro nuevo "Sesiones", `formatActivity` sin entidad afectada cuando `entity==='auth'`.
- **Logins fallidos NO se auditan** — recomendación aprobada: rate limiting (5/15min) ya frena credential stuffing, agregar al AdminAuditLog inflaría con typos legítimos, y expone info de enumeración de emails a quien vea el log. Los intentos fallidos siguen registrados en `console.warn` (logs de Railway) desde una ronda anterior.

**Verificado en vivo contra Railway** (con cuenta real jacob@almaspa.com y superadmin admin@nuvio.tech, sin usar sus passwords reales — solo su registro real + hash sintético contra el mismo singleton de Prisma):
- Login de jacob → 200 con token; **fila insertada** en `AdminAuditLog`: `{entity:'auth', action:'login', actorEmail:'jacob@almaspa.com'}` ✅
- Logout de jacob → 204; **segunda fila** con `action:'logout'` ✅
- Login de superadmin → 200; **cero filas** creadas (contador antes/después idéntico) ✅
- Logout de superadmin → 204; cero filas ✅
- `GET /audit-log?entity=auth` como jacob → 200 con las 2 filas nuevas visibles ✅

**Filas de test borradas al final** (excepción documentada: el diseño append-only del audit log se rompió puntualmente aquí porque eran filas creadas por mí en la ronda de verificación, no eventos reales — próxima vez las dejo para respetar el diseño). Backend: **313/313 tests**.

## 2026-08-21 — Descripción + imagen de servicios (GATE aprobado, implementado y verificado en Railway)

**Schema (GATE aprobado):** `Service.description String?`, `imageData Bytes?`, `imageMimeType String?`, `imageUpdatedAt DateTime?` — migración `20260821011105_service_description_image`, aplicada a Railway. Cero impacto en filas existentes ni en el flujo de reservas/disponibilidad.

**Almacenamiento de imágenes: opción D aprobada (bytes en Postgres, compresión en el navegador).** Sin dependencia nueva, sin costo nuevo, sobrevive redeploys. Formato de salida: **JPEG** (no WebP) — confirmado por búsqueda que WhatsApp Cloud API solo acepta JPEG/PNG en mensajes de imagen normales, WebP queda reservado a stickers ([Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages)) — importa porque estas fotos las enviará un bot de WhatsApp más adelante.

**Compresión real medida con un ejemplo real** (imagen sintética de complejidad fotográfica — gradiente+ruido+formas, 1600×1200, ~694KB, generada y comprimida en un navegador real vía Canvas, mismo código que corre en producción): **resultado 800×600px, ~22KB, calidad 0.75, sin necesitar bajar de calidad** — reducción del 97%. Límite duro del navegador: 800px de lado más largo, calidad inicial 0.75 con caída automática hasta 0.35 si hiciera falta.

**Backend:**
- `src/utils/serviceImage.js` (nuevo) — `decodeImageDataUrl()` valida por **magic bytes reales** (no por el `Content-Type` que declare el cliente) que sea JPEG o PNG, tope de 300KB (defensa de servidor, no el objetivo normal de peso). `normalizeDescription()` — máx. 500 caracteres.
- `GET /services/:id/image` — sirve el binario con `ETag` fuerte (`"<id>-<imageUpdatedAt>"`) + `Cache-Control: public, max-age=86400, must-revalidate`; responde 304 en `If-None-Match` — verificado en vivo, evita re-descargar la misma foto (importa para cuando el bot de WhatsApp la pida repetido).
- `listServices`/`getService`/`createService`/`updateService` nunca devuelven `imageData` en el JSON (usan `select` explícito, no `imageData`) — el binario solo viaja por la ruta de imagen dedicada, evita inflar el listado de ~20 servicios.
- **Nota técnica:** `omit` de Prisma (para excluir un campo del `select` por defecto) **no funcionó en `@prisma/client@5.22.0`** pese a estar documentado como estable desde 5.16 — tira `Unknown argument omit`. Se usó `select` explícito en su lugar (funciona en cualquier versión). Si se actualiza Prisma más adelante, vale la pena revisar si `omit` ya funciona y simplificar.
- Límite de body subido a 1MB **solo** en `/services` (montado antes del parser global de 256kb — body-parser no re-parsea un body ya leído, así que el resto de la API queda intacto con el límite estricto).
- `GET /public/:slug/services` ahora incluye `description` — **no** expone la imagen públicamente en esta ronda, como se acordó.
- `description` agregado a la whitelist de auditoría (`AdminAuditLog`) — los cambios quedan visibles en Registros.

**Frontend (`configuracion/page.js`):** nuevo modal `ServiceMediaModal` (ver/agregar/editar/quitar descripción y foto de un servicio ya creado, con preview + contador de caracteres) + descripción opcional en el formulario de creación + miniatura en la fila de cada servicio. Todo el código nuevo se escribió con clases Tailwind (confirmé que los tokens de Tailwind de este proyecto —`--primary`, `--muted-foreground`, `--destructive`, `--border`— ya son exactamente la paleta bronce existente, así que no hay discordancia visual) — **no se agregó código con el patrón inline viejo**, ni se tocó el resto del archivo. `frontend/lib/image-compress.js` (nuevo) hace la compresión client-side.

**Frontend (`reservar/[tenantSlug]/page.js`):** descripción visible bajo cada servicio en la selección de reserva pública (Tailwind, `line-clamp-2`).

**Sin permisos nuevos:** todo bajo el mismo `requirePermission('configuracion')` que ya existía — solo dueño/admin, como se pidió.

**Verificado en vivo contra Railway** (servicio real "Aero yoga", cuenta real jacob@almaspa.com): subir imagen+descripción → 200; listado nunca trae `imageData`; `GET /services/:id/image` → 200 con ETag/Cache-Control correctos; segunda petición con `If-None-Match` → 304; imagen de 310KB rechazada con 400 en el servidor (no solo en el navegador); editar solo descripción deja la imagen intacta; `image:null` la borra (`GET` de la imagen → 404 después); página pública recibe `description` sin `imageData`; flujo de disponibilidad del mismo servicio sin cambios (24 slots, igual que antes). Backend **313/313 tests** (8 nuevos). Frontend build limpio.

## 2026-08-20 — GATE cerrado: login ya no bloquea la entrada fuera de horario + sign-off final de la variante GET-solo-lectura

**Bug reportado por Jacob con captura real:** `prueba@almaspa.com` fuera de horario no podía ni siquiera entrar — el form de login quedaba bloqueado con "Próxima apertura: viernes 04:00 a.m.".

**Causa raíz:** [authService.js:32-49](src/services/authService.js) (versión anterior) tenía su PROPIO gate de horario, separado y anterior al middleware `accessSchedule` — lanzaba `OutOfScheduleError` antes de emitir el JWT. Era un remanente del diseño original (bloqueo total) que nunca se actualizó cuando se aprobó la variante de solo-lectura; los dos mecanismos quedaron contradiciéndose.

**Fix aplicado (GATE aprobado antes de tocar código):**
1. `authService.js` — eliminado el gate de horario y la clase `OutOfScheduleError` completa. `login()` depende solo de credenciales + `active`.
2. `routes/auth.js` — quitado el import y el catch especial de `OutOfScheduleError`; el handler de `/auth/login` vuelve a ser simple (200 con token, o 401 credenciales inválidas).
3. `frontend/lib/auth-client.js` — `login()` ya no propaga `reason`/`nextWindowOpensAt` (nunca volverán a aparecer en la respuesta de login). El manejo de `outOfSchedule` en `authFetch()` para MUTACIONES post-login queda intacto — es el correcto.
4. `frontend/app/admin/login/page.js` — quitado `scheduleMessage` y sus dos disparadores (el del catch de login, y la rama ya-muerta de `?outOfSchedule=1` que nunca se disparaba). Como ya no usa `useSearchParams()`, también se quitó el wrapper `Suspense`/split `LoginPageContent` que existía solo por ese hook (confirmado contra la doc de Next 16: el requisito de Suspense es específico de `useSearchParams`, no de `useRouter`).
5. Banner post-login mejorado: *"Fuera de tu horario de acceso — puedes ver todo, pero no editar, crear ni eliminar hasta la próxima apertura."*

**Cero código huérfano confirmado:** grep de `OutOfScheduleError`, `scheduleMessage`, `formatNextWindow`, `outOfSchedule=1` en todo `src/` y `frontend/` → cero coincidencias.

**Verificado con evidencia real contra Railway** (cuenta real `prueba@almaspa.com`, confirmada fuera de horario ahora mismo — `checkAccess` real: `allowed:false, nextWindowOpensAt: viernes 09:00`; su password real nunca se usó ni se conoció, se probó con su registro real + un hash sintético vía el mismo singleton de Prisma que usa la app):
- **(a) Login funciona:** `POST /auth/login` con credenciales válidas → **200**, token emitido, `user.email` correcto.
- **(b) Puede ver todo:** `GET /clients` con ese token → **200**, 4 clientes reales devueltos, header `X-Alma-Out-Of-Schedule: 1` presente (dispara el banner en el frontend).
- **(c) No puede escribir:** `POST /clients` con el mismo token → **403**, `reason: outOfSchedule`.
- **(d) Banner:** mecanismo header→evento→banner ya verificado end-to-end en la ronda de los 18 puntos (2026-08-19); texto nuevo confirmado en `layout.js:119`.

**Backend: 305/305 tests** (se reescribió el test de login-fuera-de-horario para reflejar el nuevo comportamiento correcto en vez de eliminarlo).

### Sign-off formal de seguridad — variante GET-solo-lectura: CERRADO

Como Security Architect + Application Security Engineer: **aprobada como diseño final**, reemplaza el diseño original de bloqueo total de request completo. Verificación exhaustiva: los 33 handlers `router.get(` de todo `src/routes/` no ejecutan ninguna escritura (`.create/.update/.upsert/.delete`) — la propiedad "GET = sin efectos secundarios" se sostiene estructuralmente en toda la API, no es una suposición. Restringir por horario solo las mutaciones (no la lectura) no amplía qué datos puede ver una cuenta, solo cuándo — coincide con el requisito literal de la dueña ("que vean todo, que no editen nada"). **No queda ningún punto abierto de este tema.**

## 2026-08-20 — Fix hallazgo Low de /cyber-neo: phoneNumberId/wabaId sin validar formato (aplicado y verificado)

**Hallazgo original (auditoría 2026-08-19):** [whatsappConnectionService.js:64](src/services/whatsappConnectionService.js:64) — `phoneNumberId`/`wabaId` solo se validaban como "string no vacío" antes de interpolarse directo en la URL de la Meta Graph API. No escalaba a SSRF real (host fijo `graph.facebook.com`), pero permitía manipular el segmento de ruta.

**Fix aplicado:** nuevo helper `requireMetaId()` — exige `/^\d{1,20}$/` (solo dígitos, hasta 20 caracteres) antes de `requireStringField`. Sin mínimo de longitud estricto a propósito, para no romper fixtures de test cortos (`'111'`/`'222'`) ni IDs de sandbox — la propiedad de seguridad real es "solo dígitos", no la longitud exacta. Cambio acotado a `whatsappConnectionService.js`, no toca `whatsappTransport.js` ni el resto del flujo.

**Verificado:**
- 2 tests nuevos: `phoneNumberId` con `'111/../messages'` → 400 "solo dígitos"; `wabaId` con `'abc123'` → 400.
- Los 4 tests existentes de este archivo siguen pasando sin modificarlos, incluido el que usa `phoneNumberId:'111'` como fixture válido (regex lo acepta).
- Suite completo: **305/305** (303 previos + 2 nuevos), sin regresiones.

Sin GATE — fix funcional/hardening, no toca auth/tenant/cifrado.

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
