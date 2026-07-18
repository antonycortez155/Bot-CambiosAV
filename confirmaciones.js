const SI_EXACTOS = new Set(['si', 'sí', 'yes', 'y', '1']);
const NO_EXACTOS = new Set(['no', 'n', '2']);

const SI_PATRONES = /\b(dale|ok|okay|listo|confirmo|confirmar|de acuerdo|perfecto|claro|va|vamos|adelante|hagamoslo|hagámoslo|acepto|afirmativo|por supuesto|bueno|sim|sep|see|sii+)\b/i;
const NO_PATRONES = /\b(nop|nope|negativo|cancelar|cancela|mejor no|no gracias|olvidalo|olvídalo|nah|nel)\b/i;

function normalizarConfirmacion(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esSi(texto) {
  const t = normalizarConfirmacion(texto);
  if (!t) return false;
  if (SI_EXACTOS.has(t) || t === 'si') return true;
  if (t.length <= 12 && SI_PATRONES.test(t)) return true;
  return false;
}

function esNo(texto) {
  const t = normalizarConfirmacion(texto);
  if (!t) return false;
  if (NO_EXACTOS.has(t) || t === 'no') return true;
  if (t.length <= 20 && NO_PATRONES.test(t)) return true;
  return false;
}

function esCancelarFlujo(texto) {
  const t = normalizarConfirmacion(texto);
  return t === 'cancelar' || t === 'cancela' || t === 'salir' || t === 'reiniciar';
}

module.exports = { esSi, esNo, esCancelarFlujo, normalizarConfirmacion };
