// Puente Telegram <-> Web
// Recibe los mensajes de un bot de Telegram (long polling con getUpdates)
// y los muestra en una página web desde donde se puede responder con sendMessage.
//
// Sin dependencias externas: usa el fetch nativo de Node 20+ para la Bot API.
// Configuración: TELEGRAM_BOT_TOKEN en .env (¡no se sube al repositorio!).

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// ── 1. Carga de .env (sin dependencias) ─────────────────────────────────────
const RUTA_ENV = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(RUTA_ENV)) {
  for (const linea of readFileSync(RUTA_ENV, "utf8").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const igual = limpia.indexOf("=");
    if (igual === -1) continue;
    const clave = limpia.slice(0, igual).trim();
    const valor = limpia.slice(igual + 1).trim().replace(/^["']|["']$/g, "");
    if (clave && !(clave in process.env)) process.env[clave] = valor;
  }
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const PUERTO = Number(process.env.PORT) || 3000;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : "";

// ── 2. Almacén de mensajes (en memoria + respaldo en archivo JSON) ──────────
const DIR_DATOS = fileURLToPath(new URL("./data", import.meta.url));
const ARCHIVO_DATOS = join(DIR_DATOS, "mensajes.json");
const MAX_MENSAJES = 500;

let mensajes = []; // [{id, chat_id, chat_nombre, de, texto, fecha, dir: 'recibido'|'enviado'}]
let offset = 0;
let infoBot = null; // getMe()
let estadoTel = "sin-token"; // sin-token | conectando | conectado | error

async function cargarMensajes() {
  try {
    const datos = JSON.parse(await readFile(ARCHIVO_DATOS, "utf8"));
    if (Array.isArray(datos)) mensajes = datos;
  } catch {
    mensajes = [];
  }
}

async function guardarMensajes() {
  try {
    await mkdir(DIR_DATOS, { recursive: true });
    await writeFile(ARCHIVO_DATOS, JSON.stringify(mensajes.slice(-MAX_MENSAJES), null, 2));
  } catch (e) {
    console.error("No se pudo guardar mensajes:", e.message);
  }
}

function agregarMensaje(datos) {
  const nuevo = { id: Date.now() + Math.random(), fecha: new Date().toISOString(), ...datos };
  mensajes.push(nuevo);
  guardarMensajes();
  return nuevo;
}

// ── 3. Ayudantes de la Bot API de Telegram ───────────────────────────────────
async function llamarTelegram(metodo, parametros, reintentos = 3) {
  let ultimoError;
  for (let i = 0; i < reintentos; i++) {
    try {
      const res = await fetch(`${API}/${metodo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parametros),
      });
      return await res.json();
    } catch (e) {
      ultimoError = e;
      await dormir(1000 * (i + 1));
    }
  }
  return { ok: false, error: String(ultimoError?.message || ultimoError) };
}

function obtenerNombreChat(chat) {
  return chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || `chat ${chat.id}`;
}

function nombreDeContacto(de) {
  if (!de) return "?";
  const nombre = [de.first_name, de.last_name].filter(Boolean).join(" ");
  return de.username ? `${nombre} (@${de.username})`.trim() : nombre || de.username || "?";
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 4. Bucle de long polling: recibe mensajes de Telegram ───────────────────
async function iniciarPolling() {
  if (!TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN no configurado. La web funciona, el bot no.");
    return;
  }

  // Conocer el nombre del bot (getMe)
  const me = await llamarTelegram("getMe", {});
  if (me.ok) {
    infoBot = me.result;
    console.log(`Conectado como @${infoBot.username}`);
  } else {
    console.warn("getMe falló; revisa el token. Respuesta:", JSON.stringify(me));
  }

  // Long polling: pide updates y mantiene la conexión abierta (timeout=25 s)
  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=25&offset=${offset}&allowed_updates=["message"]`);
      const datos = await res.json();
      if (datos.ok) {
        estadoTel = "conectado";
        for (const actualizacion of datos.result) {
          offset = actualizacion.update_id + 1;
          const msg = actualizacion.message;
          if (!msg) continue;
          const texto = msg.text || msg.caption || "";
          if (texto.startsWith("/start")) {
            await llamarTelegram("sendMessage", {
              chat_id: msg.chat.id,
              text: `¡Hola! Estás viendo el puente Telegram↔Web.\nAbre la app en tu servidor para ver y responder estos mensajes.`,
            });
          }
          agregarMensaje({
            chat_id: msg.chat.id,
            chat_nombre: obtenerNombreChat(msg.chat),
            de: nombreDeContacto(msg.from),
            texto: texto || "[mensaje sin texto]",
            dir: "recibido",
            update_id: actualizacion.update_id,
          });
          console.log(`[tel] ${obtenerNombreChat(msg.chat)}: ${texto}`);
        }
      } else {
        estadoTel = "error";
        // 409 = ya hay otro proceso con long polling; 401 = token inválido
        console.warn("getUpdates sin ok:", JSON.stringify(datos).slice(0, 300));
        await dormir(5000);
      }
    } catch (e) {
      estadoTel = "error";
      console.error("Error en getUpdates:", e.message);
      await dormir(5000);
    }
  }
}

// ── 5. Respuestas desde la web: sendMessage ──────────────────────────────────
async function responder(chatId, texto) {
  const res = await llamarTelegram("sendMessage", { chat_id: chatId, text: texto });
  if (res.ok) {
    const enviado = agregarMensaje({
      chat_id: chatId,
      chat_nombre: `Chat ${chatId}`,
      de: infoBot ? `@${infoBot.username}` : "Bot",
      texto,
      dir: "enviado",
    });
    return { ok: true, mensaje: enviado };
  }
  return { ok: false, error: JSON.stringify(res).slice(0, 300) };
}

// ── 6. Servidor HTTP: página web + API ───────────────────────────────────────
const DIST = fileURLToPath(new URL("./public", import.meta.url));
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function leerCuerpo(solicitud) {
  return new Promise((resolve) => {
    let datos = "";
    solicitud.on("data", (c) => (datos += c));
    solicitud.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        resolve({});
      }
    });
  });
}

createServer(async (solicitud, respuesta) => {
  const url = new URL(solicitud.url, "http://localhost");
  const ruta = url.pathname;

  // ── API ──
  if (ruta === "/api/estado") {
    respuesta.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify({
      tokenConfigurado: Boolean(TOKEN),
      bot: infoBot ? { username: infoBot.username, nombre: infoBot.first_name } : null,
      estado: estadoTel,
      total: mensajes.length,
    }));
    return;
  }

  if (ruta === "/api/mensajes") {
    respuesta.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify({ mensajes: mensajes.slice(-MAX_MENSAJES) }));
    return;
  }

  if (ruta === "/api/responder" && solicitud.method === "POST") {
    const cuerpo = await leerCuerpo(solicitud);
    const chatId = Number(cuerpo.chat_id);
    const texto = String(cuerpo.texto || "").trim();
    if (!Number.isFinite(chatId) || !texto) {
      respuesta.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      respuesta.end(JSON.stringify({ ok: false, error: "Faltan chat_id o texto." }));
      return;
    }
    if (!TOKEN) {
      respuesta.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      respuesta.end(JSON.stringify({ ok: false, error: "El token no está configurado en el servidor." }));
      return;
    }
    const resultado = await responder(chatId, texto);
    respuesta.writeHead(resultado.ok ? 200 : 502, { "Content-Type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify(resultado));
    return;
  }

  // ── Archivos estáticos ──
  const rutaSegura = normalize(decodeURIComponent(ruta === "/" ? "/index.html" : ruta));
  const archivo = join(DIST, rutaSegura);
  if (!archivo.startsWith(DIST)) {
    respuesta.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    respuesta.end("Prohibido.");
    return;
  }
  try {
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    respuesta.end("No encontrado.");
  }
}).listen(PUERTO, "0.0.0.0", async () => {
  await cargarMensajes();
  console.log(`Puente Telegram↔Web listo en http://0.0.0.0:${PUERTO}`);
  iniciarPolling();
});