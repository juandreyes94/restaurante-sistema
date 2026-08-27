// ─────────────────────────────────────────────────────────────
//  Insumos y recetas base de Coraje, derivados del menú.
//
//  Viven aquí y no dentro de un script porque los usan dos motores distintos:
//  seed-insumos.js los carga en Supabase y seed-local.js en data/db.json. Con
//  una sola copia, el modo local y el real muestran el mismo inventario.
//
//  Ojo: estas son las cantidades base (1 porción por línea). El inventario
//  real del cliente — 39 insumos pesados en gramos — se carga aparte con
//  scripts/cargar-inventario.js desde su Excel.
// ─────────────────────────────────────────────────────────────

// [nombre, unidad]
const INSUMOS = [
  // Proteínas
  ['Carne premium', 'porción 150g'], ['Carne desgranada', 'porción'],
  ['Pulled pork', 'porción'], ['Panceta caramelizada', 'porción'],
  ['Carne desmechada', 'porción'], ['Chorizo artesanal', 'unidad'],
  ['Chicharrón', 'porción'], ['Tocineta', 'porción'],
  // Salchichas
  ['Salchicha estándar', 'unidad'], ['Salchicha americana', 'unidad'], ['Salchicha ranchera', 'unidad'],
  // Panes y bases
  ['Pan brioche', 'unidad'], ['Papa a la francesa', 'porción 280g'],
  // Quesos
  ['Queso philadelphia', 'porción'], ['Queso americano', 'porción'], ['Queso mozzarella', 'porción'],
  ['Queso asado', 'porción'], ['Queso cuajada', 'porción'], ['Queso crema', 'porción'],
  // Otros
  ['Huevos de codorniz', 'porción'],
  // Bebidas (1:1)
  ['Coca-Cola / Postobón', 'unidad'], ['Agua Manantial', 'unidad'],
  ['Tamarindo Michelada', 'unidad'], ['Soda Michelada', 'unidad'], ['Sodas Saborizadas', 'unidad'],
  ['Hatsu', 'unidad'], ['Cerveza Sol', 'unidad'], ['Cerveza 3 Cordilleras', 'unidad'], ['Cerveza Corona', 'unidad'],
];

// producto -> [[insumo, cantidad], ...]
const RECETAS = {
  'Chuzo Desgranado de Panceta': [['Panceta caramelizada',1],['Queso cuajada',1]],
  'Chuzo Desgranado': [['Carne desgranada',1],['Queso cuajada',1]],
  'Chuzo Desgranado Pulled Pork': [['Pulled pork',1],['Queso cuajada',1]],
  'Hamburguesa Coraje': [['Pan brioche',1],['Carne premium',1],['Queso philadelphia',1],['Tocineta',1]],
  'Hamburguesa Americana': [['Pan brioche',1],['Carne premium',1],['Queso americano',1],['Tocineta',1]],
  'Hamburguesa Mocca': [['Pan brioche',1],['Carne premium',1],['Queso americano',1],['Queso crema',1],['Tocineta',1]],
  'Hamburguesa Hawai': [['Pan brioche',1],['Carne premium',1],['Queso asado',1],['Tocineta',1]],
  'Hamburguesa Gaucha': [['Pan brioche',1],['Carne premium',1],['Queso mozzarella',1],['Chorizo artesanal',1]],
  'Hamburguesa Marake': [['Pan brioche',1],['Carne premium',1],['Queso asado',1],['Tocineta',1]],
  'Papas Coraje': [['Papa a la francesa',1],['Salchicha ranchera',1],['Carne desmechada',1],['Queso mozzarella',1]],
  'Perro Coraje': [['Pan brioche',1],['Salchicha estándar',1],['Queso mozzarella',1],['Tocineta',1],['Carne desmechada',1]],
  'Perro Clásico': [['Pan brioche',1],['Salchicha estándar',1],['Queso americano',1],['Tocineta',1]],
  'Perro Chancho': [['Pan brioche',1],['Salchicha estándar',1],['Chicharrón',1],['Queso mozzarella',1]],
  'Perro Inmaduro': [['Pan brioche',1],['Salchicha estándar',1],['Queso philadelphia',1],['Tocineta',1]],
  'Perro Granjero': [['Pan brioche',1],['Salchicha estándar',1],['Queso mozzarella',1],['Tocineta',1]],
  'Perro Chingón': [['Pan brioche',1],['Salchicha estándar',1],['Queso mozzarella',1],['Tocineta',1]],
  'Perro Hawai': [['Pan brioche',1],['Salchicha estándar',1],['Queso mozzarella',1],['Tocineta',1]],
  'Perro Perla del Otún': [['Pan brioche',1],['Salchicha americana',1],['Queso cuajada',1],['Huevos de codorniz',1],['Tocineta',1]],
  'Perro Maradoniano': [['Pan brioche',1],['Chorizo artesanal',1]],
  // Bebidas 1:1
  'Coca-Cola / Postobón': [['Coca-Cola / Postobón',1]], 'Agua Manantial': [['Agua Manantial',1]],
  'Tamarindo Michelada': [['Tamarindo Michelada',1]], 'Soda Michelada': [['Soda Michelada',1]],
  'Sodas Saborizadas': [['Sodas Saborizadas',1]], 'Hatsu': [['Hatsu',1]],
  'Cerveza Sol': [['Cerveza Sol',1]], 'Cerveza 3 Cordilleras': [['Cerveza 3 Cordilleras',1]], 'Cerveza Corona': [['Cerveza Corona',1]],
  // Adiciones
  'Carne Premium': [['Carne premium',1]], 'Queso Asado': [['Queso asado',1]],
  'Queso Philadelphia': [['Queso philadelphia',1]], 'Queso Mozzarella': [['Queso mozzarella',1]],
  'Queso Americano': [['Queso americano',1]], 'Porción Papas a la Francesa': [['Papa a la francesa',1]],
  'Huevos de Codorniz': [['Huevos de codorniz',1]],
};

module.exports = { INSUMOS, RECETAS };
