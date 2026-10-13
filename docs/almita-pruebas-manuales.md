# Pruebas manuales de Almita

Ejecutar cada escenario desde una conversación limpia y conservar capturas del resultado.

1. Saludo simple: debe mostrar únicamente las cuatro opciones principales.
2. Reserva con servicio explícito: debe ir directo al día, sin volver al menú.
3. Reserva genérica: debe mostrar servicios con precio y duración.
4. Reserva completa de cliente nuevo: servicio, día, horario, terapeuta, datos y confirmación.
5. Reserva de cliente existente: debe reconocerlo y evitar volver a pedir su ficha.
6. Reserva para otra persona: debe recopilar los datos del beneficiario sin perder el remitente.
7. Ayuda para elegir: debe recomendar servicios reales sin diagnosticar ni reservar sin permiso.
8. Consulta, reprogramación y cancelación de cita.
9. Contacto con asesor dentro y fuera del horario de atención.
10. Horario ocupado durante la confirmación: debe ofrecer otra disponibilidad.
11. Datos inválidos u omitidos y mensajes que no corresponden al paso actual.
12. Reinicio durante una reserva: debe recuperar el paso persistido correctamente.
13. Audio, imagen y mensajes ambiguos: debe responder con una alternativa segura.
14. Repetición de preguntas comunes: debe consultar la ficha pública vigente o un ejemplo público aprobado, sin reutilizar respuestas generadas con historial personal.

## Regresión de privacidad y coherencia (12 de octubre de 2026)

Probar primero con datos ficticios. No enviar documentos personales ni claves a Información, instrucciones, briefing o ejemplos.

| Situación | Resultado esperado |
| --- | --- |
| Dos contactos preguntan «¿qué habíamos quedado?» | Cada respuesta usa solo su conversación; nunca la respuesta generada para el otro contacto. |
| Mismo teléfono escribe a dos negocios | Memoria, reserva y derivación a asesor independientes por negocio y conversación. |
| Ficha o ejemplo activo marcado Interno | No aparece en fuentes del simulador ni se incorpora al contexto de la IA o respuestas directas. |
| Ficha nueva en Información | Empieza como Interno. Soporte debe revisar el contenido y cambiar Audiencia a Público para aprobarlo. |
| Editar solo el texto de una ficha | Se conservan origen, prioridad y audiencia. |
| «Quiero reservar limpieza facial kids» sin servicio operativo específico | Explica la ficha pública y solicita coordinación con asesor; no reserva Limpieza facial general. |
| Consultar otro tratamiento durante una reserva | Explica el otro servicio, conserva la selección original y no solicita fecha para el servicio consultado. |
| Elegir explícitamente otro servicio | Sustituye el servicio de la reserva en preparación y revisa nuevamente disponibilidad. |
| Servicio con precio cero o pendiente | «Valor a confirmar»; no se presenta como gratuito ni se cierra automáticamente. |
| Solicitar asesor mientras se captura nombre, dirección o cédula | Deriva sin guardar esa petición como un dato personal. |
| Elegir una terapeuta por nombre en su selector | Selecciona la terapeuta; «quiero hablar con Gianella» sigue solicitando atención humana. |
| «Cancelar mi cita» | Selecciona una cita propia, solicita confirmación y comunica éxito solo después de que el sistema la cancela. |
| Cancelación falla o cita de otra persona | No cancela y no anuncia éxito. |
| Cambiar día/hora de cita | Consulta espacios reales; no anuncia modificación antes de guardarla. |
| Consultar horario | Usa tenant.config; se mantienen lunes a viernes hasta aprobación de Gianella. |
| Seleccionar identificador antiguo de Cumpleaños | No publica su descripción interna ni inicia su reserva comercial. |
| Consulta pública de un teléfono | Respuesta uniforme; no revela existencia de cliente ni consentimiento clínico. |
| Reserva web usando un teléfono existente | No sustituye nombre, dirección, correo ni anamnesis guardados. |
| Respuesta con enlace no registrado en una ficha pública | Se bloquea el enlace y se ofrece atención de asesor. |
| Reactivar bot desde la bandeja | Limpia únicamente el flujo y la escalación de esa conversación, no los de otro negocio. |

## Publicación

Los cambios de código y la migración están preparados localmente. No se aplican a producción solo por existir en este repositorio.

1. Ejecutar copia de seguridad y publicar backend y frontend coordinadamente.
2. Aplicar la migración `20261012120000_almita_audience` mediante el proceso normal de despliegue (`prisma migrate deploy`). No usar `db push` sobre producción.
3. Las fichas y ejemplos existentes se conservan y quedan Internos. Revisar las descripciones aprobadas, ubicación y políticas; aprobar únicamente las que deban responderse a clientes. Nunca publicar automáticamente todo el contenido.
4. En soporte: Centro de Almita > Información > Editar > Audiencia > Público > Guardar. Los ejemplos tienen su propia audiencia independiente.
5. Conservar precios pendientes y lunes a viernes; confirmar posteriormente con Gianella los importes y cualquier cambio de días, sin asumir gratuidad.
6. Repetir la matriz anterior en el simulador y luego en WhatsApp con números de prueba. El simulador verifica respuestas de IA, no crea citas ni sustituye las pruebas completas de los flujos reales.
7. Comprobar entrega de mensajes, fechas/terapeutas y actualización de la agenda. Los tests locales no certifican la configuración de Meta ni Google Calendar en producción.

La verificación empresarial de Meta y sus documentos se gestionan aparte; no son parte de la base de conocimiento de Almita.
