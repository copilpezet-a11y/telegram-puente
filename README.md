# Puente Telegram ↔ Web

App mínima para probar la conexión entre **Telegram** y un **servidor propio**:

- Escribes un mensaje a tu bot en Telegram → aparece en esta página web.
- Respondes desde la página web → el mensaje te llega a tu Telegram.

## Cómo funciona

| Pieza | Qué hace |
|---|---|
| `TELEGRAM_BOT_TOKEN` (en `.env`) | Identifica a tu bot. Lo creas con `@BotFather`. |
| `server.js` | Corre el servidor web (puerto 3000) **y** el bot por *long polling* (`getUpdates`). No necesita webhook ni URL pública. |
| `public/` | Página web: lista los mensajes recibidos y manda respuestas (`sendMessage`). |
| `data/mensajes.json` | Respaldo local de los mensajes (no se sube a git). |

El bot usa *long polling*: pregunta a Telegram cada pocos segundos si hay mensajes nuevos.
Es la forma más simple para probar — no hay que configurar dominios ni HTTPS para el webhook.

## Puesta en marcha local

1. Instala pnpm (si no lo tienes): `npm install -g pnpm`
2. Copia las variables y escribe tu token:

   ```bash
   cp .env.example .env
   # edita .env y escribe TELEGRAM_BOT_TOKEN=<tu token>
   ```

3. Inicia:

   ```bash
   pnpm start
   ```

4. Abre http://localhost:3000, escribe a tu bot desde Telegram y responde desde la web.

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
# 2. Pon el token en ~/app/.env  (nunca en el repositorio)
# 3. Fuerza el despliegue:
desplegar --forzar
```

La web queda disponible en tu link del equipo, por ejemplo `https://equipo05.179-236-73-82.sslip.io`.

## Notas

- El token se lee al arrancar el servidor (`server.js` carga `.env` él mismo). Si lo cambias,
  reinicia el servicio (`desplegar --forzar` o `supervisorctl restart app`).
- Los mensajes se guardan en memoria y en `data/mensajes.json` (hasta 500).
- No subas a git ni `.env` ni `data/`: están en `.gitignore`.