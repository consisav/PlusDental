// Plus Dental — Catálogos › 4 · Administración › Backup de la información.
// Respaldo por organización y localidad (empresa): «Todas» solo para el Super Administrador y el personal sin sede;
// los demás respaldan únicamente su organización y su localidad. Usuario y fecha (hora, minuto y segundo) automáticos.
// Contenido: Base de datos (SQL leído de Supabase con respaldo_tablas / respaldo_datos, un INSERT por tabla que se
// restaura en el SQL Editor), Aplicativo (index.html, estilos y programas en JSON) o Todo (los dos archivos).
// Destino: en Chrome y Edge los archivos se guardan en la carpeta elegida (se recuerda), no en Descargas; en otros
// navegadores se descargan. Cada respaldo queda en el historial (tabla respaldos, supabase.sql).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admBackup')) return;

  var POR_PAGINA = 1000;
  var CONTENIDOS = [
    { k: 'app', icono: 'codigo', nombre: 'Aplicativo', nota: 'Página, estilos y programas' },
    { k: 'bd', icono: 'datos', nombre: 'Base de datos', nota: 'Tablas y registros' },
    { k: 'todo', icono: 'capas', nombre: 'Todo', nota: 'Aplicativo y base de datos' }
  ];
  var ICONOS = {
    datos: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    codigo: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
    capas: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
    edificio: '<path d="M4 21V5l8-2v18M12 7l8 2v12M8 9v.01M8 13v.01M8 17v.01M16 13v.01M16 17v.01"/>',
    usuario: '<circle cx="9" cy="8" r="4"/><path d="M3 21v-1a6 6 0 0 1 12 0v1M16 11l2 2 4-4"/>',
    carpeta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    historial: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
    escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    externo: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/>',
    alerta: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'
  };
  function ico(n, t) { return '<svg width="' + (t || 16) + '" height="' + (t || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONOS[n] + '</svg>'; }
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fechaHora(f) { return new Date(f).toLocaleString('es-GT', { timeZone: 'America/Guatemala', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', ''); }
  function sello(f) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(f);
    var v = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
    return v('year') + v('month') + v('day') + '_' + v('hour') + v('minute') + v('second');
  }
  function tamano(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function leerLocal(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  // La carpeta de destino se recuerda en IndexedDB (un FileSystemDirectoryHandle no cabe en localStorage)
  function almacen(modo, fn) {
    return new Promise(function (ok) {
      try {
        var r = indexedDB.open('pd-backup', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('carpeta'); };
        r.onsuccess = function () {
          var t = r.result.transaction('carpeta', modo), q = fn(t.objectStore('carpeta'));
          t.oncomplete = function () { r.result.close(); ok(q.result == null ? null : q.result); };
          t.onerror = function () { r.result.close(); ok(null); };
        };
        r.onerror = function () { ok(null); };
      } catch (e) { ok(null); }
    });
  }
  function ultimaCarpeta(ruta) { return (ruta || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/:$/, ''); }

  var organizaciones = [], localidades = [], historial = [], carpeta = null, trabajando = false, comprimirArchivo = true, todas = false;
  var guardado = leerLocal('pd.backup.contenido');
  var contenido = { app: guardado === 'app' || guardado === 'todo', bd: guardado !== 'app' };
  var sel = { org: '', loc: '' };
  var puedeCarpeta = typeof window.showDirectoryPicker === 'function', puedeComprimir = typeof window.CompressionStream === 'function';
  var proyecto = ((window.PLUS_DENTAL_CONFIG && window.PLUS_DENTAL_CONFIG.supabaseUrl) || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  var panelBackups = proyecto ? 'https://supabase.com/dashboard/project/' + proyecto[1] + '/database/backups/scheduled' : 'https://supabase.com/dashboard/project/ixnaggewpldquyvyahjn/database/backups/scheduled';

  function marcado(k) { return k === 'todo' ? contenido.app && contenido.bd : contenido[k]; }
  function tipoArchivo(n) { return /^backup_aplicativo_/.test(n) ? 'Aplicativo' : /^backup_todo_/.test(n) ? 'Todo' : 'Base de datos'; }
  function org(id) { return organizaciones.filter(function (o) { return String(o.id) === String(id); })[0]; }
  function loc(id) { return localidades.filter(function (l) { return String(l.id) === String(id); })[0]; }
  function codLoc(l) { return window.PD_SEDES && window.PD_SEDES.codigoLoc ? window.PD_SEDES.codigoLoc(l) : l.codigo; }
  function nomLoc(l) { return l.nombre_comercial || l.razon_social || ''; }
  function usuario() { return (window.PD_SESION && window.PD_SESION.usuario()) || ''; }
  function coincide() { var r = ultimaCarpeta(leerLocal('pd.backup.ruta')); return !r || !carpeta || r.toLowerCase() === carpeta.name.toLowerCase(); }
  async function elegirCarpeta() {
    var op = { id: 'pd-backup', mode: 'readwrite' }; if (carpeta) op.startIn = carpeta;
    carpeta = await window.showDirectoryPicker(op);
    await almacen('readwrite', function (st) { return st.put(carpeta, 'destino'); });
  }
  var cont = $('admBackup');

  async function cargar() {
    cont.innerHTML = '<p class="dlg-msg">Cargando…</p>';
    if (window.PD_SEDES) await window.PD_SEDES.cargar();
    var r = await Promise.all([
      sb.from('organizaciones').select('id,codigo,nombre').order('codigo'),
      sb.from('org_localidades').select('id,codigo,nombre_comercial,razon_social,organizacion_id').order('organizacion_id').order('codigo'),
      sb.rpc('respaldo_permitido', { p_org: null, p_loc: null })
    ]);
    organizaciones = r[0].data || []; localidades = r[1].data || [];
    todas = r[2].data === true;
    if (puedeCarpeta && !carpeta) carpeta = await almacen('readonly', function (st) { return st.get('destino'); });
    var mi = window.PD_SEDES ? window.PD_SEDES.miLocalidad() : null, ml = mi ? loc(mi) : null;
    if (todas) { sel.org = ''; sel.loc = ''; } else { sel.loc = ml ? String(ml.id) : ''; sel.org = ml ? String(ml.organizacion_id) : ''; }
    if (!todas && !ml) { cont.innerHTML = '<div class="bk"><p class="dlg-msg">Tu usuario no tiene organización y localidad asignadas: pide al Super Administrador que las asigne para poder generar un backup.</p></div>'; return; }
    await cargarHistorial();
    pintar();
  }
  async function cargarHistorial() {
    var r = await sb.from('respaldos').select('*').order('fecha', { ascending: false }).limit(50);
    historial = r.error ? null : r.data || [];
  }

  function pintar() {
    var super_ = window.PD_SESION && window.PD_SESION.esSuper();
    var locs = localidades.filter(function (l) { return !sel.org || String(l.organizacion_id) === sel.org; });
    if (sel.loc && !locs.some(function (l) { return String(l.id) === sel.loc; })) sel.loc = todas ? '' : sel.loc;
    var ruta = leerLocal('pd.backup.ruta');
    cont.innerHTML =
      '<form class="bk" novalidate>' +
      '<header class="bk-cab"><span class="bk-icono">' + ico('datos', 22) + '</span>' +
      '<div class="bk-tit"><small>Catálogos · Administración</small><h3>Backup de la información</h3></div>' +
      '<span class="bk-marca' + (todas ? '' : ' pend') + '">' + ico('escudo', 13) + (super_ ? ' Super administrador: todas las organizaciones y localidades' : todas ? ' Puede respaldar todas las sedes' : ' Solo tu organización y localidad') + '</span>' +
      '<button type="submit" class="adm-btn adm-primary bk-generar" data-generar>' + ico('datos') + ' Generar backup</button></header>' +
      '<p class="bk-error" role="alert"></p>' +

      '<section class="bk-bloque"><h4>' + ico('edificio', 15) + ' Alcance del backup</h4>' +
      '<div class="bk-linea"><label>Organización<select name="org" class="adm-input"' + (todas && contenido.bd ? '' : ' disabled') + '>' +
      (todas ? '<option value=""' + (sel.org ? '' : ' selected') + '>Todas las organizaciones</option>' : '') +
      organizaciones.filter(function (o) { return todas || String(o.id) === sel.org; }).map(function (o) { return '<option value="' + o.id + '"' + (String(o.id) === sel.org ? ' selected' : '') + '>' + esc(o.codigo + ' · ' + o.nombre) + '</option>'; }).join('') + '</select></label>' +
      '<label>Localidad (empresa)<select name="loc" class="adm-input"' + (todas && contenido.bd ? '' : ' disabled') + '>' +
      (todas ? '<option value=""' + (sel.loc ? '' : ' selected') + '>' + (sel.org ? 'Todas las localidades de la organización' : 'Todas las localidades') + '</option>' : '') +
      locs.filter(function (l) { return todas || String(l.id) === sel.loc; }).map(function (l) { return '<option value="' + l.id + '"' + (String(l.id) === sel.loc ? ' selected' : '') + '>' + esc(codLoc(l) + ' · ' + nomLoc(l)) + '</option>'; }).join('') + '</select></label></div>' +
      '<fieldset class="bk-contenido"><legend>Respaldar</legend>' + CONTENIDOS.map(function (c) {
        return '<label class="bk-opcion' + (marcado(c.k) ? ' marcada' : '') + '"><input type="checkbox" name="contenido" value="' + c.k + '"' + (marcado(c.k) ? ' checked' : '') + '>' + ico(c.icono, 18) + '<span><b>' + c.nombre + '</b><small>' + c.nota + '</small></span></label>';
      }).join('') + '</fieldset>' +
      '<p class="bk-nota">' + ico('info', 13) + ' ' + (!contenido.bd ? 'El aplicativo es el mismo para todas las sedes: la organización y la localidad aplican a la base de datos.' : todas ? 'Las tablas generales del sistema (geografía, tipos, tratamientos, roles…) se incluyen siempre.' : 'Solo el Super Administrador puede respaldar otras organizaciones o todas.') + '</p></section>' +

      '<section class="bk-bloque"><h4>' + ico('usuario', 15) + ' Control</h4><div class="bk-control">' +
      '<div><span>Usuario</span><b>' + esc(usuario().toUpperCase()) + '</b><small>Usuario conectado</small></div>' +
      '<div><span>Fecha y hora</span><b class="bk-azul" data-reloj>' + esc(fechaHora(new Date())) + '</b><small>Hora de Guatemala</small></div>' +
      '<div><span>Formato</span>' + (contenido.bd ? '<b>Base de datos: SQL' + (puedeComprimir && comprimirArchivo ? ' (.sql.gz)' : ' (.sql)') + '</b>' : '') + (contenido.app ? '<b>Aplicativo: JSON' + (puedeComprimir && comprimirArchivo ? ' comprimido (.json.gz)' : ' (.json)') + '</b>' : '') +
      '<small>' + (contenido.app && contenido.bd ? 'Dos archivos, uno por cada contenido' : contenido.bd ? 'Se restaura en el SQL Editor de Supabase' : 'Página, estilos y programas') + '</small></div></div>' +
      '<div class="bk-acc">' + (puedeComprimir ? '<label class="bk-check"><input type="checkbox" name="comprimir"' + (comprimirArchivo ? ' checked' : '') + '> Comprimir los archivos</label>' : '') +
      (contenido.bd ? '<a class="adm-btn" href="' + panelBackups + '" target="_blank" rel="noopener" title="Respaldos automáticos del proyecto en Supabase">' + ico('externo', 14) + ' Backups en Supabase</a>' : '') + '</div></section>' +

      '<section class="bk-bloque"><h4>' + ico('carpeta', 15) + ' Destino</h4>' +
      '<label class="bk-ruta">Directorio o ruta (computadora o servidor)<input name="ruta" class="adm-input" value="' + esc(ruta) + '" placeholder="Ej.: D:\\Respaldos\\PlusDental o \\\\SERVIDOR\\Respaldos" maxlength="300"></label>' +
      (puedeCarpeta ? '<div class="bk-carpeta"><button type="button" class="adm-btn" data-carpeta>' + ico('carpeta', 15) + ' ' + (carpeta ? 'Cambiar carpeta' : 'Elegir carpeta…') + '</button>' +
        '<span>' + (carpeta ? ico('carpeta', 13) + ' Los archivos se guardarán en la carpeta <b class="bk-verde">' + esc(carpeta.name) + '</b>, no en Descargas.' : 'Elige la carpeta de la ruta (también una carpeta compartida del servidor): los archivos se guardarán ahí, no en Descargas.') + '</span></div>' +
        (carpeta && !coincide() ? '<p class="bk-nota bk-aviso">' + ico('alerta', 13) + ' La carpeta elegida (<b>' + esc(carpeta.name) + '</b>) no coincide con la ruta escrita: pulsa «Cambiar carpeta» y busca ' + esc(ruta) + '.</p>' : '')
        : '<p class="bk-nota">' + ico('info', 13) + ' Este navegador no permite elegir la carpeta: el archivo se descarga y después lo mueves a la ruta indicada. En Chrome o Edge se guarda directo en la carpeta elegida.</p>') + '</section>' +

      '<section class="bk-progreso" data-progreso hidden><div class="bk-barra"><i data-barra style="width:0%"></i></div><span data-estado></span></section>' +

      '<section class="bk-bloque"><h4>' + ico('historial', 15) + ' Historial de backups</h4>' +
      (historial === null ? '<p class="dlg-msg">Falta ejecutar en Supabase el script del Backup (supabase.sql).</p>' :
        '<div class="roles-wrap"><table class="bk-tabla"><thead><tr><th>Fecha y hora</th><th>Contenido</th><th>Usuario</th><th>Organización</th><th>Localidad</th><th>Archivo</th><th>Ruta</th><th class="num">Tablas</th><th class="num">Registros</th><th class="num">Tamaño</th></tr></thead><tbody>' +
        (historial.map(function (r) {
          var o = org(r.organizacion_id), l = loc(r.localidad_id);
          return '<tr><td>' + esc(fechaHora(r.fecha)) + '</td><td>' + tipoArchivo(r.archivo) + '</td><td>' + esc(r.usuario || '') + '</td><td>' + esc(r.organizacion_id ? (o ? o.codigo + ' · ' + o.nombre : r.organizacion_id) : 'TODAS') + '</td>' +
            '<td>' + esc(r.localidad_id ? (l ? codLoc(l) + ' · ' + nomLoc(l) : r.localidad_id) : 'TODAS') + '</td><td class="bk-fuerte">' + esc(r.archivo) + '</td><td>' + esc(r.ruta || '') + '</td>' +
            '<td class="num">' + r.tablas + '</td><td class="num">' + Number(r.registros).toLocaleString('es-GT') + '</td><td class="num">' + tamano(Number(r.bytes)) + '</td></tr>';
        }).join('') || '<tr><td colspan="10" class="bk-vacio">Todavía no se ha generado ningún backup.</td></tr>') + '</tbody></table></div>') + '</section>' +
      '</form>';
  }

  function progreso(pct, txt) {
    var p = cont.querySelector('[data-progreso]'); if (!p) return;
    p.hidden = false;
    p.querySelector('[data-barra]').style.width = Math.min(100, pct) + '%';
    p.querySelector('[data-estado]').innerHTML = txt;
  }
  function error(t) { var e = cont.querySelector('.bk-error'); if (e) e.textContent = t || ''; }

  // Archivos del aplicativo: index.html y los estilos y programas propios que carga; las librerías externas se anotan
  async function leerAplicativo(desde, hasta) {
    progreso(desde + 1, 'Leyendo el aplicativo…');
    var raiz = new URL('./', location.href);
    async function leer(ruta) {
      var r = await fetch(new URL(ruta, raiz), { cache: 'no-store' });
      if (!r.ok) throw new Error('No se pudo leer ' + ruta + ' del aplicativo (' + r.status + ').');
      return r.text();
    }
    var indice = await leer('index.html');
    var doc = new DOMParser().parseFromString(indice, 'text/html'), propias = [], librerias = [];
    doc.querySelectorAll('script[src], link[rel=stylesheet][href]').forEach(function (n) {
      var url = new URL(n.getAttribute('src') || n.getAttribute('href'), raiz);
      if (url.origin === raiz.origin && url.pathname.indexOf(raiz.pathname) === 0) propias.push(url.pathname.slice(raiz.pathname.length));
      else librerias.push(url.href);
    });
    var unicas = propias.filter(function (x, i, a) { return a.indexOf(x) === i; }), archivos = { 'index.html': indice };
    for (var i = 0; i < unicas.length; i++) {
      archivos[unicas[i]] = await leer(unicas[i]);
      progreso(desde + 1 + (i + 1) / unicas.length * (hasta - desde - 1), 'Leyendo el aplicativo · <b>' + esc(unicas[i]) + '</b> · ' + (i + 1) + ' de ' + unicas.length + ' archivos');
    }
    return { origen: raiz.href, archivos: archivos, librerias: librerias };
  }
  async function empacar(texto, tipo, comprimir) {
    var blob = new Blob([texto], { type: tipo });
    return comprimir ? new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob() : blob;
  }
  // Respaldo SQL: se restaura en el SQL Editor de Supabase, sin disparadores mientras se carga y sin duplicar
  function cabeceraSql(inicio, o, l, tablas, ruta) {
    return ['-- Backup de la base de datos · Plus Dental (Supabase)',
      '-- Generado: ' + fechaHora(inicio) + ' (hora de Guatemala) · usuario ' + usuario().toUpperCase(),
      '-- Organización: ' + (o ? o.codigo + ' · ' + o.nombre : 'TODAS') + ' · Localidad: ' + (l ? codLoc(l) + ' · ' + nomLoc(l) : 'TODAS'),
      '-- Tablas: ' + tablas.length + (ruta ? ' · ruta ' + ruta : ''),
      '-- Restaurar: abrir el SQL Editor del proyecto en Supabase, pegar este archivo y ejecutarlo.',
      '-- La estructura (tablas y funciones) se crea con supabase.sql.', '', 'begin;', 'set session_replication_role = replica;', ''].join('\n');
  }
  function insertSql(tabla, filas, general) {
    if (!filas.length) return '\n-- ' + tabla + ': sin registros\n';
    var lineas = ['\n-- ' + tabla + ': ' + filas.length + ' registros' + (general ? ' (tabla general)' : '')];
    for (var i = 0; i < filas.length; i += 500) {
      var json = JSON.stringify(filas.slice(i, i + 500)).replace(/'/g, "''");
      lineas.push('insert into public."' + tabla + '" overriding system value select * from jsonb_populate_recordset(null::public."' + tabla + '", \'' + json + '\'::jsonb) on conflict do nothing;');
    }
    return lineas.join('\n') + '\n';
  }

  async function generar(form) {
    if (trabajando) return;
    error('');
    var pOrg = sel.org ? Number(sel.org) : null, pLoc = sel.loc ? Number(sel.loc) : null;
    if (!contenido.app && !contenido.bd) { error('Marca qué deseas respaldar: aplicativo, base de datos o todo.'); return; }
    var ruta = form.elements.ruta.value.trim();
    if (!ruta && !carpeta) { error('Escribe el directorio o la ruta donde se alojará el backup.'); return; }
    guardarLocal('pd.backup.ruta', ruta);
    if (puedeCarpeta) {
      // Con el clic todavía vigente: elegir la carpeta o renovar el permiso antes de leer los datos
      try {
        if (!carpeta) await elegirCarpeta();
        else if (await carpeta.queryPermission({ mode: 'readwrite' }) !== 'granted' && await carpeta.requestPermission({ mode: 'readwrite' }) !== 'granted') { error('El navegador no dio permiso para escribir en la carpeta de destino.'); return; }
      } catch (err) {
        if (!err || err.name !== 'AbortError') { carpeta = null; pintar(); }
        error(err && err.name === 'AbortError' ? 'Elige la carpeta de destino: ahí se guardará el backup.' : 'No se pudo abrir la carpeta de destino: elígela de nuevo.');
        return;
      }
    }
    var comprimir = !!(form.elements.comprimir && form.elements.comprimir.checked), boton = form.querySelector('[data-generar]');
    trabajando = true; boton.disabled = true;
    var inicio = new Date();
    try {
      var o = pOrg ? org(pOrg) : null, l = pLoc ? loc(pLoc) : null;
      var alcance = (o ? 'org' + o.codigo : 'TODAS') + '_' + (l ? 'loc' + codLoc(l) : 'TODAS'), gz = comprimir ? '.gz' : '', archivos = [];
      // a) Base de datos: respaldo SQL leído de Supabase
      if (contenido.bd) {
        var tope = contenido.app ? 80 : 92;
        progreso(1, 'Conectando con Supabase: revisando las tablas…');
        var r1 = await sb.rpc('respaldo_tablas', { p_org: pOrg, p_loc: pLoc });
        if (r1.error) throw r1.error;
        var tablas = r1.data, total = tablas.reduce(function (t, x) { return t + Number(x.filas); }, 0) || 1, leidas = 0;
        var partes = [cabeceraSql(inicio, o, l, tablas, ruta)];
        for (var i = 0; i < tablas.length; i++) {
          var t = tablas[i], filas = [];
          for (var desde = 0; desde < Number(t.filas); desde += POR_PAGINA) {
            var r2 = await sb.rpc('respaldo_datos', { p_tabla: t.tabla, p_org: pOrg, p_loc: pLoc, p_desde: desde, p_cantidad: POR_PAGINA });
            if (r2.error) throw r2.error;
            filas = filas.concat(r2.data); leidas += r2.data.length;
            progreso(2 + leidas / total * (tope - 2), 'Supabase · leyendo <b>' + esc(t.tabla) + '</b> · ' + leidas.toLocaleString('es-GT') + ' de ' + total.toLocaleString('es-GT') + ' registros');
            if (r2.data.length < POR_PAGINA) break;
          }
          partes.push(insertSql(t.tabla, filas, t.general));
        }
        partes.push('\nset session_replication_role = origin;\ncommit;\n');
        archivos.push({ nombre: 'backup_bd_' + alcance + '_' + sello(inicio) + '.sql' + gz, blob: await empacar(partes.join(''), 'application/sql', comprimir), tablas: tablas.length, registros: leidas, que: tablas.length + ' tablas · ' + leidas.toLocaleString('es-GT') + ' registros' });
      }
      // b) Aplicativo: JSON con los archivos de la página
      if (contenido.app) {
        var aplicativo = await leerAplicativo(contenido.bd ? 80 : 0, 92);
        var respaldo = { sistema: 'Plus Dental', formato: 1, contenido: 'APLICATIVO', generado: inicio.toISOString(), generado_local: fechaHora(inicio), usuario: usuario().toUpperCase(), ruta: ruta || null, aplicativo: aplicativo };
        archivos.push({ nombre: 'backup_aplicativo_' + sello(inicio) + '.json' + gz, blob: await empacar(JSON.stringify(respaldo), 'application/json', comprimir), tablas: 0, registros: 0, que: Object.keys(aplicativo.archivos).length + ' archivos del aplicativo' });
      }
      var destino = ruta, hechos = [];
      for (var k = 0; k < archivos.length; k++) {
        var x = archivos[k];
        progreso(94 + k * 3, 'Guardando <b>' + esc(x.nombre) + '</b>…');
        if (carpeta) {
          var fh = await carpeta.getFileHandle(x.nombre, { create: true }), w = await fh.createWritable();
          await w.write(x.blob); await w.close();
          destino = coincide() ? ruta || carpeta.name : carpeta.name;
        } else {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(x.blob); a.download = x.nombre;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function (u) { return function () { URL.revokeObjectURL(u); }; }(a.href), 30000);
          if (k < archivos.length - 1) await new Promise(function (r) { setTimeout(r, 700); });
        }
        var r3 = await sb.from('respaldos').insert({ organizacion_id: pOrg, localidad_id: pLoc, archivo: x.nombre, ruta: destino || null, tablas: x.tablas, registros: x.registros, bytes: x.blob.size });
        hechos.push('<b>' + esc(x.nombre) + '</b> · ' + x.que + ' · ' + tamano(x.blob.size) + (r3.error ? ' · <span class="bk-rojo">no se pudo registrar en el historial</span>' : ''));
      }
      await cargarHistorial();
      pintar();
      progreso(100, ico('ok', 15) + ' ' + (archivos.length > 1 ? 'Se generaron dos archivos' : 'Backup generado') + (carpeta ? ' en la carpeta ' + esc(carpeta.name) : ' (descargado)') + ':<br>' + hechos.join('<br>'));
    } catch (err) {
      var m = (err && err.message) || '';
      var p = cont.querySelector('[data-progreso]'); if (p) p.hidden = true;
      error(err && err.name === 'NotAllowedError' ? 'El navegador no dio permiso para escribir en la carpeta: elígela de nuevo.'
        : /respaldo_/.test(m) && /function|schema cache/.test(m) ? 'Falta ejecutar en Supabase el script del Backup (supabase.sql).' : m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo generar el backup.');
    } finally {
      trabajando = false;
      var b = cont.querySelector('[data-generar]'); if (b) b.disabled = false;
    }
  }

  cont.addEventListener('change', function (e) {
    var n = e.target.name;
    if (n === 'org') { sel.org = e.target.value; sel.loc = ''; pintar(); }
    else if (n === 'loc') { sel.loc = e.target.value; pintar(); }
    else if (n === 'comprimir') { comprimirArchivo = e.target.checked; pintar(); }
    else if (n === 'contenido') {
      var k = e.target.value;
      if (k === 'todo') { contenido.app = e.target.checked; contenido.bd = e.target.checked; } else contenido[k] = e.target.checked;
      guardarLocal('pd.backup.contenido', contenido.app && contenido.bd ? 'todo' : contenido.app ? 'app' : contenido.bd ? 'bd' : 'ninguno');
      pintar();
    }
  });
  cont.addEventListener('input', function (e) { if (e.target.name === 'ruta') guardarLocal('pd.backup.ruta', e.target.value.trim()); });
  cont.addEventListener('click', async function (e) {
    if (!e.target.closest('[data-carpeta]')) return;
    try {
      await elegirCarpeta();
      var r = cont.querySelector('[name=ruta]');
      if (r && !r.value.trim()) guardarLocal('pd.backup.ruta', carpeta.name);
      pintar();
    } catch (err) { if (!err || err.name !== 'AbortError') error('No se pudo abrir la carpeta.'); }
  });
  cont.addEventListener('submit', function (e) { e.preventDefault(); generar(e.target); });
  setInterval(function () { var r = cont.querySelector('[data-reloj]'); if (r && !cont.hidden) r.textContent = fechaHora(new Date()); }, 1000);

  $('tabBackup').addEventListener('click', function () { if (!trabajando) cargar(); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {},
    limpiar: function () { historial = []; cont.innerHTML = ''; }
  });
})();
