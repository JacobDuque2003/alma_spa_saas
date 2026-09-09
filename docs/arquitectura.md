# Arquitectura inicial

## Version actual

La version creada es una demo estatica navegable. Sirve para validar pantallas, flujo del CRM y comportamiento esperado antes de conectar servicios reales.

## Arquitectura recomendada para produccion

### Frontend

- React, Next.js o Vue para una interfaz SaaS robusta.
- Panel administrativo responsive.
- Modulos: bandeja, agenda, clientes, servicios, campanas, reportes y configuracion del bot.

### Backend

- API REST o GraphQL.
- Modulos de negocio: usuarios, clientes, conversaciones, citas, servicios, plantillas, automatizaciones y auditoria.
- Webhooks para recibir mensajes de WhatsApp, Instagram y otros canales.

### Base de datos

- PostgreSQL para datos principales.
- Redis para colas, sesiones y tareas programadas.
- Almacenamiento de archivos para imagenes, documentos y respaldos.

### IA

- Base de conocimiento editable por el negocio.
- Respuestas generadas con reglas de seguridad.
- Escalamiento humano cuando exista riesgo, queja o tema sensible.
- Registro de cada respuesta sugerida o enviada.

### Integraciones

- WhatsApp Business Platform como primer canal real.
- Meta API para Instagram y Facebook.
- TikTok segun disponibilidad de mensajeria, leads o anuncios.
- Google Calendar o agenda interna.

## Seguridad minima

- Login por usuario.
- Roles: administrador, recepcion, asesora y solo lectura.
- Historial de acciones.
- Exportacion de clientes.
- Politicas para datos sensibles.

## Estado real del panel administrativo

El panel usa Next.js con un proxy interno que conserva el token en cookie
`HttpOnly`, `Secure` en produccion y `SameSite=Lax`. El navegador no accede al
JWT directamente; las llamadas pasan por `/api/proxy/*`.

Estados de interfaz obligatorios:

- Carga: mantener estructura visible y mostrar `LoadingState`, no pantallas en blanco.
- Error: mostrar `ErrorState` con motivo humano y accion de reintento cuando aplica.
- Vacio: mostrar `EmptyState` explicando que no hay datos, no que el sistema fallo.

Estos estados ya estan aplicados en Agenda, Clientes, CRM, Reportes, Equipo,
Logs, Configuracion y reserva publica.

## Disponibilidad y horarios

La fuente de verdad para horarios reservables vive en
`src/services/appointmentService.js`. La agenda del panel, la reserva publica y
el bot de WhatsApp deben consultar esa capa; no deben calcular disponibilidad
final por su cuenta.

Precedencia actual:

- Dias laborables del tenant (`Tenant.config.workDays`, ISO lunes=1, domingo=7).
- Horario general del spa (`Tenant.config.businessHours`).
- Horario propio del servicio o subservicio (`Service.appointmentSchedule`).
- Si el subservicio no tiene horario propio, hereda el horario del servicio
  principal; si el principal tampoco tiene, hereda el horario general del spa.
- Horario de cabina (`Room.schedule`) como restriccion adicional.
- Horario clinico de la trabajadora (`User.appointmentSchedule`) como
  restriccion adicional de asignacion. `null` significa que no agrega una
  restriccion propia; un dia en `null` significa que esa persona no atiende
  citas ese dia.
- Citas existentes de cabina, terapeuta y clienta.

El formato de horario por servicio es semanal por nombre de dia en ingles
(`monday`, `tuesday`, etc.) y cada dia puede tener `morning`, `afternoon` o
`null` para cerrado. El backend cruza las ventanas y devuelve `emptyReason`
cuando no hay cupos, para que panel y bot expliquen el motivo con lenguaje
humano.

No mezclar `User.accessSchedule` con disponibilidad clinica: ese campo regula
cuando una cuenta puede escribir en el panel. La disponibilidad real de
trabajadoras vive en `User.appointmentSchedule` y debe pasar siempre por
`appointmentService`, igual que servicios y cabinas.

## Sesiones

Capas actuales:

- Vencimiento absoluto de JWT en backend: `JWT_EXPIRES_IN`, default `8h`.
- Cookie del BFF con `maxAge` de 8 horas.
- Invalidacion por `sessionVersion`: cambios de clave/cuenta cierran sesiones anteriores.
- Cierre por inactividad en frontend: `NEXT_PUBLIC_SESSION_IDLE_MINUTES`, default 60 minutos.
- Logout auditado best-effort en `AdminAuditLog`.

Pendiente recomendado: tabla de sesiones si se necesita ver dispositivos activos,
cerrar una sesion especifica o aplicar politicas por dispositivo/IP.

## RLA: Role/Permission Level Authorization

El backend deriva identidad, rol y `tenantId` desde la base de datos en cada
request autenticado. El JWT solo prueba que la sesion fue emitida para la misma
version de cuenta. Las rutas usan:

- `requireRole` para acciones solo de dueña/superadmin.
- `requirePermission` y `requireAnyPermission` para permisos finos por modulo.
- `protectSuperadmin` para impedir cambios accidentales en cuentas protegidas.
- `accessSchedule` para restringir escritura fuera del horario de acceso.

El frontend oculta navegacion y controles segun permisos, pero eso es solo UX:
la autorizacion real vive en backend.

## RLS: Row Level Security en PostgreSQL

No debe activarse de golpe sin preparar Prisma. Con Prisma, las consultas no
incluyen automaticamente una variable de tenant a nivel de conexion; si se
activa `FORCE ROW LEVEL SECURITY` antes de cablear `SET LOCAL app.tenant_id`,
la app puede quedarse sin leer/escribir sus propios datos.

Plan seguro:

- Crear un rol de aplicacion no-owner y mantener un rol separado para migraciones.
- Crear una funcion estable tipo `app.current_tenant_id()` que lea
  `current_setting('app.tenant_id', true)`.
- Definir politicas RLS por tabla con `tenantId = app.current_tenant_id()`.
- Cablear las operaciones tenant-scoped para ejecutarse dentro de transacciones
  que hagan `SET LOCAL app.tenant_id = '<tenantId>'`.
- Resolver superadmin con flujo explicito: o politicas separadas por rol de DB,
  o rutas superadmin que sigan usando un rol administrativo acotado.
- Probar primero en staging con agenda, CRM, reserva publica, bot, reportes y
  scripts de mantenimiento.
- Activar produccion por grupos de tablas, no todo a la vez.

Hasta completar ese cableado, la defensa equivalente vigente es tenant scope en
servicios/rutas, permisos por rol, auditoria, cifrado de campos sensibles y rol
DB de aplicacion con privilegios reducidos.

## Blindaje faltante antes de escalar

- Cloudflare delante del frontend/backend con reglas de HTTPS y headers reales.
- `ALLOWED_ORIGINS` configurado con dominios de produccion.
- CSP estricta compatible con Next.js.
- MFA para dueña/superadmin.
- Rate limit distribuido con Redis o equivalente si hay mas de una instancia.
- Backups cifrados fuera del servidor, restauracion mensual probada y alertas.
- Buckets privados y URLs firmadas para medios persistentes.
- Logging estructurado, monitoreo y runbook de incidente.
