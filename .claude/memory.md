# Alma Spa SaaS — memoria operativa

## 2026-08-11 — Ronda P0/P2 seguridad, búsqueda y agenda

- P0.1 `todaysBirthdays`: diagnóstico confirmó que no quedan referencias en el frontend actual; el build de Next compila las rutas del dashboard.
- Horario de acceso: GET/HEAD/OPTIONS fuera de horario quedan en modo solo lectura con headers; POST/PATCH/DELETE se bloquean con 403 `reason=outOfSchedule`.
- El frontend ya no cierra sesión cuando vence el horario durante una sesión activa; muestra banner de solo lectura.
- `GET /search` busca clientas con permiso `clientes`, aislamiento por tenant y DTO mínimo `{ type, id, name, phone }`, sin ClientIntake ni campos sensibles.
- Domicilio queda fuera de UI y rechazado server-side (`domicilio`, `home`, `a_domicilio`).
- Horario de atención default: mañana 09:00-12:00 y tarde 15:00-20:00; la creación y reprogramación de citas fuera de franjas se rechaza en backend.
- Cumpleaños: la subvista de Clientes usa ventana de 8 días; el badge/sidebar mantiene su lógica propia.
- Verificación local de la ronda: backend 284/284, frontend lint sin errores y build verde.
