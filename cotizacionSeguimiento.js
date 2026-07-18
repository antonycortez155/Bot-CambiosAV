function prepararDatosDesdeCotizacionRapida(datosDetectados, resultado) {
  const datos = {
    origen: datosDetectados.origen,
    destino: datosDetectados.destino,
    monto: datosDetectados.isUSD ? resultado.montoOrigen : datosDetectados.monto,
    total: resultado.totalFinal,
    tasa_aplicada: resultado.tasaNormal.valor,
    desdeCotizacion: true,
  };

  if (datosDetectados.isUSD && datosDetectados.destino === 'venezuela') {
    datos.isUSD = true;
    datos.isInverso = true;
    datos.monto_usd_solicitado = datosDetectados.monto;
    datos.monto_ves_calculado = resultado.totalBase;
    datos.nombre_tasa = datosDetectados.tasaUsd?.toUpperCase() || 'BCV';
    datos.tasa_final_usd = parseFloat(
      (resultado.totalBase / datosDetectados.monto).toFixed(2)
    );
  }

  return datos;
}

function prepararDatosDesdeCotizacionInversa(datosDetectados, resultado) {
  const datos = {
    origen: datosDetectados.origen,
    destino: datosDetectados.destino,
    monto: resultado.montoOrigen,
    total: resultado.porcentajePromo > 0 ? resultado.montoDestinoConPromo : resultado.montoDestinoFinal,
    tasa_aplicada: resultado.tasaNormal.valor,
    desdeCotizacion: true,
  };

  if (datosDetectados.tipo === 'usd_venezuela') {
    datos.isUSD = true;
    datos.isInverso = true;
    datos.monto_usd_solicitado = datosDetectados.montoUsd;
    datos.monto_ves_calculado = resultado.montoDestinoFinal;
    datos.nombre_tasa = (datosDetectados.tasaUsd || 'bcv').toUpperCase();
    datos.tasa_final_usd = resultado.tasaBcvUsada;
  }

  return datos;
}

function activarSeguimientoCotizacion(estadoCliente, datosEnvio, clienteId, datos) {
  datosEnvio[clienteId] = datos;
  estadoCliente[clienteId] = 'esperando_confirmacion_cotizacion';
}

const PIE_COTIZACION =
  `\n\n¿Deseas *continuar con el envío*?\n(Responde *SÍ* o *NO*)`;

module.exports = {
  prepararDatosDesdeCotizacionRapida,
  prepararDatosDesdeCotizacionInversa,
  activarSeguimientoCotizacion,
  PIE_COTIZACION,
};
