// Utilidades compartidas por las pantallas de ventas y administración.
const ZONA = 'America/Bogota';
const fmtCop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const cop = (n) => fmtCop.format(n);
const METODOS = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', MIXTO: 'Mixto' };
const $ = (sel, raiz = document) => raiz.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Sonidos cortos generados en el navegador (sin archivos de audio).
let audioCtx = null;
/** Toca notas [frecuencia Hz, inicio s, duración s]. Necesita que la persona ya haya tocado la página. */
function tocar(notas, volumen = 0.3) {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (const [f, t, d] of notas) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + t);
      g.gain.exponentialRampToValueAtTime(volumen, t0 + t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + d);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + t);
      o.stop(t0 + t + d + 0.02);
    }
  } catch { /* navegador sin audio: la venta sigue igual */ }
}

// Voz en español latino (la del sistema o del navegador). Se elige la más natural disponible.
let vozLatina = null;
function elegirVoz() {
  if (!('speechSynthesis' in window)) return;
  const voces = speechSynthesis.getVoices().filter((v) => /^es/i.test(v.lang));
  const rango = (v) => {
    const lang = v.lang.replace('_', '-').toLowerCase();
    const region = ['es-co', 'es-mx', 'es-us', 'es-419'].indexOf(lang);
    // Se prefieren voces latinas, femeninas y "naturales" (más suaves que las robóticas).
    const suave = /sabina|paulina|dalia|salome|salomé|elena|camila|google|natural|online/i.test(v.name) ? 0.6 : 0;
    return (region === -1 ? (lang === 'es-es' ? 9 : 5) : region) - suave;
  };
  vozLatina = voces.sort((a, b) => rango(a) - rango(b))[0] ?? null;
}
if ('speechSynthesis' in window) {
  elegirVoz();
  speechSynthesis.addEventListener?.('voiceschanged', elegirVoz);
}
/** Dice el texto con voz suave (un poco más lenta que lo normal). */
function decir(texto) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(texto);
    if (vozLatina) { u.voice = vozLatina; u.lang = vozLatina.lang; } else u.lang = 'es-MX';
    u.rate = 0.92;
    u.pitch = 1.05;
    u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* sin voz: queda el timbre */ }
}

// Avisos con voz grabada (ElevenLabs, generada con `npm run voces`). Si no hay audio para
// ese aviso, se usa la voz del sistema con el mismo texto.
let vocesGrabadas = new Set();
fetch('/static/voz/manifiesto.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { vocesGrabadas = new Set(m?.claves ?? []); })
  .catch(() => {});
/** "Mesa 3" → "mesa-3" (igual que en scripts/generar-voces.mjs). */
const claveVoz = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Reproduce el primer audio grabado de la lista; si no hay ninguno, lo dice la voz del sistema. */
function anunciar(claves, texto) {
  const clave = claves.find((c) => vocesGrabadas.has(c));
  if (!clave) return decir(texto);
  try {
    const audio = new Audio(`/static/voz/${clave}.mp3`);
    audio.volume = 0.95;
    audio.play().catch(() => decir(texto));
  } catch {
    decir(texto);
  }
}

function hoyIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
}
function fechaHora(iso) {
  return new Date(iso).toLocaleString('es-CO', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short' });
}
/** "2026-11-16" → "lun, 16 nov 2026" */
function diaLargo(dia) {
  return new Date(`${dia}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

async function api(metodo, url, cuerpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401 && url !== '/api/login') {
    location.href = '/login';
    throw new Error('Sesión vencida');
  }
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new Error(datos?.error || 'No se pudo completar la acción');
  return datos;
}

let relojAviso;
function aviso(texto, mal = false) {
  let el = $('#aviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aviso';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = texto;
  el.className = mal ? 'mal' : '';
  el.hidden = false;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => (el.hidden = true), mal ? 6000 : 3000);
}

/** Confirmación con diálogo propio (legible en tablet). Resuelve true si se acepta. */
function confirmar(texto, etiqueta = 'Confirmar') {
  return new Promise((resolver) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<p style="margin:0">${esc(texto)}</p>
      <div class="botones"><button class="btn" value="no" autofocus>Cancelar</button><button class="btn rojo" value="si">${esc(etiqueta)}</button></div>`;
    document.body.append(d);
    d.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) d.close(b.value);
    };
    d.onclose = () => {
      d.remove();
      resolver(d.returnValue === 'si');
    };
    d.showModal();
  });
}

function textoDiferencia(dif) {
  return dif === 0 ? 'Cuadra exacto' : dif > 0 ? `Sobrante ${cop(dif)}` : `Faltante ${cop(-dif)}`;
}

/** Cuadre de una caja. Abierta: totales en vivo. Cerrada: lo que se guardó al cerrar. */
function htmlCuadre(c) {
  const q = c.cuadre;
  const cerrada = c.estado === 'CERRADA';
  // Cierre ciego (vendedor): solo lo que declaró; el cuadre completo lo ve el administrador.
  if (q.ciego) return `
    <h3>Caja N.º ${c.id}</h3>
    <p class="centro tenue chico">${esc(c.usuario.nombre)}<br>Abierta: ${esc(fechaHora(c.abiertaEn))}<br>
      ${cerrada ? `Cerrada: ${esc(fechaHora(c.cerradaEn))} por ${esc(c.cerradaPor?.nombre)}` : 'Aún abierta'}</p>
    <div class="totales">
      <div><span>Base inicial</span><span>${cop(q.base)}</span></div>
      <div><span>Ventas registradas</span><span>${q.ventas}</span></div>
      ${cerrada ? `<div class="total"><span>Efectivo declarado</span><span>${cop(q.efectivoContado)}</span></div>` : ''}
    </div>
    <p class="tenue chico">${cerrada ? 'Cierre ciego entregado. El administrador revisa el cuadre.' : 'Cierre ciego: al cerrar solo declaras lo que contaste.'}</p>
    ${c.nota ? `<p class="tenue chico">Nota: ${esc(c.nota)}</p>` : ''}`;
  return `
    <h3>Cuadre de caja N.º ${c.id}</h3>
    <p class="centro tenue chico">${esc(c.usuario.nombre)}<br>Abierta: ${esc(fechaHora(c.abiertaEn))}<br>
      ${cerrada ? `Cerrada: ${esc(fechaHora(c.cerradaEn))} por ${esc(c.cerradaPor?.nombre)}` : 'Aún abierta'}</p>
    <div class="totales">
      <div><span>Base inicial</span><span>${cop(q.base)}</span></div>
      <div><span>+ Ventas en efectivo</span><span>${cop(q.efectivo)}</span></div>
      <div><b>Efectivo esperado</b><b>${cop(q.efectivoEsperado)}</b></div>
      ${cerrada ? `<div><span>Efectivo contado</span><span>${cop(q.efectivoContado)}</span></div>
      <div class="total ${q.diferencia < 0 ? 'falta' : ''}"><span>Diferencia</span><span>${textoDiferencia(q.diferencia)}</span></div>` : ''}
    </div>
    <div class="totales">
      <div><span>Ventas con tarjeta</span><span>${cop(q.tarjeta)}</span></div>
      <div><span>Ventas por transferencia</span><span>${cop(q.transferencia)}</span></div>
      <div><b>Total vendido · ${q.ventas} ${q.ventas === 1 ? 'venta' : 'ventas'}</b><b>${cop(q.totalVentas)}</b></div>
      ${q.anuladas ? `<div class="tenue chico"><span>Anuladas (no cuentan): ${q.anuladas}</span><span>${cop(q.totalAnulado)}</span></div>` : ''}
    </div>
    ${q.anuladasTrasCierre.ventas ? `<p class="error">Después del cierre se anularon ${q.anuladasTrasCierre.ventas} venta(s) por ${cop(q.anuladasTrasCierre.total)}. El cuadre guardado no cambia.</p>` : ''}
    ${c.nota ? `<p class="tenue chico">Nota: ${esc(c.nota)}</p>` : ''}`;
}

/** Pie del ticket con el QR de reseñas (vacío si no hay enlace configurado). */
function htmlResena(ajustes) {
  if (!ajustes?.resenaUrl) return '';
  try {
    return `<div class="qr-resena">${QR.svg(ajustes.resenaUrl, { titulo: 'QR para calificar la experiencia' })}<p>${esc(ajustes.resenaTexto)}</p></div>`;
  } catch {
    return '';
  }
}

/** Filas de la tabla de cajas (ventas y administración). */
function filasCajas(cajas, conCerrar = false) {
  if (!cajas.length) return '<tr><td colspan="7" class="vacio">Aún no hay cajas.</td></tr>';
  return cajas.map((c) => {
    const q = c.cuadre;
    const cerrada = c.estado === 'CERRADA';
    return `<tr class="clic" data-caja="${c.id}" tabindex="0">
      <td>${c.id}</td><td>${esc(c.usuario.nombre)}</td>
      <td class="chico">${esc(fechaHora(c.abiertaEn))}</td>
      <td class="chico">${cerrada ? esc(fechaHora(c.cerradaEn)) : '<span class="etiqueta">Abierta</span>'}</td>
      <td class="num">${q.ciego ? '—' : cop(q.efectivoEsperado)}</td>
      <td class="num">${cerrada ? cop(q.efectivoContado) : '—'}</td>
      <td class="num">${cerrada && q.ciego ? '<span class="etiqueta gris">Entregada</span>' : cerrada
        ? `<span class="etiqueta ${q.diferencia < 0 ? 'rojo' : q.diferencia > 0 ? 'gris' : ''}">${textoDiferencia(q.diferencia)}</span>`
        : conCerrar ? `<button class="btn mini" data-cerrar-caja="${c.id}">Cerrar</button>` : '—'}</td></tr>`;
  }).join('');
}

/** Suma días a una fecha "AAAA-MM-DD". */
function sumarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pestañas: botones [data-vista] muestran la sección #vista-<nombre>. */
function iniciarPestanas(alAbrir) {
  const botones = [...document.querySelectorAll('.pestanas button')];
  function abrir(nombre) {
    for (const b of botones) {
      const activa = b.dataset.vista === nombre;
      b.setAttribute('aria-selected', activa);
      $(`#vista-${b.dataset.vista}`).hidden = !activa;
    }
    alAbrir(nombre);
  }
  for (const b of botones) b.onclick = () => abrir(b.dataset.vista);
  abrir(botones[0].dataset.vista);
}

/** Encabezado: nombre del usuario y botón de salir. Devuelve el usuario en sesión. */
async function iniciarSesionUi() {
  const yo = await api('GET', '/api/me');
  // Quién está conectado: iniciales, nombre y rol (el nombre puede coincidir con un área, p. ej. "Administración").
  const iniciales = yo.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  $('#yo').textContent = yo.nombre;
  $('#yo-rol').textContent = { ADMIN: 'Administrador', VENDEDOR: 'Vendedor', COCINA: 'Cocina y bar' }[yo.rol] ?? '';
  $('#yo-iniciales').textContent = iniciales || '?';
  $('.usuario').title = `${yo.nombre} · ${$('#yo-rol').textContent}`;
  $('#salir').onclick = async () => {
    await api('POST', '/api/logout');
    location.href = '/login';
  };
  return yo;
}
