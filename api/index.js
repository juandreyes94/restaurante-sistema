// Punto de entrada en Vercel: la app de Express se ejecuta como función.
//
// server.js exporta el app y solo abre un puerto si lo corres directamente
// (`node server.js`), así que el mismo archivo sirve en local y aquí.
module.exports = require('../server.js');
