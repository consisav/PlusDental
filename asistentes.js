// Plus Dental — Asistentes dentales (grupo «Catálogos iniciales»)
// Asistentes e higienistas de la clínica (tabla «personal», roles auxiliar e higienista): código automático, nombre,
// teléfono, DPI, dirección, fecha de inicio, fotografía y funciones. Son los que se asignan a cada dentista.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admAsistentes')) return;

  var BUCKET = 'expedientes';
  var ROLES = { auxiliar: 'Asistente dental', higienista: 'Higienista dental' };
  // Funciones habituales de un asistente dental en Guatemala (sugerencias que se agregan con un toque)
  var FUNCIONES = ['Recibir a los pacientes y confirmar citas', 'Preparar la unidad dental y el instrumental', 'Asistir al odontólogo en el sillón (trabajo a cuatro manos)',
    'Lavar, empacar y esterilizar el instrumental', 'Desinfectar la unidad entre pacientes', 'Preparar y mezclar materiales dentales', 'Tomar y revelar radiografías (si está capacitado)',
    'Actualizar expedientes y odontogramas', 'Explicar cuidados e higiene oral al paciente', 'Llevar el inventario de materiales', 'Registrar cobros y pagos', 'Limpieza dental (higienista)'];

  var lista = [], dentistas = [], actual = null, editando = false, filtro = 'activo', fotos = {};

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iniciales(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join(''); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) { return f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function antiguedad(f) {
    if (!f) return '';
    var a = new Date(f + 'T12:00:00'), h = new Date(), m = (h.getFullYear() - a.getFullYear()) * 12 + h.getMonth() - a.getMonth() - (h.getDate() < a.getDate() ? 1 : 0);
    if (m < 0) return 'Inicia el ' + fechaCorta(f);
    var y = Math.floor(m / 12); m = m % 12;
    return (y ? y + (y === 1 ? ' año' : ' años') : '') + (y && m ? ' y ' : '') + (m || !y ? m + (m === 1 ? ' mes' : ' meses') : '');
  }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/codigo|dpi|direccion|fecha_inicio|funciones|foto/.test(m) && /column|does not exist|schema cache/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los asistentes dentales.';
    if (/personal_codigo|duplicate key/i.test(m)) return 'Ya existe un asistente con ese código.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function asignadoA(a) { return dentistas.filter(function (d) { return d.asistente_id === a.id; }); }

  $('admAsistentes').innerHTML =
    '<div id="asLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Asistentes dentales</h3><button type="button" id="asNuevo" class="adm-btn adm-primary">Nuevo asistente</button></div>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="asFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['activo', 'Activos'], ['inactivo', 'Inactivos'], ['todos', 'Todos']].map(function (f) { return '<button type="button" class="adm-btn" data-asfiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'activo') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="asBuscar" type="search" class="adm-input" placeholder="Buscar por nombre, código, DPI o teléfono" aria-label="Buscar asistente" style="width: 100%; max-width: 360px"></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Asistente</th><th>Código</th><th>Tipo</th><th>Teléfono</th><th>Desde</th><th>Asignado a</th><th>Estado</th><th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="asBody"></tbody></table></div>' +
    '<p id="asMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="asFicha" class="adm-pane" hidden>' +
    '<button type="button" id="asVolver" class="dlg-link">← Todos los asistentes</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="asTitulo" class="adm-h"></h3><p id="asSub" class="dlg-msg"></p></div><span id="asPill" class="estado" hidden></span></div>' +
    '<div class="as-foto"><div id="asFotoVista" class="avatar grande" aria-hidden="true"></div><div><span class="pos-lbl">Fotografía</span><div><button type="button" id="asFotoBtn" class="adm-btn">Subir foto</button></div><input id="asFotoArchivo" type="file" accept="image/jpeg,image/png,image/webp" hidden><p id="asFotoMsg" class="dlg-msg" role="status"></p></div></div>' +
    '<p id="asReg" class="as-reg"></p>' +
    '<form id="asForm" class="adm-pane" novalidate><fieldset id="asCampos" class="campos pos-sec"><legend>Datos del asistente</legend><div class="exp-form">' +
    '<div class="exp-campo"><span class="pos-lbl">Código de asistente</span><div id="asCodigo" class="exp-calc">—</div></div>' +
    '<label>Nombre del asistente *<input id="asNombre" type="text" maxlength="150" required></label>' +
    '<label>Teléfono / WhatsApp<input id="asTelefono" type="tel" maxlength="40"></label>' +
    '<label>DPI<input id="asDpi" type="text" maxlength="20" inputmode="numeric" placeholder="13 dígitos"></label>' +
    '<label class="full">Dirección<input id="asDireccion" type="text" maxlength="250"></label>' +
    '<label>Fecha de inicio<input id="asInicio" type="date"></label>' +
    '<div class="exp-campo"><span class="pos-lbl">Antigüedad</span><div id="asAntig" class="exp-calc">—</div></div>' +
    '<label>Tipo<select id="asRol"><option value="auxiliar">Asistente dental</option><option value="higienista">Higienista dental</option></select></label>' +
    '<label>Estado<select id="asEstado" class="ac-estado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></label>' +
    '<label>Organización<select id="asOrg"><option value="">—</option></select></label><label>Localidad / Empresa<select id="asLoc"><option value="">—</option></select></label>' +
    '<div class="full as-fun"><span class="pos-lbl">Funciones</span><textarea id="asFunciones" rows="5" placeholder="Una función por línea"></textarea>' +
    '<div class="as-sug"><small>Toca para agregar:</small><span id="asSug"></span></div></div>' +
    '</div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="asGrabar" class="dlg-submit">Grabar</button><button type="button" id="asModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="asCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="asFormMsg" class="dlg-msg" role="status"></p></form></div>';

  function ver(id) { ['asLista', 'asFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargar() {
    aviso('asMsg', '');
    $('asBody').innerHTML = '<tr><td colspan="8">Cargando…</td></tr>';
    var r = await Promise.all([
      sb.from('personal').select('*').in('rol', ['auxiliar', 'higienista']).order('nombre'),
      sb.from('dentistas').select('id,nombre,asistente_id').order('nombre')
    ]);
    if (r[0].error) { $('asBody').innerHTML = ''; aviso('asMsg', traducir(r[0].error), true); return; }
    lista = r[0].data; dentistas = r[1].error ? [] : r[1].data;
    if (lista.length && !('codigo' in lista[0])) aviso('asMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los asistentes dentales.', true);
    pintarLista();
    var rutas = lista.filter(function (a) { return a.foto; }).map(function (a) { return a.foto; });
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) { fotos = {}; u.data.forEach(function (x, i) { if (x.signedUrl) fotos[rutas[i]] = x.signedUrl; }); pintarLista(); }
    }
  }
  function avatar(a, grande) {
    var url = a && a.foto && fotos[a.foto];
    return url ? '<img src="' + esc(url) + '" alt="">' : esc(iniciales(a ? a.nombre : '?'));
  }
  function pintarLista() {
    document.querySelectorAll('[data-asfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.asfiltro === filtro); });
    var q = norm($('asBuscar').value.trim());
    var vis = lista.filter(function (a) {
      if (filtro === 'activo' && !a.activo) return false;
      if (filtro === 'inactivo' && a.activo) return false;
      return !q || [a.nombre, a.codigo, a.dpi, a.telefono].some(function (v) { return norm(v).indexOf(q) >= 0; });
    });
    $('asBody').innerHTML = !vis.length ? '<tr><td colspan="8">' + (lista.length ? 'No hay asistentes con este filtro.' : 'Aún no hay asistentes. Pulsa «Nuevo asistente».') + '</td></tr>'
      : vis.map(function (a) {
        var den = asignadoA(a);
        return '<tr><td><div class="pac-nombre"><span class="avatar">' + avatar(a) + '</span><b>' + esc(a.nombre) + '</b></div></td>' +
          '<td>' + esc(a.codigo || '—') + '</td><td>' + esc(ROLES[a.rol] || a.rol) + '</td><td>' + esc(a.telefono || '—') + '</td>' +
          '<td>' + fechaCorta(a.fecha_inicio) + '</td><td>' + (den.length ? esc(den.map(function (d) { return d.nombre; }).join(', ')) : '<span class="hi-desc">Sin asignar</span>') + '</td>' +
          '<td><span class="estado estado-' + (a.activo ? 'activo' : 'inactivo') + '">' + (a.activo ? 'Activo' : 'Inactivo') + '</span></td>' +
          '<td><button type="button" class="adm-btn" data-asabrir="' + a.id + '">Abrir</button></td></tr>';
      }).join('');
  }

  // ---------- Ficha ----------
  function rellenar(a) {
    $('asCodigo').textContent = a ? a.codigo || '—' : 'Se asigna al grabar';
    $('asNombre').value = a ? a.nombre : '';
    $('asTelefono').value = a ? a.telefono || '' : '';
    $('asDpi').value = a ? a.dpi || '' : '';
    $('asDireccion').value = a ? a.direccion || '' : '';
    $('asInicio').value = a ? a.fecha_inicio || '' : hoy();
    $('asRol').value = a ? a.rol : 'auxiliar';
    $('asEstado').value = !a || a.activo ? 'activo' : 'inactivo'; $('asEstado').dataset.estado = $('asEstado').value;
    if (window.PD_SEDES) window.PD_SEDES.llenar($('asOrg'), $('asLoc'), a ? a.localidad_id : null);
    $('asFunciones').value = a ? (a.funciones || []).join('\n') : '';
    pintarAntig(); pintarSug();
  }
  function pintarAntig() { $('asAntig').textContent = antiguedad($('asInicio').value) || '—'; }
  function pintarSug() {
    var ya = $('asFunciones').value.split(/\r?\n/).map(norm);
    $('asSug').innerHTML = FUNCIONES.filter(function (f) { return ya.indexOf(norm(f)) < 0; }).map(function (f) { return '<button type="button" class="as-chip" data-asfun="' + esc(f) + '">+ ' + esc(f) + '</button>'; }).join('');
  }
  function pintarCabecera() {
    $('asTitulo').textContent = actual ? actual.nombre : 'Nuevo asistente dental';
    var den = actual ? asignadoA(actual) : [];
    $('asSub').textContent = actual ? [actual.codigo, ROLES[actual.rol], den.length ? 'Asiste a ' + den.map(function (d) { return d.nombre; }).join(', ') : 'Sin odontólogo asignado'].filter(Boolean).join(' · ') : 'Llena los datos y pulsa «Grabar». Después podrás agregar la fotografía.';
    $('asPill').hidden = !actual;
    if (actual) { $('asPill').className = 'estado estado-' + (actual.activo ? 'activo' : 'inactivo'); $('asPill').textContent = actual.activo ? 'Activo' : 'Inactivo'; }
    $('asReg').innerHTML = actual ? 'Registrado <b>' + fechaHora(actual.creado) + '</b> por <b>' + esc(actual.registrado_por || '—') + '</b>' + (actual.actualizado ? ' · Última modificación <b>' + fechaHora(actual.actualizado) + '</b> por <b>' + esc(actual.actualizado_por || '—') + '</b>' : '') : '';
    $('asReg').hidden = !actual;
  }
  function aplicarModo() {
    $('asCampos').disabled = !editando;
    $('asGrabar').disabled = !editando; $('asCancelar').disabled = !editando;
    $('asModificar').disabled = editando || !actual;
  }
  async function pintarFoto() {
    $('asFotoBtn').disabled = !actual;
    $('asFotoBtn').textContent = actual && actual.foto ? 'Cambiar foto' : 'Subir foto';
    aviso('asFotoMsg', actual ? '' : 'Podrás agregar la foto después de grabar.');
    $('asFotoVista').innerHTML = esc(iniciales(actual ? actual.nombre : '?'));
    if (!actual || !actual.foto) return;
    var u = await sb.storage.from(BUCKET).createSignedUrl(actual.foto, 3600);
    if (!u.error && actual && actual.foto) $('asFotoVista').innerHTML = '<img src="' + esc(u.data.signedUrl) + '&t=' + Date.now() + '" alt="Foto de ' + esc(actual.nombre) + '">';
  }
  function abrir(a) {
    actual = a || null; editando = !a;
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarFoto();
    aviso('asFormMsg', '');
    ver('asFicha');
    if (editando) $('asNombre').focus();
  }
  async function grabar(e) {
    e.preventDefault();
    if (!editando) return;
    var nombre = $('asNombre').value.trim(), dpi = $('asDpi').value.replace(/\s+/g, '');
    if (!nombre) { aviso('asFormMsg', 'Escribe el nombre del asistente.', true); $('asNombre').focus(); return; }
    if (dpi && !/^\d{13}$/.test(dpi)) { aviso('asFormMsg', 'El DPI debe tener 13 dígitos.', true); $('asDpi').focus(); return; }
    var fun = [];
    $('asFunciones').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) { if (!fun.some(function (x) { return norm(x) === norm(s); })) fun.push(s.slice(0, 200)); });
    var datos = { nombre: nombre, telefono: $('asTelefono').value.trim() || null, dpi: dpi || null, direccion: $('asDireccion').value.trim() || null,
      fecha_inicio: $('asInicio').value || null, rol: $('asRol').value, activo: $('asEstado').value === 'activo', funciones: fun };
    if (window.PD_SEDES && $('asLoc').options.length > 1) Object.assign(datos, window.PD_SEDES.valores($('asOrg'), $('asLoc')));
    $('asGrabar').disabled = true;
    aviso('asFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('personal').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('personal').insert(datos).select('*').single();
    if (r.error) { $('asGrabar').disabled = false; aviso('asFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual;
    actual = r.data; editando = false;
    lista = nuevo ? lista.concat([actual]) : lista.map(function (a) { return a.id === actual.id ? actual : a; });
    rellenar(actual); pintarCabecera(); aplicarModo(); pintarFoto(); pintarLista();
    aviso('asFormMsg', nuevo ? 'Asistente grabado (' + (actual.codigo || '') + '). Ya puedes agregar su fotografía y asignarlo a un dentista.' : 'Cambios guardados.');
  }
  function reducirImagen(archivo) {
    return new Promise(function (ok, falla) {
      var img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = function () {
        var escala = Math.min(1, 600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : falla(new Error('No se pudo procesar la imagen.')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); falla(new Error('El archivo no es una imagen válida.')); };
      img.src = url;
    });
  }
  async function subirFoto(archivo) {
    if (!archivo || !actual) return;
    $('asFotoBtn').disabled = true;
    aviso('asFotoMsg', 'Subiendo foto…');
    try {
      var blob = await reducirImagen(archivo), ruta = 'fotos/asistente-' + actual.id + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      if (actual.foto !== ruta) {
        var r = await sb.from('personal').update({ foto: ruta }).eq('id', actual.id).select('*').single();
        if (r.error) throw r.error;
        actual = r.data;
        lista = lista.map(function (a) { return a.id === actual.id ? actual : a; });
      }
      var u = await sb.storage.from(BUCKET).createSignedUrl(ruta, 3600);
      if (!u.error) fotos[ruta] = u.data.signedUrl + '&t=' + Date.now();
      aviso('asFotoMsg', 'Foto guardada.');
      pintarFoto(); pintarLista();
    } catch (e) {
      aviso('asFotoMsg', /válida|procesar/.test(e.message || '') ? e.message : traducir(e), true);
    } finally { $('asFotoBtn').disabled = !actual; }
  }

  // ---------- Eventos ----------
  if ($('tabAsistentes')) $('tabAsistentes').addEventListener('click', function () { if (!$('asLista').hidden) cargar(); });
  $('asNuevo').addEventListener('click', function () { abrir(null); });
  $('asVolver').addEventListener('click', function () { actual = null; editando = false; ver('asLista'); pintarLista(); });
  $('asFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-asfiltro]'); if (b) { filtro = b.dataset.asfiltro; pintarLista(); } });
  $('asBuscar').addEventListener('input', pintarLista);
  $('asBody').addEventListener('click', function (e) { var b = e.target.closest('[data-asabrir]'); if (b) abrir(lista.filter(function (a) { return a.id === +b.dataset.asabrir; })[0]); });
  $('asForm').addEventListener('submit', grabar);
  $('asInicio').addEventListener('input', pintarAntig);
  $('asEstado').addEventListener('change', function () { this.dataset.estado = this.value; });
  $('asFunciones').addEventListener('input', pintarSug);
  $('asSug').addEventListener('click', function (e) {
    var b = e.target.closest('[data-asfun]');
    if (!b || $('asCampos').disabled) return;
    var v = $('asFunciones').value.replace(/\s+$/, '');
    $('asFunciones').value = (v ? v + '\n' : '') + b.dataset.asfun;
    pintarSug();
  });
  $('asModificar').addEventListener('click', function () { if (!actual) return; editando = true; aplicarModo(); aviso('asFormMsg', 'Modo edición: haz los cambios y pulsa «Grabar».'); $('asNombre').focus(); });
  $('asCancelar').addEventListener('click', function () {
    if (!actual) { ver('asLista'); return; }
    editando = false; rellenar(actual); aplicarModo(); aviso('asFormMsg', 'Se descartaron los cambios.');
  });
  $('asFotoBtn').addEventListener('click', function () { $('asFotoArchivo').click(); });
  $('asFotoArchivo').addEventListener('change', function () { var f = this.files[0]; this.value = ''; subirFoto(f); });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('asLista').hidden) cargar(); },
    limpiar: function () { lista = []; dentistas = []; actual = null; editando = false; fotos = {}; $('asBody').innerHTML = ''; ver('asLista'); }
  });
})();
