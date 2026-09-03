# Auditoría de seguridad — Alma Spa SaaS

Fecha: 3 de septiembre de 2026
Alcance: API Node/Express, panel Next.js, autenticación y permisos, PostgreSQL/Prisma, bandeja de WhatsApp, importación Excel y configuración de despliegue disponible en el repositorio.

## Dictamen ejecutivo

El código está en condiciones para una prueba interna controlada, pero **no recomiendo declarar todavía un lanzamiento público plenamente protegido**. Antes de producción deben cerrarse tres puntos operativos que no pueden comprobarse únicamente desde el repositorio:

1. Rotar en Railway la credencial del rol de base de datos que estuvo expuesta en el historial de Git.
2. Confirmar que la aplicación usa un rol PostgreSQL sin privilegios de administrador y que las migraciones usan una credencial separada.
3. Activar respaldos automáticos, mantener una copia fuera del proyecto y ejecutar una restauración de prueba.

No se encontraron consultas SQL inseguras construidas con texto del usuario, inyección directa de HTML en el panel ni secretos activos en archivos `.env` versionados. El aislamiento por negocio, las firmas de WhatsApp y el cifrado de datos sensibles cuentan con controles explícitos.

## Hallazgos y estado

### Bloqueantes antes de producción

| Severidad | Hallazgo | Estado / acción |
|---|---|---|
| Crítica | Una contraseña de rol PostgreSQL estuvo escrita en un archivo versionado y permanece en el historial de Git. | El texto fue eliminado del archivo actual. Rotar la contraseña en Railway antes de permitir tráfico real; después, considerar sanear el historial remoto. |
| Alta | No existe evidencia verificable de un respaldo automático con restauración probada. | La pantalla ahora lo informa como pendiente. Activar las tres capas indicadas en el plan de respaldos y documentar una restauración mensual. |
| Alta | No se pudo verificar que `DATABASE_URL` use el rol restringido `alma_app`; el repositorio sí soporta `MIGRATION_DATABASE_URL` por separado. | Configurar ambas credenciales y ejecutar `npm run db:verify-role` contra el rol de aplicación. El resultado esperado es sin superusuario, sin DDL y con el historial de anamnesis de solo inserción/lectura. |

### Riesgos importantes no bloqueantes para un piloto limitado

| Severidad | Hallazgo | Recomendación |
|---|---|---|
| Media | El límite de intentos de acceso vive en memoria; se reinicia al publicar y no se comparte entre múltiples instancias. | Mantener una sola instancia durante el piloto y migrar el contador a Redis antes de escalar. Se añadió además un límite agregado por IP contra password spraying. |
| Media | No hay segundo factor de autenticación para Dueña/Técnico. | Exigir contraseñas únicas y largas ahora; incorporar TOTP o WebAuthn como siguiente endurecimiento. |
| Media | Si falla internamente la comprobación del horario de acceso, esa capa actualmente permite continuar. La autenticación principal sí falla cerrada si no puede consultar la cuenta. | Hacer que los errores de horario bloqueen mutaciones con 503 y permitir, como máximo, lecturas controladas. |
| Media | La descarga de medios entrantes de WhatsApp confía en la URL entregada por Meta y materializa el archivo en memoria. | Añadir límite por `Content-Length`, tope durante streaming y allowlist de hosts de Meta. |
| Media | `exceljs` arrastra una versión de `uuid` con un aviso de límites de buffer. | No se utiliza la función vulnerable de UUID desde el sistema. Mantener seguimiento y actualizar cuando ExcelJS publique una cadena compatible; el downgrade sugerido por npm no es una corrección segura. |
| Baja/Media | El panel tiene encabezados de seguridad, pero no una política CSP estricta. | Incorporar CSP con nonce después de inventariar scripts/estilos requeridos por Next.js. |

## Controles verificados

- JWT firmado con secreto mínimo de 32 bytes, algoritmo fijado y expiración configurada.
- Cada petición autenticada vuelve a comprobar cuenta activa, negocio, rol y versión de sesión en la base de datos.
- Cambiar permisos, rol, horario, contraseña o estado revoca inmediatamente las sesiones anteriores.
- Una cuenta protegida de Técnico no se puede editar ni eliminar; tampoco se puede eliminar la propia cuenta ni la única Dueña activa.
- Las operaciones se filtran por `tenantId`; existen pruebas de rechazo entre negocios.
- Prisma usa consultas parametrizadas. No se encontraron `$queryRawUnsafe` ni `$executeRawUnsafe`; los usos SQL existentes son plantillas etiquetadas sin interpolación insegura.
- React escapa los mensajes por defecto y no se encontró `dangerouslySetInnerHTML`.
- El webhook de WhatsApp valida HMAC con comparación de tiempo constante e impide duplicados por `waMessageId`.
- Las credenciales de WhatsApp y la anamnesis usan cifrado autenticado; las claves no se guardan en el repositorio.
- Hay límites de cuerpo por ruta, tipos MIME permitidos y neutralización de fórmulas al exportar CSV.
- Helmet configura HSTS, protección contra MIME sniffing, clickjacking y una política de referencia restrictiva.
- El panel usa una cookie `HttpOnly`, `Secure` en producción y `SameSite=Lax`; las mutaciones del proxy verifican el origen.
- El registro administrativo conserva actor y acción para cambios sensibles.

## Dependencias

- Panel: 0 vulnerabilidades conocidas en dependencias de producción.
- API: 0 críticas, 0 altas, 2 moderadas; ambas corresponden a la misma cadena `exceljs` → `uuid`.
- Se fijó una versión segura de `qs` y se corrigió el aviso de desarrollo de `brace-expansion` usado por nodemon.

## Plan de respaldos recomendado

Aplicar las tres capas, no elegir solo una:

1. **Railway, recuperación rápida:** respaldo diario con retención corta, semanal y mensual; habilitar también recuperación a un punto en el tiempo cuando esté disponible.
2. **Copia lógica externa:** `pg_dump` cifrado cada noche hacia un bucket fuera del mismo proyecto de Railway. Retención sugerida: 30 diarios y 12 mensuales.
3. **Prueba de restauración:** una vez al mes restaurar en una base aislada, comprobar cantidad de clientes, conversaciones, citas y archivos, y registrar duración/resultado.

Las copias deben cifrarse, tener acceso exclusivo de Dueña/Técnico, registrar descargas y no enviarse por correo ni guardarse como archivos sueltos en Google Drive. Drive puede recibir un reporte de éxito, no la base de datos sin un proceso adicional de cifrado y control de acceso.

## Conversaciones y conservación

Los mensajes se conservan como registros estructurados en PostgreSQL: dirección, tipo, texto/caption, identificador de WhatsApp, estado y fechas; los medios se recuperan mediante el identificador de Meta o el almacenamiento previsto por la integración. Actualmente no hay una eliminación automática por antigüedad.

Antes del lanzamiento se debe aprobar una política escrita. Recomendación inicial: conservar conversaciones operativas 24 meses, registros de auditoría por más tiempo según necesidad legal y comercial, y ofrecer borrado/anominización por solicitud sin destruir los comprobantes que deban mantenerse. La política definitiva debe revisarse con asesoría legal ecuatoriana por tratarse de información personal y, en anamnesis, potencialmente sensible.

## Criterio para autorizar producción

Se puede dar el visto bueno cuando exista evidencia de: credencial rotada, rol restringido verificado, respaldo/restauración exitosos, variables de producción revisadas, dominio HTTPS definitivo y una prueba de extremo a extremo que incluya login, reserva, reprogramación, WhatsApp, cuenta revocada y restauración de datos. Hasta entonces, limitar el uso a un piloto supervisado.
