const { dbQuery } = require('./supabase');
const { capitalizar, formatearMoneda } = require('./utils');

const ESTADOS_LABEL = {
  pendiente: '⏳ Pendiente de pago',
  revisando: '🔍 En revisión',
  completado: '✅ Completado',
  cancelado: '❌ Cancelado',
};

function formatearFecha(iso) {
  if (!iso) return 'Sin fecha';
  return new Date(iso).toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function consultarEstadoEnvio(client, chatId, supabase, clienteId) {
  const { data: trans, error } = await dbQuery(
    supabase
      .from('transacciones')
      .select('*')
      .eq('cliente_id', clienteId)
      .in('estado', ['pendiente', 'revisando'])
      .order('fecha_transaccion', { ascending: false })
      .limit(1)
  );

  if (error) {
    return client.sendText(chatId, '❌ No pude consultar tu envío. Intenta más tarde.');
  }

  if (!trans?.length) {
    const { data: ultimo } = await dbQuery(
      supabase
        .from('transacciones')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('fecha_transaccion', { ascending: false })
        .limit(1)
    );

    if (!ultimo?.length) {
      return client.sendText(chatId, '📭 No tienes envíos registrados.\n\nEscribe *"quiero enviar"* para iniciar uno.');
    }

    const t = ultimo[0];
    return client.sendText(
      chatId,
      `📦 *Último envío*\n\n` +
      `🗺️ ${capitalizar(t.pais_origen)} → ${capitalizar(t.pais_destino)}\n` +
      `💰 Recibiste: ${formatearMoneda(t.monto_recibido, t.pais_destino)}\n` +
      `📌 Estado: ${ESTADOS_LABEL[t.estado] || t.estado}\n` +
      `📅 ${formatearFecha(t.fecha_transaccion)}\n\n` +
      `✅ No tienes envíos activos pendientes.`
    );
  }

  const t = trans[0];
  let extra = '';
  if (t.estado === 'pendiente') {
    extra = '\n\n📸 *Acción requerida:* Envía tu comprobante de pago para continuar.';
  } else if (t.estado === 'revisando') {
    extra = '\n\n⏳ Nuestro equipo está verificando tu comprobante.';
  }

  return client.sendText(
    chatId,
    `📦 *Estado de tu envío*\n\n` +
    `🗺️ ${capitalizar(t.pais_origen)} → ${capitalizar(t.pais_destino)}\n` +
    `💵 Enviaste: ${formatearMoneda(t.monto_enviado, t.pais_origen)}\n` +
    `💰 Recibirás: ${formatearMoneda(t.monto_recibido, t.pais_destino)}\n` +
    `💳 Método: ${t.metodo_pago || 'N/A'}\n` +
    `📌 Estado: ${ESTADOS_LABEL[t.estado] || t.estado}\n` +
    `📅 ${formatearFecha(t.fecha_transaccion)}` +
    extra
  );
}

async function consultarHistorial(client, chatId, supabase, clienteId) {
  const { data: trans, error } = await dbQuery(
    supabase
      .from('transacciones')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('fecha_transaccion', { ascending: false })
      .limit(5)
  );

  if (error) {
    return client.sendText(chatId, '❌ No pude obtener tu historial.');
  }

  if (!trans?.length) {
    return client.sendText(chatId, '📭 Aún no tienes envíos registrados.\n\nEscribe *"quiero enviar"* para tu primera remesa.');
  }

  let mensaje = `📋 *TUS ÚLTIMOS ${trans.length} ENVÍOS*\n\n`;
  trans.forEach((t, i) => {
    mensaje += `*${i + 1}.* ${capitalizar(t.pais_origen)} → ${capitalizar(t.pais_destino)}\n`;
    mensaje += `   💰 ${formatearMoneda(t.monto_recibido, t.pais_destino)} | ${ESTADOS_LABEL[t.estado] || t.estado}\n`;
    mensaje += `   📅 ${formatearFecha(t.fecha_transaccion)}\n\n`;
  });

  mensaje += `💡 Escribe *"estado de mi envío"* para ver el activo.`;
  return client.sendText(chatId, mensaje);
}

module.exports = { consultarEstadoEnvio, consultarHistorial };
