# Tareas — Alma Spa Backend

## Fase 1 — Esquema multi-tenant + autenticación + permisos

- [x] `package.json` + dependencias (express, prisma, jsonwebtoken, bcryptjs, dotenv)
- [x] `prisma/schema.prisma`: Tenant, User, RolePermission, enum Role
- [x] Autenticación JWT (login, hash, middleware `authenticate`)
- [x] Autorización (`requirePermission`, `requireRole`, `protectSuperadmin`) + `userService` con guard de `isProtected`
- [x] Rutas `auth.js` + `users.js` montadas en `app.js`
- [x] `prisma/seed.js` (tenant alma-spa, superadmin, dueño, 2 personal)
- [x] 19 tests unitarios de las reglas de seguridad (mock de Prisma)
- [x] Verificación manual del servidor levantado localmente (sin DB real disponible en el entorno)
- [x] `git init` + primer commit
- [x] Verificación end-to-end contra PostgreSQL real (Railway, DB dedicada `alma_spa`, no barbershop): `migrate dev` + `db:seed` + walkthrough completo de curl (login por rol, 403 real sobre superadmin, tenantId forjado ignorado) — ver `CHANGELOG.md` [0.1.1] para el detalle exacto de cada paso
- [x] **Aprobado por el usuario** el esquema `Tenant`/`User`/`RolePermission` con evidencia real contra Postgres
- [x] ~~Pendiente de higiene: rotar la password de la DB Railway~~ — confirmado por el usuario que la contraseña actual (`hayabusa.proxy.rlwy.net:42587`) es la vigente

## Fase 2 — Configuración (catálogo base) — COMPLETADA

- [x] `Service`, `Room` (+ enum `RoomStatus`), `Plan` en `prisma/schema.prisma` (relaciones inversas en `Tenant`, sin tocar columnas de Fase 1)
- [x] `src/utils/tenantScope.js` extraído de `userService.js` (reutilizado por los 3 servicios nuevos, sin cambio de comportamiento en Fase 1)
- [x] CRUD `services` — `category`, `durationMins` fijo en 60 (ignora lo que mande el cliente), `priceUsd` en `Decimal`
- [x] CRUD `rooms` — `specialty` validado contra `Service.category` activa del tenant (400 si no coincide)
- [x] CRUD `plans` — `appliesToAllServices`, `serviceIds` validados contra el tenant del actor (400 si alguno es de otro tenant)
- [x] Integridad simétrica: `DELETE /services/:id` rechaza con 400 si es la última service activa de su category y un room activo depende de ella
- [x] Todos los endpoints bajo `authenticate` + `requirePermission('configuracion')`
- [x] 33 tests unitarios (19 Fase 1 sin regresión + 14 nuevos de Fase 2, mock de Prisma)
- [x] Migración + walkthrough completo contra Postgres real (Railway) — ver `CHANGELOG.md` [0.2.0] para el detalle exacto de cada paso, incluyendo la primera prueba real (no mock) de `requirePermission('configuracion')`
- [ ] **Bloqueante**: esperar aprobación del usuario de este esquema antes de Fase 3

## Fases 3–8 — pendientes (ver brief de Etapa 4 en CLAUDE.md)

- [ ] Fase 3: Flujo de reserva pública + Google Calendar
- [ ] Fase 4: Clientes (anamnesis, historial, planes, saldo)
- [ ] Fase 5: CRM (bandeja WhatsApp + recordatorios)
- [ ] Fase 6: Reportes
- [ ] Fase 7: Import/Export Excel
- [ ] Fase 8: Auditoría de seguridad + testing + despliegue
