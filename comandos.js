const { supabase, dbQuery } = require('./supabase');
const { cancelarRecordatorio } = require('./recordatorioComprobante');
const { limpiarFlujo } = require('./recuperacionFlujo');
const { limpiarFlujoPersistido } = require('./persistenciaFlujo');
const { esAdministrador } = require('./auth');
const { resolverUrlComprobante } = require('./comprobantesStorage');
const { capitalizar, esPaisValido, sanitizarBusqueda, obtenerEmoji, formatearMoneda } = require('./utils');
const { LIMITES } = require('./config');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function manejarComandos(client, message, contexto) {
    const { chatId } = contexto;

    try {
        await ejecutarComando(client, message, contexto);
    } catch (err) {
        console.error('[COMANDOS] Error:', err.message);
        await client.sendText(chatId, '❌ Ocurrió un error al procesar el comando. Intenta de nuevo.');
    }
}

async function ejecutarComando(client, message, contexto) {
    const { chatId, clienteId, texto, estadoCliente, datosEnvio, formatearMoneda } = contexto;

    contexto.esAdmin = esAdministrador(clienteId);

    console.log(`\n[COMANDOS LOG] 📥 Recibido: "${texto}" | Es Admin: ${contexto.esAdmin}`);

    // ==========================================
    // TRADUCTOR INTELIGENTE DE IDs (NUEVO)
    // ==========================================
    // Convierte un id corto (ej: 15) en el ID real de WhatsApp de la base de datos
    const obtenerIdReal = async (parametro) => {
        // Si el admin escribió un número pequeño (ID corto)
        if (!isNaN(parametro) && parametro.length <= 6) {
            const { data } = await supabase.from('clientes').select('id').eq('nro_cliente', parseInt(parametro)).single();
            return data ? data.id : null;
        }
        // Si escribió el número largo por costumbre (Compatibilidad)
        const { data } = await supabase.from('clientes').select('id').like('id', `${parametro}%`).single();
        return data ? data.id : null;
    };

    // ==========================================
    // COMANDO PÚBLICO: !tasas
    // ==========================================
    if (texto === '!tasas') {
        const { data: tasas, error } = await dbQuery(supabase.from('tasas').select('*').order('origen', { ascending: true }));

        if (error || !tasas.length) return client.sendText(chatId, '❌ No hay tasas configuradas actualmente.');

        let mensaje = `🏦 *TASAS DEL DÍA - Cambios AV*\n`;
        mensaje += `📅 _Actualizado: ${new Date().toLocaleDateString('es-VE')}_\n\n`;

        tasas.forEach(t => {
            mensaje += `${obtenerEmoji(t.origen)} *${capitalizar(t.origen)}* ➔ ${obtenerEmoji(t.destino)} *${capitalizar(t.destino)}*\n`;
            mensaje += ` └─ 💱 Tasa: *${t.valor}* (${t.tipo})\n\n`;
        });

        mensaje += `⚡ _Consulta promociones enviando "quiero enviar"_`;
        return client.sendText(chatId, mensaje);
    }

    // ==========================================
    // COMANDO PÚBLICO: !dolar / !bcv
    // ==========================================
    if (texto === '!dolar' || texto === '!bcv') {
        try {
            const { data, error } = await supabase
                .from('dolar_venezuela')
                .select('*')
                .eq('id', 1)
                .single();

            if (error || !data) {
                return client.sendText(chatId, '❌ Lo siento, no pude obtener los indicadores en este momento.');
            }

            const fechaActualizacion = new Date(data.fecha_actualizacion).toLocaleString('es-VE', {
                timeZone: 'America/Caracas',
                day: 'numeric',
                month: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            const mensajeDolar = `🏦 *INDICADORES VENEZUELA - Cambios AV*\n` +
                                 `📅 _Actualizado: ${fechaActualizacion}_\n\n` +
                                 `🇻🇪 *Dólar BCV*\n` +
                                 ` └─ 💱 Tasa: *${parseFloat(data.tasa_bcv).toFixed(2)}*\n\n` +
                                 `🇪🇺 *Euro BCV*\n` +
                                 ` └─ 💱 Tasa: *${parseFloat(data.tasa_euro).toFixed(2)}*\n\n` +
                                 `🟡 *Binance P2P*\n` +
                                 ` └─ 💱 Tasa: *${parseFloat(data.tasa_binance).toFixed(2)}*\n\n` +
                                 `⚡ _Consulta promociones enviando "quiero enviar"_`;

            return client.sendText(chatId, mensajeDolar);

        } catch (err) {
            console.error("❌ Error en comando !dolar:", err);
            return client.sendText(chatId, '❌ Ocurrió un error interno al consultar las tasas.');
        }
    }

    // ==========================================
    // COMANDOS EXCLUSIVOS ADMIN
    // ==========================================
    if (!contexto.esAdmin) return;

    if (texto === '!comandos') {
        return client.sendText(chatId, 
            `🛠 *PANEL DE CONTROL ADMIN* 🛠\n\n` +
            `💰 *OPERACIONES*\n` +
            `• \`!resumen\` - Cierre de caja.\n` +
            `• \`!pendientes\` - Envíos por procesar.\n` +
            `• \`!comprobante [Nro]\` - Ver comprobante en revisión.\n` +
            `• \`!ok [Nro Cliente]\` - Completar envío.\n\n` +
            `⚙️ *CONFIGURACIÓN*\n` +
            `• \`!tasa [origen] [destino] [valor] [tipo]\`\n` +
            `• \`!difusion [mensaje]\` - Mensaje masivo.\n\n` +
            `👤 *CLIENTES*\n` +
            `• \`!reset [Nro Cliente]\` - Limpiar estado.\n` +
            `• \`!info [Nro Cliente]\` - Ver historial.`
        );
    }

    // !buscar [nombre/teléfono]
    if (texto.startsWith('!buscar ')) {
        const termino = sanitizarBusqueda(texto.substring(8), LIMITES.BUSQUEDA_MAX_CHARS);
        if (termino.length < 2) {
            return client.sendText(chatId, '❌ Uso: !buscar [nombre o teléfono]\nEjemplo: !buscar Santiago');
        }

        const soloDigitos = termino.replace(/\D/g, '');
        const esNumero = soloDigitos.length >= 4 && soloDigitos.length === termino.replace(/\s/g, '').length;

        let clientes;
        let error;

        if (esNumero) {
            ({ data: clientes, error } = await dbQuery(
                supabase.from('clientes').select('id, nombre, nro_cliente, es_vip')
                  .or(`id.like.%${soloDigitos}%,nro_cliente.eq.${parseInt(soloDigitos, 10)}`)
                  .limit(10)
            ));
        } else {
            ({ data: clientes, error } = await dbQuery(
                supabase.from('clientes').select('id, nombre, nro_cliente, es_vip')
                  .ilike('nombre', `%${termino}%`)
                  .limit(10)
            ));
        }
        if (error || !clientes?.length) {
            return client.sendText(chatId, `❌ No encontré clientes con: *${termino}*`);
        }

        let msj = `🔍 *RESULTADOS (${clientes.length})*\n\n`;
        clientes.forEach((c) => {
            msj += `• *#${c.nro_cliente || '?'}* - ${c.nombre || 'Sin nombre'}${c.es_vip ? ' ⭐VIP' : ''}\n`;
        });
        msj += `\n👉 _Usa !info [Nro] para más detalle_`;
        return client.sendText(chatId, msj);
    }

    // !cancelar [Nro Cliente]
    if (texto.startsWith('!cancelar ')) {
        const parametro = texto.split(' ')[1]?.trim();
        if (!parametro) return client.sendText(chatId, '❌ Uso: !cancelar [Nro Cliente]');

        const realId = await obtenerIdReal(parametro);
        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        const { data: trans, error: searchError } = await dbQuery(
            supabase.from('transacciones').select('id, estado, pais_origen, pais_destino, monto_enviado')
              .eq('cliente_id', realId)
              .in('estado', ['pendiente', 'revisando'])
              .order('fecha_transaccion', { ascending: false })
              .limit(1)
        );

        if (searchError || !trans?.length) {
            return client.sendText(chatId, `❌ No hay envíos activos para el cliente #${parametro}.`);
        }

        const t = trans[0];
        const { error: updateError } = await dbQuery(
            supabase.from('transacciones').update({ estado: 'cancelado' }).eq('id', t.id)
        );

        if (updateError) {
            console.error('[CANCELAR] Error BD:', updateError.message);
            return client.sendText(chatId, '❌ Error al cancelar en la base de datos.');
        }

        delete estadoCliente[realId];
        delete datosEnvio[realId];
        cancelarRecordatorio(realId);
        limpiarFlujo(realId);
        await limpiarFlujoPersistido(supabase, realId);

        await client.sendText(
            realId,
            `❌ *ENVÍO CANCELADO*\n\nTu solicitud ${capitalizar(t.pais_origen)} → ${capitalizar(t.pais_destino)} fue cancelada.\n\nSi deseas hacer un nuevo envío, escribe *"quiero enviar"*.`
        );

        return client.sendText(
            chatId,
            `✅ Envío #${t.id} cancelado para cliente #${parametro}.\nCliente notificado.`
        );
    }

    // !stats semana / !stats mes
    if (texto.startsWith('!stats')) {
        const periodo = texto.split(' ')[1] || 'semana';
        const ahora = new Date();
        const desde = new Date(ahora);

        if (periodo === 'mes') {
            desde.setDate(desde.getDate() - 30);
        } else {
            desde.setDate(desde.getDate() - 7);
        }

        const { data: trans, error } = await dbQuery(
            supabase.from('transacciones').select('*')
              .eq('estado', 'completado')
              .gte('fecha_transaccion', desde.toISOString())
        );

        if (error) return client.sendText(chatId, '❌ Error al generar estadísticas.');

        const lista = trans || [];
        const rutas = {};
        const clientesUnicos = new Set();
        let totalBs = 0, totalCop = 0;

        lista.forEach((t) => {
            clientesUnicos.add(t.cliente_id);
            const ruta = `${t.pais_origen}→${t.pais_destino}`;
            rutas[ruta] = (rutas[ruta] || 0) + 1;
            if (t.pais_destino === 'venezuela') totalBs += Number(t.monto_recibido);
            if (t.pais_destino === 'colombia') totalCop += Number(t.monto_recibido);
        });

        const topRutas = Object.entries(rutas).sort((a, b) => b[1] - a[1]).slice(0, 5);
        let msj = `📊 *ESTADÍSTICAS (${periodo === 'mes' ? '30 días' : '7 días'})*\n\n`;
        msj += `✅ Envíos completados: *${lista.length}*\n`;
        msj += `👥 Clientes únicos: *${clientesUnicos.size}*\n`;
        msj += `🇻🇪 Total Bs entregados: *${totalBs.toLocaleString('es-VE')}*\n`;
        msj += `🇨🇴 Total COP entregados: *${totalCop.toLocaleString('es-CO')}*\n\n`;

        if (topRutas.length) {
            msj += `🔝 *Rutas más frecuentes:*\n`;
            topRutas.forEach(([ruta, cant]) => {
                msj += `• ${ruta.replace('→', ' → ')}: ${cant}\n`;
            });
        }

        return client.sendText(chatId, msj);
    }

    // !promo list | !promo off [id] | !promo crear ...
    if (texto.startsWith('!promo')) {
        const resto = texto.substring(6).trim();

        if (!resto || resto === 'list') {
            const { data: promos, error } = await dbQuery(
                supabase.from('promociones').select('*').eq('activa', true)
                  .order('fecha_vencimiento', { ascending: true })
            );
            if (error || !promos?.length) {
                return client.sendText(chatId, '📭 No hay promociones activas.');
            }

            let msj = `🎁 *PROMOCIONES ACTIVAS (${promos.length})*\n\n`;
            promos.forEach((p) => {
                msj += `*#${p.id}* ${p.nombre}\n`;
                msj += ` └─ +${p.porcentaje_bono}% | Mín: ${p.min_monto}`;
                if (p.origen || p.destino) msj += ` | ${p.origen || '*'} → ${p.destino || '*'}`;
                msj += `\n └─ Vence: ${new Date(p.fecha_vencimiento).toLocaleDateString('es-VE')}\n\n`;
            });
            msj += `👉 _Desactivar: !promo off [id]_`;
            return client.sendText(chatId, msj);
        }

        if (resto.startsWith('off ')) {
            const id = parseInt(resto.split(' ')[1], 10);
            if (isNaN(id)) return client.sendText(chatId, '❌ Uso: !promo off [id]');

            const { error } = await dbQuery(
                supabase.from('promociones').update({ activa: false }).eq('id', id)
            );
            if (error) return client.sendText(chatId, '❌ Error al desactivar promo.');
            return client.sendText(chatId, `✅ Promoción #${id} desactivada.`);
        }

        if (resto.startsWith('crear ')) {
            const partes = message.body.substring(12).split('|').map((p) => p.trim());
            if (partes.length < 3) {
                return client.sendText(chatId,
                    `❌ *Formato:*\n!promo crear nombre | porcentaje | min_monto | dias [| origen | destino]\n\n` +
                    `Ejemplo:\n!promo crear Quincena | 3 | 50 | 7 | colombia | venezuela`
                );
            }

            const [nombre, pctStr, minStr, diasStr, origenStr, destinoStr] = partes;
            const porcentaje = parseFloat(pctStr);
            const min_monto = parseFloat(minStr);
            const dias = parseInt(diasStr, 10) || 7;

            if (isNaN(porcentaje) || isNaN(min_monto) || porcentaje <= 0 || porcentaje > 100) {
                return client.sendText(chatId, '❌ Porcentaje debe ser entre 0.1 y 100, y monto mínimo un número válido.');
            }

            if (origenStr && !esPaisValido(origenStr.toLowerCase())) {
                return client.sendText(chatId, '❌ País origen inválido.');
            }
            if (destinoStr && !esPaisValido(destinoStr.toLowerCase())) {
                return client.sendText(chatId, '❌ País destino inválido.');
            }

            const ahora = new Date();
            const vence = new Date(ahora);
            vence.setDate(vence.getDate() + dias);

            const { error } = await dbQuery(supabase.from('promociones').insert([{
                nombre,
                porcentaje_bono: porcentaje,
                min_monto,
                activa: true,
                fecha_inicio: ahora.toISOString(),
                fecha_vencimiento: vence.toISOString(),
                origen: origenStr || null,
                destino: destinoStr || null,
            }]));

            if (error) {
                console.error('[PROMO]', error);
                return client.sendText(chatId, '❌ Error al crear promoción.');
            }

            return client.sendText(chatId,
                `✅ *Promoción creada*\n\n` +
                `🎁 ${nombre}\n` +
                `📈 +${porcentaje}% | Mín: ${min_monto}\n` +
                `📅 Vigente ${dias} días (hasta ${vence.toLocaleDateString('es-VE')})`
            );
        }

        return client.sendText(chatId, '❌ Usa: !promo list | !promo off [id] | !promo crear ...');
    }

    // 1. !tasa
    if (texto.startsWith('!tasa ')) {
        const partes = texto.split(' ').filter(p => p.trim() !== '');
        if (partes.length < 4) return client.sendText(chatId, '❌ Uso: !tasa origen destino valor tipo');

        let origen = partes[1].toLowerCase();
        let destino = partes[2] === '→' ? partes[3].toLowerCase() : partes[2].toLowerCase();
        let valor = parseFloat(partes[2] === '→' ? partes[4] : partes[3]);
        let tipo = partes[2] === '→' ? partes[5] : partes[4];
        tipo = tipo ? tipo.toLowerCase() : 'multiplicar';

        const { data: tasaExistente } = await supabase.from('tasas').select('id').eq('origen', origen).eq('destino', destino).single();

        if (tasaExistente) {
            await supabase.from('tasas').update({ valor, tipo, actualizado_en: new Date() }).eq('id', tasaExistente.id);
        } else {
            await supabase.from('tasas').insert([{ origen, destino, valor, tipo }]);
        }
        return client.sendText(chatId, `✅ Tasa guardada en la NUBE:\n${capitalizar(origen)} → ${capitalizar(destino)}: ${valor} (${tipo})`);
    }

    // !comprobante [Nro Cliente]
    if (texto.startsWith('!comprobante ')) {
        const parametro = texto.split(' ')[1]?.trim();
        if (!parametro) {
            return client.sendText(chatId, '❌ Uso: !comprobante [Nro Cliente]\nEjemplo: !comprobante 1');
        }

        const realId = await obtenerIdReal(parametro);
        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        const { data: trans, error } = await dbQuery(
            supabase.from('transacciones')
                .select('id, comprobante_url, estado, pais_origen, pais_destino, monto_enviado, monto_recibido, metodo_pago')
                .eq('cliente_id', realId)
                .eq('estado', 'revisando')
                .order('fecha_transaccion', { ascending: false })
                .limit(1)
        );

        if (error || !trans?.length) {
            return client.sendText(chatId, `❌ No hay comprobante en revisión para el cliente #${parametro}.`);
        }

        const t = trans[0];
        const url = await resolverUrlComprobante(supabase, t.comprobante_url);
        if (!url) {
            return client.sendText(chatId, '❌ No se pudo generar el enlace al comprobante. Intenta de nuevo.');
        }

        return client.sendText(
            chatId,
            `📸 *COMPROBANTE — Cliente #${parametro}*\n\n` +
            `🗺️ ${capitalizar(t.pais_origen)} → ${capitalizar(t.pais_destino)}\n` +
            `💰 Envía: ${formatearMoneda(t.monto_enviado, t.pais_origen)}\n` +
            `💵 Recibe: ${formatearMoneda(t.monto_recibido, t.pais_destino)}\n` +
            `💳 Método: ${t.metodo_pago || 'N/D'}\n\n` +
            `🔗 ${url}\n\n` +
            `👉 _Aprobar con: !ok ${parametro}_`
        );
    }

    // 2. !ok [Nro Cliente] 🟢 ACTUALIZADO
    if (texto.startsWith('!ok ')) {
        const parametro = texto.split(' ')[1].trim(); 
        const realId = await obtenerIdReal(parametro);

        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        const { data: transaccion, error: searchError } = await supabase
            .from('transacciones')
            .select('id')
            .eq('cliente_id', realId)
            .eq('estado', 'revisando')
            .order('fecha_transaccion', { ascending: false }) 
            .limit(1)
            .single();

        if (searchError || !transaccion) return client.sendText(chatId, `❌ No hay envíos en revisión para el cliente #${parametro}.`);

        const { error: updateError } = await supabase.from('transacciones').update({ estado: 'completado' }).eq('id', transaccion.id);
        if (updateError) return client.sendText(chatId, '❌ Error al actualizar.');
        
        return client.sendText(chatId, `✅ Envío completado. Cliente #${parametro} notificado.`);
    }

    // 8. !stop [Nro Cliente] (ADMIN FUERZA PAUSA)
    if (texto.startsWith('!stop ')) {
        const parametro = texto.split(' ')[1].trim();
        const realId = await obtenerIdReal(parametro);

        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        // Aplicamos la pausa en la memoria compartida
        contexto.clientesPausados[realId] = Date.now() + PAUSA_USUARIO_MS;

        // Avisamos al cliente
        await client.sendText(realId, '⚠️ *MENSAJE DE SISTEMA*\n\nUn administrador ha pausado mis funciones para tu chat temporalmente (1 hora). Si necesitas atención urgente, por favor espera a ser contactado.');

        return client.sendText(chatId, `🚫 Bot pausado para el cliente #${parametro} durante 1 hora.`);
    }

    // 9. !start [Nro Cliente] (RE-ACTIVAR)
    if (texto.startsWith('!start ')) {
        const parametro = texto.split(' ')[1].trim();
        const realId = await obtenerIdReal(parametro);

        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        delete contexto.clientesPausados[realId]; // Borramos la pausa

        await client.sendText(realId, '✅ *SISTEMA RE-ACTIVADO*\n\nHola de nuevo, ya puedo responder tus mensajes. ¿En qué puedo ayudarte?');
        
        return client.sendText(chatId, `✅ Bot reactivado para el cliente #${parametro}.`);
    }

    // 10. !nombre [Nro Cliente] [Nuevo Nombre] (ACTUALIZAR NOMBRE)
    if (texto.startsWith('!nombre ')) {
        // Separamos el comando en 3 partes: el "!nombre", el "ID", y el "Resto del texto"
        const partes = message.body.split(' '); // Usamos message.body para respetar las mayúsculas del nombre
        
        if (partes.length < 3) {
            return client.sendText(chatId, '❌ Formato incorrecto. Uso: !nombre [Nro Cliente] [Nuevo Nombre]\nEjemplo: !nombre 15 Santiago Pérez');
        }

        const parametro = partes[1].trim();
        const nuevoNombre = partes.slice(2).join(' ').trim(); // Une el resto de las palabras (ej: "Santiago" + "Pérez")
        
        const realId = await obtenerIdReal(parametro);

        if (!realId) return client.sendText(chatId, `❌ Cliente #${parametro} no encontrado.`);

        // Actualizamos en Supabase
        const { error } = await supabase
            .from('clientes')
            .update({ nombre: nuevoNombre })
            .eq('id', realId);

        if (error) {
            console.error("Error actualizando nombre:", error);
            return client.sendText(chatId, '❌ Hubo un error al actualizar el nombre en la base de datos.');
        }

        // Si tenemos la memoria temporal del cliente activa, la limpiamos para que el bot lo vuelva a leer fresco
        if (contexto.estadoCliente) {
             delete contexto.estadoCliente[realId]; 
        }

        return client.sendText(chatId, `✅ Nombre actualizado con éxito.\n👤 Cliente #${parametro} ahora se llama: *${nuevoNombre}*`);
    }

    // 3. !info [Nro Cliente] 🟢 ACTUALIZADO
    if (texto.startsWith('!info ')) {
        const parametro = texto.split(' ')[1].trim();
        const realId = await obtenerIdReal(parametro);

        if (!realId) return client.sendText(chatId, '❌ Cliente no encontrado.');

        const { data: cliente } = await supabase.from('clientes').select('*').eq('id', realId).single();
        const { data: trans } = await supabase.from('transacciones').select('estado').eq('cliente_id', realId);
        const { data: encuestas } = await supabase.from('encuestas').select('calificacion').eq('cliente_id', realId);

        let enviosExitosos = trans ? trans.filter(t => t.estado === 'completado').length : 0;
        let promedioStr = "Sin notas aún";
        
        if (encuestas && encuestas.length > 0) {
            const suma = encuestas.reduce((acc, cur) => acc + cur.calificacion, 0);
            promedioStr = (suma / encuestas.length).toFixed(1) + ' ⭐';
        }

        return client.sendText(chatId, 
            `👤 *CLIENTE #${cliente.nro_cliente}*\n\n` +
            `📛 Nombre: ${cliente.nombre || 'Desconocido'}\n` +
            `🎖️ VIP: ${cliente.es_vip ? 'Sí ✅' : 'No ❌'}\n` +
            `📦 Envíos completados: ${enviosExitosos}\n` +
            `📈 Calificación: ${promedioStr}`
        );
    }

    // 4. !reset [Nro Cliente] 🟢 ACTUALIZADO
    if (texto.startsWith('!reset ')) {
        const parametro = texto.split(' ')[1].trim();
        const realId = await obtenerIdReal(parametro);
        
        const target = realId || parametro; // Por si falla, usa el input crudo
        delete estadoCliente[target];
        delete datosEnvio[target];
        
        return client.sendText(chatId, `🧹 Memoria limpiada para el cliente #${parametro}.`);
    }

    // 5. !pendientes
    if (texto === '!pendientes') {
        // Traemos también los datos del cliente para mostrar el Nro Cliente
        const { data: pendientes, error } = await supabase
            .from('transacciones')
            .select(`
                monto_enviado, 
                pais_origen,
                clientes ( nro_cliente )
            `)
            .eq('estado', 'revisando');

        if (error || !pendientes.length) return client.sendText(chatId, '✅ Todo al día. No hay envíos pendientes.');

        let msj = `⏳ *ENVÍOS EN REVISIÓN (${pendientes.length})* ⏳\n\n`;
        pendientes.forEach((p) => {
            const numCli = p.clientes ? p.clientes.nro_cliente : 'N/A';
            msj += `• Cliente *#${numCli}* - ${p.monto_enviado} ${capitalizar(p.pais_origen)}\n`;
        });
        msj += `\n👉 _Usa !comprobante [Nro] o !ok [Nro] para aprobar_`;
        
        return client.sendText(chatId, msj);
    }

    // 6. !difusion [PROGRAMADA]
    if (texto.startsWith('!difusion ')) {
        // Usamos message.body para NO perder las mayúsculas originales de tu mensaje
        const partes = message.body.substring(10).split('|').map(p => p.trim());
        
        if (partes.length < 3) {
            return client.sendText(chatId, 
                `❌ *Formato incorrecto.*\n\n` +
                `Uso:\n!difusion YYYY-MM-DD HH:MM | segmento | mensaje\n\n` +
                `Ejemplo:\n!difusion 2026-05-15 14:30 | todos | ¡Llegó la quincena!\n\n` +
                `Segmentos válidos: todos, vip, no_vip`
            );
        }

        const [fechaHoraStr, segmentoStr, mensajeDifusion] = partes;
        const segmento = segmentoStr.toLowerCase();

        if (!['todos', 'vip', 'no_vip'].includes(segmento)) {
            return client.sendText(chatId, '❌ Segmento inválido. Usa: todos, vip o no_vip');
        }

        // Construimos la fecha forzando la zona horaria de Venezuela (-04:00)
        // input: "2026-05-09 18:30" -> Date() lo procesará exacto para tu país
        const fechaIsoVenezuela = `${fechaHoraStr}:00-04:00`;
        const fechaProgramada = new Date(fechaIsoVenezuela);

        if (isNaN(fechaProgramada.getTime())) {
            return client.sendText(chatId, '❌ Fecha/Hora inválida. Asegúrate de usar guiones y dos puntos (Ej: 2026-05-09 15:00)');
        }

        // Guardamos en la base de datos (El cronjob se encargará del resto)
        const { error } = await dbQuery(supabase.from('difusiones').insert([{
            mensaje: mensajeDifusion,
            fecha_programada: fechaProgramada.toISOString(),
            segmento: segmento,
            creado_por: clienteId
        }]));

        if (error) {
            console.error("Error BD:", error);
            return client.sendText(chatId, '❌ Error al guardar la difusión.');
        }

        return client.sendText(chatId, 
            `✅ *DIFUSIÓN PROGRAMADA* ☁️\n\n` +
            `📅 Se enviará el: *${fechaHoraStr}*\n` +
            `👥 Segmento: *${segmento.toUpperCase()}*\n` +
            `⏳ Estado: Pendiente`
        );
    }

    // 7. !resumen
    if (texto === '!resumen') {
        const hoy = new Date().toISOString().split('T')[0];
        const { data: trans, error } = await dbQuery(
            supabase.from('transacciones').select('*').eq('estado', 'completado').gte('fecha_transaccion', hoy)
        );

        if (error) return client.sendText(chatId, '❌ Error al generar resumen.');

        let totalBs = 0, totalCop = 0, cant = trans?.length || 0;
        (trans || []).forEach(t => {
            if (t.pais_destino === 'venezuela') totalBs += Number(t.monto_recibido);
            if (t.pais_destino === 'colombia') totalCop += Number(t.monto_recibido);
        });

        return client.sendText(chatId, 
            `📊 *RESUMEN DE HOY* 📊\n\n` +
            `✅ Envíos exitosos: *${cant}*\n` +
            `🇻🇪 Total Bolívares: *${totalBs.toLocaleString('es-VE')} Bs*\n` +
            `🇨🇴 Total Pesos: *${totalCop.toLocaleString('es-CO')} COP*`
        );
    }
}

module.exports = { manejarComandos };

