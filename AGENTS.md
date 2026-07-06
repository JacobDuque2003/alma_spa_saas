# AGENTS.md — Inventario y mapeo de agentes/skills/MCP para Alma Spa Backend

> Generado el 2026-07-06. Este archivo existe para que cualquier sesión futura (con o sin el contexto de esta conversación) sepa exactamente qué invocar explícitamente para cada tipo de tarea, en vez de depender de que la delegación automática elija bien por su cuenta.
>
> Alcance: `alma_spa_saas/` no tiene `.claude/agents/` ni `.claude/skills/` propios todavía — todo lo listado abajo es global (`~/.claude/agents/`, `~/.claude/skills/`) y por lo tanto compartido con el resto de proyectos NUVIO. Tampoco existe `.codegraph/` inicializado en este proyecto (ver nota al final).
>
> Criterio de esta lista: los ~230 agentes de `~/.claude/agents/` cubren dominios muy ajenos a este proyecto (marketing en plataformas chinas, GIS, videojuegos Unity/Unreal/Roblox/Godot, XR, blockchain, etc.). Para esos se listan solo nombres agrupados por dominio (sin descripción) — no aplican aquí y detallarlos añadiría ruido. Para todo lo que sí es potencialmente relevante a un backend Node/Express/Postgres multi-tenant con WhatsApp/Google Calendar, se da nombre + descripción completa.

---

## 1. Agentes relevantes para este proyecto (nombre + cuándo activarlo)

### Arquitectura / Backend
| Agente | Cuándo activarlo |
|---|---|
| **Backend Architect** | Diseño de sistema escalable, arquitectura de API, integraciones con terceros (Google Calendar OAuth2, WhatsApp Cloud API), microservicios. El agente por defecto para "cómo construyo X endpoint/integración". |
| **Software Architect** | Decisiones de patrones arquitectónicos más amplias (no solo backend) — DDD, límites de módulos. Útil si Fase 3+ empieza a necesitar separar el backend en servicios. |
| **Database Optimizer** | Diseño de esquema, estrategias de indexing, tuning de queries en Postgres. El agente para cada nueva migración de Fase 3 en adelante (citas, client_intake, treatment_history, client_plans, client_balances). |
| **Data Engineer** | Si Fase 6 (Reportes) crece a pipelines ETL reales o requiere un almacén separado para agregaciones pesadas. Prematuro para el volumen actual de Alma Spa (un tenant piloto). |
| **DevOps Automator** | Fase 8: pipeline de deploy a Railway, CI/CD, variables de entorno por ambiente. |
| **SRE (Site Reliability Engineer)** | Fase 8 en adelante: SLOs, error budgets, observabilidad una vez haya tráfico real. |
| **Git Workflow Master** | Estrategia de branching/commits cuando el repo crezca más allá de un solo desarrollador, o si se necesita limpiar historial. |

### Seguridad (usar ANTES de cada fase con datos sensibles, no solo al final)
| Agente | Cuándo activarlo |
|---|---|
| **Security Architect** | Diseño de la capa de seguridad de una fase nueva **antes** de programarla — ej. cómo cifrar `client_intake` (alergias/condiciones) en Fase 4, cómo aislar tokens OAuth de Google Calendar por tenant en Fase 3. Es el agente para la revisión de *diseño*, no de código ya escrito. |
| **Application Security Engineer (AppSec)** | Revisión de código ya escrito en endpoints con datos sensibles: SAST manual, revisión de autenticación/autorización, antes de mergear cualquier fase que toque `client_intake`, `client_balances`, tokens de Google, o mensajes de WhatsApp. |
| **Senior SecOps Engineer** | Escaneo de secretos filtrados (ya nos pasó dos veces con la password de Railway en este chat) + revisión de headers HTTP, cookies, CORS, rate limiting, CSP antes de exponer cualquier endpoint público (el flujo de reserva pública de Fase 3 es el caso obvio). |
| **Compliance Auditor** | Si en algún momento se necesita alinear con un estándar formal (SOC2/HIPAA-like) por exigencia de un cliente — no es el caso hoy, pero queda documentado por si Alma Spa pide certificación más adelante. |
| **Cloud Security Architect** | Solo si se migra de Railway a AWS/GCP/Azure con arquitectura zero-trust más compleja — no aplica mientras se use Railway simple. |
| **Incident Response Commander** | Si hay un incidente real en producción (Fase 8+) — no antes. |

### Revisión de código / testing (skills nativas de Claude Code, no agentes — ver sección 2)
| Agente | Cuándo activarlo |
|---|---|
| **Code Reviewer** | Segunda opinión independiente sobre un cambio ya hecho, cuando se quiere una revisión que no comparta el contexto de la sesión que escribió el código (evita sesgo de confirmación). Complementario a la skill `/code-review` (que sí corre en la sesión activa). |
| **Codebase Onboarding Engineer** | Cuando se retome este proyecto en una sesión nueva sin memoria previa y haga falta entender rápido qué existe y cómo encaja (alternativa a leer `MEMORY.md`/`CHANGELOG.md` a mano). |
| **Minimal Change Engineer** | Para cualquier fix puntual donde el riesgo es que el diff se infle con refactors no pedidos — útil como agente dedicado si se delega un bugfix aislado. |
| **API Tester** | Diseño de una suite de tests de contrato/integración más formal para los endpoints, más allá de los tests unitarios con Prisma mockeado que ya existen. |
| **Performance Benchmarker** | Si en Fase 6 (Reportes) las agregaciones sobre `appointments`/`treatment_history` empiezan a ser lentas con datos reales. |

### Datos / Reportes (Fase 6)
| Agente | Cuándo activarlo |
|---|---|
| **Analytics Reporter** | Diseñar qué métricas y agregaciones tienen sentido de negocio para el módulo de Reportes (ocupación por gabinete, ranking de servicios, tasa de no-show) antes de escribir las queries. |
| **Database Optimizer** | (repetido de arriba) — una vez definidas las métricas, el diseño de las queries/índices que las soportan eficientemente. |

### Explícitamente SIN agente dedicado (no inventar uno que no existe)
- **Integración con Google Calendar**: no hay agente especializado en Calendar. Usar **Backend Architect** para el diseño de la integración OAuth2 + sincronización bidireccional.
- **Bandeja de WhatsApp / CRM**: no hay agente especializado en WhatsApp Cloud API. Usar **Backend Architect** + reutilizar los patrones ya probados en `barbershop/src/services/whatsapp.js` y `barbershop/src/routes/webhooks.js` (HMAC, idempotencia por `waMessageId`), como ya indica `CLAUDE.md` del proyecto padre.

### Meta / orquestación (no son agentes de dominio, son mecanismos del harness)
| Agente | Cuándo activarlo |
|---|---|
| **Explore** | Búsqueda rápida de código de solo lectura ("¿dónde está X?", "¿qué archivos referencian Y?") cuando no conviene usar Grep/Glob directo por el tamaño de la búsqueda. |
| **Plan** | Diseño de plan de implementación cuando se quiere delegar esa fase a un sub-agente en vez de hacerlo inline (esta sesión ya lo hizo inline con `EnterPlanMode`, sin delegar). |
| **general-purpose** | Catch-all para tareas de investigación multi-paso que no calzan en ningún agente específico. |
| **Agents Orchestrator** | Solo si se decide coordinar múltiples agentes en paralelo para una fase grande (ej. Fase 3 completa: Backend Architect + Security Architect + Database Optimizer a la vez) — no ha hecho falta hasta ahora, cada fase se ha construido secuencialmente. |

### Resto del catálogo en `~/.claude/agents/` (no aplica a este proyecto — agrupado por dominio, sin descripción)
- **Marketing/redes sociales** (irrelevante — este es un backend, no una campaña): Ad Creative Strategist, Instagram Curator, TikTok/Douyin/Kuaishou/Xiaohongshu/Weibo/Zhihu/Bilibili Strategists, LinkedIn/Twitter/Reddit content agents, SEO/AEO/GEO specialists, Paid Media (PPC/Programmatic/Paid Social) agents, Email Marketing Strategist, Growth Hacker, Influencer/Podcast strategists, App Store Optimizer, China market/e-commerce specialists (Douyin, Taobao, Pinduoduo, JD, WeChat, Feishu), Government Digital Presales Consultant.
- **Ventas/CRM comercial**: Sales Coach/Engineer/Outreach/Deal Strategist/Pipeline Analyst/Account Strategist/Customer Success Manager/Discovery Coach/Proposal Strategist/Offer & Lead Gen Strategist.
- **Finanzas/legal/RRHH**: CFO, Tax Strategist, FP&A Analyst, Bookkeeper, Investment Researcher, M&A Integration Manager, Legal Billing/Client Intake/Document Review/Compliance Checker, HR Onboarding, Recruitment Specialist, Change Management Consultant, Organizational Psychologist.
- **Diseño visual/UX genérico** (ya cubierto por la skill `ui-ux-pro-max` para el frontend de Alma Spa, ver `CLAUDE.md` global): UI Designer, UX Architect/Researcher, Brand Guardian, Whimsy Injector, Visual Storyteller, Image Prompt Engineer.
- **Videojuegos / motores 3D**: todos los agentes Godot/Unity/Unreal/Roblox, Game Designer/Audio Engineer/Level Designer/Narrative Designer/Technical Artist.
- **GIS/geoespacial**: GIS Analyst, Geoprocessing/Spatial Data/Cartography/Drone/BIM/Web GIS/3D Scene specialists.
- **XR/spatial computing**: XR Immersive/Interface/Cockpit, visionOS, macOS Spatial/Metal.
- **Blockchain**: Solidity Smart Contract Engineer, Blockchain Security Auditor.
- **Otros dominios verticales**: Healthcare Customer Service/Marketing Compliance, Medical Billing, Hospitality/Real Estate/Retail Customer Service, Loan Officer Assistant, Study Abroad Advisor, Grant Writer, ESG/Sustainability Officer, Academic (Anthropologist/Geographer/Historian/Narratologist/Psychologist), Korean/French business navigators, Language Translator, Cultural Intelligence Strategist, IT Service Manager, IT/Jira Workflow Steward, Salesforce Architect, Feishu/WeChat Mini Program/CMS (Drupal/WordPress) developers, Embedded Firmware Engineer, Network Engineer, Terminal Integration Specialist, Voice AI Integration Engineer (transcripción de audio — no aplica a texto de WhatsApp).

---

## 2. Skills disponibles (globales — no hay skills propias del proyecto)

| Skill | Para qué sirve |
|---|---|
| **project-lifecycle** | Guía de las 10 etapas de un proyecto de software (de cero a mantenimiento). Útil para ubicar en qué etapa está Alma Spa y qué sigue. |
| **cyber-neo:cyber-neo** | Auditoría de seguridad integral: dependencias (SCA), código (SAST), secretos filtrados, fallas de auth/authz, criptografía, misconfiguraciones, supply chain, CI/CD. Cubre OWASP 2025 Top 10 y CWE Top 25. **El candidato natural para una auditoría completa antes de Fase 8**, o puntualmente antes de exponer el flujo de reserva pública. |
| **code-review** | Revisión del diff actual por corrección y simplificación, a distintos niveles de esfuerzo (low/medium/high/max/ultra). Es lo que ya se ha usado implícitamente en esta sesión al revisar cada fase antes de commitear. |
| **security-review** | Revisión de seguridad específica de los cambios pendientes en la rama actual — más acotado que cyber-neo, pensado para correr en cada PR/fase. |
| **simplify** | Revisión de reuse/simplificación/eficiencia del código ya cambiado (no busca bugs, solo calidad) y aplica los fixes. |
| **verify** | Corre la app y observa el comportamiento real para confirmar que un cambio hace lo que promete — el equivalente de lo que hicimos manualmente con curl contra Railway en Fase 1/2, formalizado como skill. |
| **run** | Levanta y controla la app para verla funcionando (busca primero una skill de proyecto para lanzarla; si no existe, usa patrones por tipo de proyecto). |
| **review** | Revisión de un Pull Request de GitHub (para el diff local se usa `code-review` en su lugar). |
| **init** | Inicializa un `CLAUDE.md` nuevo documentando la base de código — no aplica aquí, `CLAUDE.md` ya existe a nivel de `PROYECTOS/`. |
| **schedule** / **loop** | Crear tareas programadas recurrentes (cron) o correr un prompt en intervalo con auto-pacing — útil si se quiere, por ejemplo, una auditoría de seguridad periódica automática. |
| **fewer-permission-prompts** | Escanea las transcripciones por comandos de solo lectura repetidos y arma un allowlist en `.claude/settings.json` para reducir prompts de permiso — candidato a correr una vez el flujo de trabajo de este proyecto se estabilice (migrate/seed/test/curl se repiten mucho). |
| **claude-api** | Referencia de la API de Claude/Anthropic (modelos, pricing, streaming, tool use, MCP) — relevante si en algún momento Alma Spa necesita IA (ej. respuestas automáticas en el CRM, similar al agente de barbería). |
| **update-config** | Configurar hooks/permisos/env vars del harness vía `settings.json`. |
| **keybindings-help** | Personalizar atajos de teclado del propio Claude Code — no relacionado al proyecto. |
| **anthropic-skills:docx / pdf / pptx / xlsx** | Generar/editar documentos Word, PDF, presentaciones, Excel. El de **xlsx** es relevante para Fase 7 (Import/Export Excel) si se necesita generar un archivo de ejemplo o inspeccionar el formato esperado — pero la implementación del import/export en sí va en código (`exceljs`/`xlsx`), no delegada a esta skill. |
| **anthropic-skills:consolidate-memory** | Limpieza/deduplicación de la memoria persistente entre sesiones (memoria del asistente, no del proyecto). |
| **anthropic-skills:humanizer** | Reescribir texto para que no suene "generado por IA" — no aplica a código de backend. |
| **anthropic-skills:setup-cowork / skill-creator** | Configuración de Cowork / creación de skills nuevas — meta, no específico de Alma Spa. |

---

## 3. Servidores MCP conectados en este entorno

| Servidor | Qué expone |
|---|---|
| **codegraph** (`mcp__codegraph__*`) | Grafo de conocimiento del código parseado con tree-sitter: `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_context`, `codegraph_explore`, `codegraph_files`, `codegraph_status`. **No está inicializado en `alma_spa_saas/` todavía** (no existe `.codegraph/`) — para que valga la pena en las próximas fases (más archivos, más servicios), conviene correr `codegraph init -i` en algún momento. |
| **tokensave** (`mcp__tokensave__*`) | Otro servidor de grafo de código con propósito solapado a codegraph: búsqueda de símbolos, callers/callees, impacto, detección de código muerto, complejidad, cobertura de tests, blame/changelog por símbolo, y decenas de herramientas más de análisis estático. Como hay dos servidores con función parecida, **usar codegraph como el principal** (así lo indica `CLAUDE.md` global) y reservar tokensave para las herramientas que codegraph no tiene (ej. `tokensave_dead_code`, `tokensave_test_coverage`, `tokensave_unsafe_patterns`, `tokensave_god_class`). |
| **Claude_Preview** (`mcp__Claude_Preview__*`) | Levanta un dev server y lo controla desde el navegador: click, fill, eval JS, network, screenshot, snapshot de accesibilidad, resize responsive. Aplicable al `index.html` estático de la demo, no al backend (que no tiene UI). Útil si en Fase 3+ se construye un panel/frontend real para Alma Spa. |
| **computer-use** (`mcp__computer-use__*`) | Control del escritorio (clicks, teclado, screenshots) para apps nativas fuera del navegador. No relevante para este proyecto backend. |
| **headroom** (`mcp__headroom__*`) | Compresión/recuperación de contexto (`headroom_compress`, `headroom_retrieve`, `headroom_stats`) — herramienta de gestión de contexto del propio asistente, no del proyecto. |
| **mcp-registry** (`mcp__mcp-registry__*`) | Descubrimiento de conectores MCP disponibles para instalar (`list_connectors`, `search_mcp_registry`, `suggest_connectors`) — útil si se decide conectar un MCP oficial de WhatsApp/Google Calendar en vez de integrar la API REST directamente. |
| **scheduled-tasks** (`mcp__scheduled-tasks__*`) | Crear/listar/actualizar tareas programadas (cron) del asistente — mecanismo para automatizar, por ejemplo, una auditoría de seguridad recurrente. |
| **ccd_session** (`mcp__ccd_session__*`) | Funciones de la sesión actual del harness: marcar capítulos (`mark_chapter`), lanzar tareas en segundo plano como chips (`spawn_task`/`dismiss_task`), leer contexto de widgets. Meta, no específico del proyecto. |
| **ccd_session_mgmt** (`mcp__ccd_session_mgmt__*`) | Archivar/listar sesiones anteriores, buscar en transcripciones pasadas, enviar mensajes a otra sesión. Útil para recuperar contexto de una sesión anterior de Alma Spa si esta conversación se pierde. |
| **ccd_directory** (`mcp__ccd_directory__*`) | Solicitar acceso a un directorio del sistema — meta/permisos, no específico del proyecto. |
| **visualize** (`mcp__visualize__*`) | Renderizar diagramas/mockups/gráficos SVG o HTML inline en la conversación. Útil para diagramar el flujo de reserva pública o la arquitectura multi-tenant antes de programarla. |

---

## 4. Tabla resumen — qué invocar para cada tarea que queda por delante

| Tarea | Invocar explícitamente |
|---|---|
| Diseñar esquema/migraciones de una fase nueva | **Database Optimizer** (diseño de tablas/índices) + **Backend Architect** (cómo encaja en la API) |
| Endpoint con datos sensibles (client_intake, tokens Google, saldo, WhatsApp) | **Security Architect** (diseño, antes de programar) → **Application Security Engineer** (revisión del código ya escrito) |
| Integración Google Calendar | **Backend Architect** (no hay agente especializado en Calendar) |
| Bandeja de WhatsApp / CRM | **Backend Architect** + reutilizar patrones de `barbershop/src/services/whatsapp.js` (no hay agente especializado en WhatsApp) |
| Reportes/agregaciones (Fase 6) | **Analytics Reporter** (qué métricas importan) + **Database Optimizer** (cómo consultarlas eficiente) |
| Revisión de seguridad antes de cada fase con datos sensibles | Skill **`security-review`** (acotado a la rama actual) + agente **Application Security Engineer** para lectura manual profunda |
| Auditoría de seguridad completa (pre-Fase 8, o cuando se exponga algo público) | Skill **`cyber-neo`** |
| Revisión de calidad/simplificación de un diff | Skill **`code-review`** (o **`simplify`** si es solo limpieza, sin buscar bugs) |
| Segunda opinión independiente sobre código ya escrito | Agente **Code Reviewer** |
| Verificar que un cambio funciona de verdad (no solo tests) | Skill **`verify`** |
| Onboarding de una sesión nueva a este código | Agente **Codebase Onboarding Engineer**, o leer `MEMORY.md`/`CHANGELOG.md`/`TASKS.md` directamente |
| Deploy a Railway / CI-CD (Fase 8) | Agente **DevOps Automator** |
| Import/Export Excel (Fase 7) | Código directo (`exceljs`/`xlsx`) + skill **`anthropic-skills:xlsx`** solo para inspeccionar/generar archivos de referencia |

---

## Notas operativas

- **CodeGraph no está inicializado** en `alma_spa_saas/` (no existe `.codegraph/`). Si el proyecto crece mucho más en Fase 3+, vale la pena correr `codegraph init -i` para que `codegraph_context`/`codegraph_impact` empiecen a ser útiles aquí.
- No hay `.claude/agents/` ni `.claude/skills/` propios de este proyecto — todo lo de arriba es global y compartido con `barbershop/`, `nuvio-os/`, etc.
- Este archivo debe actualizarse si se instala un agente/skill/MCP nuevo relevante, o si cambia el mapeo recomendado para alguna fase.
