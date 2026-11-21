// Ajustes del negocio. Por ahora: el enlace de reseñas (NFCloud) que va como QR en el ticket.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { ErrorHttp, objeto, texto } from '../util';

const TEXTO_RESENA = '¿Cómo te fue? Escanea y califica tu experiencia';

async function leer() {
  const filas = await prisma.ajuste.findMany({ where: { clave: { in: ['resenaUrl', 'resenaTexto'] } } });
  const v = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return { resenaUrl: v.resenaUrl ?? null, resenaTexto: v.resenaTexto ?? TEXTO_RESENA };
}

/** Enlace http(s) que quepa en un QR (versión 10, nivel M: 213 bytes). */
function enlace(v: unknown): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  const s = texto(typeof v === 'string' ? v.trim() : v, 'Enlace de reseñas', 1, 200);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new ErrorHttp(400, 'El enlace de reseñas no es una dirección válida');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ErrorHttp(400, 'El enlace debe empezar por https://');
  return s;
}

export async function rutasAjustes(app: FastifyInstance) {
  // Lo leen todas las pantallas (el ticket lo necesita); solo el admin lo cambia.
  app.get('/api/ajustes', async () => leer());

  app.put('/api/ajustes', async (req) => {
    if (req.usuario!.rol !== 'ADMIN') throw new ErrorHttp(403, 'Solo para administradores');
    const b = objeto(req.body);
    const resenaUrl = enlace(b.resenaUrl);
    const resenaTexto = b.resenaTexto === undefined || b.resenaTexto === '' ? TEXTO_RESENA : texto(b.resenaTexto, 'Texto del ticket', 1, 80);
    await prisma.$transaction([
      resenaUrl === null
        ? prisma.ajuste.deleteMany({ where: { clave: 'resenaUrl' } })
        : prisma.ajuste.upsert({ where: { clave: 'resenaUrl' }, create: { clave: 'resenaUrl', valor: resenaUrl }, update: { valor: resenaUrl } }),
      prisma.ajuste.upsert({ where: { clave: 'resenaTexto' }, create: { clave: 'resenaTexto', valor: resenaTexto }, update: { valor: resenaTexto } }),
    ]);
    return leer();
  });
}
