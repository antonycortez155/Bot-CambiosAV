const { capitalizar } = require('./utils');
const { PAISES_VALIDOS_ENVIO } = require('./constantesEnvio');

const EMOJI_PAIS = {
  venezuela: '🇻🇪',
  colombia: '🇨🇴',
  usa: '🇺🇸',
  peru: '🇵🇪',
  panama: '🇵🇦',
};

async function enviarListaPaises(client, chatId, descripcion, excluir = null) {
  const paises = PAISES_VALIDOS_ENVIO.filter((p) => p !== excluir);
  try {
    await client.sendListMessage(chatId, {
      buttonText: 'Ver países',
      description: descripcion,
      sections: [{
        title: 'Países disponibles',
        rows: paises.map((p) => ({
          rowId: p,
          title: `${EMOJI_PAIS[p] || '🌎'} ${capitalizar(p)}`,
          description: '',
        })),
      }],
    });
    return true;
  } catch (err) {
    console.log('[INTERACTIVO] Lista países no disponible, usando texto:', err.message);
    return false;
  }
}

async function enviarListaMetodos(client, chatId, origen, metodos) {
  const lista = metodos || ['Transferencia'];
  try {
    await client.sendListMessage(chatId, {
      buttonText: 'Ver métodos',
      description: `💳 Método de pago desde ${capitalizar(origen)}`,
      sections: [{
        title: 'Métodos de pago',
        rows: lista.map((m, i) => ({
          rowId: String(i + 1),
          title: m,
          description: `Opción ${i + 1}`,
        })),
      }],
    });
    return true;
  } catch (err) {
    console.log('[INTERACTIVO] Lista métodos no disponible:', err.message);
    return false;
  }
}

async function enviarListaTasasUsd(client, chatId, tasas) {
  try {
    await client.sendListMessage(chatId, {
      buttonText: 'Ver tasas',
      description: '🧮 ¿Qué tasa deseas usar para tu envío en USD?',
      sections: [{
        title: 'Tasas Venezuela',
        rows: [
          { rowId: '1', title: `BCV: ${parseFloat(Number(tasas.tasa_bcv).toFixed(1))} Bs`, description: 'Tasa oficial BCV' },
          { rowId: '2', title: `Euro: ${parseFloat(Number(tasas.tasa_euro).toFixed(1))} Bs`, description: 'Tasa Euro' },
          { rowId: '3', title: `Binance: ${parseFloat(Number(tasas.tasa_binance).toFixed(1))} Bs`, description: 'Tasa Binance P2P' },
        ],
      }],
    });
    return true;
  } catch (err) {
    console.log('[INTERACTIVO] Lista tasas no disponible:', err.message);
    return false;
  }
}

function mensajePaisesTexto(excluir = null) {
  const paises = PAISES_VALIDOS_ENVIO.filter((p) => p !== excluir);
  return paises.map((p) => `${EMOJI_PAIS[p] || '🌎'} ${capitalizar(p)}`).join('\n');
}

module.exports = {
  enviarListaPaises,
  enviarListaMetodos,
  enviarListaTasasUsd,
  mensajePaisesTexto,
};
