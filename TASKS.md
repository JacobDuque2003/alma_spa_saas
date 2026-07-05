# Tareas — Alma Spa Backend

## Fase 1 — Esquema multi-tenant + autenticación + permisos

- [x] `package.json` + dependencias (express, prisma, jsonwebtoken, bcryptjs, dotenv)
- [x] `prisma/schema.prisma`: Tenant, User, RolePermission, enum Role
- [x] Autenticación JWT (login, hash, middleware `authenticate`)
- [x] Autorización (`requirePermission`, `requireRole`, `protectSuperadmin`) + `userService` con guard de `isProtected`
- [x] Rutas `auth.js` + `users.js` montadas en `app.js`
- [x] `prisma/seed.js` (tenant alma-spa, superadmin, dueño, 2 personal)
- [x] 15 tests unitarios de las reglas de seguridad
- [x] Verificación manual del servidor levantado localmente (sin DB real disponible en el entorno)
- [ ] **Bloqueante**: esperar aprobación del usuario del esquema `Tenant`/`User`/`RolePermission` antes de Fase 2
- [ ] Verificación end-to-end contra PostgreSQL real (Railway): `migrate dev` + `db:seed` + curl de login/403/tenant-aislado
- [ ] `git init` + primer commit (repo aún no inicializado)

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
