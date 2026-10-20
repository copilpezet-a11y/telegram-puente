// Cliente web del puente Telegram <-> Web.
// Consulta los mensajes cada 2 s y permite responder a un chat elegido.

const $ = (sel) => document.querySelector(sel);

const elEstado = $("#estado");
const elMensajes = $("#mensajes");
const elVacio = $("#vacio");
const elChat = $("#chat");
const elTexto = $("#texto");
const elAviso = $("#aviso");
const form = $("#responder");

let mensajesActuales = [];

// ── Estado del bot ──────────────────────────────────────────────────────────
let infoIA = { configurada: false, modelo: "" };

async function actualizarEstado() {
  try {
    const res = await fetch("/api/estado");
    const info = await res.json();
    infoIA = info.ia ?? infoIA;
    elEstado.classList.remove("ok", "err");
    if (!info.tokenConfigurado) {
      elEstado.textContent = "⚠️ Falta TELEGRAM_BOT_TOKEN en .env";
      elEstado.classList.add("err");
    } else if (!infoIA.configurada) {
      elEstado.textContent = `Bot @${info.bot?.username ?? "?"} · sin IA configurada`;
      elEstado.classList.add("ok");
    } else {
      elEstado.textContent = `Bot @${info.bot?.username ?? "?"} · IA: ${infoIA.modelo}`;
      elEstado.classList.add("ok");
    }
  } catch {
    elEstado.classList.remove("ok");
    elEstado.classList.add("err");
    elEstado.textContent = "Sin conexión con el servidor";
  }
}

// ── Mensajes ─────────────────────────────────────────────────────────────────
function dibujarMensajes(mensajes) {
  elMensajes.innerHTML = "";

  const chatsVistos = new Set();
  const opciones = [{ valor: "", etiqueta: "— elige un chat —" }];

  for (const m of mensajes) {
    if (!chatsVistos.has(m.chat_id)) {
      chatsVistos.add(m.chat_id);
      opciones.push({ valor: String(m.chat_id), etiqueta: m.chat_nombre });
    }
    const div = document.createElement("div");
    div.className = `mensaje ${m.dir === "enviado" ? "enviado" : "recibido"}`;
    const hora = new Date(m.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    const meta = document.createElement("span");
    meta.className = "meta";
    const modelo = m.modelo ? ` · 🤖 ${m.modelo.split("/").pop()}` : "";
    meta.textContent = `${m.dir === "enviado" ? "✉️ Enviado" : "📥 " + m.de} · ${hora} · ${m.chat_nombre}${modelo}`;
    const texto = document.createElement("span");
    texto.className = "texto";
    texto.textContent = m.texto;
    div.append(meta, texto);
    elMensajes.append(div);
  }

  elVacio.style.display = mensajes.length ? "none" : "";

  // Rellenar el selector solo si cambia (para no perder la selección)
  const actual = elChat.value;
  const seleccion = actual && mensajesActuales.some((m) => String(m.chat_id) === actual) ? actual : "";
  const htmlOpciones = opciones
    .map((o) => `<option value="${o.valor}">${o.etiqueta}</option>`)
    .join("");
  elChat.innerHTML = htmlOpciones;
  if (seleccion) elChat.value = seleccion;

  elMensajes.scrollTop = elMensajes.scrollHeight;
}

async function actualizarMensajes() {
  try {
    const res = await fetch("/api/mensajes");
    const datos = await res.json();
    const mensajes = datos.mensajes ?? [];
    mensajesActuales = mensajes;
    dibujarMensajes(mensajes);
  } catch {
    // silencioso; el estado ya avisa
  }
}

// ── Responder ────────────────────────────────────────────────────────────────
form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const chatId = elChat.value;
  const texto = elTexto.value.trim();
  if (!chatId || !texto) {
    elAviso.className = "aviso err";
    elAviso.textContent = "Elige un chat y escribe algo.";
    return;
  }
  elAviso.className = "aviso";
  elAviso.textContent = "Enviando…";
  try {
    const res = await fetch("/api/responder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), texto }),
    });
    const datos = await res.json();
    if (datos.ok) {
      elTexto.value = "";
      elAviso.className = "aviso ok";
      elAviso.textContent = "✔️ Mensaje enviado a Telegram.";
      await actualizarMensajes();
    } else {
      elAviso.className = "aviso err";
      elAviso.textContent = "Error: " + (datos.error ?? "desconocido");
    }
  } catch {
    elAviso.className = "aviso err";
    elAviso.textContent = "Error de red con el servidor.";
  }
});

// ── Ciclo de actualización ───────────────────────────────────────────────────
actualizarEstado();
actualizarMensajes();
setInterval(actualizarEstado, 10000);
setInterval(actualizarMensajes, 2000);