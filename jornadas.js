// Plus Dental — Jornadas: 1. Instituciones (catálogo de instituciones de jornadas médicas dentales en Guatemala)
// y 2. Jornadas dentales (pacientes atendidos, procedimientos y costo con el precio «Institucional»).
// Los pacientes de la jornada se registran solo aquí. Se graba con funciones de Supabase.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admJorInstituciones') || !document.getElementById('admJorJornadas') || !window.PD_GEO) return;

  var G = window.PD_GEO, esc = G.esc;
  var TIPOS = [['escuela_publica', 'Escuela pública'], ['escuela_privada', 'Escuela privada'], ['municipalidad', 'Municipalidad'], ['ong', 'ONG / fundación'],
    ['iglesia', 'Iglesia'], ['empresa', 'Empresa'], ['centro_salud', 'Centro de salud'], ['otro', 'Otro']];
  var ESTADOS_I = [['activo', 'Activa'], ['inactivo', 'Inactiva'], ['baja', 'Baja']];
  var ESTADOS_J = { planificada: ['Planificada', 'inactivo'], realizada: ['Realizada', 'activo'], cerrada: ['Cerrada', 'activo'], cancelada: ['Cancelada', 'baja'] };
  var instituciones = [], sucursales = [], deptos = [], municipios = {}, dentistas = [], tratamientos = [], precioInst = {}, jornadas = [], jPacientes = [], jProcs = [];
  var instSel = null, filtroTipo = '', filtroEstadoI = 'activo';
  var form = null, pacientes = [], modoEdicion = false, edit = null, pag = 1, PAG = 6;

  function $(id) { return document.getElementById(id); }
  function num(n, d) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function q(n) { return 'Q' + num(n); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
  function fechaHoraS(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''; }
  // Quién grabó y quién modificó el registro, con fecha y hora completas
  function textoRegistro(x) { return x && x.creado ? 'Grabado por ' + (x.creado_por || 'Sin usuario') + ' el ' + fechaHoraS(x.creado) + (x.modificado ? ' · Modificado por ' + (x.modificado_por || 'Sin usuario') + ' el ' + fechaHoraS(x.modificado) : '') : 'Se registra al grabar (usuario, fecha y hora)'; }
  function codigoSuc(x) { return 'SUC-' + ('00' + (x.numero || x.id)).slice(-3); }
  function sucursalesDe(inst) { return sucursales.filter(function (x) { return x.institucion_id === inst; }); }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/jor_|guardar_jornada|cerrar_jornada|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Jornadas.';
    return G.traducir(err);
  }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function nombreTipo(t) { return (TIPOS.filter(function (x) { return x[0] === t; })[0] || ['', t || '—'])[1]; }
  function sede(x) { return window.PD_SEDES && x.localidad_id ? window.PD_SEDES.texto(x.localidad_id) : '—'; }
  function codigoInst(i) { return 'INS-' + ('00' + (i.numero || i.id)).slice(-3); }
  function nombreInst(id) { var i = porId(instituciones, id); return i ? i.nombre : '—'; }
  function usuarioSes() { return (window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || ''; }
  function paginador(total, actual, paginas, ini, vis, etiqueta) {
    var b = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - actual) <= 1) b.push(n); else if (b[b.length - 1] !== '…') b.push('…');
    return total ? '<span>' + (ini + 1) + '–' + (ini + vis) + ' de ' + total + ' ' + etiqueta + '</span>' + (paginas > 1 ? '<nav aria-label="Páginas"><button type="button" class="ia-pag" data-pag="' + (actual - 1) + '"' + (actual === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      b.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-pag="' + n + '"' + (n === actual ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-pag="' + (actual + 1) + '"' + (actual === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '') : '';
  }
  async function cargarDeptos() {
    if (deptos.length) return;
    var p = await sb.from('geo_paises').select('id,nombre,prefijo');
    var gt = !p.error && p.data.filter(function (x) { return /^gt$/i.test(x.prefijo || '') || norm(x.nombre) === 'guatemala'; })[0];
    if (!gt) return;
    var r = await sb.from('geo_estados').select('id,nombre').eq('pais_id', gt.id).order('nombre');
    deptos = r.error ? [] : r.data;
  }
  async function municipiosDe(depto) {
    if (!depto) return [];
    if (!municipios[depto]) { var r = await sb.from('geo_municipios').select('id,nombre').eq('estado_id', depto).order('nombre'); municipios[depto] = r.error ? [] : r.data; }
    return municipios[depto];
  }
  async function nombreMuni(i) { if (!i.municipio_id) return ''; var l = await municipiosDe(i.estado_id); var m = porId(l, i.municipio_id); return m ? m.nombre : ''; }

  // ===================== 1. Instituciones =====================
  $('admJorInstituciones').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Instituciones</h3><div class="hi-botones"><button type="button" class="adm-btn" id="jiImprimir">Imprimir</button><button type="button" class="adm-btn adm-primary" id="jiNueva">+ Institución</button></div></div>' +
    '<p class="dlg-msg">Instituciones con las que la clínica realiza jornadas médicas dentales en Guatemala: escuelas, municipalidades, ONG, iglesias, empresas y centros de salud.</p>' +
    '<div class="ji-filtros"><input id="jiBuscar" type="search" class="adm-input" placeholder="Buscar por nombre, responsable o municipio" aria-label="Buscar institución">' +
      '<select id="jiTipo" class="adm-input" aria-label="Tipo"><option value="">Todos los tipos</option>' + TIPOS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>' +
      '<select id="jiEstado" class="adm-input" aria-label="Estado"><option value="activo">Activas</option><option value="inactivo">Inactivas</option><option value="baja">De baja</option><option value="">Todas</option></select></div>' +
    '<section class="geo-panel"><div class="roles-wrap ia-wrap"><table class="geo-tabla ji-tabla"><colgroup><col class="ji-c-cod"><col><col class="ji-c-ubi"><col class="ji-c-resp"><col class="ji-c-conv"><col class="ji-c-est"><col class="ji-c-acc"></colgroup>' +
      '<thead><tr><th>Código</th><th>Institución</th><th>Ubicación</th><th>Responsable</th><th>Convenio</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody id="jiLista"></tbody></table></div></section>' +
    '<section id="jiFicha" class="geo-panel ji-ficha" hidden></section>' +
    '<p id="jiMsg" class="dlg-msg" role="status"></p></div>';
  var muniTexto = {};
  function pintarInst() {
    var t = norm($('jiBuscar').value);
    var l = instituciones.filter(function (i) { return (!filtroTipo || i.tipo === filtroTipo) && (!filtroEstadoI || i.estado === filtroEstadoI) &&
      (!t || norm([i.nombre, i.responsable, i.telefono, muniTexto[i.id], codigoInst(i)].join(' ')).indexOf(t) >= 0); });
    $('jiLista').innerHTML = l.length ? l.map(function (i) {
      var d = porId(deptos, i.estado_id), conv = i.convenio ? (i.convenio_hasta && i.convenio_hasta < hoy() ? '<span class="estado estado-baja">Vencido</span>' : '<span class="estado estado-activo">Vigente</span>') : '<span class="inv-sub">Sin convenio</span>';
      return '<tr data-inst="' + i.id + '" tabindex="0" class="' + (i.id === instSel ? 'geo-sel' : '') + '"><td><b>' + codigoInst(i) + '</b></td>' +
        '<td><b class="ia-corto" title="' + esc(i.nombre) + '">' + esc(i.nombre) + '</b><small class="inv-sub">' + nombreTipo(i.tipo) + (sucursalesDe(i.id).length ? ' · ' + sucursalesDe(i.id).length + ' sucursal' + (sucursalesDe(i.id).length === 1 ? '' : 'es') : '') + (i.poblacion ? ' · ' + num(i.poblacion, 0) + ' personas' : '') + '</small></td>' +
        '<td><span class="ia-corto">' + esc(muniTexto[i.id] || '—') + '</span><small class="inv-sub">' + esc(d ? d.nombre : '') + '</small></td>' +
        '<td><span class="ia-corto">' + esc(i.responsable || '—') + '</span><small class="inv-sub ia-corto">' + esc([i.cargo, i.telefono].filter(Boolean).join(' · ')) + '</small></td>' +
        '<td>' + conv + (i.convenio && i.convenio_hasta ? '<small class="inv-sub">hasta ' + fecha(i.convenio_hasta) + '</small>' : '') + '</td>' +
        '<td><span class="estado estado-' + i.estado + '">' + (ESTADOS_I.filter(function (e) { return e[0] === i.estado; })[0] || ['', i.estado])[1] + '</span></td>' +
        '<td class="geo-acc"><button type="button" class="geo-editar" data-editar-inst="' + i.id + '" aria-label="Modificar" title="Modificar">✎</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="geo-vacia">' + (instituciones.length ? 'Ninguna institución coincide.' : 'Aún no hay instituciones. Agrega la primera con «+ Institución».') + '</td></tr>';
    pintarFicha();
  }
  // Ficha de la institución elegida: registro (usuario y fecha completa) y sus sucursales
  function pintarFicha() {
    var i = porId(instituciones, instSel);
    $('jiFicha').hidden = !i;
    if (!i) return;
    var ls = sucursalesDe(i.id);
    $('jiFicha').innerHTML = '<div class="ji-ficha-cab"><div><span class="ji-eti">' + codigoInst(i) + ' · ' + nombreTipo(i.tipo) + '</span><h4>' + esc(i.nombre) + '</h4></div>' +
      '<button type="button" class="adm-btn geo-mini" data-editar-inst="' + i.id + '">Modificar institución</button></div>' +
      '<div class="org-registro"><div class="org-reg-datos"><span>Grabado por <b>' + esc(i.creado_por || 'Sin usuario') + '</b> el <b>' + fechaHoraS(i.creado) + '</b></span>' +
        (i.modificado ? '<span>Modificado por <b>' + esc(i.modificado_por || 'Sin usuario') + '</b> el <b>' + fechaHoraS(i.modificado) + '</b></span>' : '') + '<span>Sede <b>' + esc(sede(i)) + '</b></span></div></div>' +
      '<div class="ik-titulo ji-suc-tit"><h4>Sucursales</h4><span>' + ls.length + ' sucursal' + (ls.length === 1 ? '' : 'es') + ' <button type="button" class="adm-btn adm-primary geo-mini" id="jiNuevaSuc">+ Sucursal</button></span></div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ji-suc"><colgroup><col class="ji-c-cod"><col><col class="ji-c-ubi"><col class="ji-c-resp"><col class="ji-c-reg"><col class="ji-c-est"><col class="ji-c-acc"></colgroup>' +
      '<thead><tr><th>Código</th><th>Sucursal</th><th>Ubicación</th><th>Responsable</th><th>Registro</th><th>Estado</th><th><span class="sr-only">Editar</span></th></tr></thead><tbody>' +
      (ls.length ? ls.map(function (x) {
        var d = porId(deptos, x.estado_id);
        return '<tr data-suc="' + x.id + '"><td><b>' + codigoSuc(x) + '</b></td><td><b class="ia-corto" title="' + esc(x.nombre) + '">' + esc(x.nombre) + '</b><small class="inv-sub ia-corto">' + esc(x.direccion || '') + '</small></td>' +
          '<td><span class="ia-corto">' + esc(muniTexto['s' + x.id] || '—') + '</span><small class="inv-sub">' + esc(d ? d.nombre : '') + '</small></td>' +
          '<td><span class="ia-corto">' + esc(x.responsable || '—') + '</span><small class="inv-sub ia-corto">' + esc([x.cargo, x.telefono].filter(Boolean).join(' · ')) + '</small></td>' +
          '<td><span class="ia-corto" title="' + esc(textoRegistro(x)) + '">' + esc(x.modificado_por || x.creado_por || '—') + '</span><small class="inv-sub">' + fechaHoraS(x.modificado || x.creado) + '</small></td>' +
          '<td><span class="estado estado-' + x.estado + '">' + (ESTADOS_I.filter(function (e) { return e[0] === x.estado; })[0] || ['', x.estado])[1] + '</span></td>' +
          '<td class="geo-acc"><button type="button" class="geo-editar" data-editar-suc="' + x.id + '" aria-label="Modificar sucursal" title="Modificar">✎</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="geo-vacia">Sin sucursales. Agrega la primera con «+ Sucursal».</td></tr>') + '</tbody></table></div>';
  }
  function editarSuc(x, instId) {
    var inst = porId(instituciones, x ? x.institucion_id : instId), v = x ? Object.assign({}, x) : { estado: 'activo', estado_id: inst && inst.estado_id };
    G.dialogo({
      eyebrow: 'Jornadas · Sucursal de ' + (inst ? inst.nombre : ''), titulo: x ? x.nombre : 'Nueva sucursal', valores: v,
      campos: [{ k: 'codigo', label: 'Código', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: ESTADOS_I },
        { k: 'nombre', label: 'Nombre de la sucursal', req: true, max: 200 }, { k: 'poblacion', label: 'Población estimada', tipo: 'number', paso: '1' },
        { k: 'registro', label: 'Registro', tipo: 'info' },
        { k: 'estado_id', label: 'Departamento', tipo: 'select', opciones: [['', 'Elige el departamento…']].concat(deptos.map(function (d) { return [d.id, d.nombre]; })) },
        { k: 'municipio_id', label: 'Municipio', tipo: 'select', opciones: [['', '—']] }, { k: 'direccion', label: 'Dirección', tipo: 'textarea', max: 300 },
        { k: 'responsable', label: 'Responsable', max: 150 }, { k: 'cargo', label: 'Cargo', max: 100 }, { k: 'telefono', label: 'Teléfono / WhatsApp', max: 60 }, { k: 'correo', label: 'Correo', max: 150 },
        { k: 'observaciones', label: 'Observaciones', tipo: 'textarea', max: 500 }],
      secciones: [
        { titulo: 'Identificación', campos: ['codigo', 'estado', 'nombre*', 'poblacion*', 'registro*'] },
        { titulo: 'Ubicación', campos: ['estado_id*', 'municipio_id*', 'direccion*'] },
        { titulo: 'Contacto', campos: ['responsable*', 'cargo*', 'telefono', 'correo', 'observaciones*'] }
      ],
      alAbrir: async function () {
        $('geoF_codigo').textContent = x ? codigoSuc(x) : 'Se asigna al grabar'; $('geoF_registro').textContent = textoRegistro(x);
        async function munis(sel) {
          var l = await municipiosDe(+$('geoF_estado_id').value || null);
          $('geoF_municipio_id').innerHTML = '<option value="">' + (l.length ? 'Elige el municipio…' : '—') + '</option>' + l.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nombre) + '</option>'; }).join('');
          if (sel) $('geoF_municipio_id').value = String(sel);
        }
        $('geoF_estado_id').addEventListener('change', function () { munis(null); });
        await munis(v.municipio_id);
      },
      guardar: async function (d) {
        d.estado_id = d.estado_id ? +d.estado_id : null; d.municipio_id = d.municipio_id ? +d.municipio_id : null;
        d.poblacion = d.poblacion == null ? null : Math.max(0, Math.round(d.poblacion));
        if (d.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo)) return 'Escribe un correo válido.';
        var r = x ? await sb.from('jor_sucursales').update(d).eq('id', x.id).select('id').single() : await sb.from('jor_sucursales').insert(Object.assign({ institucion_id: inst.id }, d)).select('id').single();
        if (r.error) return traducir(r.error);
        await cargarInst(); return null;
      },
      eliminar: x ? async function () { var r = await sb.from('jor_sucursales').delete().eq('id', x.id); if (r.error) return traducir(r.error); await cargarInst(); return null; } : null
    });
  }
  async function cargarInst() {
    aviso('jiMsg', '');
    try {
      if (window.PD_SEDES) await window.PD_SEDES.cargar();
      await cargarDeptos();
      instituciones = await todas(function () { return sb.from('jor_instituciones').select('*').order('numero'); });
      sucursales = await todas(function () { return sb.from('jor_sucursales').select('*').order('numero'); });
    } catch (e) { instituciones = []; sucursales = []; pintarInst(); aviso('jiMsg', traducir(e), true); return; }
    for (var k = 0; k < instituciones.length; k++) muniTexto[instituciones[k].id] = await nombreMuni(instituciones[k]);
    for (var k2 = 0; k2 < sucursales.length; k2++) muniTexto['s' + sucursales[k2].id] = await nombreMuni(sucursales[k2]);
    if (!porId(instituciones, instSel)) instSel = instituciones.length ? instituciones[0].id : null;
    pintarInst();
  }
  function editarInst(i) {
    var v = i ? Object.assign({}, i) : { estado: 'activo', tipo: 'escuela_publica', convenio: false };
    G.dialogo({
      eyebrow: 'Jornadas · Institución', titulo: i ? i.nombre : 'Nueva institución', valores: v,
      campos: [{ k: 'codigo', label: 'Código', tipo: 'info' }, { k: 'estado', label: 'Estado', tipo: 'select', opciones: ESTADOS_I },
        { k: 'nombre', label: 'Nombre de la institución', req: true, max: 200 }, { k: 'tipo', label: 'Tipo', tipo: 'select', opciones: TIPOS }, { k: 'registro', label: 'Registro', tipo: 'info' },
        { k: 'nit', label: 'NIT', max: 20, placeholder: 'CF' }, { k: 'poblacion', label: 'Población estimada', tipo: 'number', paso: '1', ayuda: 'Alumnos, vecinos o empleados' },
        { k: 'estado_id', label: 'Departamento', tipo: 'select', opciones: [['', 'Elige el departamento…']].concat(deptos.map(function (d) { return [d.id, d.nombre]; })) },
        { k: 'municipio_id', label: 'Municipio', tipo: 'select', opciones: [['', '—']] },
        { k: 'direccion', label: 'Dirección', tipo: 'textarea', max: 300 },
        { k: 'responsable', label: 'Responsable', max: 150 }, { k: 'cargo', label: 'Cargo', max: 100, placeholder: 'Director(a), alcalde…' },
        { k: 'telefono', label: 'Teléfono / WhatsApp', max: 60 }, { k: 'correo', label: 'Correo', max: 150 },
        { k: 'convenio', label: '¿Tiene convenio?', tipo: 'check' }, { k: 'convenio_desde', label: 'Convenio desde', max: 10 }, { k: 'convenio_hasta', label: 'Convenio hasta', max: 10 },
        { k: 'observaciones', label: 'Observaciones', tipo: 'textarea', max: 500 }, { k: 'sucursales', label: 'Sucursales', tipo: 'info' }, { k: 'sede', tipo: 'sede' }],
      secciones: [
        { titulo: 'Identificación', campos: ['codigo', 'estado', 'nombre*', 'tipo', 'nit', 'poblacion*', 'registro*'] },
        { titulo: 'Ubicación', campos: ['estado_id*', 'municipio_id*', 'direccion*'] },
        { titulo: 'Contacto', campos: ['responsable*', 'cargo*', 'telefono', 'correo'] },
        { titulo: 'Convenio y sucursales', campos: ['convenio*', 'convenio_desde', 'convenio_hasta', 'observaciones*', 'sucursales*'] }
      ],
      alAbrir: async function () {
        $('geoF_codigo').textContent = i ? codigoInst(i) : 'Se asigna al grabar'; $('geoF_registro').textContent = textoRegistro(i);
        var ls = i ? sucursalesDe(i.id) : [];
        $('geoF_sucursales').innerHTML = i ? (ls.length ? '<span class="ji-dlg-sucs">' + ls.map(function (x) { return '<button type="button" class="ji-dlg-suc" data-dlg-suc="' + x.id + '" title="Modificar sucursal">' + esc(codigoSuc(x) + ' · ' + x.nombre) + '</button>'; }).join('') + '</span>' : '<span class="inv-sub">Sin sucursales.</span>') +
          '<button type="button" class="adm-btn geo-mini ji-dlg-mas" data-dlg-nueva-suc>+ Agregar sucursal</button>' : '<span class="inv-sub">Graba la institución para agregarle sucursales.</span>';
        // La ventana es una sola: se cierra la de la institución y se abre la de la sucursal
        $('geoF_sucursales').onclick = function (ev) {
          var n = ev.target.closest('[data-dlg-nueva-suc]'), m = ev.target.closest('[data-dlg-suc]');
          if (!n && !m) return;
          document.getElementById('geoDlg').close(); instSel = i.id; pintarInst();
          setTimeout(function () { if (n) editarSuc(null, i.id); else editarSuc(porId(sucursales, +m.dataset.dlgSuc)); }, 0);
        };
        ['convenio_desde', 'convenio_hasta'].forEach(function (k) { $('geoF_' + k).type = 'date'; });
        async function munis(sel) {
          var l = await municipiosDe(+$('geoF_estado_id').value || null);
          $('geoF_municipio_id').innerHTML = '<option value="">' + (l.length ? 'Elige el municipio…' : '—') + '</option>' + l.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nombre) + '</option>'; }).join('');
          if (sel) $('geoF_municipio_id').value = String(sel);
        }
        $('geoF_estado_id').addEventListener('change', function () { munis(null); });
        await munis(v.municipio_id);
      },
      guardar: async function (d) {
        d.estado_id = d.estado_id ? +d.estado_id : null; d.municipio_id = d.municipio_id ? +d.municipio_id : null;
        d.poblacion = d.poblacion == null ? null : Math.max(0, Math.round(d.poblacion));
        if (!d.convenio) { d.convenio_desde = null; d.convenio_hasta = null; }
        if (d.convenio_desde && d.convenio_hasta && d.convenio_hasta < d.convenio_desde) return 'La fecha final del convenio no puede ser anterior a la inicial.';
        if (d.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo)) return 'Escribe un correo válido.';
        var r = i ? await sb.from('jor_instituciones').update(d).eq('id', i.id).select('id').single() : await sb.from('jor_instituciones').insert(d).select('id').single();
        if (r.error) return traducir(r.error);
        instSel = r.data.id; await cargarInst(); return null;
      },
      eliminar: i ? async function () { var r = await sb.from('jor_instituciones').delete().eq('id', i.id); if (r.error) return /foreign key|jor_jornadas/i.test(r.error.message || '') ? 'La institución tiene jornadas registradas: márcala como «Baja» en lugar de eliminarla.' : traducir(r.error); instSel = null; await cargarInst(); return null; } : null
    });
  }
  function imprimirInst() {
    var P = window.PD_IMPRESION; if (!P) return;
    var th = 'padding:6px;border-bottom:2px solid #0B2B40;text-align:left;font-size:10px;text-transform:uppercase;color:#475B68', td = 'padding:6px;border-bottom:1px solid #E3EAF0;font-size:11.5px';
    var l = instituciones.filter(function (i) { return (!filtroTipo || i.tipo === filtroTipo) && (!filtroEstadoI || i.estado === filtroEstadoI); });
    P.imprimir(P.encabezado('Instituciones de jornadas dentales') + '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['Código', 'Institución', 'Tipo', 'Ubicación', 'Responsable', 'Teléfono', 'Convenio'].map(function (h) { return '<th style="' + th + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      l.map(function (i) { var d = porId(deptos, i.estado_id); return '<tr>' + [codigoInst(i), i.nombre, nombreTipo(i.tipo), [muniTexto[i.id], d && d.nombre].filter(Boolean).join(', '), [i.responsable, i.cargo].filter(Boolean).join(' · '), i.telefono || '', i.convenio ? (i.convenio_hasta ? 'Hasta ' + fecha(i.convenio_hasta) : 'Sí') : 'No'].map(function (x) { return '<td style="' + td + '">' + esc(x || '') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table><p style="font-size:11px;margin-top:8px">' + l.length + ' instituciones</p></div>');
  }
  $('jiNueva').addEventListener('click', function () { editarInst(null); });
  $('jiImprimir').addEventListener('click', imprimirInst);
  $('jiBuscar').addEventListener('input', pintarInst);
  $('jiTipo').addEventListener('change', function () { filtroTipo = this.value; pintarInst(); });
  $('jiEstado').addEventListener('change', function () { filtroEstadoI = this.value; pintarInst(); });
  $('jiFicha').addEventListener('click', function (e) {
    if (e.target.id === 'jiNuevaSuc') { editarSuc(null, instSel); return; }
    var s2 = e.target.closest('[data-editar-suc]'); if (s2) { editarSuc(porId(sucursales, +s2.dataset.editarSuc)); return; }
    var b2 = e.target.closest('[data-editar-inst]'); if (b2) editarInst(porId(instituciones, +b2.dataset.editarInst));
  });
  $('jiFicha').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-suc]'); if (tr) editarSuc(porId(sucursales, +tr.dataset.suc)); });
  $('jiLista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-editar-inst]'); if (b) { editarInst(porId(instituciones, +b.dataset.editarInst)); return; }
    var tr = e.target.closest('tr[data-inst]'); if (tr) { instSel = +tr.dataset.inst; pintarInst(); }
  });
  $('jiLista').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-inst]'); if (tr) editarInst(porId(instituciones, +tr.dataset.inst)); });

  // ===================== 2. Jornadas dentales =====================
  function campo(etq, html, cls) { return '<label class="ic-campo' + (cls ? ' ' + cls : '') + '"><span>' + etq + '</span>' + html + '</label>'; }
  $('admJorJornadas').innerHTML =
    '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Jornadas dentales</h3><button type="button" id="jjNueva" class="adm-btn adm-primary">Nueva jornada</button></div>' +
    '<section class="geo-panel ic-consulta"><div class="ik-titulo"><h4>Consultar jornadas</h4><span id="jjCuenta"></span></div>' +
      '<div class="ic-cons-filtros">' + campo('Institución', '<select id="jjFInst"><option value="">Todas las instituciones</option></select>', 'ic-cons-buscar') +
        campo('Estado', '<select id="jjFEstado"><option value="">Todos</option><option value="planificada">Planificadas</option><option value="realizada">Realizadas</option><option value="cerrada">Cerradas</option><option value="cancelada">Canceladas</option></select>') +
        campo('Desde', '<input id="jjDesde" type="date">') + campo('Hasta', '<input id="jjHasta" type="date">') + '</div>' +
      '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-cons-t"><colgroup><col class="ic-c-num"><col class="ic-c-fecha"><col><col class="ic-c-doc"><col class="ic-c-q"><col class="ic-c-est"></colgroup>' +
        '<thead><tr><th>Jornada</th><th>Fecha</th><th>Institución / lugar</th><th>Pacientes · procedimientos</th><th class="num">Total Q</th><th>Estado</th></tr></thead><tbody id="jjLista"></tbody></table>' +
        '<div id="jjPaginas" class="ia-paginas"></div></div></section>' +
    '<form id="jjForm" class="ic-doc" novalidate>' +
    '<div id="jjModo" class="ic-modo" hidden><span id="jjModoTxt"></span><span class="ic-modo-btns"><button type="button" id="jjCancelar" class="adm-btn geo-mini">Cancelar cambios</button><button type="button" id="jjModificar" class="adm-btn adm-primary geo-mini">Modificar</button></span></div>' +
    '<div class="ic-barra"><div class="ic-num"><span>Jornada</span><b><output id="jjNumero">nueva</output></b></div><span id="jjEstadoChip" class="estado"></span>' +
      '<div class="ic-meta"><span class="ic-chip" title="Usuario"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><output id="jjUsuario"></output></span></div>' +
      '<div class="ic-totales"><div class="ic-total"><span>Pacientes</span><output id="jjTotPac">0</output></div><div class="ic-total ic-total-q"><span>Total institucional Q</span><output id="jjTotQ">0.00</output></div></div></div>' +
    '<section class="ic-tarjeta jj-tarjeta"><h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8"/></svg>Datos de la jornada</h4><div class="jj-g">' +
      campo('Institución', '<select id="jjInst"></select>', 'jj-inst') + campo('Fecha', '<input id="jjFecha" type="date">') +
      campo('Sucursal', '<select id="jjSuc"><option value="">Sede principal</option></select>', 'jj-suc') +
      campo('Estado', '<select id="jjEstado"><option value="planificada">Planificada</option><option value="realizada">Realizada</option><option value="cancelada">Cancelada</option></select>') +
      campo('Lugar', '<input id="jjLugar" maxlength="200" placeholder="Salón, aula, centro comunal…">', 'jj-lugar') +
      campo('Odontólogo responsable', '<select id="jjDentista"></select>') + campo('Tipo de precio', '<input value="Institucional" disabled>') +
      campo('Observaciones', '<input id="jjObs" maxlength="500">', 'jj-obs') + '</div></section>' +
    '<datalist id="jjPacLista"></datalist>' +
    '<div id="jjCaptura" class="ic-captura jj-captura"><div class="jj-cap1">' +
      campo('Paciente', '<input id="jjCapPac" list="jjPacLista" maxlength="150" placeholder="Nombre del paciente" autocomplete="off">', 'jj-cap-pac') +
      campo('Edad', '<input id="jjCapEdad" type="number" min="0" max="120" class="num">') +
      campo('Sexo', '<select id="jjCapSexo"><option value="">—</option><option value="F">F</option><option value="M">M</option></select>') +
      campo('Grado / referencia', '<input id="jjCapRef" maxlength="100" placeholder="3.º primaria">') +
      '<button type="button" id="jjNuevoPac" class="adm-btn geo-mini" title="Limpiar para un paciente nuevo">Nuevo paciente</button></div>' +
      '<div class="jj-cap2">' + campo('Procedimiento', '<select id="jjCapProc"></select>', 'jj-cap-proc') + campo('Pieza', '<input id="jjCapPieza" maxlength="20">') +
      campo('Cant.', '<input id="jjCapCant" type="number" min="1" step="1" class="num" value="1">') + campo('Precio inst. Q', '<input id="jjCapPrecio" type="number" min="0" step="0.01" class="num">') +
      '<span class="ic-cap-btns"><button type="button" id="jjCapAgregar" class="adm-btn adm-primary">+ Agregar</button><button type="button" id="jjCapCancelar" class="adm-btn geo-mini" hidden>Cancelar</button></span></div>' +
      '<span id="jjCapMsg" class="ic-cap-msg itr-cap-msg" role="status">Escribe el paciente y elige el procedimiento · Enter lo agrega (el paciente se mantiene para su siguiente procedimiento)</span></div>' +
    '<div class="roles-wrap ia-wrap"><table class="geo-tabla ic-det jj-det"><colgroup><col class="ic-d-n"><col class="jj-c-pac"><col><col class="jj-c-pieza"><col class="ic-d-cant"><col class="ic-d-cu"><col class="ic-d-tot"><col class="ic-d-acc"></colgroup>' +
      '<thead><tr><th>#</th><th>Paciente</th><th>Procedimiento</th><th>Pieza</th><th class="num">Cant.</th><th class="num">Precio inst.</th><th class="num">Subtotal</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody id="jjLineas"></tbody></table>' +
      '<div class="ic-det-pie"><span id="jjResumen">0 pacientes · 0 procedimientos</span><span>Total institucional <b id="jjSumQ">Q0.00</b></span></div></div>' +
    '<div class="ic-botones ic-blq jj-botones">' +
      '<button type="submit" id="jjGrabar" class="adm-btn adm-primary">Grabar</button><button type="button" id="jjCerrar" class="adm-btn">Cerrar jornada</button><button type="button" id="jjReabrir" class="adm-btn">Reabrir</button><span class="ic-sep"></span>' +
      '<button type="button" id="jjImprimir" class="adm-btn">Imprimir</button><button type="button" id="jjCorreo" class="adm-btn">Enviar correo</button><button type="button" id="jjWa" class="adm-btn">Enviar WhatsApp</button></div>' +
    '<p id="jjMsg" class="dlg-msg" role="status"></p><div id="jjRegistro"></div></form></div>';

  function editable() { return !form || (form.estado !== 'cerrada' && modoEdicion); }
  function totalPac(p) { return p.procedimientos.reduce(function (t, x) { return t + Number(x.cantidad) * Number(x.precio); }, 0); }
  function capMsg(t, error) { $('jjCapMsg').textContent = t || 'Escribe el paciente y elige el procedimiento · Enter lo agrega (el paciente se mantiene para su siguiente procedimiento)'; $('jjCapMsg').classList.toggle('error', !!error); }
  function opcionesProc() {
    $('jjCapProc').innerHTML = '<option value="">Elige el procedimiento…</option>' + tratamientos.map(function (t) {
      var p = precioInst[t.id]; return '<option value="' + t.id + '">' + esc(t.nombre) + ' · ' + (p != null ? q(p) : 'sin precio institucional') + '</option>'; }).join('') + '<option value="otro">Otro (escribir)…</option>';
  }
  function buscarPac(n) { var v = norm(n).trim(); return pacientes.filter(function (p) { return norm(p.nombre) === v; })[0] || null; }
  function limpiarProc() { edit = null; $('jjCapProc').value = ''; $('jjCapPieza').value = ''; $('jjCapCant').value = 1; $('jjCapPrecio').value = ''; $('jjCapAgregar').textContent = '+ Agregar'; $('jjCapCancelar').hidden = true; }
  function limpiarPac() { ['jjCapPac', 'jjCapEdad', 'jjCapRef'].forEach(function (id) { $(id).value = ''; }); $('jjCapSexo').value = ''; }
  function agregar() {
    var nombre = $('jjCapPac').value.trim(), tid = $('jjCapProc').value, cant = parseInt($('jjCapCant').value, 10), precio = Number($('jjCapPrecio').value);
    if (!nombre) { capMsg('Escribe el nombre del paciente.', true); $('jjCapPac').focus(); return; }
    if (!tid) { capMsg('Elige el procedimiento.', true); $('jjCapProc').focus(); return; }
    var desc = tid === 'otro' ? window.prompt('Descripción del procedimiento:') : (porId(tratamientos, +tid) || {}).nombre;
    if (!desc || !desc.trim()) return;
    if (!(cant > 0)) { capMsg('La cantidad debe ser mayor que cero.', true); $('jjCapCant').focus(); return; }
    if ($('jjCapPrecio').value === '' || precio < 0) { capMsg('Indica el precio (no hay precio institucional para este procedimiento).', true); $('jjCapPrecio').focus(); return; }
    var p = buscarPac(nombre);
    if (!p) { p = { nombre: nombre, procedimientos: [] }; pacientes.push(p); }
    p.edad = $('jjCapEdad').value === '' ? p.edad || null : +$('jjCapEdad').value; p.sexo = $('jjCapSexo').value || p.sexo || ''; p.referencia = $('jjCapRef').value.trim() || p.referencia || '';
    var linea = { tratamiento_id: tid === 'otro' ? null : +tid, descripcion: desc.trim(), pieza: $('jjCapPieza').value.trim(), cantidad: cant, precio: precio };
    if (edit) { var pe = pacientes[edit.p]; pe.procedimientos.splice(edit.x, 1); if (!pe.procedimientos.length && pe !== p) pacientes.splice(edit.p, 1); }
    p.procedimientos.push(linea);
    limpiarProc(); pintarLineas(); capMsg('Agregado a ' + p.nombre + '. Sigue con otro procedimiento o pulsa «Nuevo paciente».'); $('jjCapProc').focus();
  }
  function pintarLineas() {
    var ed = editable(), total = 0, nProc = 0, html = '';
    $('jjCaptura').hidden = !ed;
    pacientes.forEach(function (p, i) {
      p.procedimientos.forEach(function (x, j) {
        var st = Number(x.cantidad) * Number(x.precio); total += st; nProc++;
        html += '<tr class="' + (edit && edit.p === i && edit.x === j ? 'ic-editando' : '') + '"><td class="ik-cod">' + (j === 0 ? i + 1 : '') + '</td>' +
          '<td>' + (j === 0 ? '<b class="ia-corto" title="' + esc(p.nombre) + '">' + esc(p.nombre) + '</b><small class="inv-sub ia-corto">' + esc([p.edad != null && p.edad !== '' ? p.edad + ' años' : '', p.sexo, p.referencia].filter(Boolean).join(' · ')) + '</small>' : '') + '</td>' +
          '<td><span class="ia-corto">' + esc(x.descripcion) + '</span>' + (x.tratamiento_id ? '' : '<small class="inv-sub">fuera del catálogo</small>') + '</td><td>' + esc(x.pieza || '—') + '</td>' +
          '<td class="num">' + x.cantidad + '</td><td class="num">' + num(x.precio) + '</td><td class="num"><b>' + num(st) + '</b></td>' +
          '<td class="ic-d-acc">' + (ed ? '<button type="button" class="ic-ico" data-editar="' + i + ':' + j + '" aria-label="Modificar" title="Modificar">✎</button><button type="button" class="ic-ico ic-ico-x" data-quitar="' + i + ':' + j + '" aria-label="Quitar" title="Quitar">×</button>' : '') + '</td></tr>';
      });
      html += '<tr class="jj-sub"><td></td><td colspan="5">Subtotal ' + esc(p.nombre) + ' · ' + p.procedimientos.length + ' procedimiento' + (p.procedimientos.length === 1 ? '' : 's') + '</td><td class="num"><b>' + num(totalPac(p)) + '</b></td><td></td></tr>';
    });
    $('jjLineas').innerHTML = html || '<tr><td colspan="8" class="geo-vacia">' + (ed ? 'Aún no hay pacientes. Regístralos en la barra de arriba.' : 'Sin pacientes registrados.') + '</td></tr>';
    $('jjResumen').textContent = pacientes.length + ' paciente' + (pacientes.length === 1 ? '' : 's') + ' · ' + nProc + ' procedimiento' + (nProc === 1 ? '' : 's');
    $('jjSumQ').textContent = q(total); $('jjTotQ').textContent = num(total); $('jjTotPac').textContent = pacientes.length;
    $('jjPacLista').innerHTML = pacientes.map(function (p) { return '<option value="' + esc(p.nombre) + '">'; }).join('');
  }
  function opcionesSuc(sel) {
    var inst = +$('jjInst').value || null, l = inst ? sucursalesDe(inst).filter(function (x) { return x.estado === 'activo' || x.id === sel; }) : [];
    $('jjSuc').innerHTML = '<option value="">' + (l.length ? 'Sede principal' : 'Sin sucursales') + '</option>' + l.map(function (x) { return '<option value="' + x.id + '">' + esc(codigoSuc(x) + ' · ' + x.nombre) + '</option>'; }).join('');
    $('jjSuc').value = sel ? String(sel) : '';
  }
  function pintarEncabezado() {
    var j = form || {}, ed = editable(), e = ESTADOS_J[j.estado] || ['Nueva', 'inactivo'];
    $('jjNumero').textContent = j.numero ? 'N.º ' + j.numero : 'nueva';
    $('jjEstadoChip').className = 'estado estado-' + e[1]; $('jjEstadoChip').textContent = e[0];
    $('jjUsuario').textContent = (j.creado_por || usuarioSes() || '—') + (j.creado ? ' · ' + fechaHora(j.creado) : ' · sin grabar');
    $('jjInst').innerHTML = '<option value="">Elige la institución…</option>' + instituciones.filter(function (i) { return i.estado === 'activo' || i.id === j.institucion_id; }).map(function (i) { return '<option value="' + i.id + '">' + esc(codigoInst(i) + ' · ' + i.nombre) + '</option>'; }).join('');
    $('jjInst').value = j.institucion_id ? String(j.institucion_id) : '';
    opcionesSuc(j.sucursal_id);
    $('jjDentista').innerHTML = '<option value="">Sin asignar</option>' + dentistas.filter(function (d) { return d.estado === 'activo' || d.id === j.dentista_id; }).map(function (d) { return '<option value="' + d.id + '">' + esc(d.nombre) + '</option>'; }).join('');
    $('jjDentista').value = j.dentista_id ? String(j.dentista_id) : '';
    $('jjFecha').value = j.fecha || hoy(); $('jjLugar').value = j.lugar || ''; $('jjObs').value = j.observaciones || '';
    $('jjEstado').value = j.estado && j.estado !== 'cerrada' ? j.estado : 'planificada';
    ['jjInst', 'jjSuc', 'jjFecha', 'jjEstado', 'jjLugar', 'jjDentista', 'jjObs'].forEach(function (id) { $(id).disabled = !ed; });
    estadoBotones();
  }
  function estadoBotones() {
    var j = form || {}, ed = editable(), guardada = !!j.id, sup = window.PD_SEDES && window.PD_SEDES.esSuper();
    $('jjGrabar').disabled = !ed;
    $('jjCerrar').disabled = !(guardada && (j.estado === 'planificada' || j.estado === 'realizada'));
    $('jjReabrir').hidden = j.estado !== 'cerrada'; $('jjReabrir').disabled = !sup; $('jjReabrir').title = sup ? '' : 'Solo el Super Administrador reabre una jornada.';
    ['jjImprimir', 'jjCorreo', 'jjWa'].forEach(function (id) { $(id).disabled = !guardada; });
    var modo = '';
    if (guardada) modo = j.estado === 'cerrada' ? 'Jornada N.º ' + j.numero + ' · Cerrada · solo consulta.' : modoEdicion ? 'Modificando la jornada N.º ' + j.numero + '. Presiona «Grabar» para guardar los cambios.' : 'Jornada N.º ' + j.numero + ' · ' + ESTADOS_J[j.estado][0] + ' · modo consulta.';
    $('jjModo').hidden = !guardada; $('jjModoTxt').textContent = modo;
    $('jjModo').className = 'ic-modo' + (modoEdicion && j.estado !== 'cerrada' ? ' editando' : j.estado === 'cerrada' ? ' bloqueada' : '');
    $('jjModificar').hidden = !(guardada && j.estado !== 'cerrada' && !modoEdicion); $('jjCancelar').hidden = !(guardada && modoEdicion && j.estado !== 'cerrada');
    $('jjRegistro').innerHTML = guardada ? '<div class="org-registro"><div class="org-reg-datos"><span>Sede <b>' + esc(sede(j)) + '</b></span><span>Grabado por <b>' + esc(j.creado_por || '—') + '</b> el <b>' + fechaHora(j.creado) + '</b></span>' +
      (j.modificado ? '<span>Modificado por <b>' + esc(j.modificado_por || '—') + '</b> el <b>' + fechaHora(j.modificado) + '</b></span>' : '') + (j.cerrada_en ? '<span>Cerrada por <b>' + esc(j.cerrada_por || '—') + '</b> el <b>' + fechaHora(j.cerrada_en) + '</b></span>' : '') + '</div></div>' : '';
  }
  function abrir(j) {
    form = j || null; modoEdicion = !j; edit = null;
    pacientes = j ? jPacientes.filter(function (p) { return p.jornada_id === j.id; }).sort(function (a, b) { return a.orden - b.orden; }).map(function (p) {
      return { nombre: p.nombre, edad: p.edad, sexo: p.sexo || '', referencia: p.referencia || '', procedimientos: jProcs.filter(function (x) { return x.paciente_id === p.id; }).sort(function (a, b) { return a.orden - b.orden; }).map(function (x) { return { tratamiento_id: x.tratamiento_id, descripcion: x.descripcion, pieza: x.pieza || '', cantidad: x.cantidad, precio: Number(x.precio) }; }) }; }) : [];
    opcionesProc(); limpiarProc(); limpiarPac(); capMsg(''); aviso('jjMsg', '');
    pintarEncabezado(); pintarLineas();
  }
  function pintarLista() {
    var fi = +$('jjFInst').value || null, fe = $('jjFEstado').value, d = $('jjDesde').value, h = $('jjHasta').value;
    var l = jornadas.filter(function (j) { return (!fi || j.institucion_id === fi) && (!fe || j.estado === fe) && (!d || j.fecha >= d) && (!h || j.fecha <= h); });
    var paginas = Math.max(1, Math.ceil(l.length / PAG)); pag = Math.min(Math.max(1, pag), paginas);
    var ini = (pag - 1) * PAG, vis = l.slice(ini, ini + PAG);
    $('jjCuenta').textContent = l.length + ' jornada' + (l.length === 1 ? '' : 's') + ' · ' + q(l.reduce(function (t, j) { return t + Number(j.total); }, 0));
    $('jjLista').innerHTML = vis.length ? vis.map(function (j) {
      var ps = jPacientes.filter(function (p) { return p.jornada_id === j.id; }), np = jProcs.filter(function (x) { return ps.some(function (p) { return p.id === x.paciente_id; }); }).length, e = ESTADOS_J[j.estado] || [j.estado, 'inactivo'];
      return '<tr data-jornada="' + j.id + '" tabindex="0" class="' + (form && form.id === j.id ? 'geo-sel' : '') + '"><td><b>' + j.numero + '</b></td><td>' + fecha(j.fecha) + '</td>' +
        '<td><b class="ia-corto">' + esc(nombreInst(j.institucion_id)) + '</b><small class="inv-sub ia-corto">' + esc([(porId(sucursales, j.sucursal_id) || {}).nombre, j.lugar].filter(Boolean).join(' · ')) + '</small></td><td>' + ps.length + ' pacientes<small class="inv-sub">' + np + ' procedimientos</small></td>' +
        '<td class="num"><b>' + q(j.total) + '</b></td><td><span class="estado estado-' + e[1] + '">' + e[0] + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="geo-vacia">' + (jornadas.length ? 'Ninguna jornada coincide.' : 'Aún no hay jornadas.') + '</td></tr>';
    $('jjPaginas').hidden = !l.length; $('jjPaginas').innerHTML = paginador(l.length, pag, paginas, ini, vis.length, 'jornadas · toca una para verla');
  }
  async function cargarJor(mantener) {
    aviso('jjMsg', '');
    try {
      if (window.PD_SEDES) await window.PD_SEDES.cargar();
      var r = await Promise.all([
        todas(function () { return sb.from('jor_instituciones').select('*').order('numero'); }),
        todas(function () { return sb.from('jor_sucursales').select('*').order('numero'); }),
        todas(function () { return sb.from('dentistas').select('id,nombre,estado').order('nombre'); }),
        todas(function () { return sb.from('tratamientos').select('id,nombre,activo').order('nombre'); }),
        todas(function () { return sb.from('precios').select('tratamiento_id,tipo,valor,estado,localidad_id').eq('tipo', 'institucional'); }),
        todas(function () { return sb.from('jor_jornadas').select('*').order('numero', { ascending: false }); }),
        todas(function () { return sb.from('jor_pacientes').select('*'); }),
        todas(function () { return sb.from('jor_procedimientos').select('*'); })
      ]);
      instituciones = r[0]; sucursales = r[1]; dentistas = r[2]; tratamientos = r[3].filter(function (t) { return t.activo !== false; }); jornadas = r[5]; jPacientes = r[6]; jProcs = r[7];
      var mi = window.PD_SEDES && window.PD_SEDES.miLocalidad(); precioInst = {};
      r[4].filter(function (p) { return p.estado !== 'baja' && p.estado !== 'suspendido'; }).sort(function (a, b) { return (a.localidad_id === mi ? 1 : 0) - (b.localidad_id === mi ? 1 : 0); }).forEach(function (p) { precioInst[p.tratamiento_id] = Number(p.valor); });
    } catch (e) { jornadas = []; pintarLista(); abrir(null); aviso('jjMsg', traducir(e), true); return; }
    $('jjFInst').innerHTML = '<option value="">Todas las instituciones</option>' + instituciones.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    pintarLista(); abrir(mantener ? porId(jornadas, mantener) : null);
  }
  async function grabar() {
    if (!+$('jjInst').value) { aviso('jjMsg', 'Elige la institución.', true); return null; }
    aviso('jjMsg', 'Grabando…');
    var r = await sb.rpc('guardar_jornada', { p_id: form ? form.id : null,
      p_datos: { institucion_id: +$('jjInst').value, sucursal_id: +$('jjSuc').value || null, fecha: $('jjFecha').value, estado: $('jjEstado').value, lugar: $('jjLugar').value, dentista_id: $('jjDentista').value || null, observaciones: $('jjObs').value },
      p_pacientes: pacientes });
    if (r.error) { aviso('jjMsg', traducir(r.error), true); return null; }
    await cargarJor(r.data); return r.data;
  }
  function htmlImpresion(j) {
    var P = window.PD_IMPRESION, inst = porId(instituciones, j.institucion_id) || {}, den = porId(dentistas, j.dentista_id);
    var th = 'padding:6px;border-bottom:2px solid #0B2B40;text-align:left;font-size:10px;text-transform:uppercase;color:#475B68', td = 'padding:5px 6px;border-bottom:1px solid #E3EAF0;font-size:11.5px';
    var ps = jPacientes.filter(function (p) { return p.jornada_id === j.id; }).sort(function (a, b) { return a.orden - b.orden; }), filas = '', np = 0;
    ps.forEach(function (p, i) {
      var xs = jProcs.filter(function (x) { return x.paciente_id === p.id; }).sort(function (a, b) { return a.orden - b.orden; }), st = 0;
      xs.forEach(function (x, k) { var s = x.cantidad * Number(x.precio); st += s; np++;
        filas += '<tr><td style="' + td + '">' + (k ? '' : i + 1) + '</td><td style="' + td + '">' + (k ? '' : '<b>' + esc(p.nombre) + '</b><br><span style="color:#5A6D7A">' + esc([p.edad != null ? p.edad + ' años' : '', p.sexo, p.referencia].filter(Boolean).join(' · ')) + '</span>') + '</td><td style="' + td + '">' + esc(x.descripcion) + '</td><td style="' + td + '">' + esc(x.pieza || '') + '</td><td style="' + td + ';text-align:right">' + x.cantidad + '</td><td style="' + td + ';text-align:right">' + num(x.precio) + '</td><td style="' + td + ';text-align:right">' + num(s) + '</td></tr>'; });
      filas += '<tr><td style="' + td + '"></td><td colspan="5" style="' + td + ';font-weight:700;background:#F5F9FC">Subtotal ' + esc(p.nombre) + '</td><td style="' + td + ';text-align:right;font-weight:700;background:#F5F9FC">' + num(st) + '</td></tr>';
    });
    function d(k, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.08em">' + k + '</span><b>' + esc(v || '—') + '</b></div>'; }
    return P.encabezado('Jornada dental N.º ' + j.numero + ' · ' + (ESTADOS_J[j.estado] || [j.estado])[0]) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;font-size:12px">' + d('Institución', inst.nombre + ((porId(sucursales, j.sucursal_id) || {}).nombre ? ' · ' + porId(sucursales, j.sucursal_id).nombre : '')) + d('Fecha', fecha(j.fecha)) + d('Lugar', j.lugar) + d('Odontólogo responsable', den && den.nombre) +
      d('Responsable de la institución', [inst.responsable, inst.cargo].filter(Boolean).join(' · ')) + d('Teléfono', inst.telefono) + d('Tipo de precio', 'Institucional') + d('Sede', sede(j)) + '</div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['#', 'Paciente', 'Procedimiento', 'Pieza', 'Cant.', 'Precio inst.', 'Subtotal Q'].map(function (h, i) { return '<th style="' + th + (i > 3 ? ';text-align:right' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + filas + '</tbody></table>' +
      '<p style="text-align:right;font-size:14px;margin-top:10px"><b>Total institucional Q ' + num(j.total) + '</b> · ' + ps.length + ' pacientes · ' + np + ' procedimientos</p>' +
      '<div style="display:flex;gap:40px;margin-top:50px;font-size:11px"><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Odontólogo responsable</div><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Responsable de la institución</div></div>' +
      '<p style="font-size:9px;color:#5A6D7A;margin-top:14px;text-align:right">Impreso por ' + esc(usuarioSes() || '—') + ' · ' + fechaHora(new Date().toISOString()) + '</p></div>';
  }
  function textoResumen(j) {
    var inst = porId(instituciones, j.institucion_id) || {}, ps = jPacientes.filter(function (p) { return p.jornada_id === j.id; }), np = jProcs.filter(function (x) { return ps.some(function (p) { return p.id === x.paciente_id; }); }).length;
    return 'Estimados ' + (inst.responsable || inst.nombre || '') + ':\n\nPlus Dental les comparte el resumen de la jornada dental N.º ' + j.numero + ' realizada el ' + fecha(j.fecha) + (j.lugar ? ' en ' + j.lugar : '') + '.\n\n' +
      'Pacientes atendidos: ' + ps.length + '\nProcedimientos: ' + np + '\nTotal (precio institucional): Q ' + num(j.total) + '\n\nQuedamos atentos.\nAtentamente, ' + (usuarioSes() ? usuarioSes() + ' · ' : '') + 'Plus Dental';
  }

  // --- Eventos de jornadas ---
  $('jjNueva').addEventListener('click', async function () { if (!instituciones.length) await cargarJor(); abrir(null); pintarLista(); $('jjForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('jjInst').focus({ preventScroll: true }); });
  $('jjModificar').addEventListener('click', function () { if (!form || form.estado === 'cerrada') return; modoEdicion = true; limpiarPac(); limpiarProc(); pintarEncabezado(); pintarLineas(); $('jjCapPac').focus(); });
  $('jjCancelar').addEventListener('click', function () { abrir(form); aviso('jjMsg', 'Cambios descartados.'); });
  $('jjInst').addEventListener('change', function () { opcionesSuc(null); var i = porId(instituciones, +this.value); if (i && !$('jjLugar').value) $('jjLugar').value = i.direccion || ''; });
  $('jjSuc').addEventListener('change', function () { var x = porId(sucursales, +this.value); if (x) $('jjLugar').value = [x.nombre, x.direccion].filter(Boolean).join(' · '); });
  $('jjCapProc').addEventListener('change', function () { var p = precioInst[+this.value]; $('jjCapPrecio').value = p != null ? p : ''; capMsg(this.value && this.value !== 'otro' && p == null ? 'Este procedimiento no tiene precio institucional: escríbelo (o defínelo en Precios y paquetes).' : ''); });
  $('jjCapPac').addEventListener('input', function () { var p = buscarPac(this.value); if (p) { $('jjCapEdad').value = p.edad != null ? p.edad : ''; $('jjCapSexo').value = p.sexo || ''; $('jjCapRef').value = p.referencia || ''; capMsg(p.nombre + ' ya está en la jornada: el procedimiento se le agregará.'); } });
  $('jjNuevoPac').addEventListener('click', function () { limpiarPac(); limpiarProc(); capMsg(''); $('jjCapPac').focus(); });
  $('jjCaptura').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { e.preventDefault(); agregar(); } });
  $('jjCapAgregar').addEventListener('click', agregar);
  $('jjCapCancelar').addEventListener('click', function () { limpiarProc(); pintarLineas(); });
  $('jjLineas').addEventListener('click', function (e) {
    var b = e.target.closest('[data-editar],[data-quitar]'); if (!b) return;
    var k = (b.dataset.editar || b.dataset.quitar).split(':'), i = +k[0], j = +k[1], p = pacientes[i], x = p.procedimientos[j];
    if (b.dataset.quitar) { p.procedimientos.splice(j, 1); if (!p.procedimientos.length) pacientes.splice(i, 1); limpiarProc(); pintarLineas(); return; }
    edit = { p: i, x: j };
    $('jjCapPac').value = p.nombre; $('jjCapEdad').value = p.edad != null ? p.edad : ''; $('jjCapSexo').value = p.sexo || ''; $('jjCapRef').value = p.referencia || '';
    $('jjCapProc').value = x.tratamiento_id ? String(x.tratamiento_id) : 'otro'; $('jjCapPieza').value = x.pieza || ''; $('jjCapCant').value = x.cantidad; $('jjCapPrecio').value = x.precio;
    $('jjCapAgregar').textContent = 'Actualizar'; $('jjCapCancelar').hidden = false; capMsg('Modificando el procedimiento de ' + p.nombre + '.'); pintarLineas();
  });
  $('jjForm').addEventListener('submit', async function (e) { e.preventDefault(); if (!editable()) return; $('jjGrabar').disabled = true; var id = await grabar(); $('jjGrabar').disabled = false; if (id) aviso('jjMsg', 'Jornada N.º ' + (porId(jornadas, id) || {}).numero + ' grabada.'); });
  $('jjCerrar').addEventListener('click', async function () {
    if (!form || !window.confirm('¿Cerrar la jornada N.º ' + form.numero + '? Quedará solo para consulta (solo el Super Administrador puede reabrirla).')) return;
    var id = form.id, r = await sb.rpc('cerrar_jornada', { p_id: id }); if (r.error) { aviso('jjMsg', traducir(r.error), true); return; }
    await cargarJor(id); aviso('jjMsg', 'Jornada cerrada.');
  });
  $('jjReabrir').addEventListener('click', async function () { if (!form) return; var id = form.id, r = await sb.rpc('reabrir_jornada', { p_id: id }); if (r.error) { aviso('jjMsg', traducir(r.error), true); return; } await cargarJor(id); aviso('jjMsg', 'Jornada reabierta (Realizada).'); });
  $('jjImprimir').addEventListener('click', function () { if (form && window.PD_IMPRESION) window.PD_IMPRESION.imprimir(htmlImpresion(form)); });
  $('jjCorreo').addEventListener('click', function () {
    if (!form) return; var inst = porId(instituciones, form.institucion_id) || {};
    if (!inst.correo) { aviso('jjMsg', 'La institución no tiene correo: agrégalo en Jornadas › Instituciones.', true); return; }
    window.location.href = 'mailto:' + encodeURIComponent(inst.correo) + '?subject=' + encodeURIComponent('Jornada dental N.º ' + form.numero + ' · Plus Dental') + '&body=' + encodeURIComponent(textoResumen(form));
    aviso('jjMsg', 'Se abrió tu correo con el resumen para ' + inst.correo + '. Para adjuntar el detalle usa «Imprimir» → Guardar como PDF.');
  });
  $('jjWa').addEventListener('click', function () {
    if (!form) return; var inst = porId(instituciones, form.institucion_id) || {};
    var l = String(inst.telefono || '').split(/[\/,;]| o | y /).map(function (x) { return x.replace(/\D/g, ''); }).filter(function (x) { return x.length >= 8; }).map(function (x) { return x.length === 8 ? '502' + x : x; });
    var t = l.filter(function (x) { return /^502[345]\d{7}$/.test(x); })[0] || l[0];
    if (!t) { aviso('jjMsg', 'La institución no tiene teléfono: agrégalo en Jornadas › Instituciones.', true); return; }
    window.open('https://wa.me/' + t + '?text=' + encodeURIComponent(textoResumen(form)), '_blank', 'noopener');
    aviso('jjMsg', 'Se abrió WhatsApp con el resumen para +' + t + '.');
  });
  ['jjFInst', 'jjFEstado', 'jjDesde', 'jjHasta'].forEach(function (id) { $(id).addEventListener('change', function () { pag = 1; pintarLista(); }); });
  $('jjPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-pag]'); if (b && !b.disabled) { pag = +b.dataset.pag; pintarLista(); } });
  $('jjLista').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-jornada]'); if (tr) { abrir(porId(jornadas, +tr.dataset.jornada)); pintarLista(); $('jjForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });

  var PANELES = { admJorInstituciones: cargarInst, admJorJornadas: function () { return cargarJor(); } };
  Object.keys(PANELES).forEach(function (id) { var tab = document.querySelector('[data-tab="' + id + '"]'); if (tab) tab.addEventListener('click', function () { setTimeout(function () { PANELES[id](); }, 0); }); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { Object.keys(PANELES).forEach(function (id) { if (!$(id).hidden) PANELES[id](); }); },
    limpiar: function () { instituciones = []; sucursales = []; jornadas = []; jPacientes = []; jProcs = []; form = null; pacientes = []; ['jiLista', 'jjLista', 'jjLineas', 'jjRegistro'].forEach(function (i) { $(i).innerHTML = ''; }); }
  });
})();
