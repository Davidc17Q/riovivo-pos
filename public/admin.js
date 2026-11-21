// Área de administración: productos, inventario, usuarios y reportes.
let yo = null;
let productos = [];
let usuarios = [];
let editandoId = null; // producto en edición (null = nuevo)
let movimientoDe = null; // producto del movimiento de inventario

const TIPOS = { ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', VENTA: 'Venta', ANULACION: 'Anulación' };
const ROLES = { ADMIN: 'Administrador', VENDEDOR: 'Vendedor', COCINA: 'Cocina y bar' };
const ESTACIONES = { COCINA: 'Cocina', BAR: 'Bar' };

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
  pintarProductos();
  $('#lista-categorias').innerHTML = [...new Set(productos.map((p) => p.categoria))]
    .map((c) => `<option value="${esc(c)}">`).join('');
}

function pintarProductos() {
  const q = $('#buscar-producto').value.trim().toLowerCase();
  const lista = productos.filter((p) => !q || `${p.nombre} ${p.categoria}`.toLowerCase().includes(q));
  $('#tabla-productos').innerHTML = lista.length
    ? lista.map((p) => `<tr>
        <td><b>${esc(p.nombre)}</b>${p.seVende ? '' : ' <span class="etiqueta gris">Insumo</span>'}${ESTACIONES[p.estacion] ? ` <span class="etiqueta">${ESTACIONES[p.estacion]}</span>` : ''}</td>
        <td>${esc(p.categoria)}</td>
        <td class="num">${cop(p.precio)}</td>
        <td>${p.controlaStock ? `${p.stock} und.` : '<span class="tenue">No lleva</span>'}</td>
        <td><span class="etiqueta ${p.activo ? '' : 'gris'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="acciones">
          <button class="btn mini" data-editar="${p.id}">Editar</button>
          <button class="btn mini peligro" data-borrar="${p.id}">Borrar</button>
        </td></tr>`).join('')
    : `<tr><td colspan="6" class="vacio">${productos.length ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos. Crea el primero.'}</td></tr>`;
}
$('#buscar-producto').oninput = pintarProductos;

function abrirProducto(p) {
  editandoId = p?.id ?? null;
  $('#titulo-producto').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#p-nombre').value = p?.nombre ?? '';
  $('#p-categoria').value = p?.categoria ?? '';
  $('#p-precio').value = p?.precio ?? '';
  $('#p-vende').checked = p?.seVende ?? true;
  $('#p-stock').checked = p?.controlaStock ?? false;
  $('#p-estacion').value = p?.estacion ?? 'NINGUNA';
  $('#p-activo').checked = p?.activo ?? true;
  abrir($('#dlg-producto'));
}

$('#nuevo-producto').onclick = () => abrirProducto(null);
$('#tabla-productos').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.editar) return abrirProducto(productos.find((p) => p.id === Number(b.dataset.editar)));
  const p = productos.find((x) => x.id === Number(b.dataset.borrar));
  if (!p || !(await confirmar(`¿Borrar "${p.nombre}"? Esta acción no se puede deshacer.`, 'Borrar'))) return;
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
    estacion: $('#p-estacion').value,
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

// ---------- Cajas ----------
let cajas = [];
let cajaACerrar = null;
async function cargarCajas() {
  cajas = await api('GET', '/api/cajas');
  $('#tabla-cajas').innerHTML = filasCajas(cajas, true);
}
$('#tabla-cajas').onclick = (e) => {
  const cerrar = e.target.closest('[data-cerrar-caja]');
  const fila = e.target.closest('tr[data-caja]');
  const c = fila && cajas.find((x) => x.id === Number(fila.dataset.caja));
  if (!c) return;
  if (!cerrar) {
    $('#ticket').innerHTML = htmlCuadre(c);
    return $('#dlg-ticket').showModal();
  }
  cajaACerrar = c;
  $('#titulo-cierre').textContent = `Cerrar caja N.º ${c.id} · ${c.usuario.nombre}`;
  $('#esperado-cierre').textContent = `Efectivo esperado: ${cop(c.cuadre.efectivoEsperado)} (base ${cop(c.cuadre.base)} + ventas en efectivo ${cop(c.cuadre.efectivo)}).`;
  $('#form-cierre').reset();
  abrir($('#dlg-cierre'));
};
$('#imprimir').onclick = () => window.print();
alEnviar($('#dlg-cierre'), async () => {
  const efectivoContado = Number($('#c-contado').value);
  if (!Number.isInteger(efectivoContado) || efectivoContado < 0) throw new Error('El efectivo contado debe ser un número entero.');
  const cerrada = await api('POST', `/api/caja/${cajaACerrar.id}/cerrar`, { efectivoContado, nota: $('#c-nota').value.trim() });
  await cargarCajas();
  $('#ticket').innerHTML = htmlCuadre(cerrada);
  $('#dlg-ticket').showModal();
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
  if (u.activo && !(await confirmar(`¿Desactivar a ${u.nombre}? No podrá ingresar hasta que lo actives de nuevo.`, 'Desactivar'))) return;
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
  const rango = `desde=${$('#desde').value}&hasta=${$('#hasta').value}`;
  const r = await api('GET', `/api/reportes?${rango}`);
  // La exportación usa exactamente el rango que se está viendo.
  $('#exportar-resumen').href = `/api/reportes/exportar?tipo=resumen&${rango}`;
  $('#exportar-detalle').href = `/api/reportes/exportar?tipo=detalle&${rango}`;
  $('#rep-total').textContent = cop(r.total);
  $('#rep-ventas').textContent = r.ventas;
  $('#rep-descuentos').textContent = cop(r.descuentos);
  $('#rep-anuladas').textContent = `${r.anuladas.ventas} · ${cop(r.anuladas.total)}`;
  // Barra por día relativa al mejor día; por método, a su parte del total.
  const mejorDia = Math.max(1, ...r.porDia.map((d) => d.total));
  const medidor = (parte, todo) => `<div class="medidor"><i style="width:${Math.round((parte / todo) * 100)}%"></i></div>`;
  $('#rep-dias').innerHTML = r.porDia.length
    ? r.porDia.map((d) => `<tr><td>${esc(diaLargo(d.dia))}${medidor(d.total, mejorDia)}</td><td class="num">${d.ventas}</td><td class="num"><b>${cop(d.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">No hubo ventas en este rango.</td></tr>';
  $('#rep-metodos').innerHTML = r.porMetodo.length
    ? r.porMetodo.map((m) => `<tr><td>${METODOS[m.metodo]} <span class="tenue chico">· ${Math.round((m.total / Math.max(1, r.total)) * 100)} %</span>${medidor(m.total, Math.max(1, r.total))}</td><td class="num">${m.ventas}</td><td class="num"><b>${cop(m.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">No hubo ventas en este rango.</td></tr>';
  $('#rep-productos').innerHTML = ranking(r.porProducto, (p) => `${esc(p.nombre)}<br><span class="tenue chico">${esc(p.categoria)}</span>`, (p) => p.cantidad);
  $('#rep-categorias').innerHTML = ranking(r.porCategoria, (c) => esc(c.categoria), (c) => c.cantidad);
  $('#rep-vendedores').innerHTML = ranking(r.porVendedor, (v) => esc(v.nombre), (v) => v.ventas);
}

/** Tabla ordenada de mayor a menor, con barra relativa al primero. */
function ranking(filas, nombre, cantidad) {
  const tope = Math.max(1, ...filas.map((f) => f.total));
  return filas.length
    ? filas.map((f) => `<tr><td>${nombre(f)}<div class="medidor"><i style="width:${Math.round((f.total / tope) * 100)}%"></i></div></td><td class="num">${cantidad(f)}</td><td class="num"><b>${cop(f.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="3" class="vacio">No hubo ventas en este rango.</td></tr>';
}

function rangoRapido(nombre) {
  const hoy = hoyIso();
  const rangos = {
    hoy: [hoy, hoy],
    ayer: [sumarDias(hoy, -1), sumarDias(hoy, -1)],
    semana: [sumarDias(hoy, -6), hoy],
    mes: [`${hoy.slice(0, 8)}01`, hoy],
  };
  [$('#desde').value, $('#hasta').value] = rangos[nombre];
  marcarRango(nombre);
}
function marcarRango(nombre) {
  for (const b of document.querySelectorAll('#rangos button')) b.setAttribute('aria-pressed', b.dataset.rango === nombre);
}
$('#rangos').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  rangoRapido(b.dataset.rango);
  cargarReporte().catch((err) => aviso(err.message, true));
};
$('#desde').onchange = $('#hasta').onchange = () => marcarRango(null);
$('#form-reporte').onsubmit = (e) => {
  e.preventDefault();
  cargarReporte().catch((err) => aviso(err.message, true));
};

// ---------- Ajustes ----------
function pintarPrevia() {
  const url = $('#a-resena-url').value.trim();
  const previa = htmlResena({ resenaUrl: url, resenaTexto: $('#a-resena-texto').value.trim() || '¿Cómo te fue? Escanea y califica tu experiencia' });
  $('#previa-resena').innerHTML = previa || '<p class="vacio">Sin enlace: el ticket no lleva QR.</p>';
}
async function cargarAjustes() {
  const a = await api('GET', '/api/ajustes');
  $('#a-resena-url').value = a.resenaUrl ?? '';
  $('#a-resena-texto').value = a.resenaTexto;
  $('#a-noche').value = a.domicilioNocheDesde;
  $('#error-ajustes').hidden = true;
  pintarPrevia();
}
$('#a-resena-url').oninput = pintarPrevia;
$('#a-resena-texto').oninput = pintarPrevia;
$('#form-ajustes').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('PUT', '/api/ajustes', { resenaUrl: $('#a-resena-url').value.trim(), resenaTexto: $('#a-resena-texto').value.trim(), domicilioNocheDesde: $('#a-noche').value });
    $('#error-ajustes').hidden = true;
    aviso('Ajustes guardados');
    await cargarAjustes();
  } catch (err) {
    $('#error-ajustes').textContent = err.message;
    $('#error-ajustes').hidden = false;
  }
};

(async () => {
  yo = await iniciarSesionUi();
  rangoRapido('mes');
  const cargar = { productos: cargarProductos, inventario: cargarInventario, cajas: cargarCajas, usuarios: cargarUsuarios, reportes: cargarReporte, ajustes: cargarAjustes };
  iniciarPestanas((vista) => cargar[vista]().catch((err) => aviso(err.message, true)));
})();
