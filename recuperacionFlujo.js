const { capitalizar } = require('./utils');
const { esSi, esNo } = require('./confirmaciones');

const INACTIVIDAD_MS = 20 * 60000;
const EXPIRACION_MS = 24 * 3600000;

const ultimaActividad = {};
const flujosGuardados = {};

const ESTADOS_FLUJO = new Set([
  'esperando_origen', 'esperando_destino', 'esperando_monto', 'esperando_seleccion_tasa',
  'esperando_metodo', 'esperando_confirmacion', 'esperando_comprobante',
  'esperando_confirmacion_cotizacion', 'esperando_metodo_cotizacion',
]);

function registrarActividad(clienteId) {
  ultimaActividad[clienteId] = Date.now();
}

function flujoTieneDatosUtiles(datos) {
  return Boolean(datos && (datos.origen || datos.destino || datos.monto || datos.montoUsd));
}

function guardarSnapshot(clienteId, estadoCliente, datosEnvio) {
  const estado = estadoCliente?.[clienteId];
  const datos = datosEnvio?.[clienteId];
  if (!estado || !ESTADOS_FLUJO.has(estado) || !datos) return;
  if (!flujoTieneDatosUtiles(datos) && estado === 'esperando_origen') return;

  flujosGuardados[clienteId] = {
    estado,
    datos: { ...datos },
    updatedAt: Date.now(),
    preguntado: flujosGuardados[clienteId]?.preguntado || false,
  };
}

function limpiarFlujo(clienteId) {
  delete flujosGuardados[clienteId];
  delete ultimaActividad[clienteId];
}

function describirFlujo(datos) {
  if (datos?.origen && datos?.destino) {
    return `${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}`;
  }
  if (datos?.origen) return `desde ${capitalizar(datos.origen)}`;
  if (datos?.destino) return `hacia ${capitalizar(datos.destino)}`;
  return 'tu envío';
}

async function manejarReanudacion(client, chatId, clienteId, texto, estadoCliente, datosEnvio, opts = {}) {
  const { supabase, limpiarFlujoPersistido } = opts;
  const t = (texto || '').toLowerCase().trim();

  const descartar = async (mensaje) => {
    limpiarFlujo(clienteId);
    estadoCliente[clienteId] = null;
    delete datosEnvio[clienteId];
    if (typeof limpiarFlujoPersistido === 'function' && supabase) {
      await limpiarFlujoPersistido(supabase, clienteId).catch(() => {});
    }
    if (mensaje) return client.sendText(chatId, mensaje);
    return true;
  };

  if (estadoCliente[clienteId] === 'esperando_reanudacion') {
    if (esSi(t) || t === 'continuar') {
      const flujo = flujosGuardados[clienteId];
      if (!flujo || !flujoTieneDatosUtiles(flujo.datos)) {
        return descartar('❌ No encontré un envío pendiente válido. Escribe *"quiero enviar"* para empezar.');
      }
      estadoCliente[clienteId] = flujo.estado;
      datosEnvio[clienteId] = { ...flujo.datos };
      ultimaActividad[clienteId] = Date.now();
      flujo.preguntado = false;
      return client.sendText(
        chatId,
        `✅ *Continuamos tu envío* (${describirFlujo(flujo.datos)})\n\nResponde donde lo dejaste (por ejemplo el método de pago o el monto).`
      );
    }
    if (esNo(t) || t === 'cancelar') {
      return descartar('🗑 Envío descartado. Cuando quieras, escribe *"quiero enviar"* para empezar de nuevo.');
    }
    if (/\b(quiero enviar|enviar dinero|mandar plata|remesa)\b/.test(t)) {
      await descartar(null);
      return false;
    }
    return client.sendText(chatId, 'Responde *SÍ* para continuar o *NO* para cancelar.');
  }

  const estadoActual = estadoCliente[clienteId];
  if (estadoActual && ESTADOS_FLUJO.has(estadoActual)) {
    const inactivo = ultimaActividad[clienteId] && Date.now() - ultimaActividad[clienteId] > INACTIVIDAD_MS;
    guardarSnapshot(clienteId, estadoCliente, datosEnvio);

    if (inactivo && estadoActual !== 'esperando_comprobante') {
      if (!flujoTieneDatosUtiles(datosEnvio[clienteId])) {
        return descartar(null);
      }
      estadoCliente[clienteId] = 'esperando_reanudacion';
      return client.sendText(
        chatId,
        `🔄 Tienes un envío sin terminar (${describirFlujo(datosEnvio[clienteId])}).\n\n¿Deseas *continuar* donde lo dejaste?\n(Responde SÍ o NO)`
      );
    }
    return false;
  }

  const flujo = flujosGuardados[clienteId];
  if (!flujo || Date.now() - flujo.updatedAt > EXPIRACION_MS) {
    if (flujo) delete flujosGuardados[clienteId];
    return false;
  }

  // Snapshot vacío / basura del bug anterior → limpiar en silencio
  if (!flujoTieneDatosUtiles(flujo.datos)) {
    await descartar(null);
    return false;
  }

  if (flujo.preguntado) return false;

  flujo.preguntado = true;
  estadoCliente[clienteId] = 'esperando_reanudacion';
  return client.sendText(
    chatId,
    `🔄 Vi que dejaste un envío pendiente (${describirFlujo(flujo.datos)}).\n\n¿Quieres *continuar*?\n(Responde *SÍ* o *NO*)`
  );
}

module.exports = {
  registrarActividad,
  guardarSnapshot,
  limpiarFlujo,
  manejarReanudacion,
  ESTADOS_FLUJO,
  flujoTieneDatosUtiles,
};
