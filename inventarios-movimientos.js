// Plus Dental — Inventarios (fase 2): Compras de productos (ingreso a bodega) y Movimiento Kardex (existencias,
// entradas, salidas y saldo). Las ventas salen del detalle de Cobros y pagos (cuentas.js). Compras, ventas y ajustes
// se graban con funciones de Supabase que crean el movimiento del kardex; todo en la sede del usuario.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admInvCompras') || !document.getElementById('admInvKardex') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var DOCS = [['factura', 'Factura'], ['recibo', 'Recibo'], ['nota_envio', 'Nota de envío'], ['otro', 'Otro']];
  var ORIGENES = { compra: 'Compra', venta: 'Venta', ajuste: 'Ajuste', anulacion_compra: 'Anulación de compra', anulacion_venta: 'Anulación de venta' };
  var proveedores = [], bodegas = [], productos = [], compras = [], items = [], existencias = [], kardex = [];
  var compraSel = null, prodSel = null, lineas = [], filtroCompra = 'registrada';

  function $(id) { return document.getElementById(id); }
  function num(n, d) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function q(n) { return n == null || n === '' ? '—' : 'Q' + num(n); }
  function cant(n) { var v = Number(n || 0); return v % 1 ? num(v) : num(v, 0); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  function sede(x) { return window.PD_SEDES && x.localidad_id ? window.PD_SEDES.texto(x.localidad_id) : '—'; }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/inv_(compras|movimientos|kardex|existencias)|registrar_compra|registrar_ajuste|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Compras y Kardex.';
    return G.traducir(err);
  }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function porId(lista, id) { return lista.filter(function (x) { return x.id === id; })[0]; }
  function nombreProv(id) { var p = porId(proveedores, id); return p ? p.nombre_comercial : '—'; }
  function nombreBod(id) { var b = porId(bodegas, id); return b ? b.nombre : '—'; }
  function etiquetaProd(p) { return (p.codigo ? p.codigo + ' · ' : '') + p.nombre + (p.presentacion ? ' (' + p.presentacion + ')' : ''); }
  function imagen(p, tam) { return window.PD_INV ? window.PD_INV.imagenProducto(p, tam) : ''; }
  function existencia(prodId, bodId) {
    return existencias.filter(function (x) { return x.producto_id === prodId && (!bodId || x.bodega_id === bodId); }).reduce(function (s, x) { return s + Number(x.existencia || 0); }, 0);
  }
  function bodegaGeneral() {
    var mi = window.PD_SEDES && window.PD_SEDES.miLocalidad();
    var l = bodegas.filter(function (b) { return b.estado === 'activo' && b.tipo === 'general'; });
    return (l.filter(function (b) { return b.localidad_id === mi; })[0] || l[0] || bodegas[0] || {}).id || null;
  }
  function opcionesBodega(sel) {
    return bodegas.filter(function (b) { return b.estado !== 'baja' || b.id === sel; }).map(function (b) {
      return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc((b.numero ? b.numero + ' · ' : '') + b.nombre + (b.tipo === 'sub' ? ' (sub-bodega)' : '')) + '</option>';
    }).join('');
  }
  async function cargarCatalogos() {
    if (window.PD_SEDES) await window.PD_SEDES.cargar();
    var r = await Promise.all([
      todas(function () { return sb.from('inv_proveedores').select('id,numero,nombre_comercial,dias_credito,estado,padre_id').order('numero'); }),
      todas(function () { return sb.from('inv_bodegas').select('id,numero,nombre,tipo,estado,localidad_id').order('numero'); }),
      todas(function () { return sb.from('inv_productos').select('id,numero,codigo,nombre,presentacion,unidad,tipo_producto,clasificacion,costo,minimo,control_minimo,foto,estado,localidad_id').order('numero'); })
    ]);
    proveedores = r[0]; bodegas = r[1]; productos = r[2];
    $('invProdOpciones').innerHTML = productos.filter(function (p) { return p.estado === 'activo'; }).map(function (p) { return '<option value="' + esc(etiquetaProd(p)) + '"></option>'; }).join('');
  }
  async function cargarExistencias() {
    existencias = await todas(function () { return sb.from('inv_existencias').select('producto_id,bodega_id,existencia,ultimo_movimiento'); });
  }

  // ================= 6. Compras de productos =================
  $('admInvCompras').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Compras de productos</h3>' +
    '<button type="button" id="icNueva" class="adm-btn adm-primary">Nueva compra</button></div>' +
    '<p class="dlg-msg">Cada compra ingresa los productos a la bodega elegida (entrada en el kardex) y actualiza el último costo del producto. Se graba en tu organización y localidad.</p>' +
    '<form id="icForm" class="inv-compra" hidden novalidate>' +
    '<div class="inv-compra-enc">' +
    '<label>Proveedor<select id="icProv" class="adm-input"></select></label>' +
    '<label>Bodega de ingreso<select id="icBodega" class="adm-input" required></select></label>' +
    '<label>Fecha<input id="icFecha" type="date" class="adm-input" required></label>' +
    '<label>Documento<select id="icTipoDoc" class="adm-input">' + DOCS.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join('') + '</select></label>' +
    '<label>Serie<input id="icSerie" class="adm-input" maxlength="20"></label>' +
    '<label>Número<input id="icNumero" class="adm-input" maxlength="40"></label>' +
    '<label>Días de crédito<input id="icCredito" type="number" min="0" max="365" class="adm-input" value="0"></label>' +
    '<label class="full">Observaciones<input id="icObs" class="adm-input" maxlength="500"></label></div>' +
    '<div class="roles-wrap"><table class="pr-tabla inv-lineas"><thead><tr><th>#</th><th>Producto</th><th class="num">Existencia</th><th class="num">Cantidad</th><th class="num">Costo unitario (Q)</th><th>Lote</th><th>Vence</th><th class="num">Subtotal</th><th></th></tr></thead>' +
    '<tbody id="icLineas"></tbody><tfoot><tr><td colspan="7"><button type="button" id="icAgregar" class="adm-btn geo-mini">+ Agregar producto</button></td><td class="num"><b id="icTotal">Q0.00</b></td><td></td></tr></tfoot></table></div>' +
    '<div class="inv-compra-pie"><button type="submit" class="adm-btn adm-primary">Grabar compra</button><button type="button" id="icCancelar" class="adm-btn">Cancelar</button><span id="icFormMsg" class="dlg-msg" role="status"></span></div></form>' +
    '<div class="inv-barra"><input id="icBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar proveedor, documento o producto" aria-label="Buscar compra">' +
    '<div class="inv-filtros" id="icFiltro">' + [['registrada', 'Registradas'], ['anulada', 'Anuladas'], ['todas', 'Todas']].map(function (o) { return '<button type="button" class="adm-btn geo-mini" data-valor="' + o[0] + '" aria-pressed="' + (o[0] === filtroCompra) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
    '<section class="geo-panel"><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Bodega</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody id="icLista"></tbody></table></div></section>' +
    '<div id="icFicha" class="org-ficha" hidden></div>' +
    '<p id="icMsg" class="dlg-msg" role="status"></p></div>' +
    '<datalist id="invProdOpciones"></datalist>';

  function documento(c) { return (DOCS.filter(function (d) { return d[0] === c.tipo_documento; })[0] || ['', c.tipo_documento])[1] + (c.serie || c.numero_documento ? ' ' + [c.serie, c.numero_documento].filter(Boolean).join('-') : ''); }
  function pintarCompras() {
    var t = norm($('icBuscar').value);
    var l = compras.filter(function (c) {
      if (filtroCompra !== 'todas' && c.estado !== filtroCompra) return false;
      if (!t) return true;
      var nombres = items.filter(function (i) { return i.compra_id === c.id; }).map(function (i) { var p = porId(productos, i.producto_id); return p ? etiquetaProd(p) : ''; });
      return norm([c.numero, nombreProv(c.proveedor_id), documento(c), c.observaciones].concat(nombres).join(' ')).indexOf(t) >= 0;
    });
    $('icLista').innerHTML = l.length ? l.map(function (c) {
      return '<tr data-compra="' + c.id + '" tabindex="0" class="' + (c.id === compraSel ? 'geo-sel' : '') + '"><td>' + c.numero + '</td><td>' + fecha(c.fecha) + '</td><td>' + esc(nombreProv(c.proveedor_id)) + '</td><td>' + esc(documento(c)) + '</td><td>' + esc(nombreBod(c.bodega_id)) + '</td>' +
        '<td class="num"><b>' + q(c.total) + '</b></td><td><span class="estado estado-' + (c.estado === 'anulada' ? 'baja' : 'activo') + '">' + (c.estado === 'anulada' ? 'Anulada' : 'Registrada') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="7" class="geo-vacia">' + (compras.length ? 'Ninguna compra coincide.' : 'Aún no hay compras. Usa «Nueva compra» para ingresar productos a la bodega.') + '</td></tr>';
    pintarFichaCompra();
  }
  function pintarFichaCompra() {
    var c = porId(compras, compraSel);
    $('icFicha').hidden = !c;
    if (!c) return;
    var det = items.filter(function (i) { return i.compra_id === c.id; }).sort(function (a, b) { return a.linea - b.linea; });
    $('icFicha').innerHTML = '<h4 class="geo-h">Compra N.º ' + c.numero + ' · ' + esc(nombreProv(c.proveedor_id)) + '</h4>' +
      '<div class="org-datos">' + [['Fecha', fecha(c.fecha)], ['Documento', documento(c)], ['Bodega', nombreBod(c.bodega_id)], ['Crédito', +c.dias_credito ? c.dias_credito + ' días' : 'Contado'], ['Observaciones', c.observaciones || '—']].map(function (d) {
        return '<div class="geo-info"><span>' + d[0] + '</span><b>' + esc(d[1]) + '</b></div>'; }).join('') + '</div>' +
      '<div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>#</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo unitario</th><th>Lote</th><th>Vence</th><th class="num">Subtotal</th></tr></thead><tbody>' +
      det.map(function (i) { var p = porId(productos, i.producto_id) || { nombre: 'Producto ' + i.producto_id }; return '<tr><td>' + i.linea + '</td><td><div class="inv-prod">' + imagen(p, 30) + '<div><b>' + esc(etiquetaProd(p)) + '</b></div></div></td><td class="num">' + cant(i.cantidad) + '</td><td class="num">' + q(i.costo_unitario) + '</td><td>' + esc(i.lote || '—') + '</td><td>' + fecha(i.vencimiento) + '</td><td class="num">' + q(i.subtotal) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="6" class="num">Total</td><td class="num"><b>' + q(c.total) + '</b></td></tr></tfoot></table></div>' +
      (c.estado === 'anulada' ? '<p class="inv-anulada">Anulada por <b>' + esc(c.anulado_por || '—') + '</b> el <b>' + fechaHora(c.anulado_en) + '</b> · ' + esc(c.anulado_motivo || '') + '</p>' : '') +
      '<div class="org-registro"><div class="org-reg-datos"><span>N.º <b>' + c.numero + '</b></span><span>Sede <b>' + esc(sede(c)) + '</b></span>' +
      '<span>Grabado por <b>' + esc(c.creado_por || 'Sin usuario') + '</b> el <b>' + fechaHora(c.creado) + '</b></span></div>' +
      '<div class="org-reg-btns">' + (c.estado === 'registrada' && window.PD_SEDES && window.PD_SEDES.esSuper() ? '<button type="button" class="adm-btn geo-mini" id="icAnular">Anular compra</button>' : '') +
      '<button type="button" class="adm-btn geo-mini" id="icActualizar">Actualizar</button></div></div>';
  }
  async function cargarCompras() {
    aviso('icMsg', '');
    try {
      await cargarCatalogos();
      compras = await todas(function () { return sb.from('inv_compras').select('*').order('numero', { ascending: false }); });
      items = await todas(function () { return sb.from('inv_compra_items').select('*'); });
      await cargarExistencias();
    } catch (e) { compras = []; items = []; $('icLista').innerHTML = ''; aviso('icMsg', traducir(e), true); return; }
    pintarCompras();
  }

  // --- Formulario de compra nueva ---
  function lineaNueva() { return { producto_id: null, texto: '', cantidad: '', costo_unitario: '', lote: '', vencimiento: '' }; }
  function pintarLineas() {
    var bod = +$('icBodega').value || null;
    $('icLineas').innerHTML = lineas.map(function (l, k) {
      var sub = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0);
      return '<tr data-linea="' + k + '"><td>' + (k + 1) + '</td>' +
        '<td><input data-cl="texto" class="adm-input inv-prod-input" list="invProdOpciones" value="' + esc(l.texto) + '" placeholder="Código o nombre del producto" aria-label="Producto de la línea ' + (k + 1) + '"></td>' +
        '<td class="num inv-exist">' + (l.producto_id ? cant(existencia(l.producto_id, bod)) : '—') + '</td>' +
        '<td class="num"><input data-cl="cantidad" type="number" min="0" step="0.01" class="adm-input" value="' + esc(l.cantidad) + '" aria-label="Cantidad de la línea ' + (k + 1) + '"></td>' +
        '<td class="num"><input data-cl="costo_unitario" type="number" min="0" step="0.01" class="adm-input" value="' + esc(l.costo_unitario) + '" aria-label="Costo unitario de la línea ' + (k + 1) + '"></td>' +
        '<td><input data-cl="lote" class="adm-input" maxlength="40" value="' + esc(l.lote) + '" aria-label="Lote de la línea ' + (k + 1) + '"></td>' +
        '<td><input data-cl="vencimiento" type="date" class="adm-input" value="' + esc(l.vencimiento) + '" aria-label="Vencimiento de la línea ' + (k + 1) + '"></td>' +
        '<td class="num inv-sub-linea">' + q(sub) + '</td>' +
        '<td>' + (lineas.length > 1 ? '<button type="button" class="adm-btn geo-mini" data-quitar="' + k + '">Quitar</button>' : '') + '</td></tr>';
    }).join('');
    totalCompra();
  }
  function totalCompra() {
    var t = lineas.reduce(function (s, l) { return s + Math.round((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0) * 100) / 100; }, 0);
    $('icTotal').textContent = q(t);
    return t;
  }
  async function abrirFormulario() {
    try { await cargarCatalogos(); await cargarExistencias(); } catch (e) { aviso('icMsg', traducir(e), true); return; }
    $('icProv').innerHTML = '<option value="">Sin proveedor</option>' + proveedores.filter(function (p) { return p.estado === 'activo'; }).map(function (p) {
      return '<option value="' + p.id + '">' + esc((p.padre_id ? '   › ' : '') + p.nombre_comercial) + '</option>'; }).join('');
    $('icBodega').innerHTML = opcionesBodega(bodegaGeneral());
    $('icFecha').value = hoy(); $('icTipoDoc').value = 'factura';
    ['icSerie', 'icNumero', 'icObs'].forEach(function (i) { $(i).value = ''; });
    $('icCredito').value = 0;
    lineas = [lineaNueva()];
    pintarLineas();
    aviso('icFormMsg', '');
    $('icForm').hidden = false;
    $('icProv').focus();
  }
  $('icNueva').addEventListener('click', abrirFormulario);
  $('icCancelar').addEventListener('click', function () { $('icForm').hidden = true; });
  $('icProv').addEventListener('change', function () { var p = porId(proveedores, +this.value); $('icCredito').value = p ? p.dias_credito || 0 : 0; });
  $('icBodega').addEventListener('change', pintarLineas);
  $('icAgregar').addEventListener('click', function () {
    lineas.push(lineaNueva()); pintarLineas();
    var i = $('icLineas').querySelectorAll('.inv-prod-input'); i[i.length - 1].focus();
  });
  $('icLineas').addEventListener('input', function (e) {
    var tr = e.target.closest('tr[data-linea]'), c = e.target.dataset.cl;
    if (!tr || !c) return;
    var l = lineas[+tr.dataset.linea];
    l[c] = e.target.value;
    if (c === 'texto') {
      var p = productos.filter(function (x) { return etiquetaProd(x) === e.target.value; })[0];
      l.producto_id = p ? p.id : null;
      if (p && l.costo_unitario === '' && p.costo != null) { l.costo_unitario = String(p.costo); tr.querySelector('[data-cl="costo_unitario"]').value = l.costo_unitario; }
      if (p && l.cantidad === '') { l.cantidad = '1'; tr.querySelector('[data-cl="cantidad"]').value = '1'; }
      tr.querySelector('.inv-exist').textContent = p ? cant(existencia(p.id, +$('icBodega').value || null)) : '—';
    }
    tr.querySelector('.inv-sub-linea').textContent = q((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0));
    totalCompra();
  });
  $('icLineas').addEventListener('click', function (e) { var b = e.target.closest('[data-quitar]'); if (b) { lineas.splice(+b.dataset.quitar, 1); pintarLineas(); } });
  $('icForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var usadas = lineas.filter(function (l) { return l.texto || l.cantidad || l.costo_unitario; });
    if (!$('icBodega').value) { aviso('icFormMsg', 'Elige la bodega de ingreso.', true); return; }
    if (!usadas.length) { aviso('icFormMsg', 'Agrega al menos un producto.', true); return; }
    if (usadas.some(function (l) { return !l.producto_id; })) { aviso('icFormMsg', 'Elige cada producto de la lista (escribe el código o el nombre y selecciónalo).', true); return; }
    if (usadas.some(function (l) { return !(Number(l.cantidad) > 0); })) { aviso('icFormMsg', 'La cantidad de cada producto debe ser mayor que cero.', true); return; }
    var datos = { proveedor_id: $('icProv').value, bodega_id: $('icBodega').value, fecha: $('icFecha').value || hoy(), tipo_documento: $('icTipoDoc').value,
      serie: $('icSerie').value.trim(), numero_documento: $('icNumero').value.trim(), dias_credito: $('icCredito').value || 0, observaciones: $('icObs').value.trim() };
    var det = usadas.map(function (l) { return { producto_id: l.producto_id, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) || 0, lote: l.lote.trim(), vencimiento: l.vencimiento }; });
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true; aviso('icFormMsg', 'Grabando…');
    var r = await sb.rpc('registrar_compra', { p_datos: datos, p_items: det });
    boton.disabled = false;
    if (r.error) { aviso('icFormMsg', traducir(r.error), true); return; }
    $('icForm').hidden = true;
    compraSel = r.data; filtroCompra = 'registrada';
    $('icFiltro').querySelectorAll('[data-valor]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.valor === filtroCompra); });
    await cargarCompras();
    var c = porId(compras, compraSel);
    aviso('icMsg', 'Compra' + (c ? ' N.º ' + c.numero : '') + ' grabada. Los productos ya ingresaron a ' + nombreBod(+datos.bodega_id) + '.');
  });
  $('icBuscar').addEventListener('input', pintarCompras);
  $('icFiltro').addEventListener('click', function (e) {
    var b = e.target.closest('[data-valor]'); if (!b) return;
    filtroCompra = b.dataset.valor;
    this.querySelectorAll('[data-valor]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    pintarCompras();
  });
  $('icLista').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-compra]'); if (tr) { compraSel = +tr.dataset.compra; pintarCompras(); } });
  $('icLista').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-compra]')) e.target.click(); });
  $('icFicha').addEventListener('click', function (e) {
    if (e.target.id === 'icActualizar') { cargarCompras(); return; }
    if (e.target.id !== 'icAnular') return;
    var c = porId(compras, compraSel);
    G.dialogo({
      eyebrow: 'Compras de productos', titulo: 'Anular la compra N.º ' + c.numero, valores: {},
      campos: [{ k: 'aviso', label: 'Efecto', tipo: 'info', ancho: 'full' }, { k: 'motivo', label: 'Motivo de la anulación', tipo: 'textarea', req: true, max: 300 }],
      alAbrir: function () { $('geoF_aviso').textContent = 'Los productos de esta compra saldrán de ' + nombreBod(c.bodega_id) + ' (salida en el kardex). No se puede deshacer.'; },
      guardar: async function (d) {
        var r = await sb.rpc('anular_compra', { p_id: c.id, p_motivo: d.motivo });
        if (r.error) return traducir(r.error);
        await cargarCompras(); aviso('icMsg', 'Compra N.º ' + c.numero + ' anulada.'); return null;
      }
    });
  });

  // ================= 7. Movimiento Kardex =================
  $('admInvKardex').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Movimiento Kardex</h3>' +
    '<button type="button" id="ikAjuste" class="adm-btn">Ajuste de inventario</button></div>' +
    '<p class="dlg-msg">Existencia de cada producto por bodega. Toca un producto para ver sus entradas (compras, anulaciones de venta, ajustes) y salidas (ventas de Cobros y pagos, anulaciones de compra, ajustes) con el saldo.</p>' +
    '<div class="inv-barra"><label class="inv-bod-sel">Bodega <select id="ikBodega" class="adm-input"></select></label>' +
    '<input id="ikBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar producto" aria-label="Buscar producto">' +
    '<div class="inv-filtros" id="ikFiltro">' + [['con', 'Con movimientos'], ['minimo', 'Bajo el mínimo'], ['todos', 'Todos']].map(function (o, i) { return '<button type="button" class="adm-btn geo-mini" data-valor="' + o[0] + '" aria-pressed="' + (i === 0) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
    '<div class="inv-kardex"><section class="geo-panel"><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Producto</th><th class="num">Existencia</th><th class="num">Mínimo</th><th class="num">Costo</th><th class="num">Valor</th></tr></thead><tbody id="ikExist"></tbody></table></div></section>' +
    '<section class="geo-panel" id="ikDetalle" hidden></section></div>' +
    '<p id="ikMsg" class="dlg-msg" role="status"></p></div>';
  var filtroKardex = 'con';
  function bodKardex() { return +$('ikBodega').value || null; }
  function pintarExistencias() {
    var t = norm($('ikBuscar').value), bod = bodKardex();
    var conMov = {};
    existencias.forEach(function (x) { if (!bod || x.bodega_id === bod) conMov[x.producto_id] = true; });
    var l = productos.filter(function (p) {
      if (p.estado === 'baja' && !conMov[p.id]) return false;
      if (t && norm(etiquetaProd(p) + ' ' + (p.tipo_producto || '')).indexOf(t) < 0) return false;
      var ex = existencia(p.id, bod);
      if (filtroKardex === 'con') return conMov[p.id];
      if (filtroKardex === 'minimo') return p.minimo != null && ex < Number(p.minimo);
      return true;
    });
    var valor = 0;
    $('ikExist').innerHTML = l.length ? l.map(function (p) {
      var ex = existencia(p.id, bod), bajo = p.minimo != null && ex < Number(p.minimo);
      valor += ex * Number(p.costo || 0);
      return '<tr data-prod="' + p.id + '" tabindex="0" class="' + (p.id === prodSel ? 'geo-sel' : '') + '"><td><div class="inv-prod">' + imagen(p, 30) + '<div><b>' + esc(p.nombre) + '</b><small class="inv-sub">' + esc([p.codigo, p.presentacion, p.unidad].filter(Boolean).join(' · ')) + '</small></div></div></td>' +
        '<td class="num"><b class="' + (ex < 0 ? 'inv-negativo' : bajo ? 'inv-bajo' : '') + '">' + cant(ex) + '</b>' + (bajo ? '<small class="inv-sub inv-bajo">Bajo el mínimo</small>' : '') + '</td>' +
        '<td class="num">' + (p.minimo != null ? cant(p.minimo) : '—') + '</td><td class="num">' + q(p.costo) + '</td><td class="num">' + q(ex * Number(p.costo || 0)) + '</td></tr>';
    }).join('') + '<tr class="inv-total"><td colspan="4" class="num">Valor del inventario mostrado</td><td class="num"><b>' + q(valor) + '</b></td></tr>'
      : '<tr><td colspan="5" class="geo-vacia">' + (filtroKardex === 'con' ? 'Aún no hay movimientos. Registra una compra o un ajuste de inventario inicial.' : 'Ningún producto coincide.') + '</td></tr>';
  }
  async function pintarKardex() {
    var p = porId(productos, prodSel);
    $('ikDetalle').hidden = !p;
    if (!p) return;
    $('ikDetalle').innerHTML = '<p class="geo-vacia">Cargando movimientos…</p>';
    var bod = bodKardex();
    try {
      kardex = await todas(function () { var c = sb.from('inv_kardex').select('*').eq('producto_id', p.id).order('fecha').order('id'); return bod ? c.eq('bodega_id', bod) : c; });
    } catch (e) { $('ikDetalle').innerHTML = '<p class="dlg-msg" style="color:#9A3B2E">' + esc(traducir(e)) + '</p>'; return; }
    // Sin bodega elegida, el saldo se acumula sobre todas las bodegas
    var saldo = 0;
    kardex.forEach(function (m) { saldo += m.tipo === 'entrada' ? Number(m.cantidad) : -Number(m.cantidad); m.saldoVista = bod ? Number(m.saldo) : saldo; });
    var te = 0, ts = 0;
    kardex.forEach(function (m) { te += Number(m.entrada); ts += Number(m.salida); });
    $('ikDetalle').innerHTML = '<div class="inv-prod inv-kardex-cab">' + imagen(p, 48) + '<div><h4 class="geo-h">' + esc(p.nombre) + '</h4><small class="inv-sub">' + esc([p.codigo, p.presentacion, bod ? nombreBod(bod) : 'Todas las bodegas'].filter(Boolean).join(' · ')) + '</small></div></div>' +
      '<div class="roles-wrap"><table class="pr-tabla inv-kardex-tabla"><thead><tr><th>Fecha</th><th>Documento</th><th>Origen</th>' + (bod ? '' : '<th>Bodega</th>') + '<th class="num">Entrada</th><th class="num">Salida</th><th class="num">Saldo</th><th class="num">Costo</th><th>Usuario</th></tr></thead><tbody>' +
      (kardex.length ? kardex.map(function (m) {
        return '<tr class="inv-mov-' + m.tipo + '"><td>' + fechaHora(m.fecha) + '</td><td>' + esc(m.documento || '—') + (m.observaciones ? '<small class="inv-sub">' + esc(m.observaciones) + '</small>' : '') + '</td><td>' + (ORIGENES[m.origen] || m.origen) + '</td>' + (bod ? '' : '<td>' + esc(nombreBod(m.bodega_id)) + '</td>') +
          '<td class="num">' + (m.tipo === 'entrada' ? cant(m.cantidad) : '') + '</td><td class="num">' + (m.tipo === 'salida' ? cant(m.cantidad) : '') + '</td><td class="num"><b class="' + (m.saldoVista < 0 ? 'inv-negativo' : '') + '">' + cant(m.saldoVista) + '</b></td><td class="num">' + q(m.costo_unitario) + '</td><td>' + esc(m.usuario || '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="9" class="geo-vacia">Este producto aún no tiene movimientos' + (bod ? ' en esta bodega' : '') + '.</td></tr>') +
      '</tbody>' + (kardex.length ? '<tfoot><tr><td colspan="' + (bod ? 3 : 4) + '" class="num">Totales</td><td class="num"><b>' + cant(te) + '</b></td><td class="num"><b>' + cant(ts) + '</b></td><td class="num"><b>' + cant(te - ts) + '</b></td><td colspan="2"></td></tr></tfoot>' : '') + '</table></div>' +
      '<div class="org-reg-btns"><button type="button" class="adm-btn geo-mini" data-ajustar="' + p.id + '">Ajuste de este producto</button><button type="button" class="adm-btn geo-mini" id="ikActualizar">Actualizar</button></div>';
  }
  async function cargarKardex() {
    aviso('ikMsg', '');
    try { await cargarCatalogos(); await cargarExistencias(); } catch (e) { productos = []; existencias = []; $('ikExist').innerHTML = ''; aviso('ikMsg', traducir(e), true); return; }
    var antes = bodKardex();
    $('ikBodega').innerHTML = '<option value="">Todas las bodegas</option>' + opcionesBodega(antes || bodegaGeneral());
    pintarExistencias();
    if (prodSel) pintarKardex();
  }
  function ajuste(prodId) {
    var opciones = [['', 'Elige un producto…']].concat(productos.filter(function (p) { return p.estado === 'activo' || p.id === prodId; }).map(function (p) { return [p.id, etiquetaProd(p)]; }));
    G.dialogo({
      eyebrow: 'Movimiento Kardex', titulo: 'Ajuste de inventario', valores: { producto_id: prodId || '', bodega_id: bodKardex() || bodegaGeneral(), tipo: 'entrada' },
      campos: [{ k: 'producto_id', label: 'Producto', tipo: 'select', opciones: opciones, req: true, ancho: 'full' },
        { k: 'bodega_id', label: 'Bodega', tipo: 'select', opciones: bodegas.filter(function (b) { return b.estado === 'activo'; }).map(function (b) { return [b.id, b.nombre]; }), req: true },
        { k: 'tipo', label: 'Tipo de ajuste', tipo: 'select', opciones: [['entrada', 'Entrada (inventario inicial, sobrante)'], ['salida', 'Salida (merma, vencido, faltante)']], req: true },
        { k: 'cantidad', label: 'Cantidad', tipo: 'number', paso: '0.01', req: true },
        { k: 'motivo', label: 'Motivo', req: true, max: 300, placeholder: 'Inventario inicial, conteo físico, producto vencido…', ancho: 'full' }],
      guardar: async function (d) {
        if (!(Number(d.cantidad) > 0)) return 'La cantidad debe ser mayor que cero.';
        var r = await sb.rpc('registrar_ajuste_inventario', { p_producto: +d.producto_id, p_bodega: +d.bodega_id, p_tipo: d.tipo, p_cantidad: Number(d.cantidad), p_motivo: d.motivo });
        if (r.error) return traducir(r.error);
        prodSel = +d.producto_id;
        await cargarKardex(); aviso('ikMsg', 'Ajuste grabado en el kardex.'); return null;
      }
    });
  }
  $('ikAjuste').addEventListener('click', function () { ajuste(prodSel); });
  $('ikBodega').addEventListener('change', function () { pintarExistencias(); pintarKardex(); });
  $('ikBuscar').addEventListener('input', pintarExistencias);
  $('ikFiltro').addEventListener('click', function (e) {
    var b = e.target.closest('[data-valor]'); if (!b) return;
    filtroKardex = b.dataset.valor;
    this.querySelectorAll('[data-valor]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    pintarExistencias();
  });
  $('ikExist').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-prod]'); if (tr) { prodSel = +tr.dataset.prod; pintarExistencias(); pintarKardex(); } });
  $('ikExist').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-prod]')) e.target.click(); });
  $('ikDetalle').addEventListener('click', function (e) {
    if (e.target.id === 'ikActualizar') { cargarKardex(); return; }
    var a = e.target.closest('[data-ajustar]'); if (a) ajuste(+a.dataset.ajustar);
  });

  function cargarPanel(id) { return id === 'admInvCompras' ? cargarCompras() : cargarKardex(); }
  ['admInvCompras', 'admInvKardex'].forEach(function (id) {
    var tab = document.querySelector('[data-tab="' + id + '"]');
    if (tab) tab.addEventListener('click', function () { setTimeout(function () { cargarPanel(id); }, 0); });
  });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { ['admInvCompras', 'admInvKardex'].forEach(function (id) { if (!$(id).hidden) cargarPanel(id); }); },
    limpiar: function () {
      proveedores = []; bodegas = []; productos = []; compras = []; items = []; existencias = []; kardex = []; compraSel = prodSel = null; lineas = [];
      ['icLista', 'ikExist'].forEach(function (i) { $(i).innerHTML = ''; });
      $('icFicha').hidden = true; $('ikDetalle').hidden = true; $('icForm').hidden = true;
    }
  });
})();
