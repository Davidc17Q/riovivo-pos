// Utilidades compartidas por las pantallas de ventas y administración.
const ZONA = 'America/Bogota';
const fmtCop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const cop = (n) => fmtCop.format(n);
const METODOS = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' };
const $ = (sel, raiz = document) => raiz.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
  $('#yo').textContent = yo.nombre;
  $('#salir').onclick = async () => {
    await api('POST', '/api/logout');
    location.href = '/login';
  };
  return yo;
}
