// Plus Dental — Organizaciones (grupo «Catálogos iniciales» › «Geografía y Organizaciones»)
// Maestro-detalle: la organización (grupo corporativo) y sus localidades (empresas / sedes) con razón social, NIT,
// código patronal, ubicación (País → Estado → Municipio del catálogo de Geografía) y logo (almacenamiento público).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admOrganizaciones') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var SELECT = '*, pais:geo_paises(nombre,bandera), depto:geo_estados(nombre), municipio:geo_municipios(nombre)';
  var orgs = [], locs = [], orgSel = null, locSel = null;
  var ESTADOS = { activo: 'Activo', inactivo: 'Inactivo', baja: 'Baja' };
  var OPC_ESTADO = [['activo', 'Activo'], ['inactivo', 'Inactivo'], ['baja', 'Baja']];

  function $(id) { return document.getElementById(id); }
  function aviso(texto, error) { $('orgMsg').textContent = texto || ''; $('orgMsg').style.color = error ? '#9A3B2E' : '#475B68'; }
  function logoUrl(ruta) { return ruta ? sb.storage.from('publico').getPublicUrl(ruta).data.publicUrl : ''; }
  function ubicacion(x) { return [x.municipio && x.municipio.nombre, x.depto && x.depto.nombre, x.pais && ((x.pais.bandera ? x.pais.bandera + ' ' : '') + x.pais.nombre)].filter(Boolean).join(', ') || '—'; }
  function pill(e) { e = e || 'activo'; return '<span class="estado estado-' + e + '">' + (ESTADOS[e] || e) + '</span>'; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  // Registro: estado, quién grabó y cuándo (con segundos), última modificación y botones para actualizar
  function registro(x, tipo) {
    return '<div class="org-registro"><div class="org-reg-datos">' + pill(x.estado) +
      '<span>Grabado por <b>' + esc(x.creado_por || 'Sin usuario') + '</b> el <b>' + fechaHora(x.creado) + '</b></span>' +
      (x.modificado ? '<span>Última modificación por <b>' + esc(x.modificado_por || 'Sin usuario') + '</b> el <b>' + fechaHora(x.modificado) + '</b></span>' : '') + '</div>' +
      '<div class="org-reg-btns"><button type="button" class="adm-btn adm-primary geo-mini" data-org-modificar="' + tipo + '">Modificar</button>' +
      '<button type="button" class="adm-btn geo-mini" data-org-actualizar>Actualizar</button></div></div>';
  }
  // Códigos correlativos en orden numérico ascendente (1, 2, … 10), no alfabético (1, 10, 2)
  function porCodigo(a, b) { return (parseInt(a.codigo, 10) || 0) - (parseInt(b.codigo, 10) || 0) || String(a.codigo).localeCompare(String(b.codigo)); }
  function dato(k, v, ancho) { return '<div class="geo-info' + (ancho ? ' full' : '') + '"><span>' + k + '</span><b>' + (v ? esc(v) : '—') + '</b></div>'; }

  $('admOrganizaciones').innerHTML =
    '<div class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Organizaciones</h3><button type="button" class="adm-btn adm-primary" id="orgNueva">+ Organización</button></div>' +
    '<p class="dlg-msg">La organización (grupo corporativo) y sus localidades: cada empresa o sede con su razón social, NIT, código patronal, ubicación y logo.</p>' +
    '<section class="geo-panel"><div class="geo-head"><h4>Organización</h4></div>' +
    '<div class="roles-wrap"><table class="geo-tabla"><thead><tr><th>Cód.</th><th>Organización</th><th>Representante legal</th><th>Teléfonos</th><th>Ubicación</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="orgLista"></tbody></table></div>' +
    '<div id="orgFicha" class="geo-ficha" hidden></div></section>' +
    '<section class="geo-panel"><div class="geo-head"><h4 id="orgTitLoc">Localidades</h4><button type="button" class="adm-btn adm-primary geo-mini" id="orgNuevaLoc">+ Localidad</button></div>' +
    '<div class="roles-wrap"><table class="geo-tabla"><thead><tr><th>Loc.</th><th>Nombre comercial</th><th>Razón social</th><th>NIT</th><th>Municipio</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="orgLocs"></tbody></table></div>' +
    '<div id="locFicha" class="geo-ficha" hidden></div></section>' +
    '<p id="orgMsg" class="dlg-msg" role="status"></p></div>';

  var EDITAR = '<button type="button" class="geo-editar" aria-label="Modificar" title="Modificar">✎</button>';
  function fila(tipo, id, sel, celdas) {
    return '<tr data-org="' + tipo + '" data-id="' + id + '" class="' + (sel ? 'geo-sel' : '') + '" tabindex="0">' + celdas.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '<td class="geo-acc">' + EDITAR + '</td></tr>';
  }

  function pintarOrgs() {
    $('orgLista').innerHTML = orgs.length ? orgs.map(function (o) {
      return fila('org', o.id, o.id === orgSel, [esc(o.codigo), '<b>' + esc(o.nombre) + '</b>', esc(o.representante || '—'), esc(o.telefonos || '—'), esc(ubicacion(o)), pill(o.estado)]);
    }).join('') : '<tr><td colspan="7" class="geo-vacia">Aún no hay organizaciones. Crea la primera con «+ Organización».</td></tr>';
    var o = orgs.filter(function (x) { return x.id === orgSel; })[0];
    $('orgFicha').hidden = !o;
    if (o) $('orgFicha').innerHTML = registro(o, 'org') + '<div class="geo-ficha-grid">' + dato('Organización', o.codigo + ' · ' + o.nombre) + dato('Representante legal', o.representante) + dato('Teléfonos', o.telefonos) + dato('Correos', o.correos) +
      dato('Dirección', o.direccion, 1) + dato('País', o.pais && o.pais.nombre) + dato('Estado / Departamento', o.depto && o.depto.nombre) + dato('Ciudad / Municipio', o.municipio && o.municipio.nombre) + '</div>';
  }
  function pintarLocs() {
    var o = orgs.filter(function (x) { return x.id === orgSel; })[0];
    $('orgTitLoc').textContent = o ? 'Localidades de ' + o.nombre : 'Localidades';
    $('orgLocs').innerHTML = !o ? '<tr><td colspan="7" class="geo-vacia">Elige una organización.</td></tr>' : locs.length ? locs.map(function (l) {
      return fila('loc', l.id, l.id === locSel, [esc(l.codigo), '<b>' + esc(l.nombre_comercial || '—') + '</b>', esc(l.razon_social), esc(l.nit || '—'), esc(l.municipio ? l.municipio.nombre : '—'), pill(l.estado)]);
    }).join('') : '<tr><td colspan="7" class="geo-vacia">Esta organización aún no tiene localidades.</td></tr>';
    var l = locs.filter(function (x) { return x.id === locSel; })[0];
    $('locFicha').hidden = !l;
    if (l) $('locFicha').innerHTML = registro(l, 'loc') + '<div class="org-loc"><div class="geo-ficha-grid">' + dato('Localidad', l.codigo) + dato('Razón social', l.razon_social, 1) + dato('Nombre comercial', l.nombre_comercial) +
      dato('Representante legal', l.representante) + dato('NIT', l.nit) + dato('Código patronal', l.codigo_patrono) + dato('Teléfonos', l.telefonos) + dato('Correos', l.correos) +
      dato('Dirección', l.direccion, 1) + dato('País', l.pais && l.pais.nombre) + dato('Estado / Departamento', l.depto && l.depto.nombre) + dato('Ciudad / Municipio', l.municipio && l.municipio.nombre) + '</div>' +
      '<div class="org-logo">' + (l.logo ? '<img src="' + esc(logoUrl(l.logo)) + '" alt="Logo de ' + esc(l.nombre_comercial || l.razon_social) + '">' : '<span>Sin logo</span>') + '</div></div>';
  }

  async function cargar() {
    aviso('');
    var r = await sb.from('organizaciones').select(SELECT).order('codigo');
    if (r.error) { $('orgLista').innerHTML = ''; aviso(G.traducir(r.error), true); return; }
    orgs = r.data.sort(porCodigo);
    if (!orgs.some(function (o) { return o.id === orgSel; })) orgSel = orgs.length ? orgs[0].id : null;
    pintarOrgs();
    await cargarLocs();
    try { await G.paises(); } catch (e) { aviso(G.traducir(e), true); }
  }
  async function cargarLocs() {
    locs = [];
    if (orgSel) {
      var r = await sb.from('org_localidades').select(SELECT).eq('organizacion_id', orgSel).order('codigo');
      if (r.error) aviso(G.traducir(r.error), true); else locs = r.data.sort(porCodigo);
    }
    if (!locs.some(function (l) { return l.id === locSel; })) locSel = locs.length ? locs[0].id : null;
    pintarLocs();
  }

  // Campos de ubicación compartidos (listas encadenadas País → Estado → Municipio)
  function camposUbicacion() {
    return [{ k: 'pais_id', label: 'País', tipo: 'select', opciones: G.opcionesPaises() }, { k: 'estado_id', label: 'Estado / Departamento', tipo: 'select', opciones: [['', '—']] },
      { k: 'municipio_id', label: 'Ciudad / Municipio', tipo: 'select', opciones: [['', '—']] }];
  }
  function ids(d) { ['pais_id', 'estado_id', 'municipio_id'].forEach(function (k) { d[k] = d[k] ? +d[k] : null; }); return d; }
  function guatemala() { return ((window.PD_GEO_PAISES || []).filter(function (p) { return p.codigo === '1'; })[0] || {}).id; }

  async function editarOrg(o) {
    try { window.PD_GEO_PAISES = await G.paises(); } catch (e) { aviso(G.traducir(e), true); return; }
    var v = o ? Object.assign({}, o) : { codigo: 'Se asigna al grabar', estado: 'activo', pais_id: guatemala() };
    G.dialogo({
      eyebrow: 'Organizaciones', titulo: o ? o.nombre : 'Nueva organización', valores: v,
      campos: [{ k: 'codigo', label: 'Código de organización (automático)', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'nombre', label: 'Nombre de la organización', req: true, max: 150, ancho: 'full' },
        { k: 'representante', label: 'Representante legal', max: 150 }, { k: 'telefonos', label: 'Teléfonos', max: 120 }, { k: 'correos', label: 'Correos', max: 200, ancho: 'full' },
        { k: 'direccion', label: 'Dirección', tipo: 'textarea', max: 300, ancho: 'full' }].concat(camposUbicacion()),
      alAbrir: function () { G.encadenar('pais_id', 'estado_id', 'municipio_id')(v); colorEstado(); },
      guardar: async function (d) {
        d = ids(d);
        var r = o ? await sb.from('organizaciones').update(d).eq('id', o.id).select('id').single() : await sb.from('organizaciones').insert(d).select('id').single();
        if (r.error) return r.error;
        orgSel = r.data.id; await cargar(); return null;
      },
      eliminar: o ? async function () { var r = await sb.from('organizaciones').delete().eq('id', o.id); if (r.error) return r.error; orgSel = null; await cargar(); return null; } : null
    });
  }

  function colorEstado() { var sel = $('geoF_estado'); if (!sel) return; sel.classList.add('org-estado-sel'); var pinta = function () { sel.dataset.estado = sel.value; }; sel.addEventListener('change', pinta); pinta(); }

  async function subirLogo(id, archivo) {
    if (!archivo) return null;
    if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) return 'El logo debe ser una imagen PNG, JPG o WEBP.';
    if (archivo.size > 2 * 1024 * 1024) return 'El logo pesa más de 2 MB.';
    var ruta = 'logos/localidad-' + id + '-' + Date.now() + '.' + (archivo.type.split('/')[1] === 'jpeg' ? 'jpg' : archivo.type.split('/')[1]);
    var up = await sb.storage.from('publico').upload(ruta, archivo, { contentType: archivo.type, upsert: true, cacheControl: '300' });
    if (up.error) return 'La localidad se grabó, pero el logo no se pudo subir: ' + G.traducir(up.error);
    var r = await sb.from('org_localidades').update({ logo: ruta }).eq('id', id);
    return r.error || null;
  }
  async function editarLoc(l) {
    if (!orgSel) { aviso('Primero elige o crea una organización.', true); return; }
    try { window.PD_GEO_PAISES = await G.paises(); } catch (e) { aviso(G.traducir(e), true); return; }
    var o = orgs.filter(function (x) { return x.id === orgSel; })[0];
    var v = l ? Object.assign({}, l) : { codigo: 'Se asigna al grabar', estado: 'activo', pais_id: o.pais_id || guatemala(), estado_id: o.estado_id, municipio_id: o.municipio_id };
    G.dialogo({
      eyebrow: 'Organizaciones · ' + o.nombre, titulo: l ? (l.nombre_comercial || l.razon_social) : 'Nueva localidad', valores: v,
      campos: [{ k: 'codigo', label: 'Código de localidad (automático)', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: OPC_ESTADO },
        { k: 'nit', label: 'NIT', max: 20, placeholder: '1234567-8' },
        { k: 'razon_social', label: 'Razón social', req: true, max: 200, ancho: 'full' }, { k: 'nombre_comercial', label: 'Nombre comercial', max: 150 },
        { k: 'representante', label: 'Representante legal', max: 150 }, { k: 'codigo_patrono', label: 'Código patronal', max: 30 }, { k: 'telefonos', label: 'Teléfonos', max: 120 },
        { k: 'correos', label: 'Correos', max: 200, ancho: 'full' }].concat(camposUbicacion()).concat([
        { k: 'direccion', label: 'Detalle de dirección', tipo: 'textarea', max: 300, ancho: 'full' },
        { k: 'logo_archivo', label: l && l.logo ? 'Cambiar logo' : 'Logo', tipo: 'file', accept: 'image/png,image/jpeg,image/webp', ayuda: 'PNG, JPG o WEBP de hasta 2 MB.', ancho: 'full' }]),
      alAbrir: function () { G.encadenar('pais_id', 'estado_id', 'municipio_id')(v); colorEstado(); },
      guardar: async function (d) {
        var archivo = d.logo_archivo; delete d.logo_archivo;
        d = ids(d); d.organizacion_id = orgSel;
        var r = l ? await sb.from('org_localidades').update(d).eq('id', l.id).select('id').single() : await sb.from('org_localidades').insert(d).select('id').single();
        if (r.error) return r.error;
        locSel = r.data.id;
        var e = await subirLogo(r.data.id, archivo);
        await cargarLocs();
        return e;
      },
      eliminar: l ? async function () { var r = await sb.from('org_localidades').delete().eq('id', l.id); if (r.error) return r.error; locSel = null; await cargarLocs(); return null; } : null
    });
  }

  $('admOrganizaciones').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-org]');
    if (!tr) return;
    var id = +tr.dataset.id, editar = !!e.target.closest('.geo-editar');
    if (tr.dataset.org === 'org') {
      if (editar) editarOrg(orgs.filter(function (o) { return o.id === id; })[0]);
      else if (id !== orgSel) { orgSel = id; locSel = null; pintarOrgs(); cargarLocs(); }
    } else {
      if (editar) editarLoc(locs.filter(function (l) { return l.id === id; })[0]);
      else { locSel = id; pintarLocs(); }
    }
  });
  $('admOrganizaciones').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-org]')) e.target.click(); });
  $('admOrganizaciones').addEventListener('click', function (e) {
    var m = e.target.closest('[data-org-modificar]');
    if (m) { if (m.dataset.orgModificar === 'org') editarOrg(orgs.filter(function (o) { return o.id === orgSel; })[0]); else editarLoc(locs.filter(function (l) { return l.id === locSel; })[0]); return; }
    if (e.target.closest('[data-org-actualizar]')) { cargar().then(function () { aviso('Datos actualizados.'); }); }
  });
  $('orgNueva').addEventListener('click', function () { editarOrg(null); });
  $('orgNuevaLoc').addEventListener('click', function () { editarLoc(null); });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admOrganizaciones').hidden) cargar(); },
    limpiar: function () { orgs = []; locs = []; orgSel = locSel = null; $('orgLista').innerHTML = ''; $('orgLocs').innerHTML = ''; $('orgFicha').hidden = $('locFicha').hidden = true; }
  });
  var tab = document.querySelector('[data-tab="admOrganizaciones"]');
  if (tab) tab.addEventListener('click', function () { setTimeout(cargar, 0); });
})();
