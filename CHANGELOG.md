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
- Verificación end-to-end contra PostgreSQL real (Railway) — no había DB disponible en el entorno de esta sesión.
- Fases 2–8 del brief de Etapa 4 (catálogo, reserva pública, clientes/CRM, reportes, Excel, auditoría).
