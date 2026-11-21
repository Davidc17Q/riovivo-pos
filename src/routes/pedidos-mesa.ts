// Pedidos desde la mesa: el cliente toca la tarjeta NFCloud, arma su pedido en la carta
// (riovivospa.netlify.app/?mesa=N) y la carta lo envía aquí. Recepción lo revisa y, al
// aceptarlo, se carga a la cuenta de la mesa (y sale la comanda). Nada se cobra solo.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ErrorHttp, ZONA, entero, idDeUrl, objeto, texto } from '../util';
import { cargar, cuentaAbiertaONueva } from './cuentas';
import { leerAjustes } from './ajustes';

type Tx = Prisma.TransactionClient;

// Sitios que pueden enviar pedidos (la carta publicada). Se cambia con CARTA_ORIGENES.
const ORIGENES = (process.env.CARTA_ORIGENES ?? 'https://riovivospa.netlify.app')
  .split(',').map((o) => o.trim()).filter(Boolean);
const VENTANA_MS = 10 * 60 * 1000;
const POR_IP = 6; // pedidos por dispositivo cada 10 minutos
const PENDIENTES_MAXIMO = 40; // tope de pedidos sin atender (evita que alguien llene la bandeja)

const enviados = new Map<string, number[]>();
function limitar(ip: string) {
  // En desarrollo, las pruebas locales no se frenan a sí mismas.
  if (process.env.NODE_ENV !== 'production' && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return;
  const ahora = Date.now();
  for (const [k, v] of enviados) if (v.every((t) => ahora - t > VENTANA_MS)) enviados.delete(k);
  const recientes = (enviados.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= POR_IP) throw new ErrorHttp(429, 'Ya enviaste varios pedidos. Espera unos minutos o escríbenos por WhatsApp.');
  enviados.set(ip, [...recientes, ahora]);
}

function cors(req: FastifyRequest, reply: FastifyReply) {
  const origen = req.headers.origin;
  // En desarrollo también se acepta la carta servida en localhost, para probarla de punta a punta.
  const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen ?? '');
  if (origen && (ORIGENES.includes(origen) || local)) {
    reply.header('Access-Control-Allow-Origin', origen);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Max-Age', '600');
  }
}

// ---------- Equivalencias carta → producto del POS ----------
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const claveDe = (grupo: string, nombre: string) => `${normal(grupo)} | ${normal(nombre)}`;
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'o', 'y', 'con', 'en', 'a', 'al', 'su', 'sus', 'mas', 'x']);
const palabras = (s: string) => new Set(normal(s).split(' ').filter((p) => p && !VACIAS.has(p)).map((p) => p.replace(/(es|s)$/, '')));

type ProductoBase = { id: number; nombre: string; precio: number };
/** Producto más parecido a la línea (por palabras y precio). Solo como sugerencia para recepción. */
function sugerir(grupo: string, nombre: string, precio: number, productos: ProductoBase[]): number | null {
  const buscadas = palabras(`${grupo} ${nombre}`);
  let mejor: ProductoBase | null = null;
  let puntos = 0;
  for (const p of productos) {
    const de = palabras(p.nombre);
    let comunes = 0;
    for (const w of de) if (buscadas.has(w)) comunes++;
    const s = comunes / Math.max(de.size, 1) + (p.precio === precio ? 0.5 : 0);
    if (s > puntos) { puntos = s; mejor = p; }
  }
  return mejor && puntos >= 0.9 ? mejor.id : null;
}

/** Nombre de la cuenta para una mesa: "5" → "Mesa 5"; "Cabaña 2" queda igual. */
const cuentaDeMesa = (mesa: string) => (/^\d+$/.test(mesa) ? `Mesa ${mesa}` : mesa);

const conLineas = { lineas: { orderBy: { id: 'asc' } } } as const;

// ---------- Domicilio ----------
// Lo cobra el cliente: uno por restaurante del pedido (cada uno manda su domiciliario).
// Catering: tarifa de catering; los demás, tarifa de día o de noche según la hora del pedido.
const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const esCatering = (restaurante: string, grupo: string) => /catering/.test(normal(`${restaurante} ${grupo}`));

async function productosDomicilio(tx: Tx | typeof prisma) {
  const todos = await tx.producto.findMany({ where: { activo: true, seVende: true, nombre: { startsWith: 'Domicilio', mode: 'insensitive' } } });
  const buscar = (palabra: string) => todos.find((p) => normal(p.nombre).includes(palabra)) ?? null;
  return { todos, catering: buscar('catering'), dia: buscar('dia'), noche: buscar('noche') };
}

function domiciliosDe(
  pedido: { creadoEn: Date; lineas: { restaurante: string; grupo: string }[] },
  dom: Awaited<ReturnType<typeof productosDomicilio>>,
  nocheDesde: string,
) {
  // Noche: desde la hora configurada hasta las 6 de la mañana.
  const h = fmtHora.format(pedido.creadoEn);
  const deNoche = h >= nocheDesde || h < '06:00';
  const porRestaurante = new Map<string, boolean>();
  for (const l of pedido.lineas) {
    const r = l.restaurante || 'Catering del spa';
    porRestaurante.set(r, (porRestaurante.get(r) ?? false) || esCatering(l.restaurante, l.grupo));
  }
  return [...porRestaurante].flatMap(([restaurante, catering]) => {
    const p = catering ? dom.catering : deNoche ? dom.noche : dom.dia;
    return p ? [{ restaurante, productoId: p.id, nombre: p.nombre, precio: p.precio }] : [];
  });
}

async function conSugerencias(tx: Tx | typeof prisma, pedidos: Prisma.PedidoMesaGetPayload<{ include: typeof conLineas }>[]) {
  const productos = await tx.producto.findMany({ where: { activo: true, seVende: true }, select: { id: true, nombre: true, precio: true } });
  const claves = [...new Set(pedidos.flatMap((p) => p.lineas.map((l) => claveDe(l.grupo, l.nombre))))];
  const alias = new Map((await tx.aliasCarta.findMany({ where: { clave: { in: claves } } })).map((a) => [a.clave, a.productoId]));
  const vigentes = new Set(productos.map((p) => p.id));
  const dom = await productosDomicilio(tx);
  const { domicilioNocheDesde } = await leerAjustes();
  return pedidos.map((p) => ({
    ...p,
    domicilios: p.estado === 'PENDIENTE' ? domiciliosDe(p, dom, domicilioNocheDesde) : [],
    lineas: p.lineas.map((l) => {
      const aprendido = alias.get(claveDe(l.grupo, l.nombre));
      const productoId = l.productoId ?? (aprendido && vigentes.has(aprendido) ? aprendido : sugerir(l.grupo, l.nombre, l.precioCarta, productos));
      return { ...l, productoId, origen: l.productoId ? 'fijado' : aprendido && vigentes.has(aprendido) ? 'aprendido' : productoId ? 'sugerido' : null };
    }),
  }));
}

export async function rutasPedidosMesa(app: FastifyInstance) {
  // ---------- Público: lo llama la carta ----------
  app.options('/api/publico/pedidos', async (req, reply) => {
    cors(req, reply);
    return reply.code(204).send();
  });

  app.post('/api/publico/pedidos', async (req, reply) => {
    cors(req, reply);
    const b = objeto(req.body);
    const mesa = texto(typeof b.mesa === 'string' ? b.mesa.trim() : b.mesa, 'Mesa', 1, 40);
    const nota = typeof b.nota === 'string' && b.nota.trim() ? texto(b.nota.trim(), 'Nota', 1, 200) : null;
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 40) throw new ErrorHttp(400, 'El pedido debe tener entre 1 y 40 productos');
    const lineas = b.items.map((crudo) => {
      const it = objeto(crudo);
      return {
        restaurante: typeof it.restaurante === 'string' ? it.restaurante.trim().slice(0, 60) : '',
        grupo: texto(it.grupo, 'Grupo', 1, 80),
        nombre: texto(it.nombre, 'Producto', 1, 120),
        cantidad: entero(it.cantidad, 'Cantidad', 1, 50),
        precioCarta: entero(it.precio, 'Precio', 0, 10_000_000),
      };
    });
    limitar(req.ip);
    if ((await prisma.pedidoMesa.count({ where: { estado: 'PENDIENTE' } })) >= PENDIENTES_MAXIMO) {
      throw new ErrorHttp(429, 'Recepción tiene muchos pedidos por atender. Escríbenos por WhatsApp.');
    }
    const p = await prisma.pedidoMesa.create({ data: { mesa, nota, lineas: { create: lineas } } });
    return reply.code(201).send({ id: p.id });
  });

  // ---------- Recepción ----------
  // Pendientes y lo atendido en las últimas horas.
  app.get('/api/pedidos-mesa', async () => {
    const pedidos = await prisma.pedidoMesa.findMany({
      where: { OR: [{ estado: 'PENDIENTE' }, { atendidoEn: { gt: new Date(Date.now() - 3 * 60 * 60 * 1000) } }] },
      orderBy: { id: 'asc' },
      include: conLineas,
    });
    return conSugerencias(prisma, pedidos);
  });

  // Aceptar: cada línea con su producto del POS. Se recuerdan las equivalencias para la próxima.
  app.post('/api/pedidos-mesa/:id/aceptar', async (req) => {
    const id = idDeUrl(req.params);
    const b = objeto(req.body);
    if (!Array.isArray(b.lineas)) throw new ErrorHttp(400, 'Faltan los productos del pedido');
    const elegidos = new Map<number, number>();
    for (const crudo of b.lineas) {
      const l = objeto(crudo);
      elegidos.set(entero(l.id, 'Línea', 1, 999_999_999), entero(l.productoId, 'Producto', 1, 999_999_999));
    }
    // Domicilios que recepción dejó marcados (cada uno es un producto "Domicilio …").
    const domicilios = Array.isArray(b.domicilios) ? b.domicilios.map((d) => entero(d, 'Domicilio', 1, 999_999_999)) : [];
    if (domicilios.length > 10) throw new ErrorHttp(400, 'Demasiados domicilios');
    const usuarioId = req.usuario!.id;
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PedidoMesa" WHERE id = ${id} FOR UPDATE`;
      const pedido = await tx.pedidoMesa.findUnique({ where: { id }, include: conLineas });
      if (!pedido) throw new ErrorHttp(404, 'Pedido no encontrado');
      if (pedido.estado !== 'PENDIENTE') throw new ErrorHttp(409, 'Este pedido ya se atendió');
      const cantidades = new Map<number, number>();
      for (const l of pedido.lineas) {
        const productoId = elegidos.get(l.id);
        if (!productoId) throw new ErrorHttp(400, `Elige el producto para "${l.nombre}"`);
        cantidades.set(productoId, (cantidades.get(productoId) ?? 0) + l.cantidad);
        await tx.pedidoMesaLinea.update({ where: { id: l.id }, data: { productoId } });
        const clave = claveDe(l.grupo, l.nombre);
        await tx.aliasCarta.upsert({ where: { clave }, create: { clave, productoId }, update: { productoId } });
      }
      if (domicilios.length) {
        const validos = new Set((await productosDomicilio(tx)).todos.map((p) => p.id));
        for (const d of domicilios) {
          if (!validos.has(d)) throw new ErrorHttp(400, 'Ese producto no es un domicilio');
          cantidades.set(d, (cantidades.get(d) ?? 0) + 1);
        }
      }
      const cuenta = await cuentaAbiertaONueva(tx, cuentaDeMesa(pedido.mesa), usuarioId);
      await cargar(tx, cuenta, usuarioId, cantidades); // valida disponibilidad y manda comandas
      await tx.pedidoMesa.update({ where: { id }, data: { estado: 'ACEPTADO', atendidoEn: new Date(), atendidoPorId: usuarioId, cuentaId: cuenta.id } });
      return { ok: true, cuentaId: cuenta.id, cuenta: cuenta.nombre };
    });
  });

  app.post('/api/pedidos-mesa/:id/rechazar', async (req) => {
    const id = idDeUrl(req.params);
    const r = await prisma.pedidoMesa.updateMany({
      where: { id, estado: 'PENDIENTE' },
      data: { estado: 'RECHAZADO', atendidoEn: new Date(), atendidoPorId: req.usuario!.id },
    });
    if (r.count === 0) throw new ErrorHttp(409, 'Este pedido ya se atendió o no existe');
    return { ok: true };
  });
}
