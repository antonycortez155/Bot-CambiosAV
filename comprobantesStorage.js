const { dbQuery } = require('./supabase');

const BUCKET = 'comprobantes-remesas';
const EXPIRACION_URL_SEG = 86400;

async function subirComprobante(supabase, buffer, fileName, contentType) {
  const { error } = await dbQuery(
    supabase.storage.from(BUCKET).upload(fileName, buffer, {
      contentType,
      upsert: false,
    })
  );
  if (error) throw error;
  return fileName;
}

async function crearUrlFirmada(supabase, bucketPath, expiresIn = EXPIRACION_URL_SEG) {
  if (!bucketPath) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(bucketPath, expiresIn);

  if (error) {
    console.error('[STORAGE] Error creando URL firmada:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

function extraerRutaDesdeUrl(url) {
  if (!url || !url.startsWith('http')) return url;

  const patrones = [
    /\/storage\/v1\/object\/(?:public|sign)\/comprobantes-remesas\/([^?]+)/,
    /comprobantes-remesas\/([^?]+)/,
  ];

  for (const p of patrones) {
    const m = url.match(p);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

async function resolverUrlComprobante(supabase, urlOrPath) {
  if (!urlOrPath) return null;

  const ruta = extraerRutaDesdeUrl(urlOrPath) || urlOrPath;
  if (!ruta.startsWith('comprobante_') && !ruta.includes('.')) {
    return urlOrPath.startsWith('http') ? urlOrPath : null;
  }

  const firmada = await crearUrlFirmada(supabase, ruta);
  return firmada || (urlOrPath.startsWith('http') ? urlOrPath : null);
}

module.exports = {
  BUCKET,
  EXPIRACION_URL_SEG,
  subirComprobante,
  crearUrlFirmada,
  resolverUrlComprobante,
  extraerRutaDesdeUrl,
};
