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
