// Plus Dental — Tipos de quiroprácticos (Catálogos › 5 · Quiroprácticos)
// Catálogo de los tipos de quiroprácticos que ejercen en Guatemala (preparado con IA): área, formación habitual y
// casos que atienden. El área alimenta las técnicas / especialidades de cada quiropráctico. Solo personal.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admTiposQui')) return;

  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo' };
  var tipos = [], quiros = [], actual = null, editando = false, filtro = 'todos';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function pill(e) { return '<span class="estado estado-' + e + '">' + ESTADOS[e] + '</span>'; }
  function norm(t) { return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/tipos_quiropractico.*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los quiroprácticos.';
    if (/tipos_quiropractico_nombre|duplicate key/i.test(m)) return 'Ya existe un tipo con ese nombre.';
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
  // Quiroprácticos de este tipo (asignados o con su área entre sus técnicas)
  function quirosDe(t) {
    var e = norm(t.especialidad);
    return quiros.filter(function (q) { return q.tipo_id === t.id || (q.tecnicas || []).some(function (x) { return norm(x) === e; }); });
  }

  $('admTiposQui').innerHTML =
    '<div id="tqLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Tipos de quiroprácticos</h3><button type="button" id="tqNuevo" class="adm-btn adm-primary">Nuevo tipo</button></div>' +
    '<p class="dlg-msg">Tipos de quiroprácticos que ejercen en Guatemala (preparado con IA): quiropráctico general y áreas de enfoque, con la formación habitual y los casos que atienden. El área se usa en la ficha de cada quiropráctico.</p>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="tqFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['inactivo', 'Inactivos']].map(function (f) { return '<button type="button" class="adm-btn" data-tqfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="tqBuscar" type="search" class="adm-input" placeholder="Buscar tipo o caso que atiende" aria-label="Buscar tipo de quiropráctico" style="width: 100%; max-width: 320px"></div>' +
    '<div id="tqGrid" class="tp-grid"></div><p id="tqMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="tqFicha" class="adm-pane" hidden>' +
    '<button type="button" id="tqVolver" class="dlg-link">← Todos los tipos</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="tqTitulo" class="adm-h"></h3><p id="tqSub" class="dlg-msg"></p></div><span id="tqPill" class="estado" hidden></span></div>' +
    '<form id="tqForm" class="adm-pane" novalidate><fieldset id="tqCampos" class="campos pos-sec"><legend>Datos del tipo de quiropráctico</legend><div class="exp-form">' +
    '<div class="exp-campo"><span class="pos-lbl">Código (automático)</span><div id="tqCodigo" class="exp-calc">—</div></div>' +
    '<label>Estado<select id="tqEstado" class="ac-estado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></label>' +
    '<label>Nombre del tipo *<input id="tqNombre" type="text" maxlength="120" required placeholder="Ej.: Quiropráctico deportivo"></label>' +
    '<label>Organización<select id="tqOrg"><option value="">—</option></select></label><label>Localidad / Empresa<select id="tqLoc"><option value="">—</option></select></label>' +
    '<label>Área *<input id="tqEspecialidad" type="text" maxlength="120" required placeholder="Ej.: Quiropráctica deportiva"></label>' +
    '<label class="full">Descripción<textarea id="tqDesc" rows="2" maxlength="600"></textarea></label>' +
    '<label class="full">Formación habitual<textarea id="tqFormacion" rows="2" maxlength="400" placeholder="Ej.: Doctor en Quiropráctica (D.C.) con certificación en quiropráctica deportiva"></textarea></label>' +
    '<label class="full">Casos que atiende (uno por línea)<textarea id="tqAtiende" rows="5" placeholder="Ej.:&#10;Esguinces y distensiones&#10;Prevención de lesiones"></textarea></label>' +
    '</div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="tqGrabar" class="dlg-submit">Grabar</button><button type="button" id="tqModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="tqEliminar" class="adm-btn">Eliminar</button><button type="button" id="tqCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="tqFormMsg" class="dlg-msg" role="status"></p></form>' +
    '<div id="tqQuiSec" class="pos-sec"><h4 class="pr-form-t">Quiroprácticos de este tipo</h4><div id="tqQui" class="td-den"></div></div></div>';

  function ver(id) { ['tqLista', 'tqFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargar() {
    aviso('tqMsg', '');
    $('tqGrid').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await Promise.all([
      sb.from('tipos_quiropractico').select('*').order('orden').order('codigo'),
      sb.from('quiropracticos').select('id,nombre,tecnicas,estado,tipo_id').order('nombre')
    ]);
    if (r[0].error) { $('tqGrid').innerHTML = ''; aviso('tqMsg', traducir(r[0].error), true); return; }
    tipos = r[0].data; quiros = r[1].error ? [] : r[1].data;
    pintarLista();
  }

  function pintarLista() {
    document.querySelectorAll('[data-tqfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tqfiltro === filtro); });
    var bus = norm($('tqBuscar').value);
    var lista = tipos.filter(function (t) {
      if (filtro !== 'todos' && t.estado !== filtro) return false;
      return !bus || norm(t.nombre + ' ' + t.especialidad + ' ' + (t.descripcion || '') + ' ' + (t.atiende || []).join(' ')).indexOf(bus) >= 0;
    });
    $('tqGrid').innerHTML = !tipos.length ? '<p class="dlg-msg">No hay tipos todavía. Ejecuta el script de Supabase para cargar los tipos de Guatemala o pulsa «Nuevo tipo».</p>'
      : !lista.length ? '<p class="dlg-msg">No hay tipos con ese filtro.</p>'
      : lista.map(function (t) {
        var n = quirosDe(t).length;
        return '<button type="button" class="tp-card" data-tqabrir="' + t.id + '">' +
          '<span class="pa-fila"><span class="tp-cod">' + esc(t.codigo || '') + '</span>' + pill(t.estado) + '</span>' +
          '<b>' + esc(t.nombre) + '</b><span class="td-area">' + esc(t.especialidad) + '</span>' +
          (t.descripcion ? '<span class="tp-desc">' + esc(t.descripcion) + '</span>' : '') +
          '<span class="tp-chips">' + (t.atiende || []).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</span>' +
          '<small>' + (n ? n + (n === 1 ? ' quiropráctico de la clínica' : ' quiroprácticos de la clínica') : 'Ningún quiropráctico de la clínica de este tipo') + '</small></button>';
      }).join('');
  }

  // ---------- Ficha ----------
  function rellenar(t) {
    $('tqCodigo').textContent = t ? t.codigo : 'Se asigna al grabar';
    $('tqEstado').value = t ? t.estado : 'activo'; $('tqEstado').dataset.estado = $('tqEstado').value;
    $('tqNombre').value = t ? t.nombre : '';
    if (window.PD_SEDES) window.PD_SEDES.llenar($('tqOrg'), $('tqLoc'), t ? t.localidad_id : null);
    $('tqEspecialidad').value = t ? t.especialidad : '';
    $('tqDesc').value = t ? t.descripcion || '' : '';
    $('tqFormacion').value = t ? t.formacion || '' : '';
    $('tqAtiende').value = t ? (t.atiende || []).join('\n') : '';
  }
  function pintarCabecera() {
    $('tqTitulo').textContent = actual ? actual.nombre : 'Nuevo tipo de quiropráctico';
    $('tqSub').textContent = actual ? actual.codigo + ' · registrado por ' + (actual.registrado_por || '—') + ' · última modificación por ' + (actual.actualizado_por || '—') : 'Llena los datos y pulsa «Grabar».';
    $('tqPill').hidden = !actual;
    if (actual) { $('tqPill').className = 'estado estado-' + actual.estado; $('tqPill').textContent = ESTADOS[actual.estado]; }
  }
  function aplicarModo() {
    $('tqCampos').disabled = !editando;
    $('tqGrabar').disabled = !editando; $('tqCancelar').disabled = !editando;
    $('tqModificar').disabled = editando || !actual; $('tqEliminar').disabled = editando || !actual;
    if ($('tqEliminar').dataset.confirmar === '1') { $('tqEliminar').dataset.confirmar = '0'; $('tqEliminar').textContent = 'Eliminar'; $('tqEliminar').style.borderColor = ''; $('tqEliminar').style.color = ''; }
    $('tqQuiSec').hidden = !actual;
  }
  function pintarQuiros() {
    if (!actual) return;
    var lista = quirosDe(actual);
    $('tqQui').innerHTML = lista.length ? lista.map(function (q) { return '<span class="td-chip' + (q.estado === 'activo' ? '' : ' inactivo') + '">' + esc(q.nombre) + (q.estado === 'activo' ? '' : ' · ' + esc(q.estado)) + '</span>'; }).join('')
      : '<p class="dlg-msg">Ningún quiropráctico de la clínica es de este tipo. Asígnalo desde la ficha del quiropráctico.</p>';
  }
  function abrir(t) {
    actual = t || null; editando = !t;
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarQuiros();
    aviso('tqFormMsg', '');
    ver('tqFicha');
    if (editando) $('tqNombre').focus();
  }
  async function grabar(e) {
    e.preventDefault();
    if (!editando) return;
    var nombre = $('tqNombre').value.trim(), esp = $('tqEspecialidad').value.trim();
    if (!nombre) { aviso('tqFormMsg', 'Escribe el nombre del tipo.', true); $('tqNombre').focus(); return; }
    if (!esp) { aviso('tqFormMsg', 'Escribe el área.', true); $('tqEspecialidad').focus(); return; }
    var at = [];
    $('tqAtiende').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) { if (!at.some(function (x) { return norm(x) === norm(s); })) at.push(s.slice(0, 150)); });
    var datos = { nombre: nombre, especialidad: esp, descripcion: $('tqDesc').value.trim() || null, formacion: $('tqFormacion').value.trim() || null, estado: $('tqEstado').value, atiende: at };
    if (window.PD_SEDES && $('tqLoc').options.length > 1) Object.assign(datos, window.PD_SEDES.valores($('tqOrg'), $('tqLoc')));
    if (!actual) datos.orden = tipos.reduce(function (m, t) { return Math.max(m, t.orden || 0); }, 0) + 1;
    $('tqGrabar').disabled = true;
    aviso('tqFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('tipos_quiropractico').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('tipos_quiropractico').insert(datos).select('*').single();
    if (r.error) { $('tqGrabar').disabled = false; aviso('tqFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual;
    actual = r.data; editando = false;
    tipos = nuevo ? tipos.concat([actual]) : tipos.map(function (t) { return t.id === actual.id ? actual : t; });
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarQuiros(); pintarLista();
    aviso('tqFormMsg', nuevo ? 'Tipo de quiropráctico grabado.' : 'Cambios guardados.');
  }

  // ---------- Eventos ----------
  if ($('tabTiposQui')) $('tabTiposQui').addEventListener('click', function () { if (!$('tqLista').hidden) cargar(); });
  $('tqNuevo').addEventListener('click', function () { abrir(null); });
  $('tqVolver').addEventListener('click', function () { actual = null; editando = false; ver('tqLista'); pintarLista(); });
  $('tqFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-tqfiltro]'); if (b) { filtro = b.dataset.tqfiltro; pintarLista(); } });
  $('tqBuscar').addEventListener('input', pintarLista);
  $('tqGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tqabrir]');
    if (b) abrir(tipos.filter(function (t) { return t.id === +b.dataset.tqabrir; })[0]);
  });
  $('tqEstado').addEventListener('change', function () { this.dataset.estado = this.value; });
  $('tqForm').addEventListener('submit', grabar);
  $('tqModificar').addEventListener('click', function () { if (!actual) return; editando = true; aplicarModo(); aviso('tqFormMsg', 'Modo edición: haz los cambios y pulsa «Grabar».'); $('tqNombre').focus(); });
  $('tqCancelar').addEventListener('click', function () {
    if (!actual) { ver('tqLista'); return; }
    editando = false; rellenar(actual); aplicarModo(); aviso('tqFormMsg', 'Se descartaron los cambios.');
  });
  $('tqEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('tipos_quiropractico').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('tqFormMsg', traducir(r.error), true); return; }
    var nombre = actual.nombre;
    actual = null;
    await cargar();
    ver('tqLista');
    aviso('tqMsg', 'Tipo «' + nombre + '» eliminado. Las técnicas de los quiroprácticos no cambian.');
  });

  // Tipos activos para la ficha del quiropráctico
  window.PD_TIPOS_QUIRO = async function () {
    var r = await sb.from('tipos_quiropractico').select('id,codigo,nombre,especialidad,atiende,estado').order('orden');
    return r.error ? [] : r.data;
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('tqLista').hidden) cargar(); },
    limpiar: function () { tipos = []; quiros = []; actual = null; editando = false; $('tqGrid').innerHTML = ''; ver('tqLista'); }
  });
})();
