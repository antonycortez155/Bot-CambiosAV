// agradecimientos.js

const respuestasDeNada = [
    "¡Con mucho gusto! Gracias a ti por confiar en nosotros. ✨",
    "¡Para servirte! Siempre a la orden en Cambios AV. 💛",
    "¡A ti! Que tengas un excelente día. 🌟",
    "¡De nada! Es un placer ayudarte con tus envíos. 🤝",
    "¡Siempre a tu disposición! Aquí estaremos para la próxima. 📦",
    "¡Es un gusto atenderte! Gracias por preferirnos. 💫",
];

async function manejarAgradecimiento(client, chatId, clienteId, estadoCliente, texto) {
    // 1. Detecta variaciones (gracias, graacias, graciiias, grac, grax)
    const esAgradecimiento = /\b(g+r+a+c+i*a*s*|g+r+a+x+|g+r+a+c+)\b/.test(texto);
    
    // 2. Ignora si el mensaje incluye estas palabras sagradas o religiosas
    const tieneExclusion = /(dios|cielo|señor|jes[uú]s|virgen)/.test(texto);

    // Solo responde si el cliente NO está en medio de un envío
    if (!estadoCliente[clienteId] && esAgradecimiento && !tieneExclusion) {
        // Elige una respuesta al azar del menú de 20 opciones
        const respuestaElegida = respuestasDeNada[Math.floor(Math.random() * respuestasDeNada.length)];
        await client.sendText(chatId, respuestaElegida);
        return true; // Avisamos que sí respondimos algo
    }
    
    return false; // Avisamos que no era un agradecimiento
}

module.exports = { manejarAgradecimiento };

