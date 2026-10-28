// Plus Dental — Comisiones (grupo «Comisiones»): catálogo de reglas y pago de comisiones a agentes comerciales.
// Regla: agente (o todos), a qué aplica (todo, procedimientos, medicamentos o laboratorio), cuáles (uno, varios o todos),
// institución (o todas), porcentaje o valor fijo por unidad y vigencia. El cálculo lo hace Supabase (comisiones_lineas):
// base = lo cobrado y el costo de las órdenes de laboratorio recibidas; gana la regla más específica.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admComReglas')) return;

  var APLICA = { todo: 'Todo lo cobrado', procedimientos: 'Procedimientos', medicamentos: 'Medicamentos', laboratorio: 'Laboratorio' };
  var METODOS = { transferencia: 'Transferencia', efectivo: 'Efectivo', cheque: 'Cheque', deposito: 'Depósito', otro: 'Otro' };
  var agentes = [], instituciones = [], catalogo = { procedimientos: [], medicamentos: [], laboratorio: [] };
  var reglas = [], regla = null, elegidos = {}, lineas = [], pagos = [], calculo = null, faltaSql = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/comisiones_|could not find the (table|function)|does not exist/i.test(m) && !/pendientes|motivo|anulado|rango/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las comisiones.';
    if (/comisiones_reglas_pct/i.test(m)) return 'El porcentaje debe estar entre 0 y 100.';
    if (/comisiones_reglas_vigencia/i.test(m)) return 'La fecha final de vigencia no puede ser anterior a la inicial.';
    if (/row-level security|permission denied|No tienes permiso/i.test(m)) return 'No tienes permiso para esta acción.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }
  function nombreAgente(id) { var a = agentes.filter(function (x) { return x.id === id; })[0]; return a ? a.codigo + ' · ' + a.nombre : 'Todos los agentes'; }
  function nombreInst(id) { var i = instituciones.filter(function (x) { return x.id === id; })[0]; return i ? i.nombre : 'Todas'; }
  function nombreElem(tipo, id) { var e = (catalogo[tipo] || []).filter(function (x) { return x.id === id; })[0]; return e ? e.nombre : '#' + id; }
  function textoComision(tipo, valor) { return tipo === 'valor' ? q(valor) + ' c/u' : pct(valor); }

  // ---------- Catálogos de apoyo ----------
  async function cargarApoyo() {
    var r = await Promise.all([
      sb.from('agentes').select('id,codigo,nombre,comision,estado').order('codigo'),
      sb.from('jor_instituciones').select('id,nombre').order('nombre'),
      sb.from('tipos_procedimiento').select('id,nombre,estado').order('nombre'),
      sb.from('inv_productos').select('id,codigo,nombre,presentacion,estado').order('nombre'),
      sb.from('laboratorios').select('id,nombre,activo').order('nombre')
    ]);
    function orden(c) { return /^\d+$/.test(c) ? +c : Infinity; }
    agentes = (r[0].data || []).filter(function (a) { return a.codigo !== '0'; }).sort(function (a, b) { return orden(a.codigo) - orden(b.codigo); });
    instituciones = r[1].data || [];
    catalogo.procedimientos = (r[2].data || []).map(function (x) { return { id: x.id, nombre: x.nombre, activo: x.estado !== 'inactivo' }; });
    catalogo.medicamentos = (r[3].data || []).map(function (x) { return { id: x.id, nombre: [x.codigo, x.nombre, x.presentacion].filter(Boolean).join(' · '), activo: x.estado === 'activo' }; });
    catalogo.laboratorio = (r[4].data || []).map(function (x) { return { id: x.id, nombre: x.nombre, activo: x.activo !== false }; });
    var opAg = agentes.map(function (a) { return '<option value="' + a.id + '">' + esc(a.codigo + ' · ' + a.nombre) + (a.estado !== 'activo' ? ' (' + a.estado + ')' : '') + '</option>'; }).join('');
    ['crAgente', 'crFiltroAg'].forEach(function (id) { var v = $(id).value; $(id).innerHTML = '<option value="">Todos los agentes</option>' + opAg; $(id).value = v; });
    var v = $('cpAgente').value; $('cpAgente').innerHTML = '<option value="">Elige el agente…</option>' + opAg; $('cpAgente').value = v;
    var vi = $('crInst').value; $('crInst').innerHTML = '<option value="">Todas las instituciones</option>' + instituciones.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join(''); $('crInst').value = vi;
  }

  // ======================= Catálogo de comisiones =======================
  $('admComReglas').innerHTML =
    '<div id="crLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Catálogo de comisiones</h3><button type="button" id="crNueva" class="adm-btn adm-primary">Nueva regla</button></div>' +
    '<p class="dlg-msg">Define cuánto gana cada agente comercial: un porcentaje o un valor fijo por unidad, para todo lo cobrado, para uno, varios o todos los procedimientos, medicamentos o laboratorios, y para una institución. ' +
    'Si a un cobro le aplican varias reglas se usa la más específica (agente › institución › elementos elegidos › tipo). Sin regla se usa el % general del agente.</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="crFiltroAg" class="adm-input" aria-label="Filtrar por agente" style="max-width:320px"></select>' +
    '<select id="crFiltroAp" class="adm-input" aria-label="Filtrar por tipo" style="max-width:220px"><option value="">Todo tipo</option>' + Object.keys(APLICA).map(function (k) { return '<option value="' + k + '">' + APLICA[k] + '</option>'; }).join('') + '</select></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Agente</th><th>Aplica a</th><th>Cuáles</th><th>Institución</th><th class="num">Comisión</th><th>Vigencia</th><th>Estado</th><th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="crBody"></tbody></table></div>' +
    '<p id="crMsg" class="dlg-msg" role="status"></p></div>' +
    '<div id="crFicha" class="adm-pane" hidden>' +
    '<button type="button" id="crVolver" class="dlg-link">← Todas las reglas</button>' +
    '<div class="adm-pane-head"><h3 id="crTitulo" class="adm-h">Nueva regla</h3></div>' +
    '<form id="crForm" class="adm-pane" novalidate>' +
    '<fieldset class="pos-sec"><legend>¿A quién y a qué aplica?</legend><div class="exp-form">' +
    '<label>Agente comercial<select id="crAgente"></select></label>' +
    '<label>Institución<select id="crInst"></select></label>' +
    '<label>Aplica a<select id="crAplica">' + Object.keys(APLICA).map(function (k) { return '<option value="' + k + '">' + APLICA[k] + '</option>'; }).join('') + '</select></label>' +
    '<div class="exp-campo" id="crElemCampo"><span class="pos-lbl" id="crElemTit">Cuáles</span>' +
    '<label class="com-todos"><input type="checkbox" id="crTodos" checked> <span id="crTodosTxt">Todos</span></label></div>' +
    '<div class="full com-elems" id="crElems" hidden><input type="search" id="crElemBuscar" class="adm-input" placeholder="Buscar…" aria-label="Buscar elemento"><div id="crElemLista" class="com-elem-lista" role="group"></div><p id="crElemCuenta" class="dlg-msg"></p></div>' +
    '</div></fieldset>' +
    '<fieldset class="pos-sec"><legend>Comisión</legend><div class="exp-form">' +
    '<label>Tipo de comisión<select id="crTipo"><option value="porcentaje">Porcentaje (%) sobre lo cobrado</option><option value="valor">Valor fijo (Q) por unidad</option></select></label>' +
    '<label><span id="crValorTxt">Porcentaje *</span><input id="crValor" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="0.00"></label>' +
    '<label>Vigente desde<input id="crDesde" type="date"></label>' +
    '<label>Vigente hasta<input id="crHasta" type="date"></label>' +
    '<label>Estado<select id="crEstado"><option value="activo">Activa</option><option value="inactivo">Inactiva</option></select></label>' +
    '<label class="full">Observaciones<input id="crObs" type="text" maxlength="300" autocomplete="off"></label>' +
    '</div></fieldset>' +
    '<p id="crReg" class="dlg-msg"></p>' +
    '<div class="exp-actions"><button type="submit" class="adm-btn adm-primary">Grabar regla</button><button type="button" id="crEliminar" class="adm-btn" hidden>Eliminar regla</button><p id="crFormMsg" class="dlg-msg" role="status"></p></div>' +
    '</form></div>';

  function verReglas(id) { ['crLista', 'crFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargarReglas() {
    aviso('crMsg', '');
    $('crBody').innerHTML = '<tr><td colspan="8">Cargando…</td></tr>';
    await cargarApoyo();
    var r = await sb.from('comisiones_reglas').select('*').order('id');
    faltaSql = !!r.error;
    if (r.error) { $('crBody').innerHTML = ''; aviso('crMsg', traducir(r.error), true); return; }
    reglas = r.data || [];
    pintarReglas();
  }
  function pintarReglas() {
    var fa = $('crFiltroAg').value, fp = $('crFiltroAp').value;
    var lista = reglas.filter(function (x) { return (!fa || String(x.agente_id || '') === fa) && (!fp || x.aplica === fp); });
    if (!lista.length) { $('crBody').innerHTML = '<tr><td colspan="8">' + (reglas.length ? 'Ninguna regla coincide con el filtro.' : 'Todavía no hay reglas. Mientras no las haya, se usa el % general de cada agente. Crea la primera con «Nueva regla».') + '</td></tr>'; return; }
    $('crBody').innerHTML = lista.map(function (x) {
      var cuales = x.aplica === 'todo' ? '—' : !x.elementos.length ? 'Todos' :
        x.elementos.slice(0, 3).map(function (id) { return esc(nombreElem(x.aplica, id)); }).join(', ') + (x.elementos.length > 3 ? ' y ' + (x.elementos.length - 3) + ' más' : '');
      var vig = x.vigente_desde || x.vigente_hasta ? (x.vigente_desde ? fechaCorta(x.vigente_desde) : '…') + ' – ' + (x.vigente_hasta ? fechaCorta(x.vigente_hasta) : '…') : 'Siempre';
      return '<tr><td>' + esc(nombreAgente(x.agente_id)) + '</td><td>' + APLICA[x.aplica] + '</td><td>' + cuales + '</td><td>' + esc(nombreInst(x.institucion_id)) + '</td>' +
        '<td class="num"><strong>' + textoComision(x.tipo, x.valor) + '</strong></td><td class="fecha">' + vig + '</td>' +
        '<td><span class="estado estado-' + (x.estado === 'activo' ? 'activo' : 'inactivo') + '">' + (x.estado === 'activo' ? 'Activa' : 'Inactiva') + '</span></td>' +
        '<td><button type="button" class="adm-btn" data-cr="' + x.id + '">Abrir</button></td></tr>';
    }).join('');
  }

  function pintarElementos() {
    var ap = $('crAplica').value, lista = catalogo[ap] || [], b = sinTildes($('crElemBuscar').value);
    $('crElemCampo').hidden = ap === 'todo';
    var nombres = { procedimientos: 'tipos de procedimiento', medicamentos: 'medicamentos y productos', laboratorio: 'laboratorios' };
    $('crElemTit').textContent = 'Cuáles ' + (nombres[ap] || '');
    $('crTodosTxt').textContent = 'Todos los ' + (nombres[ap] || '');
    $('crElems').hidden = ap === 'todo' || $('crTodos').checked;
    if ($('crElems').hidden) return;
    $('crElemLista').innerHTML = lista.filter(function (e) { return !b || sinTildes(e.nombre).indexOf(b) >= 0 || elegidos[e.id]; })
      .map(function (e) { return '<label><input type="checkbox" data-el="' + e.id + '"' + (elegidos[e.id] ? ' checked' : '') + '> ' + esc(e.nombre) + (e.activo ? '' : ' <span class="hi-desc">(inactivo)</span>') + '</label>'; }).join('') ||
      '<p class="dlg-msg">' + (lista.length ? 'Nada coincide con la búsqueda.' : 'No hay registros en este catálogo.') + '</p>';
    var n = Object.keys(elegidos).length;
    $('crElemCuenta').textContent = n ? n + (n === 1 ? ' elegido' : ' elegidos') : 'Elige uno o varios.';
  }
  function pintarTipo() {
    var v = $('crTipo').value === 'valor';
    $('crValorTxt').textContent = v ? 'Valor por unidad (Q) *' : 'Porcentaje *';
    $('crValor').max = v ? '' : '100';
  }
  function abrirRegla(x) {
    regla = x || null;
    elegidos = {};
    (x ? x.elementos : []).forEach(function (id) { elegidos[id] = 1; });
    $('crTitulo').textContent = x ? 'Regla de comisión' : 'Nueva regla';
    $('crAgente').value = x && x.agente_id ? String(x.agente_id) : '';
    $('crInst').value = x && x.institucion_id ? String(x.institucion_id) : '';
    $('crAplica').value = x ? x.aplica : 'procedimientos';
    $('crTodos').checked = !x || !x.elementos.length;
    $('crTipo').value = x ? x.tipo : 'porcentaje';
    $('crValor').value = x ? Number(x.valor) : '';
    $('crDesde').value = (x && x.vigente_desde) || '';
    $('crHasta').value = (x && x.vigente_hasta) || '';
    $('crEstado').value = x ? x.estado : 'activo';
    $('crObs').value = (x && x.observaciones) || '';
    $('crElemBuscar').value = '';
    $('crEliminar').hidden = !x;
    $('crReg').textContent = x ? 'Registrada por ' + (x.registrado_por || '—') + ' el ' + fechaCorta(x.creado) + (x.modificado ? ' · Último cambio: ' + (x.modificado_por || '—') + ' el ' + fechaCorta(x.modificado) : '') : '';
    aviso('crFormMsg', '');
    pintarTipo(); pintarElementos();
    verReglas('crFicha');
    $('crAgente').focus();
  }

  $('crNueva').addEventListener('click', function () {
    if (faltaSql) { aviso('crMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las comisiones.', true); return; }
    abrirRegla(null);
  });
  $('crVolver').addEventListener('click', function () { verReglas('crLista'); });
  $('crBody').addEventListener('click', function (e) { var b = e.target.closest('[data-cr]'); if (b) abrirRegla(reglas.filter(function (x) { return String(x.id) === b.dataset.cr; })[0]); });
  $('crFiltroAg').addEventListener('change', pintarReglas);
  $('crFiltroAp').addEventListener('change', pintarReglas);
  $('crAplica').addEventListener('change', function () { elegidos = {}; $('crTodos').checked = true; pintarElementos(); });
  $('crTodos').addEventListener('change', function () { if (this.checked) elegidos = {}; pintarElementos(); if (!this.checked) $('crElemBuscar').focus(); });
  $('crElemBuscar').addEventListener('input', pintarElementos);
  $('crElemLista').addEventListener('change', function (e) {
    var c = e.target.closest('[data-el]'); if (!c) return;
    if (c.checked) elegidos[c.dataset.el] = 1; else delete elegidos[c.dataset.el];
    var n = Object.keys(elegidos).length;
    $('crElemCuenta').textContent = n ? n + (n === 1 ? ' elegido' : ' elegidos') : 'Elige uno o varios.';
  });
  $('crTipo').addEventListener('change', pintarTipo);

  $('crForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var ap = $('crAplica').value, valor = $('crValor').value === '' ? NaN : Number($('crValor').value), tipo = $('crTipo').value;
    var elems = ap === 'todo' || $('crTodos').checked ? [] : Object.keys(elegidos).map(Number);
    if (ap !== 'todo' && !$('crTodos').checked && !elems.length) { aviso('crFormMsg', 'Elige al menos uno, o marca «Todos».', true); $('crElemBuscar').focus(); return; }
    if (isNaN(valor) || valor < 0 || (tipo === 'porcentaje' && valor > 100)) { aviso('crFormMsg', tipo === 'porcentaje' ? 'El porcentaje debe estar entre 0 y 100.' : 'Escribe un valor mayor o igual a cero.', true); $('crValor').focus(); return; }
    if ($('crDesde').value && $('crHasta').value && $('crHasta').value < $('crDesde').value) { aviso('crFormMsg', 'La fecha final de vigencia no puede ser anterior a la inicial.', true); $('crHasta').focus(); return; }
    var datos = {
      agente_id: $('crAgente').value ? +$('crAgente').value : null, institucion_id: $('crInst').value ? +$('crInst').value : null,
      aplica: ap, elementos: elems, tipo: tipo, valor: Math.round(valor * 100) / 100,
      vigente_desde: $('crDesde').value || null, vigente_hasta: $('crHasta').value || null,
      estado: $('crEstado').value, observaciones: $('crObs').value.trim() || null
    };
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true; aviso('crFormMsg', 'Guardando…');
    var r = regla ? await sb.from('comisiones_reglas').update(datos).eq('id', regla.id).select('*').single() : await sb.from('comisiones_reglas').insert(datos).select('*').single();
    boton.disabled = false;
    if (r.error) { aviso('crFormMsg', traducir(r.error), true); return; }
    await cargarReglas();
    verReglas('crLista');
    aviso('crMsg', regla ? 'Se guardaron los cambios de la regla.' : 'Se creó la regla de comisión.');
  });
  $('crEliminar').addEventListener('click', async function () {
    if (!regla || !pedirConfirmacion(this)) return;
    var r = await sb.from('comisiones_reglas').delete().eq('id', regla.id).select('id');
    if (r.error || !r.data || !r.data.length) { aviso('crFormMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return; }
    await cargarReglas();
    verReglas('crLista');
    aviso('crMsg', 'Se eliminó la regla.');
  });

  // ======================= Pago de comisiones =======================
  $('admComPago').innerHTML =
    '<div class="adm-pane-head"><h3 class="adm-h">Pago de comisiones</h3></div>' +
    '<p class="dlg-msg">Elige el agente y el rango de fechas, pulsa «Calcular» y registra el pago. Las líneas pagadas quedan marcadas y no se vuelven a pagar; si anulas un pago, quedan otra vez pendientes.</p>' +
    '<div class="com-filtros"><label>Fecha inicial<input id="cpDesde" type="date" class="adm-input"></label><label>Fecha final<input id="cpHasta" type="date" class="adm-input"></label>' +
    '<label>Agente comercial<select id="cpAgente" class="adm-input"></select></label><button type="button" id="cpCalcular" class="adm-btn adm-primary">Calcular</button></div>' +
    '<p id="cpMsg" class="dlg-msg" role="status"></p>' +
    '<div id="cpResultado" class="adm-pane" hidden>' +
    '<div id="cpResumen" class="com-resumen"></div>' +
    '<div class="com-filtros" role="group" aria-label="Mostrar líneas"><button type="button" class="adm-btn" data-cpver="pend" aria-pressed="true">Pendientes</button><button type="button" class="adm-btn" data-cpver="pag" aria-pressed="false">Pagadas</button><button type="button" class="adm-btn" data-cpver="todas" aria-pressed="false">Todas</button></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Fecha</th><th>Documento</th><th>Paciente</th><th>Concepto</th><th class="num">Base</th><th class="num">Regla</th><th class="num">Comisión</th><th>Estado</th></tr></thead><tbody id="cpBody"></tbody></table></div>' +
    '<fieldset id="cpPagar" class="pos-sec"><legend>Registrar pago</legend><div class="exp-form">' +
    '<label>Fecha de pago<input id="cpFecha" type="date"></label>' +
    '<label>Forma de pago<select id="cpMetodo">' + Object.keys(METODOS).map(function (k) { return '<option value="' + k + '">' + METODOS[k] + '</option>'; }).join('') + '</select></label>' +
    '<label>Referencia / No. de documento<input id="cpRef" type="text" maxlength="80" autocomplete="off"></label>' +
    '<label>Observaciones<input id="cpObs" type="text" maxlength="300" autocomplete="off"></label>' +
    '</div><div class="exp-actions"><button type="button" id="cpRegistrar" class="adm-btn adm-primary">Registrar pago</button><p id="cpPagoMsg" class="dlg-msg" role="status"></p></div></fieldset>' +
    '</div>' +
    '<h4 class="com-sub">Pagos registrados del agente</h4>' +
    '<div class="roles-wrap"><table><thead><tr><th>No.</th><th>Fecha de pago</th><th>Período</th><th class="num">Líneas</th><th class="num">Base</th><th class="num">Comisión pagada</th><th>Forma de pago</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="cpPagosBody"><tr><td colspan="9">Elige un agente.</td></tr></tbody></table></div>' +
    '<p id="cpPagosMsg" class="dlg-msg" role="status"></p>';

  var verLineas = 'pend';
  (function () {
    var h = new Date();
    $('cpDesde').value = iso(new Date(h.getFullYear(), h.getMonth(), 1));
    $('cpHasta').value = iso(h);
    $('cpFecha').value = iso(h);
  })();

  function textoRegla(l) { return l.regla_id ? textoComision(l.tipo, l.valor) : pct(l.valor) + ' <span class="hi-desc">(general)</span>'; }
  async function calcular() {
    var ag = $('cpAgente').value, d = $('cpDesde').value, h = $('cpHasta').value;
    aviso('cpPagoMsg', '');
    if (!ag) { aviso('cpMsg', 'Elige el agente comercial.', true); $('cpAgente').focus(); return; }
    if (!d || !h || h < d) { aviso('cpMsg', 'Revisa el rango de fechas.', true); return; }
    aviso('cpMsg', 'Calculando…');
    var r = await sb.rpc('comisiones_lineas', { p_desde: d, p_hasta: h, p_agente: +ag });
    if (r.error) { $('cpResultado').hidden = true; aviso('cpMsg', traducir(r.error), true); return; }
    lineas = r.data || [];
    calculo = { agente: +ag, desde: d, hasta: h };
    aviso('cpMsg', lineas.length ? '' : 'No hay cobros ni órdenes de laboratorio con comisión para ese agente entre esas fechas.');
    $('cpResultado').hidden = !lineas.length;
    pintarLineas();
    cargarPagos();
  }
  function pintarLineas() {
    var pend = lineas.filter(function (l) { return !l.pago_comision_id; }), pag = lineas.filter(function (l) { return l.pago_comision_id; });
    function s(a, k) { return a.reduce(function (t, l) { return t + Number(l[k]); }, 0); }
    $('cpResumen').innerHTML = [['Líneas', lineas.length], ['Base total', q(s(lineas, 'base'))], ['Comisión total', q(s(lineas, 'comision'))], ['Ya pagado', q(s(pag, 'comision'))], ['Pendiente de pago', q(s(pend, 'comision')), 1]]
      .map(function (x) { return '<div' + (x[2] ? ' class="com-dest"' : '') + '><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join('');
    document.querySelectorAll('[data-cpver]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.cpver === verLineas); });
    var lista = verLineas === 'pend' ? pend : verLineas === 'pag' ? pag : lineas;
    $('cpBody').innerHTML = lista.length ? lista.map(function (l) {
      return '<tr><td class="fecha">' + fechaCorta(l.fecha) + '</td><td>' + esc(l.documento) + '</td><td>' + esc(l.paciente) + '</td>' +
        '<td>' + esc(l.concepto) + (Number(l.cantidad) !== 1 ? ' × ' + Number(l.cantidad) : '') + '<br><span class="hi-desc">' + (APLICA[l.categoria] || 'Otros cobros') + '</span></td>' +
        '<td class="num">' + q(l.base) + '</td><td class="num">' + textoRegla(l) + '</td><td class="num"><strong>' + q(l.comision) + '</strong></td>' +
        '<td>' + (l.pago_comision_id ? '<span class="estado estado-finalizado">Pagada · No. ' + l.pago_comision_id + '</span>' : '<span class="estado estado-proceso">Pendiente</span>') + '</td></tr>';
    }).join('') + '<tr class="com-total"><td colspan="4">Total</td><td class="num">' + q(s(lista, 'base')) + '</td><td></td><td class="num">' + q(s(lista, 'comision')) + '</td><td></td></tr>'
      : '<tr><td colspan="8">' + (verLineas === 'pend' ? 'No hay comisiones pendientes de pago.' : 'No hay líneas pagadas.') + '</td></tr>';
    var total = s(pend.filter(function (l) { return Number(l.comision) > 0; }), 'comision');
    $('cpPagar').hidden = !(total > 0);
    $('cpRegistrar').textContent = 'Registrar pago de ' + q(total);
  }
  async function cargarPagos() {
    var ag = $('cpAgente').value;
    aviso('cpPagosMsg', '');
    if (!ag) { $('cpPagosBody').innerHTML = '<tr><td colspan="9">Elige un agente.</td></tr>'; return; }
    var r = await sb.from('comisiones_pagos').select('*').eq('agente_id', +ag).order('id', { ascending: false });
    if (r.error) { $('cpPagosBody').innerHTML = ''; aviso('cpPagosMsg', traducir(r.error), true); return; }
    pagos = r.data || [];
    $('cpPagosBody').innerHTML = pagos.length ? pagos.map(function (p) {
      return '<tr' + (p.anulado ? ' class="com-anulado"' : '') + '><td>' + p.id + '</td><td class="fecha">' + fechaCorta(p.fecha_pago) + '</td><td class="fecha">' + fechaCorta(p.desde) + ' – ' + fechaCorta(p.hasta) + '</td>' +
        '<td class="num">' + p.lineas + '</td><td class="num">' + q(p.base) + '</td><td class="num"><strong>' + q(p.monto) + '</strong></td>' +
        '<td>' + (METODOS[p.metodo] || p.metodo) + (p.referencia ? '<br><span class="hi-desc">' + esc(p.referencia) + '</span>' : '') + '</td>' +
        '<td>' + (p.anulado ? '<span class="estado estado-no_aprobado" title="' + esc(p.anulado_motivo || '') + '">Anulado</span>' : '<span class="estado estado-activo">Pagado</span>') + '</td>' +
        '<td><div class="hi-botones"><button type="button" class="adm-btn" data-cpimp="' + p.id + '">Imprimir</button>' + (p.anulado ? '' : '<button type="button" class="adm-btn" data-cpanular="' + p.id + '">Anular</button>') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="9">Este agente todavía no tiene pagos de comisiones.</td></tr>';
  }

  async function imprimirPago(id) {
    var p = pagos.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p || !window.PD_IMPRESION) return;
    var r = await sb.rpc('comisiones_lineas', { p_desde: p.desde, p_hasta: p.hasta, p_agente: p.agente_id });
    var ls = r.error ? [] : (r.data || []).filter(function (l) { return String(l.pago_comision_id) === String(p.id); });
    var a = agentes.filter(function (x) { return x.id === p.agente_id; })[0];
    var td = 'padding:6px 8px;border-bottom:1px solid #D9E4EC;font-size:12px', tdn = td + ';text-align:right';
    var html = window.PD_IMPRESION.encabezado('Comprobante de pago de comisiones No. ' + p.id) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:13px;margin-bottom:16px">' +
      '<div><b>Agente comercial:</b> ' + esc(a ? a.codigo + ' · ' + a.nombre : '#' + p.agente_id) + '</div><div><b>Fecha de pago:</b> ' + fechaCorta(p.fecha_pago) + '</div>' +
      '<div><b>Período:</b> ' + fechaCorta(p.desde) + ' – ' + fechaCorta(p.hasta) + '</div><div><b>Forma de pago:</b> ' + (METODOS[p.metodo] || p.metodo) + (p.referencia ? ' · ' + esc(p.referencia) : '') + '</div>' +
      (p.anulado ? '<div style="grid-column:1/-1;color:#9A3B2E"><b>ANULADO:</b> ' + esc(p.anulado_motivo || '') + '</div>' : '') + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + td + ';text-align:left">Fecha</th><th style="' + td + ';text-align:left">Documento</th><th style="' + td + ';text-align:left">Paciente</th><th style="' + td + ';text-align:left">Concepto</th><th style="' + tdn + '">Base</th><th style="' + tdn + '">Comisión</th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (l) { return '<tr><td style="' + td + '">' + fechaCorta(l.fecha) + '</td><td style="' + td + '">' + esc(l.documento) + '</td><td style="' + td + '">' + esc(l.paciente) + '</td><td style="' + td + '">' + esc(l.concepto) + '</td><td style="' + tdn + '">' + q(l.base) + '</td><td style="' + tdn + '">' + q(l.comision) + '</td></tr>'; }).join('')
        : '<tr><td colspan="6" style="' + td + '">' + p.lineas + ' líneas (detalle no disponible' + (p.anulado ? ': el pago está anulado' : '') + ').</td></tr>') +
      '<tr><td colspan="4" style="' + td + ';font-weight:700">Total pagado</td><td style="' + tdn + ';font-weight:700">' + q(p.base) + '</td><td style="' + tdn + ';font-weight:700">' + q(p.monto) + '</td></tr></tbody></table>' +
      (p.observaciones ? '<p style="font-size:13px;margin-top:12px"><b>Observaciones:</b> ' + esc(p.observaciones) + '</p>' : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:64px;font-size:13px;text-align:center"><div style="border-top:1px solid #0B2B40;padding-top:6px">Entregado por · ' + esc(p.registrado_por || '') + '</div><div style="border-top:1px solid #0B2B40;padding-top:6px">Recibido · ' + esc(a ? a.nombre : '') + '</div></div>';
    window.PD_IMPRESION.imprimir(html);
  }

  $('cpCalcular').addEventListener('click', calcular);
  $('cpAgente').addEventListener('change', function () { $('cpResultado').hidden = true; lineas = []; calculo = null; aviso('cpMsg', ''); cargarPagos(); });
  ['cpDesde', 'cpHasta'].forEach(function (id) { $(id).addEventListener('change', function () { if (calculo) { $('cpResultado').hidden = true; calculo = null; aviso('cpMsg', 'Cambiaste las fechas: pulsa «Calcular».'); } }); });
  document.querySelectorAll('[data-cpver]').forEach(function (b) { b.addEventListener('click', function () { verLineas = b.dataset.cpver; pintarLineas(); }); });
  $('cpRegistrar').addEventListener('click', async function () {
    if (!calculo || !pedirConfirmacion(this)) return;
    this.disabled = true; aviso('cpPagoMsg', 'Registrando…');
    var r = await sb.rpc('registrar_pago_comision', { p_agente: calculo.agente, p_desde: calculo.desde, p_hasta: calculo.hasta,
      p_datos: { fecha_pago: $('cpFecha').value, metodo: $('cpMetodo').value, referencia: $('cpRef').value.trim(), observaciones: $('cpObs').value.trim() } });
    this.disabled = false;
    if (r.error) { aviso('cpPagoMsg', traducir(r.error), true); return; }
    $('cpRef').value = ''; $('cpObs').value = '';
    await calcular();
    aviso('cpMsg', 'Se registró el pago de comisiones No. ' + r.data + '.');
    imprimirPago(r.data);
  });
  $('cpPagosBody').addEventListener('click', async function (e) {
    var bi = e.target.closest('[data-cpimp]'), ba = e.target.closest('[data-cpanular]');
    if (bi) { imprimirPago(bi.dataset.cpimp); return; }
    if (!ba) return;
    var motivo = prompt('Motivo de la anulación del pago de comisiones No. ' + ba.dataset.cpanular + ':');
    if (motivo === null) return;
    if (!motivo.trim()) { aviso('cpPagosMsg', 'Escribe el motivo de la anulación.', true); return; }
    var r = await sb.rpc('anular_pago_comision', { p_id: +ba.dataset.cpanular, p_motivo: motivo.trim() });
    if (r.error) { aviso('cpPagosMsg', traducir(r.error), true); return; }
    if (calculo) await calcular(); else await cargarPagos();
    aviso('cpPagosMsg', 'Se anuló el pago No. ' + ba.dataset.cpanular + '; sus líneas quedan pendientes otra vez.');
  });

  var t1 = $('tabComReglas'), t2 = $('tabComPago');
  if (t1) t1.addEventListener('click', function () { verReglas('crLista'); cargarReglas(); });
  if (t2) t2.addEventListener('click', function () { cargarApoyo().then(cargarPagos); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { cargarReglas(); },
    limpiar: function () {
      reglas = []; lineas = []; pagos = []; calculo = null;
      $('crBody').innerHTML = ''; $('cpBody').innerHTML = ''; $('cpPagosBody').innerHTML = '<tr><td colspan="9">Elige un agente.</td></tr>';
      $('cpResultado').hidden = true; verReglas('crLista'); aviso('cpMsg', ''); aviso('crMsg', '');
    }
  });
})();
