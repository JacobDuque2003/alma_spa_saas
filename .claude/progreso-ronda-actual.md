# Progreso — Ronda actual del loop (SUPERSEDIDA por trabajo posterior)

> **Este archivo describe el estado que dejé al cerrar mi loop autónomo el
> 2026-08-11. Después hubo 30 commits de sesiones que no auditó el PM que corría
> este loop. La auditoría de esos 30 commits está en `.claude/memory.md` sección
> "Auditoría post-ronda P0/P2".**

Iniciada 2026-08-02. Cerrada por mí el 2026-08-11 con 9b pendiente de segundo GATE.

| # | Item | Estado al cierre del loop | Commit | Verificado en Railway |
|---|------|---------------------------|--------|------------------------|
| 1 | P0.1 — Bug todaysBirthdays | cerrado — no reproducible | n/a | n/a |
| 2 | P1.1 — Logs → Registros | hecho | `72f71bf` | pendiente al momento del cierre |
| 3 | P1.2 — Configuración visual | hecho | `5847e9d` | pendiente al momento del cierre |
| 4 | P2.1 — Cumpleaños 15→8 días | hecho | `6456cf2` | pendiente al momento del cierre |
| 5 | P2.2 — Eliminar botón Domicilio | hecho | `b7902e7` | pendiente al momento del cierre |
| 6 | P2.4 — no_show tachado rojo | hecho | `6c8da41` | pendiente al momento del cierre |
| 7 | P2.5 — GlobalSearch | hecho | `7c2dd32` | pendiente al momento del cierre |
| 8 | P2.3 — businessHours morning/afternoon | hecho | `dd27975` | pendiente al momento del cierre |
| 9a | P0.2 — Personal rediseño visual | hecho | `ae32c3d` | pendiente al momento del cierre |
| 9b | P0.2 — accessSchedule | **código completo, commit LOCAL** | `1ace68e` (no pusheado por mí) | GATE #2 pendiente al cierre |

### Qué pasó después del cierre (auditado 2026-08-18)

- `1ace68e` fue pusheado por otra sesión.
- La migración de `accessSchedule` se aplicó a Railway.
- **Se hicieron 30 commits adicionales**, incluyendo scope creep formal hacia Cabinas + Servicios + Anamnesis + Permisos finos, con 3 migraciones extra aplicadas a Railway. **Sin GATE explícito del PM en la memoria de esta sesión.**
- **15 tests backend fallando** ahora, incluyendo dos de aislamiento tenant crítico. Detalle en `.claude/memory.md`.
- Diseño 9b divergente del aprobado: `7774f2c` permite GET/HEAD/OPTIONS fuera de horario con headers. La Security Architect no re-validó esta variante.

### Recomendación para el PM (2026-08-18)

Antes de definir "Ronda Cabinas + Servicios" formal: resolver los 15 tests fallando (especialmente los dos de aislamiento tenant), auditar el schedule de `amparito@almaspa.com` en Railway, y re-validar el diseño de "solo lectura fuera de horario" con Security Architect. Ver reporte completo en el chat de la sesión de auditoría del 2026-08-18.

### Ronda de fixes P0+P1 (2026-08-19) — ver `.claude/memory.md` para detalle completo

- **P0 cerrado:** `amparito@almaspa.com` desbloqueada (accessSchedule → null), verificado con evidencia real contra Railway.
- **P1 cerrado:** los 15 tests fallando eran mocks/fixtures desactualizados (categoría b), no regresiones de seguridad. Backend en **303/303**.
- **Sigue sin tocar, sigue pendiente para antes de Cabinas+Servicios:** `Room.colorHex` posible duplicado, diseño GET-solo-lectura de 9b (`7774f2c`) sin re-validar con Security Architect, y un hallazgo nuevo — la UI de `AccessScheduleEditor` puede volver a producir el mismo bloqueo total silencioso que tuvo amparito (sin guardas), no corregido por estar fuera de alcance de esta ronda.
- Frontend sigue sin test runner (0 tests) — pendiente documentado en Apéndice A del plan, no iniciado.
