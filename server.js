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
const WEB_PASSWORD = process.env.WEB_PASSWORD || "";

// ── Configuración de IA (OpenRouter: API compatible con OpenAI) ──────────────
const IA_API_KEY = process.env.IA_API_KEY || "";
const IA_MODELO = process.env.IA_MODELO || "meta-llama/llama-3.3-70b-instruct";
const IA_URL = "https://openrouter.ai/api/v1/chat/completions";
const STT_MODELO = process.env.IA_STT_MODELO || "openai/whisper-large-v3-turbo";
const STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

const PROMPT_SISTEMA = `Eres un asistente experto en problemas técnicos agronómicos y temas académicos relacionados: agronomía, ingeniería mecánica agrícola, ciencias, tecnología, programación, servidores, agentes de IA y matemáticas.

Reglas inquebrantables:
1. Respondes SIEMPRE en español.
2. Respondes en MÁXIMO 3 ORACIONES.
3. Nunca mientes ni inventas datos: si no tienes certeza de algo, dilo explícitamente ("no tengo certeza de eso") en lugar de afirmar una falsedad.
4. Tratas de tú, de forma directa y práctica.
5. SOLO respondes temas académicos y de estudio: agronomía, ingeniería mecánica agrícola, ciencias, tecnología, programación, servidores, agentes de IA, matemáticas.
6. Si la pregunta es sobre deportes, entretenimiento, actualidades, política, opiniones personales, o cualquier tema NO académico, NO lo respondas: di algo como "No puedo ayudarte con eso; solo contesto temas técnicos y académicos." y nada más.
7. Ante preguntas académicas dudosas o incompletas, pide aclaración brevemente en vez de adivinar.`;

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

          // ── Nota de voz / audio: descargar + transcribir ──
          let textoFinal = texto;
          let esVoz = false;
          const archivoAudio = msg.voice || msg.audio || msg.video_note;
          if (archivoAudio?.file_id) {
            esVoz = true;
            // Avísale al usuario que está procesando (el "typing" dura ~5 s)
            await llamarTelegram("sendChatAction", { chat_id: msg.chat.id, action: "record_voice" });
            const descarga = await descargarAudioTelegram(archivoAudio.file_id);
            if (!descarga.ok) {
              console.warn("[stt] no se pudo descargar:", descarga.error);
              await llamarTelegram("sendMessage", {
                chat_id: msg.chat.id,
                text: "No pude descargar tu nota de voz. Intenta de nuevo.",
              });
              continue;
            }
            const transcripcion = await transcribirAudio(descarga.buffer, descarga.formato);
            if (!transcripcion.ok) {
              console.warn("[stt] no se pudo transcribir:", transcripcion.error);
              await llamarTelegram("sendMessage", {
                chat_id: msg.chat.id,
                text: "No pude entender la nota de voz. Intenta de nuevo.",
              });
              continue;
            }
            textoFinal = transcripcion.texto;
            console.log(`[stt] 🎤 ${obtenerNombreChat(msg.chat)}: ${textoFinal}`);
          }

          agregarMensaje({
            chat_id: msg.chat.id,
            chat_nombre: obtenerNombreChat(msg.chat),
            de: nombreDeContacto(msg.from),
            texto: esVoz ? `🎤 ${textoFinal}` : textoFinal,
            dir: "recibido",
            update_id: actualizacion.update_id,
            tipo: esVoz ? "voz" : "texto",
          });
          console.log(`[tel] ${obtenerNombreChat(msg.chat)}: ${textoFinal}`);

          // Auto-respuesta con IA (salvo comandos internos)
          if (textoFinal && !textoFinal.startsWith("/start")) {
            const ia = await responderConIA(msg.chat.id);
            if (ia.ok) {
              await llamarTelegram("sendMessage", { chat_id: msg.chat.id, text: ia.mensaje.texto });
              console.log(`[ia] @${infoBot?.username ?? "bot"} → ${obtenerNombreChat(msg.chat)}: ${ia.mensaje.texto}`);
            } else {
              console.warn("[ia] no se pudo responder:", ia.error);
            }
          } else if (textoFinal.startsWith("/start")) {
            await llamarTelegram("sendMessage", {
              chat_id: msg.chat.id,
              text: `¡Hola! Soy tu asistente técnico agronómico. Puedo ayudarte con dudas sobre cultivos, plagas, fertilización, suelos, maquinaria agrícola, riego y temas relacionados con ingeniería y tecnología. También respondo preguntas académicas de ciencias, matemáticas y programación. Escríbeme tu pregunta y con gusto te ayudo.`,
            });
          }
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

// ── 5b. Respuestas con IA (OpenRouter) ────────────────────────────────────────
// Recorta a máximo 3 oraciones como red de seguridad del prompt.
function limitarA3Oraciones(texto) {
  const partes = texto.match(/[^.!?]+[.!?]+/g) || [];
  if (partes.length <= 3) return texto.trim();
  return partes.slice(0, 3).join(" ").trim();
}

// Construye el historial reciente del chat para dar contexto a la IA.
function historialDelChat(chatId, limite = 10) {
  return mensajes
    .filter((m) => m.chat_id === chatId)
    .slice(-limite)
    .map((m) => ({
      role: m.dir === "enviado" ? "assistant" : "user",
      content: m.texto,
    }));
}

async function responderConIA(chatId) {
  if (!IA_API_KEY) return { ok: false, error: "IA_API_KEY no configurada." };
  const historial = historialDelChat(chatId);
  try {
    const res = await fetch(IA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${IA_API_KEY}`,
      },
      body: JSON.stringify({
        model: IA_MODELO,
        messages: [{ role: "system", content: PROMPT_SISTEMA }, ...historial],
        max_tokens: 180,
      }),
    });
    const datos = await res.json();
    if (!res.ok) {
      return { ok: false, error: JSON.stringify(datos).slice(0, 300) };
    }
    const contiene = datos?.choices?.[0]?.message?.content;
    if (!contiene) return { ok: false, error: "La IA no devolvió contenido." };
    const texto = limitarA3Oraciones(contiene);
    const enviado = agregarMensaje({
      chat_id: chatId,
      chat_nombre: `Chat ${chatId}`,
      de: infoBot ? `@${infoBot.username}` : "Bot",
      texto,
      dir: "enviado",
      modelo: IA_MODELO,
    });
    return { ok: true, mensaje: enviado };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── 5c. Notas de voz: descargar de Telegram y transcribir con OpenRouter ─────
// Mapa de mime_type -> formato que espera OpenRouter
const MIME_A_FORMATO = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

async function descargarAudioTelegram(fileId) {
  const meta = await llamarTelegram("getFile", { file_id: fileId });
  if (!meta.ok || !meta.result?.file_path) {
    return { ok: false, error: `getFile falló: ${JSON.stringify(meta).slice(0, 200)}` };
  }
  const archivoPath = meta.result.file_path;
  const mime = meta.result.mime_type || "";
  try {
    // La URL de descarga SIEMPRE lleva /file/bot... (sin /file da HTTP 404)
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${archivoPath}`);
    if (!res.ok) return { ok: false, error: `Descarga falló: HTTP ${res.status}` };
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.length === 0) return { ok: false, error: "El audio descargado está vacío." };
    return { ok: true, buffer, mime, formato: MIME_A_FORMATO[mime] || "ogg", duracion: meta.result.duration };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function base64DeBytes(bytes) {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return Buffer.from(binario, "binary").toString("base64");
}

async function transcribirAudio(buffer, formato) {
  if (!IA_API_KEY) return { ok: false, error: "IA_API_KEY no configurada." };
  try {
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${IA_API_KEY}`,
      },
      body: JSON.stringify({
        model: STT_MODELO,
        input_audio: {
          data: base64DeBytes(buffer),
          format: formato || "ogg",
        },
        language: "es",
      }),
    });
    const datos = await res.json();
    if (!res.ok) return { ok: false, error: JSON.stringify(datos).slice(0, 300) };
    const texto = (datos.text || datos.texto || "").trim();
    if (!texto) return { ok: false, error: "La transcripción quedó vacía." };
    return { ok: true, texto };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
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

// Autenticación básica: la web y las APIs solo responden con la contraseña correcta.
function accesoAutorizado(solicitud) {
  if (!WEB_PASSWORD) return true; // sin contraseña configurada, acceso abierto
  const encabezado = solicitud.headers.authorization || "";
  const base64 = encabezado.replace(/^Basic\s+/i, "");
  if (!base64) return false;
  const decodificado = Buffer.from(base64, "base64").toString("utf8");
  const contrasena = decodificado.split(":")[1];
  return contrasena === WEB_PASSWORD;
}

function exigirAcceso(respuesta) {
  respuesta.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Puente Telegram"',
  });
  respuesta.end("Autenticación requerida.");
}

createServer(async (solicitud, respuesta) => {
  const url = new URL(solicitud.url, "http://localhost");
  const ruta = url.pathname;

  // Proteger todo el sitio (página y APIs) con contraseña
  if (!accesoAutorizado(solicitud)) {
    exigirAcceso(respuesta);
    return;
  }

  // ── API ──
  if (ruta === "/api/estado") {
    respuesta.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify({
      tokenConfigurado: Boolean(TOKEN),
      bot: infoBot ? { username: infoBot.username, nombre: infoBot.first_name } : null,
      estado: estadoTel,
      total: mensajes.length,
      ia: {
        configurada: Boolean(IA_API_KEY),
        modelo: IA_MODELO,
      },
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