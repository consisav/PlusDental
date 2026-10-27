// Plus Dental — Inventarios (fase 2): Compras de productos (grabar, cargar al inventario, revertir, anular, abonos) y Movimiento Kardex (existencias,
// entradas, salidas y saldo). Las ventas salen del detalle de Cobros y pagos (cuentas.js). Compras, ventas y ajustes
// se graban con funciones de Supabase que crean el movimiento del kardex; todo en la sede del usuario.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admInvCompras') || !document.getElementById('admInvKardex') || !document.getElementById('admInvVentas') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var DOCS = [['factura', 'Factura'], ['recibo', 'Recibo'], ['nota_envio', 'Nota de envío'], ['otro', 'Otro']];
  var ORIGENES = { compra: 'Compra', venta: 'Venta', ajuste: 'Ajuste', anulacion_compra: 'Anulación de compra', anulacion_venta: 'Anulación de venta', reversion_compra: 'Reversión de compra', traslado: 'Traslado', reversion_traslado: 'Reversión de traslado' };
  var proveedores = [], bodegas = [], productos = [], compras = [], items = [], existencias = [], kardex = [], ultMovs = [], docsMov = { compras: [], pagos: [], traslados: [] };
  var compraSel = null, prodSel = null, lineas = [], filtroCompra = 'todas', modoEdicion = false, lineaEdit = -1, PAG_C = 6, pagCompras = 1;

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
    if (/inv_(compras|movimientos|kardex|existencias)|registrar_compra|guardar_compra|cargar_compra|revertir_carga|crear_productos_compra|no_definido|registrar_ajuste|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Compras y Kardex.';
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
      todas(function () { return sb.from('inv_productos').select('id,numero,codigo,nombre,principio_activo,presentacion,unidad,tipo_producto,clasificacion,costo,minimo,control_minimo,foto,estado,localidad_id,no_definido').order('numero'); })
    ]);
    proveedores = r[0]; bodegas = r[1]; productos = r[2];
  }
  async function cargarExistencias() {
    existencias = await todas(function () { return sb.from('inv_existencias').select('producto_id,bodega_id,existencia,ultimo_movimiento'); });
  }

  // ================= 6. Compras de productos =================
  // Consulta de compras (búsqueda, estado y fechas), encabezado (sede, usuario, estado, moneda, documento, totales, proveedor) y
  // pestañas Artículos, Abonos y Contabilidad. Una compra existente se abre en modo consulta; «Modificar» solo si está Grabada. Flujo: Grabar (estado «Grabada») → Cargar al inventario («Operada») → Revertir carga / Anular.
  var TRANSACCIONES = [['1011', 'COMPRA DE MEDICAMENTO'], ['1012', 'COMPRA DE MATERIAL DENTAL'], ['1013', 'COMPRA DE INSUMOS DESCARTABLES'], ['1014', 'COMPRA DE INSTRUMENTAL Y EQUIPO'], ['1015', 'COMPRA DE PRODUCTOS DE LIMPIEZA'], ['1016', 'MUESTRAS MÉDICAS / DONACIÓN']];
  var REGIMENES = [['PC', 'Pequeño contribuyente'], ['RU', 'Régimen sobre las utilidades'], ['ROS', 'Régimen opcional simplificado sobre ingresos']];
  var ESTADOS_C = { grabada: ['Grabada', 'inactivo'], operada: ['Operada', 'activo'], anulada: ['Anulada', 'baja'] };
  var abonos = [], pestanaCompra = 'articulos', compraForm = null;
  function opts(l, sel) { return l.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(sel) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function campo(etq, html, cls) { return '<label class="ic-campo' + (cls ? ' ' + cls : '') + '"><span>' + etq + '</span>' + html + '</label>'; }

  $('admInvCompras').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Compras de productos</h3>' +
    '<button type="button" id="icNueva" class="adm-btn adm-primary">Nueva compra</button></div>' +
    // Consultar compras
    '<section class="geo-panel ic-consulta"><div class="ik-titulo"><h4>Consultar compras</h4><span id="icConsCuenta"></span></div>' +
      '<div class="ic-cons-filtros">' + campo('Buscar compra', '<input id="icBuscar" type="search" placeholder="N.º compra, proveedor, serie o documento, producto">', 'ic-cons-buscar') +
        campo('Estado', '<select id="icFiltroSel"><option value="todas">Todas</option><option value="grabada">Grabadas</option><option value="operada">Operadas</option><option value="anulada">Anuladas</option></select>') +
        campo('Desde', '<input id="icDesdeC" type="date">') + campo('Hasta', '<input id="icHastaC" type="date">') + '</div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-cons-t"><colgroup><col class="ic-c-num"><col class="ic-c-fecha"><col><col class="ic-c-doc"><col class="ic-c-q"><col class="ic-c-q"><col class="ic-c-est"></colgroup>' +
        '<thead><tr><th>Compra</th><th>Fecha</th><th>Proveedor / bodega</th><th>Documento</th><th class="num">Total Q</th><th class="num">Saldo</th><th>Estado</th></tr></thead><tbody id="icLista"></tbody></table>' +
        '<div id="icPaginas" class="ia-paginas"></div></div></section>' +
    '<form id="icForm" class="ic-doc" novalidate>' +
    '<div id="icModo" class="ic-modo" hidden><span id="icModoTxt"></span><span class="ic-modo-btns"><button type="button" id="icCancelar" class="adm-btn geo-mini">Cancelar cambios</button><button type="button" id="icModificar" class="adm-btn adm-primary geo-mini">Modificar</button></span></div>' +
    // Barra de estado
    '<div class="ic-barra">' +
      '<div class="ic-num"><span>Compra</span><b>N.º <output id="icNumero">—</output></b></div>' +
      '<span id="icEstado" class="estado"></span>' +
      '<div class="ic-meta">' +
        '<span class="ic-chip" title="Organización y empresa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg><output id="icOrgCod"></output> · <output id="icOrgNom"></output> › <output id="icLocCod"></output> · <output id="icLocNom"></output></span>' +
        '<span class="ic-chip" title="Usuario y fecha de grabación"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><output id="icUsuario"></output> · <output id="icGrabado"></output></span>' +
      '</div>' +
      '<div class="ic-totales"><div class="ic-total"><span>Total $</span><output id="icTotalUsd">0.00</output></div><div class="ic-total ic-total-q"><span>Total Q</span><output id="icTotalQ">0.00</output></div></div>' +
    '</div>' +
    // Tarjetas
    '<div class="ic-tarjetas">' +
      '<section class="ic-tarjeta ic-fila2"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>Documento</h4><div class="ic-g2">' +
        campo('Tipo docto', '<select id="icTipoDoc">' + opts(DOCS) + '</select>') + campo('Fecha', '<input id="icFecha" type="date">') +
        campo('Serie docto', '<input id="icSerie" maxlength="20">') + campo('# Documento', '<input id="icNumDoc" maxlength="40">') +
        campo('No interno factura', '<input id="icNoInterno" class="ic-auto" readonly tabindex="-1" placeholder="Automático al grabar" title="Correlativo automático de la compra en la sede; no se puede modificar">') +
        campo('Aplica orden?', '<span class="ic-par"><select id="icAplicaOrden" class="ic-corto"><option value="no">No</option><option value="si">Sí</option></select><input id="icOrden" maxlength="40" placeholder="N.º de orden" hidden></span>') +
      '</div></section>' +
      '<section class="ic-tarjeta ic-fila3"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>Proveedor y destino</h4><div class="ic-g2">' +
        campo('Proveedor', '<span class="ic-par"><select id="icProv"></select><button type="button" id="icProvNuevo" class="ic-mas" title="Crear proveedor" aria-label="Crear proveedor">+</button></span>', 'ic-full') +
        campo('Régimen ISR', '<span class="ic-par"><input id="icRegimen" class="ic-cod" list="icRegimenes" maxlength="20"><input id="icRegimenDesc" maxlength="120"></span>', 'ic-full') +
        campo('Bodega', '<select id="icBodega"></select>') + campo('Días de crédito', '<input id="icCredito" type="number" min="0" max="365" class="num" value="0">') +
        campo('Transacción', '<select id="icTransaccion">' + opts(TRANSACCIONES.map(function (t) { return [t[0], t[0] + ' · ' + t[1]]; })) + '</select>', 'ic-full') +
      '</div></section>' +
      '<section class="ic-tarjeta ic-fila1"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1 1 9.5 15.5"/></svg>Moneda y ajustes</h4><div class="ic-g2">' +
        campo('Moneda', '<select id="icMoneda"><option value="GTQ">Quetzales</option><option value="USD">Dólares</option></select>') + campo('Cambio', '<input id="icCambio" type="number" min="0.0001" step="0.0001" class="num" value="1">') +
        campo('Compra', '<select id="icTipoCompra"><option value="local">Local</option><option value="importacion">Importación</option></select>') + campo('Descuentos', '<input id="icDescuentos" type="number" min="0" step="0.01" class="num" placeholder="0.00">') +
        campo('Nota crédito', '<input id="icNotaCredito" type="number" min="0" step="0.01" class="num" placeholder="0.00">') +
        campo('<span class="ic-ret"><input id="icAplicaRet" type="checkbox" aria-label="Aplica retención"> Retención</span>', '<input id="icRetencion" type="number" min="0" step="0.01" class="num" placeholder="0.00" aria-label="Valor de la retención">') +
        campo('Formulario retención', '<input id="icFormRet" maxlength="40">', 'ic-full') +
      '</div></section>' +
    '</div>' +
    '<div class="ic-tarjeta ic-desc">' + campo('Descripción', '<input id="icObs" maxlength="500" placeholder="Detalle u observaciones de la compra">') +
      '<label class="ic-check"><input id="icMuestras" type="checkbox"> Documento de muestras</label></div>' +
    '<datalist id="icRegimenes">' + REGIMENES.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + '</option>'; }).join('') + '</datalist>' +
    '<datalist id="icProdLista"></datalist>' +
    '<div class="ic-tabs" role="tablist">' + [['articulos', 'Artículos'], ['abonos', 'Abonos'], ['contabilidad', 'Contabilidad']].map(function (t) {
      return '<button type="button" role="tab" data-ictab="' + t[0] + '" aria-selected="' + (t[0] === pestanaCompra) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    // Artículos
    '<section class="ic-pane" data-icpane="articulos">' +
    '<div id="icCaptura" class="ic-captura"><div class="ic-cap-f1">' +
      campo('Producto (código o nombre)', '<input id="icCapProd" list="icProdLista" maxlength="240" placeholder="Escribe el código o el nombre y elige de la lista" autocomplete="off">', 'ic-cap-prod') +
      campo('Cantidad', '<input id="icCapCant" type="number" min="0" step="0.0001" class="num">') + campo('Costo unitario', '<input id="icCapCosto" type="number" min="0" step="0.0001" class="num">') +
      campo('Descuento', '<input id="icCapDesc" type="number" min="0" step="0.01" class="num" placeholder="0.00">') + campo('Total', '<output id="icCapTotal" class="ic-cap-total">0.00</output>') +
      '<span class="ic-cap-btns"><button type="button" id="icCapAgregar" class="adm-btn adm-primary">+ Agregar</button><button type="button" id="icCapCancelar" class="adm-btn geo-mini" hidden>Cancelar</button></span></div>' +
      '<div class="ic-cap-f2">' + campo('Lote', '<input id="icCapLote" maxlength="40">') + campo('Fabricación', '<input id="icCapFab" type="date">') + campo('Vencimiento', '<input id="icCapVence" type="date">') +
      '<label class="ic-check"><input id="icCapInv" type="checkbox" checked> Afecta inventario</label><label class="ic-check"><input id="icCapFecha" type="checkbox"> Controla vencimiento</label>' +
      '<span id="icCapMsg" class="ic-cap-msg" role="status">Enter agrega el artículo</span></div></div>' +
    '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-det"><colgroup><col class="ic-d-n"><col><col class="ic-d-cant"><col class="ic-d-cu"><col class="ic-d-desc"><col class="ic-d-tot"><col class="ic-d-mi"><col class="ic-d-acc"></colgroup>' +
      '<thead><tr><th>#</th><th>Producto · lote · fechas</th><th class="num">Cantidad</th><th class="num">Costo unit.</th><th class="num">Desc.</th><th class="num">Total Q</th><th class="num" title="Moneda internacional (dólares)">Total MI</th><th><span class="sr-only">Acciones</span></th></tr></thead>' +
      '<tbody id="icLineas"></tbody></table>' +
      '<div class="ic-det-pie"><span><b id="icCuenta">0</b> artículos</span><span>Subtotal Q <b id="icSumQ">0.00</b> · MI $ <b id="icSumMi">0.00</b></span></div></div>' +
    '<div class="ic-botones ic-blq ic-naranja">' +
      '<button type="submit" id="icGrabar" class="adm-btn adm-primary">Grabar</button>' +
      '<button type="button" id="icCargar" class="adm-btn">Cargar al inventario</button>' +
      '<button type="button" id="icRevertir" class="adm-btn">Revertir carga</button><span class="ic-sep"></span>' +
      '<button type="button" id="icAnular" class="adm-btn">Anular</button><span class="ic-sep"></span>' +
      '<button type="button" id="icImprimir" class="adm-btn">Imprimir</button>' +
      '<button type="button" id="icCrearProd" class="adm-btn">Crear producto</button>' +
      '<button type="button" id="icPagos" class="adm-btn">Aplicar pagos</button></div></section>' +
    // Abonos (sub-detalle de la factura)
    '<section class="ic-pane" data-icpane="abonos" hidden><p class="dlg-msg" id="icAbonosInfo"></p><div class="roles-wrap"><table class="pr-tabla ic-abonos"><thead><tr><th>Cuenta bancaria</th><th>Desc docto</th><th>Fecha pago</th><th class="num">Total</th><th class="num">Total MI</th><th></th></tr></thead>' +
      '<tbody id="icAbonos"></tbody><tfoot><tr><td><button type="button" id="icAbonoNuevo" class="adm-btn geo-mini">+ Agregar abono</button></td><td></td><td class="num">Total</td><td class="num"><b id="icAbonoQ">0.00</b></td><td class="num"><b id="icAbonoMi">0.00</b></td><td></td></tr></tfoot></table></div>' +
      '<div class="ic-botones"><button type="button" id="icAbonosGrabar" class="adm-btn adm-primary">Grabar abonos</button><span id="icSaldo" class="ic-saldo"></span></div></section>' +
    // Contabilidad
    '<section class="ic-pane" data-icpane="contabilidad" hidden><p class="dlg-msg">Partida sugerida (informativa) según el total, el régimen del proveedor y la retención. El IVA de 12 % se separa solo en facturas de proveedores que no son pequeños contribuyentes.</p><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead><tbody id="icConta"></tbody></table></div></section>' +
    '<p id="icMsg" class="dlg-msg" role="status"></p><div id="icRegistro"></div></form></div>';

  function documento(c) { return (DOCS.filter(function (d) { return d[0] === c.tipo_documento; })[0] || ['', c.tipo_documento || ''])[1] + (c.serie || c.numero_documento ? ' ' + [c.serie, c.numero_documento].filter(Boolean).join('-') : ''); }
  function abonadoDe(id) { return abonos.filter(function (a) { return a.compra_id === id && !a.borrar; }).reduce(function (s, a) { return s + (Number(a.total) || 0); }, 0); }
  function editable() { return !compraForm || (compraForm.estado === 'grabada' && modoEdicion); }
  function cambio() { return Math.max(Number($('icCambio').value) || 1, 0.0001); }
  function enUsd() { return $('icMoneda').value === 'USD'; }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // --- Cálculos de una línea (en la moneda de la compra, en quetzales y en moneda internacional) ---
  function calc(l) {
    var cu = Number(l.costo_unitario) || 0, sub = Math.max(r2((Number(l.cantidad) || 0) * cu - (Number(l.descuento) || 0)), 0), tc = cambio();
    var q2 = enUsd() ? r2(sub * tc) : sub;
    return { sub: sub, q: q2, cuMi: enUsd() ? cu : cu / tc, subMi: r2(q2 / tc) };
  }
  function totales() {
    var sq = 0, smi = 0;
    lineas.forEach(function (l) { var c = calc(l); sq += c.q; smi += c.subMi; });
    var t = Math.max(r2(sq - (Number($('icDescuentos').value) || 0) - (Number($('icNotaCredito').value) || 0)), 0);
    $('icSumQ').textContent = num(enUsd() ? smi : sq); $('icSumMi').textContent = num(smi);
    $('icTotalQ').textContent = num(t); $('icTotalUsd').textContent = num(t / cambio());
    $('icCuenta').textContent = lineas.filter(function (l) { return l.nombre || l.producto_id; }).length;
    pintarConta(t);
    return t;
  }
  // Artículo que se está digitando en la barra de captura
  function buscarProd(t) {
    var v = norm(t).trim(); if (!v) return null;
    return productos.filter(function (x) { return norm(x.codigo) === v || norm(x.nombre) === v || norm((x.codigo ? x.codigo + ' · ' : '') + x.nombre) === v; })[0] || null;
  }
  function lineaCaptura() {
    var t = $('icCapProd').value.trim(), p = buscarProd(t), cod = '', nom = t;
    if (!p && t.indexOf(' · ') > 0) { cod = t.split(' · ')[0].trim(); nom = t.slice(t.indexOf(' · ') + 3).trim(); }
    return { producto_id: p ? p.id : null, codigo: p ? p.codigo || '' : cod, nombre: p ? p.nombre : nom, lote: $('icCapLote').value.trim(), fecha_fabricacion: $('icCapFab').value, vencimiento: $('icCapVence').value,
      cantidad: $('icCapCant').value, costo_unitario: $('icCapCosto').value, descuento: $('icCapDesc').value, afecta_inventario: $('icCapInv').checked, controla_fecha: $('icCapFecha').checked };
  }
  function capMsg(t, error) { $('icCapMsg').textContent = t || 'Enter agrega el artículo'; $('icCapMsg').classList.toggle('error', !!error); }
  function limpiarCaptura() {
    lineaEdit = -1;
    ['icCapProd', 'icCapCant', 'icCapCosto', 'icCapDesc', 'icCapLote', 'icCapFab', 'icCapVence'].forEach(function (id) { $(id).value = ''; });
    $('icCapInv').checked = true; $('icCapFecha').checked = false; $('icCapTotal').textContent = '0.00';
    $('icCapAgregar').textContent = '+ Agregar'; $('icCapCancelar').hidden = true; capMsg('');
  }
  function totalCaptura() { $('icCapTotal').textContent = num(calc(lineaCaptura()).q); }
  function agregarCaptura() {
    var l = lineaCaptura();
    if (!l.nombre) { capMsg('Escribe el producto.', true); $('icCapProd').focus(); return; }
    if (!(Number(l.cantidad) > 0)) { capMsg('La cantidad debe ser mayor que cero.', true); $('icCapCant').focus(); return; }
    if (l.controla_fecha && !l.vencimiento) { capMsg('Indica la fecha de vencimiento (la línea controla vencimiento).', true); $('icCapVence').focus(); return; }
    if (l.fecha_fabricacion && l.vencimiento && l.vencimiento < l.fecha_fabricacion) { capMsg('El vencimiento no puede ser anterior a la fabricación.', true); $('icCapVence').focus(); return; }
    if (lineaEdit >= 0) lineas[lineaEdit] = l; else lineas.push(l);
    limpiarCaptura(); pintarLineas(); estadoBotones(); $('icCapProd').focus();
  }
  function editarLinea(k) {
    var l = lineas[k]; if (!l) return;
    lineaEdit = k;
    $('icCapProd').value = (l.codigo ? l.codigo + ' · ' : '') + l.nombre; $('icCapCant').value = l.cantidad; $('icCapCosto').value = l.costo_unitario; $('icCapDesc').value = l.descuento;
    $('icCapLote').value = l.lote || ''; $('icCapFab').value = l.fecha_fabricacion || ''; $('icCapVence').value = l.vencimiento || '';
    $('icCapInv').checked = !!l.afecta_inventario; $('icCapFecha').checked = !!l.controla_fecha;
    $('icCapAgregar').textContent = 'Actualizar línea ' + (k + 1); $('icCapCancelar').hidden = false; capMsg('Modificando la línea ' + (k + 1) + '. Enter para actualizar.');
    totalCaptura(); pintarLineas(); $('icCapCant').focus();
  }
  function pintarLineas() {
    var ed = editable();
    $('icCaptura').hidden = !ed;
    if (!ed && lineaEdit >= 0) limpiarCaptura();
    $('icLineas').innerHTML = lineas.length ? lineas.map(function (l, k) {
      var p = l.producto_id ? porId(productos, l.producto_id) : null, c = calc(l);
      var marca = p ? (p.no_definido ? ' <span class="inv-alerta">No definido</span>' : '') : ' <span class="inv-alerta" title="No existe en el inventario: usa «Crear producto»">Nuevo</span>';
      var extra = [l.lote ? 'Lote ' + esc(l.lote) : 'Sin lote', l.fecha_fabricacion ? 'fab. ' + fecha(l.fecha_fabricacion) : '', l.vencimiento ? 'vence ' + fecha(l.vencimiento) : (l.controla_fecha ? '' : 'no controla vencimiento'),
        l.afecta_inventario ? '' : 'no afecta inventario'].filter(Boolean).join(' · ');
      return '<tr data-linea="' + k + '" class="' + (p ? '' : 'ic-sin-prod') + (k === lineaEdit ? ' ic-editando' : '') + '"><td class="ik-cod">' + (k + 1) + '</td>' +
        '<td><b class="ic-d-nom">' + esc((l.codigo ? l.codigo + ' · ' : '') + l.nombre) + '</b>' + marca + '<small class="inv-sub ia-corto">' + extra + '</small></td>' +
        '<td class="num">' + cant(l.cantidad) + '</td><td class="num">' + num(l.costo_unitario, 4) + '</td><td class="num">' + (Number(l.descuento) ? num(l.descuento) : '—') + '</td>' +
        '<td class="num"><b>' + num(c.q) + '</b></td><td class="num ic-mi">' + num(c.subMi) + '<small class="inv-sub">c/u ' + num(c.cuMi, 4) + '</small></td>' +
        '<td class="ic-d-acc">' + (ed ? '<button type="button" class="ic-ico" data-editar-linea="' + k + '" aria-label="Modificar línea ' + (k + 1) + '" title="Modificar">✎</button><button type="button" class="ic-ico ic-ico-x" data-quitar="' + k + '" aria-label="Quitar línea ' + (k + 1) + '" title="Quitar">×</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="geo-vacia">' + (ed ? 'Aún no hay artículos. Digítalos en la barra de arriba y presiona Enter.' : 'Sin artículos.') + '</td></tr>';
    totales();
  }
  function pintarEncabezado() {
    var c = compraForm || {}, S = window.PD_SEDES, loc = c.localidad_id || (S && S.miLocalidad());
    var o = S && loc ? S.organizacion(loc) : null, l = S && loc ? S.localidad(loc) : null;
    $('icOrgCod').textContent = o ? o.codigo : '—'; $('icOrgNom').textContent = o ? o.nombre : '';
    $('icLocCod').textContent = l && o ? o.codigo + '-' + String(l.codigo).padStart(2, '0') : '—'; $('icLocNom').textContent = l ? (l.nombre_comercial || l.razon_social) : '';
    $('icUsuario').textContent = c.creado_por || (window.PD_SESION && window.PD_SESION.usuario()) || '—';
    $('icGrabado').textContent = c.creado ? fechaHora(c.creado) : 'sin grabar';
    var e = ESTADOS_C[c.estado] || ['Nueva', 'inactivo'];
    $('icEstado').className = 'estado estado-' + e[1]; $('icEstado').textContent = e[0];
    $('icNumero').textContent = c.numero || 'nueva';
    $('icProv').innerHTML = '<option value="">Sin proveedor</option>' + proveedores.filter(function (p) { return p.estado === 'activo' || p.id === c.proveedor_id; }).map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === c.proveedor_id ? ' selected' : '') + '>' + esc((p.numero ? p.numero + ' · ' : '') + (p.padre_id ? '› ' : '') + p.nombre_comercial) + '</option>'; }).join('');
    $('icBodega').innerHTML = opcionesBodega(c.bodega_id || bodegaGeneral());
    var v = { icMoneda: c.moneda || 'GTQ', icTipoCompra: c.tipo_compra || 'local', icNotaCredito: c.nota_credito ? c.nota_credito : '', icDescuentos: c.descuentos ? c.descuentos : '', icRetencion: c.valor_retencion ? c.valor_retencion : '',
      icSerie: c.serie || '', icNumDoc: c.numero_documento || '', icFecha: c.fecha || hoy(), icCambio: c.tipo_cambio || 1, icNoInterno: c.numero ? String(c.numero) : '', icOrden: c.orden_compra || '',
      icFormRet: c.formulario_retencion || '', icRegimen: c.regimen_isr || '', icRegimenDesc: c.regimen_isr_desc || '', icTipoDoc: c.tipo_documento || 'factura',
      icTransaccion: c.transaccion || '1011', icCredito: c.dias_credito || 0, icObs: c.observaciones || '' };
    Object.keys(v).forEach(function (k) { $(k).value = v[k]; });
    $('icNumero').parentNode.firstChild.textContent = c.numero ? 'N.º ' : '';
    $('icAplicaOrden').value = c.orden_compra ? 'si' : 'no'; $('icOrden').hidden = !c.orden_compra;
    $('icAplicaRet').checked = !!c.aplica_retencion; $('icMuestras').checked = !!c.documento_muestras;
    var ed = editable();
    $('icForm').querySelectorAll('.ic-tarjetas input, .ic-tarjetas select, .ic-desc input, #icProvNuevo').forEach(function (x) { x.disabled = !ed; });
    $('icNoInterno').disabled = true;
    $('icRetencion').disabled = !ed || !$('icAplicaRet').checked; $('icFormRet').disabled = !ed || !$('icAplicaRet').checked;
    estadoBotones();
  }
  // Botones según el estado de la compra y su registro de auditoría
  function estadoBotones() {
    var c = compraForm || {}, ed = editable();
    var guardada = !!c.id, sinProd = lineas.some(function (x) { return !x.producto_id && (x.nombre || x.codigo); });
    $('icGrabar').disabled = !ed;
    var modo = '', puedeMod = false;
    if (guardada) {
      if (c.estado === 'grabada' && modoEdicion) modo = 'Modificando la compra N.º ' + c.numero + '. Presiona «Grabar» para guardar los cambios.';
      else if (c.estado === 'grabada') { modo = 'Compra N.º ' + c.numero + ' · Grabada · modo consulta. Puedes modificarla porque aún no se ha cargado al inventario.'; puedeMod = true; }
      else if (c.estado === 'operada') modo = 'Compra N.º ' + c.numero + ' · Operada · solo consulta: ya fue cargada al inventario. Para modificarla, primero «Revertir carga».';
      else modo = 'Compra N.º ' + c.numero + ' · Anulada · solo consulta.';
    }
    $('icModo').hidden = !guardada; $('icModoTxt').textContent = modo;
    $('icModo').className = 'ic-modo' + (modoEdicion && c.estado === 'grabada' ? ' editando' : c.estado === 'grabada' ? '' : ' bloqueada');
    $('icModificar').hidden = !(c.estado === 'grabada' && !modoEdicion); $('icModificar').disabled = !puedeMod;
    $('icCancelar').hidden = !(c.estado === 'grabada' && modoEdicion);
    $('icCargar').disabled = !(guardada && c.estado === 'grabada');
    $('icRevertir').disabled = c.estado !== 'operada';
    $('icAnular').disabled = !(guardada && c.estado !== 'anulada' && window.PD_SEDES && window.PD_SEDES.esSuper());
    $('icAnular').title = window.PD_SEDES && window.PD_SEDES.esSuper() ? '' : 'Solo el Super Administrador anula compras.';
    $('icImprimir').disabled = !guardada;
    $('icCrearProd').disabled = !((!guardada || c.estado === 'grabada') && sinProd);
    $('icPagos').disabled = !(guardada && c.estado !== 'anulada');
    $('icRegistro').innerHTML = guardada ? '<div class="org-registro"><div class="org-reg-datos"><span>Sede <b>' + esc(sede(c)) + '</b></span>' +
      '<span>Grabado por <b>' + esc(c.creado_por || '—') + '</b> el <b>' + fechaHora(c.creado) + '</b></span>' +
      (c.modificado ? '<span>Modificado por <b>' + esc(c.modificado_por || '—') + '</b> el <b>' + fechaHora(c.modificado) + '</b></span>' : '') +
      (c.cargado_en ? '<span>Cargado al inventario por <b>' + esc(c.cargado_por || '—') + '</b> el <b>' + fechaHora(c.cargado_en) + '</b></span>' : '') +
      (c.estado === 'anulada' ? '<span class="inv-negativo">Anulada por <b>' + esc(c.anulado_por || '—') + '</b> el <b>' + fechaHora(c.anulado_en) + '</b> · ' + esc(c.anulado_motivo || '') + '</span>' : '') +
      '</div></div>' : '';
  }
  function pintarCompra() {
    pintarEncabezado(); pintarLineas(); pintarAbonos(); estadoBotones();
  }
  function cargarEnFormulario(c) {
    compraForm = c || null; modoEdicion = false; lineaEdit = -1;
    var usd = c && c.moneda === 'USD', tc = (c && Number(c.tipo_cambio)) || 1;
    lineas = c ? items.filter(function (i) { return i.compra_id === c.id; }).sort(function (a, b) { return a.linea - b.linea; }).map(function (i) {
      var p = porId(productos, i.producto_id);
      return { producto_id: i.producto_id, codigo: i.codigo || (p && p.codigo) || '', nombre: i.nombre || (p && p.nombre) || '', lote: i.lote || '', fecha_fabricacion: i.fecha_fabricacion || '', vencimiento: i.vencimiento || '',
        cantidad: Number(i.cantidad), costo_unitario: usd ? Number(i.costo_unitario_mi) : Number(i.costo_unitario), descuento: Number(i.descuento) ? (usd ? r2(i.descuento / tc) : Number(i.descuento)) : '',
        afecta_inventario: i.afecta_inventario !== false, controla_fecha: !!i.controla_fecha };
    }) : [];
    $('icProdLista').innerHTML = productos.filter(function (p) { return p.estado === 'activo'; }).map(function (p) { return '<option value="' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '">' + esc([p.presentacion, p.unidad].filter(Boolean).join(' · ')) + '</option>'; }).join('');
    limpiarCaptura();
    aviso('icMsg', '');
    pintarCompra();
  }
  function verPestana(t) {
    pestanaCompra = t;
    $('icForm').querySelectorAll('[data-ictab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.ictab === t); });
    $('icForm').querySelectorAll('[data-icpane]').forEach(function (p) { p.hidden = p.dataset.icpane !== t; });
  }

  // --- Consulta de compras ---
  function pintarCompras() {
    var t = norm($('icBuscar').value), desde = $('icDesdeC').value, hasta = $('icHastaC').value;
    var l = compras.filter(function (c) {
      if (filtroCompra !== 'todas' && c.estado !== filtroCompra) return false;
      if ((desde && c.fecha < desde) || (hasta && c.fecha > hasta)) return false;
      if (!t) return true;
      var nombres = items.filter(function (i) { return i.compra_id === c.id; }).map(function (i) { return [i.codigo, i.nombre].join(' '); });
      return norm([c.numero, nombreProv(c.proveedor_id), documento(c), c.no_interno, c.observaciones].concat(nombres).join(' ')).indexOf(t) >= 0;
    });
    var paginas = Math.max(1, Math.ceil(l.length / PAG_C));
    pagCompras = Math.min(Math.max(1, pagCompras), paginas);
    var ini = (pagCompras - 1) * PAG_C, vis = l.slice(ini, ini + PAG_C);
    $('icConsCuenta').textContent = l.length + ' compra' + (l.length === 1 ? '' : 's');
    $('icLista').innerHTML = vis.length ? vis.map(function (c) {
      var ab = abonadoDe(c.id), saldo = c.estado === 'anulada' ? 0 : Number(c.total) - Number(c.valor_retencion || 0) - ab, e = ESTADOS_C[c.estado] || [c.estado, 'inactivo'];
      return '<tr data-compra="' + c.id + '" tabindex="0" class="' + (compraForm && c.id === compraForm.id ? 'geo-sel' : '') + '"><td><b>' + c.numero + '</b></td><td>' + fecha(c.fecha) + '</td>' +
        '<td><b class="ia-corto">' + esc(nombreProv(c.proveedor_id)) + '</b><small class="inv-sub ia-corto">' + esc(nombreBod(c.bodega_id)) + '</small></td><td><span class="ia-corto" title="' + esc(documento(c)) + '">' + esc(documento(c)) + '</span></td>' +
        '<td class="num"><b>' + q(c.total) + '</b></td><td class="num' + (saldo > 0.004 ? ' inv-bajo' : '') + '">' + q(saldo) + '</td><td><span class="estado estado-' + e[1] + '">' + e[0] + '</span></td></tr>';
    }).join('') : '<tr><td colspan="7" class="geo-vacia">' + (compras.length ? 'Ninguna compra coincide.' : 'Aún no hay compras.') + '</td></tr>';
    var botones = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - pagCompras) <= 1) botones.push(n); else if (botones[botones.length - 1] !== '…') botones.push('…');
    $('icPaginas').hidden = !l.length;
    $('icPaginas').innerHTML = l.length ? '<span>' + (ini + 1) + '–' + (ini + vis.length) + ' de ' + l.length + ' compras · toca una para verla</span>' + (paginas > 1 ? '<nav aria-label="Páginas de compras"><button type="button" class="ia-pag" data-pag="' + (pagCompras - 1) + '"' + (pagCompras === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      botones.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag="' + n + '"' + (n === pagCompras ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag="' + (pagCompras + 1) + '"' + (pagCompras === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
  }
  async function cargarCompras(mantener) {
    aviso('icMsg', '');
    try {
      await cargarCatalogos();
      compras = await todas(function () { return sb.from('inv_compras').select('*').order('numero', { ascending: false }); });
      items = await todas(function () { return sb.from('inv_compra_items').select('*'); });
      abonos = await todas(function () { return sb.from('inv_compra_abonos').select('*').order('fecha_pago').order('id'); });
    } catch (e) { compras = []; items = []; abonos = []; pintarCompras(); cargarEnFormulario(null); aviso('icMsg', traducir(e), true); return; }
    pintarCompras();
    cargarEnFormulario(mantener ? porId(compras, mantener) : null);
  }

  // --- Abonos ---
  function abonosDe() { return compraForm ? abonos.filter(function (a) { return a.compra_id === compraForm.id && !a.borrar; }) : []; }
  function pintarAbonos() {
    var l = abonosDe(), ed = compraForm && compraForm.estado !== 'anulada', dis = ed ? '' : ' disabled';
    $('icAbonosInfo').textContent = compraForm ? 'Abonos de la compra N.º ' + compraForm.numero + ' · ' + nombreProv(compraForm.proveedor_id) + ' · ' + documento(compraForm) : 'Graba la compra o elígela en «Consultar compras» para aplicarle pagos.';
    $('icAbonos').innerHTML = l.length ? l.map(function (a) {
      var k = abonos.indexOf(a);
      function inp(c, tipo, extra) { return '<input data-ab="' + c + '"' + (tipo ? ' type="' + tipo + '"' : '') + ' value="' + esc(a[c] == null ? '' : a[c]) + '"' + (extra || '') + dis + '>'; }
      return '<tr data-abono="' + k + '"><td>' + inp('cuenta_bancaria', '', ' maxlength="80" placeholder="Banco y cuenta"') + '</td><td>' + inp('descripcion', '', ' maxlength="200" placeholder="Cheque, transferencia…"') + '</td><td>' + inp('fecha_pago', 'date') + '</td>' +
        '<td class="num">' + inp('total', 'number', ' min="0" step="0.01"') + '</td><td class="num">' + inp('total_mi', 'number', ' min="0" step="0.01"') + '</td>' +
        '<td>' + (ed ? '<button type="button" class="adm-btn geo-mini" data-quitar-abono="' + k + '" aria-label="Quitar abono">×</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="geo-vacia">Sin abonos.</td></tr>';
    $('icAbonoNuevo').hidden = !ed; $('icAbonosGrabar').hidden = !ed;
    var tq = l.reduce(function (s, a) { return s + (Number(a.total) || 0); }, 0), tm = l.reduce(function (s, a) { return s + (Number(a.total_mi) || 0); }, 0);
    $('icAbonoQ').textContent = num(tq); $('icAbonoMi').textContent = num(tm);
    if (compraForm) {
      var porPagar = Number(compraForm.total) - Number(compraForm.valor_retencion || 0), saldo = porPagar - tq;
      $('icSaldo').innerHTML = 'Por pagar <b>' + q(porPagar) + '</b> · Abonado <b>' + q(tq) + '</b> · Saldo <b class="' + (saldo > 0.004 ? 'inv-bajo' : '') + '">' + q(saldo) + '</b>';
    } else $('icSaldo').textContent = '';
  }

  // --- Contabilidad (partida sugerida) ---
  function pintarConta(total) {
    var ret = $('icAplicaRet').checked ? Number($('icRetencion').value) || 0 : 0, pc = $('icRegimen').value.trim().toUpperCase() === 'PC';
    var conIva = $('icTipoDoc').value === 'factura' && !pc, base = conIva ? r2(total / 1.12) : total, iva = r2(total - base);
    var cuentaInv = $('icMuestras').checked ? 'Muestras médicas' : 'Inventario de ' + ((TRANSACCIONES.filter(function (t) { return t[0] === $('icTransaccion').value; })[0] || ['', 'productos'])[1].replace(/^COMPRA DE /, '').toLowerCase());
    var f = [[cuentaInv, base, 0]];
    if (iva) f.push(['IVA por cobrar (crédito fiscal)', iva, 0]);
    f.push(['Proveedores' + ($('icProv').value ? ' · ' + nombreProv(+$('icProv').value) : ''), 0, r2(total - ret)]);
    if (ret) f.push(['Retenciones por pagar' + ($('icFormRet').value ? ' · formulario ' + $('icFormRet').value : ''), 0, ret]);
    $('icConta').innerHTML = f.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num">' + (x[1] ? q(x[1]) : '') + '</td><td class="num">' + (x[2] ? q(x[2]) : '') + '</td></tr>'; }).join('') +
      '<tr class="inv-total"><td class="num">Totales</td><td class="num"><b>' + q(base + iva) + '</b></td><td class="num"><b>' + q(total) + '</b></td></tr>';
  }

  // --- Datos para grabar ---
  function datosEncabezado() {
    return { proveedor_id: $('icProv').value, bodega_id: $('icBodega').value, fecha: $('icFecha').value || hoy(), tipo_documento: $('icTipoDoc').value,
      serie: $('icSerie').value, numero_documento: $('icNumDoc').value, dias_credito: $('icCredito').value || 0, observaciones: $('icObs').value,
      moneda: $('icMoneda').value, tipo_compra: $('icTipoCompra').value, tipo_cambio: cambio(), no_interno: compraForm && compraForm.numero ? String(compraForm.numero) : '',
      orden_compra: $('icAplicaOrden').value === 'si' ? $('icOrden').value : '', nota_credito: $('icNotaCredito').value || 0, descuentos: $('icDescuentos').value || 0,
      aplica_retencion: $('icAplicaRet').checked, valor_retencion: $('icAplicaRet').checked ? $('icRetencion').value || 0 : 0, formulario_retencion: $('icAplicaRet').checked ? $('icFormRet').value : '',
      regimen_isr: $('icRegimen').value, regimen_isr_desc: $('icRegimenDesc').value, transaccion: $('icTransaccion').value, documento_muestras: $('icMuestras').checked };
  }
  async function grabar() {
    var usadas = lineas.filter(function (l) { return l.nombre || l.codigo || l.cantidad || l.costo_unitario; });
    if (!$('icBodega').value) { aviso('icMsg', 'Elige la bodega.', true); return null; }
    if (!usadas.length) { aviso('icMsg', 'Agrega al menos un artículo.', true); return null; }
    if (usadas.some(function (l) { return !l.nombre && !l.producto_id; })) { aviso('icMsg', 'Escribe el nombre del producto en cada línea.', true); return null; }
    if (usadas.some(function (l) { return !(Number(l.cantidad) > 0); })) { aviso('icMsg', 'La cantidad de cada artículo debe ser mayor que cero.', true); return null; }
    if (usadas.some(function (l) { return l.controla_fecha && !l.vencimiento; })) { aviso('icMsg', 'Las líneas que controlan fecha necesitan la fecha de vencimiento.', true); return null; }
    var det = usadas.map(function (l) { return { producto_id: l.producto_id, codigo: l.codigo, nombre: l.nombre, lote: l.lote, fecha_fabricacion: l.fecha_fabricacion, vencimiento: l.vencimiento,
      cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) || 0, descuento: Number(l.descuento) || 0, afecta_inventario: !!l.afecta_inventario, controla_fecha: !!l.controla_fecha }; });
    aviso('icMsg', 'Grabando…');
    var r = await sb.rpc('guardar_compra', { p_id: compraForm ? compraForm.id : null, p_datos: datosEncabezado(), p_items: det });
    if (r.error) { aviso('icMsg', traducir(r.error), true); return null; }
    await cargarCompras(r.data);
    return r.data;
  }
  function confirmarMotivo(titulo, efecto, rpc, args, exito) {
    G.dialogo({
      eyebrow: 'Compras de productos', titulo: titulo, valores: {},
      campos: [{ k: 'aviso', label: 'Efecto', tipo: 'info', ancho: 'full' }, { k: 'motivo', label: 'Motivo', tipo: 'textarea', req: true, max: 300 }],
      alAbrir: function () { $('geoF_aviso').textContent = efecto; },
      guardar: async function (d) {
        var r = await sb.rpc(rpc, Object.assign({ p_motivo: d.motivo }, args));
        if (r.error) return traducir(r.error);
        await cargarCompras(args.p_id); aviso('icMsg', exito); return null;
      }
    });
  }
  function imprimirCompra() {
    var c = compraForm, P = window.PD_IMPRESION;
    if (!c || !P) return;
    var th = 'padding:6px;border-bottom:2px solid #0B2B40;text-align:left;font-size:11px', td = 'padding:6px;border-bottom:1px solid #E3EAF0;font-size:12px';
    var det = items.filter(function (i) { return i.compra_id === c.id; }).sort(function (a, b) { return a.linea - b.linea; });
    function d(k, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.08em">' + k + '</span><b>' + esc(v == null || v === '' ? '—' : v) + '</b></div>'; }
    var e = ESTADOS_C[c.estado] || [c.estado];
    var html = P.encabezado('Compra N.º ' + c.numero + ' · ' + e[0]) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;font-size:12px">' +
      d('Proveedor', nombreProv(c.proveedor_id)) + d('Documento', documento(c)) + d('Fecha', fecha(c.fecha)) + d('Bodega', nombreBod(c.bodega_id)) +
      d('Moneda / cambio', (c.moneda === 'USD' ? 'Dólares' : 'Quetzales') + ' · ' + num(c.tipo_cambio, 4)) + d('Compra', c.tipo_compra === 'importacion' ? 'Importación' : 'Local') +
      d('Transacción', (TRANSACCIONES.filter(function (t) { return t[0] === c.transaccion; })[0] || [c.transaccion, ''])[1]) + d('No interno', c.numero) + d('Sede', sede(c)) + d('Grabado por', c.creado_por) + d('Crédito', +c.dias_credito ? c.dias_credito + ' días' : 'Contado') + d('Descripción', c.observaciones) + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['#', 'Código', 'Producto', 'Lote', 'Vence', 'Cantidad', 'Costo unit.', 'Desc.', 'Costo total Q'].map(function (h, i) { return '<th style="' + th + (i > 4 ? ';text-align:right' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      det.map(function (i) { return '<tr><td style="' + td + '">' + i.linea + '</td><td style="' + td + '">' + esc(i.codigo || '') + '</td><td style="' + td + '">' + esc(i.nombre || (porId(productos, i.producto_id) || {}).nombre || '') + '</td><td style="' + td + '">' + esc(i.lote || '') + '</td><td style="' + td + '">' + (i.vencimiento ? fecha(i.vencimiento) : '') + '</td>' +
        '<td style="' + td + ';text-align:right">' + cant(i.cantidad) + '</td><td style="' + td + ';text-align:right">' + num(i.costo_unitario, 4) + '</td><td style="' + td + ';text-align:right">' + num(i.descuento) + '</td><td style="' + td + ';text-align:right">' + num(i.subtotal) + '</td></tr>'; }).join('') +
      '</tbody></table><div style="margin-top:12px;text-align:right;font-size:13px;line-height:1.7">' +
      (Number(c.descuentos) ? 'Descuentos: ' + q(c.descuentos) + '<br>' : '') + (Number(c.nota_credito) ? 'Nota de crédito: ' + q(c.nota_credito) + '<br>' : '') +
      '<b style="font-size:16px">Total Q ' + num(c.total) + '</b> · Total $ ' + num(c.total_usd) + (Number(c.valor_retencion) ? '<br>Retención: ' + q(c.valor_retencion) + (c.formulario_retencion ? ' (formulario ' + esc(c.formulario_retencion) + ')' : '') : '') +
      '<br>Abonado: ' + q(abonadoDe(c.id)) + '</div></div>';
    P.imprimir(html);
  }

  // --- Eventos ---
  $('icNueva').addEventListener('click', async function () { if (!productos.length) await cargarCompras(); cargarEnFormulario(null); pintarCompras(); verPestana('articulos'); $('icForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('icProv').focus({ preventScroll: true }); });
  $('icModificar').addEventListener('click', function () { if (!compraForm || compraForm.estado !== 'grabada') return; modoEdicion = true; pintarCompra(); verPestana('articulos'); aviso('icMsg', ''); $('icCapProd').focus(); });
  $('icCancelar').addEventListener('click', function () { cargarEnFormulario(compraForm); aviso('icMsg', 'Cambios descartados.'); });
  $('icForm').addEventListener('click', function (e) { var t = e.target.closest('[data-ictab]'); if (t) verPestana(t.dataset.ictab); });
  $('icAplicaOrden').addEventListener('change', function () { $('icOrden').hidden = this.value !== 'si'; if (!$('icOrden').hidden) $('icOrden').focus(); });
  $('icAplicaRet').addEventListener('change', function () { $('icRetencion').disabled = $('icFormRet').disabled = !this.checked; if (!this.checked) $('icRetencion').value = ''; totales(); });
  $('icProv').addEventListener('change', function () { var p = porId(proveedores, +this.value); $('icCredito').value = p ? p.dias_credito || 0 : 0; totales(); });
  $('icRegimen').addEventListener('input', function () { var r = REGIMENES.filter(function (x) { return x[0] === this.value.trim().toUpperCase(); }, this)[0]; if (r) $('icRegimenDesc').value = r[1]; totales(); });
  ['icMoneda', 'icCambio', 'icDescuentos', 'icNotaCredito', 'icRetencion', 'icTipoDoc', 'icTransaccion', 'icFormRet', 'icMuestras'].forEach(function (id) { $(id).addEventListener(id === 'icMoneda' || id === 'icMuestras' || id === 'icTipoDoc' || id === 'icTransaccion' ? 'change' : 'input', id === 'icMoneda' || id === 'icCambio' ? pintarLineas : function () { totales(); }); });
  $('icProvNuevo').addEventListener('click', function () {
    G.dialogo({
      eyebrow: 'Compras de productos', titulo: 'Nuevo proveedor', valores: { dias_credito: 0 },
      campos: [{ k: 'nombre_comercial', label: 'Nombre comercial', req: true, max: 150 }, { k: 'nit', label: 'NIT', max: 20 }, { k: 'telefonos', label: 'Teléfonos', max: 120 }, { k: 'dias_credito', label: 'Días de crédito', tipo: 'number' }],
      guardar: async function (d) {
        d.dias_credito = d.dias_credito || 0;
        var r = await sb.from('inv_proveedores').insert(d).select('id,numero,nombre_comercial,dias_credito,estado,padre_id').single();
        if (r.error) return traducir(r.error);
        proveedores.push(r.data);
        var sel = r.data.id;
        $('icProv').insertAdjacentHTML('beforeend', '<option value="' + sel + '">' + esc((r.data.numero ? r.data.numero + ' · ' : '') + r.data.nombre_comercial) + '</option>');
        $('icProv').value = sel; $('icCredito').value = r.data.dias_credito || 0;
        return null;
      }
    });
  });
  // Barra de captura: Enter agrega (o actualiza) el artículo
  $('icCaptura').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); agregarCaptura(); } if (e.key === 'Escape' && lineaEdit >= 0) { limpiarCaptura(); pintarLineas(); } });
  $('icCaptura').addEventListener('input', function (e) {
    if (e.target.id === 'icCapProd') {
      var p = buscarProd(e.target.value);
      if (p) { if ($('icCapCosto').value === '' && p.costo != null) $('icCapCosto').value = enUsd() ? r2(p.costo / cambio()) : Number(p.costo); if ($('icCapCant').value === '') $('icCapCant').value = 1;
        capMsg('Producto ' + (p.numero || p.id) + ' · ' + [p.presentacion, p.unidad].filter(Boolean).join(' · ')); if (e.inputType === 'insertReplacementText' || !e.inputType) $('icCapCant').select(); }
      else capMsg(e.target.value.trim() ? 'No existe en el inventario: se agregará como «Nuevo» (luego «Crear producto»).' : '');
    }
    totalCaptura();
  });
  $('icCapAgregar').addEventListener('click', agregarCaptura);
  $('icCapCancelar').addEventListener('click', function () { limpiarCaptura(); pintarLineas(); $('icCapProd').focus(); });
  $('icLineas').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-editar-linea]'); if (ed) { editarLinea(+ed.dataset.editarLinea); return; }
    var b = e.target.closest('[data-quitar]');
    if (b) { var k = +b.dataset.quitar; lineas.splice(k, 1); if (lineaEdit === k) limpiarCaptura(); else if (lineaEdit > k) lineaEdit--; pintarLineas(); estadoBotones(); }
  });
  $('icLineas').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-linea]'); if (tr && editable()) editarLinea(+tr.dataset.linea); });
  $('icForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!editable()) return;
    $('icGrabar').disabled = true;
    var id = await grabar();
    $('icGrabar').disabled = false;
    if (id) { var c = porId(compras, id); aviso('icMsg', 'Compra N.º ' + (c ? c.numero : id) + ' grabada (aún no está cargada al inventario). Usa «Cargar al inventario» cuando esté completa.'); }
  });
  $('icCargar').addEventListener('click', async function () {
    if (!compraForm) return;
    // Primero se graban los cambios pendientes
    var id = await grabar(); if (!id) return;
    if (lineas.some(function (l) { return !l.producto_id; })) { aviso('icMsg', 'Hay artículos que no existen en el inventario. Usa «Crear producto» antes de cargar.', true); return; }
    if (!window.confirm('¿Cargar al inventario la compra N.º ' + compraForm.numero + '? Los artículos marcados «Inv?» ingresarán a ' + nombreBod(compraForm.bodega_id) + '.')) return;
    var r = await sb.rpc('cargar_compra', { p_id: id });
    if (r.error) { aviso('icMsg', traducir(r.error), true); return; }
    await cargarCompras(id); aviso('icMsg', 'Compra N.º ' + compraForm.numero + ' cargada al inventario (estado Operada).');
  });
  $('icRevertir').addEventListener('click', function () {
    if (!compraForm) return;
    confirmarMotivo('Revertir la carga de la compra N.º ' + compraForm.numero, 'Los artículos cargados saldrán de ' + nombreBod(compraForm.bodega_id) + ' (salida en el kardex) y la compra volverá a «Grabada» para corregirla y cargarla de nuevo.',
      'revertir_carga_compra', { p_id: compraForm.id }, 'Carga revertida: la compra N.º ' + compraForm.numero + ' quedó Grabada.');
  });
  $('icAnular').addEventListener('click', function () {
    if (!compraForm) return;
    confirmarMotivo('Anular la compra N.º ' + compraForm.numero, (compraForm.estado === 'operada' ? 'Los artículos cargados saldrán de ' + nombreBod(compraForm.bodega_id) + ' (salida en el kardex). ' : '') + 'La compra quedará Anulada y no se puede deshacer.',
      'anular_compra', { p_id: compraForm.id }, 'Compra N.º ' + compraForm.numero + ' anulada.');
  });
  $('icImprimir').addEventListener('click', imprimirCompra);
  $('icCrearProd').addEventListener('click', async function () {
    var nuevos = lineas.filter(function (l) { return !l.producto_id && (l.nombre || l.codigo); });
    if (!nuevos.length) return;
    if (!window.confirm('Se crearán en «Definición de productos» ' + nuevos.length + ' producto(s) marcados como «No definido»:\n' + nuevos.map(function (l) { return '· ' + [l.codigo, l.nombre].filter(Boolean).join(' — '); }).join('\n') + '\n\nPodrás completar su definición después. ¿Continuar?')) return;
    var id = await grabar(); if (!id) return;
    var r = await sb.rpc('crear_productos_compra', { p_id: id });
    if (r.error) { aviso('icMsg', traducir(r.error), true); return; }
    await cargarCompras(id);
    aviso('icMsg', r.data ? r.data + ' producto(s) creado(s) como «No definido». Complétalos en «Definición de productos». Ya puedes cargar la compra al inventario.' : 'Los artículos ya existían en el inventario y quedaron enlazados.');
  });
  $('icPagos').addEventListener('click', function () {
    if (!compraForm) return;
    verPestana('abonos');
    if (!abonosDe().length) $('icAbonoNuevo').click();
  });
  // Abonos
  $('icAbonoNuevo').addEventListener('click', function () {
    if (!compraForm) return;
    abonos.push({ compra_id: compraForm.id, cuenta_bancaria: '', descripcion: '', fecha_pago: hoy(), total: '', total_mi: '' });
    pintarAbonos();
    var i = $('icAbonos').querySelectorAll('[data-ab="cuenta_bancaria"]'); if (i.length) i[i.length - 1].focus();
  });
  $('icAbonos').addEventListener('input', function (e) {
    var tr = e.target.closest('tr[data-abono]'), c = e.target.dataset.ab; if (!tr || !c) return;
    var a = abonos[+tr.dataset.abono];
    a[c] = e.target.value; a.cambiado = true;
    if (c === 'total') { a.total_mi = e.target.value ? r2(Number(e.target.value) / (Number(compraForm.tipo_cambio) || 1)) : ''; tr.querySelector('[data-ab="total_mi"]').value = a.total_mi; }
    var l = abonosDe();
    $('icAbonoQ').textContent = num(l.reduce(function (s, x) { return s + (Number(x.total) || 0); }, 0)); $('icAbonoMi').textContent = num(l.reduce(function (s, x) { return s + (Number(x.total_mi) || 0); }, 0));
  });
  $('icAbonos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-quitar-abono]'); if (!b) return;
    var a = abonos[+b.dataset.quitarAbono];
    if (a.id) a.borrar = true; else abonos.splice(abonos.indexOf(a), 1);
    pintarAbonos();
  });
  $('icAbonosGrabar').addEventListener('click', async function () {
    if (!compraForm) return;
    var mios = abonos.filter(function (a) { return a.compra_id === compraForm.id; });
    if (mios.some(function (a) { return !a.borrar && !(Number(a.total) > 0); })) { aviso('icMsg', 'Cada abono necesita un total mayor que cero.', true); return; }
    this.disabled = true; aviso('icMsg', 'Grabando abonos…');
    var err = null;
    for (var i = 0; i < mios.length && !err; i++) {
      var a = mios[i], d = { cuenta_bancaria: a.cuenta_bancaria || null, descripcion: a.descripcion || null, fecha_pago: a.fecha_pago || hoy(), total: Number(a.total), total_mi: Number(a.total_mi) || 0 }, r = null;
      if (a.id && a.borrar) r = await sb.from('inv_compra_abonos').delete().eq('id', a.id);
      else if (a.id && a.cambiado) r = await sb.from('inv_compra_abonos').update(d).eq('id', a.id);
      else if (!a.id) r = await sb.from('inv_compra_abonos').insert(Object.assign({ compra_id: compraForm.id }, d));
      if (r && r.error) err = r.error;
    }
    this.disabled = false;
    var id = compraForm.id;
    await cargarCompras(id); verPestana('abonos');
    aviso('icMsg', err ? traducir(err) : 'Abonos grabados.', !!err);
  });
  // Listado
  $('icBuscar').addEventListener('input', function () { pagCompras = 1; pintarCompras(); });
  ['icFiltroSel', 'icDesdeC', 'icHastaC'].forEach(function (id) { $(id).addEventListener('change', function () { if (id === 'icFiltroSel') filtroCompra = this.value; pagCompras = 1; pintarCompras(); }); });
  $('icPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-pag]'); if (b && !b.disabled) { pagCompras = +b.dataset.pag; pintarCompras(); } });
  $('icLista').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-compra]'); if (tr) { cargarEnFormulario(porId(compras, +tr.dataset.compra)); pintarCompras(); verPestana('articulos'); $('icForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  $('icLista').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-compra]')) e.target.click(); });

  // ================= 7. Movimiento Kardex (maestro - detalle) =================
  // Maestro: productos con su existencia en la bodega elegida (o en todas). Detalle: cada movimiento del producto con
  // documento interno y físico, lote, fabricación, vencimiento, cantidades, existencia por lote y del producto, y costos
  // (unitario, del movimiento, promedio ponderado y total). Lote y documentos salen de las compras y los pagos.
  var MOVS = { compra: [1, 'Ingreso - compra'], anulacion_compra: [7, 'Anulación ingreso'], reversion_compra: [40, 'Reversión ingreso'], venta: [19, 'Salida - factura'], anulacion_venta: [20, 'Anulación - factura'], ajuste_entrada: [5, 'Ajuste entrada'], ajuste_salida: [6, 'Ajuste salida'],
    traslado_entrada: [21, 'Traslado - ingreso'], traslado_salida: [22, 'Traslado - salida'], reversion_traslado_entrada: [41, 'Reversión traslado - ingreso'], reversion_traslado_salida: [42, 'Reversión traslado - salida'] };
  function tipoMov(m) { return MOVS[/^(ajuste|traslado|reversion_traslado)$/.test(m.origen) ? m.origen + '_' + m.tipo : m.origen] || [0, m.origen]; }
  $('admInvKardex').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Movimientos de productos en bodega (Kardex)</h3>' +
    '<div class="ik-acciones"><button type="button" id="ikImprimir" class="adm-btn">Imprimir</button><button type="button" id="ikAjuste" class="adm-btn adm-primary">Ajuste de inventario</button></div></div>' +
    '<div class="ik-filtros">' +
      '<label class="ik-campo"><span>Bodega</span><select id="ikBodega" class="adm-input"></select></label>' +
      '<label class="ik-campo"><span>Fecha inicial</span><input id="ikDesde" type="date" class="adm-input"></label>' +
      '<label class="ik-campo"><span>Fecha final</span><input id="ikHasta" type="date" class="adm-input"></label>' +
      '<label class="ik-campo ik-producto"><span>Producto</span><select id="ikProducto" class="adm-input"><option value="">Todos los productos</option></select></label>' +
      '<div class="ik-campo"><span>Mostrar</span><div class="inv-filtros" id="ikFiltro">' + [['con', 'Con movimientos'], ['minimo', 'Bajo el mínimo'], ['todos', 'Todos']].map(function (o, i) { return '<button type="button" class="adm-btn geo-mini" data-valor="' + o[0] + '" aria-pressed="' + (i === 0) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
      '<label class="ik-campo ik-buscar"><span>Buscar en la lista</span><input id="ikBuscar" type="search" class="adm-input" placeholder="Código, nombre o principio activo" aria-label="Buscar producto"></label>' +
      '<label class="ik-check"><input id="ikInactivos" type="checkbox"> Incluir inactivos</label>' +
    '</div>' +
    // Maestro
    '<section class="geo-panel ik-maestro"><div class="ik-titulo"><h4>Productos</h4><span id="ikCuenta"></span></div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ik-tabla-m"><colgroup><col class="ik-c-cod"><col><col class="ik-c-fecha"><col class="ik-c-op"><col class="ik-c-doc"><col class="ik-c-num"><col class="ik-c-num"><col class="ik-c-valor"></colgroup>' +
      '<thead><tr><th>Código</th><th>Producto / principio activo</th><th>Fecha</th><th>Operación</th><th>Documento</th><th class="num">Exist. anterior</th><th class="num">Exist. actual</th><th class="num">Valor / costo</th></tr></thead><tbody id="ikExist"></tbody></table>' +
      '<div id="ikPaginas" class="ia-paginas"></div></div></section>' +
    // Detalle
    '<section class="geo-panel ik-detalle" id="ikDetalle" hidden></section>' +
    '<p id="ikMsg" class="dlg-msg" role="status"></p></div>';
  var filtroKardex = 'con', kardexVista = [], PAG_KDX = 8, pagKdx = 1;
  function bodKardex() { return +$('ikBodega').value || null; }
  function ultimoMov(prodId, bod) {
    for (var i = 0; i < ultMovs.length; i++) { var m = ultMovs[i]; if (m.producto_id === prodId && (!bod || m.bodega_id === bod)) return m; }
    return null;
  }
  function operacion(m) {
    var t = { compra: ['Compra', 'ik-op-compra'], venta: ['Venta', 'ik-op-venta'], ajuste: [m.tipo === 'entrada' ? 'Ajuste (entrada)' : 'Ajuste (salida)', 'ik-op-ajuste'],
      anulacion_compra: ['Anulación de compra', 'ik-op-anul'], reversion_compra: ['Reversión de compra', 'ik-op-anul'], anulacion_venta: ['Anulación de venta', 'ik-op-anul'],
      traslado: [m.tipo === 'entrada' ? 'Traslado (entrada)' : 'Traslado (salida)', 'ik-op-traslado'], reversion_traslado: [m.tipo === 'entrada' ? 'Rev. traslado (entrada)' : 'Rev. traslado (salida)', 'ik-op-anul'] }[m.origen];
    return t || [ORIGENES[m.origen] || m.origen, 'ik-op-ajuste'];
  }
  function documentoMov(m) {
    var c = m.compra_id ? porId(docsMov.compras, m.compra_id) : null, pg = m.pago_id ? porId(docsMov.pagos, m.pago_id) : null, tr = m.traslado_id ? porId(docsMov.traslados, m.traslado_id) : null;
    if (tr) return ['Traslado N.º ' + tr.numero, nombreBod(tr.bodega_origen_id) + ' → ' + nombreBod(tr.bodega_destino_id)];
    if (c) return ['Compra N.º ' + c.numero, [(DOCS.filter(function (d) { return d[0] === c.tipo_documento; })[0] || ['', ''])[1], [c.serie, c.numero_documento].filter(Boolean).join('-')].filter(Boolean).join(' ')];
    if (pg) return [pg.tipo_documento === 'factura' && pg.numero_factura ? 'Factura ' + ['FE', pg.serie, pg.numero_factura].filter(Boolean).join('-') : 'Recibo REC-' + (pg.correlativo || pg.id), 'Cobro N.º ' + (pg.correlativo || pg.id)];
    return ['Ajuste N.º ' + m.id, m.observaciones || ''];
  }
  function pintarExistencias() {
    var t = norm($('ikBuscar').value), bod = bodKardex(), inactivos = $('ikInactivos').checked;
    var conMov = {};
    existencias.forEach(function (x) { if (!bod || x.bodega_id === bod) conMov[x.producto_id] = true; });
    var unico = +$('ikProducto').value || null;
    var l = unico ? productos.filter(function (p) { return p.id === unico; }) : productos.filter(function (p) {
      if (!inactivos && p.estado !== 'activo') return false;
      if (t && norm([p.numero, p.codigo, p.nombre, p.principio_activo, p.tipo_producto].join(' ')).indexOf(t) < 0) return false;
      var ex = existencia(p.id, bod);
      if (filtroKardex === 'con') return conMov[p.id];
      if (filtroKardex === 'minimo') return p.minimo != null && ex < Number(p.minimo);
      return true;
    });
    $('ikFiltro').classList.toggle('ik-apagado', !!unico); $('ikBuscar').disabled = !!unico;
    var valor = l.reduce(function (t, p) { return t + existencia(p.id, bod) * Number(p.costo || 0); }, 0);
    var paginas = Math.max(1, Math.ceil(l.length / PAG_KDX));
    pagKdx = Math.min(Math.max(1, pagKdx), paginas);
    var ini = (pagKdx - 1) * PAG_KDX, vis = l.slice(ini, ini + PAG_KDX);
    $('ikCuenta').textContent = l.length + ' producto' + (l.length === 1 ? '' : 's') + (bod ? ' · ' + nombreBod(bod) : ' · todas las bodegas');
    $('ikExist').innerHTML = vis.length ? vis.map(function (p) {
      var ex = existencia(p.id, bod), bajo = p.minimo != null && ex < Number(p.minimo);
      var m = ultimoMov(p.id, bod), op = m ? operacion(m) : null, doc = m ? documentoMov(m) : null;
      var antes = m ? ex - (m.tipo === 'entrada' ? 1 : -1) * Number(m.cantidad) : null;
      return '<tr data-prod="' + p.id + '" tabindex="0" class="' + (p.id === prodSel ? 'geo-sel' : '') + '"><td><b class="ik-codigo">' + esc(p.codigo || '—') + '</b><small class="inv-sub">N.º ' + (p.numero || p.id) + '</small></td>' +
        '<td><div class="inv-prod">' + imagen(p, 32) + '<div><b class="ik-nombre">' + esc(p.nombre) + '</b>' + (p.principio_activo ? '<small class="inv-sub ia-corto" title="' + esc(p.principio_activo) + '">' + esc(p.principio_activo) + '</small>' : '') +
          (p.estado !== 'activo' ? '<span class="estado estado-' + p.estado + '">' + (p.estado === 'baja' ? 'Baja' : 'Inactivo') + '</span>' : '') + '</div></div></td>' +
        (m ? '<td>' + fecha(m.fecha) + '<small class="inv-sub">' + fechaHora(m.fecha).slice(12, 17) + '</small></td><td><span class="ik-op ' + op[1] + '">' + esc(op[0]) + '</span><small class="inv-sub">' + (m.tipo === 'entrada' ? '+' : '−') + cant(m.cantidad) + '</small></td>' +
          '<td><span class="ia-corto" title="' + esc(doc[0]) + '">' + esc(doc[0]) + '</span><small class="inv-sub ia-corto" title="' + esc(doc[1]) + '">' + esc(doc[1] || '—') + '</small></td><td class="num">' + cant(antes) + '</td>'
          : '<td colspan="4" class="ik-sinmov">Sin movimientos</td>') +
        '<td class="num"><b class="' + (ex < 0 ? 'inv-negativo' : bajo ? 'inv-bajo' : '') + '">' + cant(ex) + '</b>' + (bajo ? '<small class="inv-sub">mín. ' + cant(Number(p.minimo)) + '</small>' : '') + '</td>' +
        '<td class="num"><b>' + q(ex * Number(p.costo || 0)) + '</b><small class="inv-sub">c/u ' + q(p.costo) + '</small></td></tr>';
    }).join('') + '<tr class="inv-total"><td colspan="7" class="num">Valor del inventario mostrado (' + l.length + ' producto' + (l.length === 1 ? '' : 's') + ')</td><td class="num"><b>' + q(valor) + '</b></td></tr>'
      : '<tr><td colspan="8" class="geo-vacia">' + (filtroKardex === 'con' ? 'Aún no hay movimientos. Registra una compra o un ajuste de inventario inicial.' : 'Ningún producto coincide.') + '</td></tr>';
    var botones = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - pagKdx) <= 1) botones.push(n); else if (botones[botones.length - 1] !== '…') botones.push('…');
    $('ikPaginas').hidden = !l.length;
    $('ikPaginas').innerHTML = l.length ? '<span>' + (ini + 1) + '–' + (ini + vis.length) + ' de ' + l.length + ' productos</span>' + (paginas > 1 ? '<nav aria-label="Páginas de productos"><button type="button" class="ia-pag" data-pag="' + (pagKdx - 1) + '"' + (pagKdx === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      botones.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag="' + n + '"' + (n === pagKdx ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag="' + (pagKdx + 1) + '"' + (pagKdx === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
  }
  // Movimientos del producto con sus documentos, lote, existencias corridas y costo promedio ponderado
  async function datosKardex(p, bod) {
    var movs = await todas(function () { var c = sb.from('inv_movimientos').select('*').eq('producto_id', p.id).order('fecha').order('id'); return bod ? c.eq('bodega_id', bod) : c; });
    var idsC = movs.map(function (m) { return m.compra_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var idsP = movs.map(function (m) { return m.pago_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var cs = idsC.length ? (await sb.from('inv_compras').select('id,numero,serie,numero_documento,tipo_documento').in('id', idsC)).data || [] : [];
    var its = idsC.length ? (await sb.from('inv_compra_items').select('compra_id,producto_id,lote,fecha_fabricacion,vencimiento').in('compra_id', idsC).eq('producto_id', p.id)).data || [] : [];
    var ps = idsP.length ? (await sb.from('pagos').select('id,correlativo,tipo_documento,serie,numero_factura').in('id', idsP)).data || [] : [];
    var idsT = movs.map(function (m) { return m.traslado_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var ts = idsT.length ? (await sb.from('inv_traslados').select('id,numero,bodega_origen_id,bodega_destino_id').in('id', idsT)).data || [] : [];
    var exist = 0, prom = 0, porLote = {};
    movs.forEach(function (m, k) {
      var c = m.compra_id ? porId(cs, m.compra_id) : null, it = m.compra_id ? its.filter(function (i) { return i.compra_id === m.compra_id; })[0] : null, pg = m.pago_id ? porId(ps, m.pago_id) : null, tr = m.traslado_id ? porId(ts, m.traslado_id) : null;
      var n = Number(m.cantidad), cu = Number(m.costo_unitario || 0), entra = m.tipo === 'entrada';
      m.n = k + 1; m.mov = tipoMov(m);
      m.interno = c ? c.numero : pg ? (pg.correlativo || pg.id) : tr ? tr.numero : m.id;
      m.fisico = tr ? nombreBod(tr.bodega_origen_id) + ' → ' + nombreBod(tr.bodega_destino_id) : c ? [c.serie, c.numero_documento].filter(Boolean).join('-') : pg ? (pg.tipo_documento === 'factura' && pg.numero_factura ? 'FE-' + [pg.serie, pg.numero_factura].filter(Boolean).join('-') : 'REC-' + (pg.correlativo || pg.id)) : '';
      m.lote = it ? it.lote : ''; m.fab = it ? it.fecha_fabricacion : null; m.venc = it ? it.vencimiento : null;
      if (entra && exist + n > 0) prom = exist > 0 ? (exist * prom + n * cu) / (exist + n) : cu;
      exist += entra ? n : -n;
      if (m.lote) { porLote[m.lote] = (porLote[m.lote] || 0) + (entra ? n : -n); m.existLote = porLote[m.lote]; } else m.existLote = null;
      m.existProd = exist; m.costoMov = n * cu; m.prom = prom; m.costoTotal = Math.max(exist, 0) * prom;
    });
    return movs;
  }
  function prefijoDoc(m) { return /venta/.test(m.origen) ? 'Cobro ' : m.origen === 'ajuste' ? 'Ajuste ' : /traslado/.test(m.origen) ? 'Traslado ' : 'Compra '; }
  function iniciales(u) { var p = String(u || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '').slice(1, 2))).toUpperCase(); }
  // Celdas de un movimiento: [fecha, movimiento, documento, lote, cantidad, existencias, costos, promedio/total, usuario]
  function celdasKardex(m) {
    var entra = m.tipo === 'entrada', f = fechaHora(m.fecha);
    return [
      fecha(m.fecha) + '<small>' + f.slice(12, 17) + ' · #' + m.n + '</small>',
      '<span class="ik-chip ' + (entra ? 'ik-chip-in' : 'ik-chip-out') + '">' + m.mov[0] + ' · ' + esc(m.mov[1]) + '</span>' + (m.observaciones ? '<small>' + esc(m.observaciones) + '</small>' : ''),
      '<b>' + esc(prefijoDoc(m) + m.interno) + '</b><small>' + esc(m.fisico || '—') + '</small>',
      (m.lote ? esc(m.lote) : '<span class="ik-tenue">—</span>') + (m.fab || m.venc ? '<small>' + [m.fab ? 'fab. ' + fecha(m.fab) : '', m.venc ? 'v. ' + fecha(m.venc) : ''].filter(Boolean).join(' · ') + '</small>' : ''),
      '<b class="' + (entra ? 'ik-in' : 'ik-out') + '">' + (entra ? '+' : '−') + cant(m.cantidad) + '</b>',
      '<b class="' + (m.existProd < 0 ? 'inv-negativo' : '') + '">' + cant(m.existProd) + '</b><small>' + (m.existLote == null ? '—' : 'lote ' + cant(m.existLote)) + '</small>',
      num(m.costo_unitario, 4) + '<small>' + num(m.costoMov, 2) + '</small>',
      num(m.prom, 4) + '<small><b>' + num(m.costoTotal, 2) + '</b></small>',
      '<span class="ik-usr"><span class="ik-av" aria-hidden="true">' + esc(iniciales(m.usuario)) + '</span><span class="ia-corto" title="' + esc(m.usuario || 'Sin usuario') + '">' + esc(m.usuario || 'Sin usuario') + '</span></span>'
    ];
  }
  var CAB_DETALLE = ['Fecha · #', 'Movimiento', 'Docto. interno / físico', 'Lote · fab. · vence', 'Cantidad', 'Exist. producto / lote', 'Costo unit. / movto.', 'Promedio / total', 'Usuario'];
  var NUM_DETALLE = [4, 5, 6, 7];
  function cabDetalle() { return '<colgroup><col class="ik-d-fecha"><col class="ik-d-mov"><col class="ik-d-doc"><col class="ik-d-lote"><col class="ik-d-cant"><col class="ik-d-exist"><col class="ik-d-costo"><col class="ik-d-prom"><col class="ik-d-usr"></colgroup><thead><tr>' +
    CAB_DETALLE.map(function (h, i) { return '<th' + (NUM_DETALLE.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead>'; }
  function filaKardex(m) { return '<tr class="inv-mov-' + m.tipo + '">' + celdasKardex(m).map(function (c, i) { return '<td' + (NUM_DETALLE.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }
  function filaAnterior(k) { return '<tr class="ik-anterior"><td colspan="5">Saldo anterior al ' + fecha(k.desde) + '</td><td class="num"><b>' + cant(k.saldoAnt.existProd) + '</b></td><td></td><td class="num">' + num(k.saldoAnt.prom, 4) + '<small><b>' + num(k.saldoAnt.costoTotal, 2) + '</b></small></td><td></td></tr>'; }
  async function pintarKardex() {
    var p = porId(productos, prodSel);
    $('ikDetalle').hidden = !p;
    if (!p) return;
    $('ikDetalle').innerHTML = '<p class="geo-vacia">Cargando movimientos…</p>';
    var bod = bodKardex(), desde = $('ikDesde').value, hasta = $('ikHasta').value;
    var movs;
    try { movs = await datosKardex(p, bod); } catch (e) { $('ikDetalle').innerHTML = '<p class="dlg-msg" style="color:#9A3B2E">' + esc(traducir(e)) + '</p>'; return; }
    // Las existencias se calculan con todo el historial; el rango de fechas solo filtra lo que se muestra
    var antes = movs.filter(function (m) { return desde && String(m.fecha).slice(0, 10) < desde; });
    var vista = movs.filter(function (m) { var f = String(m.fecha).slice(0, 10); return (!desde || f >= desde) && (!hasta || f <= hasta); });
    var saldoAnt = antes.length ? antes[antes.length - 1] : null;
    var te = 0, ts = 0;
    vista.forEach(function (m) { if (m.tipo === 'entrada') te += Number(m.cantidad); else ts += Number(m.cantidad); });
    kardexVista = { p: p, bod: bod, desde: desde, hasta: hasta, vista: vista, saldoAnt: saldoAnt, te: te, ts: ts };
    var ultimo = movs.length ? movs[movs.length - 1] : null;
    $('ikDetalle').innerHTML = '<div class="ik-titulo ik-cab"><div class="inv-prod">' + imagen(p, 40) + '<div><h4>' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '</h4><small class="inv-sub">' + esc([p.principio_activo, p.presentacion, bod ? nombreBod(bod) : 'Todas las bodegas'].filter(Boolean).join(' · ')) + '</small></div></div>' +
      '<div class="ik-resumen"><div><span>Ingresos</span><b class="ik-in">' + cant(te) + '</b></div><div><span>Salidas</span><b class="ik-out">' + cant(ts) + '</b></div><div><span>Existencia</span><b>' + cant(ultimo ? ultimo.existProd : 0) + '</b></div><div><span>Costo promedio</span><b>' + q(ultimo ? ultimo.prom : 0) + '</b></div><div><span>Costo total</span><b>' + q(ultimo ? ultimo.costoTotal : 0) + '</b></div></div></div>' +
      '<div class="roles-wrap ia-wrap ik-scroll-d"><table class="geo-tabla ik-det">' + cabDetalle() + '<tbody>' +
      (vista.length ? vista.slice().reverse().map(filaKardex).join('') : '<tr><td colspan="9" class="geo-vacia">Sin movimientos' + (desde || hasta ? ' en el rango de fechas' : '') + (bod ? ' en esta bodega' : '') + '.</td></tr>') +
      (saldoAnt ? filaAnterior(kardexVista) : '') +
      '</tbody></table></div>' +
      '<div class="org-reg-btns"><button type="button" class="adm-btn geo-mini" data-ajustar="' + p.id + '">Ajuste de este producto</button><button type="button" class="adm-btn geo-mini" id="ikActualizar">Actualizar</button></div>';
  }
  function imprimirKardex() {
    var P = window.PD_IMPRESION, k = kardexVista;
    if (!P) return;
    if (!k || !k.p) { aviso('ikMsg', 'Elige un producto para imprimir su kardex.', true); return; }
    var ult = k.vista.length ? k.vista[k.vista.length - 1] : k.saldoAnt;
    var css = '<style>.ikr{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9.5px}.ikr th{font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#475B68;text-align:left;padding:5px 4px;border-bottom:2px solid #0B2B40;vertical-align:bottom}' +
      '.ikr td{padding:5px 4px;border-bottom:1px solid #E3EAF0;vertical-align:top;overflow:hidden}.ikr .num{text-align:right;font-variant-numeric:tabular-nums}.ikr small{display:block;color:#5A6D7A;font-size:8.5px;margin-top:1px}' +
      '.ikr tr{page-break-inside:avoid}.ik-chip{font-weight:700}.ik-chip-in,.ik-in{color:#047857}.ik-chip-out,.ik-out{color:#B42318}.ik-av{display:none}.ik-anterior td{background:#F1F5F8;font-style:italic}.ik-tenue{color:#94A6B2}' +
      '.ikr-res{display:flex;gap:8px;margin:0 0 10px}.ikr-res div{flex:1;border:1px solid #D7E3EC;border-radius:6px;padding:5px 8px}.ikr-res span{display:block;font-size:8.5px;color:#5A6D7A;text-transform:uppercase}.ikr-res b{font-size:12px}</style>';
    var cols = '<colgroup><col style="width:9%"><col style="width:14%"><col style="width:12%"><col><col style="width:7%"><col style="width:9%"><col style="width:10%"><col style="width:10%"><col style="width:11%"></colgroup>';
    var html = css + P.encabezado('Kardex · ' + (k.p.codigo ? k.p.codigo + ' · ' : '') + k.p.nombre) +
      '<p style="font-size:11px;color:#475B68;margin:0 0 8px">' + esc([k.p.principio_activo, k.p.presentacion, k.bod ? nombreBod(k.bod) : 'Todas las bodegas', (k.desde ? 'Del ' + fecha(k.desde) : 'Desde el inicio') + (k.hasta ? ' al ' + fecha(k.hasta) : '')].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="ikr-res"><div><span>Ingresos</span><b>' + cant(k.te) + '</b></div><div><span>Salidas</span><b>' + cant(k.ts) + '</b></div><div><span>Existencia</span><b>' + cant(ult ? ult.existProd : 0) + '</b></div><div><span>Costo promedio</span><b>' + q(ult ? ult.prom : 0) + '</b></div><div><span>Costo total</span><b>' + q(ult ? ult.costoTotal : 0) + '</b></div></div>' +
      '<table class="ikr">' + cols + '<thead><tr>' + CAB_DETALLE.map(function (h, i) { return '<th' + (NUM_DETALLE.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (k.vista.length ? k.vista.slice().reverse().map(filaKardex).join('') : '<tr><td colspan="9">Sin movimientos.</td></tr>') + (k.saldoAnt ? filaAnterior(k) : '') + '</tbody></table>' +
      '<p style="font-size:9px;color:#5A6D7A;margin-top:10px;text-align:right">Impreso por ' + esc((window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || '—') + ' · ' + fechaHora(new Date().toISOString()) + '</p></div>';
    P.imprimir(html);
  }
  // Movimientos más recientes primero (para el último movimiento de cada producto) y los documentos que los respaldan
  async function cargarUltimos() {
    ultMovs = await todas(function () { return sb.from('inv_movimientos').select('id,producto_id,bodega_id,fecha,origen,tipo,cantidad,compra_id,pago_id,traslado_id,observaciones').order('fecha', { ascending: false }).order('id', { ascending: false }); });
    ultMovs.sort(function (x, y) { return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : y.id - x.id; });
    var vistos = {}, idsC = [], idsP = [], idsT = [];
    ultMovs.forEach(function (m) {
      var k = m.producto_id + '-' + m.bodega_id, k2 = m.producto_id + '-*';
      if (vistos[k] && vistos[k2]) return;
      vistos[k] = vistos[k2] = true;
      if (m.compra_id && idsC.indexOf(m.compra_id) < 0) idsC.push(m.compra_id);
      if (m.pago_id && idsP.indexOf(m.pago_id) < 0) idsP.push(m.pago_id);
      if (m.traslado_id && idsT.indexOf(m.traslado_id) < 0) idsT.push(m.traslado_id);
    });
    var r = await Promise.all([idsC.length ? sb.from('inv_compras').select('id,numero,serie,numero_documento,tipo_documento').in('id', idsC) : { data: [] },
      idsP.length ? sb.from('pagos').select('id,correlativo,tipo_documento,serie,numero_factura').in('id', idsP) : { data: [] },
      idsT.length ? sb.from('inv_traslados').select('id,numero,bodega_origen_id,bodega_destino_id').in('id', idsT) : { data: [] }]);
    docsMov = { compras: r[0].data || [], pagos: r[1].data || [], traslados: r[2].data || [] };
  }
  function llenarProductosKdx() {
    var sel = +$('ikProducto').value || null, inactivos = $('ikInactivos').checked;
    $('ikProducto').innerHTML = '<option value="">Todos los productos</option>' + productos.filter(function (p) { return inactivos || p.estado === 'activo' || p.id === sel; }).map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc((p.codigo ? p.codigo + ' · ' : '') + p.nombre + (p.estado !== 'activo' ? ' (inactivo)' : '')) + '</option>'; }).join('');
  }
  async function cargarKardex() {
    aviso('ikMsg', '');
    try { await cargarCatalogos(); await cargarExistencias(); } catch (e) { productos = []; existencias = []; $('ikExist').innerHTML = ''; aviso('ikMsg', traducir(e), true); return; }
    try { await cargarUltimos(); } catch (e) { ultMovs = []; docsMov = { compras: [], pagos: [], traslados: [] }; }
    var antes = $('ikBodega').options.length ? bodKardex() : bodegaGeneral();
    $('ikBodega').innerHTML = '<option value="">Todas las bodegas</option>' + opcionesBodega(antes);
    $('ikBodega').value = antes ? String(antes) : '';
    if (!$('ikHasta').value) $('ikHasta').value = hoy();
    llenarProductosKdx();
    pintarExistencias();
    if (prodSel) pintarKardex();
  }
  function ajuste(prodId, alGrabar) {
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
        if (alGrabar) { await alGrabar(); return null; }
        prodSel = +d.producto_id;
        await cargarKardex(); aviso('ikMsg', 'Ajuste grabado en el kardex.'); return null;
      }
    });
  }
  $('ikAjuste').addEventListener('click', function () { ajuste(prodSel); });
  $('ikBodega').addEventListener('change', function () { pintarExistencias(); pintarKardex(); });
  $('ikBuscar').addEventListener('input', function () { pagKdx = 1; pintarExistencias(); });
  $('ikInactivos').addEventListener('change', function () { pagKdx = 1; llenarProductosKdx(); pintarExistencias(); });
  $('ikProducto').addEventListener('change', function () { pagKdx = 1; var id = +this.value || null; if (id) prodSel = id; pintarExistencias(); if (id) pintarKardex(); });
  $('ikPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-pag]'); if (b && !b.disabled) { pagKdx = +b.dataset.pag; pintarExistencias(); } });
  ['ikDesde', 'ikHasta'].forEach(function (id) { $(id).addEventListener('change', pintarKardex); });
  $('ikImprimir').addEventListener('click', imprimirKardex);
  $('ikFiltro').addEventListener('click', function (e) {
    var b = e.target.closest('[data-valor]'); if (!b) return;
    filtroKardex = b.dataset.valor; pagKdx = 1;
    this.querySelectorAll('[data-valor]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    pintarExistencias();
  });
  $('ikExist').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-prod]'); if (tr) { prodSel = +tr.dataset.prod; pintarExistencias(); pintarKardex(); } });
  $('ikExist').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-prod]')) e.target.click(); });
  $('ikDetalle').addEventListener('click', function (e) {
    if (e.target.id === 'ikActualizar') { cargarKardex(); return; }
    var a = e.target.closest('[data-ajustar]'); if (a) ajuste(+a.dataset.ajustar);
  });

  // ================= 8. Ventas de productos =================
  // Productos vendidos en Cobros y pagos (cada línea «Producto» del detalle sale de la bodega general de la sede).
  var ventas = [], periodoVentas = 'mes', ajustes = [], periodoAjustes = 'mes';
  function desdePeriodo(p) {
    var d = new Date();
    if (p === 'hoy') return hoy();
    if (p === 'mes') return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-01';
    if (p === 'anio') return d.getFullYear() + '-01-01';
    return null;
  }
  function filtrosPeriodo(id, actual) {
    return '<div class="inv-filtros" id="' + id + '">' + [['hoy', 'Hoy'], ['mes', 'Este mes'], ['anio', 'Este año'], ['todo', 'Todo']].map(function (o) {
      return '<button type="button" class="adm-btn geo-mini" data-valor="' + o[0] + '" aria-pressed="' + (o[0] === actual) + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  $('admInvVentas').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Ventas de productos</h3>' +
    '<button type="button" id="ivnNueva" class="adm-btn adm-primary">Registrar venta en Cobros y pagos</button></div>' +
    '<p class="dlg-msg">Productos cobrados en Cobros y pagos (líneas «Producto» del detalle). Cada venta descuenta la existencia de la bodega general de la sede; si el pago se anula, el producto regresa a la bodega.</p>' +
    '<div class="inv-barra"><input id="ivnBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar producto, paciente o documento" aria-label="Buscar venta">' + filtrosPeriodo('ivnPeriodo', periodoVentas) + '</div>' +
    '<div class="inv-resumen" id="ivnResumen"></div>' +
    '<section class="geo-panel"><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Fecha</th><th>Documento</th><th>Paciente</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Venta</th><th class="num">Costo</th><th class="num">Utilidad</th><th>Estado</th></tr></thead><tbody id="ivnLista"></tbody></table></div></section>' +
    '<p id="ivnMsg" class="dlg-msg" role="status"></p></div>';
  function docPago(p) { return p ? (p.tipo_documento === 'factura' && p.numero_factura ? 'Factura ' + [p.serie, p.numero_factura].filter(Boolean).join('-') : 'Recibo ' + (p.correlativo || p.id)) : '—'; }
  function pintarVentas() {
    var t = norm($('ivnBuscar').value);
    var l = ventas.filter(function (v) {
      var p = porId(productos, v.producto_id) || {};
      return !t || norm([etiquetaProd(p), v.pago && v.pago.paciente ? v.pago.paciente.nombre : '', docPago(v.pago)].join(' ')).indexOf(t) >= 0;
    });
    var tv = 0, tc = 0, tu = 0;
    $('ivnLista').innerHTML = l.length ? l.map(function (v) {
      var p = porId(productos, v.producto_id) || { nombre: 'Producto ' + v.producto_id }, anul = v.pago && v.pago.anulado;
      var costo = Number(v.cantidad || 0) * Number(v.costo || 0), venta = Number(v.monto || 0);
      if (!anul) { tv += venta; tc += costo; tu += Number(v.cantidad || 0); }
      return '<tr class="' + (anul ? 'inv-anul' : '') + '"><td>' + fecha(v.pago && v.pago.fecha) + '</td><td>' + esc(docPago(v.pago)) + '</td><td>' + esc(v.pago && v.pago.paciente ? v.pago.paciente.nombre : '—') + '</td>' +
        '<td><div class="inv-prod">' + imagen(p, 30) + '<div><b>' + esc(p.nombre) + '</b><small class="inv-sub">' + esc([p.codigo, p.presentacion].filter(Boolean).join(' · ')) + '</small></div></div></td>' +
        '<td class="num">' + cant(v.cantidad) + '</td><td class="num">' + q(venta) + '</td><td class="num">' + q(costo) + '</td><td class="num' + (venta - costo < 0 ? ' inv-negativo' : '') + '">' + q(venta - costo) + '</td>' +
        '<td><span class="estado estado-' + (anul ? 'baja">Anulada' : 'activo">Vendida') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="9" class="geo-vacia">' + (ventas.length ? 'Ninguna venta coincide.' : 'No hay ventas de productos en este periodo. Se registran en Cobros y pagos eligiendo «Producto» en el detalle.') + '</td></tr>';
    $('ivnResumen').innerHTML = '<div><span>Unidades vendidas</span><b>' + cant(tu) + '</b></div><div><span>Venta</span><b>' + q(tv) + '</b></div><div><span>Costo</span><b>' + q(tc) + '</b></div><div><span>Utilidad</span><b>' + q(tv - tc) + '</b></div>';
  }
  async function cargarVentas() {
    aviso('ivnMsg', '');
    try {
      await cargarCatalogos();
      var desde = desdePeriodo(periodoVentas);
      var l = await todas(function () {
        var c = sb.from('pago_detalle').select('id,linea,producto_id,cantidad,monto,bodega_id,pago:pagos!inner(id,fecha,correlativo,tipo_documento,serie,numero_factura,anulado,paciente:pacientes(nombre))').not('producto_id', 'is', null).order('id', { ascending: false });
        return c;
      });
      if (desde) l = l.filter(function (v) { return v.pago && String(v.pago.fecha) >= desde; });
      // Costo de la venta: el registrado en el kardex al momento de la salida
      var movs = l.length ? await todas(function () { return sb.from('inv_movimientos').select('pago_id,producto_id,costo_unitario').eq('origen', 'venta').in('pago_id', l.map(function (v) { return v.pago.id; }).filter(function (x, i, a) { return a.indexOf(x) === i; })); }) : [];
      l.forEach(function (v) { var m = movs.filter(function (x) { return x.pago_id === v.pago.id && x.producto_id === v.producto_id; })[0]; v.costo = m ? m.costo_unitario : (porId(productos, v.producto_id) || {}).costo; });
      ventas = l.sort(function (a, b) { return String(b.pago.fecha).localeCompare(String(a.pago.fecha)) || b.id - a.id; });
    } catch (e) { ventas = []; $('ivnLista').innerHTML = ''; $('ivnResumen').innerHTML = ''; aviso('ivnMsg', traducir(e), true); return; }
    pintarVentas();
  }
  $('ivnBuscar').addEventListener('input', pintarVentas);
  $('ivnPeriodo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-valor]'); if (!b) return;
    periodoVentas = b.dataset.valor;
    this.querySelectorAll('[data-valor]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    cargarVentas();
  });
  $('ivnNueva').addEventListener('click', function () { var t = document.querySelector('[data-tab="admCobros"]'); if (t) t.click(); });

  // ================= 9. Ajustes de inventario =================
  // Entradas y salidas manuales (inventario inicial, conteo físico, vencidos, merma) con su motivo.
  $('admInvAjustes').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Ajustes de inventario</h3>' +
    '<button type="button" id="iajNuevo" class="adm-btn adm-primary">Nuevo ajuste</button></div>' +
    '<p class="dlg-msg">Entradas (inventario inicial, sobrantes) y salidas (merma, vencidos, faltantes) que corrigen la existencia. Cada ajuste queda en el kardex con su motivo, usuario, fecha y hora.</p>' +
    '<div class="inv-barra"><input id="iajBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar producto o motivo" aria-label="Buscar ajuste">' + filtrosPeriodo('iajPeriodo', periodoAjustes) + '</div>' +
    '<section class="geo-panel"><div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Fecha y hora</th><th>Producto</th><th>Bodega</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Costo</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody id="iajLista"></tbody></table></div></section>' +
    '<p id="iajMsg" class="dlg-msg" role="status"></p></div>';
  function pintarAjustes() {
    var t = norm($('iajBuscar').value);
    var l = ajustes.filter(function (m) { var p = porId(productos, m.producto_id) || {}; return !t || norm([etiquetaProd(p), m.observaciones, m.usuario].join(' ')).indexOf(t) >= 0; });
    $('iajLista').innerHTML = l.length ? l.map(function (m) {
      var p = porId(productos, m.producto_id) || { nombre: 'Producto ' + m.producto_id };
      return '<tr class="inv-mov-' + m.tipo + '"><td>' + fechaHora(m.fecha) + '</td><td><div class="inv-prod">' + imagen(p, 30) + '<div><b>' + esc(p.nombre) + '</b><small class="inv-sub">' + esc([p.codigo, p.presentacion].filter(Boolean).join(' · ')) + '</small></div></div></td>' +
        '<td>' + esc(nombreBod(m.bodega_id)) + '</td><td><span class="estado estado-' + (m.tipo === 'entrada' ? 'activo">Entrada' : 'baja">Salida') + '</span></td>' +
        '<td class="num">' + cant(m.cantidad) + '</td><td class="num">' + q(m.costo_unitario) + '</td><td>' + esc(m.observaciones || '—') + '</td><td>' + esc(m.usuario || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="geo-vacia">' + (ajustes.length ? 'Ningún ajuste coincide.' : 'No hay ajustes en este periodo. Usa «Nuevo ajuste» para cargar el inventario inicial o corregir existencias.') + '</td></tr>';
  }
  async function cargarAjustes() {
    aviso('iajMsg', '');
    try {
      await cargarCatalogos();
      var desde = desdePeriodo(periodoAjustes);
      ajustes = await todas(function () { var c = sb.from('inv_movimientos').select('*').eq('origen', 'ajuste').order('fecha', { ascending: false }).order('id', { ascending: false }); return desde ? c.gte('fecha', desde) : c; });
    } catch (e) { ajustes = []; $('iajLista').innerHTML = ''; aviso('iajMsg', traducir(e), true); return; }
    pintarAjustes();
  }
  $('iajBuscar').addEventListener('input', pintarAjustes);
  $('iajPeriodo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-valor]'); if (!b) return;
    periodoAjustes = b.dataset.valor;
    this.querySelectorAll('[data-valor]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    cargarAjustes();
  });
  $('iajNuevo').addEventListener('click', async function () {
    if (!productos.length) await cargarAjustes();
    ajuste(null, async function () { await cargarAjustes(); aviso('iajMsg', 'Ajuste grabado en el kardex.'); });
  });

  var PANELES = { admInvCompras: function () { return cargarCompras(); }, admInvKardex: function () { return cargarKardex(); }, admInvVentas: function () { return cargarVentas(); }, admInvAjustes: function () { return cargarAjustes(); } };
  function cargarPanel(id) { return PANELES[id](); }
  Object.keys(PANELES).forEach(function (id) {
    var tab = document.querySelector('[data-tab="' + id + '"]');
    if (tab) tab.addEventListener('click', function () { setTimeout(function () { cargarPanel(id); }, 0); });
  });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { Object.keys(PANELES).forEach(function (id) { if (!$(id).hidden) cargarPanel(id); }); },
    limpiar: function () {
      proveedores = []; bodegas = []; productos = []; compras = []; items = []; abonos = []; existencias = []; kardex = []; compraSel = prodSel = null; compraForm = null; lineas = []; ventas = []; ajustes = [];
      ['icLista', 'ikExist', 'icLineas', 'icAbonos', 'icRegistro', 'ivnLista', 'ivnResumen', 'iajLista'].forEach(function (i) { $(i).innerHTML = ''; });
      $('ikDetalle').hidden = true;
    }
  });
})();
