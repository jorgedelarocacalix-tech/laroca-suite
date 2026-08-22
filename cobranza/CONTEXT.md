# Cobranza App — Contexto del proyecto

Repo: https://github.com/jorgedelarocacalix-tech/COBRAZNA-  
**Netlify (producción):** https://laroca-cobranza-app.netlify.app  
GitHub Pages (secundario): https://jorgedelarocacalix-tech.github.io/COBRAZNA-/  
Stack: Vanilla JS · HTML único (index.html ~6500 líneas) · Supabase · Claude Haiku (Anthropic)  
Supabase project ID: `ixskgawbpwwxdjnkiixt`

Deploy: `netlify deploy --prod --dir=.` desde `/Users/jorgecalix/cobranza-app`

---

## Usuarios / PINs

| PIN   | Nombre        | Rol      | Carteras                                      |
|-------|---------------|----------|-----------------------------------------------|
| 7777  | Jorge         | gerente  | Todas (vista global)                          |
| 12345 | Administrador | admin    | Todas + subir PDFs                            |
| 1111  | Equipo Roca   | cobrador | ROCA_COMERCIAL, MOTORS, LIBERTAD, BARRIO      |
| 2222  | Equipo Su Mueble | cobrador | MUEBLE, MOTO, DANLI                       |

El PIN 7777 (gerente) al entrar abre automáticamente el chat IA en modo "Todas las carteras".

---

## IDs de carteras en Supabase

| ID Supabase | Nombre |
|---|---|
| `LA_ROCA_COMERCIAL_1` | La Roca Comercial #1 |
| `LA_ROCA_MOTORS_BARRIO_ARRIBA_1` | La Roca Motors Barrio Arriba #1 |
| `LA_ROCA_MOTORS_LA_LIBERTAD_2` | La Roca Motors La Libertad #2 |
| `SU_MOTO_DANLI` | Su Moto Danlí |
| `SU_MUEBLE` | Su Mueble |

---

## Edge Functions Supabase

| Función           | Versión | Descripción                                              |
|-------------------|---------|----------------------------------------------------------|
| ai-recomendaciones | v7     | Análisis del panel IA — recomendaciones por cliente      |
| ai-chat           | v7      | Chat conversacional — modo cartera y modo global         |

---

## Tablas Supabase clave

| Tabla | Descripción |
|---|---|
| `carteras` | Clientes JSONB por cartera, actualizado al subir PDF |
| `historial_clientes` | Notas, visitas, promesas, pagos por cliente |
| `snapshots` | Snapshot de tramos por cartera al subir PDF (usado por Pulso ECG) |
| `cierre_proyeccion` | Excel de proyección subido por gerente — `{nombre, saldo, cuota, mora, moraVal, montoAsesor}` |
| `promesas` | Estado actual de gestión por cliente |
| `alertas` | Alertas automáticas del parser |

---

## Funcionalidades implementadas

### Pantalla Inicio (gerente PIN 7777)
- KPIs globales: pagaron este mes, meta global %, vencidos hoy, mora 120d+, Prometido
- Tabla "Sistema vs Asesores" con columnas: Cartera, Pendientes, Sistema, **Proyectado** (de cierre_proyeccion), Asesores, Diferencia, Editados

### Parser PDF (v23)
- Parsea PDFs del ERP client-side con pdf.js
- Auto-recuperación de clientes no capturados
- Alerta urgente si hay clientes sin recuperar
- Informe de Carga antes de guardar

### Pulso ECG (`buildECG`)
- Gráfico de línea por tramo (Este mes, 60d, 90d, 120d, 150d, +180d) por fecha de upload
- Detecta clientes nuevos (verde) y que salen (rojo)
- **"📊 Excel todos por fecha"** — descarga todos los clientes de todos los tramos por fecha (`descargarExcelTodosClientes`)
- **"📗 Excel +180d por fecha"** — solo INACTIVO por fecha (`descargarExcelSnapshots`)
- Cada tramo tiene su propio botón "⬇ Excel"
- Alerta roja si clientes pasaron de 150d → INACTIVO

### Cobro Mensual (`_renderCobroAnalisis`)
- Selector de mes y cartera
- Lista "Sin abono" (mora > 0, sin pago en el mes): último pago + historial de notas/visitas
- Lista "Top mora" por monto
- Botón 💬 para agregar nota que guarda en historial_clientes
- Export PDF y CSV
- Fuzzy name matching para cruzar cierre_proyeccion vs historial

### Inbox (`buildInbox` — pestaña 📥 Inbox, v20260822-25)
- Feed cronológico de comentarios manuales del equipo (tipos: nota, visita_realizada, visita_agenda, no_contesta; excluye gestor='Sistema')
- Cada tarjeta: texto del comentario, tipo, cliente, hora y chip ✍ con quién comentó
- Filtros por usuario (chips 👤 con conteo), por tipo (📋) y búsqueda por cliente/texto
- **Clic en cualquier tarjeta → abre el chat del cliente**; 💬 también abre chat, 🗑 borra (autor o gerente/admin)
- Límite 400 registros más recientes por cartera

### Chat de cliente (`quickComentario` — modal estilo WhatsApp, v20260822-25)
- Se abre desde cualquier botón 💬 (Inicio, Reporte, Mora, Promesas, Historial) o clic en tarjeta del Inbox
- Hilo de burbujas cronológico: mensajes propios a la derecha (verde), del equipo a la izquierda con nombre en color por tipo; eventos automáticos del Sistema centrados y discretos
- Auto-scroll al último mensaje; separadores de día tipo chat
- Barra de entrada fija abajo: textarea redondo + botón ➤ (Enter envía); al enviar refresca el hilo sin cerrar
- 🗑 dentro de cada burbuja (autor, o gerente/admin); datos en vivo de Supabase → todo el equipo ve lo mismo
- Últimos 100 registros del cliente

### Chat IA (bot)
- Pestaña "Chat" dentro del panel IA (burbuja flotante)
- Registrar promesa, pago, visita, nota vía lenguaje natural
- Confirma siempre: nombre completo + fecha + monto antes de guardar
- Análisis de historial de cliente
- Modo "Todas las carteras" (solo rol gerente)

### Panel de Análisis IA
- Proyección hasta fin de mes
- Alertas: mora 120d+, urgentes, cobrar hoy, a punto de caer a 60d
- CONSEJO de Claude con números reales

---

## Estructura de datos clave

### cierre_proyeccion.datos[] (JSONB)
```js
{ nombre, saldo, cuota, cuotasTrans, saldoEsperado, diaAsesor, montoAsesor, mora, moraVal }
// mora='INACTIVO' = cuenta pasiva (excluir de totales)
```

### historial_clientes (Supabase)
```
cartera_id, cliente_nombre, tipo, monto, nota, fecha_accion, fecha_visita, gestor, created_at
```
Tipos: `promesa` | `pago` | `abono` | `nota` | `visita_agenda` | `visita_realizada` | `promesa_cumplida` | `promesa_incumplida`

### CARTERAS[id]
```js
{ id, empresa, fecha_emision, clientes: [{nombre, saldo, cuota, tramo, dia_pago, ultimo_pago}], load_history }
```

### ECG_DATA
```js
ECG_DATA[cartId_tramoId_idx] = { fecha, count, clientes, idx, cartId, tramoId, created_at }
```

---

## Notas técnicas

- La app es un único `index.html` (~6500 líneas), sin build ni bundler
- Los PDFs de cartera se parsean client-side con pdf.js
- Supabase se usa para persistencia de promesas, historial y snapshots
- El bot usa Claude Haiku via Supabase Edge Functions (Deno/TypeScript)
- Deploy: `netlify deploy --prod --dir=.` (Netlify CLI vinculado a `laroca-cobranza-app`)
- netlify.toml configurado con `Cache-Control: no-cache` para HTML — usuarios siempre ven versión nueva
- Si una PC no carga la app: revisar DNS (cambiar a 8.8.8.8 / 8.8.4.4 resolvió en una ocasión)
