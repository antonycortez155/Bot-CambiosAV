const { supabase, dbQuery } = require('./supabase');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { ADMIN_NUMEROS } = require('./config');

const ADMIN_NUMERO = ADMIN_NUMEROS[0];

let ejecutandoDifusion = false;
let intervaloDifusion = null;
const idsEnProceso = new Set();

const TIMEOUT_DIFUSIONES_MS = 25000;

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
        supabase.from('difusiones').select('*').eq('id', id).eq('estado', 'pendiente').single(),
        TIMEOUT_DIFUSIONES_MS
      );

      if (readError || !difusion) continue;

      idsEnProceso.add(id);
      console.log(`📢 Iniciando difusión programada ID: ${difusion.id}`);

      try {
        let query = supabase.from('clientes').select('id');
        if (difusion.segmento === 'vip') query = query.eq('es_vip', true);
        if (difusion.segmento === 'no_vip') query = query.eq('es_vip', false);

        const { data: clientes, error: cliError } = await dbQuery(query, TIMEOUT_DIFUSIONES_MS);

        if (cliError || !clientes?.length) {
          await dbQuery(supabase.from('difusiones').update({ estado: 'error' }).eq('id', difusion.id));
          continue;
        }

        let enviados = 0;
        let fallidos = 0;

        for (const cliente of clientes) {
          try {
            await client.sendText(cliente.id, difusion.mensaje);
            enviados++;
            await delay(Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000);
          } catch {
            fallidos++;
          }
        }

        await dbQuery(
          supabase.from('difusiones')
            .update({ estado: 'enviado' })
            .eq('id', difusion.id)
            .eq('estado', 'pendiente')
        );

        if (ADMIN_NUMERO) {
          await client.sendText(ADMIN_NUMERO,
            `✅ *REPORTE DE DIFUSIÓN* 📢\n\n` +
            `📝 Mensaje: "${difusion.mensaje.substring(0, 30)}..."\n` +
            `👥 Segmento: ${difusion.segmento.toUpperCase()}\n` +
            `🚀 Enviados con éxito: *${enviados}*\n` +
            `❌ Fallidos: *${fallidos}*`
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
