// Plus Dental — Inventarios (fase 1): Proveedores, Bodegas, Definición de productos y Precios por tipo de cliente.
// Cada registro lleva organización y localidad (la del usuario que graba; solo el Super Administrador la cambia),
// número correlativo y registro de quién graba y modifica. La edición usa la ventana de PD_GEO (geografia.js).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admInvProveedores') || !document.getElementById('admInvTipos') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo', baja: 'Baja' };
  var OPC_ESTADO = [['activo', 'Activo'], ['inactivo', 'Inactivo'], ['baja', 'Baja']];
  var TIPOS = [['directo', 'Cliente directo'], ['institucional', 'Institucional'], ['vip', 'VIP'], ['referido', 'Referido'], ['paquete', 'Paquete'], ['especial', 'Especial']];
  var CLASIFICACIONES = ['Medicamento', 'Anestésico', 'Insumo descartable', 'Material de restauración', 'Material de impresión', 'Endodoncia', 'Ortodoncia', 'Prótesis', 'Instrumental', 'Equipo', 'Higiene oral', 'Limpieza y esterilización'];
  var PRESENTACIONES = ['Caja', 'Frasco', 'Tubo', 'Blíster', 'Ampolla', 'Cartucho', 'Jeringa', 'Paquete', 'Kit', 'Unidad', 'Galón', 'Bolsa'];
  var UNIDADES = ['Unidad', 'Caja', 'Paquete', 'Kit', 'Par', 'Rollo', 'ml', 'Litro', 'g', 'mg', 'kg'];

  var proveedores = [], bodegas = [], productos = [], precios = [], otrosProv = [], tiposProd = [];
  var provSel = null, subSel = null, bodSel = null, prodSel = null, tipoSel = null;
  var PAG_PROD = 8, pagProd = 1, irAlProd = false;
  var filtros = { prov: 'activo', bod: 'todos', prod: 'activo', tipo: 'activo' };

  function $(id) { return document.getElementById(id); }
  function q(n) { return n == null || n === '' ? '—' : 'Q' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function usd(n) { return n == null || n === '' ? '' : 'US$' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function pill(e) { e = e || 'activo'; return '<span class="estado estado-' + e + '">' + (ESTADOS[e] || e) + '</span>'; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function sede(x) { return window.PD_SEDES && x.localidad_id ? window.PD_SEDES.texto(x.localidad_id) : '—'; }
  function dato(k, v, ancho) { return '<div class="geo-info' + (ancho ? ' full' : '') + '"><span>' + k + '</span><b>' + (v === 0 || v ? esc(v) : '—') + '</b></div>'; }
  function credito(d) { return +d ? d + ' días' : 'Inmediato'; }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/inv_.*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Inventarios.';
    if (/inv_productos_codigo_sede/i.test(m)) return 'Ya existe un producto con ese código en esta sede.';
    if (/inv_precios_producto_tipo_sede/i.test(m)) return 'Ese producto ya tiene precio de ese tipo en esta sede.';
    return G.traducir(err);
  }
  var EDITAR = '<button type="button" class="geo-editar" aria-label="Modificar" title="Modificar">✎</button>';
  function fila(tipo, id, sel, celdas) {
    return '<tr data-inv="' + tipo + '" data-id="' + id + '" class="' + (sel ? 'geo-sel' : '') + '" tabindex="0">' + celdas.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '<td class="geo-acc">' + EDITAR + '</td></tr>';
  }
  function vacia(n, t) { return '<tr><td colspan="' + n + '" class="geo-vacia">' + t + '</td></tr>'; }
  // Estado, quién grabó / modificó (con segundos) y botones Modificar y Actualizar
  function registro(x, tipo) {
    return '<div class="org-registro"><div class="org-reg-datos">' + pill(x.estado) +
      '<span>N.º <b>' + (x.numero || '—') + '</b></span><span>Sede <b>' + esc(sede(x)) + '</b></span>' +
      '<span>Grabado por <b>' + esc(x.creado_por || 'Sin usuario') + '</b> el <b>' + fechaHora(x.creado) + '</b></span>' +
      (x.modificado ? '<span>Modificado por <b>' + esc(x.modificado_por || 'Sin usuario') + '</b> el <b>' + fechaHora(x.modificado) + '</b></span>' : '') + '</div>' +
      '<div class="org-reg-btns"><button type="button" class="adm-btn adm-primary geo-mini" data-inv-modificar="' + tipo + '">Modificar</button>' +
      '<button type="button" class="adm-btn geo-mini" data-inv-actualizar>Actualizar</button></div></div>';
  }
  function filtrosHtml(clave, opciones) {
    return '<div class="inv-filtros" data-filtro="' + clave + '">' + opciones.map(function (o) { return '<button type="button" class="adm-btn geo-mini" data-valor="' + o[0] + '" aria-pressed="' + (filtros[clave] === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  var F_ESTADO = [['activo', 'Activos'], ['inactivo', 'Inactivos'], ['baja', 'Baja'], ['todos', 'Todos']];
  // Bancos del sistema bancario de Guatemala (lista sugerida: se puede escribir otro)
  var BANCOS_GT = ['Banco Industrial', 'Banrural (Banco de Desarrollo Rural)', 'BAC Credomatic (Banco de América Central)', 'Banco G&T Continental', 'BAM (Banco Agromercantil)',
    'Bantrab (Banco de los Trabajadores)', 'Banco Promerica', 'Banco Ficohsa Guatemala', 'Interbanco (Banco Internacional)', 'Crédito Hipotecario Nacional (CHN)',
    'Banco de Antigua', 'Banco Inmobiliario', 'Banco Azteca de Guatemala', 'Vivibanco', 'Banco Nexa', 'Banco INV', 'Citibank, N.A. Sucursal Guatemala'];
  function pasaFiltro(clave, x) { return filtros[clave] === 'todos' || (x.estado || 'activo') === filtros[clave]; }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function porNumero(a, b) { return (a.numero || 0) - (b.numero || 0); }

  // ================= 1. Proveedores (empresa principal y sub-empresas) =================
  $('admInvProveedores').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Proveedores</h3><button type="button" class="adm-btn adm-primary" id="ipNuevo">+ Proveedor</button></div>' +
    '<p class="dlg-msg">Empresas principales y sus sub-empresas (sucursales o razones sociales del mismo proveedor). Toca una fila para ver su detalle y sus sub-empresas.</p>' +
    '<div class="inv-barra">' + filtrosHtml('prov', F_ESTADO) + '<input id="ipBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar por nombre o NIT" aria-label="Buscar proveedor"></div>' +
    '<section class="geo-panel"><div class="geo-head"><h4>Empresas principales</h4></div>' +
    '<div class="roles-wrap geo-scroll"><table class="geo-tabla"><thead><tr><th>N.º</th><th>NIT</th><th>Nombre comercial</th><th>Días crédito</th><th>Retención</th><th>Pend. revisar</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="ipLista"></tbody></table></div>' +
    '<div id="ipFicha" class="geo-ficha" hidden></div></section>' +
    '<section class="geo-panel"><div class="geo-head"><h4 id="ipTitSub">Sub-empresas</h4><button type="button" class="adm-btn adm-primary geo-mini" id="ipNuevaSub">+ Sub-empresa</button></div>' +
    '<div class="roles-wrap"><table class="geo-tabla"><thead><tr><th>N.º</th><th>NIT</th><th>Nombre comercial</th><th>Días crédito</th><th>Retención</th><th>Pend. revisar</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="ipSubs"></tbody></table></div>' +
    '<div id="ipFichaSub" class="geo-ficha" hidden></div></section>' +
    '<p id="ipMsg" class="dlg-msg" role="status"></p></div>';

  function celdasProv(p) { return [p.numero || '—', esc(p.nit || '—'), '<b>' + esc(p.nombre_comercial) + '</b>', credito(p.dias_credito), p.efectuar_retencion ? '✓' : '—', p.pendiente_revisar ? '<span class="inv-alerta">Revisar</span>' : '—', pill(p.estado)]; }
  function fichaProv(p, tipo) {
    return registro(p, tipo) + '<div class="geo-ficha-grid">' + dato('Nombre fiscal (SAT)', p.nombre_fiscal, 1) + dato('Nombre para emisión de documentos', p.nombre_documentos, 1) + dato('Dirección', p.direccion, 1) +
      dato('Teléfonos', p.telefonos) + dato('Ext.', p.extension) + dato('Fax', p.fax) + dato('Correo', p.correo) + dato('Contacto', p.contacto) + dato('Banco', p.banco) + dato('Cuenta bancaria', p.cuenta_bancaria) + dato('Días de crédito', credito(p.dias_credito)) + '</div>';
  }
  function pintarProveedores() {
    var t = norm($('ipBuscar').value);
    var principales = proveedores.filter(function (p) { return !p.padre_id && pasaFiltro('prov', p) && (!t || norm(p.nombre_comercial + ' ' + (p.nit || '') + ' ' + (p.nombre_fiscal || '')).indexOf(t) >= 0); });
    $('ipLista').innerHTML = principales.length ? principales.map(function (p) { return fila('prov', p.id, p.id === provSel, celdasProv(p)); }).join('') : vacia(8, proveedores.length ? 'Ningún proveedor coincide.' : 'Aún no hay proveedores. Agrega el primero con «+ Proveedor».');
    var p = proveedores.filter(function (x) { return x.id === provSel; })[0];
    $('ipFicha').hidden = !p; if (p) $('ipFicha').innerHTML = fichaProv(p, 'prov');
    var subs = p ? proveedores.filter(function (x) { return x.padre_id === p.id; }) : [];
    $('ipTitSub').textContent = p ? 'Sub-empresas de ' + p.nombre_comercial : 'Sub-empresas';
    $('ipSubs').innerHTML = !p ? vacia(8, 'Elige una empresa principal.') : subs.length ? subs.map(function (s) { return fila('sub', s.id, s.id === subSel, celdasProv(s)); }).join('') : vacia(8, 'Esta empresa aún no tiene sub-empresas.');
    var s = subs.filter(function (x) { return x.id === subSel; })[0];
    $('ipFichaSub').hidden = !s; if (s) $('ipFichaSub').innerHTML = fichaProv(s, 'sub');
  }
  async function cargarProveedores() {
    aviso('ipMsg', '');
    try { proveedores = (await todas(function () { return sb.from('inv_proveedores').select('*').order('numero'); })).sort(porNumero); }
    catch (e) { proveedores = []; $('ipLista').innerHTML = ''; aviso('ipMsg', traducir(e), true); return; }
    if (!proveedores.some(function (p) { return p.id === provSel; })) provSel = (proveedores.filter(function (p) { return !p.padre_id; })[0] || {}).id || null;
    pintarProveedores();
  }
  function editarProveedor(p, padre) {
    var esSub = !!(p ? p.padre_id : padre);
    var v = p ? Object.assign({}, p) : { estado: 'activo', dias_credito: 0, padre_id: padre ? padre.id : null, localidad_id: padre ? padre.localidad_id : null };
    G.dialogo({
      eyebrow: 'Inventarios · ' + (esSub ? 'Sub-empresa de ' + (padre || proveedores.filter(function (x) { return x.id === p.padre_id; })[0] || {}).nombre_comercial : 'Proveedor'),
      titulo: p ? p.nombre_comercial : (esSub ? 'Nueva sub-empresa' : 'Nuevo proveedor'), valores: v,
      campos: [{ k: 'numero', label: 'N.º proveedor', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'nit', label: 'NIT', max: 20, placeholder: '1234567-8' }, { k: 'dias_credito', label: 'Días de crédito', tipo: 'number', paso: 1, maxNum: 365, ayuda: '0 = pago inmediato' },
        { k: 'nombre_comercial', label: 'Nombre comercial', req: true, max: 150, ancho: 'full' },
        { k: 'nombre_fiscal', label: 'Nombre fiscal (SAT)', max: 200, ancho: 'full' }, { k: 'nombre_documentos', label: 'Nombre para emisión de documentos', max: 200, ancho: 'full' },
        { k: 'direccion', label: 'Dirección', tipo: 'textarea', max: 300, ancho: 'full' },
        { k: 'telefonos', label: 'Teléfonos', max: 120 }, { k: 'extension', label: 'Ext.', max: 20 }, { k: 'fax', label: 'Fax', max: 40 }, { k: 'correo', label: 'Correo', max: 150 },
        { k: 'contacto', label: 'Persona de contacto', max: 120, ancho: 'full' }, { k: 'banco', label: 'Banco', max: 80, lista: BANCOS_GT, placeholder: 'Elige o escribe el banco' }, { k: 'cuenta_bancaria', label: 'Cuenta bancaria', max: 40 },
        { k: 'sede', tipo: 'sede' },
        { k: 'efectuar_retencion', label: 'Efectuar retención', tipo: 'check' }, { k: 'pendiente_revisar', label: 'Pendiente de revisar', tipo: 'check' }],
      secciones: [
        { titulo: 'Identificación', campos: ['numero', 'estado', 'nombre_comercial', 'nombre_fiscal', 'nombre_documentos', 'nit', 'dias_credito'] },
        { titulo: 'Contacto', campos: ['contacto', 'telefonos', 'extension', 'correo', 'fax', 'direccion'] },
        { titulo: 'Pagos y control', campos: ['banco', 'cuenta_bancaria', 'efectuar_retencion', 'pendiente_revisar', 'sede'] }
      ],
      alAbrir: function () { if (!p) $('geoF_numero').textContent = 'Se asigna al grabar'; },
      guardar: async function (d) {
        if (!p && padre) d.padre_id = padre.id;
        var r = p ? await sb.from('inv_proveedores').update(d).eq('id', p.id).select('id').single() : await sb.from('inv_proveedores').insert(d).select('id').single();
        if (r.error) return traducir(r.error);
        if (esSub) subSel = r.data.id; else { provSel = r.data.id; subSel = null; }
        await cargarProveedores(); return null;
      },
      eliminar: p ? async function () { var r = await sb.from('inv_proveedores').delete().eq('id', p.id); if (r.error) return traducir(r.error); if (esSub) subSel = null; else provSel = null; await cargarProveedores(); return null; } : null
    });
  }

  // ================= 2. Bodegas =================
  $('admInvBodegas').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Bodegas</h3><button type="button" class="adm-btn adm-primary" id="ibNueva">+ Bodega</button></div>' +
    '<p class="dlg-msg">Bodega general de cada sede y sus sub-bodegas. El tipo de precio por defecto se usa al vender desde esa bodega.</p>' +
    '<div class="inv-barra">' + filtrosHtml('bod', F_ESTADO) + '</div>' +
    '<section class="geo-panel"><div class="roles-wrap"><table class="geo-tabla"><thead><tr><th>N.º</th><th>Bodega</th><th>Tipo</th><th>Bodega mayor</th><th>Siglas</th><th>Encargado</th><th>Tipo de precio</th><th>Sede</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="ibLista"></tbody></table></div>' +
    '<div id="ibFicha" class="geo-ficha" hidden></div></section><p id="ibMsg" class="dlg-msg" role="status"></p></div>';
  function nombreBodega(id) { var b = bodegas.filter(function (x) { return x.id === id; })[0]; return b ? b.nombre : '—'; }
  function nombreTipo(t) { return (TIPOS.filter(function (x) { return x[0] === t; })[0] || [t, t])[1]; }
  function pintarBodegas() {
    var l = bodegas.filter(function (b) { return pasaFiltro('bod', b); });
    $('ibLista').innerHTML = l.length ? l.map(function (b) {
      return fila('bod', b.id, b.id === bodSel, [b.numero || '—', '<b>' + esc(b.nombre) + '</b>', b.tipo === 'sub' ? 'Sub-bodega' : 'General', esc(b.bodega_mayor_id ? nombreBodega(b.bodega_mayor_id) : '—'), esc(b.siglas || '—'), esc(b.encargado || '—'), nombreTipo(b.tipo_precio), esc(sede(b)), pill(b.estado)]);
    }).join('') : vacia(10, bodegas.length ? 'No hay bodegas con este estado.' : 'Aún no hay bodegas. Agrega la primera con «+ Bodega».');
    var b = bodegas.filter(function (x) { return x.id === bodSel; })[0];
    $('ibFicha').hidden = !b;
    if (b) $('ibFicha').innerHTML = registro(b, 'bod') + '<div class="geo-ficha-grid">' + dato('Dirección', b.direccion, 1) + dato('Permite carga directa', b.permite_carga_directa ? 'Sí' : 'No') + dato('Bodega de consignación', b.consignacion ? 'Sí' : 'No') + dato('Tipo de precio por defecto', nombreTipo(b.tipo_precio)) + dato('Encargado', b.encargado) + '</div>';
  }
  async function cargarBodegas() {
    aviso('ibMsg', '');
    try { bodegas = (await todas(function () { return sb.from('inv_bodegas').select('*').order('numero'); })).sort(porNumero); }
    catch (e) { bodegas = []; $('ibLista').innerHTML = ''; aviso('ibMsg', traducir(e), true); return; }
    if (!bodegas.some(function (b) { return b.id === bodSel; })) bodSel = bodegas.length ? bodegas[0].id : null;
    pintarBodegas();
  }
  function editarBodega(b) {
    var v = b ? Object.assign({}, b) : { estado: 'activo', tipo: 'general', tipo_precio: 'directo', permite_carga_directa: true };
    G.dialogo({
      eyebrow: 'Inventarios · Bodega', titulo: b ? b.nombre : 'Nueva bodega', valores: v,
      campos: [{ k: 'numero', label: 'N.º bodega', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'nombre', label: 'Nombre de la bodega', req: true, max: 120, ancho: 'full' },
        { k: 'tipo', label: 'Tipo', tipo: 'select', opciones: [['general', 'General'], ['sub', 'Sub-bodega']] },
        { k: 'bodega_mayor_id', label: 'Bodega mayor', ayuda: 'Solo para sub-bodegas', tipo: 'select', opciones: [['', '—']].concat(bodegas.filter(function (x) { return !b || x.id !== b.id; }).map(function (x) { return [x.id, x.numero + ' · ' + x.nombre]; })) },
        { k: 'siglas', label: 'Siglas', max: 10, placeholder: 'GEN' }, { k: 'encargado', label: 'Encargado', max: 120 },
        { k: 'direccion', label: 'Dirección', tipo: 'textarea', max: 300, ancho: 'full' },
        { k: 'tipo_precio', label: 'Tipo de precio por defecto', tipo: 'select', opciones: TIPOS },
        { k: 'sede', tipo: 'sede' },
        { k: 'permite_carga_directa', label: '¿Permitir carga directa?', tipo: 'check' }, { k: 'consignacion', label: '¿Bodega de consignación?', tipo: 'check' }],
      secciones: [
        { titulo: 'Identificación', campos: ['numero', 'estado', 'nombre', 'tipo', 'bodega_mayor_id', 'siglas', 'encargado'] },
        { titulo: 'Ubicación', campos: ['direccion', 'sede'] },
        { titulo: 'Configuración', campos: ['tipo_precio*', 'permite_carga_directa*', 'consignacion*'] }
      ],
      alAbrir: function () { if (!b) $('geoF_numero').textContent = 'Se asigna al grabar'; },
      guardar: async function (d) {
        d.bodega_mayor_id = d.bodega_mayor_id ? +d.bodega_mayor_id : null;
        var r = b ? await sb.from('inv_bodegas').update(d).eq('id', b.id).select('id').single() : await sb.from('inv_bodegas').insert(d).select('id').single();
        if (r.error) return traducir(r.error);
        bodSel = r.data.id; await cargarBodegas(); return null;
      },
      eliminar: b ? async function () { var r = await sb.from('inv_bodegas').delete().eq('id', b.id); if (r.error) return traducir(r.error); bodSel = null; await cargarBodegas(); return null; } : null
    });
  }

  // ================= Tipo de producto (catálogo para clasificar los productos) =================
  $('admInvTipos').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Tipo de producto</h3><button type="button" class="adm-btn adm-primary" id="itNuevo">+ Tipo de producto</button></div>' +
    '<p class="dlg-msg">Tipos de medicamentos e insumos de uso odontológico en Guatemala. Se eligen en el campo «Tipo de producto» de cada producto.</p>' +
    '<div class="inv-barra">' + filtrosHtml('tipo', F_ESTADO) + '<input id="itBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar tipo o medicamento" aria-label="Buscar tipo de producto"></div>' +
    '<section class="geo-panel"><div class="roles-wrap geo-scroll inv-alto"><table class="geo-tabla"><thead><tr><th>N.º</th><th>Tipo de producto</th><th>Ejemplos</th><th>Receta</th><th>Productos</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="itLista"></tbody></table></div>' +
    '<div id="itFicha" class="geo-ficha" hidden></div></section><p id="itMsg" class="dlg-msg" role="status"></p></div>';
  function pintarTipos() {
    var t = norm($('itBuscar').value);
    var l = tiposProd.filter(function (x) { return pasaFiltro('tipo', x) && (!t || norm([x.nombre, x.descripcion, x.ejemplos].join(' ')).indexOf(t) >= 0); });
    $('itLista').innerHTML = l.length ? l.map(function (x) {
      var n = productos.filter(function (p) { return norm(p.tipo_producto) === norm(x.nombre); }).length;
      return fila('tipo', x.id, x.id === tipoSel, [x.numero || '—', '<b>' + esc(x.nombre) + '</b>', '<span class="inv-sub">' + esc(x.ejemplos || '—') + '</span>', x.requiere_receta ? '<span class="inv-alerta">Con receta</span>' : 'Libre', n, pill(x.estado)]);
    }).join('') : vacia(7, tiposProd.length ? 'Ningún tipo coincide.' : 'Aún no hay tipos de producto. Agrega el primero con «+ Tipo de producto».');
    var x = tiposProd.filter(function (y) { return y.id === tipoSel; })[0];
    $('itFicha').hidden = !x;
    if (x) $('itFicha').innerHTML = registro(x, 'tipo') + '<div class="geo-ficha-grid">' + dato('Descripción', x.descripcion, 1) + dato('Ejemplos de medicamentos', x.ejemplos, 1) + dato('¿Requiere receta?', x.requiere_receta ? 'Sí' : 'No') + '</div>';
  }
  async function cargarTipos() {
    aviso('itMsg', '');
    try { tiposProd = (await todas(function () { return sb.from('inv_tipos_producto').select('*').order('numero'); })).sort(porNumero); }
    catch (e) { tiposProd = []; $('itLista').innerHTML = ''; aviso('itMsg', traducir(e), true); return; }
    if (!tiposProd.some(function (x) { return x.id === tipoSel; })) tipoSel = tiposProd.length ? tiposProd[0].id : null;
    pintarTipos();
  }
  function editarTipo(x) {
    var v = x ? Object.assign({}, x) : { estado: 'activo' };
    G.dialogo({
      eyebrow: 'Inventarios · Tipo de producto', titulo: x ? x.nombre : 'Nuevo tipo de producto', valores: v,
      campos: [{ k: 'numero', label: 'N.º (automático)', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'nombre', label: 'Nombre del tipo de producto', req: true, max: 100, ancho: 'full' },
        { k: 'descripcion', label: 'Descripción (para qué se usa)', tipo: 'textarea', max: 400, ancho: 'full' },
        { k: 'ejemplos', label: 'Ejemplos de medicamentos o productos', tipo: 'textarea', max: 400, ancho: 'full' },
        { k: 'sede', tipo: 'sede' }, { k: 'requiere_receta', label: '¿Requiere receta médica?', tipo: 'check' }],
      alAbrir: function () { if (!x) $('geoF_numero').textContent = 'Se asigna al grabar'; },
      guardar: async function (d) {
        var r = x ? await sb.from('inv_tipos_producto').update(d).eq('id', x.id).select('id').single() : await sb.from('inv_tipos_producto').insert(d).select('id').single();
        if (r.error) return /inv_tipos_producto_nombre_sede/.test(r.error.message || '') ? 'Ya existe un tipo de producto con ese nombre en esta sede.' : traducir(r.error);
        tipoSel = r.data.id; await cargarTipos(); return null;
      },
      eliminar: x ? async function () { var r = await sb.from('inv_tipos_producto').delete().eq('id', x.id); if (r.error) return traducir(r.error); tipoSel = null; await cargarTipos(); return null; } : null
    });
  }

  // ================= 3. Definición de productos =================
  $('admInvProductos').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Definición de productos</h3><button type="button" class="adm-btn adm-primary" id="iaNuevo">+ Producto</button></div>' +
    '<p class="dlg-msg">Medicamentos, insumos, materiales e instrumental: clasificación, presentación, unidad, proveedor, bodega, mínimos y máximos.</p>' +
    '<div class="inv-barra">' + filtrosHtml('prod', F_ESTADO) + '<select id="iaClasif" class="adm-input" aria-label="Clasificación"><option value="">Todas las clasificaciones</option></select><input id="iaBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar por nombre, código o marca" aria-label="Buscar producto"></div>' +
    '<section class="geo-panel"><div class="roles-wrap ia-wrap"><table class="geo-tabla ia-tabla"><colgroup><col class="ia-c-cod"><col><col class="ia-c-clas"><col class="ia-c-min"><col class="ia-c-costo"><col class="ia-c-est"><col class="ia-c-acc"></colgroup>' +
    '<thead><tr><th>Código</th><th>Producto</th><th>Clasificación / presentación</th><th>Mín. / Máx.</th><th title="Precio de costo y precio de referencia estimado por IA en Guatemala">Costo / Ref.</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="iaLista"></tbody></table>' +
    '<div id="iaPaginas" class="ia-paginas"></div></div>' +
    '<div id="iaFicha" class="geo-ficha" hidden></div></section><p id="iaMsg" class="dlg-msg" role="status"></p></div>';
  function nombreProv(id) { var p = proveedores.filter(function (x) { return x.id === id; })[0]; return p ? p.nombre_comercial : null; }
  function fotoUrl(ruta) { return ruta ? sb.storage.from('publico').getPublicUrl(ruta).data.publicUrl : ''; }
  // Ilustración del producto según su presentación (cartucho, frasco, tubo, blíster…), con el color de su tipo.
  // Se usa mientras el producto no tenga foto propia (las fotos comerciales tienen derechos de cada marca).
  var COLORES_TIPO = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#A16207'];
  function colorTipo(t) { var h = 0; String(t || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return COLORES_TIPO[h % COLORES_TIPO.length]; }
  function ilustracion(p, tam) {
    var c = colorTipo(p.tipo_producto || p.clasificacion), pr = norm(p.presentacion), k = '#0B2B40', g = '#E3EBF1', b = '#FFFFFF';
    var d;
    if (/cartucho/.test(pr)) d = '<rect x="24" y="8" width="16" height="6" rx="2" fill="#94A6B2"/><rect x="22" y="14" width="20" height="40" rx="4" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="22" y="26" width="20" height="16" fill="' + c + '"/><rect x="26" y="54" width="12" height="4" rx="1" fill="#94A6B2"/>';
    else if (/ampolla/.test(pr)) d = '<path d="M28 6h8v8l-2 4v2l4 6v28a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V26l4-6v-2l-2-4z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="25" y="34" width="14" height="12" fill="' + c + '"/>';
    else if (/blister/.test(pr)) d = '<rect x="10" y="12" width="44" height="40" rx="5" fill="' + g + '" stroke="' + k + '" stroke-width="2"/>' + [20, 32, 44].map(function (x) { return '<ellipse cx="' + x + '" cy="24" rx="5" ry="7" fill="' + c + '"/><ellipse cx="' + x + '" cy="40" rx="5" ry="7" fill="' + c + '"/>'; }).join('');
    else if (/jeringa/.test(pr)) d = '<rect x="10" y="28" width="34" height="10" rx="2" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="12" y="30" width="18" height="6" fill="' + c + '"/><rect x="44" y="31" width="10" height="4" fill="#94A6B2"/><rect x="4" y="25" width="6" height="16" rx="1" fill="' + k + '"/><path d="M54 33h6" stroke="' + k + '" stroke-width="2"/>';
    else if (/tubo/.test(pr)) d = '<path d="M16 14h32l-4 38H20z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="18" y="22" width="28" height="14" fill="' + c + '"/><rect x="26" y="52" width="12" height="8" rx="2" fill="' + k + '"/><path d="M16 14h32" stroke="' + k + '" stroke-width="4"/>';
    else if (/galon/.test(pr)) d = '<path d="M14 18h28v-6h8v6a6 6 0 0 1 6 6v28a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V22a4 4 0 0 1 2-4z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><path d="M20 18v-6a4 4 0 0 1 8 0v6" fill="none" stroke="' + k + '" stroke-width="2"/><rect x="16" y="30" width="36" height="16" fill="' + c + '"/>';
    else if (/frasco|inhalador/.test(pr)) d = (/inhalador/.test(pr) ? '<rect x="18" y="8" width="16" height="34" rx="5" fill="' + c + '"/><path d="M14 40h30v10a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/>'
      : '<rect x="24" y="6" width="16" height="8" rx="2" fill="' + k + '"/><path d="M22 14h20v6l4 4v32a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V24l4-4z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="18" y="30" width="28" height="18" fill="' + c + '"/>');
    else if (/bolsa/.test(pr)) d = '<path d="M14 18l4-8h28l4 8v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><path d="M14 18h36" stroke="' + k + '" stroke-width="2"/><rect x="18" y="28" width="28" height="16" fill="' + c + '"/>';
    else if (/rollo/.test(pr)) d = '<circle cx="32" cy="32" r="22" fill="' + c + '" stroke="' + k + '" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="' + b + '" stroke="' + k + '" stroke-width="2"/>';
    else if (/kit/.test(pr)) d = '<rect x="8" y="16" width="48" height="38" rx="5" fill="' + g + '" stroke="' + k + '" stroke-width="2"/><rect x="24" y="10" width="16" height="6" rx="2" fill="' + k + '"/><rect x="14" y="24" width="14" height="24" rx="3" fill="' + c + '"/><rect x="34" y="28" width="16" height="20" rx="3" fill="' + b + '" stroke="' + c + '" stroke-width="2"/>';
    else if (/paquete/.test(pr)) d = '<path d="M12 14l4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4 4 4v38a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><rect x="16" y="26" width="32" height="18" fill="' + c + '"/>';
    else if (/unidad/.test(pr)) d = '<circle cx="22" cy="20" r="11" fill="' + g + '" stroke="' + k + '" stroke-width="2"/><circle cx="22" cy="20" r="6" fill="' + c + '"/><path d="M30 28l22 24" stroke="' + k + '" stroke-width="5" stroke-linecap="round"/>';
    else d = '<path d="M10 22l22-10 22 10v26L32 58 10 48z" fill="' + b + '" stroke="' + k + '" stroke-width="2"/><path d="M10 22l22 10 22-10M32 32v26" fill="none" stroke="' + k + '" stroke-width="2"/><path d="M10 22l22 10v26L10 48z" fill="' + c + '" opacity=".85"/>';
    return '<svg class="inv-ilus" viewBox="0 0 64 64" width="' + (tam || 40) + '" height="' + (tam || 40) + '" role="img" aria-label="' + esc((p.presentacion || 'Producto') + ' · ' + (p.tipo_producto || '')) + '">' + d + '</svg>';
  }
  function imagenProducto(p, tam) { return p.foto ? '<img class="inv-foto" src="' + esc(fotoUrl(p.foto)) + '" alt="Foto de ' + esc(p.nombre) + '" width="' + (tam || 40) + '" height="' + (tam || 40) + '">' : ilustracion(p, tam); }
  function pintarProductos() {
    var t = norm($('iaBuscar').value), c = $('iaClasif').value;
    var clases = productos.map(function (p) { return p.clasificacion; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    var antes = $('iaClasif').value;
    $('iaClasif').innerHTML = '<option value="">Todas las clasificaciones</option>' + clases.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    $('iaClasif').value = clases.indexOf(antes) >= 0 ? antes : '';
    var l = productos.filter(function (p) { return pasaFiltro('prod', p) && (!c || p.clasificacion === c) && (!t || norm([p.nombre, p.codigo, p.marca, p.principio_activo].join(' ')).indexOf(t) >= 0); });
    var paginas = Math.max(1, Math.ceil(l.length / PAG_PROD));
    if (irAlProd) { var ix = l.findIndex(function (p) { return p.id === prodSel; }); if (ix >= 0) pagProd = Math.floor(ix / PAG_PROD) + 1; irAlProd = false; }
    pagProd = Math.min(Math.max(1, pagProd), paginas);
    var ini = (pagProd - 1) * PAG_PROD, vis = l.slice(ini, ini + PAG_PROD);
    $('iaLista').innerHTML = vis.length ? vis.map(function (p) {
      var bajo = p.control_minimo && p.minimo != null;
      var minmax = p.minimo != null || p.maximo != null ? (p.minimo != null ? Number(p.minimo) : '—') + ' / ' + (p.maximo != null ? Number(p.maximo) : '—') : '—';
      var sub = [p.principio_activo, p.tipo_producto].filter(Boolean).map(esc).join(' · ');
      return fila('prod', p.id, p.id === prodSel, [
        '<b class="ia-cod">' + esc(p.codigo || '—') + '</b><small class="inv-sub">N.º ' + (p.numero || '—') + '</small>',
        '<div class="inv-prod">' + imagenProducto(p, 36) + '<div><b class="ia-nom">' + esc(p.nombre) + '</b>' + (sub ? '<small class="inv-sub ia-corto" title="' + sub + '">' + sub + '</small>' : '') + (p.no_definido ? '<span class="inv-alerta" title="Creado desde una compra: completa su definición">No definido</span>' : '') + '</div></div>',
        '<span class="ia-corto">' + esc(p.clasificacion || '—') + '</span><small class="inv-sub ia-corto">' + (esc([p.presentacion, p.unidad].filter(Boolean).join(' · ')) || '—') + '</small>',
        minmax + (bajo ? '<small><span class="inv-alerta" title="Control de punto mínimo activo">mín.</span></small>' : ''),
        q(p.costo) + '<small class="inv-sub">' + (p.precio_referencia != null ? '<span class="inv-ref" title="' + esc(p.precio_referencia_nota || 'Precio de referencia estimado') + '">Ref. ' + q(p.precio_referencia) + '</span>' : 'Ref. —') + '</small>',
        pill(p.estado)]);
    }).join('') : vacia(7, productos.length ? 'Ningún producto coincide.' : 'Aún no hay productos. Agrega el primero con «+ Producto».');
    var botones = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - pagProd) <= 1) botones.push(n); else if (botones[botones.length - 1] !== '…') botones.push('…');
    $('iaPaginas').innerHTML = l.length ? '<span>' + (ini + 1) + '–' + (ini + vis.length) + ' de ' + l.length + ' producto' + (l.length === 1 ? '' : 's') + '</span>' + (paginas > 1 ? '<nav aria-label="Páginas de productos"><button type="button" class="ia-pag" data-pag-prod="' + (pagProd - 1) + '"' + (pagProd === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      botones.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag-prod="' + n + '"' + (n === pagProd ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag-prod="' + (pagProd + 1) + '"' + (pagProd === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
    var p = productos.filter(function (x) { return x.id === prodSel; })[0];
    $('iaFicha').hidden = !p;
    if (p) {
      var otros = otrosProv.filter(function (o) { return o.producto_id === p.id; });
      $('iaFicha').innerHTML = registro(p, 'prod') + '<div class="org-loc"><div class="geo-ficha-grid">' +
        dato('Clasificación', p.clasificacion) + dato('Tipo de producto', p.tipo_producto) + dato('Principio activo', p.principio_activo) + dato('Marca', p.marca) +
        dato('Código de barras', p.codigo_barras) + dato('Presentación', p.presentacion) + dato('Unidad de medida', p.unidad) + dato('¿Es genérico?', p.generico ? 'Sí' : 'No') +
        dato('Proveedor principal', nombreProv(p.proveedor_id)) + dato('Bodega', p.bodega_id ? nombreBodega(p.bodega_id) : null) + dato('Control de punto mínimo', p.control_minimo ? 'Sí' : 'No') + dato('Mínimo / Máximo', (p.minimo != null ? Number(p.minimo) : '—') + ' / ' + (p.maximo != null ? Number(p.maximo) : '—')) +
        dato('Precio de costo', q(p.costo)) + dato('Precio de referencia (estimado)', p.precio_referencia != null ? q(p.precio_referencia) : null) + (p.precio_referencia_nota ? '<div class="geo-info full"><span>Nota del precio de referencia</span><b class="inv-sub">' + esc(p.precio_referencia_nota) + '</b></div>' : '') + dato('Ubicación', ['Estante ' + (p.estante || '—'), 'Fila ' + (p.fila || '—'), 'Bloque ' + (p.bloque || '—')].join(' · '), 1) +
        '<div class="geo-info full"><span>Otros proveedores</span><div class="inv-chips">' + (otros.length ? otros.map(function (o) { return '<span class="geo-chip">' + esc(nombreProv(o.proveedor_id) || 'Proveedor') + ' <button type="button" data-quitar-prov="' + o.proveedor_id + '" aria-label="Quitar">×</button></span>'; }).join('') : '<span class="inv-sub">Ninguno</span>') +
        '<select id="iaOtroProv" class="adm-input inv-mini-sel" aria-label="Agregar proveedor"><option value="">+ Agregar proveedor…</option>' + proveedores.filter(function (x) { return x.estado === 'activo' && x.id !== p.proveedor_id && !otros.some(function (o) { return o.proveedor_id === x.id; }); }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.nombre_comercial) + '</option>'; }).join('') + '</select></div></div>' +
        '</div><div class="org-logo inv-logo">' + imagenProducto(p, 110) + (p.foto ? (p.foto_credito ? '<small class="inv-credito">' + esc(p.foto_credito) + '</small>' : '') : '<small>Ilustración · ' + esc(p.presentacion || 'producto') + '</small>') + '</div></div>';
    }
  }
  async function cargarProductos() {
    aviso('iaMsg', '');
    try {
      var r = await Promise.all([todas(function () { return sb.from('inv_productos').select('*').order('numero'); }), sb.from('inv_producto_proveedores').select('*')]);
      productos = r[0].sort(porNumero); otrosProv = r[1].error ? [] : r[1].data;
    } catch (e) { productos = []; $('iaLista').innerHTML = ''; aviso('iaMsg', traducir(e), true); return; }
    if (!productos.some(function (p) { return p.id === prodSel; })) prodSel = productos.length ? productos[0].id : null;
    irAlProd = true; pintarProductos();
  }
  async function subirFoto(id, archivo) {
    if (!archivo) return null;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) return 'La imagen debe ser PNG, JPG o WEBP.';
    if (archivo.size > 2 * 1024 * 1024) return 'La imagen pesa más de 2 MB.';
    var ruta = 'productos/producto-' + id + '-' + Date.now() + '.' + (archivo.type === 'image/jpeg' ? 'jpg' : archivo.type.split('/')[1]);
    var up = await sb.storage.from('publico').upload(ruta, archivo, { contentType: archivo.type, upsert: true, cacheControl: '300' });
    if (up.error) return 'El producto se grabó, pero la imagen no se pudo subir: ' + traducir(up.error);
    var r = await sb.from('inv_productos').update({ foto: ruta }).eq('id', id);
    return r.error ? traducir(r.error) : null;
  }
  function editarProducto(p) {
    var v = p ? Object.assign({}, p) : { estado: 'activo', bodega_id: (bodegas.filter(function (b) { return b.tipo === 'general' && b.estado === 'activo'; })[0] || {}).id };
    G.dialogo({
      eyebrow: 'Inventarios · Producto', titulo: p ? p.nombre : 'Nuevo producto', valores: v,
      campos: [{ k: 'numero', label: 'N.º artículo', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'codigo', label: 'Código de producto', max: 40, placeholder: 'AMX-500' }, { k: 'codigo_barras', label: 'Código de barras', max: 60 },
        { k: 'nombre', label: 'Nombre del producto', req: true, max: 200, ancho: 'full' },
        { k: 'clasificacion', label: 'Clasificación', max: 80, lista: CLASIFICACIONES }, { k: 'tipo_producto', label: 'Tipo de producto', max: 80, placeholder: 'Ej.: Antibióticos', lista: tiposProd.filter(function (x) { return x.estado === 'activo'; }).map(function (x) { return x.nombre; }) },
        { k: 'principio_activo', label: 'Principio activo', max: 150 }, { k: 'marca', label: 'Marca', max: 80 },
        { k: 'presentacion', label: 'Presentación', max: 80, lista: PRESENTACIONES }, { k: 'unidad', label: 'Unidad de medida', max: 40, lista: UNIDADES },
        { k: 'proveedor_id', label: 'Proveedor principal', tipo: 'select', opciones: [['', '—']].concat(proveedores.filter(function (x) { return x.estado === 'activo' || (p && x.id === p.proveedor_id); }).map(function (x) { return [x.id, x.nombre_comercial]; })) },
        { k: 'bodega_id', label: 'Bodega', tipo: 'select', opciones: [['', '—']].concat(bodegas.filter(function (x) { return x.estado === 'activo' || (p && x.id === p.bodega_id); }).map(function (x) { return [x.id, x.numero + ' · ' + x.nombre]; })) },
        { k: 'costo', label: 'Precio de costo (Q)', tipo: 'number', paso: '0.01' }, { k: 'precio_referencia', label: 'Precio ref. (Q, estimado)', tipo: 'number', paso: '0.01' }, { k: 'minimo', label: 'Mínimo', tipo: 'number', paso: '0.01' }, { k: 'maximo', label: 'Máximo', tipo: 'number', paso: '0.01' },
        { k: 'estante', label: 'Estante', max: 20 }, { k: 'fila', label: 'Fila', max: 20 }, { k: 'bloque', label: 'Bloque', max: 20 },
        { k: 'sede', tipo: 'sede' },
        { k: 'generico', label: '¿Es genérico?', tipo: 'check' }, { k: 'control_minimo', label: 'Administrar punto mínimo', tipo: 'check' },
        { k: 'foto_archivo', label: p && p.foto ? 'Cambiar imagen' : 'Imagen', tipo: 'file', accept: 'image/png,image/jpeg,image/webp', ayuda: 'PNG, JPG o WEBP de hasta 2 MB.', ancho: 'full' }],
      secciones: [
        { titulo: 'Identificación', campos: ['numero', 'estado', 'codigo', 'codigo_barras', 'nombre', 'clasificacion', 'tipo_producto', 'principio_activo', 'marca', 'presentacion', 'unidad'] },
        { titulo: 'Abastecimiento y existencias', campos: ['proveedor_id*', 'bodega_id', 'costo', 'precio_referencia', 'minimo', 'maximo', 'generico', 'control_minimo'] },
        { titulo: 'Ubicación e imagen', campos: ['estante', 'fila', 'bloque', 'sede', 'foto_archivo'] }
      ],
      alAbrir: function () {
        if (!p) $('geoF_numero').textContent = 'Se asigna al grabar';
        // Imagen actual del producto al final del formulario; si no tiene foto, se pide subir el archivo
        var campo = $('geoF_foto_archivo').closest('label'), caja = document.createElement('div');
        caja.className = 'full inv-dlg-img';
        var pintar = function (html, nota, aviso) { caja.innerHTML = '<div class="inv-dlg-img-vista">' + html + '</div><div class="inv-dlg-img-txt"><b>' + (p && p.foto ? 'Imagen actual' : 'Sin foto del producto') + '</b><span' + (aviso ? ' class="inv-dlg-img-aviso"' : '') + '>' + nota + '</span></div>'; };
        if (p && p.foto) pintar(imagenProducto(p, 120), esc(p.foto_credito || 'Foto subida para este producto.') + ' Para cambiarla, elige otro archivo abajo.');
        else pintar(ilustracion(p || {}, 120), 'Este producto aún no tiene foto: se muestra una ilustración según su presentación. <b>Sube el archivo de imagen</b> del producto (PNG, JPG o WEBP de hasta 2 MB).', true);
        campo.parentNode.insertBefore(caja, campo);
        $('geoF_foto_archivo').addEventListener('change', function () {
          var f = this.files && this.files[0];
          if (!f) return;
          if (['image/png', 'image/jpeg', 'image/webp'].indexOf(f.type) < 0 || f.size > 2 * 1024 * 1024) { pintar(caja.querySelector('.inv-dlg-img-vista').innerHTML, 'El archivo debe ser PNG, JPG o WEBP de hasta 2 MB.', true); return; }
          pintar('<img class="inv-foto" src="' + URL.createObjectURL(f) + '" alt="Vista previa" width="120" height="120">', 'Vista previa de <b>' + esc(f.name) + '</b>. Se guardará al pulsar «Grabar».');
        });
      },
      guardar: async function (d) {
        var archivo = d.foto_archivo; delete d.foto_archivo;
        ['proveedor_id', 'bodega_id'].forEach(function (k) { d[k] = d[k] ? +d[k] : null; });
        if (d.minimo != null && d.maximo != null && d.minimo > d.maximo) return 'El mínimo no puede ser mayor que el máximo.';
        d.no_definido = false;   // al grabar la ficha, el producto creado desde una compra queda definido
        var r = p ? await sb.from('inv_productos').update(d).eq('id', p.id).select('id').single() : await sb.from('inv_productos').insert(d).select('id').single();
        if (r.error) return traducir(r.error);
        prodSel = r.data.id;
        var e = await subirFoto(r.data.id, archivo);
        await cargarProductos(); return e;
      },
      eliminar: p ? async function () { var r = await sb.from('inv_productos').delete().eq('id', p.id); if (r.error) return traducir(r.error); prodSel = null; await cargarProductos(); return null; } : null
    });
  }

  // ================= 5. Precios por tipo de cliente =================
  $('admInvPrecios').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Precios de productos</h3></div>' +
    '<p class="dlg-msg">Un precio por tipo de cliente para cada producto de tu sede. Toca un precio (o «Definir») para grabarlo o modificarlo; la utilidad se calcula con el precio de costo del producto.</p>' +
    '<div class="inv-barra"><input id="ivBuscar" type="search" class="adm-input geo-buscar" placeholder="Buscar producto" aria-label="Buscar producto"></div>' +
    '<section class="geo-panel"><div class="roles-wrap pr-wrap"><table class="pr-tabla inv-precios"><colgroup><col class="pr-col-proc">' + TIPOS.map(function () { return '<col>'; }).join('') + '</colgroup>' +
    '<thead><tr><th>Producto</th>' + TIPOS.map(function (t) { return '<th class="num">' + t[1] + '</th>'; }).join('') + '</tr></thead><tbody id="ivLista"></tbody></table></div></section>' +
    '<p id="ivMsg" class="dlg-msg" role="status"></p></div>';
  function pintarPrecios() {
    var t = norm($('ivBuscar').value);
    var l = productos.filter(function (p) { return p.estado !== 'baja' && (!t || norm([p.nombre, p.codigo].join(' ')).indexOf(t) >= 0); });
    $('ivLista').innerHTML = l.length ? l.map(function (p) {
      return '<tr><td><div class="inv-prod">' + imagenProducto(p, 34) + '<div><b>' + esc(p.nombre) + '</b><small class="inv-sub">' + esc([p.codigo, p.presentacion].filter(Boolean).join(' · ')) + (p.costo != null ? ' · costo ' + q(p.costo) : '') + (p.precio_referencia != null ? ' · ref. ' + q(p.precio_referencia) : '') + '</small></div></div></td>' + TIPOS.map(function (tp) {
        var x = precios.filter(function (y) { return y.producto_id === p.id && y.tipo === tp[0]; })[0];
        if (!x) return '<td class="num"><button type="button" class="inv-precio vacio" data-precio="' + p.id + ':' + tp[0] + '">Definir</button></td>';
        return '<td class="num"><button type="button" class="inv-precio' + (x.vigente ? '' : ' no-vigente') + '" data-precio="' + p.id + ':' + tp[0] + '" title="' + esc('Fecha ' + fecha(x.fecha) + ' · grabado por ' + (x.modificado_por || x.creado_por || '')) + '"><b>' + q(x.precio) + '</b>' +
          (x.precio_usd != null ? '<small>' + usd(x.precio_usd) + '</small>' : '') + '<small>' + (x.pct_utilidad != null ? 'util. ' + Number(x.pct_utilidad) + ' % · ' : '') + 'desc. ' + Number(x.pct_descuento) + ' %</small>' +
          '<span class="pr-est pr-est-' + (x.vigente ? 'activo' : 'baja') + '">' + (x.vigente ? 'Vigente' : 'No vigente') + '</span></button></td>';
      }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="7" class="geo-vacia">' + (productos.length ? 'Ningún producto coincide.' : 'Primero define productos en «Definición de productos».') + '</td></tr>';
  }
  async function cargarPrecios() {
    aviso('ivMsg', '');
    try {
      if (!productos.length) productos = (await todas(function () { return sb.from('inv_productos').select('*').order('numero'); })).sort(porNumero);
      precios = await todas(function () { return sb.from('inv_precios').select('*'); });
      if (window.PD_SEDES) { await window.PD_SEDES.cargar(); precios = window.PD_SEDES.deSede(precios); }
    } catch (e) { precios = []; $('ivLista').innerHTML = ''; aviso('ivMsg', traducir(e), true); return; }
    pintarPrecios();
  }
  function editarPrecio(prodId, tipo) {
    var p = productos.filter(function (x) { return x.id === prodId; })[0], x = precios.filter(function (y) { return y.producto_id === prodId && y.tipo === tipo; })[0];
    var hoy = new Date(), v = x ? Object.assign({}, x) : { fecha: hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2) + '-' + ('0' + hoy.getDate()).slice(-2), vigente: true, pct_descuento: 0 };
    G.dialogo({
      eyebrow: 'Precios de productos · ' + nombreTipo(tipo), titulo: p.nombre, valores: v,
      campos: [{ k: 'costo_info', label: 'Precio de costo', tipo: 'info' }, { k: 'fecha', label: 'Fecha', req: true, max: 10, placeholder: 'AAAA-MM-DD' },
        { k: 'precio', label: 'Precio (Q)', tipo: 'number', paso: '0.01', req: true }, { k: 'precio_usd', label: 'Precio (US$)', tipo: 'number', paso: '0.01' },
        { k: 'pct_descuento', label: '% de descuento máximo', tipo: 'number', paso: '0.01', maxNum: 100 }, { k: 'utilidad_info', label: '% de utilidad (calculado)', tipo: 'info' },
        { k: 'sede', tipo: 'sede' }, { k: 'vigente', label: 'Vigente', tipo: 'check' }],
      alAbrir: function () {
        $('geoF_costo_info').textContent = q(p.costo);
        $('geoF_fecha').type = 'date';
        var calc = function () { var pr = Number($('geoF_precio').value), c = Number(p.costo); $('geoF_utilidad_info').textContent = pr && c ? Math.round((pr - c) / c * 10000) / 100 + ' %' : '—'; };
        $('geoF_precio').addEventListener('input', calc); calc();
      },
      guardar: async function (d) {
        if (d.precio == null) return 'Escribe el precio.';
        d.pct_utilidad = p.costo ? Math.round((d.precio - p.costo) / p.costo * 10000) / 100 : null;
        if (d.pct_utilidad != null && (d.pct_utilidad < 0 || d.pct_utilidad > 1000)) d.pct_utilidad = null;
        d.pct_descuento = d.pct_descuento || 0;
        var r = x ? await sb.from('inv_precios').update(d).eq('id', x.id) : await sb.from('inv_precios').insert(Object.assign({ producto_id: prodId, tipo: tipo }, d));
        if (r.error) return traducir(r.error);
        await cargarPrecios(); return null;
      },
      eliminar: x ? async function () { var r = await sb.from('inv_precios').delete().eq('id', x.id); if (r.error) return traducir(r.error); await cargarPrecios(); return null; } : null
    });
  }

  // ================= Eventos =================
  document.querySelectorAll('#admInvProveedores, #admInvBodegas, #admInvTipos, #admInvProductos').forEach(function (pane) {
    pane.addEventListener('click', function (e) {
      var f = e.target.closest('.inv-filtros [data-valor]');
      if (f) { var clave = f.parentNode.dataset.filtro; filtros[clave] = f.dataset.valor; if (clave === 'prod') pagProd = 1; f.parentNode.querySelectorAll('[data-valor]').forEach(function (b) { b.setAttribute('aria-pressed', b === f); }); ({ prov: pintarProveedores, bod: pintarBodegas, prod: pintarProductos, tipo: pintarTipos })[clave](); return; }
      var m = e.target.closest('[data-inv-modificar]');
      if (m) {
        var t = m.dataset.invModificar;
        if (t === 'prov') editarProveedor(proveedores.filter(function (x) { return x.id === provSel; })[0]);
        if (t === 'sub') editarProveedor(proveedores.filter(function (x) { return x.id === subSel; })[0]);
        if (t === 'bod') editarBodega(bodegas.filter(function (x) { return x.id === bodSel; })[0]);
        if (t === 'prod') editarProducto(productos.filter(function (x) { return x.id === prodSel; })[0]);
        if (t === 'tipo') editarTipo(tiposProd.filter(function (x) { return x.id === tipoSel; })[0]);
        return;
      }
      if (e.target.closest('[data-inv-actualizar]')) { cargarTodo(pane.id); return; }
      var pg = e.target.closest('[data-pag-prod]');
      if (pg) { pagProd = +pg.dataset.pagProd; pintarProductos(); return; }
      var qp = e.target.closest('[data-quitar-prov]');
      if (qp) { sb.from('inv_producto_proveedores').delete().eq('producto_id', prodSel).eq('proveedor_id', +qp.dataset.quitarProv).then(cargarProductos); return; }
      var tr = e.target.closest('tr[data-inv]');
      if (!tr) return;
      var id = +tr.dataset.id, ed = !!e.target.closest('.geo-editar'), tipo = tr.dataset.inv;
      if (tipo === 'prov') { if (ed) editarProveedor(proveedores.filter(function (x) { return x.id === id; })[0]); else { provSel = id; subSel = null; pintarProveedores(); } }
      if (tipo === 'sub') { if (ed) editarProveedor(proveedores.filter(function (x) { return x.id === id; })[0]); else { subSel = id; pintarProveedores(); } }
      if (tipo === 'bod') { if (ed) editarBodega(bodegas.filter(function (x) { return x.id === id; })[0]); else { bodSel = id; pintarBodegas(); } }
      if (tipo === 'tipo') { if (ed) editarTipo(tiposProd.filter(function (x) { return x.id === id; })[0]); else { tipoSel = id; pintarTipos(); } }
      if (tipo === 'prod') { if (ed) editarProducto(productos.filter(function (x) { return x.id === id; })[0]); else { prodSel = id; pintarProductos(); } }
    });
    pane.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-inv]')) e.target.click(); });
  });
  $('admInvProductos').addEventListener('change', function (e) {
    if (e.target.id === 'iaOtroProv' && e.target.value) sb.from('inv_producto_proveedores').insert({ producto_id: prodSel, proveedor_id: +e.target.value }).then(cargarProductos);
    if (e.target.id === 'iaClasif') { pagProd = 1; pintarProductos(); }
  });
  $('ipBuscar').addEventListener('input', pintarProveedores);
  $('iaBuscar').addEventListener('input', function () { pagProd = 1; pintarProductos(); });
  $('ivBuscar').addEventListener('input', pintarPrecios);
  $('ivLista').addEventListener('click', function (e) { var b = e.target.closest('[data-precio]'); if (b) { var k = b.dataset.precio.split(':'); editarPrecio(+k[0], k[1]); } });
  $('ipNuevo').addEventListener('click', function () { editarProveedor(null, null); });
  $('ipNuevaSub').addEventListener('click', function () { var p = proveedores.filter(function (x) { return x.id === provSel; })[0]; if (!p) { aviso('ipMsg', 'Primero elige o crea una empresa principal.', true); return; } editarProveedor(null, p); });
  $('ibNueva').addEventListener('click', function () { editarBodega(null); });
  $('iaNuevo').addEventListener('click', function () { editarProducto(null); });
  $('itNuevo').addEventListener('click', function () { editarTipo(null); });
  $('itBuscar').addEventListener('input', pintarTipos);

  async function cargarTodo(panel) {
    if (window.PD_SEDES) await window.PD_SEDES.cargar();
    if (panel === 'admInvProveedores') return cargarProveedores();
    if (panel === 'admInvBodegas') return cargarBodegas();
    if (panel === 'admInvProductos') { await Promise.all([cargarProveedores(), cargarBodegas(), cargarTipos()]); return cargarProductos(); }
    if (panel === 'admInvTipos') { await cargarTipos(); try { productos = (await todas(function () { return sb.from('inv_productos').select('id,tipo_producto,estado'); })); } catch (e) { productos = []; } return pintarTipos(); }
    if (panel === 'admInvPrecios') { productos = []; return cargarPrecios(); }
  }
  ['admInvProveedores', 'admInvBodegas', 'admInvTipos', 'admInvProductos', 'admInvPrecios'].forEach(function (id) {
    var tab = document.querySelector('[data-tab="' + id + '"]');
    if (tab) tab.addEventListener('click', function () { setTimeout(function () { cargarTodo(id); }, 0); });
  });
  window.PD_INV = { imagenProducto: imagenProducto };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { ['admInvProveedores', 'admInvBodegas', 'admInvTipos', 'admInvProductos', 'admInvPrecios'].forEach(function (id) { if (!$(id).hidden) cargarTodo(id); }); },
    limpiar: function () {
      proveedores = []; bodegas = []; productos = []; precios = []; otrosProv = []; tiposProd = []; provSel = subSel = bodSel = prodSel = tipoSel = null;
      ['ipLista', 'ipSubs', 'ibLista', 'itLista', 'iaLista', 'ivLista'].forEach(function (i) { $(i).innerHTML = ''; });
      ['ipFicha', 'ipFichaSub', 'ibFicha', 'itFicha', 'iaFicha'].forEach(function (i) { $(i).hidden = true; });
    }
  });
})();
