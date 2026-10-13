# Revisión de coherencia y privacidad de Almita

## Estado posterior a la revisión

Las correcciones se implementaron localmente el 12 de octubre de 2026. El cuerpo de este documento conserva los hallazgos originales de la auditoría de lectura; no describe el estado del código corregido ni confirma su publicación en Railway.

Se añadieron separación Público/Interno para información y ejemplos, memoria por negocio/conversación, eliminación de respuestas generadas compartidas, validación comercial de servicios y precios, instrucciones completas, horarios operativos, controles de reservas públicas y cancelación con confirmación. La revisión independiente detectó y permitió corregir tres regresiones adicionales de flujo/notificaciones/disponibilidad.

Verificación: suite completa de 638 pruebas sin fallos, pruebas adicionales focalizadas de horarios y flujos, compilación del frontend, validación/generación Prisma y revisión visual con datos ficticios en 1440 y 390 px. No se aplicó la migración en producción ni se enviaron mensajes reales.

La lista de publicación y pruebas de aceptación está en [almita-pruebas-manuales.md](almita-pruebas-manuales.md). Al aplicar la migración, las fichas existentes se conservan como Internas hasta aprobación explícita por soporte.

Fecha: 12 de octubre de 2026. Alcance: Servicios, Información del Centro de Almita, instrucciones que recibe la IA y canales relacionados de consulta y reserva.

## Resultado

La separación conceptual es adecuada, pero el sistema todavía no puede considerarse completamente coherente ni protegido frente a divulgaciones accidentales. El principal riesgo confirmado por reproducción con datos ficticios es la reutilización de una respuesta personalizada entre contactos mediante la caché.

No se encontraron credenciales, correos personales ni coincidencias con los secretos configurados en el contenido activo inspeccionado: 28 fichas operativas, 18 fichas informativas, configuración activa y ejemplos activos. Esto no certifica que nunca haya habido una fuga ni cubre historiales de clientes, archivos adjuntos, configuraciones archivadas o imágenes.

La revisión fue de lectura. No se cambiaron registros comerciales, permisos, código de aplicación ni despliegues. Las reproducciones de privacidad emplearon datos sintéticos; no se consultaron clientes reales ni se enviaron mensajes por WhatsApp. No se hicieron llamadas reales al proveedor de IA.

## Qué está correctamente separado

- Servicios guarda nombres, descripciones, precios y datos operativos de reserva. Los textos aprobados siguen guardados en los 28 registros correspondientes.
- Información contiene los 11 textos adicionales, además de siete fichas previas de consulta y orientación. Ninguna de esas 11 fichas creó un nuevo servicio reservable.
- El Centro exige el rol superadmin en ruta, servicio y frontend. Las pruebas locales rechazan a propietaria y personal con 403. Las consultas sin sesión al Centro y a Servicios devolvieron 401 en producción.
- Los servicios normales de propietaria y personal quedan limitados a su tenant. El alcance global de soporte es una autorización deliberada, no por sí mismo una fuga.
- La ubicación pública almacenada es coherente con la dirección base del bot. El enlace de Maps está en Información, no contiene credenciales.
- Las descripciones no incluyen precios de proveedores de IA, consumo de tokens, costes internos o credenciales. Los precios de servicios son datos comerciales para clientes, no costes de operación del sistema.

## Hallazgos prioritarios

### 1. P1: la caché puede compartir una respuesta personalizada entre contactos

La clave de caché distingue negocio, tono y texto del mensaje, pero no conversación. Si falta clientName, se admite almacenar la respuesta de ciertas intenciones aunque exista historial personal. Una ausencia de nombre no implica que la respuesta sea anónima.

Reproducción local con datos ficticios: una respuesta que recuerda una cédula se almacena y se reutiliza para otro contacto que hace la misma pregunta. No se comprobó una fuga de una cédula real.

Referencias: [clave y lectura de caché](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1400), [almacenamiento de respuestas](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1536).

Corrección recomendada: no compartir texto generado con contexto personal. Separar respuestas públicas determinísticas de respuestas por conversación; no confiar en que falte el nombre para decidir privacidad. Revisar también la invalidación al cambiar contenido aprobado.

### 2. P2: una pantalla solo para soporte no convierte sus fichas en contenido privado

La selección de Información consulta todas las fichas activas relevantes y no existe una clasificación de confidencialidad. Su texto se incorpora al contexto del proveedor de IA. Una etiqueta como «Interno - no publicar» no actúa como permiso ni filtro.

Prueba sintética, sin llamadas externas: una ficha marcada como interna llegó al prompt; una respuesta ficticia del proveedor que repetía su marcador pasó al llamador sin bloquearse. Demuestra la falta de una barrera técnica, no que el modelo real haya divulgado información del negocio.

Referencias: [carga de Información](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/almitaCenterService.js:214), [incorporación al prompt](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:256), [aceptación de respuesta](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:323).

Corrección recomendada: reservar Información para texto aprobado para clientes. Si se necesita documentación interna, separarla en almacenamiento y permisos y excluirla antes de construir el prompt. Las instrucciones de no revelar y un filtro de salida pueden complementar, pero no sustituir, esa exclusión.

### 3. P2: el modelo no recibe todas las instrucciones configuradas

Las instrucciones activas tienen 10.449 caracteres, pero solo se envían 6.000. Quedan fuera las secciones Promociones y paquetes, Ubicación, Salud y seguridad, Privacidad, Atención de un asesor, Manejo de errores y Límites de conversación.

Sí existen algunas reglas generales fijas de seguridad; por tanto, no significa que el bot carezca de toda protección. El problema es que guardar el texto completo en Ajustes no asegura que sus reglas específicas estén siendo utilizadas.

Referencia: [límite del contexto](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:253).

Corrección recomendada: asegurar las reglas esenciales fuera de recortes arbitrarios y alinear el límite permitido con el límite realmente consumido. Organizar el contexto por secciones y relevancia sin cortar las reglas de privacidad o seguridad.

### 4. P2: Cumpleaños, un registro interno, está publicado como servicio

Se comprobó en producción que el catálogo público devuelve Cumpleaños junto con su descripción de registro interno, duración y precio. El listado normal de WhatsApp lo filtra, pero un identificador de selección antiguo o conocido puede abrir su detalle porque ese camino comprueba actividad, no visibilidad comercial.

No revela fechas de cumpleaños ni nombres de clientes: publica el registro genérico interno. El problema es su exposición y tratamiento como servicio.

Referencias: [catálogo público](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/routes/public/booking.js:13), [detalle del bot](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:2158).

Corrección recomendada: aplicar una única política de visibilidad comercial al catálogo público, al contexto del simulador, a los detalles y a la validación de reservas. Conservar el recordatorio en la agenda interna.

### 5. P2: una consulta pública permite inferir registro y consentimiento de un número

El lookup público acepta un número sin verificar posesión. Con datos sintéticos se obtuvo una diferencia entre número inexistente y número registrado con consentimiento: cambia exists y requiresIntake. No devuelve nombre, cédula, historia clínica ni ID en ese lookup, pero permite inferir pertenencia al centro y un estado derivado de la ficha.

No se probaron números reales. El rate limit reduce volumen, no evita una consulta dirigida.

Referencias: [endpoint público](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/routes/public/booking.js:40), [resultado del lookup](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/clientService.js:307).

Corrección recomendada: verificar posesión del número antes de revelar ese estado o responder indistintamente hasta completar la verificación.

## Problemas de coherencia de respuestas y edición

### 6. P2: información sin ficha reservable puede resolverse como otro servicio

La coincidencia por inclusión permite que «Limpieza facial kids» o «Limpieza facial profunda» se resuelvan como «Limpieza facial». El enrutador prioriza ese servicio sobre la explicación de Información y puede invitar a reservar la ficha base. Tener una ficha informativa no equivale a que esa modalidad sea reservable.

Referencias: [coincidencia de nombres](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:983), [prioridad sobre la respuesta informativa](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1679).

Corrección recomendada: resolver primero la identidad exacta o los alias explícitos. Si solo existe información, responder sobre esa ficha y derivar la reserva a un asesor, sin sustituirla por otro servicio.

### 7. P2: una pregunta repetida puede perder su explicación y mostrar el catálogo

La caché guarda service_info sin respuesta reutilizable ni parámetros de servicio; al recuperarla, se pierde el dato necesario para responder. En una reproducción local, la primera consulta de maderoterapia recibe una explicación y la segunda cae al catálogo operativo. La entrada puede persistir 24 horas.

Referencias: [almacenamiento](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1541), [recuperación](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1411), [fallback](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1694).

Corrección recomendada: no almacenar entradas incompletas. Para consultas públicas, recuperar el contenido vigente por una identidad estable y preservar los parámetros necesarios, sin reutilizar respuestas personales.

### 8. P2: se recortan las descripciones aprobadas

El prompt de IA utiliza hasta 180 caracteres y WhatsApp hasta 300. En el catálogo actual, 27 descripciones comerciales superan 180 y 14 superan 300. Se cortan frases y advertencias; abrir el detalle del bot tampoco recupera la versión completa.

Referencias: [descripciones para el modelo](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:148), [descripciones de WhatsApp](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1714).

Corrección recomendada: utilizar la descripción completa al explicar el servicio, o mantener un resumen aprobado separado que preserve su sentido y las advertencias. No cortar a mitad de frase.

### 9. P2: varias pantallas no interpretan igual un precio cero

Hay 19 registros activos con precio cero, uno de ellos el recordatorio interno. WhatsApp muestra «valor a confirmar» cuando el precio no es positivo, pero la página de reservas y el contexto de IA lo presentan como $0.00. No se determinó si alguno es realmente gratuito; no se deben cambiar importes sin aprobación comercial.

Referencias: [precio para IA](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:148), [precio para reservas](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/frontend/app/reservar/[tenantSlug]/page.js:16), [precio para WhatsApp](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1741).

Corrección recomendada: distinguir «precio pendiente» de «gratuito», confirmar con Gianella el estado de esos servicios y evitar confirmar reservas gratuitas por falta de configuración.

### 10. P2: los días de atención configurados y los anunciados no coinciden

La configuración activa contiene workDays de lunes a viernes. Las instrucciones de Almita y el prompt fijo anuncian lunes a sábado. Los intervalos de horas sí coinciden: 09:00-12:00 y 15:00-20:00.

Referencias: [horario fijo](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:172), [consulta de días operativos para escalado](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:204).

Corrección recomendada: confirmar los días reales con Gianella y derivar todos los mensajes y operaciones de una misma configuración. No se cambió el horario durante esta revisión.

### 11. P2: soporte puede ver el editor de Servicios, pero guardar puede fallar

Con superadmin sin tenantId propio, la autorización permite editar una ficha, pero la auditoría toma actor.tenantId y lanza un error. La transacción se revierte. La creación desde el formulario tampoco aporta el tenant requerido para soporte.

Referencias: [auditoría al editar](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/serviceService.js:299), [tenant por defecto de auditoría](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/utils/adminAudit.js:31).

Corrección recomendada: auditar el tenant del servicio y usar un tenant de trabajo explícito para soporte.

### 12. P2: las dos pantallas no tienen el mismo selector implícito de negocio

Servicios permite que soporte consulte todos los tenants si no filtra. El Centro de Almita usa Alma Spa por defecto. Con más negocios, el usuario de soporte puede terminar viendo catálogos diferentes en cada pantalla. No es un acceso indebido para soporte, pero sí una fuente de errores de edición.

Referencias: [consulta del frontend](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/frontend/app/admin/(dashboard)/configuracion/page.js:1080), [consulta de Servicios](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/serviceService.js:122), [resolución del Centro](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/almitaCenterService.js:97).

Corrección recomendada: mostrar y mantener explícitamente el negocio seleccionado en ambas pantallas.

### 13. P2: pedir un asesor puede interpretarse como un dato personal

La captura de nombre, dirección o cédula ocurre antes de evaluar la intención de atención humana. En una reproducción de ask_address, «quiero hablar con un asesor» se guardó como dirección y el bot pidió cédula.

Referencia: [orden de captura de datos](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1342).

Corrección recomendada: evaluar cancelación, cambio de tema y solicitud de asesor antes de capturar datos, y validar cada dato conforme a su campo.

### 14. P2: consultar otro tratamiento durante una reserva puede desorientar

Una pregunta «qué es...» dentro de una reserva puede responder sobre el servicio activo aunque mencione otro. En otra variante, se explica el nuevo servicio y se solicita fecha, mientras el estado de la reserva sigue conservando el servicio anterior.

Referencias: [respuesta sobre el servicio activo](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1312), [información durante reserva](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:2225).

Corrección recomendada: separar consulta informativa de cambio explícito de servicio; no pedir una nueva fecha si la reserva continúa con otro tratamiento.

## Observaciones adicionales

- **P2, riesgo potencial de caché de imágenes:** las imágenes de Servicios protegidas por autenticación usan Cache-Control público y el proxy lo conserva. No se verificó reutilización por una caché compartida ni exposición efectiva. Referencias: [respuesta de imagen](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/routes/services.js:42), [proxy](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/frontend/app/api/proxy/[...path]/route.js:95). Usar caché privada para recursos protegidos.
- **P3, pérdida de metadatos al editar Información:** modificar el título o texto desde el formulario puede restablecer prioridad a 50 y origen a Centro de Almita. Referencias: [inicialización del editor](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/frontend/app/admin/(dashboard)/almita/page.js:247), [envío de cambios](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/frontend/app/admin/(dashboard)/almita/page.js:219). Preservar u omitir metadatos que no se editaron.
- **P2, bloque de catálogo demasiado largo:** la división por párrafos no limita una categoría entera que supere el tamaño previsto. Se reprodujo un bloque de 9.453 caracteres con un catálogo sintético de 28 servicios en una categoría. No se envió a WhatsApp. Referencia: [división del mensaje](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1778). Dividir también bloques individuales y validar el tamaño antes de enviar.
- **P3, enlaces y políticas inconsistentes:** el prompt fijo prohíbe todos los enlaces, pero la configuración permite enlaces oficiales registrados en Información y la ruta de promociones tiene enlaces fijos de Instagram, Drive y Linktree. Maps está registrado, pero la ruta de ubicación usa una respuesta fija. No se comprobó que los enlaces adicionales sean maliciosos; el problema es que no existe una única lista de aprobación utilizada por todos los caminos. Referencias: [regla fija](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/aiClient.js:192), [promociones](C:/Users/59399/Desktop/PROYECTOS/alma_spa_saas/src/services/whatsappBot/index.js:1835).

## Prioridad propuesta de corrección

1. Eliminar la reutilización de respuestas personales entre contactos y evitar enviar documentación privada al modelo.
2. Ocultar y rechazar registros internos en todos los caminos públicos; proteger el lookup de números.
3. Garantizar que las reglas esenciales y advertencias aprobadas lleguen completas a cada canal.
4. Separar información de servicios reservables y corregir la caché de consultas específicas.
5. Reparar edición de soporte y conservación de metadatos.
6. Confirmar precios pendientes y días reales con Gianella; unificar la presentación sin inventar valores.
7. Probar derivación a asesor, cambios de tema, enlaces y categorías largas.

## Verificación y límites

- Se consultaron datos activos del tenant Alma Spa y los endpoints públicos de catálogo, versión y bloqueo sin sesión. El commit publicado y el HEAD local coinciden: ffa7048.
- La suite local principal ejecutó 119 pruebas existentes sin fallos. La revisión de autorización ejecutó también pruebas existentes y reproducciones sintéticas; estos resultados no cubren los nuevos escenarios por sí solos ni prueban que el modelo real nunca divulgue datos.
- La revisión independiente de AppSec se centró en permisos, superficies públicas y edición. La revisión independiente del bot comprobó en memoria escenarios de caché, selección y captura de datos.
- No se accedió a fichas reales de clientes para probar enumeración. No se utilizaron credenciales reales en reproducciones ni se hicieron llamadas de IA con datos internos.
- No se corrigió ninguno de los hallazgos en esta revisión. Los textos de Servicios e Información aprobados previamente siguen conservados.
