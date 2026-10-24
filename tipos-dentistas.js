// Plus Dental — Tipos de dentistas (grupo «Catálogos iniciales»)
// Catálogo de los tipos de odontólogos que ejercen en Guatemala (general y especialistas): área de especialidad,
// formación habitual y casos que atienden. El área alimenta las Especialidades de cada dentista. Solo personal.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admTiposDen')) return;

  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo' };
  var tipos = [], dentistas = [], actual = null, editando = false, filtro = 'todos';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function pill(e) { return '<span class="estado estado-' + e + '">' + ESTADOS[e] + '</span>'; }
  function norm(t) { return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/tipos_dentista.*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los tipos de dentistas.';
    if (/tipos_dentista_nombre|duplicate key/i.test(m)) return 'Ya existe un tipo con ese nombre.';
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
  // Dentistas que tienen la especialidad de este tipo
  function dentistasDe(t) {
    var e = norm(t.especialidad);
    return dentistas.filter(function (d) { return (d.especialidades || []).some(function (x) { return norm(x) === e; }); });
  }

  $('admTiposDen').innerHTML =
    '<div id="tdLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Tipos de dentistas</h3><button type="button" id="tdNuevo" class="adm-btn adm-primary">Nuevo tipo</button></div>' +
    '<p class="dlg-msg">Tipos de odontólogos que ejercen en Guatemala (preparado con IA): odontólogo general y especialistas, con la formación habitual y los casos que atienden. El área de especialidad se usa en la ficha de cada dentista y en el asistente de la agenda.</p>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="tdFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['inactivo', 'Inactivos']].map(function (f) { return '<button type="button" class="adm-btn" data-tdfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="tdBuscar" type="search" class="adm-input" placeholder="Buscar tipo o caso que atiende" aria-label="Buscar tipo de dentista" style="width: 100%; max-width: 320px"></div>' +
    '<div id="tdGrid" class="tp-grid"></div><p id="tdMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="tdFicha" class="adm-pane" hidden>' +
    '<button type="button" id="tdVolver" class="dlg-link">← Todos los tipos</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="tdTitulo" class="adm-h"></h3><p id="tdSub" class="dlg-msg"></p></div><span id="tdPill" class="estado" hidden></span></div>' +
    '<form id="tdForm" class="adm-pane" novalidate><fieldset id="tdCampos" class="campos pos-sec"><legend>Datos del tipo de dentista</legend><div class="exp-form">' +
    '<div class="exp-campo"><span class="pos-lbl">Código (automático)</span><div id="tdCodigo" class="exp-calc">—</div></div>' +
    '<label>Estado<select id="tdEstado" class="ac-estado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></label>' +
    '<label>Nombre del tipo *<input id="tdNombre" type="text" maxlength="120" required placeholder="Ej.: Endodoncista"></label>' +
    '<label>Área de especialidad *<input id="tdEspecialidad" type="text" maxlength="120" required placeholder="Ej.: Endodoncia"></label>' +
    '<label class="full">Descripción<textarea id="tdDesc" rows="2" maxlength="600"></textarea></label>' +
    '<label class="full">Formación habitual<textarea id="tdFormacion" rows="2" maxlength="400" placeholder="Ej.: Cirujano dentista con especialidad en Endodoncia (2 años)"></textarea></label>' +
    '<label class="full">Casos que atiende (uno por línea)<textarea id="tdAtiende" rows="5" placeholder="Ej.:&#10;Tratamiento de conductos&#10;Retratamientos"></textarea></label>' +
    '</div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="tdGrabar" class="dlg-submit">Grabar</button><button type="button" id="tdModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="tdEliminar" class="adm-btn">Eliminar</button><button type="button" id="tdCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="tdFormMsg" class="dlg-msg" role="status"></p></form>' +
    '<div id="tdDenSec" class="pos-sec"><h4 class="pr-form-t">Dentistas de este tipo</h4><div id="tdDen" class="td-den"></div></div></div>';

  function ver(id) { ['tdLista', 'tdFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargar() {
    aviso('tdMsg', '');
    $('tdGrid').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await Promise.all([
      sb.from('tipos_dentista').select('*').order('orden').order('codigo'),
      sb.from('dentistas').select('id,nombre,especialidades,estado').order('nombre')
    ]);
    if (r[0].error) { $('tdGrid').innerHTML = ''; aviso('tdMsg', traducir(r[0].error), true); return; }
    tipos = r[0].data; dentistas = r[1].error ? [] : r[1].data;
    pintarLista();
  }

  function pintarLista() {
    document.querySelectorAll('[data-tdfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tdfiltro === filtro); });
    var bus = norm($('tdBuscar').value);
    var lista = tipos.filter(function (t) {
      if (filtro !== 'todos' && t.estado !== filtro) return false;
      return !bus || norm(t.nombre + ' ' + t.especialidad + ' ' + (t.descripcion || '') + ' ' + (t.atiende || []).join(' ')).indexOf(bus) >= 0;
    });
    $('tdGrid').innerHTML = !tipos.length ? '<p class="dlg-msg">No hay tipos todavía. Ejecuta el script de Supabase para cargar los tipos de Guatemala o pulsa «Nuevo tipo».</p>'
      : !lista.length ? '<p class="dlg-msg">No hay tipos con ese filtro.</p>'
      : lista.map(function (t) {
        var n = dentistasDe(t).length;
        return '<button type="button" class="tp-card" data-tdabrir="' + t.id + '">' +
          '<span class="pa-fila"><span class="tp-cod">' + esc(t.codigo || '') + '</span>' + pill(t.estado) + '</span>' +
          '<b>' + esc(t.nombre) + '</b><span class="td-area">' + esc(t.especialidad) + '</span>' +
          (t.descripcion ? '<span class="tp-desc">' + esc(t.descripcion) + '</span>' : '') +
          '<span class="tp-chips">' + (t.atiende || []).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</span>' +
          '<small>' + (n ? n + (n === 1 ? ' dentista de la clínica' : ' dentistas de la clínica') : 'Ningún dentista de la clínica con esta especialidad') + '</small></button>';
      }).join('');
  }

  // ---------- Ficha ----------
  function rellenar(t) {
    $('tdCodigo').textContent = t ? t.codigo : 'Se asigna al grabar';
    $('tdEstado').value = t ? t.estado : 'activo'; $('tdEstado').dataset.estado = $('tdEstado').value;
    $('tdNombre').value = t ? t.nombre : '';
    $('tdEspecialidad').value = t ? t.especialidad : '';
    $('tdDesc').value = t ? t.descripcion || '' : '';
    $('tdFormacion').value = t ? t.formacion || '' : '';
    $('tdAtiende').value = t ? (t.atiende || []).join('\n') : '';
  }
  function pintarCabecera() {
    $('tdTitulo').textContent = actual ? actual.nombre : 'Nuevo tipo de dentista';
    $('tdSub').textContent = actual ? actual.codigo + ' · registrado por ' + (actual.registrado_por || '—') + ' · última modificación por ' + (actual.actualizado_por || '—') : 'Llena los datos y pulsa «Grabar».';
    $('tdPill').hidden = !actual;
    if (actual) { $('tdPill').className = 'estado estado-' + actual.estado; $('tdPill').textContent = ESTADOS[actual.estado]; }
  }
  function aplicarModo() {
    $('tdCampos').disabled = !editando;
    $('tdGrabar').disabled = !editando; $('tdCancelar').disabled = !editando;
    $('tdModificar').disabled = editando || !actual; $('tdEliminar').disabled = editando || !actual;
    if ($('tdEliminar').dataset.confirmar === '1') { $('tdEliminar').dataset.confirmar = '0'; $('tdEliminar').textContent = 'Eliminar'; $('tdEliminar').style.borderColor = ''; $('tdEliminar').style.color = ''; }
    $('tdDenSec').hidden = !actual;
  }
  function pintarDentistas() {
    if (!actual) return;
    var lista = dentistasDe(actual);
    $('tdDen').innerHTML = lista.length ? lista.map(function (d) { return '<span class="td-chip' + (d.estado === 'activo' ? '' : ' inactivo') + '">' + esc(d.nombre) + (d.estado === 'activo' ? '' : ' · ' + esc(d.estado)) + '</span>'; }).join('')
      : '<p class="dlg-msg">Ningún dentista de la clínica tiene «' + esc(actual.especialidad) + '» en sus especialidades. Agrégala desde la ficha del dentista.</p>';
  }
  function abrir(t) {
    actual = t || null; editando = !t;
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarDentistas();
    aviso('tdFormMsg', '');
    ver('tdFicha');
    if (editando) $('tdNombre').focus();
  }
  async function grabar(e) {
    e.preventDefault();
    if (!editando) return;
    var nombre = $('tdNombre').value.trim(), esp = $('tdEspecialidad').value.trim();
    if (!nombre) { aviso('tdFormMsg', 'Escribe el nombre del tipo.', true); $('tdNombre').focus(); return; }
    if (!esp) { aviso('tdFormMsg', 'Escribe el área de especialidad.', true); $('tdEspecialidad').focus(); return; }
    var at = [];
    $('tdAtiende').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) { if (!at.some(function (x) { return norm(x) === norm(s); })) at.push(s.slice(0, 150)); });
    var datos = { nombre: nombre, especialidad: esp, descripcion: $('tdDesc').value.trim() || null, formacion: $('tdFormacion').value.trim() || null, estado: $('tdEstado').value, atiende: at };
    if (!actual) datos.orden = tipos.reduce(function (m, t) { return Math.max(m, t.orden || 0); }, 0) + 1;
    $('tdGrabar').disabled = true;
    aviso('tdFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('tipos_dentista').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('tipos_dentista').insert(datos).select('*').single();
    if (r.error) { $('tdGrabar').disabled = false; aviso('tdFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual;
    actual = r.data; editando = false;
    tipos = nuevo ? tipos.concat([actual]) : tipos.map(function (t) { return t.id === actual.id ? actual : t; });
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarDentistas(); pintarLista();
    aviso('tdFormMsg', nuevo ? 'Tipo de dentista grabado.' : 'Cambios guardados.');
  }

  // ---------- Eventos ----------
  if ($('tabTiposDen')) $('tabTiposDen').addEventListener('click', function () { if (!$('tdLista').hidden) cargar(); });
  $('tdNuevo').addEventListener('click', function () { abrir(null); });
  $('tdVolver').addEventListener('click', function () { actual = null; editando = false; ver('tdLista'); pintarLista(); });
  $('tdFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-tdfiltro]'); if (b) { filtro = b.dataset.tdfiltro; pintarLista(); } });
  $('tdBuscar').addEventListener('input', pintarLista);
  $('tdGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tdabrir]');
    if (b) abrir(tipos.filter(function (t) { return t.id === +b.dataset.tdabrir; })[0]);
  });
  $('tdEstado').addEventListener('change', function () { this.dataset.estado = this.value; });
  $('tdForm').addEventListener('submit', grabar);
  $('tdModificar').addEventListener('click', function () { if (!actual) return; editando = true; aplicarModo(); aviso('tdFormMsg', 'Modo edición: haz los cambios y pulsa «Grabar».'); $('tdNombre').focus(); });
  $('tdCancelar').addEventListener('click', function () {
    if (!actual) { ver('tdLista'); return; }
    editando = false; rellenar(actual); aplicarModo(); aviso('tdFormMsg', 'Se descartaron los cambios.');
  });
  $('tdEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('tipos_dentista').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('tdFormMsg', traducir(r.error), true); return; }
    var nombre = actual.nombre;
    actual = null;
    await cargar();
    ver('tdLista');
    aviso('tdMsg', 'Tipo «' + nombre + '» eliminado. Las especialidades de los dentistas no cambian.');
  });

  // Áreas de especialidad activas para otras pantallas (ficha del dentista, agenda)
  window.PD_TIPOS_DENTISTA = async function () {
    var r = await sb.from('tipos_dentista').select('nombre,especialidad,atiende,estado').eq('estado', 'activo').order('orden');
    return r.error ? [] : r.data;
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('tdLista').hidden) cargar(); },
    limpiar: function () { tipos = []; dentistas = []; actual = null; editando = false; $('tdGrid').innerHTML = ''; ver('tdLista'); }
  });
})();
