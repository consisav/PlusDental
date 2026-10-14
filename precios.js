// Plus Dental — Precios por procedimiento (grupo «Precios y paquetes»)
// Tabla con un precio por tipo (Cliente directo, Institucional, VIP, Paquete, Especial):
// valor, % de descuento máximo y estado con su color. Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admPrecios')) return;

  var TIPOS = [['directo', 'Cliente directo'], ['institucional', 'Institucional'], ['vip', 'VIP'], ['paquete', 'Paquete'], ['especial', 'Especial']];
  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', baja: 'Baja' };
  var tratamientos = [], precios = [], actual = null, editandoId = null, filtro = 'todos';
  var tiposProc = [];   // tipos de procedimientos: la tabla se agrupa por tipo

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
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
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
    '<p class="dlg-msg">Los procedimientos salen del catálogo de <b>Tipos de procedimientos</b> (y de tu catálogo de tratamientos). Elige un tipo, pulsa «Definir precios» o «Abrir» y graba un precio por cada tipo de precio: Cliente directo, Institucional, VIP, Paquete y Especial. Al grabar el primer precio de un procedimiento sugerido, se agrega solo a tu catálogo de tratamientos.</p>' +
    '<div class="pr-barra"><label class="pr-tipo-proc">Tipo de procedimiento<select id="prTipoProc" class="adm-input"><option value="">Todos los tipos</option></select></label></div>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="prFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['suspendido', 'Suspendidos'], ['baja', 'Baja']].map(function (f) { return '<button type="button" class="adm-btn" data-prfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="prBuscar" type="search" class="adm-input" placeholder="Buscar procedimiento" aria-label="Buscar procedimiento" style="width: 100%; max-width: 320px"></div>' +
    '<div class="roles-wrap"><table class="pr-tabla"><thead><tr><th>Procedimiento</th>' + TIPOS.map(function (t) { return '<th class="num">' + t[1] + '</th>'; }).join('') + '<th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="prBody"></tbody></table></div>' +
    '<p id="prMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="prFicha" class="adm-pane" hidden>' +
    '<button type="button" id="prVolver" class="dlg-link">← Todos los procedimientos</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="prTitulo" class="adm-h"></h3><p id="prSub" class="dlg-msg"></p></div></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Tipo de precio</th><th class="num">Valor</th><th class="num">% descuento máximo</th><th>Estado</th><th>Última modificación</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="prPrecios"></tbody></table></div>' +
    '<form id="prForm" class="adm-pane pos-sec" novalidate><h4 id="prFormTitulo" class="pr-form-t">Nuevo precio</h4>' +
    '<div class="exp-form">' +
    '<label>Tipo de precio<select id="prTipo">' + TIPOS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
    '<label>Estado<select id="prEstado" class="ac-estado"><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="baja">Baja</option></select></label>' +
    '<label>Porcentaje de descuento máximo<span class="ac-pct"><input id="prDescuento" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0.00"><span aria-hidden="true">%</span></span></label>' +
    '<label>Valor (Q) *<input id="prValor" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required></label>' +
    '</div>' +
    '<div class="exp-actions"><button type="submit" id="prGrabar" class="dlg-submit">Grabar</button><button type="button" id="prCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="prFormMsg" class="dlg-msg" role="status"></p></form></div>';

  function ver(id) { ['prLista', 'prFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function preciosDe(id) { return precios.filter(function (p) { return p.tratamiento_id === id; }); }

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
    return '<td class="num"><span class="pr-celda"><b>' + q(p.valor) + '</b><small>máx. ' + pct(p.descuento_max) + '</small>' + pill(p.estado) + '</span></td>';
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
    return '<tr' + (t.virtual ? ' class="pr-sugerido"' : '') + '><td><b>' + esc(t.nombre) + '</b>' + (t.virtual ? ' <span class="ac-fijo">Sugerido</span>' : t.activo ? '' : ' <span class="ac-fijo">Inactivo</span>') + '</td>' +
      TIPOS.map(function (tp) { return celda(ps.filter(function (p) { return p.tipo === tp[0]; })[0]); }).join('') +
      '<td><button type="button" class="adm-btn" data-prabrir="' + t.id + '">' + (t.virtual ? 'Definir precios' : 'Abrir') + '</button></td></tr>';
  }

  // ---------- Ficha del procedimiento ----------
  function pintarEstadoSelect() { $('prEstado').dataset.estado = $('prEstado').value; }
  function limpiarForm() {
    editandoId = null;
    var usados = preciosDe(actual.id).map(function (p) { return p.tipo; });
    [].forEach.call($('prTipo').options, function (o) { o.disabled = usados.indexOf(o.value) >= 0; });
    $('prTipo').disabled = false;
    // por defecto «Especial» (o el siguiente tipo que falte, si ya existe)
    var libre = ['especial', 'directo', 'institucional', 'vip', 'paquete'].filter(function (t) { return usados.indexOf(t) < 0; })[0];
    $('prTipo').value = libre || 'especial';
    $('prEstado').value = 'baja'; pintarEstadoSelect();
    $('prDescuento').value = ''; $('prValor').value = '';
    $('prFormTitulo').textContent = 'Nuevo precio';
    $('prCancelar').hidden = true;
    var completo = !libre;
    $('prGrabar').disabled = completo;
    ['prTipo', 'prEstado', 'prDescuento', 'prValor'].forEach(function (id) { $(id).disabled = completo; });
    aviso('prFormMsg', completo ? 'Este procedimiento ya tiene los cinco tipos de precio. Usa «Modificar» en la tabla.' : '');
  }
  function pintarFicha() {
    var tp = tiposProc.filter(function (x) { return x.id === actual.tipo_id; })[0];
    $('prTitulo').textContent = actual.nombre;
    $('prSub').textContent = actual.virtual
      ? 'Procedimiento sugerido de «' + (tp ? tp.nombre : '') + '». Se agregará a tu catálogo de tratamientos al grabar su primer precio.'
      : (tp ? tp.nombre + ' · ' : '') + 'Precio de catálogo en presupuestos: ' + q(actual.precio) + (actual.activo ? '' : ' · procedimiento inactivo');
    var ps = preciosDe(actual.id).sort(function (a, b) {
      return TIPOS.map(function (t) { return t[0]; }).indexOf(a.tipo) - TIPOS.map(function (t) { return t[0]; }).indexOf(b.tipo);
    });
    $('prPrecios').innerHTML = ps.length ? ps.map(function (p) {
      return '<tr' + (p.id === editandoId ? ' class="pr-editando"' : '') + '><td><b>' + nombreTipo(p.tipo) + '</b></td><td class="num">' + q(p.valor) + '</td><td class="num">' + pct(p.descuento_max) + '</td><td>' + pill(p.estado) + '</td>' +
        '<td class="fecha">' + fechaHora(p.actualizado) + (p.actualizado_por ? '<br><span class="hi-desc">por ' + esc(p.actualizado_por) + '</span>' : '') + '</td>' +
        '<td><div class="hi-botones"><button type="button" class="adm-btn" data-prmod="' + p.id + '">Modificar</button><button type="button" class="adm-btn" data-prdel="' + p.id + '">Eliminar</button></div></td></tr>';
    }).join('') : '<tr><td colspan="6">Este procedimiento todavía no tiene precios. Agrega el primero abajo.</td></tr>';
  }
  function abrir(t) {
    actual = t;
    pintarFicha(); limpiarForm(); ver('prFicha');
  }
  function modificar(p) {
    editandoId = p.id;
    $('prFormTitulo').textContent = 'Modificar precio · ' + nombreTipo(p.tipo);
    [].forEach.call($('prTipo').options, function (o) { o.disabled = false; });
    $('prTipo').value = p.tipo; $('prTipo').disabled = true;   // el tipo no se cambia: se elimina y se crea otro
    ['prEstado', 'prDescuento', 'prValor'].forEach(function (id) { $(id).disabled = false; });
    $('prEstado').value = p.estado; pintarEstadoSelect();
    $('prDescuento').value = Number(p.descuento_max); $('prValor').value = Number(p.valor);
    $('prGrabar').disabled = false; $('prCancelar').hidden = false;
    aviso('prFormMsg', 'Haz los cambios y pulsa «Grabar».');
    pintarFicha();
    $('prForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('prValor').focus();
  }

  async function grabar(e) {
    e.preventDefault();
    var valor = $('prValor').value === '' ? NaN : Number($('prValor').value);
    var desc = $('prDescuento').value === '' ? 0 : Number($('prDescuento').value);
    if (isNaN(valor) || valor < 0) { aviso('prFormMsg', 'Escribe el valor del precio (0 o más).', true); $('prValor').focus(); return; }
    if (isNaN(desc) || desc < 0 || desc > 100) { aviso('prFormMsg', 'El descuento máximo debe estar entre 0 y 100 %.', true); $('prDescuento').focus(); return; }
    var datos = { valor: Math.round(valor * 100) / 100, descuento_max: Math.round(desc * 100) / 100, estado: $('prEstado').value };
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
    else { datos.tratamiento_id = actual.id; datos.tipo = $('prTipo').value; r = await sb.from('precios').insert(datos).select('*').single(); }
    $('prGrabar').disabled = false;
    if (r.error) { aviso('prFormMsg', traducir(r.error), true); return; }
    var nuevo = !editandoId;
    precios = nuevo ? precios.concat([r.data]) : precios.map(function (p) { return p.id === r.data.id ? r.data : p; });
    pintarFicha(); limpiarForm(); pintarLista();
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
  $('prCancelar').addEventListener('click', function () { limpiarForm(); pintarFicha(); });
  $('prPrecios').addEventListener('click', async function (e) {
    var m = e.target.closest('[data-prmod]'), d = e.target.closest('[data-prdel]');
    if (m) { modificar(precios.filter(function (p) { return String(p.id) === m.dataset.prmod; })[0]); return; }
    if (!d || !pedirConfirmacion(d)) return;
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
