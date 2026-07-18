const { dbQuery } = require('./supabase');
const {
  ALIAS_PAISES,
  capitalizar,
  esPaisValido,
  normalizarPais,
  normalizarTexto,
  obtenerEmoji,
  PAISES_VALIDOS,
} = require('./utils');

const PALABRAS_TASA = /\b(tasa|tasas|cotiz|cotizacion|precio|cambio|valor|ratio)\b/i;
const PALABRAS_CONSULTA = /\b(cuanto|cuánto|a cuanto|a cuánto|esta|está|estan|están|saber|dime|informacion|información|consultar|ver|conocer|actual|hoy|del dia|del día)\b/i;
const PALABRAS_DOLAR_VE = /\b(dolar|dólar|dolares|dólares|bcv|binance|euro|usd)\b|\$/i;
const PALABRAS_ENVIO = /\b(enviar|envio|envío|mandar|remesa|transferir|transferencia)\b/i;

function extraerPaisesEnOrden(texto) {
  const t = normalizarTexto(texto);
  const candidatos = [];

  for (const pais of PAISES_VALIDOS) {
    const idx = t.indexOf(pais);
    if (idx >= 0) candidatos.push({ pais, idx });
  }

  for (const [alias, pais] of Object.entries(ALIAS_PAISES)) {
    const idx = t.indexOf(alias);
    if (idx >= 0 && !candidatos.some((c) => c.pais === pais)) {
      candidatos.push({ pais, idx });
    }
  }

  candidatos.sort((a, b) => a.idx - b.idx);
  const vistos = new Set();
  return candidatos.filter((c) => {
    if (vistos.has(c.pais)) return false;
    vistos.add(c.pais);
    return true;
  }).map((c) => c.pais);
}

function extraerPaisesDelTexto(texto) {
  return extraerPaisesEnOrden(texto);
}

function extraerRuta(texto) {
  const t = normalizarTexto(texto);

  const patrones = [
    /(?:de|desde)\s+([a-z\s]+?)\s+(?:a|hacia|para|hasta)\s+([a-z\s]+?)(?:\?|$|\s)/,
    /([a-z]+)\s*(?:->|→|a|hacia)\s*([a-z]+)/,
    /tasa\s+(?:de\s+)?([a-z]+)\s+(?:a|hacia|para)\s+([a-z]+)/,
  ];

  for (const patron of patrones) {
    const match = t.match(patron);
    if (!match) continue;

    const origen = normalizarPais(match[1].trim());
    const destino = normalizarPais(match[2].trim());
    if (esPaisValido(origen) && esPaisValido(destino)) {
      return { origen, destino };
    }
  }

  const paises = extraerPaisesEnOrden(texto);
  if (paises.length >= 2) {
    return { origen: paises[0], destino: paises[1] };
  }

  return null;
}

function detectarConsultaTasa(texto) {
  const t = normalizarTexto(texto);
  if (!t || t.length < 3) return null;

  if (/^!?tasas?$/.test(t)) return { tipo: 'todas' };
  if (/^!?(dolar|bcv)$/.test(t)) return { tipo: 'dolar_ve' };

  const mencionaTasa = PALABRAS_TASA.test(t);
  const mencionaConsulta = PALABRAS_CONSULTA.test(t);
  const mencionaDolar = PALABRAS_DOLAR_VE.test(t);
  const mencionaEnvio = PALABRAS_ENVIO.test(t);

  if (mencionaDolar && (mencionaTasa || mencionaConsulta || /\b(bcv|binance|euro)\b/.test(t))) {
    return { tipo: 'dolar_ve' };
  }

  if (mencionaTasa || (mencionaConsulta && !mencionaEnvio)) {
    const ruta = extraerRuta(texto);
    if (ruta) return { tipo: 'ruta', ...ruta };

    const paises = extraerPaisesDelTexto(texto);
    if (paises.length === 1) return { tipo: 'pais', pais: paises[0] };

    if (/\b(todas|generales|del dia|del día|actuales)\b/.test(t) && mencionaTasa) {
      return { tipo: 'todas' };
    }

    if (mencionaTasa && !mencionaEnvio) return { tipo: 'todas' };
  }

  if (mencionaConsulta && mencionaDolar && !mencionaEnvio) {
    return { tipo: 'dolar_ve' };
  }

  return null;
}

async function responderDolarVenezuela(client, chatId, supabase) {
  const { data, error } = await dbQuery(
    supabase.from('dolar_venezuela').select('*').eq('id', 1).single()
  );

  if (error || !data) {
    return client.sendText(chatId, '❌ No pude obtener los indicadores en este momento. Intenta más tarde.');
  }

  const fecha = new Date(data.fecha_actualizacion).toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const mensaje =
    `🏦 *INDICADORES VENEZUELA - Cambios AV*\n` +
    `📅 _Actualizado: ${fecha}_\n\n` +
    `🇻🇪 *Dólar BCV*\n └─ 💱 *${parseFloat(data.tasa_bcv).toFixed(2)}* Bs\n\n` +
    `🇪🇺 *Euro BCV*\n └─ 💱 *${parseFloat(data.tasa_euro).toFixed(2)}* Bs\n\n` +
    `🟡 *Binance P2P*\n └─ 💱 *${parseFloat(data.tasa_binance).toFixed(2)}* Bs\n\n` +
    `💡 Para cotizar un envío en USD a Venezuela, escribe *"quiero enviar"*`;

  return client.sendText(chatId, mensaje);
}

async function responderTodasLasTasas(client, chatId, supabase) {
  const { data: tasas, error } = await dbQuery(
    supabase.from('tasas').select('*').order('origen', { ascending: true })
  );

  if (error || !tasas?.length) {
    return client.sendText(chatId, '❌ No hay tasas configuradas actualmente.');
  }

  let mensaje = `🏦 *TASAS DEL DÍA - Cambios AV*\n`;
  mensaje += `📅 _${new Date().toLocaleDateString('es-VE')}_\n\n`;

  tasas.forEach((t) => {
    mensaje += `${obtenerEmoji(t.origen)} *${capitalizar(t.origen)}* ➔ ${obtenerEmoji(t.destino)} *${capitalizar(t.destino)}*\n`;
    mensaje += ` └─ 💱 *${t.valor}* (${t.tipo})\n\n`;
  });

  const { data: dolar } = await dbQuery(
    supabase.from('dolar_venezuela').select('tasa_bcv, tasa_binance').eq('id', 1).single()
  );

  if (dolar) {
    mensaje += `🇻🇪 *Referencia Venezuela:* BCV ${parseFloat(dolar.tasa_bcv).toFixed(1)} | Binance ${parseFloat(dolar.tasa_binance).toFixed(1)}\n\n`;
  }

  mensaje += `💡 Para iniciar un envío escribe *"quiero enviar"*`;
  return client.sendText(chatId, mensaje);
}

async function responderTasaRuta(client, chatId, supabase, origen, destino) {
  const { data: tasa, error } = await dbQuery(
    supabase.from('tasas').select('*').eq('origen', origen).eq('destino', destino).single()
  );

  if (error || !tasa) {
    return client.sendText(
      chatId,
      `❌ No hay tasa configurada para *${capitalizar(origen)} → ${capitalizar(destino)}*.\n\nEscribe *"tasas"* para ver todas las rutas disponibles.`
    );
  }

  let mensaje =
    `💱 *TASA ${capitalizar(origen)} → ${capitalizar(destino)}*\n\n` +
    `${obtenerEmoji(origen)} ➔ ${obtenerEmoji(destino)}\n` +
    `└─ Tasa: *${tasa.valor}* (${tasa.tipo})\n`;

  if (destino === 'venezuela' || origen === 'venezuela') {
    const { data: dolar } = await dbQuery(
      supabase.from('dolar_venezuela').select('*').eq('id', 1).single()
    );
    if (dolar) {
      mensaje +=
        `\n🇻🇪 *Referencia USD/VES:*\n` +
        `• BCV: ${parseFloat(dolar.tasa_bcv).toFixed(1)} Bs\n` +
        `• Binance: ${parseFloat(dolar.tasa_binance).toFixed(1)} Bs\n`;
    }
  }

  mensaje += `\n💡 Para cotizar y enviar escribe *"quiero enviar"*`;
  return client.sendText(chatId, mensaje);
}

async function responderTasasPorPais(client, chatId, supabase, pais) {
  const { data: tasas, error } = await dbQuery(
    supabase.from('tasas').select('*').or(`origen.eq.${pais},destino.eq.${pais}`).order('origen')
  );

  if (error || !tasas?.length) {
    return client.sendText(chatId, `❌ No hay tasas relacionadas con *${capitalizar(pais)}* en este momento.`);
  }

  let mensaje = `💱 *TASAS INVOLUCRANDO ${capitalizar(pais).toUpperCase()}*\n\n`;
  tasas.forEach((t) => {
    mensaje += `${obtenerEmoji(t.origen)} ${capitalizar(t.origen)} ➔ ${obtenerEmoji(t.destino)} ${capitalizar(t.destino)}: *${t.valor}* (${t.tipo})\n`;
  });

  mensaje += `\n💡 Para iniciar un envío escribe *"quiero enviar"*`;
  return client.sendText(chatId, mensaje);
}

async function manejarConsultaTasa(client, chatId, supabase, texto) {
  const consulta = detectarConsultaTasa(texto);
  if (!consulta) return false;

  try {
    switch (consulta.tipo) {
      case 'dolar_ve':
        await responderDolarVenezuela(client, chatId, supabase);
        break;
      case 'ruta':
        await responderTasaRuta(client, chatId, supabase, consulta.origen, consulta.destino);
        break;
      case 'pais':
        await responderTasasPorPais(client, chatId, supabase, consulta.pais);
        break;
      case 'todas':
      default:
        await responderTodasLasTasas(client, chatId, supabase);
        break;
    }
    return true;
  } catch (err) {
    console.error('[TASAS] Error respondiendo consulta:', err.message);
    await client.sendText(chatId, '❌ Hubo un problema al consultar las tasas. Intenta de nuevo en un momento.');
    return true;
  }
}

module.exports = { detectarConsultaTasa, manejarConsultaTasa };
