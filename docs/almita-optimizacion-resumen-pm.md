# Almita: resumen para el PM

Fecha: 2026-10-15, America/Guayaquil. Trabajo por fases 1-8, sobre el diagnostico aprobado `4b9b34c`.

No se extrajeron ni utilizaron claves de Railway o Anthropic en esta implementacion. Las pruebas usan dependencias simuladas. No se hicieron escrituras manuales en produccion ni pruebas que creen citas reales. La unica migracion es aditiva y queda para el arranque normal con `prisma migrate deploy`.

## 1. Tabla ANTES / DESPUES

| Indicador | Antes | Despues comprobado / limite de medicion |
| --- | --- | --- |
| Entrada de IA por mensaje | 9.611 tokens en una muestra inicial de Fase 0 | Cero en los recorridos deterministas ensayados; entrada de turnos con IA pendiente de observaciones reales |
| Tokens leidos de cache | Cache del proveedor sin habilitar | Habilitada; contadores separados. No hay tasa real posterior medida |
| Costo del primer mensaje | USD 0,010611 suponiendo 200 tokens de salida | En reglas: cero IA. En el escenario ilustrativo inferior: USD 0,012 con escritura de una hora |
| Costo de los siguientes | Sin descuento de cache | En reglas: cero IA. En el escenario ilustrativo: USD 0,0025 por acierto |
| Intent cache | No se usaba en el flujo activo | Activo para intenciones generales, por tenant, sin respuestas ni parametros personales. Hit rate disponible en metricas; aun sin muestra comercial |
| Mensajes sin IA | No medible historicamente: cero BotInteractionLog en siete dias | Reservas registradas de las pruebas cortas no llaman a IA. No extrapolar a un porcentaje de todo el trafico |

El escenario de cache usa 5.000 tokens estables, 1.000 dinamicos y 200 de salida. Es una comprobacion matematica de las tarifas, no un conteo del nuevo prompt real. Escritura de una hora: 5.000 x USD 2/millon; lectura: 5.000 x USD 0,10/millon; entrada normal: USD 1/millon; salida: USD 5/millon. [Precios de Anthropic](https://platform.claude.com/docs/en/about-claude/pricing).

El prefijo conserva reglas, personalidad, instrucciones completas y catalogo, sin nombre, fecha actual ni estado del cliente. Briefing, fichas relevantes, descripciones seleccionadas y resumen van despues. Haiku 4.5 exige 4.096 tokens cacheables. **No se certifico el conteo exacto posterior sin usar claves**: confirmar creaciones/lecturas en el ledger con trafico normal antes de declarar que se alcanza el minimo o un porcentaje de ahorro. No se agrego texto de relleno. [Cache de Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

El selector de TTL compara coste de escrituras y lecturas segun las ultimas 120 llamadas correctas del negocio. Reevalua cada diez minutos. Sin datos suficientes usa una hora: las pruebas con 30 llegadas separadas veinte minutos favorecen una hora; una rafaga corta favorece cinco minutos. Esto no equivale a haber medido esa cadencia en produccion.

## 2. Proyeccion mensual

30 conversaciones/dia x seis llamadas x 30 dias = 5.400 llamadas en la hipotesis de que todos los turnos usan IA.

- Antes: aproximadamente **USD 57,30/mes**, con 9.611 tokens de entrada y 200 de salida por llamada.
- Escenario de cache: aproximadamente **USD 13,79/mes**, usando los 5.000/1.000/200 tokens anteriores, una escritura inicial diaria y 5.370 lecturas al mes. No es una factura ni un ahorro real demostrado.
- Las reglas evitan llamadas adicionales, pero no hay base para prometer USD 10-15 mensuales. Cambios del prefijo, reintentos y pausas modifican el resultado.
- Meta, Railway e impuestos se calculan aparte. El presupuesto diario de IA usa USD 0,50 por defecto; permite `TENANT_DAILY_AI_CAP_USD` o `tenant.config.almitaDailyAiCapUsd`.

## 3. Fases, archivos y commits

| Fase | Implementacion y archivos principales | Commit |
| --- | --- | --- |
| 1 | `prisma/schema.prisma`, unica migracion `20261014230000_almita_usage_and_meta_category`, `aiClient.js`, `aiUsageService.js`, integracion en Centro y bot: prefijo cacheable, limite 350, ledger de intentos, cache creation/read y costos separados | `345a50c` |
| 2 | `aiClient.js`, `almitaCenterService.js`, `whatsappBot/state.js`, `conversationSummary.js`: catalogo compacto, descripciones del servicio seleccionado, ocho mensajes y resumen determinista de 60 palabras | `5219b6c` |
| 3 | `whatsappBot/intentCache.js`, `publicDataCache.js`, Centro y bot: intenciones generales sin respuestas compartidas; TTL de configuracion editorial e invalidacion al editar. Fichas y ejemplos mantienen lectura vigente | `432a6f6` |
| 4 | `textNormalize.js`, `synonyms.json`, Centro, bot y `utils/advisorRequest.js`: normalizacion comun, faltas frecuentes y sinonimos editables; matching existente conservador | `e51bca0` |
| 5 | `customerContext.js`, `state.js`, bot y cliente IA: limpiar ramas al volver al menu, primer nombre y ultimo servicio realizado, sin notas clinicas | `b7e2136` |
| 6 | `replySafety.js`, `simulationReadOnly.js`, Centro y cliente IA: agenda en lectura, JSON estructurado, formato WhatsApp y proteccion contra acciones ficticias | `d75e246` |
| 7 | `aiBudget.js`, cliente IA y bot: presupuesto diario por negocio; sin Redis | `1ccfc6f` |
| 8 | `turnTransport.js`, bot, webhook y pruebas: un envio por turno, paginacion segura, cierre corto, perfil combinado, deduplicacion comprobada y categoria de Meta. Incluye correcciones finales de reserva atomica de presupuesto, invalidacion concurrente y entrega de advertencias | SHA entregado en el mensaje final; es el commit que contiene este informe |

La reserva de presupuesto usa `reservedCostUsd` en la **misma unica migracion** y bloqueo transaccional PostgreSQL por tenant. Se reserva una estimacion conservadora antes de llamar; el consumo conocido sustituye la reserva. Un timeout conserva la reserva: no se considera gratis. No se mantienen transacciones abiertas durante la llamada al proveedor.

El ledger no incluye mensajes, nombres, telefonos, identificadores de clientes o conversaciones. Los logs existentes del bot dejan sus cuerpos de mensajes en NULL. No se cambiaron tipos, nombres de columnas existentes, auth, permisos ni reglas de aislamiento. No se uso `--accept-data-loss`.

## 4. Redis

No agregado ni creado en Railway. Para el piloto, caches acotadas en memoria y un presupuesto compartido en PostgreSQL evitan otra dependencia. La reserva presupuestaria atomica no depende de Redis. El rate limit existente sigue siendo local al proceso, no global entre replicas; no se afirma lo contrario.

El catalogo y el horario operativo mantienen lectura fresca para evitar precios o dias obsoletos sin intervenir otros modulos. Fichas PUBLIC y ejemplos tambien mantienen lectura vigente para evitar respuestas desde una version retirada en otra replica. El cache de configuracion editorial es local, se invalida en sus escrituras y descarta cargas anteriores a la invalidacion. Cambios editoriales entre replicas pueden tardar su TTL, pero no se cachean los permisos PUBLIC de fichas o ejemplos.

## 5. Fichas sin coincidencia en el catalogo

Sin borrar ni modificar fichas, el diagnostico encontro once PUBLIC sin coincidencia exacta activa:

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

El bot explica la ficha y ofrece un asesor; no reserva otro tratamiento en su lugar. Las coincidencias dudosas no seleccionan automaticamente un servicio. Un nombre distinto puede ser una variante editorial y requiere revision humana, no un duplicado nuevo automatico.

Ubicacion y politicas generales siguen siendo informacion publica aunque no sean servicios. Los precios y duraciones reservables provienen del catalogo. Se conservaron lunes a viernes y los valores actuales; el diagnostico de Masaje deportivo encontro USD 30 y 105 minutos. No usar los USD 25/60 minutos ilustrativos del prompt como datos del negocio.

## 6. Plantillas de Meta

En la lectura de Fase 0: **cero plantillas registradas en 30 dias** y ninguna `bookingTemplate` / `confirmationTemplate` configurada para este negocio.

Se conservaron las rutas existentes: aviso de reserva web en `bookingNotifier.js` y recordatorio manual de cita pendiente en `whatsappInboxService.sendReminder`. No se editaron textos aprobados ni se activaron marketing, encuestas o envios automaticos. No se encontro un programador de recordatorios diarios que estuviera enviando varios por cita.

No se implemento un nuevo programador del dia anterior ni se garantiza una sola pulsacion manual por cita: no hay evidencia suficiente para calcular plantillas por reserva y ese enlace no se invento usando otros campos. Los botones de las plantillas aprobadas siguen siendo los existentes, no se cambiaron a Confirmo/Reprogramar sin aprobacion.

La nueva categoria nullable admite service/utility/marketing/authentication y se completa desde metadata del proveedor cuando llega. Texto del bot se registra como service. Una plantilla sin categoria acreditada queda sin clasificar, no se presume utility. Categoria no equivale a precio, facturabilidad o elegibilidad gratuita.

## 7. Consultando disponibilidad

La causa era que el simulador llamaba al modelo sin ejecutar una consulta de agenda. Ahora puede inferir servicio y fecha desde el turno y el historial, consultar disponibilidad publica real en modo lectura y devolver horarios en el mismo turno. Busca dias siguientes si no hay espacios; no crea, cancela ni reprograma citas.

En WhatsApp se conserva el motor de disponibilidad existente, se saltan pasos redundantes y se ofrecen proximos espacios en la misma respuesta cuando corresponde. Las fechas siguen calculadas en JavaScript, no por el modelo.

Las respuestas de IA de cualquier intencion se filtran si afirman reserva, cancelacion, reprogramacion o pago no ejecutados. La confirmacion real sigue exigiendo un `appointment.id`. Las advertencias largas se paginan sin descartarlas y bloquean el avance hasta envio correcto, incluso si falla la primera entrega.

## 8. Tests

Suite completa final del backend: **664 tests aprobados, cero fallos y cero omitidos**, antes del commit final. Evidencia local: `tmp/almita-final-tests.log`. No se incluye tmp en Git.

Se agregaron 31 casos y se reemplazaron once casos del cache antiguo que guardaba respuestas: incremento neto de veinte frente a los 644 de Fase 0. Se actualizaron expectativas de mensajes unidos y horarios directos; no se eliminaron los guards de citas. Cada fase avanzo tras suite aprobada. No hubo un mismo caso fallando dos ejecuciones consecutivas tras su correccion.

Se cubren, entre otros: escritura/lectura de cache y tarifas, contexto sin datos privados, invalidacion concurrente, presupuesto reservado bajo bloqueo, horarios reales en simulacion, perfil combinado, advertencias pendientes y fallo del primer envio, reserva normal en cuatro respuestas, atajo en dos, agradecimiento sin envio y webhook duplicado concurrente con una sola invocacion del bot.

`prisma validate` y generacion local del cliente aprobados. Las pruebas no sustituyen una validacion de factura, una conversacion real de WhatsApp ni una prueba de bloqueo contra PostgreSQL real; no se uso produccion para esos ensayos.

## 9. Pasos para Jacob en el simulador

1. Entrar con soporte al Centro de Almita y reiniciar la conversacion.
2. Probar `ola`, `q ora abren`, `cuanto sale la limpiesa facial`.
3. Probar `kiero un masaje relajnte el biernes`, despues `de que trata ese servicio` y `que fechas tienes disponibles`.
4. Probar `el sabado`: debe respetar lunes a viernes, salvo que Gianella cambie la configuracion desde el panel.
5. Probar `mejor el lunes`, `a las 4` y `siii confirmooo`. No debe afirmar ni crear una cita real en el simulador.
6. Reiniciar y pedir `quiero maderoterapia`: ficha explicativa mas asesor, nunca sustituir por un masaje.
7. Probar `quiero mover mi turno`, `ya no puedo ir`, `mis citas` y `prefiero hablar con un humano`. El simulador no modifica citas, no conoce una identidad real de cliente y no transfiere la conversacion; esas acciones reales requieren el canal de prueba de WhatsApp.
8. Revisar diagnostico por turno y resumen: ahora el registro de consumo incluye simulaciones y errores conocidos. Un error sin usage queda desconocido, no como gasto cero confirmado.

Las reservas de cuatro/dos mensajes se comprobaron con dependencias aisladas del bot, no se crearon desde el simulador. Para probar acciones reales despues, usar el numero de prueba y una agenda de prueba, con consentimiento antes de crear una cita.

## 10. Pendientes y limites

- Conteo exacto del nuevo prefijo y confirmacion de que sigue por encima de 4.096 tokens: pendiente de los logs de uso normal; la prohibicion de claves se respeto. Tampoco hay hit rate comercial o ahorro real demostrado.
- Los textos oficiales no se escribieron en la base. Jacob los pegara en personalidad, instrucciones y briefing. No se encontro una semilla equivalente para sustituir. Quitar del ejemplo los precios/duraciones que no coinciden con el catalogo.
- No se cachearon precios, horarios, fichas PUBLIC o ejemplos con TTL: se priorizo lectura autoritativa fresca y revocacion de contenido. Solo la configuracion editorial usa ese cache local.
- El rate limit global y la actualizacion editorial inmediata entre multiples replicas necesitan coordinacion futura; no se agrego Redis.
- La memoria solo recibe campos seleccionados; el filtro de texto del historial no es una garantia universal para cualquier dato sensible que alguien escriba espontaneamente. No se consultan anamnesis ni notas clinicas para el modelo.
- El simulador consulta disponibilidad, pero no es una copia de todas las acciones del canal real. Reservas, cancelaciones y cambios efectivos siguen fuera de su alcance.
- Recordatorio automatico del dia anterior, nueva plantilla con botones y metrica directa por cita: pendientes. No se activaron envios facturables sin configuracion.
- La migracion y el despliegue se ejecutan por el circuito normal autorizado; su estado final y SHA se informan en el chat, no se asumen a partir de los tests.

## 11. Mensajes de Meta ANTES / DESPUES

Antes, ventana de Fase 0 terminada el 14 de octubre: 14 salidas del bot en dos conversaciones; promedio siete y maximo diez. Eran cuatro read y diez delivered. No habia un vinculo directo que permita medir mensajes por reserva completada. No extrapolar dos conversaciones como estadistica comercial.

Despues, pruebas aisladas: clienta registrada, terapeuta unica disponible y datos existentes, **cuatro respuestas** en flujo normal y **dos** cuando envia servicio, dia y hora juntos. Cada turno produce un solo envio. Una persona nueva que deba aportar datos, una preferencia de terapeuta, una ambiguedad o advertencias largas pueden requerir mas pasos; no se garantiza cuatro para todo caso.

No se envia otra respuesta al agradecimiento tras el cierre y las reacciones no generan respuestas. Se comprobo que reentregas secuenciales y simultaneas del mismo identificador de Meta no invocan dos veces al bot. No se agruparon mensajes distintos ni se promete eliminar toda repeticion con identificadores diferentes.

Presupuesto ilustrativo con 30 conversaciones diarias durante 30 dias y el supuesto de 1.000 mensajes service gratuitos por numero:

| Escenario | Salidas mensuales | Dentro de 1.000 | Potencialmente cobrables |
| --- | ---: | ---: | ---: |
| Hipotesis anterior: seis por conversacion | 5.400 | 1.000 | 4.400 |
| Flujo probado: cuatro por reserva | 3.600 | 1.000 | 2.600 |
| Atajo probado: dos por reserva | 1.800 | 1.000 | 800 |

Estos escenarios suponen una reserva por conversacion y ninguna plantilla. No son conteos posteriores de produccion ni una factura. El diagnostico encontro informacion publica no uniforme sobre el cambio de octubre: confirmar tarjeta y condiciones de la cuenta; no afirmar que cada plantilla cobra siempre. [Pagina de Meta](https://whatsappbusiness.com/products/platform-pricing/), [aviso de Gupshup de octubre](https://support.gupshup.io/hc/en-us/articles/62362400519705-WhatsApp-Service-Messages-Pricing-w-e-f-01-Oct-2026).

Plantillas por cita: sin muestra medible; cero registradas en la lectura original y ninguna nueva activada. La categoria persistida permite conteos por dia/mes usando los estados delivered/read, pero no demuestra por si sola el importe facturado.

## 12. Mensajes fragmentados

**Pospuesto por instruccion expresa.** No hay espera nueva de cinco a ocho segundos ni batching de mensajes entrantes. La union implementada es de las respuestas internas de un mismo turno, no de mensajes distintos de la clienta.

Se conserva y prueba la deduplicacion durable por `waMessageId` y conflicto unico. Esto evita dobles invocaciones, pero no promete recuperacion integral de un trabajo interrumpido entre guardar el inbound y ejecutar el bot; para eso haria falta una cola durable y un diseno de recuperacion separado.
