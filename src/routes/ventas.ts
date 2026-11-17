// Área de ventas: catálogo para caja, registrar venta, ticket y ventas del día.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { ErrorHttp, UN_DIA_MS, entero, fecha, hoy, idDeUrl, inicioDelDia, objeto, opcion } from '../util';

const METODOS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const;
const TOTAL_MAXIMO = 2_000_000_000; // cabe en un entero de Postgres

const conDetalle = { items: { orderBy: { id: 'asc' } }, usuario: { select: { nombre: true } } } as const;

export async function rutasVentas(app: FastifyInstance) {
  // Caja ve solo lo vendible y activo; el admin puede pedir todo el catálogo.
  app.get('/api/productos', async (req) => {
    const todos = (req.query as { todos?: string }).todos === '1' && req.usuario!.rol === 'ADMIN';
    return prisma.producto.findMany({
      where: todos ? {} : { activo: true, seVende: true },
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    });
  });

  app.post('/api/ventas', async (req, reply) => {
    const b = objeto(req.body);
    const metodoPago = opcion(b.metodoPago, 'Método de pago', METODOS);
    const descuento = entero(b.descuento ?? 0, 'Descuento', 0, TOTAL_MAXIMO);
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 100) {
      throw new ErrorHttp(400, 'La venta debe tener entre 1 y 100 productos');
    }
    // Se suman las cantidades si un producto viene repetido.
    const cantidades = new Map<number, number>();
    for (const crudo of b.items) {
      const it = objeto(crudo);
      const id = entero(it.productoId, 'Producto', 1, 999_999_999);
      const cant = entero(it.cantidad, 'Cantidad', 1, 9999);
      cantidades.set(id, (cantidades.get(id) ?? 0) + cant);
    }
    // Orden fijo de ids: dos cajas vendiendo lo mismo no se bloquean entre sí.
    const ids = [...cantidades.keys()].sort((a, c) => a - c);
    const usuarioId = req.usuario!.id;

    // Venta, líneas y descuento de inventario: todo o nada.
    const venta = await prisma.$transaction(async (tx) => {
      const productos = await tx.producto.findMany({ where: { id: { in: ids } } });
      const porId = new Map(productos.map((p) => [p.id, p]));
      let subtotal = 0;
      const lineas = ids.map((id) => {
        const p = porId.get(id);
        if (!p || !p.activo || !p.seVende) throw new ErrorHttp(400, 'Hay un producto que ya no está disponible');
        const cantidad = cantidades.get(id)!;
        // El precio sale de la base, nunca del navegador.
        const totalLinea = p.precio * cantidad;
        subtotal += totalLinea;
        return { productoId: id, nombre: p.nombre, precioUnitario: p.precio, cantidad, totalLinea };
      });
      if (subtotal > TOTAL_MAXIMO) throw new ErrorHttp(400, 'El total supera el máximo permitido');
      if (descuento > subtotal) throw new ErrorHttp(400, 'El descuento no puede ser mayor que el subtotal');

      const creada = await tx.venta.create({
        data: { usuarioId, subtotal, descuento, total: subtotal - descuento, metodoPago, items: { create: lineas } },
        include: conDetalle,
      });

      for (const l of lineas) {
        const p = porId.get(l.productoId)!;
        if (!p.controlaStock) continue;
        // Descuento atómico: solo resta si alcanza el stock en ese instante.
        const r = await tx.producto.updateMany({
          where: { id: p.id, stock: { gte: l.cantidad } },
          data: { stock: { decrement: l.cantidad } },
        });
        if (r.count === 0) throw new ErrorHttp(409, `No hay suficiente stock de "${p.nombre}"`);
        const { stock } = await tx.producto.findUniqueOrThrow({ where: { id: p.id }, select: { stock: true } });
        await tx.movimientoInventario.create({
          data: { productoId: p.id, tipo: 'VENTA', cantidad: -l.cantidad, stockResultante: stock, usuarioId, ventaId: creada.id },
        });
      }
      return creada;
    });
    return reply.code(201).send(venta);
  });

  // Ventas de un día (por defecto hoy, hora de Colombia).
  app.get('/api/ventas', async (req) => {
    const q = req.query as { fecha?: string };
    const dia = q.fecha ? fecha(q.fecha, 'Fecha') : hoy();
    const inicio = inicioDelDia(dia);
    const ventas = await prisma.venta.findMany({
      where: { creadaEn: { gte: inicio, lt: new Date(inicio.getTime() + UN_DIA_MS) } },
      orderBy: { id: 'desc' },
      include: conDetalle,
    });
    return { fecha: dia, total: ventas.reduce((s, v) => s + v.total, 0), ventas };
  });

  app.get('/api/ventas/:id', async (req) => {
    const venta = await prisma.venta.findUnique({ where: { id: idDeUrl(req.params) }, include: conDetalle });
    if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
    return venta;
  });
}
