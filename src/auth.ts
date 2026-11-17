// Sesión por cookie firmada httpOnly. El rol se lee de la base en cada petición,
// así un usuario desactivado pierde el acceso de inmediato.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import type { Rol } from '@prisma/client';
import { prisma } from './db';
import { ErrorHttp, objeto } from './util';

const COOKIE = 'pos_sesion';
const DURACION_S = 12 * 60 * 60; // un turno largo
const HASH_SEÑUELO = bcrypt.hashSync('sin-usuario', 10);

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: UsuarioSesion | null;
  }
}

export async function usuarioDeSesion(req: FastifyRequest): Promise<UsuarioSesion | null> {
  const cruda = req.cookies[COOKIE];
  if (!cruda) return null;
  const { valid, value } = req.unsignCookie(cruda);
  if (!valid || !value) return null;
  const [id, expira] = value.split('.').map(Number);
  if (!id || !expira || Date.now() > expira) return null;
  const u = await prisma.usuario.findUnique({ where: { id } });
  if (!u || !u.activo) return null;
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

export async function soloAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.usuario?.rol !== 'ADMIN') return reply.code(403).send({ error: 'Solo para administradores' });
}

export async function rutasAuth(app: FastifyInstance) {
  app.post('/api/login', async (req, reply) => {
    const b = objeto(req.body);
    const usuario = typeof b.usuario === 'string' ? b.usuario.trim().toLowerCase() : '';
    const clave = typeof b.clave === 'string' ? b.clave : '';
    const u = usuario ? await prisma.usuario.findUnique({ where: { usuario } }) : null;
    // Siempre se compara contra un hash para no revelar por tiempo si el usuario existe.
    const hash = u?.claveHash ?? HASH_SEÑUELO;
    const coincide = await bcrypt.compare(clave, hash);
    if (!u || !u.activo || !coincide) throw new ErrorHttp(401, 'Usuario o contraseña incorrectos');

    reply.setCookie(COOKIE, `${u.id}.${Date.now() + DURACION_S * 1000}`, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DURACION_S,
    });
    return { usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => req.usuario);
}
