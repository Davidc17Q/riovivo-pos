// Área de ventas: catálogo para caja, registrar venta, ticket y ventas del día.
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { crearComandas } from './comandas';
import { leerAjustes } from './ajustes';
import { prisma } from '../db';
import { ErrorHttp, UN_DIA_MS, entero, fecha, hoy, idDeUrl, inicioDelDia, objeto, opcion, texto } from '../util';

const METODOS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const;
const TOTAL_MAXIMO = 2_000_000_000; // cabe en un entero de Postgres

export const conDetalle = {
  items: { orderBy: { id: 'asc' } },
  pagos: { orderBy: { id: 'asc' } },
  usuario: { select: { nombre: true } },
  anuladaPor: { select: { nombre: true } },
} as const;

type Tx = Prisma.TransactionClient;
export type Pago = ReturnType<typeof leerPago>;

/** Descuento y forma de pago: simple (metodoPago) o repartida (pagos: [{ metodo, monto }]), más el efectivo recibido. */
export function leerPago(b: Record<string, unknown>) {
  const pagosPedidos = Array.isArray(b.pagos)
    ? b.pagos.map((crudo) => {
        const p = objeto(crudo);
        return { metodo: opcion(p.metodo, 'Método de pago', METODOS), monto: entero(p.monto, 'Monto del pago', 1, TOTAL_MAXIMO) };
      })
    : null;
  if (pagosPedidos && (pagosPedidos.length === 0 || pagosPedidos.length > METODOS.length)) {
    throw new ErrorHttp(400, 'Indica entre uno y tres pagos');
  }
  if (pagosPedidos && new Set(pagosPedidos.map((p) => p.metodo)).size !== pagosPedidos.length) {
    throw new ErrorHttp(400, 'Cada método de pago puede aparecer una sola vez');
  }
  const metodoSimple = pagosPedidos ? null : opcion(b.metodoPago, 'Método de pago', METODOS);
  const recibido = b.recibido === undefined || b.recibido === null || b.recibido === '' ? null : entero(b.recibido, 'Paga con', 0, TOTAL_MAXIMO);
  const descuento = entero(b.descuento ?? 0, 'Descuento', 0, TOTAL_MAXIMO);
  return { pagosPedidos, metodoSimple, recibido, descuento };
}

/** Productos pedidos → cantidad por producto (se suman los repetidos). */
export function leerItems(items: unknown): Map<number, number> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new ErrorHttp(400, 'La venta debe tener entre 1 y 100 productos');
  }
  const cantidades = new Map<number, number>();
  for (const crudo of items) {
    const it = objeto(crudo);
    const id = entero(it.productoId, 'Producto', 1, 999_999_999);
    const cant = entero(it.cantidad, 'Cantidad', 1, 9999);
    cantidades.set(id, (cantidades.get(id) ?? 0) + cant);
  }
  return cantidades;
}

/** Registra una venta dentro de una transacción: caja abierta, precios de la base, pagos e inventario. */
export async function crearVenta(tx: Tx, usuarioId: number, cantidades: Map<number, number>, pago: Pago, referencia: string | null) {
  const { pagosPedidos, metodoSimple, recibido, descuento } = pago;
  // Orden fijo de ids: dos cajas vendiendo lo mismo no se bloquean entre sí.
  const ids = [...cantidades.keys()].sort((a, c) => a - c);
  // Sin caja abierta no se vende. El bloqueo compartido deja vender a la vez,
  // pero hace esperar al cierre: ninguna venta entra a una caja ya cuadrada.
  const cajas = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "SesionCaja" WHERE "usuarioId" = ${usuarioId} AND estado = 'ABIERTA' FOR SHARE`;
  const cajaId = cajas[0]?.id;
  if (!cajaId) throw new ErrorHttp(409, 'No hay caja abierta. Abre la caja antes de registrar ventas.');

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
  const total = subtotal - descuento;

  // El reparto debe sumar exactamente el total que calcula el servidor.
  const pagos = pagosPedidos ?? (total > 0 ? [{ metodo: metodoSimple!, monto: total }] : []);
  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  if (pagado !== total) {
    throw new ErrorHttp(400, pagado < total ? `Falta por pagar ${total - pagado} pesos` : 'Los pagos superan el total de la venta');
  }
  // Solo los métodos que el negocio tiene habilitados (Ajustes).
  const { metodosPago } = await leerAjustes();
  const metodoSuelto = pagos.length ? null : metodoSimple;
  if ([...pagos.map((p) => p.metodo), ...(metodoSuelto ? [metodoSuelto] : [])].some((m) => !(metodosPago as string[]).includes(m))) {
    throw new ErrorHttp(400, 'Ese método de pago no está habilitado en este negocio');
  }
  const metodoPago = pagos.length > 1 ? 'MIXTO' : (pagos[0]?.metodo ?? metodoSimple ?? 'EFECTIVO');
  // Vuelto: solo aplica a la parte en efectivo.
  const enEfectivo = pagos.find((p) => p.metodo === 'EFECTIVO')?.monto ?? 0;
  if (recibido !== null && enEfectivo === 0) throw new ErrorHttp(400, '"Paga con" solo aplica a pagos en efectivo');
  if (recibido !== null && recibido < enEfectivo) throw new ErrorHttp(400, 'El efectivo recibido no alcanza para la parte en efectivo');
  const cambio = recibido === null ? null : recibido - enEfectivo;

  const creada = await tx.venta.create({
    data: {
      usuarioId, cajaId, subtotal, descuento, total, metodoPago, referencia, recibido, cambio,
      items: { create: lineas },
      pagos: { create: pagos },
    },
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
}

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
    const pago = leerPago(b);
    const referencia = typeof b.referencia === 'string' && b.referencia.trim() ? texto(b.referencia.trim(), 'Referencia', 1, 60) : null;
    const cantidades = leerItems(b.items);
    const usuarioId = req.usuario!.id;
    // Venta, líneas y descuento de inventario: todo o nada.
    const venta = await prisma.$transaction(async (tx) => {
      const v = await crearVenta(tx, usuarioId, cantidades, pago, referencia);
      await crearComandas(tx, { usuarioId, referencia, ventaId: v.id, cantidades });
      return v;
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
    // Las anuladas se listan, pero no suman.
    const total = ventas.reduce((s, v) => s + (v.estado === 'ACTIVA' ? v.total : 0), 0);
    // Cierre ciego: el vendedor no ve totales en dinero; el listado sí (para reimprimir y consultar).
    if (req.usuario!.rol !== 'ADMIN') return { fecha: dia, ciego: true, ventas };
    return { fecha: dia, total, ventas };
  });

  app.get('/api/ventas/:id', async (req) => {
    const venta = await prisma.venta.findUnique({ where: { id: idDeUrl(req.params) }, include: conDetalle });
    if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
    return venta;
  });
}
