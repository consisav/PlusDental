// Plus Dental — Expedientes de pacientes (solo Administrador y Super Administrador)
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var BUCKET = 'expedientes';
  var CAMPOS = {
    nombre: 'pNombre', dpi: 'pDpi', nit: 'pNit', fecha_nacimiento: 'pNacimiento', telefono: 'pTelefono', direccion: 'pDireccion',
    emergencia_nombre: 'pEmNombre', emergencia_telefono: 'pEmTelefono', estado: 'pEstado', correo: 'pCorreo'
  };

  var ESTADOS_PAC = { activo: 'Activo', inactivo: 'Inactivo', suspendido: 'Suspendido', baja: 'Baja' };
  var pacientes = [], actual = null, odontoCambiado = false;
  var filtroEstado = 'activo', editando = false, fotos = {}, medicos = [], agentesCat = [], clientes = [], usuariosTomados = {}, hayUsuario = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function anios(f) {
    if (!f) return null;
    var n = new Date(f + 'T12:00:00'), h = new Date();
    var a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a;
  }
  function edad(f) { return f ? anios(f) + ' años' : '—'; }
  function iniciales(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join(''); }
  function avatar(p, url) { return url ? '<img src="' + esc(url) + '" alt="">' : esc(iniciales(p.nombre)); }
  function fechaHoraCorta(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/pacientes_usuario_unico/i.test(m)) return 'Ese usuario ya está asignado a otro paciente.';
    if (/pacientes_usuario_fk/i.test(m)) return 'Ese usuario ya no existe. Elige otro de la lista.';
    if (/pacientes_dpi_unico|duplicate key/i.test(m)) return 'Ya existe un paciente con ese DPI.';
    if (/odontograma_cambios|guardar_odontograma|editar_cambio_odontograma/i.test(m) && /does not exist|could not find/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para el historial del odontograma.';
    if (/relation .*(pacientes|notas_visita).* does not exist|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script de expedientes.';
    if (/bucket not found/i.test(m)) return 'Falta ejecutar en Supabase el script de expedientes (almacenamiento de radiografías).';
    if (/row-level security|permission denied|not authorized|unauthorized/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/exceeded the maximum allowed size|too large/i.test(m)) return 'El archivo pesa más de 10 MB.';
    if (/mime type/i.test(m)) return 'Solo se aceptan imágenes JPG, PNG, WEBP o archivos PDF.';
    return 'No se pudo completar: ' + m;
  }

  // ---------- Lista ----------
  async function cargar() {
    if (window.PD_COLOR) await window.PD_COLOR.cargar(true);
    aviso('expMsg', '');
    $('expBody').innerHTML = '<tr><td colspan="8">Cargando…</td></tr>';
    var r = await sb.from('pacientes').select('id,nombre,dpi,telefono,fecha_nacimiento,actualizado,creado,estado,foto,dentista_id,medico:dentistas(nombre)').order('nombre');
    if (r.error && /dentista/.test(r.error.message)) r = await sb.from('pacientes').select('id,nombre,dpi,telefono,fecha_nacimiento,actualizado,creado,estado,foto').order('nombre');
    // Si aún no existen las columnas nuevas, se muestra la lista sin ellas
    if (r.error && /estado|foto/.test(r.error.message)) r = await sb.from('pacientes').select('id,nombre,dpi,telefono,fecha_nacimiento,actualizado,creado').order('nombre');
    if (r.error) { $('expBody').innerHTML = ''; aviso('expMsg', traducir(r.error), true); return; }
    pacientes = r.data;
    pintarLista();
    // Fotos de la lista (enlaces temporales del almacenamiento privado)
    var rutas = pacientes.filter(function (p) { return p.foto; }).map(function (p) { return p.foto; });
    if (rutas.length) {
      var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
      if (!u.error) { fotos = {}; u.data.forEach(function (x, i) { if (x.signedUrl) fotos[rutas[i]] = x.signedUrl; }); pintarLista(); }
    }
  }

  function pintarLista() {
    var q = $('expBuscar').value.trim().toLowerCase();
    document.querySelectorAll('#expFiltros [data-efiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.efiltro === filtroEstado); });
    var lista = pacientes.filter(function (p) {
      var est = p.estado || 'activo';
      return (filtroEstado === 'todos' || est === filtroEstado) &&
        (!q || [p.nombre, p.dpi, p.telefono, p.medico && p.medico.nombre].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; }));
    });
    if (!lista.length) {
      $('expBody').innerHTML = '<tr><td colspan="8">' + (q ? 'Ningún paciente coincide con «' + esc(q) + '».'
        : pacientes.length ? 'No hay pacientes con estado «' + (ESTADOS_PAC[filtroEstado] || 'Todos') + '».' : 'Todavía no hay expedientes. Crea el primero con «Nuevo paciente».') + '</td></tr>';
      return;
    }
    $('expBody').innerHTML = lista.map(function (p) {
      var est = p.estado || 'activo';
      return '<tr><td><div class="pac-nombre"><span class="avatar"' + (window.PD_COLOR ? window.PD_COLOR.estilo(p.dentista_id) : '') + ' title="' + esc(p.medico ? 'Color de ' + p.medico.nombre : '') + '">' + avatar(p, fotos[p.foto]) + '</span><strong>' + esc(p.nombre) + '</strong></div></td>' +
        '<td>' + esc(p.dpi || '—') + '</td><td>' + esc(p.telefono || '—') + '</td>' +
        '<td class="fecha">' + edad(p.fecha_nacimiento) + '</td>' +
        '<td>' + (p.medico ? (window.PD_COLOR ? window.PD_COLOR.punto(p.dentista_id) : '') + esc(p.medico.nombre) : '<span style="color:#94A6B2">Sin asignar</span>') + '</td>' +
        '<td><span class="estado estado-' + est + '">' + ESTADOS_PAC[est] + '</span></td>' +
        '<td class="fecha">' + fechaCorta(p.creado) + '</td>' +
        '<td><button type="button" class="adm-btn" data-abrir="' + p.id + '">Abrir</button></td></tr>';
    }).join('');
  }

  // ---------- Ficha ----------
  async function verLista() {
    var sinGuardar = odontoCambiado && actual ? actual.nombre : '';
    actual = null; odontoCambiado = false;
    $('expFicha').hidden = true; $('expLista').hidden = false;
    await cargar();
    if (sinGuardar) aviso('expMsg', 'Ojo: no se guardaron los cambios del odontograma de ' + sinGuardar + '.', true);
  }

  function parte(id) {
    document.querySelectorAll('#fichaTabs [data-ficha]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.ficha === id);
      $(b.dataset.ficha).hidden = b.dataset.ficha !== id;
    });
    if (id === 'fNotas') cargarNotas();
    if (id === 'fOdonto') { cargarHistorial(); cargarCatalogoOdg(); cargarCodigoPresupuesto(); cargarPresupuestoActual(); if (window.PD_CUOTAS) window.PD_CUOTAS.cargar(); }
    if (id === 'fRx') cargarArchivos();
    if (id === 'fTrat' && window.PD_TRATAMIENTOS) window.PD_TRATAMIENTOS.cargar(actual);
    if (id === 'fHistoria' && window.PD_HISTORIAS) window.PD_HISTORIAS.cargar(actual);
    if (id === 'fRecetas' && window.PD_RECETAS) window.PD_RECETAS.cargar(actual);
    if (id === 'fLab' && window.PD_LAB) window.PD_LAB.cargar(actual);
  }

  // Médico principal por defecto: el primer dentista activo marcado como principal (si no hay, el primero activo)
  function medicoPorDefecto() {
    var p = medicos.filter(function (m) { return m.rol_sala !== 'alterno'; })[0] || medicos[0];
    return p ? String(p.id) : '';
  }
  function opcionesMedicos(elegido) {
    var lista = medicos.slice();
    // Si el paciente tiene un médico que ya no está activo, se muestra igual
    if (elegido && !lista.some(function (m) { return m.id === elegido; }) && actual && actual.medico) lista.push({ id: elegido, nombre: actual.medico.nombre + ' (inactivo)', rol_sala: 'alterno' });
    $('pDentista').innerHTML = '<option value="">Sin asignar</option>' + lista.map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.nombre) + (m.rol_sala === 'alterno' ? ' · alterno' : ' · principal') + '</option>';
    }).join('');
    $('pDentista').value = elegido ? String(elegido) : '';
  }
  async function cargarMedicos() {
    var r = await Promise.all([window.PD_DENTISTAS ? window.PD_DENTISTAS() : [], window.PD_AGENTES ? window.PD_AGENTES() : []]);
    medicos = r[0]; agentesCat = r[1];
    await cargarUsuarios();
  }

  // Usuario del portal: los usuarios de tipo Cliente que no estén asignados a otro paciente.
  // Si la columna pacientes.usuario aún no existe (falta el SQL), el campo queda deshabilitado.
  async function cargarUsuarios() {
    var r = await Promise.all([
      sb.from('perfiles').select('usuario,nombre').eq('rol', 'cliente').order('usuario'),
      sb.from('pacientes').select('id,usuario').not('usuario', 'is', null),
      sb.from('dentistas').select('usuario').not('usuario', 'is', null)
    ]);
    hayUsuario = !r[1].error;
    clientes = r[0].error ? [] : (r[0].data || []);
    usuariosTomados = {};
    (r[1].data || []).forEach(function (p) { usuariosTomados[p.usuario] = p.id; });
    (r[2].error ? [] : r[2].data || []).forEach(function (d) { usuariosTomados[d.usuario] = 'dentista'; });
  }
  function opcionesUsuarios(p) {
    var sel = $('pUsuario'), elegido = (p && p.usuario) || '';
    if (!hayUsuario) {
      sel.innerHTML = '<option value="">Falta ejecutar supabase.sql</option>';
      sel.title = 'Ejecuta en Supabase el script actualizado para asignar usuarios a los pacientes.';
      sel.disabled = true; return;
    }
    sel.disabled = false; sel.title = 'Usuario de tipo Cliente con el que el paciente ve su expediente («Mi expediente»).';
    var lista = clientes.filter(function (c) { var t = usuariosTomados[c.usuario]; return !t || (p && t === p.id); });
    if (elegido && !lista.some(function (c) { return c.usuario === elegido; })) lista.unshift({ usuario: elegido });
    sel.innerHTML = '<option value="">Sin usuario</option>' + lista.map(function (c) {
      return '<option value="' + esc(c.usuario) + '"' + (c.nombre && c.nombre !== c.usuario ? ' title="' + esc(c.nombre) + '"' : '') + '>' + esc(c.usuario) + '</option>';
    }).join('') + (lista.length ? '' : '<option value="" disabled>— No hay usuarios Cliente disponibles —</option>');
    sel.value = elegido;
  }

  // Agente comercial: lista del catálogo (solo activos, más el que ya tenga el paciente). Por defecto el 0 «NINGUNO».
  function agenteCero() { var a = agentesCat.filter(function (x) { return x.codigo === '0'; })[0]; return a ? String(a.id) : ''; }
  function opcionesAgentes(elegido) {
    var lista = agentesCat.filter(function (a) { return a.estado === 'activo' || a.id === elegido; });
    $('pAgente').innerHTML = lista.length ? lista.map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.codigo + ' · ' + a.nombre) + (a.estado !== 'activo' ? ' (' + a.estado + ')' : '') + '</option>';
    }).join('') : '<option value="">0 · NINGUNO</option>';
    $('pAgente').value = elegido && lista.some(function (a) { return a.id === elegido; }) ? String(elegido) : agenteCero();
  }

  function rellenar(p) {
    Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = (p && p[k]) || ''; });
    $('pEstado').value = (p && p.estado) || 'activo';
    opcionesMedicos(p ? p.dentista_id : null);
    if (!p) $('pDentista').value = medicoPorDefecto();
    opcionesAgentes(p ? p.agente_id : null);
    opcionesUsuarios(p);
    if (window.PD_SEDES) window.PD_SEDES.llenar($('pOrg'), $('pLoc'), p ? p.localidad_id : null);
    pintarDerivados();
  }

  // Edad (calculada) y color del estado
  function pintarDerivados() {
    $('pEdad').textContent = $('pNacimiento').value ? edad($('pNacimiento').value) : '—';
    $('pEstado').dataset.estado = $('pEstado').value;
  }

  // Modo consulta / modo edición ("Modificar registro")
  function aplicarModo() {
    $('pDatosCampos').disabled = !editando;
    document.querySelectorAll('[data-exp-accion]').forEach(function (b) {
      var a = b.dataset.expAccion;
      b.hidden = a === 'editar' ? (editando || !actual) : !editando;
    });
  }
  function editar() {
    editando = true;
    if (!$('pDentista').value) $('pDentista').value = medicoPorDefecto();
    aplicarModo();
    aviso('fDatosMsg', 'Modo edición: haz los cambios y pulsa «Guardar».');
    $('pNombre').focus();
  }
  function cancelar() {
    if (!actual) { verLista(); return; }
    rellenar(actual);
    editando = false;
    aplicarModo();
    aviso('fDatosMsg', 'Se descartaron los cambios.');
  }

  // ---------- Foto del paciente ----------
  async function pintarFoto() {
    var vista = $('pFotoVista');
    $('pFotoBtn').disabled = !actual;
    $('pFotoBtn').textContent = actual && actual.foto ? 'Cambiar foto' : 'Subir foto';
    aviso('pFotoMsg', actual ? '' : 'Podrás agregar la foto después de guardar los datos.');
    vista.innerHTML = esc(iniciales(actual ? actual.nombre : $('pNombre').value || '?'));
    if (!actual || !actual.foto) return;
    var u = await sb.storage.from(BUCKET).createSignedUrl(actual.foto, 3600);
    if (!u.error && actual && actual.foto) vista.innerHTML = '<img src="' + esc(u.data.signedUrl) + '" alt="Foto de ' + esc(actual.nombre) + '">';
  }

  // Reduce la foto a 600 px como máximo y la convierte a JPG
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
    $('pFotoBtn').disabled = true;
    aviso('pFotoMsg', 'Subiendo foto…');
    try {
      var blob = await reducirImagen(archivo);
      var ruta = 'fotos/' + actual.id + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      if (actual.foto !== ruta) {
        var r = await sb.from('pacientes').update({ foto: ruta }).eq('id', actual.id).select('*').single();
        if (r.error) throw r.error;
        actual = r.data;
      }
      aviso('pFotoMsg', 'Foto guardada.');
      await pintarFoto();
      pintarCabecera();
    } catch (e) {
      aviso('pFotoMsg', e.message && /válida|procesar/.test(e.message) ? e.message : traducir(e), true);
    } finally {
      $('pFotoBtn').disabled = !actual;
    }
  }

  function pintarCabecera() {
    $('expNombre').textContent = actual ? actual.nombre : 'Nuevo paciente';
    $('expSub').textContent = actual
      ? [actual.dpi ? 'DPI ' + actual.dpi : '', actual.fecha_nacimiento ? edad(actual.fecha_nacimiento) : ''].filter(Boolean).join(' · ')
      : 'Llena los datos y guarda para crear el expediente. Después podrás completar las demás partes.';
    var est = actual && (actual.estado || 'activo');
    $('expEstado').hidden = !actual;
    if (actual) { $('expEstado').className = 'estado estado-' + est; $('expEstado').textContent = ESTADOS_PAC[est]; }
    // Encabezado de la pestaña Datos: nombre, estado, edad, DPI y NIT
    $('pPerfilNombre').textContent = actual ? actual.nombre : ($('pNombre').value.trim() || 'Nuevo paciente');
    // Anillo del color de su médico alrededor de la foto del paciente
    var colorMed = actual && window.PD_COLOR ? window.PD_COLOR.color(actual.dentista_id) : null;
    if (colorMed) { $('pFotoVista').style.setProperty('--med', colorMed); $('pFotoVista').style.setProperty('--med-linea', window.PD_COLOR.linea(colorMed)); }
    else { $('pFotoVista').style.removeProperty('--med'); $('pFotoVista').style.removeProperty('--med-linea'); }
    $('pPerfilChips').innerHTML = actual ? [
      '<span class="pac-chip est-' + est + '">' + ESTADOS_PAC[est] + '</span>',
      actual.fecha_nacimiento ? '<span class="pac-chip">' + edad(actual.fecha_nacimiento) + '</span>' : '',
      actual.dpi ? '<span class="pac-chip">DPI ' + esc(actual.dpi) + '</span>' : '',
      actual.nit ? '<span class="pac-chip">NIT ' + esc(actual.nit) + '</span>' : '',
      // Color del paciente: el de su médico asignado (se cambia desde la ficha del odontólogo)
      window.PD_COLOR && window.PD_COLOR.color(actual.dentista_id) ? '<span class="pac-chip pac-med"' + window.PD_COLOR.estilo(actual.dentista_id) + ' title="Se cambia en Catálogos iniciales › Odontólogos">' + window.PD_COLOR.punto(actual.dentista_id) + esc(window.PD_COLOR.nombrePaleta(window.PD_COLOR.color(actual.dentista_id))) + (actual.medico ? ' · ' + esc(actual.medico.nombre) : '') + '</span>' : ''].join('') : '';
    $('pMeta').hidden = !actual;
    if (actual) {
      $('pMeta').innerHTML = '<span>Paciente desde <b>' + fechaHoraCorta(actual.creado) + '</b></span>' +
        '<span>Registrado por <b>' + esc(actual.registrado_por || '—') + '</b></span>' +
        '<span>Última modificación <b>' + fechaHoraCorta(actual.actualizado) + '</b>' + (actual.actualizado_por ? ' por <b>' + esc(actual.actualizado_por) + '</b>' : '') + '</span>';
    }
    // Las demás partes necesitan un expediente ya guardado
    document.querySelectorAll('#fichaTabs [data-ficha]').forEach(function (b) { if (b.dataset.ficha !== 'fDatos') b.disabled = !actual; });
  }

  async function abrir(id) {
    aviso('expMsg', '');
    await cargarMedicos();
    var r = await sb.from('pacientes').select('*,medico:dentistas(nombre)').eq('id', id).single();
    if (r.error && /dentista/.test(r.error.message)) r = await sb.from('pacientes').select('*').eq('id', id).single();
    if (r.error) { aviso('expMsg', traducir(r.error), true); return; }
    actual = r.data;
    cargarOdonto();
    rellenar(actual);
    ['fDatosMsg', 'fHistoriaMsg', 'notaMsg', 'rxMsg'].forEach(function (m) { aviso(m, ''); });
    editando = false;
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    $('expLista').hidden = true; $('expFicha').hidden = false;
    parte('fDatos');
    $('expFicha').scrollIntoView({ block: 'start' });
  }

  async function nuevo() {
    await cargarMedicos();
    actual = null;
    cargarOdonto();
    rellenar(null);
    ['fDatosMsg', 'fHistoriaMsg', 'notaMsg', 'rxMsg'].forEach(function (m) { aviso(m, ''); });
    editando = true;
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    $('expLista').hidden = true; $('expFicha').hidden = false;
    parte('fDatos');
    $('pNombre').focus();
  }

  function valores(claves) {
    var o = {};
    claves.forEach(function (k) { var v = $(CAMPOS[k]).value.trim(); o[k] = v === '' ? null : v; });
    if (claves.indexOf('nombre') >= 0) {
      o.dentista_id = $('pDentista').value ? +$('pDentista').value : null;
      o.agente_id = $('pAgente').value ? +$('pAgente').value : null;   // vacío = Supabase pone el agente 0
      if (hayUsuario) o.usuario = $('pUsuario').value || null;
      if (window.PD_SEDES && $('pLoc').options.length > 1) Object.assign(o, window.PD_SEDES.valores($('pOrg'), $('pLoc')));
    }
    return o;
  }

  async function guardar(claves, msgId, boton) {
    var datos = valores(claves);
    if (claves.indexOf('nombre') >= 0 && !datos.nombre) { aviso(msgId, 'El nombre es obligatorio.', true); return; }
    boton.disabled = true;
    aviso(msgId, 'Guardando…');
    var r = actual
      ? await sb.from('pacientes').update(datos).eq('id', actual.id).select('*,medico:dentistas(nombre)').single()
      : await sb.from('pacientes').insert(datos).select('*,medico:dentistas(nombre)').single();
    boton.disabled = false;
    if (r.error) { aviso(msgId, traducir(r.error), true); return; }
    var eraNuevo = !actual;
    actual = r.data;
    if (hayUsuario) { Object.keys(usuariosTomados).forEach(function (u) { if (usuariosTomados[u] === actual.id) delete usuariosTomados[u]; }); if (actual.usuario) usuariosTomados[actual.usuario] = actual.id; }
    if (eraNuevo) cargarOdonto();
    rellenar(actual);
    editando = false;
    aplicarModo();
    pintarCabecera();
    pintarFoto();
    aviso(msgId, eraNuevo ? 'Expediente creado. Ya puedes completar la historia médica, el odontograma, las notas y las radiografías.' : 'Cambios guardados.');
  }

  // ---------- Odontograma (componente de odontograma.js) ----------
  // base = lo último guardado; los cambios pendientes salen de comparar contra ella.
  // meta guarda, por pieza, la fecha del cambio y las observaciones escritas antes de guardar.
  var base = null, meta = {}, pendientes = [], historial = [];
  // Abrir el expediente de un paciente desde otras pantallas (p. ej. la agenda)
  window.PD_EXPEDIENTE = {
    abrir: function (id) {
      if ($('tabExpedientes')) $('tabExpedientes').click();
      abrir(id);
      var p = $('admExpedientes'); if (p) p.scrollIntoView({ block: 'start' });
    }
  };
  window.PD_ODG_GET = function () { return typeof odg !== 'undefined' ? odg : null; };
  window.PD_ODONTOGRAMA_ACTUAL = function () { return typeof odg !== 'undefined' && odg ? odg.valor() : null; };
  var odg = window.Odontograma.crear($('odoComp'), {
    onCambio: function () { revisarCambios(); },
    paciente: function () { return actual ? actual.nombre : ''; },
    // Solo el Super Administrador modifica procedimientos, precios y datos del presupuesto
    esSuper: function () { return !!(window.PD_SESION && window.PD_SESION.esSuper()); },
    // Presupuesto en borrador con los tratamientos requeridos (d.items) y el tipo de precio elegido (d.tipo)
    crearPresupuesto: async function (d) {
      if (!actual) throw new Error('Primero guarda el expediente del paciente.');
      var r = await sb.from('presupuestos').insert({ paciente_id: actual.id, origen: 'odontograma' }).select('id').single();
      if (r.error && /origen/.test(r.error.message || '')) r = await sb.from('presupuestos').insert({ paciente_id: actual.id }).select('id').single();
      if (r.error) throw new Error(traducir(r.error));
      var g = await sb.rpc('guardar_presupuesto', { p_id: r.data.id, p_descuento: 0, p_notas: '', p_items: d.items, p_tipo: d.tipo,
        p_forma_pago: d.forma_pago || 'efectivo', p_cuotas: d.cuotas, p_citas: d.citas, p_sin_recargo: !!d.sin_recargo });
      if (g.error) {
        var falta = /guardar_presupuesto|could not find the function/i.test(g.error.message || '');
        throw new Error('Se creó el presupuesto N.º ' + r.data.id + ', pero no se pudieron agregar los tratamientos: ' +
          (falta ? 'falta ejecutar en Supabase el script actualizado (supabase.sql).' : traducir(g.error)));
      }
      // Estado elegido: Activo queda en borrador; Aprobado y No aprobado se aplican al crear
      var estadoBd = { aprobado: 'aprobado', no_aprobado: 'rechazado' }[d.estado];
      if (estadoBd) await sb.from('presupuestos').update({ estado: estadoBd }).eq('id', r.data.id);
      var c = await sb.from('presupuestos').select('codigo').eq('id', r.data.id).maybeSingle();
      cargarCodigoPresupuesto();
      cargarPresupuestoActual();
      return { id: r.data.id, codigo: !c.error && c.data ? c.data.codigo : null };
    },
    // Reporte impreso con el logo: paciente, médico asignado y los procedimientos requeridos con su valor
    // Guardar forma de pago, cuotas y citas del presupuesto ya creado (sube la versión)
    guardarPresupuesto: async function (p, d) {
      var items = (p.presupuesto_items || []).slice().sort(function (a, b) { return a.orden - b.orden || a.id - b.id; })
        .map(function (i) { return { tratamiento: i.tratamiento, pieza: i.pieza || '', cantidad: i.cantidad, precio: Number(i.precio) }; });
      var g = await sb.rpc('guardar_presupuesto', { p_id: p.id, p_descuento: Number(p.descuento_pct) || 0, p_notas: p.notas || '', p_items: items, p_tipo: p.tipo_precio || 'directo',
        p_forma_pago: d.forma, p_cuotas: d.forma === 'tarjeta' ? d.cuotas : null, p_citas: d.citas ? +d.citas : null, p_sin_recargo: d.forma === 'tarjeta' && !!d.sinRecargo });
      if (g.error) throw new Error(/guardar_presupuesto|could not find the function/i.test(g.error.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql).' : traducir(g.error));
      await cargarPresupuestoActual();
    },
    // Estado de un procedimiento del presupuesto (Pendiente, Proceso, Finalizado, Eliminado)
    cambiarEstadoItem: async function (itemId, estado) {
      var r = await sb.rpc('cambiar_estado_item', { p_item: itemId, p_estado: estado });
      if (r.error) throw new Error(/cambiar_estado_item|could not find the function/i.test(r.error.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql).' : traducir(r.error));
      await cargarPresupuestoActual();
    },
    // Cambiar estado (borrador = Activo, aprobado, rechazado = No aprobado); las fechas las registra la base de datos
    cambiarEstadoPresupuesto: async function (p, estado) {
      if (estado === 'aprobado' && !(p.presupuesto_items || []).length) throw new Error('El presupuesto no tiene tratamientos; no se puede aprobar.');
      var r = await sb.from('presupuestos').update({ estado: estado }).eq('id', p.id).select('id');
      if (r.error || !r.data || !r.data.length) throw new Error(r.error ? traducir(r.error) : 'No tienes permiso para esta acción.');
      await cargarPresupuestoActual();
    },
    imprimir: function (d) { return imprimirPresupuesto(d); },
    puedeAbrirPresupuesto: function () { return !!($('tabPresupuestos') && window.PD_PRESUPUESTOS); },
    abrirPresupuesto: function (id) { $('tabPresupuestos').click(); window.PD_PRESUPUESTOS.abrir(id); }
  });

  // Procedimientos y precios para el odontograma: catálogo de tratamientos (con sus precios por tipo)
  // y los procedimientos sugeridos de «Tipos de procedimientos» que aún no están en el catálogo.
  // Código que tendrá el próximo presupuesto del paciente: PACIENTE-AÑO-CORRELATIVO-V01 (lo asigna la base de datos)
  // Reporte del presupuesto: logo, todos los datos del presupuesto en el encabezado y el detalle con valores
  var COLOR_ESTADO = { activo: ['#DBEAFE', '#1E40AF'], aprobado: ['#DCF2EC', '#08504C'], proceso: ['#FEF3C7', '#92400E'], finalizado: ['#E5E7EB', '#374151'], no_aprobado: ['#FDE2E4', '#9F1239'] };
  async function imprimirPresupuesto(d) {
    var imp = window.PD_IMPRESION, i = d.info;
    if (!imp || !actual || !i) return;
    var idMedico = actual.dentista_id || ($('pDentista').value ? +$('pDentista').value : null);
    var firma = window.PD_FIRMA ? await window.PD_FIRMA.cargar(idMedico, actual.medico && actual.medico.nombre) : null;
    var dinero = function (n) { return 'Q' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var medico = actual.medico && actual.medico.nombre ? actual.medico.nombre
      : ($('pDentista').value && $('pDentista').selectedOptions[0] ? $('pDentista').selectedOptions[0].text : 'Sin asignar');
    var ce = COLOR_ESTADO[i.estadoClave] || COLOR_ESTADO.activo;
    var celda = 'padding:7px 6px;border-bottom:1px solid #D9E4EC';
    var th = celda + ';background:#0B2B40;color:#FFFFFF;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em';
    var dato = function (k, v, ancho) {
      return '<div style="min-width:0' + (ancho ? ';grid-column:' + ancho : '') + '"><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + k + '</span>' +
        '<b style="font-size:13.5px;overflow-wrap:anywhere">' + v + '</b></div>';
    };
    var sec = function (t) { return '<div style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#005A87;font-weight:800;margin:16px 0 8px;border-bottom:1px solid #D9E4EC;padding-bottom:4px">' + t + '</div>'; };
    var grilla = function (h) { return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px">' + h + '</div>'; };
    var html = imp.encabezado('Presupuesto') +
      // Código y estado destacados
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:10px 14px">' +
      '<div><span style="display:block;font-size:10px;color:#5A6D7A;letter-spacing:.12em;font-weight:800">CÓDIGO DEL PRESUPUESTO</span><b style="font-size:18px;letter-spacing:.03em">' + esc(i.codigo) + '</b></div>' +
      '<span style="border-radius:999px;padding:5px 14px;font-size:12px;font-weight:800;background:' + ce[0] + ';color:' + ce[1] + '">' + esc(i.estado).toUpperCase() + '</span></div>' +
      sec('Paciente') + grilla(dato('Paciente', esc(actual.nombre), 'span 2') + dato('Médico asignado', esc(medico)) + dato('NIT', esc(actual.nit || 'CF'))) +
      sec('Datos del presupuesto') + grilla(
        dato('Fecha del presupuesto', esc(i.fecha)) + dato('Elaborado por', esc(i.usuario || '—')) + dato('Tipo de precio', esc(i.tipo)) + dato('Cantidad de citas', esc(i.citas || '—')) +
        dato('Fecha cambio de estado', esc(i.cambio)) + dato('Fecha de aprobación', esc(i.aprobado)) + dato('Forma de pago', esc(i.formaTexto)) + dato('Plan de pago', esc(i.plan || '—'))) +
      sec('Detalle') +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>' +
      '<th style="' + th + ';text-align:left">Pieza</th><th style="' + th + ';text-align:left">Hallazgo</th><th style="' + th + ';text-align:left">Procedimiento</th>' +
      '<th style="' + th + ';text-align:right">Cant.</th><th style="' + th + ';text-align:right">Precio</th><th style="' + th + ';text-align:right">Total</th></tr></thead><tbody>' +
      (d.lineas.length ? d.lineas.map(function (l) {
        return '<tr><td style="' + celda + ';font-weight:700">' + esc(l.pieza) + '</td><td style="' + celda + '">' + esc(l.hallazgo) + '</td><td style="' + celda + '">' + esc(l.procedimiento) + '</td>' +
          '<td style="' + celda + ';text-align:right">' + l.cantidad + '</td><td style="' + celda + ';text-align:right">' + dinero(l.precio) + '</td><td style="' + celda + ';text-align:right">' + dinero(l.total) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="' + celda + '">No hay procedimientos con valor.</td></tr>') +
      '</tbody></table>' +
      // Totales
      '<div style="display:flex;justify-content:flex-end;margin-top:10px"><table style="border-collapse:collapse;font-size:13px;min-width:280px">' +
      (i.descuento ? '<tr><td style="padding:4px 8px;color:#5A6D7A">Subtotal</td><td style="padding:4px 8px;text-align:right">' + dinero(i.subtotal) + '</td></tr>' +
        '<tr><td style="padding:4px 8px;color:#5A6D7A">Descuento (' + i.descuento + ' %)</td><td style="padding:4px 8px;text-align:right">−' + dinero(i.subtotal - i.total) + '</td></tr>' : '') +
      '<tr><td style="padding:6px 8px;font-weight:800;background:#EEF5FA;border-top:2px solid #0B2B40">TOTAL</td><td style="padding:6px 8px;text-align:right;font-weight:800;background:#EEF5FA;border-top:2px solid #0B2B40">' + dinero(i.total) + '</td></tr>' +
      (i.totalPagar != null ? '<tr><td style="padding:6px 8px;color:#5A6D7A">' + esc(i.plan) + '</td><td></td></tr><tr><td style="padding:6px 8px;font-weight:800;background:#0B2B40;color:#FFFFFF">TOTAL A PAGAR CON TARJETA</td><td style="padding:6px 8px;text-align:right;font-weight:800;background:#0B2B40;color:#FFFFFF">' + dinero(i.totalPagar) + '</td></tr>' : '') +
      '</table></div>' +
      (i.notas ? sec('Notas') + '<div style="font-size:12.5px;white-space:pre-line">' + esc(i.notas) + '</div>' : '') +
      '<p style="margin-top:14px;font-size:11.5px;color:#5A6D7A">Precios con IVA incluido. ' + (i.existe ? 'Datos del presupuesto al momento de imprimir.' : 'Presupuesto aún no confirmado: valores estimados según el odontograma.') + ' El costo final se confirma en la evaluación clínica.</p>' +
      (firma ? window.PD_FIRMA.conPaciente(firma, 'Firma del paciente', actual.nombre) : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:46px;font-size:12px;text-align:center;color:#475B68">' +
      '<div style="border-top:1px solid #0B2B40;padding-top:6px">' + esc(medico) + '</div><div style="border-top:1px solid #0B2B40;padding-top:6px">Firma del paciente</div></div>') + '</div>';
    imp.imprimir(html);
  }

  // Último presupuesto del paciente creado desde el odontograma
  async function cargarPresupuestoActual() {
    if (!actual) return;
    var pid = actual.id;
    var r = await sb.from('presupuestos').select('*,presupuesto_items(*)')
      .eq('paciente_id', pid).eq('origen', 'odontograma').order('id', { ascending: false }).limit(1);
    if (!actual || actual.id !== pid) return;
    odg.presupuestoActual(!r.error && r.data && r.data.length ? r.data[0] : null);
  }
  async function cargarCodigoPresupuesto() {
    if (!actual) return;
    var pid = actual.id, anio = new Date().getFullYear();
    var r = await sb.from('presupuestos').select('correlativo').eq('paciente_id', pid).eq('anio', anio).order('correlativo', { ascending: false }).limit(1);
    if (!actual || actual.id !== pid) return;
    if (r.error) { odg.codigoPresupuesto(''); return; }
    var sig = (r.data.length ? Number(r.data[0].correlativo) || 0 : 0) + 1;
    odg.codigoPresupuesto(String(pid).padStart(4, '0') + '-' + anio + '-' + String(sig).padStart(3, '0') + '-V01');
  }
  document.addEventListener('pd-recargos', function () { odg.recargos(); });
  var catalogoOdgCargado = 0;
  async function cargarCatalogoOdg() {
    if (Date.now() - catalogoOdgCargado < 120000) return;
    var r = await Promise.all([
      sb.from('tratamientos').select('id,nombre,precio,activo,tipo_id').order('nombre'),
      sb.from('precios').select('tratamiento_id,tipo,valor,estado,localidad_id'),
      sb.from('tipos_procedimiento').select('id,nombre,estado,orden,sugeridos').order('orden')
    ]);
    if (r[0].error) return;
    if (window.PD_SEDES && r[1].data) { await window.PD_SEDES.cargar(); r[1].data = window.PD_SEDES.deSede(r[1].data, actual ? actual.localidad_id : null); }
    var tipos = r[2].error ? [] : r[2].data.filter(function (t) { return t.estado === 'activo'; });
    var nombreTipo = {}, ordenTipo = {};
    tipos.forEach(function (t, i) { nombreTipo[t.id] = t.nombre; ordenTipo[t.id] = i; });
    var precios = {};
    (r[1].error ? [] : r[1].data).forEach(function (p) {
      if (p.estado !== 'activo') return;
      (precios[p.tratamiento_id] = precios[p.tratamiento_id] || {})[p.tipo] = Number(p.valor);
    });
    var lista = r[0].data.filter(function (t) { return t.activo; }).map(function (t) {
      return { id: t.id, nombre: t.nombre, tipo: nombreTipo[t.tipo_id] || '', orden: t.tipo_id in ordenTipo ? ordenTipo[t.tipo_id] : 999, base: Number(t.precio) || 0, precios: precios[t.id] || {} };
    });
    var ya = {};
    lista.forEach(function (c) { ya[c.nombre.toLowerCase()] = true; });
    tipos.forEach(function (t, i) {
      (t.sugeridos || []).forEach(function (n) {
        if (ya[n.toLowerCase()]) return;
        ya[n.toLowerCase()] = true;
        lista.push({ id: null, nombre: n, tipo: t.nombre, orden: i, base: 0, precios: {} });
      });
    });
    lista.sort(function (a, b) { return a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'); });
    catalogoOdgCargado = Date.now();
    odg.catalogo(lista);
  }

  function dos(n) { return ('0' + n).slice(-2); }
  function valorFechaHora(d) {
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + 'T' + dos(d.getHours()) + ':' + dos(d.getMinutes()) + ':' + dos(d.getSeconds());
  }
  function fechaHora(f) {
    return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
  }

  function cargarOdonto() {
    odg.cargar(actual ? actual.odontograma : null, actual ? anios(actual.fecha_nacimiento) : null);
    base = odg.valor();
    meta = {};
    revisarCambios();
    var n = odg.hallazgos();
    aviso('odoMsg', n ? n + ' pieza(s) con hallazgos.' : 'Sin hallazgos registrados.');
    historial = [];
    $('odoHist').innerHTML = '';
    aviso('odoHistMsg', '');
  }

  function revisarCambios() {
    pendientes = base ? window.Odontograma.diferencias(base, odg.valor()) : [];
    odontoCambiado = pendientes.length > 0;
    pendientes.forEach(function (c) { if (!meta[c.clave]) meta[c.clave] = { fecha: valorFechaHora(new Date()), obs: '' }; });
    $('odoPend').hidden = !pendientes.length;
    $('odoGuardar').disabled = !pendientes.length;
    $('odoDescartar').disabled = !pendientes.length;
    $('odoPendBody').innerHTML = pendientes.map(function (c) {
      var m = meta[c.clave], de = c.pieza ? ' de la pieza ' + c.pieza : '';
      return '<tr data-clave="' + esc(c.clave) + '"><td class="fecha"><strong>' + (c.pieza || 'General') + '</strong></td><td>' + esc(c.descripcion) + '</td>' +
        '<td style="min-width:215px"><input type="datetime-local" step="1" class="odo-input" data-m="fecha" value="' + m.fecha + '" aria-label="Fecha del cambio' + de + '"></td>' +
        '<td style="min-width:220px"><input type="text" maxlength="1000" class="odo-input" data-m="obs" value="' + esc(m.obs) + '" placeholder="Opcional" aria-label="Observaciones' + de + '"></td></tr>';
    }).join('');
    if (pendientes.length) aviso('odoMsg', pendientes.length + ' cambio(s) sin guardar.', true);
  }

  async function guardarOdonto(boton) {
    if (!pendientes.length || !actual) return;
    var cambios = pendientes.map(function (c) {
      var m = meta[c.clave], f = m.fecha ? new Date(m.fecha) : new Date();
      return { pieza: c.pieza, descripcion: c.descripcion, fecha_cambio: (isNaN(f) ? new Date() : f).toISOString(), observaciones: m.obs };
    });
    var valor = odg.valor();
    boton.disabled = true;
    aviso('odoMsg', 'Guardando…');
    var r = await sb.rpc('guardar_odontograma', { p_paciente: actual.id, p_odontograma: valor, p_cambios: cambios });
    if (r.error) { boton.disabled = false; aviso('odoMsg', traducir(r.error), true); return; }
    actual.odontograma = valor;
    actual.actualizado = new Date().toISOString();
    base = valor;
    meta = {};
    revisarCambios();
    pintarCabecera();
    aviso('odoMsg', cambios.length + ' cambio(s) guardado(s) en el historial.');
    cargarHistorial();
  }

  function eliminarCambios(boton) {
    if (!pedirConfirmacion(boton)) return;
    odg.cargar(base);
    meta = {};
    revisarCambios();
    aviso('odoMsg', 'Se eliminaron los cambios sin guardar. El odontograma quedó como estaba.');
  }

  async function cargarHistorial() {
    if (!actual) return;
    $('odoHist').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('odontograma_cambios').select('*').eq('paciente_id', actual.id)
      .order('fecha_cambio', { ascending: false }).order('id', { ascending: false });
    if (r.error) { $('odoHist').innerHTML = ''; aviso('odoHistMsg', traducir(r.error), true); return; }
    historial = r.data;
    pintarHistorial();
  }

  function pintarHistorial(editando) {
    $('odoHist').innerHTML = historial.length ? historial.map(function (h) {
      var pieza = h.pieza || 'General';
      if (String(h.id) === String(editando)) {
        return '<tr data-hist="' + h.id + '"><td style="min-width:215px"><input type="datetime-local" step="1" class="odo-input" data-e="fecha" value="' + valorFechaHora(new Date(h.fecha_cambio)) + '" aria-label="Fecha del cambio"></td>' +
          '<td class="fecha"><strong>' + pieza + '</strong></td><td>' + esc(h.descripcion) + '</td>' +
          '<td style="min-width:220px"><input type="text" maxlength="1000" class="odo-input" data-e="obs" value="' + esc(h.observaciones || '') + '" aria-label="Observaciones"></td>' +
          '<td>' + esc(h.usuario || '—') + '</td><td><div class="acciones"><button type="button" class="adm-btn adm-primary" data-hist-guardar="' + h.id + '">Guardar</button>' +
          '<button type="button" class="adm-btn" data-hist-cancelar>Cancelar</button></div></td></tr>';
      }
      return '<tr><td class="odo-hora">' + fechaHora(h.fecha_cambio) + '</td><td class="fecha"><strong>' + pieza + '</strong></td>' +
        '<td>' + esc(h.descripcion) + '</td><td>' + esc(h.observaciones || '—') + '</td>' +
        '<td>' + esc(h.usuario || '—') + '<span class="odo-meta">Registrado ' + fechaHora(h.registrado_en) + '</span>' +
        (h.editado_en ? '<span class="odo-meta">Editado por ' + esc(h.editado_por || '—') + ' · ' + fechaHora(h.editado_en) + '</span>' : '') + '</td>' +
        '<td><button type="button" class="adm-btn" data-hist-editar="' + h.id + '" style="min-height:36px;padding:6px 12px">Editar</button></td></tr>';
    }).join('') : '<tr><td colspan="6">Todavía no hay cambios registrados. Se registran al guardar el odontograma.</td></tr>';
  }

  // ---------- Notas de visita ----------
  async function cargarNotas() {
    if (!actual) return;
    $('notaFecha').value = $('notaFecha').value || hoyISO();
    $('notaFecha').max = hoyISO();
    $('notaLista').innerHTML = '<li>Cargando…</li>';
    var r = await sb.from('notas_visita').select('id,fecha,texto,autor_usuario,creada').eq('paciente_id', actual.id)
      .order('fecha', { ascending: false }).order('creada', { ascending: false });
    if (r.error) { $('notaLista').innerHTML = ''; aviso('notaMsg', traducir(r.error), true); return; }
    $('notaLista').innerHTML = r.data.length
      ? r.data.map(function (n) {
        return '<li><div class="meta"><span><strong style="color:#0B2B40">' + fechaCorta(n.fecha) + '</strong>' + (n.autor_usuario ? ' · por ' + esc(n.autor_usuario) : '') + '</span>' +
          (esSuper() ? '<button type="button" class="adm-btn" data-borrar-nota="' + n.id + '" data-confirmar="0" style="min-height:36px;padding:6px 12px">Borrar</button>' : '') +
          '</div><div class="texto">' + esc(n.texto) + '</div></li>';
      }).join('')
      : '<li style="color:#5A6D7A">Todavía no hay notas de visita.</li>';
  }

  // ---------- Radiografías ----------
  function nombreSeguro(n) {
    return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80);
  }

  async function cargarArchivos() {
    if (!actual) return;
    var carpeta = String(actual.id);
    $('rxGrid').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await sb.storage.from(BUCKET).list(carpeta, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (r.error) { $('rxGrid').innerHTML = ''; aviso('rxMsg', traducir(r.error), true); return; }
    var archivos = r.data.filter(function (f) { return f.id; });
    if (!archivos.length) { $('rxGrid').innerHTML = '<p class="dlg-msg">Todavía no hay radiografías ni fotografías.</p>'; return; }
    var rutas = archivos.map(function (f) { return carpeta + '/' + f.name; });
    var u = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
    if (u.error) { $('rxGrid').innerHTML = ''; aviso('rxMsg', traducir(u.error), true); return; }
    $('rxGrid').innerHTML = archivos.map(function (f, i) {
      var url = u.data[i] && u.data[i].signedUrl;
      var esPdf = /\.pdf$/i.test(f.name);
      var visible = f.name.replace(/^\d+-/, '');
      return '<div class="rx-item"><a class="ver" href="' + esc(url) + '" target="_blank" rel="noopener" title="Abrir ' + esc(visible) + '">' +
        (esPdf ? '<span class="pdf">PDF</span>' : '<img src="' + esc(url) + '" alt="' + esc(visible) + '" loading="lazy">') + '</a>' +
        '<div class="pie"><span title="' + esc(visible) + '">' + fechaCorta(f.created_at) + ' · ' + esc(visible) + '</span>' +
        (esSuper() ? '<button type="button" class="adm-btn" data-borrar-rx="' + esc(rutas[i]) + '" data-confirmar="0" style="min-height:34px;padding:5px 10px">Borrar</button>' : '') +
        '</div></div>';
    }).join('');
  }

  async function subirArchivo(form) {
    var f = $('rxArchivo').files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { aviso('rxMsg', 'El archivo pesa más de 10 MB.', true); return; }
    var boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    aviso('rxMsg', 'Subiendo ' + f.name + '…');
    var ruta = actual.id + '/' + Date.now() + '-' + nombreSeguro(f.name);
    var r = await sb.storage.from(BUCKET).upload(ruta, f, { contentType: f.type, upsert: false });
    boton.disabled = false;
    if (r.error) { aviso('rxMsg', traducir(r.error), true); return; }
    form.reset();
    aviso('rxMsg', 'Archivo subido.');
    cargarArchivos();
  }

  // Borrar pide un segundo clic en el mismo botón (la página no puede usar confirm())
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
  $('expBuscar').addEventListener('input', pintarLista);
  $('expNuevo').addEventListener('click', nuevo);
  $('expVolver').addEventListener('click', verLista);
  $('expBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir]');
    if (b) abrir(b.dataset.abrir);
  });
  $('fichaTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ficha]');
    if (b && !b.disabled) parte(b.dataset.ficha);
  });

  document.querySelectorAll('[data-exp-accion]').forEach(function (b) {
    if (b.dataset.expAccion === 'editar') b.addEventListener('click', editar);
    if (b.dataset.expAccion === 'cancelar') b.addEventListener('click', cancelar);
  });
  $('pFotoBtn').addEventListener('click', function () { $('pFotoArchivo').click(); });
  $('pNacimiento').addEventListener('input', pintarDerivados);
  $('pEstado').addEventListener('change', pintarDerivados);
  $('pNombre').addEventListener('input', function () { if (!actual) $('pPerfilNombre').textContent = this.value.trim() || 'Nuevo paciente'; });
  $('pFotoArchivo').addEventListener('change', function () { var f = this.files[0]; this.value = ''; subirFoto(f); });
  $('expFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-efiltro]');
    if (b) { filtroEstado = b.dataset.efiltro; pintarLista(); }
  });

  $('fDatos').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editando) return;
    guardar(['nombre', 'dpi', 'nit', 'fecha_nacimiento', 'telefono', 'correo', 'direccion', 'emergencia_nombre', 'emergencia_telefono', 'estado'], 'fDatosMsg', this.querySelector('[type=submit]'));
  });

  $('odoGuardar').addEventListener('click', function () { guardarOdonto(this); });
  $('odoDescartar').addEventListener('click', function () { eliminarCambios(this); });
  $('odoPendBody').addEventListener('input', function (e) {
    var inp = e.target.closest('[data-m]');
    if (!inp) return;
    var m = meta[inp.closest('tr').dataset.clave];
    if (m) m[inp.dataset.m] = inp.value;
  });
  $('odoHist').addEventListener('click', async function (e) {
    var ed = e.target.closest('[data-hist-editar]');
    if (ed) { pintarHistorial(ed.dataset.histEditar); return; }
    if (e.target.closest('[data-hist-cancelar]')) { pintarHistorial(); return; }
    var g = e.target.closest('[data-hist-guardar]');
    if (!g) return;
    var fila = g.closest('tr'), f = new Date(fila.querySelector('[data-e=fecha]').value);
    if (isNaN(f)) { aviso('odoHistMsg', 'Escribe una fecha y hora válidas.', true); return; }
    g.disabled = true;
    var r = await sb.rpc('editar_cambio_odontograma', { p_id: +g.dataset.histGuardar, p_fecha: f.toISOString(), p_observaciones: fila.querySelector('[data-e=obs]').value });
    if (r.error) { g.disabled = false; aviso('odoHistMsg', traducir(r.error), true); return; }
    aviso('odoHistMsg', 'Registro actualizado.');
    cargarHistorial();
  });

  $('notaForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var texto = $('notaTexto').value.trim();
    if (!texto) return;
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('notaMsg', 'Guardando…');
    var r = await sb.from('notas_visita').insert({ paciente_id: actual.id, fecha: $('notaFecha').value || hoyISO(), texto: texto });
    boton.disabled = false;
    if (r.error) { aviso('notaMsg', traducir(r.error), true); return; }
    $('notaTexto').value = '';
    aviso('notaMsg', 'Nota agregada.');
    cargarNotas();
  });
  $('notaLista').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-nota]');
    if (!b || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('notas_visita').delete().eq('id', b.dataset.borrarNota);
    if (r.error) { b.disabled = false; aviso('notaMsg', traducir(r.error), true); return; }
    aviso('notaMsg', 'Nota borrada.');
    cargarNotas();
  });

  $('rxForm').addEventListener('submit', function (e) { e.preventDefault(); subirArchivo(this); });
  $('rxGrid').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-rx]');
    if (!b || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.storage.from(BUCKET).remove([b.dataset.borrarRx]);
    if (r.error) { b.disabled = false; aviso('rxMsg', traducir(r.error), true); return; }
    aviso('rxMsg', 'Archivo borrado.');
    cargarArchivos();
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if ($('expFicha').hidden) cargar(); },
    limpiar: function () {
      pacientes = []; actual = null; odontoCambiado = false;
      odg.cargar(null);
      base = odg.valor(); meta = {}; historial = [];
      revisarCambios();
      $('odoHist').innerHTML = '';
      rellenar(null);
      $('expBody').innerHTML = ''; $('notaLista').innerHTML = ''; $('rxGrid').innerHTML = '';
      $('expFicha').hidden = true; $('expLista').hidden = false;
    }
  });
})();
