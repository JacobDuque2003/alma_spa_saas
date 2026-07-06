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
- [ ] **Bloqueante**: esperar aprobación del usuario del esquema `Tenant`/`User`/`RolePermission` antes de Fase 2
- [ ] **Pendiente de higiene**: rotar la password de la DB Railway `alma_spa` (quedó expuesta en texto plano en el chat de esta sesión)

## Fase 2 — Configuración (catálogo base) — NO INICIADA

- [ ] CRUD `services` (nombre, duración 1h, precio USD)
- [ ] CRUD `rooms` (gabinetes) con especialidad + estado libre/ocupado/a_domicilio
- [ ] CRUD `plans` (sesiones incluidas, periodo, precio, servicios aplicables, incluye_domicilio)

## Fases 3–8 — pendientes (ver brief de Etapa 4 en CLAUDE.md)

- [ ] Fase 3: Flujo de reserva pública + Google Calendar
- [ ] Fase 4: Clientes (anamnesis, historial, planes, saldo)
- [ ] Fase 5: CRM (bandeja WhatsApp + recordatorios)
- [ ] Fase 6: Reportes
- [ ] Fase 7: Import/Export Excel
- [ ] Fase 8: Auditoría de seguridad + testing + despliegue
