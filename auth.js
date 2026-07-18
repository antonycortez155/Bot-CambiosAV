const { ADMIN_NUMEROS, ADMIN_TELEFONOS } = require('./config');

function extraerDigitos(valor) {
  if (!valor) return '';
  return String(valor).split('@')[0].replace(/\D/g, '');
}

function coincideTelefono(digitosCliente, digitosAdmin) {
  if (!digitosCliente || !digitosAdmin || digitosAdmin.length < 8) return false;
  if (digitosCliente === digitosAdmin) return true;
  if (digitosCliente.endsWith(digitosAdmin)) return true;
  if (digitosAdmin.endsWith(digitosCliente) && digitosCliente.length >= 10) return true;
  return false;
}

function esAdministrador(clienteId) {
  if (!clienteId) return false;

  const id = String(clienteId);
  if (ADMIN_NUMEROS.includes(id)) return true;

  const digitosCliente = extraerDigitos(id);
  if (!digitosCliente) return false;

  for (const adminId of ADMIN_NUMEROS) {
    if (id === adminId) return true;
    const digitosAdmin = extraerDigitos(adminId);
    if (coincideTelefono(digitosCliente, digitosAdmin)) return true;
  }

  for (const telefono of ADMIN_TELEFONOS) {
    if (coincideTelefono(digitosCliente, telefono)) return true;
  }

  return false;
}

module.exports = { esAdministrador, extraerDigitos };
