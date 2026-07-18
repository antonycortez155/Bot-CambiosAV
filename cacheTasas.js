const TTL_MS = 5 * 60 * 1000;

const cache = {
  tasas: { data: null, expires: 0 },
  dolarVenezuela: { data: null, expires: 0 },
  promociones: { data: null, expires: 0 },
  rutas: new Map(),
};

function expirado(entry) {
  return !entry?.data || Date.now() > entry.expires;
}

function guardar(entry, data) {
  entry.data = data;
  entry.expires = Date.now() + TTL_MS;
  return data;
}

async function obtenerTodasLasTasas(supabase, dbQuery) {
  if (!expirado(cache.tasas)) return cache.tasas.data;
  const { data, error } = await dbQuery(supabase.from('tasas').select('*'));
  if (error) throw error;
  guardar(cache.tasas, data || []);
  cache.rutas.clear();
  return cache.tasas.data;
}

async function obtenerTasaRuta(supabase, dbQuery, origen, destino) {
  const key = `${origen}:${destino}`;
  const cached = cache.rutas.get(key);
  if (cached && Date.now() < cached.expires) return cached.data;

  const tasas = await obtenerTodasLasTasas(supabase, dbQuery);
  const tasa = tasas.find((t) => t.origen === origen && t.destino === destino) || null;
  cache.rutas.set(key, { data: tasa, expires: Date.now() + TTL_MS });
  return tasa;
}

async function obtenerDolarVenezuela(supabase, dbQuery) {
  if (!expirado(cache.dolarVenezuela)) return cache.dolarVenezuela.data;
  const { data, error } = await dbQuery(
    supabase.from('dolar_venezuela').select('*').eq('id', 1).single()
  );
  if (error) throw error;
  return guardar(cache.dolarVenezuela, data);
}

async function obtenerPromocionesActivas(supabase, dbQuery) {
  if (!expirado(cache.promociones)) return cache.promociones.data;
  const ahoraIso = new Date().toISOString();
  const { data, error } = await dbQuery(
    supabase.from('promociones')
      .select('*')
      .eq('activa', true)
      .lte('fecha_inicio', ahoraIso)
      .gt('fecha_vencimiento', ahoraIso)
  );
  if (error) throw error;
  return guardar(cache.promociones, data || []);
}

function invalidarCacheTasas() {
  cache.tasas = { data: null, expires: 0 };
  cache.dolarVenezuela = { data: null, expires: 0 };
  cache.promociones = { data: null, expires: 0 };
  cache.rutas.clear();
}

module.exports = {
  obtenerTasaRuta,
  obtenerTodasLasTasas,
  obtenerDolarVenezuela,
  obtenerPromocionesActivas,
  invalidarCacheTasas,
};
