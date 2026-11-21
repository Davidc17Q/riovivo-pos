// Generador de códigos QR propio (sin librerías): modo byte (UTF-8), corrección de errores M
// (~15 % del código puede dañarse y aún se lee), versiones 1 a 10 (hasta 213 bytes, de sobra
// para un enlace). Sigue la norma ISO/IEC 18004; la estructura se basa en la implementación
// de referencia de Nayuki. Uso: QR.svg('https://…') → <svg> listo para insertar o imprimir.
(function (raiz) {
  // Por versión (1..10) en nivel M: [codewords totales, ec por bloque, bloques grupo 1, datos por bloque grupo 1, bloques grupo 2]
  // (los bloques del grupo 2 llevan un dato más que los del grupo 1).
  const TABLA_M = [
    null,
    [26, 10, 1, 16, 0], [44, 16, 1, 28, 0], [70, 26, 1, 44, 0], [100, 18, 2, 32, 0], [134, 24, 2, 43, 0],
    [172, 16, 4, 27, 0], [196, 18, 4, 31, 0], [242, 22, 2, 38, 2], [292, 22, 3, 36, 2], [346, 26, 4, 43, 1],
  ];
  const ALINEACION = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const FORMATO_M = 0; // bits del nivel M en la información de formato

  // Aritmética en GF(256) con el polinomio 0x11D.
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisorRS(grado) {
    const r = new Array(grado).fill(0);
    r[grado - 1] = 1;
    let raizG = 1;
    for (let i = 0; i < grado; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = mul(r[j], raizG);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      raizG = mul(raizG, 0x02);
    }
    return r;
  }
  function restoRS(datos, divisor) {
    const r = divisor.map(() => 0);
    for (const b of datos) {
      const factor = b ^ r.shift();
      r.push(0);
      divisor.forEach((c, i) => { r[i] ^= mul(c, factor); });
    }
    return r;
  }

  function bytesUtf8(texto) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(texto));
    return Array.from(Buffer.from(texto, 'utf8'));
  }

  /** Codewords finales (datos + corrección, intercalados) para la versión dada. */
  function codewords(bytes, version) {
    const [total, ec, g1, d1, g2] = TABLA_M[version];
    const capacidad = g1 * d1 + g2 * (d1 + 1);
    const bits = [];
    const poner = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
    poner(0b0100, 4); // modo byte
    poner(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) poner(b, 8);
    poner(0, Math.min(4, capacidad * 8 - bits.length)); // terminador
    while (bits.length % 8) bits.push(0);
    const datos = [];
    for (let i = 0; i < bits.length; i += 8) datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; datos.length < capacidad; pad ^= 0xec ^ 0x11) datos.push(pad);

    const divisor = divisorRS(ec);
    const bloques = [];
    let k = 0;
    for (let i = 0; i < g1 + g2; i++) {
      const largo = i < g1 ? d1 : d1 + 1;
      const d = datos.slice(k, k + largo);
      k += largo;
      bloques.push({ d, e: restoRS(d, divisor) });
    }
    const salida = [];
    for (let i = 0; i <= d1; i++) for (const b of bloques) if (i < b.d.length) salida.push(b.d[i]);
    for (let i = 0; i < ec; i++) for (const b of bloques) salida.push(b.e[i]);
    if (salida.length !== total) throw new Error('QR: tamaño inesperado');
    return salida;
  }

  function matriz(version, datos, mascara) {
    const n = version * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fija = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, oscuro) => { m[y][x] = oscuro; fija[y][x] = true; };

    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const buscador = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    buscador(3, 3); buscador(n - 4, 3); buscador(3, n - 4);
    const pos = ALINEACION[version];
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      const ultimo = pos.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    // Formato (nivel + máscara) con su BCH.
    const f = (FORMATO_M << 3) | mascara;
    let r = f;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const fb = ((f << 10) | r) ^ 0x5412;
    const bit = (v, i) => ((v >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(fb, i));
    set(8, 7, bit(fb, 6)); set(8, 8, bit(fb, 7)); set(7, 8, bit(fb, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fb, i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(fb, i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(fb, i));
    set(8, n - 8, true);
    // Versión (desde la 7).
    if (version >= 7) {
      let rv = version;
      for (let i = 0; i < 12; i++) rv = (rv << 1) ^ ((rv >>> 11) * 0x1f25);
      const vb = (version << 12) | rv;
      for (let i = 0; i < 18; i++) {
        const a = n - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit(vb, i)); set(b, a, bit(vb, i));
      }
    }
    // Datos en zigzag, de dos columnas, de abajo hacia arriba y viceversa.
    let i = 0;
    for (let der = n - 1; der >= 1; der -= 2) {
      if (der === 6) der = 5;
      for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
        const x = der - j;
        const y = ((der + 1) & 2) === 0 ? n - 1 - v : v;
        if (!fija[y][x] && i < datos.length * 8) {
          m[y][x] = bit(datos[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
    // Máscara.
    const cond = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ][mascara];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fija[y][x] && cond(x, y)) m[y][x] = !m[y][x];
    return m;
  }

  /** Penalización de la norma: se elige la máscara que deja el código más fácil de leer. */
  function penalizacion(m) {
    const n = m.length;
    let p = 0;
    const lineas = [];
    for (let y = 0; y < n; y++) lineas.push(m[y]);
    for (let x = 0; x < n; x++) lineas.push(m.map((fila) => fila[x]));
    for (const l of lineas) {
      let corrida = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && l[i] === l[i - 1]) corrida++;
        else { if (corrida >= 5) p += corrida - 2; corrida = 1; }
      }
      // Patrones parecidos a un buscador (1:1:3:1:1 con 4 claros a un lado).
      const s = l.map((v) => (v ? '1' : '0')).join('');
      for (const patron of ['10111010000', '00001011101']) {
        for (let k = s.indexOf(patron); k !== -1; k = s.indexOf(patron, k + 1)) p += 40;
      }
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    const oscuros = m.reduce((s, f) => s + f.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) * 10;
    return p;
  }

  /** Matriz de módulos (true = oscuro) del texto. */
  function modulos(texto) {
    const bytes = bytesUtf8(texto);
    let version = 1;
    for (; version <= 10; version++) {
      const [, , g1, d1, g2] = TABLA_M[version];
      if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= (g1 * d1 + g2 * (d1 + 1)) * 8) break;
    }
    if (version > 10) throw new Error('El enlace es demasiado largo para el código QR');
    const datos = codewords(bytes, version);
    let mejor = null, puntos = Infinity;
    for (let k = 0; k < 8; k++) {
      const m = matriz(version, datos, k);
      const p = penalizacion(m);
      if (p < puntos) { mejor = m; puntos = p; }
    }
    return mejor;
  }

  /** SVG con margen de 4 módulos (el que pide la norma para leerse bien). */
  function svg(texto, { titulo = 'Código QR' } = {}) {
    const m = modulos(texto);
    const n = m.length, borde = 4, lado = n + borde * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + borde} ${y + borde}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="${titulo}"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { svg, modulos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.QR = api;
})(this);
