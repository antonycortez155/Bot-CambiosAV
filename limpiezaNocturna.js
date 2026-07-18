const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

let job = null;

/**
 * Limpieza diaria a las 02:00 hora Venezuela (America/Caracas).
 * Libera mapas en memoria, logs temporales y fuerza GC si está disponible.
 */
function iniciarLimpiezaNocturna(hooks = {}) {
  detenerLimpiezaNocturna();

  job = cron.schedule(
    '0 2 * * *',
    () => {
      console.log('[LIMPIEZA] Iniciando limpieza nocturna (02:00 VE)...');
      try {
        if (typeof hooks.onLimpieza === 'function') hooks.onLimpieza();

        const tmpDir = path.join(__dirname, 'tmp');
        if (fs.existsSync(tmpDir)) {
          for (const f of fs.readdirSync(tmpDir)) {
            try {
              fs.unlinkSync(path.join(tmpDir, f));
            } catch {
              // ignore
            }
          }
        }

        if (global.gc) {
          global.gc();
          console.log('[LIMPIEZA] GC forzado.');
        }

        const mem = process.memoryUsage();
        console.log(
          `[LIMPIEZA] OK — heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB / rss ${Math.round(mem.rss / 1024 / 1024)}MB`
        );
      } catch (err) {
        console.error('[LIMPIEZA] Error:', err.message);
      }
    },
    { timezone: 'America/Caracas' }
  );

  console.log('[LIMPIEZA] Programada a las 02:00 (hora Venezuela).');
}

function detenerLimpiezaNocturna() {
  if (job) {
    job.stop();
    job = null;
  }
}

module.exports = { iniciarLimpiezaNocturna, detenerLimpiezaNocturna };
