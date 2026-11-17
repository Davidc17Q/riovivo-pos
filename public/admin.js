// Área de administración: productos, inventario, usuarios y reportes.
let yo = null;
let productos = [];
let usuarios = [];
let editandoId = null; // producto en edición (null = nuevo)
let movimientoDe = null; // producto del movimiento de inventario

const TIPOS = { ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', VENTA: 'Venta' };
const ROLES = { ADMIN: 'Administrador', VENDEDOR: 'Vendedor' };

/** Envía un formulario de diálogo: muestra el error dentro o cierra al terminar. */
function alEnviar(dlg, accion) {
  const error = $('.error', dlg);
  $('form', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const boton = e.submitter;
    if (boton) boton.disabled = true;
    error.hidden = true;
    try {
      await accion();
      dlg.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
    if (boton) boton.disabled = false;
  };
}
function abrir(dlg) {
  $('.error', dlg).hidden = true;
  dlg.showModal();
}
for (const b of document.querySelectorAll('[data-cerrar]')) b.onclick = () => b.closest('dialog').close();

// ---------- Productos ----------
async function cargarProductos() {
  productos = await api('GET', '/api/productos?todos=1');
  $('#tabla-productos').innerHTML = productos.length
    ? productos.map((p) => `<tr>
        <td><b>${esc(p.nombre)}</b>${p.seVende ? '' : ' <span class="etiqueta gris">Insumo</span>'}</td>
        <td>${esc(p.categoria)}</td>
        <td class="num">${cop(p.precio)}</td>
        <td>${p.controlaStock ? `${p.stock} und.` : '<span class="tenue">No lleva</span>'}</td>
        <td><span class="etiqueta ${p.activo ? '' : 'gris'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="acciones">
          <button class="btn mini" data-editar="${p.id}">Editar</button>
          <button class="btn mini peligro" data-borrar="${p.id}">Borrar</button>
        </td></tr>`).join('')
    : '<tr><td colspan="6" class="vacio">Aún no hay productos. Crea el primero.</td></tr>';
  $('#lista-categorias').innerHTML = [...new Set(productos.map((p) => p.categoria))]
    .map((c) => `<option value="${esc(c)}">`).join('');
}

function abrirProducto(p) {
  editandoId = p?.id ?? null;
  $('#titulo-producto').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#p-nombre').value = p?.nombre ?? '';
  $('#p-categoria').value = p?.categoria ?? '';
  $('#p-precio').value = p?.precio ?? '';
  $('#p-vende').checked = p?.seVende ?? true;
  $('#p-stock').checked = p?.controlaStock ?? false;
  $('#p-activo').checked = p?.activo ?? true;
  abrir($('#dlg-producto'));
}

$('#nuevo-producto').onclick = () => abrirProducto(null);
$('#tabla-productos').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.editar) return abrirProducto(productos.find((p) => p.id === Number(b.dataset.editar)));
  const p = productos.find((x) => x.id === Number(b.dataset.borrar));
  if (!p || !confirm(`¿Borrar "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api('DELETE', `/api/productos/${p.id}`);
    aviso('Producto borrado');
    await cargarProductos();
  } catch (err) {
    aviso(err.message, true);
  }
};
alEnviar($('#dlg-producto'), async () => {
  const precio = Number($('#p-precio').value);
  if (!Number.isInteger(precio) || precio < 0) throw new Error('El precio debe ser un número entero, sin decimales.');
  const datos = {
    nombre: $('#p-nombre').value,
    categoria: $('#p-categoria').value,
    precio,
    seVende: $('#p-vende').checked,
    controlaStock: $('#p-stock').checked,
    activo: $('#p-activo').checked,
  };
  if (editandoId) await api('PUT', `/api/productos/${editandoId}`, datos);
  else await api('POST', '/api/productos', datos);
  aviso('Producto guardado');
  await cargarProductos();
});

// ---------- Inventario ----------
async function cargarInventario() {
  const [, movimientos] = await Promise.all([cargarProductos(), api('GET', '/api/inventario/movimientos')]);
  const conStock = productos.filter((p) => p.controlaStock);
  $('#tabla-stock').innerHTML = conStock.length
    ? conStock.map((p) => `<tr>
        <td><b>${esc(p.nombre)}</b><br><span class="tenue chico">${esc(p.categoria)}${p.activo ? '' : ' · Inactivo'}</span></td>
        <td class="num"><b>${p.stock}</b>${p.stock <= 0 ? ' <span class="etiqueta rojo">Agotado</span>' : ''}</td>
        <td class="acciones"><button class="btn mini" data-mover="${p.id}">Registrar movimiento</button></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">Ningún producto lleva inventario. Actívalo al editar el producto.</td></tr>';
  $('#tabla-movimientos').innerHTML = movimientos.length
    ? movimientos.map((m) => `<tr>
        <td class="chico">${esc(fechaHora(m.creadoEn))}<br><span class="tenue">${esc(m.usuario.nombre)}</span></td>
        <td>${esc(m.producto.nombre)}${m.nota ? `<br><span class="tenue chico">${esc(m.nota)}</span>` : ''}${m.ventaId ? `<br><span class="tenue chico">Venta N.º ${m.ventaId}</span>` : ''}</td>
        <td>${TIPOS[m.tipo]}</td>
        <td class="num">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td class="num">${m.stockResultante}</td></tr>`).join('')
    : '<tr><td colspan="5" class="vacio">Sin movimientos todavía.</td></tr>';
}

function etiquetaCantidad() {
  $('#m-etiqueta').textContent = $('#m-tipo').value === 'AJUSTE' ? 'Stock real contado' : 'Unidades';
}
$('#m-tipo').onchange = etiquetaCantidad;
$('#tabla-stock').onclick = (e) => {
  const b = e.target.closest('button[data-mover]');
  if (!b) return;
  movimientoDe = productos.find((p) => p.id === Number(b.dataset.mover));
  $('#titulo-movimiento').textContent = `${movimientoDe.nombre} · stock ${movimientoDe.stock}`;
  $('#m-tipo').value = 'ENTRADA';
  $('#m-cantidad').value = '';
  $('#m-nota').value = '';
  etiquetaCantidad();
  abrir($('#dlg-movimiento'));
};
alEnviar($('#dlg-movimiento'), async () => {
  const cantidad = Number($('#m-cantidad').value);
  if (!Number.isInteger(cantidad)) throw new Error('La cantidad debe ser un número entero.');
  await api('POST', '/api/inventario/movimientos', {
    productoId: movimientoDe.id,
    tipo: $('#m-tipo').value,
    cantidad,
    nota: $('#m-nota').value.trim(),
  });
  aviso('Movimiento registrado');
  await cargarInventario();
});

// ---------- Usuarios ----------
async function cargarUsuarios() {
  usuarios = await api('GET', '/api/usuarios');
  $('#tabla-usuarios').innerHTML = usuarios.map((u) => `<tr>
      <td><b>${esc(u.nombre)}</b></td><td>${esc(u.usuario)}</td><td>${ROLES[u.rol]}</td>
      <td><span class="etiqueta ${u.activo ? '' : 'gris'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="acciones">${u.id === yo.id
        ? '<span class="tenue chico">Tu usuario</span>'
        : `<button class="btn mini" data-usuario="${u.id}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('');
}
$('#nuevo-usuario').onclick = () => {
  $('#form-usuario').reset();
  abrir($('#dlg-usuario'));
};
$('#tabla-usuarios').onclick = async (e) => {
  const b = e.target.closest('button[data-usuario]');
  const u = b && usuarios.find((x) => x.id === Number(b.dataset.usuario));
  if (!u) return;
  try {
    await api('PUT', `/api/usuarios/${u.id}`, { activo: !u.activo });
    await cargarUsuarios();
  } catch (err) {
    aviso(err.message, true);
  }
};
alEnviar($('#dlg-usuario'), async () => {
  await api('POST', '/api/usuarios', {
    nombre: $('#u-nombre').value,
    usuario: $('#u-usuario').value,
    clave: $('#u-clave').value,
    rol: $('#u-rol').value,
  });
  aviso('Usuario creado');
  await cargarUsuarios();
});

// ---------- Reportes ----------
async function cargarReporte() {
  const r = await api('GET', `/api/reportes?desde=${$('#desde').value}&hasta=${$('#hasta').value}`);
  $('#rep-total').textContent = cop(r.total);
  $('#rep-ventas').textContent = r.ventas;
  $('#rep-descuentos').textContent = cop(r.descuentos);
  $('#rep-dias').innerHTML = r.porDia.length
    ? r.porDia.map((d) => `<tr><td>${esc(diaLargo(d.dia))}</td><td class="num">${d.ventas}</td><td class="num"><b>${cop(d.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">No hubo ventas en este rango.</td></tr>';
  $('#rep-metodos').innerHTML = r.porMetodo.length
    ? r.porMetodo.map((m) => `<tr><td>${METODOS[m.metodo]}</td><td class="num">${m.ventas}</td><td class="num"><b>${cop(m.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">No hubo ventas en este rango.</td></tr>';
}
$('#form-reporte').onsubmit = (e) => {
  e.preventDefault();
  cargarReporte().catch((err) => aviso(err.message, true));
};

(async () => {
  yo = await iniciarSesionUi();
  // Por defecto: del primer día del mes hasta hoy.
  $('#hasta').value = hoyIso();
  $('#desde').value = `${hoyIso().slice(0, 8)}01`;
  const cargar = { productos: cargarProductos, inventario: cargarInventario, usuarios: cargarUsuarios, reportes: cargarReporte };
  iniciarPestanas((vista) => cargar[vista]().catch((err) => aviso(err.message, true)));
})();
