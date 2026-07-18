const colasPorCliente = new Map();
const MAX_COLAS = 300;

function encolar(clienteId, tarea) {
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

  if (colasPorCliente.size > MAX_COLAS) {
    const excess = colasPorCliente.size - MAX_COLAS;
    const keys = [...colasPorCliente.keys()].slice(0, excess);
    keys.forEach((k) => colasPorCliente.delete(k));
  }

  return siguiente;
}

module.exports = { encolar };
