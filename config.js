require('dotenv').config({ quiet: true });

function requerirEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`❌ Falta la variable de entorno ${nombre} en .env`);
    process.exit(1);
  }
  return valor;
}

const SUPABASE_URL = requerirEnv('SUPABASE_URL');
const SUPABASE_KEY = requerirEnv('SUPABASE_KEY');

const ADMIN_NUMEROS = (process.env.ADMIN_NUMEROS || '')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);

const ADMIN_TELEFONOS = (process.env.ADMIN_TELEFONOS || '')
  .split(',')
  .map((n) => n.replace(/\D/g, ''))
  .filter((n) => n.length >= 8);

if (ADMIN_NUMEROS.length === 0 && ADMIN_TELEFONOS.length === 0) {
  console.warn('⚠️ ADMIN_NUMEROS no configurado en .env — los comandos admin no funcionarán.');
}

function obtenerDestinosNotificacion() {
  const explicitos = (process.env.ADMIN_NOTIFICACION || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (explicitos.length > 0) return explicitos;

  const cuentasClasicas = ADMIN_NUMEROS.filter((id) => id.endsWith('@c.us'));
  if (cuentasClasicas.length > 0) return cuentasClasicas;

  return ADMIN_NUMEROS.length > 0 ? [ADMIN_NUMEROS[0]] : [];
}

const ADMIN_DESTINOS_NOTIFICACION = obtenerDestinosNotificacion();

const PAUSA_MANUAL_MS = 30 * 60 * 1000;
const PAUSA_USUARIO_MS = 60 * 60 * 1000;

const LIMITES = {
  MONTO_MINIMO: 1,
  MONTO_MAXIMO: 500000000,
  COMPROBANTE_MAX_BYTES: 3 * 1024 * 1024, // Lite: 3 MB para acotar picos de RAM
  COMENTARIO_MAX_CHARS: 500,
  BUSQUEDA_MAX_CHARS: 50,
};

module.exports = {
  SUPABASE_URL,
  SUPABASE_KEY,
  ADMIN_NUMEROS,
  ADMIN_TELEFONOS,
  ADMIN_DESTINOS_NOTIFICACION,
  PAUSA_MANUAL_MS,
  PAUSA_USUARIO_MS,
  LIMITES,
};
