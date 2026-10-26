// Plus Dental — Precios por procedimiento (grupo «Precios y paquetes»)
// Tabla con un precio por tipo (Cliente directo, Institucional, VIP, Paquete, Especial):
// valor, % de descuento máximo y estado con su color. Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admPrecios')) return;

  var TIPOS = [['directo', 'Cliente directo'], ['institucional', 'Institucional'], ['vip', 'VIP'], ['referido', 'Referido'], ['paquete', 'Paquete'], ['especial', 'Especial']];
  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', baja: 'Baja' };
  var tratamientos = [], precios = [], actual = null, editandoId = null, filtro = 'todos';
  var tiposProc = [];   // tipos de procedimientos: la tabla se agrupa por tipo
  var EN = window.PD_EN_EXTRA = window.PD_EN_EXTRA || {};
  EN['+ Otro tipo de precio'] = '+ Another price type';
  EN['Nuevo precio para el mismo procedimiento: elige el tipo de precio, escribe el valor y pulsa «Grabar».'] = 'New price for the same procedure: choose the price type, enter the value and press “Save”.';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return (Number(n) || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 }) + ' %'; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function nombreTipo(t) { return (TIPOS.filter(function (x) { return x[0] === t; })[0] || [t, t])[1]; }
  function pill(e) { return '<span class="estado estado-' + e + '">' + ESTADOS[e] + '</span>'; }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/precios.*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los precios.';
    if (/precios_tratamiento_tipo|duplicate key/i.test(m)) return 'Este procedimiento ya tiene un precio de ese tipo. Usa «Modificar».';
    if (/precios_descuento/i.test(m)) return 'El descuento máximo debe estar entre 0 y 100 %.';
    if (/precios_valor/i.test(m)) return 'El valor no puede ser negativo.';
    if (/row-level security|permission denied|JSON object requested|0 rows/i.test(m)) return 'Solo el Super Administrador puede crear, modificar o eliminar precios.';
    if (/valor_usd/i.test(m)) return 'El valor en dólares no puede ser negativo.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent; b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // ---------- Pantalla ----------
  $('admPrecios').innerHTML =
    '<div id="prLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Precios por procedimiento</h3></div>' +
    '<p class="dlg-msg">Los procedimientos salen del catálogo de <b>Tipos de procedimientos</b> (y de tu catálogo de tratamientos). Elige un tipo, pulsa «Definir precios» o «Abrir» y graba un precio por cada tipo de precio: Cliente directo, Institucional, VIP, Referido, Paquete y Especial. Al grabar el primer precio de un procedimiento sugerido, se agrega solo a tu catálogo de tratamientos.</p>' +
    '<div class="pr-barra"><label class="pr-tipo-proc">Tipo de procedimiento<select id="prTipoProc" class="adm-input"><option value="">Todos los tipos</option></select></label>' +
    '<label class="pr-tipo-proc">Organización<select id="prOrg" class="adm-input"><option value="">—</option></select></label>' +
    '<label class="pr-tipo-proc">Localidad / Empresa<select id="prLoc" class="adm-input"><option value="">—</option></select></label></div>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="prFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['suspendido', 'Suspendidos'], ['baja', 'Baja']].map(function (f) { return '<button type="button" class="adm-btn" data-prfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="prBuscar" type="search" class="adm-input" placeholder="Buscar procedimiento" aria-label="Buscar procedimiento" style="width: 100%; max-width: 320px"></div>' +
    '<div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Procedimiento</th>' + TIPOS.map(function (t) { return '<th class="num">' + t[1] + '</th>'; }).join('') + '<th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="prBody"></tbody></table></div>' +
    '<p id="prMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="prFicha" class="adm-pane" hidden>' +
    '<button type="button" id="prVolver" class="dlg-link">← Todos los procedimientos</button>' +
    // Encabezado destacado: deja claro a qué procedimiento se le está definiendo el precio
    '<div class="pr-cabeza"><span class="pr-cabeza-lbl">Definiendo precios de</span><h3 id="prTitulo" class="pr-cabeza-nom"></h3>' +
    '<div class="pr-cabeza-info"><span id="prTipoTag" class="pr-cabeza-tipo" hidden></span><span id="prSub"></span></div></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Tipo de precio</th><th class="num">Valor (Q)</th><th class="num">Valor (US$)</th><th class="num">% desc. máx.</th><th>Estado</th><th>Fecha</th><th>Última modificación</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="prPrecios"></tbody></table></div>' +
    '<form id="prForm" class="adm-pane pos-sec" novalidate><h4 id="prFormTitulo" class="pr-form-t">Nuevo precio</h4>' +
    '<p id="prSoloSuper" class="pr-solo-super" hidden>Solo el Super Administrador puede crear, modificar o eliminar precios. Tú puedes consultarlos.</p>' +
    '<fieldset id="prCampos" class="campos"><div class="exp-form">' +
    '<label>Tipo de precio<select id="prTipo">' + TIPOS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
    '<label>Estado<select id="prEstado" class="ac-estado"><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="baja">Baja</option></select></label>' +
    '<label>Valor (Q) *<input id="prValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required></label>' +
    '<label>Valor (US$)<input id="prValorUsd" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>' +
    '<label>Porcentaje de descuento máximo<span class="ac-pct"><input id="prDescuento" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0.00"><span aria-hidden="true">%</span></span></label>' +
    '<label>Fecha *<input id="prFecha" type="date" required></label>' +
    '</div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="prGrabar" class="dlg-submit">Grabar</button><button type="button" id="prModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="prCancelar" class="adm-btn">Cancelar</button><button type="button" id="prOtro" class="adm-btn" style="margin-left:auto">+ Otro tipo de precio</button></div>' +
    '<p id="prFormMsg" class="dlg-msg" role="status"></p></form></div>';

  function ver(id) { ['prLista', 'prFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }
  // Precios de la sede elegida arriba (Organización / Localidad); cada sede tiene su propia lista
  function sedePrecios() { return $('prLoc') ? (+$('prLoc').value || null) : null; }
  function preciosDe(id) { var l = sedePrecios(); return precios.filter(function (p) { return p.tratamiento_id === id && (!l || p.localidad_id === l); }); }

  async function cargar() {
    aviso('prMsg', '');
    $('prBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var r = await Promise.all([
      sb.from('tratamientos').select('id,nombre,precio,activo,tipo_id').order('nombre'),
      sb.from('precios').select('*'),
      sb.from('tipos_procedimiento').select('id,nombre,estado,orden,sugeridos').order('orden').order('codigo')
    ]);
    if (r[0].error && /tipo_id/.test(r[0].error.message || '')) r[0] = await sb.from('tratamientos').select('id,nombre,precio,activo').order('nombre');
    if (r[0].error || r[1].error) { $('prBody').innerHTML = ''; aviso('prMsg', traducir(r[0].error || r[1].error), true); return; }
    tratamientos = r[0].data || []; precios = r[1].data || [];
    if (window.PD_SEDES && !$('prLoc').dataset.listo) { $('prLoc').dataset.listo = '1'; await window.PD_SEDES.llenar($('prOrg'), $('prLoc'), null); }
    tiposProc = r[2].error ? [] : (r[2].data || []).filter(function (t) { return t.estado === 'activo'; });
    pintarTiposProc();
    pintarLista();
    if (actual && !actual.virtual && !$('prFicha').hidden) { actual = tratamientos.filter(function (t) { return t.id === actual.id; })[0] || null; if (actual) pintarFicha(); else ver('prLista'); }
  }

  // Lista dinámica de tipos de procedimiento (del catálogo «Tipos de procedimientos»)
  function pintarTiposProc() {
    var sel = $('prTipoProc'), antes = sel.value;
    sel.innerHTML = '<option value="">Todos los tipos</option>' +
      tiposProc.map(function (t) { return '<option value="' + t.id + '">' + esc(t.nombre) + '</option>'; }).join('') +
      (tratamientos.some(function (t) { return !tipoValido(t.tipo_id); }) ? '<option value="sin">Sin tipo</option>' : '');
    sel.value = [].some.call(sel.options, function (o) { return o.value === antes; }) ? antes : '';
  }
  function tipoValido(id) { return !!id && tiposProc.some(function (tp) { return tp.id === id; }); }
  function clave(t) { return String(t || '').trim().toLowerCase(); }

  // Procedimientos por tipo: los sugeridos del tipo (los que aún no están en el catálogo quedan como «virtuales»)
  // más los del catálogo clasificados en ese tipo; al final, los del catálogo sin tipo.
  function modelo() {
    var vistos = {}, res = [];
    tiposProc.forEach(function (tp) {
      var filas = [];
      (tp.sugeridos || []).forEach(function (nombre, k) {
        var t = tratamientos.filter(function (x) { return clave(x.nombre) === clave(nombre); })[0];
        if (t) {
          if (vistos[t.id] || (tipoValido(t.tipo_id) && t.tipo_id !== tp.id)) return;   // ya aparece en su propio tipo
          vistos[t.id] = 1; filas.push(t);
        } else filas.push({ id: 'v' + tp.id + '-' + k, virtual: true, nombre: nombre, tipo_id: tp.id, precio: 0, activo: true });
      });
      tratamientos.forEach(function (t) { if (t.tipo_id === tp.id && !vistos[t.id]) { vistos[t.id] = 1; filas.push(t); } });
      res.push({ id: String(tp.id), titulo: tp.nombre, filas: filas });
    });
    var sinTipo = tratamientos.filter(function (t) { return !vistos[t.id]; });
    if (sinTipo.length) res.push({ id: 'sin', titulo: tiposProc.length ? 'Sin tipo' : '', filas: sinTipo });
    return res;
  }

  function celda(p) {
    if (!p || (filtro !== 'todos' && p.estado !== filtro)) return '<td class="num pr-vacio">—</td>';
    return '<td class="num"><span class="pr-celda"><b>' + q(p.valor) + '</b>' + (p.valor_usd != null ? '<small>' + usd(p.valor_usd) + '</small>' : '') + '<small>máx. ' + pct(p.descuento_max) + '</small>' + pill(p.estado) + '</span></td>';
  }
  var filasVisibles = [];
  function pintarLista() {
    document.querySelectorAll('[data-prfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.prfiltro === filtro); });
    var qtxt = sinTildes($('prBuscar').value.trim()), tipoSel = $('prTipoProc').value;
    var grupos = modelo().filter(function (g) { return !tipoSel || g.id === tipoSel; }).map(function (g) {
      return { titulo: g.titulo, filas: g.filas.filter(function (t) {
        if (qtxt && sinTildes(t.nombre).indexOf(qtxt) < 0) return false;
        return filtro === 'todos' || (!t.virtual && preciosDe(t.id).some(function (p) { return p.estado === filtro; }));
      }) };
    }).filter(function (g) { return g.filas.length; });
    filasVisibles = [].concat.apply([], grupos.map(function (g) { return g.filas; }));
    $('prBody').innerHTML = !tiposProc.length && !tratamientos.length
      ? '<tr><td colspan="7">Aún no hay procedimientos. Crea los tipos de procedimientos en «Tipos de procedimientos» (ejecuta el script actualizado de Supabase para cargar los de Guatemala).</td></tr>'
      : !grupos.length ? '<tr><td colspan="7">No hay procedimientos con ese filtro.</td></tr>'
      : grupos.map(function (g) {
        return (g.titulo ? '<tr class="pr-grupo"><td colspan="7">' + esc(g.titulo) + '</td></tr>' : '') + g.filas.map(fila).join('');
      }).join('');
  }
  function fila(t) {
    var ps = t.virtual ? [] : preciosDe(t.id);
    return '<tr' + (t.virtual ? ' class="pr-sugerido"' : '') + '><td><b>' + esc(t.nombre) + '</b>' + (!t.virtual && !t.activo ? ' <span class="ac-fijo">Inactivo</span>' : '') + '</td>' +
      TIPOS.map(function (tp) { return celda(ps.filter(function (p) { return p.tipo === tp[0]; })[0]); }).join('') +
      '<td><button type="button" class="adm-btn" data-prabrir="' + t.id + '">' + (t.virtual ? 'Definir precios' : 'Abrir') + '</button></td></tr>';
  }

  // ---------- Ficha del procedimiento ----------
  function pintarEstadoSelect() { $('prEstado').dataset.estado = $('prEstado').value; }
  function hoyIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function usd(n) { return n == null || n === '' ? '—' : 'US$' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // Solo el Super Administrador crea, modifica o elimina precios (Supabase también lo exige)
  function puedeEditar() { return !!(window.PD_SESION && window.PD_SESION.esSuper()); }

  // Formulario en tres modos: nuevo precio · ver un precio (botón Modificar) · modificar
  var modo = 'nuevo', seleccionado = null;
  function aplicarModo() {
    var permiso = puedeEditar();
    $('prSoloSuper').hidden = permiso;
    $('prCampos').disabled = !permiso || modo === 'ver';
    $('prTipo').disabled = modo !== 'nuevo';
    $('prGrabar').disabled = !permiso || modo === 'ver' || (modo === 'nuevo' && $('prTipo').dataset.completo === '1');
    $('prModificar').disabled = !permiso || modo !== 'ver';
    $('prCancelar').disabled = modo === 'nuevo';
    // «+ Otro tipo de precio»: mismo procedimiento, un tipo que aún no tenga precio
    var faltan = actual ? TIPOS.length - preciosDe(actual.id).length : 0;
    $('prOtro').hidden = !permiso || modo === 'nuevo';
    $('prOtro').disabled = faltan <= 0;
    $('prOtro').title = faltan <= 0 ? 'Este procedimiento ya tiene los seis tipos de precio.' : '';
    $('prModificar').title = !permiso ? 'Solo el Super Administrador puede modificar precios.' : modo === 'nuevo' ? 'Elige un precio de la tabla («Ver») para modificarlo.' : '';
    document.querySelectorAll('#prPrecios [data-prdel]').forEach(function (b) { b.disabled = !permiso; });
  }
  function limpiarForm() {
    modo = 'nuevo'; seleccionado = null; editandoId = null;
    var usados = preciosDe(actual.id).map(function (p) { return p.tipo; });
    [].forEach.call($('prTipo').options, function (o) { o.disabled = usados.indexOf(o.value) >= 0; });
    // por defecto «Especial» (o el siguiente tipo que falte, si ya existe)
    var libre = ['especial', 'directo', 'institucional', 'vip', 'referido', 'paquete'].filter(function (t) { return usados.indexOf(t) < 0; })[0];
    $('prTipo').value = libre || 'especial';
    $('prTipo').dataset.completo = libre ? '0' : '1';
    $('prEstado').value = 'activo'; pintarEstadoSelect();
    $('prDescuento').value = ''; $('prValor').value = ''; $('prValorUsd').value = '';
    $('prFecha').value = hoyIso();
    $('prFormTitulo').innerHTML = 'Nuevo precio para <b>' + esc(actual.nombre) + '</b>';
    aplicarModo();
    aviso('prFormMsg', !libre ? 'Este procedimiento ya tiene los seis tipos de precio. Pulsa «Ver» en uno y luego «Modificar».' : '');
  }
  function mostrarPrecio(p) {
    $('prTipo').value = p.tipo;
    $('prEstado').value = p.estado; pintarEstadoSelect();
    $('prValor').value = Number(p.valor);
    $('prValorUsd').value = p.valor_usd == null ? '' : Number(p.valor_usd);
    $('prDescuento').value = Number(p.descuento_max);
    $('prFecha').value = p.fecha || hoyIso();
  }
  function verPrecio(p) {
    modo = 'ver'; seleccionado = p; editandoId = null;
    [].forEach.call($('prTipo').options, function (o) { o.disabled = false; });
    mostrarPrecio(p);
    $('prFormTitulo').innerHTML = 'Precio ' + nombreTipo(p.tipo) + ' de <b>' + esc(actual.nombre) + '</b>';
    aplicarModo(); pintarFicha();
    aviso('prFormMsg', puedeEditar() ? 'Pulsa «Modificar» para cambiar este precio.' : '');
    $('prForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function pintarFicha() {
    var tp = tiposProc.filter(function (x) { return x.id === actual.tipo_id; })[0];
    $('prTitulo').textContent = actual.nombre;
    $('prTipoTag').hidden = !tp;
    $('prTipoTag').textContent = tp ? tp.nombre : '';
    $('prSub').textContent = actual.virtual
      ? 'Se agregará a tu catálogo de tratamientos al grabar su primer precio.'
      : 'Precio de catálogo en presupuestos: ' + q(actual.precio) + (actual.activo ? '' : ' · procedimiento inactivo');
    var ps = preciosDe(actual.id).sort(function (a, b) {
      return TIPOS.map(function (t) { return t[0]; }).indexOf(a.tipo) - TIPOS.map(function (t) { return t[0]; }).indexOf(b.tipo);
    });
    var sel = seleccionado ? seleccionado.id : editandoId;
    $('prPrecios').innerHTML = ps.length ? ps.map(function (p) {
      return '<tr' + (p.id === sel ? ' class="pr-editando"' : '') + '><td><b>' + nombreTipo(p.tipo) + '</b></td><td class="num">' + q(p.valor) + '</td><td class="num">' + usd(p.valor_usd) + '</td><td class="num">' + pct(p.descuento_max) + '</td><td>' + pill(p.estado) + '</td>' +
        '<td class="fecha">' + fechaCorta(p.fecha) + '</td>' +
        '<td class="fecha">' + fechaHora(p.actualizado) + (p.actualizado_por ? '<br><span class="hi-desc">por ' + esc(p.actualizado_por) + '</span>' : '') + '</td>' +
        '<td><div class="hi-botones"><button type="button" class="adm-btn" data-prver="' + p.id + '">Ver</button><button type="button" class="adm-btn" data-prdel="' + p.id + '"' + (puedeEditar() ? '' : ' disabled title="Solo el Super Administrador puede eliminar precios."') + '>Eliminar</button></div></td></tr>';
    }).join('') : '<tr><td colspan="8">Este procedimiento todavía no tiene precios.' + (puedeEditar() ? ' Agrega el primero abajo.' : '') + '</td></tr>';
  }
  function abrir(t) {
    actual = t;
    seleccionado = null; editandoId = null;
    pintarFicha(); limpiarForm(); ver('prFicha');
  }
  // «Modificar»: habilita el precio que se está viendo; la fecha pasa a la de hoy (se puede cambiar)
  function modificar() {
    if (!seleccionado || !puedeEditar()) return;
    modo = 'editar'; editandoId = seleccionado.id;
    $('prFormTitulo').innerHTML = 'Modificar precio ' + nombreTipo(seleccionado.tipo) + ' de <b>' + esc(actual.nombre) + '</b>';
    $('prFecha').value = hoyIso();
    aplicarModo();
    aviso('prFormMsg', 'Haz los cambios y pulsa «Grabar». El tipo de precio no se cambia.');
    $('prValor').focus();
  }

  function cambioSede() { pintarLista(); if (actual && !$('prFicha').hidden) { pintarFicha(); if (typeof limpiarForm === 'function' && !actual.virtual) limpiarForm(); } }
  $('prOrg').addEventListener('change', function () { setTimeout(cambioSede, 0); });
  $('prLoc').addEventListener('change', cambioSede);

  async function grabar(e) {
    e.preventDefault();
    if (!puedeEditar()) { aviso('prFormMsg', 'Solo el Super Administrador puede crear o modificar precios.', true); return; }
    if (modo === 'ver') return;
    var valor = $('prValor').value === '' ? NaN : Number($('prValor').value);
    var valorUsd = $('prValorUsd').value === '' ? null : Number($('prValorUsd').value);
    var desc = $('prDescuento').value === '' ? 0 : Number($('prDescuento').value);
    if (isNaN(valor) || valor < 0) { aviso('prFormMsg', 'Escribe el valor del precio en quetzales (0 o más).', true); $('prValor').focus(); return; }
    if (valorUsd != null && (isNaN(valorUsd) || valorUsd < 0)) { aviso('prFormMsg', 'El valor en dólares no puede ser negativo.', true); $('prValorUsd').focus(); return; }
    if (isNaN(desc) || desc < 0 || desc > 100) { aviso('prFormMsg', 'El descuento máximo debe estar entre 0 y 100 %.', true); $('prDescuento').focus(); return; }
    if (!$('prFecha').value) { aviso('prFormMsg', 'Indica la fecha del precio.', true); $('prFecha').focus(); return; }
    var datos = { valor: Math.round(valor * 100) / 100, valor_usd: valorUsd == null ? null : Math.round(valorUsd * 100) / 100,
      descuento_max: Math.round(desc * 100) / 100, estado: $('prEstado').value, fecha: $('prFecha').value };
    $('prGrabar').disabled = true;
    aviso('prFormMsg', 'Grabando…');
    // Procedimiento sugerido: primero se agrega al catálogo de tratamientos, ya clasificado en su tipo
    if (actual.virtual) {
      var tipoPrecio = $('prTipo').value;
      var t = await sb.from('tratamientos').insert({ nombre: actual.nombre, precio: tipoPrecio === 'directo' ? datos.valor : 0, tipo_id: actual.tipo_id })
        .select('id,nombre,precio,activo,tipo_id').single();
      if (t.error) { $('prGrabar').disabled = false; aviso('prFormMsg', /duplicate|unico/i.test(t.error.message || '') ? 'Ese procedimiento ya está en el catálogo de tratamientos. Pulsa «Todos los procedimientos» y ábrelo desde la lista.' : traducir(t.error), true); return; }
      tratamientos = tratamientos.concat([t.data]);
      actual = t.data;
    }
    var r;
    if (editandoId) r = await sb.from('precios').update(datos).eq('id', editandoId).select('*').single();
    else { datos.tratamiento_id = actual.id; datos.tipo = $('prTipo').value; if (sedePrecios()) datos.localidad_id = sedePrecios(); r = await sb.from('precios').insert(datos).select('*').single(); }
    $('prGrabar').disabled = false;
    if (r.error) { aviso('prFormMsg', traducir(r.error), true); return; }
    var nuevo = !editandoId;
    precios = nuevo ? precios.concat([r.data]) : precios.map(function (p) { return p.id === r.data.id ? r.data : p; });
    pintarLista();
    verPrecio(r.data);   // queda a la vista, con «Modificar» disponible
    aviso('prFormMsg', (nuevo ? 'Precio ' : 'Cambios del precio ') + nombreTipo(r.data.tipo) + (nuevo ? ' grabado.' : ' grabados.'));
  }

  $('tabPrecios').addEventListener('click', function () { if (!$('prLista').hidden) cargar(); });
  $('prBuscar').addEventListener('input', pintarLista);
  $('prFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-prfiltro]'); if (b) { filtro = b.dataset.prfiltro; pintarLista(); } });
  $('prBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-prabrir]');
    if (b) abrir(filasVisibles.filter(function (t) { return String(t.id) === b.dataset.prabrir; })[0]);
  });
  $('prTipoProc').addEventListener('change', pintarLista);
  $('prVolver').addEventListener('click', function () { actual = null; ver('prLista'); pintarLista(); });
  $('prEstado').addEventListener('change', pintarEstadoSelect);
  $('prForm').addEventListener('submit', grabar);
  $('prModificar').addEventListener('click', modificar);
  $('prOtro').addEventListener('click', function () {
    limpiarForm(); pintarFicha();
    aviso('prFormMsg', 'Nuevo precio para el mismo procedimiento: elige el tipo de precio, escribe el valor y pulsa «Grabar».');
    $('prTipo').focus();
  });
  $('prCancelar').addEventListener('click', function () {
    if (modo === 'editar' && seleccionado) { verPrecio(seleccionado); aviso('prFormMsg', 'Se descartaron los cambios.'); return; }
    limpiarForm(); pintarFicha();
  });
  $('prPrecios').addEventListener('click', async function (e) {
    var v = e.target.closest('[data-prver]'), d = e.target.closest('[data-prdel]');
    if (v) { verPrecio(precios.filter(function (p) { return String(p.id) === v.dataset.prver; })[0]); return; }
    if (!d || !puedeEditar() || !pedirConfirmacion(d)) return;
    d.disabled = true;
    var p = precios.filter(function (x) { return String(x.id) === d.dataset.prdel; })[0];
    var r = await sb.from('precios').delete().eq('id', p.id);
    d.disabled = false;
    if (r.error) { aviso('prFormMsg', traducir(r.error), true); return; }
    precios = precios.filter(function (x) { return x.id !== p.id; });
    pintarFicha(); limpiarForm(); pintarLista();
    aviso('prFormMsg', 'Precio ' + nombreTipo(p.tipo) + ' eliminado.');
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('prLista').hidden) cargar(); },
    limpiar: function () { tratamientos = []; precios = []; actual = null; editandoId = null; $('prBody').innerHTML = ''; $('prPrecios').innerHTML = ''; ver('prLista'); }
  });
})();
