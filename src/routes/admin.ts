// Área de administración (solo rol ADMIN): catálogo, usuarios, inventario y reportes.
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { soloAdmin } from '../auth';
import { conDetalle } from './ventas';
import { csv } from '../csv';
import {
  ErrorHttp, UN_DIA_MS, ZONA, booleano, entero, fecha, idDeUrl, inicioDelDia, objeto, opcion, texto,
} from '../util';

const PRECIO_MAXIMO = 100_000_000;
const STOCK_MAXIMO = 1_000_000;
const ROLES = ['ADMIN', 'VENDEDOR'] as const;
const TIPOS_MANUALES = ['ENTRADA', 'SALIDA', 'AJUSTE'] as const;

const usuarioPublico = { id: true, usuario: true, nombre: true, rol: true, activo: true, creadoEn: true } as const;

function datosProducto(body: unknown) {
  const b = objeto(body);
  return {
    nombre: texto(b.nombre, 'Nombre', 1, 80),
    categoria: texto(b.categoria, 'Categoría', 1, 40),
    precio: entero(b.precio, 'Precio', 0, PRECIO_MAXIMO),
    activo: booleano(b.activo, 'Activo'),
    seVende: booleano(b.seVende, 'Se vende'),
    controlaStock: booleano(b.controlaStock, 'Controla stock'),
  };
}

export async function rutasAdmin(app: FastifyInstance) {
  app.addHook('preHandler', soloAdmin);

  // ---------- Productos ----------
  app.post('/api/productos', async (req, reply) => {
    return reply.code(201).send(await prisma.producto.create({ data: datosProducto(req.body) }));
  });

  app.put('/api/productos/:id', async (req) => {
    const id = idDeUrl(req.params);
    const data = datosProducto(req.body);
    const r = await prisma.producto.updateMany({ where: { id }, data });
    if (r.count === 0) throw new ErrorHttp(404, 'Producto no encontrado');
    return prisma.producto.findUnique({ where: { id } });
  });

  // Solo se borra lo que nunca se vendió; lo vendido se desactiva para conservar el historial.
  app.delete('/api/productos/:id', async (req) => {
    const id = idDeUrl(req.params);
    if ((await prisma.ventaItem.count({ where: { productoId: id } })) > 0) {
      throw new ErrorHttp(409, 'Este producto ya tiene ventas. Desactívalo en lugar de borrarlo.');
    }
    const r = await prisma.producto.deleteMany({ where: { id } });
    if (r.count === 0) throw new ErrorHttp(404, 'Producto no encontrado');
    return { ok: true };
  });

  // ---------- Usuarios ----------
  app.get('/api/usuarios', async () => prisma.usuario.findMany({ select: usuarioPublico, orderBy: { id: 'asc' } }));

  app.post('/api/usuarios', async (req, reply) => {
    const b = objeto(req.body);
    const usuario = texto(b.usuario, 'Usuario', 3, 30).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(usuario)) {
      throw new ErrorHttp(400, 'Usuario: solo letras, números, punto, guion y guion bajo');
    }
    const data = {
      usuario,
      nombre: texto(b.nombre, 'Nombre', 1, 60),
      rol: opcion(b.rol, 'Rol', ROLES),
      claveHash: await bcrypt.hash(texto(b.clave, 'Contraseña', 8, 72), 10),
    };
    try {
      return reply.code(201).send(await prisma.usuario.create({ data, select: usuarioPublico }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErrorHttp(409, 'Ya existe un usuario con ese nombre de usuario');
      }
      throw e;
    }
  });

  // Activar/desactivar o cambiar la contraseña.
  app.put('/api/usuarios/:id', async (req) => {
    const id = idDeUrl(req.params);
    const b = objeto(req.body);
    const data: { activo?: boolean; claveHash?: string } = {};
    if (b.activo !== undefined) {
      data.activo = booleano(b.activo, 'Activo');
      if (!data.activo && id === req.usuario!.id) throw new ErrorHttp(400, 'No puedes desactivar tu propio usuario');
    }
    if (b.clave !== undefined) data.claveHash = await bcrypt.hash(texto(b.clave, 'Contraseña', 8, 72), 10);
    const r = await prisma.usuario.updateMany({ where: { id }, data });
    if (r.count === 0) throw new ErrorHttp(404, 'Usuario no encontrado');
    return prisma.usuario.findUnique({ where: { id }, select: usuarioPublico });
  });

  // ---------- Inventario ----------
  app.get('/api/inventario/movimientos', async () =>
    prisma.movimientoInventario.findMany({
      orderBy: { id: 'desc' },
      take: 100,
      include: { producto: { select: { nombre: true } }, usuario: { select: { nombre: true } } },
    }),
  );

  // ENTRADA y SALIDA mueven unidades; AJUSTE fija el stock al conteo físico.
  app.post('/api/inventario/movimientos', async (req, reply) => {
    const b = objeto(req.body);
    const productoId = entero(b.productoId, 'Producto', 1, 999_999_999);
    const tipo = opcion(b.tipo, 'Tipo', TIPOS_MANUALES);
    const cantidad = entero(b.cantidad, 'Cantidad', tipo === 'AJUSTE' ? 0 : 1, STOCK_MAXIMO);
    const nota = b.nota === undefined || b.nota === '' ? null : texto(b.nota, 'Nota', 1, 200);

    const mov = await prisma.$transaction(async (tx) => {
      // Bloquea la fila: una venta simultánea espera y no se pierde ninguna resta.
      const filas = await tx.$queryRaw<{ stock: number; controlaStock: boolean }[]>`
        SELECT stock, "controlaStock" FROM "Producto" WHERE id = ${productoId} FOR UPDATE`;
      const p = filas[0];
      if (!p) throw new ErrorHttp(404, 'Producto no encontrado');
      if (!p.controlaStock) throw new ErrorHttp(400, 'Este producto no lleva inventario');
      const nuevo = tipo === 'AJUSTE' ? cantidad : tipo === 'ENTRADA' ? p.stock + cantidad : p.stock - cantidad;
      if (nuevo < 0) throw new ErrorHttp(409, `Solo hay ${p.stock} unidades; no se pueden sacar ${cantidad}`);
      if (nuevo > STOCK_MAXIMO) throw new ErrorHttp(400, 'El stock supera el máximo permitido');
      await tx.producto.update({ where: { id: productoId }, data: { stock: nuevo } });
      return tx.movimientoInventario.create({
        data: { productoId, tipo, cantidad: nuevo - p.stock, stockResultante: nuevo, nota, usuarioId: req.usuario!.id },
      });
    });
    return reply.code(201).send(mov);
  });

  // ---------- Anulación de ventas ----------
  // Regla: solo ADMIN anula. La venta no se borra: queda ANULADA con quién, cuándo y por qué,
  // y el inventario que descontó se repone con un movimiento inverso. Todo o nada.
  app.post('/api/ventas/:id/anular', async (req) => {
    const id = idDeUrl(req.params);
    const motivo = texto(objeto(req.body).motivo, 'Motivo', 5, 200);
    const usuarioId = req.usuario!.id;

    await prisma.$transaction(async (tx) => {
      // Bloquea la venta: dos anulaciones simultáneas no reponen el stock dos veces.
      const filas = await tx.$queryRaw<{ estado: string; cajaId: number | null }[]>`
        SELECT estado::text AS estado, "cajaId" FROM "Venta" WHERE id = ${id} FOR UPDATE`;
      const venta = filas[0];
      if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
      if (venta.estado === 'ANULADA') throw new ErrorHttp(409, 'Esta venta ya estaba anulada');
      // Si su caja se está cerrando en este instante, espera: la anulación cae antes o después del cierre, nunca en medio.
      if (venta.cajaId) await tx.$queryRaw`SELECT id FROM "SesionCaja" WHERE id = ${venta.cajaId} FOR SHARE`;

      // Se repone exactamente lo que esta venta descontó (mismo orden de ids que al vender).
      const descontados = await tx.movimientoInventario.findMany({
        where: { ventaId: id, tipo: 'VENTA' },
        orderBy: { productoId: 'asc' },
      });
      for (const m of descontados) {
        const devuelto = -m.cantidad;
        const p = await tx.producto.update({
          where: { id: m.productoId },
          data: { stock: { increment: devuelto } },
          select: { stock: true },
        });
        await tx.movimientoInventario.create({
          data: { productoId: m.productoId, tipo: 'ANULACION', cantidad: devuelto, stockResultante: p.stock, nota: motivo, usuarioId, ventaId: id },
        });
      }
      await tx.venta.update({
        where: { id },
        data: { estado: 'ANULADA', anuladaEn: new Date(), anuladaPorId: usuarioId, motivoAnulacion: motivo },
      });
    });
    return prisma.venta.findUnique({ where: { id }, include: conDetalle });
  });

  // ---------- Reportes ----------
  app.get('/api/reportes', async (req) => calcularReporte(rangoReporte(req.query)));

  // Exportación a CSV (Excel): "resumen" replica la pantalla; "detalle" trae una fila por
  // producto vendido, incluidas las anuladas, para que el contador pueda filtrar y cruzar.
  app.get('/api/reportes/exportar', async (req, reply) => {
    const q = req.query as { tipo?: string };
    const tipo = opcion(q.tipo, 'Tipo', ['resumen', 'detalle'] as const);
    const rango = rangoReporte(req.query);
    const contenido = tipo === 'resumen' ? csvResumen(await calcularReporte(rango)) : await csvDetalle(rango);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="riovivo-${tipo}-${rango.desde}_a_${rango.hasta}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(contenido);
  });
}

type Rango = { desde: string; hasta: string; inicio: Date; fin: Date };

function rangoReporte(query: unknown): Rango {
  const q = query as { desde?: string; hasta?: string };
  const desde = fecha(q.desde, 'Desde');
  const hasta = fecha(q.hasta, 'Hasta');
  const inicio = inicioDelDia(desde);
  const fin = new Date(inicioDelDia(hasta).getTime() + UN_DIA_MS);
  if (fin <= inicio) throw new ErrorHttp(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  if (fin.getTime() - inicio.getTime() > 366 * UN_DIA_MS) throw new ErrorHttp(400, 'El rango máximo es de un año');
  return { desde, hasta, inicio, fin };
}

async function calcularReporte({ desde, hasta, inicio, fin }: Rango) {

    // El día se agrupa en hora de Colombia, no en UTC.
    const dias = await prisma.$queryRaw<{ dia: string; ventas: bigint; total: bigint }[]>`
      SELECT to_char("creadaEn" AT TIME ZONE ${ZONA}, 'YYYY-MM-DD') AS dia, COUNT(*) AS ventas, SUM(total) AS total
      FROM "Venta" WHERE estado = 'ACTIVA' AND "creadaEn" >= ${inicio} AND "creadaEn" < ${fin}
      GROUP BY 1 ORDER BY 1`;
    const metodos = await prisma.venta.groupBy({
      by: ['metodoPago'],
      where: { estado: 'ACTIVA', creadaEn: { gte: inicio, lt: fin } },
      _sum: { total: true, descuento: true },
      _count: true,
    });
    // Por producto: valor de las líneas, antes del descuento de la venta.
    const productos = await prisma.$queryRaw<{ id: number; nombre: string; categoria: string; cantidad: bigint; total: bigint }[]>`
      SELECT p.id, p.nombre, p.categoria, SUM(i.cantidad) AS cantidad, SUM(i."totalLinea") AS total
      FROM "VentaItem" i JOIN "Venta" v ON v.id = i."ventaId" JOIN "Producto" p ON p.id = i."productoId"
      WHERE v.estado = 'ACTIVA' AND v."creadaEn" >= ${inicio} AND v."creadaEn" < ${fin}
      GROUP BY p.id ORDER BY total DESC, p.nombre`;
    const porProducto = productos.map((p) => ({ ...p, cantidad: Number(p.cantidad), total: Number(p.total) }));
    const categorias = new Map<string, { categoria: string; cantidad: number; total: number }>();
    for (const p of porProducto) {
      const c = categorias.get(p.categoria) ?? { categoria: p.categoria, cantidad: 0, total: 0 };
      c.cantidad += p.cantidad;
      c.total += p.total;
      categorias.set(p.categoria, c);
    }
    const vendedores = await prisma.$queryRaw<{ id: number; nombre: string; ventas: bigint; total: bigint }[]>`
      SELECT u.id, u.nombre, COUNT(*) AS ventas, SUM(v.total) AS total
      FROM "Venta" v JOIN "Usuario" u ON u.id = v."usuarioId"
      WHERE v.estado = 'ACTIVA' AND v."creadaEn" >= ${inicio} AND v."creadaEn" < ${fin}
      GROUP BY u.id ORDER BY total DESC, u.nombre`;
    const anuladas = await prisma.venta.aggregate({
      where: { estado: 'ANULADA', creadaEn: { gte: inicio, lt: fin } },
      _sum: { total: true },
      _count: true,
    });

    const porDia = dias.map((d) => ({ dia: d.dia, ventas: Number(d.ventas), total: Number(d.total) }));
    return {
      desde,
      hasta,
      total: porDia.reduce((s, d) => s + d.total, 0),
      ventas: porDia.reduce((s, d) => s + d.ventas, 0),
      descuentos: metodos.reduce((s, m) => s + (m._sum.descuento ?? 0), 0),
      porDia,
      porMetodo: metodos.map((m) => ({ metodo: m.metodoPago, ventas: m._count, total: m._sum.total ?? 0 })),
      porProducto,
      porCategoria: [...categorias.values()].sort((a, c) => c.total - a.total),
      porVendedor: vendedores.map((v) => ({ ...v, ventas: Number(v.ventas), total: Number(v.total) })),
      anuladas: { ventas: anuladas._count, total: anuladas._sum.total ?? 0 },
    };
}

const METODOS: Record<string, string> = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' };
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false });

function csvResumen(r: Awaited<ReturnType<typeof calcularReporte>>): string {
  return csv([
    ['Reporte de ventas · Río Vivo Spa'],
    ['Desde', r.desde, 'Hasta', r.hasta],
    [],
    ['Indicador', 'Valor'],
    ['Total vendido', r.total],
    ['Ventas', r.ventas],
    ['Descuentos otorgados', r.descuentos],
    ['Ventas anuladas (no cuentan)', r.anuladas.ventas],
    ['Valor anulado', r.anuladas.total],
    [],
    ['Por día', 'Ventas', 'Total'],
    ...r.porDia.map((d) => [d.dia, d.ventas, d.total]),
    [],
    ['Por método de pago', 'Ventas', 'Total'],
    ...r.porMetodo.map((m) => [METODOS[m.metodo] ?? m.metodo, m.ventas, m.total]),
    [],
    ['Por producto (antes de descuentos)', 'Categoría', 'Cantidad', 'Total'],
    ...r.porProducto.map((p) => [p.nombre, p.categoria, p.cantidad, p.total]),
    [],
    ['Por categoría (antes de descuentos)', 'Cantidad', 'Total'],
    ...r.porCategoria.map((c) => [c.categoria, c.cantidad, c.total]),
    [],
    ['Por vendedor', 'Ventas', 'Total'],
    ...r.porVendedor.map((v) => [v.nombre, v.ventas, v.total]),
  ]);
}

async function csvDetalle({ inicio, fin }: Rango): Promise<string> {
  const ventas = await prisma.venta.findMany({
    where: { creadaEn: { gte: inicio, lt: fin } },
    orderBy: { id: 'asc' },
    include: {
      usuario: { select: { nombre: true } },
      items: { orderBy: { id: 'asc' }, include: { producto: { select: { categoria: true } } } },
    },
  });
  const filas = ventas.flatMap((v) =>
    v.items.map((i) => [
      v.id, fmtDia.format(v.creadaEn), fmtHora.format(v.creadaEn), v.usuario.nombre, METODOS[v.metodoPago],
      v.estado === 'ACTIVA' ? 'Activa' : 'Anulada', i.nombre, i.producto.categoria, i.cantidad, i.precioUnitario,
      i.totalLinea, v.subtotal, v.descuento, v.total, v.motivoAnulacion,
    ]),
  );
  return csv([
    ['N.º venta', 'Fecha', 'Hora', 'Vendedor', 'Método de pago', 'Estado', 'Producto', 'Categoría', 'Cantidad',
      'Precio unitario', 'Total línea', 'Subtotal de la venta', 'Descuento de la venta', 'Total de la venta', 'Motivo de anulación'],
    ...filas,
  ]);
}
