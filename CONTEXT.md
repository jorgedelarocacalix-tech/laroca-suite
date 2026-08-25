# La Roca Suite — Contexto del proyecto

Hub central de apps de La Roca. El usuario inicia sesión aquí y desde el menú abre las demás apps.

**Producción (Railway):** https://laroca-suite-production.up.railway.app  
Repo: https://github.com/jorgedelarocacalix-tech/laroca-suite

## Apps que incluye / enlaza
| Ruta | App | Notas |
|---|---|---|
| `/` | Suite (hub) | Login con código+PIN RRHH vía RPC `rrhh_login`, guarda sesión en `sessionStorage.suite_sesion` |
| `/cobranza/` | Cobranza | `cobranza/index.html` — copia sincronizada del repo COBRAZNA- (SSO vía sessionStorage) |
| `/cotizador/` | Cotizador | `cotizador/index.html` — copia sincronizada del repo cotizador-laroca. Tile SIN `data-app`, por lo que no se filtra por `accesos_apps`: siempre visible para cualquier usuario logueado en la suite |
| link | RRHH | https://laroca-rrhh-production.up.railway.app |
| link (`#sso=`) | Arqueos | https://larocaarqueos-production.up.railway.app — SSO por hash base64 codigo+pin |

## Sesión
- `sessionStorage.setItem('suite_sesion', JSON.stringify({codigo,nombre,nivel_admin,accesos_apps,pin}))`
- Códigos conocidos: ADMIN=jorge, v_joh=isis, v_mil=milagro
- Tiles visibles según `accesos_apps` del usuario (campo de rrhh_empleados)

## Push notifications
- UI de suscripción en la suite (usuario selecciona su persona, roles admin/rrhh/auditoria)
- Edge Function: `https://ixskgawbpwwxdjnkiixt.supabase.co/functions/v1/send-push` body `{title,body,role}`
- Service worker: `sw.js`

## Deploy
```
railway up --detach   # NO auto-despliega desde GitHub
```
Railway NO está conectado al repo: cada cambio requiere `railway up` manual.
nginx sirve HTML con `Cache-Control: no-cache` (usuarios siempre ven versión nueva).

## Actualizar cobranza incluida
Copiar `~/cobranza-app/index.html` → `cobranza/index.html`, commit, y `railway up`.

## Actualizar cotizador incluido
Copiar `~/cotizador-laroca/index.html` → `cotizador/index.html`, commit, y `railway up`.
