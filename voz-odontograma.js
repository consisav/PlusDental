// Plus Dental — Expediente > Odontograma: dictado por voz.
// «pieza 16 caries oclusal y distal, resina de varias superficies; pieza 21 corona de porcelana; pieza 38 extracción;
//  pieza 46 obturación realizada… crear presupuesto». Cada trabajo «requerido» toma su procedimiento con precio
// del catálogo (el dicho o el más adecuado) y pasa solo a la lista del presupuesto.
(function () {
  function $(id) { return document.getElementById(id); }
  if (!$('odVoz')) return;
  var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconocedor) { $('odVoz').disabled = true; $('odAyuda').textContent = 'El dictado por voz funciona en Chrome o Edge.'; return; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function odg() { return window.PD_ODG_GET ? window.PD_ODG_GET() : null; }

  var DECENAS = { once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19 };
  var UNIDAD = { uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
  var DIEZ = { veinte: 20, veinti: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80 };
  // «dieciséis», «veintiuno», «treinta y ocho», «uno seis» → números
  function cifras(t) {
    t = t.replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta) y (uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, function (m, a, b) { return String(DIEZ[a] + UNIDAD[b]); });
    t = t.replace(/\bveinti(uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, function (m, b) { return String(20 + UNIDAD[b]); });
    t = t.replace(/\b(once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve)\b/g, function (m) { return String(DECENAS[m]); });
    t = t.replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta)\b/g, function (m) { return String(DIEZ[m]); });
    t = t.replace(/\b(pieza|diente|muela) (uno|dos|tres|cuatro|cinco|seis|siete|ocho|[1-8]) (uno|dos|tres|cuatro|cinco|seis|siete|ocho|[1-8])\b/g, function (m, p, a, b) {
      return p + ' ' + (UNIDAD[a] || a) + (UNIDAD[b] || b);
    });
    return t.replace(/\b([1-8]) ([1-8])\b/g, '$1$2');
  }
  var HERR = [
    [/\b(borrar|borra|quitar|quita|limpiar)\b/, 'borrar'],
    [/\b(ausente|falta|perdid[ao]|no tiene)\b/, 'ausente'],
    [/\b(extrac\w*|extraer|sacar|exodoncia|cordal)\b/, 'extraccion'],
    [/\bimplante\b/, 'implante'],
    [/\b(endodon\w*|conducto|conductos|canal|canales|nervio)\b/, 'endodoncia'],
    [/\bcorona\b/, 'corona'],
    [/\b(obtura\w*|calza|relleno|amalgama)\b/, 'obturacion'],
    [/\b(caries|cariad\w*|picad\w*|resina)\b/, 'caries']
  ];
  var CARAS = [[/\b(vestibular|bucal|vestibulares)\b/, 'V'], [/\bmesial\b/, 'M'], [/\bdistal\b/, 'D'], [/\boclusal\b/, 'O'], [/\bincisal\b/, 'I'], [/\b(lingual|palatin[ao])\b/, 'L']];
  var NOMBRE_HERR = { caries: 'Caries', obturacion: 'Obturación', corona: 'Corona', endodoncia: 'Endodoncia', implante: 'Implante', extraccion: 'Extracción', ausente: 'Ausente', borrar: 'Borrar' };

  // Un fragmento («pieza 16 caries oclusal…») → instrucción para el odontograma
  function instruccion(seg) {
    var m = seg.match(/\b([1-8][1-8])\b/);
    if (!m) return null;
    var resto = seg.replace(m[0], ' ');
    var h = null;
    for (var i = 0; i < HERR.length; i++) if (HERR[i][0].test(resto)) { h = HERR[i][1]; break; }
    var caras = CARAS.filter(function (c) { return c[0].test(resto); }).map(function (c) { return c[1]; });
    var c = /\b(realizad\w*|existente|hech[ao]|ya tiene|tiene una|antigu\w*|previ\w*)\b/.test(resto) ? 'a' : 'r';
    return { n: +m[1], h: h, caras: caras, c: c, proc: resto };
  }
  function partir(texto) {
    var t = cifras(normal(texto));
    var segs = t.split(/\b(?:pieza|piezas|diente|muela)\b/).map(function (s) { return s.trim(); }).filter(Boolean);
    // Sin la palabra «pieza»: se parte en cada número de pieza dicho
    if (segs.length <= 1) segs = t.split(/(?=\b[1-8][1-8]\b)/).map(function (s) { return s.trim(); }).filter(Boolean);
    return { texto: t, segs: segs };
  }

  var rec = null, escuchando = false, pendiente = '', bitacora = [];
  function anotar(ok, txt) {
    bitacora.unshift({ ok: ok, txt: txt }); bitacora = bitacora.slice(0, 8);
    $('odVozLog').innerHTML = bitacora.map(function (b) { return '<li class="' + (b.ok ? 'ok' : 'mal') + '">' + (b.ok ? '✓ ' : '⚠ ') + esc(b.txt) + '</li>'; }).join('');
  }
  function procesar(texto) {
    var o = odg();
    if (!o) return;
    var p = partir((pendiente + ' ' + texto).trim()), orden = null;
    pendiente = '';
    var mo = p.texto.match(/\b(crear presupuesto|crea presupuesto|hacer presupuesto|generar presupuesto|guardar odontograma|guardar|detener|parar|terminar)\b\s*$/);
    if (mo) {
      orden = mo[1];
      var ult = p.segs[p.segs.length - 1].replace(new RegExp('\\s*' + orden + '\\s*$'), '').trim();
      if (ult) p.segs[p.segs.length - 1] = ult; else p.segs.pop();
    }
    p.segs.forEach(function (seg, i) {
      var ins = instruccion(seg);
      if (!ins) return;
      if (!ins.h) {
        // Solo se dijo el número: puede completarse en la frase siguiente
        if (i === p.segs.length - 1 && !orden) { pendiente = 'pieza ' + seg; return; }
        anotar(false, 'Pieza ' + ins.n + ': no entendí qué hallazgo marcar.'); return;
      }
      var r = o.dictar(ins);
      anotar(r.ok, r.texto);
    });
    total();
    if (orden) {
      detener();
      if (/presupuesto/.test(orden)) o.crearPresupuesto();
      else if (/guardar/.test(orden)) { var g = $('odoGuardar'); if (g && !g.closest('[hidden]')) g.click(); else anotar(false, 'No hay cambios del odontograma por guardar.'); }
    }
  }
  function total() {
    var o = odg(); if (!o || !o.totalRequerido) return;
    var t = o.totalRequerido();
    $('odVozTotal').textContent = 'Total requerido en el presupuesto: Q' + t.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function botones() {
    $('odVoz').classList.toggle('escuchando', escuchando);
    $('odVozTxt').textContent = escuchando ? 'Escuchando… toca para detener' : 'Dictar odontograma';
    $('odVozPanel').hidden = !escuchando && !bitacora.length;
  }
  function iniciar() {
    rec = new Reconocedor();
    rec.lang = 'es-GT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (e) {
      var parcial = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) procesar(e.results[i][0].transcript);
        else parcial += e.results[i][0].transcript;
      }
      $('odVozOi').textContent = parcial ? 'Oyendo: «' + parcial.trim() + '»' : pendiente ? 'Esperando el hallazgo de la ' + pendiente + '…' : '';
    };
    rec.onerror = function (e) {
      anotar(false, e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permite el uso del micrófono en el navegador para dictar.'
        : e.error === 'no-speech' ? 'No escuché nada. Toca el micrófono e intenta de nuevo.' : e.error === 'audio-capture' ? 'No se encontró un micrófono.' : 'No se pudo usar el micrófono (' + e.error + ').');
    };
    rec.onend = function () { escuchando = false; $('odVozOi').textContent = ''; botones(); };
    try { rec.start(); escuchando = true; pendiente = ''; botones(); total(); } catch (err) { escuchando = false; botones(); }
  }
  function detener() { escuchando = false; if (rec) { try { rec.stop(); } catch (err) { /* ya detenido */ } } botones(); }

  $('odVoz').addEventListener('click', function () { if (escuchando) detener(); else iniciar(); });
  document.addEventListener('click', function (e) { if (escuchando && e.target.closest('#fichaTabs [data-ficha]')) detener(); });
  window.PD_VOZ_ODONTOGRAMA = { procesar: procesar, partir: partir, instruccion: instruccion };
})();
