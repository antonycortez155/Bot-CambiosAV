const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

let job = null;

const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'blob_storage'];

function limpiarDirSiExiste(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const st = fs.lstatSync(full);
        if (st.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
      } catch {
        // archivo en uso por Chrome
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Limpia caches de disco de Chromium (no toca IndexedDB/cookies de sesión).
 */
function limpiarCachesChromeSesion(sessionName = 'cambios-ayv-lite') {
  const sessionDir = path.join(__dirname, 'tokens', sessionName);
  if (!fs.existsSync(sessionDir)) return;

  const candidatos = [sessionDir];
  try {
    for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidatos.push(path.join(sessionDir, entry.name));
    }
  } catch {
    // ignore
  }

  for (const base of candidatos) {
    for (const nombre of CACHE_DIRS) {
      limpiarDirSiExiste(path.join(base, nombre));
    }
  }
}

/**
 * Limpieza diaria a las 02:00 hora Venezuela (America/Caracas).
 * Libera mapas en memoria, caches de Chrome en disco y fuerza GC si está disponible.
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

        limpiarCachesChromeSesion(hooks.sessionName || 'cambios-ayv-lite');

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

module.exports = { iniciarLimpiezaNocturna, detenerLimpiezaNocturna, limpiarCachesChromeSesion };
