// Plus Dental — Expediente > Recetas: recetas médicas del paciente por fecha de atención / número de visita.
// Número automático (REC-AÑO-correlativo), visita sugerida según citas atendidas y notas de visita,
// medicamentos con dosis, frecuencia y duración. Se puede modificar e imprimir con logo y firma del médico.
(function () {
  var sb = window.PD_SB;
  if (!sb || !document.getElementById('fRecetas')) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaLarga(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function edad(f) {
    if (!f) return '';
    var n = new Date(f + 'T12:00:00'), h = new Date(), a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a + ' años';
  }
  function aviso(t, error) { var m = $('rcMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/recetas|receta_items|guardar_receta|visita_sugerida/.test(m) && /does not exist|could not find/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las recetas.';
    if (/row-level security|permission denied|No tienes permiso/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  var ESTADOS_CITA = { pendiente: 'Programado', confirmada: 'Confirmado', reprogramada: 'Reprogramado', atendida: 'Atendido' };

  // Sugerencias editables al elegir un medicamento frecuente en odontología (el médico decide la indicación final)
  var FRECUENTES = {
    'Ibuprofeno 400 mg, tabletas': ['1 tableta', 'Cada 8 horas', '3 días'],
    'Ibuprofeno 600 mg, tabletas': ['1 tableta', 'Cada 8 horas', '3 días'],
    'Paracetamol 500 mg, tabletas': ['1 a 2 tabletas', 'Cada 6 horas', '3 días'],
    'Naproxeno sódico 550 mg, tabletas': ['1 tableta', 'Cada 12 horas', '3 días'],
    'Ketorolaco 10 mg, tabletas': ['1 tableta', 'Cada 8 horas', '2 días'],
    'Amoxicilina 500 mg, cápsulas': ['1 cápsula', 'Cada 8 horas', '7 días'],
    'Amoxicilina + ácido clavulánico 875/125 mg, tabletas': ['1 tableta', 'Cada 12 horas', '7 días'],
    'Clindamicina 300 mg, cápsulas': ['1 cápsula', 'Cada 6 horas', '7 días'],
    'Azitromicina 500 mg, tabletas': ['1 tableta', 'Una vez al día', '3 días'],
    'Metronidazol 500 mg, tabletas': ['1 tableta', 'Cada 8 horas', '7 días'],
    'Clorhexidina 0.12 %, enjuague bucal': ['15 ml (enjuagar 30 segundos)', 'Cada 12 horas', '10 días'],
    'Benzocaína 20 %, gel tópico': ['Aplicar en la zona', 'Cada 8 horas si hay molestia', '3 días'],
    'Fluoruro de sodio 5000 ppm, pasta dental': ['Cepillado', 'Una vez al día, antes de dormir', 'Uso continuo']
  };
  // Alergias registradas en el expediente contra medicamentos de la receta (aviso, no bloquea)
  var CRUCES = [
    [/penicil/i, /penicil|amoxicil|ampicil|dicloxacil|clavul/i, 'penicilinas'],
    [/aine|ibuprofen|antiinflamatori|aspirina|acido acetil/i, /ibuprofen|naproxen|ketorolac|diclofenac|aspirina|acido acetil|meloxicam/i, 'antiinflamatorios (AINE)'],
    [/sulfa/i, /sulfa|trimetoprim/i, 'sulfas'],
    [/clindamic/i, /clindamic/i, 'clindamicina'],
    [/metronidaz/i, /metronidaz/i, 'metronidazol'],
    [/paracetamol|acetaminof/i, /paracetamol|acetaminof/i, 'paracetamol'],
    [/clorhexid/i, /clorhexid/i, 'clorhexidina'],
    [/azitromic|macrol|eritromic|claritromic/i, /azitromic|eritromic|claritromic/i, 'macrólidos'],
    [/lidoca|anest/i, /lidoca|benzoca|anest/i, 'anestésicos locales']
  ];
  function alertasAlergia(meds) {
    var al = paciente && paciente.alergias ? paciente.alergias.normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
    if (!al) return [];
    var r = [];
    meds.forEach(function (m) {
      var t = m.normalize('NFD').replace(/[̀-ͯ]/g, '');
      CRUCES.forEach(function (c) { if (c[2] && c[0].test(al) && c[1].test(t)) r.push('«' + m + '»: el paciente es alérgico a ' + c[2] + '.'); });
    });
    return r;
  }
  function revisarAlergias() {
    if (!$('rcAlerta')) return [];
    var meds = [].map.call($('rcMeds').querySelectorAll('[data-c="medicamento"]'), function (i) { return i.value.trim(); }).filter(Boolean);
    var a = alertasAlergia(meds);
    $('rcAlerta').hidden = !a.length;
    $('rcAlerta').innerHTML = a.length ? '<b>Atención · posible alergia</b><br>' + a.map(esc).join('<br>') : '';
    return a;
  }
  var FRECUENCIAS = ['Cada 4 horas', 'Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Una vez al día', 'Una vez al día, antes de dormir', 'Solo si hay dolor', 'Dosis única'];
  var DURACIONES = ['Dosis única', '2 días', '3 días', '5 días', '7 días', '10 días', '14 días', 'Hasta terminar el tratamiento', 'Uso continuo'];

  var paciente = null, recetas = [], dentistas = [], citasPac = [], elegida = null, editando = null, visitaAMano = false, proximaAMano = false;

  function nombreDentista(id) { var d = dentistas.filter(function (x) { return x.id === id; })[0]; return d ? d.nombre : ''; }
  function dentistaDe(id) { return dentistas.filter(function (x) { return x.id === id; })[0] || null; }
  function medicoPorDefecto() {
    if (paciente && paciente.dentista_id && dentistaDe(paciente.dentista_id)) return paciente.dentista_id;
    var d = dentistas.filter(function (x) { return x.rol_sala === 'principal' && x.estado === 'activo'; })[0] || dentistas.filter(function (x) { return x.estado === 'activo'; })[0];
    return d ? d.id : null;
  }
  function textoProxima(r) { return r.proxima_cita ? fechaLarga(r.proxima_cita) + (r.proxima_hora ? ' · ' + String(r.proxima_hora).slice(0, 5) : '') : 'Sin próxima cita'; }
  // Próxima cita del paciente después de una fecha (programada, confirmada o reprogramada)
  function citaSiguiente(f) {
    return citasPac.filter(function (c) { return c.fecha > f && c.estado !== 'atendida'; })
      .sort(function (a, b) { return (a.fecha + a.hora) < (b.fecha + b.hora) ? -1 : 1; })[0] || null;
  }
  function registroHtml(r, conBoton) {
    var nueva = !r;
    return '<div class="rc-registro">' +
      '<div><span>Fecha y hora de grabación</span>' + (nueva ? 'Se registra al grabar' : fechaHora(r.creada)) + '</div>' +
      '<div><span>Usuario que graba</span>' + esc(nueva ? ((window.PD_SESION && window.PD_SESION.usuario()) || 'Sin usuario') : (r.creada_por || 'Sin usuario')) + '</div>' +
      '<div><span>Última modificación</span>' + (r && r.modificada ? fechaHora(r.modificada) + ' · ' + esc(r.modificada_por || '') : '—') + '</div>' +
      (conBoton ? '<div class="rc-registro-btn"><button type="button" class="adm-btn adm-primary" data-rc-modificar>Modificar receta</button></div>' : '') +
      '</div>';
  }
  function textoCita(c) { return fechaCorta(c.fecha) + ' · ' + String(c.hora || '').slice(0, 5) + ' · ' + (c.servicio || '') + ' (' + (ESTADOS_CITA[c.estado] || c.estado) + ')'; }

  async function cargar(p) {
    paciente = p; recetas = []; elegida = null; editando = null;
    if (!p) return;
    aviso('');
    $('rcLista').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    $('rcPanel').innerHTML = '';
    var rs = await Promise.all([
      sb.from('recetas').select('*,receta_items(*)').eq('paciente_id', p.id).order('fecha', { ascending: false }).order('id', { ascending: false }),
      dentistas.length ? Promise.resolve({ data: dentistas }) : sb.from('dentistas').select('id,nombre,colegiado,rol_sala,estado,especialidades').order('nombre'),
      sb.from('citas').select('id,fecha,hora,servicio,estado,dentista_id').eq('paciente_id', p.id).neq('estado', 'cancelada').order('fecha', { ascending: false }).limit(60)
    ]);
    if (paciente !== p) return;
    if (rs[0].error) { $('rcLista').innerHTML = ''; aviso(traducir(rs[0].error), true); return; }
    recetas = rs[0].data.map(function (r) { r.receta_items = (r.receta_items || []).sort(function (a, b) { return a.orden - b.orden; }); return r; });
    if (!rs[1].error) dentistas = rs[1].data;
    citasPac = rs[2].error ? [] : rs[2].data;
    elegida = recetas[0] ? recetas[0].id : null;
    pintar();
  }

  function pintarLista() {
    $('rcLista').innerHTML = recetas.length ? recetas.map(function (r) {
      var n = r.receta_items.length;
      return '<button type="button" class="rc-item" data-rc="' + r.id + '" aria-pressed="' + (r.id === elegida && !editando) + '">' +
        '<b>' + esc(r.numero || 'Receta') + '</b><span>' + fechaCorta(r.fecha) + (r.visita_numero ? ' · Visita ' + r.visita_numero : '') + '</span>' +
        '<small>' + n + (n === 1 ? ' medicamento' : ' medicamentos') + '</small></button>';
    }).join('') : '<p class="rc-vacia">Este paciente aún no tiene recetas.</p>';
  }

  function datosPaciente() {
    var p = paciente;
    return '<div class="rc-pac"><div><span>Paciente</span><b>' + esc(p.nombre) + '</b></div>' +
      '<div><span>DPI</span>' + esc(p.dpi || '—') + '</div>' +
      '<div><span>Edad</span>' + esc(edad(p.fecha_nacimiento) || '—') + '</div>' +
      '<div><span>Teléfono</span>' + esc(p.telefono || '—') + '</div></div>' +
      (p.alergias ? '<p class="rc-alergia"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
      (p.medicamentos ? '<p class="rc-nota-pac"><b>Medicamentos que ya toma:</b> ' + esc(p.medicamentos) + '</p>' : '');
  }

  function pintarDetalle(r) {
    var med = dentistaDe(r.dentista_id);
    var cita = citasPac.filter(function (c) { return c.id === r.cita_id; })[0];
    $('rcPanel').innerHTML =
      '<div class="rc-head"><div><span class="rc-eti">Receta médica</span><h4>' + esc(r.numero || '') + '</h4></div>' +
      '<div class="rc-acc"><button type="button" class="adm-btn" data-rc-modificar>Modificar</button><button type="button" class="adm-btn adm-primary" data-rc-imprimir>Imprimir receta</button></div></div>' +
      '<div class="rc-datos">' +
      '<div><span>Fecha de atención</span>' + fechaCorta(r.fecha) + '</div>' +
      '<div><span>N.º de visita</span>' + (r.visita_numero || '—') + (cita ? ' <small class="rc-chip">' + esc(ESTADOS_CITA[cita.estado] || '') + '</small>' : '') + '</div>' +
      '<div><span>N.º de receta</span>' + esc(r.numero || '—') + '</div>' +
      '<div><span>Médico</span>' + esc(med ? med.nombre : '—') + '</div>' +
      '<div class="rc-proxima"><span>Próxima cita</span>' + textoProxima(r) + '</div></div>' +
      datosPaciente() +
      '<div class="rc-tabla-wrap"><table class="rc-tabla"><thead><tr><th>#</th><th>Medicamento</th><th>Dosis</th><th>Frecuencia</th><th>Duración</th></tr></thead><tbody>' +
      r.receta_items.map(function (i, k) { return '<tr><td>' + (k + 1) + '</td><td><b>' + esc(i.medicamento) + '</b></td><td>' + esc(i.dosis || '—') + '</td><td>' + esc(i.frecuencia || '—') + '</td><td>' + esc(i.duracion || '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      (r.indicaciones ? '<p class="rc-ind"><b>Indicaciones:</b> ' + esc(r.indicaciones) + '</p>' : '') +
      (cita ? '<p class="rc-reg">Cita de la visita: ' + esc(textoCita(cita)) + '</p>' : '') +
      registroHtml(r, true);
  }

  function filaMed(i) {
    i = i || {};
    return '<div class="rc-med">' +
      '<label class="rc-m1">Medicamento y presentación<input type="text" list="rcListaMed" maxlength="160" data-c="medicamento" value="' + esc(i.medicamento || '') + '" placeholder="Ej.: Ibuprofeno 400 mg, tabletas"></label>' +
      '<label>Dosis<input type="text" maxlength="80" data-c="dosis" value="' + esc(i.dosis || '') + '" placeholder="Ej.: 1 tableta"></label>' +
      '<label>Frecuencia<input type="text" list="rcListaFrec" maxlength="80" data-c="frecuencia" value="' + esc(i.frecuencia || '') + '" placeholder="Ej.: Cada 8 horas"></label>' +
      '<label>Duración<input type="text" list="rcListaDur" maxlength="60" data-c="duracion" value="' + esc(i.duracion || '') + '" placeholder="Ej.: 3 días"></label>' +
      '<button type="button" class="rc-quitar" data-rc-quitar aria-label="Quitar medicamento" title="Quitar">×</button></div>';
  }

  function pintarFormulario(r) {
    var nueva = !r;
    var med = r ? r.dentista_id : medicoPorDefecto();
    var activos = dentistas.filter(function (d) { return d.estado === 'activo' || d.id === med; });
    $('rcPanel').innerHTML =
      '<form id="rcForm" class="rc-form">' +
      '<div class="rc-head"><div><span class="rc-eti">' + (nueva ? 'Nueva receta' : 'Modificar receta') + '</span><h4>' + (nueva ? 'N.º se asigna al grabar' : esc(r.numero)) + '</h4></div></div>' +
      '<div class="exp-form rc-g4">' +
      '<label>Fecha de atención *<input id="rcFecha" type="date" required value="' + (r ? r.fecha : hoy()) + '"></label>' +
      '<label>N.º de visita<input id="rcVisita" type="number" min="1" step="1" inputmode="numeric" value="' + (r && r.visita_numero ? r.visita_numero : '') + '"></label>' +
      '<label class="rc-span2">Cita de la visita<select id="rcCita"><option value="">Sin cita relacionada</option>' +
      citasPac.map(function (c) { return '<option value="' + c.id + '"' + (r && r.cita_id === c.id ? ' selected' : '') + '>' + esc(textoCita(c)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="rc-span2">Médico que receta<select id="rcMedico"><option value="">Sin asignar</option>' +
      activos.map(function (d) { return '<option value="' + d.id + '"' + (d.id === med ? ' selected' : '') + '>' + esc(d.nombre) + (d.colegiado ? ' · Col. ' + esc(d.colegiado) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label>Próxima cita<input id="rcProx" type="date" value="' + (r && r.proxima_cita ? r.proxima_cita : '') + '"></label>' +
      '<label>Hora<input id="rcProxHora" type="time" step="900" value="' + (r && r.proxima_hora ? String(r.proxima_hora).slice(0, 5) : '') + '"></label>' +
      '<p id="rcProxInfo" class="rc-span2 dlg-msg"></p>' +
      '<p id="rcVisitaInfo" class="rc-span2 dlg-msg"></p>' +
      '</div>' +
      datosPaciente() +
      '<section class="rc-ia" aria-labelledby="rcIaTit"><div class="rc-ia-cab"><b id="rcIaTit">✦ Sugerir receta</b><small>Protocolos clínicos o IA que corre en este equipo · sin clave ni costo</small></div>' +
      '<label class="rc-ind-campo">Diagnóstico<textarea id="rcDiag" rows="2" maxlength="1500" placeholder="Ej.: pulpitis irreversible pieza 36, dolor intenso nocturno"></textarea></label>' +
      '<div id="rcIaCtx" class="rc-ia-ctx"></div>' +
      '<div class="rc-ia-acc"><button type="button" class="adm-btn adm-primary" data-rc-protocolo>Sugerir por protocolo</button><button type="button" class="adm-btn" data-rc-local>Generar con IA local (sin clave)</button><span id="rcIaMsg" class="dlg-msg" role="status"></span></div>' +
      '<div id="rcIaRes" class="rc-ia-res" hidden></div></section>' +
      '<div class="rc-meds-head"><span class="pos-lbl">Medicamentos</span><small>Al elegir uno de la lista se sugieren dosis, frecuencia y duración; puedes cambiarlas.</small></div>' +
      '<div id="rcMeds" class="rc-meds">' + ((r && r.receta_items.length ? r.receta_items : [null]).map(filaMed).join('')) + '</div>' +
      '<p id="rcAlerta" class="rc-alergia rc-alerta" role="alert" hidden></p>' +
      '<button type="button" class="adm-btn" data-rc-agregar>+ Agregar medicamento</button>' +
      '<label class="rc-ind-campo">Indicaciones generales<textarea id="rcInd" rows="2" maxlength="600" placeholder="Ej.: tomar con alimentos; no masticar del lado tratado por 24 horas">' + esc(r ? r.indicaciones || '' : '') + '</textarea></label>' +
      registroHtml(r, false) +
      '<div class="rc-pie"><button type="button" class="adm-btn" data-rc-cancelar>Cancelar</button><button type="submit" class="dlg-submit" id="rcGrabar">' + (nueva ? 'Grabar receta' : 'Guardar cambios') + '</button></div>' +
      '</form>';
    visitaAMano = !nueva; proximaAMano = !nueva;
    if (nueva) { sugerirVisita(); sugerirProxima(); }
    contextoIA();
    revisarAlergias();
  }

  // Propone la próxima cita agendada del paciente (si no se cambió a mano)
  function sugerirProxima() {
    if (!$('rcProx')) return;
    var c = citaSiguiente($('rcFecha').value || hoy());
    if (!proximaAMano) { $('rcProx').value = c ? c.fecha : ''; $('rcProxHora').value = c ? String(c.hora || '').slice(0, 5) : ''; }
    $('rcProxInfo').textContent = c ? 'Tomada de la agenda: ' + textoCita(c) + '.' : 'El paciente no tiene otra cita agendada; puedes indicar la fecha sugerida.';
  }
  async function sugerirVisita() {
    var f = $('rcFecha') && $('rcFecha').value;
    if (!f || !paciente) return;
    var r = await sb.rpc('visita_sugerida', { p_paciente: paciente.id, p_fecha: f });
    if (!$('rcVisita')) return;
    if (!r.error && r.data && !visitaAMano) $('rcVisita').value = r.data;
    $('rcVisitaInfo').textContent = r.error ? '' : 'Visita calculada con las citas atendidas o confirmadas y las notas de visita hasta esa fecha.';
  }

  // ---------- Sugerencia con IA ----------
  // Junta lo que la IA toma en cuenta: nota de visita (diagnóstico), tratamientos de la fecha, cita y odontograma
  var ctxIA = null, turnoIA = 0;
  function isoLocal(t) { return t ? iso(new Date(t)) : ''; }
  function hallazgosOdontograma() {
    var v = window.PD_ODONTOGRAMA_ACTUAL ? window.PD_ODONTOGRAMA_ACTUAL() : null;
    if (!v || !v.piezas) return '';
    var NOM = { caries: 'caries', obturacion: 'obturación', corona: 'corona', endodoncia: 'endodoncia', implante: 'implante', extraccion: 'extracción indicada' };
    return Object.keys(v.piezas).map(function (n) {
      var p = v.piezas[n], out = [];
      Object.keys(p.caras || {}).forEach(function (k) { var m = p.caras[k]; if (m.h === 'caries' || m.c === 'r') out.push((NOM[m.h] || m.h) + ' ' + k); });
      Object.keys(p.estados || {}).forEach(function (k) { if (p.estados[k] === 'r') out.push(NOM[k] || k); });
      return out.length ? 'pieza ' + n + ': ' + out.join(', ') : '';
    }).filter(Boolean).join('; ');
  }
  async function contextoIA() {
    if (!$('rcIaCtx') || !paciente) return;
    var f = $('rcFecha').value, turno = ++turnoIA, p = paciente;
    $('rcIaCtx').innerHTML = '<span class="dlg-msg">Revisando la fecha…</span>';
    var rs = await Promise.all([
      sb.from('notas_visita').select('texto').eq('paciente_id', p.id).eq('fecha', f),
      sb.from('presupuesto_items').select('tratamiento,pieza,estado,estado_fecha,realizado_en,presupuesto:presupuestos!inner(paciente_id)').eq('presupuesto.paciente_id', p.id)
    ]);
    if (turno !== turnoIA || !$('rcIaCtx')) return;
    var notas = rs[0].error ? [] : rs[0].data.map(function (n) { return n.texto; });
    var trat = rs[1].error ? [] : rs[1].data.filter(function (i) {
      return i.estado !== 'eliminado' && (isoLocal(i.estado_fecha) === f || i.realizado_en === f);
    }).map(function (i) { return i.tratamiento + (i.pieza ? ' (pieza ' + i.pieza + ')' : ''); });
    var cSel = $('rcCita').value ? citasPac.filter(function (c) { return c.id === +$('rcCita').value; })[0] : citasPac.filter(function (c) { return c.fecha === f; })[0];
    ctxIA = { notas: notas, tratamientos: trat, cita: cSel ? cSel.servicio : '', hallazgos: hallazgosOdontograma() };
    if (!$('rcDiag').value.trim() && notas.length) $('rcDiag').value = notas.join('\n');
    var chips = [];
    trat.forEach(function (t) { chips.push(['Tratamiento: ' + t, '']); });
    if (ctxIA.cita) chips.push(['Cita: ' + ctxIA.cita, '']);
    if (ctxIA.hallazgos) chips.push(['Odontograma: ' + ctxIA.hallazgos, '']);
    if (p.alergias) chips.push(['Alergias: ' + p.alergias, 'mal']);
    if (p.enfermedades) chips.push([p.enfermedades, '']);
    if (p.medicamentos) chips.push(['Toma: ' + p.medicamentos, '']);
    if (edad(p.fecha_nacimiento)) chips.unshift([edad(p.fecha_nacimiento), '']);
    $('rcIaCtx').innerHTML = '<span class="rc-ia-lbl">La IA toma en cuenta (' + fechaCorta(f) + '):</span>' +
      chips.map(function (c) { return '<span class="rc-ia-chip ' + c[1] + '">' + esc(c[0]) + '</span>'; }).join('') +
      (trat.length || notas.length ? '' : '<span class="rc-ia-chip">Sin tratamientos ni nota de visita registrados ese día</span>');
  }
  // Datos del caso para los dos métodos (protocolos e IA local)
  async function datosCaso() {
    if (!ctxIA) await contextoIA();
    var p = paciente, diag = $('rcDiag').value.trim();
    var anios = p.fecha_nacimiento ? parseInt(edad(p.fecha_nacimiento), 10) : null;
    return {
      diagnostico: diag, tratamientos: ctxIA ? ctxIA.tratamientos : [], cita: ctxIA ? ctxIA.cita : '', hallazgos: ctxIA ? ctxIA.hallazgos : '',
      alergias: p.alergias || '', enfermedades: p.enfermedades || '', medicamentos: p.medicamentos || '', edad: anios
    };
  }
  function sinDatos(c) { return !c.diagnostico && !c.tratamientos.length && !c.cita; }

  // ---------- Método 1: protocolos clínicos (sin internet ni clave) ----------
  function protocolo(c) {
    var t = norm([c.diagnostico, c.tratamientos.join(' '), c.cita].join(' '));
    var al = norm(c.alergias), enf = norm(c.enfermedades + ' ' + c.medicamentos);
    var alergiaPen = /penicil|amoxicil|ampicil/.test(al);
    var sinAine = /aine|ibuprofen|naproxen|aspirina|antiinflam|ketorolac|diclofen/.test(al) ||
      /hipertens|presion alta|renal|rinon|ulcera|gastritis|sangrado digest|embaraz|anticoag|warfarin|clopidog|losartan|enalapril|asma/.test(enf);
    var sinParacet = /paracetamol|acetaminof/.test(al);
    var embarazo = /embaraz/.test(enf);
    var meds = [], adv = [], por = [];
    function med(nombre, dosis, frec, dur) { if (!meds.some(function (m) { return m.medicamento === nombre; })) meds.push({ medicamento: nombre, dosis: dosis, frecuencia: frec, duracion: dur }); }
    function analgesico(dias, fuerte) {
      if (!sinAine) med(fuerte ? 'Ibuprofeno 600 mg, tabletas' : 'Ibuprofeno 400 mg, tabletas', '1 tableta', 'Cada 8 horas', dias + ' días');
      else if (!sinParacet) med('Paracetamol 500 mg, tabletas', '1 a 2 tabletas', 'Cada 6 horas', dias + ' días');
      else adv.push('El paciente no puede tomar antiinflamatorios ni paracetamol: elige el analgésico manualmente.');
    }
    function antibiotico() {
      if (alergiaPen) { med('Clindamicina 300 mg, cápsulas', '1 cápsula', 'Cada 6 horas', '7 días'); adv.push('Alergia a penicilina: se usa clindamicina en lugar de amoxicilina.'); }
      else med('Amoxicilina 500 mg, cápsulas', '1 cápsula', 'Cada 8 horas', '7 días');
    }
    var infeccion = /absceso|infecc|pus|celulitis|flemon|pericoronar|fistula|hinchaz/.test(t);
    var cirugia = /extrac|exodon|cordal|tercer molar|cirug|implante|injerto|apicect/.test(t);
    var endo = /endodon|conducto|pulpitis|pulpar|nervio|pulpot|pulpect/.test(t);
    var encias = /gingiv|periodon|encia|sangr|raspado|curetaje|limpieza profunda/.test(t);
    var alveolitis = /alveolitis/.test(t);
    var sensib = /sensib|blanqueam/.test(t);
    var dolor = /dolor|inflam|molest|duele/.test(t);
    if (infeccion) { antibiotico(); analgesico(5, true); por.push('infección'); }
    if (cirugia) {
      analgesico(3, true);
      if (/implante|cordal|tercer molar|injerto/.test(t) && !infeccion) { antibiotico(); por.push('cirugía con riesgo de infección'); }
      med('Clorhexidina 0.12 %, enjuague bucal', '15 ml (enjuagar 30 segundos)', 'Cada 12 horas, desde el día siguiente', '7 días');
      por.push('cirugía o extracción');
    }
    if (alveolitis) { med('Clorhexidina 0.12 %, enjuague bucal', '15 ml (enjuagar 30 segundos)', 'Cada 12 horas', '10 días'); analgesico(5, true); por.push('alveolitis'); }
    if (endo) { analgesico(3, false); por.push('endodoncia o dolor pulpar'); }
    if (encias) { med('Clorhexidina 0.12 %, enjuague bucal', '15 ml (enjuagar 30 segundos)', 'Cada 12 horas', '10 días'); por.push('encías'); }
    if (sensib) { med('Fluoruro de sodio 5000 ppm, pasta dental', 'Cepillado', 'Una vez al día, antes de dormir', 'Uso continuo'); por.push('sensibilidad'); }
    if (dolor && !meds.length) { analgesico(3, false); por.push('dolor o inflamación'); }
    if (c.edad != null && c.edad < 12 && meds.length) adv.push('Paciente de ' + c.edad + ' años: ajusta las dosis a su peso (presentación pediátrica en suspensión).');
    if (embarazo) { adv.push('Embarazo: evita antiinflamatorios y metronidazol en el primer trimestre; confirma con su médico.'); }
    if (sinAine && !/aine|ibuprofen/.test(al) && meds.some(function (m) { return /paracetamol/i.test(m.medicamento); })) adv.push('Se prefirió paracetamol por las condiciones del paciente (presión, riñón, estómago, embarazo o anticoagulantes).');
    var ind = [];
    if (cirugia || alveolitis) ind.push('No enjuagarse ni escupir con fuerza las primeras 24 horas; dieta blanda y fría; no fumar.');
    if (meds.some(function (m) { return /ibuprofeno|clindamicina|amoxicilina/i.test(m.medicamento); })) ind.push('Tomar los medicamentos con alimentos.');
    if (meds.some(function (m) { return /amoxicilina|clindamicina/i.test(m.medicamento); })) ind.push('Completar el antibiótico aunque se sienta mejor.');
    return {
      medicamentos: meds, indicaciones: ind.join(' '), advertencias: adv,
      razonamiento: meds.length ? 'Protocolo por ' + por.join(', ') + '.' : 'Ningún protocolo indica medicamento para este caso (por ejemplo, resina o limpieza sin dolor).'
    };
  }
  function aplicarSugerencia(d, fuente) {
    var meds = d.medicamentos || [];
    $('rcMeds').innerHTML = (meds.length ? meds : [null]).map(filaMed).join('');
    if (d.indicaciones && $('rcInd').value.indexOf(d.indicaciones) < 0) $('rcInd').value = $('rcInd').value.trim() ? $('rcInd').value.trim() + '\n' + d.indicaciones : d.indicaciones;
    $('rcIaMsg').textContent = meds.length ? 'Sugerencia lista: revisa los medicamentos de abajo.' : 'No se sugiere medicamento para este caso.';
    $('rcIaRes').hidden = false;
    $('rcIaRes').innerHTML = '<p class="rc-ia-aviso">Sugerencia ' + fuente + ': el médico debe revisarla y ajustarla antes de grabar.</p>' +
      (d.razonamiento ? '<p>' + esc(d.razonamiento) + '</p>' : '') +
      ((d.advertencias || []).length ? '<ul>' + d.advertencias.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '');
    $('rcGrabar').dataset.confirmado = '0'; $('rcGrabar').textContent = editando === 'nueva' ? 'Grabar receta' : 'Guardar cambios';
    revisarAlergias();
  }
  async function sugerirProtocolo() {
    var c = await datosCaso();
    if (sinDatos(c)) { $('rcIaMsg').textContent = 'Escribe el diagnóstico o registra el tratamiento del día para sugerir la receta.'; $('rcDiag').focus(); return; }
    aplicarSugerencia(protocolo(c), 'por protocolo');
  }

  // ---------- Método 2: IA local en el navegador (WebLLM, sin clave) ----------
  // El modelo se descarga una vez (≈1.8 GB) y queda guardado en este equipo; solo elige medicamentos del catálogo.
  var MODELO_LOCAL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC', motor = null, cargandoMotor = null;
  var avisoMotor = null;
  async function motorLocal(avisar) {
    if (avisar) avisoMotor = avisar;
    if (motor) return motor;
    if (!cargandoMotor) cargandoMotor = (async function () {
      var webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm');
      return webllm.CreateMLCEngine(MODELO_LOCAL, {
        initProgressCallback: function (p) {
          var t = 'Preparando la IA en este equipo… ' + Math.round((p.progress || 0) * 100) + '% (la primera vez descarga el modelo; después es inmediato).';
          if (avisoMotor) avisoMotor(t);
        }
      });
    })();
    try { motor = await cargandoMotor; return motor; } catch (err) { cargandoMotor = null; throw err; }
  }
  function delCatalogo(nombre) {
    var n = norm(nombre), primera = n.split(/[\s,]+/)[0];
    return Object.keys(FRECUENTES).filter(function (k) { return norm(k) === n; })[0] ||
      Object.keys(FRECUENTES).filter(function (k) { return norm(k).split(/[\s,]+/)[0] === primera && primera.length > 4; })[0] || null;
  }
  async function generarLocal(boton) {
    if (!navigator.gpu) { $('rcIaMsg').textContent = 'Este navegador o equipo no permite IA local (necesita WebGPU: Chrome o Edge actualizados en computadora). Usa «Sugerir por protocolo».'; return; }
    var c = await datosCaso();
    if (sinDatos(c)) { $('rcIaMsg').textContent = 'Escribe el diagnóstico o registra el tratamiento del día para sugerir la receta.'; $('rcDiag').focus(); return; }
    var base = protocolo(c);
    boton.disabled = true;
    try {
      var e = await motorLocal(function (t) { if ($('rcIaMsg')) $('rcIaMsg').textContent = t; });
      $('rcIaMsg').textContent = 'La IA local está analizando el caso…';
      var catalogo = Object.keys(FRECUENTES).map(function (k) { return '- ' + k + ' (' + FRECUENTES[k].join(', ') + ')'; }).join('\n');
      var esquema = JSON.stringify({ type: 'object', properties: {
        medicamentos: { type: 'array', items: { type: 'object', properties: { medicamento: { type: 'string' }, dosis: { type: 'string' }, frecuencia: { type: 'string' }, duracion: { type: 'string' } }, required: ['medicamento', 'dosis', 'frecuencia', 'duracion'] } },
        indicaciones: { type: 'string' }, advertencias: { type: 'array', items: { type: 'string' } }, razonamiento: { type: 'string' } },
        required: ['medicamentos', 'indicaciones', 'advertencias', 'razonamiento'] });
      var r = await e.chat.completions.create({
        temperature: 0.2, max_tokens: 900,
        response_format: { type: 'json_object', schema: esquema },
        messages: [
          { role: 'system', content: 'Eres un asistente clínico para odontólogos en Guatemala. Propones una receta odontológica que el odontólogo revisará. Responde solo en JSON y en español. Usa ÚNICAMENTE medicamentos de este catálogo, con su nombre exacto:\n' + catalogo + '\nRespeta las alergias (nunca un medicamento de la familia a la que es alérgico), la edad, las enfermedades y los medicamentos que ya toma. Antibióticos solo si hay infección o cirugía con riesgo. Si no hace falta medicamento, devuelve la lista vacía.' },
          { role: 'user', content: 'Caso:\nEdad: ' + (c.edad != null ? c.edad + ' años' : 'no registrada') + '\nAlergias: ' + (c.alergias || 'ninguna registrada') + '\nEnfermedades: ' + (c.enfermedades || 'ninguna registrada') +
            '\nMedicamentos que ya toma: ' + (c.medicamentos || 'ninguno') + '\nDiagnóstico: ' + (c.diagnostico || 'no indicado') + '\nTratamientos del día: ' + (c.tratamientos.join('; ') || 'ninguno') +
            '\nCita: ' + (c.cita || '-') + '\nPropuesta según protocolo (puedes ajustarla): ' + JSON.stringify(base.medicamentos) }
        ]
      });
      var d = JSON.parse(r.choices[0].message.content || '{}');
      // Solo medicamentos del catálogo; lo demás se descarta y se avisa
      var fuera = [];
      d.medicamentos = (d.medicamentos || []).filter(function (m) {
        var k = m && m.medicamento && delCatalogo(m.medicamento);
        if (!k) { if (m && m.medicamento) fuera.push(m.medicamento); return false; }
        m.medicamento = k; return true;
      });
      d.advertencias = (d.advertencias || []).concat(base.advertencias.filter(function (a) { return (d.advertencias || []).indexOf(a) < 0; }));
      if (fuera.length) d.advertencias.push('Se descartó por no estar en el catálogo: ' + fuera.join(', ') + '.');
      aplicarSugerencia(d, 'de la IA local');
    } catch (err) {
      console.error(err);
      $('rcIaMsg').textContent = 'No se pudo usar la IA local en este equipo (' + (err && err.message ? err.message.slice(0, 120) : 'error') + '). Se aplicó la sugerencia por protocolo.';
      aplicarSugerencia(base, 'por protocolo');
    }
    boton.disabled = false;
  }

  function pintar() {
    pintarLista();
    if (editando) { pintarFormulario(editando === 'nueva' ? null : recetas.filter(function (r) { return r.id === editando; })[0]); return; }
    var r = recetas.filter(function (x) { return x.id === elegida; })[0];
    if (r) pintarDetalle(r);
    else $('rcPanel').innerHTML = '<div class="rc-vacio"><b>Sin recetas</b><p>Pulsa «+ Nueva receta» para registrar la primera receta de ' + esc(paciente.nombre) + '.</p></div>';
  }

  async function grabar(e) {
    e.preventDefault();
    var items = [].map.call($('rcMeds').querySelectorAll('.rc-med'), function (f) {
      var o = {}; f.querySelectorAll('[data-c]').forEach(function (i) { o[i.dataset.c] = i.value.trim(); }); return o;
    }).filter(function (o) { return o.medicamento; });
    if (!$('rcFecha').value) { aviso('Indica la fecha de atención.', true); return; }
    if (!items.length) { aviso('Agrega al menos un medicamento.', true); return; }
    var alertas = revisarAlergias();
    if (alertas.length && $('rcGrabar').dataset.confirmado !== '1') { $('rcGrabar').dataset.confirmado = '1'; $('rcGrabar').textContent = 'Grabar de todas formas'; aviso('Revisa el aviso de alergia. Si la indicación es correcta, pulsa «Grabar de todas formas».', true); return; }
    var id = editando === 'nueva' ? null : editando;
    $('rcGrabar').disabled = true;
    aviso('Grabando…');
    var r = await sb.rpc('guardar_receta', {
      p_id: id, p_paciente: paciente.id, p_fecha: $('rcFecha').value,
      p_visita: $('rcVisita').value ? parseInt($('rcVisita').value, 10) : null,
      p_cita: $('rcCita').value ? +$('rcCita').value : null,
      p_dentista: $('rcMedico').value ? +$('rcMedico').value : null,
      p_indicaciones: $('rcInd').value, p_items: items,
      p_proxima: $('rcProx').value || null, p_proxima_hora: $('rcProxHora').value || null
    });
    if (r.error) { $('rcGrabar').disabled = false; aviso(traducir(r.error), true); return; }
    var p = paciente;
    await cargar(p);
    elegida = r.data; editando = null; pintar();
    aviso(id ? 'Cambios guardados.' : 'Receta grabada. Ya puedes imprimirla.');
  }

  function imprimir(r) {
    var imp = window.PD_IMPRESION;
    if (!imp) return;
    var p = paciente, med = dentistaDe(r.dentista_id);
    var celda = 'padding:8px 6px;border-bottom:1px solid #D9E4EC;text-align:left;vertical-align:top';
    var dato = function (t, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t + '</span><b style="font-size:13.5px">' + v + '</b></div>'; };
    imp.imprimir(imp.encabezado('Receta médica · ' + esc(r.numero || '')) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 16px;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;margin-bottom:12px">' +
      dato('Paciente', esc(p.nombre)) + dato('DPI', esc(p.dpi || '—')) + dato('Edad', esc(edad(p.fecha_nacimiento) || '—')) + dato('Teléfono', esc(p.telefono || '—')) +
      dato('Fecha de atención', fechaLarga(r.fecha)) + dato('N.º de visita', r.visita_numero || '—') + dato('N.º de receta', esc(r.numero || '—')) + dato('Médico', esc(med ? med.nombre : '—')) +
      '</div>' +
      (p.alergias ? '<p style="margin:0 0 12px;padding:8px 12px;border-radius:10px;background:#FDE2E4;color:#9F1239;font-size:13px"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
      '<div style="font-family:Georgia,serif;font-size:30px;color:#005A87;margin:4px 0 6px">℞</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0B2B40;color:#FFFFFF">' +
      ['#', 'Medicamento', 'Dosis', 'Frecuencia', 'Duración'].map(function (h) { return '<th style="' + celda + ';border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      r.receta_items.map(function (i, k) { return '<tr><td style="' + celda + '">' + (k + 1) + '</td><td style="' + celda + '"><b>' + esc(i.medicamento) + '</b></td><td style="' + celda + '">' + esc(i.dosis || '—') + '</td><td style="' + celda + '">' + esc(i.frecuencia || '—') + '</td><td style="' + celda + '">' + esc(i.duracion || '—') + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (r.indicaciones ? '<p style="margin:14px 0 0;font-size:13.5px;line-height:1.55"><b>Indicaciones:</b> ' + esc(r.indicaciones) + '</p>' : '') +
      '<div style="display:flex;justify-content:center;margin-top:70px"><div style="width:320px;text-align:center;border-top:1.5px solid #0B2B40;padding-top:8px;font-size:13px">' +
      '<b style="font-size:14px">' + esc(med ? 'Dr(a). ' + med.nombre : 'Médico tratante') + '</b>' + (med && med.colegiado ? '<br>Colegiado ' + esc(med.colegiado) : '') +
      '<br><span style="color:#5A6D7A">Firma y sello</span>' +
      '<div style="margin-top:14px;padding-top:10px;border-top:1px dashed #C4D4DF;text-align:center;font-size:12px;line-height:1.7;color:#22394A">' +
      '<div><span style="color:#5A6D7A">Próxima cita:</span> <b>' + textoProxima(r) + '</b></div>' +
      '<div><span style="color:#5A6D7A">Fecha de grabación:</span> ' + fechaHora(r.creada) + '</div>' +
      '<div><span style="color:#5A6D7A">Usuario que graba:</span> ' + esc(r.creada_por || 'Sin usuario') + '</div>' +
      '</div></div></div>' +
      '<p style="margin-top:28px;font-size:11px;color:#5A6D7A;text-align:center">Siga las indicaciones de su médico. Ante cualquier reacción, suspenda el medicamento y comuníquese con la clínica.</p></div>');
  }

  // ---------- Eventos ----------
  $('rcNueva').addEventListener('click', function () { if (!paciente) return; editando = 'nueva'; aviso(''); pintar(); $('rcFecha').focus(); });
  $('rcLista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rc]');
    if (!b) return;
    elegida = +b.dataset.rc; editando = null; aviso(''); pintar();
  });
  $('rcPanel').addEventListener('click', function (e) {
    var r = recetas.filter(function (x) { return x.id === elegida; })[0];
    if (e.target.closest('[data-rc-modificar]') && r) { editando = r.id; aviso(''); pintar(); return; }
    if (e.target.closest('[data-rc-imprimir]') && r) { imprimir(r); return; }
    if (e.target.closest('[data-rc-cancelar]')) { editando = null; aviso(''); pintar(); return; }
    if (e.target.closest('[data-rc-protocolo]')) { sugerirProtocolo(); return; }
    var loc = e.target.closest('[data-rc-local]');
    if (loc) { generarLocal(loc); return; }
    if (e.target.closest('[data-rc-agregar]')) { $('rcMeds').insertAdjacentHTML('beforeend', filaMed()); var u = $('rcMeds').lastElementChild.querySelector('input'); if (u) u.focus(); return; }
    var q = e.target.closest('[data-rc-quitar]');
    if (q) { if ($('rcMeds').children.length > 1) q.closest('.rc-med').remove(); else q.closest('.rc-med').querySelectorAll('input').forEach(function (i) { i.value = ''; }); }
  });
  $('rcPanel').addEventListener('submit', function (e) { if (e.target.id === 'rcForm') grabar(e); });
  $('rcPanel').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'rcFecha') { sugerirVisita(); sugerirProxima(); contextoIA(); }
    if (t.id === 'rcProx' || t.id === 'rcProxHora') proximaAMano = true;
    if (t.id === 'rcVisita') visitaAMano = true;
    if (t.id === 'rcCita' && t.value) {
      var c = citasPac.filter(function (x) { return x.id === +t.value; })[0];
      if (c) { $('rcFecha').value = c.fecha; if (c.dentista_id && dentistaDe(c.dentista_id)) $('rcMedico').value = String(c.dentista_id); visitaAMano = false; sugerirVisita(); sugerirProxima(); }
    }
    // Medicamento frecuente: completa lo que esté vacío
    if (t.dataset && t.dataset.c === 'medicamento' && FRECUENTES[t.value]) {
      var fila = t.closest('.rc-med'), s = FRECUENTES[t.value];
      ['dosis', 'frecuencia', 'duracion'].forEach(function (c, k) { var i = fila.querySelector('[data-c="' + c + '"]'); if (i && !i.value) i.value = s[k]; });
    }
    if (t.dataset && t.dataset.c === 'medicamento') revisarAlergias();
  });

  // Listas de sugerencias
  document.body.insertAdjacentHTML('beforeend',
    '<datalist id="rcListaMed">' + Object.keys(FRECUENTES).map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>' +
    '<datalist id="rcListaFrec">' + FRECUENCIAS.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>' +
    '<datalist id="rcListaDur">' + DURACIONES.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>');

  window.PD_RECETAS = { cargar: cargar };
  window.PD_IA_LOCAL = { disponible: function () { return !!navigator.gpu; }, motor: motorLocal };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {},
    limpiar: function () { paciente = null; recetas = []; dentistas = []; citasPac = []; elegida = null; editando = null; $('rcLista').innerHTML = ''; $('rcPanel').innerHTML = ''; aviso(''); }
  });
})();
