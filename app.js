// Plus Dental — interacción de la página (asistente, agenda y preguntas frecuentes)
(function () {
  var WHATSAPP = '50237565739';
  var DARK = '#0B2B40', LINE = '#C4D4DF';
  var sb = window.PD_SB || null;
  // Horarios reales desde Supabase: { 'AAAA-MM-DD': [{ hora: '09:30', libre: true }] }.
  // Si no se pueden cargar, la agenda ofrece los horarios fijos y envía la solicitud por WhatsApp.
  var avail = null;

  var state = { concern: 'dolor', service: 'Evaluación general', day: 0, time: '09:30', faq: 0 };

  var recs = {
    dolor: { title: 'Evaluación de urgencia y endodoncia', short: 'evaluación de urgencia', text: 'Ubicamos la causa del dolor con examen clínico y radiografía digital. Si el nervio está comprometido, el tratamiento de conductos elimina el dolor y conserva tu pieza.', time: '60–90 min', visits: '1–2', service: 'Urgencia / dolor' },
    estetica: { title: 'Blanqueamiento y diseño de sonrisa', short: 'estética dental', text: 'Aclaramos el tono de tus dientes de forma segura y, si lo deseas, simulamos carillas para ver el resultado antes de comenzar.', time: '60–120 min', visits: '1–3', service: 'Estética' },
    alineacion: { title: 'Ortodoncia con alineadores', short: 'ortodoncia', text: 'Corregimos la posición de tus dientes con alineadores transparentes o brackets estéticos, con un plan digital de cada etapa.', time: '6–18 meses', visits: 'Mensuales', service: 'Ortodoncia' },
    faltante: { title: 'Implantes dentales', short: 'valoración de implantes', text: 'Reponemos piezas perdidas con implantes fijos, planificados con imagen 3D para una colocación precisa y natural.', time: '3–6 meses', visits: '3–5', service: 'Implantes' },
    encias: { title: 'Tratamiento de encías', short: 'periodoncia', text: 'Si tus encías sangran o están inflamadas, una limpieza profunda y control periódico detienen el avance y protegen tus dientes.', time: '45–60 min', visits: '2–4', service: 'Limpieza' },
    revision: { title: 'Limpieza y chequeo preventivo', short: 'limpieza', text: 'Revisión completa, limpieza profesional y recomendaciones personalizadas. Ideal cada seis meses.', time: '45 min', visits: '1', service: 'Limpieza' }
  };
  var concernList = [
    ['dolor', 'Dolor o sensibilidad'], ['estetica', 'Quiero dientes más blancos'],
    ['alineacion', 'Dientes torcidos'], ['faltante', 'Me falta una pieza'],
    ['encias', 'Encías que sangran'], ['revision', 'Solo un chequeo']
  ];
  var serviceList = ['Evaluación general', 'Limpieza', 'Urgencia / dolor', 'Estética', 'Ortodoncia', 'Implantes'];
  var faqList = [
    ['¿Cuánto cuesta la primera evaluación?', '[PRECIO DE EVALUACIÓN]. Incluye revisión clínica, diagnóstico y un plan de tratamiento por escrito.'],
    ['¿Aceptan seguros o pagos en cuotas?', '[DETALLE DE SEGUROS Y FINANCIAMIENTO]. Te explicamos todas las opciones antes de iniciar cualquier tratamiento.'],
    ['¿Atienden urgencias?', '[POLÍTICA DE URGENCIAS]. Si tienes dolor intenso, escríbenos por WhatsApp al +502 3756-5739 para buscarte el espacio más cercano.'],
    ['¿Qué pasa si necesito cambiar mi cita?', 'Puedes reprogramar sin costo avisando con al menos [HORAS] horas de anticipación.']
  ];
  var wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // Próximos 6 días hábiles (sin domingos)
  var dayDates = [];
  var d = new Date();
  while (dayDates.length < 6) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (d.getDay() !== 0) dayDates.push(d);
  }

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pill(on) {
    return on ? 'background:' + DARK + ';color:#FFFFFF;border:1px solid ' + DARK + ';'
              : 'background:#FFFFFF;color:' + DARK + ';border:1px solid ' + LINE + ';';
  }
  function iso(x) { return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
  function slotsDe(i) {
    if (avail) return avail[iso(dayDates[i])] || [];
    var fijos = dayDates[i].getDay() === 6 ? ['08:00', '09:30', '11:00'] : ['08:00', '09:30', '11:00', '14:00', '15:30', '17:00'];
    return fijos.map(function (h) { return { hora: h, libre: true }; });
  }
  function slots() { return slotsDe(state.day); }
  function libre(t) { return slots().some(function (s) { return s.hora === t && s.libre; }); }
  function primerLibre() { var s = slots().filter(function (x) { return x.libre; })[0]; return s ? s.hora : ''; }
  function fechaTexto() { var dd = dayDates[state.day]; return wd[dd.getDay()] + ' ' + dd.getDate(); }
  function summary() {
    return state.service + ' · ' + fechaTexto() + ' · ' + (state.time || 'elige una hora');
  }
  function bookMsg(texto, error) {
    $('bookMsg').hidden = !texto;
    $('bookMsg').textContent = texto || '';
    $('bookMsg').style.color = error ? '#9A3B2E' : '#475B68';
  }

  // Próximo horario libre (tarjeta de la portada)
  function pintarProximo() {
    for (var i = 0; i < dayDates.length; i++) {
      var s = slotsDe(i).filter(function (x) { return x.libre; })[0];
      if (s) { $('firstDay').textContent = wd[dayDates[i].getDay()] + ' ' + dayDates[i].getDate() + ' · ' + s.hora; return; }
    }
    $('firstDay').textContent = 'Consúltanos por WhatsApp';
  }

  async function cargarDisponibilidad() {
    if (!sb) return;
    var r = await sb.rpc('disponibilidad', { desde: iso(dayDates[0]), hasta: iso(dayDates[dayDates.length - 1]) });
    if (r.error) { console.warn('Plus Dental: no se pudo leer la disponibilidad', r.error.message); return; }
    avail = {};
    r.data.forEach(function (x) { (avail[x.fecha] = avail[x.fecha] || []).push({ hora: x.hora, libre: x.libre }); });
    if (!libre(state.time)) state.time = primerLibre();
    pintarProximo();
    render();
  }

  function render() {
    $('concerns').innerHTML = concernList.map(function (c, i) {
      var on = state.concern === c[0];
      var st = 'display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;padding:20px;min-height:104px;border-radius:18px;cursor:pointer;font:inherit;' +
        (on ? 'background:#FFFFFF;color:#0B2B40;border:1px solid #FFFFFF;' : 'background:transparent;color:#FFFFFF;border:1px solid rgba(255,255,255,.28);');
      return '<button type="button" data-concern="' + c[0] + '" aria-pressed="' + on + '" style="' + st + '">' +
        '<span style="font-size:12px;opacity:.7;letter-spacing:1px">0' + (i + 1) + '</span>' +
        '<span style="font-size:17px;font-weight:600;line-height:1.3">' + esc(c[1]) + '</span></button>';
    }).join('');

    var rec = recs[state.concern];
    document.querySelectorAll('[data-rec]').forEach(function (el) { el.textContent = rec[el.getAttribute('data-rec')]; });

    $('services').innerHTML = serviceList.map(function (s) {
      var on = state.service === s;
      return '<button type="button" data-service="' + esc(s) + '" aria-pressed="' + on + '" style="font:inherit;font-size:14px;font-weight:600;padding:10px 16px;min-height:44px;border-radius:999px;cursor:pointer;' + pill(on) + '">' + esc(s) + '</button>';
    }).join('');

    $('days').innerHTML = dayDates.map(function (x, i) {
      var on = state.day === i;
      return '<button type="button" data-day="' + i + '" aria-pressed="' + on + '" style="display:flex;flex-direction:column;align-items:center;gap:2px;font:inherit;padding:10px 0;min-height:60px;border-radius:14px;cursor:pointer;' + pill(on) + '">' +
        '<span style="font-size:12px;text-transform:uppercase;letter-spacing:1px">' + wd[x.getDay()] + '</span>' +
        '<span style="font-size:20px;font-weight:700">' + x.getDate() + '</span></button>';
    }).join('');

    var lista = slots();
    $('times').innerHTML = !lista.some(function (s) { return s.libre; })
      ? '<p style="grid-column:1/-1;margin:0;padding:12px 0;font-size:15px;color:#5A6D7A">No quedan horarios libres este día. Elige otro día o escríbenos por WhatsApp.</p>'
      : lista.map(function (s) {
        var on = state.time === s.hora;
        if (!s.libre) {
          return '<button type="button" disabled title="Ocupado" aria-label="' + s.hora + ', ocupado" style="font:inherit;font-size:15px;font-weight:600;padding:10px 0;min-height:44px;border-radius:12px;cursor:not-allowed;background:#EEF5FA;color:#94A6B2;border:1px solid #E2EEF6;text-decoration:line-through">' + s.hora + '</button>';
        }
        return '<button type="button" data-time="' + s.hora + '" aria-pressed="' + on + '" style="font:inherit;font-size:15px;font-weight:600;padding:10px 0;min-height:44px;border-radius:12px;cursor:pointer;' + pill(on) + '">' + s.hora + '</button>';
      }).join('');

    document.querySelectorAll('.summary').forEach(function (el) { el.textContent = summary(); });

    $('faqs').innerHTML = faqList.map(function (f, i) {
      var open = state.faq === i;
      return '<div style="border-bottom:1px solid #D9E4EC">' +
        '<button type="button" data-faq="' + i + '" aria-expanded="' + open + '" style="width:100%;background:transparent;border:0;padding:24px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;font:inherit;font-size:19px;font-weight:600;color:#0B2B40;text-align:left;cursor:pointer;min-height:44px">' +
        esc(f[0]) + '<span aria-hidden="true" style="font-size:26px;font-weight:400;color:#005A87">' + (open ? '−' : '+') + '</span></button>' +
        (open ? '<p style="margin:0;padding:0 0 24px;font-size:16px;line-height:1.7;color:#475B68;max-width:720px">' + esc(f[1]) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-concern],button[data-service],button[data-day],button[data-time],button[data-faq]');
    if (!b) return;
    if (b.dataset.concern) state.concern = b.dataset.concern;
    if (b.dataset.service) state.service = b.dataset.service;
    if (b.dataset.day) {
      state.day = +b.dataset.day;
      if (!libre(state.time)) state.time = primerLibre();
    }
    if (b.dataset.time) state.time = b.dataset.time;
    if (b.dataset.faq) { var i = +b.dataset.faq; state.faq = state.faq === i ? -1 : i; }
    render();
  });

  $('bookRec').addEventListener('click', function () {
    state.service = recs[state.concern].service;
    $('formView').hidden = false; $('doneView').hidden = true;
    render();
  });

  // Confirmar: registra la cita en Supabase; si la agenda en línea no está disponible, abre WhatsApp
  $('confirmBtn').addEventListener('click', async function () {
    var btn = this;
    var nombre = $('bookName').value.trim(), tel = $('bookPhone').value.trim();
    if (!state.time) { bookMsg('Elige una hora libre.', true); return; }
    var resumen = summary();
    var msg = 'Hola Plus Dental, quiero agendar una cita.\n' +
      'Servicio: ' + state.service + '\nFecha y hora: ' + fechaTexto() + ' · ' + state.time +
      (nombre ? '\nNombre: ' + nombre : '') + (tel ? '\nTeléfono: ' + tel : '');
    $('waDone').href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg);

    if (avail) {
      if (!nombre || !tel) { bookMsg('Escribe tu nombre y tu WhatsApp para registrar la cita.', true); return; }
      btn.disabled = true;
      bookMsg('Registrando tu cita…');
      var r = await sb.rpc('solicitar_cita', { p_fecha: iso(dayDates[state.day]), p_hora: state.time, p_servicio: state.service, p_nombre: nombre, p_telefono: tel });
      btn.disabled = false;
      if (r.error) {
        bookMsg(/disponible/i.test(r.error.message) ? 'Ese horario se acaba de ocupar. Elige otro, por favor.' : 'No se pudo registrar la cita: ' + r.error.message, true);
        cargarDisponibilidad();
        return;
      }
      $('doneText').textContent = 'Registramos tu solicitud. Te escribiremos por WhatsApp para confirmarla.';
      cargarDisponibilidad();
    } else {
      window.open($('waDone').href, '_blank');
      $('doneText').textContent = 'Te escribiremos por WhatsApp para confirmar tu cita.';
    }
    bookMsg('');
    $('doneSummary').textContent = resumen;
    $('formView').hidden = true; $('doneView').hidden = false;
  });
  $('resetBtn').addEventListener('click', function () {
    $('formView').hidden = false; $('doneView').hidden = true;
  });

  // La barra se compacta un poco al bajar por la página (el eslogan sigue visible)
  var barra = document.querySelector('.topbar');
  function compactarBarra() { barra.classList.toggle('compacta', window.scrollY > 40); }
  window.addEventListener('scroll', compactarBarra, { passive: true });
  compactarBarra();

  // Menú principal: botón para pantallas pequeñas
  var menu = $('mainMenu'), menuBtn = $('menuBtn');
  function setMenu(open) {
    menu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open);
  }
  menuBtn.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a,button')) setMenu(false); });

  // Equipo en la sección «Nosotros»: dentistas activos marcados para la página pública
  async function cargarEquipo() {
    if (!sb) return;
    var r = await sb.rpc('equipo_publico');
    if (r.error || !r.data || !r.data.length) return;
    var hoy = new Date();
    $('equipo').innerHTML = r.data.map(function (d) {
      var foto = d.foto_publica ? sb.storage.from('publico').getPublicUrl(d.foto_publica).data.publicUrl + '?v=' + encodeURIComponent(d.actualizado || '') : '';
      var anios = null;
      if (d.inicio_profesion) {
        var p = d.inicio_profesion.split('-'), ini = new Date(+p[0], p[1] - 1, +p[2]);
        anios = hoy.getFullYear() - ini.getFullYear() - ((hoy.getMonth() < ini.getMonth() || (hoy.getMonth() === ini.getMonth() && hoy.getDate() < ini.getDate())) ? 1 : 0);
      }
      var iniciales = d.nombre.trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join('');
      return '<article class="eq-card"><div class="eq-foto">' + (foto ? '<img src="' + esc(foto) + '" alt="' + esc(d.nombre) + '" loading="lazy">' : esc(iniciales)) + '</div>' +
        '<div class="eq-info"><h4>' + esc(d.nombre) + '</h4>' +
        ((d.especialidades || []).length ? '<span class="eq-esp">' + esc(d.especialidades.join(' · ')) + '</span>' : '') +
        '<span class="eq-meta">' + [d.colegiado ? 'Colegiado N.º ' + esc(d.colegiado) : '', anios > 0 ? anios + (anios === 1 ? ' año' : ' años') + ' de experiencia' : ''].filter(Boolean).join(' · ') + '</span>' +
        '</div></article>';
    }).join('');
    $('equipoWrap').hidden = false;
  }

  pintarProximo();
  render();
  cargarDisponibilidad();
  cargarEquipo();
})();
