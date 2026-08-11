# Progreso — Ronda actual (loop autónomo)

Iniciada 2026-08-02. Se actualiza al cierre de cada ciclo.

| # | Item | Estado | Commit | Verificado en Railway | Nota |
|---|------|--------|--------|------------------------|------|
| 1 | P0.1 — Bug todaysBirthdays | **cerrado — no reproducible** | n/a | n/a | 0 matches en frontend; PM confirmó cerrar |
| 2 | P1.1 — Logs → Registros | **hecho** | `72f71bf` | pendiente (auto-deploy) | Sin schema change: `formatActivity()` compone frase natural |
| 3 | P1.2 — Configuración visual | **hecho** | `5847e9d` | pendiente (auto-deploy) | `<SectionHeader>` + `<EmptyState>`, tildes corregidas |
| 4 | P2.1 — Cumpleaños 15→8 días | **hecho** | `6456cf2` | pendiente (auto-deploy) | One-liner: sub-vista pide `days=8` |
| 5 | P2.2 — Eliminar botón Domicilio | **hecho** | `b7902e7` | pendiente (auto-deploy) | Botón removido, `offersHomeService` intacto en schema |
| 6 | P2.4 — no_show tachado rojo | **hecho** | `6c8da41` | pendiente (auto-deploy) | Terracota + `line-through` en mobile + grilla |
| 7 | P2.5 — GlobalSearch | **hecho** | `7c2dd32` | pendiente (auto-deploy) | Sidebar, solo clientes, preselección vía `?client=` |
| 8 | P2.3 — businessHours morning/afternoon | **hecho** | `dd27975` | pendiente (auto-deploy) | Helper `businessHours.js` + 19 tests, backward-compat lazy sin migración |
| 9a | P0.2 — Personal rediseño visual | **hecho** | `ae32c3d` | pendiente (auto-deploy) | Botones "Activa/Inactiva" en oliva/terracota + "Editar" circular |
| 9b | P0.2 — accessSchedule | **GATE — análisis de seguridad listo** | - | no | Ambos agentes respondieron. Presento recomendaciones abajo para tu aprobación |

---

## 9 commits atómicos empujados a `main`

```
ae32c3d polish(personal): rediseño visual de la lista con botones activar/editar
dd27975 feat(config): businessHours con franjas mañana/tarde independientes
7c2dd32 feat(header): <GlobalSearch> en el sidebar con preselección en Clientes
6c8da41 polish(agenda): no_show con estilo tachado y rojo suave
b7902e7 polish(configuracion): eliminar botón "Domicilio/Spa" del panel
6456cf2 tweak(clientes): ventana de cumpleaños sub-vista 15 → 8 días
5847e9d polish(configuracion): rediseño visual + tildes correctas
72f71bf refactor(logs): renombrar a "Registros" y componer actividad en lenguaje natural
```

**Backend suite:** 255/255 pass (era 236 al arranque de la ronda, +19 tests del helper `businessHours`). **Cero regresiones.**

**Sin criterio de aborto disparado.** Sin cambios a `schema.prisma` (item 8 no requirió migración porque `Tenant.config` es JSON). Sin tocar rol `alma_app`, `MIGRATION_DATABASE_URL`, auth, permisos, ni Cabinas/Servicios/anamnesis.

---

## GATE 9b — Recomendaciones de Security Architect + AppSec Engineer

Ambos agentes ejecutados en paralelo mientras yo trabajaba en 8 y 9a. Ambos entregaron análisis completo.

### Security Architect — pregunta 1 (JWT vs middleware)

**Recomendación: Opción A** (middleware rechaza cada request nueva con 403, sin tabla `RevokedToken`).

Justificación clave: para un piloto de 3 cuentas en un solo nodo, el middleware `accessSchedule` post-`authenticate` YA es autoritativo. Mientras esté montado en todas las rutas protegidas, un JWT "flotando" fuera de ventana es inerte — no puede tocar datos, no puede mutar, no puede exfiltrar (cookie httpOnly). B introduce una tabla + lookup por request para resolver un problema que este piloto no tiene. Complejidad operativa real (migración, limpieza de tokens expirados) a cambio de una propiedad que ya se tiene gratis vía middleware.

**Guardrails de implementación que agregó (además de la respuesta):**
1. `/auth/logout` **debe** seguir funcionando fuera de horario (permitir cerrar sesión limpiamente).
2. `/auth/me` debe devolver 403 con `{ reason: 'outOfSchedule', nextWindowOpensAt }` para que el frontend redirija a una pantalla "Fuera de horario" en vez de al login — evita loop de login → 401 → login.
3. Registrar el 403 en `AdminAuditLog` con **throttling** (1 entrada por sesión+día, no una por request) para no inundar la tabla si el frontend reintenta.
4. Cuando `dueno`/`superadmin` cambien `accessSchedule` de un usuario logueado, el efecto es inmediato en la próxima request — documentar como feature, no bug.
5. Test de integración que enumere rutas y verifique que todas las autenticadas (excepto `/auth/logout` y `/auth/me` con el 403 especial) apliquen `accessSchedule` — mitiga el único vector real (ruta nueva olvidada).

Migración a B (con revocation) queda trivial si en el futuro escalan a multi-nodo. Cero lock-in.

### Application Security Engineer — pregunta 2 (fail-open vs fail-close)

**Recomendación: Opción A (Fail-open) + guardrails de UX obligatorios.**

Justificación clave: el activo protegido es la agenda de un spa con 2-3 empleadas conocidas ya autenticadas con contraseña. `accessSchedule` es un **control de restricción horaria de conveniencia**, no una barrera contra atacante externo. El login + JWT + rate limit hacen ese trabajo. Aplicar menor-privilegio duro sobre un control secundario cuando el primario ya está en pie es el error clásico de bloquear la puerta correcta por la razón equivocada.

**Riesgo real de B (fail-close):** dueña crea cuenta empleada domingo 8pm sin configurar horario, empleada intenta entrar lunes 7am, no puede, llama a la dueña, se pierde media mañana. Incidente que erosiona confianza en el producto. Onboarding roto se siente como bug.

**Riesgo real de A (fail-open):** cuenta `personal` recién creada puede entrar 24/7 hasta que se configure. Mitigable: solo rol `personal` (sin permisos destructivos), `AdminAuditLog` deja rastro.

**Guardrails de UX obligatorios para no degenerar:**
1. **Badge persistente en la fila del usuario** en `/personal`: "Acceso 24/7 — sin horario configurado" en amarillo. No modal descartable; estado visible hasta resolverse.
2. **Default sensato en POST /users:** al crear cuenta `personal`, **prellenar `accessSchedule` con `Tenant.config.businessHours`** (como *default del formulario*, no como fallback silencioso del middleware). La dueña acepta con un click o ajusta. Convierte "olvidó configurar" en "aceptó horario del spa" — que es lo que probablemente quería.
3. **Toast en login de la dueña** si alguna cuenta `personal` lleva `accessSchedule` vacío >7 días: "Tienes N cuentas sin horario — revisa Personal". Cierra el bucle sin bloquear.

Con esos tres cambios, A tiene la usabilidad de fail-open y el 90% de la seguridad de fail-close.

---

### Convergencia de los dos análisis

Ambas recomendaciones apuntan a **Opción A** en su pregunta respectiva. Combinado da un diseño coherente:

- Middleware `accessSchedule` post-`authenticate`, ejecuta chequeo TZ-aware por request, 403 con `reason: 'outOfSchedule'`.
- `/auth/logout` bypass (siempre permitido).
- `/auth/me` devuelve 403 con `nextWindowOpensAt` en vez de spinner.
- Auditoría throttled en `AdminAuditLog` (nueva `AuditAction: accessDeniedSchedule` — ya aprobada por PM).
- Schedule vacío = 24/7 permitido, con badge visible en `/personal`.
- POST /users prellenar schedule con `businessHours` del tenant.
- Toast a la dueña si hay cuentas sin schedule >7 días.
- `dueno`/`superadmin` = `alwaysAllowed: true` hardcoded (ya aprobado).
- Cruce medianoche a v2 (ya aprobado).
- Test de integración: enumerar rutas, verificar que todas las autenticadas aplican el middleware.

**Esfuerzo actualizado con guardrails:** 8-11h. Los guardrails de UX (badge amarillo, prefill schedule, toast dueña) suman ~1h pero son innegociables.

### Segundo GATE dentro de 9b (esperado)

Aún con este diseño aprobado, la migración Prisma para agregar `accessSchedule Json?` a `User` requiere aprobación explícita antes de aplicarla a Railway (`MIGRATION_DATABASE_URL`). El SQL será algo así:

```sql
ALTER TABLE "User" ADD COLUMN "accessSchedule" JSONB;
```

Sin default, sin backfill destructivo. Los usuarios existentes tendrán `accessSchedule: null` → cae al fail-open (24/7 con badge amarillo).

---

## Loop detenido — esperando aprobación PM

**Puedo arrancar 9b apenas apruebes:**
1. Ambas recomendaciones de los agentes (A + A + guardrails)
2. La migración Prisma propuesta

**O si prefieres pushear atrás con alguna de las recomendaciones**, dime y las re-diseñamos.

Recordatorio: cuando 9b esté aprobado y aplicado, la ronda completa cierra. Los 9 items estarán o hechos o formalmente descartados.
## Ronda P0/P2 seguridad, búsqueda y agenda (2026-08-11)

- Diagnóstico P0.1: no queda ninguna referencia a `todaysBirthdays` en el frontend actual; `npm run build` confirma que las rutas del dashboard compilan.
- Horario de acceso: el middleware ahora permite GET/HEAD/OPTIONS fuera de horario con headers `X-Alma-Out-Of-Schedule`, pero bloquea mutaciones con 403 `reason=outOfSchedule`. El frontend propaga esos headers por el proxy BFF y muestra banner de modo solo lectura sin cerrar sesión.
- Buscador global: se agregó `GET /search` protegido por permiso `clientes`, tenant-scoped y con DTO mínimo `{ type, id, name, phone }`, sin ClientIntake ni passwordHash.
- Domicilio: se ocultó de reserva pública, Agenda, Gabinetes y Configuración; backend rechaza `domicilio`, `home` y `a_domicilio` en disponibilidad y creación de citas.
- Horario de atención: default actualizado a 09:00-12:00 y 15:00-20:00; creación de citas fuera de franja se rechaza server-side.
- Cumpleaños: la subvista de Clientes ya consulta 8 días y el texto vacío ahora dice 8 días.
- Verificación local: `npm test` backend 284/284, `npm run lint` frontend 0 errores (3 warnings existentes), `npm run build` frontend verde.
- Verificación Railway adicional: el tenant `alma-spa` tenía `Tenant.config.businessHours` en formato viejo 09:00-19:00; se actualizó operativamente a 09:00-12:00 y 15:00-20:00. Disponibilidad pública verificada con slots locales `09:00,10:00,11:00,15:00,16:00,17:00,18:00,19:00`.
