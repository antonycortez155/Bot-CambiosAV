/**
 * Protocolos de estabilidad para servidor 24/7.
 * Evita que un error no capturado tumbe el proceso sin intentar recuperarse.
 */

function registrarProtocolosEstabilidad({ onReiniciar, adminAlert } = {}) {
  let reiniciando = false;

  const intentarRecuperar = async (origen, err) => {
    const msg = err?.message || String(err);
    console.error(`[ESTABILIDAD] ${origen}:`, msg);
    if (reiniciando) return;
    reiniciando = true;
    try {
      if (typeof adminAlert === 'function') {
        await adminAlert(`⚠️ *Bot Lite* — ${origen}\n${msg.slice(0, 200)}\nIntentando recuperar...`).catch(() => {});
      }
      if (typeof onReiniciar === 'function') {
        await onReiniciar(`${origen}: ${msg}`);
      }
    } catch (e) {
      console.error('[ESTABILIDAD] Falló recuperación:', e.message);
    } finally {
      setTimeout(() => {
        reiniciando = false;
      }, 15000);
    }
  };

  process.on('uncaughtException', (err) => {
    intentarRecuperar('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    // No reiniciar por cada rechazo menor: solo loguear salvo errores fatales de browser
    const msg = String(err.message || reason).toLowerCase();
    const fatal =
      msg.includes('page closed') ||
      msg.includes('browser') ||
      msg.includes('target closed') ||
      msg.includes('session closed') ||
      msg.includes('protocol error');
    if (fatal) intentarRecuperar('unhandledRejection', err);
    else console.error('[ESTABILIDAD] unhandledRejection:', err.message || reason);
  });

  process.on('SIGTERM', () => {
    console.log('[ESTABILIDAD] SIGTERM recibido — cierre limpio.');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[ESTABILIDAD] SIGINT recibido — cierre limpio.');
    process.exit(0);
  });

  console.log('[ESTABILIDAD] Protocolos anti-caída activos.');
}

module.exports = { registrarProtocolosEstabilidad };
