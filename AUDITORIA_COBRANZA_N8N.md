# Auditoría: Cobranza + Pagos/Cierre Diario para integración con n8n

**Fecha:** 2026-08-25
**Alcance:** auditoría de solo lectura, sin cambios de código ni de base de datos. Objetivo: dejar mapeado dónde vive cada dato antes de diseñar la automatización n8n descrita en la conversación (cruzar cobranza vs pagos, detectar quién pagó/no pagó, mora nueva, promesas incumplidas, y generar gestión diaria).

Repos revisados (los 9 en el scope de la sesión): `cobrazna-`, `laroca-suite`, `analisis-cierre`, `cotizador-laroca`, `fintrack-apps-script`, `la-roca-crm`, `laroca-rrhh`, `larocaarqueos`, `proveedor`.

---

## 1. Arquitectura actual

No son dos apps, son **tres** relevantes para este proyecto (más un cuarto sistema, el CRM, que ya tiene el canal de salida a WhatsApp que faltaría):

| App | Repo | Rol en el flujo de cobranza |
|---|---|---|
| **Cobranza** | `cobrazna-` (copia servida también dentro de `laroca-suite/cobranza/`) | Cartera de clientes, créditos, cuotas, mora, promesas, gestión (notas/visitas/pagos manuales), chat IA |
| **Arqueos** | `larocaarqueos` | Cierre de caja diario por sucursal: la cajera sube PDF+Excel del ERP, Claude extrae cobros/ventas/gastos/depósitos, motor de reglas determinista detecta fraude/inconsistencias |
| **Análisis de Cierre** | `analisis-cierre` | Dashboard que YA cruza `arqueos` (pagos reales) contra `carteras`/`cierre_proyeccion` (cobranza) — es el prototipo manual de exactamente lo que n8n automatizaría |
| **CRM** | `la-roca-crm` | Clientes/leads/gestiones de venta + backend WhatsApp (Twilio) ya operativo — ojo: es una cartera de **prospectos de venta**, no la misma cartera de créditos de cobranza, pero es el canal WhatsApp reutilizable |
| **Suite** | `laroca-suite` | Hub de login (SSO vía RRHH) que enlaza/embebe las apps de arriba |
| **RRHH** | `laroca-rrhh` | Fuente de verdad de usuarios/empleados y roles (`accesos_apps`) — todas las demás apps delegan login aquí |

**No relevantes para este proyecto** (confirmado en la exploración, no auditados a fondo): `cotizador-laroca` (cotizador de precios de productos), `fintrack-apps-script` (Google Apps Script de finanzas/proveedores, corre dentro de un Sheet), `proveedor` (repo con un solo `index.html` que resultó ser una **copia vieja de la app de Cobranza** — `<title>La Roca — Cobranza</title>`, guardado desde `laroca_cobranza_14.html` — parece un repo mal nombrado/residual, no una app de proveedores real. Vale la pena que Jorge confirme si se puede archivar).

Todas las apps de negocio (`cobrazna-`, `larocaarqueos`, `analisis-cierre`, `la-roca-crm`, `laroca-rrhh`) comparten el mismo patrón: **single-file HTML** (vanilla JS, sin build) + Supabase como backend, salvo `larocaarqueos` que además tiene un backend propio Node/Express (porque necesita llamar a la API de Claude del lado servidor y manejar uploads).

**Dato importante:** cada una de estas 5 apps de negocio tiene además una carpeta `php-mysql/` con un puerto paralelo completo a PHP+MySQL (para hosting cPanel, independiente de Supabase). **No está en producción** — es una migración de respaldo documentada pero no desplegada. La producción real de todas las apps es Supabase + Railway/GitHub Pages/Netlify. Se menciona porque cambia la respuesta de "cuál es la forma más segura de leer los datos" (ver sección 10): hoy solo existe la vía Supabase.

---

## 2. Bases de datos

Hay **dos proyectos Supabase distintos**, no uno:

| Proyecto Supabase | ID | Usado por |
|---|---|---|
| Datos de cobranza/cierre | `ixskgawbpwwxdjnkiixt` | `cobrazna-`, `analisis-cierre`, `larocaarqueos` (tabla `arqueos` vive aquí) |
| Datos de identidad/CRM | `upaenjotkocmdvfuobii` | `laroca-rrhh` (login SSO), `la-roca-crm`, `cotizador-laroca`; también consultado por `cobrazna-` y `larocaarqueos` solo para el login RRHH (`rpc/rrhh_login`) |

Esto importa para n8n: **cruzar cobranza (`ixskgawbpwwxdjnkiixt`) con pagos (`ixskgawbpwwxdjnkiixt`) es el mismo proyecto** — no hace falta federar dos bases distintas para el caso de uso principal. El proyecto de RRHH/CRM (`upaenjotkocmdvfuobii`) solo entraría si se quiere enviar el WhatsApp de gestión reusando el backend del CRM.

RLS: según `analisis-cierre/CONTEXT.md`, las políticas hoy son **abiertas, con la key `sb_publishable_`** (anon). Es decir, cualquiera con esa key (que ya vive en el `index.html` público de varias apps) puede leer/escribir estas tablas directamente. Ver riesgo en sección 11.

---

## 3. Tablas relevantes (todas en el proyecto `ixskgawbpwwxdjnkiixt` salvo que se indique lo contrario)

### Lado cobranza (clientes, créditos, cuotas, mora)

| Tabla | Descripción | Campos clave |
|---|---|---|
| `carteras` | Una fila por cartera de crédito (ROCA_COMERCIAL, MOTORS, etc.). `clientes` es un **array JSONB completo** que se reescribe entero cada vez que se sube un PDF del ERP | `id`, `empresa`, `fecha_emision`, `clientes: [{nombre, saldo, cuota, tramo, dia_pago, ultimo_pago}]`, `load_history` |
| `cierre_proyeccion` | Snapshot mensual de proyección de cobro, congelado ("cierre de mes") | `cartera_id`, `mes_key ('2026-07')`, `datos: [{nombre, saldo, cuota, cuotasTrans, saldoEsperado, diaAsesor, montoAsesor, mora, moraVal}]`, `cerrado_por`, `cerrado_at` |
| `historial_clientes` | Bitácora de notas/visitas/promesas/pagos/abonos por cliente — **es donde hoy se registra manualmente que alguien pagó**, vía chat IA o formularios | `cartera_id`, `cliente_nombre`, `tipo` (`promesa`\|`pago`\|`abono`\|`nota`\|`visita_agenda`\|`visita_realizada`\|`promesa_cumplida`\|`promesa_incumplida`), `monto`, `nota`, `fecha_accion`, `fecha_visita`, `gestor`, `created_at` |
| `promesas` | Estado de gestión **vigente** por cliente (1 fila por `cartera_id + cliente_nombre`) | ver `historial_clientes` para el histórico completo |
| `snapshots` | Foto de cuántos clientes hay en cada tramo de mora, por carga de PDF (alimenta "Pulso ECG") | `cartera_id`, tramo, fecha, count, clientes |
| `alertas` / `alertas_lecturas` | Alertas manuales del equipo (no relacionadas a pagos) | — |
| `mora_historial`, `mora_overrides`, `proyecciones` | Usadas en `cobrazna-/index.html` (confirmado por grep) pero **no documentadas en ningún CONTEXT.md** — gap, ver sección 9 | — |

### Lado pagos/cierre diario

| Tabla | Descripción | Campos clave |
|---|---|---|
| `arqueos` | **El cierre de caja diario.** Una fila por `sucursal + fecha` (con versión, la más alta gana) | `id`, `sucursal (R1-R6)`, `fecha`, `cajera`, `cobrado`, `gastos`, `depositado`, `diferencia` (NO recalcular, se usa el valor almacenado), `estado (PENDIENTE\|OK\|REVISAR\|INCOMPLETO\|DUPLICADO)`, `alertas (JSONB)`, `analisis_json (JSONB, respuesta completa de Claude)`, `version`, `arqueo_orig_id` |
| `estados_cuenta` | Estados de cuenta bancarios para conciliación de depósitos | `sucursal`, `mes_anno`, `resultado_cruce (JSONB)` |
| `gastos_autorizados` | Vales/gastos sin factura fiscal, con flujo de autorización | — |
| `audit_log` | Log de auditoría de acciones sobre arqueos | `accion`, `usuario`, `arqueo_id`, `detalle` |
| `cierre_ventas`, `cierre_inventario` | Excel de ventas/inventario por sucursal, usados por `analisis-cierre` | `mes_key`, `sucursal`, `rows (JSONB)` |

**El dato de pago individual vive dentro de `arqueos.analisis_json.cobros[]`**, no en una tabla propia:
```json
{
  "recibo": "0001-234",
  "cliente": "Juan Perez",
  "monto": 3000.00,
  "tipo": "ABONO",           // CONTADO | PRIMA | ABONO | NOTA DÉBITO | NOTA CRÉDITO | OTRO
  "medio_pago": "EFECTIVO",  // EFECTIVO | POS
  "factura_relacionada": ""
}
```
`tipo=ABONO` es lo que corresponde a un pago de cuota de crédito (baja cartera); `PRIMA` es entrada de crédito nuevo; `CONTADO` es venta de contado, no cobranza.

---

## 4. Relaciones entre los dos lados (y el problema central)

```
carteras.id (cobranza)          arqueos.sucursal (pagos)
  LA_ROCA_COMERCIAL_1     ←→        R1
  LA_ROCA_MOTORS_BARRIO_ARRIBA_1 ←→ R2
  LA_ROCA_MOTORS_LA_LIBERTAD_2   ←→ R3
  SU_MUEBLE                ←→        R4
  SU_MOTO_DANLI             ←→       R5
```
Este mapeo `cartera_id ↔ sucursal` está **hardcodeado en JS dentro de `analisis-cierre/index.html`** (`CARTERA_TO_SUC`), no en una tabla de base de datos. Es el primer puente que n8n necesitará, y hoy solo existe como constante de un solo archivo — habría que replicarlo (o mejor, centralizarlo en una tabla `carteras_sucursales`).

**El problema central para "quién pagó / quién no pagó":** ni `carteras.clientes[]` ni `arqueos.analisis_json.cobros[].cliente` tienen un ID estable de cliente — todo se identifica **por nombre en texto libre**:
- En `arqueos.cobros[].cliente`, el nombre lo extrae Claude leyendo el recibo/Excel (OCR + LLM) — puede venir con variaciones de escritura, abreviado, mal separado.
- En `carteras.clientes[].nombre`, el nombre viene del parser del PDF del ERP de cobranza.
- El propio código ya reconoce esto: `cobrazna-/CONTEXT.md` menciona "Fuzzy name matching para cruzar `cierre_proyeccion` vs historial", y `analisis-cierre/CONTEXT.md` dice "Normalización de nombres solo dentro de la misma sucursal".

Es decir: **hoy no hay join confiable cliente-a-cliente entre pagos y cartera** — solo aproximado por nombre + sucursal/cartera. Esto es lo primero que hay que resolver (o aceptar con una tolerancia conocida) antes de automatizar con n8n, porque un mal match puede marcar a un cliente como "no pagó" cuando sí pagó (o cobrar dos veces la misma gestión).

`arqueos.cobrado` (el total del día) sí es confiable a nivel agregado por sucursal — el problema es solo al bajar al nivel de "qué cliente individual".

---

## 5. Flujo actual de pagos

1. La cajera de cada sucursal cierra el día: sube el PDF/Excel del reporte ERP a `larocaarqueos` (`cajera.html` → `POST /api/arqueos/analizar`).
2. El backend Node llama a Claude (Haiku para extraer texto, Sonnet si el PDF viene escaneado) en 2 pasos, arma `analisis_json` con `ventas[]`, `cobros[]`, `gastos_detalle[]`, `depositos_excel[]`, `cuadre`.
3. Un motor de reglas determinista (`postProcess.js` → `aplicarReglasDepositos`) valida: duplicados por hash de archivo, depósitos duplicados entre arqueos, saltos de correlativo de factura/recibo, depósitos sin confirmador válido → decide `estado = OK | REVISAR | INCOMPLETO` y arma `alertas[]` con niveles `OBSERVACION/ALERTA/CRITICA/FRAUDE`.
4. Se guarda en `arqueos` (Supabase). Si hay alerta `CRITICA/FRAUDE/ALERTA` (no `OBSERVACION`), se dispara push a rol `auditoria` (`server/services/push.js`).
5. El auditor revisa en `auditor.html`, puede corregir, justificar alertas, o resolver fraude.
6. **Nada de esto toca hoy la cartera de cobranza (`carteras`/`historial_clientes`) automáticamente.** El cruce solo pasa manualmente cuando alguien abre `analisis-cierre` y mira el dashboard, o cuando un gestor de cobranza registra "pago" a mano en el chat de `cobrazna-`.

---

## 6. Flujo del cierre diario

El "cierre diario" real es el proceso de arriba (arqueo por sucursal). No hay un cierre diario del lado de cobranza — ahí el ciclo es mensual (`cierre_proyeccion`, "cierre de mes" con PIN de 6 dígitos para reabrir). El punto de disparo natural para la automatización que se describe en la conversación es: **cuando un `arqueo` pasa a `estado=OK` (o `REVISAR` con alertas ya justificadas) para una fecha+sucursal dada**, ese es el momento en que "el día está cerrado" y hay datos confiables de cobros para cruzar contra la cartera.

---

## 7. Datos disponibles para cobranza (respondiendo a los 10 puntos de la automatización deseada)

| Pregunta que n8n debe responder | ¿Está disponible hoy? | Dónde |
|---|---|---|
| 1. Clientes con cuota pendiente | Sí | `carteras.clientes[]` (saldo, cuota, tramo, dia_pago) o `cierre_proyeccion.datos[]` (más preciso: `diaAsesor`, `montoAsesor` = lo que debía pagar ese mes) |
| 2. Clientes que pagaron | Parcial | `arqueos.analisis_json.cobros[]` con `tipo=ABONO` — pero sin ID de cliente confiable (ver §4) |
| 3. Clientes que NO pagaron | Derivado | Complemento de (1) − (2), sujeto al mismo problema de matching |
| 4. Cuánto debía pagar | Sí | `cierre_proyeccion.datos[].montoAsesor` |
| 5. Cuánto pagó realmente | Sí (agregado), parcial (por cliente) | `arqueos.cobrado` (agregado por sucursal/día) es confiable; por cliente depende del match de nombre |
| 6. Quién entró en mora | Sí | Comparar `snapshots` o `carteras.clientes[].tramo` día a día (no hay tabla de "eventos de mora", hay que derivarlo comparando snapshots consecutivos) |
| 7. Quién aumentó su mora | Sí, derivado | Igual que (6), comparando tramo anterior vs actual por cliente |
| 8. Promesas incumplidas | Sí | `historial_clientes` tipo `promesa` sin `promesa_cumplida` posterior a la fecha prometida, o `promesas` (estado vigente) |
| 9. Quién debe recibir gestión hoy | Derivado | Combinación de (3)+(6)+(8) — no existe hoy como query única, hay que construirla |
| 10. Quién debe escalarse a supervisor | No existe hoy | No hay ninguna regla ni tabla que marque "escalar a supervisor" — habría que definir el criterio (ej. mora 120d+, o promesa incumplida 2 veces) y esa lógica viviría en n8n, no en las apps actuales |

---

## 8. APIs existentes

**No hay una API REST propia del lado de cobranza.** `cobrazna-` es 100% cliente: llama directo a la REST API autogenerada de Supabase (`.from('tabla')`) con la key `anon`/`sb_publishable_` embebida en el HTML, más 2 Edge Functions (`ai-recomendaciones`, `ai-chat`, ambas para el chat IA, no relevantes para n8n).

**`larocaarqueos` sí tiene un backend Express propio** con ~35 endpoints REST bajo `/api/arqueos`, `/api/auditor`, `/api/export`, `/api/gastos-autorizados`, `/api/planilla`, `/api/integra`. Los más relevantes:

| Endpoint | Método | Uso |
|---|---|---|
| `/api/auth/login` | POST | `{codigo, pin}` contra RRHH, o `{password}` para cuenta compartida R6. Devuelve cookie de sesión |
| `/api/arqueos` | GET | Listar arqueos (filtros por query) |
| `/api/arqueos/:id` | GET | Detalle de un arqueo (incluye `analisis_json` completo) |
| `/api/arqueos/:id/completar-analisis` | POST | Usado por la Routine automática de análisis pendientes — **contrato congelado**, no tocar sin avisar (ver `larocaarqueos/CONTEXT.md`) |
| `/api/auditor/resumen-mes` | GET | Resumen agregado mensual |
| `/api/auditor/dashboard` | GET | Dashboard del auditor |

**Autenticación: solo por sesión (cookie), no hay API key ni token para acceso máquina-a-máquina.** Tanto `larocaarqueos` (Express + `express-session`, guardada en Supabase Postgres) como el patrón general de las otras apps (login por PIN, sesión en `sessionStorage`/cookie) están pensados para un usuario humano en un navegador, no para un cliente HTTP externo como n8n.

**Webhooks:** no existen webhooks salientes hoy (ni en cobranza ni en arqueos) que avisen "se guardó un arqueo" o "cambió una cartera". El único mecanismo de notificación es push a usuarios (Edge Function `send-push`), no un webhook consultable por n8n.

---

## 9. Información que falta

- **ID de cliente estable.** Ni cobranza ni arqueos tienen una PK de cliente — todo es nombre en texto libre por cartera/sucursal. Es el gap más importante para automatizar sin errores.
- **Tabla puente `carteras_sucursales`.** El mapeo cartera↔sucursal hoy vive hardcodeado en un solo archivo JS de `analisis-cierre`, no en base de datos.
- **`mora_historial`, `mora_overrides`, `proyecciones`** se usan en `cobrazna-/index.html` pero no están documentadas en ningún `CONTEXT.md` — hay que revisar su estructura real en Supabase antes de depender de ellas.
- **`planilla_empleados`/`planilla_quincenas`** (en `larocaarqueos`) se crearon directo en el panel de Supabase, sin migración en el repo — no hay `schema.sql` de referencia (dato aparte, no crítico para este proyecto).
- **No hay tabla de eventos de "mora nueva" ni de "escalado a supervisor"** — habría que decidir si esa lógica vive en n8n (recomendado) o si conviene además loguearla en una tabla nueva para auditoría/histórico.
- **No hay credencial de servicio dedicada para integraciones.** Todo acceso hoy es con la key `anon` pública del cliente, o con sesión de usuario humano — no hay un `service_role` acotado ni un API key de solo-lectura para n8n.

---

## 10. Recomendación de arquitectura para que n8n consulte esto sin tocar los datos originales

1. **Usar Supabase directo desde n8n (nodo HTTP o el nodo Supabase nativo), en modo solo-lectura, con una key propia — no la `anon`/`sb_publishable_` que ya está expuesta en el HTML público.**
   - Crear un **Postgres role de solo lectura** (o usar `service_role` pero restringido con RLS a nivel de política, nunca el `service_role` crudo dentro de un workflow que también podría, por error de configuración, escribir).
   - Alternativa más segura: exponer 2-3 **Postgres Views** de solo lectura ya cruzadas (ej. `v_cobros_dia`, `v_cartera_actual`, `v_mora_actual`) y darle a n8n acceso únicamamente a esas vistas, no a las tablas base. Así ninguna query mal armada desde n8n puede afectar `carteras`/`arqueos` directamente, y el join cartera↔sucursal (hoy hardcodeado en JS) se centraliza en SQL.
2. **No escribir directo a `carteras`/`historial_clientes`/`arqueos` desde n8n.** Si n8n necesita registrar una gestión (ej. "se envió WhatsApp de mora a Juan Pérez"), que lo haga a través de un endpoint propio nuevo y angosto (ver punto 3), nunca con `INSERT`/`UPDATE` genérico por SQL — para no reproducir el problema de "cualquiera con la key puede escribir cualquier cosa" que ya existe hoy con la key `anon`.
3. **Crear un endpoint mínimo dedicado para n8n** (Supabase Edge Function o una ruta nueva en el backend de `larocaarqueos`, que ya es Node/Express) tipo `POST /api/n8n/gestion-diaria` que reciba `{cartera_id, cliente_nombre, tipo, monto, nota}` y haga el `INSERT` a `historial_clientes` con validación — así queda auditable, con un solo punto de entrada, y separado del acceso de la app de cobranza para usuarios humanos.
4. **Autenticación:** generar una API key propia para n8n (header custom validado en el endpoint del punto 3, o un JWT de Supabase de un usuario de servicio dedicado) — no reusar PINs de cajeras/gerentes ni la `anon` key pública.

---

## 11. Riesgos de duplicar pagos o modificar información

- **Doble conteo de pagos:** si n8n vuelve a leer `arqueos.cobros[]` de una fecha ya procesada (ej. por un re-análisis o una versión corregida del arqueo), puede volver a contar el mismo pago. Mitigación: siempre filtrar por `version` más alta (igual que hace `analisis-cierre` hoy) y llevar en n8n (o en una tabla nueva) un registro de qué `arqueo.id + version` ya se procesó.
- **Falso "no pagó" por mal match de nombre:** dado que no hay ID de cliente, un nombre mal escrito en el recibo (ej. "Juan Perez" vs "Juan Pérez Gómez") puede hacer que el cliente aparezca como moroso cuando sí pagó, y dispare una gestión de cobranza indebida (mensaje de WhatsApp de mora a alguien que ya pagó). Esto es el riesgo más serio para la experiencia del cliente. Mitigación: fuzzy matching con umbral conservador + cola de "no pude hacer match automático" para revisión humana antes de escalar, en vez de asumir "no pagó" por default.
- **Escritura accidental sobre `carteras.clientes[]`:** esa columna se **reescribe completa** cada vez que se sube un PDF nuevo — un workflow de n8n mal armado que la toque podría borrar el resto del array. Nunca debe escribirse ahí desde n8n (solo lectura).
- **RLS abierta:** mientras las políticas sigan abiertas con la key `anon`/`sb_publishable_`, cualquier credencial de n8n que reuse esa misma key hereda el mismo riesgo que ya existe en producción (cualquiera que inspeccione el HTML público puede leer/escribir esas tablas). Es un problema preexistente, no introducido por n8n, pero conectar n8n es un buen momento para cerrarlo (políticas RLS reales + key de servicio separada).
- **Falta de idempotencia:** ningún endpoint actual está diseñado para ser llamado más de una vez con el mismo resultado (no hay `idempotency_key`). Si el workflow de n8n falla a medias y se reintenta, puede duplicar filas en `historial_clientes`.

---

## 12. Propuesta de sincronización entre ambos sistemas

**Disparador:** cuando un `arqueo` de `larocaarqueos` queda en `estado=OK` (o `REVISAR` ya resuelto) para una fecha — no hace falta que n8n esté pollING constantemente la base completa.
- Corto plazo (sin tocar código): un **Schedule Trigger en n8n una vez al día** (después de la hora en que normalmente ya cerraron todas las sucursales) que consulta `arqueos` filtrando `fecha = ayer AND estado IN ('OK','REVISAR')`.
- Mejor a mediano plazo: agregar un webhook saliente simple en `larocaarqueos/server/routes/arqueos.js` (donde ya se guarda el arqueo) que haga un `POST` fire-and-forget a una URL de n8n (Webhook Trigger) — mismo patrón que ya usan para el push de alertas (`server/services/push.js`), así que es una extensión natural del código existente, no una arquitectura nueva.

**Flujo propuesto:**
```
1. Trigger (diario o webhook) → arqueo del día en estado OK/REVISAR
2. n8n lee arqueo.analisis_json.cobros[] (tipo=ABONO) → pagos del día por sucursal
3. n8n resuelve sucursal → cartera_id (tabla puente, no el JS hardcodeado)
4. n8n lee carteras.clientes[] / cierre_proyeccion.datos[] de esa cartera → cartera esperada
5. Cruce por nombre (fuzzy, umbral conservador) cliente-a-cliente:
     match fuerte  → marcar como "pagó"
     sin match     → cola de revisión humana (no asumir "no pagó" automáticamente)
6. Con (5) + tramo de mora actual vs snapshot anterior → clasificar:
     pagó / no pagó / mora nueva / mora aumentó / promesa incumplida
7. Motor de reglas en n8n decide acción por cliente:
     enviar WhatsApp de recordatorio / escalar a supervisor / no hacer nada
8. Registrar el resultado de la gestión de vuelta en historial_clientes,
   vía el endpoint dedicado del punto 10.3 (nunca INSERT directo desde n8n)
```

Este es el **segundo prompt** natural para Claude Code una vez que Jorge confirme esta arquitectura: construir la tabla puente `carteras_sucursales`, el endpoint `/api/n8n/gestion-diaria`, y (si se decide) el webhook saliente en `larocaarqueos`.
