const { normalizarTexto } = require('./utils');

const metodosPorPais = {
  venezuela: ['Pago móvil', 'Transferencia'],
  colombia: ['Nequi', 'Llave', 'Bancolombia'],
  usa: ['Efectivo', 'ZELLE'],
  panama: ['Efectivo Western'],
  peru: ['Yape'],
};

const PATRONES_INICIO_ENVIO = [
  /\b(quiero enviar|mandar plata|enviar plata|si enviar|para enviar)\b/i,
  /\b(hacer un envi[oó]|hacer una transferencia|enviar dinero|mandar dinero)\b/i,
  /\b(remesa|remesas)\b/i,
];

const ESTADOS_FLUJO_ENVIO = new Set([
  'esperando_origen', 'esperando_destino', 'esperando_monto', 'esperando_seleccion_tasa',
  'esperando_metodo', 'esperando_confirmacion', 'esperando_comprobante',
  'esperando_confirmacion_cotizacion', 'esperando_metodo_cotizacion',
]);

const PAISES_VALIDOS_ENVIO = ['venezuela', 'colombia', 'usa', 'peru', 'panama'];

function esFraseInicioEnvio(texto) {
  const t = normalizarTexto(texto);
  return PATRONES_INICIO_ENVIO.some((p) => p.test(t));
}

module.exports = {
  metodosPorPais,
  PATRONES_INICIO_ENVIO,
  esFraseInicioEnvio,
  ESTADOS_FLUJO_ENVIO,
  PAISES_VALIDOS_ENVIO,
};
