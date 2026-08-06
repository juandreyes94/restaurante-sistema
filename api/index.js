// Punto de entrada en Vercel: la app de Express se ejecuta como función.
//
// server.js exporta el app y solo abre un puerto si lo corres directamente
// (`node server.js`), así que el mismo archivo sirve en local y aquí.
//
// El try/catch no es decorativo: si la carga falla, Vercel devuelve un
// FUNCTION_INVOCATION_FAILED genérico y no hay forma de saber qué pasó. Así
// el error real queda visible en la respuesta y en los logs.
let app;
try {
  app = require('../server.js');
} catch (e) {
  const detalle = `${e.code || e.name}: ${e.message}\n\n${e.stack || ''}`;
  console.error('No se pudo cargar server.js:', detalle);
  app = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('El servidor no pudo arrancar.\n\n' + detalle);
  };
}

module.exports = app;
