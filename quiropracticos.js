// Plus Dental — Quiroprácticos (Catálogos › 5 · Quiroprácticos)
// Mismo diseño que Odontólogos: datos, sede (organización y localidad, obligatorias), tipo, trayectoria, técnicas,
// estancia en la clínica, horario, foto y títulos. Solo personal; cada usuario ve los de su sede (supabase.sql).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admQuiropracticos')) return;

  var BUCKET = 'expedientes';
  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo', baja: 'Baja' };
  var DIAS = [['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo']];
  var HORARIO_BASE = { 1: { abre: '07:00', cierra: '19:00' }, 2: { abre: '07:00', cierra: '19:00' }, 3: { abre: '07:00', cierra: '19:00' }, 4: { abre: '07:00', cierra: '19:00' }, 5: { abre: '07:00', cierra: '19:00' } };
  // Técnicas y áreas quiroprácticas (lista preparada para Guatemala) con palabras con las que se suelen buscar
  var TECNICAS = [
    ['Quiropráctica general', 'general espalda columna ajuste'],
    ['Técnica Diversificada', 'diversified manual ajuste'],
    ['Técnica Gonstead', 'gonstead estructural'],
    ['Técnica Thompson (drop table)', 'thompson camilla drop'],
    ['Activator (instrumental)', 'activator instrumento baja fuerza'],
    ['Flexión-distracción (Cox)', 'cox disco hernia lumbar'],
    ['Técnica Webster', 'webster embarazo prenatal'],
    ['Técnica sacro-occipital (SOT)', 'sot craneal sacro'],
    ['Chiropractic BioPhysics (CBP)', 'cbp postura curva estructural'],
    ['Cervical superior (NUCCA / Atlas)', 'nucca atlas toggle cervical cefalea'],
    ['Quiropráctica deportiva', 'deporte deportistas lesiones'],
    ['Quiropráctica pediátrica', 'ninos bebes pediatria infantil'],
    ['Quiropráctica geriátrica', 'adultos mayores tercera edad'],
    ['Trastornos de ATM', 'atm mandibula bruxismo temporomandibular'],
    ['Terapia de tejidos blandos', 'masaje miofascial graston tejido'],
    ['Puntos gatillo', 'trigger contractura'],
    ['Vendaje neuromuscular (kinesiotaping)', 'kinesio taping vendaje'],
    ['Rehabilitación y ejercicio terapéutico', 'rehabilitacion ejercicio core'],
    ['Ergonomía y salud ocupacional', 'ergonomia oficina trabajo empresas'],
    ['Análisis radiográfico de columna', 'rayos x radiografia']
  ];

  var quiros = [], tipos = [], titulos = [], actual = null, editando = false, filtro = 'activo';
  var tecnicas = [], sugerencias = [], marcada = -1, fotos = {};

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function iniciales(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join(''); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function aniosMeses(f) {
    if (!f) return null;
    var p = f.split('-'), ini = new Date(+p[0], p[1] - 1, +p[2]), h = new Date();
    if (ini > h) return 'La fecha es futura';
    var meses = (h.getFullYear() - ini.getFullYear()) * 12 + (h.getMonth() - ini.getMonth());
    if (h.getDate() < ini.getDate()) meses--;
    var a = Math.floor(meses / 12), m = meses % 12;
    if (!a && !m) return 'Menos de un mes';
    return [a ? plural(a, 'año', 'años') : '', m ? plural(m, 'mes', 'meses') : ''].filter(Boolean).join(' y ');
  }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/(quiropracticos|quiropractico_titulos).*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los quiroprácticos.';
    if (/quiropracticos_codigo_unico|duplicate key/i.test(m)) return 'Ya existe un quiropráctico con ese código.';
    if (/quiropracticos_fechas/i.test(m)) return 'La fecha final en la clínica no puede ser anterior a la de inicio.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción (revisa que la localidad sea de tu sede).';
    if (/exceeded the maximum allowed size|too large/i.test(m)) return 'El archivo pesa más de 10 MB.';
    if (/mime type/i.test(m)) return 'Solo se aceptan PDF o imágenes JPG, PNG o WEBP.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent; b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.isConnected && b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  $('admQuiropracticos').innerHTML =
    // Lista
    '<div id="quLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Quiroprácticos</h3><button type="button" id="quNuevo" class="adm-btn adm-primary">Nuevo quiropráctico</button></div>' +
    '<div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center">' +
    '<div id="quFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['activo', 'Activos'], ['inactivo', 'Inactivos'], ['baja', 'Baja'], ['todos', 'Todos']].map(function (f) { return '<button type="button" class="adm-btn" data-qufiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'activo') + '">' + f[1] + '</button>'; }).join('') +
    '</div><input id="quBuscar" type="search" class="adm-input" placeholder="Buscar por nombre, código, tipo o técnica" aria-label="Buscar quiropráctico" style="width: 100%; max-width: 360px"></div>' +
    '<div class="roles-wrap"><table><thead><tr><th>Quiropráctico</th><th>Código</th><th>Tipo</th><th>Técnicas</th><th>Organización / Localidad</th><th>Experiencia</th><th>Estado</th><th><span class="sr-only">Abrir</span></th></tr></thead><tbody id="quBody"></tbody></table></div>' +
    '<p id="quMsg" class="dlg-msg" role="status"></p></div>' +
    // Ficha
    '<div id="quFicha" class="adm-pane" hidden>' +
    '<button type="button" id="quVolver" class="dlg-link">← Todos los quiroprácticos</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="quTitulo" class="adm-h"></h3><p id="quSub" class="dlg-msg"></p></div><span id="quEstadoPill" class="estado" hidden></span></div>' +
    '<form id="quForm" class="adm-pane">' +
    '<div class="pac-foto"><div id="quFotoVista" class="avatar grande" aria-hidden="true"></div>' +
    '<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0"><span style="font-size: 14px; font-weight: 600">Fotografía</span>' +
    '<div><button type="button" id="quFotoBtn" class="adm-btn">Subir foto</button></div><input id="quFotoArchivo" type="file" accept="image/jpeg,image/png,image/webp" hidden><p id="quFotoMsg" class="dlg-msg" role="status"></p></div></div>' +
    '<div id="quMeta" class="pac-meta" hidden></div>' +
    '<fieldset id="quCampos" class="campos adm-pane">' +
    '<fieldset class="pos-sec"><legend>Datos personales</legend><div class="exp-form">' +
    '<label>Código *<input id="quCodigo" type="text" maxlength="20" required placeholder="QUI-001"></label>' +
    '<label>Nombre completo *<input id="quNombre" type="text" maxlength="150" required></label>' +
    '<label>Teléfono / WhatsApp<input id="quTelefono" type="tel" maxlength="40"></label>' +
    '<label>Correo electrónico<input id="quCorreo" type="email" maxlength="120"></label>' +
    '<label>Registro profesional (opcional)<input id="quRegistro" type="text" maxlength="40" placeholder="Número de registro o licencia D.C."></label>' +
    '<label>Tipo de quiropráctico<select id="quTipo"><option value="">Sin asignar</option></select></label>' +
    '<label>Organización *<select id="quOrg"><option value="">—</option></select></label>' +
    '<label>Localidad / Empresa *<select id="quLoc"><option value="">—</option></select></label>' +
    '<label class="full">Dirección<input id="quDireccion" type="text" maxlength="250"></label>' +
    '</div></fieldset>' +
    '<fieldset class="pos-sec"><legend>Trayectoria y técnicas</legend><div class="exp-form">' +
    '<label>Inicio como quiropráctico<input id="quInicioProf" type="date"></label>' +
    '<div class="exp-campo"><span class="pos-lbl">Años de ejercicio</span><div id="quExperiencia" class="exp-calc">—</div></div>' +
    '<div class="full exp-campo"><span class="pos-lbl" id="quTecLbl">Técnicas y áreas de atención</span><div id="quTecChips" class="esp-chips"></div>' +
    '<div class="esp-buscador"><input id="quTecInput" type="text" maxlength="80" autocomplete="off" placeholder="Escribe para buscar: deporte, ATM, Gonstead, embarazo…" aria-labelledby="quTecLbl" aria-controls="quTecLista" aria-expanded="false" role="combobox">' +
    '<ul id="quTecLista" class="esp-lista" role="listbox" hidden></ul></div></div>' +
    '</div></fieldset>' +
    '<fieldset class="pos-sec"><legend>En la clínica</legend><div class="exp-form">' +
    '<label>Fecha de inicio en la clínica<input id="quIngreso" type="date" required></label>' +
    '<label>Fecha final en la clínica (déjala vacía si sigue trabajando)<input id="quSalida" type="date"></label>' +
    '<label>Estado<select id="quEstado"><option value="activo">Activo</option><option value="inactivo">Inactivo</option><option value="baja">Baja</option></select></label>' +
    '<label>Frecuencia de atención<select id="quFrecuencia" title="Cada cuántos minutos se agendan sus pacientes."><option value="">Automática (cada 30 minutos)</option><option value="10">Cada 10 minutos</option><option value="15">Cada 15 minutos</option><option value="20">Cada 20 minutos</option><option value="30">Cada 30 minutos</option><option value="40">Cada 40 minutos</option><option value="45">Cada 45 minutos</option><option value="60">Cada 1 hora</option><option value="90">Cada 1 hora 30 minutos</option><option value="120">Cada 2 horas</option></select></label>' +
    '</div></fieldset>' +
    '<fieldset class="pos-sec"><legend>Días y horas de atención a pacientes</legend><div id="quHorario" class="pos-horario"></div></fieldset>' +
    '<div class="exp-form"><label class="full">Notas<textarea id="quNotas" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label></div>' +
    '</fieldset>' +
    '<div class="exp-actions"><button type="button" class="adm-btn adm-primary" data-qu-accion="editar">Modificar registro</button><button type="submit" class="dlg-submit" data-qu-accion="guardar">Guardar</button><button type="button" class="adm-btn" data-qu-accion="cancelar">Cancelar</button></div>' +
    '<p id="quFormMsg" class="dlg-msg" role="status"></p></form>' +
    // Títulos
    '<div id="quTitulosSec" class="adm-pane" hidden><h3 style="margin: 0; font-size: 19px; font-weight: 700">Títulos y certificaciones</h3>' +
    '<form id="quTitForm" class="adm-box"><div class="exp-form">' +
    '<label>Título *<input id="quTitNombre" type="text" maxlength="200" required placeholder="Ej.: Doctor en Quiropráctica (D.C.)"></label>' +
    '<label>Institución<input id="quTitInst" type="text" maxlength="150" placeholder="Universidad o entidad certificadora"></label>' +
    '<label>Año<input id="quTitAnio" type="number" min="1950" max="2100" step="1"></label>' +
    '<label>Archivo escaneado (PDF o imagen, opcional)<input id="quTitArchivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></label>' +
    '<div class="full exp-actions"><button type="submit" class="dlg-submit">Agregar título</button><p id="quTitMsg" class="dlg-msg" role="status"></p></div>' +
    '</div></form>' +
    '<div class="roles-wrap"><table><thead><tr><th>Título</th><th>Institución</th><th>Año</th><th>Archivo</th><th>Registrado por</th><th><span class="sr-only">Borrar</span></th></tr></thead><tbody id="quTitBody"></tbody></table></div></div>' +
    '</div>';

  function ver(id) { ['quLista', 'quFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  // ---------- Lista ----------
  async function cargar() {
    aviso('quMsg', '');
    $('quBody').innerHTML = '<tr><td colspan="8">Cargando…</td></tr>';
    var r = await sb.from('quiropracticos').select('*').order('nombre');
    if (r.error) { $('quBody').innerHTML = ''; aviso('quMsg', traducir(r.error), true); return; }
    quiros = r.data;
    tipos = window.PD_TIPOS_QUIRO ? await window.PD_TIPOS_QUIRO() : [];
    tipos.filter(function (t) { return t.estado === 'activo'; }).forEach(function (t) {
      if (!TECNICAS.some(function (e) { return sinTildes(e[0]) === sinTildes(t.especialidad); }))
        TECNICAS.push([t.especialidad, sinTildes(t.nombre + ' ' + (t.atiende || []).join(' '))]);
    });
    if (window.PD_SEDES) await window.PD_SEDES.cargar();
    pintarLista();
    var rutas = quiros.filter(function (q) { return q.foto; }).map(function (q) { return q.foto; });
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) { fotos = {}; u.data.forEach(function (x, i) { if (x.signedUrl) fotos[rutas[i]] = x.signedUrl; }); pintarLista(); }
    }
  }
  function nombreTipo(id) { var t = tipos.filter(function (x) { return x.id === id; })[0]; return t ? t.nombre : '—'; }
  function sede(q) { return window.PD_SEDES && q.localidad_id ? window.PD_SEDES.texto(q.localidad_id) || '—' : '—'; }

  function pintarLista() {
    document.querySelectorAll('#quFiltros [data-qufiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.qufiltro === filtro); });
    var q = sinTildes($('quBuscar').value.trim());
    var lista = quiros.filter(function (x) {
      return (filtro === 'todos' || x.estado === filtro) &&
        (!q || [x.nombre, x.codigo, nombreTipo(x.tipo_id), (x.tecnicas || []).join(' ')].some(function (v) { return sinTildes(v).indexOf(q) >= 0; }));
    });
    if (!lista.length) {
      $('quBody').innerHTML = '<tr><td colspan="8">' + (q ? 'Ningún quiropráctico coincide.' : quiros.length ? 'No hay quiroprácticos con este estado.' : 'Todavía no hay quiroprácticos registrados. Agrega el primero con «Nuevo quiropráctico».') + '</td></tr>';
      return;
    }
    $('quBody').innerHTML = lista.map(function (x) {
      var url = fotos[x.foto];
      return '<tr><td><div class="pac-nombre"><span class="avatar">' + (url ? '<img src="' + esc(url) + '" alt="">' : esc(iniciales(x.nombre))) + '</span><strong>' + esc(x.nombre) + '</strong></div></td>' +
        '<td class="fecha">' + esc(x.codigo) + '</td><td>' + esc(x.tipo_id ? nombreTipo(x.tipo_id) : '—') + '</td>' +
        '<td>' + esc((x.tecnicas || []).join(', ') || '—') + '</td><td>' + esc(sede(x)) + '</td>' +
        '<td class="fecha">' + esc(aniosMeses(x.inicio_profesion) || '—') + '</td>' +
        '<td><span class="estado estado-' + x.estado + '">' + ESTADOS[x.estado] + '</span></td>' +
        '<td><button type="button" class="adm-btn" data-abrir-qu="' + x.id + '">Abrir</button></td></tr>';
    }).join('');
  }

  // ---------- Ficha ----------
  function siguienteCodigo() {
    var max = 0;
    quiros.forEach(function (x) { var m = /^QUI-(\d+)$/i.exec(x.codigo || ''); if (m) max = Math.max(max, +m[1]); });
    return 'QUI-' + ('00' + (max + 1)).slice(-3);
  }
  function opcionesTipo(sel) {
    $('quTipo').innerHTML = '<option value="">Sin asignar</option>' + tipos.filter(function (t) { return t.estado === 'activo' || t.id === sel; }).map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.nombre) + '</option>';
    }).join('');
  }
  function pintarHorario(h) {
    $('quHorario').innerHTML = DIAS.map(function (d) {
      var x = h[d[0]];
      return '<div class="pos-dia" data-dia="' + d[0] + '"><label class="nom"><input type="checkbox" data-abierto' + (x ? ' checked' : '') + '>' + d[1].slice(0, 3) + '</label>' +
        '<input type="time" data-abre value="' + (x ? x.abre : '07:00') + '" aria-label="' + d[1] + ': desde"' + (x ? '' : ' disabled') + '>' +
        '<span aria-hidden="true">–</span><input type="time" data-cierra value="' + (x ? x.cierra : '19:00') + '" aria-label="' + d[1] + ': hasta"' + (x ? '' : ' disabled') + '></div>';
    }).join('');
  }
  function leerHorario() {
    var h = {};
    $('quHorario').querySelectorAll('[data-dia]').forEach(function (f) {
      if (f.querySelector('[data-abierto]').checked) h[f.dataset.dia] = { abre: f.querySelector('[data-abre]').value, cierra: f.querySelector('[data-cierra]').value };
    });
    return h;
  }
  function pintarExperiencia() { $('quExperiencia').textContent = aniosMeses($('quInicioProf').value) || '—'; }

  function rellenar(x) {
    $('quCodigo').value = x ? x.codigo : siguienteCodigo();
    $('quNombre').value = (x && x.nombre) || '';
    $('quTelefono').value = (x && x.telefono) || '';
    $('quCorreo').value = (x && x.correo) || '';
    $('quRegistro').value = (x && x.registro) || '';
    $('quDireccion').value = (x && x.direccion) || '';
    opcionesTipo(x ? x.tipo_id || null : null);
    if (window.PD_SEDES) window.PD_SEDES.llenar($('quOrg'), $('quLoc'), x ? x.localidad_id : null);
    $('quInicioProf').value = (x && x.inicio_profesion) || '';
    $('quIngreso').value = x ? x.fecha_ingreso : hoy();
    $('quSalida').value = (x && x.fecha_salida) || '';
    $('quEstado').value = (x && x.estado) || 'activo';
    $('quFrecuencia').value = x && x.frecuencia ? String(x.frecuencia) : '';
    $('quNotas').value = (x && x.notas) || '';
    tecnicas = x ? (x.tecnicas || []).slice() : [];
    pintarChips();
    pintarHorario(x ? (x.horario || {}) : HORARIO_BASE);
    pintarExperiencia();
  }
  function pintarCabecera() {
    $('quTitulo').textContent = actual ? actual.nombre : 'Nuevo quiropráctico';
    $('quSub').textContent = actual
      ? [actual.codigo, actual.tipo_id ? nombreTipo(actual.tipo_id) : '', sede(actual), actual.frecuencia ? 'Citas cada ' + actual.frecuencia + ' min' : '', actual.registro ? 'Registro ' + actual.registro : ''].filter(function (v) { return v && v !== '—'; }).join(' · ')
      : 'Llena los datos y guarda. Después podrás agregar la foto y los títulos.';
    $('quEstadoPill').hidden = !actual;
    if (actual) { $('quEstadoPill').className = 'estado estado-' + actual.estado; $('quEstadoPill').textContent = ESTADOS[actual.estado]; }
    $('quMeta').hidden = !actual;
    if (actual) {
      $('quMeta').innerHTML = '<span>Registrado <b>' + fechaHora(actual.creado) + '</b> por <b>' + esc(actual.registrado_por || '—') + '</b></span>' +
        '<span>Última modificación <b>' + fechaHora(actual.actualizado) + '</b>' + (actual.actualizado_por ? ' por <b>' + esc(actual.actualizado_por) + '</b>' : '') + '</span>' +
        '<span>En la clínica desde <b>' + fechaCorta(actual.fecha_ingreso) + '</b>' + (actual.fecha_salida ? ' hasta <b>' + fechaCorta(actual.fecha_salida) + '</b>' : '') + '</span>';
    }
    $('quTitulosSec').hidden = !actual;
  }
  function aplicarModo() {
    $('quCampos').disabled = !editando;
    document.querySelectorAll('[data-qu-accion]').forEach(function (b) {
      b.hidden = b.dataset.quAccion === 'editar' ? (editando || !actual) : !editando;
    });
    cerrarSugerencias();
  }
  function abrir(id) {
    var x = quiros.filter(function (q) { return q.id === id; })[0];
    if (!x) return;
    actual = x; editando = false;
    rellenar(x); aplicarModo(); pintarCabecera(); pintarFoto();
    aviso('quFormMsg', '');
    ver('quFicha');
    $('quFicha').scrollIntoView({ block: 'start' });
    cargarTitulos();
  }
  function nuevo() {
    actual = null; editando = true;
    rellenar(null); aplicarModo(); pintarCabecera(); pintarFoto();
    aviso('quFormMsg', '');
    ver('quFicha');
    $('quNombre').focus();
  }

  async function guardar(form) {
    var horario = leerHorario();
    if (Object.keys(horario).some(function (d) { return !horario[d].abre || !horario[d].cierra || horario[d].abre >= horario[d].cierra; })) {
      aviso('quFormMsg', 'Revisa el horario: la hora final debe ser después de la inicial.', true); return;
    }
    var datos = {
      codigo: $('quCodigo').value.trim(),
      nombre: $('quNombre').value.trim(),
      telefono: $('quTelefono').value.trim() || null,
      correo: $('quCorreo').value.trim() || null,
      registro: $('quRegistro').value.trim() || null,
      direccion: $('quDireccion').value.trim() || null,
      tipo_id: $('quTipo').value ? +$('quTipo').value : null,
      inicio_profesion: $('quInicioProf').value || null,
      tecnicas: tecnicas.slice(),
      fecha_ingreso: $('quIngreso').value || hoy(),
      fecha_salida: $('quSalida').value || null,
      horario: horario,
      estado: $('quEstado').value,
      frecuencia: $('quFrecuencia').value ? +$('quFrecuencia').value : null,
      notas: $('quNotas').value.trim() || null
    };
    if (window.PD_SEDES) Object.assign(datos, window.PD_SEDES.valores($('quOrg'), $('quLoc')));
    if (!datos.codigo || !datos.nombre) { aviso('quFormMsg', 'El código y el nombre son obligatorios.', true); return; }
    if (!datos.organizacion_id || !datos.localidad_id) { aviso('quFormMsg', 'Elige la organización y la localidad / empresa del quiropráctico.', true); (datos.organizacion_id ? $('quLoc') : $('quOrg')).focus(); return; }
    if (datos.fecha_salida && datos.fecha_salida < datos.fecha_ingreso) { aviso('quFormMsg', 'La fecha final en la clínica no puede ser anterior a la de inicio.', true); return; }
    var boton = form.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('quFormMsg', 'Guardando…');
    var r = actual
      ? await sb.from('quiropracticos').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('quiropracticos').insert(datos).select('*').single();
    boton.disabled = false;
    if (r.error) { aviso('quFormMsg', traducir(r.error), true); return; }
    var eraNuevo = !actual;
    actual = r.data;
    quiros = eraNuevo ? quiros.concat([actual]) : quiros.map(function (q) { return q.id === actual.id ? actual : q; });
    editando = false;
    rellenar(actual); aplicarModo(); pintarCabecera(); pintarFoto();
    if (eraNuevo) cargarTitulos();
    aviso('quFormMsg', eraNuevo ? 'Quiropráctico registrado. Ya puedes agregar su foto y sus títulos.' : 'Cambios guardados.');
  }

  // Al elegir el tipo se agrega su área a las técnicas (si no estaba)
  $('quTipo').addEventListener('change', function () {
    var t = tipos.filter(function (x) { return x.id === +$('quTipo').value; })[0];
    if (t && !tecnicas.some(function (e) { return sinTildes(e) === sinTildes(t.especialidad); })) { tecnicas.push(t.especialidad); pintarChips(); }
  });

  // ---------- Técnicas (buscador) ----------
  function pintarChips() {
    $('quTecChips').innerHTML = tecnicas.length
      ? tecnicas.map(function (e, i) { return '<span class="esp-chip">' + esc(e) + '<button type="button" data-quitar-tec="' + i + '" aria-label="Quitar ' + esc(e) + '">×</button></span>'; }).join('')
      : '<span class="dlg-msg">Sin técnicas. Escribe abajo para buscar.</span>';
  }
  function buscarTecnicas(texto) {
    var q = sinTildes(texto.trim()), ya = tecnicas.map(sinTildes);
    var res = TECNICAS.filter(function (e) { return ya.indexOf(sinTildes(e[0])) < 0; }).map(function (e) {
      var nombre = sinTildes(e[0]), claves = e[1], p;
      if (!q) p = 1;
      else if (nombre.indexOf(q) === 0) p = 5;
      else if (nombre.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) p = 4;
      else if (nombre.indexOf(q) >= 0) p = 3;
      else if (claves.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) p = 2;
      else if (claves.indexOf(q) >= 0) p = 1;
      else p = 0;
      return { nombre: e[0], pista: p === 2 ? 'Relacionado: ' + claves.split(' ').filter(function (w) { return w.indexOf(q) === 0; })[0] : '', p: p };
    }).filter(function (x) { return x.p > 0; }).sort(function (a, b) { return b.p - a.p || a.nombre.localeCompare(b.nombre); }).slice(0, 8);
    var exacta = TECNICAS.some(function (e) { return sinTildes(e[0]) === q; }) || ya.indexOf(q) >= 0;
    if (q && !exacta) res.push({ nombre: texto.trim(), pista: 'Agregar como técnica nueva', nueva: true });
    return res;
  }
  function mostrarSugerencias() { sugerencias = buscarTecnicas($('quTecInput').value); marcada = sugerencias.length ? 0 : -1; pintarSugerencias(); }
  function pintarSugerencias() {
    var ul = $('quTecLista');
    ul.hidden = !sugerencias.length;
    $('quTecInput').setAttribute('aria-expanded', String(!ul.hidden));
    ul.innerHTML = sugerencias.map(function (s, i) {
      return '<li role="option" id="qtec-op-' + i + '" data-tec="' + i + '" aria-selected="' + (i === marcada) + '">' + (s.nueva ? '+ «' + esc(s.nombre) + '»' : esc(s.nombre)) + (s.pista ? '<small>' + esc(s.pista) + '</small>' : '') + '</li>';
    }).join('');
    if (marcada >= 0) $('quTecInput').setAttribute('aria-activedescendant', 'qtec-op-' + marcada); else $('quTecInput').removeAttribute('aria-activedescendant');
  }
  function cerrarSugerencias() { sugerencias = []; marcada = -1; pintarSugerencias(); }
  function elegirTecnica(i) {
    var s = sugerencias[i];
    if (!s) return;
    if (tecnicas.map(sinTildes).indexOf(sinTildes(s.nombre)) < 0) tecnicas.push(s.nombre);
    $('quTecInput').value = '';
    pintarChips(); cerrarSugerencias();
    $('quTecInput').focus();
  }

  // ---------- Foto ----------
  async function pintarFoto() {
    var vista = $('quFotoVista');
    $('quFotoBtn').disabled = !actual;
    $('quFotoBtn').textContent = actual && actual.foto ? 'Cambiar foto' : 'Subir foto';
    aviso('quFotoMsg', actual ? '' : 'Podrás agregar la foto después de guardar.');
    vista.innerHTML = esc(iniciales(actual ? actual.nombre : '?'));
    if (!actual || !actual.foto) return;
    var u = await sb.storage.from(BUCKET).createSignedUrl(actual.foto, 3600);
    if (!u.error && actual && actual.foto) vista.innerHTML = '<img src="' + esc(u.data.signedUrl) + '&t=' + Date.now() + '" alt="Foto de ' + esc(actual.nombre) + '">';
  }
  function reducirImagen(archivo) {
    return new Promise(function (ok, falla) {
      var img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = function () {
        var escala = Math.min(1, 600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
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
    $('quFotoBtn').disabled = true;
    aviso('quFotoMsg', 'Subiendo foto…');
    try {
      var blob = await reducirImagen(archivo);
      var ruta = 'fotos/quiropractico-' + actual.id + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      if (actual.foto !== ruta) {
        var r = await sb.from('quiropracticos').update({ foto: ruta }).eq('id', actual.id).select('*').single();
        if (r.error) throw r.error;
        actual = r.data;
        quiros = quiros.map(function (q) { return q.id === actual.id ? actual : q; });
        pintarCabecera();
      }
      aviso('quFotoMsg', 'Foto guardada.');
      await pintarFoto();
    } catch (e) {
      aviso('quFotoMsg', /válida|procesar/.test(e.message || '') ? e.message : traducir(e), true);
    } finally { $('quFotoBtn').disabled = !actual; }
  }

  // ---------- Títulos ----------
  function nombreSeguro(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80); }
  async function cargarTitulos() {
    if (!actual) return;
    $('quTitBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('quiropractico_titulos').select('*').eq('quiropractico_id', actual.id).order('anio', { ascending: false, nullsFirst: false }).order('id');
    if (r.error) { $('quTitBody').innerHTML = ''; aviso('quTitMsg', traducir(r.error), true); return; }
    titulos = r.data;
    var rutas = titulos.filter(function (t) { return t.archivo; }).map(function (t) { return t.archivo; }), urls = {};
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) u.data.forEach(function (x, i) { urls[rutas[i]] = x.signedUrl; });
    }
    $('quTitBody').innerHTML = titulos.length ? titulos.map(function (t) {
      return '<tr><td><strong>' + esc(t.titulo) + '</strong></td><td>' + esc(t.institucion || '—') + '</td><td class="fecha">' + (t.anio || '—') + '</td>' +
        '<td>' + (t.archivo && urls[t.archivo] ? '<a href="' + esc(urls[t.archivo]) + '" target="_blank" rel="noopener">Ver archivo</a>' : '—') + '</td>' +
        '<td>' + esc(t.registrado_por || '—') + '<span class="odo-meta">' + fechaHora(t.creado) + '</span></td>' +
        '<td>' + (esSuper() ? '<button type="button" class="adm-btn" data-borrar-qtit="' + t.id + '" data-confirmar="0" style="min-height:34px;padding:5px 10px">Borrar</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6">Sin títulos registrados.</td></tr>';
  }

  // ---------- Eventos ----------
  $('quNuevo').addEventListener('click', nuevo);
  $('quVolver').addEventListener('click', function () { actual = null; ver('quLista'); cargar(); });
  $('quBuscar').addEventListener('input', pintarLista);
  $('quFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-qufiltro]'); if (b) { filtro = b.dataset.qufiltro; pintarLista(); } });
  $('quBody').addEventListener('click', function (e) { var b = e.target.closest('[data-abrir-qu]'); if (b) abrir(+b.dataset.abrirQu); });
  document.querySelectorAll('[data-qu-accion]').forEach(function (b) {
    if (b.dataset.quAccion === 'editar') b.addEventListener('click', function () { editando = true; aplicarModo(); aviso('quFormMsg', 'Modo edición: haz los cambios y pulsa «Guardar».'); $('quNombre').focus(); });
    if (b.dataset.quAccion === 'cancelar') b.addEventListener('click', function () {
      if (!actual) { ver('quLista'); cargar(); return; }
      editando = false; rellenar(actual); aplicarModo(); aviso('quFormMsg', 'Se descartaron los cambios.');
    });
  });
  $('quForm').addEventListener('submit', function (e) { e.preventDefault(); if (editando) guardar(this); });
  $('quInicioProf').addEventListener('input', pintarExperiencia);
  $('quHorario').addEventListener('change', function (e) {
    var c = e.target.closest('[data-abierto]'); if (!c) return;
    var f = c.closest('[data-dia]');
    f.querySelector('[data-abre]').disabled = !c.checked;
    f.querySelector('[data-cierra]').disabled = !c.checked;
  });
  $('quTecInput').addEventListener('input', mostrarSugerencias);
  $('quTecInput').addEventListener('focus', mostrarSugerencias);
  $('quTecInput').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' && sugerencias.length) { e.preventDefault(); marcada = (marcada + 1) % sugerencias.length; pintarSugerencias(); }
    else if (e.key === 'ArrowUp' && sugerencias.length) { e.preventDefault(); marcada = (marcada - 1 + sugerencias.length) % sugerencias.length; pintarSugerencias(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (marcada >= 0) elegirTecnica(marcada); }
    else if (e.key === 'Escape') cerrarSugerencias();
  });
  $('quTecInput').addEventListener('blur', function () { setTimeout(cerrarSugerencias, 150); });
  $('quTecLista').addEventListener('mousedown', function (e) { var li = e.target.closest('[data-tec]'); if (li) { e.preventDefault(); elegirTecnica(+li.dataset.tec); } });
  $('quTecChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-quitar-tec]');
    if (!b || !editando) return;
    tecnicas.splice(+b.dataset.quitarTec, 1);
    pintarChips();
  });
  $('quFotoBtn').addEventListener('click', function () { $('quFotoArchivo').click(); });
  $('quFotoArchivo').addEventListener('change', function () { var f = this.files[0]; this.value = ''; subirFoto(f); });
  $('quTitForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!actual) return;
    var archivo = $('quTitArchivo').files[0];
    if (archivo && archivo.size > 10 * 1024 * 1024) { aviso('quTitMsg', 'El archivo pesa más de 10 MB.', true); return; }
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('quTitMsg', 'Guardando…');
    var ruta = null;
    if (archivo) {
      ruta = 'quiropracticos/' + actual.id + '/' + Date.now() + '-' + nombreSeguro(archivo.name);
      var up = await sb.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
      if (up.error) { boton.disabled = false; aviso('quTitMsg', traducir(up.error), true); return; }
    }
    var r = await sb.from('quiropractico_titulos').insert({
      quiropractico_id: actual.id, titulo: $('quTitNombre').value.trim(), institucion: $('quTitInst').value.trim() || null,
      anio: $('quTitAnio').value ? +$('quTitAnio').value : null, archivo: ruta
    });
    boton.disabled = false;
    if (r.error) { aviso('quTitMsg', traducir(r.error), true); return; }
    this.reset();
    aviso('quTitMsg', 'Título agregado.');
    cargarTitulos();
  });
  $('quTitBody').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-qtit]');
    if (!b || !pedirConfirmacion(b)) return;
    var t = titulos.filter(function (x) { return String(x.id) === b.dataset.borrarQtit; })[0];
    b.disabled = true;
    var r = await sb.from('quiropractico_titulos').delete().eq('id', b.dataset.borrarQtit);
    if (r.error) { b.disabled = false; aviso('quTitMsg', traducir(r.error), true); return; }
    if (t && t.archivo) await sb.storage.from(BUCKET).remove([t.archivo]);
    aviso('quTitMsg', 'Título borrado.');
    cargarTitulos();
  });
  $('tabQuiropracticos').addEventListener('click', function () { if (!$('quLista').hidden) cargar(); });

  // Quiroprácticos activos para otras pantallas (expediente, agendas, historial y reportes)
  window.PD_QUIROPRACTICOS = async function (todos) {
    var q = sb.from('quiropracticos').select('id,nombre,tecnicas,horario,frecuencia,estado,fecha_ingreso,fecha_salida,telefono,correo');
    if (!todos) q = q.eq('estado', 'activo');
    var r = await q.order('nombre');
    return r.error ? [] : r.data;
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('quLista').hidden) cargar(); },
    limpiar: function () {
      quiros = []; titulos = []; actual = null; editando = false; fotos = {}; tecnicas = [];
      ['quBody', 'quTitBody', 'quFotoVista'].forEach(function (id) { $(id).innerHTML = ''; });
      ver('quLista');
    }
  });
})();
