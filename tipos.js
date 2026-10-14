// Plus Dental — Tipos de procedimientos (grupo «Precios y paquetes»)
// Catálogo de tipos (Odontología general, Endodoncia, Periodoncia…) con sus procedimientos sugeridos.
// Desde cada tipo se agregan procedimientos al catálogo de tratamientos ya clasificados. Solo personal.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admTipos')) return;

  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo' };
  var tipos = [], catalogo = [], actual = null, editando = false, filtro = 'todos';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function pill(e) { return '<span class="estado estado-' + e + '">' + ESTADOS[e] + '</span>'; }
  function clave(t) { return String(t || '').trim().toLowerCase(); }
  function enCatalogo(nombre) { return catalogo.filter(function (t) { return clave(t.nombre) === clave(nombre); })[0] || null; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/tipos_procedimiento.*(does not exist|could not find)|could not find the table|column .*tipo_id/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los tipos de procedimientos.';
    if (/tipos_procedimiento_nombre|duplicate key/i.test(m)) return 'Ya existe un tipo con ese nombre.';
    if (/tratamientos_nombre_unico/i.test(m)) return 'Ese procedimiento ya está en el catálogo.';
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

  $('admTipos').innerHTML =
    '<div id="tpLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Tipos de procedimientos</h3><button type="button" id="tpNuevo" class="adm-btn adm-primary">Nuevo tipo</button></div>' +
    '<p class="dlg-msg">Tipos de procedimientos dentales que se ofrecen en Guatemala, con sus procedimientos más comunes. En verde, los que ya están en tu catálogo de tratamientos. Abre un tipo para agregar procedimientos a tu catálogo ya clasificados.</p>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="tpFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['inactivo', 'Inactivos']].map(function (f) { return '<button type="button" class="adm-btn" data-tpfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="tpBuscar" type="search" class="adm-input" placeholder="Buscar tipo o procedimiento" aria-label="Buscar tipo o procedimiento" style="width: 100%; max-width: 320px"></div>' +
    '<div id="tpGrid" class="tp-grid"></div><p id="tpMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="tpFicha" class="adm-pane" hidden>' +
    '<button type="button" id="tpVolver" class="dlg-link">← Todos los tipos</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="tpTitulo" class="adm-h"></h3><p id="tpSub" class="dlg-msg"></p></div><span id="tpPill" class="estado" hidden></span></div>' +
    '<form id="tpForm" class="adm-pane" novalidate><fieldset id="tpCampos" class="campos pos-sec"><legend>Datos del tipo</legend><div class="exp-form">' +
    '<div class="exp-campo"><span class="pos-lbl">Código (automático)</span><div id="tpCodigo" class="exp-calc">—</div></div>' +
    '<label>Estado<select id="tpEstado" class="ac-estado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></label>' +
    '<label class="full">Nombre del tipo *<input id="tpNombre" type="text" maxlength="120" required></label>' +
    '<label class="full">Descripción<textarea id="tpDesc" rows="2" maxlength="500"></textarea></label>' +
    '<label class="full">Procedimientos sugeridos (uno por línea)<textarea id="tpSugeridos" rows="5" placeholder="Ej.:&#10;Tratamiento de conductos unirradicular&#10;Pulpotomía"></textarea></label>' +
    '</div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="tpGrabar" class="dlg-submit">Grabar</button><button type="button" id="tpModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="tpEliminar" class="adm-btn">Eliminar</button><button type="button" id="tpCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="tpFormMsg" class="dlg-msg" role="status"></p></form>' +
    '<div id="tpProcSec" class="pos-sec"><h4 class="pr-form-t">Procedimientos de este tipo</h4>' +
    '<p class="dlg-msg">«Agregar al catálogo» crea el procedimiento en tu catálogo de tratamientos (precio Q0.00; luego pon sus precios en «Precios»). «Clasificar aquí» asigna este tipo a un procedimiento que ya tenías.</p>' +
    '<div class="roles-wrap"><table><thead><tr><th>Procedimiento</th><th>En tu catálogo</th><th><span class="sr-only">Acción</span></th></tr></thead><tbody id="tpProc"></tbody></table></div>' +
    '<p id="tpProcMsg" class="dlg-msg" role="status"></p></div></div>';

  function ver(id) { ['tpLista', 'tpFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargar() {
    aviso('tpMsg', '');
    $('tpGrid').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await Promise.all([
      sb.from('tipos_procedimiento').select('*').order('orden').order('codigo'),
      sb.from('tratamientos').select('id,nombre,precio,activo,tipo_id').order('nombre')
    ]);
    if (r[0].error || r[1].error) { $('tpGrid').innerHTML = ''; aviso('tpMsg', traducir(r[0].error || r[1].error), true); return; }
    tipos = r[0].data; catalogo = r[1].data;
    pintarLista();
  }

  function pintarLista() {
    document.querySelectorAll('[data-tpfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tpfiltro === filtro); });
    var bus = clave($('tpBuscar').value).normalize('NFD').replace(/[̀-ͯ]/g, '');
    function norm(t) { return clave(t).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    var lista = tipos.filter(function (t) {
      if (filtro !== 'todos' && t.estado !== filtro) return false;
      return !bus || norm(t.nombre + ' ' + (t.descripcion || '') + ' ' + (t.sugeridos || []).join(' ')).indexOf(bus) >= 0;
    });
    $('tpGrid').innerHTML = !tipos.length ? '<p class="dlg-msg">No hay tipos todavía. Ejecuta el script de Supabase para cargar los tipos de Guatemala o pulsa «Nuevo tipo».</p>'
      : !lista.length ? '<p class="dlg-msg">No hay tipos con ese filtro.</p>'
      : lista.map(function (t) {
        var sug = t.sugeridos || [], propios = catalogo.filter(function (c) { return c.tipo_id === t.id; });
        var dentro = sug.filter(function (s) { return enCatalogo(s); }).length;
        return '<button type="button" class="tp-card" data-tpabrir="' + t.id + '">' +
          '<span class="pa-fila"><span class="tp-cod">' + esc(t.codigo || '') + '</span>' + pill(t.estado) + '</span>' +
          '<b>' + esc(t.nombre) + '</b>' + (t.descripcion ? '<span class="tp-desc">' + esc(t.descripcion) + '</span>' : '') +
          '<span class="tp-chips">' + sug.map(function (s) { return '<span' + (enCatalogo(s) ? ' class="en"' : '') + '>' + esc(s) + (enCatalogo(s) ? ' ✓' : '') + '</span>'; }).join('') + '</span>' +
          '<small>' + propios.length + ' en tu catálogo · ' + (sug.length - dentro) + ' sugeridos por agregar</small></button>';
      }).join('');
  }

  // ---------- Ficha ----------
  function pintarEstadoSelect() { $('tpEstado').dataset.estado = $('tpEstado').value; }
  function rellenar(t) {
    $('tpCodigo').textContent = t ? t.codigo : 'Se asigna al grabar';
    $('tpEstado').value = t ? t.estado : 'activo'; pintarEstadoSelect();
    $('tpNombre').value = t ? t.nombre : '';
    $('tpDesc').value = t ? t.descripcion || '' : '';
    $('tpSugeridos').value = t ? (t.sugeridos || []).join('\n') : '';
  }
  function pintarCabecera() {
    $('tpTitulo').textContent = actual ? actual.nombre : 'Nuevo tipo de procedimiento';
    $('tpSub').textContent = actual ? actual.codigo + ' · registrado por ' + (actual.registrado_por || '—') + ' · última modificación por ' + (actual.actualizado_por || '—') : 'Llena los datos y pulsa «Grabar».';
    $('tpPill').hidden = !actual;
    if (actual) { $('tpPill').className = 'estado estado-' + actual.estado; $('tpPill').textContent = ESTADOS[actual.estado]; }
  }
  function aplicarModo() {
    $('tpCampos').disabled = !editando;
    $('tpGrabar').disabled = !editando; $('tpCancelar').disabled = !editando;
    $('tpModificar').disabled = editando || !actual; $('tpEliminar').disabled = editando || !actual;
    $('tpModificar').title = !actual ? 'Disponible después de grabar el tipo.' : '';
    $('tpEliminar').title = !actual ? 'Disponible después de grabar el tipo.' : '';
    if ($('tpEliminar').dataset.confirmar === '1') { $('tpEliminar').dataset.confirmar = '0'; $('tpEliminar').textContent = 'Eliminar'; $('tpEliminar').style.borderColor = ''; $('tpEliminar').style.color = ''; }
    $('tpProcSec').hidden = !actual;
  }
  function pintarProcedimientos() {
    if (!actual) return;
    var nombres = (actual.sugeridos || []).slice();
    catalogo.forEach(function (c) { if (c.tipo_id === actual.id && !nombres.some(function (n) { return clave(n) === clave(c.nombre); })) nombres.push(c.nombre); });
    $('tpProc').innerHTML = nombres.length ? nombres.map(function (n) {
      var c = enCatalogo(n), accion;
      if (!c) accion = '<button type="button" class="adm-btn" data-tpagregar="' + esc(n) + '">Agregar al catálogo</button>';
      else if (c.tipo_id !== actual.id) accion = '<button type="button" class="adm-btn" data-tpclasificar="' + c.id + '">Clasificar aquí</button>';
      else accion = '<span class="tp-ok">✓ Clasificado</span>';
      var otro = c && c.tipo_id && c.tipo_id !== actual.id ? tipos.filter(function (t) { return t.id === c.tipo_id; })[0] : null;
      return '<tr><td>' + esc(n) + '</td><td>' + (c ? q(c.precio) + (c.activo ? '' : ' · inactivo') + (otro ? '<br><span class="hi-desc">ahora en ' + esc(otro.nombre) + '</span>' : '') : '—') + '</td><td>' + accion + '</td></tr>';
    }).join('') : '<tr><td colspan="3">Este tipo no tiene procedimientos sugeridos. Agrégalos con «Modificar».</td></tr>';
  }
  function abrir(t) {
    actual = t || null; editando = !t;
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarProcedimientos();
    aviso('tpFormMsg', ''); aviso('tpProcMsg', '');
    ver('tpFicha');
    if (editando) $('tpNombre').focus();
  }

  async function grabar(e) {
    e.preventDefault();
    if (!editando) return;
    var nombre = $('tpNombre').value.trim();
    if (!nombre) { aviso('tpFormMsg', 'Escribe el nombre del tipo.', true); $('tpNombre').focus(); return; }
    var sug = [];
    $('tpSugeridos').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      if (!sug.some(function (x) { return clave(x) === clave(s); })) sug.push(s.slice(0, 150));
    });
    var datos = { nombre: nombre, descripcion: $('tpDesc').value.trim() || null, estado: $('tpEstado').value, sugeridos: sug };
    if (!actual) datos.orden = tipos.reduce(function (m, t) { return Math.max(m, t.orden || 0); }, 0) + 1;
    $('tpGrabar').disabled = true;
    aviso('tpFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('tipos_procedimiento').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('tipos_procedimiento').insert(datos).select('*').single();
    if (r.error) { $('tpGrabar').disabled = false; aviso('tpFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual;
    actual = r.data;
    tipos = nuevo ? tipos.concat([actual]) : tipos.map(function (t) { return t.id === actual.id ? actual : t; });
    editando = false;
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarProcedimientos();
    aviso('tpFormMsg', nuevo ? 'Tipo grabado.' : 'Cambios grabados.');
  }

  $('tabTipos').addEventListener('click', function () { if (!$('tpLista').hidden) cargar(); });
  $('tpNuevo').addEventListener('click', function () { abrir(null); });
  $('tpVolver').addEventListener('click', function () { actual = null; ver('tpLista'); pintarLista(); });
  $('tpBuscar').addEventListener('input', pintarLista);
  $('tpFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-tpfiltro]'); if (b) { filtro = b.dataset.tpfiltro; pintarLista(); } });
  $('tpGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tpabrir]');
    if (b) abrir(tipos.filter(function (t) { return String(t.id) === b.dataset.tpabrir; })[0]);
  });
  $('tpEstado').addEventListener('change', pintarEstadoSelect);
  $('tpForm').addEventListener('submit', grabar);
  $('tpModificar').addEventListener('click', function () {
    if (!actual) return;
    editando = true; aplicarModo();
    aviso('tpFormMsg', 'Modo modificación: haz los cambios y pulsa «Grabar».');
    $('tpNombre').focus();
  });
  $('tpCancelar').addEventListener('click', function () {
    if (!actual) { ver('tpLista'); pintarLista(); return; }
    editando = false; rellenar(actual); aplicarModo();
    aviso('tpFormMsg', 'Se descartaron los cambios.');
  });
  $('tpEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || editando || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('tipos_procedimiento').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('tpFormMsg', traducir(r.error), true); return; }
    var nombre = actual.nombre;
    actual = null;
    await cargar();
    ver('tpLista');
    aviso('tpMsg', 'Tipo «' + nombre + '» eliminado. Sus procedimientos siguen en el catálogo, sin tipo.');
  });
  // Agregar un procedimiento sugerido al catálogo, o clasificar uno existente en este tipo
  $('tpProc').addEventListener('click', async function (e) {
    var a = e.target.closest('[data-tpagregar]'), c = e.target.closest('[data-tpclasificar]');
    if (!a && !c) return;
    var b = a || c;
    b.disabled = true;
    var r = a
      ? await sb.from('tratamientos').insert({ nombre: a.dataset.tpagregar, precio: 0, tipo_id: actual.id }).select('id,nombre,precio,activo,tipo_id').single()
      : await sb.from('tratamientos').update({ tipo_id: actual.id }).eq('id', +c.dataset.tpclasificar).select('id,nombre,precio,activo,tipo_id').single();
    if (r.error) { b.disabled = false; aviso('tpProcMsg', traducir(r.error), true); return; }
    catalogo = a ? catalogo.concat([r.data]) : catalogo.map(function (t) { return t.id === r.data.id ? r.data : t; });
    pintarProcedimientos();
    aviso('tpProcMsg', a ? '«' + r.data.nombre + '» se agregó a tu catálogo. Pon su precio en «Precios».' : '«' + r.data.nombre + '» ahora pertenece a ' + actual.nombre + '.');
  });

  // Lista de tipos para otras pantallas (catálogo de tratamientos y Precios)
  window.PD_TIPOS = async function () {
    var r = await sb.from('tipos_procedimiento').select('id,codigo,nombre,estado,orden').order('orden').order('codigo');
    return r.error ? [] : r.data;
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('tpLista').hidden) cargar(); },
    limpiar: function () { tipos = []; catalogo = []; actual = null; editando = false; $('tpGrid').innerHTML = ''; $('tpProc').innerHTML = ''; ver('tpLista'); }
  });
})();
