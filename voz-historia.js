// Plus Dental — Expediente > Historia médica: dictado por voz.
// Se dice el nombre del campo y luego su contenido: «alergias penicilina y látex, enfermedades diabetes,
// medicamentos metformina 850 cada 12 horas… guardar». También «cambiar alergias por…», «borrar medicamentos»,
// «coma», «punto», «nueva línea», «cancelar» y «detener». Cada campo tiene además su propio micrófono.
(function () {
  function $(id) { return document.getElementById(id); }
  if (!$('fHistoria') || !$('hvVoz')) return;
  var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var NOMBRES = { pAlergias: 'Alergias', pEnfermedades: 'Enfermedades y condiciones', pMedicamentos: 'Medicamentos actuales' };
  if (!Reconocedor) {
    document.querySelectorAll('#fHistoria .hv-btn, #hvVoz').forEach(function (b) { b.disabled = true; b.title = 'El dictado funciona en Chrome o Edge.'; });
    $('hvAyuda').textContent = 'El dictado por voz funciona en Chrome o Edge.';
    return;
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function campoDe(palabra) {
    var p = palabra.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/^alergia/.test(p)) return 'pAlergias';
    if (/^(enfermedad|condicion|padecimiento)/.test(p)) return 'pEnfermedades';
    if (/^(medicament|medicina)/.test(p)) return 'pMedicamentos';
    return null;
  }
  var RE_CAMPO = /(?:^|\s)(borrar|borra|limpiar|limpia|cambiar|cambia|reemplazar|reemplaza)?\s*(alergias?|enfermedades|enfermedad|condiciones|padecimientos|medicamentos(?: actuales)?|medicamento|medicinas)\b\s*(?:por|:)?\s*/gi;
  var RE_FIN = /\s*\b(guardar|guarda|grabar|graba|cancelar|cancela|detener|deten|parar)\b[\s.]*$/i;

  var rec = null, escuchando = false, destino = 'pAlergias', soloCampo = null;

  // Signos dictados
  function signos(t) {
    return t.replace(/\s*\b(punto y aparte|nueva linea|nueva línea|siguiente linea|siguiente línea)\b\s*/gi, '\n')
      .replace(/\s*\bpunto y coma\b\s*/gi, '; ').replace(/\s*\bdos puntos\b\s*/gi, ': ')
      .replace(/\s*\bcoma\b\s*/gi, ', ').replace(/\s*\bpunto\b\s*/gi, '. ');
  }
  function agregar(id, texto) {
    texto = signos(texto).replace(/\s+([,.;:])/g, '$1').trim();
    if (!texto) return;
    var el = $(id), v = el.value.replace(/\s+$/, '');
    if (/^ningun[oa]s?$/i.test(v)) v = '';
    texto = texto.charAt(0).toUpperCase() + texto.slice(1);
    el.value = v ? v + (/[\n,.;:]$/.test(v) ? ' ' : ', ') + texto : texto;
    el.value = el.value.replace(/ \n/g, '\n').replace(/([.\n]\s*)(\p{Ll})/gu, function (m, a, b) { return a + b.toUpperCase(); });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    marcar(id);
  }
  function marcar(id) { var el = $(id); el.classList.remove('voz-ok'); void el.offsetWidth; el.classList.add('voz-ok'); }

  // Aplica un fragmento ya reconocido (definitivo)
  function procesar(texto) {
    var orden = null, m = texto.match(RE_FIN);
    if (m) { orden = m[1].toLowerCase(); texto = texto.slice(0, m.index); }
    if (soloCampo) { agregar(soloCampo, texto); }
    else {
      var pos = 0, r; RE_CAMPO.lastIndex = 0;
      while ((r = RE_CAMPO.exec(texto))) {
        agregar(destino, texto.slice(pos, r.index));
        var id = campoDe(r[2]);
        if (id) {
          destino = id;
          if (r[1]) { $(id).value = ''; marcar(id); }
        }
        pos = RE_CAMPO.lastIndex;
      }
      agregar(destino, texto.slice(pos));
    }
    estado();
    if (orden) {
      detener();
      if (/^(guard|grab)/.test(orden)) { var g = document.querySelector('#fHistoria [data-exp-accion="guardar"]'); if (g) g.click(); }
      else if (/^cancel/.test(orden)) { var c = document.querySelector('#fHistoria [data-exp-accion="cancelar"]'); if (c) c.click(); }
    }
  }

  // El registro debe estar en modo edición para dictar
  function modoEdicion() {
    var fs = $('pHistoriaCampos');
    if (fs && fs.disabled) { var b = document.querySelector('#fHistoria [data-exp-accion="editar"]'); if (b) b.click(); }
    return !(fs && fs.disabled);
  }
  function estado(parcial) {
    $('hvEstado').innerHTML = escuchando
      ? 'Escribiendo en <b>' + esc(NOMBRES[soloCampo || destino]) + '</b>' + (parcial ? ' · <span class="hv-parcial">«' + esc(parcial) + '»</span>' : '')
      : '';
  }
  function botones() {
    $('hvVoz').classList.toggle('escuchando', escuchando && !soloCampo);
    $('hvVozTxt').textContent = escuchando && !soloCampo ? 'Escuchando… toca para detener' : 'Dictar historia médica';
    document.querySelectorAll('#fHistoria .hv-btn').forEach(function (b) {
      var on = escuchando && soloCampo === b.dataset.hvCampo;
      b.classList.toggle('escuchando', on); b.setAttribute('aria-pressed', on);
    });
  }
  function iniciar(campo) {
    if (!modoEdicion()) { $('fHistoriaMsg').textContent = 'No tienes permiso para modificar la historia médica.'; return; }
    soloCampo = campo || null;
    destino = campo || (document.activeElement && NOMBRES[document.activeElement.id] ? document.activeElement.id : destino);
    rec = new Reconocedor();
    rec.lang = 'es-GT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (e) {
      var parcial = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) procesar(e.results[i][0].transcript);
        else parcial += e.results[i][0].transcript;
      }
      if (escuchando) estado(parcial.trim());
    };
    rec.onerror = function (e) {
      $('hvEstado').textContent = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permite el uso del micrófono en el navegador para dictar.'
        : e.error === 'no-speech' ? 'No escuché nada. Toca el micrófono e intenta de nuevo.'
        : e.error === 'audio-capture' ? 'No se encontró un micrófono.' : 'No se pudo usar el micrófono (' + e.error + ').';
    };
    rec.onend = function () { escuchando = false; soloCampo = null; botones(); };
    try { rec.start(); escuchando = true; botones(); estado(); $(destino).focus({ preventScroll: true }); } catch (err) { escuchando = false; botones(); }
  }
  function detener() { escuchando = false; if (rec) { try { rec.stop(); } catch (err) { /* ya detenido */ } } soloCampo = null; botones(); estado(); }

  $('hvVoz').addEventListener('click', function () { if (escuchando) detener(); else iniciar(null); });
  $('fHistoria').addEventListener('click', function (e) {
    var b = e.target.closest('.hv-btn');
    if (!b) return;
    e.preventDefault();
    if (escuchando) { var mismo = soloCampo === b.dataset.hvCampo; detener(); if (mismo) return; }
    iniciar(b.dataset.hvCampo);
  });
  // Al cambiar de paciente o de pestaña, se deja de escuchar
  document.addEventListener('click', function (e) { if (escuchando && e.target.closest('#fichaTabs [data-ficha], [data-exp-accion="cancelar"]')) detener(); });
  window.PD_VOZ_HISTORIA = { procesar: function (t) { procesar(t); } };
})();
