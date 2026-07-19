const VENTANA_MS = 60000;
const MAX_MENSAJES = 10;
const MAX_KEYS = 400;
const mensajesRecientes = new Map();

function podarRateLimit(ahora = Date.now()) {
  for (const [id, ts] of mensajesRecientes) {
    const vigentes = ts.filter((t) => ahora - t < VENTANA_MS);
    if (vigentes.length === 0) mensajesRecientes.delete(id);
    else mensajesRecientes.set(id, vigentes);
  }
}

function excedeRateLimit(clienteId, esAdmin = false) {
  if (esAdmin) return false;

  const ahora = Date.now();
  const historial = (mensajesRecientes.get(clienteId) || []).filter((t) => ahora - t < VENTANA_MS);
  historial.push(ahora);
  mensajesRecientes.set(clienteId, historial);

  if (mensajesRecientes.size > MAX_KEYS) podarRateLimit(ahora);

  return historial.length > MAX_MENSAJES;
}

module.exports = { excedeRateLimit, podarRateLimit };
