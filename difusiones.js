const { supabase, dbQuery } = require('./supabase');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { ADMIN_NUMEROS } = require('./config');

const ADMIN_NUMERO = ADMIN_NUMEROS[0];

let ejecutandoDifusion = false;
let intervaloDifusion = null;
const idsEnProceso = new Set();

const TIMEOUT_DIFUSIONES_MS = 25000;
const PAGE_SIZE = 40;
const CAMPOS_DIFUSION = 'id, mensaje, segmento, estado, fecha_programada';

async function procesarDifusionesPendientes(client) {
  if (ejecutandoDifusion) return;
  ejecutandoDifusion = true;

  try {
    const { data: candidatas, error } = await dbQuery(
      supabase
        .from('difusiones')
        .select('id')
        .eq('estado', 'pendiente')
        .lte('fecha_programada', new Date().toISOString())
        .order('fecha_programada', { ascending: true })
        .limit(2),
      TIMEOUT_DIFUSIONES_MS
    );

    if (error || !candidatas?.length) return;

    for (const { id } of candidatas) {
      if (idsEnProceso.has(id)) continue;

      const { data: difusion, error: readError } = await dbQuery(
        supabase
          .from('difusiones')
          .select(CAMPOS_DIFUSION)
          .eq('id', id)
          .eq('estado', 'pendiente')
          .single(),
        TIMEOUT_DIFUSIONES_MS
      );

      if (readError || !difusion) continue;

      idsEnProceso.add(id);
      console.log(`📢 Iniciando difusión programada ID: ${difusion.id}`);

      // Evita reenvío masivo si PM2 reinicia a mitad de campaña
      const { data: claimed } = await dbQuery(
        supabase
          .from('difusiones')
          .update({ estado: 'enviando' })
          .eq('id', difusion.id)
          .eq('estado', 'pendiente')
          .select('id')
          .single(),
        TIMEOUT_DIFUSIONES_MS
      );
      if (!claimed) {
        idsEnProceso.delete(id);
        continue;
      }

      try {
        let enviados = 0;
        let fallidos = 0;
        let from = 0;
        let hayClientes = false;
        let errorPagina = false;

        while (true) {
          let query = supabase
            .from('clientes')
            .select('id')
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
          if (difusion.segmento === 'vip') query = query.eq('es_vip', true);
          if (difusion.segmento === 'no_vip') query = query.eq('es_vip', false);

          const { data: clientes, error: cliError } = await dbQuery(query, TIMEOUT_DIFUSIONES_MS);

          if (cliError) {
            console.error(`[DIFUSIONES] Error página clientes ID ${id}:`, cliError.message);
            errorPagina = true;
            break;
          }

          if (!clientes?.length) break;
          hayClientes = true;

          for (const cliente of clientes) {
            try {
              await client.sendText(cliente.id, difusion.mensaje);
              enviados++;
              await delay(Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000);
            } catch {
              fallidos++;
            }
          }

          if (clientes.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        if (!hayClientes && !errorPagina) {
          await dbQuery(supabase.from('difusiones').update({ estado: 'error' }).eq('id', difusion.id));
          continue;
        }

        // Si hubo envíos parciales, marcar enviado (no reintentar desde cero)
        const estadoFinal = (!hayClientes && errorPagina) ? 'error' : 'enviado';
        await dbQuery(
          supabase.from('difusiones')
            .update({ estado: estadoFinal })
            .eq('id', difusion.id)
            .eq('estado', 'enviando')
        );

        if (ADMIN_NUMERO && (enviados > 0 || fallidos > 0)) {
          const nota = errorPagina ? '\n⚠️ Terminó con error de página (parcial).' : '';
          await client.sendText(ADMIN_NUMERO,
            `✅ *REPORTE DE DIFUSIÓN* 📢\n\n` +
            `📝 Mensaje: "${difusion.mensaje.substring(0, 30)}..."\n` +
            `👥 Segmento: ${difusion.segmento.toUpperCase()}\n` +
            `🚀 Enviados con éxito: *${enviados}*\n` +
            `❌ Fallidos: *${fallidos}*${nota}`
          ).catch(() => {});
        }
      } catch (err) {
        console.error(`[DIFUSIONES] Error ID ${id}:`, err.message);
        await dbQuery(supabase.from('difusiones').update({ estado: 'error' }).eq('id', id)).catch(() => {});
      } finally {
        idsEnProceso.delete(id);
      }
    }
  } catch (err) {
    console.error('❌ Error procesando difusiones:', err.message);
  } finally {
    ejecutandoDifusion = false;
  }
}

function iniciarProgramadorDifusiones(client) {
  if (intervaloDifusion) clearInterval(intervaloDifusion);
  console.log('⏰ Difusiones Lite: revisando BD cada 5 minutos...');
  setTimeout(() => procesarDifusionesPendientes(client), 90000);
  intervaloDifusion = setInterval(() => procesarDifusionesPendientes(client), 300000);
}

function detenerProgramadorDifusiones() {
  if (intervaloDifusion) clearInterval(intervaloDifusion);
  intervaloDifusion = null;
  idsEnProceso.clear();
}

module.exports = { iniciarProgramadorDifusiones, detenerProgramadorDifusiones };
