// Plus Dental — Expediente > Tratamientos > Seguimientos.
// A partir de los tratamientos en proceso o finalizados arma el plan de seguimiento del paciente: qué control o
// procedimiento sigue y en qué fecha, con cuidados en casa. Dos métodos sin clave: protocolos clínicos (al instante)
// e IA local en el navegador (la misma de Recetas). Cada paso se puede agendar.
(function () {
  function $(id) { return document.getElementById(id); }
  if (!$('trSeg') || !$('trFiltros')) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function sumar(f, dias) { var d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + dias); return iso(d); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

  // Protocolos de seguimiento: [patrón, [[días, acción], …], cuidados]
  var PROTOCOLOS = [
    [/implante/, [[7, 'Control posoperatorio y retiro de puntos'], [90, 'Control de oseointegración con radiografía'], [120, 'Toma de impresión para la corona sobre implante'], [365, 'Control anual del implante con radiografía']], 'No masticar del lado del implante las primeras semanas; higiene suave con cepillo blando.'],
    [/cordal|tercer molar|cirug/, [[7, 'Control posoperatorio y retiro de puntos'], [30, 'Control de cicatrización']], 'Dieta blanda y fría 48 horas; no fumar ni usar pajilla; frío local las primeras horas.'],
    [/extrac|exodon/, [[7, 'Control de cicatrización'], [60, 'Valorar reposición de la pieza (implante, puente o prótesis)']], 'No enjuagar con fuerza 24 horas; dieta blanda; no fumar.'],
    [/endodon|conducto|pulpect|pulpot/, [[14, 'Restauración definitiva o corona de la pieza tratada'], [180, 'Control radiográfico de la endodoncia'], [365, 'Control radiográfico anual']], 'Evitar morder alimentos duros con la pieza hasta su restauración definitiva.'],
    [/corona|puente|incrustac|carilla|protesis fija/, [[7, 'Control de ajuste de mordida'], [180, 'Revisión de la prótesis y encías']], 'Usar hilo dental o cepillo interdental alrededor de la prótesis.'],
    [/protesis|placa|dentadura/, [[2, 'Control de ajuste y zonas de presión'], [30, 'Revisión de la prótesis'], [365, 'Revisión anual y posible rebase']], 'Retirar la prótesis por la noche y limpiarla a diario.'],
    [/raspado|curetaje|periodon|alisado/, [[42, 'Reevaluación periodontal'], [120, 'Mantenimiento periodontal (cada 3 a 4 meses)']], 'Cepillado 3 veces al día, hilo dental y enjuague indicado.'],
    [/ortodon|bracket|alineador/, [[30, 'Control mensual de ortodoncia']], 'Cepillar después de cada comida; evitar alimentos duros o pegajosos.'],
    [/blanqueam/, [[14, 'Control de color y sensibilidad'], [270, 'Valorar retoque de blanqueamiento']], 'Evitar café, té, vino y alimentos pigmentantes las primeras 48 horas.'],
    [/resina|obtura|amalgama|restaura|ionomero/, [[180, 'Revisión de la restauración']], 'Puede haber sensibilidad leve unos días; si persiste, avisar.'],
    [/limpieza|profilax|detartraje/, [[180, 'Limpieza dental y control semestral']], 'Cepillado 3 veces al día y uso diario de hilo dental.'],
    [/sellante|fluor/, [[180, 'Revisión de sellantes y aplicación de flúor']], 'Cepillado con pasta con flúor dos veces al día.'],
    [/radiograf|evaluac|diagnost|examen/, [[14, 'Presentación del plan de tratamiento']], '']
  ];
  function protocolo(items) {
    var pasos = [], cuidados = [];
    items.forEach(function (i) {
      var t = norm(i.tratamiento), base = i.fecha || hoy();
      var reg = PROTOCOLOS.filter(function (p) { return p[0].test(t); })[0];
      var lista = reg ? reg[1] : [[180, 'Control general de la pieza tratada']];
      lista.forEach(function (x) { pasos.push({ fecha: sumar(base, x[0]), accion: x[1], origen: i.tratamiento + (i.pieza ? ' · pieza ' + i.pieza : ''), dias: x[0] }); });
      if (reg && reg[2] && cuidados.indexOf(reg[2]) < 0) cuidados.push(reg[2]);
    });
    // Controles iguales en la misma fecha se juntan
    var unidos = [];
    pasos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; }).forEach(function (p) {
      var igual = unidos.filter(function (u) { return u.fecha === p.fecha && u.accion === p.accion; })[0];
      if (igual) { if (igual.origen.indexOf(p.origen) < 0) igual.origen += '; ' + p.origen; } else unidos.push(p);
    });
    return { pasos: unidos, cuidados: cuidados, fuente: 'según protocolos' };
  }

  var activo = false, plan = null;
  function items() {
    var T = window.PD_TRATAMIENTOS;
    var lista = T && T.items ? T.items() : [];
    return lista.map(function (i) {
      var f = i.estado_fecha ? iso(new Date(i.estado_fecha)) : i.realizado_en || null;
      return { tratamiento: i.tratamiento, pieza: i.pieza, fecha: f, estado: i.estado || (i.realizado ? 'finalizado' : 'pendiente') };
    });
  }
  function paciente() { var T = window.PD_TRATAMIENTOS; return T && T.paciente ? T.paciente() : null; }

  function estadoPaso(f) {
    var h = hoy(), en30 = sumar(h, 30);
    return f < h ? ['vencido', 'Vencido'] : f <= en30 ? ['proximo', 'Próximo'] : ['futuro', 'Programar'];
  }
  function pintar() {
    var lista = items();
    if (!lista.length) {
      $('trSeg').innerHTML = '<p class="dlg-msg">Aún no hay tratamientos en proceso ni finalizados para armar el plan de seguimiento.</p>';
      return;
    }
    if (!plan) plan = protocolo(lista);
    var ia = window.PD_IA_LOCAL && window.PD_IA_LOCAL.disponible();
    $('trSeg').innerHTML =
      '<div class="tr-seg-cab"><div><b>Plan de seguimiento</b><small>' + lista.length + (lista.length === 1 ? ' tratamiento' : ' tratamientos') + ' · ' + esc(plan.fuente) + '</small></div>' +
      '<div class="tr-seg-acc"><button type="button" class="adm-btn" data-seg-protocolo>Por protocolo</button>' +
      '<button type="button" class="adm-btn adm-primary" data-seg-ia' + (ia ? '' : ' disabled title="La IA local necesita Chrome o Edge actualizados en computadora (WebGPU)"') + '>✦ Generar con IA local</button></div></div>' +
      '<p id="trSegMsg" class="dlg-msg" role="status"></p>' +
      '<div class="roles-wrap"><table class="tr-seg-tabla"><thead><tr><th>Fecha sugerida</th><th>Seguimiento</th><th>Por el tratamiento</th><th>Estado</th><th></th></tr></thead><tbody>' +
      plan.pasos.map(function (p, k) {
        var e = estadoPaso(p.fecha);
        return '<tr><td class="fecha"><b>' + fechaCorta(p.fecha) + '</b></td><td><strong>' + esc(p.accion) + '</strong></td><td><span class="tr-sub">' + esc(p.origen) + '</span></td>' +
          '<td><span class="tr-seg-est ' + e[0] + '">' + e[1] + '</span></td>' +
          '<td><button type="button" class="adm-btn tr-seg-agendar" data-seg-agendar="' + k + '">Agendar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (plan.cuidados.length ? '<div class="tr-seg-cuid"><b>Cuidados en casa</b><ul>' + plan.cuidados.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p class="dlg-msg">Sugerencia ' + esc(plan.fuente) + ': el odontólogo confirma cada control según la evolución del paciente.</p>';
  }

  // IA local (la misma de Recetas): ajusta los pasos y fechas al caso; solo devuelve días y acciones
  async function generarIA(boton) {
    var lista = items(), p = paciente();
    if (!lista.length || !window.PD_IA_LOCAL) return;
    boton.disabled = true;
    var msg = function (t) { if ($('trSegMsg')) $('trSegMsg').textContent = t; };
    try {
      var motor = await window.PD_IA_LOCAL.motor(msg);
      msg('La IA local está armando el plan de seguimiento…');
      var esquema = JSON.stringify({ type: 'object', properties: {
        seguimientos: { type: 'array', items: { type: 'object', properties: { tratamiento: { type: 'string' }, dias: { type: 'integer' }, accion: { type: 'string' } }, required: ['tratamiento', 'dias', 'accion'] } },
        cuidados: { type: 'array', items: { type: 'string' } } }, required: ['seguimientos', 'cuidados'] });
      var r = await motor.chat.completions.create({
        temperature: 0.2, max_tokens: 900, response_format: { type: 'json_object', schema: esquema },
        messages: [
          { role: 'system', content: 'Eres un asistente clínico para odontólogos en Guatemala. Arma el plan de seguimiento de un paciente después de sus tratamientos dentales: para cada tratamiento, los controles o procedimientos siguientes y a cuántos días de la fecha del tratamiento (dias). Acciones breves y concretas en español (máximo 12 palabras). Agrega cuidados en casa cortos. Responde solo en JSON.' },
          { role: 'user', content: 'Paciente: ' + (p && p.fecha_nacimiento ? Math.floor((Date.now() - new Date(p.fecha_nacimiento + 'T12:00:00')) / 31557600000) + ' años' : 'edad no registrada') +
            (p && p.enfermedades ? '; condiciones: ' + p.enfermedades : '') + '\nTratamientos:\n' + lista.map(function (i) { return '- ' + i.tratamiento + (i.pieza ? ' (pieza ' + i.pieza + ')' : '') + ', ' + (i.estado === 'proceso' ? 'en proceso' : 'finalizado') + ' el ' + (i.fecha || hoy()); }).join('\n') +
            '\nReferencia por protocolo: ' + JSON.stringify(protocolo(lista).pasos.map(function (x) { return { tratamiento: x.origen, dias: x.dias, accion: x.accion }; })) }
        ]
      });
      var d = JSON.parse(r.choices[0].message.content || '{}');
      var pasos = [];
      (d.seguimientos || []).forEach(function (s) {
        var dias = parseInt(s.dias, 10), acc = String(s.accion || '').trim().slice(0, 140);
        if (!acc || !(dias >= 0 && dias <= 730)) return;
        var t = norm(s.tratamiento), orig = lista.filter(function (i) { return t && (norm(i.tratamiento).indexOf(t.split(/[\s(]/)[0]) >= 0 || t.indexOf(norm(i.tratamiento).split(' ')[0]) >= 0); })[0] || lista[0];
        pasos.push({ fecha: sumar(orig.fecha || hoy(), dias), accion: acc, origen: orig.tratamiento + (orig.pieza ? ' · pieza ' + orig.pieza : ''), dias: dias });
      });
      if (!pasos.length) throw new Error('La IA no devolvió pasos válidos');
      pasos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      plan = { pasos: pasos, cuidados: (d.cuidados || []).map(function (c) { return String(c).slice(0, 200); }).filter(Boolean).slice(0, 8), fuente: 'de la IA local' };
      pintar();
      msg('Plan generado por la IA local. Revísalo antes de agendar.');
    } catch (err) {
      console.error(err);
      plan = protocolo(lista); pintar();
      msg('No se pudo usar la IA local en este equipo (' + (err && err.message ? err.message.slice(0, 100) : 'error') + '). Se muestra el plan por protocolo.');
    }
  }

  function imprimir() {
    var imp = window.PD_IMPRESION, p = paciente();
    if (!imp || !p || !plan) return;
    var celda = 'padding:7px 6px;border-bottom:1px solid #D9E4EC;text-align:left;vertical-align:top';
    imp.imprimir(imp.encabezado('Plan de seguimiento') +
      '<div style="background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13.5px"><b>' + esc(p.nombre) + '</b>' + (p.dpi ? ' · DPI ' + esc(p.dpi) : '') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>' + ['Fecha sugerida', 'Seguimiento', 'Por el tratamiento'].map(function (h) { return '<th style="' + celda + ';background:#0B2B40;color:#FFFFFF;font-size:10.5px;text-transform:uppercase">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      plan.pasos.map(function (x) { return '<tr><td style="' + celda + ';white-space:nowrap"><b>' + fechaCorta(x.fecha) + '</b></td><td style="' + celda + '">' + esc(x.accion) + '</td><td style="' + celda + ';color:#475B68">' + esc(x.origen) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (plan.cuidados.length ? '<div style="margin-top:16px;font-size:13px"><b>Cuidados en casa</b><ul style="margin:6px 0 0;padding-left:18px">' + plan.cuidados.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p style="margin-top:18px;font-size:11.5px;color:#5A6D7A">Fechas sugeridas; el odontólogo las confirma según la evolución. Para agendar: WhatsApp +502 3756-5739.</p></div>');
  }

  // ---------- Acciones del paciente: qué hacer para recuperarse (dirigido al paciente) ----------
  // [patrón, hacer, evitar, señales de alarma]
  var ACCIONES = [
    [/implante/, ['Aplique frío en la cara 15 minutos cada hora durante el primer día.', 'Coma blando y frío los primeros días, del lado contrario al implante.', 'Cepíllese con cepillo suave y haga los enjuagues indicados desde el día siguiente.'],
      ['No fume ni tome alcohol durante al menos 2 semanas.', 'No mastique alimentos duros sobre el implante.'], ['Sangrado que no para', 'Hinchazón que aumenta después del tercer día', 'Fiebre', 'Movilidad del implante']],
    [/cordal|tercer molar|cirug|extrac|exodon/, ['Muerda la gasa 30 a 45 minutos después del procedimiento.', 'Aplique frío en la cara las primeras 24 horas (15 minutos sí, 15 no).', 'Coma blando y frío los primeros 2 días y tome bastante agua.', 'Duerma con la cabeza un poco elevada la primera noche.'],
      ['No escupa, no se enjuague con fuerza y no use pajilla las primeras 24 horas.', 'No fume ni tome alcohol al menos 3 días.', 'No se toque la herida con la lengua ni con los dedos.'], ['Sangrado abundante después de 24 horas', 'Dolor intenso que aumenta al tercer día', 'Mal olor o mal sabor fuerte', 'Fiebre o hinchazón que crece']],
    [/endodon|conducto|pulpect|pulpot/, ['Tome los analgésicos indicados si hay molestia; es normal sentir sensibilidad al morder unos días.', 'Mastique del lado contrario hasta que la pieza tenga su restauración definitiva.', 'Asista a la cita para la corona o restauración final.'],
      ['No muerda alimentos duros (hielo, nueces, caramelos) con la pieza tratada.'], ['Hinchazón en la encía o la cara', 'Dolor fuerte que no cede con el analgésico', 'Se cae o rompe la curación provisional']],
    [/corona|puente|incrustac|carilla/, ['Use hilo dental o cepillo interdental alrededor de la prótesis todos los días.', 'Si la mordida se siente alta, avise para ajustarla.'],
      ['Evite alimentos muy pegajosos las primeras 24 horas.', 'No muerda objetos duros (uñas, lapiceros, hielo).'], ['La corona se mueve o se despega', 'Dolor al morder que no mejora en una semana']],
    [/protesis|placa|dentadura/, ['Retire la prótesis por la noche y déjela en agua limpia.', 'Lávela a diario con cepillo y jabón neutro.', 'Comience con alimentos blandos cortados en trozos pequeños.'],
      ['No la limpie con agua caliente ni cloro.'], ['Llagas o zonas de presión que no sanan en una semana']],
    [/raspado|curetaje|periodon|alisado/, ['Haga los enjuagues de clorhexidina indicados.', 'Cepíllese 3 veces al día con cepillo suave y use hilo dental.'],
      ['No fume: retrasa la curación de las encías.', 'Evite alimentos muy calientes o picantes 2 días.'], ['Sangrado que no para', 'Encía muy inflamada o con pus']],
    [/ortodon|bracket|alineador/, ['Cepíllese después de cada comida y use cepillo interdental.', 'Use cera de ortodoncia si algún bracket lastima.'],
      ['Evite alimentos duros o pegajosos (chicle, caramelos, elotes enteros).'], ['Se despega un bracket o un alambre lastima']],
    [/blanqueam/, ['Use pasta para dientes sensibles si hay sensibilidad.'],
      ['Durante 48 horas evite café, té, vino, refrescos de cola, salsas oscuras y tabaco.'], ['Sensibilidad muy fuerte que no baja en 3 días']],
    [/resina|obtura|amalgama|restaura|ionomero/, ['Puede comer cuando pase la anestesia (cuidado de no morderse la mejilla).', 'Es normal un poco de sensibilidad al frío unos días.'],
      ['Evite morder objetos duros con la pieza restaurada.'], ['Sensibilidad o dolor que dura más de 2 semanas', 'La restauración se siente alta al morder']],
    [/limpieza|profilax|detartraje/, ['Cepíllese 3 veces al día y use hilo dental a diario.', 'Puede haber sensibilidad leve 1 o 2 días.'],
      ['Evite fumar y bebidas muy pigmentadas las primeras horas.'], []],
    [/sellante|fluor/, ['Siga cepillándose con pasta con flúor.'], ['No coma ni beba 30 minutos después del flúor.'], []]
  ];
  function accionesProtocolo(lista) {
    var hacer = [], evitar = [], alarma = [];
    function add(arr, x) { x.forEach(function (v) { if (arr.indexOf(v) < 0) arr.push(v); }); }
    lista.forEach(function (i) {
      var t = norm(i.tratamiento), reg = ACCIONES.filter(function (a) { return a[0].test(t); })[0];
      if (reg) { add(hacer, reg[1]); add(evitar, reg[2]); add(alarma, reg[3]); }
    });
    if (!hacer.length) add(hacer, ['Cepíllese 3 veces al día y use hilo dental.', 'Asista a sus controles programados.']);
    add(hacer, ['Tome los medicamentos de su receta tal como se le indicó.']);
    return { hacer: hacer, evitar: evitar, alarma: alarma, mensaje: '', fuente: 'según protocolos' };
  }
  var acciones = null;
  function nombreCorto() { var p = paciente(); return p ? String(p.nombre).split(' ')[0] : ''; }
  function textoWhatsApp() {
    var a = acciones, lista = items();
    return 'Hola ' + nombreCorto() + ', le escribimos de Plus Dental. Después de su tratamiento (' + lista.map(function (i) { return i.tratamiento; }).join(', ') + '):\n\n' +
      (a.mensaje ? a.mensaje + '\n\n' : '') +
      'Qué hacer:\n' + a.hacer.map(function (x) { return '• ' + x; }).join('\n') +
      (a.evitar.length ? '\n\nQué evitar:\n' + a.evitar.map(function (x) { return '• ' + x; }).join('\n') : '') +
      (a.alarma.length ? '\n\nLlámenos si tiene: ' + a.alarma.join(', ') + '.' : '') + '\n\nCualquier duda, escríbanos por este medio.';
  }
  function telWa(t) { var n = String(t || '').replace(/\D/g, ''); if (n.length === 8) n = '502' + n; return n; }
  function pintarAcciones() {
    var lista = items(), p = paciente();
    if (!lista.length) { $('trSeg').innerHTML = '<p class="dlg-msg">Aún no hay tratamientos en proceso ni finalizados para sugerir acciones al paciente.</p>'; return; }
    if (!acciones) acciones = accionesProtocolo(lista);
    var ia = window.PD_IA_LOCAL && window.PD_IA_LOCAL.disponible(), tel = p ? telWa(p.telefono) : '';
    function bloque(clase, titulo, arr) { return arr.length ? '<div class="tr-acc-b ' + clase + '"><b>' + titulo + '</b><ul>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : ''; }
    $('trSeg').innerHTML =
      '<div class="tr-seg-cab"><div><b>Acciones del paciente para su recuperación</b><small>' + esc(lista.map(function (i) { return i.tratamiento; }).join(', ')) + ' · ' + esc(acciones.fuente) + '</small></div>' +
      '<div class="tr-seg-acc"><button type="button" class="adm-btn" data-acc-protocolo>Por protocolo</button>' +
      '<button type="button" class="adm-btn adm-primary" data-acc-ia' + (ia ? '' : ' disabled title="La IA local necesita Chrome o Edge actualizados en computadora (WebGPU)"') + '>✦ Generar con IA local</button></div></div>' +
      '<p id="trSegMsg" class="dlg-msg" role="status"></p>' +
      (acciones.mensaje ? '<p class="tr-acc-msg">' + esc(acciones.mensaje) + '</p>' : '') +
      '<div class="tr-acc-grid">' + bloque('si', '✓ Qué hacer', acciones.hacer) + bloque('no', '✕ Qué evitar', acciones.evitar) + bloque('alerta', '⚠ Llame a la clínica si tiene', acciones.alarma) + '</div>' +
      '<div class="tr-seg-acc">' + (tel ? '<a class="adm-btn adm-primary" target="_blank" rel="noopener" href="https://wa.me/' + tel + '?text=' + encodeURIComponent(textoWhatsApp()) + '">Enviar al paciente por WhatsApp</a>' : '<span class="dlg-msg">El paciente no tiene teléfono registrado para enviarlo por WhatsApp.</span>') + '</div>' +
      '<p class="dlg-msg">Sugerencia ' + esc(acciones.fuente) + ': revísala antes de entregarla al paciente.</p>';
  }
  async function generarAccionesIA(boton) {
    var lista = items(), p = paciente();
    if (!lista.length || !window.PD_IA_LOCAL) return;
    boton.disabled = true;
    var msg = function (t) { if ($('trSegMsg')) $('trSegMsg').textContent = t; };
    var base = accionesProtocolo(lista);
    try {
      var motor = await window.PD_IA_LOCAL.motor(msg);
      msg('La IA local está preparando las recomendaciones para el paciente…');
      var esquema = JSON.stringify({ type: 'object', properties: { mensaje: { type: 'string' }, hacer: { type: 'array', items: { type: 'string' } }, evitar: { type: 'array', items: { type: 'string' } }, alarma: { type: 'array', items: { type: 'string' } } }, required: ['mensaje', 'hacer', 'evitar', 'alarma'] });
      var r = await motor.chat.completions.create({
        temperature: 0.3, max_tokens: 900, response_format: { type: 'json_object', schema: esquema },
        messages: [
          { role: 'system', content: 'Eres un asistente de una clínica dental en Guatemala. Escribe recomendaciones de recuperación DIRIGIDAS AL PACIENTE, tratándolo de usted, en español sencillo y amable. «mensaje»: 1 o 2 oraciones de ánimo y resumen. «hacer»: acciones concretas para recuperarse. «evitar»: lo que no debe hacer. «alarma»: señales por las que debe llamar a la clínica. Frases cortas. No recetes medicamentos nuevos ni des dosis: solo «tome los medicamentos de su receta». Responde solo en JSON.' },
          { role: 'user', content: 'Paciente' + (p && p.fecha_nacimiento ? ' de ' + Math.floor((Date.now() - new Date(p.fecha_nacimiento + 'T12:00:00')) / 31557600000) + ' años' : '') + (p && p.enfermedades ? ' con: ' + p.enfermedades : '') +
            '.\nTratamientos realizados:\n' + lista.map(function (i) { return '- ' + i.tratamiento + (i.pieza ? ' (pieza ' + i.pieza + ')' : '') + ', ' + (i.estado === 'proceso' ? 'en proceso' : 'finalizado') + ' el ' + (i.fecha || hoy()); }).join('\n') +
            '\nReferencia por protocolo: ' + JSON.stringify({ hacer: base.hacer, evitar: base.evitar, alarma: base.alarma }) }
        ]
      });
      var d = JSON.parse(r.choices[0].message.content || '{}');
      function limpia(a) { return (a || []).map(function (x) { return String(x).trim().slice(0, 220); }).filter(Boolean).slice(0, 10); }
      var hacer = limpia(d.hacer);
      if (!hacer.length) throw new Error('La IA no devolvió recomendaciones');
      acciones = { hacer: hacer, evitar: limpia(d.evitar), alarma: limpia(d.alarma).length ? limpia(d.alarma) : base.alarma, mensaje: String(d.mensaje || '').slice(0, 300), fuente: 'de la IA local' };
      pintarAcciones();
      msg('Recomendaciones generadas por la IA local. Revísalas antes de enviarlas.');
    } catch (err) {
      console.error(err);
      acciones = base; pintarAcciones();
      msg('No se pudo usar la IA local en este equipo (' + (err && err.message ? err.message.slice(0, 100) : 'error') + '). Se muestran las acciones por protocolo.');
    }
  }
  function imprimirAcciones() {
    var imp = window.PD_IMPRESION, p = paciente(), a = acciones;
    if (!imp || !p || !a) return;
    function lista(titulo, color, arr) { return arr.length ? '<div style="break-inside:avoid;margin-top:14px"><div style="font-weight:800;color:' + color + ';font-size:14px;margin-bottom:4px">' + titulo + '</div><ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.6">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : ''; }
    imp.imprimir(imp.encabezado('Indicaciones para su recuperación') +
      '<div style="background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;font-size:13.5px"><b>' + esc(p.nombre) + '</b><br><span style="color:#475B68">Tratamientos: ' + esc(items().map(function (i) { return i.tratamiento + (i.pieza ? ' (pieza ' + i.pieza + ')' : ''); }).join(', ')) + '</span></div>' +
      (a.mensaje ? '<p style="font-size:14px;margin:14px 0 0">' + esc(a.mensaje) + '</p>' : '') +
      lista('✓ Qué hacer', '#08504C', a.hacer) + lista('✕ Qué evitar', '#9F1239', a.evitar) + lista('⚠ Llame a la clínica si tiene', '#92400E', a.alarma) +
      '<p style="margin-top:22px;font-size:12px;color:#5A6D7A">Dudas o urgencias: WhatsApp +502 3756-5739 · Reforma Montúfar, zona 10.</p></div>');
  }

  // ---------- Modo de la pestaña: tabla, Seguimientos o Acciones del paciente ----------
  function activar(modo) {
    activo = modo || false;
    var tabla = $('trBody').closest('.roles-wrap');
    if (tabla) tabla.hidden = !!activo;
    $('trSeg').hidden = !activo;
    $('trSegBtn').setAttribute('aria-pressed', activo === 'seg');
    $('trAccBtn').setAttribute('aria-pressed', activo === 'acc');
    if (activo) {
      document.querySelectorAll('#trFiltros [data-trfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      if (activo === 'seg') { plan = null; pintar(); } else { acciones = null; pintarAcciones(); }
    }
  }
  $('trFiltros').addEventListener('click', function (e) {
    if (e.target.closest('#trSegBtn')) { activar('seg'); return; }
    if (e.target.closest('#trAccBtn')) { activar('acc'); return; }
    if (e.target.closest('[data-trfiltro]') && activo) activar(false);
  });
  $('trSeg').addEventListener('click', function (e) {
    if (e.target.closest('[data-seg-protocolo]')) { plan = protocolo(items()); pintar(); return; }
    var b = e.target.closest('[data-seg-ia]');
    if (b) { generarIA(b); return; }
    if (e.target.closest('[data-acc-protocolo]')) { acciones = accionesProtocolo(items()); pintarAcciones(); return; }
    var ai = e.target.closest('[data-acc-ia]');
    if (ai) { generarAccionesIA(ai); return; }
    var ag = e.target.closest('[data-seg-agendar]');
    if (ag && plan) {
      var paso = plan.pasos[+ag.dataset.segAgendar], p = paciente();
      if (paso && p && window.PD_AGENDA && window.PD_AGENDA.preparar) window.PD_AGENDA.preparar({ pacienteId: p.id, tratamiento: paso.accion, fecha: paso.fecha < hoy() ? hoy() : paso.fecha });
    }
  });
  // Con Seguimientos o Acciones activo, «Imprimir» imprime eso
  $('trImprimir').addEventListener('click', function (e) {
    if (!activo) return;
    e.stopImmediatePropagation();
    if (activo === 'seg') imprimir(); else imprimirAcciones();
  }, true);
  window.PD_SEGUIMIENTOS = {
    reiniciar: function () { if (activo) activar(false); plan = null; acciones = null; },
    // Al cambiar la fecha se rehace el plan o las acciones con los tratamientos de esa fecha
    refrescar: function () { if (activo) activar(activo); }
  };
})();
