// Plus Dental — Paquetes (grupo «Precios y paquetes») y su sección en la página pública
// Un paquete agrupa procedimientos del catálogo con un precio especial, vigencia, % de descuento máximo y estado.
(function () {
  var sb = window.PD_SB || null;
  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', baja: 'Baja' };

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n, sinDecimales) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: sinDecimales ? 0 : 2, maximumFractionDigits: sinDecimales ? 0 : 2 }); }
  function fechaNum(f) { if (!f) return ''; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function ahorro(normal, precio) {
    var a = Number(normal) - Number(precio);
    return a > 0.004 ? { monto: a, pct: Math.round(a / Number(normal) * 100) } : null;
  }

  // Textos de la parte pública en inglés (idiomas.js los agrega a su lista)
  var EN = window.PD_EN_EXTRA = window.PD_EN_EXTRA || {};
  [['Paquetes y promociones', 'Packages and promotions'], ['Tratamientos combinados a un precio especial.', 'Combined treatments at a special price.'],
   ['Incluye', 'Includes'], ['Precio normal', 'Regular price'], ['Ahorras', 'You save'], ['Válido hasta el', 'Valid until'],
   ['Agendar este paquete →', 'Book this package →'], ['Paquete', 'Package']].forEach(function (p) { EN[p[0]] = p[1]; });

  // ================= Página pública =================
  async function cargarPublicos() {
    if (!sb || !$('paqWrap')) return;
    var r = await sb.rpc('paquetes_publicos');
    if (r.error || !r.data || !r.data.length) { $('paqWrap').hidden = true; return; }
    $('paqGrid').innerHTML = r.data.map(function (p) {
      var a = ahorro(p.precio_normal, p.precio);
      return '<article class="paq-card">' +
        '<span class="paq-tag">Paquete</span><h3>' + esc(p.nombre) + '</h3>' +
        (p.descripcion ? '<p>' + esc(p.descripcion) + '</p>' : '') +
        '<div class="paq-precio"><b>' + q(p.precio, true) + '</b>' + (a ? '<s>' + q(p.precio_normal, true) + '</s>' : '') + (p.precio_usd != null ? '<span class="paq-usd">US$' + Number(p.precio_usd).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '</span>' : '') + '</div>' +
        (a ? '<span class="paq-ahorro"><span>Ahorras</span> ' + q(a.monto, true) + ' (' + a.pct + ' %)</span>' : '') +
        ((p.incluye || []).length ? '<span class="paq-inc">Incluye</span><ul>' + p.incluye.map(function (i) { return '<li>' + esc(i.nombre) + (i.cantidad > 1 ? ' ×' + i.cantidad : '') + '</li>'; }).join('') + '</ul>' : '') +
        (p.vigente_hasta ? '<small><span>Válido hasta el</span> ' + fechaNum(p.vigente_hasta) + '</small>' : '') +
        '<a href="#agenda" class="paq-agendar">Agendar este paquete →</a></article>';
    }).join('');
    $('paqWrap').hidden = false;
  }
  cargarPublicos();

  // ================= Administración =================
  if (!sb || !$('admPaquetes')) return;

  var paquetes = [], items = {}, catalogo = [], precioDirecto = {}, actual = null, editando = false, filtro = 'todos', lineas = [];

  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function pill(e) { return '<span class="estado estado-' + e + '">' + ESTADOS[e] + '</span>'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/paquete.*(does not exist|could not find)|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los paquetes.';
    if (/paquetes_vigencia/i.test(m)) return 'La fecha final de vigencia no puede ser anterior a la inicial.';
    if (/paquetes_descuento/i.test(m)) return 'El descuento máximo debe estar entre 0 y 100 %.';
    if (/Solo el Super Administrador|row-level security|permission denied|permiso/i.test(m)) return 'Solo el Super Administrador puede crear, modificar o eliminar paquetes.';
    if (/precio_usd/i.test(m)) return 'El precio en dólares no puede ser negativo.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent; b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }
  // Precio normal de un procedimiento: «Cliente directo» activo o, si no tiene, el del catálogo
  // (los procedimientos sugeridos que aún no están en el catálogo no tienen precio: cuentan Q0.00)
  function precioNormal(id) {
    if (!id) return 0;
    if (precioDirecto[id] != null) return precioDirecto[id];
    var t = catalogo.filter(function (x) { return x.id === id; })[0];
    return t ? Number(t.precio) : 0;
  }
  function nombreTrat(id) { var t = catalogo.filter(function (x) { return x.id === id; })[0]; return t ? t.nombre : '—'; }
  function nombreLinea(l) { return l.tratamiento_id ? nombreTrat(l.tratamiento_id) : l.nombre; }
  function normalDe(ls) { return ls.reduce(function (s, l) { return s + l.cantidad * precioNormal(l.tratamiento_id); }, 0); }
  // Solo el Super Administrador crea, modifica o elimina paquetes (Supabase también lo exige)
  function puedeEditar() { return !!(window.PD_SESION && window.PD_SESION.esSuper()); }
  function usd(n) { return 'US$' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var tiposProc = [];

  $('admPaquetes').innerHTML =
    '<div id="paLista" class="adm-pane">' +
    '<div class="adm-pane-head"><h3 class="adm-h">Paquetes</h3><button type="button" id="paNuevo" class="adm-btn adm-primary">Nuevo paquete</button></div>' +
    '<p class="dlg-msg">Procedimientos del catálogo agrupados a un precio especial. Los paquetes <b>Activos</b> y vigentes se muestran en la página pública, en Servicios.</p>' +
    '<div id="paFiltros" style="display: flex; gap: 8px; flex-wrap: wrap" aria-label="Filtrar por estado">' +
    [['todos', 'Todos'], ['activo', 'Activos'], ['suspendido', 'Suspendidos'], ['baja', 'Baja']].map(function (f) { return '<button type="button" class="adm-btn" data-pafiltro="' + f[0] + '" aria-pressed="' + (f[0] === 'todos') + '">' + f[1] + '</button>'; }).join('') + '</div>' +
    '<div id="paGrid" class="pa-grid"></div><p id="paMsg" class="dlg-msg" role="status"></p></div>' +

    '<div id="paFicha" class="adm-pane" hidden>' +
    '<button type="button" id="paVolver" class="dlg-link">← Todos los paquetes</button>' +
    '<div class="adm-pane-head"><div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><h3 id="paTitulo" class="adm-h"></h3><p id="paSub" class="dlg-msg"></p></div><span id="paPill" class="estado" hidden></span></div>' +
    '<form id="paForm" class="adm-pane" novalidate>' +
    '<p id="paSoloSuper" class="pr-solo-super" hidden>Solo el Super Administrador puede crear, modificar o eliminar paquetes. Tú puedes consultarlos.</p>' +
    '<fieldset id="paCampos" class="campos pos-sec"><legend>Datos del paquete</legend><div class="exp-form">' +
    '<div class="exp-campo"><span class="pos-lbl">Código (automático)</span><div id="paCodigo" class="exp-calc">—</div></div>' +
    '<label>Estado<select id="paEstado" class="ac-estado"><option value="activo">Activo</option><option value="suspendido">Suspendido</option><option value="baja">Baja</option></select></label>' +
    '<label>Organización<select id="paOrg"><option value="">—</option></select></label><label>Localidad / Empresa<select id="paLoc"><option value="">—</option></select></label>' +
    '<label class="full">Nombre del paquete *<input id="paNombre" type="text" maxlength="120" required></label>' +
    '<label class="full">Descripción<textarea id="paDesc" rows="2" maxlength="500" placeholder="Se muestra en la página pública"></textarea></label>' +
    '<label>Vigente desde *<input id="paDesde" type="date" required></label>' +
    '<label>Vigente hasta (opcional)<input id="paHasta" type="date"></label>' +
    '<label>Precio del paquete (Q) *<input id="paPrecio" type="number" min="0" step="0.01" inputmode="decimal" required></label>' +
    '<label>Precio del paquete (US$)<input id="paPrecioUsd" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>' +
    '<label>Porcentaje de descuento máximo<span class="ac-pct"><input id="paDescuento" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0.00"><span aria-hidden="true">%</span></span></label>' +
    '<label>Fecha *<input id="paFecha" type="date" required></label>' +
    '</div></fieldset>' +
    '<fieldset id="paItemsCampos" class="campos pos-sec"><legend>Procedimientos incluidos</legend>' +
    '<div class="roles-wrap"><table><thead><tr><th>Procedimiento</th><th class="num">Cantidad</th><th class="num">Precio normal</th><th class="num">Subtotal</th><th><span class="sr-only">Quitar</span></th></tr></thead><tbody id="paItems"></tbody></table></div>' +
    '<div class="pa-agregar"><select id="paTrat" aria-label="Procedimiento a agregar"></select><input id="paCant" type="number" min="1" max="99" value="1" aria-label="Cantidad"><button type="button" id="paAgregar" class="adm-btn">Agregar</button></div>' +
    '<div id="paTotales" class="pa-totales"></div></fieldset>' +
    '<div class="exp-actions ac-acciones"><button type="submit" id="paGrabar" class="dlg-submit">Grabar</button><button type="button" id="paModificar" class="adm-btn adm-primary">Modificar</button><button type="button" id="paEliminar" class="adm-btn">Eliminar</button><button type="button" id="paCancelar" class="adm-btn">Cancelar</button></div>' +
    '<p id="paFormMsg" class="dlg-msg" role="status"></p></form></div>';

  function ver(id) { ['paLista', 'paFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }

  async function cargar() {
    aviso('paMsg', '');
    $('paGrid').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await Promise.all([
      sb.from('paquetes').select('*').order('creado', { ascending: false }),
      sb.from('paquete_items').select('paquete_id,tratamiento_id,cantidad'),
      sb.from('tratamientos').select('id,nombre,precio,activo').order('nombre'),
      sb.from('precios').select('tratamiento_id,valor,localidad_id').eq('tipo', 'directo').eq('estado', 'activo'),
      sb.from('tipos_procedimiento').select('id,nombre,estado,orden,sugeridos').order('orden').order('codigo')
    ]);
    var err = r.slice(0, 4).map(function (x) { return x.error; }).filter(Boolean)[0];
    if (window.PD_SEDES && r[3].data) { await window.PD_SEDES.cargar(); r[3].data = window.PD_SEDES.deSede(r[3].data); }
    if (err) { $('paGrid').innerHTML = ''; aviso('paMsg', traducir(err), true); return; }
    paquetes = r[0].data; catalogo = r[2].data; items = {}; precioDirecto = {};
    tiposProc = r[4].error ? [] : r[4].data.filter(function (t) { return t.estado === 'activo'; });
    $('paNuevo').disabled = !puedeEditar();
    $('paNuevo').title = puedeEditar() ? '' : 'Solo el Super Administrador puede crear paquetes.';
    r[1].data.forEach(function (i) { (items[i.paquete_id] = items[i.paquete_id] || []).push({ tratamiento_id: i.tratamiento_id, cantidad: i.cantidad }); });
    r[3].data.forEach(function (p) { precioDirecto[p.tratamiento_id] = Number(p.valor); });
    pintarLista();
  }

  function pintarLista() {
    document.querySelectorAll('[data-pafiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.pafiltro === filtro); });
    var lista = paquetes.filter(function (p) { return filtro === 'todos' || p.estado === filtro; });
    $('paGrid').innerHTML = !paquetes.length ? '<p class="dlg-msg">Aún no hay paquetes. Pulsa «Nuevo paquete» para crear el primero.</p>'
      : !lista.length ? '<p class="dlg-msg">No hay paquetes con ese filtro.</p>'
      : lista.map(function (p) {
        var ls = items[p.id] || [], normal = normalDe(ls), a = ahorro(normal, p.precio);
        var vence = p.vigente_hasta && p.vigente_hasta < hoy();
        return '<button type="button" class="pa-card" data-paabrir="' + p.id + '">' +
          '<span class="pa-fila"><b>' + esc(p.nombre) + '</b>' + pill(p.estado) + '</span>' +
          '<span class="hi-desc">' + esc(p.codigo || '') + '</span>' +
          '<span><span class="pa-precio">' + q(p.precio) + '</span>' + (a ? '<s class="pa-antes">' + q(normal) + '</s>' : '') + (p.precio_usd != null ? ' <span class="hi-desc">· ' + usd(p.precio_usd) + '</span>' : '') + '</span>' +
          (a ? '<span class="pa-ahorro">Ahorra ' + q(a.monto) + ' (' + a.pct + ' %)</span>' : '') +
          '<ul>' + ls.map(function (l) { return '<li>' + esc(nombreTrat(l.tratamiento_id)) + ' ×' + l.cantidad + '</li>'; }).join('') + '</ul>' +
          '<small>' + (p.vigente_hasta ? 'Vigente del ' + fechaNum(p.vigente_desde) + ' al ' + fechaNum(p.vigente_hasta) : 'Desde el ' + fechaNum(p.vigente_desde) + ', sin vencimiento') +
          ' · desc. máx. ' + Number(p.descuento_max) + ' %' + (vence ? ' · <b style="color:#9F1239">vencido</b>' : '') + '</small></button>';
      }).join('');
  }

  // ---------- Ficha ----------
  function pintarEstadoSelect() { $('paEstado').dataset.estado = $('paEstado').value; }
  // Lista de procedimientos por tipo (de «Tipos de procedimientos») más los del catálogo sin tipo.
  // Valor: «t:ID» si ya está en el catálogo, o «s:TIPO:NOMBRE» si es un sugerido que se agregará al grabar.
  function opcionesCatalogo() {
    var usados = lineas.map(function (l) { return clave(nombreLinea(l)); }), vistos = {}, grupos = [];
    function opcion(nombre, tipoId) {
      var k = clave(nombre); if (vistos[k] || usados.indexOf(k) >= 0) return '';
      vistos[k] = 1;
      var t = catalogo.filter(function (x) { return clave(x.nombre) === k; })[0];
      if (t && !t.activo) return '';
      return t ? '<option value="t:' + t.id + '">' + esc(t.nombre) + ' · ' + q(precioNormal(t.id)) + '</option>'
        : '<option value="s:' + tipoId + ':' + esc(nombre) + '">' + esc(nombre) + ' · sin precio</option>';
    }
    tiposProc.forEach(function (tp) {
      var html = (tp.sugeridos || []).map(function (n) { return opcion(n, tp.id); }).join('') +
        catalogo.filter(function (t) { return t.tipo_id === tp.id; }).map(function (t) { return opcion(t.nombre, tp.id); }).join('');
      if (html) grupos.push('<optgroup label="' + esc(tp.nombre) + '">' + html + '</optgroup>');
    });
    var resto = catalogo.map(function (t) { return opcion(t.nombre, ''); }).join('');
    if (resto) grupos.push(tiposProc.length ? '<optgroup label="Sin tipo">' + resto + '</optgroup>' : resto);
    $('paTrat').innerHTML = grupos.length ? '<option value="">Elige un procedimiento…</option>' + grupos.join('')
      : '<option value="">' + (catalogo.length || tiposProc.length ? 'Ya están todos los procedimientos' : 'No hay procedimientos: créalos en Tipos de procedimientos') + '</option>';
    $('paAgregar').disabled = !grupos.length || !editando;
  }
  function clave(t) { return String(t || '').trim().toLowerCase(); }
  function pintarItems() {
    $('paItems').innerHTML = lineas.length ? lineas.map(function (l, k) {
      var pn = precioNormal(l.tratamiento_id);
      return '<tr><td>' + esc(nombreLinea(l)) + (l.tratamiento_id ? '' : ' <span class="hi-desc">(se agregará al catálogo)</span>') + '</td>' +
        '<td class="num"><input type="number" min="1" max="99" value="' + l.cantidad + '" data-pacant="' + k + '" class="pa-cant" aria-label="Cantidad"></td>' +
        '<td class="num">' + q(pn) + '</td><td class="num">' + q(pn * l.cantidad) + '</td>' +
        '<td><button type="button" class="adm-btn" data-paquitar="' + k + '">Quitar</button></td></tr>';
    }).join('') : '<tr><td colspan="5">Agrega los procedimientos que incluye el paquete.</td></tr>';
    var normal = normalDe(lineas), precio = Number($('paPrecio').value) || 0, a = ahorro(normal, precio);
    $('paTotales').innerHTML = '<span>Precio normal: <b>' + q(normal) + '</b></span><span>Paquete: <b>' + q(precio) + '</b></span>' +
      (a ? '<span class="pa-ahorro">Ahorro ' + q(a.monto) + ' (' + a.pct + ' %)</span>' : lineas.length && precio > normal ? '<span class="pa-aviso">El paquete cuesta más que los procedimientos por separado</span>' : '');
    opcionesCatalogo();
  }
  function rellenar(p) {
    $('paCodigo').textContent = p ? p.codigo : 'Se asigna al grabar';
    $('paEstado').value = p ? p.estado : 'activo'; pintarEstadoSelect();
    if (window.PD_SEDES) window.PD_SEDES.llenar($('paOrg'), $('paLoc'), p ? p.localidad_id : null);
    $('paPrecioUsd').value = p && p.precio_usd != null ? Number(p.precio_usd) : '';
    $('paFecha').value = p ? (p.fecha || hoy()) : hoy();
    $('paNombre').value = p ? p.nombre : '';
    $('paDesc').value = p ? p.descripcion || '' : '';
    $('paDesde').value = p ? p.vigente_desde : hoy();
    $('paHasta').value = p ? p.vigente_hasta || '' : '';
    $('paPrecio').value = p ? Number(p.precio) : '';
    $('paDescuento').value = p ? Number(p.descuento_max) : '';
    lineas = p ? (items[p.id] || []).map(function (l) { return { tratamiento_id: l.tratamiento_id, cantidad: l.cantidad }; }) : [];
    pintarItems();
  }
  function pintarCabecera() {
    $('paTitulo').textContent = actual ? actual.nombre : 'Nuevo paquete';
    $('paSub').textContent = actual ? actual.codigo + ' · registrado por ' + (actual.registrado_por || '—') + ' · última modificación por ' + (actual.actualizado_por || '—') : 'Llena los datos, agrega los procedimientos y pulsa «Grabar».';
    $('paPill').hidden = !actual;
    if (actual) { $('paPill').className = 'estado estado-' + actual.estado; $('paPill').textContent = ESTADOS[actual.estado]; }
  }
  function aplicarModo() {
    var permiso = puedeEditar();
    if (!permiso) editando = false;
    $('paSoloSuper').hidden = permiso;
    $('paCampos').disabled = !editando; $('paItemsCampos').disabled = !editando;
    $('paGrabar').disabled = !editando; $('paCancelar').disabled = !editando;
    $('paModificar').disabled = !permiso || editando || !actual; $('paEliminar').disabled = !permiso || editando || !actual;
    $('paModificar').title = !permiso ? 'Solo el Super Administrador puede modificar paquetes.' : !actual ? 'Disponible después de grabar el paquete.' : '';
    $('paEliminar').title = !permiso ? 'Solo el Super Administrador puede eliminar paquetes.' : !actual ? 'Disponible después de grabar el paquete.' : '';
    if ($('paEliminar').dataset.confirmar === '1') { $('paEliminar').dataset.confirmar = '0'; $('paEliminar').textContent = 'Eliminar'; $('paEliminar').style.borderColor = ''; $('paEliminar').style.color = ''; }
    opcionesCatalogo();
  }
  function abrir(p) {
    actual = p || null; editando = !p;
    rellenar(actual); pintarCabecera(); aplicarModo();
    aviso('paFormMsg', ''); ver('paFicha');
    if (editando) $('paNombre').focus();
  }

  async function grabar(e) {
    e.preventDefault();
    if (!editando) return;
    var nombre = $('paNombre').value.trim(), desde = $('paDesde').value, hasta = $('paHasta').value;
    var precio = $('paPrecio').value === '' ? NaN : Number($('paPrecio').value);
    var desc = $('paDescuento').value === '' ? 0 : Number($('paDescuento').value);
    var precioUsd = $('paPrecioUsd').value === '' ? null : Number($('paPrecioUsd').value), fecha = $('paFecha').value;
    if (!puedeEditar()) { aviso('paFormMsg', 'Solo el Super Administrador puede crear o modificar paquetes.', true); return; }
    if (!nombre) { aviso('paFormMsg', 'Escribe el nombre del paquete.', true); $('paNombre').focus(); return; }
    if (precioUsd != null && (isNaN(precioUsd) || precioUsd < 0)) { aviso('paFormMsg', 'El precio en dólares no puede ser negativo.', true); $('paPrecioUsd').focus(); return; }
    if (!fecha) { aviso('paFormMsg', 'Indica la fecha del paquete.', true); $('paFecha').focus(); return; }
    if (!desde) { aviso('paFormMsg', 'Indica desde cuándo está vigente.', true); $('paDesde').focus(); return; }
    if (hasta && hasta < desde) { aviso('paFormMsg', 'La fecha final de vigencia no puede ser anterior a la inicial.', true); $('paHasta').focus(); return; }
    if (isNaN(precio) || precio < 0) { aviso('paFormMsg', 'Escribe el precio del paquete.', true); $('paPrecio').focus(); return; }
    if (isNaN(desc) || desc < 0 || desc > 100) { aviso('paFormMsg', 'El descuento máximo debe estar entre 0 y 100 %.', true); $('paDescuento').focus(); return; }
    if (!lineas.length) { aviso('paFormMsg', 'Agrega al menos un procedimiento al paquete.', true); return; }
    $('paGrabar').disabled = true;
    aviso('paFormMsg', 'Grabando…');
    var r = await sb.rpc('guardar_paquete', {
      p_id: actual ? actual.id : null, p_nombre: nombre, p_descripcion: $('paDesc').value, p_precio: Math.round(precio * 100) / 100,
      p_descuento: Math.round(desc * 100) / 100, p_desde: desde, p_hasta: hasta || null, p_estado: $('paEstado').value,
      p_items: lineas.map(function (l) { return l.tratamiento_id ? { tratamiento_id: l.tratamiento_id, cantidad: l.cantidad } : { nombre: l.nombre, tipo_id: l.tipo_id, cantidad: l.cantidad }; }),
      p_precio_usd: precioUsd == null ? null : Math.round(precioUsd * 100) / 100, p_fecha: fecha
    });
    if (r.error) { $('paGrabar').disabled = false; aviso('paFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual, id = r.data;
    if (window.PD_SEDES && $('paLoc').options.length > 1 && id) await sb.from('paquetes').update(window.PD_SEDES.valores($('paOrg'), $('paLoc'))).eq('id', id);
    await cargar();
    actual = paquetes.filter(function (p) { return p.id === id; })[0] || null;
    editando = false;
    rellenar(actual); pintarCabecera(); aplicarModo();
    aviso('paFormMsg', nuevo ? 'Paquete grabado.' : 'Cambios grabados.');
    cargarPublicos();
  }

  $('tabPaquetes').addEventListener('click', function () { if (!$('paLista').hidden) cargar(); });
  $('paNuevo').addEventListener('click', function () { abrir(null); });
  $('paVolver').addEventListener('click', function () { actual = null; ver('paLista'); pintarLista(); });
  $('paFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-pafiltro]'); if (b) { filtro = b.dataset.pafiltro; pintarLista(); } });
  $('paGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-paabrir]');
    if (b) abrir(paquetes.filter(function (p) { return String(p.id) === b.dataset.paabrir; })[0]);
  });
  $('paEstado').addEventListener('change', pintarEstadoSelect);
  $('paPrecio').addEventListener('input', pintarItems);
  $('paAgregar').addEventListener('click', function () {
    var v = $('paTrat').value, c = Math.max(1, Math.min(99, parseInt($('paCant').value, 10) || 1));
    if (!v) return;
    if (v.indexOf('t:') === 0) lineas.push({ tratamiento_id: +v.slice(2), cantidad: c });
    else { var p = v.split(':'); lineas.push({ tratamiento_id: null, nombre: p.slice(2).join(':'), tipo_id: p[1] ? +p[1] : null, cantidad: c }); }
    $('paCant').value = 1;
    pintarItems();
  });
  $('paItems').addEventListener('input', function (e) {
    var i = e.target.closest('[data-pacant]');
    if (!i) return;
    lineas[+i.dataset.pacant].cantidad = Math.max(1, Math.min(99, parseInt(i.value, 10) || 1));
    var normal = normalDe(lineas), precio = Number($('paPrecio').value) || 0, a = ahorro(normal, precio);
    var fila = i.closest('tr'); fila.cells[3].textContent = q(precioNormal(lineas[+i.dataset.pacant].tratamiento_id) * lineas[+i.dataset.pacant].cantidad);
    $('paTotales').innerHTML = '<span>Precio normal: <b>' + q(normal) + '</b></span><span>Paquete: <b>' + q(precio) + '</b></span>' + (a ? '<span class="pa-ahorro">Ahorro ' + q(a.monto) + ' (' + a.pct + ' %)</span>' : '');
  });
  $('paItems').addEventListener('click', function (e) {
    var b = e.target.closest('[data-paquitar]');
    if (b) { lineas.splice(+b.dataset.paquitar, 1); pintarItems(); }
  });
  $('paForm').addEventListener('submit', grabar);
  $('paModificar').addEventListener('click', function () {
    if (!actual || !puedeEditar()) return;
    editando = true; aplicarModo();
    $('paFecha').value = hoy();   // al actualizar, la fecha pasa a la de hoy (se puede cambiar)
    aviso('paFormMsg', 'Modo modificación: haz los cambios y pulsa «Grabar».');
    $('paNombre').focus();
  });
  $('paCancelar').addEventListener('click', function () {
    if (!actual) { ver('paLista'); pintarLista(); return; }
    editando = false; rellenar(actual); aplicarModo();
    aviso('paFormMsg', 'Se descartaron los cambios.');
  });
  $('paEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || editando || !puedeEditar() || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('paquetes').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('paFormMsg', traducir(r.error), true); return; }
    var nombre = actual.nombre;
    actual = null;
    await cargar();
    ver('paLista');
    aviso('paMsg', 'Paquete «' + nombre + '» eliminado.');
    cargarPublicos();
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('paLista').hidden) cargar(); },
    limpiar: function () { paquetes = []; items = {}; catalogo = []; actual = null; editando = false; lineas = []; $('paGrid').innerHTML = ''; ver('paLista'); }
  });
})();
