// Datos iniciales: 2 usuarios de prueba y el catálogo real de Río Vivo. Se puede correr varias veces sin duplicar.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CATALOGO, estacionDe, type ItemCatalogo } from './catalogo';

const prisma = new PrismaClient();

const USUARIOS = [
  { usuario: 'admin', nombre: 'Administración', clave: 'admin1234', rol: 'ADMIN' as const },
  { usuario: 'caja', nombre: 'Caja Recepción', clave: 'caja1234', rol: 'VENDEDOR' as const },
];

// Catálogo real de Río Vivo más un insumo interno de ejemplo.
const PRODUCTOS: ItemCatalogo[] = [
  ...CATALOGO,
  { nombre: 'Aceite para masaje (litro)', categoria: 'Insumos', precio: 0, stock: 10, seVende: false },
];

async function main() {
  for (const u of USUARIOS) {
    await prisma.usuario.upsert({
      where: { usuario: u.usuario },
      update: {},
      create: { usuario: u.usuario, nombre: u.nombre, rol: u.rol, claveHash: await bcrypt.hash(u.clave, 10) },
    });
  }
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { usuario: 'admin' } });

  if ((await prisma.producto.count()) === 0) {
    for (const p of PRODUCTOS) {
      const stock = p.stock ?? 0;
      await prisma.producto.create({
        data: {
          nombre: p.nombre,
          categoria: p.categoria,
          precio: p.precio,
          seVende: p.seVende ?? true,
          estacion: estacionDe(p.categoria),
          controlaStock: p.stock !== undefined,
          stock,
          movimientos: stock
            ? { create: { tipo: 'ENTRADA', cantidad: stock, stockResultante: stock, nota: 'Inventario inicial', usuarioId: admin.id } }
            : undefined,
        },
      });
    }
  }
  console.log('Seed listo: usuarios y catálogo de prueba.');
}

main().finally(() => prisma.$disconnect());
