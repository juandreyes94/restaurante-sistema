// ─────────────────────────────────────────────────────────────
//  El catálogo, leído de sql/02_seed_productos.sql.
//
//  Ese archivo es la fuente de verdad de los 35 productos y ya está en el
//  repo. Antes el modo local dependía de que data/db.json existiera de antes,
//  sin nadie que supiera de dónde había salido: borrarlo dejaba el sistema sin
//  catálogo y sin forma de recuperarlo. Ahora se reconstruye desde el SQL, así
//  que un clon limpio puede levantar el modo local sin traerse ningún archivo.
//
//  Se parsea de verdad, no con una expresión regular: las descripciones traen
//  comas y apóstrofes, y un split ingenuo las parte por la mitad.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SQL = path.join(__dirname, '..', 'sql', '02_seed_productos.sql');

// Corta una fila `('a','b',123,null)` en sus valores, respetando las comillas.
function partirFila(fila) {
  const out = [];
  let buf = '', enTexto = false;
  for (let i = 0; i < fila.length; i++) {
    const c = fila[i];
    if (enTexto) {
      // '' dentro de un texto es un apóstrofe escapado, no el final.
      if (c === "'" && fila[i + 1] === "'") { buf += "'"; i++; continue; }
      if (c === "'") { enTexto = false; continue; }
      buf += c;
    } else if (c === "'") {
      enTexto = true;
    } else if (c === ',') {
      out.push(buf.trim()); buf = '';
    } else {
      buf += c;
    }
  }
  out.push(buf.trim());
  // Los ::int de Postgres no significan nada fuera de la BD.
  return out.map(v => v.replace(/::\w+$/, ''));
}

function leerCatalogo() {
  const sql = fs.readFileSync(SQL, 'utf8');

  // Categorías: ('Chuzos', 1), ('Hamburguesas', 2), ...
  const bloqueCat = sql.slice(sql.indexOf('insert into categorias'), sql.indexOf('on conflict'));
  const categorias = [];
  for (const m of bloqueCat.matchAll(/\('([^']+)',\s*(\d+)\)/g)) {
    categorias.push({ nombre: m[1], orden: Number(m[2]) });
  }

  // Productos: el bloque `from (values ... ) as v(...)`.
  const desde = sql.indexOf('from (values');
  const hasta = sql.indexOf(') as v', desde);
  const bloque = sql.slice(desde + 'from (values'.length, hasta);

  const productos = [];
  for (let linea of bloque.split('\n')) {
    linea = linea.trim();
    if (!linea.startsWith('(')) continue;              // comentarios y sobrantes
    linea = linea.replace(/,$/, '').slice(1, -1);      // quitar los paréntesis
    const v = partirFila(linea);
    if (v.length < 8) continue;
    productos.push({
      categoria:    v[0],
      nombre:       v[1],
      descripcion:  v[2],
      precio:       Number(v[3]) || 0,
      precioCombo:  v[4] === 'null' ? null : (Number(v[4]) || null),
      imagen:       v[5],
      emoji:        v[6],
      orden:        Number(v[7]) || 0,
    });
  }
  return { categorias, productos };
}

module.exports = { leerCatalogo };
