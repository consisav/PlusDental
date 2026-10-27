// Plus Dental — Inventarios: Órdenes de compra. Flujo: Grabar (estado «Solicitada») → Autorizar (estado «Autorizada»,
// con la cantidad aprobada por producto) → la compra la asocia en «Aplica orden». Revertir autorización (si ninguna
// compra vigente la usa) y Anular (Super Administrador). Se graba con funciones de Supabase.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admInvOrdenes') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var bodegas = [], productos = [], proveedores = [], existencias = [], ordenes = [], items = [], compras = [];
  var form = null, lineas = [], modoEdicion = false, lineaEdit = -1, filtro = 'todas', pag = 1, PAG = 6;
  var ESTADOS = { solicitada: ['Solicitada', 'inactivo'], autorizada: ['Autorizada', 'activo'], anulada: ['Anulada', 'baja'] };

  function $(id) { return document.getElementById(id); }
  function num(n, d) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function q(n) { return 'Q' + num(n); }
  function cant(n) { var v = Number(n || 0); return v % 1 ? num(v) : num(v, 0); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/inv_orden|orden_compra|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Órdenes de compra.';
    return G.traducir(err);
  }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function nombreBod(id) { var b = porId(bodegas, id); return b ? (b.numero ? b.numero + ' · ' : '') + b.nombre : '—'; }
  function nombreProv(id) { var p = porId(proveedores, id); return p ? p.nombre_comercial : '—'; }
  function sede(x) { return window.PD_SEDES && x.localidad_id ? window.PD_SEDES.texto(x.localidad_id) : '—'; }
  function campo(etq, html, cls) { return '<label class="ic-campo' + (cls ? ' ' + cls : '') + '"><span>' + etq + '</span>' + html + '</label>'; }
  function editable() { return !form || (form.estado === 'solicitada' && modoEdicion); }
  function enUsd() { return $('iocMoneda').value === 'USD'; }
  function cambio() { return Math.max(Number($('iocCambio').value) || 1, 0.0001); }
  function existencia(prod) { var b = +$('iocBodega').value || null; return existencias.filter(function (x) { return x.producto_id === prod && (!b || x.bodega_id === b); }).reduce(function (s, x) { return s + Number(x.existencia || 0); }, 0); }
  // En tránsito: aprobado en otras órdenes autorizadas que todavía no tienen compra vigente
  function enTransito(prod) {
    return ordenes.filter(function (o) { return o.estado === 'autorizada' && (!form || o.id !== form.id) && !compras.some(function (c) { return c.orden_id === o.id && c.estado !== 'anulada'; }); })
      .reduce(function (s, o) { return s + items.filter(function (i) { return i.orden_id === o.id && i.producto_id === prod; }).reduce(function (t, i) { return t + Number(i.cantidad_aprueba || 0); }, 0); }, 0);
  }
  function aprobada(l) { return l.cantidad_aprueba === '' || l.cantidad_aprueba == null ? Number(l.cantidad_solicita) : Number(l.cantidad_aprueba); }
  function opciones(l, sel, vacio) { return (vacio ? '<option value="">' + vacio + '</option>' : '') + l.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function paginador(total, actual, paginas, ini, vis, etiqueta) {
    var b = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - actual) <= 1) b.push(n); else if (b[b.length - 1] !== '…') b.push('…');
    return total ? '<span>' + (ini + 1) + '–' + (ini + vis) + ' de ' + total + ' ' + etiqueta + '</span>' + (paginas > 1 ? '<nav aria-label="Páginas"><button type="button" class="ia-pag" data-pag="' + (actual - 1) + '"' + (actual === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      b.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag="' + n + '"' + (n === actual ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag="' + (actual + 1) + '"' + (actual === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
  }

  $('admInvOrdenes').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Órdenes de compra</h3>' +
    '<button type="button" id="iocNueva" class="adm-btn adm-primary">Nueva orden</button></div>' +
    // Consultar órdenes
    '<section class="geo-panel ic-consulta"><div class="ik-titulo"><h4>Consultar órdenes de compra</h4><span id="iocCuenta"></span></div>' +
      '<div class="ic-cons-filtros">' + campo('Buscar orden', '<input id="iocBuscar" type="search" placeholder="Folio, número de orden, proveedor u observaciones">', 'ic-cons-buscar') +
        campo('Estado', '<select id="iocFiltro"><option value="todas">Todas</option><option value="solicitada">Solicitadas</option><option value="autorizada">Autorizadas</option><option value="anulada">Anuladas</option></select>') +
        campo('Desde', '<input id="iocDesde" type="date">') + campo('Hasta', '<input id="iocHasta" type="date">') + '</div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-cons-t"><colgroup><col class="ic-c-num"><col class="ic-c-fecha"><col><col class="ic-c-doc"><col class="ic-c-q"><col class="ic-c-est"></colgroup>' +
        '<thead><tr><th>Folio</th><th>Fecha</th><th>Proveedor / bodega</th><th>Número de orden</th><th class="num">Total Q</th><th>Estado</th></tr></thead><tbody id="iocLista"></tbody></table>' +
        '<div id="iocPaginas" class="ia-paginas"></div></div></section>' +
    '<form id="iocForm" class="ic-doc" novalidate>' +
    '<div id="iocModo" class="ic-modo" hidden><span id="iocModoTxt"></span><span class="ic-modo-btns"><button type="button" id="iocCancelar" class="adm-btn geo-mini">Cancelar cambios</button><button type="button" id="iocModificar" class="adm-btn adm-primary geo-mini">Modificar</button></span></div>' +
    // Barra de estado
    '<div class="ic-barra">' +
      '<div class="ic-num"><span>Folio</span><b><output id="iocFolio">nuevo</output></b></div>' +
      '<span id="iocEstado" class="estado"></span>' +
      '<div class="ic-meta">' +
        '<span class="ic-chip" title="Número de orden"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><output id="iocNumOrden">se asigna al grabar</output></span>' +
        '<span class="ic-chip" title="Usuario"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><output id="iocUsuario"></output></span>' +
      '</div>' +
      '<div class="ic-totales"><div class="ic-total"><span>Total MI $</span><output id="iocTotMi">0.00</output></div><div class="ic-total ic-total-q"><span>Total Q</span><output id="iocTotQ">0.00</output></div></div>' +
    '</div>' +
    // Tarjetas
    '<div class="ic-tarjetas ioc-tarjetas">' +
      '<section class="ic-tarjeta"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>Proveedor y condiciones</h4><div class="ic-g2">' +
        campo('Proveedor', '<select id="iocProv"></select>', 'ic-full') +
        campo('Forma de pago', '<select id="iocForma"><option value="credito">Crédito</option><option value="contado">Contado</option></select>') + campo('Días de crédito', '<input id="iocDias" type="number" min="0" max="365" class="num" value="0">') +
        campo('Moneda', '<select id="iocMoneda"><option value="GTQ">Quetzales</option><option value="USD">Dólares</option></select>') + campo('Valor cambio', '<input id="iocCambio" type="number" min="0.0001" step="0.0001" class="num" value="8">') +
        campo('Tipo de proveedor', '<select id="iocTipoProv"><option value="local">Local</option><option value="exterior">Del exterior</option></select>', 'ic-full') +
      '</div></section>' +
      '<section class="ic-tarjeta"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8"/></svg>Destino y documento</h4><div class="ic-g2">' +
        campo('Bodega', '<select id="iocBodega"></select>', 'ic-full') +
        campo('Fecha', '<input id="iocFecha" type="date">') + campo('Número de orden', '<input id="iocNumero" maxlength="40" placeholder="Automático">') +
        campo('Observaciones internas', '<textarea id="iocObsInt" maxlength="500" rows="2"></textarea>', 'ic-full') +
      '</div></section>' +
      '<section class="ic-tarjeta"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Para el proveedor</h4><div class="ic-g2">' +
        campo('Observaciones para el proveedor', '<textarea id="iocObsProv" maxlength="500" rows="5" placeholder="Referencia, NOG, condiciones de entrega…"></textarea>', 'ic-full') +
      '</div></section>' +
    '</div>' +
    '<datalist id="iocProdLista"></datalist>' +
    '<div class="ic-tabs" role="tablist">' + [['productos', 'Productos'], ['compras', 'Compras asociadas']].map(function (t, i) {
      return '<button type="button" role="tab" data-ioctab="' + t[0] + '" aria-selected="' + (i === 0) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    // Productos
    '<section class="ic-pane" data-iocpane="productos">' +
    '<div id="iocCaptura" class="ic-captura"><div class="ioc-cap">' +
      campo('Producto (código o nombre)', '<input id="iocCapProd" list="iocProdLista" maxlength="240" placeholder="Escribe el código o el nombre y elige de la lista" autocomplete="off">', 'ic-cap-prod') +
      campo('Cant. solicita', '<input id="iocCapSol" type="number" min="0" step="0.01" class="num">') + campo('Cant. aprueba', '<input id="iocCapApr" type="number" min="0" step="0.01" class="num" placeholder="= solicitada">') +
      campo('Precio unitario', '<input id="iocCapPrecio" type="number" min="0" step="0.0001" class="num">') + campo('Total', '<output id="iocCapTotal" class="ic-cap-total">0.00</output>') +
      '<span class="ic-cap-btns"><button type="button" id="iocCapAgregar" class="adm-btn adm-primary">+ Agregar</button><button type="button" id="iocCapCancelar" class="adm-btn geo-mini" hidden>Cancelar</button></span></div>' +
      '<div class="ioc-cap2">' + campo('Observaciones de la línea', '<input id="iocCapObs" maxlength="300">') + '<span id="iocCapMsg" class="ic-cap-msg itr-cap-msg" role="status">Escribe el producto · Enter lo agrega</span></div></div>' +
    '<div class="ioc-marcar"><button type="button" id="iocMarcar" class="adm-btn geo-mini">Aprobar todo lo solicitado</button><button type="button" id="iocDesmarcar" class="adm-btn geo-mini">Quitar aprobaciones</button></div>' +
    '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-det"><colgroup><col class="ic-d-n"><col><col class="ioc-c-ex"><col class="ioc-c-cant"><col class="ioc-c-cant"><col class="ic-d-cu"><col class="ic-d-tot"><col class="ic-d-acc"></colgroup>' +
      '<thead><tr><th>#</th><th>Código · producto</th><th class="num" title="Existencia en la bodega · en tránsito">Existencia</th><th class="num">Cant. solicita</th><th class="num">Cant. aprueba</th><th class="num">Precio unit. / MI</th><th class="num">Total Q / MI</th><th><span class="sr-only">Acciones</span></th></tr></thead>' +
      '<tbody id="iocLineas"></tbody></table>' +
      '<div class="ic-det-pie"><span><b id="iocCuentaLin">0</b> productos</span><span>Total Q <b id="iocSumQ">0.00</b> · MI $ <b id="iocSumMi">0.00</b></span></div></div>' +
    '<div class="ic-botones ic-blq">' +
      '<button type="submit" id="iocGrabar" class="adm-btn adm-primary">Grabar</button>' +
      '<button type="button" id="iocAutorizar" class="adm-btn">Autorizar</button>' +
      '<button type="button" id="iocRevertir" class="adm-btn">Revertir autorización</button><span class="ic-sep"></span>' +
      '<button type="button" id="iocAnular" class="adm-btn">Anular</button><span class="ic-sep"></span>' +
      '<button type="button" id="iocImprimir" class="adm-btn">Imprimir</button>' +
      '<button type="button" id="iocCorreo" class="adm-btn ioc-envio"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>Enviar por correo</button>' +
      '<button type="button" id="iocWa" class="adm-btn ioc-envio ioc-wa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/></svg>Enviar por WhatsApp</button></div></section>' +
    // Compras asociadas
    '<section class="ic-pane" data-iocpane="compras" hidden><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>#Compra</th><th>Fecha</th><th>Documento</th><th class="num">Total Q</th><th>Estado</th></tr></thead><tbody id="iocCompras"></tbody></table></div></section>' +
    '<p id="iocMsg" class="dlg-msg" role="status"></p><div id="iocRegistro"></div></form></div>';

  // --- Captura ---
  function buscarProd(t) {
    var v = norm(t).trim(); if (!v) return null;
    return productos.filter(function (x) { return norm(x.codigo) === v || norm(x.nombre) === v || norm((x.codigo ? x.codigo + ' · ' : '') + x.nombre) === v; })[0] || null;
  }
  function capMsg(t, error) { $('iocCapMsg').textContent = t || 'Escribe el producto · Enter lo agrega'; $('iocCapMsg').classList.toggle('error', !!error); }
  function infoProd(p) { return 'Existencia ' + cant(existencia(p.id)) + ' · en tránsito ' + cant(enTransito(p.id)) + (p.minimo != null ? ' · mínimo ' + cant(p.minimo) : '') + (p.maximo != null ? ' · máximo ' + cant(p.maximo) : ''); }
  function limpiarCaptura() {
    lineaEdit = -1;
    ['iocCapProd', 'iocCapSol', 'iocCapApr', 'iocCapPrecio', 'iocCapObs'].forEach(function (id) { $(id).value = ''; });
    $('iocCapTotal').textContent = '0.00'; $('iocCapAgregar').textContent = '+ Agregar'; $('iocCapCancelar').hidden = true; capMsg('');
  }
  function totalCaptura() { var a = $('iocCapApr').value === '' ? Number($('iocCapSol').value) : Number($('iocCapApr').value); $('iocCapTotal').textContent = num((a || 0) * (Number($('iocCapPrecio').value) || 0) * (enUsd() ? cambio() : 1)); }
  function agregarCaptura() {
    var p = buscarProd($('iocCapProd').value), s = Number($('iocCapSol').value), a = $('iocCapApr').value;
    if (!p) { capMsg('Elige un producto existente de la lista.', true); $('iocCapProd').focus(); return; }
    if (!(s > 0)) { capMsg('La cantidad solicitada debe ser mayor que cero.', true); $('iocCapSol').focus(); return; }
    if (a !== '' && (Number(a) < 0 || Number(a) > s)) { capMsg('La cantidad aprobada debe estar entre 0 y lo solicitado.', true); $('iocCapApr').focus(); return; }
    var l = { producto_id: p.id, cantidad_solicita: s, cantidad_aprueba: a === '' ? '' : Number(a), precio_unitario: Number($('iocCapPrecio').value) || 0, observaciones: $('iocCapObs').value.trim() };
    if (lineaEdit >= 0) lineas[lineaEdit] = l; else lineas.push(l);
    limpiarCaptura(); pintarLineas(); estadoBotones(); $('iocCapProd').focus();
  }
  function editarLinea(k) {
    var l = lineas[k], p = l && porId(productos, l.producto_id); if (!l) return;
    lineaEdit = k;
    $('iocCapProd').value = p ? (p.codigo ? p.codigo + ' · ' : '') + p.nombre : ''; $('iocCapSol').value = l.cantidad_solicita; $('iocCapApr').value = l.cantidad_aprueba; $('iocCapPrecio').value = l.precio_unitario; $('iocCapObs').value = l.observaciones || '';
    $('iocCapAgregar').textContent = 'Actualizar línea ' + (k + 1); $('iocCapCancelar').hidden = false; capMsg(p ? infoProd(p) : '');
    totalCaptura(); pintarLineas(); $('iocCapApr').focus();
  }
  function pintarLineas() {
    var ed = editable(), tq = 0, tm = 0, tc = cambio(), usd = enUsd();
    $('iocCaptura').hidden = !ed; $('iocMarcar').parentNode.hidden = !ed;
    if (!ed && lineaEdit >= 0) limpiarCaptura();
    $('iocLineas').innerHTML = lineas.length ? lineas.map(function (l, k) {
      var p = porId(productos, l.producto_id) || { nombre: 'Producto ' + l.producto_id }, a = aprobada(l), pu = Number(l.precio_unitario) || 0;
      var totQ = a * pu * (usd ? tc : 1), totMi = usd ? a * pu : a * pu / tc;
      tq += totQ; tm += totMi;
      var bajo = p.minimo != null && existencia(p.id) < Number(p.minimo), tr = enTransito(p.id);
      return '<tr data-linea="' + k + '" class="' + (k === lineaEdit ? 'ic-editando' : '') + '"><td class="ik-cod">' + (k + 1) + '</td>' +
        '<td><b class="ic-d-nom">' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '</b><small class="inv-sub ia-corto">' + esc(l.observaciones || p.presentacion || '') + '</small></td>' +
        '<td class="num' + (bajo ? ' inv-bajo' : '') + '">' + cant(existencia(p.id)) + '<small class="inv-sub">' + (tr ? 'tránsito ' + cant(tr) : (p.minimo != null ? 'mín. ' + cant(p.minimo) : '')) + '</small></td>' +
        '<td class="num">' + cant(l.cantidad_solicita) + '</td>' +
        '<td class="num"><b class="ioc-aprueba' + (l.cantidad_aprueba === '' || l.cantidad_aprueba == null ? ' ioc-pend' : '') + '" title="' + (l.cantidad_aprueba === '' || l.cantidad_aprueba == null ? 'Sin aprobar: al autorizar se aprueba lo solicitado' : '') + '">' + cant(a) + '</b></td>' +
        '<td class="num">' + num(pu, 4) + '<small class="inv-sub">' + num(usd ? pu : pu / tc, 4) + '</small></td>' +
        '<td class="num"><b>' + num(totQ) + '</b><small class="inv-sub">' + num(totMi) + '</small></td>' +
        '<td class="ic-d-acc">' + (ed ? '<button type="button" class="ic-ico" data-editar-linea="' + k + '" aria-label="Modificar línea ' + (k + 1) + '" title="Modificar">✎</button><button type="button" class="ic-ico ic-ico-x" data-quitar="' + k + '" aria-label="Quitar línea ' + (k + 1) + '" title="Quitar">×</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="geo-vacia">' + (ed ? 'Aún no hay productos. Digítalos en la barra de arriba y presiona Enter.' : 'Sin productos.') + '</td></tr>';
    $('iocCuentaLin').textContent = lineas.length; $('iocSumQ').textContent = num(tq); $('iocSumMi').textContent = num(tm);
    $('iocTotQ').textContent = num(tq); $('iocTotMi').textContent = num(tm);
  }

  // --- Encabezado, modo y botones ---
  function pintarEncabezado() {
    var o = form || {}, ed = editable(), e = ESTADOS[o.estado] || ['Nueva', 'inactivo'];
    $('iocFolio').textContent = o.numero ? 'N.º ' + o.numero : 'nueva';
    $('iocEstado').className = 'estado estado-' + e[1]; $('iocEstado').textContent = e[0];
    $('iocNumOrden').textContent = o.numero_orden || 'se asigna al grabar';
    $('iocUsuario').textContent = (o.creado_por || (window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || '—') + (o.creado ? ' · ' + fechaHora(o.creado) : ' · sin grabar');
    $('iocProv').innerHTML = opciones(proveedores.filter(function (p) { return p.estado === 'activo' || p.id === o.proveedor_id; }).map(function (p) { return [p.id, (p.numero ? p.numero + ' · ' : '') + p.nombre_comercial]; }), o.proveedor_id, 'Elige el proveedor…');
    var general = bodegas.filter(function (b) { return b.tipo === 'general' && b.estado === 'activo'; })[0];
    $('iocBodega').innerHTML = opciones(bodegas.filter(function (b) { return b.estado !== 'baja' || b.id === o.bodega_id; }).map(function (b) { return [b.id, (b.numero ? b.numero + ' · ' : '') + b.nombre]; }), o.bodega_id || (general && general.id), 'Elige la bodega…');
    $('iocForma').value = o.forma_pago || 'credito'; $('iocDias').value = o.dias_credito || 0; $('iocMoneda').value = o.moneda || 'GTQ'; $('iocCambio').value = o.tipo_cambio || 8;
    $('iocTipoProv').value = o.tipo_proveedor || 'local'; $('iocFecha').value = o.fecha || hoy(); $('iocNumero').value = o.numero_orden || '';
    $('iocObsInt').value = o.obs_internas || ''; $('iocObsProv').value = o.obs_proveedor || '';
    $('iocForm').querySelectorAll('.ioc-tarjetas input, .ioc-tarjetas select, .ioc-tarjetas textarea').forEach(function (x) { x.disabled = !ed; });
    estadoBotones();
  }
  function estadoBotones() {
    var o = form || {}, ed = editable(), guardada = !!o.id, conCompra = guardada && compras.some(function (c) { return c.orden_id === o.id && c.estado !== 'anulada'; });
    var esSuper = window.PD_SEDES && window.PD_SEDES.esSuper();
    $('iocGrabar').disabled = !ed;
    $('iocAutorizar').disabled = !(guardada && o.estado === 'solicitada');
    $('iocRevertir').disabled = !(o.estado === 'autorizada' && !conCompra);
    $('iocAnular').disabled = !(guardada && o.estado !== 'anulada' && esSuper && !conCompra);
    $('iocAnular').title = esSuper ? '' : 'Solo el Super Administrador anula órdenes de compra.';
    $('iocImprimir').disabled = !guardada;
    var prov = porId(proveedores, o.proveedor_id), mail = correoProv(prov), wa = telWa(prov && prov.telefonos), envia = guardada && o.estado !== 'anulada';
    $('iocCorreo').disabled = !(envia && mail); $('iocCorreo').title = mail ? 'Enviar a ' + mail : 'El proveedor no tiene correo definido';
    $('iocWa').disabled = !(envia && wa); $('iocWa').title = wa ? 'Enviar a +' + wa : 'El proveedor no tiene teléfono definido';
    var modo = '';
    if (guardada) {
      if (o.estado === 'solicitada' && modoEdicion) modo = 'Modificando la orden folio ' + o.numero + '. Presiona «Grabar» para guardar los cambios.';
      else if (o.estado === 'solicitada') modo = 'Orden folio ' + o.numero + ' · Solicitada · modo consulta. Puedes modificarla porque aún no está autorizada.';
      else if (o.estado === 'autorizada') modo = 'Orden folio ' + o.numero + ' · Autorizada · solo consulta' + (conCompra ? ' · ya está asociada a una compra.' : '. Para modificarla, primero «Revertir autorización».');
      else modo = 'Orden folio ' + o.numero + ' · Anulada · solo consulta.';
    }
    $('iocModo').hidden = !guardada; $('iocModoTxt').textContent = modo;
    $('iocModo').className = 'ic-modo' + (o.estado === 'solicitada' && modoEdicion ? ' editando' : o.estado === 'solicitada' ? '' : ' bloqueada');
    $('iocModificar').hidden = !(o.estado === 'solicitada' && !modoEdicion); $('iocCancelar').hidden = !(o.estado === 'solicitada' && modoEdicion);
    var cs = guardada ? compras.filter(function (c) { return c.orden_id === o.id; }) : [];
    $('iocCompras').innerHTML = cs.length ? cs.map(function (c) { return '<tr><td>' + c.numero + '</td><td>' + fecha(c.fecha) + '</td><td>' + esc([c.serie, c.numero_documento].filter(Boolean).join('-') || '—') + '</td><td class="num">' + q(c.total) + '</td><td>' + esc(c.estado) + '</td></tr>'; }).join('')
      : '<tr><td colspan="5" class="geo-vacia">' + (o.estado === 'autorizada' ? 'Ninguna compra la usa todavía. Asóciala en Compras → «Aplica orden?».' : 'Solo una orden Autorizada se puede asociar a una compra.') + '</td></tr>';
    $('iocRegistro').innerHTML = guardada ? '<div class="org-registro"><div class="org-reg-datos"><span>Sede <b>' + esc(sede(o)) + '</b></span>' +
      '<span>Grabado por <b>' + esc(o.creado_por || '—') + '</b> el <b>' + fechaHora(o.creado) + '</b></span>' +
      (o.modificado ? '<span>Modificado por <b>' + esc(o.modificado_por || '—') + '</b> el <b>' + fechaHora(o.modificado) + '</b></span>' : '') +
      (o.aprobado_en ? '<span>Aprobado por <b>' + esc(o.aprobado_por || '—') + '</b> el <b>' + fechaHora(o.aprobado_en) + '</b></span>' : '') +
      (o.estado === 'anulada' ? '<span class="inv-negativo">Anulada por <b>' + esc(o.anulado_por || '—') + '</b> el <b>' + fechaHora(o.anulado_en) + '</b> · ' + esc(o.anulado_motivo || '') + '</span>' : '') +
      '</div></div>' : '';
  }
  function abrir(o) {
    form = o || null; modoEdicion = false; lineaEdit = -1;
    lineas = o ? items.filter(function (i) { return i.orden_id === o.id; }).sort(function (a, b) { return a.linea - b.linea; }).map(function (i) {
      return { producto_id: i.producto_id, cantidad_solicita: Number(i.cantidad_solicita), cantidad_aprueba: i.cantidad_aprueba == null ? '' : Number(i.cantidad_aprueba), precio_unitario: Number(i.precio_unitario), observaciones: i.observaciones || '' }; }) : [];
    $('iocProdLista').innerHTML = productos.filter(function (p) { return p.estado === 'activo'; }).map(function (p) { return '<option value="' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '">' + esc([p.presentacion, p.unidad].filter(Boolean).join(' · ')) + '</option>'; }).join('');
    limpiarCaptura(); aviso('iocMsg', '');
    pintarEncabezado(); pintarLineas();
  }
  function verPestana(t) {
    $('iocForm').querySelectorAll('[data-ioctab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.ioctab === t); });
    $('iocForm').querySelectorAll('[data-iocpane]').forEach(function (p) { p.hidden = p.dataset.iocpane !== t; });
  }

  // --- Consulta ---
  function pintarLista() {
    var t = norm($('iocBuscar').value), d = $('iocDesde').value, h = $('iocHasta').value;
    var l = ordenes.filter(function (o) {
      if (filtro !== 'todas' && o.estado !== filtro) return false;
      if ((d && o.fecha < d) || (h && o.fecha > h)) return false;
      return !t || norm([o.numero, o.numero_orden, nombreProv(o.proveedor_id), o.obs_internas, o.obs_proveedor].join(' ')).indexOf(t) >= 0;
    });
    var paginas = Math.max(1, Math.ceil(l.length / PAG)); pag = Math.min(Math.max(1, pag), paginas);
    var ini = (pag - 1) * PAG, vis = l.slice(ini, ini + PAG);
    $('iocCuenta').textContent = l.length + ' orden' + (l.length === 1 ? '' : 'es');
    $('iocLista').innerHTML = vis.length ? vis.map(function (o) {
      var e = ESTADOS[o.estado] || [o.estado, 'inactivo'];
      return '<tr data-orden="' + o.id + '" tabindex="0" class="' + (form && form.id === o.id ? 'geo-sel' : '') + '"><td><b>' + o.numero + '</b></td><td>' + fecha(o.fecha) + '</td>' +
        '<td><b class="ia-corto">' + esc(nombreProv(o.proveedor_id)) + '</b><small class="inv-sub ia-corto">' + esc(nombreBod(o.bodega_id)) + '</small></td>' +
        '<td><span class="ia-corto">' + esc(o.numero_orden || '—') + '</span><small class="inv-sub">' + (o.forma_pago === 'contado' ? 'Contado' : 'Crédito ' + (o.dias_credito || 0) + ' días') + '</small></td>' +
        '<td class="num"><b>' + q(o.total) + '</b></td><td><span class="estado estado-' + e[1] + '">' + e[0] + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="geo-vacia">' + (ordenes.length ? 'Ninguna orden coincide.' : 'Aún no hay órdenes de compra.') + '</td></tr>';
    $('iocPaginas').hidden = !l.length;
    $('iocPaginas').innerHTML = paginador(l.length, pag, paginas, ini, vis.length, 'órdenes · toca una para verla');
  }
  async function cargar(mantener) {
    aviso('iocMsg', '');
    try {
      if (window.PD_SEDES) await window.PD_SEDES.cargar();
      var r = await Promise.all([
        todas(function () { return sb.from('inv_bodegas').select('id,numero,nombre,tipo,estado,localidad_id').order('numero'); }),
        todas(function () { return sb.from('inv_productos').select('id,numero,codigo,nombre,presentacion,unidad,costo,minimo,maximo,estado').order('numero'); }),
        todas(function () { return sb.from('inv_proveedores').select('id,numero,nombre_comercial,dias_credito,estado,correo,telefonos,contacto').order('numero'); }),
        todas(function () { return sb.from('inv_existencias').select('producto_id,bodega_id,existencia'); }),
        todas(function () { return sb.from('inv_ordenes_compra').select('*').order('numero', { ascending: false }); }),
        todas(function () { return sb.from('inv_orden_items').select('*'); }),
        todas(function () { return sb.from('inv_compras').select('id,numero,fecha,serie,numero_documento,total,estado,orden_id'); })
      ]);
      bodegas = r[0]; productos = r[1]; proveedores = r[2]; existencias = r[3]; ordenes = r[4]; items = r[5]; compras = r[6];
    } catch (e) { ordenes = []; items = []; pintarLista(); abrir(null); aviso('iocMsg', traducir(e), true); return; }
    pintarLista();
    abrir(mantener ? porId(ordenes, mantener) : null);
  }
  async function grabar() {
    if (!+$('iocProv').value) { aviso('iocMsg', 'Elige el proveedor.', true); return null; }
    if (!+$('iocBodega').value) { aviso('iocMsg', 'Elige la bodega.', true); return null; }
    if (!lineas.length) { aviso('iocMsg', 'Agrega al menos un producto.', true); return null; }
    aviso('iocMsg', 'Grabando…');
    var r = await sb.rpc('guardar_orden_compra', { p_id: form ? form.id : null,
      p_datos: { proveedor_id: +$('iocProv').value, bodega_id: +$('iocBodega').value, fecha: $('iocFecha').value, numero_orden: $('iocNumero').value, forma_pago: $('iocForma').value,
        dias_credito: $('iocDias').value || 0, moneda: $('iocMoneda').value, tipo_cambio: cambio(), tipo_proveedor: $('iocTipoProv').value, obs_internas: $('iocObsInt').value, obs_proveedor: $('iocObsProv').value },
      p_items: lineas.map(function (l) { return { producto_id: l.producto_id, cantidad_solicita: l.cantidad_solicita, cantidad_aprueba: l.cantidad_aprueba === '' ? null : l.cantidad_aprueba, precio_unitario: l.precio_unitario, observaciones: l.observaciones }; }) });
    if (r.error) { aviso('iocMsg', traducir(r.error), true); return null; }
    await cargar(r.data);
    return r.data;
  }
  function conMotivo(titulo, efecto, rpc, exito) {
    var o = form;
    G.dialogo({
      eyebrow: 'Órdenes de compra', titulo: titulo, valores: {},
      campos: [{ k: 'aviso', label: 'Efecto', tipo: 'info', ancho: 'full' }, { k: 'motivo', label: 'Motivo', tipo: 'textarea', req: true, max: 300 }],
      alAbrir: function () { $('geoF_aviso').textContent = efecto; },
      guardar: async function (d) { var r = await sb.rpc(rpc, { p_id: o.id, p_motivo: d.motivo }); if (r.error) return traducir(r.error); await cargar(o.id); aviso('iocMsg', exito); return null; }
    });
  }
  // WhatsApp: de los teléfonos del proveedor, el primer celular de Guatemala (empieza con 3, 4 o 5); si no hay, el primero
  function telWa(t) {
    var l = String(t || '').split(/[\/,;]| o | y /).map(function (x) { return x.replace(/\D/g, ''); }).filter(function (x) { return x.length >= 8; }).map(function (x) { return x.length === 8 ? '502' + x : x; });
    return l.filter(function (x) { return /^502[345]\d{7}$/.test(x); })[0] || l[0] || '';
  }
  function correoProv(p) { return p && p.correo ? String(p.correo).split(/[\s,;]+/).filter(function (x) { return /@/.test(x); })[0] || '' : ''; }
  function textoOrden(o, largo) {
    var p = porId(proveedores, o.proveedor_id) || {}, usd = o.moneda === 'USD', tc = Number(o.tipo_cambio) || 1, simb = usd ? '$' : 'Q';
    var det = items.filter(function (i) { return i.orden_id === o.id; }).sort(function (a, b) { return a.linea - b.linea; });
    var lin = det.map(function (i) { var pr = porId(productos, i.producto_id) || {}, a = i.cantidad_aprueba == null ? Number(i.cantidad_solicita) : Number(i.cantidad_aprueba), pu = Number(i.precio_unitario);
      return (largo ? '' : '• ') + i.linea + '. ' + (pr.codigo ? pr.codigo + ' · ' : '') + (pr.nombre || 'Producto') + ': ' + cant(a) + ' × ' + simb + num(pu, 2) + ' = ' + simb + num(a * pu) + (i.observaciones ? ' (' + i.observaciones + ')' : ''); });
    var total = usd ? 'Total $ ' + num(o.total_mi) + ' (Q ' + num(o.total) + ')' : 'Total Q ' + num(o.total);
    return ['Estimados ' + (p.contacto || p.nombre_comercial || '') + ':', '',
      'Plus Dental les envía la orden de compra ' + (o.numero_orden || 'folio ' + o.numero) + (o.estado === 'solicitada' ? ' (solicitud pendiente de autorización)' : '') + '.', '',
      'Fecha: ' + fecha(o.fecha), 'Entregar en: ' + nombreBod(o.bodega_id) + ' · ' + sede(o),
      'Forma de pago: ' + (o.forma_pago === 'contado' ? 'Contado' : 'Crédito a ' + (o.dias_credito || 0) + ' días') + (usd ? ' · Moneda: dólares (cambio ' + num(tc, 4) + ')' : ''), '',
      'Productos:'].concat(lin).concat(['', total].concat(o.obs_proveedor ? ['', 'Observaciones: ' + o.obs_proveedor] : []).concat(['',
      'Por favor confirmar recepción y fecha de entrega.', 'Atentamente, ' + ((window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) ? window.PD_SESION.usuario() + ' · ' : '') + 'Plus Dental'])).join('\n');
  }
  function enviar(medio) {
    var o = form; if (!o || !o.id) return;
    var p = porId(proveedores, o.proveedor_id), destino = medio === 'correo' ? correoProv(p) : telWa(p && p.telefonos);
    if (!destino) { aviso('iocMsg', 'El proveedor no tiene ' + (medio === 'correo' ? 'correo' : 'teléfono') + ' definido. Agrégalo en Catálogos → Proveedores.', true); return; }
    var texto = textoOrden(o, medio === 'correo');
    if (medio === 'correo') {
      var asunto = 'Orden de compra ' + (o.numero_orden || o.numero) + ' · Plus Dental';
      if (texto.length > 1800) texto = texto.slice(0, 1780) + '\n…';
      window.location.href = 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto);
      aviso('iocMsg', 'Se abrió tu programa de correo con la orden lista para ' + destino + '. Para adjuntar el PDF usa «Imprimir» → Guardar como PDF.');
    } else {
      window.open('https://wa.me/' + destino + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
      aviso('iocMsg', 'Se abrió WhatsApp con la orden lista para +' + destino + '. Solo presiona Enviar.');
    }
  }
  function imprimir() {
    var o = form, P = window.PD_IMPRESION;
    if (!o || !P) return;
    var th = 'padding:6px;border-bottom:2px solid #0B2B40;text-align:left;font-size:10px;text-transform:uppercase;color:#475B68', td = 'padding:6px;border-bottom:1px solid #E3EAF0;font-size:12px';
    function d(k, v, ancho) { return '<div' + (ancho ? ' style="grid-column:span ' + ancho + '"' : '') + '><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.08em">' + k + '</span><b>' + esc(v == null || v === '' ? '—' : v) + '</b></div>'; }
    var usd = o.moneda === 'USD', tc = Number(o.tipo_cambio) || 1, det = items.filter(function (i) { return i.orden_id === o.id; }).sort(function (a, b) { return a.linea - b.linea; });
    var html = P.encabezado('Orden de compra ' + (o.numero_orden || '') + ' · folio ' + o.numero + ' · ' + (ESTADOS[o.estado] || [o.estado])[0]) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;font-size:12px">' +
      d('Proveedor', nombreProv(o.proveedor_id), 2) + d('Fecha', fecha(o.fecha)) + d('Bodega', nombreBod(o.bodega_id)) +
      d('Forma de pago', o.forma_pago === 'contado' ? 'Contado' : 'Crédito · ' + (o.dias_credito || 0) + ' días') + d('Moneda / cambio', (usd ? 'Dólares' : 'Quetzales') + ' · ' + num(tc, 4)) + d('Tipo de proveedor', o.tipo_proveedor === 'exterior' ? 'Del exterior' : 'Local') + d('Sede', sede(o)) +
      d('Observaciones para el proveedor', o.obs_proveedor, 4) + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['#', 'Código', 'Producto', 'Solicitado', 'Aprobado', 'Precio unit.', 'Total Q', 'Total MI'].map(function (h, i) { return '<th style="' + th + (i > 2 ? ';text-align:right' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      det.map(function (i) { var p = porId(productos, i.producto_id) || {}, a = i.cantidad_aprueba == null ? Number(i.cantidad_solicita) : Number(i.cantidad_aprueba), pu = Number(i.precio_unitario);
        return '<tr><td style="' + td + '">' + i.linea + '</td><td style="' + td + '">' + esc(p.codigo || '') + '</td><td style="' + td + '">' + esc(p.nombre || '') + (i.observaciones ? '<br><small style="color:#5A6D7A">' + esc(i.observaciones) + '</small>' : '') + '</td>' +
          '<td style="' + td + ';text-align:right">' + cant(i.cantidad_solicita) + '</td><td style="' + td + ';text-align:right">' + cant(a) + '</td><td style="' + td + ';text-align:right">' + num(pu, 4) + '</td>' +
          '<td style="' + td + ';text-align:right">' + num(a * pu * (usd ? tc : 1)) + '</td><td style="' + td + ';text-align:right">' + num(usd ? a * pu : a * pu / tc) + '</td></tr>'; }).join('') +
      '</tbody></table><p style="text-align:right;font-size:13px;margin-top:10px"><b>Total Q ' + num(o.total) + '</b> · Total MI $ ' + num(o.total_mi) + '</p>' +
      '<div style="display:flex;gap:40px;margin-top:50px;font-size:11px"><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Solicitado por · ' + esc(o.creado_por || '') + '</div><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Autorizado por · ' + esc(o.aprobado_por || '') + '</div></div>' +
      '<p style="font-size:9px;color:#5A6D7A;margin-top:14px;text-align:right">Impreso por ' + esc((window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || '—') + ' · ' + fechaHora(new Date().toISOString()) + '</p></div>';
    P.imprimir(html);
  }

  // --- Eventos ---
  $('iocNueva').addEventListener('click', async function () { if (!bodegas.length) await cargar(); abrir(null); pintarLista(); verPestana('productos'); $('iocForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('iocProv').focus({ preventScroll: true }); });
  $('iocModificar').addEventListener('click', function () { if (!form || form.estado !== 'solicitada') return; modoEdicion = true; pintarEncabezado(); pintarLineas(); verPestana('productos'); $('iocCapProd').focus(); });
  $('iocCancelar').addEventListener('click', function () { abrir(form); aviso('iocMsg', 'Cambios descartados.'); });
  $('iocForm').addEventListener('click', function (e) { var t = e.target.closest('[data-ioctab]'); if (t) verPestana(t.dataset.ioctab); });
  $('iocProv').addEventListener('change', function () { var p = porId(proveedores, +this.value); if (p) { $('iocDias').value = p.dias_credito || 0; $('iocForma').value = +p.dias_credito ? 'credito' : 'contado'; } });
  ['iocMoneda', 'iocCambio', 'iocBodega'].forEach(function (id) { $(id).addEventListener(id === 'iocCambio' ? 'input' : 'change', function () { pintarLineas(); totalCaptura(); }); });
  $('iocCaptura').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); agregarCaptura(); } if (e.key === 'Escape' && lineaEdit >= 0) { limpiarCaptura(); pintarLineas(); } });
  $('iocCaptura').addEventListener('input', function (e) {
    if (e.target.id === 'iocCapProd') {
      var p = buscarProd(e.target.value);
      if (p) { if ($('iocCapPrecio').value === '' && p.costo != null) $('iocCapPrecio').value = enUsd() ? Math.round(p.costo / cambio() * 10000) / 10000 : Number(p.costo); capMsg(infoProd(p)); if (e.inputType === 'insertReplacementText' || !e.inputType) $('iocCapSol').focus(); }
      else capMsg(e.target.value.trim() ? 'Elige un producto de la lista.' : '');
    }
    totalCaptura();
  });
  $('iocCapAgregar').addEventListener('click', agregarCaptura);
  $('iocCapCancelar').addEventListener('click', function () { limpiarCaptura(); pintarLineas(); $('iocCapProd').focus(); });
  $('iocMarcar').addEventListener('click', function () { lineas.forEach(function (l) { l.cantidad_aprueba = Number(l.cantidad_solicita); }); pintarLineas(); });
  $('iocDesmarcar').addEventListener('click', function () { lineas.forEach(function (l) { l.cantidad_aprueba = ''; }); pintarLineas(); });
  $('iocLineas').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-editar-linea]'); if (ed) { editarLinea(+ed.dataset.editarLinea); return; }
    var b = e.target.closest('[data-quitar]');
    if (b) { var k = +b.dataset.quitar; lineas.splice(k, 1); if (lineaEdit === k) limpiarCaptura(); else if (lineaEdit > k) lineaEdit--; pintarLineas(); estadoBotones(); }
  });
  $('iocLineas').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-linea]'); if (tr && editable()) editarLinea(+tr.dataset.linea); });
  $('iocForm').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!editable()) return;
    $('iocGrabar').disabled = true; var id = await grabar(); $('iocGrabar').disabled = false;
    if (id) { var o = porId(ordenes, id); aviso('iocMsg', 'Orden folio ' + (o ? o.numero : id) + ' grabada como Solicitada. Usa «Autorizar» cuando esté aprobada.'); }
  });
  $('iocAutorizar').addEventListener('click', async function () {
    if (!form || form.estado !== 'solicitada') return;
    if (!window.confirm('¿Autorizar la orden folio ' + form.numero + '? Las líneas sin cantidad aprobada se aprueban por lo solicitado. Después ya no se puede modificar (salvo «Revertir autorización»).')) return;
    var id = form.id, r = await sb.rpc('autorizar_orden_compra', { p_id: id });
    if (r.error) { aviso('iocMsg', traducir(r.error), true); return; }
    await cargar(id); aviso('iocMsg', 'Orden folio ' + form.numero + ' autorizada. Ya se puede asociar a una compra.');
  });
  $('iocRevertir').addEventListener('click', function () { if (form) conMotivo('Revertir la autorización · folio ' + form.numero, 'La orden vuelve a «Solicitada» para corregirla. El motivo queda en las observaciones internas.', 'revertir_orden_compra', 'Autorización revertida: la orden quedó Solicitada.'); });
  $('iocAnular').addEventListener('click', function () { if (form) conMotivo('Anular la orden folio ' + form.numero, 'La orden quedará Anulada y no se puede deshacer.', 'anular_orden_compra', 'Orden anulada.'); });
  $('iocImprimir').addEventListener('click', imprimir);
  $('iocCorreo').addEventListener('click', function () { enviar('correo'); });
  $('iocWa').addEventListener('click', function () { enviar('whatsapp'); });
  $('iocBuscar').addEventListener('input', function () { pag = 1; pintarLista(); });
  ['iocFiltro', 'iocDesde', 'iocHasta'].forEach(function (id) { $(id).addEventListener('change', function () { if (id === 'iocFiltro') filtro = this.value; pag = 1; pintarLista(); }); });
  $('iocPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-pag]'); if (b && !b.disabled) { pag = +b.dataset.pag; pintarLista(); } });
  $('iocLista').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-orden]'); if (tr) { abrir(porId(ordenes, +tr.dataset.orden)); pintarLista(); verPestana('productos'); $('iocForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  $('iocLista').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-orden]')) e.target.click(); });

  var tab = document.querySelector('[data-tab="admInvOrdenes"]');
  if (tab) tab.addEventListener('click', function () { setTimeout(function () { cargar(); }, 0); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admInvOrdenes').hidden) cargar(); },
    limpiar: function () { bodegas = []; productos = []; proveedores = []; existencias = []; ordenes = []; items = []; compras = []; form = null; lineas = []; ['iocLista', 'iocLineas', 'iocRegistro', 'iocCompras'].forEach(function (i) { $(i).innerHTML = ''; }); }
  });
})();
