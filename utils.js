const monedaPorPais = {
  venezuela: 'Bs',
  colombia: 'Pesos',
  usa: '$',
  panama: '$',
  peru: 'Soles',
};

const ALIAS_PAISES = {
  vzla: 'venezuela',
  ven: 'venezuela',
  vene: 'venezuela',
  benesuela: 'venezuela',
  venezolana: 'venezuela',
  colonvia: 'colombia',
  col: 'colombia',
  columbia: 'colombia',
  colombiana: 'colombia',
  eeuu: 'usa',
  'estados unidos': 'usa',
  us: 'usa',
  'united states': 'usa',
  americana: 'usa',
  pty: 'panama',
  panamena: 'panama',
  peruana: 'peru',
  lima: 'peru',
};

const PAISES_VALIDOS = ['venezuela', 'colombia', 'usa', 'peru', 'panama'];

function normalizarTexto(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizarPais(entrada) {
  const limpio = normalizarTexto(entrada);
  return ALIAS_PAISES[limpio] || limpio;
}

function esPaisValido(pais) {
  return PAISES_VALIDOS.includes(pais);
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

function formatearMoneda(monto, pais) {
  const valor = Number(monto).toFixed(2);
  return Number(valor).toLocaleString('es-CO') + ' ' + (monedaPorPais[pais] || '');
}

function parseMonto(texto) {
  const limpio = texto.replace(/[^\d.,]/g, '').trim();
  if (!limpio) return NaN;

  if (limpio.includes(',') && limpio.includes('.')) {
    const lastComma = limpio.lastIndexOf(',');
    const lastDot = limpio.lastIndexOf('.');
    if (lastComma > lastDot) {
      return parseFloat(limpio.replace(/\./g, '').replace(',', '.'));
    }
    return parseFloat(limpio.replace(/,/g, ''));
  }

  if (limpio.includes(',')) {
    const [, decimales] = limpio.split(',');
    if (decimales?.length === 3 && !limpio.includes('.')) {
      return parseFloat(limpio.replace(/,/g, ''));
    }
    return parseFloat(limpio.replace(',', '.'));
  }

  if (limpio.includes('.')) {
    const partes = limpio.split('.');
    if (partes[partes.length - 1]?.length === 3 && partes.length > 1) {
      return parseFloat(limpio.replace(/\./g, ''));
    }
    return parseFloat(limpio);
  }

  return parseFloat(limpio);
}

function obtenerEmoji(pais) {
  const banderas = {
    venezuela: '🇻🇪',
    colombia: '🇨🇴',
    usa: '🇺🇸',
    peru: '🇵🇪',
    panama: '🇵🇦',
  };
  return banderas[pais.toLowerCase()] || '🌎';
}

function sanitizarBusqueda(texto, maxLen = 50) {
  return texto.replace(/[%_\\,().]/g, '').trim().slice(0, maxLen);
}

function esMontoValido(monto, min = 1, max = 500000000) {
  return typeof monto === 'number' && !isNaN(monto) && monto >= min && monto <= max;
}

function esChatPrivado(chatId) {
  const id = normalizarWid(chatId);
  return id && !id.endsWith('@g.us') && id !== 'status@broadcast';
}

/**
 * WhatsApp Web >= 2.3000.1042401057 renombró a veces _serialized → $1.
 * Normaliza WIDs/MsgKey a string usable.
 */
function normalizarWid(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'object') {
    const s = valor._serialized || valor.$1;
    if (typeof s === 'string') return s;
    if (typeof valor.toString === 'function') {
      const t = valor.toString();
      if (t && t !== '[object Object]') return t;
    }
  }
  return null;
}

function serializarIdMensaje(message) {
  return normalizarWid(message?.id) || null;
}

function validarBufferImagen(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  return null;
}

module.exports = {
  monedaPorPais,
  PAISES_VALIDOS,
  ALIAS_PAISES,
  normalizarTexto,
  normalizarPais,
  esPaisValido,
  capitalizar,
  formatearMoneda,
  parseMonto,
  obtenerEmoji,
  sanitizarBusqueda,
  esMontoValido,
  esChatPrivado,
  normalizarWid,
  serializarIdMensaje,
  validarBufferImagen,
};
