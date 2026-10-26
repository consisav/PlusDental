// Plus Dental — Reportes > Constancia médica.
// Toma la cita, la nota de visita y los tratamientos del día del paciente, redacta la constancia en lenguaje formal
// (editable antes de imprimir), la registra con número CM-AÑO-correlativo y la imprime con logo, firma y sello.
(function () {
  var sb = window.PD_SB;
  if (!sb || !document.getElementById('admRepConstancia')) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function sumar(f, n) { var d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function aviso(t, error) { var m = $('cmMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fechaLarga(f) { var d = new Date(f + 'T12:00:00'); return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
  // Números en letras (para la fecha formal del cierre)
  var UNI = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  var DEC = { 3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa' };
  function letras(n) { if (n < 30) return UNI[n]; var d = Math.floor(n / 10), u = n % 10; return DEC[d] + (u ? ' y ' + (u === 1 ? 'un' : UNI[u]) : ''); }
  function anioLetras(a) { var r = a - 2000; return 'dos mil' + (r ? ' ' + (r === 1 ? 'uno' : r < 30 ? UNI[r].replace(/ún$/, 'uno') : letras(r).replace(/ un$/, ' uno')) : ''); }
  function cierreFormal(f) { var d = new Date(f + 'T12:00:00'), n = d.getDate(); return 'a ' + (n === 1 ? 'un día' : 'los ' + letras(n) + ' días') + ' del mes de ' + MESES[d.getMonth()] + ' de ' + anioLetras(d.getFullYear()); }
  function edad(f) { if (!f) return ''; var n = new Date(f + 'T12:00:00'), h = new Date(), a = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--; return a + ' años'; }
  function sumarHora(h, min) { if (!h) return ''; var p = h.split(':'), t = (+p[0]) * 60 + (+p[1]) + min; return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2); }

  var pacientes = [], dentistas = [], paciente = null, historial = [], textoManual = false;

  $('admRepConstancia').innerHTML =
    '<div class="adm-pane-head"><h3 class="adm-h">Constancia médica</h3></div>' +
    '<p class="dlg-msg">Elige el paciente y la fecha de atención: se completan la hora, el diagnóstico y el tratamiento con la cita, la nota de visita y los tratamientos de ese día. Revisa el texto y pulsa «Grabar e imprimir».</p>' +
    '<div class="cm-layout"><form id="cmForm" class="cm-form" novalidate>' +
    '<fieldset class="pos-sec"><legend>Datos de la atención</legend><div class="exp-form rc-g4">' +
    '<label class="rc-span2">Paciente *<select id="cmPaciente"><option value="">Cargando pacientes…</option></select></label>' +
    '<label>Fecha de atención *<input id="cmFecha" type="date"></label>' +
    '<label>Odontólogo que firma<select id="cmDentista"><option value="">Sin asignar</option></select></label>' +
    '<label>Hora de entrada<input id="cmEntrada" type="time" step="300"></label>' +
    '<label>Hora de salida<input id="cmSalida" type="time" step="300"></label>' +
    '<label>Días de reposo<input id="cmReposo" type="number" min="0" max="60" step="1" value="0" inputmode="numeric"></label>' +
    '<label>Reposo desde<input id="cmDesde" type="date"></label>' +
    '<label class="rc-span2">Diagnóstico<input id="cmDiag" maxlength="300" placeholder="Ej.: pulpitis irreversible en pieza 36"></label>' +
    '<label class="rc-span2">Tratamiento realizado<input id="cmTrat" maxlength="300" placeholder="Ej.: tratamiento de conductos"></label>' +
    '<label class="rc-span2">Dirigida a<input id="cmDirigida" maxlength="150" value="A quien interese"></label>' +
    '<p id="cmFuente" class="rc-span2 dlg-msg"></p>' +
    '</div></fieldset>' +
    '<fieldset class="pos-sec"><legend>Texto de la constancia</legend>' +
    '<textarea id="cmTexto" class="cm-texto" rows="9" maxlength="3000"></textarea>' +
    '<div class="cm-acc"><button type="button" id="cmRedactar" class="adm-btn">Volver a redactar</button><button type="submit" id="cmGrabar" class="dlg-submit">Grabar e imprimir / PDF</button></div>' +
    '</fieldset></form>' +
    '<aside class="cm-hist"><span class="pos-lbl">Constancias del paciente</span><div id="cmHist"><p class="dlg-msg">Elige un paciente.</p></div></aside></div>' +
    '<p id="cmMsg" class="dlg-msg" role="status"></p>';

  async function cargar() {
    var rs = await Promise.all([
      sb.from('pacientes').select('id,nombre,dpi,fecha_nacimiento,telefono,dentista_id,estado').order('nombre'),
      sb.from('dentistas').select('id,nombre,colegiado,rol_sala,estado').order('nombre')
    ]);
    pacientes = rs[0].error ? [] : rs[0].data; dentistas = rs[1].error ? [] : rs[1].data;
    var sel = $('cmPaciente').value;
    $('cmPaciente').innerHTML = '<option value="">Elegir paciente…</option>' + pacientes.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + (p.dpi ? ' · DPI ' + esc(p.dpi) : '') + '</option>'; }).join('');
    $('cmPaciente').value = sel;
    $('cmDentista').innerHTML = '<option value="">Sin asignar</option>' + dentistas.filter(function (d) { return d.estado === 'activo'; }).map(function (d) { return '<option value="' + d.id + '">' + esc(d.nombre) + (d.colegiado ? ' · Col. ' + esc(d.colegiado) : '') + '</option>'; }).join('');
    if (!$('cmFecha').value) $('cmFecha').value = hoy();
  }
  function principal() { var d = dentistas.filter(function (x) { return x.rol_sala === 'principal' && x.estado === 'activo'; })[0] || dentistas.filter(function (x) { return x.estado === 'activo'; })[0]; return d ? d.id : null; }

  // Datos del día: cita (horas), nota de visita (diagnóstico) y tratamientos (en proceso o finalizados esa fecha)
  async function datosDelDia() {
    paciente = pacientes.filter(function (p) { return p.id === +$('cmPaciente').value; })[0] || null;
    if (!paciente) { $('cmHist').innerHTML = '<p class="dlg-msg">Elige un paciente.</p>'; return; }
    var f = $('cmFecha').value || hoy();
    $('cmFuente').textContent = 'Buscando la información de ese día…';
    var rs = await Promise.all([
      sb.from('citas').select('hora,servicio,dentista_id,estado').eq('paciente_id', paciente.id).eq('fecha', f).neq('estado', 'cancelada').order('hora'),
      sb.from('notas_visita').select('texto').eq('paciente_id', paciente.id).eq('fecha', f),
      sb.from('presupuesto_items').select('tratamiento,pieza,estado,estado_fecha,realizado_en,presupuesto:presupuestos!inner(paciente_id)').eq('presupuesto.paciente_id', paciente.id),
      sb.from('constancias').select('*').eq('paciente_id', paciente.id).order('creada', { ascending: false })
    ]);
    var citas = rs[0].error ? [] : rs[0].data, notas = rs[1].error ? [] : rs[1].data;
    var trat = rs[2].error ? [] : rs[2].data.filter(function (i) { return i.estado !== 'eliminado' && ((i.estado_fecha && iso(new Date(i.estado_fecha)) === f) || i.realizado_en === f); });
    historial = rs[3].error ? null : rs[3].data;
    var c = citas[0], fuentes = [];
    if (c) { $('cmEntrada').value = String(c.hora).slice(0, 5); $('cmSalida').value = sumarHora(String(c.hora).slice(0, 5), 60); fuentes.push('cita de las ' + String(c.hora).slice(0, 5)); }
    else { $('cmEntrada').value = ''; $('cmSalida').value = ''; }
    $('cmDentista').value = String((c && c.dentista_id) || paciente.dentista_id || principal() || '');
    $('cmDiag').value = notas.length ? notas.map(function (n) { return n.texto; }).join('; ').slice(0, 300) : '';
    if (notas.length) fuentes.push('nota de visita');
    $('cmTrat').value = trat.length ? trat.map(function (i) { return i.tratamiento + (i.pieza ? ' en pieza ' + i.pieza : ''); }).join(', ').slice(0, 300) : (c ? c.servicio || '' : '');
    if (trat.length) fuentes.push(trat.length + (trat.length === 1 ? ' tratamiento' : ' tratamientos'));
    if (!$('cmDesde').value || $('cmDesde').dataset.auto === '1') { $('cmDesde').value = f; $('cmDesde').dataset.auto = '1'; }
    $('cmFuente').textContent = fuentes.length ? 'Completado con: ' + fuentes.join(', ') + '. Puedes corregir cualquier dato.' : 'No hay cita, nota de visita ni tratamientos registrados ese día: completa los datos a mano.';
    textoManual = false; redactar();
    pintarHistorial();
  }

  // Primera letra en minúscula dentro de la frase (salvo siglas, p. ej. «ATM»)
  function minus(t) { return /^[A-ZÁÉÍÓÚÑ]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); }
  function redactar() {
    if (!paciente) { $('cmTexto').value = ''; return; }
    var p = paciente, f = $('cmFecha').value || hoy(), d = dentistas.filter(function (x) { return x.id === +$('cmDentista').value; })[0];
    var ent = $('cmEntrada').value, sal = $('cmSalida').value, diag = $('cmDiag').value.trim(), trat = $('cmTrat').value.trim();
    var dias = Math.max(0, parseInt($('cmReposo').value, 10) || 0), desde = $('cmDesde').value || f;
    var t = 'El infrascrito Cirujano Dentista' + (d ? ', ' + d.nombre + (d.colegiado ? ', colegiado activo número ' + d.colegiado : '') : '') +
      ', hace constar que el(la) paciente ' + p.nombre + (p.fecha_nacimiento ? ', de ' + edad(p.fecha_nacimiento) + ' de edad' : '') +
      (p.dpi ? ', quien se identifica con Documento Personal de Identificación (DPI) número ' + p.dpi : '') +
      ', fue atendido(a) en la clínica Plus Dental el día ' + fechaLarga(f) +
      (ent && sal ? ', de las ' + ent + ' a las ' + sal + ' horas' : ent ? ', a partir de las ' + ent + ' horas' : '') +
      (diag ? ', con diagnóstico de ' + minus(diag.replace(/\.$/, '')) : '') +
      (trat ? ', realizándosele ' + minus(trat.replace(/\.$/, '')) : '') + '.';
    if (dias > 0) t += '\n\nPor el procedimiento realizado se recomienda reposo de ' + (dias === 1 ? 'un (1) día' : dias + ' días') + ', del ' + fechaLarga(desde) + ' al ' + fechaLarga(sumar(desde, dias - 1)) + '.';
    else t += '\n\nPuede reincorporarse a sus actividades habituales siguiendo las indicaciones dadas por su odontólogo.';
    t += '\n\nY para los usos que al(a la) interesado(a) convengan, se extiende, firma y sella la presente en la Ciudad de Guatemala, ' + cierreFormal(hoy()) + '.';
    $('cmTexto').value = t;
  }

  function pintarHistorial() {
    if (historial === null) { $('cmHist').innerHTML = '<p class="dlg-msg">Falta ejecutar en Supabase el script actualizado (supabase.sql) para registrar las constancias.</p>'; return; }
    $('cmHist').innerHTML = historial.length ? historial.map(function (c) {
      return '<div class="cm-item"><b>' + esc(c.numero) + '</b><span>Atención ' + fechaLarga(c.fecha) + (c.reposo_dias ? ' · reposo ' + c.reposo_dias + (c.reposo_dias === 1 ? ' día' : ' días') : '') + '</span>' +
        '<small>Emitida por ' + esc(c.creada_por || '') + ' · ' + fechaHora(c.creada) + '</small><button type="button" class="adm-btn" data-cm-reimp="' + c.id + '">Reimprimir</button></div>';
    }).join('') : '<p class="dlg-msg">Este paciente aún no tiene constancias emitidas.</p>';
  }

  async function imprimir(c) {
    var imp = window.PD_IMPRESION;
    if (!imp) return;
    var d = dentistas.filter(function (x) { return x.id === c.dentista_id; })[0];
    var firma = window.PD_FIRMA ? await window.PD_FIRMA.cargar(c.dentista_id, d && d.nombre) : null;
    var parrafos = String(c.texto).split(/\n\s*\n/).map(function (x) { return '<p style="margin:0 0 14px;text-align:justify;text-indent:32px">' + esc(x.trim()) + '</p>'; }).join('');
    imp.imprimir(imp.encabezado('Constancia médica · ' + esc(c.numero || '')) +
      '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:15px;line-height:1.85;color:#0B2B40;padding:6px 10px 0">' +
      '<div style="text-align:center;font-family:Manrope,system-ui,sans-serif;font-size:20px;font-weight:800;letter-spacing:.18em;margin:10px 0 24px">CONSTANCIA MÉDICA</div>' +
      '<p style="margin:0 0 16px;font-weight:700">' + esc(c.dirigida || 'A quien interese') + ':</p>' + parrafos + '</div>' +
      '<div style="display:flex;justify-content:center;margin-top:46px">' + (firma ? window.PD_FIRMA.bloque(firma, { ancho: 320 }) : '<div style="width:300px;border-top:1.5px solid #0B2B40;padding-top:6px;text-align:center">' + esc(d ? 'Dr(a). ' + d.nombre : 'Cirujano Dentista') + '<br><small>Firma y sello</small></div>') + '</div>' +
      '<p style="margin-top:34px;font-size:11px;color:#5A6D7A;text-align:center;font-family:Manrope,system-ui,sans-serif">Constancia ' + esc(c.numero || '') + ' · emitida por ' + esc(c.creada_por || '') + ' el ' + fechaHora(c.creada) + ' · Para verificarla comuníquese con Plus Dental al +502 3756-5739.</p></div>');
  }

  async function grabar(e) {
    e.preventDefault();
    if (!paciente) { aviso('Elige el paciente.', true); $('cmPaciente').focus(); return; }
    var texto = $('cmTexto').value.trim();
    if (!$('cmFecha').value || !texto) { aviso('Completa la fecha y el texto de la constancia.', true); return; }
    var dias = Math.max(0, parseInt($('cmReposo').value, 10) || 0), desde = dias ? ($('cmDesde').value || $('cmFecha').value) : null;
    var datos = { paciente_id: paciente.id, dentista_id: $('cmDentista').value ? +$('cmDentista').value : null, fecha: $('cmFecha').value,
      hora_entrada: $('cmEntrada').value || null, hora_salida: $('cmSalida').value || null, diagnostico: $('cmDiag').value.trim() || null, tratamiento: $('cmTrat').value.trim() || null,
      reposo_dias: dias, reposo_desde: desde, reposo_hasta: dias ? sumar(desde, dias - 1) : null, dirigida: $('cmDirigida').value.trim() || 'A quien interese', texto: texto };
    $('cmGrabar').disabled = true;
    aviso('Grabando…');
    var r = await sb.from('constancias').insert(datos).select('*').single();
    $('cmGrabar').disabled = false;
    if (r.error) {
      var falta = /constancias/.test(r.error.message || '') && /does not exist|could not find|schema cache/i.test(r.error.message || '');
      aviso(falta ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para registrar las constancias. Se imprime sin número.' : (r.error.message || 'No se pudo grabar.'), true);
      if (falta) imprimir(Object.assign({ numero: 'sin registrar', creada: new Date().toISOString(), creada_por: (window.PD_SESION && window.PD_SESION.usuario()) || '' }, datos));
      return;
    }
    historial = [r.data].concat(historial || []);
    pintarHistorial();
    aviso('Constancia ' + r.data.numero + ' registrada.');
    imprimir(r.data);
  }

  // ---------- Eventos ----------
  $('cmPaciente').addEventListener('change', datosDelDia);
  $('cmFecha').addEventListener('change', function () { $('cmDesde').dataset.auto = '1'; datosDelDia(); });
  $('cmDesde').addEventListener('change', function () { this.dataset.auto = '0'; });
  ['cmEntrada', 'cmSalida', 'cmReposo', 'cmDesde', 'cmDiag', 'cmTrat', 'cmDentista'].forEach(function (id) {
    $(id).addEventListener('input', function () { if (!textoManual) redactar(); });
    $(id).addEventListener('change', function () { if (!textoManual) redactar(); });
  });
  $('cmTexto').addEventListener('input', function () { textoManual = true; });
  $('cmRedactar').addEventListener('click', function () { textoManual = false; redactar(); });
  $('cmForm').addEventListener('submit', grabar);
  $('cmHist').addEventListener('click', function (e) { var b = e.target.closest('[data-cm-reimp]'); if (b) imprimir((historial || []).filter(function (c) { return c.id === +b.dataset.cmReimp; })[0]); });
  if ($('tabRepConstancia')) $('tabRepConstancia').addEventListener('click', function () { if (!pacientes.length) cargar(); });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { cargar(); },
    limpiar: function () { pacientes = []; dentistas = []; paciente = null; historial = []; $('cmTexto').value = ''; $('cmHist').innerHTML = ''; aviso(''); }
  });
})();
