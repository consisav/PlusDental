// Plus Dental — Precios por procedimiento (grupo «Precios y paquetes»)
// Tabla con un precio por tipo (Cliente directo, Institucional, VIP, Paquete, Especial):
// valor, % de descuento máximo y estado con su color. Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admPrecios')) return;

  var TIPOS = [['directo', 'Cliente directo'], ['institucional', 'Institucional'], ['vip', 'VIP'], ['paquete', 'Paquete'], ['especial', 'Especial']];
  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', baja: 'Baja' };
  var tratamientos = [], precios = [], actual = null, editandoId = null, filtro = 'todos';

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
    '<p class="dlg-msg">Un precio por cada tipo: Cliente directo, Institucional, VIP, Paquete y Especial. Pulsa «Abrir» en un procedimiento para agregar o modificar sus precios. Los procedimientos son los del catálogo de tratamientos (Pacientes → Presupuesto).</p>' +
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
      sb.from('tratamientos').select('id,nombre,precio,activo').order('nombre'),
      sb.from('precios').select('*')
    ]);
    if (r[0].error || r[1].error) { $('prBody').innerHTML = ''; aviso('prMsg', traducir(r[0].error || r[1].error), true); return; }
    tratamientos = r[0].data || []; precios = r[1].data || [];
    pintarLista();
    if (actual && !$('prFicha').hidden) { actual = tratamientos.filter(function (t) { return t.id === actual.id; })[0] || null; if (actual) pintarFicha(); else ver('prLista'); }
  }

  function celda(p) {
    if (!p || (filtro !== 'todos' && p.estado !== filtro)) return '<td class="num pr-vacio">—</td>';
    return '<td class="num"><span class="pr-celda"><b>' + q(p.valor) + '</b><small>máx. ' + pct(p.descuento_max) + '</small>' + pill(p.estado) + '</span></td>';
  }
  function pintarLista() {
    document.querySelectorAll('[data-prfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.prfiltro === filtro); });
    var qtxt = sinTildes($('prBuscar').value.trim());
    var filas = tratamientos.filter(function (t) {
      if (qtxt && sinTildes(t.nombre).indexOf(qtxt) < 0) return false;
      return filtro === 'todos' || preciosDe(t.id).some(function (p) { return p.estado === filtro; });
    });
    $('prBody').innerHTML = !tratamientos.length
      ? '<tr><td colspan="7">Aún no hay procedimientos. Agrégalos en Pacientes → Presupuesto → catálogo de tratamientos.</td></tr>'
      : !filas.length ? '<tr><td colspan="7">No hay procedimientos con ese filtro.</td></tr>'
      : filas.map(function (t) {
        var ps = preciosDe(t.id);
        return '<tr><td><b>' + esc(t.nombre) + '</b>' + (t.activo ? '' : ' <span class="ac-fijo">Inactivo</span>') + '</td>' +
          TIPOS.map(function (tp) { return celda(ps.filter(function (p) { return p.tipo === tp[0]; })[0]); }).join('') +
          '<td><button type="button" class="adm-btn" data-prabrir="' + t.id + '">Abrir</button></td></tr>';
      }).join('');
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
    $('prTitulo').textContent = actual.nombre;
    $('prSub').textContent = 'Precio de catálogo en presupuestos: ' + q(actual.precio) + (actual.activo ? '' : ' · procedimiento inactivo');
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
    if (b) abrir(tratamientos.filter(function (t) { return String(t.id) === b.dataset.prabrir; })[0]);
  });
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
