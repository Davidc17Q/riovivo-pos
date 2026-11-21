-- El domicilio es un cobro, no un plato: no va a cocina ni al bar.
UPDATE "Producto" SET "estacion" = 'NINGUNA' WHERE lower("nombre") LIKE 'domicilio%';
