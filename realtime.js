// ─────────────────────────────────────────────────────────────
//  Avisos en vivo — Supabase Realtime por HTTP
//
//  Antes el servidor tenía su propio WebSocketServer y guardaba las
//  conexiones en un Set. Eso funciona con un único proceso encendido, pero no
//  con funciones: cada instancia tendría su propio Set, así que un pedido
//  creado en la instancia A nunca llegaría a la cocina conectada a la B.
//
//  Ahora el reparto lo hace Supabase: el servidor publica por HTTP (una
//  petición y listo, sin mantener conexión) y los navegadores se suscriben al
//  canal. Cualquier instancia puede publicar y todos reciben.
// ─────────────────────────────────────────────────────────────
const { supabase: cfg } = require('./config');

const CANAL = 'pedidos';
const EVENTO = 'cambio';

const URL_BROADCAST =
  `${cfg.url}/realtime/v1/api/broadcast/${CANAL}/events/${EVENTO}`;

// Publica un mensaje para todas las pantallas.
//
// A propósito no lanza: que falle un aviso no debe tumbar la operación que ya
// se guardó. Si el aviso se pierde, la pantalla igual se pone al día cuando
// se reconecta (vuelve a pedir el estado inicial).
async function broadcast(msg) {
  try {
    const res = await fetch(URL_BROADCAST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
      },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      console.warn(`⚠️  Aviso en vivo no entregado (${res.status}):`, await res.text());
    }
  } catch (e) {
    console.warn('⚠️  Aviso en vivo no entregado:', e.message);
  }
}

module.exports = { broadcast, CANAL, EVENTO };
