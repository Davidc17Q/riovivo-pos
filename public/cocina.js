// Tablero de comandas: se actualiza solo cada pocos segundos. Cocina avanza cada pedido
// con un toque: pendiente → en preparación → lista → entregada.
const CADA_MS = 4000;
const ESTACION_NOMBRE = { COCINA: 'Cocina', BAR: 'Bar' };
const SIGUIENTE = { PENDIENTE: ['PREPARANDO', 'Empezar'], PREPARANDO: ['LISTA', 'Listo'], LISTA: ['ENTREGADA', 'Entregado'] };
const ANTERIOR = { PREPARANDO: 'PENDIENTE', LISTA: 'PREPARANDO' };

// Preferencias de esta pantalla (cada tablet recuerda la suya).
const guardado = (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: no pasa nada */ } };
let estacion = guardado('comandas.estacion', 'COCINA');
let sonido = guardado('comandas.sonido', 'no') === 'si';

let comandas = [];
let vistas = null; // ids ya mostrados: lo que no esté aquí es nuevo
let ocupado = false;

// ---------- Sonido ----------
let audio = null;
function pitido() {
  if (!sonido) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    // Dos tonos cortos y suaves: se oyen en una cocina sin asustar.
    [[880, 0], [1175, 0.18]].forEach(([f, t]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.18);
    });
  } catch { /* navegador sin audio */ }
}
function pintarSonido() {
  $('#sonido').setAttribute('aria-pressed', sonido);
  $('#texto-sonido').textContent = sonido ? 'Sonido activado' : 'Activar sonido';
}
$('#sonido').onclick = () => {
  sonido = !sonido;
  guardar('comandas.sonido', sonido ? 'si' : 'no');
  pintarSonido();
  pitido(); // prueba, y además desbloquea el audio del navegador
};

// ---------- Tablero ----------
function minutos(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function tarjeta(c, nueva) {
  const cancelada = c.estado === 'CANCELADA';
  const min = minutos(c.creadaEn);
  // El tiempo se cuenta desde que se pidió; se marca si una comanda activa lleva mucho esperando.
  const espera = cancelada || c.estado === 'LISTA' ? '' : min >= 20 ? 'tarde' : min >= 10 ? 'demora' : '';
  const titulo = c.referencia || (c.ventaId ? `Venta N.º ${c.ventaId}` : 'Sin referencia');
  const sig = SIGUIENTE[c.estado];
  const ant = ANTERIOR[c.estado];
  return `<article class="comanda ${espera} ${cancelada ? 'cancelada' : ''} ${nueva ? 'nueva' : ''}" data-id="${c.id}">
    <header>
      <b>${esc(titulo)}</b>
      <span class="tiempo" title="Pedida a las ${hora(c.creadaEn)}">${min < 1 ? 'Ahora' : `${min} min`}</span>
    </header>
    ${cancelada ? '<p class="aviso-cancelada">Cancelada: no preparar</p>' : ''}
    ${estacion === 'TODAS' ? `<span class="etiqueta">${ESTACION_NOMBRE[c.estacion]}</span>` : ''}
    <ul>${c.items.map((i) => `<li><b>${i.cantidad}</b> ${esc(i.nombre)}</li>`).join('')}</ul>
    <footer>
      <span class="tenue chico">${esc(c.usuario.nombre)} · ${hora(c.creadaEn)}</span>
      ${cancelada ? '' : `<span class="acciones">
        ${ant ? `<button type="button" class="btn mini" data-estado="${ant}" title="Devolver al estado anterior" aria-label="Devolver ${esc(titulo)} al estado anterior">↩</button>` : ''}
        <button type="button" class="btn primario" data-estado="${sig[0]}">${sig[1]}</button>
      </span>`}
    </footer>
  </article>`;
}

function pintar() {
  const nuevas = vistas ? comandas.filter((c) => !vistas.has(c.id) && c.estado !== 'CANCELADA') : [];
  for (const estado of ['PENDIENTE', 'PREPARANDO', 'LISTA']) {
    // Las canceladas se muestran arriba de su columna original (pendientes por defecto).
    const lista = comandas.filter((c) => (c.estado === 'CANCELADA' ? estado === 'PENDIENTE' : c.estado === estado));
    lista.sort((a, b) => (a.estado === 'CANCELADA') - (b.estado === 'CANCELADA') || a.id - b.id);
    const activas = lista.filter((c) => c.estado !== 'CANCELADA').length;
    $(`#n-${estado}`).textContent = activas;
    $(`#n-${estado}`).hidden = activas === 0;
    $(`#col-${estado}`).innerHTML = lista.length
      ? lista.map((c) => tarjeta(c, nuevas.includes(c))).join('')
      : `<p class="vacio">${{ PENDIENTE: 'Sin pedidos por ahora.', PREPARANDO: 'Nada en preparación.', LISTA: 'Nada esperando a ser entregado.' }[estado]}</p>`;
  }
  if (nuevas.length) pitido();
  vistas = new Set(comandas.map((c) => c.id));
}

async function cargar() {
  if (ocupado) return;
  ocupado = true;
  try {
    comandas = await api('GET', `/api/comandas?estacion=${estacion}`);
    $('#sin-conexion').hidden = true;
    pintar();
  } catch {
    $('#sin-conexion').hidden = false;
  }
  ocupado = false;
}

function pintarEstaciones() {
  for (const b of document.querySelectorAll('[data-estacion]')) b.setAttribute('aria-pressed', b.dataset.estacion === estacion);
}
$('#estaciones').onclick = (e) => {
  const b = e.target.closest('[data-estacion]');
  if (!b) return;
  estacion = b.dataset.estacion;
  guardar('comandas.estacion', estacion);
  vistas = null; // al cambiar de estación no se anuncia lo que ya estaba
  pintarEstaciones();
  cargar();
};

$('.tablero').onclick = async (e) => {
  const b = e.target.closest('[data-estado]');
  const art = b?.closest('[data-id]');
  if (!b || !art) return;
  b.disabled = true;
  try {
    await api('POST', `/api/comandas/${art.dataset.id}/estado`, { estado: b.dataset.estado });
  } catch (err) {
    aviso(err.message, true);
  }
  await cargar();
};

(async () => {
  const yo = await iniciarSesionUi();
  $('#ir-ventas').hidden = yo.rol === 'COCINA';
  pintarEstaciones();
  pintarSonido();
  await cargar();
  setInterval(cargar, CADA_MS);
})();
