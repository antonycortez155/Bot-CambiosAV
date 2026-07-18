const { supabase, dbQuery } = require('./supabase');

const RECORDATORIOS = new Map();
const MINUTOS_PRIMER = 15;
const MINUTOS_SEGUNDO = 45;

function cancelarRecordatorio(clienteId) {
  const pending = RECORDATORIOS.get(clienteId);
  if (pending) {
    clearTimeout(pending.timer1);
    clearTimeout(pending.timer2);
    RECORDATORIOS.delete(clienteId);
  }
}

function programarRecordatorio(client, chatId, clienteId, estadoCliente, transaccionId) {
  cancelarRecordatorio(clienteId);

  const enviarRecordatorio = async (numero) => {
    if (estadoCliente[clienteId] !== 'esperando_comprobante') {
      cancelarRecordatorio(clienteId);
      return;
    }

    try {
      const { data: trans } = await dbQuery(
        supabase.from('transacciones').select('estado').eq('id', transaccionId).single()
      );
      if (!trans || trans.estado !== 'pendiente') {
        cancelarRecordatorio(clienteId);
        return;
      }

      const mensaje = numero === 1
        ? `⏰ *Recordatorio*\n\nAún estamos esperando tu comprobante de pago para procesar tu envío.\n\n📸 Envía una foto del comprobante cuando puedas.`
        : `📢 *Segundo recordatorio*\n\nTu envío sigue pendiente de comprobante.\n\nSi ya pagaste, envía la captura. Si necesitas ayuda, escríbenos.`;

      await client.sendText(chatId, mensaje);
    } catch (err) {
      console.error('[RECORDATORIO] Error:', err.message);
    }
  };

  const timer1 = setTimeout(() => enviarRecordatorio(1), MINUTOS_PRIMER * 60000);
  const timer2 = setTimeout(() => enviarRecordatorio(2), MINUTOS_SEGUNDO * 60000);

  RECORDATORIOS.set(clienteId, { timer1, timer2, transaccionId });
}

module.exports = { programarRecordatorio, cancelarRecordatorio };
