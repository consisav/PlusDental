// Plus Dental — Historias de impacto: fotos, videos y casos de antes y después de pacientes
// Parte pública (galería con filtros y vista ampliada) y módulo de administración (solo personal).
(function () {
  var sb = window.PD_SB || null;
  var BUCKET = 'historias';
  var MAX_VIDEO = 50 * 1024 * 1024;
  var TIPOS = { foto: 'Foto', video: 'Video', antes_despues: 'Antes y después' };
  var FILTROS = [['video', 'Videos'], ['antes_despues', 'Antes y después'], ['foto', 'Fotos']];
  var IMAGENES = ['image/jpeg', 'image/png', 'image/webp'];
  var VIDEOS = ['video/mp4', 'video/webm', 'video/quicktime'];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function url(ruta, v) { return ruta && sb ? sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl + (v ? '?v=' + encodeURIComponent(v) : '') : ''; }
  function idYoutube(u) {
    var m = String(u || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }
  function meta(h) { return [h.tratamiento, h.detalle].filter(Boolean).join(' · '); }

  // Comparador de antes y después (la barra se arrastra con el control deslizante)
  function antesDespues(h, interactivo) {
    return '<span class="his-ad" style="--p:50%">' +
      '<img src="' + esc(url(h.archivo, h.actualizado)) + '" alt="Antes: ' + esc(h.titulo) + '" loading="lazy">' +
      '<img class="his-desp" src="' + esc(url(h.archivo2, h.actualizado)) + '" alt="Después: ' + esc(h.titulo) + '" loading="lazy">' +
      '<span class="his-ad-bar" aria-hidden="true"></span><span class="his-ea">Antes</span><span class="his-eb">Después</span>' +
      (interactivo ? '<input type="range" min="0" max="100" value="50" aria-label="Deslizar para comparar antes y después">' : '') +
      '</span>';
  }
  document.addEventListener('input', function (e) {
    if (e.target.matches('.his-ad input[type=range]')) e.target.parentNode.style.setProperty('--p', e.target.value + '%');
  });

  // ================= Página pública =================
  var historias = [], filtro = 'todas', abierta = -1;

  function visibles() { return historias.filter(function (h) { return filtro === 'todas' || h.tipo === filtro; }); }

  function miniatura(h) {
    if (h.tipo === 'antes_despues') return antesDespues(h, false);
    if (h.tipo === 'video') {
      var yt = idYoutube(h.video_url);
      var fondo = h.archivo
        ? '<video src="' + esc(url(h.archivo, h.actualizado)) + '#t=0.5" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video>'
        : yt ? '<img src="https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg" alt="" loading="lazy">' : '';
      return '<span class="his-med his-v">' + fondo + '<span class="his-tag">Video</span><span class="his-play" aria-hidden="true"></span></span>';
    }
    return '<span class="his-med"><img src="' + esc(url(h.archivo, h.actualizado)) + '" alt="' + esc(h.titulo) + '" loading="lazy"><span class="his-tag">Foto</span></span>';
  }

  function pintarPublicas() {
    var grid = $('hisGrid');
    if (!grid) return;
    $('hisVacio').hidden = historias.length > 0;
    var tipos = FILTROS.filter(function (f) { return historias.some(function (h) { return h.tipo === f[0]; }); });
    if (filtro !== 'todas' && !tipos.some(function (f) { return f[0] === filtro; })) filtro = 'todas';
    $('hisFiltros').hidden = tipos.length < 2;
    $('hisFiltros').innerHTML = [['todas', 'Todas']].concat(tipos).map(function (f) {
      return '<button type="button" data-hfiltro="' + f[0] + '" aria-pressed="' + (filtro === f[0]) + '">' + f[1] + '</button>';
    }).join('');
    grid.innerHTML = visibles().map(function (h, i) {
      return '<article class="his-card"><button type="button" class="his-abrir" data-hi="' + i + '" aria-label="Ver ' + esc(TIPOS[h.tipo].toLowerCase()) + ': ' + esc(h.titulo) + '">' + miniatura(h) + '</button>' +
        '<div class="his-txt"><h3>' + esc(h.titulo) + '</h3>' + (h.descripcion ? '<p>' + esc(h.descripcion) + '</p>' : '') +
        (meta(h) ? '<span class="his-meta">' + esc(meta(h)) + '</span>' : '') + '</div></article>';
    }).join('');
  }

  function medio(h) {
    if (h.tipo === 'antes_despues') return antesDespues(h, true);
    if (h.tipo === 'video') {
      if (h.archivo) return '<video src="' + esc(url(h.archivo, h.actualizado)) + '" controls autoplay playsinline></video>';
      return '<iframe src="https://www.youtube-nocookie.com/embed/' + idYoutube(h.video_url) + '?autoplay=1&rel=0" title="' + esc(h.titulo) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    }
    return '<img src="' + esc(url(h.archivo, h.actualizado)) + '" alt="' + esc(h.titulo) + '">';
  }

  function abrir(i) {
    var lista = visibles();
    if (!lista.length) return;
    abierta = (i + lista.length) % lista.length;
    var h = lista[abierta];
    $('hisDlgMedio').innerHTML = medio(h);
    $('hisDlgTitulo').textContent = h.titulo;
    $('hisDlgDesc').textContent = h.descripcion || '';
    $('hisDlgDesc').hidden = !h.descripcion;
    $('hisDlgMeta').textContent = meta(h);
    $('hisNav').hidden = lista.length < 2;
    if (!$('hisDlg').open) $('hisDlg').showModal();
  }

  async function cargarPublicas() {
    if (!sb || !$('hisGrid')) return;
    var r = await sb.from('historias').select('id,tipo,titulo,descripcion,tratamiento,detalle,archivo,archivo2,video_url,actualizado')
      .eq('publicada', true).order('orden').order('creado', { ascending: false });
    historias = r.error ? [] : (r.data || []);
    pintarPublicas();
  }

  if ($('hisGrid')) {
    $('hisFiltros').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hfiltro]');
      if (b) { filtro = b.dataset.hfiltro; pintarPublicas(); }
    });
    $('hisGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hi]');
      if (b) abrir(+b.dataset.hi);
    });
    var dlg = $('hisDlg');
    $('hisCerrar').addEventListener('click', function () { dlg.close(); });
    $('hisPrev').addEventListener('click', function () { abrir(abierta - 1); });
    $('hisNext').addEventListener('click', function () { abrir(abierta + 1); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { $('hisDlgMedio').innerHTML = ''; }); // detiene el video
    dlg.addEventListener('keydown', function (e) {
      if (e.target.matches('input')) return;
      if (e.key === 'ArrowLeft') abrir(abierta - 1);
      if (e.key === 'ArrowRight') abrir(abierta + 1);
    });
    cargarPublicas();
  }

  // ================= Administración =================
  if (!sb || !$('admHistorias')) return;

  var lista = [], actual = null, nuevo = { 1: null, 2: null }, borrar = { 1: false, 2: false }, vistas = { 1: null, 2: null };

  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || String(err || '');
    if (/historias.*(does not exist|could not find)|could not find the table|bucket not found/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las historias.';
    if (/historias_con_permiso/i.test(m)) return 'Para publicarla marca que el paciente firmó la autorización.';
    if (/historias_con_medios/i.test(m)) return 'Para publicarla falta subir la foto o el video.';
    if (/exceeded the maximum allowed size|too large|payload too large/i.test(m)) return 'El archivo pesa más de 50 MB.';
    if (/mime type|invalid_mime/i.test(m)) return 'Ese tipo de archivo no está permitido (fotos JPG, PNG o WEBP; videos MP4, WEBM o MOV).';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function ver(id) { ['hiLista', 'hiFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // ---------- Lista ----------
  function estado(h) {
    if (h.publicada) return '<span class="estado estado-activo">Publicada</span>';
    if (!h.consentimiento) return '<span class="estado estado-suspendido">Sin autorización</span>';
    return '<span class="estado estado-inactivo">Borrador</span>';
  }
  function mini(h) {
    if (h.tipo === 'video' && h.archivo) return '<video src="' + esc(url(h.archivo, h.actualizado)) + '#t=0.5" muted preload="metadata" aria-hidden="true"></video>';
    if (h.tipo === 'video' && idYoutube(h.video_url)) return '<img src="https://i.ytimg.com/vi/' + idYoutube(h.video_url) + '/default.jpg" alt="">';
    if (h.archivo && h.tipo !== 'video') return '<img src="' + esc(url(h.archivo, h.actualizado)) + '" alt="">';
    return '';
  }
  async function cargar() {
    aviso('hiMsg', '');
    $('hiBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('historias').select('*').order('orden').order('creado', { ascending: false });
    if (r.error) { $('hiBody').innerHTML = ''; aviso('hiMsg', traducir(r.error), true); return; }
    lista = r.data || [];
    $('hiBody').innerHTML = lista.length ? lista.map(function (h) {
      return '<tr><td><div class="hi-fila"><span class="hi-mini">' + mini(h) + '</span><span><b>' + esc(h.titulo) + '</b>' +
        (h.descripcion ? '<br><span class="hi-desc">' + esc(h.descripcion.length > 90 ? h.descripcion.slice(0, 90) + '…' : h.descripcion) + '</span>' : '') + '</span></div></td>' +
        '<td>' + esc(TIPOS[h.tipo]) + '</td><td>' + esc(h.tratamiento || '—') + '</td><td>' + h.orden + '</td><td>' + estado(h) + '</td>' +
        '<td><button type="button" class="adm-btn" data-hiabrir="' + h.id + '">Abrir</button></td></tr>';
    }).join('') : '<tr><td colspan="6">Aún no hay historias. Pulsa «Nueva historia» para agregar la primera.</td></tr>';
  }

  // ---------- Ficha ----------
  function tipoActual() { return $('hiTipo').value; }
  function esVideo(t) { return t === 'video'; }

  function limpiarVista(n) { if (vistas[n]) { URL.revokeObjectURL(vistas[n]); vistas[n] = null; } }
  function pintarVista(n) {
    var col = n === 1 ? 'archivo' : 'archivo2', caja = $('hiVista' + n), src = '', video = n === 1 && esVideo(tipoActual());
    if (nuevo[n]) { limpiarVista(n); vistas[n] = URL.createObjectURL(nuevo[n]); src = vistas[n]; }
    else if (actual && actual[col] && !borrar[n]) src = url(actual[col], actual.actualizado);
    caja.innerHTML = src ? (video ? '<video src="' + esc(src) + '" controls muted playsinline preload="metadata"></video>' : '<img src="' + esc(src) + '" alt="">') : '<span>Sin archivo</span>';
    $('hiQuitar' + n).hidden = !src;
    $('hiBtn' + n).textContent = src ? 'Cambiar archivo' : 'Elegir archivo';
  }
  function ajustarTipo() {
    var t = tipoActual();
    $('hiLbl1').textContent = t === 'video' ? 'Video (MP4, WEBM o MOV · máx. 50 MB)' : t === 'antes_despues' ? 'Foto de antes' : 'Foto';
    $('hiArch1').accept = (t === 'video' ? VIDEOS : IMAGENES).join(',');
    $('hiCaja2').hidden = t !== 'antes_despues';
    $('hiYtCaja').hidden = t !== 'video';
    $('hiAyuda').textContent = t === 'video'
      ? 'Sube un video corto (hasta 50 MB) o pega el enlace de YouTube para videos largos. Si pones los dos, se muestra el video subido.'
      : t === 'antes_despues' ? 'Usa dos fotos con el mismo encuadre y tamaño para que la comparación se vea bien.' : 'Las fotos se reducen automáticamente para que la página cargue rápido.';
    pintarVista(1); pintarVista(2);
  }
  function abrirFicha(h) {
    actual = h || null;
    nuevo = { 1: null, 2: null }; borrar = { 1: false, 2: false };
    limpiarVista(1); limpiarVista(2);
    $('hiTituloFicha').textContent = h ? h.titulo : 'Nueva historia';
    $('hiTipo').value = h ? h.tipo : 'foto';
    $('hiTipo').dataset.antes = $('hiTipo').value;
    $('hiTituloIn').value = h ? h.titulo : '';
    $('hiTrat').value = h ? h.tratamiento || '' : '';
    $('hiDetalle').value = h ? h.detalle || '' : '';
    $('hiDesc').value = h ? h.descripcion || '' : '';
    $('hiOrden').value = h ? h.orden : 0;
    $('hiYoutube').value = h ? h.video_url || '' : '';
    $('hiConsent').checked = !!(h && h.consentimiento);
    $('hiPublicada').checked = !!(h && h.publicada);
    $('hiBorrar').hidden = !h;
    aviso('hiFormMsg', '');
    ajustarTipo();
    ver('hiFicha');
    $('hiTituloIn').focus();
  }

  // Foto: se reduce a máx. 1600 px en JPG para que la página cargue rápido
  function reducirImagen(archivo) {
    return new Promise(function (ok, falla) {
      var img = new Image(), u = URL.createObjectURL(archivo);
      img.onload = function () {
        var escala = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? ok(b) : falla(new Error('No se pudo procesar la imagen.')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(u); falla(new Error('El archivo no es una imagen válida.')); };
      img.src = u;
    });
  }
  function nombreUnico() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  async function subir(archivo) {
    var ruta, cuerpo, tipo;
    if (VIDEOS.indexOf(archivo.type) >= 0) {
      var ext = archivo.type === 'video/webm' ? 'webm' : archivo.type === 'video/quicktime' ? 'mov' : 'mp4';
      ruta = 'videos/' + nombreUnico() + '.' + ext; cuerpo = archivo; tipo = archivo.type;
    } else {
      ruta = 'fotos/' + nombreUnico() + '.jpg'; cuerpo = await reducirImagen(archivo); tipo = 'image/jpeg';
    }
    var up = await sb.storage.from(BUCKET).upload(ruta, cuerpo, { contentType: tipo, upsert: false, cacheControl: '3600' });
    if (up.error) throw up.error;
    return ruta;
  }

  function elegir(n, archivo) {
    if (!archivo) return;
    var permitidos = n === 1 && esVideo(tipoActual()) ? VIDEOS : IMAGENES;
    if (permitidos.indexOf(archivo.type) < 0) {
      aviso('hiFormMsg', n === 1 && esVideo(tipoActual()) ? 'Elige un video MP4, WEBM o MOV.' : 'Elige una foto JPG, PNG o WEBP.', true);
      return;
    }
    if (archivo.size > MAX_VIDEO) { aviso('hiFormMsg', 'El archivo pesa más de 50 MB. Para videos largos usa un enlace de YouTube.', true); return; }
    aviso('hiFormMsg', '');
    nuevo[n] = archivo;
    pintarVista(n);
  }

  async function guardar(e) {
    e.preventDefault();
    var t = tipoActual(), titulo = $('hiTituloIn').value.trim(), yt = $('hiYoutube').value.trim();
    var publicada = $('hiPublicada').checked, consentimiento = $('hiConsent').checked;
    if (!titulo) { aviso('hiFormMsg', 'Escribe un título.', true); $('hiTituloIn').focus(); return; }
    if (t === 'video' && yt && !idYoutube(yt)) { aviso('hiFormMsg', 'El enlace de YouTube no es válido. Cópialo desde el botón «Compartir» del video.', true); return; }
    var orden = parseInt($('hiOrden').value, 10);
    var tiene1 = !!(nuevo[1] || (actual && actual.archivo && !borrar[1]));
    var tiene2 = !!(nuevo[2] || (actual && actual.archivo2 && !borrar[2]));
    if (publicada && !consentimiento) { aviso('hiFormMsg', 'Para publicarla marca que el paciente firmó la autorización.', true); return; }
    if (publicada && ((t === 'foto' && !tiene1) || (t === 'video' && !tiene1 && !yt) || (t === 'antes_despues' && !(tiene1 && tiene2)))) {
      aviso('hiFormMsg', t === 'antes_despues' ? 'Para publicarla sube la foto de antes y la de después.' : t === 'video' ? 'Para publicarla sube el video o pega el enlace de YouTube.' : 'Para publicarla sube la foto.', true);
      return;
    }
    var cambios = {
      tipo: t, titulo: titulo, descripcion: $('hiDesc').value.trim() || null, tratamiento: $('hiTrat').value.trim() || null,
      detalle: $('hiDetalle').value.trim() || null, video_url: t === 'video' && yt ? yt : null,
      consentimiento: consentimiento, publicada: publicada, orden: isNaN(orden) ? 0 : Math.max(0, Math.min(999, orden))
    };
    var subidos = [];
    $('hiGuardar').disabled = true;
    aviso('hiFormMsg', nuevo[1] && esVideo(t) ? 'Subiendo el video… puede tardar unos minutos, no cierres la página.' : 'Guardando…');
    try {
      [[1, 'archivo'], [2, 'archivo2']].forEach(function (p) { if (borrar[p[0]]) cambios[p[1]] = null; });
      if (t !== 'antes_despues') cambios.archivo2 = null;
      for (var n = 1; n <= 2; n++) {
        if (!nuevo[n] || (n === 2 && t !== 'antes_despues')) continue;
        var ruta = await subir(nuevo[n]);
        subidos.push(ruta);
        cambios[n === 1 ? 'archivo' : 'archivo2'] = ruta;
      }
      var r = actual
        ? await sb.from('historias').update(cambios).eq('id', actual.id).select('*').single()
        : await sb.from('historias').insert(cambios).select('*').single();
      if (r.error) throw r.error;
      var viejos = actual ? ['archivo', 'archivo2'].filter(function (c) { return actual[c] && actual[c] !== r.data[c]; }).map(function (c) { return actual[c]; }) : [];
      if (viejos.length) await sb.storage.from(BUCKET).remove(viejos);
      abrirFicha(r.data);
      aviso('hiFormMsg', r.data.publicada ? 'Historia guardada. Ya se ve en la página.' : 'Historia guardada como borrador (todavía no se ve en la página).');
      cargarPublicas();
    } catch (err) {
      if (subidos.length) await sb.storage.from(BUCKET).remove(subidos);
      aviso('hiFormMsg', /válida|procesar/.test(err.message || '') ? err.message : traducir(err), true);
    } finally {
      $('hiGuardar').disabled = false;
    }
  }

  $('tabHistorias').addEventListener('click', function () { if (!$('hiLista').hidden) cargar(); });
  $('hiNueva').addEventListener('click', function () { abrirFicha(null); });
  $('hiVolver').addEventListener('click', function () { ver('hiLista'); cargar(); });
  $('hiBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-hiabrir]');
    if (b) abrirFicha(lista.filter(function (h) { return String(h.id) === b.dataset.hiabrir; })[0]);
  });
  $('hiTipo').addEventListener('change', function () {
    var antes = $('hiTipo').dataset.antes, t = tipoActual();
    // al pasar de foto a video (o al revés) el archivo anterior ya no sirve
    if (esVideo(antes) !== esVideo(t)) { nuevo[1] = null; limpiarVista(1); if (actual && actual.archivo) borrar[1] = true; }
    if (t !== 'antes_despues') { nuevo[2] = null; limpiarVista(2); }
    $('hiTipo').dataset.antes = t;
    ajustarTipo();
  });
  [1, 2].forEach(function (n) {
    $('hiBtn' + n).addEventListener('click', function () { $('hiArch' + n).click(); });
    $('hiArch' + n).addEventListener('change', function () { elegir(n, this.files[0]); this.value = ''; });
    $('hiQuitar' + n).addEventListener('click', function () {
      nuevo[n] = null; limpiarVista(n);
      if (actual && actual[n === 1 ? 'archivo' : 'archivo2']) borrar[n] = true;
      pintarVista(n);
    });
  });
  $('hiForm').addEventListener('submit', guardar);
  $('hiBorrar').addEventListener('click', async function () {
    var b = this;
    if (!actual || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('historias').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('hiFormMsg', traducir(r.error), true); return; }
    var archivos = [actual.archivo, actual.archivo2].filter(Boolean);
    if (archivos.length) await sb.storage.from(BUCKET).remove(archivos);
    actual = null;
    ver('hiLista'); cargar(); cargarPublicas();
    aviso('hiMsg', 'Historia borrada.');
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('hiLista').hidden) cargar(); },
    limpiar: function () {
      lista = []; actual = null; nuevo = { 1: null, 2: null }; borrar = { 1: false, 2: false };
      limpiarVista(1); limpiarVista(2);
      $('hiBody').innerHTML = '';
      ver('hiLista');
    }
  });
})();
