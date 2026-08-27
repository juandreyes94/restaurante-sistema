// ─────────────────────────────────────────────────────────────
//  Código público de la tarjeta de fidelización.
//
//  Va en el QR y en la URL de la tarjeta, así que el cliente lo va a leer en
//  voz alta y algún mesero lo va a teclear. Por eso el alfabeto no tiene
//  0/O ni 1/I/L: son las confusiones que generan reclamos en el mostrador.
//
//  Aleatorio, no secuencial: con ids consecutivos cualquiera podría contar
//  hacia arriba y abrir la tarjeta del vecino. Con 28 símbolos y 8 posiciones
//  hay ~3.8e11 combinaciones, de sobra para el universo de un restaurante.
//
//  Vive aquí y no dentro de un store para que los dos motores (Supabase y
//  local) generen exactamente el mismo formato.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO = 8;

function nuevoCodigo() {
  // randomInt en vez de Math.random: no queremos códigos predecibles.
  let out = '';
  for (let i = 0; i < LARGO; i++) out += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return out;
}

// El cliente puede escribirlo con minúsculas, espacios o guiones.
function normalizarCodigo(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// El teléfono identifica al cliente en el mostrador, así que dos formas de
// escribir el mismo número tienen que caer en la misma persona. Se guardan
// solo los dígitos y se quita el indicativo: quien se registra como
// "+57 300 123 4567" y quien lo busca como "300 123 4567" son el mismo.
//
// Sin esto el cliente se registra con indicativo, el mesero lo busca sin él y
// no aparece; o peor, se le crea una segunda tarjeta y pierde sus sellos.
//
// El 57 es de Colombia. Al clonar el sistema a otro país hay que cambiarlo.
const INDICATIVO = '57';
const LARGO_NACIONAL = 10;

function normalizarTelefono(v) {
  let d = String(v || '').replace(/\D/g, '');
  d = d.replace(/^0+/, '');                       // 0057... o 057...
  if (d.length === INDICATIVO.length + LARGO_NACIONAL && d.startsWith(INDICATIVO)) {
    d = d.slice(INDICATIVO.length);
  }
  return d;
}

module.exports = { nuevoCodigo, normalizarCodigo, normalizarTelefono, ALFABETO, LARGO };
