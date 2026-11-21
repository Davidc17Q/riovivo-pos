// Catálogo real de Río Vivo Spa (tomado de su carta digital: experiencias, catering y
// restaurantes aliados). Precios en pesos enteros. Lo usan el seed y `npm run db:catalogo`.
export type ItemCatalogo = { nombre: string; categoria: string; precio: number; stock?: number; seVende?: boolean };

/** Estación de comandas por categoría: la comida va a cocina; bebidas y helados, al bar. */
export function estacionDe(categoria: string): 'NINGUNA' | 'COCINA' | 'BAR' {
  if (['Restaurante', 'Asados y picadas', 'Catering'].includes(categoria)) return 'COCINA';
  if (['Bebidas', 'Heladería'].includes(categoria)) return 'BAR';
  return 'NINGUNA';
}

const grupo = (categoria: string, items: [string, number][]): ItemCatalogo[] =>
  items.map(([nombre, precio]) => ({ nombre, categoria, precio }));

export const CATALOGO: ItemCatalogo[] = [
  ...grupo('Experiencias', [
    ['Solara · día de bienestar', 85000],
    ['Armonía · cuerpo y mente', 95000],
    ['Vitalia · energía pura', 120000],
    ['Alma · viaje interior', 145000],
    ['Áurea · experiencia insignia', 160000],
  ]),
  ...grupo('Para dos', [
    ['Hospedaje · noche para dos', 280000],
    ['Oasis · día en habitación', 390000],
    ['Serena · noche y rituales', 430000],
    ['Romántico · noche especial', 550000],
    ['Hora adicional de habitación', 20000],
  ]),
  ...grupo('Catering', [
    ['Trucha o tilapia frita', 33000],
    ['Bandeja (pollo, res, chicharrón o cerdo)', 26000],
    ['Domicilio catering', 10000],
    ['Domicilio día', 15000],
    ['Domicilio noche', 20000],
  ]),
  ...grupo('Restaurante', [
    ['Arepa de carne o pollo', 23000],
    ['Arepa mixta', 24000],
    ['Arepa especial', 26000],
    ['Arepa antioqueña', 23000],
    ['Derretido especial', 27000],
    ['Crep de pollo o carne', 26000],
    ['Crep, derretido, fajita o patacón vegetariano', 23000],
    ['Patacón de carne o pollo', 26000],
    ['Patacón ranchero', 28000],
    ['Patacón especial', 29000],
    ['Patacón de camarones', 30000],
    ['Sánduche de jamón y queso', 17000],
    ['Sánduche de atún', 24000],
    ['Fajitas', 23000],
    ['Quesadillas', 23000],
    ['Burritos', 28000],
    ['Lasaña', 25000],
    ['Chuzo de pollo BBQ', 28000],
    ['Hamburguesa + papas', 23000],
    ['Perro o perra + papas', 20000],
    ['Maícitos', 23000],
    ['Salchipapas', 16500],
    ['Salchipapas especial', 22000],
    ['Ceviche de camarones', 28000],
  ]),
  ...grupo('Heladería', [
    ['Cucurucho sencillo', 5000],
    ['Cucurucho doble', 9000],
    ['Miniconcha', 9500],
    ['Junior', 12000],
    ['Banana conchuda', 14000],
    ['Salpicón especial', 15000],
    ['Salpicón con helado', 12000],
    ['Salpicón sencillo o mini', 9500],
    ['Salpicón con helado y queso', 16000],
    ['Ensalada de frutas mini', 18000],
    ['Ensalada de frutas mediana', 22000],
    ['Ensalada de frutas grande', 26000],
    ['Copa de fresas, duraznos o brevas', 16500],
    ['Copa infantil', 9500],
    ['Maracumango', 18500],
    ['Pasión', 18000],
    ['Tropical', 18000],
    ['Caribe', 17500],
    ['Chocobanana', 16500],
    ['Crepes con helado', 21800],
    ['Wafle clásico', 21000],
    ['Wafle especial', 22000],
    ['Banana split', 18000],
    ['Gel-helado', 15000],
    ['Brownie con helado', 15000],
    ['Copa oreo', 15000],
    ['Delicia', 18500],
    ['Sensación de queso', 18500],
  ]),
  ...grupo('Bebidas', [
    ['Jugo natural', 9000],
    ['Jugo en soda', 12000],
    ['Granizado', 14000],
    ['Granizado especial', 12000],
    ['Limonada especial', 13000],
    ['Soda saborizada', 13000],
    ['Malteada', 15000],
    ['Cholao', 16000],
    ['Café especial', 13000],
  ]),
  ...grupo('Asados y picadas', [
    ['Picada 1000 g', 70000],
    ['Picada 1250 g', 85000],
    ['Picada 1500 g', 110000],
    ['Picada 2000 g', 140000],
    ['Picada 2500 g', 175000],
    ['Picada 2750 g', 195000],
    ['Picada 3000 g', 210000],
    ['Picada 3500 g', 245000],
    ['Bondiola de cerdo 500 g', 35000],
    ['Punta de anca de cerdo 500 g', 35000],
    ['Cañón 500 g', 35000],
    ['Chicharrón 500 g', 35000],
    ['Costillas 500 g', 35000],
    ['Solomo de res 500 g', 35000],
  ]),
];

/** Productos del catálogo de demostración inicial: se desactivan al cargar el real. */
export const DEMO = [
  'Masaje relajante 60 min', 'Masaje con piedras calientes', 'Pasadía spa', 'Circuito de hidroterapia',
  'Noche en cabaña (pareja)', 'Bandeja típica', 'Limonada de coco', 'Cerveza nacional', 'Agua en botella',
];
