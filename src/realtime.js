// ─────────────────────────────────────────────────────────────
//  Avisos en vivo (lado navegador)
//
//  Antes cada pantalla abría un WebSocket contra nuestro propio servidor. Eso
//  dejó de servir al pasar a funciones: no hay un proceso fijo al cual
//  conectarse. Ahora el reparto lo hace Supabase Realtime y este archivo
//  esconde el cambio: las pantallas siguen recibiendo los mismos mensajes
//  ({type:'new_order'}, {type:'init'}, …) y no se enteraron de nada.
//
//  Depende de auth.js (authHeaders) y del cliente de Supabase por CDN.
// ─────────────────────────────────────────────────────────────
(function () {
  const CANAL = 'pedidos';
  const EVENTO = 'cambio';

  let canal = null;

  // El estado inicial ya no llega en el primer mensaje del socket: se pide por
  // HTTP. Se vuelve a pedir en cada (re)suscripción, así que si la pantalla
  // estuvo desconectada un rato, al volver se pone al día sola.
  async function cargarEstadoInicial(onMessage) {
    const res = await fetch('/estado-inicial', { headers: authHeaders() });
    if (!res.ok) throw new Error('No se pudo cargar el estado inicial');
    const { orders, completed } = await res.json();
    onMessage({ type: 'init', orders: orders || [], completed: completed || [] });
  }

  // onMessage: recibe los mismos mensajes de antes.
  // onOpen / onClose: para el indicador de conexión (lo usa comanda.html).
  async function connect({ onMessage, onOpen, onClose }) {
    const aviso = (fn) => { try { fn && fn(); } catch (e) { console.error(e); } };

    let cfg;
    try {
      cfg = await (await fetch('/realtime-config')).json();
    } catch {
      aviso(onClose);
      return setTimeout(() => connect({ onMessage, onOpen, onClose }), 5000);
    }

    if (!cfg.anonKey) {
      console.error('Falta SUPABASE_ANON_KEY: las pantallas no recibirán avisos en vivo.');
      aviso(onClose);
      // Sin canal no hay avisos, pero al menos que se vea el estado actual.
      return cargarEstadoInicial(onMessage).catch(() => {});
    }

    const cliente = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },
    });

    if (canal) { try { cliente.removeChannel(canal); } catch {} }

    canal = cliente.channel(CANAL)
      .on('broadcast', { event: EVENTO }, ({ payload }) => {
        if (payload && payload.type) onMessage(payload);
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          cargarEstadoInicial(onMessage)
            .then(() => aviso(onOpen))
            .catch(() => aviso(onClose));
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          aviso(onClose);
        }
      });
  }

  window.RT = { connect };
})();
