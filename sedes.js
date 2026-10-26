// Plus Dental — Sedes: listas encadenadas Organización → Localidad / Empresa para los formularios
// (pacientes, odontólogos, tipos de odontólogos y usuarios). La separación por sede la hace Supabase (ve_sede).
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var orgs = [], locs = [], cargado = null, miLoc;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(a, b) { return (parseInt(a.codigo, 10) || 0) - (parseInt(b.codigo, 10) || 0); }

  function cargar(forzar) {
    if (cargado && !forzar) return cargado;
    cargado = (async function () {
      var r = await Promise.all([
        sb.from('organizaciones').select('id,codigo,nombre,estado'),
        sb.from('org_localidades').select('id,organizacion_id,codigo,nombre_comercial,razon_social,estado'),
        sb.rpc('mi_localidad')
      ]);
      orgs = r[0].error ? [] : r[0].data.sort(num);
      locs = r[1].error ? [] : r[1].data.sort(num);
      miLoc = r[2].error ? null : r[2].data;
    })();
    return cargado;
  }
  function org(id) { return orgs.filter(function (o) { return o.id === id; })[0]; }
  function loc(id) { return locs.filter(function (l) { return l.id === id; })[0]; }
  function codigoLoc(l) { var o = org(l.organizacion_id); return (o ? o.codigo + '-' : '') + String(l.codigo).padStart(2, '0'); }
  function nombreLoc(l) { return l.nombre_comercial || l.razon_social; }
  // Texto corto de la sede: «2-01 · PLUS DENTAL ZONA 1O»
  function texto(locId) { var l = loc(locId); return l ? codigoLoc(l) + ' · ' + nombreLoc(l) : '—'; }

  // Llena los <select> de organización y localidad (solo activas, más la ya elegida) y los encadena.
  // Por defecto: la sede del usuario conectado.
  async function llenar(selOrg, selLoc, locId, porDefecto) {
    await cargar();
    if (!locId && porDefecto !== false) locId = miLoc || null;
    var l0 = locId ? loc(locId) : null, orgId = l0 ? l0.organizacion_id : null;
    selOrg.innerHTML = '<option value="">—</option>' + orgs.filter(function (o) { return o.estado === 'activo' || o.id === orgId; }).map(function (o) {
      return '<option value="' + o.id + '">' + esc(o.codigo + ' · ' + o.nombre) + '</option>'; }).join('');
    selOrg.value = orgId ? String(orgId) : '';
    function locales(sel) {
      var oid = +selOrg.value || null;
      var l = locs.filter(function (x) { return x.organizacion_id === oid && (x.estado === 'activo' || x.id === sel); });
      selLoc.innerHTML = '<option value="">—</option>' + l.map(function (x) { return '<option value="' + x.id + '">' + esc(codigoLoc(x) + ' · ' + nombreLoc(x)) + '</option>'; }).join('');
      selLoc.value = sel && l.some(function (x) { return x.id === sel; }) ? String(sel) : (l.length === 1 ? String(l[0].id) : '');
    }
    locales(locId);
    if (!selOrg.dataset.sedeEnlazado) { selOrg.dataset.sedeEnlazado = '1'; selOrg.addEventListener('change', function () { locales(null); }); }
  }
  // Valores para grabar (la organización la completa Supabase a partir de la localidad)
  function valores(selOrg, selLoc) { return { organizacion_id: +selOrg.value || null, localidad_id: +selLoc.value || null }; }

  // De una lista con localidad_id, deja los registros de la sede indicada (o la del usuario); si no hay ninguno, la lista completa
  function deSede(lista, locId) {
    var l = locId || miLoc;
    if (!l || !lista) return lista;
    var f = lista.filter(function (x) { return x.localidad_id === l; });
    return f.length ? f : lista.filter(function (x) { return !x.localidad_id; }).length ? lista.filter(function (x) { return !x.localidad_id; }) : lista;
  }
  window.PD_SEDES = { deSede: deSede, miLocalidad: function () { return miLoc; }, cargar: cargar, llenar: llenar, valores: valores, texto: texto, lista: function () { return locs; }, codigoLoc: codigoLoc, nombreLoc: nombreLoc };
})();
