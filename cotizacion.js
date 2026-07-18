const { dbQuery } = require('./supabase');
const { capitalizar, esPaisValido, formatearMoneda, normalizarPais, normalizarTexto, parseMonto, esMontoValido, PAISES_VALIDOS, ALIAS_PAISES } = require('./utils');
const { LIMITES } = require('./config');
const {
  obtenerTasaRuta,
  obtenerDolarVenezuela,
  obtenerPromocionesActivas,
} = require('./cacheTasas');
const {
  prepararDatosDesdeCotizacionRapida,
  prepararDatosDesdeCotizacionInversa,
  activarSeguimientoCotizacion,
  PIE_COTIZACION,
} = require('./cotizacionSeguimiento');

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

const MONEDA_A_PAIS = {
  bolivar: 'venezuela',
  bolivares: 'venezuela',
  bs: 'venezuela',
  ves: 'venezuela',
  peso: 'colombia',
  pesos: 'colombia',
  cop: 'colombia',
  dolar: 'usa',
  dolares: 'usa',
  usd: 'usa',
  sol: 'peru',
  soles: 'peru',
  pen: 'peru',
};

function monedaAPais(moneda) {
  const m = normalizarTexto(moneda).replace(/[^a-z]/g, '');
  return MONEDA_A_PAIS[m] || null;
}

function extraerRutaPorMonedas(texto) {
  const t = normalizarTexto(texto);
  let origen = null;
  let destino = null;

  const montoConMoneda = t.match(/(\d[\d.,]*)\s*(bolivares?|bs|ves|pesos?|cop|dolares?|usd|soles?|pen)\b/i);
  if (montoConMoneda) {
    origen = monedaAPais(montoConMoneda[2]);
  }

  const pregDestino = t.match(/\b(?:cuant[oa]s?|a\s+cuant[oa])\s+(pesos?|bolivares?|bs|dolares?|usd|soles?)\b/i);
  if (pregDestino) {
    destino = monedaAPais(pregDestino[1]);
  }

  const monedaMeDas = t.match(/\b(pesos?|bolivares?|bs|dolares?|usd|soles?)\s+(?:me\s+d(?:a|an|aria)|recibo|llegan?)\b/i);
  if (monedaMeDas) {
    destino = monedaAPais(monedaMeDas[1]);
  }

  if (/\bme\s+d(?:a|an|aria)\s+(?:por\s+)?(?:los\s+)?(pesos?|bolivares?|dolares?|soles?)\b/i.test(t)) {
    const m = t.match(/\bme\s+d(?:a|an|aria)\s+(?:por\s+)?(?:los\s+)?(pesos?|bolivares?|dolares?|soles?)\b/i);
    if (m) destino = monedaAPais(m[1]);
  }

  const monedasPresentes = [];
  const ordenMonedas = [
    { re: /\b(bolivares?|bs|ves)\b/i, pais: 'venezuela' },
    { re: /\b(pesos?|cop)\b/i, pais: 'colombia' },
    { re: /\b(dolares?|usd)\b/i, pais: 'usa' },
    { re: /\b(soles?|pen)\b/i, pais: 'peru' },
  ];
  for (const item of ordenMonedas) {
    const idx = t.search(item.re);
    if (idx >= 0) monedasPresentes.push({ pais: item.pais, idx });
  }
  monedasPresentes.sort((a, b) => a.idx - b.idx);
  const paisesUnicos = [...new Set(monedasPresentes.map((m) => m.pais))];

  if (!origen && paisesUnicos.length >= 1) origen = paisesUnicos[0];
  if (!destino && paisesUnicos.length >= 2) destino = paisesUnicos[1];

  if (origen && destino && origen !== destino) {
    return { origen, destino };
  }
  return null;
}

function extraerRuta(texto) {
  const t = normalizarTexto(texto);
  const patrones = [
    /(?:de|desde)\s+([a-z\s]+?)\s+(?:a|hacia|para|hasta)\s+([a-z\s]+?)(?:\?|$|\s|,)/,
    /([a-z]+)\s*(?:->|→|a|hacia)\s*([a-z]+)/,
    /(?:envio|enviar|mando|mandar)\s+[\d.,$]+\s*(?:usd|\$|de)?\s*(?:de\s+)?([a-z]+)\s+(?:a|hacia|para)\s+([a-z]+)/,
  ];

  for (const patron of patrones) {
    const match = t.match(patron);
    if (!match) continue;
    const origen = normalizarPais(match[1].trim());
    const destino = normalizarPais(match[2].trim());
    if (esPaisValido(origen) && esPaisValido(destino)) return { origen, destino };
  }

  const paises = extraerPaisesEnOrden(texto);
  if (paises.length >= 2) return { origen: paises[0], destino: paises[1] };

  return extraerRutaPorMonedas(texto);
}

function calcularMontoOrigenInverso(tasaNormal, montoDestino) {
  if (tasaNormal.tipo === 'multiplicar') {
    return montoDestino / tasaNormal.valor;
  }
  return montoDestino * tasaNormal.valor;
}

function esCotizacionInversa(texto) {
  const t = normalizarTexto(texto);
  if (!/\d/.test(t)) return false;

  const deseoEnDestino = /\b(lleguen|llegue|llegar|llegaria|llegar[ií]a|que me lleguen|que lleguen|recibir en|reciba en|necesito en|quiero que lleguen|han de llegar|deben llegar)\b/i;
  const preguntaCuantoEnviar = /\b(cuant[oa]s?|cuanto)\s+(pesos?|bolivares?|bs|soles?|dolares?|usd)\s+(te\s+)?(tengo\s+que\s+)?(mandar|enviar|transferir|pagar|depositar)\b/i;
  const preguntaCuantoEnviar2 = /\b(pesos?|bolivares?|soles?|dolares?)\s+(te\s+)?(tengo\s+que\s+)?(mandar|enviar|transferir)\b/i;
  const preguntaDeboEnviar = /\b(cuant[oa]\s+(debo|tengo)\s+(enviar|mandar|transferir))\b/i;
  const preguntaDeboEnviarMoneda = /\b(cuant[oa]s?\s+(?:pesos?|bolivares?|bs|soles?|dolares?)\s+(?:debo|tengo)\s+(?:enviar|mandar|transferir))\b/i;
  const preguntaDeboEnviarMoneda2 = /\b(pesos?|bolivares?|soles?|dolares?)\s+(?:debo|tengo)\s+(?:enviar|mandar|transferir)\b/i;
  const preguntaCuantoMandar = /\b(cuant[oa]s?|a\s+cuant[oa])\s+(?:te\s+)?(?:tengo\s+que\s+)?(?:debo\s+)?(?:mandar|mando|enviar|envio|transferir|pagar|pago)\b/i;
  const pagoEnMonedaOrigen = /\b(?:si\s+)?(?:te\s+)?(?:pago|pagar|pagaria|pagare)\s+en\s+(pesos?|bolivares?|bs|soles?|dolares?|usd)\b/i;
  const envioAPais = /\b(?:necesito|quiero)\s+(?:enviar|mandar)\b.*\b(?:a|en|hacia|para)\s+(?:una\s+cuenta\s+en\s+)?(venezuela|colombia|usa|peru|panama|vzla)\b/i;

  const quiereDestino = deseoEnDestino.test(t)
    || /\b(necesito|quiero)\s+\d+.*\b(en|a)\s+(venezuela|colombia|usa|peru|panama|vzla)\b/i.test(t)
    || envioAPais.test(t)
    || (/\b(venezuela|vzla)\b/i.test(t) && /(usd|dolares?|\$)/i.test(t) && /\b(enviar|mandar|necesito)\b/i.test(t));

  const preguntaOrigen = preguntaCuantoEnviar.test(t) || preguntaCuantoEnviar2.test(t)
    || preguntaDeboEnviar.test(t) || preguntaDeboEnviarMoneda.test(t) || preguntaDeboEnviarMoneda2.test(t)
    || preguntaCuantoMandar.test(t) || pagoEnMonedaOrigen.test(t);

  return quiereDestino && preguntaOrigen;
}

function extraerOrigenDesdePregunta(texto) {
  const t = normalizarTexto(texto);

  const pagoEnMoneda = t.match(/\b(?:si\s+)?(?:te\s+)?(?:pago|pagar|pagaria|pagare)\s+en\s+(pesos?|bolivares?|bs|soles?|dolares?|usd)\b/i);
  if (pagoEnMoneda) {
    const porMoneda = monedaAPais(pagoEnMoneda[1]);
    if (porMoneda) return porMoneda;
  }

  const patrones = [
    /\b(?:desde|de)\s+(venezuela|colombia|usa|peru|panama|vzla|col|eeuu)\b/i,
    /\b(cuant[oa]s?|cuanto)\s+(pesos?|bolivares?|bs|soles?|dolares?|usd)\s+(?:te\s+)?(?:tengo\s+que\s+)?(?:debo\s+)?(?:mandar|enviar)/i,
    /\b(pesos?|bolivares?|soles?|dolares?)\s+(?:te\s+)?(?:tengo\s+que\s+)?(?:debo\s+)?(?:mandar|enviar)/i,
    /\b(cuant[oa]s?\s+(?:pesos?|bolivares?|bs|soles?|dolares?)\s+(?:debo|tengo)\s+(?:enviar|mandar))/i,
  ];

  for (const p of patrones) {
    const m = t.match(p);
    if (!m) continue;
    const token = m[2] || m[1];
    if (!token) continue;
    const porMoneda = monedaAPais(token);
    if (porMoneda) return porMoneda;
    const porPais = normalizarPais(token);
    if (esPaisValido(porPais)) return porPais;
  }

  const paises = extraerPaisesEnOrden(texto);
  const monedas = [];
  if (/\b(?:pago|pagar|pagaria|pagare)\s+en\s+(pesos?|cop)\b/i.test(t)) monedas.push('colombia');
  else if (/\b(pesos?|cop)\b/i.test(t)) monedas.push('colombia');
  if (/\b(bolivares?|bs|ves)\b/i.test(t)) monedas.push('venezuela');
  if (/\b(soles?|pen)\b/i.test(t)) monedas.push('peru');
  if (/\b(dolares?|usd)\b/i.test(t) && !/\b(en\s+)?venezuela\b/i.test(t)) monedas.push('usa');

  for (const p of monedas) {
    if (!paises.includes(p)) return p;
  }
  if (paises.length >= 1) {
    const dest = extraerDestinoInverso(texto);
    return paises.find((p) => p !== dest) || null;
  }
  return null;
}

function extraerDestinoInverso(texto) {
  const t = normalizarTexto(texto);

  const envioACuenta = t.match(
    /\b(?:enviar|mandar|necesito enviar|quiero enviar)\b.*\b(?:a|en|hacia|para)\s+(?:una\s+cuenta\s+en\s+)?(venezuela|colombia|usa|peru|panama|vzla)\b/i
  );
  if (envioACuenta) {
    const p = normalizarPais(envioACuenta[1]);
    if (esPaisValido(p)) return p;
  }

  const paisExplicito = t.match(/\b(\d[\d.,]*)\s*(usd|dolares?|\$|pesos?|bolivares?|bs|soles?)\s*(en|a|para|hacia)\s+(venezuela|colombia|usa|peru|panama|vzla)\b/i)
    || t.match(/\b(en|a|para|hacia)\s+(venezuela|colombia|usa|peru|panama|vzla)\b/i)
    || t.match(/\b(lleguen|llegar|llegue|recibir|reciba|necesito|quiero)\s+(\d[\d.,]*)?\s*(usd|dolares?|\$|pesos?|bolivares?|bs|soles?)?\s*(en|a|para)?\s*(venezuela|colombia|usa|peru|panama|vzla)\b/i);

  if (paisExplicito) {
    const paisToken = paisExplicito[paisExplicito.length - 1];
    const p = normalizarPais(paisToken);
    if (esPaisValido(p)) return p;
  }

  if (/\b(venezuela|vzla)\b/i.test(t) && /(usd|dolares?|\$)/i.test(t)) return 'venezuela';

  const monedaDestino = t.match(/\b(lleguen|llegar|reciba?|necesito|quiero que lleguen)\s+(\d[\d.,]*)\s*(pesos?|bolivares?|bs|soles?|dolares?)\b/i);
  if (monedaDestino) {
    const p = monedaAPais(monedaDestino[3]);
    if (p) return p;
  }

  return null;
}

function detectarCotizacionInversa(texto) {
  if (!esCotizacionInversa(texto)) return null;

  const t = normalizarTexto(texto);
  const destino = extraerDestinoInverso(texto);
  const origen = extraerOrigenDesdePregunta(texto);

  if (!destino) return null;

  let tasaUsd = 'bcv';
  if (/\bbinance\b/i.test(t)) tasaUsd = 'binance';
  else if (/\beuro\b/i.test(t)) tasaUsd = 'euro';

  const esUsdEnVenezuela = destino === 'venezuela' && /(usd|dolares?|\$)/i.test(t);
  if (esUsdEnVenezuela) {
    const mUsd = t.match(/(\d[\d.,]*)\s*(usd|dolares?|\$)/i);
    if (!mUsd) return null;
    const montoUsd = parseMonto(mUsd[1]);
    if (!esMontoValido(montoUsd, LIMITES.MONTO_MINIMO, LIMITES.MONTO_MAXIMO)) return null;
    if (!origen || origen === destino) return { tipo: 'usd_venezuela', montoUsd, destino, origen: null, tasaUsd };
    return { tipo: 'usd_venezuela', montoUsd, destino, origen, tasaUsd };
  }

  const mDest = t.match(/\b(lleguen|llegar|llegue|reciba?|que me lleguen|que lleguen|necesito|quiero que lleguen|han de llegar)\s+(\d[\d.,]*)\s*(pesos?|bolivares?|bs|soles?|dolares?|usd)?\s*(?:en|a|para|hacia)?\s*(venezuela|colombia|usa|peru|panama|vzla)?/i)
    || t.match(/\b(necesito|quiero)\s+(\d[\d.,]*)\s*(pesos?|bolivares?|bs|soles?)\s+(en|a)\s+(venezuela|colombia|usa|peru|panama|vzla)\b/i);

  if (!mDest) return null;
  const montoDestino = parseMonto(mDest[2]);
  if (!esMontoValido(montoDestino, LIMITES.MONTO_MINIMO, LIMITES.MONTO_MAXIMO)) return null;
  if (!origen || origen === destino) return { tipo: 'monto_destino', montoDestino, destino, origen: null, tasaUsd: null };

  return { tipo: 'monto_destino', montoDestino, destino, origen, tasaUsd: null };
}

function detectarCotizacionRapida(texto) {
  if (esCotizacionInversa(texto)) return null;

  const t = normalizarTexto(texto);
  if (!/\d/.test(t)) return null;

  const palabrasCotiz = /\b(recibo|recibiria|recibir[ií]a|ser[ií]a|cotiza|cotizacion|cuanto me dan|cuanto me das|cuantos pesos|cuantos bolivares|cuantos dolares|cuanto llega|cuanto seria|cuanto recibo|me dan|me das|me daria|me dar[ií]a|llegar[ií]a|a cuanto|a cuantos)\b/i;
  const palabrasEnvio = /\b(enviar|envio|envío|mandar|mando|remesa)\b/i;

  const pareceCotizacion = palabrasCotiz.test(t) || (palabrasEnvio.test(t) && /\b(pesos?|bolivares?|dolares?|soles?|bs)\b/i.test(t));
  if (!pareceCotizacion) return null;
  if (/\b(como va|estado|historial|mis envios)\b/i.test(t)) return null;

  const monto = parseMonto(texto);
  if (!esMontoValido(monto, LIMITES.MONTO_MINIMO, LIMITES.MONTO_MAXIMO)) return null;

  const ruta = extraerRuta(texto);
  if (!ruta) return null;

  const isUSD = /(usd|\$|dolar|dólar|dolares|dólares)/i.test(texto);
  let tasaUsd = 'bcv';
  if (/\bbinance\b/i.test(t)) tasaUsd = 'binance';
  else if (/\beuro\b/i.test(t)) tasaUsd = 'euro';

  return { monto, ...ruta, isUSD, tasaUsd };
}

async function obtenerPromo(supabase, clienteId, origen, destino, montoOrigen) {
  const { count: enviosPrevios } = await dbQuery(
    supabase.from('transacciones').select('*', { count: 'exact', head: true }).eq('cliente_id', clienteId).eq('estado', 'completado')
  );
  const promosActivas = await obtenerPromocionesActivas(supabase, dbQuery);
  const promoData = (promosActivas || [])
    .filter((p) => montoOrigen >= p.min_monto && (!p.origen || p.origen === origen) && (!p.destino || p.destino === destino))
    .sort((a, b) => b.porcentaje_bono - a.porcentaje_bono)[0];

  let porcentajePromo = 0;
  let nombrePromo = null;
  if (promoData && promoData.porcentaje_bono >= 2) {
    porcentajePromo = promoData.porcentaje_bono;
    nombrePromo = promoData.nombre;
  } else if (enviosPrevios === 0) {
    porcentajePromo = 2;
    nombrePromo = 'Promo Primera Vez';
  } else if (promoData) {
    porcentajePromo = promoData.porcentaje_bono;
    nombrePromo = promoData.nombre;
  }
  return { porcentajePromo, nombrePromo };
}

async function calcularCotizacionInversa(supabase, clienteId, datos) {
  const { origen, destino } = datos;

  const tasaNormal = await obtenerTasaRuta(supabase, dbQuery, origen, destino);
  if (!tasaNormal?.valor || tasaNormal.valor <= 0) return null;

  let montoDestinoFinal = 0;
  let montoOrigen = 0;
  let detalleUsd = '';
  let montoUsd = null;
  let tasaBcvUsada = null;

  if (datos.tipo === 'usd_venezuela') {
    let dolar;
    try {
      dolar = await obtenerDolarVenezuela(supabase, dbQuery);
    } catch {
      return null;
    }
    if (!dolar) return null;

    montoUsd = datos.montoUsd;
    tasaBcvUsada = parseFloat(dolar[`tasa_${datos.tasaUsd}`] || dolar.tasa_bcv);
    montoDestinoFinal = Math.round(montoUsd * tasaBcvUsada);
    detalleUsd = `${montoUsd} USD × ${tasaBcvUsada.toFixed(1)} Bs (${datos.tasaUsd.toUpperCase()})`;
    montoOrigen = calcularMontoOrigenInverso(tasaNormal, montoDestinoFinal);
  } else {
    montoDestinoFinal = datos.montoDestino;
    montoOrigen = calcularMontoOrigenInverso(tasaNormal, montoDestinoFinal);
  }

  const promo = await obtenerPromo(supabase, clienteId, origen, destino, montoOrigen);
  let montoDestinoConPromo = montoDestinoFinal;
  if (promo.porcentajePromo > 0) {
    montoDestinoConPromo = montoDestinoFinal + montoDestinoFinal * (promo.porcentajePromo / 100);
  }

  return {
    montoOrigen,
    montoDestinoFinal,
    montoDestinoConPromo,
    montoUsd,
    tasaBcvUsada,
    detalleUsd,
    tasaNormal,
    ...promo,
  };
}

async function manejarCotizacionInversa(client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio) {
  const datos = detectarCotizacionInversa(texto);
  if (!datos) return false;

  if (!datos.origen) {
    await client.sendText(
      chatId,
      `🌍 Para calcular cuánto debes enviar, indícame *desde qué país* envías.\n\n` +
      `Ejemplo: _"Quiero que lleguen 10 dólares en Venezuela, cuántos pesos mando desde Colombia"_`
    );
    return true;
  }

  try {
    const resultado = await calcularCotizacionInversa(supabase, clienteId, datos);
    if (!resultado) {
      return client.sendText(
        chatId,
        `❌ No hay tasa configurada para *${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}*.`
      );
    }

    let mensaje = `🧮 *COTIZACIÓN INVERSA*\n\n`;

    if (datos.tipo === 'usd_venezuela') {
      mensaje += `🎯 Meta en destino: *${datos.montoUsd} USD* en Venezuela\n`;
      mensaje += `💱 ${resultado.detalleUsd}\n`;
      mensaje += `🇻🇪 Recibirán: *${formatearMoneda(resultado.montoDestinoFinal, 'venezuela')}*\n\n`;
    } else {
      mensaje += `🎯 Meta en destino: *${formatearMoneda(datos.montoDestino, datos.destino)}*\n\n`;
    }

    mensaje +=
      `🗺️ Ruta: *${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}*\n` +
      `💱 Tasa ruta: ${resultado.tasaNormal.valor} (${resultado.tasaNormal.tipo})\n\n` +
      `💸 *Debes enviar aprox:* ${formatearMoneda(resultado.montoOrigen, datos.origen)}\n`;

    if (resultado.porcentajePromo > 0) {
      mensaje += `\n🎁 *${resultado.nombrePromo}:* recibirían ${formatearMoneda(resultado.montoDestinoConPromo, datos.destino)} (+${resultado.porcentajePromo}%)\n`;
    }

    mensaje += PIE_COTIZACION;

    activarSeguimientoCotizacion(
      estadoCliente,
      datosEnvio,
      clienteId,
      prepararDatosDesdeCotizacionInversa(datos, resultado)
    );

    await client.sendText(chatId, mensaje);
    return true;
  } catch (err) {
    console.error('[COTIZACION INVERSA] Error:', err.message);
    await client.sendText(chatId, '❌ No pude calcular la cotización. Intenta de nuevo.');
    return true;
  }
}

async function calcularTotal(supabase, clienteId, origen, destino, monto, isUSD, tasaUsd) {
  const tasaNormal = await obtenerTasaRuta(supabase, dbQuery, origen, destino);
  if (!tasaNormal || !tasaNormal.valor || tasaNormal.valor <= 0) return null;

  let montoOrigen = monto;
  let montoVes = null;
  let detalleUsd = '';

  if (isUSD && destino === 'venezuela') {
    let dolar;
    try {
      dolar = await obtenerDolarVenezuela(supabase, dbQuery);
    } catch {
      return null;
    }
    if (!dolar) return null;

    const tasaVal = parseFloat(dolar[`tasa_${tasaUsd}`] || dolar.tasa_bcv);
    montoVes = Math.round(monto * tasaVal);
    detalleUsd = `\n💵 ${monto} USD × ${tasaVal.toFixed(1)} Bs (${tasaUsd.toUpperCase()})`;

    if (tasaNormal.tipo === 'dividir') montoOrigen = montoVes * tasaNormal.valor;
    else if (tasaNormal.tipo === 'multiplicar') montoOrigen = montoVes / tasaNormal.valor;
  }

  let totalBase = montoVes ?? (tasaNormal.tipo === 'multiplicar' ? montoOrigen * tasaNormal.valor : montoOrigen / tasaNormal.valor);

  const promo = await obtenerPromo(supabase, clienteId, origen, destino, montoOrigen);
  let totalFinal = totalBase;
  if (promo.porcentajePromo > 0) {
    totalFinal = totalBase + totalBase * (promo.porcentajePromo / 100);
  }

  return {
    totalBase,
    totalFinal,
    porcentajePromo: promo.porcentajePromo,
    nombrePromo: promo.nombrePromo,
    tasaNormal,
    montoOrigen,
    detalleUsd,
  };
}

async function manejarCotizacionRapida(client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio) {
  const datos = detectarCotizacionRapida(texto);
  if (!datos) return false;

  try {
    const resultado = await calcularTotal(
      supabase, clienteId, datos.origen, datos.destino, datos.monto, datos.isUSD, datos.tasaUsd
    );

    if (!resultado) {
      return client.sendText(
        chatId,
        `❌ No hay tasa configurada para *${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}*.`
      );
    }

    let mensaje =
      `🧮 *COTIZACIÓN RÁPIDA*\n\n` +
      `🗺️ ${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}\n` +
      `💵 Monto: ${formatearMoneda(datos.isUSD ? resultado.montoOrigen : datos.monto, datos.origen)}` +
      resultado.detalleUsd +
      `\n💱 Tasa ruta: ${resultado.tasaNormal.valor} (${resultado.tasaNormal.tipo})\n`;

    if (resultado.porcentajePromo > 0) {
      mensaje += `🎁 ${resultado.nombrePromo}: +${resultado.porcentajePromo}%\n`;
    }

    mensaje +=
      `\n💰 *Recibirías aprox:* ${formatearMoneda(resultado.totalFinal, datos.destino)}` +
      PIE_COTIZACION;

    activarSeguimientoCotizacion(
      estadoCliente,
      datosEnvio,
      clienteId,
      prepararDatosDesdeCotizacionRapida(datos, resultado)
    );

    await client.sendText(chatId, mensaje);
    return true;
  } catch (err) {
    console.error('[COTIZACION] Error:', err.message);
    await client.sendText(chatId, '❌ No pude calcular la cotización. Intenta de nuevo.');
    return true;
  }
}

module.exports = {
  detectarCotizacionRapida,
  detectarCotizacionInversa,
  esCotizacionInversa,
  manejarCotizacionRapida,
  manejarCotizacionInversa,
  extraerRuta,
};
