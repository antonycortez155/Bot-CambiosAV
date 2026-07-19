// saludos.js — Lite (menos variantes en memoria)

const { dbQuery } = require('./supabase');
const registroSaludos = {};
const MAX_REGISTRO = 400;
const TTL_SALUDO_MS = 3600000;

const obtenerIntroducciones = (nombre, saludoTiempo) => {
    const n = nombre ? ` ${nombre}` : '';
    return [
        `👋 ¡${saludoTiempo}${n}! Soy AVI, tu asistente virtual en Cambios AV 💱`,
        `¡Hola${n}! Qué gusto saludarte. Soy AVI de Cambios AV 🤖`,
        `👋 ¡Qué tal${n}! Soy AVI. En Cambios AV hacemos que tus remesas vuelen 🚀`,
        `¡Hola${n}! Soy AVI. Gracias por escribir a Cambios AV 💛`,
    ];
};

const instrucciones = [
    `✍ Escribe *"Quiero enviar dinero"* y comenzamos 🚀`,
    `👉 Dime *"Quiero enviar dinero"* y te guío paso a paso`,
    `✨ Para cotizar o enviar, escríbeme el monto y los países.`,
];

function limpiarRegistroSaludos(ahora = Date.now()) {
    for (const id of Object.keys(registroSaludos)) {
        if (ahora - registroSaludos[id] >= TTL_SALUDO_MS) delete registroSaludos[id];
    }
    const keys = Object.keys(registroSaludos);
    if (keys.length > MAX_REGISTRO) {
        keys
            .sort((a, b) => registroSaludos[a] - registroSaludos[b])
            .slice(0, keys.length - MAX_REGISTRO)
            .forEach((id) => delete registroSaludos[id]);
    }
}

async function manejarSaludo(client, message, estadoCliente, supabase) {
    if (message.from === 'status@broadcast' || message.isBroadcast) return false;

    const chatId = message.from;
    let clienteId = message.author || message.from;
    if (clienteId.includes(':')) clienteId = clienteId.replace(/:\d+/, '');

    const texto = message.body ? message.body.toLowerCase().trim() : '';
    const esSaludo = /^(hola|holis|buenas|buenos d[ií]as|buenas tardes|buenas noches|epa|qhubo|que tal|saludos|hello)\b/i.test(texto);
    if (!esSaludo || estadoCliente[clienteId]) return false;

    const ahora = Date.now();
    const ultimoSaludo = registroSaludos[clienteId];
    if (ultimoSaludo && (ahora - ultimoSaludo < TTL_SALUDO_MS)) return true;

    let nombreOficial = null;
    try {
        const { data } = await dbQuery(
            supabase.from('clientes').select('nombre').eq('id', clienteId).single()
        );
        if (data?.nombre && data.nombre.toLowerCase() !== 'cliente') {
            nombreOficial = data.nombre;
        }
    } catch {
        // ignore
    }

    const horaActual = new Date().getHours();
    let saludoTiempo = 'Buenos días';
    if (horaActual >= 12 && horaActual < 19) saludoTiempo = 'Buenas tardes';
    else if (horaActual >= 19 || horaActual < 5) saludoTiempo = 'Buenas noches';

    const intros = obtenerIntroducciones(nombreOficial, saludoTiempo);
    const introElegida = intros[Math.floor(Math.random() * intros.length)];
    const instruccionElegida = instrucciones[Math.floor(Math.random() * instrucciones.length)];

    await client.sendText(chatId, `${introElegida}\n\n${instruccionElegida}`);
    registroSaludos[clienteId] = ahora;
    if (Object.keys(registroSaludos).length > MAX_REGISTRO) limpiarRegistroSaludos(ahora);
    return true;
}

module.exports = { manejarSaludo, limpiarRegistroSaludos };
