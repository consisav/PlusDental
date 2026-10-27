// Plus Dental — Geografía (grupo «Catálogos iniciales» › «Geografía y Organizaciones»)
// Maestro-detalle: Países → Estados / Departamentos → Ciudades / Municipios. Cada país tiene su catálogo de regiones,
// que alimenta la región de sus departamentos. Al tocar una fila se cargan sus detalles abajo; cada fila se edita en una ventana.
// También publica window.PD_GEO: listas en caché (países, regiones, estados, municipios), la ventana de edición genérica
// y las listas encadenadas País → Estado → Municipio que usa «Organizaciones».
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admGeografia')) return;

  var paises = [], regiones = [], estados = [], municipios = [];
  var paisSel = null, estadoSel = null, buscarMun = '', buscarPais = '', buscarEstado = '';
  var cache = { estados: {}, municipios: {}, regiones: {} };

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(t) { return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function aviso(id, texto, error) { if (!$(id)) return; $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/(geo_|organizaciones|org_localidades).*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Geografía y Organizaciones.';
    if (/duplicate key|unique/i.test(m)) return 'Ya existe un registro con ese código.';
    if (/foreign key|violates/i.test(m)) return 'No se puede eliminar: hay registros que lo usan.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción (eliminar es solo del Super Administrador).';
    if (/check constraint/i.test(m)) return 'Revisa los datos: algún campo es demasiado largo o está vacío.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }

  // ---------- Ventana de edición genérica ----------
  // campos: [{ k, label, tipo: 'text'|'select'|'textarea'|'file'|'info', req, max, opciones: [[valor, texto]], ancho: 'full', ayuda }]
  var dlg = document.createElement('dialog');
  dlg.id = 'geoDlg';
  dlg.innerHTML = '<form id="geoDlgForm" class="dlg-form" novalidate>' +
    '<div class="geo-dlg-head"><div><span class="geo-dlg-eyebrow" id="geoDlgEyebrow"></span><h2 id="geoDlgTitulo"></h2></div>' +
    '<button type="button" id="geoDlgCerrar" aria-label="Cerrar">×</button></div>' +
    '<div id="geoDlgCampos" class="geo-dlg-campos"></div>' +
    '<div class="geo-dlg-acciones"><button type="submit" class="dlg-submit" id="geoDlgGrabar">Grabar</button>' +
    '<button type="button" class="adm-btn" id="geoDlgEliminar" hidden>Eliminar</button><button type="button" class="adm-btn" id="geoDlgCancelar">Cancelar</button></div>' +
    '<p id="geoDlgMsg" class="dlg-msg" role="status"></p></form>';
  document.body.appendChild(dlg);
  var dlgCfg = null;

  function campoHtml(c, v) {
    var id = 'geoF_' + c.k, req = c.req ? ' required' : '', lbl = esc(c.label) + (c.req ? ' *' : '');
    var cls = c.ancho === 'full' ? ' class="full"' : '';
    if (c.tipo === 'info') return '<div class="geo-info' + (c.ancho === 'full' ? ' full' : '') + '"><span>' + lbl + '</span><b id="' + id + '">' + esc(v || '—') + '</b></div>';
    if (c.tipo === 'select') return '<label' + cls + '>' + lbl + '<select id="' + id + '"' + req + '>' + (c.opciones || []).map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' + (c.ayuda ? '<small>' + esc(c.ayuda) + '</small>' : '') + '</label>';
    if (c.tipo === 'textarea') return '<label' + cls + '>' + lbl + '<textarea id="' + id + '" rows="2" maxlength="' + (c.max || 300) + '"' + req + '>' + esc(v || '') + '</textarea></label>';
    // Casilla de verificación, número, sede (organización + localidad) y texto con sugerencias (lista)
    if (c.tipo === 'check') return '<label class="geo-check' + (c.ancho === 'full' ? ' full' : '') + '"><input id="' + id + '" type="checkbox"' + (v ? ' checked' : '') + '> ' + esc(c.label) + '</label>';
    if (c.tipo === 'number') return '<label' + cls + '>' + lbl + '<input id="' + id + '" type="number" inputmode="decimal" step="' + (c.paso || 'any') + '" min="' + (c.min == null ? 0 : c.min) + '"' + (c.maxNum != null ? ' max="' + c.maxNum + '"' : '') + ' value="' + (v == null ? '' : esc(v)) + '"' + req + '>' + (c.ayuda ? '<small>' + esc(c.ayuda) + '</small>' : '') + '</label>';
    if (c.tipo === 'sede') return '<label>Organización<select id="geoF_organizacion_id"><option value="">—</option></select></label><label>Localidad / Empresa<select id="geoF_localidad_id"><option value="">—</option></select></label>';
    if (c.lista) return '<label' + cls + '>' + lbl + '<input id="' + id + '" type="text" list="' + id + 'Lista" maxlength="' + (c.max || 80) + '" value="' + esc(v || '') + '"' + req + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '') + '><datalist id="' + id + 'Lista">' + c.lista.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></label>';
    if (c.tipo === 'file') return '<label' + cls + '>' + lbl + '<input id="' + id + '" type="file" accept="' + esc(c.accept || 'image/*') + '">' + (c.ayuda ? '<small>' + esc(c.ayuda) + '</small>' : '') + '</label>';
    return '<label' + cls + '>' + lbl + '<input id="' + id + '" type="text" maxlength="' + (c.max || 80) + '" value="' + esc(v || '') + '"' + req + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '') + '></label>';
  }
  function abrirDialogo(cfg) {
    dlgCfg = cfg;
    $('geoDlgEyebrow').textContent = cfg.eyebrow || '';
    $('geoDlgTitulo').textContent = cfg.titulo;
    var val = cfg.valores || {};
    if (cfg.secciones) {
      // Campos agrupados en secciones con título, lado a lado (los que no estén en ninguna van al final)
      var usados = {};
      var html = cfg.secciones.map(function (s) {
        return '<fieldset class="geo-sec"><legend>' + esc(s.titulo) + '</legend><div class="geo-sec-g">' + s.campos.map(function (k) {
          var ancho = /\*$/.test(k); k = k.replace(/\*$/, '');
          var c = cfg.campos.filter(function (x) { return x.k === k; })[0]; if (!c) return ''; usados[k] = true;
          return campoHtml(ancho ? Object.assign({}, c, { ancho: 'full' }) : c, val[c.k]); }).join('') + '</div></fieldset>';
      }).join('');
      var resto = cfg.campos.filter(function (c) { return !usados[c.k]; });
      $('geoDlgCampos').innerHTML = '<div class="geo-secs geo-secs-' + cfg.secciones.length + '">' + html + '</div>' + resto.map(function (c) { return campoHtml(c, val[c.k]); }).join('');
    } else $('geoDlgCampos').innerHTML = cfg.campos.map(function (c) { return campoHtml(c, val[c.k]); }).join('');
    dlg.classList.toggle('geo-dlg-xl', !!cfg.secciones);
    $('geoDlgCampos').classList.toggle('con-secciones', !!cfg.secciones);
    $('geoDlgEliminar').hidden = !cfg.eliminar;
    $('geoDlgEliminar').textContent = 'Eliminar'; $('geoDlgEliminar').dataset.confirmar = '0';
    aviso('geoDlgMsg', '');
    if (cfg.campos.some(function (c) { return c.tipo === 'sede'; }) && window.PD_SEDES) window.PD_SEDES.llenar($('geoF_organizacion_id'), $('geoF_localidad_id'), (cfg.valores || {}).localidad_id || null);
    if (cfg.alAbrir) cfg.alAbrir();
    if (!dlg.open) dlg.showModal();
    var primero = $('geoDlgCampos').querySelector('input:not([type=file]),select,textarea');
    if (primero) primero.focus();
  }
  function leer() {
    var o = {};
    dlgCfg.campos.forEach(function (c) {
      if (c.tipo === 'info') return;
      var el = $('geoF_' + c.k);
      if (c.tipo === 'sede') { if (window.PD_SEDES && $('geoF_localidad_id').options.length > 1) Object.assign(o, window.PD_SEDES.valores($('geoF_organizacion_id'), $('geoF_localidad_id'))); return; }
      if (c.tipo === 'check') { o[c.k] = el.checked; return; }
      if (c.tipo === 'number') { o[c.k] = el.value === '' ? null : Number(el.value); return; }
      if (c.tipo === 'file') { o[c.k] = el.files && el.files[0] ? el.files[0] : null; return; }
      var v = el.value.trim(); o[c.k] = v === '' ? null : v;
    });
    return o;
  }
  $('geoDlgForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = leer();
    var falta = dlgCfg.campos.filter(function (c) { return c.req && c.tipo !== 'info' && !d[c.k]; })[0];
    if (falta) { aviso('geoDlgMsg', 'Completa «' + falta.label + '».', true); $('geoF_' + falta.k).focus(); return; }
    $('geoDlgGrabar').disabled = true; aviso('geoDlgMsg', 'Grabando…');
    var err = await dlgCfg.guardar(d);
    $('geoDlgGrabar').disabled = false;
    if (err) { aviso('geoDlgMsg', typeof err === 'string' ? err : traducir(err), true); return; }
    dlg.close();
  });
  $('geoDlgEliminar').addEventListener('click', async function () {
    var b = this;
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '¿Seguro? Eliminar'; setTimeout(function () { b.dataset.confirmar = '0'; b.textContent = 'Eliminar'; }, 4000); return; }
    b.disabled = true; aviso('geoDlgMsg', 'Eliminando…');
    var err = await dlgCfg.eliminar();
    b.disabled = false;
    if (err) { aviso('geoDlgMsg', typeof err === 'string' ? err : traducir(err), true); return; }
    dlg.close();
  });
  $('geoDlgCerrar').addEventListener('click', function () { dlg.close(); });
  $('geoDlgCancelar').addEventListener('click', function () { dlg.close(); });

  // ---------- Datos en caché (también para Organizaciones) ----------
  // Supabase entrega como máximo 1,000 filas por consulta: se piden por páginas hasta traer todas
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  async function cargarPaises(forzar) {
    if (paises.length && !forzar) return paises;
    var data = await todas(function () { return sb.from('geo_paises').select('*').order('codigo'); });
    paises = data.sort(function (a, b) { return (+a.codigo || 0) - (+b.codigo || 0) || a.codigo.localeCompare(b.codigo); });
    return paises;
  }
  async function estadosDe(pais, forzar) {
    if (!pais) return [];
    if (!cache.estados[pais] || forzar) cache.estados[pais] = await todas(function () { return sb.from('geo_estados').select('*').eq('pais_id', pais).order('codigo'); });
    return cache.estados[pais];
  }
  async function regionesDe(pais, forzar) {
    if (!pais) return [];
    if (!cache.regiones[pais] || forzar) { var r = await sb.from('geo_regiones').select('*').eq('pais_id', pais).order('id'); if (r.error) throw r.error; cache.regiones[pais] = r.data; }
    return cache.regiones[pais];
  }
  async function municipiosDe(estado, forzar) {
    if (!estado) return [];
    if (!cache.municipios[estado] || forzar) cache.municipios[estado] = await todas(function () { return sb.from('geo_municipios').select('*').eq('estado_id', estado).order('codigo'); });
    return cache.municipios[estado];
  }
  // Listas encadenadas País → Estado → Municipio dentro de la ventana (ids de los <select>: geoF_<k>)
  function encadenar(kPais, kEstado, kMun) {
    async function llenarEstados(sel) {
      var l = await estadosDe(+$('geoF_' + kPais).value || null);
      $('geoF_' + kEstado).innerHTML = '<option value="">—</option>' + l.map(function (e) { return '<option value="' + e.id + '">' + esc(e.codigo + ' · ' + e.nombre) + '</option>'; }).join('');
      $('geoF_' + kEstado).value = sel ? String(sel) : '';
    }
    async function llenarMunicipios(sel) {
      var l = await municipiosDe(+$('geoF_' + kEstado).value || null);
      $('geoF_' + kMun).innerHTML = '<option value="">—</option>' + l.map(function (m) { return '<option value="' + m.id + '">' + esc(m.codigo + ' · ' + m.nombre) + '</option>'; }).join('');
      $('geoF_' + kMun).value = sel ? String(sel) : '';
    }
    return async function (valores) {
      $('geoF_' + kPais).addEventListener('change', async function () { await llenarEstados(null); await llenarMunicipios(null); });
      $('geoF_' + kEstado).addEventListener('change', function () { llenarMunicipios(null); });
      await llenarEstados(valores[kEstado]); await llenarMunicipios(valores[kMun]);
    };
  }
  function opcionesPaises() { return [['', '—']].concat(paises.map(function (p) { return [p.id, (p.bandera ? p.bandera + ' ' : '') + p.codigo + ' · ' + p.nombre]; })); }

  // ---------- Pantalla ----------
  $('admGeografia').innerHTML =
    '<div class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Geografía</h3></div>' +
    '<p class="dlg-msg">Países, sus estados o departamentos (con su región) y sus ciudades o municipios. Toca una fila para ver su detalle abajo; con ✎ la modificas.</p>' +
    '<section class="geo-panel"><div class="geo-head"><h4>Países</h4><button type="button" class="adm-btn adm-primary geo-mini" id="geoNuevoPais">+ País</button></div>' +
    '<input id="geoBuscarPais" type="search" class="adm-input geo-buscar" placeholder="Buscar país, prefijo o código" aria-label="Buscar país">' +
    '<div class="roles-wrap geo-scroll"><table class="geo-tabla"><thead><tr><th>Cód.</th><th>País</th><th>Prefijo</th><th>Cód. tel.</th><th>Idioma</th><th>Moneda</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="geoPaises"></tbody></table></div></section>' +
    '<section class="geo-panel"><div class="geo-head"><h4 id="geoTitEstados">Estados / Departamentos</h4><div class="geo-head-btns"><button type="button" class="adm-btn geo-mini" id="geoRegiones">Regiones</button><button type="button" class="adm-btn adm-primary geo-mini" id="geoNuevoEstado">+ Departamento</button></div></div>' +
    '<input id="geoBuscarEstado" type="search" class="adm-input geo-buscar" placeholder="Buscar estado o departamento" aria-label="Buscar estado">' +
    '<div class="roles-wrap geo-scroll"><table class="geo-tabla"><thead><tr><th>Cód.</th><th>Estado / Departamento</th><th>Región</th><th>Cód. tel.</th><th>Cód. postal</th><th>Municipios</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="geoEstados"></tbody></table></div></section>' +
    '<section class="geo-panel"><div class="geo-head"><h4 id="geoTitMun">Ciudades / Municipios</h4><div class="geo-head-btns"><input id="geoBuscarMun" type="search" class="adm-input" placeholder="Buscar municipio" aria-label="Buscar municipio"><button type="button" class="adm-btn adm-primary geo-mini" id="geoNuevoMun">+ Municipio</button></div></div>' +
    '<div class="roles-wrap geo-scroll"><table class="geo-tabla"><thead><tr><th>Cód.</th><th>Ciudad / Municipio</th><th>Prefijo</th><th>Cód. tel.</th><th>Prefijo ciudad</th><th>Cód. postal</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="geoMunicipios"></tbody></table></div></section>' +
    '<p id="geoMsg" class="dlg-msg" role="status"></p>' +
    '<p class="geo-fuente">Datos mundiales de países, estados y ciudades: <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noopener">countries-states-cities-database</a> (licencia ODbL). Guatemala: división oficial (22 departamentos, 340 municipios).</p></div>';

  var EDITAR = '<button type="button" class="geo-editar" aria-label="Modificar" title="Modificar">✎</button>';
  function fila(tipo, id, sel, celdas) {
    return '<tr data-geo="' + tipo + '" data-id="' + id + '" class="' + (sel ? 'geo-sel' : '') + '" tabindex="0">' + celdas.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '<td class="geo-acc">' + EDITAR + '</td></tr>';
  }
  function vacia(n, t) { return '<tr><td colspan="' + n + '" class="geo-vacia">' + t + '</td></tr>'; }
  function nombrePais(id) { var p = paises.filter(function (x) { return x.id === id; })[0]; return p ? p.nombre : ''; }
  function nombreEstado(id) { var e = estados.filter(function (x) { return x.id === id; })[0]; return e ? e.nombre : ''; }

  function pintarPaises() {
    var tp = norm(buscarPais), lp = paises.filter(function (p) { return !tp || p.id === paisSel || norm(p.codigo + ' ' + p.nombre + ' ' + (p.prefijo || '')).indexOf(tp) >= 0; });
    $('geoPaises').innerHTML = lp.length ? lp.map(function (p) {
      return fila('pais', p.id, p.id === paisSel, [esc(p.codigo), '<span class="geo-bandera">' + esc(p.bandera || '') + '</span>' + esc(p.nombre), esc(p.prefijo || '—'), esc(p.codigo_tel ? '+' + p.codigo_tel : '—'), esc(p.idioma || '—'), esc(p.moneda || '—')]);
    }).join('') : vacia(7, 'Aún no hay países. Agrega el primero con «+ País».');
  }
  function pintarEstados() {
    var reg = {}; regiones.forEach(function (r) { reg[r.id] = r.nombre; });
    $('geoTitEstados').textContent = paisSel ? 'Estados / Departamentos de ' + nombrePais(paisSel) : 'Estados / Departamentos';
    var te = norm(buscarEstado), le = estados.filter(function (e) { return !te || e.id === estadoSel || norm(e.codigo + ' ' + e.nombre).indexOf(te) >= 0; });
    $('geoEstados').innerHTML = !paisSel ? vacia(7, 'Elige un país.') : le.length ? le.map(function (e) {
      var n = cache.municipios[e.id] ? cache.municipios[e.id].length : (e.n == null ? '…' : e.n);
      return fila('estado', e.id, e.id === estadoSel, [esc(e.codigo), esc(e.nombre), esc(reg[e.region_id] || '—'), esc(e.codigo_tel ? '+' + e.codigo_tel : '—'), esc(e.codigo_postal || '—'), n]);
    }).join('') : vacia(7, 'Este país aún no tiene departamentos.');
  }
  function pintarMunicipios() {
    $('geoTitMun').textContent = estadoSel ? 'Ciudades / Municipios de ' + nombreEstado(estadoSel) : 'Ciudades / Municipios';
    var t = norm(buscarMun), l = municipios.filter(function (m) { return !t || norm(m.codigo + ' ' + m.nombre).indexOf(t) >= 0; });
    $('geoMunicipios').innerHTML = !estadoSel ? vacia(7, 'Elige un departamento.') : l.length ? l.map(function (m) {
      return fila('municipio', m.id, false, [esc(m.codigo), esc(m.nombre), esc(m.prefijo || '—'), esc(m.codigo_tel ? '+' + m.codigo_tel : '—'), esc(m.prefijo_ciudad || '—'), esc(m.codigo_postal || '—')]);
    }).join('') : vacia(7, municipios.length ? 'Ningún municipio coincide con la búsqueda.' : 'Este departamento aún no tiene municipios.');
  }

  async function cargar() {
    aviso('geoMsg', '');
    try { await cargarPaises(true); } catch (e) { $('geoPaises').innerHTML = ''; aviso('geoMsg', traducir(e), true); return; }
    if (!paisSel || !paises.some(function (p) { return p.id === paisSel; })) paisSel = paises.length ? paises[0].id : null;
    pintarPaises();
    await elegirPais(paisSel, true);
  }
  async function elegirPais(id, forzar) {
    if (!forzar) { buscarEstado = ''; buscarMun = ''; $('geoBuscarEstado').value = ''; $('geoBuscarMun').value = ''; }
    paisSel = id; estadoSel = forzar ? estadoSel : null; pintarPaises();
    try {
      var r = await Promise.all([estadosDe(id, forzar), regionesDe(id, forzar)]);
      estados = r[0]; regiones = r[1];
      // Cantidad de municipios por departamento (una sola consulta)
      if (estados.length) {
        var c = await sb.from('geo_estados').select('id, geo_municipios(count)').eq('pais_id', id).range(0, 999);
        var cuenta = {}; (c.data || []).forEach(function (x) { cuenta[x.id] = x.geo_municipios && x.geo_municipios[0] ? x.geo_municipios[0].count : 0; });
        estados.forEach(function (e) { e.n = c.error ? null : (cuenta[e.id] || 0); });
      }
    } catch (e) { estados = []; regiones = []; aviso('geoMsg', traducir(e), true); }
    if (!estados.some(function (e) { return e.id === estadoSel; })) estadoSel = estados.length ? estados[0].id : null;
    pintarEstados();
    await elegirEstado(estadoSel, forzar);
  }
  async function elegirEstado(id, forzar) {
    if (!forzar) { buscarMun = ''; $('geoBuscarMun').value = ''; }
    estadoSel = id; pintarEstados();
    try { municipios = id ? await municipiosDe(id, forzar) : []; } catch (e) { municipios = []; aviso('geoMsg', traducir(e), true); }
    pintarMunicipios();
  }

  // ---------- Altas y cambios ----------
  async function guardar(tabla, id, datos) {
    var r = id ? await sb.from(tabla).update(datos).eq('id', id) : await sb.from(tabla).insert(datos);
    return r.error || null;
  }
  async function borrar(tabla, id) { var r = await sb.from(tabla).delete().eq('id', id); return r.error || null; }

  function editarPais(p) {
    abrirDialogo({
      eyebrow: 'Geografía · País', titulo: p ? p.nombre : 'Nuevo país', valores: p || {},
      campos: [{ k: 'codigo', label: 'Código de país', req: true, max: 10 }, { k: 'nombre', label: 'Nombre del país', req: true },
        { k: 'prefijo', label: 'Prefijo (siglas)', max: 10, placeholder: 'GT' }, { k: 'bandera', label: 'Bandera', max: 300, placeholder: '🇬🇹' },
        { k: 'idioma', label: 'Idioma', max: 60, placeholder: 'Español' }, { k: 'moneda', label: 'Moneda', max: 30, placeholder: 'GTQ' },
        { k: 'codigo_tel', label: 'Código telefónico', max: 10, placeholder: '502' }],
      guardar: async function (d) { if (d.codigo_tel) d.codigo_tel = d.codigo_tel.replace(/^\+/, ''); var e = await guardar('geo_paises', p && p.id, d); if (!e) await cargar(); return e; },
      eliminar: p ? async function () { var e = await borrar('geo_paises', p.id); if (!e) { paisSel = null; await cargar(); } return e; } : null
    });
  }
  function editarEstado(e0) {
    if (!paisSel) return;
    abrirDialogo({
      eyebrow: 'Geografía · ' + nombrePais(paisSel), titulo: e0 ? e0.nombre : 'Nuevo estado / departamento', valores: e0 || { codigo_tel: (paises.filter(function (p) { return p.id === paisSel; })[0] || {}).codigo_tel },
      campos: [{ k: 'pais', label: 'País', tipo: 'info' }, { k: 'codigo', label: 'Código', req: true, max: 10 }, { k: 'nombre', label: 'Nombre del estado / departamento', req: true },
        { k: 'region_id', label: 'Región', tipo: 'select', opciones: [['', 'Sin región']].concat(regiones.map(function (r) { return [r.id, r.nombre]; })), ayuda: 'Las regiones se administran con el botón «Regiones».' },
        { k: 'codigo_tel', label: 'Código telefónico', max: 10 }, { k: 'codigo_postal', label: 'Código postal', max: 15 }],
      alAbrir: function () { $('geoF_pais').textContent = nombrePais(paisSel); },
      guardar: async function (d) {
        d.pais_id = paisSel; d.region_id = d.region_id ? +d.region_id : null;
        var e = await guardar('geo_estados', e0 && e0.id, d); if (!e) await elegirPais(paisSel, true); return e;
      },
      eliminar: e0 ? async function () { var e = await borrar('geo_estados', e0.id); if (!e) { estadoSel = null; await elegirPais(paisSel, true); } return e; } : null
    });
  }
  function editarMunicipio(m) {
    if (!estadoSel) return;
    var e0 = estados.filter(function (x) { return x.id === estadoSel; })[0] || {};
    var siguiente = e0.codigo ? e0.codigo + String(municipios.length + 1).padStart(2, '0') : '';
    abrirDialogo({
      eyebrow: 'Geografía · ' + nombrePais(paisSel) + ' › ' + e0.nombre, titulo: m ? m.nombre : 'Nueva ciudad / municipio', valores: m || { codigo: siguiente, codigo_tel: e0.codigo_tel, codigo_postal: e0.codigo_postal },
      campos: [{ k: 'pais', label: 'País', tipo: 'info' }, { k: 'estado', label: 'Estado / Departamento', tipo: 'info' },
        { k: 'codigo', label: 'Código', req: true, max: 10 }, { k: 'nombre', label: 'Nombre de la ciudad / municipio', req: true },
        { k: 'prefijo', label: 'Prefijo', max: 10 }, { k: 'codigo_tel', label: 'Código telefónico', max: 10 },
        { k: 'prefijo_ciudad', label: 'Prefijo de ciudad', max: 10 }, { k: 'codigo_postal', label: 'Código postal', max: 15 }],
      alAbrir: function () { $('geoF_pais').textContent = nombrePais(paisSel); $('geoF_estado').textContent = e0.nombre; },
      guardar: async function (d) {
        d.pais_id = paisSel; d.estado_id = estadoSel;
        var e = await guardar('geo_municipios', m && m.id, d); if (!e) { await elegirEstado(estadoSel, true); pintarEstados(); } return e;
      },
      eliminar: m ? async function () { var e = await borrar('geo_municipios', m.id); if (!e) { await elegirEstado(estadoSel, true); pintarEstados(); } return e; } : null
    });
  }
  // Regiones del país: lista con alta, cambio y baja en la misma ventana
  function editarRegiones() {
    if (!paisSel) return;
    abrirDialogo({
      eyebrow: 'Geografía · ' + nombrePais(paisSel), titulo: 'Regiones', valores: {},
      campos: [{ k: 'lista', label: 'Regiones actuales', tipo: 'info', ancho: 'full' }, { k: 'codigo', label: 'Código de la nueva región', req: true, max: 10, placeholder: 'IX' }, { k: 'nombre', label: 'Nombre', req: true, placeholder: 'Región IX · …' }],
      alAbrir: function () {
        $('geoF_lista').innerHTML = regiones.length ? regiones.map(function (r) {
          return '<span class="geo-chip">' + esc(r.nombre) + ' <button type="button" data-borrar-region="' + r.id + '" aria-label="Eliminar ' + esc(r.nombre) + '">×</button></span>';
        }).join('') : 'Sin regiones';
        $('geoDlgGrabar').textContent = 'Agregar región';
      },
      guardar: async function (d) {
        d.pais_id = paisSel; var e = await guardar('geo_regiones', null, d);
        if (!e) { regiones = await regionesDe(paisSel, true); pintarEstados(); }
        return e;
      }
    });
  }
  $('geoDlgCampos').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-region]');
    if (!b) return;
    var err = await borrar('geo_regiones', +b.dataset.borrarRegion);
    if (err) { aviso('geoDlgMsg', traducir(err), true); return; }
    regiones = await regionesDe(paisSel, true); pintarEstados();
    b.parentNode.remove(); aviso('geoDlgMsg', 'Región eliminada.');
  });
  dlg.addEventListener('close', function () { $('geoDlgGrabar').textContent = 'Grabar'; });

  // ---------- Eventos ----------
  $('admGeografia').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-geo]');
    if (!tr) return;
    var id = +tr.dataset.id, tipo = tr.dataset.geo, editar = !!e.target.closest('.geo-editar');
    if (tipo === 'pais') { if (editar) editarPais(paises.filter(function (p) { return p.id === id; })[0]); else if (id !== paisSel) elegirPais(id); }
    if (tipo === 'estado') { if (editar) editarEstado(estados.filter(function (x) { return x.id === id; })[0]); else if (id !== estadoSel) elegirEstado(id); }
    if (tipo === 'municipio') editarMunicipio(municipios.filter(function (m) { return m.id === id; })[0]);
  });
  $('admGeografia').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-geo]')) e.target.click(); });
  $('geoNuevoPais').addEventListener('click', function () { editarPais(null); });
  $('geoNuevoEstado').addEventListener('click', function () { if (!paisSel) { aviso('geoMsg', 'Primero elige un país.', true); return; } editarEstado(null); });
  $('geoNuevoMun').addEventListener('click', function () { if (!estadoSel) { aviso('geoMsg', 'Primero elige un departamento.', true); return; } editarMunicipio(null); });
  $('geoRegiones').addEventListener('click', function () { if (!paisSel) { aviso('geoMsg', 'Primero elige un país.', true); return; } editarRegiones(); });
  $('geoBuscarMun').addEventListener('input', function () { buscarMun = this.value; pintarMunicipios(); });
  $('geoBuscarPais').addEventListener('input', function () { buscarPais = this.value; pintarPaises(); });
  $('geoBuscarEstado').addEventListener('input', function () { buscarEstado = this.value; pintarEstados(); });

  window.PD_GEO = {
    paises: cargarPaises, estados: estadosDe, municipios: municipiosDe, opcionesPaises: opcionesPaises,
    dialogo: abrirDialogo, encadenar: encadenar, traducir: traducir, esc: esc,
    nombre: function (lista, id) { var x = (lista || []).filter(function (o) { return o.id === id; })[0]; return x ? x.nombre : ''; }
  };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admGeografia').hidden) cargar(); },
    limpiar: function () { paises = []; regiones = []; estados = []; municipios = []; paisSel = estadoSel = null; cache = { estados: {}, municipios: {}, regiones: {} }; ['geoPaises', 'geoEstados', 'geoMunicipios'].forEach(function (i) { $(i).innerHTML = ''; }); }
  });
  // Cargar al abrir la pestaña
  var tab = document.querySelector('[data-tab="admGeografia"]');
  if (tab) tab.addEventListener('click', function () { setTimeout(cargar, 0); });
})();
