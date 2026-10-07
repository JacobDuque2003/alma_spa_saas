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
14. Repetición de preguntas comunes: debe reutilizar la caché sin mezclar negocios, tonos o datos personales.
