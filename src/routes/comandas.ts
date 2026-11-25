// Comandas de cocina y bar. Nacen al vender o al cargar a una cuenta productos con estación,
// y la pantalla /cocina las avanza: pendiente → en preparación → lista → entregada.
import type { FastifyInstance } from 'fastify';
import type { Estacion, EstadoComanda, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ErrorHttp, idDeUrl, objeto, opcion } from '../util';
import { leerAjustes } from './ajustes';

type Tx = Prisma.TransactionClient;

const AVANCES = ['PENDIENTE', 'PREPARANDO', 'LISTA', 'ENTREGADA'] as const;
const ESTACIONES = ['COCINA', 'BAR', 'TODAS'] as const;
const CANCELADAS_VISIBLES_MS = 15 * 60 * 1000; // la cocina ve lo cancelado un rato, para no seguir preparándolo

const conItems = {
  items: { orderBy: { id: 'asc' } },
  usuario: { select: { nombre: true } },
} as const;

/**
 * Crea una comanda por estación con los productos dados (cantidad pedida, no acumulada).
 * Los productos sin estación (experiencias, hospedaje) no generan nada.
 */
export async function crearComandas(
  tx: Tx,
  o: { usuarioId: number; referencia: string | null; ventaId?: number; cuentaId?: number; cantidades: Map<number, number> },
) {
  const ids = [...o.cantidades.keys()];
  if (!ids.length) return;
  // Si el negocio no usa pantalla de cocina, no se generan comandas.
  if (!(await leerAjustes()).comandas) return;
  const productos = await tx.producto.findMany({ where: { id: { in: ids }, estacion: { not: 'NINGUNA' } }, orderBy: { id: 'asc' } });
  const porEstacion = new Map<Estacion, { nombre: string; cantidad: number }[]>();
  for (const p of productos) {
    const cantidad = o.cantidades.get(p.id) ?? 0;
    if (cantidad <= 0) continue;
    porEstacion.set(p.estacion, [...(porEstacion.get(p.estacion) ?? []), { nombre: p.nombre, cantidad }]);
  }
  for (const [estacion, items] of porEstacion) {
    await tx.comanda.create({
      data: {
        estacion, referencia: o.referencia, ventaId: o.ventaId, cuentaId: o.cuentaId, usuarioId: o.usuarioId,
        items: { create: items },
      },
    });
  }
}

/** Lo que aún no salió de cocina deja de prepararse (venta anulada o cuenta cancelada). */
export async function cancelarComandas(tx: Tx, donde: { ventaId?: number; cuentaId?: number }) {
  await tx.comanda.updateMany({ where: { ...donde, estado: { in: ['PENDIENTE', 'PREPARANDO'] } }, data: { estado: 'CANCELADA' } });
}

export async function rutasComandas(app: FastifyInstance) {
  // Tablero: lo activo de la estación y lo cancelado en los últimos minutos.
  app.get('/api/comandas', async (req) => {
    const estacion = opcion((req.query as { estacion?: string }).estacion ?? 'TODAS', 'Estación', ESTACIONES);
    return prisma.comanda.findMany({
      where: {
        ...(estacion === 'TODAS' ? {} : { estacion }),
        OR: [
          { estado: { in: ['PENDIENTE', 'PREPARANDO', 'LISTA'] } },
          { estado: 'CANCELADA', actualizadaEn: { gt: new Date(Date.now() - CANCELADAS_VISIBLES_MS) } },
        ],
      },
      orderBy: { id: 'asc' },
      include: conItems,
    });
  });

  // Avanzar (o devolver) el estado. Lo pueden hacer cocina, caja y administración.
  app.post('/api/comandas/:id/estado', async (req) => {
    const id = idDeUrl(req.params);
    const estado: EstadoComanda = opcion(objeto(req.body).estado, 'Estado', AVANCES);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Comanda" WHERE id = ${id} FOR UPDATE`;
      const c = await tx.comanda.findUnique({ where: { id } });
      if (!c) throw new ErrorHttp(404, 'Comanda no encontrada');
      if (c.estado === 'CANCELADA') throw new ErrorHttp(409, 'Esta comanda se canceló');
      if (c.estado === 'ENTREGADA') throw new ErrorHttp(409, 'Esta comanda ya se entregó');
      return tx.comanda.update({ where: { id }, data: { estado }, include: conItems });
    });
  });
}
