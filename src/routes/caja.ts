// Caja: apertura, cierre con arqueo y consulta. Cada usuario tiene, como mucho, una caja abierta.
import type { FastifyInstance } from 'fastify';
import type { Prisma, SesionCaja } from '@prisma/client';
import { prisma } from '../db';
import { ErrorHttp, entero, idDeUrl, objeto, texto } from '../util';

type Db = Prisma.TransactionClient;
const MONTO_MAXIMO = 2_000_000_000;
const conNombres = { usuario: { select: { nombre: true } }, cerradaPor: { select: { nombre: true } } } as const;

/** Totales vivos de una caja por método de pago. Las ventas anuladas no suman. */
async function resumenCaja(db: Db, cajaId: number) {
  const grupos = await db.venta.groupBy({
    by: ['metodoPago', 'estado'],
    where: { cajaId },
    _sum: { total: true },
    _count: true,
  });
  const r = { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, ventas: 0, anuladas: 0, totalAnulado: 0 };
  for (const g of grupos) {
    const total = g._sum.total ?? 0;
    if (g.estado === 'ANULADA') {
      r.anuladas += g._count;
      r.totalAnulado += total;
    } else {
      r[g.metodoPago] += total;
      r.ventas += g._count;
    }
  }
  return r;
}

/**
 * Caja con su cuadre. Abierta: totales en vivo. Cerrada: los valores guardados al cierre,
 * más lo anulado después (que ya no cambia el cierre, pero debe quedar a la vista).
 */
async function conCuadre<T extends SesionCaja>(db: Db, caja: T) {
  const vivo = await resumenCaja(db, caja.id);
  const cerrada = caja.estado === 'CERRADA';
  const tras = cerrada && caja.cerradaEn
    ? await db.venta.aggregate({
        where: { cajaId: caja.id, estado: 'ANULADA', anuladaEn: { gt: caja.cerradaEn } },
        _sum: { total: true },
        _count: true,
      })
    : null;
  const efectivo = cerrada ? (caja.ventasEfectivo ?? 0) : vivo.EFECTIVO;
  const tarjeta = cerrada ? (caja.ventasTarjeta ?? 0) : vivo.TARJETA;
  const transferencia = cerrada ? (caja.ventasTransferencia ?? 0) : vivo.TRANSFERENCIA;
  const anuladasTrasCierre = { ventas: tras?._count ?? 0, total: tras?._sum.total ?? 0 };
  return {
    ...caja,
    cuadre: {
      base: caja.baseInicial,
      efectivo,
      tarjeta,
      transferencia,
      totalVentas: efectivo + tarjeta + transferencia,
      efectivoEsperado: caja.baseInicial + efectivo,
      efectivoContado: caja.efectivoContado,
      diferencia: caja.diferencia,
      // Lo que contaba al cerrar incluye lo que se anuló después.
      ventas: vivo.ventas + anuladasTrasCierre.ventas,
      anuladas: vivo.anuladas - anuladasTrasCierre.ventas,
      totalAnulado: vivo.totalAnulado - anuladasTrasCierre.total,
      anuladasTrasCierre,
    },
  };
}

export async function rutasCaja(app: FastifyInstance) {
  // Caja abierta de quien pregunta (o null).
  app.get('/api/caja/actual', async (req) => {
    const caja = await prisma.sesionCaja.findFirst({
      where: { usuarioId: req.usuario!.id, estado: 'ABIERTA' },
      include: conNombres,
    });
    return { caja: caja ? await conCuadre(prisma, caja) : null };
  });

  app.post('/api/caja/abrir', async (req, reply) => {
    const baseInicial = entero(objeto(req.body).baseInicial, 'Base inicial', 0, MONTO_MAXIMO);
    const usuarioId = req.usuario!.id;
    const caja = await prisma.$transaction(async (tx) => {
      // Bloquea al usuario: dos aperturas simultáneas no pueden dejar dos cajas abiertas.
      await tx.$queryRaw`SELECT id FROM "Usuario" WHERE id = ${usuarioId} FOR NO KEY UPDATE`;
      if (await tx.sesionCaja.findFirst({ where: { usuarioId, estado: 'ABIERTA' } })) {
        throw new ErrorHttp(409, 'Ya tienes una caja abierta. Ciérrala antes de abrir otra.');
      }
      return tx.sesionCaja.create({ data: { usuarioId, baseInicial }, include: conNombres });
    });
    return reply.code(201).send(await conCuadre(prisma, caja));
  });

  // Cierre con arqueo: el vendedor solo cierra la suya; el admin, cualquiera.
  app.post('/api/caja/:id/cerrar', async (req) => {
    const id = idDeUrl(req.params);
    const b = objeto(req.body);
    const efectivoContado = entero(b.efectivoContado, 'Efectivo contado', 0, MONTO_MAXIMO);
    const nota = b.nota === undefined || b.nota === '' ? null : texto(b.nota, 'Nota', 1, 200);
    const yo = req.usuario!;

    const cerrada = await prisma.$transaction(async (tx) => {
      // Bloqueo exclusivo: espera a las ventas en curso de esta caja y frena las nuevas,
      // así los totales del cierre incluyen exactamente lo que se vendió.
      await tx.$queryRaw`SELECT id FROM "SesionCaja" WHERE id = ${id} FOR UPDATE`;
      const caja = await tx.sesionCaja.findUnique({ where: { id } });
      if (!caja) throw new ErrorHttp(404, 'Caja no encontrada');
      if (caja.usuarioId !== yo.id && yo.rol !== 'ADMIN') throw new ErrorHttp(403, 'Solo puedes cerrar tu propia caja');
      if (caja.estado === 'CERRADA') throw new ErrorHttp(409, 'Esta caja ya está cerrada');

      const r = await resumenCaja(tx, id);
      const efectivoEsperado = caja.baseInicial + r.EFECTIVO;
      return tx.sesionCaja.update({
        where: { id },
        data: {
          estado: 'CERRADA',
          cerradaEn: new Date(),
          cerradaPorId: yo.id,
          ventasEfectivo: r.EFECTIVO,
          ventasTarjeta: r.TARJETA,
          ventasTransferencia: r.TRANSFERENCIA,
          efectivoEsperado,
          efectivoContado,
          diferencia: efectivoContado - efectivoEsperado,
          nota,
        },
        include: conNombres,
      });
    });
    return conCuadre(prisma, cerrada);
  });

  // Cajas recientes: el vendedor ve las suyas; el admin, todas.
  app.get('/api/cajas', async (req) => {
    const yo = req.usuario!;
    const cajas = await prisma.sesionCaja.findMany({
      where: yo.rol === 'ADMIN' ? {} : { usuarioId: yo.id },
      orderBy: { id: 'desc' },
      take: 30,
      include: conNombres,
    });
    return Promise.all(cajas.map((c) => conCuadre(prisma, c)));
  });
}
