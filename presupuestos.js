// Plus Dental — Presupuestos y catálogo de tratamientos (solo Administrador y Super Administrador)
// Precios con IVA incluido. Cada tratamiento de un presupuesto aprobado se carga a la cuenta al marcarlo como realizado.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var ESTADOS = { borrador: 'Borrador', enviado: 'Enviado', aprobado: 'Aprobado', rechazado: 'Rechazado' };
  // Estado que se muestra: Activo (borrador o enviado), Aprobado, Proceso (con tratamientos realizados),
  // Finalizado (todos realizados) y No aprobado (rechazado). Proceso y Finalizado se calculan solos.
  var ESTADOS_V = { activo: 'Activo', aprobado: 'Aprobado', proceso: 'Proceso', finalizado: 'Finalizado', no_aprobado: 'No aprobado' };
  function estadoVisible(estado, its) {
    if (estado === 'rechazado') return 'no_aprobado';
    if (estado !== 'aprobado') return 'activo';
    var hechos = (its || []).filter(function (i) { return i.realizado; }).length;
    return !hechos ? 'aprobado' : hechos === its.length ? 'finalizado' : 'proceso';
  }
  var FORMAS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta de crédito', otro: 'Otro' };
  function codigoDe(p) { return p.codigo || 'N.º ' + p.id; }
  var lista = [], pacientes = [], catalogo = [], filtro = 'todos';
  var actual = null, items = [], cambios = false;
  // Precios activos por tratamiento y tipo (de «Precios y paquetes»): { idTratamiento: { directo: {valor, max}, … } }
  var preciosAct = {};
  var tiposCat = [];   // tipos de procedimientos (para clasificar los tratamientos del catálogo)
  var TIPOS = { directo: 'Cliente directo', institucional: 'Institucional', vip: 'VIP', referido: 'Referido', paquete: 'Paquete', especial: 'Especial' };

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function editable() { return actual && (actual.estado === 'borrador' || actual.estado === 'enviado'); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/relation .*(tratamientos|presupuesto).* does not exist|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script de presupuestos.';
    if (/tratamientos_nombre_unico|duplicate key/i.test(m)) return 'Ese tratamiento ya está en el catálogo.';
    if (/row-level security|permission denied|No tienes permiso/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }

  // Importe de una línea con el descuento del presupuesto aplicado
  function importe(it) { return redondear(it.cantidad * it.precio); }
  function totales(lineas, descuento) {
    var sub = redondear(lineas.reduce(function (s, it) { return s + importe(it); }, 0));
    var factor = 1 - (Number(descuento) || 0) / 100;
    var realizado = redondear(lineas.filter(function (it) { return it.realizado; }).reduce(function (s, it) { return s + importe(it) * factor; }, 0));
    return { subtotal: sub, descuento: redondear(sub - sub * factor), total: redondear(sub * factor), realizado: realizado };
  }

  // ---------- Lista ----------
  async function cargar() {
    aviso('preMsg', '');
    $('preBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var r = await sb.from('presupuestos')
      .select('id,codigo,fecha,estado,descuento_pct,paciente_id,pacientes(nombre),presupuesto_items(cantidad,precio,realizado)')
      .order('id', { ascending: false });
    if (r.error) { $('preBody').innerHTML = ''; aviso('preMsg', traducir(r.error), true); return; }
    lista = r.data;
    pintarLista();
    cargarPacientes();
    cargarCatalogo();
  }

  async function cargarPacientes() {
    var r = await sb.from('pacientes').select('id,nombre,dpi').order('nombre');
    if (r.error) return;
    pacientes = r.data;
    $('prePaciente').innerHTML = pacientes.length
      ? '<option value="">Elige un paciente…</option>' + pacientes.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.nombre) + (p.dpi ? ' · DPI ' + esc(p.dpi) : '') + '</option>';
      }).join('')
      : '<option value="">Primero crea el expediente del paciente</option>';
  }

  function pintarLista() {
    document.querySelectorAll('#preFiltros [data-pfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.pfiltro === filtro); });
    var buscar = $('preBuscar').value.trim().toLowerCase();
    var filas = lista.filter(function (p) {
      var nombre = (p.pacientes && p.pacientes.nombre) || '';
      return (filtro === 'todos' || estadoVisible(p.estado, p.presupuesto_items) === filtro) &&
        (!buscar || nombre.toLowerCase().indexOf(buscar) >= 0 || String(p.id) === buscar || String(p.codigo || '').toLowerCase().indexOf(buscar) >= 0);
    });
    if (!filas.length) {
      $('preBody').innerHTML = '<tr><td colspan="7">' + (lista.length ? 'Ningún presupuesto coincide.' : 'Todavía no hay presupuestos. Elige un paciente y pulsa «Nuevo presupuesto».') + '</td></tr>';
      return;
    }
    $('preBody').innerHTML = filas.map(function (p) {
      var its = p.presupuesto_items || [];
      var t = totales(its, p.descuento_pct);
      var hechos = its.filter(function (i) { return i.realizado; }).length;
      var ev = estadoVisible(p.estado, its);
      return '<tr><td class="fecha"><strong>' + esc(codigoDe(p)) + '</strong></td><td><strong>' + esc(p.pacientes ? p.pacientes.nombre : '—') + '</strong></td>' +
        '<td class="fecha">' + fechaCorta(p.fecha) + '</td><td class="num"><strong>' + q(t.total) + '</strong></td>' +
        '<td><span class="estado estado-' + ev + '">' + ESTADOS_V[ev] + '</span></td>' +
        '<td class="fecha">' + (p.estado === 'aprobado' ? hechos + ' de ' + its.length : '—') + '</td>' +
        '<td><button type="button" class="adm-btn" data-abrir="' + p.id + '">Abrir</button></td></tr>';
    }).join('');
  }

  function ver(id) {
    ['preLista', 'preEditor', 'preCatalogo'].forEach(function (v) { $(v).hidden = v !== id; });
  }

  // ---------- Catálogo ----------
  async function cargarCatalogo() {
    var r = await sb.from('tratamientos').select('id,nombre,precio,activo,tipo_id').order('nombre');
    if (r.error && /tipo_id/.test(r.error.message || '')) r = await sb.from('tratamientos').select('id,nombre,precio,activo').order('nombre');
    if (r.error) { aviso('catMsg', traducir(r.error), true); return; }
    catalogo = r.data;
    var tp = await sb.from('tipos_procedimiento').select('id,codigo,nombre,estado,orden,sugeridos').order('orden').order('codigo');
    tiposCat = tp.error ? [] : tp.data;
    var p = await sb.from('precios').select('tratamiento_id,tipo,valor,descuento_max').eq('estado', 'activo');
    preciosAct = {};
    if (!p.error) p.data.forEach(function (x) { (preciosAct[x.tratamiento_id] = preciosAct[x.tratamiento_id] || {})[x.tipo] = { valor: Number(x.valor), max: Number(x.descuento_max) }; });
    // Sugerencias al escribir: el catálogo activo y los procedimientos sugeridos de cada tipo
    var nombres = {};
    pintarSugerencias();
    pintarTiposProc();
    pintarCatalogo();
  }

  // Solo se ofrecen procedimientos con precio: un precio activo del tipo elegido o el precio del catálogo
  function conPrecio(t) { return !!(t && t.activo && ((preciosAct[t.id] && preciosAct[t.id][tipoActual()]) || Number(t.precio) > 0)); }
  function pintarSugerencias() {
    $('preCatalogoLista').innerHTML = catalogo.filter(conPrecio)
      .map(function (t) { return '<option value="' + esc(t.nombre) + '">' + q(precioDe(t)) + '</option>'; }).join('');
  }

  function pintarCatalogo() {
    $('catBody').innerHTML = catalogo.length
      ? catalogo.map(function (t) {
        var opcTipo = '<option value="">Sin tipo</option>' + tiposCat.filter(function (x) { return x.estado === 'activo' || x.id === t.tipo_id; })
          .map(function (x) { return '<option value="' + x.id + '"' + (x.id === t.tipo_id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('');
        return '<tr data-cat="' + t.id + '"><td><input class="adm-input" style="width:100%;border-radius:10px" maxlength="120" value="' + esc(t.nombre) + '" aria-label="Nombre del tratamiento" data-c="nombre"></td>' +
          '<td><select class="adm-input" style="width:100%;min-width:170px;border-radius:10px" data-c="tipo" aria-label="Tipo de ' + esc(t.nombre) + '">' + opcTipo + '</select></td>' +
          '<td class="num"><input class="adm-input" type="number" min="0" step="0.01" style="width:130px;border-radius:10px;text-align:right" value="' + Number(t.precio).toFixed(2) + '" aria-label="Precio de ' + esc(t.nombre) + '" data-c="precio"></td>' +
          '<td><input type="checkbox" data-c="activo"' + (t.activo ? ' checked' : '') + ' aria-label="Activo" style="width:20px;height:20px;accent-color:#005A87"></td>' +
          '<td><button type="button" class="adm-btn" data-guardar-cat="' + t.id + '">Guardar</button></td></tr>';
      }).join('')
      : '<tr><td colspan="5">El catálogo está vacío. Agrega los tratamientos que ofrece la clínica con su precio.</td></tr>';
  }

  // ---------- Tipos de procedimientos (para agregar tratamientos) ----------
  function tiposActivos() { return tiposCat.filter(function (x) { return x.estado === 'activo'; }); }
  // Procedimientos de un tipo: sus sugeridos y los del catálogo clasificados en él (sin repetir)
  function procedimientosDe(tp) {
    var lista = [], vistos = {};
    (tp.sugeridos || []).forEach(function (n) {
      var t = tratamientoDe(n);
      if (t && !t.activo) return;
      if (t && t.tipo_id && t.tipo_id !== tp.id && tiposActivos().some(function (x) { return x.id === t.tipo_id; })) return;
      if (!vistos[n.toLowerCase()]) { vistos[n.toLowerCase()] = 1; lista.push({ nombre: t ? t.nombre : n, t: t }); }
    });
    catalogo.forEach(function (t) {
      if (t.activo && t.tipo_id === tp.id && !vistos[t.nombre.toLowerCase()]) { vistos[t.nombre.toLowerCase()] = 1; lista.push({ nombre: t.nombre, t: t }); }
    });
    return lista;
  }
  function tipoDeNombre(nombre) {
    var t = tratamientoDe(nombre);
    if (t && t.tipo_id) { var x = tiposCat.filter(function (y) { return y.id === t.tipo_id; })[0]; if (x) return x.nombre; }
    var s = tiposActivos().filter(function (y) { return (y.sugeridos || []).some(function (n) { return n.toLowerCase() === String(nombre || '').trim().toLowerCase(); }); })[0];
    return s ? s.nombre : '';
  }
  function pintarTiposProc() {
    var sel = $('preTipoProc'), antes = sel.value;
    sel.innerHTML = '<option value="">Todos los tipos</option>' + tiposActivos().map(function (x) { return '<option value="' + x.id + '">' + esc(x.nombre) + '</option>'; }).join('');
    sel.value = [].some.call(sel.options, function (o) { return o.value === antes; }) ? antes : '';
    pintarProcedimientos();
  }
  function pintarProcedimientos() {
    var sel = $('preTipoProc').value, antes = $('preProc').value;
    var grupos = tiposActivos().filter(function (x) { return !sel || String(x.id) === sel; })
      .map(function (x) { return { titulo: x.nombre, lista: procedimientosDe(x) }; });
    if (!sel) {
      var sinTipo = catalogo.filter(function (t) { return t.activo && !tiposActivos().some(function (x) { return x.id === t.tipo_id; }) && !grupos.some(function (g) { return g.lista.some(function (p) { return p.t === t; }); }); });
      if (sinTipo.length) grupos.push({ titulo: tiposActivos().length ? 'Sin tipo' : 'Catálogo', lista: sinTipo.map(function (t) { return { nombre: t.nombre, t: t }; }) });
    }
    grupos.forEach(function (g) { g.lista = g.lista.filter(function (p) { return conPrecio(p.t); }); });
    grupos = grupos.filter(function (g) { return g.lista.length; });
    $('preProc').innerHTML = grupos.length ? '<option value="">Elige un procedimiento…</option>' + grupos.map(function (g) {
      return '<optgroup label="' + esc(g.titulo) + '">' + g.lista.map(function (p) {
        return '<option value="' + esc(p.nombre) + '">' + esc(p.nombre) + ' · ' + q(precioDe(p.t)) + '</option>';
      }).join('') + '</optgroup>';
    }).join('') : '<option value="">No hay procedimientos con precio: defínelos en Precios y paquetes</option>';
    $('preProc').value = [].some.call($('preProc').options, function (o) { return o.value === antes; }) ? antes : '';
  }

  // ---------- Precio según el tipo ----------
  function tipoActual() { return $('preTipo').value || 'directo'; }
  function tratamientoDe(nombre) {
    var n = String(nombre || '').trim().toLowerCase();
    return catalogo.filter(function (t) { return t.nombre.toLowerCase() === n; })[0] || null;
  }
  // Precio activo del tipo elegido; si el tratamiento no lo tiene, el del catálogo
  function precioDe(t) {
    var p = preciosAct[t.id] && preciosAct[t.id][tipoActual()];
    return p ? p.valor : Number(t.precio);
  }
  // Descuento máximo: el más bajo de los precios activos de este tipo usados en el presupuesto (null = sin límite)
  function descuentoMax() {
    var max = null;
    items.forEach(function (it) {
      var t = tratamientoDe(it.tratamiento), p = t && preciosAct[t.id] && preciosAct[t.id][tipoActual()];
      if (p) max = max == null ? p.max : Math.min(max, p.max);
    });
    return max;
  }
  function pintarDescMax() {
    var max = descuentoMax(), d = Number($('preDescuento').value) || 0, aviso = $('preDescMax');
    aviso.hidden = max == null || !editable();
    if (aviso.hidden) return;
    aviso.textContent = 'Descuento máximo con precio ' + TIPOS[tipoActual()] + ': ' + max + ' %' + (d > max ? ' — reduce el descuento para poder guardar.' : '');
    aviso.classList.toggle('pre-max-error', d > max);
  }

  // ---------- Editor ----------
  async function abrir(id) {
    aviso('preEdMsg', '');
    var r = await sb.from('presupuestos').select('*,pacientes(nombre,telefono,dpi),presupuesto_items(*)').eq('id', id).single();
    if (r.error) { aviso('preMsg', traducir(r.error), true); return; }
    actual = r.data;
    var he = await sb.from('presupuesto_estados').select('de,a,fecha,usuario').eq('presupuesto_id', id).order('id');
    historialEst = he.error ? [] : he.data;
    items = (actual.presupuesto_items || []).sort(function (a, b) { return a.orden - b.orden || a.id - b.id; })
      .map(function (i) { return { id: i.id, tratamiento: i.tratamiento, pieza: i.pieza || '', cantidad: i.cantidad, precio: Number(i.precio), realizado: i.realizado, realizado_en: i.realizado_en }; });
    cambios = false;
    $('preDescuento').value = Number(actual.descuento_pct) || 0;
    $('preTipo').value = actual.tipo_precio || 'directo';
    $('preNotas').value = actual.notas || '';
    $('preForma').value = actual.forma_pago || 'efectivo';
    $('preCuotas').value = String(actual.cuotas || 1);
    $('preSinRecargo').value = actual.sin_recargo ? '1' : '';
    if (window.PD_CUOTAS) window.PD_CUOTAS.cargar().then(function () { if (actual) pintarCuotas(); });
    $('preCitas').value = actual.citas || '';
    if (editable() && !items.length) items.push({ tratamiento: '', pieza: '', cantidad: 1, precio: 0 });
    pintarEditor();
    ver('preEditor');
    $('preEditor').scrollIntoView({ block: 'start' });
  }

  // Fechas del presupuesto (las registra la base de datos) e historial de estados
  var historialEst = [];
  function fechaHoraP(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function pintarFechas() {
    var a = actual, nombre = { borrador: 'Activo', enviado: 'Activo', aprobado: 'Aprobado', rechazado: 'No aprobado' };
    $('preFechas').innerHTML = '<div><span>Fecha del presupuesto</span>' + fechaHoraP(a.creado) + '</div>' +
      '<div><span>Elaborado por</span>' + esc(a.creado_por || '—') + '</div>' +
      '<div><span>Fecha cambio de estado</span>' + fechaHoraP(a.estado_cambiado) + (a.estado_cambiado_por ? ' · ' + esc(a.estado_cambiado_por) : '') + '</div>' +
      '<div><span>Fecha de aprobación</span>' + fechaHoraP(a.aprobado_en) + '</div>' +
      (historialEst.length ? '<div class="hist"><span>Historial de estados</span>' + historialEst.map(function (h) {
        return fechaHoraP(h.fecha) + ' · ' + (h.de ? nombre[h.de] + ' → ' : '') + nombre[h.a] + (h.usuario ? ' (' + esc(h.usuario) + ')' : '');
      }).join('<br>') + '</div>' : '');
  }

  function pintarEditor() {
    pintarFechas();
    var ed = editable();
    $('preTitulo').textContent = 'Presupuesto ' + codigoDe(actual);
    $('preSub').textContent = (actual.pacientes ? actual.pacientes.nombre : '') + ' · ' + fechaCorta(actual.fecha) + (actual.creado_por ? ' · por ' + actual.creado_por : '');
    var ev = estadoVisible(actual.estado, items);
    $('preEstado').className = 'estado estado-' + ev;
    $('preEstado').textContent = ESTADOS_V[ev];
    ['preForma', 'preCuotas', 'preCitas'].forEach(function (id) { $(id).disabled = !ed; });
    pintarCuotas();
    $('preDescuento').disabled = !ed;
    $('preTipo').disabled = !ed;
    $('preNotas').disabled = !ed;
    $('preAgregarWrap').hidden = !ed;

    $('preItems').innerHTML = items.length ? items.map(function (it, i) {
      if (ed) {
        return '<tr data-i="' + i + '">' +
          '<td class="c-trat"><input class="adm-input" list="preCatalogoLista" maxlength="150" data-f="tratamiento" value="' + esc(it.tratamiento) + '" aria-label="Tratamiento" placeholder="Elige o escribe">' +
          '<span class="pre-tipo-tag" data-tipo-tag>' + esc(tipoDeNombre(it.tratamiento)) + '</span></td>' +
          '<td class="c-pieza"><input class="adm-input" maxlength="20" data-f="pieza" value="' + esc(it.pieza) + '" aria-label="Pieza" placeholder="Ej.: 16"></td>' +
          '<td class="c-cant"><input class="adm-input" type="number" min="1" step="1" data-f="cantidad" value="' + it.cantidad + '" aria-label="Cantidad"></td>' +
          '<td class="c-precio"><input class="adm-input" type="number" min="0" step="0.01" data-f="precio" value="' + Number(it.precio).toFixed(2) + '" aria-label="Precio"></td>' +
          '<td class="num" data-importe>' + q(importe(it)) + '</td>' +
          '<td style="color:#5A6D7A;font-size:13px">Al aprobar</td>' +
          '<td><button type="button" class="adm-btn" data-quitar="' + i + '" style="min-height:38px;padding:6px 12px">Quitar</button></td></tr>';
      }
      var marcar = actual.estado === 'aprobado'
        ? '<label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#5A6D7A"><input type="checkbox" data-realizado="' + it.id + '"' + (it.realizado ? ' checked' : '') + ' aria-label="Realizado: ' + esc(it.tratamiento) + '">' + (it.realizado && it.realizado_en ? fechaCorta(it.realizado_en) : '') + '</label>'
        : '—';
      var tipoIt = tipoDeNombre(it.tratamiento);
      return '<tr><td><strong>' + esc(it.tratamiento) + '</strong>' + (tipoIt ? '<span class="pre-tipo-tag">' + esc(tipoIt) + '</span>' : '') + '</td><td>' + esc(it.pieza || '—') + '</td><td class="num">' + it.cantidad + '</td>' +
        '<td class="num">' + q(it.precio) + '</td><td class="num">' + q(importe(it)) + '</td><td>' + marcar + '</td><td></td></tr>';
    }).join('') : '<tr><td colspan="7">Sin tratamientos.</td></tr>';

    pintarTotales();
    pintarAcciones();
  }

  // Plan de pago: solo con tarjeta de crédito, con el valor de cada cuota
  function pintarCuotas() {
    var tarjeta = $('preForma').value === 'tarjeta';
    $('preCuotasWrap').hidden = !tarjeta;
    if (!tarjeta || !window.PD_CUOTAS) { $('preCuotasTabla').innerHTML = ''; return; }
    var total = totales(items, $('preDescuento').value).total, sel = +($('preCuotas').value || 1);
    // presupuesto ya aprobado o no aprobado: se usa el % guardado; si se puede editar, el vigente
    var fijo = !editable() && sel === actual.cuotas ? actual.recargo_pct : null;
    $('preCuotasTabla').innerHTML = window.PD_CUOTAS.tabla(total, sel, 'pre-cuota', fijo, $('preSinRecargo').value === '1');
    $('preCuotasTabla').classList.toggle('cuo-bloqueada', !editable());
  }

  function pintarTotales() {
    var t = totales(items, $('preDescuento').value);
    $('preSubtotal').textContent = q(t.subtotal);
    $('preTotal').textContent = q(t.total);
    pintarCuotas();
    $('preRealizado').textContent = actual.estado === 'aprobado' ? q(t.realizado) : '—';
    document.querySelectorAll('#preItems [data-importe]').forEach(function (td) {
      var it = items[+td.parentNode.dataset.i];
      if (it) td.textContent = q(importe(it));
    });
    pintarDescMax();
  }

  function mensajeWhatsApp() {
    var t = totales(items, $('preDescuento').value);
    var lineas = items.filter(function (it) { return it.tratamiento.trim(); }).map(function (it) {
      return '• ' + it.tratamiento.trim() + (it.pieza ? ' (pieza ' + it.pieza + ')' : '') + (it.cantidad > 1 ? ' x' + it.cantidad : '') + ': ' + q(importe(it));
    });
    var texto = 'Hola ' + (actual.pacientes ? actual.pacientes.nombre : '') + ', le compartimos su presupuesto de Plus Dental (' + codigoDe(actual) + ', ' + fechaCorta(actual.fecha) + '):\n\n' +
      lineas.join('\n') + '\n\n' +
      (t.descuento ? 'Subtotal: ' + q(t.subtotal) + '\nDescuento (' + Number($('preDescuento').value) + '%): -' + q(t.descuento) + '\n' : '') +
      'Total: ' + q(t.total) + ' (IVA incluido)' +
      '\nForma de pago: ' + FORMAS[$('preForma').value || 'efectivo'] + ($('preForma').value === 'tarjeta' ? ' · ' + ($('preCuotas').value === '1' ? '1 pago' : $('preCuotas').value + ' cuotas') : '') +
      ($('preForma').value === 'tarjeta' && window.PD_CUOTAS ? (function () { var sinR = $('preSinRecargo').value === '1', c = window.PD_CUOTAS.calcular(t.total, +($('preCuotas').value || 1), sinR ? 0 : !editable() ? actual.recargo_pct : null); return '\nValor de cada cuota: ' + q(c.cuota) + (sinR ? ' (sin recargo)' : ' (recargo ' + c.pct + '%)') + '\nTotal a pagar con tarjeta: ' + q(c.total); })() : '') +
      ($('preCitas').value ? '\nCitas estimadas: ' + $('preCitas').value : '') +
      ($('preNotas').value.trim() ? '\n\n' + $('preNotas').value.trim() : '') +
      '\n\nQuedamos a la orden para cualquier duda.';
    var num = String((actual.pacientes && actual.pacientes.telefono) || '').replace(/\D/g, '');
    if (num.length === 8) num = '502' + num;
    return num ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto) : '';
  }

  function pintarAcciones() {
    var b = [];
    var e = actual.estado;
    if (editable()) b.push('<button type="button" class="dlg-submit" data-accion="guardar">Guardar</button>');
    var wa = mensajeWhatsApp();
    if (e !== 'rechazado') {
      b.push(wa
        ? '<a class="adm-btn" id="preWa" href="' + esc(wa) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">' + (e === 'borrador' ? 'Enviar por WhatsApp' : 'Reenviar por WhatsApp') + '</a>'
        : '<span class="dlg-msg">Agrega un teléfono en el expediente para enviarlo por WhatsApp.</span>');
    }
    if (e === 'borrador' || e === 'enviado') {
      b.push('<button type="button" class="adm-btn adm-primary" data-accion="aprobado">Marcar aprobado</button>');
      b.push('<button type="button" class="adm-btn" data-accion="rechazado">Marcar no aprobado</button>');
    }
    if (e === 'enviado' || e === 'rechazado' || (e === 'aprobado' && !items.some(function (i) { return i.realizado; }))) {
      b.push('<button type="button" class="adm-btn" data-accion="borrador">Volver a activo</button>');
    }
    if (esSuper() && e !== 'aprobado') b.push('<button type="button" class="adm-btn" data-accion="borrar" data-confirmar="0">Borrar</button>');
    $('preAcciones').innerHTML = b.join('');
  }

  async function guardar() {
    var max = descuentoMax(), d = Number($('preDescuento').value) || 0;
    if (max != null && d > max) {
      aviso('preEdMsg', 'El descuento máximo con precio ' + TIPOS[tipoActual()] + ' es ' + max + ' %. Reduce el descuento.', true);
      $('preDescuento').focus();
      return false;
    }
    var datos = items.map(function (it) { return { tratamiento: it.tratamiento, pieza: it.pieza, cantidad: it.cantidad, precio: it.precio }; });
    var r = await sb.rpc('guardar_presupuesto', {
      p_id: actual.id,
      p_descuento: Math.min(Math.max(d, 0), 100),
      p_notas: $('preNotas').value,
      p_items: datos,
      p_tipo: tipoActual(),
      p_forma_pago: $('preForma').value || 'efectivo',
      p_cuotas: $('preForma').value === 'tarjeta' ? +($('preCuotas').value || 1) : null,
      p_citas: $('preCitas').value ? Math.min(Math.max(parseInt($('preCitas').value, 10) || 1, 1), 99) : null,
      p_sin_recargo: $('preForma').value === 'tarjeta' && $('preSinRecargo').value === '1'
    });
    if (r.error) { aviso('preEdMsg', traducir(r.error), true); return false; }
    cambios = false;
    return true;
  }

  async function cambiarEstado(estado) {
    if (editable() && !(await guardar())) return false;
    if (estado === 'aprobado' && !items.some(function (i) { return i.tratamiento.trim(); })) {
      aviso('preEdMsg', 'Agrega al menos un tratamiento antes de aprobar.', true);
      return false;
    }
    var r = await sb.from('presupuestos').update({ estado: estado }).eq('id', actual.id).select('id');
    if (r.error || !r.data || !r.data.length) { aviso('preEdMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return false; }
    await abrir(actual.id);
    return true;
  }

  function pedirConfirmacion(b) {
    if (b.dataset.confirmar === '1') return true;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? Borrar';
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.isConnected) { b.dataset.confirmar = '0'; b.textContent = 'Borrar'; b.style.borderColor = ''; b.style.color = ''; } }, 4000);
    return false;
  }

  async function volverALista() {
    var aviso_ = cambios && editable() ? 'Ojo: no se guardaron los últimos cambios del presupuesto N.º ' + actual.id + '.' : '';
    actual = null; items = []; cambios = false;
    ver('preLista');
    await cargar();
    if (aviso_) aviso('preMsg', aviso_, true);
  }

  // ---------- Eventos ----------
  $('preFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pfiltro]');
    if (b) { filtro = b.dataset.pfiltro; pintarLista(); }
  });
  $('preBuscar').addEventListener('input', pintarLista);
  $('preBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir]');
    if (b) abrir(b.dataset.abrir);
  });
  $('preVolver').addEventListener('click', volverALista);
  $('preVerCatalogo').addEventListener('click', function () { ver('preCatalogo'); aviso('catMsg', ''); cargarCatalogo(); });
  $('preCatVolver').addEventListener('click', function () { ver('preLista'); cargar(); });

  $('preNuevoForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var pid = $('prePaciente').value;
    if (!pid) { aviso('preMsg', 'Elige un paciente.', true); return; }
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    var r = await sb.from('presupuestos').insert({ paciente_id: +pid }).select('id').single();
    boton.disabled = false;
    if (r.error) { aviso('preMsg', traducir(r.error), true); return; }
    abrir(r.data.id);
  });

  // Edición de líneas
  $('preItems').addEventListener('input', function (e) {
    var inp = e.target.closest('[data-f]');
    if (!inp) return;
    var it = items[+inp.closest('tr').dataset.i];
    var f = inp.dataset.f;
    if (f === 'cantidad') it.cantidad = Math.max(parseInt(inp.value, 10) || 1, 1);
    else if (f === 'precio') it.precio = Math.max(Number(inp.value) || 0, 0);
    else it[f] = inp.value;
    // Al elegir un tratamiento del catálogo se propone su precio (el activo del tipo elegido, o el del catálogo)
    if (f === 'tratamiento') {
      var c = tratamientoDe(inp.value);
      if (c && c.activo) {
        it.precio = precioDe(c);
        inp.closest('tr').querySelector('[data-f=precio]').value = it.precio.toFixed(2);
      }
      var tag = inp.closest('td').querySelector('[data-tipo-tag]');
      if (tag) tag.textContent = tipoDeNombre(inp.value);
    }
    cambios = true;
    pintarTotales();
    var a = $('preWa'); if (a) a.href = mensajeWhatsApp();
  });
  $('preItems').addEventListener('click', function (e) {
    var b = e.target.closest('[data-quitar]');
    if (!b) return;
    items.splice(+b.dataset.quitar, 1);
    cambios = true;
    pintarEditor();
  });
  $('preItems').addEventListener('change', async function (e) {
    var c = e.target.closest('[data-realizado]');
    if (!c) return;
    c.disabled = true;
    var r = await sb.rpc('marcar_realizado', { p_item: +c.dataset.realizado, p_realizado: c.checked });
    if (r.error) { c.checked = !c.checked; c.disabled = false; aviso('preEdMsg', traducir(r.error), true); return; }
    aviso('preEdMsg', c.checked ? 'Tratamiento marcado como realizado. Su costo ya cuenta en el estado de cuenta del paciente.' : 'Se quitó la marca de realizado.');
    await abrir(actual.id);
  });
  $('preAgregar').addEventListener('click', function () {
    items.push({ tratamiento: '', pieza: '', cantidad: 1, precio: 0 });
    cambios = true;
    pintarEditor();
    var filas = $('preItems').querySelectorAll('[data-f=tratamiento]');
    if (filas.length) filas[filas.length - 1].focus();
  });
  // Agregar por tipo de procedimiento: elige el tipo, luego el procedimiento, y se agrega con su precio
  $('preTipoProc').addEventListener('change', pintarProcedimientos);
  $('preAgregarProc').addEventListener('click', function () {
    var nombre = $('preProc').value;
    if (!nombre) { aviso('preEdMsg', 'Elige un procedimiento de la lista.', true); $('preProc').focus(); return; }
    var t = tratamientoDe(nombre), linea = { tratamiento: nombre, pieza: '', cantidad: 1, precio: t ? precioDe(t) : 0 };
    var vacia = items.length && !items[items.length - 1].tratamiento.trim() ? items.length - 1 : -1;
    if (vacia >= 0) items[vacia] = linea; else items.push(linea);   // usa la línea en blanco si la hay
    cambios = true;
    pintarEditor();
    aviso('preEdMsg', t ? '«' + nombre + '» agregado con precio ' + TIPOS[tipoActual()] + '. Pulsa «Guardar».'
      : '«' + nombre + '» agregado sin precio: escríbelo en la línea o defínelo en Precios y paquetes → Precios.');
    $('preProc').value = '';
  });
  // Al cambiar el tipo de precio se actualizan los precios de los tratamientos del catálogo
  $('preTipo').addEventListener('change', function () {
    pintarProcedimientos(); pintarSugerencias();
    var n = 0;
    items.forEach(function (it) {
      var t = tratamientoDe(it.tratamiento);
      if (t) { it.precio = precioDe(t); n++; }
    });
    cambios = true;
    pintarEditor();
    pintarProcedimientos();
    aviso('preEdMsg', n ? 'Se aplicaron los precios «' + TIPOS[tipoActual()] + '» a ' + n + (n === 1 ? ' tratamiento' : ' tratamientos') + '. Pulsa «Guardar».' : 'Tipo de precio cambiado. Pulsa «Guardar».');
    var a = $('preWa'); if (a) a.href = mensajeWhatsApp();
  });
  // Plan de pago: se elige tocando la fila de la tabla
  $('preCuotasTabla').addEventListener('click', function (e) {
    var m = e.target.closest('[data-pre-cuota-modo]');
    if (m && editable()) { $('preSinRecargo').value = m.dataset.preCuotaModo === 'sin' ? '1' : ''; cambios = true; pintarCuotas(); var a2 = $('preWa'); if (a2) a2.href = mensajeWhatsApp(); return; }
    var f = e.target.closest('[data-pre-cuota]');
    if (!f || !editable()) return;
    $('preCuotas').value = f.dataset.preCuota;
    cambios = true;
    pintarCuotas();
    var g = $('preCuotasTabla').querySelector('[data-pre-cuota="' + f.dataset.preCuota + '"]'); if (g) g.focus({ preventScroll: true });
    var a = $('preWa'); if (a) a.href = mensajeWhatsApp();
  });
  $('preCuotasTabla').addEventListener('keydown', function (e) {
    var f = e.target.closest('[data-pre-cuota]');
    if (f && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); f.click(); }
  });
  ['preDescuento', 'preNotas', 'preForma', 'preCitas'].forEach(function (id) {
    $(id).addEventListener(id === 'preForma' ? 'change' : 'input', function () {
      cambios = true;
      pintarTotales();
      var a = $('preWa'); if (a) a.href = mensajeWhatsApp();
    });
  });

  $('preAcciones').addEventListener('click', async function (e) {
    // Enviar por WhatsApp: el enlace se abre solo; aquí se guarda y se marca como enviado
    if (e.target.closest('#preWa')) {
      if (actual.estado === 'borrador') cambiarEstado('enviado');
      else if (editable() && cambios) guardar();
      return;
    }
    var b = e.target.closest('[data-accion]');
    if (!b) return;
    var accion = b.dataset.accion;
    if (accion === 'borrar') {
      if (!pedirConfirmacion(b)) return;
      b.disabled = true;
      var r = await sb.from('presupuestos').delete().eq('id', actual.id).select('id');
      if (r.error || !r.data || !r.data.length) { b.disabled = false; aviso('preEdMsg', r.error ? traducir(r.error) : 'No se pudo borrar.', true); return; }
      cambios = false;
      await volverALista();
      aviso('preMsg', 'Presupuesto borrado.');
      return;
    }
    b.disabled = true;
    if (accion === 'guardar') {
      aviso('preEdMsg', 'Guardando…');
      if (await guardar()) { await abrir(actual.id); aviso('preEdMsg', 'Presupuesto guardado.'); }
      else b.disabled = false;
      return;
    }
    var textos = { aprobado: 'Presupuesto aprobado. Marca cada tratamiento como realizado cuando se haga.', rechazado: 'Presupuesto marcado como no aprobado.', borrador: 'El presupuesto volvió a Activo y se puede editar.' };
    if (await cambiarEstado(accion)) aviso('preEdMsg', textos[accion]);
    else b.disabled = false;
  });

  $('catForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    var r = await sb.from('tratamientos').insert({ nombre: $('catNombre').value.trim(), precio: redondear($('catPrecio').value) });
    boton.disabled = false;
    if (r.error) { aviso('catMsg', traducir(r.error), true); return; }
    this.reset();
    aviso('catMsg', 'Tratamiento agregado al catálogo.');
    $('catNombre').focus();
    cargarCatalogo();
  });
  $('catBody').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-guardar-cat]');
    if (!b) return;
    var fila = b.closest('tr');
    var datos = {
      nombre: fila.querySelector('[data-c=nombre]').value.trim(),
      precio: redondear(fila.querySelector('[data-c=precio]').value),
      activo: fila.querySelector('[data-c=activo]').checked
    };
    if (tiposCat.length) { var tp = fila.querySelector('[data-c=tipo]').value; datos.tipo_id = tp ? +tp : null; }
    if (!datos.nombre) { aviso('catMsg', 'El nombre no puede quedar vacío.', true); return; }
    b.disabled = true;
    var r = await sb.from('tratamientos').update(datos).eq('id', b.dataset.guardarCat).select('id');
    b.disabled = false;
    if (r.error || !r.data || !r.data.length) { aviso('catMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return; }
    aviso('catMsg', 'Cambios guardados: ' + datos.nombre + '.');
    cargarCatalogo();
  });

  // Para abrir un presupuesto desde otra sección (p. ej. el odontograma del expediente)
  window.PD_PRESUPUESTOS = {
    abrir: async function (id) {
      if (!catalogo.length) await cargarCatalogo();
      await abrir(id);
    }
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('preLista').hidden) cargar(); },
    limpiar: function () {
      lista = []; pacientes = []; actual = null; items = []; cambios = false;
      $('preBody').innerHTML = ''; $('preItems').innerHTML = ''; $('prePaciente').innerHTML = '';
      ver('preLista');
    }
  });
})();
