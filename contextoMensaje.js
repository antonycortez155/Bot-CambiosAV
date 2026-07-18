const { ESTADOS_FLUJO_ENVIO } = require('./constantesEnvio');
const { esCancelarFlujo } = require('./confirmaciones');

const ESTADOS_SOLO_CONFIRMACION = new Set([
  'esperando_confirmacion',
  'esperando_confirmacion_cotizacion',
  'esperando_reanudacion',
]);

const ESTADOS_SOLO_DATOS = new Set([
  'esperando_origen',
  'esperando_destino',
  'esperando_monto',
  'esperando_seleccion_tasa',
  'esperando_metodo',
  'esperando_metodo_cotizacion',
]);

const INTENCIONES_PERMITIDAS_EN_FLUJO = new Set(['estado_envio']);

function obtenerEstadoActual(estadoCliente, clienteId) {
  return estadoCliente[clienteId] || null;
}

function intencionPermitidaEnEstado(estado, intencion) {
  if (!estado) return true;
  if (ESTADOS_SOLO_CONFIRMACION.has(estado)) return false;
  if (estado === 'esperando_comprobante') return INTENCIONES_PERMITIDAS_EN_FLUJO.has(intencion);
  if (ESTADOS_SOLO_DATOS.has(estado)) return false;
  return true;
}

function mensajeBloqueoIntencion(estado) {
  if (ESTADOS_SOLO_CONFIRMACION.has(estado)) {
    return '⚠️ Estoy esperando tu confirmación. Responde *SÍ* o *NO* (también vale *dale*, *ok*, *listo*).';
  }
  if (estado === 'esperando_comprobante') {
    return '📸 Estoy esperando tu *comprobante de pago* (imagen). También puedes preguntarme por el *estado* de tu envío.';
  }
  if (ESTADOS_SOLO_DATOS.has(estado)) {
    return '⚠️ Tienes un envío en curso. Responde la pregunta anterior o escribe *cancelar* para empezar de nuevo.';
  }
  return null;
}

function debeProcesarIntenciones(estadoCliente, clienteId) {
  const estado = estadoCliente[clienteId];
  if (!estado) return true;
  return !ESTADOS_FLUJO_ENVIO.has(estado);
}

function extraerTextoRespuesta(message) {
  const rowId = message?.listResponse?.singleSelectReply?.selectedRowId
    || message?.selectedRowId
    || message?.selectedButtonId;

  if (rowId) return String(rowId).toLowerCase().trim();

  return (message.body || '').toLowerCase().trim();
}

function manejarCancelacionFlujo(clienteId, estadoCliente, datosEnvio, limpiarFlujo, limpiarFlujoPersistido, supabase) {
  if (!ESTADOS_FLUJO_ENVIO.has(estadoCliente[clienteId])) return false;
  limpiarFlujo(clienteId);
  estadoCliente[clienteId] = null;
  delete datosEnvio[clienteId];
  if (limpiarFlujoPersistido) limpiarFlujoPersistido(supabase, clienteId);
  return true;
}

module.exports = {
  ESTADOS_SOLO_CONFIRMACION,
  intencionPermitidaEnEstado,
  mensajeBloqueoIntencion,
  debeProcesarIntenciones,
  extraerTextoRespuesta,
  esCancelarFlujo,
  manejarCancelacionFlujo,
};
