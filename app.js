// Plus Dental — interacción de la página (asistente, agenda y preguntas frecuentes)
(function () {
  var WHATSAPP = '50237565739';
  var DARK = '#0F2A2E', LINE = '#C9D4D2';

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
  function times() {
    return dayDates[state.day].getDay() === 6 ? ['08:00', '09:30', '11:00'] : ['08:00', '09:30', '11:00', '14:00', '15:30', '17:00'];
  }
  function summary() {
    var dd = dayDates[state.day];
    return state.service + ' · ' + wd[dd.getDay()] + ' ' + dd.getDate() + ' · ' + state.time;
  }

  function render() {
    $('concerns').innerHTML = concernList.map(function (c, i) {
      var on = state.concern === c[0];
      var st = 'display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;padding:20px;min-height:104px;border-radius:18px;cursor:pointer;font:inherit;' +
        (on ? 'background:#FFFFFF;color:#0F2A2E;border:1px solid #FFFFFF;' : 'background:transparent;color:#FFFFFF;border:1px solid rgba(255,255,255,.28);');
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

    $('times').innerHTML = times().map(function (t) {
      var on = state.time === t;
      return '<button type="button" data-time="' + t + '" aria-pressed="' + on + '" style="font:inherit;font-size:15px;font-weight:600;padding:10px 0;min-height:44px;border-radius:12px;cursor:pointer;' + pill(on) + '">' + t + '</button>';
    }).join('');

    document.querySelectorAll('.summary').forEach(function (el) { el.textContent = summary(); });

    $('faqs').innerHTML = faqList.map(function (f, i) {
      var open = state.faq === i;
      return '<div style="border-bottom:1px solid #DCE3E1">' +
        '<button type="button" data-faq="' + i + '" aria-expanded="' + open + '" style="width:100%;background:transparent;border:0;padding:24px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;font:inherit;font-size:19px;font-weight:600;color:#0F2A2E;text-align:left;cursor:pointer;min-height:44px">' +
        esc(f[0]) + '<span aria-hidden="true" style="font-size:26px;font-weight:400;color:#0B6E69">' + (open ? '−' : '+') + '</span></button>' +
        (open ? '<p style="margin:0;padding:0 0 24px;font-size:16px;line-height:1.7;color:#44585B;max-width:720px">' + esc(f[1]) + '</p>' : '') +
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
      if (times().indexOf(state.time) < 0) state.time = '09:30';
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

  // Confirmar: abre WhatsApp con la solicitud ya escrita
  $('confirmBtn').addEventListener('click', function () {
    var inputs = $('formView').querySelectorAll('input');
    var nombre = inputs[0].value.trim(), tel = inputs[1].value.trim();
    var msg = 'Hola Plus Dental, quiero agendar una cita.\n' +
      'Servicio: ' + state.service + '\nFecha y hora: ' + summary().split(' · ').slice(1).join(' · ') +
      (nombre ? '\nNombre: ' + nombre : '') + (tel ? '\nTeléfono: ' + tel : '');
    window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg), '_blank');
    $('formView').hidden = true; $('doneView').hidden = false;
  });
  $('resetBtn').addEventListener('click', function () {
    $('formView').hidden = false; $('doneView').hidden = true;
  });

  // Menú principal: botón para pantallas pequeñas
  var menu = $('mainMenu'), menuBtn = $('menuBtn');
  function setMenu(open) {
    menu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open);
  }
  menuBtn.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a,button')) setMenu(false); });

  // Conectarse / Administración: ventana de usuario y clave.
  // Pendiente: conectar a un servicio de autenticación real; esta página no valida claves.
  var dlg = $('loginDlg');
  document.querySelectorAll('[data-login]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var admin = el.getAttribute('data-login') === 'admin';
      $('loginEyebrow').textContent = admin ? 'Solo personal autorizado' : 'Acceso';
      $('loginTitle').textContent = admin ? 'Administración' : 'Conectarse';
      $('loginMsg').textContent = '¿Olvidaste tu clave? Comunícate con la clínica al +502 3756-5739.';
      $('loginMsg').style.color = '#44585B';
      dlg.showModal();
      $('loginUser').focus();
    });
  });
  $('loginClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginPass').value = '';
    $('loginMsg').textContent = 'El acceso en línea todavía no está habilitado. Comunícate con la clínica para obtener tu usuario.';
    $('loginMsg').style.color = '#9A3B2E';
  });

  $('firstDay').textContent = wd[dayDates[0].getDay()] + ' ' + dayDates[0].getDate();
  render();
})();
