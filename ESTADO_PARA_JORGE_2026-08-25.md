# Estado al 2026-08-25 — para revisar cuando vuelvas

Trabajé de forma autónoma en todo lo que no necesitaba tu aprobación en vivo. Esto es lo que hay, en orden: qué está listo, qué falta que hagas tú (o que me autorices), y cómo probarlo.

---

## ✅ Listo (código y documentos, todo pusheado)

1. **`AUDITORIA_COBRANZA_N8N.md`** (`laroca-suite`) — auditoría completa de cómo están hoy `cobrazna-`, `larocaarqueos` y `analisis-cierre`, y el diseño de la integración.
2. **Extracción de saldo en los recibos** (`larocaarqueos/server/services/claude.js`) — Claude ahora también extrae `saldo_viejo`/`saldo_actual` de cada recibo, en los 3 caminos de análisis (texto, imagen escaneada, respaldo completo). Antes ese dato se ignoraba.
3. **Tabla puente `carteras_sucursales`** — migración lista en `larocaarqueos/migrations/007_carteras_sucursales.sql`, con los 5 mapeos reales confirmados contra la base en vivo (R1↔LA_ROCA_COMERCIAL_1, etc.). **No aplicada en producción todavía** (ver abajo).
4. **`server/services/cruceCobranza.js`** — la lógica del cruce: matchea cada pago (`cobros[]` tipo ABONO) contra `carteras.clientes[]` por saldo, con tolerancia de L1 y desempate por nombre solo si 2+ clientes comparten el mismo saldo exacto. Probado con datos sintéticos (match exacto, desempate, sin match).
5. **`GET /api/n8n/gestion-diaria`** (`larocaarqueos`) — expone ese cruce. Protegido con header `x-n8n-key` contra la variable de entorno `N8N_API_KEY` — si esa variable no existe en Railway, el endpoint responde 503 en vez de quedar abierto. Probado localmente: las 4 respuestas (503 sin configurar, 401 con key mala, 400 con fecha mala, y el flujo completo con datos simulados).
6. **`n8n/cruce-cobranza-diario.json`** (`laroca-suite`) — workflow de n8n listo para importar. Corre cada noche, llama al endpoint, separa quién pagó / quién no se pudo cruzar / quién no pagó, y arma un reporte de texto. **No envía nada a ningún cliente todavía** — termina en un nodo vacío a propósito, con notas dentro del workflow explicando cómo conectar el envío real más adelante.
7. **`CONTEXT.md`** de `larocaarqueos` actualizado con todo lo anterior.

Todo está en la rama `claude/audit-collections-payments-fwdsgo`, pusheada en `laroca-suite` y `larocaarqueos`.

---

## ⛔ Lo que NO hice porque necesita tu aprobación

Intenté aplicar la migración de la tabla puente directo en la base de producción y el clasificador de seguridad de Claude Code lo bloqueó automáticamente — correcto, un cambio de esquema en la base viva no debía pasar sin que tú lo confirmes. Tampoco tengo acceso a Railway CLI desde este entorno, así que no pude desplegar nada.

### Para que esto funcione de verdad, en este orden:

1. **Aplicar la migración 007** — abre el SQL Editor de Supabase (proyecto `ixskgawbpwwxdjnkiixt`, el de cobranza) y corre `larocaarqueos/migrations/007_carteras_sucursales.sql`. Es aditiva (solo crea una tabla nueva), no toca nada existente. También puedes pedirme que la aplique yo cuando estés de vuelta.
2. **Desplegar `larocaarqueos`** a Railway (`railway up --detach`, como siempre — no se despliega solo desde GitHub).
3. **Agregar la variable `N8N_API_KEY`** en Railway (cualquier string largo y random que tú elijas — es la contraseña que usará n8n para llamar al endpoint).
4. **Probar con un cierre real**: que la cajera suba un cierre normal, y revisa en el arqueo guardado si `analisis_json.cobros[].saldo_viejo` salió bien — antes de confiar en el cruce.
5. **Importar `n8n/cruce-cobranza-diario.json`** en tu n8n, editar el nodo "Config" con la URL de Railway y la `N8N_API_KEY` del paso 3.
6. **Dejarlo corriendo unos días solo para ti** (revisando el reporte a mano) antes de conectar cualquier envío real a clientes — ver la nota dentro del workflow.

---

## Cosas para tener en cuenta al revisar

- El cruce por saldo **solo es válido si se consulta la misma noche del cierre**, antes de que la encargada de créditos suba la cartera del día siguiente (esa subida sobreescribe `carteras.clientes[].saldo` completo). El trigger del workflow está puesto a las 9pm Honduras — ajústalo si tu cierre normalmente termina más tarde.
- La lista "pendientes_hoy_sin_pago" es un primer filtro por `dia_pago` (el día habitual de pago de cada cliente) — no es una verdad absoluta, está pensada para que la revise una persona antes de escalar nada.
- Todavía no hay forma de que n8n escriba de vuelta a `historial_clientes` (registrar que se gestionó a un cliente) — quedó pendiente a propósito, es el siguiente paso natural una vez que confíes en el cruce.
- Revisé (de paso, sin tocar nada) las políticas de seguridad de la base: siguen abiertas con la key pública, tal como ya lo marcaba la auditoría — no es algo nuevo que haya introducido yo, pero sigue pendiente de decisión tuya.
