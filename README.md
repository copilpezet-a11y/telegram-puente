# Puente Telegram ↔ Web

App mínima para probar la conexión entre **Telegram** y un **servidor propio**,
que además responde con **IA (OpenRouter)** como un agente:

- Escribes un mensaje a tu bot en Telegram → el agente de IA responde automáticamente
  (como ingeniero agrícola, máximo 3 oraciones, sin inventar datos).
- Todos los mensajes aparecen en esta página web, y desde ahí también puedes responder a mano.

## Cómo funciona

| Pieza | Qué hace |
|---|---|
| `TELEGRAM_BOT_TOKEN` (en `.env`) | Identifica a tu bot. Lo creas con `@BotFather`. |
| `IA_API_KEY` + `IA_MODELO` (en `.env`) | Key de OpenRouter y modelo de IA usado para responder. |
| `server.js` | Corre el servidor web (puerto 3000), el bot por *long polling* (`getUpdates`) y llama a la IA. |
| `public/` | Página web: lista los mensajes recibidos y manda respuestas (`sendMessage`). |
| `data/mensajes.json` | Respaldo local de los mensajes (no se sube a git). |

El bot usa *long polling*: pregunta a Telegram cada pocos segundos si hay mensajes nuevos.
Es la forma más simple para probar — no hay que configurar dominios ni HTTPS para el webhook.

### Cómo responde la IA

- **Prompt de sistema**: ingeniero agrónomo/mecánico agrícola del curso DIMA 2026 (UACh).
- **Reglas**: responde en español, máximo 3 oraciones, nunca inventa datos.
- Además el código **recorta a 3 oraciones** como red de seguridad del prompt.
- La IA recibe los últimos 10 mensajes del chat como contexto.

## Puesta en marcha local

1. Instala pnpm (si no lo tienes): `npm install -g pnpm`
2. Copia las variables y escribe tu token y key:

   ```bash
   cp .env.example .env
   # edita .env y escribe:
   # TELEGRAM_BOT_TOKEN=<tu token>
   # IA_API_KEY=<tu key de OpenRouter>
   # IA_MODELO=<modelo a usar>
   ```

3. Inicia:

   ```bash
   pnpm start
   ```

4. Abre http://localhost:3000, escribe a tu bot desde Telegram y observa cómo la IA responde.

## Despliegue en el servidor del curso

El servidor desplega solo desde GitHub cada 30 s (mira `~/despliegue.conf`):

```bash
# En el servidor (equipo05):
# 1. Apunta la ranura APP al repo nuevo en ~/despliegue.conf
#    APP_REPO="https://github.com/copilpezet-a11y/telegram-puente.git"
#    APP_RAMA="main"
#    APP_INSTALAR="pnpm install"
#    APP_CONSTRUIR=""
#    APP_INICIAR="pnpm start"
# 2. Pon el token y la key en ~/app/.env  (nunca en el repositorio)
# 3. Fuerza el despliegue:
desplegar --forzar
```

La web queda disponible en tu link del equipo, por ejemplo `https://equipo05.179-236-73-82.sslip.io`.

## Notas

- El token y la key se leen al arrancar el servidor (`server.js` carga `.env` él mismo).
  Si cambias cualquiera, reinicia el servicio (`desplegar --forzar` o `supervisorctl restart app`).
- Para cambiar de modelo solo edita `IA_MODELO` (ver ejemplos en `.env.example`).
- Los mensajes se guardan en memoria y en `data/mensajes.json` (hasta 500).
- No subas a git ni `.env` ni `data/`: están en `.gitignore`.