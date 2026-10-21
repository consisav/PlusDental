// Plus Dental — Historial de citas: búsqueda por voz.
// Mientras se habla llena paciente, fechas y procedimiento; reconoce el estado (programadas, confirmadas…)
// y el periodo (próximas / anteriores). Al decir «buscar» ejecuta la consulta; «limpiar» borra la búsqueda.
// Usa el reconocimiento de voz del navegador (Chrome, Edge, Safari reciente).
(function () {
  function $(id) { return document.getElementById(id); }
  if (!$('cbVoz')) return;
  var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocedor) {
    $('cbVoz').disabled = true;
    $('cbVoz').title = 'Este navegador no permite dictar. Usa Chrome o Edge.';
    $('cbVozAyuda').textContent = 'La búsqueda por voz funciona en Chrome o Edge.';
    return;
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ/\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function sumar(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var NUM = { uno: 1, primero: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
    dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, 'treinta y uno': 31 };
  var VACIAS = ['paciente', 'pacientes', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'por', 'al', 'a', 'en', 'citas', 'cita', 'buscar', 'busca', 'procedimiento', 'tratamiento', 'servicio', 'desde', 'hasta', 'fecha', 'dental', 'dentales'];

  // Números dichos en palabras → cifras («del uno al quince» → «del 1 al 15»)
  function cifras(t) {
    t = t.replace(/treinta y uno/g, '31');
    return t.split(' ').map(function (w) { return NUM[w] != null ? String(NUM[w]) : w; }).join(' ');
  }
  function fechaDe(dia, mes, anio) {
    var h = new Date(), a = anio ? +anio : h.getFullYear();
    if (a < 100) a += 2000;
    var d = new Date(a, mes, Math.min(+dia, 31));
    return d.getMonth() === mes ? iso(d) : null;
  }
  var RE_MES = '(' + MESES.join('|') + ')';
  var RE_FECHA = '(\\d{1,2})(?: de)?(?: ' + RE_MES + ')?(?: (?:de |del )?(\\d{4}))?';

  // Lee el texto dicho y devuelve lo que entendió
  function interpretar(texto) {
    var t = cifras(normal(texto)), r = {}, h = new Date();
    // Órdenes
    if (/\b(buscar|busca|busque|consultar|consulta|mostrar|muestra|ejecutar)\s*$/.test(t)) r.buscar = true;
    if (/\b(limpiar|limpia|borrar|borra)\b/.test(t)) r.limpiar = true;
    if (/\b(detener|deten|parar|para de escuchar|cancelar busqueda)\b/.test(t)) r.detener = true;
    // Estado (reprogramadas antes que programadas)
    if (/\breprogramad/.test(t)) r.estado = 'reprogramada';
    else if (/\b(programad|pendiente)/.test(t)) r.estado = 'pendiente';
    else if (/\bconfirmad/.test(t)) r.estado = 'confirmada';
    else if (/\batendid/.test(t)) r.estado = 'atendida';
    else if (/\bcancelad/.test(t)) r.estado = 'cancelada';
    else if (/\b(todas|todos los estados)\b/.test(t)) r.estado = 'todas';
    // Periodo
    if (/\b(proximas|futuras|siguientes)\b/.test(t)) r.periodo = 'proximas';
    else if (/\b(anteriores|pasadas|historial)\b/.test(t)) r.periodo = 'anteriores';
    // Fechas: rango «del 1 al 15 de octubre», «desde el 3 de septiembre hasta el 10 de octubre»
    var m = t.match(new RegExp('(?:del|desde(?: el)?|entre(?: el)?) ' + RE_FECHA + ' (?:al|hasta(?: el)?|y(?: el)?) ' + RE_FECHA));
    if (m) {
      var mesFin = m[5] ? MESES.indexOf(m[5]) : h.getMonth(), anioFin = m[6];
      var mesIni = m[2] ? MESES.indexOf(m[2]) : mesFin, anioIni = m[3] || anioFin;
      r.desde = fechaDe(m[1], mesIni, anioIni); r.hasta = fechaDe(m[4], mesFin, anioFin);
    } else {
      var d1 = t.match(new RegExp('(?:desde(?: el)?|a partir del?) ' + RE_FECHA));
      var d2 = t.match(new RegExp('hasta(?: el)? ' + RE_FECHA));
      if (d1) r.desde = fechaDe(d1[1], d1[2] ? MESES.indexOf(d1[2]) : h.getMonth(), d1[3]);
      if (d2) r.hasta = fechaDe(d2[1], d2[2] ? MESES.indexOf(d2[2]) : h.getMonth(), d2[3]);
      if (!d1 && !d2) {
        var uno = t.match(new RegExp('(?:el|dia) ' + '(\\d{1,2}) de ' + RE_MES + '(?: (?:de |del )?(\\d{4}))?'));
        var fx = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (uno) r.desde = r.hasta = fechaDe(uno[1], MESES.indexOf(uno[2]), uno[3]);
        else if (fx) r.desde = r.hasta = fechaDe(fx[1], +fx[2] - 1, fx[3]);
        else if (/\bhoy\b/.test(t)) r.desde = r.hasta = iso(h);
        else if (/\bayer\b/.test(t)) r.desde = r.hasta = iso(sumar(h, -1));
        else if (/\bpasado manana\b/.test(t)) r.desde = r.hasta = iso(sumar(h, 2));
        else if (/\bmanana\b/.test(t)) r.desde = r.hasta = iso(sumar(h, 1));
        else if (/\b(semana pasada|la semana anterior)\b/.test(t)) { var lp = sumar(h, -((h.getDay() + 6) % 7) - 7); r.desde = iso(lp); r.hasta = iso(sumar(lp, 6)); }
        else if (/\b(proxima semana|semana que viene|siguiente semana)\b/.test(t)) { var ls = sumar(h, -((h.getDay() + 6) % 7) + 7); r.desde = iso(ls); r.hasta = iso(sumar(ls, 6)); }
        else if (/\b(esta semana)\b/.test(t)) { var l = sumar(h, -((h.getDay() + 6) % 7)); r.desde = iso(l); r.hasta = iso(sumar(l, 6)); }
        else if (/\b(mes pasado|mes anterior)\b/.test(t)) { r.desde = iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)); r.hasta = iso(new Date(h.getFullYear(), h.getMonth(), 0)); }
        else if (/\b(proximo mes|mes que viene|siguiente mes)\b/.test(t)) { r.desde = iso(new Date(h.getFullYear(), h.getMonth() + 1, 1)); r.hasta = iso(new Date(h.getFullYear(), h.getMonth() + 2, 0)); }
        else if (/\beste mes\b/.test(t)) { r.desde = iso(new Date(h.getFullYear(), h.getMonth(), 1)); r.hasta = iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)); }
        else {
          var mesSolo = t.match(new RegExp('\\b(?:en|de|mes de) ' + RE_MES + '(?: (?:de |del )?(\\d{4}))?'));
          if (mesSolo) { var mi = MESES.indexOf(mesSolo[1]), ai = mesSolo[2] ? +mesSolo[2] : h.getFullYear(); r.desde = iso(new Date(ai, mi, 1)); r.hasta = iso(new Date(ai, mi + 1, 0)); }
        }
      }
    }
    // Paciente y procedimiento: se buscan en las listas de la pantalla
    var palabras = t.split(' ');
    var pac = mejorOpcion($('cbPaciente'), palabras, true);
    if (pac) { r.paciente = pac.value; r.pacienteTxt = pac.text; palabras = palabras.filter(function (w) { return pac.tokens.indexOf(w) < 0; }); }
    var proc = mejorOpcion($('cbProc'), palabras, false);
    if (proc) { r.proc = proc.value; r.procTxt = proc.text; }
    return r;
  }
  // La opción cuya mayoría de palabras importantes se dijo (paciente: al menos 2 palabras o el nombre completo)
  function mejorOpcion(sel, palabras, esPaciente) {
    var mejor = null;
    [].forEach.call(sel.options, function (o) {
      if (!o.value) return;
      var tokens = normal(o.text).split(' ').filter(function (w) { return w.length > 2 && VACIAS.indexOf(w) < 0; });
      if (!tokens.length) return;
      var dichos = tokens.filter(function (w) {
        return palabras.some(function (p) { return p === w || (p.length > 4 && w.length > 4 && (p.indexOf(w.slice(0, 5)) === 0 || w.indexOf(p.slice(0, 5)) === 0)); });
      });
      var ok = esPaciente ? (dichos.length >= Math.min(2, tokens.length)) : dichos.some(function (w) { return w.length >= 4; });
      if (!ok) return;
      var puntos = dichos.length * 10 + (dichos.length === tokens.length ? 5 : 0) - tokens.length;
      if (!mejor || puntos > mejor.puntos) mejor = { value: o.value, text: o.text, puntos: puntos, tokens: dichos };
    });
    return mejor;
  }

  var ESTADOS = { pendiente: 'Programadas', confirmada: 'Confirmadas', reprogramada: 'Reprogramadas', atendida: 'Atendidas', cancelada: 'Canceladas', todas: 'Todas' };
  var rec = null, escuchando = false, textoFinal = '', pendiente = {};

  function marcar(id) {
    var el = $(id); el.classList.remove('voz-ok'); void el.offsetWidth; el.classList.add('voz-ok');
  }
  function aplicarCampos(r) {
    if (r.paciente && $('cbPaciente').value !== r.paciente) { $('cbPaciente').value = r.paciente; marcar('cbPaciente'); }
    if (r.proc && $('cbProc').value !== r.proc) { $('cbProc').value = r.proc; marcar('cbProc'); }
    if (r.desde && $('cbDesde').value !== r.desde) { $('cbDesde').value = r.desde; marcar('cbDesde'); }
    if (r.hasta && $('cbHasta').value !== r.hasta) { $('cbHasta').value = r.hasta; marcar('cbHasta'); }
    if (r.estado) pendiente.estado = r.estado;
    if (r.periodo) pendiente.periodo = r.periodo;
    var partes = [];
    if (r.pacienteTxt) partes.push('Paciente: ' + r.pacienteTxt);
    var dmy = function (f) { return f ? f.split('-').reverse().join('/') : '…'; };
    if (r.desde || r.hasta) partes.push('Fechas: ' + dmy($('cbDesde').value) + ' a ' + dmy($('cbHasta').value));
    if (r.procTxt) partes.push('Procedimiento: ' + r.procTxt);
    if (pendiente.estado) partes.push('Estado: ' + ESTADOS[pendiente.estado]);
    if (pendiente.periodo) partes.push(pendiente.periodo === 'proximas' ? 'Próximas' : 'Anteriores');
    $('cbVozEntendi').innerHTML = partes.length ? 'Entendí → ' + partes.map(esc).join(' · ') : '';
  }
  function ejecutar() {
    var hayFechas = $('cbDesde').value || $('cbHasta').value;
    var periodoBtn = pendiente.periodo && document.querySelector('#citaPeriodo [data-periodo="' + pendiente.periodo + '"]');
    if (!hayFechas && periodoBtn && periodoBtn.getAttribute('aria-pressed') !== 'true') {
      // Guardar paciente y procedimiento: el cambio de periodo recarga la lista
      periodoBtn.click();
    } else {
      $('cbBuscar').click();
    }
    if (pendiente.estado) { var b = document.querySelector('#citaFiltros [data-filtro="' + pendiente.estado + '"]'); if (b) b.click(); }
    else if (hayFechas) { var t = document.querySelector('#citaFiltros [data-filtro="todas"]'); if (t) t.click(); }
    pendiente = {};
  }

  function estadoBoton(on) {
    escuchando = on;
    $('cbVoz').classList.toggle('escuchando', on);
    $('cbVoz').setAttribute('aria-pressed', on);
    $('cbVozTxt').textContent = on ? 'Escuchando… toca para detener' : 'Buscar por voz';
  }
  function iniciar() {
    rec = new Reconocedor();
    rec.lang = 'es-GT';
    rec.continuous = true;
    rec.interimResults = true;
    textoFinal = ''; pendiente = {};
    $('cbVozOi').textContent = ''; $('cbVozEntendi').textContent = '';
    $('cbVozPanel').hidden = false;
    rec.onresult = function (e) {
      var parcial = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) textoFinal += ' ' + e.results[i][0].transcript;
        else parcial += e.results[i][0].transcript;
      }
      $('cbVozOi').innerHTML = 'Oí: «' + esc((textoFinal + ' ' + parcial).trim()) + '»';
      var r = interpretar(textoFinal + ' ' + parcial);
      if (r.limpiar) { $('cbLimpiar').click(); textoFinal = ''; pendiente = {}; $('cbVozEntendi').textContent = 'Búsqueda limpia. Sigue hablando.'; return; }
      aplicarCampos(r);
      if (r.detener) { detener(); return; }
      if (r.buscar && /\b(buscar|busca|busque|consultar|consulta|mostrar|muestra|ejecutar)\s*$/.test(normal(textoFinal))) { detener(); ejecutar(); }
    };
    rec.onerror = function (e) {
      var m = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permite el uso del micrófono en el navegador para buscar por voz.'
        : e.error === 'no-speech' ? 'No escuché nada. Toca el micrófono e intenta de nuevo.'
        : e.error === 'audio-capture' ? 'No se encontró un micrófono.' : 'No se pudo usar el micrófono (' + e.error + ').';
      $('cbVozEntendi').textContent = m;
    };
    rec.onend = function () { estadoBoton(false); };
    try { rec.start(); estadoBoton(true); } catch (err) { estadoBoton(false); }
  }
  function detener() { if (rec) { try { rec.stop(); } catch (err) { /* ya detenido */ } } estadoBoton(false); }

  $('cbVoz').addEventListener('click', function () { if (escuchando) detener(); else iniciar(); });
  window.PD_VOZ_CITAS = { interpretar: interpretar };
})();
