// Plus Dental — Expediente > Órdenes de laboratorio: dictado por voz.
// Se dice cada dato y su valor: «laboratorio Dental Lab, trabajo corona unitaria, pieza 36, material zirconia, color A2,
// impresión escaneo intraoral, se envía modelos de yeso y registro de mordida, entrega 20 de noviembre, costo 450,
// indicaciones contacto proximal firme… grabar». También «odontólogo…», «fecha de envío…», «estado…», «cancelar» y «detener».
// Las listas (laboratorios, odontólogos, materiales, colores…) se toman del propio formulario de laboratorio.js.
(function () {
  function $(id) { return document.getElementById(id); }
  if (!$('olPanel') || !$('olNueva')) return;
  var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
  var MIC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>';
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s.]/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Nombre de persona: cada palabra con mayúscula («juan pérez» → «Juan Pérez»)
  function nombre(t) { return String(t || '').trim().replace(/(^|\s)(\p{Ll})/gu, function (m, a, b) { return a + b.toUpperCase(); }); }
  function mayus(t) { t = String(t || '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }

  // ---- Números dictados en palabras («treinta y seis», «uno seis») ----
  var UNIDAD = { cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
  var DECENAS = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19 };
  var DIEZ = { veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
  function cifras(t) {
    t = normal(t);
    t = t.replace(/\b(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) y (uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, function (m, a, b) { return String(DIEZ[a] + UNIDAD[b]); });
    t = t.replace(/\bveinti(uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, function (m, b) { return String(20 + UNIDAD[b]); });
    t = t.replace(/\b(diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve)\b/g, function (m) { return String(DECENAS[m]); });
    t = t.replace(/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/g, function (m) { return String(DIEZ[m]); });
    t = t.replace(/\b(cero|uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, function (m) { return String(UNIDAD[m]); });
    return t.replace(/\b([1-8]) ([1-8])\b/g, '$1$2');   // «uno seis» → 16
  }

  // ---- Campos que se reconocen ----
  var RE_CAMPO = /(?:^|\s)(fecha de recepci[oó]n|recepci[oó]n|recibido el|persona que entrega|qui[eé]n entrega|entregado por|lo entrega|persona que recibe|qui[eé]n recibe|recibido por|lo recibe|observaciones de recepci[oó]n|observaciones|laboratorio|odont[oó]log[oa]|doctor[a]?|dentista|tipo de trabajo|trabajo|piezas?|dientes?|materiales|material|color|impresi[oó]n|se env[ií]an?|env[ií]a|enviar|incluye|indicaciones|indicaci[oó]n|instrucciones|fecha de entrega|entrega(?: prometida)?|fecha de env[ií]o|env[ií]o|costo|precio|estado)\b[\s:,]*(?:es |de |del |el |la |los |las )?/gi;
  var RE_FIN = /\s*\b(grabar|graba|guardar|guarda|cancelar|cancela|detener|det[eé]n|parar)\b[\s.]*$/i;
  function campoDe(p) {
    p = normal(p);
    if (/^(fecha de recepcion|recepcion|recibido el)/.test(p)) return 'recFecha';
    if (/(que entrega|quien entrega|entregado por|lo entrega)$/.test(p)) return 'recEntrega';
    if (/(que recibe|quien recibe|recibido por|lo recibe)$/.test(p)) return 'recRecibe';
    if (/^observaciones/.test(p)) return 'recObs';
    if (/^laboratorio/.test(p)) return 'lab';
    if (/^(odontolog|doctor|dentista)/.test(p)) return 'dent';
    if (/trabajo$/.test(p)) return 'trabajo';
    if (/^(pieza|diente)/.test(p)) return 'piezas';
    if (/^material/.test(p)) return 'material';
    if (/^color/.test(p)) return 'color';
    if (/^impresion/.test(p)) return 'impresion';
    if (/^(se envia|envia|enviar|incluye)/.test(p)) return 'envia';
    if (/^(indicacion|instruccion)/.test(p)) return 'ind';
    if (/entrega/.test(p)) return 'entrega';
    if (/envio/.test(p)) return 'envio';
    if (/^(costo|precio)/.test(p)) return 'costo';
    if (/^estado/.test(p)) return 'estado';
    return null;
  }
  var NOMBRES = { lab: 'Laboratorio', dent: 'Odontólogo', trabajo: 'Tipo de trabajo', piezas: 'Piezas', material: 'Material', color: 'Color', impresion: 'Impresión', envia: 'Se envía', ind: 'Indicaciones', entrega: 'Entrega prometida', envio: 'Fecha de envío', costo: 'Costo', estado: 'Estado', recFecha: 'Fecha y hora de recepción', recEntrega: 'Persona que entrega', recRecibe: 'Persona que recibe', recObs: 'Observaciones de recepción' };
  var ID = { lab: 'olLab', dent: 'olDent', trabajo: 'olTrabajo', piezas: 'olPiezas', material: 'olMaterial', color: 'olColor', impresion: 'olImpresion', ind: 'olInd', entrega: 'olEntrega', envio: 'olEnvio', costo: 'olCosto', estado: 'olEstado', recFecha: 'olRecFecha', recEntrega: 'olRecEntrega', recRecibe: 'olRecRecibe', recObs: 'olRecObs' };

  // Mejor opción de una lista: exacta, la que contiene lo dicho, o la que comparte más palabras
  function mejor(lista, dicho) {
    var d = normal(dicho); if (!d) return null;
    var pal = d.split(' ').filter(function (w) { return w.length > 2; }), top = null, pts = 0;
    lista.forEach(function (x) {
      var n = normal(x), p = n === d ? 100 : n.indexOf(d) === 0 ? 60 : n.indexOf(d) >= 0 ? 50 : d.indexOf(n) >= 0 ? 45 : 0;
      if (!p) pal.forEach(function (w) { if (n.indexOf(w) >= 0) p += 10; });
      if (p > pts) { pts = p; top = x; }
    });
    return top;
  }
  function opcionesDe(sel) { return [].slice.call(sel.options).filter(function (o) { return o.value && o.value !== 'nuevo'; }); }
  function elegir(sel, dicho) {
    var ops = opcionesDe(sel), t = mejor(ops.map(function (o) { return o.textContent; }), dicho);
    var o = ops.filter(function (x) { return x.textContent === t; })[0];
    if (!o) return null;
    sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return o.textContent;
  }
  function lista(id) { var dl = $(id); return dl ? [].map.call(dl.options, function (o) { return o.value; }) : []; }
  function poner(id, v) { var el = $(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return v; }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  // «20 de noviembre», «hoy», «mañana», «en 7 días», «20/11»
  function fecha(dicho) {
    var t = cifras(dicho).replace(/\bsetiembre\b/, 'septiembre'), h = new Date(), m;
    if (/\bhoy\b/.test(t)) return iso(h);
    if (/\bpasado manana\b/.test(t)) { h.setDate(h.getDate() + 2); return iso(h); }
    if (/\bmanana\b/.test(t)) { h.setDate(h.getDate() + 1); return iso(h); }
    if ((m = t.match(/\ben (\d+) dias?( habiles)?/))) {
      var n = +m[1];
      if (m[2]) { while (n > 0) { h.setDate(h.getDate() + 1); if (h.getDay() !== 0) n--; } } else h.setDate(h.getDate() + n);
      return iso(h);
    }
    if ((m = t.match(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: (?:de |del )?(\d{4}))?/))) {
      var mes = MESES.indexOf(m[2]), anio = m[3] ? +m[3] : h.getFullYear();
      var f = new Date(anio, mes, +m[1]);
      if (!m[3] && f < new Date(h.getFullYear(), h.getMonth(), h.getDate() - 60)) f.setFullYear(anio + 1);   // «20 de enero» dicho en diciembre
      return iso(f);
    }
    if ((m = t.match(/\b(\d{1,2})[\/ -](\d{1,2})(?:[\/ -](\d{2,4}))?\b/))) {
      var a = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : h.getFullYear();
      return iso(new Date(a, +m[2] - 1, +m[1]));
    }
    return null;
  }
  function piezas(dicho) {
    var t = cifras(dicho).replace(/\b(al|hasta)\b/g, 'a').replace(/\b(y|coma)\b/g, ',');
    var nums = t.match(/\b[1-8][1-8]\b|\ba\b|,/g) || [], out = '';
    nums.forEach(function (x) { out += x === 'a' ? ' a ' : x === ',' ? ', ' : (out && !/[ ,] ?$/.test(out) ? ', ' : '') + x; });
    return out.replace(/(, )+/g, ', ').replace(/^[, a]+|[, a]+$/g, '').replace(/ ,/g, ',').trim();
  }
  var SINONIMOS_MAT = [[/e ?max|disilicato/, 'Disilicato de litio (e.max)'], [/zirconi/, 'Zirconia'], [/metal ?(y )?porcelana|metal ceramica/, 'Metal-porcelana'], [/porcelana pura|ceramica pura/, 'Porcelana pura'],
    [/resina/, 'Resina compuesta'], [/pmma|provisional/, 'PMMA (provisional)'], [/acrilico/, 'Acrílico'], [/cromo|cobalto/, 'Cromo-cobalto'], [/flexible|valplast|nylon/, 'Nylon flexible (Valplast)'], [/acetato|termoformad/, 'Acetato / termoformado'], [/titanio/, 'Titanio']];
  function color(dicho) {
    var t = cifras(dicho).replace(/\bpunto (\d)\b/, '.$1').replace(/\b(be|ve)\b/g, 'b').replace(/\b(ce|se)\b/g, 'c').replace(/\bde\b/g, 'd');
    if (/no aplica|ninguno|sin color/.test(t)) return '';
    var m = t.match(/\b(bl) ?([12])\b/) || t.match(/\b([abcd]) ?(\d(?:\.5)?)\b/);
    if (!m) return null;
    var v = m[1].toUpperCase() + m[2];
    var o = [].filter.call($('olColor').options, function (x) { return x.value === v || x.value.indexOf(v + ' ') === 0; })[0];
    return o ? o.value : null;
  }
  var IMP = [[/escane|intraoral|digital|stl/, 0], [/silicon/, 1], [/alginat/, 2], [/yeso|modelo/, 3]];
  var ENVIA = [[/yeso|modelos?/, 'Modelos de yeso'], [/impresion fisica|impresiones/, 'Impresión física'], [/stl|escaneo|archivo/, 'Archivo STL / escaneo'], [/mordida/, 'Registro de mordida'],
    [/antagonista/, 'Antagonista'], [/foto/, 'Fotografías'], [/provisional/, 'Provisional'], [/transfer|analogo/, 'Transfer y análogo de implante'], [/protesis anterior|protesis vieja|protesis actual/, 'Prótesis anterior']];
  function signos(t) {
    return t.replace(/\s*\b(punto y aparte|nueva l[ií]nea)\b\s*/gi, '\n').replace(/\s*\bpunto y coma\b\s*/gi, '; ').replace(/\s*\bdos puntos\b\s*/gi, ': ')
      .replace(/\s*\bcoma\b\s*/gi, ', ').replace(/\s*\bpunto\b\s*/gi, '. ').replace(/\s+([,.;:])/g, '$1').trim();
  }

  // Aplica el valor dicho a un campo; devuelve el texto aplicado o null si no se entendió
  function aplicar(campo, dicho) {
    dicho = String(dicho || '').replace(/^[\s,.;:]+|[\s,.;:]+$/g, '');
    if (!dicho) return null;
    var n = normal(dicho), r = null;
    switch (campo) {
      case 'lab':
        r = elegir($('olLab'), dicho);
        if (!r) { $('olLab').value = 'nuevo'; $('olLab').dispatchEvent(new Event('change', { bubbles: true })); poner('olLabNombre', mayus(dicho)); r = 'Nuevo: ' + mayus(dicho); }
        break;
      case 'dent': r = elegir($('olDent'), dicho.replace(/^(el |la )?(doctor[a]?|dr[a]?\.?|odont[oó]log[oa])\s+/i, '')); break;
      case 'trabajo': r = poner('olTrabajo', mejor(lista('olListaTrabajos'), dicho) || mayus(dicho)); break;
      case 'piezas': var pz = piezas(dicho); r = pz ? poner('olPiezas', pz) : null; break;
      case 'material':
        var s = SINONIMOS_MAT.filter(function (x) { return x[0].test(n); })[0];
        r = poner('olMaterial', s ? s[1] : mejor(lista('olListaMat'), dicho) || mayus(dicho)); break;
      case 'color': var c = color(dicho); if (c !== null) { $('olColor').value = c; r = c || 'No aplica'; } break;
      case 'impresion':
        var im = IMP.filter(function (x) { return x[0].test(n); })[0], ops = opcionesDe($('olImpresion'));
        if (im && ops[im[1]]) { $('olImpresion').value = ops[im[1]].value; r = ops[im[1]].textContent; } break;
      case 'envia':
        var hechos = [];
        ENVIA.forEach(function (x) {
          if (!x[0].test(n)) return;
          var cb = document.querySelector('[data-ol-envia][value="' + x[1] + '"]');
          if (cb) { cb.checked = true; hechos.push(x[1]); }
        });
        r = hechos.length ? hechos.join(', ') : null; break;
      case 'ind':
        var el = $('olInd'), v = el.value.replace(/\s+$/, ''), tx = mayus(signos(dicho));
        el.value = v ? v + (/[.\n]$/.test(v) ? ' ' : '. ') + tx : tx; r = tx; break;
      case 'entrega': case 'envio':
        var f = fecha(dicho); if (f) { poner(ID[campo], f); r = new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }); } break;
      case 'costo':
        var mm = dicho.replace(/(\d)[ ,](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d{1,2})?/);
        if (mm) { var q = Number(mm[0].replace(',', '.')); if (/\bmil\b/.test(n) && q < 100) q *= 1000; r = 'Q' + poner('olCosto', q); } break;
      case 'estado': r = elegir($('olEstado'), dicho); break;
      case 'recFecha':
        // «hoy a las 10 30», «ahora», «20 de noviembre a las 3 y 15 de la tarde»
        var t0 = cifras(dicho), d0 = /\bahora\b/.test(t0) ? new Date() : null;
        if (!d0) { var fd = fecha(dicho) || (/\b(a las|las)\b/.test(t0) ? fecha('hoy') : null); if (fd) d0 = new Date(fd + 'T00:00:00'); }
        if (d0 && !/\bahora\b/.test(t0)) {
          var hm = t0.match(/\b(?:a las|las) (\d{1,2})(?:(?::| y | )(\d{1,2}))?(?: (?:y )?(\d{1,2}) segundos?)?/);
          if (hm) { var hh = +hm[1]; if (/tarde|noche|pm|p m/.test(t0) && hh < 12) hh += 12; d0.setHours(hh, hm[2] ? +hm[2] : 0, hm[3] ? +hm[3] : 0); }
        }
        if (d0 && $('olRecFecha')) { var p2 = function (x) { return ('0' + x).slice(-2); }; poner('olRecFecha', iso(d0) + 'T' + p2(d0.getHours()) + ':' + p2(d0.getMinutes()) + ':' + p2(d0.getSeconds())); r = d0.toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
        break;
      case 'recEntrega': if ($('olRecEntrega')) r = poner('olRecEntrega', nombre(dicho)); break;
      case 'recRecibe': if ($('olRecRecibe')) r = poner('olRecRecibe', nombre(dicho)); break;
      case 'recObs':
        if ($('olRecObs')) { var ob = $('olRecObs'), vo = ob.value.replace(/\s+$/, ''), to = mayus(signos(dicho)); ob.value = vo ? vo + (/[.\n]$/.test(vo) ? ' ' : '. ') + to : to; r = to; }
        break;
    }
    if (r !== null && ID[campo] && $(ID[campo])) marcar($(ID[campo]));
    return r;
  }
  function marcar(el) { el.classList.remove('voz-ok'); void el.offsetWidth; el.classList.add('voz-ok'); }

  var rec = null, escuchando = false, campo = null;
  // Corta un fragmento reconocido en «campo valor»; en Indicaciones solo se corta al decir entrega, costo o estado
  function procesar(texto) {
    var orden = null, m = texto.match(RE_FIN);
    if (m) { orden = normal(m[1]); texto = texto.slice(0, m.index); }
    var partes = [], pos = 0, r, actual = campo;
    RE_CAMPO.lastIndex = 0;
    while ((r = RE_CAMPO.exec(texto))) {
      var c = campoDe(r[1]), resto = normal(texto.slice(RE_CAMPO.lastIndex, RE_CAMPO.lastIndex + 12));
      if (!c) continue;
      if ((actual === 'ind' || actual === 'recObs') && ['entrega', 'costo', 'estado', 'recFecha', 'recEntrega', 'recRecibe'].indexOf(c) < 0) continue;
      if (actual === 'envia' && c === 'impresion' && /^fisica/.test(resto)) continue;
      partes.push([actual, texto.slice(pos, r.index)]);
      actual = c; pos = RE_CAMPO.lastIndex;
    }
    partes.push([actual, texto.slice(pos)]);
    partes.forEach(function (p) {
      if (!p[0] || !p[1].trim()) return;
      var hecho = aplicar(p[0], p[1]);
      registro(p[0], hecho, p[1]);
    });
    campo = actual;
    estado();
    if (orden) {
      detener();
      if (/^(grab|guard)/.test(orden)) { if ($('olGrabar')) $('olGrabar').click(); }
      else if (/^cancel/.test(orden)) { var b = document.querySelector('[data-ol-cancelar]'); if (b) b.click(); }
    }
  }
  function registro(c, hecho, dicho) {
    var ul = $('olVozLog'); if (!ul) return;
    ul.insertAdjacentHTML('beforeend', hecho !== null
      ? '<li class="ok"><b>' + esc(NOMBRES[c]) + ':</b> ' + esc(hecho) + '</li>'
      : '<li class="no"><b>' + esc(NOMBRES[c]) + ':</b> no entendí «' + esc(dicho.trim()) + '»</li>');
    $('olVozPanel').hidden = false;
  }
  function estado(parcial) {
    if (!$('olVozOi')) return;
    $('olVozOi').innerHTML = escuchando ? (campo ? 'Escribiendo en <b>' + esc(NOMBRES[campo]) + '</b>' : 'Escuchando…') + (parcial ? ' · «' + esc(parcial) + '»' : '') : '';
    if (escuchando) $('olVozPanel').hidden = false;
  }
  function botones() {
    if ($('olVoz')) { $('olVoz').classList.toggle('escuchando', escuchando); $('olVoz').setAttribute('aria-pressed', escuchando); $('olVozTxt').textContent = escuchando ? 'Escuchando… toca para detener' : 'Dictar orden'; }
  }
  function iniciar() {
    if (!$('olForm')) return;
    campo = null;
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
      if (!$('olVozOi')) return;
      $('olVozPanel').hidden = false;
      $('olVozOi').textContent = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permite el uso del micrófono en el navegador para dictar.'
        : e.error === 'no-speech' ? 'No escuché nada. Toca el micrófono e intenta de nuevo.'
        : e.error === 'audio-capture' ? 'No se encontró un micrófono.' : 'No se pudo usar el micrófono (' + e.error + ').';
    };
    rec.onend = function () { escuchando = false; botones(); estado(); };
    try { rec.start(); escuchando = true; botones(); estado(); } catch (err) { escuchando = false; botones(); }
  }
  function detener() { escuchando = false; if (rec) { try { rec.stop(); } catch (err) { /* ya detenido */ } } botones(); estado(); }

  // Barra de dictado dentro del formulario de la orden (laboratorio.js lo vuelve a pintar en cada apertura)
  function barra() {
    var f = $('olForm');
    if (!f || $('olVoz')) return;
    var pac = f.querySelector('.rc-pac');
    var html = '<div class="hv-barra od-voz ol-voz"><button type="button" id="olVoz" class="cb-voz-btn" aria-pressed="false"' + (Reconocedor ? '' : ' disabled title="El dictado funciona en Chrome o Edge."') + '>' + MIC + '<span id="olVozTxt">Dictar orden</span></button>' +
      '<span class="cb-voz-ayuda">' + (Reconocedor ? 'Di cada dato y su valor: «laboratorio …, trabajo corona unitaria, pieza 36, material zirconia, color A2, impresión escaneo intraoral, se envía modelos de yeso y registro de mordida, entrega 20 de noviembre, costo 450, indicaciones … <b>grabar</b>». Al recibir: «recepción hoy a las 10 30, entregado por Juan, recibido por Ana, observaciones …». Las indicaciones y observaciones, mejor al final.' : 'El dictado por voz funciona en Chrome o Edge.') + '</span>' +
      '<div id="olVozPanel" class="od-voz-panel" hidden><p id="olVozOi" class="hv-parcial"></p><ul id="olVozLog" class="od-voz-log"></ul></div></div>';
    if (pac) pac.insertAdjacentHTML('afterend', html); else f.insertAdjacentHTML('afterbegin', html);
  }
  new MutationObserver(function () { if (!$('olForm') && escuchando) detener(); barra(); }).observe($('olPanel'), { childList: true });

  $('olPanel').addEventListener('click', function (e) {
    if (!e.target.closest('#olVoz')) return;
    if (escuchando) detener(); else iniciar();
  });
  // Botón junto a «+ Nueva orden»: abre una orden nueva y empieza a escuchar
  if (Reconocedor) {
    $('olNueva').insertAdjacentHTML('afterend', '<button type="button" id="olNuevaVoz" class="adm-btn ol-nueva-voz">' + MIC + 'Nueva orden por voz</button>');
    $('olNuevaVoz').addEventListener('click', function () { if (!$('olForm')) $('olNueva').click(); setTimeout(function () { if ($('olForm') && !escuchando) iniciar(); }, 60); });
  }
  window.PD_VOZ_LAB = { procesar: function (t) { if ($('olForm')) procesar(t); } };
})();
