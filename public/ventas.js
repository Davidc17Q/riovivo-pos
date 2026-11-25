// Área de ventas: armar la venta, registrarla, ver el ticket y las ventas del día.
let productos = [];
const carrito = new Map(); // productoId → cantidad
let categoria = 'Todas';
let metodo = 'EFECTIVO';
let dividir = false; // pago repartido entre varios métodos
let cuentaActiva = null; // cuenta abierta que se está atendiendo (null = venta rápida)
let cuentas = [];
let ajustes = null; // enlace de reseñas para el QR del ticket
let yo = null;
let caja = null; // caja abierta de este usuario (null = no puede vender)
let ventaEnTicket = null;

const porId = (id) => productos.find((p) => p.id === id);

// Orden de las categorías en caja: primero el spa, luego la comida. Las demás, al final.
const PRIORIDAD = ['Experiencias', 'Para dos', 'Catering', 'Restaurante', 'Asados y picadas', 'Heladería', 'Bebidas'];
const rango = (c) => (PRIORIDAD.indexOf(c) + 1 || PRIORIDAD.length + 1);
const categorias = () => [...new Set(productos.map((p) => p.categoria))].sort((a, b) => rango(a) - rango(b) || a.localeCompare(b));

// Color e ícono por categoría: ayudan a encontrar el producto con la vista.
const TONOS = ['--c1', '--c4', '--c6', '--c5', '--c7', '--c3', '--c2'];
const ICONOS = {
  loto: '<path d="M12 20c-4-3-6-8-5-14 3 2 5 6 5 14Z"/><path d="M12 20c4-3 6-8 5-14-3 2-5 6-5 14Z"/><path d="M12 20c-4 0-8-2-10-6 4-1 7 1 10 6Z"/><path d="M12 20c4 0 8-2 10-6-4-1-7 1-10 6Z"/>',
  corazon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  plato: '<path d="M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 2-3 4-3 8h3v10"/>',
  fuego: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-2 4-2 5-1-1-2-2-2-4-3 3-4 6-4 9a6 6 0 0 0 6 6Z"/>',
  helado: '<path d="M7 11a5 5 0 0 1 10 0Z"/><path d="m7 11 5 10 5-10"/>',
  vaso: '<path d="M6 3h12l-1.5 17a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1Z"/><path d="M6.5 9h11"/>',
  chispa: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
function estiloCategoria(cat) {
  const c = cat.toLowerCase();
  const icono = /experien|spa|masaj|terap/.test(c) ? 'loto' : /dos|hosped|pareja|habita/.test(c) ? 'corazon'
    : /asad|picad|parrill/.test(c) ? 'fuego' : /helad|postre/.test(c) ? 'helado'
    : /bebid|jugo|bar\b/.test(c) ? 'vaso' : /comid|plato|restaur|catering|almuer/.test(c) ? 'plato' : 'chispa';
  const orden = categorias().indexOf(cat);
  return { tono: `var(${TONOS[Math.max(orden, 0) % TONOS.length]})`, icono: ICONOS[icono] };
}

// Figura central de la confirmación según el método de pago: chulito (efectivo),
// tarjeta que se acerca al datáfono o celular que envía la transferencia, ambas con su sello verde.
const SELLO = '<g class="sello"><circle cx="39" cy="38" r="8.5"/><path d="m35.2 38.2 2.6 2.6 5-5.2"/></g>';
const FIGURAS_PAGO = {
  EFECTIVO: '<path class="check" d="m15 27 7 7 15-16"/>',
  TARJETA: '<g class="figura tarjeta"><rect x="11" y="16" width="28" height="19" rx="3.5"/><path d="M11 22.5h28"/><path class="fino" d="M15.5 30h7"/></g>' + SELLO,
  MIXTO: '<path class="check" d="m15 27 7 7 15-16"/>',
  TRANSFERENCIA: '<g class="figura celular"><rect x="16" y="11" width="17" height="29" rx="3.5"/><path class="fino" d="M22.5 35.5h4"/><path class="senal" d="M37 14.5a6 6 0 0 1 0 8M40.5 11.5a10.5 10.5 0 0 1 0 14"/></g>' + SELLO,
};

// Sonido al confirmar: cada caja decide (se recuerda en este navegador).
let sonidoVenta = true;
try { sonidoVenta = localStorage.getItem('ventas.sonido') !== 'no'; } catch { /* sin almacenamiento */ }
// Tres notas ascendentes (do-mi-sol), cortas y suaves, como una campanita de caja.
const CAMPANITA = [[1047, 0, 0.2], [1319, 0.09, 0.2], [1568, 0.18, 0.34]];
function pintarSonidoVenta() {
  $('#sonido-venta').setAttribute('aria-pressed', sonidoVenta);
  $('#sonido-venta').title = sonidoVenta ? 'Sonido al confirmar: activado (toca para silenciar)' : 'Sonido al confirmar: silenciado (toca para activar)';
  $('#texto-sonido-venta').textContent = sonidoVenta ? 'Sonido activado' : 'Sonido silenciado';
}

/** Confirma la venta con un chulito verde que se dibuja; se va solo o con un toque. */
function celebrar(v) {
  if (sonidoVenta) tocar(CAMPANITA, 0.22);
  return new Promise((listo) => {
    const capa = document.createElement('div');
    capa.className = 'celebra';
    capa.setAttribute('role', 'status');
    capa.innerHTML = `<div class="celebra-caja">
      <svg class="chulito" viewBox="0 0 52 52" aria-hidden="true">
        <circle class="onda" cx="26" cy="26" r="24"/><circle class="aro" cx="26" cy="26" r="24"/>${FIGURAS_PAGO[v.metodoPago] ?? FIGURAS_PAGO.EFECTIVO}
      </svg>
      <b>Venta registrada</b><span>${cop(v.total)} · ${esc(textoPago(v))}</span>
      ${v.cambio ? `<p class="cambio-celebra">Entregar de cambio <b>${cop(v.cambio)}</b></p>` : ''}
    </div>`;
    document.body.append(capa);
    let hecho = false;
    const cerrar = () => {
      if (hecho) return;
      hecho = true;
      capa.classList.add('sale');
      setTimeout(() => { capa.remove(); listo(); }, 200);
    };
    // Con cambio se deja más tiempo para leerlo.
    const reloj = setTimeout(cerrar, v.cambio ? 3200 : 1400);
    capa.onclick = () => { clearTimeout(reloj); cerrar(); };
  });
}

async function cargarProductos() {
  const orden = new Map();
  productos = await api('GET', '/api/productos');
  categorias().forEach((c, i) => orden.set(c, i));
  productos.sort((a, b) => orden.get(a.categoria) - orden.get(b.categoria)); // estable: conserva el orden por nombre
  // Si un producto se desactivó mientras estaba en la venta, se retira.
  for (const id of carrito.keys()) if (!porId(id)) carrito.delete(id);
  pintarCategorias();
  pintarProductos();
  pintarCarrito();
}

function pintarCategorias() {
  const cats = ['Todas', ...categorias()];
  if (!cats.includes(categoria)) categoria = 'Todas';
  $('#categorias').innerHTML = cats
    .map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === categoria}" style="--cat:${estiloCategoria(c).tono}">${esc(c)}</button>`)
    .join('');
}

function pintarProductos() {
  const q = $('#buscar').value.trim().toLowerCase();
  const lista = productos.filter(
    (p) => (categoria === 'Todas' || p.categoria === categoria) && (!q || p.nombre.toLowerCase().includes(q)),
  );
  $('#productos').innerHTML = lista.length
    ? lista.map((p) => {
        const agotado = p.controlaStock && p.stock <= 0;
        const nota = agotado ? 'Agotado' : p.controlaStock ? `Quedan ${p.stock}` : esc(p.categoria);
        const poco = p.controlaStock && p.stock <= 5 ? 'poco' : 'tenue';
        const cant = carrito.get(p.id);
        const est = estiloCategoria(p.categoria);
        return `<button type="button" class="producto ${cant ? 'elegido' : ''}" data-id="${p.id}" ${agotado ? 'disabled' : ''} style="--cat:${est.tono}">
          ${cant ? `<span class="insignia" aria-label="${cant} en la venta">${cant}</span>` : ''}
          <span class="icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${est.icono}</svg></span>
          <b>${esc(p.nombre)}</b>
          <span class="pie"><span class="${poco} chico">${nota}</span><span class="precio">${cop(p.precio)}</span></span>
        </button>`;
      }).join('')
    : '<p class="vacio">No hay productos que coincidan.</p>';
}

function cambiar(id, delta) {
  const p = porId(id);
  if (!p) return;
  const nueva = (carrito.get(id) ?? 0) + delta;
  if (p.controlaStock && nueva > p.stock) return aviso(`Solo quedan ${p.stock} de ${p.nombre}`, true);
  if (cuentaActiva) return cambiarEnCuenta(id, Math.max(0, nueva));
  if (nueva <= 0) carrito.delete(id);
  else carrito.set(id, Math.min(nueva, 9999));
  pintarProductos();
  pintarCarrito();
}

function calcular() {
  let subtotal = 0;
  for (const [id, cant] of carrito) subtotal += porId(id).precio * cant;
  const valor = Math.max(0, Number($('#descuento').value) || 0);
  const descuento = $('#tipo-descuento').value === 'porcentaje'
    ? Math.round((subtotal * Math.min(valor, 100)) / 100)
    : Math.min(Math.round(valor), subtotal);
  return { subtotal, descuento, total: subtotal - descuento };
}

/** "Efectivo" o, si es mixto, "Efectivo $20.000 + Tarjeta $35.000". */
function textoPago(v) {
  if (v.metodoPago !== 'MIXTO' || !v.pagos?.length) return METODOS[v.metodoPago];
  return v.pagos.map((p) => `${METODOS[p.metodo]} ${cop(p.monto)}`).join(' + ');
}

const numero = (el) => (el.value === '' ? null : Math.max(0, Math.round(Number(el.value) || 0)));

/** Cómo se paga el total: un método, o el reparto escrito. Incluye la parte en efectivo y el vuelto. */
function estadoPago(total) {
  const pagos = dividir
    ? [...document.querySelectorAll('[data-parte]')].map((el) => ({ metodo: el.dataset.parte, monto: numero(el) ?? 0 })).filter((p) => p.monto > 0)
    : total > 0 ? [{ metodo, monto: total }] : [];
  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const enEfectivo = pagos.find((p) => p.metodo === 'EFECTIVO')?.monto ?? 0;
  const recibido = enEfectivo > 0 ? numero($('#recibido')) : null;
  return { pagos, falta: total - pagado, enEfectivo, recibido, cambio: recibido === null ? null : recibido - enEfectivo };
}

function pintarPago(t) {
  const e = estadoPago(t.total);
  $('#metodos').hidden = dividir;
  $('#reparto').hidden = !dividir;
  $('#dividir').setAttribute('aria-pressed', dividir);
  $('#dividir').textContent = dividir ? 'Un solo método' : 'Dividir pago';
  const est = $('#estado-pago');
  est.className = `estado-pago ${e.falta === 0 ? 'ok' : e.falta < 0 ? 'mal' : ''}`;
  est.textContent = !t.total ? '' : e.falta > 0 ? `Falta asignar ${cop(e.falta)}` : e.falta < 0 ? `Sobran ${cop(-e.falta)}: ajusta los valores` : 'Pago completo';
  for (const b of document.querySelectorAll('[data-resto]')) b.hidden = e.falta <= 0;

  $('#efectivo').hidden = !carrito.size || e.enEfectivo === 0;
  $('#efectivo-a-cobrar').textContent = dividir ? `· efectivo ${cop(e.enEfectivo)}` : '';
  // Valores rápidos: exacto y los billetes o redondeos más probables por encima del valor.
  const sugeridos = [...new Set([10000, 50000, 100000].map((m) => Math.ceil((e.enEfectivo + 1) / m) * m))]
    .filter((v) => v > e.enEfectivo).sort((a, b) => a - b).slice(0, 3);
  $('#billetes').innerHTML = [['exacto', e.enEfectivo, 'Exacto'], ...sugeridos.map((v) => [v, v, cop(v)])]
    .map(([k, v, t]) => `<button type="button" data-billete="${k}" aria-pressed="${e.recibido !== null && e.recibido === v}">${t}</button>`).join('');
  const vuelto = $('#vuelto');
  vuelto.className = 'vuelto';
  if (e.recibido === null) vuelto.innerHTML = '<span class="tenue">Escribe con cuánto paga para calcular el cambio.</span>';
  else if (e.cambio < 0) { vuelto.classList.add('falta'); vuelto.innerHTML = `<span>Faltan</span><b>${cop(-e.cambio)}</b>`; }
  else vuelto.innerHTML = `<span>Cambio a entregar</span><b>${cop(e.cambio)}</b>`;
  return e;
}

function pintarCarrito() {
  $('#lineas').innerHTML = carrito.size
    ? [...carrito].map(([id, cant]) => {
        const p = porId(id);
        return `<div class="linea">
          <b>${esc(p.nombre)}</b><span class="num">${cop(p.precio * cant)}</span>
          <span class="cant">
            <button type="button" data-id="${id}" data-delta="-1" aria-label="Quitar uno de ${esc(p.nombre)}">−</button>
            <span>${cant}</span>
            <button type="button" data-id="${id}" data-delta="1" aria-label="Agregar uno de ${esc(p.nombre)}">+</button>
            <span class="tenue chico">× ${cop(p.precio)}</span>
          </span>
          <button type="button" class="texto-btn" data-id="${id}" data-delta="-9999" aria-label="Quitar ${esc(p.nombre)} de la venta">Quitar</button>
        </div>`;
      }).join('')
    : '<p class="vacio">Toca un producto para agregarlo.</p>';
  const t = calcular();
  const unidades = [...carrito.values()].reduce((s, c) => s + c, 0);
  $('#subtotal').textContent = cop(t.subtotal);
  $('#valor-descuento').textContent = t.descuento ? `− ${cop(t.descuento)}` : cop(0);
  $('#total').textContent = cop(t.total);
  $('#sin-caja').hidden = Boolean(caja);
  const e = pintarPago(t);
  const pagoListo = (!dividir || e.falta === 0) && !(e.cambio !== null && e.cambio < 0);
  $('#cobrar').disabled = carrito.size === 0 || !caja || !pagoListo;
  $('#cobrar').textContent = !caja ? 'Abre la caja para cobrar'
    : !carrito.size ? 'Agrega productos para cobrar'
    : dividir && e.falta > 0 ? `Falta asignar ${cop(e.falta)}`
    : cuentaActiva ? `Cobrar cuenta ${cop(t.total)}`
    : `Cobrar ${cop(t.total)}`;
  $('#vaciar').hidden = carrito.size === 0 || Boolean(cuentaActiva);
  $('#modo-cuenta').hidden = !cuentaActiva;
  $('#nombre-cuenta').textContent = cuentaActiva?.nombre ?? '';
  $('#titulo-venta').textContent = cuentaActiva ? 'Consumos' : 'Venta en curso';
  $('.carrito .referencia').hidden = Boolean(cuentaActiva);
  // Cargar a cuenta no necesita caja abierta: solo se cobra con caja.
  $('#a-cuenta').hidden = Boolean(cuentaActiva) || carrito.size === 0;
  $('#cancelar-cuenta').hidden = !cuentaActiva || carrito.size > 0;
  $('#barra-movil').hidden = carrito.size === 0;
  $('#movil-resumen').textContent = `${unidades} ${unidades === 1 ? 'ítem' : 'ítems'} · ${cop(t.total)}`;
  for (const b of document.querySelectorAll('#metodos button')) b.setAttribute('aria-pressed', b.dataset.metodo === metodo);
}

async function cobrar() {
  const t = calcular();
  const e = estadoPago(t.total);
  $('#cobrar').disabled = true; // evita doble registro por doble toque
  const pago = {
    descuento: t.descuento,
    ...(dividir ? { pagos: e.pagos } : { metodoPago: metodo }),
    ...(e.recibido !== null ? { recibido: e.recibido } : {}),
  };
  try {
    // Una cuenta se cobra con lo que tiene guardado en el servidor; la venta rápida, con el carrito.
    const venta = cuentaActiva
      ? await api('POST', `/api/cuentas/${cuentaActiva.id}/cobrar`, pago)
      : await api('POST', '/api/ventas', {
          ...pago,
          items: [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad })),
          referencia: $('#referencia').value.trim(),
        });
    limpiarVenta();
    await celebrar(venta);
    mostrarTicket(venta);
  } catch (err) {
    aviso(err.message, true);
  }
  // Se refresca también la caja: pudo cerrarla un administrador mientras tanto.
  await Promise.all([cargarProductos(), cargarCaja(), cargarCuentas()]).catch(() => {});
}

// ---------- Cuentas abiertas ----------
const itemsCarrito = () => [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad }));

/** Pone la cuenta en el panel de venta: sus consumos se ven como el carrito. */
function usarCuenta(c) {
  cuentaActiva = c;
  carrito.clear();
  for (const i of c.items) carrito.set(i.productoId, i.cantidad);
  pintarProductos();
  pintarCarrito();
}

let enCurso = Promise.resolve();
/** Cada toque en modo cuenta se guarda en el servidor, en orden. */
function cambiarEnCuenta(productoId, cantidad) {
  const id = cuentaActiva.id;
  enCurso = enCurso.then(async () => {
    try {
      const c = carrito.has(productoId)
        ? await api('PUT', `/api/cuentas/${id}/items/${productoId}`, { cantidad })
        : await api('POST', `/api/cuentas/${id}/items`, { items: [{ productoId, cantidad }] });
      if (cuentaActiva?.id === id) usarCuenta(c);
    } catch (err) {
      aviso(err.message, true);
      if (/cobró|cancelada/.test(err.message)) salirDeCuenta();
    }
  });
}

function salirDeCuenta() {
  limpiarVenta();
  cargarCuentas().catch(() => {});
}

async function cargarCuentas() {
  cuentas = await api('GET', '/api/cuentas');
  $('#n-cuentas').hidden = cuentas.length === 0;
  $('#n-cuentas').textContent = cuentas.length;
  $('#lista-cuentas').innerHTML = cuentas.length
    ? cuentas.map((c) => `<button type="button" class="cuenta" data-cuenta="${c.id}">
        <span class="nombre">${esc(c.nombre)}</span>
        <b class="valor">${cop(c.total)}</b>
        <span class="tenue chico">${c.unidades} ${c.unidades === 1 ? 'consumo' : 'consumos'} · desde ${hora(c.abiertaEn)} · ${esc(c.abiertaPor.nombre)}</span>
      </button>`).join('')
    : '<p class="vacio">No hay cuentas abiertas. Abre una para la cabaña, mesa o cliente que pagará al final.</p>';
}

async function abrirCuenta(c) {
  if (!cuentaActiva && carrito.size) {
    if (!(await confirmar(`Hay productos en la venta en curso. ¿Cargarlos a "${c.nombre}"?`, 'Cargar a la cuenta'))) return;
    c = await api('POST', `/api/cuentas/${c.id}/items`, { items: itemsCarrito() });
  }
  usarCuenta(c);
  $('[data-vista=nueva]').click();
}

// Diálogo: "Cargar a una cuenta" (desde la venta rápida) o "Nueva cuenta" (desde la pestaña Cuentas).
let modoDlgCuenta = 'cargar';
let cuentaElegida = null;
function pintarElegirCuenta() {
  $('#elegir-cuenta').innerHTML = cuentas
    .map((c) => `<button type="button" data-elegir="${c.id}" aria-pressed="${c.id === cuentaElegida}"><span>${esc(c.nombre)}</span><span class="tenue">${cop(c.total)}</span></button>`)
    .join('');
}
async function dialogoCuenta(modo) {
  modoDlgCuenta = modo;
  cuentaElegida = null;
  await cargarCuentas().catch(() => {});
  const cargar = modo === 'cargar';
  $('#titulo-dlg-cuenta').textContent = cargar ? `Cargar ${cop(calcular().subtotal)} a una cuenta` : 'Nueva cuenta';
  $('#elegir-cuenta').hidden = !cargar || cuentas.length === 0;
  $('#lbl-nombre-cuenta').textContent = cargar && cuentas.length ? 'O abre una cuenta nueva' : 'Nombre de la cuenta';
  $('#ok-cuenta').textContent = cargar ? 'Cargar' : 'Abrir cuenta';
  $('#nombre-nueva-cuenta').value = '';
  $('#error-cuenta').hidden = true;
  pintarElegirCuenta();
  $('#dlg-cuenta').showModal();
  if (!cargar || !cuentas.length) $('#nombre-nueva-cuenta').focus();
}

/** Deja la venta en curso en blanco, lista para el siguiente cliente. */
function limpiarVenta() {
  carrito.clear();
  cuentaActiva = null;
  dividir = false;
  for (const id of ['#descuento', '#referencia', '#recibido']) $(id).value = '';
  for (const el of document.querySelectorAll('[data-parte]')) el.value = '';
  pintarProductos();
  pintarCarrito();
}

// ---------- Caja ----------
async function cargarCaja() {
  caja = (await api('GET', '/api/caja/actual')).caja;
  pintarCarrito();
}

let cajas = [];
async function cargarVistaCaja() {
  [, cajas] = await Promise.all([cargarCaja(), api('GET', '/api/cajas')]);
  $('#caja-cerrada').hidden = Boolean(caja);
  $('#caja-abierta').hidden = !caja;
  if (caja) {
    const q = caja.cuadre;
    $('#titulo-caja').textContent = `Caja N.º ${caja.id} · abierta ${fechaHora(caja.abiertaEn)}`;
    $('#caja-base').textContent = cop(q.base);
    $('#caja-ventas').textContent = q.ventas;
    $('.ciego-nota').hidden = !q.ciego;
    $('#diferencia-viva').hidden = Boolean(q.ciego);
    if (!q.ciego) {
      $('#caja-efectivo').textContent = cop(q.efectivo);
      $('#caja-esperado').textContent = cop(q.efectivoEsperado);
      $('#caja-tarjeta').textContent = cop(q.tarjeta);
      $('#caja-transferencia').textContent = cop(q.transferencia);
      pintarDiferencia();
    }
  }
  $('#titulo-cajas').textContent = yo.rol === 'ADMIN' ? 'Cajas recientes (todas)' : 'Mis cajas';
  $('#tabla-cajas').innerHTML = filasCajas(cajas);
}

function pintarDiferencia() {
  const el = $('#diferencia-viva');
  const valor = $('#contado').value;
  if (caja?.cuadre.ciego) return;
  el.className = 'tenue';
  if (valor === '' || !caja) return (el.textContent = 'Escribe lo que contaste para ver la diferencia.');
  const dif = Number(valor) - caja.cuadre.efectivoEsperado;
  el.textContent = `Esperado ${cop(caja.cuadre.efectivoEsperado)} · ${textoDiferencia(dif)}`;
  if (dif < 0) el.className = 'falta';
}

function mostrarCuadre(c) {
  ventaEnTicket = null;
  $('#anular').hidden = true;
  $('#ticket').innerHTML = htmlCuadre(c);
  $('#dlg-ticket').showModal();
}

$('#form-abrir').onsubmit = async (e) => {
  e.preventDefault();
  const baseInicial = Number($('#base-inicial').value);
  if (!Number.isInteger(baseInicial) || baseInicial < 0) return aviso('La base debe ser un número entero, sin decimales.', true);
  try {
    await api('POST', '/api/caja/abrir', { baseInicial });
    $('#base-inicial').value = '';
    aviso('Caja abierta');
  } catch (err) {
    aviso(err.message, true);
  }
  await cargarVistaCaja();
};
$('#contado').oninput = pintarDiferencia;
$('#form-cerrar').onsubmit = async (e) => {
  e.preventDefault();
  const efectivoContado = Number($('#contado').value);
  if (!Number.isInteger(efectivoContado) || efectivoContado < 0) return aviso('El efectivo contado debe ser un número entero.', true);
  if (!(await confirmar(`¿Cerrar la caja con ${cop(efectivoContado)} contados? Después no podrás registrar ventas hasta abrir otra.`, 'Cerrar caja'))) return;
  try {
    const cerrada = await api('POST', `/api/caja/${caja.id}/cerrar`, { efectivoContado, nota: $('#nota-cierre').value.trim() });
    $('#form-cerrar').reset();
    mostrarCuadre(cerrada);
  } catch (err) {
    aviso(err.message, true);
  }
  await cargarVistaCaja();
};
$('#recargar-caja').onclick = () => cargarVistaCaja().catch((err) => aviso(err.message, true));
function abrirCaja(e) {
  const tr = e.target.closest('tr[data-caja]');
  const c = tr && cajas.find((x) => x.id === Number(tr.dataset.caja));
  if (c) mostrarCuadre(c);
}
$('#tabla-cajas').onclick = abrirCaja;
// Con bloque: un manejador on* que devuelve false cancela la tecla.
$('#tabla-cajas').onkeydown = (e) => { if (e.key === 'Enter') abrirCaja(e); };
$('#ir-caja').onclick = () => $('[data-vista=caja]').click();

function mostrarTicket(v) {
  ventaEnTicket = v;
  const anulada = v.estado === 'ANULADA';
  // Regla: solo un administrador anula.
  $('#anular').hidden = anulada || yo.rol !== 'ADMIN';
  $('#ticket').innerHTML = `
    ${anulada ? `<p class="error"><b>VENTA ANULADA</b> · ${esc(fechaHora(v.anuladaEn))} · ${esc(v.anuladaPor?.nombre)}<br>Motivo: ${esc(v.motivoAnulacion)}</p>` : ''}
    <h3>Río Vivo Spa</h3>
    <p class="centro tenue chico">Santa Fe de Antioquia<br>Venta N.º ${v.id} · ${esc(fechaHora(v.creadaEn))}<br>Atendió: ${esc(v.usuario.nombre)}${v.referencia ? `<br>Para: <b>${esc(v.referencia)}</b>` : ''}</p>
    <table>
      <thead><tr><th>Cant.</th><th>Detalle</th><th class="num">Valor</th></tr></thead>
      <tbody>${v.items.map((i) => `<tr><td>${i.cantidad}</td><td>${esc(i.nombre)}<br><span class="tenue chico">${cop(i.precioUnitario)} c/u</span></td><td class="num">${cop(i.totalLinea)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal</span><span>${cop(v.subtotal)}</span></div>
      ${v.descuento ? `<div><span>Descuento</span><span>− ${cop(v.descuento)}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${cop(v.total)}</span></div>
      ${v.metodoPago === 'MIXTO' && v.pagos?.length
        ? v.pagos.map((p) => `<div><span>Pago ${METODOS[p.metodo].toLowerCase()}</span><span>${cop(p.monto)}</span></div>`).join('')
        : `<div><span>Pago</span><span>${METODOS[v.metodoPago]}</span></div>`}
      ${v.recibido !== null && v.recibido !== undefined ? `<div><span>Efectivo recibido</span><span>${cop(v.recibido)}</span></div><div><span>Cambio</span><span>${cop(v.cambio ?? 0)}</span></div>` : ''}
    </div>
    ${anulada ? '' : htmlResena(ajustes)}`;
  $('#dlg-ticket').showModal();
}

let ventasHoy = [];
let filtroVentas = 'TODAS';
const BASICOS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'];
// Pagos de una venta (las anteriores al pago mixto traen uno solo).
const pagosDe = (v) => (v.pagos?.length ? v.pagos : [{ metodo: v.metodoPago, monto: v.total }]);
const conMetodo = (m) => (v) => v.estado === 'ACTIVA' && pagosDe(v).some((p) => p.metodo === m);
const FILTROS = {
  TODAS: { nombre: 'Todas', cumple: () => true },
  EFECTIVO: { nombre: 'Efectivo', cumple: conMetodo('EFECTIVO') },
  TARJETA: { nombre: 'Tarjeta', cumple: conMetodo('TARJETA') },
  TRANSFERENCIA: { nombre: 'Transferencia', cumple: conMetodo('TRANSFERENCIA') },
  MIXTO: { nombre: 'Mixto', cumple: (v) => v.estado === 'ACTIVA' && v.metodoPago === 'MIXTO' },
  ANULADAS: { nombre: 'Anuladas', cumple: (v) => v.estado === 'ANULADA' },
};
const ICONO_ACCION = {
  ver: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  imprimir: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6Z"/>',
  anular: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
};
const pildora = (m, titulo) => `<span class="pago-pill p-${m.toLowerCase()}"${titulo ? ` title="${esc(titulo)}"` : ''}>${METODOS[m]}</span>`;
const accion = (tipo, nombre, v) => `<button type="button" class="accion ${tipo}" data-accion="${tipo}" aria-label="${nombre} venta N.º ${v.id}" title="${nombre}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONO_ACCION[tipo]}</svg></button>`;

async function cargarHoy() {
  if (!$('#fecha-ventas').value) $('#fecha-ventas').value = hoyIso();
  const d = await api('GET', `/api/ventas?fecha=${$('#fecha-ventas').value}`);
  ventasHoy = d.ventas;
  // Las anuladas se muestran, pero no cuentan en ningún total.
  const activas = d.ventas.filter((v) => v.estado === 'ACTIVA');
  $('#titulo-hoy').textContent = `Ventas del día · ${diaLargo(d.fecha)}`;
  if (!d.ciego) $('#hoy-total').textContent = cop(d.total);
  $('#hoy-cantidad').textContent = activas.length;
  // Total por método: es lo que se cuadra contra el cajón, el datáfono y el banco.
  for (const m of BASICOS) {
    $(`#hoy-${m}`).textContent = cop(activas.flatMap(pagosDe).filter((p) => p.metodo === m).reduce((s, p) => s + p.monto, 0));
  }
  pintarHoy();
}

function pintarHoy() {
  // Filtros con su conteo; Mixto y Anuladas solo aparecen si hay alguna.
  $('#filtro-ventas').innerHTML = Object.entries(FILTROS)
    .map(([k, f]) => [k, f, ventasHoy.filter(f.cumple).length])
    .filter(([k, , n]) => n > 0 || k === filtroVentas || (!['MIXTO', 'ANULADAS'].includes(k) && (k === 'TODAS' || habilitado(k))))
    .map(([k, f, n]) => `<button type="button" data-filtro="${k}" aria-pressed="${k === filtroVentas}">${f.nombre} <span class="n-filtro">${n}</span></button>`)
    .join('');
  const q = $('#buscar-ventas').value.trim().toLowerCase();
  const lista = ventasHoy.filter((v) => FILTROS[filtroVentas].cumple(v) && (!q || [
    String(v.id), v.referencia, v.usuario.nombre, ...v.items.map((i) => i.nombre),
  ].some((t) => t && t.toLowerCase().includes(q))));
  const esAdmin = yo.rol === 'ADMIN';
  $('#tabla-hoy').innerHTML = lista.length
    ? lista.map((v) => {
        const anulada = v.estado === 'ANULADA';
        const pago = anulada ? '<span class="pago-pill p-anulada">Anulada</span>'
          : pagosDe(v).map((p) => pildora(p.metodo, v.metodoPago === 'MIXTO' ? cop(p.monto) : '')).join('');
        return `<tr class="clic ${anulada ? 'anulada' : ''}" data-id="${v.id}" tabindex="0">
        <td>${v.id}</td><td>${hora(v.creadaEn)}</td><td>${esc(v.usuario.nombre)}</td>
        <td>${v.referencia ? `<span class="ref-venta">${esc(v.referencia)}</span>` : ''}${esc(v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', '))}</td>
        <td><span class="pills">${pago}</span></td><td class="num"><b class="tachado">${cop(v.total)}</b></td>
        <td class="acciones">${accion('ver', 'Ver', v)}${accion('imprimir', 'Reimprimir', v)}${esAdmin && !anulada ? accion('anular', 'Anular', v) : ''}</td></tr>`;
      }).join('')
    : `<tr><td colspan="7" class="vacio">${ventasHoy.length ? 'Ninguna venta coincide con la búsqueda.' : 'No hay ventas este día.'}</td></tr>`;
}

function pedirAnulacion(v) {
  ventaEnTicket = v;
  $('#titulo-anular').textContent = `Anular venta N.º ${v.id} · ${cop(v.total)}`;
  $('#motivo-anular').value = '';
  $('#error-anular').hidden = true;
  $('#dlg-anular').showModal();
}

// Eventos
$('#categorias').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  categoria = b.dataset.cat;
  pintarCategorias();
  pintarProductos();
};
$('#buscar').oninput = pintarProductos;
$('#productos').onclick = (e) => {
  const b = e.target.closest('.producto');
  if (b) cambiar(Number(b.dataset.id), 1);
};
$('#lineas').onclick = (e) => {
  const b = e.target.closest('button');
  if (b) cambiar(Number(b.dataset.id), Number(b.dataset.delta));
};
$('#descuento').oninput = pintarCarrito;
$('#tipo-descuento').onchange = pintarCarrito;
$('#sonido-venta').onclick = () => {
  sonidoVenta = !sonidoVenta;
  try { localStorage.setItem('ventas.sonido', sonidoVenta ? 'si' : 'no'); } catch { /* sin almacenamiento */ }
  pintarSonidoVenta();
  if (sonidoVenta) tocar(CAMPANITA, 0.22); // muestra cómo suena
};
$('#a-cuenta').onclick = () => dialogoCuenta('cargar');
$('#nueva-cuenta').onclick = () => dialogoCuenta('nueva');
$('#salir-cuenta').onclick = salirDeCuenta;
$('#cancelar-cuenta').onclick = async () => {
  if (!(await confirmar(`¿Cancelar la cuenta "${cuentaActiva.nombre}"? No tiene consumos.`, 'Cancelar cuenta'))) return;
  try {
    await api('POST', `/api/cuentas/${cuentaActiva.id}/cancelar`);
    aviso('Cuenta cancelada');
  } catch (err) {
    aviso(err.message, true);
  }
  salirDeCuenta();
};
$('#lista-cuentas').onclick = (e) => {
  const b = e.target.closest('[data-cuenta]');
  const c = b && cuentas.find((x) => x.id === Number(b.dataset.cuenta));
  if (c) abrirCuenta(c).catch((err) => aviso(err.message, true));
};
$('#elegir-cuenta').onclick = (e) => {
  const b = e.target.closest('[data-elegir]');
  if (!b) return;
  cuentaElegida = Number(b.dataset.elegir);
  $('#nombre-nueva-cuenta').value = '';
  pintarElegirCuenta();
};
$('#nombre-nueva-cuenta').oninput = () => {
  if (cuentaElegida === null) return;
  cuentaElegida = null;
  pintarElegirCuenta();
};
$('#cancelar-dlg-cuenta').onclick = () => $('#dlg-cuenta').close();
$('#form-cuenta').onsubmit = async (e) => {
  e.preventDefault();
  const nombre = $('#nombre-nueva-cuenta').value.trim();
  const error = (m) => { $('#error-cuenta').textContent = m; $('#error-cuenta').hidden = false; };
  if (cuentaElegida === null && !nombre) return error('Elige una cuenta o escribe el nombre de una nueva.');
  $('#ok-cuenta').disabled = true;
  try {
    const items = modoDlgCuenta === 'cargar' ? itemsCarrito() : undefined;
    const c = cuentaElegida !== null
      ? await api('POST', `/api/cuentas/${cuentaElegida}/items`, { items })
      : await api('POST', '/api/cuentas', { nombre, ...(items ? { items } : {}) });
    $('#dlg-cuenta').close();
    if (modoDlgCuenta === 'cargar') {
      limpiarVenta();
      aviso(`Cargado a ${c.nombre} · total ${cop(c.total)}`);
      await cargarCuentas();
    } else {
      usarCuenta(c);
      $('[data-vista=nueva]').click();
    }
  } catch (err) {
    error(err.message);
  }
  $('#ok-cuenta').disabled = false;
};
// Con bloque: si devolviera false (cualquier tecla que no sea Enter), el navegador cancelaría la escritura.
$('#referencia').onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
$('#dividir').onclick = () => {
  dividir = !dividir;
  // Al dividir se parte del método elegido con todo el total; el cajero ajusta desde ahí.
  for (const el of document.querySelectorAll('[data-parte]')) el.value = '';
  if (dividir && carrito.size) $(`[data-parte=${metodo}]`).value = calcular().total;
  $('#recibido').value = '';
  pintarCarrito();
  if (dividir) $(`[data-parte=${metodo}]`).select();
};
$('#reparto').oninput = pintarCarrito;
$('#reparto').onclick = (e) => {
  const b = e.target.closest('[data-resto]');
  if (!b) return;
  const el = $(`[data-parte=${b.dataset.resto}]`);
  el.value = (numero(el) ?? 0) + Math.max(0, estadoPago(calcular().total).falta);
  pintarCarrito();
};
$('#recibido').oninput = pintarCarrito;
$('#billetes').onclick = (e) => {
  const b = e.target.closest('[data-billete]');
  if (!b || b.disabled) return;
  $('#recibido').value = b.dataset.billete === 'exacto' ? estadoPago(calcular().total).enEfectivo : b.dataset.billete;
  pintarCarrito();
};
$('#metodos').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  metodo = b.dataset.metodo;
  pintarCarrito();
};
$('#cobrar').onclick = cobrar;
$('#vaciar').onclick = limpiarVenta;
$('#barra-movil').onclick = () => $('.carrito').scrollIntoView({ behavior: 'smooth' });
$('#recargar').onclick = () => cargarHoy().catch((err) => aviso(err.message, true));
function abrirFila(e) {
  const tr = e.target.closest('tr[data-id]');
  const v = tr && ventasHoy.find((x) => x.id === Number(tr.dataset.id));
  if (!v) return;
  const b = e.target.closest('[data-accion]');
  if (b?.dataset.accion === 'anular') return pedirAnulacion(v);
  mostrarTicket(v);
  if (b?.dataset.accion === 'imprimir') requestAnimationFrame(() => window.print());
}
$('#buscar-ventas').oninput = pintarHoy;
$('#filtro-ventas').onclick = (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  filtroVentas = b.dataset.filtro;
  pintarHoy();
};
$('#tabla-hoy').onclick = abrirFila;
$('#tabla-hoy').onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('tr')) abrirFila(e); };
$('#fecha-ventas').onchange = () => cargarHoy().catch((err) => aviso(err.message, true));
$('#anular').onclick = () => pedirAnulacion(ventaEnTicket);
$('#cancelar-anular').onclick = () => $('#dlg-anular').close();
$('#form-anular').onsubmit = async (e) => {
  e.preventDefault();
  const boton = $('#form-anular .rojo');
  boton.disabled = true;
  try {
    const anulada = await api('POST', `/api/ventas/${ventaEnTicket.id}/anular`, { motivo: $('#motivo-anular').value });
    $('#dlg-anular').close();
    mostrarTicket(anulada);
    aviso('Venta anulada');
    await Promise.all([cargarHoy(), cargarProductos(), cargarCaja()]);
  } catch (err) {
    $('#error-anular').textContent = err.message;
    $('#error-anular').hidden = false;
  }
  boton.disabled = false;
};
$('#imprimir').onclick = () => window.print();
$('#cerrar-ticket').onclick = () => $('#dlg-ticket').close();

// ---------- Pedidos de las mesas (carta → POS) ----------
let pedidos = [];
let pendientesVistos = null;
const eleccion = new Map(); // líneaId → productoId elegido por recepción (sobrevive a las actualizaciones)
const sinDomicilio = new Set(); // "pedido:índice" de los domicilios que recepción desmarcó
const TIMBRE = [[784, 0, 0.14], [988, 0.13, 0.14], [784, 0.3, 0.14], [988, 0.43, 0.22]];

function opcionesProductos(elegido) {
  const porCat = new Map();
  for (const p of productos) porCat.set(p.categoria, [...(porCat.get(p.categoria) ?? []), p]);
  return `<option value="">Elige el producto…</option>` + [...porCat].map(([cat, lista]) =>
    `<optgroup label="${esc(cat)}">${lista.map((p) => `<option value="${p.id}" ${p.id === elegido ? 'selected' : ''}>${esc(p.nombre)} · ${cop(p.precio)}</option>`).join('')}</optgroup>`).join('');
}

function pintarPedidos() {
  const pendientes = pedidos.filter((p) => p.estado === 'PENDIENTE');
  const atendidos = pedidos.filter((p) => p.estado !== 'PENDIENTE').reverse();
  $('#n-pedidos').hidden = pendientes.length === 0;
  $('#n-pedidos').textContent = pendientes.length;
  if ($('#vista-pedidos').hidden) return;
  $('#lista-pedidos').innerHTML = pendientes.length
    ? pendientes.map((p) => {
        let total = 0;
        const lineas = p.lineas.map((l) => {
          const elegido = eleccion.get(l.id) ?? l.productoId;
          const prod = porId(elegido);
          if (prod) total += prod.precio * l.cantidad;
          const marca = eleccion.has(l.id) ? '' : l.origen === 'aprendido' ? '<span class="pago-pill p-efectivo">Conocido</span>' : l.origen === 'sugerido' ? '<span class="pago-pill p-mixto">Revisa</span>' : '';
          return `<div class="linea-pedido">
            <div><b>${l.cantidad} ×</b> ${esc(l.nombre)} <span class="tenue chico">· ${esc(l.grupo)}${l.restaurante ? ` · ${esc(l.restaurante)}` : ''} · ${cop(l.precioCarta)} en la carta</span> ${marca}</div>
            <select data-linea="${l.id}" aria-label="Producto del POS para ${esc(l.nombre)}">${opcionesProductos(elegido)}</select>
          </div>`;
        }).join('');
        const domicilios = (p.domicilios ?? []).map((d, i) => {
          const marcado = !sinDomicilio.has(`${p.id}:${i}`);
          if (marcado) total += d.precio;
          return `<label class="domicilio-pedido"><input type="checkbox" data-domicilio="${p.id}:${i}" ${marcado ? 'checked' : ''}>
            <span>${esc(d.nombre)} <span class="tenue chico">· ${esc(d.restaurante)}</span></span><b>${cop(d.precio)}</b></label>`;
        }).join('');
        const completo = p.lineas.every((l) => porId(eleccion.get(l.id) ?? l.productoId));
        const nombreCuenta = /^\d+$/.test(p.mesa) ? `Mesa ${p.mesa}` : p.mesa;
        return `<article class="pedido" data-pedido="${p.id}">
          <header><b>${esc(nombreCuenta)}</b><span class="tenue">${hora(p.creadoEn)} · hace ${Math.max(0, Math.floor((Date.now() - new Date(p.creadoEn)) / 60000))} min</span></header>
          ${p.nota ? `<p class="nota-pedido">“${esc(p.nota)}”</p>` : ''}
          ${lineas}
          ${domicilios ? `<div class="domicilios"><span class="tenue chico">Domicilio (lo paga el cliente; desmarca si no aplica)</span>${domicilios}</div>` : ''}
          <footer>
            <span>Total con precios del POS: <b>${cop(total)}</b></span>
            <span class="acciones">
              <button type="button" class="btn" data-rechazar="${p.id}">Rechazar</button>
              <button type="button" class="btn primario" data-aceptar="${p.id}" ${completo ? '' : 'disabled'}>Aceptar y cargar a ${esc(nombreCuenta)}</button>
            </span>
          </footer>
        </article>`;
      }).join('')
    : '<p class="vacio">No hay pedidos por atender. Cuando una mesa pida desde la carta, aparecerá aquí con un timbre.</p>';
  $('#titulo-atendidos').hidden = $('#panel-atendidos').hidden = atendidos.length === 0;
  $('#tabla-atendidos').innerHTML = atendidos.map((p) => `<tr>
    <td>${hora(p.creadoEn)}</td><td>${esc(p.mesa)}</td>
    <td>${esc(p.lineas.map((l) => `${l.cantidad} × ${l.nombre}`).join(', '))}</td>
    <td>${p.estado === 'ACEPTADO' ? '<span class="pago-pill p-efectivo">Cargado a la cuenta</span>' : '<span class="pago-pill p-anulada">Rechazado</span>'}</td></tr>`).join('');
}

async function vigilarPedidos() {
  try {
    pedidos = await api('GET', '/api/pedidos-mesa');
    const pendientes = pedidos.filter((p) => p.estado === 'PENDIENTE');
    if (pendientesVistos) {
      const nuevos = pendientes.filter((p) => !pendientesVistos.has(p.id));
      if (nuevos.length) {
        const nombres = nuevos.map((p) => (/^\d+$/.test(p.mesa) ? `Mesa ${p.mesa}` : p.mesa));
        if (sonidoVenta) {
          tocar(TIMBRE, 0.25);
          setTimeout(() => (nuevos.length === 1
            ? anunciar([`pedido-${claveVoz(nombres[0])}`, 'nuevo-pedido'], `Nuevo pedido, ${nombres[0]}`)
            : anunciar(['pedidos-nuevos'], `${nuevos.length} pedidos nuevos`)), 750);
        }
        aviso(`Nuevo pedido: ${nombres.join(', ')}`);
      }
    }
    pendientesVistos = new Set(pendientes.map((p) => p.id));
    // No se repinta mientras alguien elige un producto en una lista.
    if (!document.activeElement?.matches('#lista-pedidos select')) pintarPedidos();
  } catch { /* sin conexión: se reintenta */ }
}

$('#lista-pedidos').onchange = (e) => {
  const d = e.target.closest('[data-domicilio]');
  if (d) {
    if (d.checked) sinDomicilio.delete(d.dataset.domicilio);
    else sinDomicilio.add(d.dataset.domicilio);
    return pintarPedidos();
  }
  const s = e.target.closest('[data-linea]');
  if (!s) return;
  if (s.value) eleccion.set(Number(s.dataset.linea), Number(s.value));
  else eleccion.delete(Number(s.dataset.linea));
  pintarPedidos();
};
$('#lista-pedidos').onclick = async (e) => {
  const aceptar = e.target.closest('[data-aceptar]');
  const rechazar = e.target.closest('[data-rechazar]');
  const id = Number((aceptar ?? rechazar)?.dataset.aceptar ?? (aceptar ?? rechazar)?.dataset.rechazar);
  const p = pedidos.find((x) => x.id === id);
  if (!p) return;
  try {
    if (rechazar) {
      if (!(await confirmar(`¿Rechazar el pedido de ${p.mesa}? No se carga a ninguna cuenta.`, 'Rechazar'))) return;
      await api('POST', `/api/pedidos-mesa/${id}/rechazar`);
      aviso('Pedido rechazado');
    } else {
      aceptar.disabled = true;
      const r = await api('POST', `/api/pedidos-mesa/${id}/aceptar`, {
        lineas: p.lineas.map((l) => ({ id: l.id, productoId: eleccion.get(l.id) ?? l.productoId })),
        domicilios: (p.domicilios ?? []).filter((_, i) => !sinDomicilio.has(`${p.id}:${i}`)).map((d) => d.productoId),
      });
      for (const l of p.lineas) eleccion.delete(l.id);
      if (sonidoVenta) tocar(CAMPANITA, 0.18);
      aviso(`Cargado a ${r.cuenta}`);
      cargarCuentas().catch(() => {});
    }
  } catch (err) {
    aviso(err.message, true);
  }
  await vigilarPedidos();
};

// ---------- Lo que el negocio tiene habilitado (Administración → Ajustes) ----------
const habilitado = (m) => !ajustes?.metodosPago || ajustes.metodosPago.includes(m);
function aplicarAjustes() {
  const metodos = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].filter(habilitado);
  for (const b of document.querySelectorAll('#metodos [data-metodo]')) b.hidden = !habilitado(b.dataset.metodo);
  $('#metodos').style.gridTemplateColumns = `repeat(${metodos.length}, 1fr)`;
  for (const el of document.querySelectorAll('[data-parte]')) el.closest('label').hidden = !habilitado(el.dataset.parte);
  // Con un solo método no hay nada que dividir.
  $('#dividir').hidden = metodos.length < 2;
  if (!habilitado(metodo)) metodo = metodos[0];
  for (const [m, ids] of [['EFECTIVO', ['#hoy-EFECTIVO']], ['TARJETA', ['#hoy-TARJETA', '#caja-tarjeta']], ['TRANSFERENCIA', ['#hoy-TRANSFERENCIA', '#caja-transferencia']]]) {
    for (const id of ids) $(id).closest('.kpi').hidden = !habilitado(m);
  }
  $('a.cambiar-area[href="/cocina"]').hidden = ajustes?.comandas === false;
  pintarCarrito();
}

// ---------- Avisos de cocina ----------
// Cada pocos segundos se mira el tablero: cuando un pedido queda listo, la caja se entera.
let listasVistas = null;
async function vigilarComandas() {
  try {
    const listas = (await api('GET', '/api/comandas?estacion=TODAS')).filter((c) => c.estado === 'LISTA');
    $('#n-listas').hidden = listas.length === 0;
    $('#n-listas').textContent = listas.length;
    if (listasVistas) {
      const nuevas = listas.filter((c) => !listasVistas.has(c.id));
      if (nuevas.length) {
        const nombres = nuevas.map((c) => `${c.referencia || `Venta N.º ${c.ventaId}`} (${c.estacion === 'BAR' ? 'bar' : 'cocina'})`);
        aviso(`Listo para entregar: ${nombres.join(', ')}`);
      }
    }
    listasVistas = new Set(listas.map((c) => c.id));
  } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
}

(async () => {
  yo = await iniciarSesionUi();
  // Cierre ciego: el vendedor no ve totales en dinero de la caja ni del día.
  document.body.classList.toggle('vendedor', yo.rol !== 'ADMIN');
  await Promise.all([cargarCaja(), cargarCuentas(), api('GET', '/api/ajustes').then((a) => { ajustes = a; }).catch(() => {})]);
  $('#ir-admin').hidden = yo.rol !== 'ADMIN';
  pintarSonidoVenta();
  aplicarAjustes();
  // Pantalla de cocina: solo si el negocio la usa.
  if (ajustes?.comandas !== false) {
    vigilarComandas();
    setInterval(vigilarComandas, 10000);
  }
  vigilarPedidos();
  setInterval(vigilarPedidos, 8000);
  iniciarPestanas((vista) => {
    const cargar = { nueva: () => Promise.all([cargarProductos(), cargarCaja()]), pedidos: async () => { if (!productos.length) await cargarProductos(); pintarPedidos(); await vigilarPedidos(); }, cuentas: cargarCuentas, hoy: cargarHoy, caja: cargarVistaCaja };
    cargar[vista]().catch((err) => aviso(err.message, true));
  });
})();
