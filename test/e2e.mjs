// Prueba de punta a punta contra el servidor en marcha (npm run dev) con los datos del seed.
// Uso: npm run test:e2e   (crea un producto y un vendedor de prueba y los deja inactivos)
const B = process.env.POS_URL || 'http://localhost:3100';
let fallas = 0;
const ok = (c, m, extra = '') => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m} ${extra}`); if (!c) fallas++; };
function cliente() {
  let cookie = '';
  return async (metodo, url, cuerpo) => {
    const r = await fetch(B + url, { method: metodo, redirect: 'manual',
      headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch {}
    return { s: r.status, d, t, loc: r.headers.get('location'), ct: r.headers.get('content-type') || '' };
  };
}
const anon = cliente(), admin = cliente(), caja = cliente(), otro = cliente();
ok((await anon('GET', '/api/productos')).s === 401, 'API sin sesión → 401');
ok((await admin('POST', '/api/login', { usuario: 'admin', clave: 'admin1234' })).s === 200, 'login admin');
ok((await caja('POST', '/api/login', { usuario: 'caja', clave: 'caja1234' })).s === 200, 'login vendedor');
ok((await caja('GET', '/admin')).loc === '/ventas', 'vendedor en /admin → vuelve a /ventas');
const nu = 'e2e' + Date.now();
const uOtro = (await admin('POST', '/api/usuarios', { usuario: nu, nombre: 'Vendedor E2E', clave: 'clave-e2e-123', rol: 'VENDEDOR' })).d;
await otro('POST', '/api/login', { usuario: nu, clave: 'clave-e2e-123' });

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const reporte = async () => (await admin('GET', `/api/reportes?desde=${hoy}&hasta=${hoy}`)).d;
const actual = async (c) => (await c('GET', '/api/caja/actual')).d.caja;
const deAdmin = async (id) => (await admin('GET', '/api/cajas')).d.find((c) => c.id === id);
const stockDe = async (id) => (await admin('GET', '/api/productos?todos=1')).d.find((p) => p.id === id).stock;
const vender = (c, items, metodoPago, descuento = 0) => c('POST', '/api/ventas', { items, descuento, metodoPago });

// Estado limpio: si quedó una caja abierta, se cierra.
for (const c of [caja, admin]) { const a = await actual(c); if (a) await c('POST', `/api/caja/${a.id}/cerrar`, { efectivoContado: 0 }); }

const np = (await admin('POST', '/api/productos', { nombre: 'E2E Jabón ' + nu, categoria: 'E2E ' + nu, precio: 20000, activo: true, seVende: true, controlaStock: true })).d;
await admin('POST', '/api/inventario/movimientos', { productoId: np.id, tipo: 'ENTRADA', cantidad: 10 });
// Un servicio sin control de inventario (en el catálogo real, una experiencia del spa).
const masaje = (await caja('GET', '/api/productos')).d.find((p) => !p.controlaStock && p.precio > 0 && !p.nombre.startsWith('E2E'));
const rep0 = await reporte();

console.log('— Caja —');
ok((await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO')).s === 409, 'vender sin caja abierta → 409');
ok(await stockDe(np.id) === 10, 'la venta bloqueada no tocó el stock');
ok((await caja('POST', '/api/caja/abrir', { baseInicial: -1 })).s === 400, 'base negativa → 400');
ok((await caja('POST', '/api/caja/abrir', { baseInicial: 1000.5 })).s === 400, 'base decimal → 400');
const ab = await caja('POST', '/api/caja/abrir', { baseInicial: 100000 });
ok(ab.s === 201 && ab.d.estado === 'ABIERTA' && ab.d.cuadre.base === 100000, 'abrir caja con base 100.000');
ok(ab.d.cuadre.ciego === true && ab.d.cuadre.efectivoEsperado === undefined && ab.d.cuadre.efectivo === undefined, 'cierre ciego: el vendedor no recibe el efectivo esperado');
ok((await caja('POST', '/api/caja/abrir', { baseInicial: 5 })).s === 409, 'segunda caja del mismo usuario → 409');
const dobles = await Promise.all([otro('POST', '/api/caja/abrir', { baseInicial: 0 }), otro('POST', '/api/caja/abrir', { baseInicial: 0 })]);
ok(dobles.filter((r) => r.s === 201).length === 1 && dobles.filter((r) => r.s === 409).length === 1, 'dos aperturas simultáneas → solo una caja', `(${dobles.map((r) => r.s)})`);
const cid = ab.d.id;

ok((await vender(caja, [], 'EFECTIVO')).s === 400, 'venta vacía → 400');
ok((await vender(caja, [{ productoId: np.id, cantidad: 1.5 }], 'EFECTIVO')).s === 400, 'cantidad decimal → 400');
ok((await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'BITCOIN')).s === 400, 'método inválido → 400');
ok((await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO', 999999999)).s === 400, 'descuento mayor al subtotal → 400');
ok((await vender(caja, [{ productoId: np.id, cantidad: 11 }], 'EFECTIVO')).s === 409 && await stockDe(np.id) === 10, 'vender más que el stock → 409 y nada guardado');

const v1 = await vender(caja, [{ productoId: np.id, cantidad: 2 }], 'EFECTIVO');            // 40.000
const v2 = await vender(caja, [{ productoId: masaje.id, cantidad: 1 }], 'TARJETA');          // precio del masaje
const v3 = await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'TRANSFERENCIA');        // 20.000
const v4 = await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO', 5000);       // 15.000
const M = masaje.precio;
ok([v1, v2, v3, v4].every((v) => v.s === 201 && v.d.cajaId === cid && v.d.estado === 'ACTIVA'), '4 ventas ligadas a la caja abierta');
let q = (await deAdmin(cid)).cuadre;
ok(q.efectivo === 55000 && q.tarjeta === M && q.transferencia === 20000 && q.efectivoEsperado === 155000 && q.ventas === 4, 'cuadre en vivo separado por método');
ok(await stockDe(np.id) === 6, 'stock 10 → 6');

console.log('— Anulación —');
ok((await caja('POST', `/api/ventas/${v1.d.id}/anular`, { motivo: 'Cliente se arrepintió' })).s === 403, 'vendedor no puede anular → 403');
ok((await admin('POST', `/api/ventas/${v1.d.id}/anular`, { motivo: '' })).s === 400, 'anular sin motivo → 400');
ok((await admin('POST', '/api/ventas/99999999/anular', { motivo: 'No existe esta venta' })).s === 404, 'anular venta inexistente → 404');
const an = await admin('POST', `/api/ventas/${v1.d.id}/anular`, { motivo: 'Cliente se arrepintió' });
ok(an.s === 200 && an.d.estado === 'ANULADA' && an.d.motivoAnulacion === 'Cliente se arrepintió' && an.d.anuladaPor.nombre && an.d.anuladaEn, 'admin anula: queda ANULADA con quién, cuándo y motivo');
ok(await stockDe(np.id) === 8, 'anular repuso el inventario 6 → 8');
ok((await admin('POST', `/api/ventas/${v1.d.id}/anular`, { motivo: 'Segunda vez' })).s === 409, 'anular dos veces → 409');
const dobleAn = await Promise.all([1, 2].map(() => admin('POST', `/api/ventas/${v3.d.id}/anular`, { motivo: 'Anulación simultánea' })));
ok(dobleAn.filter((r) => r.s === 200).length === 1 && await stockDe(np.id) === 9, 'dos anulaciones simultáneas → una sola, stock repuesto una vez', `(${dobleAn.map((r) => r.s)})`);
const movs = (await admin('GET', '/api/inventario/movimientos')).d.filter((m) => m.productoId === np.id);
ok(movs.filter((m) => m.tipo === 'ANULACION').length === 2 && movs[0].stockResultante === 9, 'movimientos inversos de inventario registrados');
q = (await deAdmin(cid)).cuadre;
ok(q.efectivo === 15000 && q.transferencia === 0 && q.tarjeta === M && q.efectivoEsperado === 115000 && q.ventas === 2 && q.anuladas === 2 && q.totalAnulado === 60000, 'anuladas salen del cuadre de caja');
ok((await caja('GET', '/api/ventas')).d.ventas.some((v) => v.id === v1.d.id && v.estado === 'ANULADA'), 'sigue visible como anulada en ventas del día');

console.log('— Reportes —');
const rep1 = await reporte();
ok(rep1.total === rep0.total + M + 15000 && rep1.ventas === rep0.ventas + 2, 'ingresos del reporte excluyen anuladas', `(${rep0.total} → ${rep1.total})`);
ok(rep1.anuladas.ventas === rep0.anuladas.ventas + 2 && rep1.anuladas.total === rep0.anuladas.total + 60000, 'reporte informa lo anulado aparte');
const pp = rep1.porProducto.find((p) => p.id === np.id);
ok(pp && pp.cantidad === 1 && pp.total === 20000, 'por producto: cantidad y total', JSON.stringify(pp));
const pc = rep1.porCategoria.find((c) => c.categoria === 'E2E ' + nu);
ok(pc && pc.cantidad === 1 && pc.total === 20000, 'por categoría', JSON.stringify(pc));
const yoCaja = (await caja('GET', '/api/me')).d;
const pv1 = rep1.porVendedor.find((v) => v.id === yoCaja.id), pv0 = rep0.porVendedor.find((v) => v.id === yoCaja.id) ?? { ventas: 0, total: 0 };
ok(pv1.total === pv0.total + M + 15000 && pv1.ventas === pv0.ventas + 2, 'por vendedor');
const suma = (l) => l.reduce((s, x) => s + x.total, 0);
ok(suma(rep1.porVendedor) === rep1.total && suma(rep1.porMetodo) === rep1.total && suma(rep1.porDia) === rep1.total, 'día, método y vendedor suman el mismo total');
ok(suma(rep1.porProducto) === rep1.total + rep1.descuentos && suma(rep1.porCategoria) === suma(rep1.porProducto), 'productos y categorías (antes de descuento) = total + descuentos');
ok((await caja('GET', `/api/reportes?desde=${hoy}&hasta=${hoy}`)).s === 403, 'vendedor no ve reportes → 403');
const csvRes = await admin('GET', `/api/reportes/exportar?tipo=resumen&desde=${hoy}&hasta=${hoy}`);
ok(csvRes.s === 200 && csvRes.ct.startsWith('text/csv') && csvRes.t.includes('Total vendido;'), 'exporta el resumen en CSV para Excel');
const csvDet = await admin('GET', `/api/reportes/exportar?tipo=detalle&desde=${hoy}&hasta=${hoy}`);
ok(csvDet.s === 200 && csvDet.t.split(String.fromCharCode(13, 10))[0].includes('N.º venta;Fecha;Hora') && csvDet.t.includes(';Anulada;'), 'exporta el detalle, con las anuladas marcadas');
ok((await admin('GET', `/api/reportes/exportar?tipo=otro&desde=${hoy}&hasta=${hoy}`)).s === 400, 'tipo de exportación inválido → 400');
ok((await caja('GET', `/api/reportes/exportar?tipo=detalle&desde=${hoy}&hasta=${hoy}`)).s === 403, 'vendedor no exporta reportes → 403');

console.log('— Cierre y arqueo —');
ok((await otro('POST', `/api/caja/${cid}/cerrar`, { efectivoContado: 0 })).s === 403, 'vendedor no cierra la caja de otro → 403');
ok((await otro('GET', '/api/cajas')).d.every((c) => c.usuarioId === uOtro.id), 'vendedor solo lista sus cajas');
ok((await admin('GET', '/api/cajas')).d.some((c) => c.id === cid), 'admin ve las cajas de todos');
ok((await caja('POST', `/api/caja/${cid}/cerrar`, { efectivoContado: -5 })).s === 400, 'conteo negativo → 400');
ok((await caja('POST', `/api/caja/${cid}/cerrar`, {})).s === 400, 'cerrar sin conteo → 400');
const vHoy = (await caja('GET', '/api/ventas')).d;
ok(vHoy.ciego === true && vHoy.total === undefined && vHoy.ventas.length > 0, 'cierre ciego: el vendedor no recibe el total del día');
ok(typeof (await admin('GET', '/api/ventas')).d.total === 'number', 'el admin sí recibe el total del día');
const ciV = await caja('POST', `/api/caja/${cid}/cerrar`, { efectivoContado: 110000, nota: 'Faltó un billete' });
ok(ciV.s === 200 && ciV.d.estado === 'CERRADA' && ciV.d.diferencia === undefined && ciV.d.efectivoEsperado === undefined && ciV.d.cuadre.efectivoContado === 110000,
  'cierre ciego: al cerrar el vendedor solo ve lo que declaró');
const ci = { s: ciV.s, d: await deAdmin(cid) };
ok(ci.s === 200 && ci.d.estado === 'CERRADA' && ci.d.efectivoEsperado === 115000 && ci.d.efectivoContado === 110000 && ci.d.diferencia === -5000
  && ci.d.ventasEfectivo === 15000 && ci.d.ventasTarjeta === M && ci.d.ventasTransferencia === 0 && ci.d.cerradaPor.nombre, 'cierre guardado: esperado 115.000, contado 110.000, faltante 5.000');
ok((await caja('POST', `/api/caja/${cid}/cerrar`, { efectivoContado: 1 })).s === 409, 'cerrar dos veces → 409');
ok((await vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO')).s === 409, 'vender tras el cierre → 409');
ok(await actual(caja) === null, 'ya no hay caja actual');
await admin('POST', `/api/ventas/${v2.d.id}/anular`, { motivo: 'Devolución al día siguiente' });
const tras = (await admin('GET', '/api/cajas')).d.find((c) => c.id === cid);
ok(tras.ventasTarjeta === M && tras.diferencia === -5000 && tras.cuadre.tarjeta === M && tras.cuadre.anuladasTrasCierre.ventas === 1 && tras.cuadre.anuladasTrasCierre.total === M,
  'anular tras el cierre no reescribe el cuadre guardado y queda señalado');
ok((await reporte()).total === rep0.total + 15000, 'pero sí sale de los ingresos del reporte');

console.log('— Concurrencia —');
const c2 = (await caja('POST', '/api/caja/abrir', { baseInicial: 0 })).d;
const rafaga = await Promise.all([
  ...Array.from({ length: 4 }, () => vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO')),
  caja('POST', `/api/caja/${c2.id}/cerrar`, { efectivoContado: 0 }),
  ...Array.from({ length: 4 }, () => vender(caja, [{ productoId: np.id, cantidad: 1 }], 'EFECTIVO')),
]);
const pasaron = rafaga.filter((r) => r.s === 201).length;
const enCaja = (await caja('GET', '/api/ventas')).d.ventas.filter((v) => v.cajaId === c2.id && v.estado === 'ACTIVA');
ok(rafaga[4].s === 200 && (await deAdmin(c2.id)).ventasEfectivo === suma(enCaja) && enCaja.length === pasaron,
  'cierre contra ventas simultáneas: el cuadre incluye exactamente las que entraron', `(${pasaron} ventas; estados ${rafaga.map((r) => r.s)})`);
ok(rafaga.every((r) => [200, 201, 409].includes(r.s)), 'las que no entraron fueron rechazadas, sin errores 500');
const s = await stockDe(np.id);
ok(s === 9 - pasaron && s >= 0, 'stock coherente tras la ráfaga', `(${s})`);
await caja('POST', '/api/caja/abrir', { baseInicial: 0 });
const agotar = await Promise.all(Array.from({ length: s + 3 }, () => vender(caja, [{ productoId: np.id, cantidad: 1 }], 'TARJETA')));
ok(agotar.filter((r) => r.s === 201).length === s && await stockDe(np.id) === 0, `stock ${s} y ${s + 3} ventas simultáneas → pasan ${s}; stock final 0, nunca negativo`);

console.log('— Pago mixto, vuelto y referencia —');
const unMasaje = [{ productoId: masaje.id, cantidad: 1 }];
const mixto = (pagos, extra = {}) => otro('POST', '/api/ventas', { items: unMasaje, pagos, ...extra });
ok((await mixto([{ metodo: 'EFECTIVO', monto: 1000 }])).s === 400, 'pagos que no completan el total → 400');
ok((await mixto([{ metodo: 'EFECTIVO', monto: M }, { metodo: 'TARJETA', monto: 1 }])).s === 400, 'pagos que superan el total → 400');
ok((await mixto([{ metodo: 'TARJETA', monto: 1 }, { metodo: 'TARJETA', monto: M - 1 }])).s === 400, 'método repetido en el reparto → 400');
ok((await mixto([{ metodo: 'EFECTIVO', monto: 1000 }, { metodo: 'TARJETA', monto: M - 1000 }], { recibido: 500 })).s === 400, 'efectivo recibido menor a la parte en efectivo → 400');
ok((await otro('POST', '/api/ventas', { items: unMasaje, metodoPago: 'TARJETA', recibido: M })).s === 400, '"paga con" sin efectivo → 400');
const vm = await mixto([{ metodo: 'EFECTIVO', monto: 1000 }, { metodo: 'TARJETA', monto: M - 1000 }], { recibido: 5000, referencia: '  Cabaña 3 ' });
ok(vm.s === 201 && vm.d.metodoPago === 'MIXTO' && vm.d.pagos.length === 2 && vm.d.cambio === 4000 && vm.d.recibido === 5000 && vm.d.referencia === 'Cabaña 3',
  'venta mixta con vuelto y referencia', JSON.stringify({ s: vm.s, m: vm.d?.metodoPago, c: vm.d?.cambio }));
const ve = await otro('POST', '/api/ventas', { items: unMasaje, metodoPago: 'EFECTIVO', recibido: M + 7000 });
ok(ve.s === 201 && ve.d.cambio === 7000 && ve.d.pagos.length === 1, 'efectivo simple con vuelto');
const qo = (await deAdmin((await actual(otro)).id)).cuadre;
ok(qo.efectivo === 1000 + M && qo.tarjeta === M - 1000 && qo.efectivoEsperado === 1000 + M, 'la caja reparte la venta mixta por método (el vuelto no suma)', JSON.stringify(qo));
const repM = await reporte();
ok(suma(repM.porMetodo) === repM.total, 'reporte por método cuadra con ventas mixtas');
ok((await admin('GET', `/api/reportes/exportar?tipo=detalle&desde=${hoy}&hasta=${hoy}`)).t.includes('Cabaña 3'), 'el detalle exportado incluye la referencia');

console.log('— Cuentas abiertas —');
const nc = 'E2E Cabaña ' + nu;
ok((await otro('POST', '/api/cuentas', { nombre: '  ' })).s === 400, 'cuenta sin nombre → 400');
const cu = await otro('POST', '/api/cuentas', { nombre: nc, items: [{ productoId: masaje.id, cantidad: 1 }] });
ok(cu.s === 201 && cu.d.estado === 'ABIERTA' && cu.d.total === M, 'abrir cuenta con un consumo');
ok((await caja('POST', '/api/cuentas', { nombre: nc.toUpperCase() })).s === 409, 'dos cuentas abiertas con el mismo nombre → 409');
ok((await caja('POST', `/api/cuentas/${cu.d.id}/items`, { items: [{ productoId: masaje.id, cantidad: 2 }] })).d.total === 3 * M, 'otro vendedor carga consumos a la misma cuenta');
ok((await otro('POST', `/api/cuentas/${cu.d.id}/items`, { items: [{ productoId: np.id, cantidad: 1 }] })).s === 409, 'cargar sin stock → 409');
const cuCorr = await otro('PUT', `/api/cuentas/${cu.d.id}/items/${masaje.id}`, { cantidad: 2 });
ok(cuCorr.s === 200 && cuCorr.d.total === 2 * M && cuCorr.d.items.length === 1, 'corregir la cantidad de un consumo');
ok((await caja('GET', '/api/cuentas')).d.some((c) => c.id === cu.d.id), 'la cuenta aparece entre las abiertas');
ok((await caja('POST', `/api/cuentas/${cu.d.id}/cancelar`)).s === 403, 'vendedor no cancela una cuenta con consumos → 403');
ok((await admin('POST', `/api/cuentas/${cu.d.id}/cobrar`, { metodoPago: 'EFECTIVO' })).s === 409, 'cobrar sin caja abierta → 409');
ok((await otro('POST', `/api/cuentas/${cu.d.id}/cobrar`, { pagos: [{ metodo: 'EFECTIVO', monto: 1 }] })).s === 400, 'cobrar con pagos incompletos → 400');
ok((await otro('GET', `/api/cuentas/${cu.d.id}`)).d.estado === 'ABIERTA', 'tras un cobro fallido la cuenta sigue abierta');
const cobros = await Promise.all([1, 2].map(() => otro('POST', `/api/cuentas/${cu.d.id}/cobrar`, { metodoPago: 'TARJETA' })));
const cobro = cobros.find((r) => r.s === 201);
ok(cobro && cobros.filter((r) => r.s === 409).length === 1, 'dos cobros simultáneos de la misma cuenta → solo uno', `(${cobros.map((r) => r.s)})`);
ok(cobro.d.referencia === nc && cobro.d.total === 2 * M && cobro.d.items[0].cantidad === 2 && cobro.d.metodoPago === 'TARJETA', 'la venta lleva el nombre de la cuenta y sus consumos');
const cuFin = (await otro('GET', `/api/cuentas/${cu.d.id}`)).d;
ok(cuFin.estado === 'COBRADA' && cuFin.ventaId === cobro.d.id && !(await otro('GET', '/api/cuentas')).d.some((c) => c.id === cu.d.id), 'cuenta cobrada: ligada a la venta y fuera de las abiertas');
ok((await otro('POST', `/api/cuentas/${cu.d.id}/items`, { items: [{ productoId: masaje.id, cantidad: 1 }] })).s === 409, 'cargar a una cuenta cobrada → 409');
const vacia = (await caja('POST', '/api/cuentas', { nombre: nc })).d;
ok((await caja('POST', `/api/cuentas/${vacia.id}/cobrar`, { metodoPago: 'EFECTIVO' })).s === 400, 'cobrar una cuenta vacía → 400');
ok((await caja('POST', `/api/cuentas/${vacia.id}/cancelar`)).s === 200 && (await caja('GET', `/api/cuentas/${vacia.id}`)).d.estado === 'CANCELADA', 'el vendedor cancela una cuenta vacía');

// Limpieza: cajas cerradas, producto y usuario de prueba inactivos.
for (const c of [caja, otro]) { const a = await actual(c); if (a) await c('POST', `/api/caja/${a.id}/cerrar`, { efectivoContado: 0 }); }
await admin('PUT', `/api/productos/${np.id}`, { nombre: np.nombre, categoria: np.categoria, precio: 20000, activo: false, seVende: true, controlaStock: true });
await admin('PUT', `/api/usuarios/${uOtro.id}`, { activo: false });
ok((await otro('GET', '/api/productos')).s === 401, 'usuario desactivado pierde la sesión');
console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
