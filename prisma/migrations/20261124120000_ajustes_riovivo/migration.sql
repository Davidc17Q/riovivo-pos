-- Río Vivo cobra solo en efectivo y transferencia, y no tiene cocina propia (la comida la
-- traen restaurantes aliados): sin comandas. Solo se fija si aún no se había configurado.
INSERT INTO "Ajuste" ("clave", "valor", "actualizadoEn") VALUES
  ('metodosPago', 'EFECTIVO,TRANSFERENCIA', CURRENT_TIMESTAMP),
  ('comandas', 'no', CURRENT_TIMESTAMP)
ON CONFLICT ("clave") DO NOTHING;
