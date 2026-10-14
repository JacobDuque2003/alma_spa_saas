# Almita: diagnostico de costos y flujos (Fase 0)

Fecha: 2026-10-14. Zona horaria: America/Guayaquil.
Base de codigo: e7ab363. Alcance: diagnostico, sin cambios de aplicacion ni escrituras en produccion.

Se consultaron agregados del negocio seleccionado y configuracion operativa. Para el conteo externo, Jacob autorizo usar la clave de Railway exclusivamente en memoria y enviar a Anthropic instrucciones, catalogo publico y un mensaje ficticio. No se enviaron datos de clientes ni se generaron respuestas. Este documento no incluye claves, instrucciones privadas completas ni identificadores de clientes.

## 1. Tabla ANTES / DESPUES

Muestra reproducible: `quiero un masaje relajante`, sin historial, con la configuracion actual y `claude-haiku-4-5-20251001`. Conteo del proveedor: **9.611 tokens de entrada**. No es el promedio historico de todas las conversaciones.

| Indicador | Antes: estado actual | Despues |
| --- | --- | --- |
| Tokens de entrada por mensaje | 9.611 en la muestra inicial | Pendiente de implementacion y medicion |
| Tokens leidos de cache de prompt | Cache de Anthropic no habilitada en el codigo | Pendiente |
| Costo de entrada del primer mensaje | USD 0,009611, sin salida | Pendiente |
| Costo total con 200 tokens de salida supuestos | USD 0,010611 | Pendiente |
| Costo de mensajes siguientes | No hay descuento de cache; depende del contexto e historial | Pendiente |
| Aciertos de intentCache | Cache local fuera del flujo activo; no hay tasa instrumentada | Pendiente |
| Porcentaje resuelto sin IA | No medible con los registros disponibles | Pendiente |

Desglose por ablacion: se quita un bloque del prompt completo y se resta el conteo resultante. Son aportes marginales, no una particion exacta: las etiquetas y fronteras de tokenizacion impiden sumarlos como si fueran independientes.

| Bloque | Caracteres | Aporte marginal en tokens |
| --- | ---: | ---: |
| Personalidad | 2.068 | 631 |
| Instrucciones permanentes | 10.449 | 3.047 |
| Briefing diario | 1.232 | 363 |
| Catalogo completo de 26 servicios, con descripciones y formato | 9.338 | 2.818 |
| Contenido de tres fichas seleccionadas | 797 | 235 |
| Historial de esta muestra | 0 | 0 |
| Mensaje ficticio actual | 26 | 7 |

El sistema tiene 31.866 caracteres; 7.982 corresponden a otras reglas y etiquetas fuera de los bloques anteriores. Una prueba separada con las reglas base, sin catalogo ni configuracion personalizada, conto 2.405 tokens incluyendo su envoltura y el mensaje actual. No debe sumarse al desglose como residuo exacto.

Correcciones al diagnostico inicial del pedido:

- No se envian todas las fichas: ya hay seleccion de hasta seis fichas PUBLIC activas y cuatro ejemplos. El catalogo completo con descripciones si se envia.
- Para esta consulta se seleccionaron Limpieza facial profunda, Maderoterapia y Paquete alivio profundo: la seleccion existe, pero su relevancia necesita mejorar.
- `aiClient.js` admite hasta 16 mensajes de historial y 1.024 tokens de salida. No se impuso todavia el limite propuesto de ocho mensajes o 350 tokens.
- `intentCache.js` conserva una implementacion antigua que puede guardar respuestas, pero el bot activo no la utiliza. No reactivarla sin sustituirla por intenciones y parametros seguros, por negocio y sin datos personales.
- El 0% del panel de Anthropic corresponde al cache del proveedor, no al cache local de intenciones. Son mecanismos distintos. El cliente actual no envia `cache_control` ni contabiliza creacion/lectura de cache.

Ultimos siete dias: **cero registros en BotInteractionLog**. No es posible calcular llamadas evitables, promedios de tokens o porcentaje sin IA con ese conjunto. El simulador llama al proveedor, pero no persiste sus consumos en ese registro; cero registros no significa cero consumo ni saldo disponible.

## 2. Proyeccion mensual de IA

Escenario, no factura: 30 conversaciones/dia x 6 llamadas de IA x 30 dias = 5.400 llamadas. Con 9.611 tokens de entrada y 200 de salida por llamada, el total seria **USD 57,30/mes**, solo IA. No incluye Railway, Meta, impuestos, reintentos o crecimiento del historial. Si una parte se resuelve sin IA, esta hipotesis sobreestima las llamadas.

Haiku 4.5: entrada USD 1/millon y salida USD 5/millon; escritura de cache de cinco minutos USD 1,25/millon, de una hora USD 2/millon y lectura USD 0,10/millon. [Tarifas de Anthropic](https://platform.claude.com/docs/en/about-claude/pricing).

El prefijo cacheable de Haiku 4.5 debe alcanzar 4.096 tokens. El cache de cinco minutos se renueva al leerlo; el de una hora cubre pausas mas largas a mayor costo inicial. Con 30 conversaciones distribuidas en diez horas, una hora es un candidato razonable, no un ahorro demostrado. Medir tambien los intervalos reales entre llamadas y cuantos turnos evitara el motor determinista. No alargar artificialmente un prompt compacto para alcanzar el minimo. [Cache de Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

La meta USD 10-15/mes queda como objetivo de evaluacion, no como resultado conseguido. El conteo autorizado utilizo el endpoint gratuito de conteo, no generacion de respuestas. [Conteo de tokens](https://platform.claude.com/docs/en/build-with-claude/token-counting).

## 3. Fases, archivos y commits

| Fase | Trabajo realizado | Archivos modificados | Commit |
| --- | --- | --- | --- |
| 0 | Inspeccion del flujo, conteo externo autorizado, agregados de solo lectura y suite completa | Este informe | SHA entregado en el cierre de la tarea |
| 1 | Detectado requisito de migracion; se detuvo antes de modificar el esquema | Ninguno | Pendiente de autorizacion |
| 2 | Diagnosticados catalogo extenso, seleccion mejorable e historial | Ninguno | Pendiente |
| 3 | Diagnosticados cache local inactivo y falta de metricas completas | Ninguno | Pendiente |
| 4 | Identificados matching y normalizaciones para futura unificacion | Ninguno | Pendiente |
| 5 | Revisado alcance de memoria; sin envio de datos de salud | Ninguno | Pendiente |
| 6 | Identificado simulador sin ejecucion de disponibilidad y fichas sin servicio activo | Ninguno | Pendiente |
| 7 | Evaluacion preliminar; no se creo Redis | Ninguno | Pendiente |
| 8 | Medidos mensajes existentes y revisadas rutas con varios envios | Ninguno | Pendiente |

No se hizo push ni deploy de cambios de aplicacion en esta fase. Los archivos ajenos al diagnostico quedan intactos.

## 4. Redis

No agregado ni creado en Railway. Dos conversaciones observadas y ausencia de registros de IA recientes no justifican todavia una dependencia adicional solo por volumen. Una cache local puede bastar para datos estables en una instancia, pero no resuelve limites de gasto o de trafico compartidos entre replicas y reinicios. Esa necesidad debe evaluarse separadamente; la decision definitiva corresponde a la Fase 7. Si se elige Redis, Jacob crea el servicio y se exige fallback seguro.

## 5. Fichas y catalogo

Hay 26 servicios canonicos activos visibles a clientes. Estas **11 fichas PUBLIC no tienen coincidencia exacta con un servicio activo del catalogo**:

- Limpieza facial kids
- Limpieza facial profunda
- Hidratacion de labios
- Terapia de sonido
- Paquete detox y reduccion consciente
- Paquete detox facial
- Paquete alivio profundo
- Bano de cajon
- Maderoterapia
- Envoltura corporal con vendas frias
- Exfoliacion corporal

Esto es una discrepancia de nombres o de oferta reservable, no prueba de que el contenido sea falso. Revisar variantes como Limpieza facial profunda frente a Limpieza facial antes de crear duplicados. No se borraron fichas ni se cambio su audiencia. La futura seleccion debe impedir que una ficha sin servicio reservable se convierta en una reserva de otro tratamiento.

La ubicacion oficial y las politicas generales son excepciones necesarias a la regla de una ficha por servicio: pueden ser publicas sin ser tratamientos. No deben ocultarse por no tener servicio asociado.

Los siete servicios de masajes consultados, incluido Masaje deportivo, tienen **USD 30 y 105 minutos** en el catalogo actual. El ejemplo USD 25/60 minutos del nuevo prompt no representa ese precio: quitarlo o sustituirlo por referencias sin cifras antes de pegar el texto. No se cambiaron precios ni horarios; se mantiene lunes a viernes hasta confirmar con Gianella.

No se encontraron textos de personalidad, instrucciones y briefing por defecto para reemplazar en semillas revisadas. Jacob los pegara en el panel. Los nuevos textos no se cargaron en produccion. El limite editorial de 60 palabras no debe eliminar advertencias de seguridad necesarias.

## 6. Plantillas de Meta

Ultimos 30 dias: **cero mensajes registrados de tipo template** para el negocio seleccionado. No figuran nombres configurados para `bookingTemplate` o `confirmationTemplate` en su configuracion consultada.

Rutas existentes:

- `src/services/bookingNotifier.js`: aviso tras una reserva publica web; envia una plantilla si existe conexion, plantilla y URL publica configuradas. Incluye enlace de confirmacion de la primera cita.
- `src/services/whatsappInboxService.js`, `sendReminder`: recordatorio manual desde la bandeja para la proxima cita pendiente futura. Siempre usa una plantilla preaprobada con enlace de confirmacion; no lleva actualmente botones de respuesta Confirmo/Reprogramar.

No se identifico un programador automatico de recordatorios diarios en las rutas revisadas. No hay evidencia para afirmar que se enviaban varios recordatorios por cita. No se modificaron plantillas aprobadas ni se activaron envios.

Sobre precios: la pagina publica de Meta todavia describe respuestas de servicio gratuitas en 24 horas. Gupshup publica un cambio desde octubre de 2026, con 1.000 mensajes de servicio gratuitos y cobro posterior, pero conserva excepciones como entradas gratuitas de 72 horas. La tarjeta fechada de Meta no estuvo accesible. Por tanto, el presupuesto siguiente es **condicional**, sujeto a la tarifa y condiciones de la cuenta de Alma Spa; no afirmar que toda plantilla siempre cobra. [Pagina de Meta](https://whatsappbusiness.com/products/platform-pricing/), [aviso de Gupshup](https://support.gupshup.io/hc/en-us/articles/62362400519705-WhatsApp-Service-Messages-Pricing-w-e-f-01-Oct-2026).

## 7. Consultando disponibilidad

Causa encontrada: `almitaCenterService.simulate()` obtiene una respuesta de `aiClient.chat`, pero no ejecuta la consulta de disponibilidad ni el flujo de reserva del bot. Un texto de la IA que anuncia la consulta no produce horarios por si solo. El bot de WhatsApp si tiene rutas que consultan disponibilidad; no confundir ambos recorridos.

Correccion pendiente en Fase 6: simulacion con estado y consultas reales de solo lectura, seguida del resultado en el mismo turno. Nunca crear, cancelar o reprogramar citas desde el simulador. Probar ausencia de promesas de acciones sin resultado y conservar el guard de `appointment.id` para el canal real.

El pedido actual tambien requiere validar afirmaciones de reserva, cancelacion, reprogramacion y pago en todas las intenciones. No se declaran corregidas hasta implementarlas y probarlas.

## 8. Tests

Suite completa del backend: **644 tests, 644 aprobados, cero fallos, cero omitidos**. Tests nuevos: cero; esta fase no cambia comportamiento. Evidencia local: `tmp/almita-fase0-tests.log`, sin incluir ese directorio en el commit.

El conteo externo termino sin generar respuestas. No se ejecutaron reservas reales, cambios de citas, mensajes de WhatsApp o escrituras de base de datos durante el diagnostico. Las pruebas de las fases siguientes siguen pendientes.

## 9. Verificacion en el simulador

Estas son pruebas propuestas para las fases de implementacion, no resultados aprobados en esta fase. Usar datos ficticios. El simulador no debe crear citas ni enviar mensajes.

1. Reiniciar conversacion. Enviar `ola`, luego `q ora abren`: verificar saludo y horario desde configuracion, con ruta sin IA cuando se implemente.
2. Enviar `cuanto sale la limpiesa facial`: identificar un unico servicio o aclarar ambiguedad; precio y duracion del catalogo.
3. Enviar `kiero un masaje relajnte el biernes`: entender servicio y fecha sin reservar otro masaje por similitud.
4. Continuar `de que trata ese servicio`: mantener el servicio elegido y usar su descripcion canonica.
5. Enviar `que fechas tienes disponibles`: ofrecer resultados de consulta, no solamente anunciar que va a consultar.
6. Enviar `el sabado`: rechazarlo mientras la configuracion mantenga lunes a viernes y ofrecer dias validos.
7. Enviar `mejor el lunes` y `a las 4`: usar el ultimo paso y horarios reales; aclarar si falta contexto.
8. Probar `el de piedras calientes` en una seleccion de servicios: mantener contexto y pedir aclaracion si procede.
9. Probar `siii confirmooo` solo en un paso de confirmacion: nunca afirmar una reserva real en el simulador.
10. Probar `quiero mover mi turno`, `ya no puedo ir` y `mis citas` con identidad ficticia: no inventar citas ni modificar produccion.
11. Probar `prefiero hablar con un humano`: no anunciar una transferencia real en simulacion.
12. Reiniciar y pedir `maderoterapia`: no reservar automaticamente un masaje u otro tratamiento del catalogo.

No realizar pruebas de agrupacion de fragmentos en este simulador hasta disponer de un recorrido que reproduzca el webhook; usar un ambiente de prueba aislado para ese caso.

## 10. Pendientes y punto de autorizacion

**GATE antes de Fase 1:** `BotInteractionLog` no tiene campos separados de creacion y lectura de cache. Sus campos actuales de prompt, salida y total no bastan para auditar costos de cache. Ademas exige una conversacion de WhatsApp y un identificador de cliente, por lo que no se deben fabricar registros de clientes para contabilizar simulaciones.

Se solicita permiso para modificar `schema.prisma` y crear una migracion en el repositorio que contemple los contadores y un registro de uso apto para simulaciones, reintentos y errores. El diseno debe mantener compatibilidad con los registros actuales, aislamiento por negocio y no guardar contenido personal innecesario. **La autorizacion propuesta no incluye aplicar la migracion en produccion ni escribir en su base.**

Fase 8 tambien requerira una decision de esquema si se quieren persistir categorias de cobro y metadata de facturacion: `WhatsAppMessage` distingue texto/plantilla, pero no registra categoria utility/marketing/authentication ni elegibilidad gratuita. No reutilizar campos ajenos para evadir el GATE.

Quedan pendientes las Fases 1-8, metricas posteriores, costos de respuestas generadas, tasa real de cache y mejora comprobada de comprension. Tampoco se cambiaron auth, permisos, agenda, clientes, equipo o respaldos. La verificacion comercial de Meta y migracion del numero real siguen fuera de esta tarea.

## 11. Mensajes de Meta ANTES / DESPUES

Ventana de 30 dias consultada: desde 2026-09-14 17:40:08 hasta 2026-10-14 17:40:08, America/Guayaquil. Se contaron salidas con `senderType=bot` registradas para el negocio seleccionado, no todos los mensajes de agentes o del sistema.

| Medida | Antes observado | Despues |
| --- | --- | --- |
| Mensajes del bot en 30 dias | 14: cuatro read y diez delivered | Pendiente |
| Conversaciones con salidas del bot | 2 | Pendiente |
| Promedio por conversacion | 7 | Pendiente |
| Maximo por conversacion | 10 | Pendiente |
| Mensajes por reserva completada | No medible: sin vinculo directo mensaje-reserva ni confirmaciones encontradas en la muestra | Pendiente |
| Turnos inferidos con multiples salidas consecutivas | 0 observados; maximo una salida | Pendiente |
| Plantillas en 30 dias | 0 registradas | Pendiente |
| Mensajes del bot en octubre hasta el corte | 10 delivered/read | Pendiente |

Una conversacion de bandeja puede acumular varias sesiones o reservas; este promedio no es una medida de mensajes por reserva. Los turnos se infirieron agrupando salidas hasta el siguiente mensaje entrante, no mediante un identificador explicito. Los mensajes del numero de prueba no prueban gasto comercial de Meta.

Aunque la muestra no contiene envios dobles, el codigo tiene rutas que pueden hacerlo: detalle de servicio mas invitacion separada, errores mas menu/catalogo, catalogos largos divididos y confirmacion mas indicaciones. Revisarlos en Fase 8. No truncar catalogos o advertencias necesarias para aparentar un unico mensaje; usar selecciones paginadas cuando el canal lo exija.

Escenarios mensuales bajo el supuesto de 1.000 mensajes de servicio gratuitos por numero, sin excepciones adicionales ni plantillas. **Objetivos, no resultados implementados**:

| Escenario: 30 conversaciones/dia, 30 dias | Salidas/mes | Dentro de 1.000 | Potencialmente facturables |
| --- | ---: | ---: | ---: |
| Hipotesis inicial: seis salidas por conversacion | 5.400 | 1.000 | 4.400 |
| Objetivo: cuatro salidas por reserva | 3.600 | 1.000 | 2.600 |
| Atajo objetivo: dos salidas por reserva | 1.800 | 1.000 | 800 |

Los objetivos de reserva suponen una reserva por conversacion. No extrapolar el promedio de dos conversaciones como rendimiento comercial. No hay tarifa monetaria de Ecuador verificada para multiplicar estos valores. Plantillas por cita no medibles con la muestra: se observaron cero en total y no se activo ni elimino ninguna.

## 12. Agrupacion de mensajes fragmentados

No implementada; no hay nueva espera de cinco a ocho segundos. Un temporizador solo en memoria puede perder trabajo en reinicios o duplicar respuestas entre replicas. La Fase 8 debe preservar cada mensaje entrante, deduplicar por identificador de Meta y coordinar procesamiento por conversacion con recuperacion tras fallos, antes de prometer agrupacion segura. Revisar persistencia y despliegue existentes; si requiere campos o cola nuevos, reportar el GATE correspondiente. No bloquear la respuesta de recepcion del webhook durante la espera.
