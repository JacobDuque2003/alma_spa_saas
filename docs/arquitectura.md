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

## Disponibilidad de citas

La disponibilidad no debe tratar a cada servicio como si tuviera un horario
semanal propio. El spa tiene un horario de atencion general y cada servicio
define cuanto tiempo ocupa una reserva.

Regla correcta:

- Horario del local: `Tenant.config.businessHours` y `Tenant.config.workDays`.
- Servicio/subservicio: `durationMins` para la sesion y `bufferMins` para la pausa.
- Bloque total reservable: `durationMins + bufferMins`.
- Cabinas permitidas: relacion `Room`-`Service`.
- La agenda, reserva publica y bot generan todos los cupos que quepan dentro
  del horario abierto, descontando citas existentes de cabina, terapeuta y
  clienta.
- La agenda interna puede mostrar horarios ampliados para dueña/superadmin.
  Si se agenda en ese rango, se guarda como reserva interna para trazabilidad,
  sin cambiar el horario del local ni abrir esos cupos en bot o link publico.

`User.accessSchedule` regula cuando una cuenta puede usar el panel. No debe
mostrarse como “horario de citas” ni reemplazar el horario de atencion del
local.

## Seguridad minima

- Login por usuario.
- Roles: administrador, recepcion, asesora y solo lectura.
- Historial de acciones.
- Exportacion de clientes.
- Politicas para datos sensibles.
