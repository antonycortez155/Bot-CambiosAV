const VENTANA_MS = 6000;
const enviosRecientesBot = new Map();

function marcarEnvioBot(chatId) {
  if (!chatId) return;
  enviosRecientesBot.set(chatId, Date.now());
}

function fueEnvioBot(chatId) {
  const t = enviosRecientesBot.get(chatId);
  if (!t) return false;
  if (Date.now() - t > VENTANA_MS) {
    enviosRecientesBot.delete(chatId);
    return false;
  }
  return true;
}

function limpiarEnviosRecientes(ahora = Date.now()) {
  for (const [chatId, t] of enviosRecientesBot) {
    if (ahora - t > VENTANA_MS) enviosRecientesBot.delete(chatId);
  }
}

function envolverCliente(client) {
  const originalSendText = client.sendText.bind(client);
  client.sendText = async (to, message, ...args) => {
    marcarEnvioBot(to);
    return originalSendText(to, message, ...args);
  };

  if (typeof client.sendListMessage === 'function') {
    const originalSendList = client.sendListMessage.bind(client);
    client.sendListMessage = async (to, options, ...args) => {
      marcarEnvioBot(to);
      return originalSendList(to, options, ...args);
    };
  }

  if (typeof client.sendImageFromBase64 === 'function') {
    const originalSendImage = client.sendImageFromBase64.bind(client);
    client.sendImageFromBase64 = async (to, base64, filename, caption, ...args) => {
      marcarEnvioBot(to);
      return originalSendImage(to, base64, filename, caption, ...args);
    };
  }

  return client;
}

module.exports = { marcarEnvioBot, fueEnvioBot, envolverCliente, limpiarEnviosRecientes };
