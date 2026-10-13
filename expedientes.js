// Plus Dental — Expedientes de pacientes (solo Administrador y Super Administrador)
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var BUCKET = 'expedientes';
  var CAMPOS = {
    nombre: 'pNombre', dpi: 'pDpi', fecha_nacimiento: 'pNacimiento', telefono: 'pTelefono', direccion: 'pDireccion',
    emergencia_nombre: 'pEmNombre', emergencia_telefono: 'pEmTelefono',
    alergias: 'pAlergias', enfermedades: 'pEnfermedades', medicamentos: 'pMedicamentos'
  };

  var pacientes = [], actual = null, odontoCambiado = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#44585B'; }
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
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/pacientes_dpi_unico|duplicate key/i.test(m)) return 'Ya existe un paciente con ese DPI.';
    if (/relation .*(pacientes|notas_visita).* does not exist|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script de expedientes.';
    if (/bucket not found/i.test(m)) return 'Falta ejecutar en Supabase el script de expedientes (almacenamiento de radiografías).';
    if (/row-level security|permission denied|not authorized|unauthorized/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/exceeded the maximum allowed size|too large/i.test(m)) return 'El archivo pesa más de 10 MB.';
    if (/mime type/i.test(m)) return 'Solo se aceptan imágenes JPG, PNG, WEBP o archivos PDF.';
    return 'No se pudo completar: ' + m;
  }

  // ---------- Lista ----------
  async function cargar() {
    aviso('expMsg', '');
    $('expBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('pacientes').select('id,nombre,dpi,telefono,fecha_nacimiento,actualizado').order('nombre');
    if (r.error) { $('expBody').innerHTML = ''; aviso('expMsg', traducir(r.error), true); return; }
    pacientes = r.data;
    pintarLista();
  }

  function pintarLista() {
    var q = $('expBuscar').value.trim().toLowerCase();
    var lista = pacientes.filter(function (p) {
      return !q || [p.nombre, p.dpi, p.telefono].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; });
    });
    if (!lista.length) {
      $('expBody').innerHTML = '<tr><td colspan="6">' + (q ? 'Ningún paciente coincide con «' + esc(q) + '».' : 'Todavía no hay expedientes. Crea el primero con «Nuevo paciente».') + '</td></tr>';
      return;
    }
    $('expBody').innerHTML = lista.map(function (p) {
      return '<tr><td><strong>' + esc(p.nombre) + '</strong></td><td>' + esc(p.dpi || '—') + '</td><td>' + esc(p.telefono || '—') + '</td>' +
        '<td class="fecha">' + edad(p.fecha_nacimiento) + '</td><td class="fecha">' + fechaCorta(p.actualizado) + '</td>' +
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
    if (id === 'fRx') cargarArchivos();
  }

  function rellenar(p) {
    Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = (p && p[k]) || ''; });
  }

  function pintarCabecera() {
    $('expNombre').textContent = actual ? actual.nombre : 'Nuevo paciente';
    $('expSub').textContent = actual
      ? [actual.dpi ? 'DPI ' + actual.dpi : '', actual.fecha_nacimiento ? edad(actual.fecha_nacimiento) : '', 'Actualizado ' + fechaCorta(actual.actualizado)].filter(Boolean).join(' · ')
      : 'Llena los datos y guarda para crear el expediente. Después podrás completar las demás partes.';
    // Las demás partes necesitan un expediente ya guardado
    document.querySelectorAll('#fichaTabs [data-ficha]').forEach(function (b) { if (b.dataset.ficha !== 'fDatos') b.disabled = !actual; });
  }

  async function abrir(id) {
    aviso('expMsg', '');
    var r = await sb.from('pacientes').select('*').eq('id', id).single();
    if (r.error) { aviso('expMsg', traducir(r.error), true); return; }
    actual = r.data;
    cargarOdonto();
    rellenar(actual);
    ['fDatosMsg', 'fHistoriaMsg', 'notaMsg', 'rxMsg'].forEach(function (m) { aviso(m, ''); });
    pintarCabecera();
    $('expLista').hidden = true; $('expFicha').hidden = false;
    parte('fDatos');
    $('expFicha').scrollIntoView({ block: 'start' });
  }

  function nuevo() {
    actual = null;
    cargarOdonto();
    rellenar(null);
    ['fDatosMsg', 'fHistoriaMsg', 'notaMsg', 'rxMsg'].forEach(function (m) { aviso(m, ''); });
    pintarCabecera();
    $('expLista').hidden = true; $('expFicha').hidden = false;
    parte('fDatos');
    $('pNombre').focus();
  }

  function valores(claves) {
    var o = {};
    claves.forEach(function (k) { var v = $(CAMPOS[k]).value.trim(); o[k] = v === '' ? null : v; });
    return o;
  }

  async function guardar(claves, msgId, boton) {
    var datos = valores(claves);
    if (claves.indexOf('nombre') >= 0 && !datos.nombre) { aviso(msgId, 'El nombre es obligatorio.', true); return; }
    boton.disabled = true;
    aviso(msgId, 'Guardando…');
    var r = actual
      ? await sb.from('pacientes').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('pacientes').insert(datos).select('*').single();
    boton.disabled = false;
    if (r.error) { aviso(msgId, traducir(r.error), true); return; }
    var eraNuevo = !actual;
    actual = r.data;
    if (eraNuevo) cargarOdonto();
    pintarCabecera();
    aviso(msgId, eraNuevo ? 'Expediente creado. Ya puedes completar la historia médica, el odontograma, las notas y las radiografías.' : 'Cambios guardados.');
  }

  // ---------- Odontograma (componente de odontograma.js) ----------
  var odg = window.Odontograma.crear($('odoComp'), {
    onCambio: function () { odontoCambiado = true; aviso('odoMsg', 'Hay cambios sin guardar.', true); }
  });

  function cargarOdonto() {
    odg.cargar(actual ? actual.odontograma : null, actual ? anios(actual.fecha_nacimiento) : null);
    odontoCambiado = false;
    var n = odg.hallazgos();
    aviso('odoMsg', n ? n + ' pieza(s) con hallazgos.' : 'Sin hallazgos registrados.');
  }

  async function guardarOdonto(boton) {
    boton.disabled = true;
    aviso('odoMsg', 'Guardando…');
    var r = await sb.from('pacientes').update({ odontograma: odg.valor() }).eq('id', actual.id).select('*').single();
    boton.disabled = false;
    if (r.error) { aviso('odoMsg', traducir(r.error), true); return; }
    actual = r.data;
    odontoCambiado = false;
    pintarCabecera();
    aviso('odoMsg', 'Odontograma guardado.');
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
        return '<li><div class="meta"><span><strong style="color:#0F2A2E">' + fechaCorta(n.fecha) + '</strong>' + (n.autor_usuario ? ' · por ' + esc(n.autor_usuario) : '') + '</span>' +
          (esSuper() ? '<button type="button" class="adm-btn" data-borrar-nota="' + n.id + '" data-confirmar="0" style="min-height:36px;padding:6px 12px">Borrar</button>' : '') +
          '</div><div class="texto">' + esc(n.texto) + '</div></li>';
      }).join('')
      : '<li style="color:#5B6E70">Todavía no hay notas de visita.</li>';
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
    if (b.dataset.confirmar === '1') return true;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? Borrar';
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.isConnected) { b.dataset.confirmar = '0'; b.textContent = 'Borrar'; b.style.borderColor = ''; b.style.color = ''; } }, 4000);
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

  $('fDatos').addEventListener('submit', function (e) {
    e.preventDefault();
    guardar(['nombre', 'dpi', 'fecha_nacimiento', 'telefono', 'direccion', 'emergencia_nombre', 'emergencia_telefono'], 'fDatosMsg', this.querySelector('[type=submit]'));
  });
  $('fHistoria').addEventListener('submit', function (e) {
    e.preventDefault();
    guardar(['alergias', 'enfermedades', 'medicamentos'], 'fHistoriaMsg', this.querySelector('[type=submit]'));
  });

  $('odoGuardar').addEventListener('click', function () { guardarOdonto(this); });

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
      rellenar(null);
      $('expBody').innerHTML = ''; $('notaLista').innerHTML = ''; $('rxGrid').innerHTML = '';
      $('expFicha').hidden = true; $('expLista').hidden = false;
    }
  });
})();
