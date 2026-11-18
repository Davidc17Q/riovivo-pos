// Sincroniza el catálogo real de Río Vivo: crea lo que falta, actualiza categoría y precio
// de lo que ya existe (por nombre) y desactiva los productos de demostración.
// No borra nada: las ventas viejas siguen apuntando a sus productos. Uso: npm run db:catalogo
import { PrismaClient } from '@prisma/client';
import { CATALOGO, DEMO } from './catalogo';

const prisma = new PrismaClient();

async function main() {
  let creados = 0;
  let actualizados = 0;
  for (const p of CATALOGO) {
    const existente = await prisma.producto.findFirst({ where: { nombre: p.nombre } });
    if (existente) {
      await prisma.producto.update({
        where: { id: existente.id },
        data: { categoria: p.categoria, precio: p.precio, activo: true },
      });
      actualizados++;
    } else {
      await prisma.producto.create({
        data: { nombre: p.nombre, categoria: p.categoria, precio: p.precio, seVende: p.seVende ?? true },
      });
      creados++;
    }
  }
  const { count } = await prisma.producto.updateMany({ where: { nombre: { in: DEMO }, activo: true }, data: { activo: false } });
  console.log(`Catálogo Río Vivo: ${creados} creados, ${actualizados} actualizados, ${count} de demostración desactivados.`);
}

main().finally(() => prisma.$disconnect());
