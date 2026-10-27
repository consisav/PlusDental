// Plus Dental — Inventarios: Traslado de productos entre bodegas de la sede. Flujo: Grabar (estado «Grabado», no mueve
// inventario) → Descargar (estado «Operado»: salida de la bodega origen y entrada en la destino en el kardex) → Revertir
// (devuelve los productos y el traslado vuelve a «Grabado»). Se graba con funciones de Supabase.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admInvTraslados') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var bodegas = [], productos = [], existencias = [], traslados = [], items = [];
  var form = null, lineas = [], modoEdicion = false, lineaEdit = -1, filtro = 'todos', pag = 1, PAG = 6;
  var ESTADOS = { grabado: ['Grabado', 'inactivo'], operado: ['Operado', 'activo'] };

  function $(id) { return document.getElementById(id); }
  function num(n, d) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function q(n) { return 'Q' + num(n); }
  function cant(n) { var v = Number(n || 0); return v % 1 ? num(v) : num(v, 0); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/inv_traslado|guardar_traslado|descargar_traslado|revertir_traslado|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Traslados.';
    return G.traducir(err);
  }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function nombreBod(id) { var b = porId(bodegas, id); return b ? (b.numero ? b.numero + ' · ' : '') + b.nombre : '—'; }
  function existencia(prod, bod) { return existencias.filter(function (x) { return x.producto_id === prod && x.bodega_id === bod; }).reduce(function (s, x) { return s + Number(x.existencia || 0); }, 0); }
  function sede(x) { return window.PD_SEDES && x.localidad_id ? window.PD_SEDES.texto(x.localidad_id) : '—'; }
  function campo(etq, html, cls) { return '<label class="ic-campo' + (cls ? ' ' + cls : '') + '"><span>' + etq + '</span>' + html + '</label>'; }
  function editable() { return !form || (form.estado === 'grabado' && modoEdicion); }
  function opcionesBodega(sel) {
    return '<option value="">Elige la bodega…</option>' + bodegas.filter(function (b) { return b.estado !== 'baja' || b.id === sel; }).map(function (b) {
      return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc((b.numero ? b.numero + ' · ' : '') + b.nombre + (b.tipo === 'sub' ? ' (sub-bodega)' : '')) + '</option>'; }).join('');
  }
  function paginador(total, actual, paginas, ini, vis, etiqueta) {
    var b = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - actual) <= 1) b.push(n); else if (b[b.length - 1] !== '…') b.push('…');
    return total ? '<span>' + (ini + 1) + '–' + (ini + vis) + ' de ' + total + ' ' + etiqueta + '</span>' + (paginas > 1 ? '<nav aria-label="Páginas"><button type="button" class="ia-pag" data-pag="' + (actual - 1) + '"' + (actual === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      b.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag="' + n + '"' + (n === actual ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag="' + (actual + 1) + '"' + (actual === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
  }

  $('admInvTraslados').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Traslado de productos entre bodegas</h3>' +
    '<button type="button" id="itrNuevo" class="adm-btn adm-primary">Nuevo traslado</button></div>' +
    // Consultar traslados
    '<section class="geo-panel ic-consulta"><div class="ik-titulo"><h4>Consultar traslados</h4><span id="itrCuenta"></span></div>' +
      '<div class="ic-cons-filtros">' + campo('Buscar traslado', '<input id="itrBuscar" type="search" placeholder="N.º traslado, bodega, descripción o producto">', 'ic-cons-buscar') +
        campo('Estado', '<select id="itrFiltro"><option value="todos">Todos</option><option value="grabado">Grabados</option><option value="operado">Operados</option></select>') +
        campo('Desde', '<input id="itrDesde" type="date">') + campo('Hasta', '<input id="itrHasta" type="date">') + '</div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-cons-t"><colgroup><col class="ic-c-num"><col class="ic-c-fecha"><col><col><col class="ic-c-q"><col class="ic-c-est"></colgroup>' +
        '<thead><tr><th>Traslado</th><th>Fecha</th><th>Bodega origen → destino</th><th>Descripción</th><th class="num">Productos</th><th>Estado</th></tr></thead><tbody id="itrLista"></tbody></table>' +
        '<div id="itrPaginas" class="ia-paginas"></div></div></section>' +
    '<form id="itrForm" class="ic-doc" novalidate>' +
    '<div id="itrModo" class="ic-modo" hidden><span id="itrModoTxt"></span><span class="ic-modo-btns"><button type="button" id="itrCancelar" class="adm-btn geo-mini">Cancelar cambios</button><button type="button" id="itrModificar" class="adm-btn adm-primary geo-mini">Modificar</button></span></div>' +
    // Barra de estado
    '<div class="ic-barra">' +
      '<div class="ic-num"><span>Traslado</span><b><output id="itrNumero">nuevo</output></b></div>' +
      '<span id="itrEstado" class="estado"></span>' +
      '<div class="ic-meta">' +
        '<span class="ic-chip" title="Fecha del traslado"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><output id="itrFecha"></output></span>' +
        '<span class="ic-chip" title="Usuario"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><output id="itrUsuario"></output></span>' +
      '</div>' +
      '<div class="ic-totales"><div class="ic-total"><span>Productos</span><output id="itrTotProd">0</output></div><div class="ic-total ic-total-q"><span>Valor Q</span><output id="itrTotQ">0.00</output></div></div>' +
    '</div>' +
    // Bodegas y descripción
    '<section class="ic-tarjeta itr-tarjeta"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8"/></svg>Bodegas y descripción</h4><div class="itr-g">' +
      campo('Bodega origen', '<select id="itrOrigen"></select>') +
      '<span class="itr-flecha" aria-hidden="true">→</span>' +
      campo('Bodega destino', '<select id="itrDestino"></select>') +
      campo('Aplica conta', '<select id="itrConta"><option value="false">No</option><option value="true">Sí</option></select>', 'itr-conta') +
      campo('Descripción', '<input id="itrDesc" maxlength="500" placeholder="Motivo o referencia del traslado">', 'itr-desc') +
    '</div></section>' +
    '<datalist id="itrProdLista"></datalist>' +
    '<div class="ic-tabs" role="tablist">' + [['productos', 'Productos'], ['contabilidad', 'Contabilidad']].map(function (t, i) {
      return '<button type="button" role="tab" data-itrtab="' + t[0] + '" aria-selected="' + (i === 0) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    // Productos: barra de captura + lista compacta
    '<section class="ic-pane" data-itrpane="productos">' +
    '<div id="itrCaptura" class="ic-captura"><div class="itr-cap">' +
      campo('Producto (código o nombre)', '<input id="itrCapProd" list="itrProdLista" maxlength="240" placeholder="Escribe el código o el nombre y elige de la lista" autocomplete="off">', 'ic-cap-prod') +
      campo('Lote', '<input id="itrCapLote" maxlength="40">') + campo('Vence', '<input id="itrCapVence" type="date">') +
      campo('Cantidad', '<input id="itrCapCant" type="number" min="0" step="0.01" class="num">') +
      '<label class="ic-check"><input id="itrCapInv" type="checkbox" checked> Inv.</label>' +
      '<span class="ic-cap-btns"><button type="button" id="itrCapAgregar" class="adm-btn adm-primary">+ Agregar</button><button type="button" id="itrCapCancelar" class="adm-btn geo-mini" hidden>Cancelar</button></span></div>' +
      '<span id="itrCapMsg" class="ic-cap-msg itr-cap-msg" role="status">Elige la bodega origen y escribe el producto · Enter lo agrega</span></div>' +
    '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-det"><colgroup><col class="ic-d-n"><col><col class="itr-c-lote"><col class="itr-c-vence"><col class="ic-d-cant"><col class="itr-c-exist"><col class="ic-d-tot"><col class="ic-d-acc"></colgroup>' +
      '<thead><tr><th>#</th><th>Código · producto</th><th>Lote</th><th>Vence</th><th class="num">Cantidad</th><th class="num" title="Existencia actual en la bodega origen">Exist. origen</th><th class="num">Valor Q</th><th><span class="sr-only">Acciones</span></th></tr></thead>' +
      '<tbody id="itrLineas"></tbody></table>' +
      '<div class="ic-det-pie"><span><b id="itrCuentaLin">0</b> productos</span><span>Cantidad total <b id="itrSumCant">0</b> · Valor Q <b id="itrSumQ">0.00</b></span></div></div>' +
    '<div class="ic-botones ic-blq">' +
      '<button type="submit" id="itrGrabar" class="adm-btn adm-primary">Grabar</button>' +
      '<button type="button" id="itrDescargar" class="adm-btn">Descargar</button>' +
      '<button type="button" id="itrRevertir" class="adm-btn">Revertir</button><span class="ic-sep"></span>' +
      '<button type="button" id="itrImprimir" class="adm-btn">Imprimir</button></div></section>' +
    // Contabilidad
    '<section class="ic-pane" data-itrpane="contabilidad" hidden><p class="dlg-msg">Partida sugerida (informativa) al costo de cada producto: entra al inventario de la bodega destino y sale del inventario de la bodega origen.</p>' +
      '<div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead><tbody id="itrConta2"></tbody></table></div></section>' +
    '<p id="itrMsg" class="dlg-msg" role="status"></p><div id="itrRegistro"></div></form></div>';

  // --- Captura de productos ---
  function buscarProd(t) {
    var v = norm(t).trim(); if (!v) return null;
    return productos.filter(function (x) { return norm(x.codigo) === v || norm(x.nombre) === v || norm((x.codigo ? x.codigo + ' · ' : '') + x.nombre) === v; })[0] || null;
  }
  function origen() { return +$('itrOrigen').value || null; }
  function capMsg(t, error) { $('itrCapMsg').textContent = t || 'Escribe el producto · Enter lo agrega'; $('itrCapMsg').classList.toggle('error', !!error); }
  function limpiarCaptura() {
    lineaEdit = -1;
    ['itrCapProd', 'itrCapLote', 'itrCapVence', 'itrCapCant'].forEach(function (id) { $(id).value = ''; });
    $('itrCapInv').checked = true; $('itrCapAgregar').textContent = '+ Agregar'; $('itrCapCancelar').hidden = true; capMsg('');
  }
  function agregarCaptura() {
    var p = buscarProd($('itrCapProd').value), n = Number($('itrCapCant').value);
    if (!origen()) { capMsg('Primero elige la bodega origen.', true); $('itrOrigen').focus(); return; }
    if (!p) { capMsg('Elige un producto existente de la lista.', true); $('itrCapProd').focus(); return; }
    if (!(n > 0)) { capMsg('La cantidad debe ser mayor que cero.', true); $('itrCapCant').focus(); return; }
    var l = { producto_id: p.id, lote: $('itrCapLote').value.trim(), vencimiento: $('itrCapVence').value, cantidad: n, afecta_inventario: $('itrCapInv').checked };
    if (lineaEdit >= 0) lineas[lineaEdit] = l; else lineas.push(l);
    var pedido = lineas.filter(function (x) { return x.producto_id === p.id && x.afecta_inventario; }).reduce(function (s, x) { return s + Number(x.cantidad); }, 0), ex = existencia(p.id, origen());
    limpiarCaptura(); pintarLineas(); estadoBotones(); $('itrCapProd').focus();
    if (pedido > ex) capMsg('Atención: «' + p.nombre + '» tiene ' + cant(ex) + ' en la bodega origen y se trasladan ' + cant(pedido) + '. No se podrá descargar.', true);
  }
  function editarLinea(k) {
    var l = lineas[k], p = l && porId(productos, l.producto_id); if (!l) return;
    lineaEdit = k;
    $('itrCapProd').value = p ? (p.codigo ? p.codigo + ' · ' : '') + p.nombre : ''; $('itrCapLote').value = l.lote || ''; $('itrCapVence').value = l.vencimiento || ''; $('itrCapCant').value = l.cantidad; $('itrCapInv').checked = !!l.afecta_inventario;
    $('itrCapAgregar').textContent = 'Actualizar línea ' + (k + 1); $('itrCapCancelar').hidden = false; capMsg('Modificando la línea ' + (k + 1) + '. Enter para actualizar.');
    pintarLineas(); $('itrCapCant').focus();
  }
  function pintarLineas() {
    var ed = editable(), bo = origen(), tc = 0, tq = 0;
    $('itrCaptura').hidden = !ed;
    if (!ed && lineaEdit >= 0) limpiarCaptura();
    $('itrLineas').innerHTML = lineas.length ? lineas.map(function (l, k) {
      var p = porId(productos, l.producto_id) || { nombre: 'Producto ' + l.producto_id }, ex = bo ? existencia(l.producto_id, bo) : 0, v = Number(l.cantidad) * Number(p.costo || 0);
      tc += Number(l.cantidad); tq += v;
      var falta = l.afecta_inventario && (!form || form.estado === 'grabado') && Number(l.cantidad) > ex;
      return '<tr data-linea="' + k + '" class="' + (k === lineaEdit ? 'ic-editando' : '') + '"><td class="ik-cod">' + (k + 1) + '</td>' +
        '<td><b class="ic-d-nom">' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '</b>' + (l.afecta_inventario ? '' : ' <span class="inv-alerta">No afecta inventario</span>') + (p.presentacion ? '<small class="inv-sub ia-corto">' + esc(p.presentacion) + '</small>' : '') + '</td>' +
        '<td>' + esc(l.lote || '—') + '</td><td>' + (l.vencimiento ? fecha(l.vencimiento) : '—') + '</td>' +
        '<td class="num"><b>' + cant(l.cantidad) + '</b></td><td class="num' + (falta ? ' inv-negativo' : '') + '"' + (falta ? ' title="Existencia insuficiente en la bodega origen"' : '') + '>' + (bo ? cant(ex) : '—') + '</td>' +
        '<td class="num">' + num(v) + '<small class="inv-sub">c/u ' + num(p.costo || 0) + '</small></td>' +
        '<td class="ic-d-acc">' + (ed ? '<button type="button" class="ic-ico" data-editar-linea="' + k + '" aria-label="Modificar línea ' + (k + 1) + '" title="Modificar">✎</button><button type="button" class="ic-ico ic-ico-x" data-quitar="' + k + '" aria-label="Quitar línea ' + (k + 1) + '" title="Quitar">×</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="geo-vacia">' + (ed ? 'Aún no hay productos. Digítalos en la barra de arriba y presiona Enter.' : 'Sin productos.') + '</td></tr>';
    $('itrCuentaLin').textContent = lineas.length; $('itrSumCant').textContent = cant(tc); $('itrSumQ').textContent = num(tq);
    $('itrTotProd').textContent = lineas.length; $('itrTotQ').textContent = num(tq);
    pintarConta(tq);
  }
  function pintarConta(total) {
    var o = origen(), d = +$('itrDestino').value || null;
    $('itrConta2').innerHTML = '<tr><td>Inventario · ' + esc(d ? nombreBod(d) : 'bodega destino') + '</td><td class="num">' + q(total) + '</td><td></td></tr>' +
      '<tr><td>Inventario · ' + esc(o ? nombreBod(o) : 'bodega origen') + '</td><td></td><td class="num">' + q(total) + '</td></tr>' +
      '<tr class="inv-total"><td class="num">Totales' + ($('itrConta').value === 'true' ? '' : ' (no aplica conta)') + '</td><td class="num"><b>' + q(total) + '</b></td><td class="num"><b>' + q(total) + '</b></td></tr>';
  }

  // --- Encabezado, modo y botones ---
  function pintarEncabezado() {
    var t = form || {}, ed = editable(), e = ESTADOS[t.estado] || ['Nuevo', 'inactivo'];
    $('itrNumero').textContent = t.numero ? 'N.º ' + t.numero : 'nuevo';
    $('itrEstado').className = 'estado estado-' + e[1]; $('itrEstado').textContent = e[0];
    $('itrFecha').textContent = t.fecha ? fechaHora(t.fecha) : fechaHora(new Date().toISOString());
    $('itrUsuario').textContent = (t.operado_por || t.creado_por || (window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || '—') + (t.creado ? '' : ' · sin grabar');
    var general = bodegas.filter(function (b) { return b.tipo === 'general' && b.estado === 'activo'; })[0];
    $('itrOrigen').innerHTML = opcionesBodega(t.bodega_origen_id || (general && general.id) || null);
    $('itrDestino').innerHTML = opcionesBodega(t.bodega_destino_id || null);
    $('itrDesc').value = t.descripcion || ''; $('itrConta').value = t.aplica_conta ? 'true' : 'false';
    ['itrOrigen', 'itrDestino', 'itrDesc', 'itrConta'].forEach(function (id) { $(id).disabled = !ed; });
    estadoBotones();
  }
  function estadoBotones() {
    var t = form || {}, ed = editable(), guardado = !!t.id;
    $('itrGrabar').disabled = !ed;
    $('itrDescargar').disabled = !(guardado && t.estado === 'grabado');
    $('itrRevertir').disabled = t.estado !== 'operado';
    $('itrImprimir').disabled = !guardado;
    var modo = '';
    if (guardado) {
      if (t.estado === 'grabado' && modoEdicion) modo = 'Modificando el traslado N.º ' + t.numero + '. Presiona «Grabar» para guardar los cambios.';
      else if (t.estado === 'grabado') modo = 'Traslado N.º ' + t.numero + ' · Grabado · modo consulta. Puedes modificarlo porque aún no se ha descargado.';
      else modo = 'Traslado N.º ' + t.numero + ' · Operado · solo consulta: ya se descargó del inventario. Para modificarlo, primero «Revertir».';
    }
    $('itrModo').hidden = !guardado; $('itrModoTxt').textContent = modo;
    $('itrModo').className = 'ic-modo' + (t.estado === 'grabado' && modoEdicion ? ' editando' : t.estado === 'grabado' ? '' : ' bloqueada');
    $('itrModificar').hidden = !(t.estado === 'grabado' && !modoEdicion); $('itrCancelar').hidden = !(t.estado === 'grabado' && modoEdicion);
    $('itrRegistro').innerHTML = guardado ? '<div class="org-registro"><div class="org-reg-datos"><span>Sede <b>' + esc(sede(t)) + '</b></span>' +
      '<span>Grabado por <b>' + esc(t.creado_por || '—') + '</b> el <b>' + fechaHora(t.creado) + '</b></span>' +
      (t.modificado ? '<span>Modificado por <b>' + esc(t.modificado_por || '—') + '</b> el <b>' + fechaHora(t.modificado) + '</b></span>' : '') +
      (t.operado_en ? '<span>Descargado por <b>' + esc(t.operado_por || '—') + '</b> el <b>' + fechaHora(t.operado_en) + '</b></span>' : '') +
      (t.revertido_en ? '<span>Última reversión por <b>' + esc(t.revertido_por || '—') + '</b> el <b>' + fechaHora(t.revertido_en) + '</b> · ' + esc(t.revertido_motivo || '') + '</span>' : '') +
      '</div></div>' : '';
  }
  function abrir(t) {
    form = t || null; modoEdicion = false; lineaEdit = -1;
    lineas = t ? items.filter(function (i) { return i.traslado_id === t.id; }).sort(function (a, b) { return a.linea - b.linea; }).map(function (i) {
      return { producto_id: i.producto_id, lote: i.lote || '', vencimiento: i.vencimiento || '', cantidad: Number(i.cantidad), afecta_inventario: i.afecta_inventario !== false }; }) : [];
    $('itrProdLista').innerHTML = productos.filter(function (p) { return p.estado === 'activo'; }).map(function (p) { return '<option value="' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '">' + esc([p.presentacion, p.unidad].filter(Boolean).join(' · ')) + '</option>'; }).join('');
    limpiarCaptura(); aviso('itrMsg', '');
    pintarEncabezado(); pintarLineas();
  }
  function verPestana(t) {
    $('itrForm').querySelectorAll('[data-itrtab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.itrtab === t); });
    $('itrForm').querySelectorAll('[data-itrpane]').forEach(function (p) { p.hidden = p.dataset.itrpane !== t; });
  }

  // --- Consulta ---
  function pintarLista() {
    var t = norm($('itrBuscar').value), d = $('itrDesde').value, h = $('itrHasta').value;
    var l = traslados.filter(function (x) {
      if (filtro !== 'todos' && x.estado !== filtro) return false;
      var f = String(x.fecha).slice(0, 10);
      if ((d && f < d) || (h && f > h)) return false;
      if (!t) return true;
      var prods = items.filter(function (i) { return i.traslado_id === x.id; }).map(function (i) { var p = porId(productos, i.producto_id); return p ? p.codigo + ' ' + p.nombre : ''; });
      return norm([x.numero, nombreBod(x.bodega_origen_id), nombreBod(x.bodega_destino_id), x.descripcion].concat(prods).join(' ')).indexOf(t) >= 0;
    });
    var paginas = Math.max(1, Math.ceil(l.length / PAG)); pag = Math.min(Math.max(1, pag), paginas);
    var ini = (pag - 1) * PAG, vis = l.slice(ini, ini + PAG);
    $('itrCuenta').textContent = l.length + ' traslado' + (l.length === 1 ? '' : 's');
    $('itrLista').innerHTML = vis.length ? vis.map(function (x) {
      var e = ESTADOS[x.estado] || [x.estado, 'inactivo'], n = items.filter(function (i) { return i.traslado_id === x.id; }).length;
      return '<tr data-traslado="' + x.id + '" tabindex="0" class="' + (form && form.id === x.id ? 'geo-sel' : '') + '"><td><b>' + x.numero + '</b></td><td>' + fecha(x.fecha) + '<small class="inv-sub">' + fechaHora(x.fecha).slice(12, 17) + '</small></td>' +
        '<td><span class="ia-corto">' + esc(nombreBod(x.bodega_origen_id)) + '</span><small class="inv-sub ia-corto">→ ' + esc(nombreBod(x.bodega_destino_id)) + '</small></td>' +
        '<td><span class="ia-corto" title="' + esc(x.descripcion || '') + '">' + esc(x.descripcion || '—') + '</span><small class="inv-sub">' + esc(x.operado_por || x.creado_por || '') + '</small></td>' +
        '<td class="num">' + n + '</td><td><span class="estado estado-' + e[1] + '">' + e[0] + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="geo-vacia">' + (traslados.length ? 'Ningún traslado coincide.' : 'Aún no hay traslados.') + '</td></tr>';
    $('itrPaginas').hidden = !l.length;
    $('itrPaginas').innerHTML = paginador(l.length, pag, paginas, ini, vis.length, 'traslados · toca uno para verlo');
  }
  async function cargar(mantener) {
    aviso('itrMsg', '');
    try {
      if (window.PD_SEDES) await window.PD_SEDES.cargar();
      var r = await Promise.all([
        todas(function () { return sb.from('inv_bodegas').select('id,numero,nombre,tipo,estado,localidad_id').order('numero'); }),
        todas(function () { return sb.from('inv_productos').select('id,numero,codigo,nombre,presentacion,unidad,costo,estado').order('numero'); }),
        todas(function () { return sb.from('inv_existencias').select('producto_id,bodega_id,existencia'); }),
        todas(function () { return sb.from('inv_traslados').select('*').order('numero', { ascending: false }); }),
        todas(function () { return sb.from('inv_traslado_items').select('*'); })
      ]);
      bodegas = r[0]; productos = r[1]; existencias = r[2]; traslados = r[3]; items = r[4];
    } catch (e) { traslados = []; items = []; pintarLista(); abrir(null); aviso('itrMsg', traducir(e), true); return; }
    pintarLista();
    abrir(mantener ? porId(traslados, mantener) : null);
  }
  async function grabar() {
    if (!origen() || !+$('itrDestino').value) { aviso('itrMsg', 'Elige la bodega origen y la bodega destino.', true); return null; }
    if (origen() === +$('itrDestino').value) { aviso('itrMsg', 'La bodega origen y la destino deben ser distintas.', true); return null; }
    if (!lineas.length) { aviso('itrMsg', 'Agrega al menos un producto.', true); return null; }
    aviso('itrMsg', 'Grabando…');
    var r = await sb.rpc('guardar_traslado', { p_id: form ? form.id : null,
      p_datos: { bodega_origen_id: origen(), bodega_destino_id: +$('itrDestino').value, descripcion: $('itrDesc').value, aplica_conta: $('itrConta').value === 'true' },
      p_items: lineas.map(function (l) { return { producto_id: l.producto_id, lote: l.lote, vencimiento: l.vencimiento, cantidad: l.cantidad, afecta_inventario: l.afecta_inventario }; }) });
    if (r.error) { aviso('itrMsg', traducir(r.error), true); return null; }
    await cargar(r.data);
    return r.data;
  }
  function imprimir() {
    var t = form, P = window.PD_IMPRESION;
    if (!t || !P) return;
    var th = 'padding:6px;border-bottom:2px solid #0B2B40;text-align:left;font-size:10px;text-transform:uppercase;color:#475B68', td = 'padding:6px;border-bottom:1px solid #E3EAF0;font-size:12px';
    function d(k, v, ancho) { return '<div' + (ancho ? ' style="grid-column:span ' + ancho + '"' : '') + '><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.08em">' + k + '</span><b>' + esc(v == null || v === '' ? '—' : v) + '</b></div>'; }
    var det = items.filter(function (i) { return i.traslado_id === t.id; }).sort(function (a, b) { return a.linea - b.linea; }), total = 0;
    var html = P.encabezado('Traslado de productos N.º ' + t.numero + ' · ' + (ESTADOS[t.estado] || [t.estado])[0]) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;font-size:12px">' +
      d('Bodega origen', nombreBod(t.bodega_origen_id)) + d('Bodega destino', nombreBod(t.bodega_destino_id)) + d('Fecha', fechaHora(t.fecha)) + d('Usuario', t.operado_por || t.creado_por) +
      d('Sede', sede(t)) + d('Aplica conta', t.aplica_conta ? 'Sí' : 'No') + d('Descripción', t.descripcion, 2) + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['#', 'Código', 'Producto', 'Lote', 'Vence', 'Cantidad', 'Costo unit.', 'Valor Q'].map(function (h, i) { return '<th style="' + th + (i > 4 ? ';text-align:right' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      det.map(function (i) { var p = porId(productos, i.producto_id) || {}, v = Number(i.cantidad) * Number(p.costo || 0); total += v;
        return '<tr><td style="' + td + '">' + i.linea + '</td><td style="' + td + '">' + esc(p.codigo || '') + '</td><td style="' + td + '">' + esc(p.nombre || '') + (i.afecta_inventario ? '' : ' (no afecta inventario)') + '</td><td style="' + td + '">' + esc(i.lote || '') + '</td><td style="' + td + '">' + (i.vencimiento ? fecha(i.vencimiento) : '') + '</td>' +
          '<td style="' + td + ';text-align:right">' + cant(i.cantidad) + '</td><td style="' + td + ';text-align:right">' + num(p.costo || 0) + '</td><td style="' + td + ';text-align:right">' + num(v) + '</td></tr>'; }).join('') +
      '</tbody></table><p style="text-align:right;font-size:13px;margin-top:10px"><b>Valor total Q ' + num(total) + '</b></p>' +
      '<div style="display:flex;gap:40px;margin-top:50px;font-size:11px"><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Entrega (bodega origen)</div><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Recibe (bodega destino)</div></div>' +
      '<p style="font-size:9px;color:#5A6D7A;margin-top:14px;text-align:right">Impreso por ' + esc((window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || '—') + ' · ' + fechaHora(new Date().toISOString()) + '</p></div>';
    P.imprimir(html);
  }

  // --- Eventos ---
  $('itrNuevo').addEventListener('click', async function () { if (!bodegas.length) await cargar(); abrir(null); pintarLista(); verPestana('productos'); $('itrForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('itrOrigen').focus({ preventScroll: true }); });
  $('itrModificar').addEventListener('click', function () { if (!form || form.estado !== 'grabado') return; modoEdicion = true; pintarEncabezado(); pintarLineas(); verPestana('productos'); $('itrCapProd').focus(); });
  $('itrCancelar').addEventListener('click', function () { abrir(form); aviso('itrMsg', 'Cambios descartados.'); });
  $('itrForm').addEventListener('click', function (e) { var t = e.target.closest('[data-itrtab]'); if (t) verPestana(t.dataset.itrtab); });
  ['itrOrigen', 'itrDestino', 'itrConta'].forEach(function (id) { $(id).addEventListener('change', function () { pintarLineas(); }); });
  $('itrCaptura').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); agregarCaptura(); } if (e.key === 'Escape' && lineaEdit >= 0) { limpiarCaptura(); pintarLineas(); } });
  $('itrCapProd').addEventListener('input', function (e) {
    var p = buscarProd(this.value);
    if (p) { if ($('itrCapCant').value === '') $('itrCapCant').value = 1; capMsg('Existencia en la bodega origen: ' + (origen() ? cant(existencia(p.id, origen())) : '— (elige la bodega origen)')); if (e.inputType === 'insertReplacementText' || !e.inputType) $('itrCapCant').select(); }
    else capMsg(this.value.trim() ? 'Elige un producto de la lista.' : '');
  });
  $('itrCapAgregar').addEventListener('click', agregarCaptura);
  $('itrCapCancelar').addEventListener('click', function () { limpiarCaptura(); pintarLineas(); $('itrCapProd').focus(); });
  $('itrLineas').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-editar-linea]'); if (ed) { editarLinea(+ed.dataset.editarLinea); return; }
    var b = e.target.closest('[data-quitar]');
    if (b) { var k = +b.dataset.quitar; lineas.splice(k, 1); if (lineaEdit === k) limpiarCaptura(); else if (lineaEdit > k) lineaEdit--; pintarLineas(); estadoBotones(); }
  });
  $('itrLineas').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-linea]'); if (tr && editable()) editarLinea(+tr.dataset.linea); });
  $('itrForm').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!editable()) return;
    $('itrGrabar').disabled = true; var id = await grabar(); $('itrGrabar').disabled = false;
    if (id) { var t = porId(traslados, id); aviso('itrMsg', 'Traslado N.º ' + (t ? t.numero : id) + ' grabado (aún no se ha descargado). Usa «Descargar» para mover el inventario.'); }
  });
  $('itrDescargar').addEventListener('click', async function () {
    if (!form || form.estado !== 'grabado') return;
    if (!window.confirm('¿Descargar el traslado N.º ' + form.numero + '? Los productos marcados «Inv.» saldrán de ' + nombreBod(form.bodega_origen_id) + ' e ingresarán a ' + nombreBod(form.bodega_destino_id) + '.')) return;
    var id = form.id, r = await sb.rpc('descargar_traslado', { p_id: id });
    if (r.error) { aviso('itrMsg', traducir(r.error), true); return; }
    await cargar(id); aviso('itrMsg', 'Traslado N.º ' + form.numero + ' descargado (estado Operado). Ya se refleja en el kardex de ambas bodegas.');
  });
  $('itrRevertir').addEventListener('click', function () {
    if (!form || form.estado !== 'operado') return;
    var t = form;
    G.dialogo({
      eyebrow: 'Traslado de productos', titulo: 'Revertir el traslado N.º ' + t.numero, valores: {},
      campos: [{ k: 'aviso', label: 'Efecto', tipo: 'info', ancho: 'full' }, { k: 'motivo', label: 'Motivo', tipo: 'textarea', req: true, max: 300 }],
      alAbrir: function () { $('geoF_aviso').textContent = 'Los productos regresan de ' + nombreBod(t.bodega_destino_id) + ' a ' + nombreBod(t.bodega_origen_id) + ' (movimientos en el kardex) y el traslado vuelve a «Grabado» para corregirlo.'; },
      guardar: async function (d) {
        var r = await sb.rpc('revertir_traslado', { p_id: t.id, p_motivo: d.motivo });
        if (r.error) return traducir(r.error);
        await cargar(t.id); aviso('itrMsg', 'Traslado N.º ' + t.numero + ' revertido: quedó Grabado.'); return null;
      }
    });
  });
  $('itrImprimir').addEventListener('click', imprimir);
  $('itrBuscar').addEventListener('input', function () { pag = 1; pintarLista(); });
  ['itrFiltro', 'itrDesde', 'itrHasta'].forEach(function (id) { $(id).addEventListener('change', function () { if (id === 'itrFiltro') filtro = this.value; pag = 1; pintarLista(); }); });
  $('itrPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-pag]'); if (b && !b.disabled) { pag = +b.dataset.pag; pintarLista(); } });
  $('itrLista').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-traslado]'); if (tr) { abrir(porId(traslados, +tr.dataset.traslado)); pintarLista(); verPestana('productos'); $('itrForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  $('itrLista').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-traslado]')) e.target.click(); });

  var tab = document.querySelector('[data-tab="admInvTraslados"]');
  if (tab) tab.addEventListener('click', function () { setTimeout(function () { cargar(); }, 0); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admInvTraslados').hidden) cargar(); },
    limpiar: function () { bodegas = []; productos = []; existencias = []; traslados = []; items = []; form = null; lineas = []; ['itrLista', 'itrLineas', 'itrRegistro'].forEach(function (i) { $(i).innerHTML = ''; }); }
  });
})();
