// Plus Dental — Comisiones (grupo «Comisiones»): catálogo de reglas, generar comisiones y pago de comisiones.
// Beneficiarios: agentes comerciales e instituciones. Regla: para quién, a qué aplica (todo, procedimientos, medicamentos
// o laboratorio), cuáles (uno, varios o todos), institución, porcentaje o valor fijo por unidad y vigencia.
// Supabase graba las comisiones (generar_comisiones): base = lo cobrado y el costo de las órdenes de laboratorio
// recibidas; gana la regla más específica; sin regla, el % del agente o de la institución.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admComReglas')) return;

  var APLICA = { todo: 'Todo lo cobrado', procedimientos: 'Procedimientos', medicamentos: 'Medicamentos', laboratorio: 'Laboratorio' };
  var METODOS = { transferencia: 'Transferencia', efectivo: 'Efectivo', cheque: 'Cheque', deposito: 'Depósito', otro: 'Otro' };
  var sucursales = [];   // sucursales de las instituciones (Generar comisiones)
  var agentes = [], instituciones = [], catalogo = { procedimientos: [], medicamentos: [], laboratorio: [] };
  var reglas = [], regla = null, elegidos = {}, lineas = [], pagos = [], calculo = null, faltaSql = false;   // lineas: comisiones de Pagar Comisiones

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
      sb.from('jor_instituciones').select('id,nombre,comision').order('nombre'),
      sb.from('tipos_procedimiento').select('id,nombre,estado').order('nombre'),
      sb.from('inv_productos').select('id,codigo,nombre,presentacion,estado').order('nombre'),
      sb.from('laboratorios').select('id,nombre,activo').order('nombre'),
      sb.from('jor_sucursales').select('id,nombre,institucion_id').order('nombre')
    ]);
    function orden(c) { return /^\d+$/.test(c) ? +c : Infinity; }
    agentes = (r[0].data || []).filter(function (a) { return a.codigo !== '0'; }).sort(function (a, b) { return orden(a.codigo) - orden(b.codigo); });
    instituciones = r[1].data || [];
    catalogo.procedimientos = (r[2].data || []).map(function (x) { return { id: x.id, nombre: x.nombre, activo: x.estado !== 'inactivo' }; });
    catalogo.medicamentos = (r[3].data || []).map(function (x) { return { id: x.id, nombre: [x.codigo, x.nombre, x.presentacion].filter(Boolean).join(' · '), activo: x.estado === 'activo' }; });
    catalogo.laboratorio = (r[4].data || []).map(function (x) { return { id: x.id, nombre: x.nombre, activo: x.activo !== false }; });
    sucursales = r[5] && !r[5].error ? r[5].data || [] : [];
    var opAg = agentes.map(function (a) { return '<option value="' + a.id + '">' + esc(a.codigo + ' · ' + a.nombre) + (a.estado !== 'activo' ? ' (' + a.estado + ')' : '') + '</option>'; }).join('');
    ['crAgente', 'crFiltroAg'].forEach(function (id) { var v = $(id).value; $(id).innerHTML = '<option value="">Todos los agentes</option>' + opAg; $(id).value = v; });
    llenarBen('gcAgente', 'gcInst', ['ninguno', 'ninguna']);
    opcionesSucGen();
    llenarBen('pqAgente', 'pqInst', ['todos', 'todas']);
    var vi = $('crInst').value; $('crInst').innerHTML = '<option value="">Todas las instituciones</option>' + instituciones.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join(''); $('crInst').value = vi;
  }

  // ======================= Catálogo de comisiones =======================
  $('admComReglas').innerHTML =
    '<div id="crLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Catálogo de comisiones</h3><button type="button" id="crNueva" class="adm-btn adm-primary">Nueva regla</button></div>' +
    '<p class="dlg-msg">Define cuánto gana cada agente comercial o cada institución: un porcentaje o un valor fijo por unidad, para todo lo cobrado o para uno, varios o todos los procedimientos, medicamentos o laboratorios. ' +
    'Si a un cobro le aplican varias reglas se usa la más específica (agente › institución › elementos elegidos › tipo). Sin regla se usa el % del agente o el % de la institución (Jornadas › Instituciones).</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="crFiltroAg" class="adm-input" aria-label="Filtrar por agente" style="max-width:320px"></select>' +
    '<select id="crFiltroAp" class="adm-input" aria-label="Filtrar por tipo" style="max-width:220px"><option value="">Todo tipo</option>' + Object.keys(APLICA).map(function (k) { return '<option value="' + k + '">' + APLICA[k] + '</option>'; }).join('') + '</select></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Comisión para</th><th>Aplica a</th><th>Cuáles</th><th>Institución del paciente</th><th class="num">Comisión</th><th>Vigencia</th><th>Estado</th><th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="crBody"></tbody></table></div>' +
    '<p id="crMsg" class="dlg-msg" role="status"></p></div>' +
    '<div id="crFicha" class="adm-pane" hidden>' +
    '<button type="button" id="crVolver" class="dlg-link">← Todas las reglas</button>' +
    '<div class="adm-pane-head"><h3 id="crTitulo" class="adm-h">Nueva regla</h3></div>' +
    '<form id="crForm" class="adm-pane" novalidate>' +
    '<fieldset class="pos-sec"><legend>¿A quién y a qué aplica?</legend><div class="exp-form">' +
    '<label>Comisión para<select id="crBenef"><option value="agente">Agente comercial</option><option value="institucion">Institución</option></select></label>' +
    '<label id="crAgenteLbl">Agente comercial<select id="crAgente"></select></label>' +
    '<label><span id="crInstTxt">Institución del paciente</span><select id="crInst"></select></label>' +
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
      var inst = x.beneficiario === 'institucion';
      return '<tr><td>' + (inst ? 'Institución: ' + esc(x.institucion_id ? nombreInst(x.institucion_id) : 'todas') : esc(nombreAgente(x.agente_id))) + '</td><td>' + APLICA[x.aplica] + '</td><td>' + cuales + '</td><td>' + (inst ? '—' : esc(nombreInst(x.institucion_id))) + '</td>' +
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
  function pintarBenef() {
    var inst = $('crBenef').value === 'institucion';
    $('crAgenteLbl').hidden = inst;
    $('crInstTxt').textContent = inst ? 'Institución que recibe la comisión' : 'Institución del paciente';
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
    $('crBenef').value = x && x.beneficiario === 'institucion' ? 'institucion' : 'agente';
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
    pintarBenef(); pintarTipo(); pintarElementos();
    verReglas('crFicha');
    $('crBenef').focus();
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
  $('crBenef').addEventListener('change', pintarBenef);

  $('crForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var ap = $('crAplica').value, valor = $('crValor').value === '' ? NaN : Number($('crValor').value), tipo = $('crTipo').value;
    var elems = ap === 'todo' || $('crTodos').checked ? [] : Object.keys(elegidos).map(Number);
    if (ap !== 'todo' && !$('crTodos').checked && !elems.length) { aviso('crFormMsg', 'Elige al menos uno, o marca «Todos».', true); $('crElemBuscar').focus(); return; }
    if (isNaN(valor) || valor < 0 || (tipo === 'porcentaje' && valor > 100)) { aviso('crFormMsg', tipo === 'porcentaje' ? 'El porcentaje debe estar entre 0 y 100.' : 'Escribe un valor mayor o igual a cero.', true); $('crValor').focus(); return; }
    if ($('crDesde').value && $('crHasta').value && $('crHasta').value < $('crDesde').value) { aviso('crFormMsg', 'La fecha final de vigencia no puede ser anterior a la inicial.', true); $('crHasta').focus(); return; }
    var datos = {
      beneficiario: $('crBenef').value, agente_id: $('crBenef').value === 'agente' && $('crAgente').value ? +$('crAgente').value : null, institucion_id: $('crInst').value ? +$('crInst').value : null,
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

  // ======================= Utilidades de beneficiarios =======================
  var ESTADOS_COM = { pendiente: 'Pendiente de pago', pagado: 'Pagado', suspendido: 'Suspendido', anulado: 'Anulado' };
  var CATEGORIA = { procedimientos: 'Procedimiento', medicamentos: 'Medicamento', laboratorio: 'Laboratorio', otros: 'Otro cobro' };
  function usuarioActual() { return (window.PD_SESION && window.PD_SESION.usuario()) || '—'; }
  function agentePorId(id) { return agentes.filter(function (a) { return a.id === id; })[0]; }
  function instPorId(id) { return instituciones.filter(function (i) { return i.id === id; })[0]; }
  function claveBen(l) { return l.beneficiario === 'agente' ? 'a' + l.agente_id : 'i' + l.institucion_id; }
  function idBen(l) { return l.beneficiario === 'agente' ? l.agente_id : l.institucion_id; }
  function nombreBen(benef, id) {
    if (benef === 'agente') { var a = agentePorId(id); return a ? a.codigo + ' · ' + a.nombre : 'Agente ' + id; }
    var i = instPorId(id); return i ? i.nombre : 'Institución ' + id;
  }
  function etiquetaBen(benef) { return '<span class="com-tipo com-tipo-' + benef + '">' + (benef === 'agente' ? 'Agente' : 'Institución') + '</span>'; }
  function ordenBen(a, b) {
    if (a.benef !== b.benef) return a.benef === 'agente' ? -1 : 1;
    return String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true });
  }
  function ordenLinea(x, y) { return String(x.paciente || '').localeCompare(String(y.paciente || ''), 'es') || (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0) || x.id - y.id; }
  // Listas «Agente comercial» e «Institución»: Ninguno/Ninguna, Todos/Todas y cada uno
  function llenarBen(idAg, idIn, porDefecto) {
    var opAg = agentes.map(function (a) { return '<option value="' + a.id + '">' + esc(a.codigo + ' · ' + a.nombre) + (a.estado !== 'activo' ? ' (' + a.estado + ')' : '') + '</option>'; }).join('');
    var opIn = instituciones.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    var va = $(idAg).value || $(idAg).dataset.def || porDefecto[0], vi = $(idIn).value || $(idIn).dataset.def || porDefecto[1];
    $(idAg).innerHTML = '<option value="ninguno">Ninguno</option><option value="todos">Todos los agentes</option>' + opAg; $(idAg).value = va;
    $(idIn).innerHTML = '<option value="ninguna">Ninguna</option><option value="todas">Todas las instituciones</option>' + opIn; $(idIn).value = vi;
    if (!$(idAg).value) $(idAg).value = porDefecto[0];
    if (!$(idIn).value) $(idIn).value = porDefecto[1];
  }
  // Lee las comisiones grabadas de un rango según la elección de agente e institución
  async function leerGeneradas(d, h, ag, ins, estados, suc) {
    var consultas = [];
    function base(benef) {
      var x = sb.from('comisiones_generadas').select('*').eq('beneficiario', benef).gte('fecha', d).lte('fecha', h).order('fecha').limit(5000);
      return estados ? x.in('estado', estados) : x;
    }
    if (ag !== 'ninguno') consultas.push(ag === 'todos' ? base('agente') : base('agente').eq('agente_id', +ag));
    if (ins !== 'ninguna') { var bi = ins === 'todas' ? base('institucion') : base('institucion').eq('institucion_id', +ins); consultas.push(suc ? bi.eq('sucursal_id', +suc) : bi); }
    var rs = await Promise.all(consultas), l = [];
    for (var k = 0; k < rs.length; k++) { if (rs[k].error) throw rs[k].error; l = l.concat(rs[k].data || []); }
    return l;
  }

  // ======================= Generar comisiones =======================
  // Graba las comisiones del rango (agentes y/o instituciones). Maestro por beneficiario con casilla «Autorizar pago»,
  // «Detalle» (cambiar %, estado y autorización; se graba con «Confirmar y actualizar maestro»), «Pagar» (traslada
  // las autorizadas a Pagar Comisiones) y «Revertir» (las saca de Pagar Comisiones si aún no se han pagado).
  var gen = [], genParams = null, genAbierto = null, borrador = {};
  $('admRepComisiones').innerHTML =
    '<div class="adm-pane-head"><h3 class="adm-h">Generar comisiones</h3>' +
    '<div class="hi-botones"><button type="button" class="adm-btn" id="gcImprimir" disabled>Imprimir</button><button type="button" class="adm-btn" id="gcExcel" disabled>Exportar a Excel</button></div></div>' +
    '<p class="dlg-msg">Elige las fechas y de quién generar comisiones: agentes comerciales, instituciones o ambos. Al generar se graban las nuevas; las ya generadas conservan tus cambios. ' +
    'Marca «Autorizar pago»; en «Detalle» puedes cambiar el %, el estado y autorizar línea por línea y luego «Confirmar y actualizar maestro». ' +
    '«Pagar» traslada las comisiones autorizadas a Pagar Comisiones; «Revertir» las saca de ahí mientras no se hayan pagado.</p>' +
    '<div class="com-filtros"><label>Fecha inicial<input id="gcDesde" type="date" class="adm-input"></label><label>Fecha final<input id="gcHasta" type="date" class="adm-input"></label>' +
    '<label>Agente comercial<select id="gcAgente" class="adm-input"><option value="ninguno">Ninguno</option></select></label>' +
    '<label>Institución<select id="gcInst" class="adm-input"><option value="ninguna">Ninguna</option></select></label>' +
    '<label>Sucursal<select id="gcSuc" class="adm-input" disabled title="Elige primero una institución"><option value="">Todas las sucursales</option></select></label>' +
    '<button type="button" id="gcGenerar" class="dlg-submit">Generar comisiones</button></div>' +
    '<p id="gcMsg" class="dlg-msg" role="status"></p>' +
    '<div id="gcRes" class="adm-pane" hidden>' +
    '<div class="rep-params" id="gcParams"></div>' +
    '<div id="gcResumen" class="com-resumen"></div>' +
    '<div id="gcBody" class="com-bens"></div><div id="gcPie"></div>' +
    '<div id="gcDet" class="rep-det" hidden></div>' +
    '</div>';
  (function () { var h = new Date(); $('gcDesde').value = iso(new Date(h.getFullYear(), h.getMonth(), 1)); $('gcHasta').value = iso(h); })();

  function editable(l) { return !l.pago_id && !l.trasladado; }
  // Línea con los cambios aún sin confirmar del detalle
  function conBorrador(l) {
    var c = borrador[l.id];
    if (!c) return l;
    var x = Object.assign({}, l, c);
    x.comision = Math.round((x.tipo === 'porcentaje' ? x.base * x.valor / 100 : x.valor * x.cantidad) * 100) / 100;
    if (x.estado !== 'pendiente') x.autorizado = false;
    return x;
  }
  // Sucursal: se elige cuando hay una institución elegida (Todas = todas sus sucursales)
  function opcionesSucGen() {
    var ins = $('gcInst').value, uno = ins !== 'ninguna' && ins !== 'todas', v = $('gcSuc').value;
    var l = uno ? sucursales.filter(function (s) { return String(s.institucion_id) === ins; }) : [];
    $('gcSuc').innerHTML = '<option value="">Todas las sucursales</option>' + l.map(function (s) { return '<option value="' + s.id + '">' + esc(s.nombre) + '</option>'; }).join('');
    $('gcSuc').value = l.some(function (s) { return String(s.id) === v; }) ? v : '';
    $('gcSuc').disabled = !uno || !l.length;
    $('gcSuc').title = !uno ? 'Elige primero una institución' : l.length ? 'Una o todas las sucursales de la institución' : 'Esta institución no tiene sucursales';
  }
  function resumir(lineasBen) {
    function s(a, k) { return a.reduce(function (t, l) { return t + Number(l[k]); }, 0); }
    var b = {}, vivas = lineasBen.filter(function (l) { return l.estado !== 'anulado'; }), pend = lineasBen.filter(function (l) { return l.estado === 'pendiente'; });
    var libres = pend.filter(function (l) { return !l.trasladado; });
    b.n = vivas.length; b.base = s(vivas, 'base'); b.comision = s(vivas.filter(function (l) { return l.estado !== 'suspendido'; }), 'comision');
    b.autorizado = s(pend.filter(function (l) { return l.autorizado; }), 'comision');
    b.enPago = s(pend.filter(function (l) { return l.trasladado; }), 'comision');
    b.pagado = s(lineasBen.filter(function (l) { return l.estado === 'pagado'; }), 'comision');
    b.pendiente = s(pend, 'comision');
    b.libres = libres.length; b.aut = libres.filter(function (l) { return l.autorizado; }).length;
    b.porTrasladar = libres.filter(function (l) { return l.autorizado && Number(l.comision) > 0; }).length;
    b.trasladadas = pend.filter(function (l) { return l.trasladado; }).length;
    return b;
  }
  function resumirGen() {
    var porBen = {}, orden = [];
    gen.forEach(function (l) {
      var k = claveBen(l);
      if (!porBen[k]) { porBen[k] = { clave: k, benef: l.beneficiario, id: idBen(l), nombre: nombreBen(l.beneficiario, idBen(l)), lineas: [] }; orden.push(porBen[k]); }
      porBen[k].lineas.push(l);
    });
    orden.forEach(function (b) { Object.assign(b, resumir(b.lineas)); });
    return orden.sort(ordenBen);
  }
  function pintarGen() {
    var bs = resumirGen();
    $('gcRes').hidden = !genParams;
    $('gcImprimir').disabled = $('gcExcel').disabled = !gen.length;
    if (!genParams) return;
    $('gcParams').innerHTML = '<span class="rep-params-t">Parámetros</span>' + [['Fecha inicial', fechaCorta(genParams.desde)], ['Fecha final', fechaCorta(genParams.hasta)], ['Agente comercial', genParams.agTxt], ['Institución', genParams.inTxt]].concat(genParams.inst !== 'ninguna' ? [['Sucursal', genParams.sucTxt]] : [])
      .map(function (x) { return '<span class="rep-param-i">' + esc(x[0]) + ' <b>' + esc(x[1]) + '</b></span>'; }).join('');
    function s(k) { return bs.reduce(function (t, b) { return t + b[k]; }, 0); }
    $('gcResumen').innerHTML = [['Beneficiarios', bs.length], ['Base', q(s('base'))], ['Comisiones', q(s('comision'))], ['En Pagar Comisiones', q(s('enPago'))], ['Pagado', q(s('pagado'))], ['Total autorizado', q(s('autorizado')), 1]]
      .map(function (x) { return '<div' + (x[2] ? ' class="com-dest"' : '') + '><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join('');
    var sinPermiso = puedePagar ? '' : ' disabled title="Solo el médico principal o el Super Administrador"';
    function cifras(b) {
      return '<dl class="com-ben-cifras">' + [['Base', b.base], ['Comisión', b.comision], ['Autorizado', b.autorizado, 'dest'], ['En Pagar Comisiones', b.enPago], ['Pagado', b.pagado], ['Pendiente', b.pendiente]]
        .map(function (x) { return '<div' + (x[2] ? ' class="com-ben-dest"' : '') + '><dt>' + x[0] + '</dt><dd>' + q(x[1]) + '</dd></div>'; }).join('') + '</dl>';
    }
    $('gcBody').innerHTML = bs.length ? bs.map(function (b) {
      var todo = b.libres > 0 && b.aut === b.libres, parte = b.aut > 0 && b.aut < b.libres;
      return '<article class="com-ben' + (genAbierto === b.clave ? ' com-sel' : '') + '">' +
        '<div class="com-ben-id"><label class="com-ben-aut" title="' + (b.libres ? b.aut + ' de ' + b.libres + ' comisiones pendientes autorizadas' : 'Sin comisiones pendientes por autorizar') + '"><input type="checkbox" data-gc-aut="' + b.clave + '"' + (todo ? ' checked' : '') + (parte ? ' data-parte="1"' : '') + (b.libres ? '' : ' disabled') +
        ' aria-label="Autorizar el pago de ' + esc(b.nombre) + '"><span>Autorizar pago</span></label>' +
        '<div class="com-ben-nom"><strong>' + esc(b.nombre) + '</strong><span>' + etiquetaBen(b.benef) + ' · ' + b.n + (b.n === 1 ? ' línea' : ' líneas') + '</span></div></div>' +
        cifras(b) +
        '<div class="com-acc"><button type="button" class="adm-btn rep-det-btn" data-gc-det="' + b.clave + '">Detalle</button>' +
        '<button type="button" class="adm-btn rep-det-btn com-btn-pagar" data-gc-pagar-ben="' + b.clave + '"' + (b.porTrasladar ? sinPermiso : ' disabled title="No hay comisiones autorizadas por trasladar"') + '>Pagar</button>' +
        '<button type="button" class="adm-btn rep-det-btn com-btn-rev" data-gc-revertir="' + b.clave + '"' + (b.trasladadas ? sinPermiso : ' disabled title="No hay comisiones sin pagar en Pagar Comisiones"') + '>Revertir</button></div></article>';
    }).join('') : '<p class="dlg-msg">No hay comisiones para esos parámetros.</p>';
    document.querySelectorAll('#gcBody [data-parte]').forEach(function (c) { c.indeterminate = true; });
    $('gcPie').innerHTML = bs.length > 1 ? '<div class="com-ben com-ben-total"><div class="com-ben-id"><div class="com-ben-nom"><strong>TOTAL</strong><span>' + bs.length + ' beneficiarios · ' + s('n') + ' líneas</span></div></div>' +
      cifras({ base: s('base'), comision: s('comision'), autorizado: s('autorizado'), enPago: s('enPago'), pagado: s('pagado'), pendiente: s('pendiente') }) + '</div>' : '';
    pintarGenDet(bs);
  }
  function pintarGenDet(bs) {
    var b = (bs || resumirGen()).filter(function (x) { return x.clave === genAbierto; })[0];
    if (!b) { $('gcDet').hidden = true; $('gcDet').innerHTML = ''; return; }
    var ls = b.lineas.map(conBorrador).sort(ordenLinea), t = resumir(ls);
    var nCambios = b.lineas.filter(function (l) { return borrador[l.id]; }).length;
    $('gcDet').hidden = false;
    $('gcDet').innerHTML = '<div class="rep-det-head"><div><h4>Detalle · ' + esc(b.nombre) + ' ' + etiquetaBen(b.benef) + '</h4><p class="dlg-msg">' + ls.length + (ls.length === 1 ? ' comisión' : ' comisiones') + ', por paciente y fecha. Haz tus cambios y pulsa «Confirmar y actualizar maestro».</p></div>' +
      '<div class="hi-botones"><button type="button" class="adm-btn" data-gc-cerrar>Cerrar</button></div></div>' +
      '<div class="roles-wrap com-fit"><table class="rep-tabla com-det com-t7"><colgroup><col class="c-pac"><col class="c-fec"><col class="c-num"><col class="c-pct"><col class="c-num"><col class="c-est"><col class="c-chk"></colgroup><thead><tr><th>Paciente · concepto</th><th>Fecha</th><th class="num">Base</th><th class="num">% comisión</th><th class="num">Comisión</th><th>Estado</th><th class="com-chk">Pagar</th></tr></thead><tbody>' +
      ls.map(function (l) {
        var bloq = !editable(l), nota = l.pago_id ? 'Pago No. ' + l.pago_id : l.trasladado ? 'En Pagar Comisiones' : '';
        var valor = l.tipo === 'valor'
          ? '<span class="com-in">Q<input type="number" min="0" step="0.01" value="' + Number(l.valor) + '" data-gc-valor="' + l.id + '"' + (bloq ? ' disabled' : '') + ' aria-label="Valor por unidad"></span><small class="hi-desc">c/u</small>'
          : '<span class="com-in"><input type="number" min="0" max="100" step="0.01" value="' + Number(l.valor) + '" data-gc-valor="' + l.id + '"' + (bloq ? ' disabled' : '') + ' aria-label="% de comisión">%</span>';
        return '<tr class="com-e-' + l.estado + (borrador[l.id] ? ' com-cambio' : '') + '"><td><strong>' + esc(l.paciente) + '</strong><br><span class="hi-desc">' + esc(l.concepto) + (Number(l.cantidad) !== 1 ? ' × ' + Number(l.cantidad) : '') + ' · ' + esc(l.documento) + ' · ' + (CATEGORIA[l.categoria] || '') + '</span></td>' +
          '<td class="fecha">' + fechaCorta(l.fecha) + '</td><td class="num">' + q(l.base) + '</td><td class="num">' + valor + (Number(l.valor) !== Number(l.valor_original) ? '<br><small class="hi-desc">antes ' + (l.tipo === 'valor' ? q(l.valor_original) : pct(l.valor_original)) + '</small>' : '') + '</td>' +
          '<td class="num"><strong>' + q(l.comision) + '</strong></td>' +
          '<td><select class="com-estado com-estado-' + l.estado + '" data-gc-estado="' + l.id + '"' + (bloq ? ' disabled' : '') + '>' +
          Object.keys(ESTADOS_COM).map(function (k) { return '<option value="' + k + '"' + (k === l.estado ? ' selected' : '') + '>' + ESTADOS_COM[k] + '</option>'; }).join('') + '</select>' + (nota ? '<br><small class="hi-desc">' + nota + '</small>' : '') + '</td>' +
          '<td class="com-chk"><input type="checkbox" data-gc-pagar="' + l.id + '"' + (l.autorizado ? ' checked' : '') + (l.estado !== 'pendiente' || bloq ? ' disabled' : '') + ' aria-label="Autorizar el pago de esta comisión"></td></tr>';
      }).join('') +
      '<tr class="rep-total"><td colspan="2">TOTAL ' + esc(b.nombre) + '</td><td class="num">' + q(t.base) + '</td><td></td><td class="num">' + q(t.comision) + '</td><td colspan="2">Autorizado <b>' + q(t.autorizado) + '</b></td></tr></tbody></table></div>' +
      '<div class="com-det-acc"><p class="dlg-msg" role="status" id="gcDetMsg">' + (nCambios ? nCambios + (nCambios === 1 ? ' cambio sin confirmar.' : ' cambios sin confirmar.') : '') + '</p>' +
      (nCambios ? '<button type="button" class="adm-btn" data-gc-descartar>Descartar cambios</button>' : '') +
      '<button type="button" class="dlg-submit" data-gc-confirmar' + (nCambios ? '' : ' disabled') + '>Confirmar y actualizar maestro</button></div>';
  }
  async function generarCom() {
    var d = $('gcDesde').value, h = $('gcHasta').value, ag = $('gcAgente').value, ins = $('gcInst').value, suc = $('gcSuc').disabled ? '' : $('gcSuc').value;
    if (!d || !h || h < d) { aviso('gcMsg', 'Revisa el rango de fechas.', true); return; }
    if (ag === 'ninguno' && ins === 'ninguna') { aviso('gcMsg', 'Elige de quién generar comisiones: agentes comerciales, instituciones o ambos.', true); $('gcAgente').focus(); return; }
    $('gcGenerar').disabled = true; aviso('gcMsg', 'Generando…');
    try {
      await permisoPago();
      var r = await sb.rpc('generar_comisiones', { p_desde: d, p_hasta: h, p_agentes: ag, p_instituciones: ins, p_sucursal: suc ? +suc : null });
      if (r.error) throw r.error;
      gen = await leerGeneradas(d, h, ag, ins, null, suc);
      borrador = {};
      genParams = { desde: d, hasta: h, agente: ag, inst: ins, suc: suc, agTxt: $('gcAgente').selectedOptions[0].textContent, inTxt: $('gcInst').selectedOptions[0].textContent,
        sucTxt: suc ? $('gcSuc').selectedOptions[0].textContent : 'Todas las sucursales' };
      var n = (r.data.agentes || 0) + (r.data.instituciones || 0);
      aviso('gcMsg', (n ? 'Se generaron ' + n + (n === 1 ? ' comisión nueva' : ' comisiones nuevas') : 'No había comisiones nuevas') + (r.data.anuladas ? '; ' + r.data.anuladas + ' pasaron a «Anulado» porque se anuló su cobro' : '') + '.');
    } catch (e) { aviso('gcMsg', traducir(e), true); }
    $('gcGenerar').disabled = false;
    if (genAbierto && !gen.some(function (l) { return claveBen(l) === genAbierto; })) genAbierto = null;
    pintarGen();
  }
  async function recargarGen() { if (genParams) gen = await leerGeneradas(genParams.desde, genParams.hasta, genParams.agente, genParams.inst, null, genParams.suc); pintarGen(); }
  async function actualizarLineas(ids, cambios, msgId) {
    var r = await sb.from('comisiones_generadas').update(cambios).in('id', ids).select('*');
    if (r.error) { aviso(msgId, traducir(r.error), true); pintarGen(); return false; }
    var nuevo = {}; (r.data || []).forEach(function (x) { nuevo[x.id] = x; });
    gen = gen.map(function (l) { return nuevo[l.id] || l; });
    return true;
  }
  function benDeClave(k) { return resumirGen().filter(function (b) { return b.clave === k; })[0]; }
  $('gcGenerar').addEventListener('click', generarCom);
  $('gcInst').addEventListener('change', opcionesSucGen);
  ['gcDesde', 'gcHasta', 'gcAgente', 'gcInst', 'gcSuc'].forEach(function (id) { $(id).addEventListener('change', function () { if (genParams) aviso('gcMsg', 'Cambiaste los parámetros: pulsa «Generar comisiones».'); }); });
  $('gcBody').addEventListener('click', async function (e) {
    var d = e.target.closest('[data-gc-det]'), p = e.target.closest('[data-gc-pagar-ben]'), rv = e.target.closest('[data-gc-revertir]');
    if (d) {
      genAbierto = genAbierto === d.dataset.gcDet ? null : d.dataset.gcDet;
      pintarGen();
      if (genAbierto) $('gcDet').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var bt = p || rv;
    if (!bt || !genParams) return;
    var b = benDeClave(bt.dataset.gcPagarBen || bt.dataset.gcRevertir);
    if (!b) return;
    if (b.lineas.some(function (l) { return borrador[l.id]; })) { aviso('gcMsg', 'Tienes cambios sin confirmar en el detalle de ' + b.nombre + ': confírmalos o descártalos primero.', true); return; }
    if (!pedirConfirmacion(bt)) return;
    bt.disabled = true; aviso('gcMsg', p ? 'Trasladando a Pagar Comisiones…' : 'Revirtiendo…');
    var r = await sb.rpc(p ? 'trasladar_comisiones' : 'revertir_comisiones', { p_beneficiario: b.benef, p_id: b.id, p_desde: genParams.desde, p_hasta: genParams.hasta });
    if (r.error) { aviso('gcMsg', traducir(r.error), true); pintarGen(); return; }
    await recargarGen();
    if (p) {
      aviso('gcMsg', 'Se trasladaron ' + r.data + (r.data === 1 ? ' comisión' : ' comisiones') + ' de ' + b.nombre + ' a Pagar Comisiones.');
      irAPagar(b);
    } else aviso('gcMsg', 'Se revirtieron ' + r.data + (r.data === 1 ? ' comisión' : ' comisiones') + ' de ' + b.nombre + ': ya no están en Pagar Comisiones y se pueden modificar.');
  });
  $('gcBody').addEventListener('change', async function (e) {
    var c = e.target.closest('[data-gc-aut]');
    if (!c) return;
    var ids = gen.filter(function (l) { return claveBen(l) === c.dataset.gcAut && l.estado === 'pendiente' && editable(l); }).map(function (l) { return l.id; });
    if (!ids.length) return;
    c.disabled = true; aviso('gcMsg', 'Guardando…');
    ids.forEach(function (id) { if (borrador[id]) { delete borrador[id].autorizado; if (!Object.keys(borrador[id]).length) delete borrador[id]; } });
    var ok = await actualizarLineas(ids, { autorizado: c.checked }, 'gcMsg');
    pintarGen();
    if (ok) aviso('gcMsg', c.checked ? 'Pago autorizado: usa «Pagar» para trasladarlo a Pagar Comisiones.' : 'Se quitó la autorización de pago.');
  });
  // Detalle: los cambios quedan en borrador hasta «Confirmar y actualizar maestro»
  function anotar(id, campo, valor) {
    var l = gen.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    var c = borrador[id] || {};
    if (String(valor) === String(l[campo])) delete c[campo]; else c[campo] = valor;
    if (Object.keys(c).length) borrador[id] = c; else delete borrador[id];
  }
  $('gcDet').addEventListener('change', function (e) {
    var v = e.target.closest('[data-gc-valor]'), es = e.target.closest('[data-gc-estado]'), pg = e.target.closest('[data-gc-pagar]');
    if (v) {
      var l = gen.filter(function (x) { return String(x.id) === v.dataset.gcValor; })[0], n = v.value === '' ? NaN : Number(v.value);
      if (isNaN(n) || n < 0 || (l.tipo === 'porcentaje' && n > 100)) { pintarGenDet(); aviso('gcDetMsg', l.tipo === 'porcentaje' ? 'El % debe estar entre 0 y 100.' : 'Escribe un valor mayor o igual a cero.', true); return; }
      anotar(l.id, 'valor', Math.round(n * 100) / 100);
    } else if (es) anotar(+es.dataset.gcEstado, 'estado', es.value);
    else if (pg) anotar(+pg.dataset.gcPagar, 'autorizado', pg.checked);
    else return;
    pintarGenDet();
  });
  $('gcDet').addEventListener('click', async function (e) {
    if (e.target.closest('[data-gc-cerrar]')) {
      var abiertas = gen.filter(function (l) { return claveBen(l) === genAbierto && borrador[l.id]; });
      if (abiertas.length && !confirm('Tienes cambios sin confirmar. ¿Cerrar y descartarlos?')) return;
      abiertas.forEach(function (l) { delete borrador[l.id]; });
      genAbierto = null; pintarGen(); return;
    }
    if (e.target.closest('[data-gc-descartar]')) { gen.forEach(function (l) { if (claveBen(l) === genAbierto) delete borrador[l.id]; }); pintarGenDet(); return; }
    var bc = e.target.closest('[data-gc-confirmar]');
    if (!bc) return;
    var ids = gen.filter(function (l) { return claveBen(l) === genAbierto && borrador[l.id]; }).map(function (l) { return l.id; });
    if (!ids.length) return;
    bc.disabled = true; aviso('gcDetMsg', 'Guardando ' + ids.length + (ids.length === 1 ? ' cambio…' : ' cambios…'));
    var fallos = 0;
    for (var k = 0; k < ids.length; k++) {
      var cambios = Object.assign({}, borrador[ids[k]]);
      if (await actualizarLineas([ids[k]], cambios, 'gcDetMsg')) delete borrador[ids[k]]; else fallos++;
    }
    pintarGen();
    aviso('gcDetMsg', fallos ? 'No se pudieron guardar ' + fallos + ' cambios; revisa el mensaje y vuelve a intentar.' : 'Cambios confirmados: el maestro ya está actualizado.', !!fallos);
  });
  // Después de «Pagar»: abre Pagar Comisiones con ese beneficiario y las mismas fechas
  function irAPagar(b) {
    $('pqDesde').value = genParams.desde; $('pqHasta').value = genParams.hasta;
    $('pqAgente').value = b.benef === 'agente' ? String(b.id) : 'ninguno';
    $('pqInst').value = b.benef === 'institucion' ? String(b.id) : 'ninguna';
    $('tabComPago').click();
    calcular();
  }
  $('gcImprimir').addEventListener('click', function () {
    if (!window.PD_IMPRESION || !genParams) return;
    var bs = resumirGen(), td = 'padding:5px 6px;border-bottom:1px solid #D9E4EC;font-size:11.5px', tdn = td + ';text-align:right';
    function s(k) { return bs.reduce(function (t, b) { return t + b[k]; }, 0); }
    var html = window.PD_IMPRESION.encabezado('Comisiones generadas') +
      '<div style="font-size:12px;color:#475B68;margin-bottom:10px">Parámetros: Fecha inicial <b>' + fechaCorta(genParams.desde) + '</b> · Fecha final <b>' + fechaCorta(genParams.hasta) + '</b> · Agente comercial <b>' + esc(genParams.agTxt) + '</b> · Institución <b>' + esc(genParams.inTxt) + '</b></div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['Autorizado', 'Beneficiario', 'Tipo', 'Líneas', 'Base', 'Comisión', 'Autorizado Q', 'Pagado', 'Pendiente'].map(function (t, i) { return '<th style="' + (i > 2 ? tdn : td + ';text-align:left') + '">' + t + '</th>'; }).join('') + '</tr></thead><tbody>' +
      bs.map(function (b) { return '<tr><td style="' + td + '">' + (b.libres && b.aut === b.libres ? 'Sí' : b.aut ? 'Parcial' : 'No') + '</td><td style="' + td + '">' + esc(b.nombre) + '</td><td style="' + td + '">' + (b.benef === 'agente' ? 'Agente' : 'Institución') + '</td><td style="' + tdn + '">' + b.n + '</td><td style="' + tdn + '">' + q(b.base) + '</td><td style="' + tdn + '">' + q(b.comision) + '</td><td style="' + tdn + '">' + q(b.autorizado) + '</td><td style="' + tdn + '">' + q(b.pagado) + '</td><td style="' + tdn + '">' + q(b.pendiente) + '</td></tr>'; }).join('') +
      '<tr><td colspan="3" style="' + td + ';font-weight:800">TOTAL</td><td style="' + tdn + ';font-weight:800">' + s('n') + '</td><td style="' + tdn + ';font-weight:800">' + q(s('base')) + '</td><td style="' + tdn + ';font-weight:800">' + q(s('comision')) + '</td><td style="' + tdn + ';font-weight:800">' + q(s('autorizado')) + '</td><td style="' + tdn + ';font-weight:800">' + q(s('pagado')) + '</td><td style="' + tdn + ';font-weight:800">' + q(s('pendiente')) + '</td></tr></tbody></table>';
    window.PD_IMPRESION.imprimir(html);
  });
  $('gcExcel').addEventListener('click', function () {
    if (!gen.length) return;
    function c(v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var filas = [['Comisiones generadas del ' + genParams.desde + ' al ' + genParams.hasta], ['Agente comercial', genParams.agTxt], ['Institución', genParams.inTxt], ['Sucursal', genParams.sucTxt || 'Todas las sucursales'], [],
      ['Beneficiario', 'Tipo', 'Paciente', 'Fecha', 'Documento', 'Concepto', 'Base', 'Tipo de comisión', '% o valor', 'Comisión', 'Estado', 'Autorizado', 'Pago No.']];
    gen.slice().sort(function (x, y) { return ordenBen({ benef: x.beneficiario, nombre: nombreBen(x.beneficiario, idBen(x)) }, { benef: y.beneficiario, nombre: nombreBen(y.beneficiario, idBen(y)) }) || ordenLinea(x, y); }).forEach(function (l) {
      filas.push([nombreBen(l.beneficiario, idBen(l)), l.beneficiario === 'agente' ? 'Agente' : 'Institución', l.paciente, l.fecha, l.documento, l.concepto, Number(l.base).toFixed(2), l.tipo === 'valor' ? 'Valor por unidad' : 'Porcentaje', Number(l.valor).toFixed(2), Number(l.comision).toFixed(2), ESTADOS_COM[l.estado], l.autorizado ? 'Sí' : 'No', l.pago_id || '']);
    });
    var blob = new Blob(['﻿' + filas.map(function (f) { return f.map(c).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'comisiones-' + genParams.desde + '-al-' + genParams.hasta + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ======================= Pagar Comisiones =======================
  // Paga lo autorizado en «Generar comisiones»: detalle de cada comisión y resumen de pago por beneficiario
  // (agente o institución) con forma de pago, fecha, banco, cuenta bancaria y fecha de operación.
  $('admComPago').innerHTML =
    '<div class="adm-pane-head"><h3 class="adm-h">Pagar Comisiones</h3></div>' +
    '<p class="dlg-msg">Aquí se pagan las comisiones que se trasladaron con «Pagar» en «Generar comisiones». Elige las fechas, el agente y la institución y pulsa «Calcular»; en el resumen por beneficiario llena la forma de pago y pulsa «Pagar». ' +
    'Si anulas un pago, sus comisiones vuelven a quedar pendientes.</p>' +
    '<div class="com-filtros"><label>Fecha inicial<input id="pqDesde" type="date" class="adm-input"></label><label>Fecha final<input id="pqHasta" type="date" class="adm-input"></label>' +
    '<label>Agente comercial<select id="pqAgente" class="adm-input" data-def="todos"><option value="todos">Todos los agentes</option></select></label>' +
    '<label>Institución<select id="pqInst" class="adm-input" data-def="todas"><option value="todas">Todas las instituciones</option></select></label>' +
    '<button type="button" id="pqCalcular" class="adm-btn adm-primary">Calcular</button></div>' +
    '<p id="pqMsg" class="dlg-msg" role="status"></p>' +
    '<div id="pqResultado" class="adm-pane" hidden>' +
    '<div id="pqResumen" class="com-resumen"></div>' +
    '<h4 class="com-sub">Detalle del pago</h4>' +
    '<div class="com-filtros" role="group" aria-label="Mostrar comisiones"><button type="button" class="adm-btn" data-pqver="aut" aria-pressed="true">Por pagar</button><button type="button" class="adm-btn" data-pqver="sin" aria-pressed="false">Sin autorizar</button><button type="button" class="adm-btn" data-pqver="pag" aria-pressed="false">Pagadas</button><button type="button" class="adm-btn" data-pqver="todas" aria-pressed="false">Todas</button></div>' +
    '<div class="roles-wrap com-fit"><table class="com-tpq"><colgroup><col class="c-pac"><col class="c-ben"><col class="c-fec"><col class="c-num"><col class="c-pct"><col class="c-num"><col class="c-est"></colgroup><thead><tr><th>Paciente · concepto</th><th>Beneficiario</th><th>Fecha</th><th class="num">Base</th><th class="num">% comisión</th><th class="num">Comisión</th><th>Estado</th></tr></thead><tbody id="pqBody"></tbody></table></div>' +
    '<h4 class="com-sub">Resumen de pago por beneficiario</h4>' +
    '<div id="pqVendedores" class="com-vends"></div>' +
    '</div>' +
    '<h4 class="com-sub">Pagos registrados</h4>' +
    '<div class="roles-wrap com-fit"><table class="com-tpagos"><colgroup><col class="c-no"><col class="c-ben"><col class="c-fec2"><col class="c-num"><col class="c-forma"><col class="c-est2"><col class="c-acc"></colgroup><thead><tr><th>No.</th><th>Beneficiario</th><th>Fecha · período</th><th class="num">Pagado</th><th>Forma de pago</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="pqPagosBody"></tbody></table></div>' +
    '<p id="pqPagosMsg" class="dlg-msg" role="status"></p>';

  var verLineas = 'aut';
  // Solo el médico principal o el Super Administrador pueden pagar (Supabase también lo valida)
  var puedePagar = false;
  async function permisoPago() { var r = await sb.rpc('puede_pagar_comisiones'); puedePagar = !r.error && r.data === true; }
  (function () { var h = new Date(); $('pqDesde').value = iso(new Date(h.getFullYear(), h.getMonth(), 1)); $('pqHasta').value = iso(h); })();
  function textoValor(l) { return l.tipo === 'valor' ? q(l.valor) + ' c/u' : pct(l.valor); }
  function opcionesBanco(elegido) {
    var l = (window.PD_BANCOS_GT || []).slice();
    if (elegido && l.indexOf(elegido) < 0) l.push(elegido);
    return '<option value="">Selecciona…</option>' + l.map(function (b) { return '<option' + (b === elegido ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('');
  }
  function benDePago(p) { return p.beneficiario === 'institucion' ? nombreBen('institucion', p.institucion_id) : nombreBen('agente', p.agente_id); }
  function formaPagoTxt(p) {
    return (METODOS[p.metodo] || p.metodo) + (p.banco ? '<br><span class="hi-desc">' + esc(p.banco) + (p.cuenta_bancaria ? ' · ' + esc(p.cuenta_bancaria) : '') + '</span>' : '') +
      (p.fecha_operacion ? '<br><span class="hi-desc">Operación ' + fechaCorta(p.fecha_operacion) + '</span>' : '') + (p.referencia ? '<br><span class="hi-desc">Ref. ' + esc(p.referencia) + '</span>' : '');
  }

  async function calcular() {
    var ag = $('pqAgente').value, ins = $('pqInst').value, d = $('pqDesde').value, h = $('pqHasta').value;
    if (!d || !h || h < d) { aviso('pqMsg', 'Revisa el rango de fechas.', true); return; }
    if (ag === 'ninguno' && ins === 'ninguna') { aviso('pqMsg', 'Elige agentes, instituciones o ambos.', true); return; }
    aviso('pqMsg', 'Calculando…');
    try { lineas = await leerGeneradas(d, h, ag, ins, ['pendiente', 'pagado']); }
    catch (e) { $('pqResultado').hidden = true; aviso('pqMsg', traducir(e), true); return; }
    lineas.sort(function (x, y) { return ordenBen({ benef: x.beneficiario, nombre: nombreBen(x.beneficiario, idBen(x)) }, { benef: y.beneficiario, nombre: nombreBen(y.beneficiario, idBen(y)) }) || ordenLinea(x, y); });
    calculo = { agente: ag, inst: ins, desde: d, hasta: h };
    await permisoPago();
    aviso('pqMsg', lineas.length ? '' : 'No hay comisiones generadas con esos parámetros. Genéralas en «Generar comisiones».');
    $('pqResultado').hidden = !lineas.length;
    await cargarPagos();
    pintarLineas();
  }
  // Vistas del detalle: por pagar (trasladadas), sin autorizar, pagadas o todas
  function enVista(l) {
    if (verLineas === 'aut') return l.estado === 'pendiente' && l.trasladado;
    if (verLineas === 'sin') return l.estado === 'pendiente' && !l.autorizado && !l.trasladado;
    if (verLineas === 'pag') return l.estado === 'pagado';
    return true;
  }
  function estadoLinea(l, p) {
    if (l.estado === 'pagado') return '<span class="estado estado-finalizado">Pagada' + (l.pago_id ? ' · No. ' + l.pago_id : '') + '</span>' + (p ? '<br><span class="hi-desc">' + fechaCorta(p.fecha_pago) + ' · ' + (METODOS[p.metodo] || p.metodo) + '</span>' : '');
    if (l.trasladado) return '<span class="estado estado-proceso">Pendiente de pago</span>';
    return l.autorizado ? '<span class="estado estado-activo">Autorizada · sin trasladar</span>' : '<span class="estado estado-inactivo">Sin autorizar</span>';
  }
  var VACIO = { aut: 'No hay comisiones por pagar. Trasládalas con «Pagar» en «Generar comisiones».', sin: 'No hay comisiones sin autorizar.', pag: 'No hay comisiones pagadas.', todas: 'No hay comisiones.' };
  function pintarLineas() {
    var aut = lineas.filter(function (l) { return l.estado === 'pendiente' && l.trasladado; }), pag = lineas.filter(function (l) { return l.estado === 'pagado'; }), sin = lineas.filter(function (l) { return l.estado === 'pendiente' && !l.autorizado && !l.trasladado; });
    function s(a, k) { return a.reduce(function (t, l) { return t + Number(l[k]); }, 0); }
    $('pqResumen').innerHTML = [['Comisiones', lineas.length], ['Sin autorizar', q(s(sin, 'comision'))], ['Ya pagado', q(s(pag, 'comision'))], ['Por pagar', q(s(aut, 'comision')), 1]]
      .map(function (x) { return '<div' + (x[2] ? ' class="com-dest"' : '') + '><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join('');
    document.querySelectorAll('[data-pqver]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.pqver === verLineas); });
    var lista = lineas.filter(enVista);
    var pagoDe = {}; pagos.forEach(function (p) { pagoDe[p.id] = p; });
    $('pqBody').innerHTML = lista.length ? lista.map(function (l) {
      var p = pagoDe[l.pago_id];
      return '<tr><td><strong>' + esc(l.paciente) + '</strong><br><span class="hi-desc">' + esc(l.concepto) + ' · ' + esc(l.documento) + '</span></td>' +
        '<td>' + esc(nombreBen(l.beneficiario, idBen(l))) + ' ' + etiquetaBen(l.beneficiario) + '</td><td class="fecha">' + fechaCorta(l.fecha) + '</td>' +
        '<td class="num">' + q(l.base) + '</td><td class="num">' + textoValor(l) + '</td><td class="num"><strong>' + q(l.comision) + '</strong></td>' +
        '<td>' + estadoLinea(l, p) + '</td></tr>';
    }).join('') + '<tr class="com-total"><td colspan="3">Total</td><td class="num">' + q(s(lista, 'base')) + '</td><td></td><td class="num">' + q(s(lista, 'comision')) + '</td><td></td></tr>'
      : '<tr><td colspan="7">' + VACIO[verLineas] + '</td></tr>';
    pintarVendedores(aut);
  }
  // Una tarjeta por beneficiario con comisiones autorizadas; banco y cuenta se proponen con los de su último pago
  function pintarVendedores(aut) {
    var porB = {}, orden = [];
    aut.forEach(function (l) { if (Number(l.comision) <= 0) return; var k = claveBen(l); if (!porB[k]) { porB[k] = { benef: l.beneficiario, id: idBen(l), nombre: nombreBen(l.beneficiario, idBen(l)), ls: [] }; orden.push(porB[k]); } porB[k].ls.push(l); });
    if (!orden.length) { $('pqVendedores').innerHTML = '<p class="dlg-msg">No hay comisiones por pagar con estos parámetros.</p>'; return; }
    var hoyIso = iso(new Date());
    $('pqVendedores').innerHTML = (puedePagar ? '' : '<p class="com-sin-permiso">Solo el <b>médico principal</b> o el <b>Super Administrador</b> pueden pagar comisiones.</p>') + orden.sort(ordenBen).map(function (b) {
      var total = b.ls.reduce(function (t, l) { return t + Number(l.comision); }, 0);
      var ult = pagos.filter(function (p) { return p.beneficiario === b.benef && (b.benef === 'agente' ? p.agente_id : p.institucion_id) === b.id && !p.anulado && (p.banco || p.cuenta_bancaria); })[0] || {};
      var pacs = {}; b.ls.forEach(function (l) { pacs[l.paciente_id] = 1; });
      return '<div class="com-vend" data-vend="' + b.id + '" data-benef="' + b.benef + '">' +
        '<div class="com-vend-head"><h5>' + esc(b.nombre) + ' ' + etiquetaBen(b.benef) + ' <button type="button" class="adm-btn rep-det-btn" data-pqdet="' + b.benef + b.id + '" aria-expanded="' + !!pqAbiertos[b.benef + b.id] + '">' + (pqAbiertos[b.benef + b.id] ? 'Ocultar detalle' : 'Detalle') + '</button></h5><span class="hi-desc">' + b.ls.length + (b.ls.length === 1 ? ' comisión' : ' comisiones') + ' · ' + Object.keys(pacs).length + (Object.keys(pacs).length === 1 ? ' paciente' : ' pacientes') + '</span></div>' +
        (pqAbiertos[b.benef + b.id] ? detalleTarjeta(b) : '') +
        '<div class="com-vend-grid">' +
        '<div><small>Total a pagar</small><b>' + q(total) + '</b></div>' +
        '<label><small>Forma de pago</small><select data-v="metodo">' + Object.keys(METODOS).map(function (k) { return '<option value="' + k + '">' + METODOS[k] + '</option>'; }).join('') + '</select></label>' +
        '<label><small>Fecha de pago</small><input type="date" data-v="fecha_pago" value="' + hoyIso + '"></label>' +
        '<label><small>Fecha operación</small><input type="date" data-v="fecha_operacion" value="' + hoyIso + '"></label>' +
        '<div><small>Usuario que paga</small><span>' + esc(usuarioActual()) + '</span></div>' +
        '<label><small>Banco</small><select data-v="banco">' + opcionesBanco(ult.banco || '') + '</select></label>' +
        '<label><small>Cuenta bancaria</small><input type="text" data-v="cuenta_bancaria" maxlength="40" placeholder="Número de cuenta" value="' + esc(ult.cuenta_bancaria || '') + '"></label>' +
        '<label><small>Referencia / No. de operación</small><input type="text" data-v="referencia" maxlength="80" autocomplete="off"></label>' +
        '<label class="com-vend-obs"><small>Observaciones</small><input type="text" data-v="observaciones" maxlength="300" autocomplete="off"></label>' +
        '</div>' +
        '<div class="com-vend-acc"><p class="dlg-msg" role="status" data-vmsg></p><button type="button" class="com-pagar" data-pagar="' + b.id + '"' + (puedePagar ? '' : ' disabled title="Solo el médico principal o el Super Administrador pueden pagar"') + '>Pagar ' + q(total) + '</button></div></div>';
    }).join('');
  }
  var pqAbiertos = {};
  // Comisiones del beneficiario según la vista del detalle (Por pagar, Sin autorizar, Pagadas o Todas)
  function detalleTarjeta(b) {
    var ls = lineas.filter(function (l) { return l.beneficiario === b.benef && idBen(l) === b.id && enVista(l); }).sort(ordenLinea);
    var pagoDe = {}; pagos.forEach(function (p) { pagoDe[p.id] = p; });
    var tot = ls.reduce(function (t, l) { return t + Number(l.comision); }, 0), base = ls.reduce(function (t, l) { return t + Number(l.base); }, 0);
    var vista = { aut: 'por pagar', sin: 'sin autorizar', pag: 'pagadas', todas: 'todas' }[verLineas];
    return '<div class="com-vend-det"><p class="dlg-msg">Comisiones ' + vista + ' (cambia la vista con los botones de «Detalle del pago»).</p>' +
      '<div class="roles-wrap com-fit"><table class="rep-tabla com-t6"><colgroup><col class="c-pac"><col class="c-fec"><col class="c-num"><col class="c-pct"><col class="c-num"><col class="c-est"></colgroup><thead><tr><th>Paciente · concepto</th><th>Fecha</th><th class="num">Base</th><th class="num">% comisión</th><th class="num">Comisión</th><th>Estado</th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (l) {
        return '<tr><td><strong>' + esc(l.paciente) + '</strong><br><span class="hi-desc">' + esc(l.concepto) + ' · ' + esc(l.documento) + '</span></td><td class="fecha">' + fechaCorta(l.fecha) + '</td>' +
          '<td class="num">' + q(l.base) + '</td><td class="num">' + textoValor(l) + '</td><td class="num"><strong>' + q(l.comision) + '</strong></td><td>' + estadoLinea(l, pagoDe[l.pago_id]) + '</td></tr>';
      }).join('') + '<tr class="rep-total"><td colspan="2">Total</td><td class="num">' + q(base) + '</td><td></td><td class="num">' + q(tot) + '</td><td></td></tr>'
        : '<tr><td colspan="6">' + VACIO[verLineas] + '</td></tr>') + '</tbody></table></div></div>';
  }
  async function cargarPagos() {
    var ag = $('pqAgente').value, ins = $('pqInst').value;
    aviso('pqPagosMsg', '');
    var qy = sb.from('comisiones_pagos').select('*').order('id', { ascending: false }).limit(100);
    var cond = [];
    if (ag === 'todos') cond.push('beneficiario.eq.agente'); else if (ag !== 'ninguno') cond.push('agente_id.eq.' + (+ag));
    if (ins === 'todas') cond.push('beneficiario.eq.institucion'); else if (ins !== 'ninguna') cond.push('and(beneficiario.eq.institucion,institucion_id.eq.' + (+ins) + ')');
    if (!cond.length) { pagos = []; $('pqPagosBody').innerHTML = '<tr><td colspan="7">Elige agentes, instituciones o ambos.</td></tr>'; return; }
    var r = await qy.or(cond.join(','));
    if (r.error) { pagos = []; $('pqPagosBody').innerHTML = ''; aviso('pqPagosMsg', traducir(r.error), true); return; }
    pagos = r.data || [];
    $('pqPagosBody').innerHTML = pagos.length ? pagos.map(function (p) {
      return '<tr' + (p.anulado ? ' class="com-anulado"' : '') + '><td>' + p.id + '</td><td>' + esc(benDePago(p)) + ' ' + etiquetaBen(p.beneficiario || 'agente') + '</td>' +
        '<td><strong>' + fechaCorta(p.fecha_pago) + '</strong><br><span class="hi-desc">' + fechaCorta(p.desde) + ' – ' + fechaCorta(p.hasta) + '</span></td>' +
        '<td class="num"><strong>' + q(p.monto) + '</strong><br><span class="hi-desc">' + p.lineas + (p.lineas === 1 ? ' línea' : ' líneas') + '</span></td><td>' + formaPagoTxt(p) + '<br><span class="hi-desc">Pagó: ' + esc(p.registrado_por || '—') + '</span></td>' +
        '<td>' + (p.anulado ? '<span class="estado estado-no_aprobado" title="' + esc(p.anulado_motivo || '') + '">Anulado</span>' : '<span class="estado estado-activo">Pagado</span>') + '</td>' +
        '<td><div class="hi-botones"><button type="button" class="adm-btn" data-pqimp="' + p.id + '">Imprimir</button>' + (p.anulado ? '' : '<button type="button" class="adm-btn" data-pqanular="' + p.id + '">Anular</button>') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7">Todavía no hay pagos de comisiones con estos parámetros.</td></tr>';
  }

  async function imprimirPago(id) {
    var p = pagos.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) { var rp = await sb.from('comisiones_pagos').select('*').eq('id', id).maybeSingle(); p = rp.data; }
    if (!p || !window.PD_IMPRESION) return;
    var r = await sb.from('comisiones_generadas').select('*').eq('pago_id', p.id);
    var ls = (r.error ? [] : r.data || []).sort(ordenLinea);
    var nom = benDePago(p), td = 'padding:6px 8px;border-bottom:1px solid #D9E4EC;font-size:12px', tdn = td + ';text-align:right';
    var dato = function (t, v) { return '<div><b>' + t + ':</b> ' + v + '</div>'; };
    var html = window.PD_IMPRESION.encabezado('Comprobante de pago de comisiones No. ' + p.id) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:13px;margin-bottom:16px">' +
      dato(p.beneficiario === 'institucion' ? 'Institución' : 'Vendedor', esc(nom)) + dato('Período', fechaCorta(p.desde) + ' – ' + fechaCorta(p.hasta)) +
      dato('Fecha de pago', fechaCorta(p.fecha_pago)) + dato('Fecha de operación', p.fecha_operacion ? fechaCorta(p.fecha_operacion) : '—') +
      dato('Forma de pago', METODOS[p.metodo] || p.metodo) + dato('Banco', esc(p.banco || '—')) +
      dato('Cuenta bancaria', esc(p.cuenta_bancaria || '—')) + dato('Referencia', esc(p.referencia || '—')) +
      dato('Usuario que paga', esc(p.registrado_por || '—')) +
      (p.anulado ? '<div style="grid-column:1/-1;color:#9A3B2E"><b>ANULADO:</b> ' + esc(p.anulado_motivo || '') + '</div>' : '') + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + td + ';text-align:left">Paciente</th><th style="' + td + ';text-align:left">Fecha</th><th style="' + td + ';text-align:left">Documento</th><th style="' + td + ';text-align:left">Concepto</th><th style="' + tdn + '">Base</th><th style="' + tdn + '">% comisión</th><th style="' + tdn + '">Comisión</th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (l) { return '<tr><td style="' + td + '">' + esc(l.paciente) + '</td><td style="' + td + '">' + fechaCorta(l.fecha) + '</td><td style="' + td + '">' + esc(l.documento) + '</td><td style="' + td + '">' + esc(l.concepto) + '</td><td style="' + tdn + '">' + q(l.base) + '</td><td style="' + tdn + '">' + textoValor(l) + '</td><td style="' + tdn + '">' + q(l.comision) + '</td></tr>'; }).join('')
        : '<tr><td colspan="7" style="' + td + '">' + p.lineas + ' líneas (detalle no disponible' + (p.anulado ? ': el pago está anulado' : '') + ').</td></tr>') +
      '<tr><td colspan="4" style="' + td + ';font-weight:700">Total pagado · ' + (METODOS[p.metodo] || p.metodo) + (p.banco ? ' · ' + esc(p.banco) : '') + (p.cuenta_bancaria ? ' · Cuenta ' + esc(p.cuenta_bancaria) : '') + '</td><td style="' + tdn + ';font-weight:700">' + q(p.base) + '</td><td style="' + tdn + '"></td><td style="' + tdn + ';font-weight:700">' + q(p.monto) + '</td></tr></tbody></table>' +
      (p.observaciones ? '<p style="font-size:13px;margin-top:12px"><b>Observaciones:</b> ' + esc(p.observaciones) + '</p>' : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:64px;font-size:13px;text-align:center"><div style="border-top:1px solid #0B2B40;padding-top:6px">Entregado por · ' + esc(p.registrado_por || '') + '</div><div style="border-top:1px solid #0B2B40;padding-top:6px">Recibido · ' + esc(nom) + '</div></div>';
    window.PD_IMPRESION.imprimir(html);
  }

  $('pqCalcular').addEventListener('click', calcular);
  ['pqAgente', 'pqInst', 'pqDesde', 'pqHasta'].forEach(function (id) {
    $(id).addEventListener('change', function () { if (calculo) { $('pqResultado').hidden = true; calculo = null; aviso('pqMsg', 'Cambiaste los parámetros: pulsa «Calcular».'); } if (id === 'pqAgente' || id === 'pqInst') cargarPagos(); });
  });
  document.querySelectorAll('[data-pqver]').forEach(function (b) { b.addEventListener('click', function () { verLineas = b.dataset.pqver; pintarLineas(); }); });
  $('pqVendedores').addEventListener('click', async function (e) {
    var dt = e.target.closest('[data-pqdet]');
    // Abre o cierra solo el detalle de esa tarjeta (sin perder lo que ya se escribió en la forma de pago)
    if (dt) {
      var k = dt.dataset.pqdet, card = dt.closest('[data-vend]'), caja = card.querySelector('.com-vend-det');
      pqAbiertos[k] = !pqAbiertos[k];
      if (caja) caja.remove();
      if (pqAbiertos[k]) card.querySelector('.com-vend-head').insertAdjacentHTML('afterend', detalleTarjeta({ benef: card.dataset.benef, id: +card.dataset.vend }));
      dt.textContent = pqAbiertos[k] ? 'Ocultar detalle' : 'Detalle'; dt.setAttribute('aria-expanded', pqAbiertos[k]);
      return;
    }
    var b = e.target.closest('[data-pagar]');
    if (!b || !calculo || !puedePagar) return;
    var card = b.closest('[data-vend]'), msg = card.querySelector('[data-vmsg]');
    function campo(k) { var x = card.querySelector('[data-v="' + k + '"]'); return x ? x.value.trim() : ''; }
    function av(t, err) { msg.textContent = t; msg.style.color = err ? '#9A3B2E' : '#475B68'; }
    var metodo = campo('metodo');
    if ((metodo === 'transferencia' || metodo === 'deposito') && !campo('banco')) { av('Elige el banco del pago.', true); card.querySelector('[data-v="banco"]').focus(); return; }
    if (!campo('fecha_pago')) { av('Indica la fecha de pago.', true); return; }
    if (!pedirConfirmacion(b)) return;
    b.disabled = true; av('Registrando…');
    var r = await sb.rpc('registrar_pago_comision', { p_beneficiario: card.dataset.benef, p_id: +card.dataset.vend, p_desde: calculo.desde, p_hasta: calculo.hasta,
      p_datos: { metodo: metodo, fecha_pago: campo('fecha_pago'), fecha_operacion: campo('fecha_operacion'), banco: campo('banco'), cuenta_bancaria: campo('cuenta_bancaria'), referencia: campo('referencia'), observaciones: campo('observaciones') } });
    b.disabled = false;
    if (r.error) { av(traducir(r.error), true); return; }
    await calcular();
    aviso('pqMsg', 'Se registró el pago de comisiones No. ' + r.data + '.');
    imprimirPago(r.data);
  });
  $('pqPagosBody').addEventListener('click', async function (e) {
    var bi = e.target.closest('[data-pqimp]'), ba = e.target.closest('[data-pqanular]');
    if (bi) { imprimirPago(bi.dataset.pqimp); return; }
    if (!ba) return;
    var motivo = prompt('Motivo de la anulación del pago de comisiones No. ' + ba.dataset.pqanular + ':');
    if (motivo === null) return;
    if (!motivo.trim()) { aviso('pqPagosMsg', 'Escribe el motivo de la anulación.', true); return; }
    var r = await sb.rpc('anular_pago_comision', { p_id: +ba.dataset.pqanular, p_motivo: motivo.trim() });
    if (r.error) { aviso('pqPagosMsg', traducir(r.error), true); return; }
    if (calculo) await calcular(); else await cargarPagos();
    aviso('pqPagosMsg', 'Se anuló el pago No. ' + ba.dataset.pqanular + '; sus comisiones vuelven a quedar pendientes de pago.');
  });

  var t1 = $('tabComReglas'), t2 = $('tabComPago'), t3 = $('tabRepComisiones');
  if (t1) t1.addEventListener('click', function () { verReglas('crLista'); cargarReglas(); });
  if (t2) t2.addEventListener('click', function () { permisoPago(); cargarApoyo().then(cargarPagos); });
  if (t3) t3.addEventListener('click', function () { permisoPago().then(function () { if (genParams) pintarGen(); }); cargarApoyo(); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { cargarReglas(); },
    limpiar: function () {
      reglas = []; lineas = []; pagos = []; calculo = null; gen = []; genParams = null; genAbierto = null; borrador = {};
      $('crBody').innerHTML = ''; $('pqBody').innerHTML = ''; $('pqPagosBody').innerHTML = ''; $('pqVendedores').innerHTML = '';
      $('pqResultado').hidden = true; verReglas('crLista'); aviso('pqMsg', ''); aviso('crMsg', ''); aviso('gcMsg', ''); pintarGen();
    }
  });
})();
