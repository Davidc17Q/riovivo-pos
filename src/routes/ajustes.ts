// Ajustes del negocio: QR de reseñas, domicilio nocturno, métodos de pago habilitados y si se
// usa la pantalla de cocina (comandas). Así cada negocio activa solo lo que usa.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { ErrorHttp, objeto, texto } from '../util';

const TEXTO_RESENA = '¿Cómo te fue? Escanea y califica tu experiencia';
const NOCHE_DESDE = '18:00';
export const METODOS_PAGO = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'] as const;
export type MetodoBasico = (typeof METODOS_PAGO)[number];
const CLAVES = ['resenaUrl', 'resenaTexto', 'domicilioNocheDesde', 'metodosPago', 'comandas'];

export async function leerAjustes() {
  const filas = await prisma.ajuste.findMany({ where: { clave: { in: CLAVES } } });
  const v = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const metodos = (v.metodosPago ?? METODOS_PAGO.join(',')).split(',').filter((m): m is MetodoBasico => (METODOS_PAGO as readonly string[]).includes(m));
  return {
    resenaUrl: v.resenaUrl ?? null,
    resenaTexto: v.resenaTexto ?? TEXTO_RESENA,
    domicilioNocheDesde: v.domicilioNocheDesde ?? NOCHE_DESDE,
    metodosPago: metodos.length ? metodos : [...METODOS_PAGO],
    // Pantalla de cocina y comandas: solo si el negocio prepara pedidos en su propia cocina.
    comandas: (v.comandas ?? 'si') === 'si',
  };
}
const leer = leerAjustes;

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
    const noche = b.domicilioNocheDesde === undefined || b.domicilioNocheDesde === '' ? NOCHE_DESDE : String(b.domicilioNocheDesde);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(noche)) throw new ErrorHttp(400, 'La hora del domicilio de noche debe ser HH:MM (por ejemplo 18:00)');
    const actuales = await leer();
    let metodos = actuales.metodosPago as string[];
    if (b.metodosPago !== undefined) {
      if (!Array.isArray(b.metodosPago)) throw new ErrorHttp(400, 'Métodos de pago inválidos');
      metodos = METODOS_PAGO.filter((m) => (b.metodosPago as unknown[]).includes(m));
      if (!metodos.length) throw new ErrorHttp(400, 'Deja al menos un método de pago habilitado');
    }
    const comandas = b.comandas === undefined ? actuales.comandas : b.comandas === true;
    await prisma.$transaction([
      resenaUrl === null
        ? prisma.ajuste.deleteMany({ where: { clave: 'resenaUrl' } })
        : prisma.ajuste.upsert({ where: { clave: 'resenaUrl' }, create: { clave: 'resenaUrl', valor: resenaUrl }, update: { valor: resenaUrl } }),
      prisma.ajuste.upsert({ where: { clave: 'resenaTexto' }, create: { clave: 'resenaTexto', valor: resenaTexto }, update: { valor: resenaTexto } }),
      prisma.ajuste.upsert({ where: { clave: 'domicilioNocheDesde' }, create: { clave: 'domicilioNocheDesde', valor: noche }, update: { valor: noche } }),
      prisma.ajuste.upsert({ where: { clave: 'metodosPago' }, create: { clave: 'metodosPago', valor: metodos.join(',') }, update: { valor: metodos.join(',') } }),
      prisma.ajuste.upsert({ where: { clave: 'comandas' }, create: { clave: 'comandas', valor: comandas ? 'si' : 'no' }, update: { valor: comandas ? 'si' : 'no' } }),
    ]);
    return leer();
  });
}
