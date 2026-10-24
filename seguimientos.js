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

  function activar(si) {
    activo = si;
    var tabla = $('trBody').closest('.roles-wrap');
    if (tabla) tabla.hidden = si;
    $('trSeg').hidden = !si;
    $('trSegBtn').setAttribute('aria-pressed', si);
    if (si) {
      document.querySelectorAll('#trFiltros [data-trfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      plan = null; pintar();
    }
  }
  $('trFiltros').addEventListener('click', function (e) {
    if (e.target.closest('#trSegBtn')) { activar(true); return; }
    if (e.target.closest('[data-trfiltro]') && activo) activar(false);
  });
  $('trSeg').addEventListener('click', function (e) {
    if (e.target.closest('[data-seg-protocolo]')) { plan = protocolo(items()); pintar(); return; }
    var b = e.target.closest('[data-seg-ia]');
    if (b) { generarIA(b); return; }
    var ag = e.target.closest('[data-seg-agendar]');
    if (ag && plan) {
      var paso = plan.pasos[+ag.dataset.segAgendar], p = paciente();
      if (paso && p && window.PD_AGENDA && window.PD_AGENDA.preparar) window.PD_AGENDA.preparar({ pacienteId: p.id, tratamiento: paso.accion, fecha: paso.fecha < hoy() ? hoy() : paso.fecha });
    }
  });
  // Con Seguimientos activo, «Imprimir» imprime el plan
  $('trImprimir').addEventListener('click', function (e) { if (activo) { e.stopImmediatePropagation(); imprimir(); } }, true);
  window.PD_SEGUIMIENTOS = { reiniciar: function () { if (activo) activar(false); plan = null; } };
})();
