const { dbQuery } = require('./supabase');
const { PAUSA_MANUAL_MS } = require('./config');
const { ESTADOS_FLUJO } = require('./recuperacionFlujo');

const pausasManuales = new Map();

function expiracionPausa(clienteId, clientesPausados) {
  const hasta = clientesPausados?.[clienteId];
  if (!hasta) return null;
  if (Date.now() >= hasta) {
    delete clientesPausados[clienteId];
    pausasManuales.delete(clienteId);
    return null;
  }
  return hasta;
}

function fueAtendidoManual(clienteId, clientesPausados) {
  const hasta = pausasManuales.get(clienteId);
  if (!hasta) return false;
  if (Date.now() >= hasta) {
    pausasManuales.delete(clienteId);
    if (clientesPausados) delete clientesPausados[clienteId];
    return false;
  }
  return true;
}

function estaPausado(clienteId, clientesPausados) {
  expiracionPausa(clienteId, clientesPausados);
  return Boolean(clientesPausados?.[clienteId] && Date.now() < clientesPausados[clienteId]);
}

async function limpiarAtencionManualExpirada(supabase, clienteId) {
  pausasManuales.delete(clienteId);
  await dbQuery(
    supabase.from('flujos_activos').upsert([{
      cliente_id: clienteId,
      atendido_manual: false,
      pausado_hasta: null,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'cliente_id' })
  ).catch(() => {});
}

async function persistirFlujo(supabase, clienteId, estado, datos) {
  if (!clienteId || !estado || !ESTADOS_FLUJO.has(estado)) return;

  await dbQuery(
    supabase.from('flujos_activos').upsert([{
      cliente_id: clienteId,
      estado,
      datos: datos || {},
      atendido_manual: false,
      pausado_hasta: null,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'cliente_id' })
  ).catch((err) => console.error('[PERSISTENCIA] Error guardando flujo:', err.message));
}

async function limpiarFlujoPersistido(supabase, clienteId) {
  pausasManuales.delete(clienteId);
  await dbQuery(
    supabase.from('flujos_activos').delete().eq('cliente_id', clienteId)
  ).catch((err) => console.error('[PERSISTENCIA] Error limpiando flujo:', err.message));
}

async function marcarAtencionManual(supabase, clienteId, clientesPausados, duracionMs = PAUSA_MANUAL_MS) {
  const expiry = Date.now() + duracionMs;
  pausasManuales.set(clienteId, expiry);
  clientesPausados[clienteId] = expiry;

  await dbQuery(
    supabase.from('flujos_activos').upsert([{
      cliente_id: clienteId,
      estado: null,
      datos: {},
      atendido_manual: true,
      pausado_hasta: new Date(expiry).toISOString(),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'cliente_id' })
  ).catch((err) => console.error('[PERSISTENCIA] Error marcando atención manual:', err.message));
}

async function cargarFlujosActivos(supabase, estadoCliente, datosEnvio, clientesPausados) {
  const { data: flujos, error } = await dbQuery(
    supabase.from('flujos_activos')
      .select('cliente_id, estado, datos, atendido_manual, pausado_hasta')
      .eq('atendido_manual', false)
      .not('estado', 'is', null)
  );

  if (error) {
    console.error('[PERSISTENCIA] No se pudieron cargar flujos:', error.message);
    return 0;
  }

  let cargados = 0;
  for (const f of flujos || []) {
    if (!f.estado || !ESTADOS_FLUJO.has(f.estado)) continue;
    const datos = f.datos || {};
    // No restaurar flujos vacíos (causan "tu envío" sin sentido)
    const util = datos.origen || datos.destino || datos.monto || datos.montoUsd;
    if (!util && f.estado === 'esperando_origen') {
      await limpiarFlujoPersistido(supabase, f.cliente_id);
      continue;
    }
    estadoCliente[f.cliente_id] = f.estado;
    datosEnvio[f.cliente_id] = datos;
    cargados++;
  }

  const { data: atendidos } = await dbQuery(
    supabase.from('flujos_activos')
      .select('cliente_id, pausado_hasta')
      .eq('atendido_manual', true)
  );

  for (const a of atendidos || []) {
    const pausaHasta = a.pausado_hasta ? new Date(a.pausado_hasta).getTime() : 0;
    if (pausaHasta > Date.now()) {
      pausasManuales.set(a.cliente_id, pausaHasta);
      clientesPausados[a.cliente_id] = pausaHasta;
    } else {
      await limpiarAtencionManualExpirada(supabase, a.cliente_id);
    }
  }

  if (cargados > 0) console.log(`[PERSISTENCIA] ${cargados} flujo(s) restaurado(s) desde Supabase.`);
  return cargados;
}

async function sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio) {
  const estado = estadoCliente[clienteId];
  if (!estado || !ESTADOS_FLUJO.has(estado)) return;
  await persistirFlujo(supabase, clienteId, estado, datosEnvio[clienteId]);
}

async function reactivarCliente(supabase, clienteId, clientesPausados) {
  pausasManuales.delete(clienteId);
  delete clientesPausados[clienteId];

  await dbQuery(
    supabase.from('flujos_activos').upsert([{
      cliente_id: clienteId,
      estado: null,
      datos: {},
      atendido_manual: false,
      pausado_hasta: null,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'cliente_id' })
  ).catch((err) => console.error('[PERSISTENCIA] Error reactivando cliente:', err.message));
}

module.exports = {
  persistirFlujo,
  limpiarFlujoPersistido,
  marcarAtencionManual,
  fueAtendidoManual,
  estaPausado,
  cargarFlujosActivos,
  sincronizarEstadoCliente,
  reactivarCliente,
};
