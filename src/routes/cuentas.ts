// Cuentas abiertas: cabañas, mesas o clientes que van cargando consumos y pagan una sola vez.
// Al cobrar se crea una venta normal con crearVenta (caja, pagos, inventario y reportes).
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ErrorHttp, entero, idDeUrl, objeto, texto } from '../util';
import { crearVenta, leerItems, leerPago } from './ventas';
import { cancelarComandas, crearComandas } from './comandas';

type Tx = Prisma.TransactionClient;

const conItems = {
  abiertaPor: { select: { nombre: true } },
  items: {
    orderBy: { id: 'asc' },
    include: { producto: { select: { nombre: true, precio: true, categoria: true, activo: true, seVende: true } } },
  },
} as const;

type CuentaDb = Prisma.CuentaGetPayload<{ include: typeof conItems }>;

/** Total al precio vigente (es el que se cobrará). */
function conTotal(c: CuentaDb) {
  const total = c.items.reduce((s, i) => s + i.producto.precio * i.cantidad, 0);
  const unidades = c.items.reduce((s, i) => s + i.cantidad, 0);
  return { ...c, total, unidades };
}

/** Bloquea la cuenta (espera a quien la esté cobrando) y exige que siga abierta. */
async function cuentaAbierta(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM "Cuenta" WHERE id = ${id} FOR UPDATE`;
  const c = await tx.cuenta.findUnique({ where: { id } });
  if (!c) throw new ErrorHttp(404, 'Cuenta no encontrada');
  if (c.estado !== 'ABIERTA') throw new ErrorHttp(409, c.estado === 'COBRADA' ? 'Esta cuenta ya se cobró' : 'Esta cuenta está cancelada');
  return c;
}

/**
 * Suma productos a la cuenta. Valida que se vendan y que, si llevan inventario, alcance hoy.
 * Lo que va a cocina o bar sale de una vez como comanda con el nombre de la cuenta.
 */
async function cargar(tx: Tx, cuenta: { id: number; nombre: string }, usuarioId: number, cantidades: Map<number, number>) {
  const cuentaId = cuenta.id;
  const ids = [...cantidades.keys()];
  const productos = await tx.producto.findMany({ where: { id: { in: ids } } });
  const actuales = await tx.cuentaItem.findMany({ where: { cuentaId, productoId: { in: ids } } });
  for (const id of ids) {
    const p = productos.find((x) => x.id === id);
    if (!p || !p.activo || !p.seVende) throw new ErrorHttp(400, 'Hay un producto que ya no está disponible');
    const nueva = (actuales.find((a) => a.productoId === id)?.cantidad ?? 0) + cantidades.get(id)!;
    if (nueva > 9999) throw new ErrorHttp(400, 'Cantidad demasiado alta');
    if (p.controlaStock && nueva > p.stock) throw new ErrorHttp(409, `Solo quedan ${p.stock} de "${p.nombre}"`);
    await tx.cuentaItem.upsert({
      where: { cuentaId_productoId: { cuentaId, productoId: id } },
      create: { cuentaId, productoId: id, cantidad: nueva },
      update: { cantidad: nueva },
    });
  }
  await crearComandas(tx, { usuarioId, referencia: cuenta.nombre, cuentaId, cantidades });
}

const nombreDe = (v: unknown) => texto(typeof v === 'string' ? v.trim() : v, 'Nombre de la cuenta', 1, 60);

export async function rutasCuentas(app: FastifyInstance) {
  // Cuentas abiertas: las ve todo el equipo (cualquiera puede cargar o cobrar).
  app.get('/api/cuentas', async () => {
    const cuentas = await prisma.cuenta.findMany({ where: { estado: 'ABIERTA' }, orderBy: { abiertaEn: 'asc' }, include: conItems });
    return cuentas.map(conTotal);
  });

  app.get('/api/cuentas/:id', async (req) => {
    const c = await prisma.cuenta.findUnique({ where: { id: idDeUrl(req.params) }, include: conItems });
    if (!c) throw new ErrorHttp(404, 'Cuenta no encontrada');
    return conTotal(c);
  });

  // Abrir una cuenta, opcionalmente con sus primeros consumos.
  app.post('/api/cuentas', async (req, reply) => {
    const b = objeto(req.body);
    const nombre = nombreDe(b.nombre);
    const cantidades = b.items === undefined ? null : leerItems(b.items);
    const usuarioId = req.usuario!.id;
    const cuenta = await prisma.$transaction(async (tx) => {
      // Un bloqueo por nombre evita abrir dos cuentas "Cabaña 3" a la vez.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(lower(${nombre})))`;
      const repetida = await tx.cuenta.findFirst({ where: { estado: 'ABIERTA', nombre: { equals: nombre, mode: 'insensitive' } } });
      if (repetida) throw new ErrorHttp(409, `Ya hay una cuenta abierta llamada "${repetida.nombre}"`);
      const c = await tx.cuenta.create({ data: { nombre, abiertaPorId: usuarioId } });
      if (cantidades) await cargar(tx, c, usuarioId, cantidades);
      return tx.cuenta.findUniqueOrThrow({ where: { id: c.id }, include: conItems });
    });
    return reply.code(201).send(conTotal(cuenta));
  });

  // Cargar consumos a una cuenta abierta.
  app.post('/api/cuentas/:id/items', async (req) => {
    const id = idDeUrl(req.params);
    const cantidades = leerItems(objeto(req.body).items);
    const usuarioId = req.usuario!.id;
    const cuenta = await prisma.$transaction(async (tx) => {
      const c = await cuentaAbierta(tx, id);
      await cargar(tx, c, usuarioId, cantidades);
      return tx.cuenta.findUniqueOrThrow({ where: { id }, include: conItems });
    });
    return conTotal(cuenta);
  });

  // Corregir la cantidad de un producto (0 lo quita).
  app.put('/api/cuentas/:id/items/:productoId', async (req) => {
    const id = idDeUrl(req.params);
    const productoId = entero(Number((req.params as { productoId?: string }).productoId), 'Producto', 1, 999_999_999);
    const cantidad = entero(objeto(req.body).cantidad, 'Cantidad', 0, 9999);
    const usuarioId = req.usuario!.id;
    const cuenta = await prisma.$transaction(async (tx) => {
      const c = await cuentaAbierta(tx, id);
      const antes = (await tx.cuentaItem.findUnique({ where: { cuentaId_productoId: { cuentaId: id, productoId } } }))?.cantidad ?? 0;
      if (cantidad === 0) {
        await tx.cuentaItem.deleteMany({ where: { cuentaId: id, productoId } });
      } else {
        const p = await tx.producto.findUnique({ where: { id: productoId } });
        if (!p) throw new ErrorHttp(404, 'Producto no encontrado');
        if (p.controlaStock && cantidad > p.stock) throw new ErrorHttp(409, `Solo quedan ${p.stock} de "${p.nombre}"`);
        const r = await tx.cuentaItem.updateMany({ where: { cuentaId: id, productoId }, data: { cantidad } });
        if (r.count === 0) throw new ErrorHttp(404, 'Ese producto no está en la cuenta');
        // Si se pidió más, solo lo nuevo va a cocina; bajar la cantidad no genera comanda.
        if (cantidad > antes) await crearComandas(tx, { usuarioId, referencia: c.nombre, cuentaId: id, cantidades: new Map([[productoId, cantidad - antes]]) });
      }
      return tx.cuenta.findUniqueOrThrow({ where: { id }, include: conItems });
    });
    return conTotal(cuenta);
  });

  // Cobrar: se crea la venta con los consumos de la cuenta (no con lo que mande el navegador).
  app.post('/api/cuentas/:id/cobrar', async (req, reply) => {
    const id = idDeUrl(req.params);
    const pago = leerPago(objeto(req.body));
    const usuarioId = req.usuario!.id;
    const venta = await prisma.$transaction(async (tx) => {
      const c = await cuentaAbierta(tx, id);
      const items = await tx.cuentaItem.findMany({ where: { cuentaId: id } });
      if (items.length === 0) throw new ErrorHttp(400, 'La cuenta no tiene consumos para cobrar');
      const v = await crearVenta(tx, usuarioId, new Map(items.map((i) => [i.productoId, i.cantidad])), pago, c.nombre);
      await tx.cuenta.update({ where: { id }, data: { estado: 'COBRADA', cerradaEn: new Date(), ventaId: v.id } });
      return v;
    });
    return reply.code(201).send(venta);
  });

  // Cancelar: una cuenta vacía la cancela cualquiera; con consumos, solo un administrador.
  app.post('/api/cuentas/:id/cancelar', async (req) => {
    const id = idDeUrl(req.params);
    const yo = req.usuario!;
    await prisma.$transaction(async (tx) => {
      await cuentaAbierta(tx, id);
      const n = await tx.cuentaItem.count({ where: { cuentaId: id } });
      if (n > 0 && yo.rol !== 'ADMIN') throw new ErrorHttp(403, 'Solo un administrador puede cancelar una cuenta con consumos');
      await tx.cuenta.update({ where: { id }, data: { estado: 'CANCELADA', cerradaEn: new Date() } });
      await cancelarComandas(tx, { cuentaId: id });
    });
    return { ok: true };
  });
}
