try {
  process.loadEnvFile(); // carga .env si existe (en producción las variables vienen del entorno)
} catch {}

import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { rutasAuth, usuarioDeSesion } from './auth';
import { rutasVentas } from './routes/ventas';
import { rutasAdmin } from './routes/admin';
import { rutasCaja } from './routes/caja';
import { ErrorHttp } from './util';

const RAIZ = path.join(__dirname, '..');
const VISTAS = path.join(RAIZ, 'views');

const secreto = process.env.SESSION_SECRET;
if (!secreto && process.env.NODE_ENV === 'production') {
  throw new Error('Falta SESSION_SECRET');
}

const app = Fastify({ logger: { level: 'warn' } });

app.register(cookie, { secret: secreto ?? 'solo-para-desarrollo-local' });
app.register(fastifyStatic, { root: path.join(RAIZ, 'public'), prefix: '/static/' });

app.decorateRequest('usuario', null);

// Toda la API exige sesión, salvo el login.
app.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/login')) return;
  const u = await usuarioDeSesion(req);
  if (!u) return reply.code(401).send({ error: 'Sesión no iniciada' });
  req.usuario = u;
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof ErrorHttp) return reply.code(err.codigo).send({ error: err.message });
  if (err.statusCode && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ error: 'Solicitud inválida' });
  }
  app.log.error(err);
  return reply.code(500).send({ error: 'Error interno. Intenta de nuevo.' });
});

app.register(rutasAuth);
app.register(rutasVentas);
app.register(rutasCaja);
app.register(rutasAdmin);

// Páginas: el servidor decide qué área puede abrir cada rol.
function pagina(archivo: string, soloAdmin = false) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const u = await usuarioDeSesion(req);
    if (!u) return reply.redirect('/login');
    if (soloAdmin && u.rol !== 'ADMIN') return reply.redirect('/ventas');
    return reply.header('Cache-Control', 'no-store').sendFile(archivo, VISTAS);
  };
}

app.get('/', async (req, reply) => reply.redirect((await usuarioDeSesion(req)) ? '/ventas' : '/login'));
app.get('/login', async (req, reply) =>
  (await usuarioDeSesion(req)) ? reply.redirect('/ventas') : reply.sendFile('login.html', VISTAS),
);
app.get('/ventas', pagina('ventas.html'));
app.get('/admin', pagina('admin.html', true));

app.listen({ port: Number(process.env.PORT) || 3100, host: '0.0.0.0' }).then(
  (url) => console.log(`POS Río Vivo en ${url}`),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
