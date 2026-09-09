# Auditoria de seguridad y UI - Alma Spa SaaS

Fecha: 9 de septiembre de 2026
Alcance: backend Node/Express, frontend Next.js, login, entradas de usuario, webhooks, PostgreSQL/Prisma, scripts de consola, dependencias y barra lateral izquierda del panel.

## Dictamen

El repositorio queda en mejor estado que la auditoria del 3 de septiembre: las dependencias de produccion del backend y del frontend reportan 0 vulnerabilidades conocidas, el build del frontend pasa, y la barra lateral izquierda fue ajustada para abrirse y cerrarse con una sola transicion coordinada.

No se detecto NoSQL en el proyecto. La persistencia real es PostgreSQL via Prisma; los unicos estados no relacionales observados son caches en memoria para rate limits, estados temporales del bot y avisos de UI.

## Cambios aplicados

- Barra lateral izquierda: se reemplazo el montaje/desmontaje brusco de textos, logo y acciones por animaciones sincronizadas de ancho, padding, opacidad y desplazamiento. El contenedor ahora mantiene el contenido estable durante el colapso para evitar que se abra o cierre "por partes".
- Frontend build: se fijo `turbopack.root` al directorio `frontend`, evitando que Next tome el lockfile del backend como raiz del proyecto y busque dependencias en el lugar incorrecto.
- Dependencias backend: se fijo `uuid` en `11.1.1` via `overrides`, eliminando el aviso moderado arrastrado por dependencias transitivas.
- Dependencias frontend: el lockfile quedo con `sharp 0.35.4`, eliminando la vulnerabilidad alta reportada por npm.
- Horario de acceso: en produccion, si el middleware no puede verificar el horario de una cuenta no privilegiada, las mutaciones ahora fallan cerrado con 503 en vez de continuar.

## Superficies revisadas

- Login y sesion: rate limit por IP+correo y por IP, JWT con algoritmo HS256 fijado, secreto minimo de 32 bytes, expiracion, version de sesion y revalidacion de usuario activo en DB.
- Cookies y proxy frontend: cookie `HttpOnly`, `SameSite=Lax`, `Secure` en produccion, no-store para respuestas con datos y validacion de origen en mutaciones.
- Permisos: guards por modulo/rol, scope por `tenantId`, pruebas de rechazo cross-tenant y revocacion de sesion cuando cambian cuenta, rol o version.
- Inputs: validaciones de email, telefono, fechas, horarios, importacion Excel, imagenes, adjuntos, estados permitidos, limites por ruta y neutralizacion de formulas en CSV.
- Webhooks WhatsApp: verificacion HMAC SHA-256 sobre `rawBody`, comparacion segura, rechazo de headers malformados, idempotencia por `waMessageId` y filtrado por tenant/phone id.
- SQL/PostgreSQL: no se encontraron `queryRawUnsafe` ni `executeRawUnsafe`. Los usos raw detectados son plantillas parametrizadas de Prisma para healthcheck, migracion/verificacion controlada y update de estado de WhatsApp.
- NoSQL: no aplica; no hay MongoDB ni base NoSQL en el repo.
- Scripts de consola: backups usan `spawn` sin shell, redaccion de cadenas de conexion y borrado de temporales; restore-test elimina variables peligrosas antes de levantar Postgres local. Scripts destructivos observados requieren confirmacion explicita.
- Secretos: `.env` esta ignorado y no versionado; no aparecieron patrones de secretos activos en archivos rastreados por Git.

## Riesgos residuales

- El rate limit sigue en memoria. Para una sola instancia/piloto esta bien; antes de escalar conviene moverlo a Redis o un storage compartido.
- No hay MFA para Dueña/Tecnico. Recomendacion: agregar TOTP/WebAuthn antes de produccion abierta.
- La descarga de medios de WhatsApp materializa el archivo en memoria. Recomendacion: imponer tope por `Content-Length`, cortar streaming al superar limite y restringir hosts esperados de Meta.
- Falta una CSP estricta con nonce en el frontend. Los headers base estan, pero CSP requiere inventariar scripts/estilos de Next para no romper el panel.

## Verificacion ejecutada

- Backend tests: 502/502 pasan.
- Frontend lint: 0 errores, 4 warnings existentes de hooks.
- Frontend build: pasa.
- Auditoria npm backend: 0 vulnerabilidades conocidas.
- Auditoria npm frontend: 0 vulnerabilidades conocidas.
- Revisión de whitespace del diff: sin errores.
