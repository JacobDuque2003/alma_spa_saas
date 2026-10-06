# Almita v2: estado de implementación

Actualizado: 2026-10-03.

## Implementado

- Memoria reciente reconstruida desde `WhatsAppMessage` en PostgreSQL. No depende solamente del estado temporal del proceso.
- Aislamiento obligatorio por `tenantId` y `conversationId` en cada consulta de memoria.
- Inclusión de mensajes entrantes y salientes, incluidos los enviados por recepción, para conservar el hilo real de la conversación.
- Límite de 16 mensajes normalmente y 40 ante solicitudes explícitas de recuerdo.
- Límite de 500 caracteres por mensaje y 6000 caracteres totales enviados como contexto a la IA.
- Eliminación de la copia duplicada del mensaje entrante actual antes de llamar al modelo.
- Degradación segura: si PostgreSQL no responde, se usa el historial temporal y el bot continúa sin exponer datos de otra conversación.
- Instrucción explícita para no inventar recuerdos ni acciones realizadas.
- Menú principal en texto con emojis y comprensión del nombre o intención de la opción.
- Catálogo general de servicios en texto, sin depender de listas interactivas de Meta.
- Reserva y reprogramación completas en texto: servicio, variante, fecha, jornada, hora, terapeuta y selección de cita.
- Las opciones de texto quedan asociadas al paso exacto que las creó; una respuesta tardía no puede ejecutar una opción perteneciente a una pregunta anterior.
- Las horas usan el formato `🕐 9:00 de la mañana`, sin un índice numérico delante que pueda confundirse con la hora.
- Solo permanecen botones para confirmar una reserva o confirmar una reprogramación.
- Los constructores interactivos antiguos ya fueron retirados. Se conservaron las reglas de tono, categorías, íconos, compatibilidad con identificadores anteriores y confirmaciones finales.
- El boceto de experiencia y contenido está en `docs/almita-boceto-conversacion.md`.

## Seguridad y privacidad

- No se registran cuerpos de mensajes en los logs nuevos de memoria.
- La consulta aprovecha el índice existente `(tenantId, conversationId, createdAt)`.
- La memoria entregada al modelo está acotada para evitar crecimiento sin límite, costos inesperados y abuso de contexto.
- Esta memoria no convierte automáticamente datos médicos, secretos o preferencias en hechos permanentes.
- No existe todavía una política automática de vencimiento o anonimización de mensajes; debe definirse antes de producción plena.

## Interacciones restantes

- Confirmación final de una reserva.
- Confirmación final de una reprogramación.

Son acciones deliberadas: antes de ejecutarlas el backend vuelve a comprobar disponibilidad. Si se implementa cancelación automática, también deberá exigir una confirmación explícita.

## Siguiente bloque recomendado

1. Añadir resumen progresivo y hechos aprobados, separados del historial literal.
2. Definir retención, exportación y eliminación de conversaciones por cliente y tenant.
3. Construir la base de conocimiento aprobada por Gianella: servicios, preparación, cuidados, restricciones, pagos y políticas.
4. Crear un conjunto de conversaciones de evaluación antes de conectar el número real.
5. Añadir transcripción de audio con consentimiento, límites de tamaño y borrado controlado.
