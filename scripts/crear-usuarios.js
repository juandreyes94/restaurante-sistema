// ─────────────────────────────────────────────────────────────
//  Crea usuarios con PIN cifrado (bcrypt).
//
//  Uso:
//    node scripts/crear-usuarios.js                    → siembra el equipo inicial
//    node scripts/crear-usuarios.js "Ana" mesero 4321  → agrega una persona
//
//  Requiere haber corrido antes sql/03_usuarios.sql en el SQL Editor.
//  Los PINs se guardan con hash: no quedan en texto plano en ningún lado.
// ─────────────────────────────────────────────────────────────
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');
const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
const ROLES = ['mesero', 'cocina', 'admin'];

// Equipo inicial: se conservan los PINs que ya usaba el equipo para que
// nadie quede afuera al migrar. Cámbialos desde el panel cuando quieras.
const INICIAL = [
  { nombre: 'Administrador', rol: 'admin',  pin: '9876' },
  { nombre: 'Cocina',        rol: 'cocina', pin: '1234' },
  { nombre: 'Mesero',        rol: 'mesero', pin: '5678' },
];

async function crear({ nombre, rol, pin }) {
  const { data: ya } = await supa.from('usuarios').select('id').eq('nombre', nombre).maybeSingle();
  if (ya) { console.log(`  ${c.d}·${c.x} ${c.d}"${nombre}" ya existe — no se toca${c.x}`); return false; }
  const { error } = await supa.from('usuarios').insert({
    nombre, rol, pin_hash: bcrypt.hashSync(pin, 10), activo: true,
  });
  if (error) throw error;
  console.log(`  ${c.g}✓${c.x} ${nombre.padEnd(16)} ${rol.padEnd(8)} PIN ${pin}`);
  return true;
}

(async () => {
  // ¿Existe la tabla? (sin head:true — con esa opción el error no se propaga)
  const { error: e0 } = await supa.from('usuarios').select('id').limit(1);
  if (e0) {
    console.error(`\n${c.r}✗ No encuentro la tabla "usuarios".${c.x}`);
    console.error(`${c.d}  Corre primero sql/03_usuarios.sql en el SQL Editor de Supabase.${c.x}\n`);
    process.exit(1);
  }

  const [nombre, rol, pin] = process.argv.slice(2);

  if (nombre) {
    if (!ROLES.includes(rol)) {
      console.error(`${c.r}✗ Rol inválido "${rol}". Debe ser: ${ROLES.join(', ')}${c.x}`);
      process.exit(1);
    }
    if (!/^\d{4,8}$/.test(pin || '')) {
      console.error(`${c.r}✗ El PIN debe tener entre 4 y 8 dígitos.${c.x}`);
      process.exit(1);
    }
    console.log(`\n${c.b}Nuevo usuario${c.x}`);
    await crear({ nombre, rol, pin });
  } else {
    console.log(`\n${c.b}Equipo inicial${c.x}`);
    let nuevos = 0;
    for (const u of INICIAL) if (await crear(u)) nuevos++;
    if (!nuevos) console.log(`${c.d}  (ya estaban todos)${c.x}`);
  }

  const { data } = await supa.from('usuarios').select('nombre,rol,activo').order('rol').order('nombre');
  console.log(`\n${c.b}Usuarios en el sistema (${data.length})${c.x}`);
  data.forEach(u => console.log(`  ${u.nombre.padEnd(18)} ${u.rol.padEnd(8)} ${u.activo ? '' : c.d + '(inactivo)' + c.x}`));
  console.log(`\n${c.d}Los PINs quedan cifrados; si alguien lo olvida se le asigna uno nuevo desde el panel.${c.x}\n`);
})().catch(e => { console.error(`${c.r}✗`, e.message, c.x); process.exit(1); });
