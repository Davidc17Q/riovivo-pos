// Área de ventas: armar la venta, registrarla, ver el ticket y las ventas del día.
let productos = [];
const carrito = new Map(); // productoId → cantidad
let categoria = 'Todas';
let metodo = 'EFECTIVO';

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
        return `<button type="button" class="producto" data-id="${p.id}" ${agotado ? 'disabled' : ''}>
          <b>${esc(p.nombre)}</b>
          <span class="pie"><span class="tenue chico">${nota}</span><span class="precio">${cop(p.precio)}</span></span>
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
          </span>
          <span class="num tenue chico">${cop(p.precio)} c/u</span>
        </div>`;
      }).join('')
    : '<p class="vacio">Toca un producto para agregarlo.</p>';
  const t = calcular();
  $('#subtotal').textContent = cop(t.subtotal);
  $('#valor-descuento').textContent = t.descuento ? `− ${cop(t.descuento)}` : cop(0);
  $('#total').textContent = cop(t.total);
  $('#cobrar').disabled = carrito.size === 0;
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
  await cargarProductos().catch(() => {});
}

function mostrarTicket(v) {
  $('#ticket').innerHTML = `
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
  const d = await api('GET', '/api/ventas');
  ventasHoy = d.ventas;
  $('#titulo-hoy').textContent = `Ventas de hoy · ${diaLargo(d.fecha)}`;
  $('#hoy-total').textContent = cop(d.total);
  $('#hoy-cantidad').textContent = d.ventas.length;
  $('#tabla-hoy').innerHTML = d.ventas.length
    ? d.ventas.map((v) => `<tr class="clic" data-id="${v.id}" tabindex="0">
        <td>${v.id}</td><td>${hora(v.creadaEn)}</td><td>${esc(v.usuario.nombre)}</td>
        <td>${esc(v.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', '))}</td>
        <td>${METODOS[v.metodoPago]}</td><td class="num"><b>${cop(v.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="6" class="vacio">Aún no hay ventas hoy.</td></tr>';
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
$('#recargar').onclick = () => cargarHoy().catch((err) => aviso(err.message, true));
function abrirFila(e) {
  const tr = e.target.closest('tr[data-id]');
  const v = tr && ventasHoy.find((x) => x.id === Number(tr.dataset.id));
  if (v) mostrarTicket(v);
}
$('#tabla-hoy').onclick = abrirFila;
$('#tabla-hoy').onkeydown = (e) => e.key === 'Enter' && abrirFila(e);
$('#imprimir').onclick = () => window.print();
$('#cerrar-ticket').onclick = () => $('#dlg-ticket').close();

(async () => {
  const yo = await iniciarSesionUi();
  $('#ir-admin').hidden = yo.rol !== 'ADMIN';
  iniciarPestanas((vista) => {
    (vista === 'hoy' ? cargarHoy() : cargarProductos()).catch((err) => aviso(err.message, true));
  });
})();
