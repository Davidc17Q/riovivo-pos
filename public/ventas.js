// Área de ventas: armar la venta, registrarla, ver el ticket y las ventas del día.
let productos = [];
const carrito = new Map(); // productoId → cantidad
let categoria = 'Todas';
let metodo = 'EFECTIVO';
let yo = null;
let caja = null; // caja abierta de este usuario (null = no puede vender)
let ventaEnTicket = null;

const porId = (id) => productos.find((p) => p.id === id);

async function cargarProductos() {
  productos = await api('GET', '/api/productos');
  // Si un producto se desactivó mientras estaba en la venta, se retira.
  for (const id of carrito.keys()) if (!porId(id)) carrito.delete(id);
  pintarCategorias();
  pintarProductos();
  pintarCarrito();
}

function pintarCategorias() {
  const cats = ['Todas', ...new Set(productos.map((p) => p.categoria))];
  if (!cats.includes(categoria)) categoria = 'Todas';
  $('#categorias').innerHTML = cats
    .map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === categoria}">${esc(c)}</button>`)
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
        return `<button type="button" class="producto ${cant ? 'elegido' : ''}" data-id="${p.id}" ${agotado ? 'disabled' : ''}>
          ${cant ? `<span class="insignia" aria-label="${cant} en la venta">${cant}</span>` : ''}
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
  $('#cobrar').disabled = carrito.size === 0 || !caja;
  $('#cobrar').textContent = !caja ? 'Abre la caja para cobrar' : carrito.size ? `Cobrar ${cop(t.total)}` : 'Agrega productos para cobrar';
  $('#vaciar').hidden = carrito.size === 0;
  $('#barra-movil').hidden = carrito.size === 0;
  $('#movil-resumen').textContent = `${unidades} ${unidades === 1 ? 'ítem' : 'ítems'} · ${cop(t.total)}`;
  for (const b of document.querySelectorAll('#metodos button')) b.setAttribute('aria-pressed', b.dataset.metodo === metodo);
}

async function cobrar() {
  const t = calcular();
  $('#cobrar').disabled = true; // evita doble registro por doble toque
  try {
    const venta = await api('POST', '/api/ventas', {
      items: [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad })),
      descuento: t.descuento,
      metodoPago: metodo,
    });
    carrito.clear();
    $('#descuento').value = '';
    mostrarTicket(venta);
  } catch (err) {
    aviso(err.message, true);
  }
  // Se refresca también la caja: pudo cerrarla un administrador mientras tanto.
  await Promise.all([cargarProductos(), cargarCaja()]).catch(() => {});
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
    $('#caja-efectivo').textContent = cop(q.efectivo);
    $('#caja-esperado').textContent = cop(q.efectivoEsperado);
    $('#caja-tarjeta').textContent = cop(q.tarjeta);
    $('#caja-transferencia').textContent = cop(q.transferencia);
    pintarDiferencia();
  }
  $('#titulo-cajas').textContent = yo.rol === 'ADMIN' ? 'Cajas recientes (todas)' : 'Mis cajas';
  $('#tabla-cajas').innerHTML = filasCajas(cajas);
}

function pintarDiferencia() {
  const el = $('#diferencia-viva');
  const valor = $('#contado').value;
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
$('#tabla-cajas').onkeydown = (e) => e.key === 'Enter' && abrirCaja(e);
$('#ir-caja').onclick = () => $('[data-vista=caja]').click();

function mostrarTicket(v) {
  ventaEnTicket = v;
  const anulada = v.estado === 'ANULADA';
  // Regla: solo un administrador anula.
  $('#anular').hidden = anulada || yo.rol !== 'ADMIN';
  $('#ticket').innerHTML = `
    ${anulada ? `<p class="error"><b>VENTA ANULADA</b> · ${esc(fechaHora(v.anuladaEn))} · ${esc(v.anuladaPor?.nombre)}<br>Motivo: ${esc(v.motivoAnulacion)}</p>` : ''}
    <h3>Río Vivo Spa</h3>
    <p class="centro tenue chico">Santa Fe de Antioquia<br>Venta N.º ${v.id} · ${esc(fechaHora(v.creadaEn))}<br>Atendió: ${esc(v.usuario.nombre)}</p>
    <table>
      <thead><tr><th>Cant.</th><th>Detalle</th><th class="num">Valor</th></tr></thead>
      <tbody>${v.items.map((i) => `<tr><td>${i.cantidad}</td><td>${esc(i.nombre)}<br><span class="tenue chico">${cop(i.precioUnitario)} c/u</span></td><td class="num">${cop(i.totalLinea)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal</span><span>${cop(v.subtotal)}</span></div>
      ${v.descuento ? `<div><span>Descuento</span><span>− ${cop(v.descuento)}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${cop(v.total)}</span></div>
      <div><span>Pago</span><span>${METODOS[v.metodoPago]}</span></div>
    </div>`;
  $('#dlg-ticket').showModal();
}

let ventasHoy = [];
async function cargarHoy() {
  if (!$('#fecha-ventas').value) $('#fecha-ventas').value = hoyIso();
  const d = await api('GET', `/api/ventas?fecha=${$('#fecha-ventas').value}`);
  ventasHoy = d.ventas;
  // Las anuladas se muestran, pero no cuentan en ningún total.
  const activas = d.ventas.filter((v) => v.estado === 'ACTIVA');
  $('#titulo-hoy').textContent = `Ventas del día · ${diaLargo(d.fecha)}`;
  $('#hoy-total').textContent = cop(d.total);
  $('#hoy-cantidad').textContent = activas.length;
  // Total por método: es lo que se cuadra contra el cajón, el datáfono y el banco.
  for (const m of Object.keys(METODOS)) {
    $(`#hoy-${m}`).textContent = cop(activas.filter((v) => v.metodoPago === m).reduce((s, v) => s + v.total, 0));
  }
  $('#tabla-hoy').innerHTML = d.ventas.length
    ? d.ventas.map((v) => `<tr class="clic ${v.estado === 'ANULADA' ? 'anulada' : ''}" data-id="${v.id}" tabindex="0">
        <td>${v.id}</td><td>${hora(v.creadaEn)}</td><td>${esc(v.usuario.nombre)}</td>
        <td>${esc(v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', '))}</td>
        <td>${v.estado === 'ANULADA' ? '<span class="etiqueta rojo">Anulada</span>' : METODOS[v.metodoPago]}</td><td class="num"><b class="tachado">${cop(v.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="6" class="vacio">No hay ventas este día.</td></tr>';
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
$('#metodos').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  metodo = b.dataset.metodo;
  pintarCarrito();
};
$('#cobrar').onclick = cobrar;
$('#vaciar').onclick = () => {
  carrito.clear();
  $('#descuento').value = '';
  pintarProductos();
  pintarCarrito();
};
$('#barra-movil').onclick = () => $('.carrito').scrollIntoView({ behavior: 'smooth' });
$('#recargar').onclick = () => cargarHoy().catch((err) => aviso(err.message, true));
function abrirFila(e) {
  const tr = e.target.closest('tr[data-id]');
  const v = tr && ventasHoy.find((x) => x.id === Number(tr.dataset.id));
  if (v) mostrarTicket(v);
}
$('#tabla-hoy').onclick = abrirFila;
$('#tabla-hoy').onkeydown = (e) => e.key === 'Enter' && abrirFila(e);
$('#fecha-ventas').onchange = () => cargarHoy().catch((err) => aviso(err.message, true));
$('#anular').onclick = () => {
  $('#titulo-anular').textContent = `Anular venta N.º ${ventaEnTicket.id} · ${cop(ventaEnTicket.total)}`;
  $('#motivo-anular').value = '';
  $('#error-anular').hidden = true;
  $('#dlg-anular').showModal();
};
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

(async () => {
  yo = await iniciarSesionUi();
  await cargarCaja();
  $('#ir-admin').hidden = yo.rol !== 'ADMIN';
  iniciarPestanas((vista) => {
    const cargar = { nueva: () => Promise.all([cargarProductos(), cargarCaja()]), hoy: cargarHoy, caja: cargarVistaCaja };
    cargar[vista]().catch((err) => aviso(err.message, true));
  });
})();
