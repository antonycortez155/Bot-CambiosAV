const { dbQuery } = require('./supabase');
const { ADMIN_DESTINOS_NOTIFICACION } = require('./config');
const { capitalizar, formatearMoneda } = require('./utils');

function construirMensajeConfirmacion(datos) {
  return (
    `✅ *¡Tu envío fue registrado!*\n\n` +
    `🗺️ Ruta: ${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}\n` +
    `💰 Pagas: ${formatearMoneda(datos.monto, datos.origen)}\n` +
    `💵 Recibes: ${formatearMoneda(datos.total, datos.destino)}\n` +
    `💳 Método: ${datos.metodo}\n\n` +
    `⏳ En unos momentos recibirás los *datos para realizar el pago*.\n` +
    `📸 Luego envía aquí la *captura de tu comprobante*.`
  );
}

async function registrarEnvioConfirmado({
  client,
  message,
  chatId,
  clienteId,
  datosEnvio,
  estadoCliente,
  supabase,
  programarRecordatorio,
  guardarSnapshot,
  silencioso = false,
}) {
  if (datosEnvio[clienteId]?.transaccion_id) {
    if (silencioso) return;
    return client.sendText(chatId, '✅ Ya tienes un envío registrado. Envía tu comprobante de pago.');
  }

  const datos = datosEnvio[clienteId];
  if (!datos?.origen || !datos?.destino || !datos?.monto || !datos?.total || !datos?.metodo) {
    if (silencioso) return;
    return client.sendText(chatId, '❌ Faltan datos del envío. Escribe *"quiero enviar"* para comenzar de nuevo.');
  }

  const { data: clienteExiste } = await dbQuery(
    supabase.from('clientes').select('id').eq('id', clienteId).single()
  );

  if (!clienteExiste) {
    await dbQuery(supabase.from('clientes').insert([{
      id: clienteId,
      nombre: message.sender?.pushname || 'Cliente',
    }]));
  }

  const { data: trans, error } = await dbQuery(
    supabase.from('transacciones').insert([{
      cliente_id: clienteId,
      pais_origen: datos.origen,
      pais_destino: datos.destino,
      monto_enviado: datos.monto,
      monto_recibido: datos.total,
      tasa_aplicada: datos.tasa_aplicada,
      metodo_pago: datos.metodo,
      estado: 'pendiente',
    }]).select().single()
  );

  if (error) {
    if (silencioso) return;
    return client.sendText(chatId, '❌ Error al registrar envío.');
  }

  const avisoAdmin =
    `🛎 *NUEVA SOLICITUD DE ENVÍO* ☁️\n\n` +
    `👤 Cliente: ${message.sender?.pushname || clienteId.replace('@c.us', '').replace('@lid', '')}\n` +
    `🗺️ Ruta: ${capitalizar(datos.origen)} → ${capitalizar(datos.destino)}\n` +
    `💰 Monto: ${formatearMoneda(datos.monto, datos.origen)}\n` +
    `💵 Recibe: ${formatearMoneda(datos.total, datos.destino)}\n` +
    `💳 Método: ${datos.metodo}\n\n` +
    `⏳ Esperando comprobante del cliente.`;

  for (const admin of ADMIN_DESTINOS_NOTIFICACION) {
    await client.sendText(admin, avisoAdmin).catch(() => {});
  }

  estadoCliente[clienteId] = 'esperando_comprobante';
  datosEnvio[clienteId].transaccion_id = trans.id;
  delete datosEnvio[clienteId].desdeCotizacion;
  guardarSnapshot(clienteId, estadoCliente, datosEnvio);
  programarRecordatorio(client, chatId, clienteId, estadoCliente, trans.id);

  if (silencioso) return;

  return client.sendText(chatId, construirMensajeConfirmacion(datos));
}

function construirMensajeMetodos(origen, metodosPorPais) {
  const metodos = metodosPorPais[origen] || ['Transferencia'];
  let msj = `💳 ¿Qué método de pago usarás para tu envío desde ${capitalizar(origen)}?\n`;
  metodos.forEach((m, i) => { msj += `\n${i + 1}. ${m}`; });
  return msj;
}

function seleccionarMetodo(texto, origen, metodosPorPais) {
  const metodos = metodosPorPais[origen] || ['Transferencia'];
  return metodos[parseInt(texto, 10) - 1] || metodos.find((m) => m.toLowerCase() === texto) || null;
}

module.exports = {
  registrarEnvioConfirmado,
  construirMensajeConfirmacion,
  construirMensajeMetodos,
  seleccionarMetodo,
};
