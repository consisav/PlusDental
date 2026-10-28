// Plus Dental — Asistente virtual de la página (24/7)
// Agenda citas con los horarios reales, confirma y reprograma citas (el paciente se identifica con su teléfono y los
// 4 últimos dígitos de su DPI) y responde dudas con el contenido del sitio (preguntas frecuentes, horarios, ubicación).
// Cada conversación puede continuar por WhatsApp con el mensaje ya escrito.
(function () {
  var sb = window.PD_SB || null;
  var WHATSAPP = '50237565739', TELEFONO = '+502 3756-5739';
  var DIRECCION = 'Reforma Montúfar, zona 10, Nivel 9, Oficina 910, Ciudad de Guatemala';
  var HORARIO = 'Lunes a viernes de 8:00 a. m. a 6:00 p. m. y sábados de 8:00 a. m. a 12:30 p. m.';
  var SERVICIOS = ['Evaluación general', 'Limpieza', 'Urgencia / dolor', 'Estética', 'Ortodoncia', 'Implantes'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function sumar(f, n) { var d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function fechaTexto(f) { var d = new Date(f + 'T12:00:00'); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  // Etiqueta del botón del día: «Hoy, …» y «Mañana, …» para que se reconozcan de un vistazo
  function etiquetaDia(f) {
    var hoy = iso(new Date()), t = fechaTexto(f);
    if (f === hoy) return 'Hoy, ' + t;
    if (f === sumar(hoy, 1)) return 'Mañana, ' + t;
    return t.replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  function esUrgencia() { return /urgencia|dolor/i.test(datos.servicio || ''); }
  function wa(texto) { return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(texto); }

  // ---------- Interfaz ----------
  var raiz = document.createElement('div');
  raiz.className = 'bot';
  raiz.innerHTML =
    '<button type="button" class="bot-fab" aria-expanded="false" aria-controls="botPanel"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path><circle cx="9" cy="12" r=".6" fill="currentColor"></circle><circle cx="12.5" cy="12" r=".6" fill="currentColor"></circle><circle cx="16" cy="12" r=".6" fill="currentColor"></circle></svg><span>Asistente 24/7</span></button>' +
    '<section id="botPanel" class="bot-panel" role="dialog" aria-label="Asistente virtual de Plus Dental" hidden>' +
    '<header class="bot-cab"><div><b>Asistente Plus Dental</b><small><i></i>En línea · responde al instante</small></div>' +
    '<a class="bot-wa" href="' + wa('Hola Plus Dental, quiero información.') + '" target="_blank" rel="noopener" title="Continuar por WhatsApp">WhatsApp</a>' +
    '<button type="button" class="bot-x" aria-label="Cerrar asistente">×</button></header>' +
    '<div class="bot-msgs" aria-live="polite"></div>' +
    '<div class="bot-chips"></div>' +
    '<form class="bot-form"><input type="text" maxlength="300" placeholder="Escribe tu mensaje…" aria-label="Escribe tu mensaje"><button type="submit" aria-label="Enviar">➤</button></form>' +
    '</section>';
  document.body.appendChild(raiz);
  var fab = raiz.querySelector('.bot-fab'), panel = raiz.querySelector('.bot-panel'), msgs = raiz.querySelector('.bot-msgs'),
    chips = raiz.querySelector('.bot-chips'), form = raiz.querySelector('.bot-form'), entrada = form.querySelector('input');

  function decir(html, quien) {
    var m = document.createElement('div');
    m.className = 'bot-m ' + (quien || 'bot');
    m.innerHTML = html;
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
    return m;
  }
  function escribiendo() { return decir('<span class="bot-dots"><i></i><i></i><i></i></span>', 'bot espera'); }
  async function responder(html, demora) {
    var e = escribiendo();
    await new Promise(function (ok) { setTimeout(ok, demora || 450); });
    e.remove();
    return decir(html);
  }
  // opciones: [[texto, valor]]
  function opciones(lista) {
    chips.innerHTML = lista.map(function (o) { return '<button type="button" data-v="' + esc(o[1] != null ? o[1] : o[0]) + '">' + esc(o[0]) + '</button>'; }).join('');
  }
  function botonWa(texto, etiqueta) { return '<a class="bot-wa-btn" href="' + wa(texto) + '" target="_blank" rel="noopener">' + esc(etiqueta || 'Continuar por WhatsApp') + '</a>'; }
  // WhatsApp automático: se abre una pestaña en el clic de «Confirmar» y, al registrarse la cita, se carga el mensaje
  var ventanaWa = null;
  function prepararWa() { try { ventanaWa = window.open('about:blank', '_blank'); } catch (e) { ventanaWa = null; } }
  function enviarWa(texto) {
    if (ventanaWa && !ventanaWa.closed) { try { ventanaWa.location.href = wa(texto); ventanaWa = null; return true; } catch (e) { /* bloqueada */ } }
    ventanaWa = null; return false;
  }
  function cancelarWa() { if (ventanaWa && !ventanaWa.closed) { try { ventanaWa.close(); } catch (e) { /* ya cerrada */ } } ventanaWa = null; }
  function avisoWa(enviado, texto) {
    return (enviado ? '<br><small class="bot-nota">📲 Abrimos WhatsApp con el mensaje listo: solo pulsa <b>Enviar</b>. Si no se abrió o no llegó, reenvíalo aquí:</small>'
      : '<br><small class="bot-nota">Envíanos este aviso por WhatsApp:</small>') + botonWa(texto, enviado ? 'Reenviar por WhatsApp' : 'Avisar por WhatsApp');
  }
  // Acciones que terminan en una cita registrada (y en el aviso por WhatsApp)
  function terminaEnCita(v, texto) {
    return (paso === 'agendar_ok' && (v === 'si' || /^(si|sí|confirmar|ok|dale)/i.test(texto || ''))) || String(v).indexOf('conf:') === 0 ||
      (paso === 'repro_hora' && ((disponible && disponible[datos.fecha]) || []).indexOf(String(v).trim()) >= 0);
  }
  var MENU = [['Agendar una cita', 'agendar'], ['Confirmar mi cita', 'confirmar'], ['Reprogramar mi cita', 'reprogramar'], ['Horarios y ubicación', 'info'], ['Tengo una duda', 'duda']];

  // ---------- Estado de la conversación ----------
  var paso = 'menu', datos = {}, ident = null, disponible = null;

  async function inicio() {
    paso = 'menu'; datos = {};
    await responder('¡Hola! 👋 Soy el asistente virtual de <b>Plus Dental</b>. Puedo agendar, confirmar o reprogramar tu cita y resolver tus dudas, a cualquier hora. ¿En qué te ayudo?');
    opciones(MENU);
  }
  async function menu(texto) {
    paso = 'menu';
    await responder(texto || '¿En qué más te puedo ayudar?');
    opciones(MENU);
  }

  // Horarios libres reales: hoy (la agenda solo ofrece horas con al menos 1 hora de anticipación) y los próximos 14 días
  async function cargarDisponible() {
    if (!sb) return null;
    var hoy = iso(new Date());
    var r = await sb.rpc('disponibilidad', { desde: hoy, hasta: sumar(hoy, 14) });
    if (r.error) return null;
    var porDia = {};
    r.data.forEach(function (x) { if (x.libre) (porDia[x.fecha] = porDia[x.fecha] || []).push(x.hora); });
    return porDia;
  }
  async function elegirDia(siguiente) {
    disponible = await cargarDisponible();
    if (!disponible || !Object.keys(disponible).length) {
      await responder('Ahora no pude consultar la agenda en línea. Escríbenos por WhatsApp y te damos un horario de inmediato. ' + botonWa('Hola Plus Dental, quiero ' + (siguiente === 'repro' ? 'reprogramar mi cita.' : 'agendar una cita de ' + (datos.servicio || 'evaluación') + '.')));
      return menu();
    }
    paso = siguiente === 'repro' ? 'repro_dia' : 'agendar_dia';
    var hoy = iso(new Date()), dias = Object.keys(disponible).sort().slice(0, 8);
    // Urgencia: si hay espacio hoy se ofrece primero; si no, se avisa y se deja el WhatsApp para atenderla cuanto antes
    if (siguiente !== 'repro' && esUrgencia()) {
      if (disponible[hoy]) {
        await responder('Para tu urgencia hay espacio <b>hoy</b> (' + disponible[hoy].length + (disponible[hoy].length === 1 ? ' horario libre' : ' horarios libres') + '). Elige hoy u otro día:');
      } else {
        await responder('Hoy ya no quedan horarios libres en la agenda en línea. Si el dolor es fuerte, escríbenos <b>ahora</b> por WhatsApp y buscamos un espacio hoy mismo. ' + botonWa('Hola Plus Dental, tengo una urgencia dental y necesito cita para hoy.', 'Urgencia por WhatsApp') + '<br>O elige uno de estos días:');
      }
    } else {
      await responder('Estos días tienen horarios libres. ¿Cuál te queda mejor?');
    }
    opciones(dias.map(function (f) { return [etiquetaDia(f), f]; }).concat([['Volver al menú', 'menu']]));
  }
  async function elegirHora(f, siguiente) {
    var horas = (disponible && disponible[f]) || [];
    paso = siguiente === 'repro' ? 'repro_hora' : 'agendar_hora';
    datos.fecha = f;
    await responder('Horarios libres el <b>' + fechaTexto(f) + '</b>:');
    opciones(horas.map(function (h) { return [h, h]; }).concat([['Otro día', 'otro_dia']]));
  }

  // ---------- Agendar ----------
  async function agendar(servicio) {
    datos = { servicio: servicio || null };
    if (!servicio) {
      paso = 'agendar_servicio';
      await responder('Con gusto. ¿Qué tipo de cita necesitas?');
      return opciones(SERVICIOS.map(function (s) { return [s, s]; }));
    }
    await elegirDia('agendar');
  }
  async function confirmarAgenda() {
    paso = 'agendar_ok';
    await responder('Revisa tu cita:<br><b>' + esc(datos.servicio) + '</b><br>' + fechaTexto(datos.fecha) + ' a las <b>' + datos.hora + '</b><br>A nombre de ' + esc(datos.nombre) + ' · WhatsApp ' + esc(datos.telefono));
    opciones([['Confirmar cita', 'si'], ['Cambiar horario', 'otro_dia'], ['Cancelar', 'menu']]);
  }
  async function guardarAgenda() {
    // El paciente confirmó en el chat: la cita se registra ya Confirmada (si la función nueva aún no está, queda Programada)
    var args = { p_fecha: datos.fecha, p_hora: datos.hora, p_servicio: datos.servicio, p_nombre: datos.nombre, p_telefono: datos.telefono };
    var r = await sb.rpc('bot_agendar', args), confirmada = !r.error;
    if (r.error && /bot_agendar/.test(r.error.message || '') && /could not find|does not exist|schema cache/i.test(r.error.message || '')) { r = await sb.rpc('solicitar_cita', args); confirmada = false; }
    var msg = 'Hola Plus Dental, soy ' + datos.nombre + '. Agendé y confirmé mi cita de ' + datos.servicio + ' el ' + fechaTexto(datos.fecha) + ' a las ' + datos.hora + '.';
    if (r.error) {
      cancelarWa();
      var ocupado = /disponible/i.test(r.error.message || '');
      await responder((ocupado ? 'Ese horario se acaba de ocupar. Elige otro, por favor.' : 'No pude registrar la cita en este momento.') + (ocupado ? '' : ' ' + botonWa(msg, 'Enviarla por WhatsApp')));
      if (ocupado) return elegirDia('agendar');
      return menu();
    }
    var enviado = enviarWa(msg);
    await responder('¡Listo! ✅ Registramos tu cita de <b>' + esc(datos.servicio) + '</b> para el <b>' + fechaTexto(datos.fecha) + ' a las ' + datos.hora + '</b>' + (confirmada ? ' y quedó <b>confirmada</b>. ¡Te esperamos!' : '. Te escribiremos por WhatsApp para confirmarla.') + avisoWa(enviado, msg));
    return menu('¿Te ayudo con algo más?');
  }

  // ---------- Identificación (confirmar / reprogramar) ----------
  async function identificar(accion) {
    datos = { accion: accion };
    if (ident) return listarCitas();
    paso = 'id_tel';
    await responder('Para ' + (accion === 'confirmar' ? 'confirmar' : 'reprogramar') + ' tu cita necesito identificarte. Escribe el <b>número de teléfono</b> que registraste en la clínica.');
    opciones([['Volver al menú', 'menu']]);
  }
  function motivo(r) {
    var m = r && r.motivo;
    return m === 'bloqueado' ? 'Hubo demasiados intentos con ese teléfono. Por seguridad, intenta en una hora o escríbenos por WhatsApp.'
      : m === 'no_coincide' ? 'No encontré un paciente con ese teléfono y esos dígitos del DPI. Revisa los datos e intenta de nuevo.'
      : m === 'cita' ? 'Esa cita ya no se puede modificar desde aquí.'
      : m === 'ocupado' ? 'Ese horario se acaba de ocupar. Elige otro, por favor.'
      : 'Revisa los datos e intenta de nuevo.';
  }
  async function listarCitas() {
    var r = await sb.rpc('bot_mis_citas', { p_tel: ident.tel, p_dpi4: ident.dpi });
    var d = r.data;
    if (r.error) { await responder('Ahora no puedo consultar las citas. ' + botonWa('Hola Plus Dental, quiero ' + datos.accion + ' mi cita.')); return menu(); }
    if (!d || !d.ok) {
      var bloqueado = d && d.motivo === 'bloqueado';
      ident = null;
      await responder(motivo(d) + (bloqueado ? ' ' + botonWa('Hola Plus Dental, quiero ' + datos.accion + ' mi cita.') : ''));
      return bloqueado ? menu() : identificar(datos.accion);
    }
    datos.citas = d.citas;
    if (!d.citas.length) {
      await responder('Hola ' + esc(d.nombre || '') + ', no tienes citas próximas registradas. ¿Quieres agendar una?');
      paso = 'menu';
      return opciones([['Agendar una cita', 'agendar'], ['Volver al menú', 'menu']]);
    }
    paso = 'citas';
    var est = { pendiente: 'por confirmar', confirmada: 'confirmada', reprogramada: 'reprogramada, por confirmar' };
    await responder('Hola ' + esc(d.nombre || '') + '. Estas son tus próximas citas:' + d.citas.map(function (c) {
      return '<div class="bot-cita"><b>' + fechaTexto(c.fecha) + ' · ' + c.hora + '</b><span>' + esc(c.servicio) + (c.dentista ? ' · ' + esc(c.dentista) : '') + '</span><small>' + (est[c.estado] || c.estado) + '</small></div>';
    }).join(''));
    var ops = [];
    d.citas.forEach(function (c) {
      var t = fechaTexto(c.fecha).split(' ').slice(0, 2).join(' ') + ' ' + c.hora;
      if (datos.accion === 'confirmar' && c.estado !== 'confirmada') ops.push(['Confirmar ' + t, 'conf:' + c.id]);
      if (datos.accion === 'reprogramar') ops.push(['Reprogramar ' + t, 'repro:' + c.id]);
    });
    if (datos.accion === 'confirmar' && !ops.length) { await responder('Todas tus citas ya están confirmadas. ¡Te esperamos!'); return menu(); }
    opciones(ops.concat([['Volver al menú', 'menu']]));
  }
  async function confirmarCita(id) {
    var r = await sb.rpc('bot_confirmar', { p_tel: ident.tel, p_dpi4: ident.dpi, p_cita: +id });
    var c = (datos.citas || []).filter(function (x) { return x.id === +id; })[0];
    if (r.error || !r.data || !r.data.ok) { cancelarWa(); await responder(r.error ? 'No pude confirmar la cita ahora.' : motivo(r.data)); return menu(); }
    var msgC = 'Hola Plus Dental, confirmo mi cita' + (c ? ' de ' + c.servicio + ' del ' + fechaTexto(c.fecha) + ' a las ' + c.hora : '') + '.';
    var envC = enviarWa(msgC);
    await responder('¡Gracias! ✅ Tu cita del <b>' + (c ? fechaTexto(c.fecha) + ' a las ' + c.hora : '') + '</b> quedó <b>confirmada</b>. Te esperamos en ' + DIRECCION + '.' + avisoWa(envC, msgC));
    return menu('¿Te ayudo con algo más?');
  }
  async function reprogramarCita(f, h) {
    var r = await sb.rpc('bot_reprogramar', { p_tel: ident.tel, p_dpi4: ident.dpi, p_cita: datos.cita, p_fecha: f, p_hora: h });
    if (r.error || !r.data || !r.data.ok) {
      cancelarWa();
      await responder(r.error ? 'No pude reprogramar la cita ahora.' : motivo(r.data));
      if (r.data && r.data.motivo === 'ocupado') return elegirDia('repro');
      return menu();
    }
    var msgR = 'Hola Plus Dental, reprogramé mi cita para el ' + fechaTexto(f) + ' a las ' + h + '.';
    var envR = enviarWa(msgR);
    await responder('¡Listo! ✅ Tu cita quedó para el <b>' + fechaTexto(f) + ' a las ' + h + '</b>. Te escribiremos por WhatsApp para confirmarla.' + avisoWa(envR, msgR));
    return menu('¿Te ayudo con algo más?');
  }

  // ---------- Dudas e información ----------
  async function informacion() {
    await responder('📍 <b>' + DIRECCION + '</b><br>🕗 ' + HORARIO + '<br>📞 ' + TELEFONO + ' (llamadas y WhatsApp)');
    menu('¿Quieres agendar una cita o tienes alguna duda?');
  }
  async function duda(texto) {
    var t = norm(texto);
    if (/\b(horario|abren|cierran|atienden|hora de atencion|que dias)\b/.test(t)) return informacion();
    if (/\b(direccion|ubicacion|donde|como llego|mapa|zona)\b/.test(t)) return informacion();
    if (/\b(telefono|llamar|numero|contacto)\b/.test(t)) return informacion();
    if (/\b(precio|precios|costo|cuesta|cuanto|valor|cobran)\b/.test(t)) {
      await responder('El precio depende de tu caso. En la <b>evaluación</b> el odontólogo revisa tu boca y te entrega un presupuesto detallado, con opciones de pago (también tarjeta en cuotas). ' + botonWa('Hola Plus Dental, quiero información de precios.', 'Preguntar precios por WhatsApp'));
      paso = 'menu';
      return opciones([['Agendar evaluación', 'agendar:Evaluación general'], ['Volver al menú', 'menu']]);
    }
    if (/\b(urgencia|emergencia|me duele mucho|dolor fuerte|hinchad|sangra mucho|se me cayo|se me quebro)\b/.test(t)) {
      await responder('Si tienes dolor intenso, hinchazón o un golpe en un diente, escríbenos <b>ahora</b> por WhatsApp para atenderte lo antes posible. ' + botonWa('Hola Plus Dental, tengo una urgencia dental: ' + texto, 'Urgencia por WhatsApp'));
      paso = 'menu';
      return opciones([['Agendar urgencia', 'agendar:Urgencia / dolor'], ['Volver al menú', 'menu']]);
    }
    var f = window.PD_FAQ && window.PD_FAQ.buscar(texto);
    if (f && f.cobertura >= 0.5) {
      await responder('<b>' + esc(f.pregunta) + '</b><br>' + esc(f.respuesta) +
        (f.recomendaciones && f.recomendaciones.length ? '<ul>' + f.recomendaciones.slice(0, 3).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : ''), 600);
      paso = 'menu';
      return opciones([['Agendar una cita', 'agendar'], ['Tengo otra duda', 'duda'], ['Volver al menú', 'menu']]);
    }
    await responder('No tengo una respuesta exacta para eso. Un miembro del equipo te responde por WhatsApp. ' + botonWa('Hola Plus Dental, tengo una pregunta: ' + texto));
    paso = 'menu';
    opciones([['Agendar una cita', 'agendar'], ['Volver al menú', 'menu']]);
  }

  // ---------- Entrada del usuario (texto o botones) ----------
  function intencion(t) {
    t = norm(t);
    if (/\b(reprogram|cambiar|mover|pasar)\w*\b.*\bcita\b|\breprogram/.test(t)) return 'reprogramar';
    if (/\bconfirm/.test(t)) return 'confirmar';
    if (/\b(agendar|agenda|reservar|sacar|quiero|necesito|programar)\b.*\b(cita|turno|consulta|evaluacion)\b|^(cita|agendar)$/.test(t)) return 'agendar';
    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal)\b/.test(t) && t.length < 25) return 'saludo';
    if (/^(menu|inicio|volver)$/.test(t)) return 'menu';
    if (/^(gracias|muchas gracias|ok|listo|perfecto)\b/.test(t)) return 'gracias';
    return null;
  }
  async function procesar(valor, texto) {
    chips.innerHTML = '';
    var v = String(valor);
    if (v === 'menu') return menu();
    if (v === 'agendar') return agendar();
    if (v.indexOf('agendar:') === 0) return agendar(v.slice(8));
    if (v === 'confirmar' || v === 'reprogramar') return identificar(v);
    if (v === 'info') return informacion();
    if (v === 'duda') { paso = 'duda'; await responder('Claro, escríbeme tu duda (por ejemplo: «¿duele una endodoncia?» o «¿cada cuánto debo hacerme una limpieza?»).'); return opciones([['Volver al menú', 'menu']]); }
    if (v === 'otro_dia') return elegirDia(paso.indexOf('repro') === 0 ? 'repro' : 'agendar');
    if (v.indexOf('conf:') === 0) return confirmarCita(v.slice(5));
    if (v.indexOf('repro:') === 0) { datos.cita = +v.slice(6); return elegirDia('repro'); }

    switch (paso) {
      case 'agendar_servicio': datos.servicio = SERVICIOS.filter(function (s) { return norm(s) === norm(v); })[0] || texto.slice(0, 60); return elegirDia('agendar');
      case 'agendar_dia': case 'repro_dia':
        if (disponible && disponible[v]) return elegirHora(v, paso === 'repro_dia' ? 'repro' : 'agendar');
        var dicho = /pasado manana/.test(norm(texto)) ? sumar(iso(new Date()), 2) : /\bmanana\b/.test(norm(texto)) ? sumar(iso(new Date()), 1) : /\bhoy\b/.test(norm(texto)) ? iso(new Date()) : null;
        if (dicho && disponible && disponible[dicho]) return elegirHora(dicho, paso === 'repro_dia' ? 'repro' : 'agendar');
        if (dicho) { await responder((dicho === iso(new Date()) ? 'Hoy' : 'Ese día') + ' ya no quedan horarios libres en la agenda en línea.' + (esUrgencia() ? ' Para una urgencia escríbenos por WhatsApp. ' + botonWa('Hola Plus Dental, tengo una urgencia dental y necesito cita para hoy.', 'Urgencia por WhatsApp') : '')); return elegirDia(paso === 'repro_dia' ? 'repro' : 'agendar'); }
        await responder('Elige uno de los días de la lista, por favor.'); return elegirDia(paso === 'repro_dia' ? 'repro' : 'agendar');
      case 'agendar_hora': case 'repro_hora':
        var h = ((disponible && disponible[datos.fecha]) || []).filter(function (x) { return x === v || x === texto.trim(); })[0];
        if (!h) { await responder('Elige una de las horas de la lista, por favor.'); return elegirHora(datos.fecha, paso === 'repro_hora' ? 'repro' : 'agendar'); }
        if (paso === 'repro_hora') return reprogramarCita(datos.fecha, h);
        datos.hora = h; paso = 'agendar_nombre';
        return responder('Perfecto. ¿A nombre de quién registramos la cita? (nombre y apellido)');
      case 'agendar_nombre':
        if (texto.trim().length < 3) return responder('Escribe tu nombre y apellido, por favor.');
        datos.nombre = texto.trim().slice(0, 120); paso = 'agendar_tel';
        return responder('Gracias, ' + esc(datos.nombre.split(' ')[0]) + '. ¿A qué número de <b>WhatsApp</b> te confirmamos la cita?');
      case 'agendar_tel':
        if (texto.replace(/\D/g, '').length < 8) return responder('Escribe un número de 8 dígitos, por favor.');
        datos.telefono = texto.trim().slice(0, 40);
        return confirmarAgenda();
      case 'agendar_ok':
        if (v === 'si' || /^(si|sí|confirmar|ok|dale)/i.test(texto)) return guardarAgenda();
        return menu();
      case 'id_tel':
        if (texto.replace(/\D/g, '').length < 8) return responder('Escribe tu número de teléfono de 8 dígitos, por favor.');
        datos.tel = texto; paso = 'id_dpi';
        return responder('Ahora escribe los <b>4 últimos dígitos de tu DPI</b> (solo para verificar que eres tú).');
      case 'id_dpi':
        var dpi = texto.replace(/\D/g, '');
        if (dpi.length !== 4) return responder('Escribe solo los 4 últimos dígitos de tu DPI, por favor.');
        ident = { tel: datos.tel, dpi: dpi };
        return listarCitas();
    }
    // Texto libre en el menú o como duda
    var it = intencion(texto);
    if (it === 'saludo') return menu('¡Hola! ¿En qué te ayudo?');
    if (it === 'gracias') return menu('¡Con gusto! 😊 ¿Algo más?');
    if (it === 'menu') return menu();
    if (it === 'agendar') return agendar();
    if (it === 'confirmar' || it === 'reprogramar') return identificar(it);
    return duda(texto);
  }

  // ---------- Eventos ----------
  var iniciado = false;
  function abrir(si) {
    panel.hidden = !si;
    fab.setAttribute('aria-expanded', si);
    raiz.classList.toggle('abierto', si);
    if (si) { if (!iniciado) { iniciado = true; inicio(); } setTimeout(function () { entrada.focus(); }, 50); }
  }
  fab.addEventListener('click', function () { abrir(panel.hidden); });
  raiz.querySelector('.bot-x').addEventListener('click', function () { abrir(false); });
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (!b) return;
    decir(esc(b.textContent), 'yo');
    if (terminaEnCita(b.dataset.v, b.textContent)) prepararWa();
    procesar(b.dataset.v, b.textContent);
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = entrada.value.trim();
    if (!t) return;
    entrada.value = '';
    // El DPI no se muestra completo en la conversación
    decir(paso === 'id_dpi' ? '••••' : esc(t), 'yo');
    if (terminaEnCita(t, t)) prepararWa();
    procesar(t, t);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) abrir(false); });
  window.PD_BOT = { abrir: function () { abrir(true); } };
})();
