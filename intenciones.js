const { normalizarTexto } = require('./utils');
const { detectarConsultaTasa, manejarConsultaTasa } = require('./tasasConsulta');
const { detectarCotizacionRapida, detectarCotizacionInversa, manejarCotizacionRapida, manejarCotizacionInversa } = require('./cotizacion');
const { consultarEstadoEnvio, consultarHistorial } = require('./clienteConsultas');

const PATRONES_ESTADO = [
  /\b(como va|como está|como esta|estado de|donde esta|dónde está|donde quedo|seguimiento de)\b.*\b(envio|envío|remesa|transferencia|pedido)\b/i,
  /\b(mi envio|mi envío|mi remesa)\b.*\b(estado|va|anda|llego|llegó)\b/i,
  /\b(yaa? llego|ya depositaron|ya pagaron|cuando llega)\b/i,
  /^estado$/,
  /^mi envio$/,
  /^mi envío$/,
];

const PATRONES_HISTORIAL = [
  /\b(mis envios|mis envíos|historial|ultimos envios|últimos envíos|envios anteriores|envíos anteriores)\b/i,
  /\b(cuántos envios|cuantos envios|cuantos envíos)\b/i,
];

function detectarIntencion(texto) {
  const t = normalizarTexto(texto);
  if (!t) return null;

  if (PATRONES_ESTADO.some((p) => p.test(t))) return 'estado_envio';
  if (PATRONES_HISTORIAL.some((p) => p.test(t))) return 'historial';

  if (detectarCotizacionInversa(texto)) return 'cotizacion_inversa';
  if (detectarCotizacionRapida(texto)) return 'cotizacion';
  if (detectarConsultaTasa(texto)) return 'consulta_tasa';

  return null;
}

async function manejarIntencionCliente(client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio) {
  const intencion = detectarIntencion(texto);
  if (!intencion) return false;

  switch (intencion) {
    case 'estado_envio':
      await consultarEstadoEnvio(client, chatId, supabase, clienteId);
      return true;
    case 'historial':
      await consultarHistorial(client, chatId, supabase, clienteId);
      return true;
    case 'cotizacion_inversa':
      return manejarCotizacionInversa(client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio);
    case 'cotizacion':
      return manejarCotizacionRapida(client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio);
    case 'consulta_tasa':
      return manejarConsultaTasa(client, chatId, supabase, texto);
    default:
      return false;
  }
}

module.exports = { detectarIntencion, manejarIntencionCliente };
