const { ADMIN_DESTINOS_NOTIFICACION } = require('./config');
const { capitalizar } = require('./utils');
const { ESTADOS_FLUJO } = require('./recuperacionFlujo');

const COOLDOWN_MENU_MS = 6 * 60 * 60 * 1000; // 6 horas

const PATRONES_HANDOFF = [
  /\b(hablar con|quiero hablar|necesito hablar|comunicar(?:me)? con)\b.*\b(asesor|agente|persona|humano|alguien|operador|representante)\b/i,
  /\b(persona real|atenci[oó]n humana|atencion humana)\b/i,
  /\b(ayuda urgente|emergencia)\b/i,
];

const intentosSinRespuesta = {};
const ultimoMenuFallback = {};

function detectarHandoff(texto) {
  return PATRONES_HANDOFF.some((p) => p.test(texto));
}

function registrarIntentoFallido(clienteId) {
  intentosSinRespuesta[clienteId] = (intentosSinRespuesta[clienteId] || 0) + 1;
  return intentosSinRespuesta[clienteId];
}

function resetearIntentos(clienteId) {
  delete intentosSinRespuesta[clienteId];
}

function obtenerIntentos(clienteId) {
  return intentosSinRespuesta[clienteId] || 0;
}

function puedeEnviarMenuFallback(clienteId) {
  const ultimo = ultimoMenuFallback[clienteId];
  if (!ultimo) return true;
  return Date.now() - ultimo >= COOLDOWN_MENU_MS;
}

function marcarMenuEnviado(clienteId) {
  ultimoMenuFallback[clienteId] = Date.now();
}

function limpiarCooldownExpirados() {
  const ahora = Date.now();
  for (const id of Object.keys(ultimoMenuFallback)) {
    if (ahora - ultimoMenuFallback[id] >= COOLDOWN_MENU_MS) {
      delete ultimoMenuFallback[id];
    }
  }
  for (const id of Object.keys(intentosSinRespuesta)) {
    if (!ultimoMenuFallback[id] && intentosSinRespuesta[id] <= 0) {
      delete intentosSinRespuesta[id];
    }
  }
}

async function activarHandoff({
  client,
  workspace,
  chatId,
  clienteId,
  texto,
  estadoCliente,
  datosEnvio,
  adminNumeros,
  marcarAtencionManual,
  limpiarFlujo,
  supabase,
  clientesPausados,
}) {
  const estado = estadoCliente[clienteId];
  const datos = datosEnvio[clienteId];
  let contexto = 'Sin flujo activo';

  if (estado && ESTADOS_FLUJO.has(estado)) {
    if (datos?.origen && datos?.destino) {
      contexto = `${capitalizar(datos.origen)} → ${capitalizar(datos.destino)} (${estado})`;
    } else {
      contexto = estado;
    }
  }

  limpiarFlujo(clienteId);
  estadoCliente[clienteId] = null;
  delete datosEnvio[clienteId];
  resetearIntentos(clienteId);

  await marcarAtencionManual(supabase, clienteId, clientesPausados, 30 * 60000);

  const pushname = workspace?.sender?.pushname || clienteId.replace('@c.us', '');
  const alerta =
    `🆘 *SOLICITUD DE ATENCIÓN HUMANA*\n\n` +
    `👤 Cliente: ${pushname}\n` +
    `💬 Dijo: _"${(texto || '').slice(0, 120)}"_\n` +
    `📋 Contexto: ${contexto}\n\n` +
    `⏸ Bot pausado 30 min para este cliente.\n` +
    `👉 Usa \`!start [nro]\` para reactivarlo cuando termines.`;

  for (const admin of ADMIN_DESTINOS_NOTIFICACION) {
    await client.sendText(admin, alerta).catch(() => {});
  }

  return client.sendText(
    chatId,
    '👤 Te conectamos con un asesor. Un miembro del equipo te responderá en breve.\n\n' +
    '_Mientras tanto, el asistente automático está en pausa para no interrumpir._'
  );
}

const MENU_FALLBACK =
  `🤔 No entendí bien. ¿Qué necesitas?\n\n` +
  `1️⃣ Cotizar un envío\n` +
  `2️⃣ Hacer un envío\n` +
  `3️⃣ Ver estado de mi envío\n` +
  `4️⃣ Hablar con un asesor\n\n` +
  `_Responde con el número o escribe lo que necesitas._`;

const MAPA_MENU = {
  '1': 'cotizar',
  '2': 'enviar',
  '3': 'estado',
  '4': 'asesor',
  cotizar: 'cotizar',
  cotizacion: 'cotizar',
  cotización: 'cotizar',
  enviar: 'enviar',
  envio: 'enviar',
  envío: 'enviar',
  estado: 'estado',
  asesor: 'asesor',
};

function interpretarMenuFallback(texto, opciones = {}) {
  const { enFlujo = false } = opciones;
  const t = (texto || '').toLowerCase().trim();
  if (!t) return null;

  // En flujo de envío, "1"/"2"/"3" son método de pago o tasa — NUNCA menú
  if (enFlujo) {
    if (/^cotizar(\s+un\s+env[ií]o)?$/.test(t)) return 'cotizar';
    if (/^hacer\s+un\s+env[ií]o$/.test(t) || /^enviar$/.test(t)) return 'enviar';
    if (/^ver\s+estado/.test(t) || /^estado(\s+de\s+(mi\s+)?env[ií]o)?$/.test(t)) return 'estado';
    if (/^hablar\s+con(\s+un)?\s+asesor$/.test(t) || /^asesor$/.test(t)) return 'asesor';
    return null;
  }

  if (MAPA_MENU[t]) return MAPA_MENU[t];

  // "1", "1.", "1️⃣", "1️⃣ Cotizar un envío", "2) Hacer un envío"
  const sinKeycap = t.replace(/[\uFE0F\u20E3]/g, '');
  const porNumero = sinKeycap.match(/^([1-4])(?:\s*[.)\-:]\s*|\s+|$)(.*)$/);
  if (porNumero) return MAPA_MENU[porNumero[1]] || null;

  if (/^cotizar(\s+un\s+env[ií]o)?$/.test(t)) return 'cotizar';
  if (/^(hacer(\s+un)?\s+)?env[ií]o$/.test(t) || /^hacer\s+un\s+env[ií]o$/.test(t)) return 'enviar';
  if (/^ver\s+estado/.test(t) || /^estado(\s+de\s+(mi\s+)?env[ií]o)?$/.test(t)) return 'estado';
  if (/^hablar\s+con(\s+un)?\s+asesor$/.test(t) || /^asesor$/.test(t)) return 'asesor';

  return null;
}

/**
 * Envía el menú solo si no se envió en las últimas 6 horas.
 * @returns {Promise<boolean>} true si se envió, false si está en cooldown
 */
async function enviarMenuFallback(client, chatId, clienteId = chatId) {
  if (!puedeEnviarMenuFallback(clienteId)) {
    return false;
  }
  marcarMenuEnviado(clienteId);
  await client.sendText(chatId, MENU_FALLBACK);
  return true;
}

module.exports = {
  detectarHandoff,
  activarHandoff,
  registrarIntentoFallido,
  resetearIntentos,
  obtenerIntentos,
  interpretarMenuFallback,
  enviarMenuFallback,
  puedeEnviarMenuFallback,
  limpiarCooldownExpirados,
  MENU_FALLBACK,
  COOLDOWN_MENU_MS,
};
