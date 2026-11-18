// CSV pensado para abrirse con doble clic en Excel en español (Colombia):
// separador ";" (la coma es el separador decimal), BOM UTF-8 para las tildes y fin de línea CRLF.
type Celda = string | number | null | undefined;

function celda(v: Celda): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  // Evita que Excel interprete como fórmula un texto escrito por un usuario (=, +, -, @).
  let s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csv(filas: Celda[][]): string {
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}
