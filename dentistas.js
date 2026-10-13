// Plus Dental — Dentistas: datos, trayectoria, especialidades, sala, asistente, horario, títulos y foto
// Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var BUCKET = 'expedientes';
  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo', baja: 'Baja' };
  var EST_POS = { libre: 'Libre', ocupado: 'Ocupado', limpieza: 'En limpieza', mantenimiento: 'Fuera de servicio' };
  var DIAS = [['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo']];
  var HORARIO_BASE = { 1: { abre: '08:00', cierra: '17:00' }, 2: { abre: '08:00', cierra: '17:00' }, 3: { abre: '08:00', cierra: '17:00' }, 4: { abre: '08:00', cierra: '17:00' }, 5: { abre: '08:00', cierra: '17:00' } };
  // Especialidades odontológicas (lista preparada para Guatemala) con palabras con las que se suelen buscar
  var ESPECIALIDADES = [
    ['Odontología general', 'general dentista odontologo cirujano dentista'],
    ['Ortodoncia y ortopedia maxilar', 'orto brackets frenos alineadores ortopedia invisalign'],
    ['Endodoncia', 'endo conductos nervio canales'],
    ['Periodoncia', 'perio encias piorrea'],
    ['Odontopediatría', 'ninos ninas pediatria infantil pediatrica'],
    ['Prostodoncia', 'protesis puentes coronas dentaduras placas'],
    ['Rehabilitación oral', 'rehabilitacion protesis coronas'],
    ['Cirugía oral y maxilofacial', 'cirugia extracciones cordales terceras molares maxilofacial'],
    ['Implantología oral', 'implantes implante'],
    ['Odontología estética', 'estetica cosmetica carillas blanqueamiento diseno de sonrisa'],
    ['Odontología restauradora', 'resinas restauraciones operatoria'],
    ['Patología y medicina bucal', 'patologia medicina oral lesiones'],
    ['Radiología oral y maxilofacial', 'radiologia rayos x tomografia imagen'],
    ['Trastornos temporomandibulares y dolor orofacial', 'atm bruxismo mandibula dolor'],
    ['Odontogeriatría', 'adultos mayores geriatria tercera edad'],
    ['Odontología para pacientes con necesidades especiales', 'discapacidad especiales'],
    ['Odontología forense', 'forense peritaje'],
    ['Salud pública bucal', 'salud publica comunitaria'],
    ['Higiene y prevención dental', 'higiene profilaxis limpieza prevencion'],
    ['Odontología deportiva', 'deporte protectores bucales'],
    ['Odontología láser', 'laser'],
    ['Sedación y anestesia en odontología', 'sedacion anestesia']
  ];

  var dentistas = [], posiciones = [], personal = [], titulos = [], actual = null, editando = false, filtro = 'activo';
  var especialidades = [], sugerencias = [], marcada = -1, fotos = {};

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
  // Años y meses desde una fecha hasta hoy
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
    if (/(dentistas|dentista_titulos).*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los dentistas.';
    if (/dentistas_codigo_unico|duplicate key/i.test(m)) return 'Ya existe un dentista con ese código.';
    if (/dentistas_fechas/i.test(m)) return 'La fecha final en la clínica no puede ser anterior a la de inicio.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/exceeded the maximum allowed size|too large/i.test(m)) return 'El archivo pesa más de 10 MB.';
    if (/mime type/i.test(m)) return 'Solo se aceptan PDF o imágenes JPG, PNG o WEBP.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  function ver(id) { ['denLista', 'denFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  // ---------- Lista ----------
  async function cargar() {
    aviso('denMsg', '');
    $('denBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var r = await sb.from('dentistas').select('*').order('nombre');
    if (r.error) { $('denBody').innerHTML = ''; aviso('denMsg', traducir(r.error), true); return; }
    dentistas = r.data;
    await cargarCatalogos();
    pintarLista();
    var rutas = dentistas.filter(function (d) { return d.foto; }).map(function (d) { return d.foto; });
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) { fotos = {}; u.data.forEach(function (x, i) { if (x.signedUrl) fotos[rutas[i]] = x.signedUrl; }); pintarLista(); }
    }
  }

  async function cargarCatalogos() {
    var p = await sb.from('posiciones').select('id,codigo,nombre,estado,activa').order('codigo');
    posiciones = p.error ? [] : p.data;
    var s = await sb.from('personal').select('id,nombre,rol,activo').order('nombre');
    personal = s.error ? [] : s.data;
  }

  function nombrePosicion(id) { var p = posiciones.filter(function (x) { return x.id === id; })[0]; return p ? p.codigo + ' · ' + p.nombre : '—'; }

  function pintarLista() {
    document.querySelectorAll('#denFiltros [data-dfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.dfiltro === filtro); });
    var q = sinTildes($('denBuscar').value.trim());
    var lista = dentistas.filter(function (d) {
      return (filtro === 'todos' || d.estado === filtro) &&
        (!q || [d.nombre, d.codigo, (d.especialidades || []).join(' ')].some(function (v) { return sinTildes(v).indexOf(q) >= 0; }));
    });
    if (!lista.length) {
      $('denBody').innerHTML = '<tr><td colspan="7">' + (q ? 'Ningún dentista coincide.' : dentistas.length ? 'No hay dentistas con este estado.' : 'Todavía no hay dentistas registrados. Agrega el primero con «Nuevo dentista».') + '</td></tr>';
      return;
    }
    $('denBody').innerHTML = lista.map(function (d) {
      var url = fotos[d.foto];
      return '<tr><td><div class="pac-nombre"><span class="avatar">' + (url ? '<img src="' + esc(url) + '" alt="">' : esc(iniciales(d.nombre))) + '</span><strong>' + esc(d.nombre) + '</strong></div></td>' +
        '<td class="fecha">' + esc(d.codigo) + '</td><td>' + esc((d.especialidades || []).join(', ') || '—') + '</td>' +
        '<td>' + esc(d.posicion_id ? nombrePosicion(d.posicion_id) : '—') + '</td>' +
        '<td class="fecha">' + esc(aniosMeses(d.inicio_profesion) || '—') + '</td>' +
        '<td><span class="estado estado-' + d.estado + '">' + ESTADOS[d.estado] + '</span></td>' +
        '<td><button type="button" class="adm-btn" data-abrir-den="' + d.id + '">Abrir</button></td></tr>';
    }).join('');
  }

  // ---------- Ficha ----------
  function siguienteCodigo() {
    var max = 0;
    dentistas.forEach(function (d) { var m = /^DEN-(\d+)$/i.exec(d.codigo || ''); if (m) max = Math.max(max, +m[1]); });
    return 'DEN-' + ('00' + (max + 1)).slice(-3);
  }

  function opcionesSalas(elegida) {
    var otros = {};
    dentistas.forEach(function (d) {
      if (d.posicion_id && d.estado === 'activo' && (!actual || d.id !== actual.id)) (otros[d.posicion_id] = otros[d.posicion_id] || []).push(d.nombre);
    });
    $('dePosicion').innerHTML = '<option value="">Sin asignar</option>' + posiciones.filter(function (p) { return p.activa || p.id === elegida; }).map(function (p) {
      var extra = EST_POS[p.estado] + (otros[p.id] ? ' · también: ' + otros[p.id].join(', ') : ' · disponible');
      return '<option value="' + p.id + '"' + (p.id === elegida ? ' selected' : '') + '>' + esc(p.codigo + ' · ' + p.nombre + ' — ' + extra) + '</option>';
    }).join('');
    if (!posiciones.length) $('dePosicion').innerHTML = '<option value="">Primero registra las salas en «Posiciones y clínicas»</option>';
  }

  function opcionesAsistentes(elegido) {
    var lista = personal.filter(function (p) { return (p.rol === 'auxiliar' || p.rol === 'higienista') && (p.activo || p.id === elegido); });
    $('deAsistente').innerHTML = '<option value="">Sin asistente</option>' + lista.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === elegido ? ' selected' : '') + '>' + esc(p.nombre) + (p.rol === 'higienista' ? ' (higienista)' : '') + '</option>';
    }).join('');
    if (!lista.length) $('deAsistente').innerHTML = '<option value="">Agrega asistentes en «Posiciones y clínicas → Personal»</option>';
  }

  function pintarHorario(h) {
    $('deHorario').innerHTML = DIAS.map(function (d) {
      var x = h[d[0]];
      return '<div class="pos-dia" data-dia="' + d[0] + '"><label class="nom"><input type="checkbox" data-abierto' + (x ? ' checked' : '') + '>' + d[1].slice(0, 3) + '</label>' +
        '<input type="time" data-abre value="' + (x ? x.abre : '08:00') + '" aria-label="' + d[1] + ': desde"' + (x ? '' : ' disabled') + '>' +
        '<span aria-hidden="true">–</span><input type="time" data-cierra value="' + (x ? x.cierra : '17:00') + '" aria-label="' + d[1] + ': hasta"' + (x ? '' : ' disabled') + '></div>';
    }).join('');
  }
  function leerHorario() {
    var h = {};
    $('deHorario').querySelectorAll('[data-dia]').forEach(function (f) {
      if (f.querySelector('[data-abierto]').checked) h[f.dataset.dia] = { abre: f.querySelector('[data-abre]').value, cierra: f.querySelector('[data-cierra]').value };
    });
    return h;
  }

  function pintarExperiencia() { $('deExperiencia').textContent = aniosMeses($('deInicioProf').value) || '—'; }

  function rellenar(d) {
    $('deCodigo').value = d ? d.codigo : siguienteCodigo();
    $('deNombre').value = (d && d.nombre) || '';
    $('deTelefono').value = (d && d.telefono) || '';
    $('deDireccion').value = (d && d.direccion) || '';
    $('deColegiado').value = (d && d.colegiado) || '';
    $('deInicioProf').value = (d && d.inicio_profesion) || '';
    $('deIngreso').value = d ? d.fecha_ingreso : hoy();
    $('deSalida').value = (d && d.fecha_salida) || '';
    $('deEstado').value = (d && d.estado) || 'activo';
    $('deNotas').value = (d && d.notas) || '';
    especialidades = d ? (d.especialidades || []).slice() : [];
    pintarChips();
    opcionesSalas(d ? d.posicion_id : null);
    opcionesAsistentes(d ? d.asistente_id : null);
    pintarHorario(d ? (d.horario || {}) : HORARIO_BASE);
    pintarExperiencia();
  }

  function pintarCabecera() {
    $('denTitulo').textContent = actual ? actual.nombre : 'Nuevo dentista';
    $('denSub').textContent = actual
      ? [actual.codigo, (actual.especialidades || []).join(', '), actual.colegiado ? 'Colegiado ' + actual.colegiado : ''].filter(Boolean).join(' · ')
      : 'Llena los datos y guarda. Después podrás agregar la foto y los títulos.';
    $('denEstadoPill').hidden = !actual;
    if (actual) { $('denEstadoPill').className = 'estado estado-' + actual.estado; $('denEstadoPill').textContent = ESTADOS[actual.estado]; }
    $('deMeta').hidden = !actual;
    if (actual) {
      $('deMeta').innerHTML = '<span>Registrado <b>' + fechaHora(actual.creado) + '</b> por <b>' + esc(actual.registrado_por || '—') + '</b></span>' +
        '<span>Última modificación <b>' + fechaHora(actual.actualizado) + '</b>' + (actual.actualizado_por ? ' por <b>' + esc(actual.actualizado_por) + '</b>' : '') + '</span>' +
        '<span>En la clínica desde <b>' + fechaCorta(actual.fecha_ingreso) + '</b>' + (actual.fecha_salida ? ' hasta <b>' + fechaCorta(actual.fecha_salida) + '</b>' : '') + '</span>';
    }
    $('deTitulosSec').hidden = !actual;
  }

  function aplicarModo() {
    $('deCampos').disabled = !editando;
    document.querySelectorAll('[data-de-accion]').forEach(function (b) {
      var a = b.dataset.deAccion;
      b.hidden = a === 'editar' ? (editando || !actual) : !editando;
    });
    cerrarSugerencias();
  }

  async function abrir(id) {
    var d = dentistas.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    actual = d;
    editando = false;
    rellenar(d);
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    aviso('deMsg', '');
    ver('denFicha');
    $('denFicha').scrollIntoView({ block: 'start' });
    cargarTitulos();
  }

  function nuevo() {
    actual = null;
    editando = true;
    rellenar(null);
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    aviso('deMsg', '');
    ver('denFicha');
    $('deNombre').focus();
  }

  async function guardar(form) {
    var horario = leerHorario();
    if (Object.keys(horario).some(function (d) { return !horario[d].abre || !horario[d].cierra || horario[d].abre >= horario[d].cierra; })) {
      aviso('deMsg', 'Revisa el horario: la hora final debe ser después de la inicial.', true); return;
    }
    var datos = {
      codigo: $('deCodigo').value.trim(),
      nombre: $('deNombre').value.trim(),
      telefono: $('deTelefono').value.trim() || null,
      direccion: $('deDireccion').value.trim() || null,
      colegiado: $('deColegiado').value.trim() || null,
      inicio_profesion: $('deInicioProf').value || null,
      especialidades: especialidades.slice(),
      fecha_ingreso: $('deIngreso').value || hoy(),
      fecha_salida: $('deSalida').value || null,
      posicion_id: $('dePosicion').value ? +$('dePosicion').value : null,
      asistente_id: $('deAsistente').value ? +$('deAsistente').value : null,
      horario: horario,
      estado: $('deEstado').value,
      notas: $('deNotas').value.trim() || null
    };
    if (!datos.codigo || !datos.nombre) { aviso('deMsg', 'El código y el nombre son obligatorios.', true); return; }
    if (datos.fecha_salida && datos.fecha_salida < datos.fecha_ingreso) { aviso('deMsg', 'La fecha final en la clínica no puede ser anterior a la de inicio.', true); return; }
    var boton = form.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('deMsg', 'Guardando…');
    var r = actual
      ? await sb.from('dentistas').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('dentistas').insert(datos).select('*').single();
    boton.disabled = false;
    if (r.error) { aviso('deMsg', traducir(r.error), true); return; }
    var eraNuevo = !actual;
    actual = r.data;
    dentistas = eraNuevo ? dentistas.concat([r.data]) : dentistas.map(function (d) { return d.id === r.data.id ? r.data : d; });
    editando = false;
    rellenar(actual);
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    if (eraNuevo) cargarTitulos();
    aviso('deMsg', eraNuevo ? 'Dentista registrado. Ya puedes agregar su foto y sus títulos.' : 'Cambios guardados.');
  }

  // ---------- Especialidades (buscador inteligente) ----------
  function pintarChips() {
    $('deEspChips').innerHTML = especialidades.length
      ? especialidades.map(function (e, i) { return '<span class="esp-chip">' + esc(e) + '<button type="button" data-quitar-esp="' + i + '" aria-label="Quitar ' + esc(e) + '">×</button></span>'; }).join('')
      : '<span class="dlg-msg">Sin especialidades. Escribe abajo para buscar.</span>';
  }
  function buscarEspecialidades(texto) {
    var q = sinTildes(texto.trim());
    var ya = especialidades.map(sinTildes);
    var res = ESPECIALIDADES.filter(function (e) { return ya.indexOf(sinTildes(e[0])) < 0; }).map(function (e) {
      var nombre = sinTildes(e[0]), claves = e[1], p = 0;
      if (!q) p = 1;
      else if (nombre.indexOf(q) === 0) p = 5;
      else if (nombre.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) p = 4;
      else if (nombre.indexOf(q) >= 0) p = 3;
      else if (claves.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) p = 2;
      else if (claves.indexOf(q) >= 0) p = 1;
      else p = 0;
      return { nombre: e[0], pista: p === 2 ? 'Relacionado: ' + claves.split(' ').filter(function (w) { return w.indexOf(q) === 0; })[0] : '', p: p };
    }).filter(function (x) { return x.p > 0; }).sort(function (a, b) { return b.p - a.p || a.nombre.localeCompare(b.nombre); }).slice(0, 8);
    var exacta = ESPECIALIDADES.some(function (e) { return sinTildes(e[0]) === q; }) || ya.indexOf(q) >= 0;
    if (q && !exacta) res.push({ nombre: texto.trim(), pista: 'Agregar como especialidad nueva', nueva: true });
    return res;
  }
  function mostrarSugerencias() {
    sugerencias = buscarEspecialidades($('deEspInput').value);
    marcada = sugerencias.length ? 0 : -1;
    pintarSugerencias();
  }
  function pintarSugerencias() {
    var ul = $('deEspLista');
    ul.hidden = !sugerencias.length;
    $('deEspInput').setAttribute('aria-expanded', String(!ul.hidden));
    ul.innerHTML = sugerencias.map(function (s, i) {
      return '<li role="option" id="esp-op-' + i + '" data-esp="' + i + '" aria-selected="' + (i === marcada) + '">' + (s.nueva ? '+ «' + esc(s.nombre) + '»' : esc(s.nombre)) + (s.pista ? '<small>' + esc(s.pista) + '</small>' : '') + '</li>';
    }).join('');
    if (marcada >= 0) $('deEspInput').setAttribute('aria-activedescendant', 'esp-op-' + marcada); else $('deEspInput').removeAttribute('aria-activedescendant');
  }
  function cerrarSugerencias() { sugerencias = []; marcada = -1; pintarSugerencias(); }
  function elegirEspecialidad(i) {
    var s = sugerencias[i];
    if (!s) return;
    if (especialidades.map(sinTildes).indexOf(sinTildes(s.nombre)) < 0) especialidades.push(s.nombre);
    $('deEspInput').value = '';
    pintarChips();
    cerrarSugerencias();
    $('deEspInput').focus();
  }

  // ---------- Foto ----------
  async function pintarFoto() {
    var vista = $('deFotoVista');
    $('deFotoBtn').disabled = !actual;
    $('deFotoBtn').textContent = actual && actual.foto ? 'Cambiar foto' : 'Subir foto';
    aviso('deFotoMsg', actual ? '' : 'Podrás agregar la foto después de guardar.');
    vista.innerHTML = esc(iniciales(actual ? actual.nombre : '?'));
    if (!actual || !actual.foto) return;
    var u = await sb.storage.from(BUCKET).createSignedUrl(actual.foto, 3600);
    if (!u.error && actual && actual.foto) vista.innerHTML = '<img src="' + esc(u.data.signedUrl) + '" alt="Foto de ' + esc(actual.nombre) + '">';
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
    $('deFotoBtn').disabled = true;
    aviso('deFotoMsg', 'Subiendo foto…');
    try {
      var blob = await reducirImagen(archivo);
      var ruta = 'fotos/dentista-' + actual.id + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      if (actual.foto !== ruta) {
        var r = await sb.from('dentistas').update({ foto: ruta }).eq('id', actual.id).select('*').single();
        if (r.error) throw r.error;
        actual = r.data;
        dentistas = dentistas.map(function (d) { return d.id === actual.id ? actual : d; });
        pintarCabecera();
      }
      aviso('deFotoMsg', 'Foto guardada.');
      await pintarFoto();
    } catch (e) {
      aviso('deFotoMsg', /válida|procesar/.test(e.message || '') ? e.message : traducir(e), true);
    } finally {
      $('deFotoBtn').disabled = !actual;
    }
  }

  // ---------- Títulos ----------
  function nombreSeguro(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80); }
  async function cargarTitulos() {
    if (!actual) return;
    $('titBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('dentista_titulos').select('*').eq('dentista_id', actual.id).order('anio', { ascending: false, nullsFirst: false }).order('id');
    if (r.error) { $('titBody').innerHTML = ''; aviso('titMsg', traducir(r.error), true); return; }
    titulos = r.data;
    var rutas = titulos.filter(function (t) { return t.archivo; }).map(function (t) { return t.archivo; }), urls = {};
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) u.data.forEach(function (x, i) { urls[rutas[i]] = x.signedUrl; });
    }
    $('titBody').innerHTML = titulos.length ? titulos.map(function (t) {
      return '<tr><td><strong>' + esc(t.titulo) + '</strong></td><td>' + esc(t.institucion || '—') + '</td><td class="fecha">' + (t.anio || '—') + '</td>' +
        '<td>' + (t.archivo && urls[t.archivo] ? '<a href="' + esc(urls[t.archivo]) + '" target="_blank" rel="noopener">Ver archivo</a>' : '—') + '</td>' +
        '<td>' + esc(t.registrado_por || '—') + '<span class="odo-meta">' + fechaHora(t.creado) + '</span></td>' +
        '<td>' + (esSuper() ? '<button type="button" class="adm-btn" data-borrar-tit="' + t.id + '" data-confirmar="0" style="min-height:34px;padding:5px 10px">Borrar</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6">Sin títulos registrados.</td></tr>';
  }

  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.isConnected && b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // ---------- Eventos ----------
  $('denNuevo').addEventListener('click', nuevo);
  $('denVolver').addEventListener('click', function () { actual = null; ver('denLista'); cargar(); });
  $('denBuscar').addEventListener('input', pintarLista);
  $('denFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dfiltro]');
    if (b) { filtro = b.dataset.dfiltro; pintarLista(); }
  });
  $('denBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir-den]');
    if (b) abrir(+b.dataset.abrirDen);
  });
  document.querySelectorAll('[data-de-accion]').forEach(function (b) {
    if (b.dataset.deAccion === 'editar') b.addEventListener('click', function () { editando = true; aplicarModo(); aviso('deMsg', 'Modo edición: haz los cambios y pulsa «Guardar».'); $('deNombre').focus(); });
    if (b.dataset.deAccion === 'cancelar') b.addEventListener('click', function () {
      if (!actual) { ver('denLista'); cargar(); return; }
      editando = false; rellenar(actual); aplicarModo(); aviso('deMsg', 'Se descartaron los cambios.');
    });
  });
  $('denForm').addEventListener('submit', function (e) { e.preventDefault(); if (editando) guardar(this); });
  $('deInicioProf').addEventListener('input', pintarExperiencia);
  $('deHorario').addEventListener('change', function (e) {
    var c = e.target.closest('[data-abierto]');
    if (!c) return;
    var f = c.closest('[data-dia]');
    f.querySelector('[data-abre]').disabled = !c.checked;
    f.querySelector('[data-cierra]').disabled = !c.checked;
  });

  $('deEspInput').addEventListener('input', mostrarSugerencias);
  $('deEspInput').addEventListener('focus', mostrarSugerencias);
  $('deEspInput').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' && sugerencias.length) { e.preventDefault(); marcada = (marcada + 1) % sugerencias.length; pintarSugerencias(); }
    else if (e.key === 'ArrowUp' && sugerencias.length) { e.preventDefault(); marcada = (marcada - 1 + sugerencias.length) % sugerencias.length; pintarSugerencias(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (marcada >= 0) elegirEspecialidad(marcada); }
    else if (e.key === 'Escape') cerrarSugerencias();
  });
  $('deEspInput').addEventListener('blur', function () { setTimeout(cerrarSugerencias, 150); });
  $('deEspLista').addEventListener('mousedown', function (e) {
    var li = e.target.closest('[data-esp]');
    if (li) { e.preventDefault(); elegirEspecialidad(+li.dataset.esp); }
  });
  $('deEspChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-quitar-esp]');
    if (!b || !editando) return;
    especialidades.splice(+b.dataset.quitarEsp, 1);
    pintarChips();
  });

  $('deFotoBtn').addEventListener('click', function () { $('deFotoArchivo').click(); });
  $('deFotoArchivo').addEventListener('change', function () { var f = this.files[0]; this.value = ''; subirFoto(f); });

  $('titForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!actual) return;
    var archivo = $('titArchivo').files[0];
    if (archivo && archivo.size > 10 * 1024 * 1024) { aviso('titMsg', 'El archivo pesa más de 10 MB.', true); return; }
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('titMsg', 'Guardando…');
    var ruta = null;
    if (archivo) {
      ruta = 'dentistas/' + actual.id + '/' + Date.now() + '-' + nombreSeguro(archivo.name);
      var up = await sb.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
      if (up.error) { boton.disabled = false; aviso('titMsg', traducir(up.error), true); return; }
    }
    var r = await sb.from('dentista_titulos').insert({
      dentista_id: actual.id,
      titulo: $('titNombre').value.trim(),
      institucion: $('titInst').value.trim() || null,
      anio: $('titAnio').value ? +$('titAnio').value : null,
      archivo: ruta
    });
    boton.disabled = false;
    if (r.error) { aviso('titMsg', traducir(r.error), true); return; }
    this.reset();
    aviso('titMsg', 'Título agregado.');
    cargarTitulos();
  });
  $('titBody').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-tit]');
    if (!b || !pedirConfirmacion(b)) return;
    var t = titulos.filter(function (x) { return String(x.id) === b.dataset.borrarTit; })[0];
    b.disabled = true;
    var r = await sb.from('dentista_titulos').delete().eq('id', b.dataset.borrarTit);
    if (r.error) { b.disabled = false; aviso('titMsg', traducir(r.error), true); return; }
    if (t && t.archivo) await sb.storage.from(BUCKET).remove([t.archivo]);
    aviso('titMsg', 'Título borrado.');
    cargarTitulos();
  });

  $('tabDentistas').addEventListener('click', function () { if (!$('denLista').hidden) cargar(); });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('denLista').hidden) cargar(); },
    limpiar: function () {
      dentistas = []; titulos = []; actual = null; editando = false; fotos = {}; especialidades = [];
      ['denBody', 'titBody', 'deFotoVista'].forEach(function (id) { $(id).innerHTML = ''; });
      ver('denLista');
    }
  });
})();
