const { supabase, dbQuery } = require('./supabase');

let intervalo = null;
let reiniciando = false;
let fallosConsecutivos = 0;

async function verificarSalud(client, adminNumero, onReiniciar) {
  try {
    const { error } = await dbQuery(supabase.from('tasas').select('id').limit(1), 8000);
    if (error) throw new Error(`Supabase: ${error.message}`);

    let conectado = true;
    if (typeof client.getConnectionState === 'function') {
      const estado = await client.getConnectionState();
      conectado = estado === 'CONNECTED' || estado === 'OPENING';
      if (!conectado && estado !== 'OPENING') {
        throw new Error(`WhatsApp desconectado (${estado})`);
      }
    }

    fallosConsecutivos = 0;
    return true;
  } catch (err) {
    fallosConsecutivos += 1;
    console.error(`[HEALTH] Fallo ${fallosConsecutivos}:`, err.message);

    if (fallosConsecutivos >= 2 && adminNumero) {
      try {
        await client.sendText(
          adminNumero,
          `🚨 *ALERTA DE SISTEMA*\n\n` +
          `Detecté un problema: ${err.message}\n` +
          `Fallos consecutivos: ${fallosConsecutivos}\n\n` +
          (fallosConsecutivos >= 3 ? '⏳ Intentando reinicio automático...' : '👀 Monitoreando...')
        );
      } catch {
        console.error('[HEALTH] No se pudo alertar al admin.');
      }
    }

    if (fallosConsecutivos >= 3 && onReiniciar && !reiniciando) {
      reiniciando = true;
      console.log('[HEALTH] Iniciando reinicio automático...');
      try {
        await onReiniciar(err.message);
      } finally {
        reiniciando = false;
        fallosConsecutivos = 0;
      }
    }

    return false;
  }
}

function iniciarHealthCheck(client, adminNumero, onReiniciar, intervaloMs = 120000) {
  if (intervalo) clearInterval(intervalo);
  intervalo = setInterval(() => verificarSalud(client, adminNumero, onReiniciar), intervaloMs);
  console.log('[HEALTH] Monitoreo activo cada', intervaloMs / 1000, 'segundos');
}

function detenerHealthCheck() {
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}

function configurarReinicioPorDesconexion(client, adminNumero, onReiniciar) {
  if (typeof client.onStateChange !== 'function') return;

  client.onStateChange((state) => {
    console.log('[HEALTH] Estado WhatsApp:', state);
    if (state === 'DISCONNECTED' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
      setTimeout(async () => {
        if (reiniciando) return;
        try {
          await client.sendText(adminNumero, `⚠️ *WhatsApp desconectado*\nEstado: ${state}\nReiniciando bot...`);
        } catch {}
        reiniciando = true;
        try {
          await onReiniciar(`Estado WhatsApp: ${state}`);
        } finally {
          reiniciando = false;
        }
      }, 5000);
    }
  });
}

module.exports = { iniciarHealthCheck, detenerHealthCheck, verificarSalud, configurarReinicioPorDesconexion };
