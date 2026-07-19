const colasPorCliente = new Map();
const MAX_COLAS = 200;

function encolar(clienteId, tarea) {
  // No evictar colas activas: borrar keys rompe la serialización por cliente
  if (!colasPorCliente.has(clienteId) && colasPorCliente.size >= MAX_COLAS) {
    console.warn(`[COLA] Capacidad llena (${MAX_COLAS}), ignorando ${clienteId}`);
    return Promise.resolve();
  }

  const anterior = colasPorCliente.get(clienteId) || Promise.resolve();
  const siguiente = anterior
    .then(() => tarea())
    .catch((err) => {
      console.error(`[COLA] Error procesando mensaje de ${clienteId}:`, err.message || err);
    })
    .finally(() => {
      if (colasPorCliente.get(clienteId) === siguiente) {
        colasPorCliente.delete(clienteId);
      }
    });

  colasPorCliente.set(clienteId, siguiente);
  return siguiente;
}

module.exports = { encolar };
