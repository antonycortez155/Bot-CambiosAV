const { dbQuery } = require('./supabase');
const { LIMITES } = require('./config');
const { capitalizar, formatearMoneda, normalizarPais, parseMonto, esMontoValido } = require('./utils');
const { esSi, esNo } = require('./confirmaciones');
const { registrarEnvioConfirmado, construirMensajeMetodos, seleccionarMetodo } = require('./envioConfirmacion');
const { detectarCotizacionRapida, detectarCotizacionInversa } = require('./cotizacion');
const { obtenerTasaRuta, obtenerDolarVenezuela, obtenerPromocionesActivas } = require('./cacheTasas');
const {
  metodosPorPais,
  esFraseInicioEnvio,
  PAISES_VALIDOS_ENVIO,
} = require('./constantesEnvio');
const {
  enviarListaPaises,
  enviarListaMetodos,
  enviarListaTasasUsd,
  mensajePaisesTexto,
} = require('./mensajesInteractivos');
const { sincronizarEstadoCliente } = require('./persistenciaFlujo');

async function guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot) {
  guardarSnapshot(clienteId, estadoCliente, datosEnvio);
  await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);
}

async function calcularPromo(supabase, dbQueryFn, clienteId, origen, destino, monto) {
  const { count: enviosPrevios } = await dbQueryFn(
    supabase.from('transacciones').select('*', { count: 'exact', head: true }).eq('cliente_id', clienteId).eq('estado', 'completado')
  );
  const promosActivas = await obtenerPromocionesActivas(supabase, dbQueryFn);
  const promoData = (promosActivas || [])
    .filter((p) => monto >= p.min_monto && (!p.origen || p.origen === origen) && (!p.destino || p.destino === destino))
    .sort((a, b) => b.porcentaje_bono - a.porcentaje_bono)[0];

  let nombrePromo = null;
  let porcentajePromo = 0;

  if (promoData && promoData.porcentaje_bono >= 2) {
    nombrePromo = promoData.nombre;
    porcentajePromo = promoData.porcentaje_bono;
  } else if (enviosPrevios === 0) {
    nombrePromo = 'Promo Primera Vez';
    porcentajePromo = 2.0;
  } else if (promoData) {
    nombrePromo = promoData.nombre;
    porcentajePromo = promoData.porcentaje_bono;
  }

  return { nombrePromo, porcentajePromo };
}

async function manejarFlujoEnvio(ctx) {
  const {
    client, message, chatId, clienteId, texto, estadoCliente, datosEnvio, supabase,
    guardarSnapshot, limpiarFlujo, limpiarFlujoPersistido, programarRecordatorio,
    silencioso = false,
  } = ctx;

  if (esFraseInicioEnvio(texto) && !detectarCotizacionRapida(texto) && !detectarCotizacionInversa(texto)) {
    limpiarFlujo(clienteId);
    if (limpiarFlujoPersistido) await limpiarFlujoPersistido(supabase, clienteId);
    estadoCliente[clienteId] = 'esperando_origen';
    datosEnvio[clienteId] = {};
    const ok = await enviarListaPaises(client, chatId, '🌍 ¿Desde qué país envías tu remesa?');
    if (!ok) {
      return client.sendText(chatId, `🌍 ¿Desde qué país envías tu remesa?\n\n${mensajePaisesTexto()}`);
    }
    await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);
    return;
  }

  if (estadoCliente[clienteId] === 'esperando_origen') {
    const paisCorregido = normalizarPais(texto);
    if (PAISES_VALIDOS_ENVIO.includes(paisCorregido)) {
      datosEnvio[clienteId].origen = paisCorregido;
      estadoCliente[clienteId] = 'esperando_destino';
      const ok = await enviarListaPaises(client, chatId, '🌎 ¿Hacia qué país deseas enviar?', paisCorregido);
      if (!ok) {
        await client.sendText(chatId, `🌎 ¿Hacia qué país deseas enviar?\n\n${mensajePaisesTexto(paisCorregido)}`);
      }
      await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);
      return;
    }
    return client.sendText(chatId, '❌ País no reconocido. Por favor intenta escribirlo nuevamente.');
  }

  if (estadoCliente[clienteId] === 'esperando_destino') {
    const paisCorregido = normalizarPais(texto);
    if (PAISES_VALIDOS_ENVIO.includes(paisCorregido)) {
      if (datosEnvio[clienteId]?.origen && paisCorregido === datosEnvio[clienteId].origen) {
        return client.sendText(chatId, '❌ El país de destino debe ser diferente al de origen.');
      }
      datosEnvio[clienteId].destino = paisCorregido;
      estadoCliente[clienteId] = 'esperando_monto';
      await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);
      if (paisCorregido === 'venezuela') {
        return client.sendText(chatId, '💰 ¿Cuánto deseas enviar?\n(Solo números o usa $ si quieres calcular tu envio en USD)');
      }
      return client.sendText(chatId, '💰 ¿Cuánto deseas enviar?\n(Solo números)');
    }
    return client.sendText(chatId, '❌ País destino no reconocido. Por favor intenta de nuevo.');
  }

  if (estadoCliente[clienteId] === 'esperando_monto') {
    const origen = datosEnvio[clienteId].origen;
    const destino = datosEnvio[clienteId].destino;
    const isUSD = /(usd|\$|dolar|dólar|dolares|dólares)/i.test(texto);
    const monto = parseMonto(texto);

    if (!esMontoValido(monto, LIMITES.MONTO_MINIMO, LIMITES.MONTO_MAXIMO)) {
      return client.sendText(chatId, '❌ Monto inválido. Ingresa un valor numérico válido.');
    }

    if (isUSD && destino === 'venezuela') {
      let tasas;
      try {
        tasas = await obtenerDolarVenezuela(supabase, dbQuery);
      } catch {
        return client.sendText(chatId, '⚠ Error al consultar tasas. Intenta de nuevo.');
      }
      if (!tasas) return client.sendText(chatId, '⚠ Error al consultar tasas. Intenta de nuevo.');

      datosEnvio[clienteId].monto_usd_solicitado = monto;
      datosEnvio[clienteId].isUSD = true;
      estadoCliente[clienteId] = 'esperando_seleccion_tasa';
      await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);

      const ok = await enviarListaTasasUsd(client, chatId, tasas);
      if (ok) return;

      return client.sendText(
        chatId,
        `🧮 *SELECCIÓN DE TASA*\n\n` +
        `Has solicitado cotizar tu envío de *${monto} USD* a Venezuela.\n\n` +
        `¿Qué tasa deseas usar?\n\n` +
        `1️⃣ Tasa BCV: ${parseFloat(Number(tasas.tasa_bcv).toFixed(1))} Bs\n` +
        `2️⃣ Tasa Euro: ${parseFloat(Number(tasas.tasa_euro).toFixed(1))} Bs\n` +
        `3️⃣ Tasa Binance: ${parseFloat(Number(tasas.tasa_binance).toFixed(1))} Bs\n\n` +
        `Responde con el número de la opción.`
      );
    }

    datosEnvio[clienteId].monto = monto;
    datosEnvio[clienteId].isInverso = false;
    estadoCliente[clienteId] = 'esperando_metodo';
    await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);

    const metodos = metodosPorPais[origen] || ['Transferencia'];
    const ok = await enviarListaMetodos(client, chatId, origen, metodos);
    if (!ok) {
      let msj = '💳 ¿Qué método de pago usarás?\n';
      metodos.forEach((m, i) => { msj += `\n${i + 1}. ${m}`; });
      return client.sendText(chatId, msj);
    }
    return;
  }

  if (estadoCliente[clienteId] === 'esperando_seleccion_tasa') {
    const origen = datosEnvio[clienteId].origen;
    const destino = datosEnvio[clienteId].destino;
    const montoUsd = datosEnvio[clienteId].monto_usd_solicitado;

    let tasas;
    try {
      tasas = await obtenerDolarVenezuela(supabase, dbQuery);
    } catch {
      return client.sendText(chatId, '⚠ Error al consultar las tasas. Intenta de nuevo.');
    }
    if (!tasas) return client.sendText(chatId, '⚠ Error al consultar las tasas. Intenta de nuevo.');

    let tasaSeleccionada = 0;
    let nombreTasa = '';

    if (texto === '1') { tasaSeleccionada = parseFloat(tasas.tasa_bcv); nombreTasa = 'BCV'; }
    else if (texto === '2') { tasaSeleccionada = parseFloat(tasas.tasa_euro); nombreTasa = 'Euro'; }
    else if (texto === '3') { tasaSeleccionada = parseFloat(tasas.tasa_binance); nombreTasa = 'Binance'; }
    else return client.sendText(chatId, '❌ Opción inválida.\nResponde 1, 2 o 3.');

    const tasaNormal = await obtenerTasaRuta(supabase, dbQuery, origen, destino);
    if (!tasaNormal) return client.sendText(chatId, '⚠ No hay tasa configurada para esta ruta.');
    if (!tasaNormal.valor || tasaNormal.valor <= 0) {
      return client.sendText(chatId, '⚠ Tasa mal configurada. Contacta a soporte.');
    }

    const montoVes = Math.round(montoUsd * tasaSeleccionada);
    let montoOrigen = 0;
    if (tasaNormal.tipo === 'dividir') montoOrigen = montoVes * tasaNormal.valor;
    else if (tasaNormal.tipo === 'multiplicar') montoOrigen = montoVes / tasaNormal.valor;

    datosEnvio[clienteId].monto = montoOrigen;
    datosEnvio[clienteId].isInverso = true;
    datosEnvio[clienteId].monto_ves_calculado = montoVes;
    datosEnvio[clienteId].tasa_final_usd = tasaSeleccionada;
    datosEnvio[clienteId].nombre_tasa = nombreTasa;
    estadoCliente[clienteId] = 'esperando_metodo';
    await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);

    const metodos = metodosPorPais[origen] || ['Transferencia'];
    const ok = await enviarListaMetodos(client, chatId, origen, metodos);
    if (!ok) {
      let msj = `💳 ¿Qué método de pago usarás para tu envío desde ${capitalizar(origen)}?\n`;
      metodos.forEach((m, i) => { msj += `\n${i + 1}. ${m}`; });
      return client.sendText(chatId, msj);
    }
    return;
  }

  if (estadoCliente[clienteId] === 'esperando_metodo') {
    const { origen, destino, monto, isInverso, monto_ves_calculado, isUSD, monto_usd_solicitado, nombre_tasa, tasa_final_usd } = datosEnvio[clienteId];
    const seleccion = seleccionarMetodo(texto, origen, metodosPorPais);
    if (!seleccion) return client.sendText(chatId, '❌ Elige una opción válida.');

    datosEnvio[clienteId].metodo = seleccion;

    const tasaNormal = await obtenerTasaRuta(supabase, dbQuery, origen, destino);
    if (!tasaNormal) return client.sendText(chatId, '⚠ No hay tasa para esta ruta.');
    if (!tasaNormal.valor || tasaNormal.valor <= 0) {
      return client.sendText(chatId, '⚠ Tasa mal configurada. Contacta a soporte.');
    }

    let totalBase = isInverso ? monto_ves_calculado : (
      tasaNormal.tipo === 'multiplicar' ? monto * tasaNormal.valor : monto / tasaNormal.valor
    );

    const { nombrePromo, porcentajePromo } = await calcularPromo(supabase, dbQuery, clienteId, origen, destino, monto);
    let totalFinal = totalBase;

    let mensajeResumen = `📦 *Resumen de tu envío:*\n\n` +
      `Enviarás ${formatearMoneda(monto, origen)} desde ${capitalizar(origen)} hacia ${capitalizar(destino)} vía ${seleccion}.\n\n`;

    if (isUSD) {
      mensajeResumen += `💵 Cotizado en: ${monto_usd_solicitado} USD\n` +
        `💱 Tasa seleccionada (${nombre_tasa}): ${parseFloat(Number(tasa_final_usd).toFixed(1))} Bs\n`;
    } else {
      mensajeResumen += `💱 Tasa aplicada: ${tasaNormal.valor}\n`;
    }

    if (porcentajePromo > 0) {
      totalFinal = totalBase + totalBase * (porcentajePromo / 100);
      mensajeResumen += `🎁 *${nombrePromo} ${porcentajePromo}% Extra*\n`;
    }

    datosEnvio[clienteId].total = totalFinal;
    datosEnvio[clienteId].tasa_aplicada = tasaNormal.valor;
    estadoCliente[clienteId] = 'esperando_confirmacion';
    await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);

    mensajeResumen += `\n💵 *Total a recibir: ${formatearMoneda(totalFinal, destino)}*\n\n` +
      `¿Deseas continuar?\n(Responde SÍ, dale, ok… o NO)`;

    return client.sendText(chatId, mensajeResumen);
  }

  if (estadoCliente[clienteId] === 'esperando_confirmacion_cotizacion') {
    if (esSi(texto)) {
      const origen = datosEnvio[clienteId]?.origen;
      if (!origen) {
        limpiarFlujo(clienteId);
        if (limpiarFlujoPersistido) await limpiarFlujoPersistido(supabase, clienteId);
        estadoCliente[clienteId] = null;
        delete datosEnvio[clienteId];
        return client.sendText(chatId, '❌ Faltan datos del envío. Escribe *"quiero enviar"* para comenzar de nuevo.');
      }
      estadoCliente[clienteId] = 'esperando_metodo_cotizacion';
      await guardarEstado(supabase, clienteId, estadoCliente, datosEnvio, guardarSnapshot);
      const metodos = metodosPorPais[origen] || ['Transferencia'];
      const ok = await enviarListaMetodos(client, chatId, origen, metodos);
      if (!ok) return client.sendText(chatId, construirMensajeMetodos(origen, metodosPorPais));
      return;
    }
    if (esNo(texto)) {
      limpiarFlujo(clienteId);
      if (limpiarFlujoPersistido) await limpiarFlujoPersistido(supabase, clienteId);
      estadoCliente[clienteId] = null;
      delete datosEnvio[clienteId];
      return client.sendText(chatId, '❌ Operación cancelada.');
    }
    return false;
  }

  if (estadoCliente[clienteId] === 'esperando_metodo_cotizacion') {
    const origen = datosEnvio[clienteId]?.origen;
    const seleccion = seleccionarMetodo(texto, origen, metodosPorPais);
    if (!seleccion) return client.sendText(chatId, '❌ Elige una opción válida.');

    datosEnvio[clienteId].metodo = seleccion;
    return registrarEnvioConfirmado({
      client,
      message,
      chatId,
      clienteId,
      datosEnvio,
      estadoCliente,
      supabase,
      programarRecordatorio,
      guardarSnapshot,
      silencioso,
    });
  }

  if (estadoCliente[clienteId] === 'esperando_confirmacion') {
    if (esSi(texto)) {
      return registrarEnvioConfirmado({
        client,
        message,
        chatId,
        clienteId,
        datosEnvio,
        estadoCliente,
        supabase,
        programarRecordatorio,
        guardarSnapshot,
        silencioso,
      });
    }
    if (esNo(texto)) {
      limpiarFlujo(clienteId);
      if (limpiarFlujoPersistido) await limpiarFlujoPersistido(supabase, clienteId);
      estadoCliente[clienteId] = null;
      delete datosEnvio[clienteId];
      return client.sendText(chatId, '❌ Operación cancelada.');
    }
    return false;
  }

  return false;
}

module.exports = { manejarFlujoEnvio, metodosPorPais };
