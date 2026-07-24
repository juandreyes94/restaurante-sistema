-- ═══════════════════════════════════════════════════════════════
--  SEED — Catálogo de Coraje Fast Food (categorías + productos)
--  Correr DESPUÉS de 01_schema.sql. Idempotente por nombre.
-- ═══════════════════════════════════════════════════════════════

insert into categorias (nombre, orden) values
  ('Chuzos', 1), ('Hamburguesas', 2), ('Papas', 3),
  ('Perros', 4), ('Bebidas', 5), ('Adiciones', 6)
on conflict (nombre) do nothing;

insert into productos (categoria_id, nombre, descripcion, precio, precio_combo, imagen, emoji, orden)
select c.id, v.nombre, v.descripcion, v.precio, v.precio_combo, v.imagen, v.emoji, v.orden
from (values
  -- Chuzos
  ('Chuzos','Chuzo Desgranado de Panceta','Panceta caramelizada, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.',32900,41900::int,'img/chuzo-desgranado-de-panceta.jpg','',1),
  ('Chuzos','Chuzo Desgranado','Res, pollo o mixto, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.',35900,44900,'img/chuzo-desgranado.jpg','',2),
  ('Chuzos','Chuzo Desgranado Pulled Pork','Pulled pork en salsa BBQ de lulo, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.',33900,42900,'img/chuzo-desgranado-pulled-pork.jpg','',3),
  -- Hamburguesas
  ('Hamburguesas','Hamburguesa Coraje','Pan brioche, 150g carne premium, queso philadelphia, mermelada de tomate, tocineta, aros de cebolla apanados, vegetales, salsa de la casa.',32900,41900,'img/hamburguesa-coraje.jpg','',1),
  ('Hamburguesas','Hamburguesa Americana','Pan brioche, 150g carne premium, queso americano, tocineta, vegetales, salsa BBQ, salsa de la casa.',28900,37900,'img/hamburguesa-americana.jpg','',2),
  ('Hamburguesas','Hamburguesa Mocca','Pan brioche, mayonesa de café, carne premium, queso americano, cebolla en reducción de café y ron, queso crema, tocineta.',33900,42900,'img/hamburguesa-mocca.jpg','',3),
  ('Hamburguesas','Hamburguesa Hawai','Pan brioche, 150g carne premium, queso asado, piña calada, tocineta, vegetales, salsa BBQ, salsa de la casa.',33900,42900,'img/hamburguesa-hawai.jpg','',4),
  ('Hamburguesas','Hamburguesa Gaucha','Pan brioche, 150g carne premium, queso mozzarella, chorizo artesanal, guacamole, pico de gallo, vegetales, salsa de la casa.',33900,42900,'img/hamburguesa-gaucha.jpg','',5),
  ('Hamburguesas','Hamburguesa Marake','Pan brioche, 150g carne premium, queso asado, dip cremoso de maracuyá, tocineta, vegetales, salsa de la casa.',34900,43900,'img/hamburguesa-marake.jpg','',6),
  -- Papas
  ('Papas','Papas Coraje','Papas a la francesa (280g), salchicha ranchera, carne desmechada, queso mozzarella, maicitos, guacamole, pico de gallo, salsa de la casa.',33900,null::int,'img/papas-coraje.jpg','',1),
  -- Perros
  ('Perros','Perro Coraje','Pan brioche, salchicha, queso mozzarella, tocineta, carne desmechada, salsa de la casa.',28900,37900,'img/perro-coraje.jpg','',1),
  ('Perros','Perro Clásico','Pan brioche, salchicha, queso americano, tocineta, salsa de tomate, salsa BBQ.',25900,34900,'img/perro-clasico.jpg','',2),
  ('Perros','Perro Chancho','Pan brioche, salchicha, chicharrón crujiente, queso mozzarella, salsa BBQ, guacamole.',26900,35900,'img/perro-chancho.jpg','',3),
  ('Perros','Perro Inmaduro','Pan brioche, salchicha, queso philadelphia, maduro calado, tocineta, salsa crema leña.',26900,35900,'img/perro-inmaduro.jpg','',4),
  ('Perros','Perro Granjero','Pan brioche, salchicha, queso mozzarella, maicitos, tocineta, salsa de maíz dulce.',25900,34900,'img/perro-granjero.jpg','',5),
  ('Perros','Perro Chingón','Pan brioche, salchicha, queso mozzarella, tocineta, pico de gallo, guacamole, salsa BBQ.',26900,35900,'img/perro-chingon.jpg','',6),
  ('Perros','Perro Hawai','Pan brioche, salchicha, queso mozzarella, tocineta, piña calada, salsa BBQ.',26900,35900,'img/perro-hawai.jpg','',7),
  ('Perros','Perro Perla del Otún','Pan brioche, salchicha americana, queso cuajada, huevos de codorniz, ripio de papa, tocineta, salsa mora, salsa rosada.',24900,33900,'img/perro-perla-del-otun.jpg','',8),
  ('Perros','Perro Maradoniano','Pan brioche, chorizo artesanal, pico de gallo, guacamole, salsa de la casa.',22900,31900,'img/perro-maradoniano.jpg','',9),
  -- Bebidas
  ('Bebidas','Coca-Cola / Postobón','Gaseosa 350ml bien fría.',5900,null::int,'','🥤',1),
  ('Bebidas','Agua Manantial','Agua natural 350ml.',5900,null::int,'','💧',2),
  ('Bebidas','Tamarindo Michelada','Michelada sabor tamarindo.',7900,null::int,'','🍹',3),
  ('Bebidas','Soda Michelada','Michelada con soda.',7900,null::int,'','🍹',4),
  ('Bebidas','Sodas Saborizadas','Sodas en diferentes sabores.',12000,null::int,'','🥤',5),
  ('Bebidas','Hatsu','Bebida Hatsu natural o de frutas.',8500,null::int,'','🫖',6),
  ('Bebidas','Cerveza Sol','Cerveza Sol 330ml.',8500,null::int,'','🍺',7),
  ('Bebidas','Cerveza 3 Cordilleras','Cerveza artesanal 3 Cordilleras.',9000,null::int,'','🍺',8),
  ('Bebidas','Cerveza Corona','Cerveza Corona 330ml.',10000,null::int,'','🍺',9),
  -- Adiciones
  ('Adiciones','Carne Premium','Porción adicional de carne premium.',11000,null::int,'','🥩',1),
  ('Adiciones','Queso Asado','Porción de queso asado.',4900,null::int,'','🧀',2),
  ('Adiciones','Queso Philadelphia','Porción de queso philadelphia.',4900,null::int,'','🧀',3),
  ('Adiciones','Queso Mozzarella','Porción de queso mozzarella.',3900,null::int,'','🧀',4),
  ('Adiciones','Queso Americano','Porción de queso americano.',3900,null::int,'','🧀',5),
  ('Adiciones','Porción Papas a la Francesa','Porción de papas a la francesa.',7900,null::int,'','🍟',6),
  ('Adiciones','Huevos de Codorniz','Porción de huevos de codorniz.',5000,null::int,'','🥚',7)
) as v(cat,nombre,descripcion,precio,precio_combo,imagen,emoji,orden)
join categorias c on c.nombre = v.cat
where not exists (select 1 from productos p where p.nombre = v.nombre);
