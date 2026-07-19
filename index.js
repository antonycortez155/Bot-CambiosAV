require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const wppconnect = require('@wppconnect-team/wppconnect');
const winston = require('winston');
// Silenciar spam debug (Emitting onAnyMessage, Exposing function, etc.)
try {
  wppconnect.defaultLogger.level = 'error';
  for (const t of wppconnect.defaultLogger.transports || []) {
    t.level = 'error';
  }
} catch {
  // ignore
}
const { supabase, dbQuery } = require('./supabase');
const { ADMIN_NUMEROS, ADMIN_DESTINOS_NOTIFICACION, LIMITES, PAUSA_USUARIO_MS } = require('./config');
const { esAdministrador } = require('./auth');
const { encolar } = require('./cola');
const { excedeRateLimit, podarRateLimit } = require('./rateLimit');
const { iniciarHealthCheck, detenerHealthCheck, configurarReinicioPorDesconexion } = require('./healthCheck');
const { programarRecordatorio, cancelarRecordatorio } = require('./recordatorioComprobante');
const {
  registrarActividad,
  guardarSnapshot,
  limpiarFlujo,
  limpiarFlujosExpirados,
  manejarReanudacion,
  ESTADOS_FLUJO,
} = require('./recuperacionFlujo');
const { manejarIntencionCliente } = require('./intenciones');
const { manejarComandos } = require('./comandos');
const { iniciarProgramadorDifusiones, detenerProgramadorDifusiones } = require('./difusiones');
const { manejarAgradecimiento } = require('./agradecimientos');
const { manejarSaludo, limpiarRegistroSaludos } = require('./saludos');
const { subirComprobante } = require('./comprobantesStorage');
const { formatearMoneda, esChatPrivado, validarBufferImagen, capitalizar } = require('./utils');
const { ESTADOS_FLUJO_ENVIO } = require('./constantesEnvio');
const { manejarFlujoEnvio } = require('./flujoEnvio');
const { envolverCliente, fueEnvioBot, limpiarEnviosRecientes } = require('./botEnvio');
const {
  cargarFlujosActivos,
  marcarAtencionManual,
  limpiarFlujoPersistido,
  sincronizarEstadoCliente,
  fueAtendidoManual,
  estaPausado,
} = require('./persistenciaFlujo');
const {
  extraerTextoRespuesta,
  manejarCancelacionFlujo,
  debeProcesarIntenciones,
  ESTADOS_SOLO_CONFIRMACION,
} = require('./contextoMensaje');
const { esCancelarFlujo, esSi, esNo } = require('./confirmaciones');
const {
  detectarHandoff,
  activarHandoff,
  registrarIntentoFallido,
  resetearIntentos,
  interpretarMenuFallback,
  enviarMenuFallback,
  limpiarCooldownExpirados,
} = require('./handoffHumano');
const { consultarEstadoEnvio } = require('./clienteConsultas');
const { iniciarLimpiezaNocturna, detenerLimpiezaNocturna } = require('./limpiezaNocturna');
const { registrarProtocolosEstabilidad } = require('./estabilidad');
const { invalidarCacheTasas } = require('./cacheTasas');

const estadoCliente = {};
const clientesPausados = {};
const datosEnvio = {};
const timersEncuesta = new Map();
const SESSION_NAME = 'cambios-ayv-lite';
const MAX_INTENTOS_ARRANQUE = 5;
let clientGlobal = null;
let reinicioEnCurso = false;
let canalRealtime = null;
let intentosArranque = 0;
const mensajesProcesados = new Map();
const TTL_MENSAJE_MS = 60000;
const MAX_MENSAJES_CACHE = 250;

/** Flags Chrome/Chromium agresivos para ~1 GB RAM (aplicar en browserArgs y puppeteer). */
const CHROME_LITE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--mute-audio',
  '--disable-notifications',
  '--disable-popup-blocking',
  '--disable-hang-monitor',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-client-side-phishing-detection',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--metrics-recording-only',
  '--renderer-process-limit=1',
  '--disk-cache-size=1',
  '--media-cache-size=1',
  '--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess,IsolateOrigins,site-per-process,CalculateNativeWinOcclusion,InterestFeedContentSuggestions',
  '--js-flags=--max-old-space-size=192',
];

function esMensajeDuplicado(message) {
  const id = message.id?._serialized || message.id;
  if (!id) return false;

  const ahora = Date.now();
  const previo = mensajesProcesados.get(id);
  if (previo && ahora - previo < TTL_MENSAJE_MS) return true;

  mensajesProcesados.set(id, ahora);
  if (mensajesProcesados.size > MAX_MENSAJES_CACHE) {
    for (const [key, ts] of mensajesProcesados) {
      if (ahora - ts > TTL_MENSAJE_MS) mensajesProcesados.delete(key);
    }
  }
  return false;
}

function matarChromeSesion(session = SESSION_NAME) {
  try {
    if (process.platform === 'win32') {
      const filtro = session.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${filtro}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 15000 }
      );
    } else {
      execSync(`pkill -f "${session}" 2>/dev/null || true`, { stdio: 'ignore', timeout: 10000 });
    }
  } catch {
    // Sin procesos huérfanos de esta sesión
  }
}

function limpiarLocksSesion(session = SESSION_NAME) {
  const dir = path.join(__dirname, 'tokens', session);
  for (const nombre of [
    'lockfile',
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie',
    'DevToolsActivePort',
  ]) {
    try {
      const archivo = path.join(dir, nombre);
      if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
    } catch {
      // Chrome aún activo en otro proceso
    }
  }
}

function liberarSesionBloqueada(session = SESSION_NAME) {
  matarChromeSesion(session);
  limpiarLocksSesion(session);
}

function esErrorArranqueRecuperable(error) {
  const msg = String(error?.message || error).toLowerCase();
  return (
    msg.includes('browser is already running') ||
    msg.includes('target closed') ||
    msg.includes('page closed') ||
    msg.includes('protocol error') ||
    msg.includes('session closed')
  );
}

function limpiarMemoriaExpirada() {
  const ahora = Date.now();
  Object.keys(clientesPausados).forEach((id) => {
    if (clientesPausados[id] <= ahora) delete clientesPausados[id];
  });
  for (const [key, ts] of mensajesProcesados) {
    if (ahora - ts > TTL_MENSAJE_MS) mensajesProcesados.delete(key);
  }
  // Evitar mapas huérfanos sin flujo activo
  for (const id of Object.keys(estadoCliente)) {
    if (!estadoCliente[id] && !datosEnvio[id]) {
      delete estadoCliente[id];
      delete datosEnvio[id];
    }
  }
  limpiarCooldownExpirados();
  limpiarFlujosExpirados(ahora);
  limpiarRegistroSaludos(ahora);
  podarRateLimit(ahora);
  limpiarEnviosRecientes(ahora);
}

function limpiezaProfunda() {
  limpiarMemoriaExpirada();
  invalidarCacheTasas();
  // No cancelar timersEncuesta: la encuesta diferida (3 min) debe completarse
  mensajesProcesados.clear();
  if (global.gc) global.gc();
}

function cancelarTimersEncuesta() {
  for (const timerId of timersEncuesta.values()) clearTimeout(timerId);
  timersEncuesta.clear();
}

setInterval(limpiarMemoriaExpirada, 300000);

async function manejarIntervencionManual(chatId) {
  const estado = estadoCliente[chatId];
  if (estado === 'esperando_comprobante') {
    console.log(`[MANUAL] Admin envió datos de pago a ${chatId} — el bot sigue activo para el comprobante.`);
    return;
  }

  const teniaFlujo = ESTADOS_FLUJO.has(estado) || datosEnvio[chatId];
  if (!teniaFlujo) return;

  delete estadoCliente[chatId];
  delete datosEnvio[chatId];
  limpiarFlujo(chatId);
  cancelarRecordatorio(chatId);
  await marcarAtencionManual(supabase, chatId, clientesPausados);
  console.log(`[MANUAL] Cliente ${chatId} atendido manualmente — flujo limpiado y bot pausado 30 min.`);
}

function habilitarEscuchadorRealtime(client) {
  console.log('📡 Escuchando cambios en transacciones desde la nube...');

  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null;
  }

  canalRealtime = supabase
    .channel('cambios-transacciones')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'transacciones',
    }, async (payload) => {
      try {
        const anterior = payload.old || {};
        const nuevo = payload.new;
        if (!nuevo?.cliente_id || !nuevo?.estado) return;

        if (anterior.estado !== 'completado' && nuevo.estado === 'completado') {
          const clienteId = nuevo.cliente_id;
          const monto = nuevo.monto_recibido;
          const paisDestino = nuevo.pais_destino;

          try {
            await client.sendText(
              clienteId,
              `✅ *¡TU ENVÍO HA SIDO COMPLETADO!* 🚀\n\n` +
              `💰 Hemos depositado con éxito: *${formatearMoneda(monto, paisDestino)}*.\n\n` +
              `🙏 Gracias por confiar en *Cambios AV*. Es un placer servirte.`
            );

            const timerId = setTimeout(async () => {
              try {
                const { data: encuestasPrevias } = await dbQuery(
                  supabase.from('encuestas').select('id').eq('cliente_id', clienteId).limit(1)
                );

                if (encuestasPrevias?.length > 0) return;

                estadoCliente[clienteId] = 'esperando_calificacion';
                datosEnvio[clienteId] = { transaccion_id_encuesta: nuevo.id };

                await client.sendText(
                  clienteId,
                  `✨ Tu opinión nos importa ✨ ¿Cómo calificarías tu experiencia con Cambios AV? 💛\n\n` +
                  `Por favor, responde con un número del *1 al 5*:\n\n` +
                  `5️⃣ Excelente 🌟\n4️⃣ Muy buena 😊\n3️⃣ Aceptable 🙂\n2️⃣ Regular 😕\n1️⃣ Mala 😞`
                );
                await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);
              } catch (err) {
                console.log('Error al enviar encuesta diferida:', err.message);
              } finally {
                timersEncuesta.delete(clienteId);
              }
            }, 180000);
            timersEncuesta.set(clienteId, timerId);
          } catch {
            console.log(`⚠️ No se pudo notificar al cliente ${clienteId}.`);
          }
        }
      } catch (err) {
        console.error('[REALTIME] Error procesando cambio:', err.message);
      }
    })
    .subscribe();
}

async function reiniciarBot(motivo) {
  if (reinicioEnCurso) return;
  reinicioEnCurso = true;
  console.log('[REINICIO] Motivo:', motivo);

  detenerHealthCheck();
  detenerProgramadorDifusiones();
  detenerLimpiezaNocturna();
  cancelarTimersEncuesta();
  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null;
  }
  if (clientGlobal) {
    try {
      await clientGlobal.close();
    } catch (err) {
      console.log('[REINICIO] Error cerrando sesión:', err.message);
    }
    clientGlobal = null;
  }

  await new Promise((r) => setTimeout(r, 8000));
  liberarSesionBloqueada();
  reinicioEnCurso = false;
  await iniciarBot();
}

async function iniciarBot() {
  console.log('🚀 Iniciando Cambios AV Lite (bajo consumo / 24/7)...');
  try {
    liberarSesionBloqueada();

    const client = await wppconnect.create({
      session: SESSION_NAME,
      folderNameToken: 'tokens',
      headless: true,
      autoClose: 0,
      deviceSyncTimeout: 180000,
      useChrome: true,
      debug: false,
      logQR: true,
      updatesLog: false,
      disableWelcome: true,
      waitForLogin: true,
      // Silencia spam debug de WPPConnect (onAnyMessage, etc.)
      logger: winston.createLogger({
        level: 'error',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message }) => `${level}: ${message}`)
        ),
        transports: [new winston.transports.Console()],
      }),
      puppeteerOptions: {
        protocolTimeout: 180000,
        handleSIGINT: false,
        handleSIGTERM: false,
        args: [...CHROME_LITE_ARGS],
      },
      browserArgs: [...CHROME_LITE_ARGS],
    });
    clientGlobal = envolverCliente(client);
    intentosArranque = 0;
    start(clientGlobal);
  } catch (error) {
    if (esErrorArranqueRecuperable(error) && intentosArranque < MAX_INTENTOS_ARRANQUE) {
      intentosArranque += 1;
      console.warn(
        `[ARRANQUE] Error de sesión (${intentosArranque}/${MAX_INTENTOS_ARRANQUE}): ${error.message}`
      );
      liberarSesionBloqueada();
      await new Promise((r) => setTimeout(r, 10000));
      return iniciarBot();
    }
    console.error('❌ Error arrancando el bot Lite:', error.message || error);
    setTimeout(() => reiniciarBot(error.message || 'arranque'), 20000);
  }
}

async function procesarMensajeEntrante(client, message) {
  if (esMensajeDuplicado(message)) return;

  const chatId = message.from;
  let clienteId = message.author || message.from;
  if (clienteId.includes(':')) clienteId = clienteId.replace(/:\d+/, '');

  if (estaPausado(clienteId, clientesPausados)) {
    if (estadoCliente[clienteId] === 'esperando_comprobante') {
      // Permitir la imagen del comprobante aunque esté en pausa; texto solo recuerda
      if (!(message.isMedia || message.mimetype)) {
        return client.sendText(chatId, '📸 Envía una *imagen* (captura) de tu comprobante de pago.');
      }
    } else {
      return;
    }
  }

  const esAdmin = esAdministrador(clienteId);
  if (excedeRateLimit(clienteId, esAdmin)) {
    console.log(`[RATE LIMIT] Cliente ${clienteId} excedió límite de mensajes.`);
    return;
  }

  registrarActividad(clienteId);
  guardarSnapshot(clienteId, estadoCliente, datosEnvio);

  if (message.isMedia || message.mimetype) {
    if (estadoCliente[clienteId] === 'esperando_comprobante' && datosEnvio[clienteId]?.transaccion_id) {
      try {
        const transaccionId = datosEnvio[clienteId].transaccion_id;

        const { data: transPendiente, error: transError } = await dbQuery(
          supabase.from('transacciones')
            .select('id, cliente_id, estado')
            .eq('id', transaccionId)
            .eq('cliente_id', clienteId)
            .eq('estado', 'pendiente')
            .single()
        );

        if (transError || !transPendiente) {
          return client.sendText(chatId, '❌ No tienes un envío pendiente válido para este comprobante.');
        }

        const mime = (message.mimetype || '').toLowerCase();
        if (mime && !mime.startsWith('image/')) {
          return client.sendText(chatId, '❌ Solo se aceptan imágenes (JPG, PNG). Envía una captura de tu comprobante.');
        }

        let buffer = await client.decryptFile(message);
        if (!buffer) {
          return client.sendText(chatId, '❌ No pude leer la imagen. Envía de nuevo la captura (JPG o PNG).');
        }
        if (buffer.length > LIMITES.COMPROBANTE_MAX_BYTES) {
          buffer = null;
          return client.sendText(chatId, '❌ Imagen demasiado grande. Máximo 3 MB.');
        }

        const formato = validarBufferImagen(buffer);
        if (!formato) {
          buffer = null;
          return client.sendText(chatId, '❌ Archivo no válido. Envía una imagen JPG o PNG de tu comprobante.');
        }

        const numeroLimpio = clienteId.replace('@c.us', '').replace('@lid', '');
        const fileName = `comprobante_${numeroLimpio}_${Date.now()}.${formato.ext}`;
        const mimeTipo = formato.mime;

        await subirComprobante(supabase, buffer, fileName, mimeTipo);

        await dbQuery(supabase.from('comprobantes').insert([{
          transaccion_id: transaccionId,
          cliente_id: clienteId,
          nombre_archivo: fileName,
          bucket_path: fileName,
          url_publica: fileName,
          tipo_archivo: 'imagen',
        }]));

        const { data: actualizado, error: updateError } = await dbQuery(
          supabase.from('transacciones')
            .update({
              comprobante_url: fileName,
              estado: 'revisando',
            })
            .eq('id', transaccionId)
            .eq('cliente_id', clienteId)
            .eq('estado', 'pendiente')
            .select('id')
            .single()
        );

        if (updateError || !actualizado) {
          buffer = null;
          return client.sendText(
            chatId,
            '✅ Ya recibimos tu comprobante. Nuestro equipo lo está revisando.'
          );
        }

        cancelarRecordatorio(clienteId);
        limpiarFlujo(clienteId);
        await limpiarFlujoPersistido(supabase, clienteId);
        estadoCliente[clienteId] = null;
        delete datosEnvio[clienteId];

        await client.sendText(
          chatId,
          `📸 *¡Comprobante recibido exitosamente!*\n\n` +
          `⏳ Nuestro equipo está verificando tu pago.\n\n` +
          `🏦 Para acelerar tu envío, por favor indícanos los *datos de la cuenta destino* a continuación.`
        );

        const { data: clienteData } = await dbQuery(
          supabase.from('clientes').select('nro_cliente, nombre').eq('id', clienteId).single()
        );
        const idCorto = clienteData?.nro_cliente ?? 'Nuevo';
        const nombreCliente = clienteData?.nombre || message.sender?.pushname || 'Usuario';

        const { data: transDetalle } = await dbQuery(
          supabase.from('transacciones')
            .select('pais_origen, pais_destino, monto_enviado, monto_recibido, metodo_pago')
            .eq('id', transaccionId)
            .single()
        );

        const ruta = transDetalle
          ? `${capitalizar(transDetalle.pais_origen)} → ${capitalizar(transDetalle.pais_destino)}`
          : 'Sin datos';
        const montoEnviado = transDetalle
          ? formatearMoneda(transDetalle.monto_enviado, transDetalle.pais_origen)
          : 'N/D';
        const montoRecibido = transDetalle
          ? formatearMoneda(transDetalle.monto_recibido, transDetalle.pais_destino)
          : 'N/D';
        const metodo = transDetalle?.metodo_pago || 'N/D';

        const avisoAdmin =
          `📥 *NUEVA SOLICITUD DE REVISIÓN* 📑\n\n` +
          `👤 Cliente #${idCorto}: ${nombreCliente}\n` +
          `🗺️ Ruta: ${ruta}\n` +
          `💰 Envía: ${montoEnviado}\n` +
          `💵 Recibe: ${montoRecibido}\n` +
          `💳 Método: ${metodo}\n` +
          `⏳ Estado: REVISANDO\n\n` +
          `👉 Aprobar: *!ok ${idCorto}*\n` +
          `📸 Ver comprobante: *!comprobante ${idCorto}*`;

        // Base64 solo al notificar (1.er admin); libera buffer de inmediato
        let imagenBase64 = buffer
          ? `data:${mimeTipo};base64,${buffer.toString('base64')}`
          : null;
        buffer = null;

        const destinos = ADMIN_DESTINOS_NOTIFICACION;
        for (let i = 0; i < destinos.length; i++) {
          const admin = destinos[i];
          try {
            if (i === 0 && imagenBase64) {
              await client.sendImageFromBase64(admin, imagenBase64, fileName, avisoAdmin);
              imagenBase64 = null;
            } else {
              await client.sendText(admin, avisoAdmin);
            }
          } catch (err) {
            console.warn(`[COMPROBANTE] No se pudo notificar a ${admin}:`, err.message);
            await client.sendText(admin, avisoAdmin).catch(() => {});
          }
        }
        imagenBase64 = null;
        if (global.gc) global.gc();
        resetearIntentos(clienteId);
        return;
      } catch (err) {
        console.error('❌ Error procesando comprobante:', err.message);
        return client.sendText(chatId, '❌ Error al procesar la imagen. Intenta de nuevo.');
      }
    }
    if (estadoCliente[clienteId] === 'esperando_comprobante') {
      return client.sendText(chatId, '📸 Envía una *imagen* (captura) de tu comprobante de pago.');
    }
    return;
  }

  if (!message.body) return;
  const texto = extraerTextoRespuesta(message);

  const siNoCorto = /^(si|sí|no|n|yes|nop|nope)$/i.test((texto || '').trim());
  if (estadoCliente[clienteId] === 'esperando_reanudacion' || siNoCorto) {
    const reanudoEarly = await manejarReanudacion(
      client, chatId, clienteId, texto, estadoCliente, datosEnvio,
      { supabase, limpiarFlujoPersistido }
    );
    if (reanudoEarly !== false) {
      resetearIntentos(clienteId);
      return;
    }
    if (!estadoCliente[clienteId] && siNoCorto) {
      limpiarFlujo(clienteId);
      delete datosEnvio[clienteId];
      await limpiarFlujoPersistido(supabase, clienteId).catch(() => {});
      resetearIntentos(clienteId);
      return client.sendText(
        chatId,
        esNo(texto)
          ? '✅ Listo, no hay ningún envío pendiente.\n\nEscribe *"quiero enviar"* o cuéntame tu cotización cuando quieras.'
          : 'ℹ️ Ahora mismo no tengo un envío pendiente para continuar.\n\nEscribe *"quiero enviar"* para empezar.'
      );
    }
  }

  const contexto = {
    chatId, clienteId, esAdmin, texto, estadoCliente, datosEnvio, formatearMoneda, clientesPausados,
  };

  if (texto.startsWith('!')) {
    await manejarComandos(client, message, contexto);
    return;
  }

  if (texto === 'stop' || texto === 'alto') {
    clientesPausados[clienteId] = Date.now() + PAUSA_USUARIO_MS;
    return client.sendText(
      chatId,
      '📴 *BOT DESACTIVADO*\n\nHas pausado mis respuestas por 1 hora. No te responderé durante este tiempo a menos que un administrador me reactive. ¡Hasta luego! 👋'
    );
  }

  if (estadoCliente[clienteId] === 'esperando_calificacion') {
    if (!datosEnvio[clienteId]) {
      estadoCliente[clienteId] = null;
      return;
    }
    const calificacionMatch = texto.match(/^[1-5]$/);
    if (!calificacionMatch) return client.sendText(chatId, '⚠ Responde con un número del 1 al 5.');

    datosEnvio[clienteId].calificacion = parseInt(calificacionMatch[0], 10);
    estadoCliente[clienteId] = 'esperando_comentario';
    await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);
    return client.sendText(chatId, '📝 ¡Gracias! ¿Deseas dejar algún comentario o sugerencia? (Escribe "No" para omitir)');
  }

  if (estadoCliente[clienteId] === 'esperando_comentario') {
    if (!datosEnvio[clienteId]?.transaccion_id_encuesta) {
      estadoCliente[clienteId] = null;
      return;
    }
    const comentario = (texto === 'no' || texto === 'nop')
      ? null
      : (message.body || '').slice(0, LIMITES.COMENTARIO_MAX_CHARS);
    await dbQuery(supabase.from('encuestas').insert([{
      transaccion_id: datosEnvio[clienteId].transaccion_id_encuesta,
      cliente_id: clienteId,
      calificacion: datosEnvio[clienteId].calificacion,
      comentario,
    }]));
    estadoCliente[clienteId] = null;
    delete datosEnvio[clienteId];
    await limpiarFlujoPersistido(supabase, clienteId);
    resetearIntentos(clienteId);
    return client.sendText(chatId, '✨ ¡Tu opinión ha sido registrada! Gracias por ayudarnos a mejorar.');
  }

  if (fueAtendidoManual(clienteId, clientesPausados)) {
    return;
  }

  if (esCancelarFlujo(texto)) {
    const cancelado = await manejarCancelacionFlujo(
      clienteId, estadoCliente, datosEnvio, limpiarFlujo, limpiarFlujoPersistido, supabase
    );
    if (cancelado) {
      return client.sendText(chatId, '❌ Envío cancelado. Escribe *"quiero enviar"* cuando quieras empezar de nuevo.');
    }
  }

  const enFlujoEnvio = ESTADOS_FLUJO_ENVIO.has(estadoCliente[clienteId]);
  const menuOpcion = interpretarMenuFallback(texto, { enFlujo: enFlujoEnvio });
  if (menuOpcion === 'estado') {
    resetearIntentos(clienteId);
    return consultarEstadoEnvio(client, chatId, supabase, clienteId);
  }
  if (menuOpcion === 'asesor') {
    resetearIntentos(clienteId);
    return activarHandoff({
      client, workspace: message, chatId, clienteId, texto, estadoCliente, datosEnvio,
      adminNumeros: ADMIN_NUMEROS, marcarAtencionManual, limpiarFlujo, supabase, clientesPausados,
    });
  }
  if ((menuOpcion === 'cotizar' || menuOpcion === 'enviar') && !enFlujoEnvio) {
    resetearIntentos(clienteId);
    if (menuOpcion === 'cotizar') {
      return client.sendText(
        chatId,
        '💱 Cuéntame cuánto quieres enviar y entre qué países.\n\n' +
        '*Ejemplo:*\n' +
        'Necesito enviar 10 dólares a Venezuela, si te pago en pesos cuánto te mando'
      );
    }
    estadoCliente[clienteId] = 'esperando_origen';
    datosEnvio[clienteId] = {};
    return manejarFlujoEnvio({
      client, message, chatId, clienteId, texto: 'quiero enviar', estadoCliente, datosEnvio, supabase,
      guardarSnapshot, limpiarFlujo, limpiarFlujoPersistido, programarRecordatorio, adminNumeros: ADMIN_NUMEROS,
    });
  }

  if (detectarHandoff(texto) && !esAdmin) {
    return activarHandoff({
      client, workspace: message, chatId, clienteId, texto, estadoCliente, datosEnvio,
      adminNumeros: ADMIN_NUMEROS, marcarAtencionManual, limpiarFlujo, supabase, clientesPausados,
    });
  }

  const reanudo = await manejarReanudacion(client, chatId, clienteId, texto, estadoCliente, datosEnvio, {
    supabase,
    limpiarFlujoPersistido,
  });
  if (reanudo !== false) {
    registrarActividad(clienteId);
    if (estadoCliente[clienteId] && estadoCliente[clienteId] !== 'esperando_reanudacion') {
      await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);
    }
    return;
  }

  registrarActividad(clienteId);
  guardarSnapshot(clienteId, estadoCliente, datosEnvio);
  await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);

  const respondioSaludo = await manejarSaludo(client, message, estadoCliente, supabase);
  if (respondioSaludo) {
    resetearIntentos(clienteId);
    return;
  }

  const respondioAgradecimiento = await manejarAgradecimiento(client, chatId, clienteId, estadoCliente, texto);
  if (respondioAgradecimiento) {
    resetearIntentos(clienteId);
    return;
  }

  if (debeProcesarIntenciones(estadoCliente, clienteId)) {
    const respondioIntencion = await manejarIntencionCliente(
      client, chatId, supabase, clienteId, texto, estadoCliente, datosEnvio
    );
    if (respondioIntencion) {
      guardarSnapshot(clienteId, estadoCliente, datosEnvio);
      await sincronizarEstadoCliente(supabase, clienteId, estadoCliente, datosEnvio);
      resetearIntentos(clienteId);
      return;
    }
  }

  const enAtencionManual = fueAtendidoManual(clienteId, clientesPausados);

  const flujoCtx = {
    client, message, chatId, clienteId, texto, estadoCliente, datosEnvio, supabase,
    guardarSnapshot, limpiarFlujo, limpiarFlujoPersistido, programarRecordatorio,
    silencioso: enAtencionManual,
  };

  const flujoAtendido = await manejarFlujoEnvio(flujoCtx);
  if (flujoAtendido !== false) {
    resetearIntentos(clienteId);
    return;
  }

  if (!estadoCliente[clienteId] || !ESTADOS_FLUJO_ENVIO.has(estadoCliente[clienteId])) {
    const intentos = registrarIntentoFallido(clienteId);
    if (intentos >= 2) {
      resetearIntentos(clienteId);
      // Solo una vez cada 6 horas; el bot sigue activo y responde cotizaciones/envíos normales
      await enviarMenuFallback(client, chatId, clienteId);
    }
  } else if (ESTADOS_SOLO_CONFIRMACION.has(estadoCliente[clienteId])) {
    return client.sendText(chatId, '⚠️ Responde *SÍ* (dale, ok, listo…) o *NO* para continuar.');
  }
}

function start(client) {
  console.log('✅ Bot Lite conectado y listo (modo bajo consumo).');

  cargarFlujosActivos(supabase, estadoCliente, datosEnvio, clientesPausados).catch((err) => {
    console.error('[PERSISTENCIA] Error al cargar flujos:', err.message);
  });

  iniciarProgramadorDifusiones(client);
  habilitarEscuchadorRealtime(client);
  iniciarHealthCheck(client, ADMIN_NUMEROS[0], reiniciarBot, 300000);
  configurarReinicioPorDesconexion(client, ADMIN_NUMEROS[0], reiniciarBot);
  iniciarLimpiezaNocturna({ onLimpieza: limpiezaProfunda, sessionName: SESSION_NAME });

  client.onAnyMessage((message) => {
    if (message.from === 'status@broadcast' || message.isBroadcast) return;
    if (message.isGroupMsg) return;

    if (message.fromMe) {
      const chatId = message.to || message.chatId;
      if (chatId && esChatPrivado(chatId) && !fueEnvioBot(chatId)) {
        encolar(chatId, () => manejarIntervencionManual(chatId));
      }
      return;
    }

    if (!esChatPrivado(message.from)) return;

    let clienteId = message.author || message.from;
    if (clienteId.includes(':')) clienteId = clienteId.replace(/:\d+/, '');

    encolar(clienteId, () => procesarMensajeEntrante(client, message));
  });
}

registrarProtocolosEstabilidad({
  onReiniciar: reiniciarBot,
  adminAlert: async (texto) => {
    if (!clientGlobal || !ADMIN_NUMEROS[0]) return;
    await clientGlobal.sendText(ADMIN_NUMEROS[0], texto);
  },
});

iniciarBot();
