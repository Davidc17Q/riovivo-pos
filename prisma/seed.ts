// Datos de prueba: 2 usuarios y un catálogo inicial. Se puede correr varias veces sin duplicar.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USUARIOS = [
  { usuario: 'admin', nombre: 'Administración', clave: 'admin1234', rol: 'ADMIN' as const },
  { usuario: 'caja', nombre: 'Caja Recepción', clave: 'caja1234', rol: 'VENDEDOR' as const },
];

const PRODUCTOS = [
  { nombre: 'Masaje relajante 60 min', categoria: 'Experiencias', precio: 150000 },
  { nombre: 'Masaje con piedras calientes', categoria: 'Experiencias', precio: 190000 },
  { nombre: 'Pasadía spa', categoria: 'Experiencias', precio: 95000 },
  { nombre: 'Circuito de hidroterapia', categoria: 'Experiencias', precio: 70000 },
  { nombre: 'Noche en cabaña (pareja)', categoria: 'Hospedaje', precio: 420000 },
  { nombre: 'Bandeja típica', categoria: 'Comida', precio: 38000 },
  { nombre: 'Limonada de coco', categoria: 'Bebidas', precio: 14000 },
  { nombre: 'Cerveza nacional', categoria: 'Bebidas', precio: 9000, stock: 48 },
  { nombre: 'Agua en botella', categoria: 'Bebidas', precio: 5000, stock: 60 },
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
