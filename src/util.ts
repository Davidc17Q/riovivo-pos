// Validación de entradas y fechas de negocio (America/Bogota).

export class ErrorHttp extends Error {
  constructor(public codigo: number, mensaje: string) {
    super(mensaje);
  }
}

export function objeto(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ErrorHttp(400, 'Datos inválidos');
  return v as Record<string, unknown>;
}

export function entero(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ErrorHttp(400, `${campo}: debe ser un número entero entre ${min} y ${max}`);
  }
  return v;
}

export function texto(v: unknown, campo: string, min: number, max: number): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min || t.length > max) {
    throw new ErrorHttp(400, `${campo}: debe tener entre ${min} y ${max} caracteres`);
  }
  return t;
}

export function booleano(v: unknown, campo: string): boolean {
  if (typeof v !== 'boolean') throw new ErrorHttp(400, `${campo}: debe ser verdadero o falso`);
  return v;
}

export function opcion<T extends string>(v: unknown, campo: string, opciones: readonly T[]): T {
  if (typeof v !== 'string' || !opciones.includes(v as T)) {
    throw new ErrorHttp(400, `${campo}: debe ser uno de ${opciones.join(', ')}`);
  }
  return v as T;
}

/** Id numérico tomado de la URL (/algo/:id). */
export function idDeUrl(params: unknown): number {
  const crudo = (params as { id?: string }).id ?? '';
  if (!/^\d{1,9}$/.test(crudo) || Number(crudo) < 1) throw new ErrorHttp(400, 'Id inválido');
  return Number(crudo);
}

export const ZONA = 'America/Bogota';
// Colombia no tiene horario de verano: el desfase es fijo.
const DESFASE = '-05:00';

/** Fecha de hoy en Colombia, como YYYY-MM-DD. */
export function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}

export function fecha(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00${DESFASE}`))) {
    throw new ErrorHttp(400, `${campo}: fecha inválida (use AAAA-MM-DD)`);
  }
  return v;
}

/** Instante en que empieza un día en Colombia. */
export function inicioDelDia(dia: string): Date {
  return new Date(`${dia}T00:00:00${DESFASE}`);
}

export const UN_DIA_MS = 24 * 60 * 60 * 1000;
