// Plus Dental — Agenda de clínicas con asistente inteligente (reglas, sin servicios externos)
// Propone horarios combinando: especialidad que requiere el tratamiento, médico asignado del paciente,
// horario y citas de cada dentista, horario y estado de cada sala, bloqueos, prioridad y carga de trabajo.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var TURNOS = { semana: ['07:00', '08:00', '09:30', '11:00', '14:00', '15:30', '17:00', '18:30'], sabado: ['08:00', '09:30', '11:00', '12:30'] };
  // Jornada de la clínica (inicio y fin de cada bloque) y cada cuántos minutos se ofrece una hora al agendar:
  // Ortodoncia cada 10 minutos; los demás tratamientos cada media hora. Cada cita ocupa ese mismo tiempo.
  // Los TURNOS de 90 minutos solo ordenan las filas del calendario y los bloqueos de horario.
  // Jornada continua (sin corte de almuerzo): las horas reales las limitan el horario de cada odontólogo y de cada sala.
  var JORNADA = { semana: [['07:00', '19:00']], sabado: [['08:00', '15:00']] };
  var MINUTOS = { ortodoncia: 10, general: 30 }, BLOQUE = 90;
  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS_BUSQUEDA = 21;
  // Palabras del tratamiento → especialidad requerida
  var REGLAS = [
    [/orto|bracket|frenos|alineador|invisalign|retenedor/, 'Ortodoncia'],
    [/endo|conducto|nervio|pulp/, 'Endodoncia'],
    [/implant/, 'Implantología'],
    [/cirug|extracci|cordal|juicio|tercer(a|o)s? molar|exodoncia/, 'Cirugía'],
    [/nino|nina|pediatr|infantil|sellante|fluor/, 'Odontopediatría'],
    [/perio|encia|raspado|curetaje|gingiv/, 'Periodoncia'],
    [/carilla|blanque|estetic|diseno de sonrisa/, 'Estética'],
    [/corona|puente|protesis|dentadura|placa/, 'Prostodoncia'],
    [/atm|bruxismo|mandibula|ferula/, 'Trastornos temporomandibulares'],
    [/limpieza|profilaxis|higiene|detartraje/, 'Higiene']
  ];
  var ESPECIALIDADES = ['Odontología general', 'Ortodoncia', 'Endodoncia', 'Periodoncia', 'Odontopediatría', 'Prostodoncia', 'Rehabilitación oral', 'Cirugía', 'Implantología', 'Estética', 'Higiene', 'Trastornos temporomandibulares'];
  var SERVICIOS = ['Evaluación general', 'Limpieza', 'Urgencia / dolor', 'Estética', 'Ortodoncia', 'Implantes'];

  // Área de atención: Odontología (odontólogos y salas) o Quiropráctica (quiroprácticos, sin salas)
  window.PD_AREA = window.PD_AREA || 'odontologia';
  function esQuiro() { return window.PD_AREA === 'quiropractica'; }
  var canceladas = [];   // se muestran en la agenda, pero no ocupan horario
  var dentistas = [], salas = [], pacientes = [], citas = [], bloqueos = [], fijo = null, sugerencias = [], diaCitas = [], vista = 'semana';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fecha(f) { var p = f.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function sumar(f, n) { var d = fecha(f); d.setDate(d.getDate() + n); return iso(d); }
  function hoy() { return iso(new Date()); }
  function textoFecha(f) { var d = fecha(f); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function diaSemana(f) { var d = fecha(f).getDay(); return d === 0 ? '7' : String(d); }
  function turnos(f) { var d = fecha(f).getDay(); return d === 0 ? [] : d === 6 ? TURNOS.sabado : TURNOS.semana; }
  function hhmm(h) { return String(h || '').slice(0, 5); }
  function aMin(h) { var p = hhmm(h).split(':'); return +p[0] * 60 + (+p[1] || 0); }
  function aHora(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function esOrtodoncia(servicio, esp) { return esp === 'Ortodoncia' || /ortodon/.test(sinTildes(servicio)); }
  // Frecuencia de atención del médico (Odontólogos): cada cita ocupa ese tiempo y sus horas se ofrecen con ese paso
  function frecDe(id) { var d = id && dentistas.filter(function (x) { return x.id === id; })[0]; return d && d.frecuencia ? d.frecuencia : 0; }
  function duracion(c) { return +c.duracion || frecDe(c.dentista_id) || (esOrtodoncia(c.servicio) ? MINUTOS.ortodoncia : MINUTOS.general); }
  // Duración de la cita (como «Duración» al agendar): 15 a 240 minutos; vacío = según el médico y el tratamiento
  var DURACIONES = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
  function durElegida() { return $('agDuracion') ? +$('agDuracion').value || 0 : 0; }
  function opcionesDuracion(sel, auto) { return '<option value="">' + (auto ? 'Automática (' + auto + ' minutos)' : 'Automática') + '</option>' + DURACIONES.map(function (m) { return '<option value="' + m + '"' + (+sel === m ? ' selected' : '') + '>' + m + ' minutos</option>'; }).join(''); }
  async function guardarDuracion(id) { var m = durElegida(); if (id && m) await sb.from('citas').update({ duracion: m }).eq('id', id); }
  function durMedico(d) { return durElegida() || (d && d.frecuencia) || durNueva(); }
  // Horas del médico ese día: desde su hora de inicio, cada «frecuencia» minutos, y la cita termina antes de su cierre
  function horariosMedico(f, d) {
    if (!d || !d.frecuencia) return horarios(f, durMedico(d));
    var x = (d.horario || {})[diaSemana(f)], l = [];
    if (!x) return l;
    for (var m = aMin(x.abre); m + d.frecuencia <= aMin(x.cierra); m += d.frecuencia) l.push(aHora(m));
    return l;
  }
  // Horas de inicio del día con el paso indicado (la cita debe terminar dentro del bloque de la jornada)
  function horarios(f, paso) {
    var d = fecha(f).getDay(), j = d === 0 ? [] : d === 6 ? JORNADA.sabado : JORNADA.semana, l = [];
    j.forEach(function (r) { for (var m = aMin(r[0]); m + paso <= aMin(r[1]); m += paso) l.push(aHora(m)); });
    return l;
  }
  function choca(a, da, b, db) { return a < b + db && b < a + da; }
  // Catálogo de estados de la cita (en el orden del menú) y el que sigue en el flujo de la consulta
  var ESTADOS_CITA = { pendiente: 'No confirmado', confirmada: 'Confirmado por teléfono', sala_espera: 'En sala de espera', atendiendose: 'Atendiéndose', atendida: 'Atendido', no_asiste: 'No asiste', reprogramada: 'Reprogramado', cancelada: 'Anulado' };
  var CATALOGO_CITA = ['atendida', 'atendiendose', 'confirmada', 'sala_espera', 'no_asiste', 'pendiente'];
  function fechaHoraGrab(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function usuarioSesion() { return (window.PD_SESION && window.PD_SESION.usuario()) || 'Sin usuario'; }
  function telWa(t) { var n = String(t || '').replace(/\D/g, ''); if (n.length === 8) n = '502' + n; return n; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/agendar_cita|paciente_id|prioridad/.test(m) && /does not exist|could not find/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para la agenda de clínicas.';
    if (/row-level security|permission denied|No tienes permiso/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }

  // ---------- Reglas de disponibilidad ----------
  function atiende(d, f, h) {
    if (d.estado !== 'activo' || f < d.fecha_ingreso || (d.fecha_salida && f > d.fecha_salida)) return false;
    var x = (d.horario || {})[diaSemana(f)];
    return !!x && h >= x.abre && h < x.cierra;
  }
  function salaAbierta(s, f, h) {
    if (!s.activa || s.estado === 'mantenimiento') return false;
    var hor = s.horario || {};
    if (!Object.keys(hor).length) return true; // sin horario cargado: se considera abierta
    var x = hor[diaSemana(f)];
    return !!x && h >= x.abre && h < x.cierra;
  }
  // Bloqueos de la clínica (todo el día o un turno) y bloqueos por médico de una hora inicial a una final.
  // medId: el médico de la cita; sin médico solo cuentan los bloqueos de «todos».
  function bloqueado(f, h, dur, medId) {
    return bloqueos.some(function (b) { return b.fecha === f && (!b.hora || choca(aMin(h), dur || MINUTOS.general, aMin(b.hora), BLOQUE)); }) ||
      bloqueosMed(f, h, dur, medId).length > 0;
  }
  var bloqMed = [];
  function bloqueosMed(f, h, dur, medId, cualquiera) {
    return bloqMed.filter(function (b) {
      if (b.area !== window.PD_AREA || f < b.fecha_desde || f > b.fecha_hasta) return false;
      if (!choca(aMin(h), dur || MINUTOS.general, aMin(b.desde), aMin(b.hasta) - aMin(b.desde))) return false;
      return cualquiera || !b.medicos || (!!medId && b.medicos.indexOf(+medId) >= 0);
    });
  }
  function nombresBloqueo(b) { return b.medicos ? b.medicos.map(function (id) { return nombreDentista(id); }).join(', ') : (esQuiro() ? 'Todos los quiroprácticos' : 'Todos los odontólogos'); }
  // Celda del calendario: bloqueada para todos (o para el médico filtrado) o solo para algunos médicos
  function celdaBloqueo(f, hh, medFiltro) {
    var l = bloqueosMed(f, hh, PASO, null, true);
    if (!l.length) return null;
    var total = l.filter(function (b) { return !b.medicos || (medFiltro && b.medicos.indexOf(medFiltro) >= 0); })[0];
    if (total) return ['bloq', '<button type="button" class="ag2-lock" data-desbloq="' + total.id + '" data-fecha="' + f + '" aria-label="Desbloquear este horario">🔒</button>', 'Bloqueado: ' + nombresBloqueo(total) + (total.motivo ? ' · ' + total.motivo : '')];
    if (medFiltro) return null;
    return { parcial: '<button type="button" class="ag2-lock ag2-lock-p" data-desbloq="' + l[0].id + '" data-fecha="' + f + '" aria-label="Desbloquear este horario">🔒</button>', titulo: 'Bloqueado para: ' + l.map(function (b) { return nombresBloqueo(b) + (b.motivo ? ' (' + b.motivo + ')' : ''); }).join(' · ') };
  }
  function medDelFiltro() { var yo = soloMio(); return yo ? yo.id : +$('agFMed').value || null; }
  // Citas que empiezan dentro de la fila del calendario (bloque de 90 minutos que inicia en h)
  function citasEn(f, h) { var a = aMin(h); return citas.filter(function (c) { var m = aMin(c.hora); return c.fecha === f && m >= a && m < a + BLOQUE; }); }
  // Citas que se traslapan con [h, h + dur)
  function ocupan(f, h, dur) { var a = aMin(h), d = dur || MINUTOS.general; return (citasTodas || citas).filter(function (c) { return c.fecha === f && choca(a, d, aMin(c.hora), duracion(c)); }); }
  function dentistaOcupado(id, f, h, dur) { return ocupan(f, h, dur).some(function (c) { return c.dentista_id === id; }); }
  function salaOcupada(id, f, h, dur) { return ocupan(f, h, dur).some(function (c) { return c.posicion_id === id; }); }
  function durNueva() { return durElegida() || (esOrtodoncia($('agTratamiento').value, especialidadRequerida()) ? MINUTOS.ortodoncia : MINUTOS.general); }
  function cargaDelDia(id, f) { return citas.filter(function (c) { return c.fecha === f && c.dentista_id === id; }).length; }
  function nombreSala(id) { var s = salas.filter(function (x) { return x.id === id; })[0]; return s ? s.codigo + ' · ' + s.nombre : 'Sin sala'; }
  function nombreDentista(id) { var d = dentistas.filter(function (x) { return x.id === id; })[0]; return d ? d.nombre : 'Sin asignar'; }

  function especialidadRequerida() {
    var elegida = $('agEspecialidad').value;
    if (elegida) return elegida;
    var t = sinTildes($('agTratamiento').value);
    for (var i = 0; i < REGLAS.length; i++) if (REGLAS[i][0].test(t)) return REGLAS[i][1];
    return '';
  }
  function coincide(lista, esp) {
    if (!esp) return false;
    var e = sinTildes(esp).split(' ')[0].slice(0, 6);
    return (lista || []).some(function (x) { return sinTildes(x).indexOf(e) >= 0; });
  }

  // ---------- Asistente: generar y puntuar opciones ----------
  function sugerir() {
    var pac = pacienteElegido();
    var esp = especialidadRequerida();
    var medico = $('agMedico').value ? +$('agMedico').value : null;
    var franja = $('agFranja').value, urgente = $('agPrioridad').value === 'urgente';
    var desde = $('agDesde').value || hoy();
    var ahora = new Date(), ahoraF = hoy(), ahoraH = ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);
    var conHorario = dentistas.some(function (d) { return d.estado === 'activo' && Object.keys(d.horario || {}).length; });
    var opciones = [];

    var fechas = [];
    if (fijo) fechas = [fijo.fecha];
    else for (var i = 0; i < DIAS_BUSQUEDA; i++) fechas.push(sumar(desde, i));

    var dur = durNueva();
    var posibles = conHorario ? dentistas.filter(function (d) { return !medico || d.id === medico; }) : [];
    fechas.forEach(function (f, iDia) {
      var horasDe = {}, todas = {};
      posibles.forEach(function (d) { horasDe[d.id] = {}; horariosMedico(f, d).forEach(function (h) { horasDe[d.id][h] = 1; todas[h] = 1; }); });
      var lista = fijo ? [fijo.hora] : conHorario ? Object.keys(todas).sort() : horarios(f, dur);
      lista.forEach(function (h, iTurno) {
        if (f < ahoraF || (f === ahoraF && h <= ahoraH)) return;
        if (bloqueado(f, h, dur)) return;
        if (franja === 'manana' && h >= '12:00') return;
        if (franja === 'tarde' && h < '12:00') return;

        var candidatos = conHorario ? dentistas.filter(function (d) {
          return (!medico || d.id === medico) && (fijo || (horasDe[d.id] && horasDe[d.id][h])) && atiende(d, f, h) && !dentistaOcupado(d.id, f, h, durMedico(d)) && !bloqueado(f, h, durMedico(d), d.id);
        }) : [null];

        candidatos.forEach(function (d) {
          // Sala: la fija, la del dentista o la mejor libre
          var opcionesSala = salas.filter(function (s) { return salaAbierta(s, f, h) && !salaOcupada(s.id, f, h, durMedico(d)); });
          var sala = null;
          if (fijo && fijo.sala) sala = opcionesSala.filter(function (s) { return s.id === fijo.sala; })[0] || null;
          else if (d && d.posicion_id) sala = opcionesSala.filter(function (s) { return s.id === d.posicion_id; })[0] || null;
          if (!sala && !(fijo && fijo.sala) && !(d && d.posicion_id)) {
            sala = opcionesSala.slice().sort(function (a, b) { return (coincide([b.especialidad], esp) ? 1 : 0) - (coincide([a.especialidad], esp) ? 1 : 0); })[0] || null;
          }
          if (salas.length && !sala) return; // hay salas registradas pero ninguna libre para esta opción

          var puntos = 50, razones = [];
          if (d && pac && pac.dentista_id === d.id) { puntos += 40; razones.push('Su médico asignado'); }
          if (d && esp && coincide(d.especialidades, esp)) { puntos += 30; razones.push('Especialista en ' + esp); }
          else if (d && esp) { puntos -= 8; }
          if (sala && esp && coincide([sala.especialidad], esp)) { puntos += 15; razones.push('Sala preparada para ' + esp); }
          else if (sala && sala.especialidad && esp && !coincide([sala.especialidad], esp)) { puntos -= 10; }
          if (d && sala && d.posicion_id === sala.id && d.rol_sala !== 'alterno') { puntos += 8; razones.push('Principal de la sala'); }
          var carga = d ? cargaDelDia(d.id, f) : 0;
          puntos -= carga * 2;
          if (d && carga === 0) razones.push('Agenda libre ese día');
          puntos -= iDia * (urgente ? 12 : 3) + iTurno * (urgente ? 2 : 0.5);
          if (iDia === 0 && iTurno === 0) razones.push('Primer horario disponible');
          if (urgente && iDia <= 1) razones.push('Atención pronta');
          opciones.push({ fecha: f, hora: h, dentista: d, sala: sala, puntos: puntos, razones: razones });
        });
      });
    });

    // Las mejores, sin repetir más de dos veces la misma fecha y hora
    opciones.sort(function (a, b) { return b.puntos - a.puntos || (a.fecha + a.hora).localeCompare(b.fecha + b.hora); });
    var usadas = {}, finales = [];
    opciones.forEach(function (o) {
      var k = o.fecha + o.hora;
      if (finales.length < 8 && (usadas[k] || 0) < 2) { finales.push(o); usadas[k] = (usadas[k] || 0) + 1; }
    });
    return { opciones: finales, especialidad: esp };
  }

  function pintarSugerencias(res) {
    sugerencias = res.opciones;
    if (!sugerencias.length) {
      $('agSugerencias').innerHTML = '<p class="dlg-msg">No encontré horarios con esas condiciones en los próximos ' + DIAS_BUSQUEDA + ' días. Prueba con otro médico, otra preferencia de horario u otra fecha de inicio. Revisa también que los odontólogos tengan su horario cargado, o guarda la cita abajo en un horario específico.</p>';
      return;
    }
    var max = sugerencias[0].puntos, min = sugerencias[sugerencias.length - 1].puntos;
    $('agSugerencias').innerHTML = sugerencias.map(function (o, i) {
      var pct = max === min ? 100 : Math.round(55 + 45 * (o.puntos - min) / (max - min));
      return '<div class="ag-sug' + (i === 0 ? ' mejor' : '') + '">' +
        (i === 0 ? '<span class="estado rol-principal" style="align-self:flex-start">Mejor opción</span>' : '') +
        '<span class="cuando">' + textoFecha(o.fecha) + ' · ' + o.hora + '</span>' +
        '<span class="quien">' + esc(o.dentista ? o.dentista.nombre : 'Odontólogo por asignar') + '<br>' + esc(o.sala ? o.sala.codigo + ' · ' + o.sala.nombre : 'Sin sala asignada') + '</span>' +
        '<div class="barra-puntos" title="Qué tan adecuada es"><i style="width:' + pct + '%"></i></div>' +
        (o.razones.length ? '<div class="ag-razones">' + o.razones.map(function (r) { return '<span>' + esc(r) + '</span>'; }).join('') + '</div>' : '') +
        (cantidadCitas() > 1 ? '<button type="button" class="adm-btn adm-primary" data-serie="' + i + '">Programar serie de ' + cantidadCitas() + ' citas desde aquí</button>'
          : '<button type="button" class="adm-btn adm-primary" data-agendar="' + i + '">Agendar aquí</button>') + '</div>';
    }).join('');
  }

  // ---------- Serie de citas (una o más) ----------
  function cantidadCitas() { return $('agCantidad') ? Math.min(Math.max(parseInt($('agCantidad').value, 10) || 1, 1), 24) : 1; }
  function siguienteFecha(f, k) {
    var c = $('agCada') ? $('agCada').value : 'm1';
    if (c.charAt(0) === 'm') { var d = fecha(f); var dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + k * +c.slice(1)); var ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(dia, ult)); return iso(d); }
    return sumar(f, k * +c);
  }
  function textoCada() { var o = $('agCada') && $('agCada').selectedOptions[0]; return o ? o.text : ''; }
  var serie = null;
  // Propone las citas: la primera es la elegida; las siguientes, cerca de la fecha que toca (misma hora y médico si se puede)
  function planificarSerie(primera) {
    var n = cantidadCitas(), plan = [primera], copia = citas.slice();
    var medicoAntes = $('agMedico').value, desdeAntes = $('agDesde').value, fijoAntes = fijo;
    function ocupar(o) { citas.push({ id: 'plan' + plan.length, fecha: o.fecha, hora: o.hora, dentista_id: o.dentista ? o.dentista.id : null, posicion_id: o.sala ? o.sala.id : null, estado: 'pendiente', nombre: '' }); }
    ocupar(primera);
    fijo = null;
    if (primera.dentista) $('agMedico').value = String(primera.dentista.id);
    for (var k = 1; k < n; k++) {
      var objetivo = siguienteFecha(primera.fecha, k);
      $('agDesde').value = objetivo;
      var ops = sugerir().opciones.filter(function (o) { return o.fecha <= sumar(objetivo, 6); });
      var elegida = ops.filter(function (o) { return o.fecha === objetivo && o.hora === primera.hora; })[0]
        || ops.filter(function (o) { return o.hora === primera.hora; })[0] || ops[0] || null;
      if (elegida) { plan.push(elegida); ocupar(elegida); }
      else plan.push({ falta: true, fecha: objetivo });
    }
    citas = copia; fijo = fijoAntes; $('agMedico').value = medicoAntes; $('agDesde').value = desdeAntes;
    return plan;
  }
  function pintarSerie() {
    var ok = serie.filter(function (o) { return !o.falta; }).length;
    $('agSugerencias').innerHTML = '<div class="ag-serie"><b>Serie de ' + serie.length + ' citas · cada ' + esc(textoCada()) + '</b>' +
      '<p class="dlg-msg" style="margin:0">Revisa las fechas propuestas. Se buscó la misma hora y el mismo médico; si no había espacio, el horario más cercano.</p>' +
      '<table><thead><tr><th>#</th><th>Fecha y hora</th><th>Odontólogo</th><th>Sala</th></tr></thead><tbody>' +
      serie.map(function (o, i) {
        return o.falta ? '<tr><td>' + (i + 1) + '</td><td class="falta" colspan="3">' + textoFecha(o.fecha) + ': sin horario disponible cerca de esa fecha (no se agendará)</td></tr>'
          : '<tr><td>' + (i + 1) + '</td><td><b>' + textoFecha(o.fecha) + ' · ' + o.hora + '</b></td><td>' + esc(o.dentista ? o.dentista.nombre : 'Por asignar') + '</td><td>' + esc(o.sala ? o.sala.codigo + ' · ' + o.sala.nombre : 'Sin sala') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ag-serie-acc"><button type="button" class="adm-btn" data-serie-cancelar>Volver a los horarios</button>' +
      (ok ? '<button type="button" class="adm-btn adm-primary" data-serie-ok>Agendar ' + ok + (ok === 1 ? ' cita' : ' citas') + '</button>' : '') + '</div></div>';
  }
  async function agendarSerie(boton) {
    var p = pacienteElegido(), nuevo = $('agPaciente').value === 'nuevo';
    if (!p && !nuevo) { aviso('agFormMsg', 'Elige el paciente.', true); return; }
    if (nuevo && (!$('agNombre').value.trim() || !$('agTelefono').value.trim())) { aviso('agFormMsg', 'Escribe el nombre y el teléfono del paciente nuevo.', true); return; }
    if (!tipoValido()) return;
    boton.disabled = true;
    if (nuevo) {
      aviso('agFormMsg', 'Creando el expediente del paciente…');
      var prim = serie.filter(function (o) { return !o.falta; })[0];
      try { p = await crearExpediente(prim && prim.dentista ? prim.dentista.id : null); nuevo = false; } catch (e) { boton.disabled = false; aviso('agFormMsg', 'No se pudo crear el expediente: ' + traducir(e), true); return; }
    }
    var hechas = [], fallo = null, lista = serie.filter(function (o) { return !o.falta; });
    for (var i = 0; i < lista.length; i++) {
      var o = lista[i];
      aviso('agFormMsg', 'Agendando cita ' + (i + 1) + ' de ' + lista.length + '…');
      var r = await sb.rpc('agendar_cita', {
        p_fecha: o.fecha, p_hora: o.hora, p_paciente_id: p ? p.id : null,
        p_nombre: nuevo ? $('agNombre').value.trim() : null, p_telefono: nuevo ? $('agTelefono').value.trim() : null,
        p_servicio: $('agTratamiento').value.trim(), p_dentista_id: o.dentista && !esQuiro() ? o.dentista.id : null, p_posicion_id: o.sala && !esQuiro() ? o.sala.id : null,
        p_quiropractico_id: o.dentista && esQuiro() ? o.dentista.id : null,
        p_prioridad: $('agPrioridad').value, p_notas: [$('agNotas').value.trim(), lista.length > 1 ? '(cita ' + (i + 1) + ' de ' + lista.length + ')' : ''].filter(Boolean).join(' '),
        p_estado: $('agEstado').value
      });
      if (r.error) { fallo = textoFecha(o.fecha) + ' · ' + o.hora + ': ' + traducir(r.error); break; }
      await sedeCita(r.data);
      await guardarDuracion(r.data);
      hechas.push(o);
    }
    boton.disabled = false;
    if (hechas.length) await guardarTipo(p);
    var nombre = p ? p.nombre : $('agNombre').value.trim(), tel = telWa(p ? p.telefono : $('agTelefono').value.trim());
    var fechasTxt = hechas.map(function (o, i) { return (i + 1) + '. ' + textoFecha(o.fecha) + ' a las ' + o.hora + (o.dentista ? ' con ' + o.dentista.nombre : ''); }).join('\n');
    var msg = 'Hola ' + nombre + ', le confirmamos sus citas en Plus Dental para ' + $('agTratamiento').value.trim() + ':\n' + fechasTxt + '\nDirección: ' + CLINICA + '. Si necesita cambiar alguna, responda a este mensaje.';
    $('agSugerencias').innerHTML = '<div class="ag-fijo" style="background:' + (fallo ? '#FFF8E6;border-color:#F3D9A4;color:#7A4B00' : '#DCF2EC;border-color:#BFE6D8;color:#08504C') + ';flex-direction:column;align-items:flex-start">' +
      '<span><b>' + hechas.length + (hechas.length === 1 ? ' cita agendada' : ' citas agendadas') + '</b> para ' + esc(nombre) + ':</span>' +
      '<span>' + hechas.map(function (o) { return textoFecha(o.fecha) + ' · ' + o.hora; }).join('<br>') + '</span>' +
      (fallo ? '<span>No se pudo agendar: ' + esc(fallo) + '</span>' : '') +
      (hechas.length && tel ? '<div class="ag-aviso-btns"><a class="adm-btn" href="https://wa.me/' + tel + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">WhatsApp al paciente con todas las fechas</a></div>' : '') + '</div>';
    aviso('agFormMsg', '');
    serie = null; fijo = null; pintarFijo();
    $('agNotas').value = '';
    if (hechas.length) $('agDia').value = hechas[0].fecha;
    await cargarCitas();
  }

  // ---------- Tipo de cliente: independiente o de una institución (con su sucursal) ----------
  var instCat = [], sucCat = [], tipoCli = 'directo';
  function codigoCat(pre, x) { return pre + '-' + ('00' + (x.numero || x.id)).slice(-3); }
  function ponerTipo(t) {
    tipoCli = t === 'institucional' ? 'institucional' : 'directo';
    document.querySelectorAll('#agForm [data-ag-tipo]').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.agTipo === tipoCli); });
    $('agInstWrap').hidden = $('agSucWrap').hidden = tipoCli !== 'institucional';
  }
  function opcionesInst(instId, sucId) {
    var l = instCat.filter(function (i) { return i.estado === 'activo' || i.id === instId; });
    $('agInst').innerHTML = '<option value="">' + (l.length ? 'Elige la institución…' : 'No hay instituciones (Jornadas › Instituciones)') + '</option>' +
      l.map(function (i) { return '<option value="' + i.id + '">' + esc(codigoCat('INS', i) + ' · ' + i.nombre) + '</option>'; }).join('');
    $('agInst').value = instId ? String(instId) : '';
    opcionesSuc(sucId);
  }
  function opcionesSuc(sucId) {
    var inst = +$('agInst').value || null, l = inst ? sucCat.filter(function (x) { return x.institucion_id === inst && (x.estado === 'activo' || x.id === sucId); }) : [];
    $('agSuc').innerHTML = '<option value="">' + (!inst ? 'Elige primero la institución' : l.length ? 'Sede principal' : 'Sin sucursales') + '</option>' +
      l.map(function (x) { return '<option value="' + x.id + '">' + esc(codigoCat('SUC', x) + ' · ' + x.nombre) + '</option>'; }).join('');
    $('agSuc').value = sucId && l.some(function (x) { return x.id === sucId; }) ? String(sucId) : '';
  }
  function tipoValido() {
    if (tipoCli === 'institucional' && !$('agInst').value) { aviso('agFormMsg', 'Elige la institución a la que pertenece el paciente.', true); aviso('agMsgM', 'Elige la institución a la que pertenece el paciente.', true); $('agInst').focus(); return false; }
    return true;
  }
  // Lo que se guarda en el expediente. «Independiente» solo cambia a un paciente que era institucional (respeta VIP, referido…)
  function datosTipo(p) {
    if (tipoCli === 'institucional') return { tipo_cliente: 'institucional', institucion_id: +$('agInst').value || null, sucursal_id: +$('agSuc').value || null };
    return !p || p.tipo_cliente === 'institucional' ? { tipo_cliente: 'directo', institucion_id: null, sucursal_id: null } : {};
  }
  async function guardarTipo(p) {
    if (!p || !instCat.length) return;
    var d = datosTipo(p), cambia = Object.keys(d).some(function (k) { return (p[k] == null ? null : p[k]) !== d[k]; });
    if (!cambia) return;
    var r = await sb.from('pacientes').update(d).eq('id', p.id).select('id');
    if (!r.error) Object.assign(p, d);
  }

  // ---------- Expediente del paciente nuevo ----------
  // Nombre, teléfono, correo, médico (el de la cita o el elegido) y sede; estado Activo, tipo de cliente y agente por defecto
  async function crearExpediente(dentistaId) {
    var datos = { nombre: $('agNombre').value.trim(), telefono: $('agTelefono').value.trim() || null, correo: $('agCorreo').value.trim() || null, estado: 'activo',
      dentista_id: dentistaId || ($('agMedico').value ? +$('agMedico').value : null) || (esQuiro() ? null : medicoPrincipal()) };
    if (esQuiro()) { datos.tipo_paciente = 'quiropractica'; datos.quiropractico_id = datos.dentista_id; datos.dentista_id = null; }
    if (window.PD_SEDES && $('agLoc').options.length > 1 && $('agLoc').value) Object.assign(datos, window.PD_SEDES.valores($('agOrg'), $('agLoc')));
    if (instCat.length) Object.assign(datos, datosTipo(null));
    var r = await sb.from('pacientes').insert(datos).select('*').single();
    if (r.error && /tipo_cliente|institucion_id|sucursal_id/.test(r.error.message || '')) { delete datos.tipo_cliente; delete datos.institucion_id; delete datos.sucursal_id; r = await sb.from('pacientes').insert(datos).select('*').single(); }
    if (r.error && /correo/.test(r.error.message || '')) { delete datos.correo; r = await sb.from('pacientes').insert(datos).select('id,nombre,dpi,telefono,dentista_id,estado').single(); }
    if (r.error) throw r.error;
    if (esQuiro()) r.data.dentista_id = r.data.quiropractico_id || null;
    pacientes.push(r.data);
    pacientes.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
    $('agPaciente').insertAdjacentHTML('beforeend', '<option value="' + r.data.id + '">' + esc(r.data.nombre) + '</option>');
    $('agPaciente').value = String(r.data.id);
    alCambiarPaciente();
    return r.data;
  }

  // ---------- Formulario ----------
  function pacienteElegido() {
    var v = $('agPaciente').value;
    if (!v || v === 'nuevo') return null;
    return pacientes.filter(function (p) { return String(p.id) === v; })[0] || null;
  }
  function alCambiarPaciente() {
    var nuevo = $('agPaciente').value === 'nuevo';
    $('agNombreWrap').hidden = !nuevo;
    $('agTelWrap').hidden = !nuevo;
    var p = pacienteElegido();
    $('agPacInfo').textContent = p ? [p.telefono ? 'WhatsApp ' + p.telefono : 'Sin teléfono en el expediente', p.correo ? 'Correo ' + p.correo : 'Sin correo', p.dentista_id ? 'Médico asignado: ' + nombreDentista(p.dentista_id) : 'Sin médico asignado'].join(' · ') : '';
    $('agCorreoWrap').hidden = !(nuevo || (p && !p.correo));
    ponerTipo(p && p.tipo_cliente === 'institucional' ? 'institucional' : 'directo'); opcionesInst(p ? p.institucion_id : null, p ? p.sucursal_id : null);
    $('agCorreo').value = '';
    if (!medicoElegidoAMano) {
      var porDefecto = p && p.dentista_id && dentistas.some(function (d) { return d.id === p.dentista_id; }) ? p.dentista_id : medicoPrincipal();
      $('agMedico').value = porDefecto ? String(porDefecto) : '';
    }
  }
  // Dentista principal de la clínica: el primero activo con rol «principal» (si no hay, el primero activo)
  var medicoElegidoAMano = false;
  function medicoPrincipal() {
    var d = dentistas.filter(function (x) { return x.rol_sala === 'principal'; })[0] || dentistas[0];
    return d ? d.id : null;
  }
  function alCambiarTratamiento() {
    var esp = especialidadRequerida();
    $('agEspDetectada').textContent = ($('agEspecialidad').value ? '' : esp ? 'Especialidad detectada: ' + esp + '.' : 'No se detectó una especialidad: se buscará entre todos los dentistas.') +
      (esOrtodoncia($('agTratamiento').value, esp) ? ' Ortodoncia: horarios cada 10 minutos.' : '');
    if ($('agHoraM')) opcionesHorario();
  }
  function pintarFijo() {
    if (fijo) modoHorario('buscar');
    $('agFijo').hidden = !fijo;
    if (fijo) $('agFijo').innerHTML = '<div class="ag-fijo">Horario elegido en la agenda: <b>' + textoFecha(fijo.fecha) + ' · ' + fijo.hora + (fijo.sala ? ' · ' + esc(nombreSala(fijo.sala)) : '') + '</b><button type="button" class="adm-btn" id="agQuitarFijo" style="min-height:34px;padding:5px 12px">Quitar</button></div>';
  }

  // ---------- Avisos: WhatsApp al paciente y al médico, recordatorio por correo ----------
  var CLINICA = 'Reforma Montúfar, zona 10, Nivel 9, Oficina 910, Ciudad de Guatemala', TEL_CLINICA = '+502 3756-5739';
  function datosAviso(c) {
    var d = dentistas.filter(function (x) { return x.id === c.dentista_id; })[0] || null;
    return {
      cuando: textoFecha(c.fecha) + ' a las ' + hhmm(c.hora),
      dentista: d, sala: c.posicion_id ? nombreSala(c.posicion_id) : ''
    };
  }
  function avisosHtml(c, cuales) {
    var a = datosAviso(c), b = [];
    var pac = telWa(c.telefono), med = a.dentista ? telWa(a.dentista.telefono) : '';
    if (cuales.paciente) {
      var tp = 'Hola ' + c.nombre + ', le confirmamos su cita en Plus Dental el ' + a.cuando + (a.dentista ? ' con ' + a.dentista.nombre : '') +
        (a.sala ? ' (' + a.sala + ')' : '') + ' para ' + c.servicio + '. Dirección: ' + CLINICA + '. Si necesita cambiarla, responda a este mensaje. ¡Le esperamos!';
      b.push(pac ? '<a class="adm-btn" href="https://wa.me/' + pac + '?text=' + encodeURIComponent(tp) + '" target="_blank" rel="noopener">WhatsApp al paciente</a>'
        : '<span class="dlg-msg">El paciente no tiene teléfono.</span>');
    }
    if (cuales.medico) {
      var tm = 'Hola ' + (a.dentista ? a.dentista.nombre : '') + ', tiene una cita asignada en Plus Dental:\n' +
        'Paciente: ' + c.nombre + '\nTratamiento: ' + c.servicio + '\nFecha y hora: ' + a.cuando + (a.sala ? '\nSala: ' + a.sala : '') +
        (c.prioridad === 'urgente' ? '\nPrioridad: URGENTE' : '') + (c.notas ? '\nMotivo: ' + c.notas : '');
      b.push(!a.dentista ? '<span class="dlg-msg">La cita no tiene médico asignado.</span>'
        : med ? '<a class="adm-btn" href="https://wa.me/' + med + '?text=' + encodeURIComponent(tm) + '" target="_blank" rel="noopener">WhatsApp al médico</a>'
          : '<span class="dlg-msg">' + esc(a.dentista.nombre) + ' no tiene teléfono en su ficha.</span>');
    }
    if (cuales.correo) {
      var correo = c.correo || '';
      var asunto = 'Recordatorio de su cita en Plus Dental · ' + a.cuando;
      var cuerpo = 'Hola ' + c.nombre + ':\n\nLe recordamos su cita en Plus Dental:\n\n' +
        '• Fecha y hora: ' + a.cuando + '\n• Tratamiento: ' + c.servicio + (a.dentista ? '\n• Odontólogo: ' + a.dentista.nombre : '') + (a.sala ? '\n• Sala: ' + a.sala : '') +
        '\n\nDirección: ' + CLINICA + '.\nSi necesita cambiar su cita, escríbanos o llame al ' + TEL_CLINICA + '.\n\nPlus Dental · La tranquilidad también es parte del tratamiento.';
      b.push(correo ? '<a class="adm-btn" href="mailto:' + encodeURIComponent(correo) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo) + '">Recordatorio por correo</a>'
        : '<span class="dlg-msg">El paciente no tiene correo registrado.</span>');
    }
    return b.length ? '<div class="ag-aviso-btns">' + b.join('') + '</div>' : '';
  }

  // Horas libres para guardar en un horario específico: sin horas bloqueadas ni ocupadas (las pasadas sí se permiten)
  // (ocupada = el médico elegido ya tiene cita, la sala elegida ya está usada, o no queda ninguna sala libre)
  function horaLibre(f, h, medicoId, salaId, dur) {
    dur = dur || durNueva();
    if (bloqueado(f, h, dur, medicoId)) return false;
    if (medicoId && dentistaOcupado(medicoId, f, h, dur)) return false;
    var activas = salas.filter(function (x) { return x.activa; });
    if (salaId) {
      var sala = salas.filter(function (x) { return x.id === salaId; })[0];
      return !!sala && salaAbierta(sala, f, h) && !salaOcupada(salaId, f, h, dur);
    }
    if (activas.length) return activas.some(function (x) { return salaAbierta(x, f, h) && !salaOcupada(x.id, f, h, dur); });
    return !ocupan(f, h, dur).length;
  }
  function opcionesHorario() {
    var f = $('agFechaM').value, actual = $('agHoraM').value;
    var sala = $('agSalaM').value;
    $('agSalaM').innerHTML = '<option value="">La del médico</option>' + salas.filter(function (s) { return s.activa; }).map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.codigo + ' · ' + s.nombre) + '</option>';
    }).join('');
    $('agSalaM').value = sala;
    var medicoId = $('agMedico').value ? +$('agMedico').value : null;
    var medico = medicoId ? dentistas.filter(function (d) { return d.id === medicoId; })[0] : null;
    var salaId = sala ? +sala : medico && medico.posicion_id ? medico.posicion_id : null;
    var dur = durMedico(medico);
    // Con una sala elegida se ofrecen todas las horas libres de la agenda (cada 15 minutos, de 7:00 a 19:00),
    // no solo las del horario y la frecuencia del médico; se descartan las bloqueadas y las que chocan con otra cita
    var base = !f ? [] : sala ? horarios(f, PASO).filter(function (h) { return enJornada(f, aMin(h) + dur - 1); }) : horariosMedico(f, medico);
    var lista = base.filter(function (h) { return horaLibre(f, h, medicoId, salaId, dur); });
    $('agHoraM').innerHTML = lista.length ? lista.map(function (h) { return '<option value="' + h + '">' + h + '</option>'; }).join('')
      : '<option value="">' + (!f ? 'Elige la fecha' : !turnos(f).length ? 'La clínica no atiende ese día' : 'Sin horarios libres ese día') + '</option>';
    $('agHoraM').disabled = !lista.length;
    if (lista.indexOf(actual) >= 0) $('agHoraM').value = actual;
  }

  // Guardar en el horario elegido: si hay médico elegido se usa; si no, el asistente elige el más adecuado para ese horario

  // Sede elegida en el paso 4 (si no, Supabase usa la del usuario o la del odontólogo)
  async function sedeCita(id) { if (!id || !window.PD_SEDES || $('agLoc').options.length <= 1 || !$('agLoc').value) return; await sb.from('citas').update(window.PD_SEDES.valores($('agOrg'), $('agLoc'))).eq('id', id); }
  async function guardarDirecto(boton) {
    var f = $('agFechaM').value, h = $('agHoraM').value;
    if (!$('agPaciente').value) { aviso('agMsgM', 'Elige el paciente arriba.', true); return; }
    if (!$('agTratamiento').value.trim()) { aviso('agMsgM', 'Indica el tratamiento arriba.', true); return; }
    if (!f || !h) { aviso('agMsgM', 'Elige la fecha y la hora.', true); return; }
    if (bloqueado(f, h, durNueva(), $('agMedico').value ? +$('agMedico').value : null)) { aviso('agMsgM', 'Ese horario está bloqueado' + ($('agMedico').value ? ' para ese médico' : '') + '.', true); return; }
    if (!horaLibre(f, h, $('agMedico').value ? +$('agMedico').value : null, $('agSalaM').value ? +$('agSalaM').value : null, durMedico($('agMedico').value ? dentistas.filter(function (d) { return d.id === +$('agMedico').value; })[0] : null))) { aviso('agMsgM', 'Ese horario ya pasó o está ocupado. Elige otra hora.', true); opcionesHorario(); return; }
    var salaElegida = $('agSalaM').value ? +$('agSalaM').value : null;
    var medico = $('agMedico').value ? dentistas.filter(function (d) { return d.id === +$('agMedico').value; })[0] : null;
    var opcion = null;
    if (!medico) {
      var anterior = fijo;
      fijo = { fecha: f, hora: h, sala: salaElegida };
      opcion = sugerir().opciones[0] || null;
      fijo = anterior;
    }
    if (!opcion) {
      var sala = salaElegida ? salas.filter(function (s) { return s.id === salaElegida; })[0]
        : medico && medico.posicion_id ? salas.filter(function (s) { return s.id === medico.posicion_id; })[0] : null;
      opcion = { fecha: f, hora: h, dentista: medico, sala: sala || null };
    }
    // Sin silla elegida: se asigna una silla libre a esa hora (la del médico si está libre), así varias citas
    // pueden quedar en el mismo horario, cada una en su silla.
    if (!opcion.sala && !esQuiro()) {
      var durS = durMedico(opcion.dentista || null), activasS = salas.filter(function (s) { return s.activa && salaAbierta(s, f, h) && !salaOcupada(s.id, f, h, durS); });
      var propia = opcion.dentista && opcion.dentista.posicion_id ? activasS.filter(function (s) { return s.id === opcion.dentista.posicion_id; })[0] : null;
      if (activasS.length) opcion.sala = propia || activasS[0];
      else if (salas.some(function (s) { return s.activa; })) { aviso('agMsgM', 'No queda ninguna silla libre a esa hora: elige otro horario.', true); return; }
    }
    var avisoHorario = opcion.dentista && !atiende(opcion.dentista, f, h) ? ' Ojo: según su ficha, ' + opcion.dentista.nombre + ' no atiende a esa hora.' : '';
    aviso('agMsgM', '');
    aviso('agFormMsg', '');
    await agendar(opcion, boton);
    if (!$('agFormMsg').textContent) aviso('agMsgM', 'Cita guardada.' + avisoHorario, !!avisoHorario);
    else aviso('agMsgM', $('agFormMsg').textContent, true);
    $('agSugerencias').scrollIntoView({ block: 'nearest' });
  }

  async function agendar(o, boton) {
    var p = pacienteElegido(), nuevo = $('agPaciente').value === 'nuevo';
    if (!p && !nuevo) { aviso('agFormMsg', 'Elige el paciente.', true); return; }
    if (nuevo && (!$('agNombre').value.trim() || !$('agTelefono').value.trim())) { aviso('agFormMsg', 'Escribe el nombre y el teléfono del paciente nuevo.', true); return; }
    if (!tipoValido()) return;
    boton.disabled = true;
    var expedienteNuevo = false;
    if (nuevo) {
      aviso('agFormMsg', 'Creando el expediente del paciente…');
      try { p = await crearExpediente(o.dentista ? o.dentista.id : null); nuevo = false; expedienteNuevo = true; } catch (e) { boton.disabled = false; aviso('agFormMsg', 'No se pudo crear el expediente: ' + traducir(e), true); return; }
    }
    aviso('agFormMsg', 'Agendando…');
    var r = await sb.rpc('agendar_cita', {
      p_fecha: o.fecha, p_hora: o.hora,
      p_paciente_id: p ? p.id : null,
      p_nombre: nuevo ? $('agNombre').value.trim() : null,
      p_telefono: nuevo ? $('agTelefono').value.trim() : null,
      p_servicio: $('agTratamiento').value.trim(),
      p_dentista_id: o.dentista && !esQuiro() ? o.dentista.id : null,
      p_posicion_id: o.sala && !esQuiro() ? o.sala.id : null,
      p_quiropractico_id: o.dentista && esQuiro() ? o.dentista.id : null,
      p_prioridad: $('agPrioridad').value,
      p_notas: $('agNotas').value.trim(),
      p_estado: $('agEstado').value
    });
    boton.disabled = false;
    if (r.error) { aviso('agFormMsg', traducir(r.error), true); await cargarCitas(); return; }
    await sedeCita(r.data);
    await guardarDuracion(r.data);
    await guardarTipo(p);
    var nombre = p ? p.nombre : $('agNombre').value.trim(), tel = p ? p.telefono : $('agTelefono').value.trim();
    var correo = (p && p.correo) || $('agCorreo').value.trim();
    if (p && !p.correo && correo) {
      var ac = await sb.from('pacientes').update({ correo: correo }).eq('id', p.id).select('id');
      if (!ac.error) p.correo = correo;
    }
    var cita = { fecha: o.fecha, hora: o.hora, nombre: nombre, telefono: tel, correo: correo, servicio: $('agTratamiento').value.trim(),
      dentista_id: o.dentista ? o.dentista.id : null, posicion_id: o.sala ? o.sala.id : null, prioridad: $('agPrioridad').value, notas: $('agNotas').value.trim() };
    var avisos = avisosHtml(cita, { paciente: $('agAvPac').checked, medico: $('agAvMed').checked, correo: $('agAvMail').checked });
    $('agSugerencias').innerHTML = '<div class="ag-fijo" style="background:#DCF2EC;border-color:#BFE6D8;color:#08504C;flex-direction:column;align-items:flex-start">' +
      '<span>Cita agendada: <b>' + textoFecha(o.fecha) + ' · ' + o.hora + ' · ' + esc(nombre) + '</b></span>' +
      (expedienteNuevo ? '<span>Se creó el expediente de <b>' + esc(nombre) + '</b> (Pacientes › Expediente de pacientes): complétalo cuando puedas.</span>' : '') +
      (avisos ? '<span>Envía los avisos:</span>' + avisos : '') + '</div>';
    aviso('agFormMsg', '');
    fijo = null; pintarFijo();
    $('agNotas').value = '';
    $('agDia').value = o.fecha;
    await cargarCitas();
  }

  // ---------- Agenda del día ----------
  // Lunes de la semana de una fecha
  function lunesDe(f) { var d = fecha(f).getDay(); return sumar(f, d === 0 ? -6 : 1 - d); }

  var MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function primeroDelMes(f) { return f.slice(0, 8) + '01'; }
  function ultimoDelMes(f) { var d = fecha(primeroDelMes(f)); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); }
  function sumarMeses(f, n) { var d = fecha(primeroDelMes(f)); d.setMonth(d.getMonth() + n); return iso(d); }
  // Rango que se ve en pantalla (y que se imprime)
  function rangoVista() {
    var f = $('agDia').value || hoy();
    if (vista === 'mes') { var ini = lunesDe(primeroDelMes(f)); var u = ultimoDelMes(f), dsem = fecha(u).getDay(); return { desde: ini, hasta: dsem === 0 ? u : sumar(u, 7 - dsem), mesDesde: primeroDelMes(f), mesHasta: u }; }
    if (vista === 'semana') { var l = lunesDe(f); return { desde: l, hasta: sumar(l, 6) }; }
    return { desde: f, hasta: f };
  }
  async function cargarCitas() {
    var rv = rangoVista(), inicio = rv.desde, fin = rv.hasta;
    var desde = hoy() < inicio ? hoy() : inicio;
    var hasta = sumar(hoy(), DIAS_BUSQUEDA + 31);
    if (fin > hasta) hasta = fin;
    if (inicio < desde) desde = inicio;
    var r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada,creada_por,reprogramada_de,tipo,quiropractico_id,duracion')
      .gte('fecha', desde).lte('fecha', hasta);
    if (r.error && /duracion/.test(r.error.message)) r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada,creada_por,reprogramada_de,tipo,quiropractico_id')
      .gte('fecha', desde).lte('fecha', hasta);
    if (r.error && /tipo|quiropractico_id/.test(r.error.message)) r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada,creada_por,reprogramada_de')
      .gte('fecha', desde).lte('fecha', hasta);
    if (r.error && /creada_por|reprogramada_de/.test(r.error.message)) {
      r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada')
        .gte('fecha', desde).lte('fecha', hasta);
      if (!r.error) aviso('agMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los estados de la cita.', true);
    }
    if (r.error && /paciente_id|prioridad|notas/.test(r.error.message)) {
      r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id').gte('fecha', desde).lte('fecha', hasta);
      aviso('agMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para agendar desde aquí.', true);
    }
    var todasC = r.error ? [] : delArea(r.data);
    canceladas = todasC.filter(function (c) { return c.estado === 'cancelada'; });
    citas = todasC.filter(function (c) { return c.estado !== 'cancelada'; });
    if ($('agHoraM')) opcionesHorario();
    pintar();
  }

  // Citas del área elegida; en Quiropráctica el «médico» de la cita es su quiropráctico
  function delArea(lista) {
    return lista.filter(function (c) { return (c.tipo || 'odontologia') === window.PD_AREA; })
      .map(function (c) { if (esQuiro()) c.dentista_id = c.quiropractico_id || null; return c; });
  }
  // ---------- Filtros de la agenda: institución y médico ----------
  // El Super Administrador, el personal que no es médico y los médicos principales ven a todos los médicos;
  // un médico alterno (con usuario propio) solo ve sus citas.
  var citaInst = {}, pacInst = {}, citaSuc = {}, pacSuc = {}, citasTodas = null;
  function miDentista() { var u = window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario(); return u ? dentistas.filter(function (d) { return d.usuario && d.usuario === u; })[0] || null : null; }
  function soloMio() { var d = miDentista(); return d && !(window.PD_SESION && window.PD_SESION.esSuper()) && d.rol_sala !== 'principal' ? d : null; }
  function instDeCita(c) { return citaInst[c.id] || (c.paciente_id && pacInst[c.paciente_id]) || null; }
  function sucDeCita(c) { return citaInst[c.id] ? citaSuc[c.id] || null : (c.paciente_id && pacSuc[c.paciente_id]) || null; }
  function opcionesFiltros() {
    var fi = $('agFInst').value, fm = $('agFMed').value, yo = soloMio();
    $('agFInst').innerHTML = '<option value="">Todas las instituciones</option><option value="0">Sin institución (clínica)</option>' +
      instCat.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    $('agFInst').value = fi && [].some.call($('agFInst').options, function (o) { return o.value === fi; }) ? fi : '';
    opcionesSucFiltro();
    $('agFMed').innerHTML = (yo ? '' : '<option value="">Todos los médicos</option>') + (yo ? [yo] : dentistas).map(function (d) { return '<option value="' + d.id + '">' + esc(d.nombre) + '</option>'; }).join('');
    $('agFMed').value = yo ? String(yo.id) : fm && dentistas.some(function (d) { return String(d.id) === fm; }) ? fm : '';
    $('agFMed').disabled = !!yo;
    $('agFMed').title = yo ? 'Como médico, solo ves tus citas.' : '';
  }
  // Sucursal: solo cuando se elige una institución (todas o una; «Sede principal» = sin sucursal)
  function opcionesSucFiltro() {
    var inst = +$('agFInst').value || null, fs = $('agFSuc').value, l = inst ? sucCat.filter(function (x) { return x.institucion_id === inst; }) : [];
    $('agFSucWrap').hidden = !inst;
    $('agFSuc').innerHTML = '<option value="">Todas las sucursales</option><option value="0">Sede principal (sin sucursal)</option>' +
      l.map(function (x) { return '<option value="' + x.id + '">' + esc(codigoCat('SUC', x) + ' · ' + x.nombre) + '</option>'; }).join('');
    $('agFSuc').value = inst && fs && [].some.call($('agFSuc').options, function (o) { return o.value === fs; }) ? fs : '';
  }
  function pasaFiltro(c) {
    var fi = $('agFInst').value, yo = soloMio(), fm = yo ? yo.id : +$('agFMed').value || null;
    if (fm && c.dentista_id !== fm) return false;
    if (fi === '0') return !instDeCita(c);
    if (fi && instDeCita(c) !== +fi) return false;
    var fs = fi ? $('agFSuc').value : '';
    return !fs || (fs === '0' ? !sucDeCita(c) : sucDeCita(c) === +fs);
  }
  function filtrando() { return !!($('agFInst').value || $('agFMed').value || soloMio()); }
  // Pinta con las citas que pasan los filtros (también las canceladas); los espacios libres se calculan con todas las activas
  function conFiltro(fn) {
    var todas = citas; citasTodas = todas; citas = todas.concat(canceladas).filter(pasaFiltro);
    try { fn(); } finally { citas = todas; citasTodas = null; }
  }

  function pintar() { conFiltro(pintarFiltrado); }
  function pintarFiltrado() {
    document.querySelectorAll('.ag-vista [data-vista]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.vista === vista); });
    var fsel = $('agDia').value || hoy();
    $('agTitulo').textContent = vista === 'mes' ? 'Agenda de ' + MESES_LARGO[fecha(fsel).getMonth()] + ' ' + fecha(fsel).getFullYear() : vista === 'semana' ? 'Agenda de la semana' : 'Agenda del día';
    document.querySelector('.ag-grid').classList.toggle('ag-mes', vista === 'mes');
    $('agAyuda').innerHTML = vista === 'mes' ? 'Toca un día para verlo por salas, o una cita para ver su detalle.' : vista === 'semana'
      ? 'Toca un día o un <b>+ libre</b> para abrirlo por salas y agendar, o una cita para ver su detalle.'
      : 'Toca un espacio <b>Libre</b> para agendar ahí, o una cita para ver su detalle.';
    $('agPrev').setAttribute('aria-label', vista === 'mes' ? 'Mes anterior' : vista === 'semana' ? 'Semana anterior' : 'Día anterior');
    $('agNext').setAttribute('aria-label', vista === 'mes' ? 'Mes siguiente' : vista === 'semana' ? 'Semana siguiente' : 'Día siguiente');
    if (vista === 'mes') pintarMes(); else if (vista === 'semana') pintarSemana(); else pintarDia();
    pintarLeyenda();
    pintarResumen();
  }
  function pintarResumen() {
    var rv = rangoVista(), d = rv.mesDesde || rv.desde, h = rv.mesHasta || rv.hasta;
    var en = citas.filter(function (c) { return c.fecha >= d && c.fecha <= h && c.estado !== 'cancelada'; });
    var nCanc = citas.filter(function (c) { return c.fecha >= d && c.fecha <= h && c.estado === 'cancelada'; }).length;
    var porConfirmar = en.filter(function (c) { return c.estado === 'pendiente' || c.estado === 'reprogramada'; }).length;
    var urg = en.filter(function (c) { return c.prioridad === 'urgente'; }).length;
    if (vista === 'semana') {
      var a = fecha(d), b = fecha(h);
      $('agTitulo').textContent = 'Semana del ' + a.getDate() + (a.getMonth() !== b.getMonth() ? ' de ' + MESES_LARGO[a.getMonth()] : '') + ' al ' + b.getDate() + ' de ' + MESES_LARGO[b.getMonth()];
    }
    $('agResumen').innerHTML = '<b>' + en.length + '</b> ' + (en.length === 1 ? 'cita' : 'citas') + (porConfirmar ? ' · <b>' + porConfirmar + '</b> por confirmar' : '') + (urg ? ' · <b>' + urg + '</b> ' + (urg === 1 ? 'urgente' : 'urgentes') : '') + (nCanc ? ' · <b>' + nCanc + '</b> ' + (nCanc === 1 ? 'cancelada' : 'canceladas') : '');
  }
  var anchoAntes = semanaAngosta();
  window.addEventListener('resize', function () {
    if (semanaAngosta() === anchoAntes) return;
    anchoAntes = semanaAngosta();
    if (vista === 'semana' && $('admVerCitas') && !$('admVerCitas').hidden) pintar();
  });
  var COLOR_ESTADO = { pendiente: '#B45309', confirmada: '#4D8B1E', sala_espera: '#0E7490', atendiendose: '#DB2777', atendida: '#2F78C4', no_asiste: '#475569', reprogramada: '#6D5BD0', cancelada: '#C0263A' };
  function pintarLeyenda() {
    var rv = rangoVista(), d = rv.mesDesde || rv.desde, h = rv.mesHasta || rv.hasta;
    var enRango = citas.filter(function (c) { return c.fecha >= d && c.fecha <= h; });
    var urg = enRango.filter(function (c) { return c.prioridad === 'urgente'; }).length;
    $('agLeyenda').innerHTML = Object.keys(COLOR_ESTADO).map(function (e) {
      var n = enRango.filter(function (c) { return c.estado === e; }).length;
      return '<span title="Punto de estado en la esquina de cada cita"><i style="background:' + COLOR_ESTADO[e] + '"></i>' + ESTADOS_CITA[e] + ' · <b>' + n + '</b></span>';
    }).join('') + '<span class="ag-ley-urg">Urgente = borde rojo' + (urg ? ' · <b>' + urg + '</b>' : '') + '</span>' +
      (window.PD_COLOR && !esQuiro() ? dentistas.filter(function (d) { return window.PD_COLOR.color(d.id) && enRango.some(function (c) { return c.dentista_id === d.id; }); }).map(function (d) {
        return '<span class="ag-ley-med"><i style="background:' + window.PD_COLOR.color(d.id) + ';box-shadow:0 0 0 1px ' + window.PD_COLOR.linea(window.PD_COLOR.color(d.id)) + '"></i>' + esc(d.nombre) + ' · <b>' + enRango.filter(function (c) { return c.dentista_id === d.id; }).length + '</b></span>';
      }).join('') : '');
  }

  // Vista de semana: lunes a sábado, todas las salas en cada casilla
  // En pantallas angostas la semana se muestra como lista por día (sin desplazamiento lateral)
  function medEstilo(id) { return window.PD_COLOR && !esQuiro() ? window.PD_COLOR.estilo(id) : ''; }
  function semanaAngosta() { return window.innerWidth < 760; }
  function pintarSemanaLista(dias) {
    var g = document.querySelector('.ag-grid'); g.classList.remove('semana', 'semana2'); g.classList.add('semana-lista');
    $('agHead').innerHTML = '<tr><th>Día</th><th>Citas</th></tr>';
    $('agBody').innerHTML = dias.map(function (f) {
      var cs = citas.filter(function (c) { return c.fecha === f; }).sort(function (a, b) { return hhmm(a.hora) < hhmm(b.hora) ? -1 : 1; });
      var cuerpo = cs.length ? '<div class="ag-lista-citas">' + cs.map(function (x) {
        return '<button type="button" class="ag-mini cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '"' + medEstilo(x.dentista_id) + '><b class="ag-h">' + hhmm(x.hora) + '</b>' + nombrePaciente(x) + '<small class="ag-trat">' + esc(x.servicio || '') + '</small></button>';
      }).join('') + '</div>' : '<span class="ag-lista-vacia">' + (turnos(f).length ? 'Sin citas' : 'Cerrado') + '</span>';
      return '<tr class="' + (f === hoy() ? 'hoy' : '') + '"><td><button type="button" class="ag-dia-btn' + (f === hoy() ? ' hoy' : '') + '" data-ir-dia="' + f + '">' + textoFecha(f) + '</button></td><td>' + cuerpo + '</td></tr>';
    }).join('');
  }
  // Vista de semana (formato de cuadrícula): lunes a domingo en columnas, filas de 15 minutos con la hora a ambos lados.
  // Cada cita es un bloque del alto de su duración, con el color de su médico (gris si ya fue atendida) y un punto del estado.
  // Verde con «+» = espacio libre para agendar; rayado = bloqueado; blanco = la clínica no atiende.
  var PASO = 15, ALTO = 25;
  function hhmmDe(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  function enJornada(f, m) {
    var d = fecha(f).getDay(), j = d === 0 ? [] : d === 6 ? JORNADA.sabado : JORNADA.semana;
    return j.some(function (x) { return m >= aMin(x[0]) && m < aMin(x[1]); });
  }
  // Carriles: citas que se traslapan el mismo día van lado a lado
  function carriles(cs) {
    cs = cs.slice().sort(function (a, b) { return aMin(a.hora) - aMin(b.hora) || a.id - b.id; });
    var grupos = [], g = null, finG = -1;
    cs.forEach(function (c) {
      var a = aMin(c.hora), b = a + duracion(c);
      if (!g || a >= finG) { g = []; grupos.push(g); finG = b; } else finG = Math.max(finG, b);
      var fines = g.lanes || (g.lanes = []), k = fines.findIndex(function (x) { return x <= a; });
      if (k < 0) { k = fines.length; fines.push(b); } else fines[k] = b;
      c._lane = k; g.push(c);
    });
    grupos.forEach(function (x) { x.forEach(function (c) { c._lanes = x.lanes.length; }); });
    return cs;
  }
  // Bloque de una cita dentro de la celda de la fila donde empieza
  function bloque2(c, m, conMedico) {
    var dur = duracion(c), alto = Math.max(1, dur / PASO) * ALTO - 3, ancho = 100 / c._lanes, off = (aMin(c.hora) - m) / PASO * ALTO;
    // Se deja libre una franja a la derecha para el «+»: en el mismo horario se agenda otra cita en otra silla.
    var pos = 'top:' + (off + 1) + 'px;height:' + alto + 'px;left:calc((100% - 22px) * ' + (c._lane / c._lanes) + ' + 2px);width:calc((100% - 22px) / ' + c._lanes + ' - 4px)';
    var est = medEstilo(c.dentista_id), estilo = est ? est.replace('style="', 'style="' + pos + ';') : ' style="' + pos + '"';
    var filas = Math.max(1, dur / PASO);
    return '<button type="button" class="ag2-cita ' + c.estado + (c.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + c.id + '"' + estilo +
      ' title="' + esc(hhmm(c.hora) + ' · ' + c.nombre + ' · ' + (c.servicio || '') + ' · ' + nombreDentista(c.dentista_id) + ' · ' + (ESTADOS_CITA[c.estado] || '')) + '">' +
      '<i class="ag2-punto" style="background:' + (COLOR_ESTADO[c.estado] || '#94A6B2') + '"></i>' + nombrePaciente(c) +
      (filas > 1 ? '<small>' + esc(hhmm(c.hora) + ' · ' + (c.servicio || '')) + '</small>' : '') +
      '<em class="ag2-est" style="--est:' + (COLOR_ESTADO[c.estado] || '#94A6B2') + '">' + esc(ESTADOS_CITA[c.estado] || c.estado) + '</em>' +
      (conMedico && filas > 2 ? '<small>' + esc(nombreDentista(c.dentista_id)) + '</small>' : '') + '</button>';
  }
  // cols: [{ th: html del encabezado, citas: [...], celda: function (m, hh) → [clase, html del «+»], hoy }]
  function cuadricula(cols, conMedico) {
    var g = document.querySelector('.ag-grid'); g.classList.remove('semana-lista', 'semana'); g.classList.add('semana2');
    var desde = aMin(JORNADA.semana[0][0]), hasta = aMin(JORNADA.semana[JORNADA.semana.length - 1][1]);
    cols.forEach(function (c) {
      carriles(c.citas).forEach(function (x) { var a = aMin(x.hora); desde = Math.min(desde, Math.floor(a / PASO) * PASO); hasta = Math.max(hasta, Math.ceil((a + duracion(x)) / PASO) * PASO); });
      c.inicioEn = {};
      c.citas.forEach(function (x) { var k = Math.floor(aMin(x.hora) / PASO) * PASO; (c.inicioEn[k] = c.inicioEn[k] || []).push(x); });
    });
    $('agHead').innerHTML = '<tr><th class="ag2-h"></th>' + cols.map(function (c) { return '<th class="' + (c.hoy ? 'hoy' : '') + '">' + c.th + '</th>'; }).join('') + '<th class="ag2-h"></th></tr>';
    var filas = [];
    for (var m = desde; m < hasta; m += PASO) {
      var hh = hhmmDe(m);
      filas.push('<tr' + (m % 60 === 0 ? ' class="ag2-hora"' : '') + '><td class="ag2-t">' + hh + '</td>' + cols.map(function (c) {
        var blq = (c.inicioEn[m] || []).map(function (x) { return bloque2(x, m, conMedico); }).join(''), e = c.celda(m, hh);
        return '<td class="ag2-c ' + e[0] + (c.hoy ? ' hoy' : '') + '"' + (e[2] ? ' title="' + esc(e[2]) + '"' : '') + '>' + (e[1] || '') + blq + '</td>';
      }).join('') + '<td class="ag2-t">' + hh + '</td></tr>');
    }
    $('agBody').innerHTML = filas.join('');
  }
  function yaPaso(f, m) { var a = new Date(); return f < hoy() || (f === hoy() && m <= a.getHours() * 60 + a.getMinutes()); }
  function botonMas(f, hh, sala, texto) {
    return '<button type="button" class="ag2-mas" data-libre="' + hh + '" data-fecha="' + f + '" data-sala="' + (sala || '') + '" aria-label="Agendar ' + esc(texto) + ' a las ' + hh + '">+</button>';
  }
  function pintarSemana() {
    var inicio = lunesDe($('agDia').value), dias = [];
    for (var i = 0; i < 7; i++) dias.push(sumar(inicio, i));
    if (semanaAngosta()) { pintarSemanaLista(dias); return; }
    var activas = salas.filter(function (x) { return x.activa; });
    cuadricula(dias.map(function (f) {
      var d = fecha(f), cs = citas.filter(function (c) { return c.fecha === f; });
      return {
        hoy: f === hoy(), citas: cs,
        th: '<button type="button" class="ag2-dia" data-ir-dia="' + f + '" title="Ver el día por salas">' + ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d.getDay()] + ' ' + ('0' + d.getDate()).slice(-2) +
          (cs.length ? '<small>' + cs.length + (cs.length === 1 ? ' cita' : ' citas') + '</small>' : '') + '</button>',
        celda: function (m, hh) {
          if (!enJornada(f, m)) return ['fuera'];
          var cb = celdaBloqueo(f, hh, medDelFiltro());
          if (cb && cb[0]) return cb;
          if (bloqueado(f, hh, PASO)) return ['bloq', '', 'Bloqueado'];
          var r = (function () {
          var hay = activas.length ? activas.some(function (x) { return salaAbierta(x, f, hh) && !salaOcupada(x.id, f, hh, PASO); }) : !ocupan(f, hh, PASO).length;
          if (!hay) return ['lleno'];
          // Horas ya pasadas: también se pueden registrar (citas atendidas o que faltó anotar)
          if (yaPaso(f, m)) return ['pasado-libre', botonMas(f, hh, null, 'el ' + textoFecha(f)), 'Hora pasada: puedes registrar una cita'];
          return ['libre', botonMas(f, hh, null, 'el ' + textoFecha(f))];
          })();
          if (cb && cb.parcial) { r[0] += ' bloq-parcial'; r[1] = (r[1] || '') + cb.parcial; r[2] = cb.titulo; }
          return r;
        }
      };
    }), false);
  }

  // Vista de mes: calendario de lunes a domingo con las citas de cada día
  function pintarMes() {
    document.querySelector('.ag-grid').classList.remove('semana', 'semana-lista', 'semana2');
    var rv = rangoVista(), dias = [], f = rv.desde;
    while (f <= rv.hasta) { dias.push(f); f = sumar(f, 1); }
    $('agHead').innerHTML = '<tr>' + ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr>';
    var filas = [];
    for (var i = 0; i < dias.length; i += 7) filas.push(dias.slice(i, i + 7));
    $('agBody').innerHTML = filas.map(function (sem) {
      return '<tr>' + sem.map(function (d) {
        var cs = citas.filter(function (c) { return c.fecha === d; }).sort(function (a, b) { return hhmm(a.hora).localeCompare(hhmm(b.hora)); });
        var fuera = d < rv.mesDesde || d > rv.mesHasta;
        var lista = cs.slice(0, 3).map(function (x) {
          return '<button type="button" class="ag-mini cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '"' + medEstilo(x.dentista_id) + ' title="' + esc(hhmm(x.hora) + ' · ' + x.nombre + ' · ' + x.servicio) + '"><b>' + hhmm(x.hora) + '</b> ' + nombrePaciente(x) + '<small class="ag-trat">' + esc(x.servicio || '') + '</small></button>';
        }).join('') + (cs.length > 3 ? '<button type="button" class="mas ag-mini" data-ir-dia="' + d + '" style="border:0;background:none;padding:0">+ ' + (cs.length - 3) + ' más</button>' : '');
        return '<td class="' + (fuera ? 'fuera' : '') + (d === hoy() ? ' hoy' : '') + '"><button type="button" class="ag-mes-dia" data-ir-dia="' + d + '">' + fecha(d).getDate() +
          (cs.length ? '<small>' + cs.length + (cs.length === 1 ? ' cita' : ' citas') + '</small>' : '') + '</button>' + lista + '</td>';
      }).join('') + '</tr>';
    }).join('');
  }

  // Imprimir la agenda que se ve (día, semana o mes): lista ordenada por fecha y hora
  function imprimirAgenda() { conFiltro(imprimirFiltrado); }
  function imprimirFiltrado() {
    var imp = window.PD_IMPRESION;
    if (!imp) return;
    var rv = rangoVista(), desde = vista === 'mes' ? rv.mesDesde : rv.desde, hasta = vista === 'mes' ? rv.mesHasta : rv.hasta;
    var lista = citas.filter(function (c) { return c.fecha >= desde && c.fecha <= hasta; })
      .sort(function (a, b) { return a.fecha.localeCompare(b.fecha) || hhmm(a.hora).localeCompare(hhmm(b.hora)); });
    var celda = 'padding:7px 6px;border-bottom:1px solid #D9E4EC';
    var th = celda + ';background:#0B2B40;color:#FFFFFF;font-size:10.5px;text-transform:uppercase;text-align:left';
    var periodo = vista === 'mes' ? MESES_LARGO[fecha(desde).getMonth()] + ' ' + fecha(desde).getFullYear()
      : vista === 'semana' ? textoFecha(desde) + ' al ' + textoFecha(hasta) + ' ' + fecha(hasta).getFullYear() : textoFecha(desde) + ' ' + fecha(desde).getFullYear();
    var titulo = vista === 'mes' ? 'Agenda del mes' : vista === 'semana' ? 'Agenda de la semana' : 'Agenda del día';
    var cuerpo = '', diaAnt = '';
    lista.forEach(function (c) {
      if (c.fecha !== diaAnt) {
        diaAnt = c.fecha;
        var n = lista.filter(function (x) { return x.fecha === c.fecha; }).length;
        cuerpo += '<tr><td colspan="6" style="padding:8px 6px;background:#EEF5FA;font-weight:800">' + textoFecha(c.fecha) + ' · ' + n + (n === 1 ? ' cita' : ' citas') + '</td></tr>';
      }
      cuerpo += '<tr><td style="' + celda + ';font-weight:700">' + hhmm(c.hora) + '</td><td style="' + celda + '">' + esc(c.nombre) + (c.prioridad === 'urgente' ? ' <b style="color:#9F1239">(urgente)</b>' : '') + (c.telefono ? '<br><span style="color:#5A6D7A">' + esc(c.telefono) + '</span>' : '') + '</td>' +
        '<td style="' + celda + '">' + esc(c.servicio || '') + '</td><td style="' + celda + '">' + esc(nombreDentista(c.dentista_id)) + '</td>' +
        '<td style="' + celda + '">' + esc(c.posicion_id ? nombreSala(c.posicion_id) : 'Sin sala') + '</td><td style="' + celda + '">' + (ESTADOS_CITA[c.estado] || c.estado) + '</td></tr>';
    });
    imp.imprimir(imp.encabezado(titulo) +
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:10px 14px;margin-bottom:14px">' +
      '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Periodo</span><b style="font-size:15px">' + esc(periodo) + '</b></div>' +
      '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Institución · médico</span><b style="font-size:13px">' + esc($('agFInst').selectedOptions[0] ? $('agFInst').selectedOptions[0].text : 'Todas') + (+$('agFInst').value && $('agFSuc').selectedOptions[0] ? ' · ' + esc($('agFSuc').selectedOptions[0].text) : '') + ' · ' + esc($('agFMed').selectedOptions[0] ? $('agFMed').selectedOptions[0].text : 'Todos') + '</b></div>' +
      '<div style="text-align:right"><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Citas</span><b style="font-size:15px">' + lista.length + '</b></div></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr><th style="' + th + '">Hora</th><th style="' + th + '">Paciente</th><th style="' + th + '">Tratamiento</th><th style="' + th + '">Odontólogo</th><th style="' + th + '">Sala</th><th style="' + th + '">Estado</th></tr></thead><tbody>' +
      (cuerpo || '<tr><td colspan="6" style="' + celda + '">No hay citas en este periodo.</td></tr>') + '</tbody></table></div>');
  }

  // Nombre del paciente: si tiene expediente, al tocarlo se abre su expediente
  function nombrePaciente(x) {
    return x.paciente_id && window.PD_EXPEDIENTE ? '<span class="ag-pac" data-ir-exp="' + x.paciente_id + '" title="Abrir expediente de ' + esc(x.nombre) + '">' + esc(x.nombre) + '</span>' : esc(x.nombre);
  }
  function irExpediente(id) { if (window.PD_EXPEDIENTE) window.PD_EXPEDIENTE.abrir(+id); }

  function pintarDia() {
    var f = $('agDia').value, del = citas.filter(function (c) { return c.fecha === f; });
    var cols = salas.filter(function (x) { return x.activa; }).map(function (x) { return { id: x.id, titulo: x.codigo + ' · ' + x.nombre, sala: x }; });
    if (del.some(function (c) { return !c.posicion_id; }) || !cols.length) cols.push({ id: null, titulo: 'Sin sala asignada', sala: null });
    var todas = citasTodas || citas;
    cuadricula(cols.map(function (k) {
      var cs = del.filter(function (c) { return (c.posicion_id || null) === k.id; });
      return {
        hoy: false, citas: cs,
        th: '<span class="ag2-dia ag2-sala">' + esc(k.titulo) + (cs.length ? '<small>' + cs.length + (cs.length === 1 ? ' cita' : ' citas') + '</small>' : '') + '</span>',
        celda: function (m, hh) {
          if (!enJornada(f, m)) return ['fuera'];
          var cb = celdaBloqueo(f, hh, medDelFiltro());
          if (cb && cb[0]) return cb;
          if (bloqueado(f, hh, PASO)) return ['bloq', '', 'Bloqueado'];
          if (k.sala && !salaAbierta(k.sala, f, hh)) return ['cerrada', '', k.sala.estado === 'mantenimiento' ? 'Fuera de servicio' : 'Sala cerrada'];
          var ocupada = k.sala ? salaOcupada(k.id, f, hh, PASO) : todas.some(function (x) { return x.fecha === f && !x.posicion_id && choca(m, PASO, aMin(x.hora), duracion(x)); });
          if (ocupada) return ['lleno'];
          if (yaPaso(f, m)) return ['pasado-libre', botonMas(f, hh, k.id, 'en ' + k.titulo), 'Hora pasada: puedes registrar una cita'];
          return ['libre', botonMas(f, hh, k.id, 'en ' + k.titulo)];
        }
      };
    }), true);
  }

  function verDetalle(id) {
    var c = citas.concat(canceladas).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var pac = pacientes.filter(function (p) { return p.id === c.paciente_id; })[0];
    var conCorreo = Object.assign({}, c, { correo: pac && pac.correo });
    var activa = c.estado !== 'atendida' && c.estado !== 'cancelada';
    var campo = function (t, v) { return '<div><dt>' + t + '</dt><dd>' + v + '</dd></div>'; };
    $('agDetalle').hidden = false;
    $('agDetalle').classList.add('ag-det');
    $('agDetalle').innerHTML =
      '<div class="ag-det-head"><div><h3>' + esc(c.nombre) + (c.prioridad === 'urgente' ? ' <span class="ag-urg">Urgente</span>' : '') + '</h3>' +
      '<div class="ag-det-cuando">' + textoFecha(c.fecha) + ' · <b>' + hhmm(c.hora) + '</b>' + (c.servicio ? ' · ' + esc(c.servicio) : '') + '</div></div>' +
      '<div class="ag-det-der"><span class="estado estado-' + c.estado + '">' + (ESTADOS_CITA[c.estado] || c.estado) + '</span>' +
      '<button type="button" class="ag-det-x" data-det-cerrar aria-label="Cerrar">×</button></div></div>' +
      '<dl class="ag-det-grid">' +
      campo('Odontólogo', esc(nombreDentista(c.dentista_id))) +
      campo('Sala', esc(c.posicion_id ? nombreSala(c.posicion_id) : 'Sin sala')) +
      campo('Duración', duracion(c) + ' minutos' + (c.duracion ? '' : ' (automática)')) +
      campo('WhatsApp', c.telefono ? esc(c.telefono) : '—') +
      campo('Fecha y hora de grabación', fechaHoraGrab(c.creada)) +
      campo('Usuario que graba', esc(c.creada_por || 'Sin usuario')) +
      campo('Reprogramada de', c.reprogramada_de ? esc(textoFecha(c.reprogramada_de.slice(0, 10)) + ' · ' + c.reprogramada_de.slice(11, 16)) : '—') +
      '</dl>' +
      (c.notas ? '<p class="ag-det-notas">' + esc(c.notas) + '</p>' : '') +
      '<div class="ag-det-acc">' +
      '<span class="ag-det-est">Cambiar estado:</span>' + CATALOGO_CITA.filter(function (e) { return e !== c.estado; }).map(function (e) {
        return '<button type="button" class="adm-btn ag-est-btn" style="--est:' + COLOR_ESTADO[e] + '" data-det-estado="' + e + '" data-id="' + c.id + '">' + ESTADOS_CITA[e] + '</button>';
      }).join('') + '<span class="ag-det-sep"></span>' +
      (c.estado !== 'cancelada' ? '<button type="button" class="adm-btn ag-det-mod" data-det-editar="' + c.id + '">✎ Modificar cita</button>' : '') +
      (activa ? '<button type="button" class="adm-btn" data-det-repro="' + c.id + '">Reprogramar</button>' : '') +
      (c.paciente_id && window.PD_EXPEDIENTE ? '<button type="button" class="adm-btn" data-ir-exp="' + c.paciente_id + '">Ver expediente</button>' : '') +
      (c.estado !== 'cancelada' ? '<button type="button" class="adm-btn ag-det-cancel" data-det-estado="cancelada" data-id="' + c.id + '" data-confirmar="0">Anular cita</button>' : '') +
      '</div>' +
      '<details class="ag-det-avisos"><summary>Avisos y recordatorios</summary><div>' + avisosHtml(conCorreo, { paciente: true, medico: true, correo: true }) + '</div></details>';
    $('agDetalle').scrollIntoView({ block: 'nearest' });
  }

  // ---------- Modificar la cita desde la agenda ----------
  function editarCita(id) {
    var c = citas.concat(canceladas).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var q = esQuiro();
    var opMed = '<option value="">Sin asignar</option>' + dentistas.map(function (d) { return '<option value="' + d.id + '"' + (d.id === c.dentista_id ? ' selected' : '') + '>' + esc(d.nombre) + '</option>'; }).join('');
    if (c.dentista_id && !dentistas.some(function (d) { return d.id === c.dentista_id; })) opMed += '<option value="' + c.dentista_id + '" selected>' + esc(nombreDentista(c.dentista_id)) + '</option>';
    var opSala = '<option value="">Sin sala</option>' + salas.map(function (s) { return '<option value="' + s.id + '"' + (s.id === c.posicion_id ? ' selected' : '') + '>' + esc(s.codigo + ' · ' + s.nombre) + (s.activa ? '' : ' (inactiva)') + '</option>'; }).join('');
    var cont = document.createElement('form');
    cont.className = 'ag-det-editar';
    cont.id = 'agDetEditar';
    cont.dataset.id = c.id;
    cont.innerHTML = '<h4>Modificar cita</h4><div class="ag-ed-grid">' +
      '<label>Fecha<input type="date" name="fecha" required value="' + c.fecha + '"></label>' +
      '<label>Hora<input type="time" name="hora" required step="300" min="07:00" max="19:00" value="' + hhmm(c.hora) + '"></label>' +
      '<label>Tratamiento<input name="servicio" list="agTratamientos" required value="' + esc(c.servicio || '') + '"></label>' +
      '<label>' + (q ? 'Quiropráctico' : 'Odontólogo') + '<select name="medico">' + opMed + '</select></label>' +
      (q ? '' : '<label>Sala<select name="sala">' + opSala + '</select></label>') +
      '<label>WhatsApp<input name="telefono" inputmode="tel" value="' + esc(c.telefono || '') + '"></label>' +
      '<label>Duración<select name="duracion">' + opcionesDuracion(c.duracion, frecDe(c.dentista_id) || (esOrtodoncia(c.servicio) ? MINUTOS.ortodoncia : MINUTOS.general)) + '</select></label>' +
      '<label>Prioridad<select name="prioridad"><option value="normal">Normal</option><option value="urgente"' + (c.prioridad === 'urgente' ? ' selected' : '') + '>Urgente</option></select></label>' +
      '<label class="ag-ed-ancho">Notas<textarea name="notas" rows="2">' + esc(c.notas || '') + '</textarea></label>' +
      '</div><p class="ag-ed-msg" role="status"></p>' +
      '<div class="ag-ed-acc"><button type="submit" class="adm-btn adm-primary">Guardar cambios</button><button type="button" class="adm-btn" data-ed-cancelar>Cancelar</button></div>';
    var viejo = $('agDetEditar'); if (viejo) viejo.remove();
    var acc = $('agDetalle').querySelector('.ag-det-acc');
    $('agDetalle').insertBefore(cont, acc);
    cont.querySelector('[data-ed-cancelar]').addEventListener('click', function () { cont.remove(); });
    cont.addEventListener('submit', function (e) { e.preventDefault(); guardarEdicion(c, cont); });
    cont.elements.fecha.focus();
    cont.scrollIntoView({ block: 'nearest' });
  }
  async function guardarEdicion(c, f) {
    var msg = f.querySelector('.ag-ed-msg'), btn = f.querySelector('[type=submit]');
    var decir = function (t, err) { msg.textContent = t; msg.classList.toggle('error', !!err); };
    var fecha = f.elements.fecha.value, hora = f.elements.hora.value, servicio = f.elements.servicio.value.trim();
    if (!fecha || !hora || !servicio) { decir('Indica la fecha, la hora y el tratamiento.', true); return; }
    var med = f.elements.medico.value ? +f.elements.medico.value : null;
    var sala = f.elements.sala ? (f.elements.sala.value ? +f.elements.sala.value : null) : null;
    var durSel = +f.elements.duracion.value || null;
    var nueva = { fecha: fecha, hora: hora, servicio: servicio, dentista_id: med, posicion_id: sala, duracion: durSel };
    var bm = bloqueosMed(fecha, hora, duracion(nueva), med)[0];
    if (bm) { decir('Ese horario está bloqueado para ' + nombresBloqueo(bm) + ' de ' + hhmm(bm.desde) + ' a ' + hhmm(bm.hasta) + (bm.motivo ? ' (' + bm.motivo + ')' : '') + '.', true); return; }
    // Choques con otras citas del mismo médico o de la misma sala ese día
    btn.disabled = true; decir('Revisando el horario…');
    var r = await sb.from('citas').select('id,hora,servicio,dentista_id,posicion_id,tipo,quiropractico_id,duracion').eq('fecha', fecha).neq('estado', 'cancelada');
    if (r.error) r = await sb.from('citas').select('id,hora,servicio,dentista_id,posicion_id,tipo,quiropractico_id').eq('fecha', fecha).neq('estado', 'cancelada');
    if (!r.error) {
      var dur = duracion(nueva);
      var choque = delArea(r.data).filter(function (x) {
        return String(x.id) !== String(c.id) && choca(aMin(hora), dur, aMin(x.hora), duracion(x)) &&
          ((med && x.dentista_id === med) || (sala && x.posicion_id === sala));
      })[0];
      if (choque) { btn.disabled = false; decir('Ese horario choca con otra cita a las ' + hhmm(choque.hora) + (choque.dentista_id === med ? ' del mismo ' + (esQuiro() ? 'quiropráctico' : 'odontólogo') : ' en la misma sala') + '.', true); return; }
    }
    var cambios = {
      fecha: fecha, hora: hora, servicio: servicio,
      telefono: f.elements.telefono.value.trim(),
      prioridad: f.elements.prioridad.value === 'urgente' ? 'urgente' : 'normal',
      notas: f.elements.notas.value.trim() || null,
      duracion: durSel
    };
    if (esQuiro()) cambios.quiropractico_id = med; else { cambios.dentista_id = med; cambios.posicion_id = sala; }
    if (fecha !== c.fecha || hora !== hhmm(c.hora)) {
      cambios.reprogramada_de = c.fecha + ' ' + hhmm(c.hora);
      cambios.reprogramada_en = new Date().toISOString();
      cambios.reprogramada_por = usuarioSesion();
    }
    decir('Guardando…');
    var u = await sb.from('citas').update(cambios).eq('id', c.id).select('id');
    if (u.error && /duracion/.test(u.error.message || '')) { btn.disabled = false; decir('Falta ejecutar en Supabase el script actualizado (supabase.sql) para la duración de la cita.', true); return; }
    if (u.error && /reprogramada_(en|por)/.test(u.error.message || '')) { delete cambios.reprogramada_en; delete cambios.reprogramada_por; u = await sb.from('citas').update(cambios).eq('id', c.id).select('id'); }
    btn.disabled = false;
    if (u.error || !u.data || !u.data.length) {
      var m = u.error ? u.error.message || '' : '';
      decir(/duplicate key|unique/i.test(m) ? 'Ese horario ya está ocupado para ese médico o esa sala.' : u.error ? traducir(u.error) : 'No tienes permiso para esta acción.', true);
      return;
    }
    aviso('agMsg', 'Cita modificada: ' + textoFecha(fecha) + ' · ' + hora + ' · ' + servicio + '.');
    await cargarCitas();
    verDetalle(c.id);
  }

  // ---------- Bloquear horarios por médico ----------
  async function cargarBloqMed() {
    var r = await sb.from('bloqueos_medicos').select('id,area,fecha_desde,fecha_hasta,desde,hasta,medicos,motivo,creado_por').gte('fecha_hasta', sumar(hoy(), -120)).order('fecha_desde').order('desde');
    bloqMed = r.error ? [] : r.data;
    return r.error;
  }
  function horasBloqueo(sel) { var l = []; for (var m = 7 * 60; m <= 19 * 60; m += 15) l.push('<option value="' + aHora(m) + '"' + (aHora(m) === sel ? ' selected' : '') + '>' + aHora(m) + '</option>'); return l.join(''); }
  function pintarBloqMed() {
    var q = esQuiro(), lista = bloqMed.filter(function (b) { return b.area === window.PD_AREA && b.fecha_hasta >= hoy(); });
    $('bmTitulo').textContent = (bmModo === 'desbloquear' ? 'Desbloquear horarios · ' : 'Bloquear horarios · ') + (q ? 'Quiropráctica' : 'Odontología');
    $('bmTodosTxt').textContent = q ? 'Todos los quiroprácticos' : 'Todos los odontólogos';
    $('bmMedicos').innerHTML = dentistas.length ? dentistas.map(function (d) {
      return '<label class="bm-med"><input type="checkbox" value="' + d.id + '"> ' + esc(d.nombre) + '</label>';
    }).join('') : '<span class="dlg-msg">No hay ' + (q ? 'quiroprácticos' : 'odontólogos') + ' activos.</span>';
    $('bmLista').innerHTML = lista.length ? lista.map(function (b) {
      var dias = b.fecha_desde === b.fecha_hasta ? textoFecha(b.fecha_desde) : textoFecha(b.fecha_desde) + ' al ' + textoFecha(b.fecha_hasta);
      return '<li class="bloq-item"><span><strong>' + dias + '</strong> · ' + hhmm(b.desde) + ' a ' + hhmm(b.hasta) + ' · ' + esc(nombresBloqueo(b)) +
        (b.motivo ? ' <span style="color:#5A6D7A">— ' + esc(b.motivo) + '</span>' : '') + '</span>' +
        '<button type="button" class="adm-btn" data-bm-quitar="' + b.id + '">Quitar</button></li>';
    }).join('') : '<li class="bloq-item" style="color:#5A6D7A">No hay horarios bloqueados.</li>';
  }
  var bmModo = 'bloquear';
  function modoBloqueo(m) {
    bmModo = m;
    document.querySelectorAll('[data-bm-modo]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.bmModo === m); });
    $('bmGuardar').textContent = m === 'desbloquear' ? 'Desbloquear horario' : 'Bloquear horario';
    $('bmGuardar').classList.toggle('bm-desbloq', m === 'desbloquear');
    $('bmAyuda').textContent = m === 'desbloquear'
      ? 'Libera el horario indicado para los médicos elegidos (o para todos). Si un bloqueo es más amplio, se conserva el resto.'
      : 'En ese horario no se podrán agendar citas para los médicos elegidos. Las citas que ya existen no se anulan.';
    $('bmMotivoWrap').hidden = m === 'desbloquear';
    var q = esQuiro();
    $('bmTitulo').textContent = (m === 'desbloquear' ? 'Desbloquear horarios · ' : 'Bloquear horarios · ') + (q ? 'Quiropráctica' : 'Odontología');
    aviso('bmMsg', '');
  }
  document.querySelectorAll('[data-bm-modo]').forEach(function (b) { b.addEventListener('click', function () { modoBloqueo(b.dataset.bmModo); }); });
  function marcarMedicos(ids) {
    $('bmTodos').checked = !ids;
    $('bmMedicos').classList.toggle('bm-off', !ids);
    $('bmMedicos').querySelectorAll('input').forEach(function (x) { x.checked = !!ids && ids.indexOf(+x.value) >= 0; });
  }
  // Desbloquear desde el candado del calendario: se abre con el horario de ese bloqueo
  async function abrirDesbloqueo(id, f) {
    var b = bloqMed.filter(function (x) { return String(x.id) === String(id); })[0];
    await abrirBloqueo();
    modoBloqueo('desbloquear');
    if (!b) return;
    $('bmDesde').value = f || b.fecha_desde; $('bmHasta').value = f || b.fecha_hasta;
    $('bmHoraIni').innerHTML = horasBloqueo(hhmm(b.desde)); $('bmHoraFin').innerHTML = horasBloqueo(hhmm(b.hasta));
    marcarMedicos(b.medicos);
  }
  document.addEventListener('click', function (e) {
    var l = e.target.closest('[data-desbloq]');
    if (!l || !$('agBody').contains(l)) return;
    e.preventDefault(); e.stopPropagation();
    abrirDesbloqueo(l.dataset.desbloq, l.dataset.fecha);
  }, true);
  // Quita el horario [d1..d2] × [h1..h2) a los médicos indicados (null = todos). Cada bloqueo que se cruza
  // se reemplaza por las partes que siguen bloqueadas.
  async function desbloquear(d1, d2, h1, h2, meds) {
    var afect = bloqMed.filter(function (b) {
      return b.area === window.PD_AREA && b.fecha_desde <= d2 && b.fecha_hasta >= d1 && hhmm(b.desde) < h2 && hhmm(b.hasta) > h1 &&
        (!meds || !b.medicos || b.medicos.some(function (id) { return meds.indexOf(id) >= 0; }));
    });
    if (!afect.length) return { cambiados: 0 };
    var todosIds = dentistas.map(function (d) { return d.id; });
    for (var i = 0; i < afect.length; i++) {
      var b = afect[i], partes = [], base = { area: b.area, motivo: b.motivo, medicos: b.medicos };
      var fi = b.fecha_desde > d1 ? b.fecha_desde : d1, ff = b.fecha_hasta < d2 ? b.fecha_hasta : d2;
      if (b.fecha_desde < fi) partes.push(Object.assign({}, base, { fecha_desde: b.fecha_desde, fecha_hasta: sumar(fi, -1), desde: b.desde, hasta: b.hasta }));
      if (b.fecha_hasta > ff) partes.push(Object.assign({}, base, { fecha_desde: sumar(ff, 1), fecha_hasta: b.fecha_hasta, desde: b.desde, hasta: b.hasta }));
      var ti = hhmm(b.desde) > h1 ? hhmm(b.desde) : h1, tf = hhmm(b.hasta) < h2 ? hhmm(b.hasta) : h2;
      if (hhmm(b.desde) < ti) partes.push(Object.assign({}, base, { fecha_desde: fi, fecha_hasta: ff, desde: b.desde, hasta: ti }));
      if (hhmm(b.hasta) > tf) partes.push(Object.assign({}, base, { fecha_desde: fi, fecha_hasta: ff, desde: tf, hasta: b.hasta }));
      if (meds) {
        var quedan = (b.medicos || todosIds).filter(function (id) { return meds.indexOf(id) < 0; });
        if (quedan.length) partes.push(Object.assign({}, base, { fecha_desde: fi, fecha_hasta: ff, desde: ti, hasta: tf, medicos: quedan }));
      }
      var r = await sb.from('bloqueos_medicos').delete().eq('id', b.id);
      if (r.error) return { error: r.error };
      if (partes.length) { r = await sb.from('bloqueos_medicos').insert(partes); if (r.error) return { error: r.error }; }
    }
    return { cambiados: afect.length };
  }
  async function abrirBloqueo() {
    var f = $('agDia').value || hoy();
    modoBloqueo('bloquear');
    $('bmDesde').value = f; $('bmHasta').value = f;
    $('bmHoraIni').innerHTML = horasBloqueo('12:00'); $('bmHoraFin').innerHTML = horasBloqueo('13:00');
    $('bmMotivo').value = ''; $('bmTodos').checked = true;
    aviso('bmMsg', '');
    pintarBloqMed();
    $('bmMedicos').classList.add('bm-off');
    $('bmDlg').showModal();
    var err = await cargarBloqMed();
    if (err) aviso('bmMsg', /bloqueos_medicos/.test(err.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para bloquear horarios por médico.' : traducir(err), true);
    pintarBloqMed();
  }
  $('agBloquear').addEventListener('click', abrirBloqueo);
  $('bmCerrar').addEventListener('click', function () { $('bmDlg').close(); });
  $('bmTodos').addEventListener('change', function () {
    $('bmMedicos').classList.toggle('bm-off', this.checked);
    if (this.checked) $('bmMedicos').querySelectorAll('input').forEach(function (x) { x.checked = false; });
  });
  $('bmMedicos').addEventListener('change', function () {
    var alguno = !!$('bmMedicos').querySelector('input:checked');
    $('bmTodos').checked = !alguno; $('bmMedicos').classList.toggle('bm-off', !alguno);
  });
  $('bmForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var d1 = $('bmDesde').value, d2 = $('bmHasta').value || d1, h1 = $('bmHoraIni').value, h2 = $('bmHoraFin').value;
    var meds = [].map.call($('bmMedicos').querySelectorAll('input:checked'), function (x) { return +x.value; });
    if (!d1) { aviso('bmMsg', 'Indica la fecha.', true); return; }
    if (d2 < d1) { aviso('bmMsg', 'La fecha final no puede ser antes que la inicial.', true); return; }
    if (h2 <= h1) { aviso('bmMsg', 'La hora final debe ser después de la hora inicial.', true); return; }
    if (!$('bmTodos').checked && !meds.length) { aviso('bmMsg', 'Elige uno o más médicos, o marca «Todos».', true); return; }
    var btn = $('bmGuardar');
    if (bmModo === 'desbloquear') {
      btn.disabled = true; aviso('bmMsg', 'Desbloqueando…');
      await cargarBloqMed();
      var res = await desbloquear(d1, d2, h1, h2, $('bmTodos').checked ? null : meds);
      btn.disabled = false;
      await cargarBloqMed(); pintarBloqMed(); pintar(); modoBloqueo('desbloquear');
      if (res.error) { aviso('bmMsg', traducir(res.error), true); return; }
      var quien = $('bmTodos').checked ? (esQuiro() ? 'todos los quiroprácticos' : 'todos los odontólogos') : meds.map(nombreDentista).join(', ');
      aviso('bmMsg', res.cambiados ? 'Horario desbloqueado de ' + h1 + ' a ' + h2 + ' para ' + quien + '.' : 'No había bloqueos en ese horario para ' + quien + '.', !res.cambiados);
      return;
    }
    btn.disabled = true; aviso('bmMsg', 'Bloqueando…');
    var r = await sb.from('bloqueos_medicos').insert({ area: window.PD_AREA, fecha_desde: d1, fecha_hasta: d2, desde: h1, hasta: h2, medicos: $('bmTodos').checked ? null : meds, motivo: $('bmMotivo').value.trim() || null });
    btn.disabled = false;
    if (r.error) { aviso('bmMsg', /bloqueos_medicos/.test(r.error.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para bloquear horarios por médico.' : traducir(r.error), true); return; }
    var afectadas = citas.filter(function (c) {
      return c.fecha >= d1 && c.fecha <= d2 && choca(aMin(c.hora), duracion(c), aMin(h1), aMin(h2) - aMin(h1)) && ($('bmTodos').checked || meds.indexOf(c.dentista_id) >= 0);
    });
    await cargarBloqMed();
    pintarBloqMed(); pintar();
    $('bmMotivo').value = ''; $('bmTodos').checked = true; $('bmMedicos').classList.add('bm-off');
    aviso('bmMsg', 'Horario bloqueado de ' + h1 + ' a ' + h2 + '.' + (afectadas.length ? ' Ojo: ya hay ' + afectadas.length + (afectadas.length === 1 ? ' cita' : ' citas') + ' en ese horario; el bloqueo no las anula.' : ''), afectadas.length > 0);
  });
  $('bmLista').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-bm-quitar]'); if (!b) return;
    b.disabled = true;
    var r = await sb.from('bloqueos_medicos').delete().eq('id', b.dataset.bmQuitar);
    if (r.error) { b.disabled = false; aviso('bmMsg', traducir(r.error), true); return; }
    aviso('bmMsg', 'Bloqueo quitado. Ese horario vuelve a estar disponible.');
    await cargarBloqMed(); pintarBloqMed(); pintar();
  });

  // ---------- Carga general ----------
  async function cargar() {
    var hoyF = hoy();
    if (!$('agDesde').value) $('agDesde').value = sumar(hoyF, 1);
    if (!$('agDia').value) $('agDia').value = hoyF;
    var rs = await Promise.all([
      sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono,correo,usuario,frecuencia').eq('estado', 'activo').order('nombre'),
      sb.from('posiciones').select('id,codigo,nombre,especialidad,estado,activa,horario').order('codigo'),
      sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado,correo,tipo_cliente,institucion_id,sucursal_id,tipo_paciente,quiropractico_id').order('nombre'),
      sb.from('tratamientos').select('nombre,activo').eq('activo', true).order('nombre'),
      sb.from('bloqueos').select('fecha,hora').gte('fecha', hoyF)
    ]);
    if (window.PD_COLOR) await window.PD_COLOR.cargar(true);
    if (rs[0].error && /frecuencia/.test(rs[0].error.message)) rs[0] = await sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono,correo,usuario').eq('estado', 'activo').order('nombre');
    if (rs[0].error && /usuario/.test(rs[0].error.message)) rs[0] = await sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono,correo').eq('estado', 'activo').order('nombre');
    if (rs[0].error && /correo/.test(rs[0].error.message)) rs[0] = await sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono').eq('estado', 'activo').order('nombre');
    if (rs[2].error && /tipo_paciente|quiropractico_id/.test(rs[2].error.message)) rs[2] = await sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado,correo,tipo_cliente,institucion_id,sucursal_id').order('nombre');
    if (rs[2].error && /tipo_cliente|institucion_id|sucursal_id/.test(rs[2].error.message)) rs[2] = await sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado,correo').order('nombre');
    try {
      var ri = await Promise.all([sb.from('jor_instituciones').select('id,numero,nombre,estado').order('nombre'), sb.from('jor_sucursales').select('id,numero,institucion_id,nombre,estado').order('nombre')]);
      instCat = ri[0].error ? [] : ri[0].data || []; sucCat = ri[1].error ? [] : ri[1].data || [];
      var rj = await Promise.all([sb.from('jor_pacientes').select('cita_id,jornada_id').not('cita_id', 'is', null), sb.from('jor_jornadas').select('id,institucion_id,sucursal_id')]);
      var jInst = {}, jSuc = {}; citaInst = {}; citaSuc = {};
      (rj[1].error ? [] : rj[1].data || []).forEach(function (j) { jInst[j.id] = j.institucion_id; jSuc[j.id] = j.sucursal_id; });
      (rj[0].error ? [] : rj[0].data || []).forEach(function (x) { if (jInst[x.jornada_id]) { citaInst[x.cita_id] = jInst[x.jornada_id]; citaSuc[x.cita_id] = jSuc[x.jornada_id] || null; } });
    } catch (e) { instCat = []; sucCat = []; }
    if (rs[2].error && /correo/.test(rs[2].error.message)) rs[2] = await sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado').order('nombre');
    dentistas = rs[0].error ? [] : rs[0].data;
    salas = rs[1].error ? [] : rs[1].data;
    if (esQuiro()) {
      dentistas = (window.PD_QUIROPRACTICOS ? await window.PD_QUIROPRACTICOS() : []).map(function (q) { return Object.assign({}, q, { especialidades: q.tecnicas || [], posicion_id: null, rol_sala: 'principal', usuario: null }); });
      salas = [];
    }
    pacInst = {}; pacSuc = {}; (rs[2].error ? [] : rs[2].data).forEach(function (p) { if (p.institucion_id) pacInst[p.id] = p.institucion_id; if (p.sucursal_id) pacSuc[p.id] = p.sucursal_id; });
    pacientes = rs[2].error ? [] : rs[2].data.filter(function (p) { return (!p.estado || p.estado === 'activo') && (p.tipo_paciente || 'odontologia') === window.PD_AREA; });
    if (esQuiro()) pacientes.forEach(function (p) { p.dentista_id = p.quiropractico_id || null; });
    opcionesFiltros();
    var catalogo = rs[3].error ? [] : rs[3].data.map(function (t) { return t.nombre; });
    bloqueos = rs[4].error ? [] : rs[4].data;
    await cargarBloqMed();

    var actual = $('agPaciente').value;
    $('agPaciente').innerHTML = '<option value="">Elige un paciente…</option><option value="nuevo">+ Paciente nuevo (se crea su expediente)</option>' +
      pacientes.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + (p.dpi ? ' · DPI ' + esc(p.dpi) : '') + '</option>'; }).join('');
    $('agPaciente').value = actual;
    var medicoActual = $('agMedico').value;
    $('agMedico').innerHTML = '<option value="">El más adecuado (recomendado)</option>' + dentistas.map(function (d) {
      return '<option value="' + d.id + '">' + esc(d.nombre) + ((d.especialidades || []).length ? ' · ' + esc(d.especialidades.join(', ')) : '') + '</option>';
    }).join('');
    $('agMedico').value = medicoActual;
    if ($('agEspecialidad').options.length <= 1) {
      $('agEspecialidad').innerHTML += ESPECIALIDADES.map(function (e) { return '<option value="' + e + '">' + e + '</option>'; }).join('');
    }
    $('agTratamientos').innerHTML = catalogo.concat(SERVICIOS).filter(function (x, i, a) { return a.indexOf(x) === i; })
      .map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join('');
    if (!$('agFechaM').value) $('agFechaM').value = sumar(hoyF, 1);
    $('agUsuarioGraba').textContent = usuarioSesion();
    opcionesHorario();
    alCambiarPaciente();
    if (!dentistas.length) aviso('agFormMsg', esQuiro() ? 'Aún no hay quiroprácticos activos con horario: regístralos en Catálogos › 5 · Quiroprácticos.' : 'Aún no hay odontólogos activos con horario: registra a los odontólogos para que el asistente pueda asignarlos.', true);
    else if ($('agFormMsg').textContent.indexOf('Aún no hay') === 0) aviso('agFormMsg', '');
    await cargarCitas();
  }

  // ---------- Reprogramar: se consulta la nueva fecha y hora ----------
  var repro = null;
  async function horasRepro() {
    var f = $('reproFecha').value, c = repro.cita;
    $('reproHora').disabled = true;
    $('reproHora').innerHTML = '<option value="">' + (f ? 'Buscando horas libres…' : 'Elige la fecha') + '</option>';
    if (!f) return;
    var r = await sb.from('citas').select('id,hora,servicio,dentista_id,posicion_id,tipo,quiropractico_id,duracion').eq('fecha', f).neq('estado', 'cancelada');
    if (r.error) r = await sb.from('citas').select('id,hora,servicio,dentista_id,posicion_id,tipo,quiropractico_id').eq('fecha', f).neq('estado', 'cancelada');
    if (r.error) r = await sb.from('citas').select('id,hora,servicio,dentista_id,posicion_id').eq('fecha', f).neq('estado', 'cancelada');
    if (!r.error) r.data = delArea(r.data);
    if ($('reproFecha').value !== f) return;
    var otras = (r.error ? [] : r.data).filter(function (x) { return String(x.id) !== String(c.id); });
    var sala = c.posicion_id ? salas.filter(function (x) { return x.id === c.posicion_id; })[0] : null;
    var dur = duracion(c), med = c.dentista_id ? dentistas.filter(function (d) { return d.id === c.dentista_id; })[0] : null;
    var lista = horariosMedico(f, med && med.frecuencia ? med : null).filter(function (h) {
      if (bloqueado(f, h, dur, c.dentista_id)) return false;
      if (f === c.fecha && h === hhmm(c.hora)) return false;
      if (sala && !salaAbierta(sala, f, h)) return false;
      return !otras.some(function (x) { return choca(aMin(h), dur, aMin(x.hora), duracion(x)) && ((c.dentista_id && x.dentista_id === c.dentista_id) || (c.posicion_id && x.posicion_id === c.posicion_id)); });
    });
    $('reproHora').innerHTML = lista.length ? lista.map(function (h) { return '<option value="' + h + '">' + h + '</option>'; }).join('')
      : '<option value="">' + (!turnos(f).length ? 'La clínica no atiende ese día' : 'Sin horarios libres ese día') + '</option>';
    $('reproHora').disabled = !lista.length;
  }
  async function reprogramar(c, alTerminar) {
    repro = { cita: c, alTerminar: alTerminar };
    $('reproTitulo').textContent = c.nombre || '';
    $('reproActual').textContent = 'Fecha actual: ' + textoFecha(c.fecha) + ' · ' + hhmm(c.hora) + (c.servicio ? ' · ' + c.servicio : '');
    aviso('reproMsg', '');
    $('reproGuardar').disabled = false;
    $('reproFecha').value = c.fecha >= hoy() ? c.fecha : hoy();
    $('reproDlg').showModal();
    if (!salas.length && !dentistas.length) {
      var rs = await Promise.all([sb.from('posiciones').select('id,codigo,nombre,especialidad,estado,activa,horario'), sb.from('bloqueos').select('fecha,hora').gte('fecha', hoy())]);
      salas = rs[0].error ? [] : rs[0].data;
      bloqueos = rs[1].error ? [] : rs[1].data;
    }
    horasRepro();
  }
  $('reproFecha').addEventListener('change', horasRepro);
  $('reproCerrar').addEventListener('click', function () { $('reproDlg').close(); });
  $('reproForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!repro || !$('reproFecha').value || !$('reproHora').value) { aviso('reproMsg', 'Elige la nueva fecha y hora.', true); return; }
    $('reproGuardar').disabled = true;
    aviso('reproMsg', 'Reprogramando…');
    var r = await sb.rpc('reprogramar_cita', { p_id: repro.cita.id, p_fecha: $('reproFecha').value, p_hora: $('reproHora').value });
    $('reproGuardar').disabled = false;
    if (r.error) {
      aviso('reproMsg', /reprogramar_cita/.test(r.error.message || '') && /does not exist|could not find/i.test(r.error.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para reprogramar citas.' : traducir(r.error), true);
      horasRepro();
      return;
    }
    $('reproDlg').close();
    if (repro.alTerminar) repro.alTerminar({ fecha: $('reproFecha').value, hora: $('reproHora').value });
  });
  // Abre «Administrar citas» con el paciente, el tratamiento y la fecha desde la que buscar (p. ej. desde Seguimientos)
  function preparar(o) {
    if ($('tabAgenda')) $('tabAgenda').click();
    var intentos = 0;
    (function esperar() {
      var op = $('agPaciente').querySelector('option[value="' + o.pacienteId + '"]');
      if (!op && intentos++ < 40) { setTimeout(esperar, 150); return; }
      if (typeof nuevaCita === 'function') nuevaCita();
      if (op) { $('agPaciente').value = String(o.pacienteId); alCambiarPaciente(); }
      $('agTratamiento').value = o.tratamiento || ''; alCambiarTratamiento();
      if (o.fecha) { $('agDesde').value = o.fecha; $('agFechaM').value = o.fecha; }
      aviso('agFormMsg', 'Seguimiento listo para agendar: pulsa «Buscar los mejores horarios» o elige «Ya tengo fecha y hora».');
      $('agForm').scrollIntoView({ block: 'start' });
    })();
  }
  // Área de atención (Administrar citas, Visualizar citas e Historial de citas): Odontología o Quiropráctica
  function pintarArea() { document.querySelectorAll('[data-area]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.area === window.PD_AREA); }); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-area]'); if (!b || b.dataset.area === window.PD_AREA) return;
    window.PD_AREA = b.dataset.area; pintarArea();
    $('agMedico').value = ''; $('agFMed').value = ''; fijo = null; serie = null; $('agSugerencias').innerHTML = '';
    document.dispatchEvent(new CustomEvent('pd-area'));
    cargar();
  });
  pintarArea();

  window.PD_AGENDA = { reprogramar: reprogramar, estados: ESTADOS_CITA, preparar: preparar };

  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.isConnected && b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // Paso 3: buscar los mejores horarios o guardar en una fecha y hora ya acordadas
  function modoHorario(m) {
    var fija = m === 'fija';
    document.querySelectorAll('#agForm [data-ag-modo]').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.agModo === m); });
    $('agModoBuscar').hidden = fija; $('agModoFija').hidden = !fija;
    $('agBuscarBtn').hidden = fija; $('agGuardarM').hidden = !fija;
    $('agFormMsg').hidden = fija; $('agMsgM').hidden = !fija;
    if (fija) { if (fijo) { fijo = null; $('agFijo').hidden = true; } opcionesHorario(); }
  }
  // Limpia el registro actual y deja el formulario listo para una cita nueva
  function nuevaCita() {
    var man = sumar(hoy(), 1);
    $('agPaciente').value = ''; $('agNombre').value = ''; $('agTelefono').value = ''; $('agCorreo').value = '';
    $('agTratamiento').value = ''; $('agEspecialidad').value = '';
    medicoElegidoAMano = false;
    $('agDesde').value = man; $('agFranja').value = '';
    $('agFechaM').value = man; $('agSalaM').value = '';
    $('agEstado').value = 'pendiente'; $('agPrioridad').value = 'normal'; $('agNotas').value = '';
    if (window.PD_SEDES) window.PD_SEDES.llenar($('agOrg'), $('agLoc'), null);
    ['agAvPac', 'agAvMed', 'agAvMail'].forEach(function (id) { $(id).checked = true; });
    fijo = null; serie = null; sugerencias = [];
    $('agSugerencias').innerHTML = '';
    aviso('agFormMsg', ''); aviso('agMsgM', '');
    alCambiarPaciente(); alCambiarTratamiento(); $('agEspDetectada').textContent = '';
    modoHorario('buscar'); pintarFijo();
    $('agUsuarioGraba').textContent = usuarioSesion();
    $('agForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('agPaciente').focus({ preventScroll: true });
  }
  $('agNuevaCita').addEventListener('click', nuevaCita);
  document.querySelectorAll('#agForm [data-ag-modo]').forEach(function (b) { b.addEventListener('click', function () { modoHorario(b.dataset.agModo); }); });

  // ---------- Eventos ----------
  $('agPaciente').addEventListener('change', alCambiarPaciente);
  document.querySelectorAll('#agForm [data-ag-tipo]').forEach(function (b) { b.addEventListener('click', function () { ponerTipo(b.dataset.agTipo); if (tipoCli === 'institucional' && !$('agInst').value) $('agInst').focus(); }); });
  $('agInst').addEventListener('change', function () { opcionesSuc(null); });
  $('agMedico').addEventListener('change', function () { medicoElegidoAMano = true; });
  $('agTratamiento').addEventListener('input', alCambiarTratamiento);
  $('agEspecialidad').addEventListener('change', alCambiarTratamiento);
  $('agForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!$('agPaciente').value) { aviso('agFormMsg', 'Elige el paciente.', true); return; }
    if (!$('agTratamiento').value.trim()) { aviso('agFormMsg', 'Indica el tratamiento.', true); return; }
    aviso('agFormMsg', '');
    pintarSugerencias(sugerir());
  });
  $('agSugerencias').addEventListener('click', function (e) {
    var sb2 = e.target.closest('[data-serie]');
    if (sb2) { serie = planificarSerie(sugerencias[+sb2.dataset.serie]); pintarSerie(); return; }
    if (e.target.closest('[data-serie-cancelar]')) { serie = null; pintarSugerencias({ opciones: sugerencias }); return; }
    var so = e.target.closest('[data-serie-ok]');
    if (so && serie) { agendarSerie(so); return; }
    var b = e.target.closest('[data-agendar]');
    if (b) agendar(sugerencias[+b.dataset.agendar], b);
  });
  $('agFechaM').addEventListener('change', opcionesHorario);
  $('agSalaM').addEventListener('change', opcionesHorario);
  $('agMedico').addEventListener('change', opcionesHorario);
  $('agGuardarM').addEventListener('click', function () { guardarDirecto(this); });
  $('agFijo').addEventListener('click', function (e) { if (e.target.closest('#agQuitarFijo')) { fijo = null; pintarFijo(); } });

  $('agDia').addEventListener('change', cargarCitas);
  function mover(n) { var f = $('agDia').value || hoy(); $('agDia').value = vista === 'mes' ? sumarMeses(f, n) : sumar(f, vista === 'semana' ? 7 * n : n); cargarCitas(); }
  $('agPrev').addEventListener('click', function () { mover(-1); });
  $('agNext').addEventListener('click', function () { mover(1); });
  $('agImprimir').addEventListener('click', imprimirAgenda);
  $('agFInst').addEventListener('change', function () { $('agFSuc').value = ''; opcionesSucFiltro(); pintar(); });
  ['agFSuc', 'agFMed'].forEach(function (id) { $(id).addEventListener('change', pintar); });
  document.querySelector('.ag-vista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-vista]');
    if (b && b.dataset.vista !== vista) { vista = b.dataset.vista; $('agDetalle').hidden = true; cargarCitas(); }
  });
  // En la semana: tocar un día o un «+ libres» abre ese día por salas
  $('agHead').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ir-dia]');
    if (b) { $('agDia').value = b.dataset.irDia; vista = 'dia'; pintar(); }
  });
  $('agHoy').addEventListener('click', function () { $('agDia').value = hoy(); cargarCitas(); });
  $('agBody').addEventListener('click', function (e) {
    var exp = e.target.closest('[data-ir-exp]');
    if (exp) { e.preventDefault(); e.stopPropagation(); irExpediente(exp.dataset.irExp); return; }
    var irDia = e.target.closest('[data-ir-dia]');
    if (irDia) { $('agDia').value = irDia.dataset.irDia; vista = 'dia'; pintar(); return; }
    var libre = e.target.closest('[data-libre]');
    if (libre) {
      fijo = { fecha: libre.dataset.fecha || $('agDia').value, hora: libre.dataset.libre, sala: libre.dataset.sala ? +libre.dataset.sala : null };
      if ($('admAgenda').hidden && $('tabAgenda')) $('tabAgenda').click();
      pintarFijo();
      $('agForm').scrollIntoView({ block: 'start' });
      aviso('agFormMsg', 'Completa el paciente y el tratamiento y pulsa «Sugerir horarios» para elegir el odontólogo de ese horario.');
      return;
    }
    var c = e.target.closest('[data-cita]');
    if (c) verDetalle(c.dataset.cita);
  });
  $('agDetalle').addEventListener('click', async function (e) {
    if (e.target.closest('[data-det-cerrar]')) { $('agDetalle').hidden = true; return; }
    var ex2 = e.target.closest('[data-ir-exp]');
    if (ex2) { irExpediente(ex2.dataset.irExp); return; }
    var ed = e.target.closest('[data-det-editar]');
    if (ed) { editarCita(ed.dataset.detEditar); return; }
    var rp = e.target.closest('[data-det-repro]');
    if (rp) {
      var cr = citas.filter(function (x) { return String(x.id) === rp.dataset.detRepro; })[0];
      if (cr) reprogramar(cr, function () { aviso('agMsg', 'Cita reprogramada.'); $('agDetalle').hidden = true; cargarCitas(); });
      return;
    }
    var b = e.target.closest('[data-det-estado]');
    if (!b) return;
    if (b.dataset.detEstado === 'cancelada' && !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('citas').update({ estado: b.dataset.detEstado }).eq('id', b.dataset.id).select('id');
    if (r.error || !r.data || !r.data.length) { b.disabled = false; aviso('agMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return; }
    aviso('agMsg', b.dataset.detEstado === 'cancelada' ? 'Cita anulada: queda en la agenda como «Anulado» y el horario quedó libre.' : 'Estado de la cita: ' + ESTADOS_CITA[b.dataset.detEstado] + '.');
    $('agDetalle').hidden = true;
    cargarCitas();
  });

  $('tabAgenda').addEventListener('click', cargar);
  if ($('tabVerCitas')) $('tabVerCitas').addEventListener('click', cargar);

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {
      if (window.PD_SEDES && $('agLoc').options.length <= 1) window.PD_SEDES.llenar($('agOrg'), $('agLoc'), null);
      if (!$('admAgenda').hidden || ($('admVerCitas') && !$('admVerCitas').hidden)) cargar();
    },
    limpiar: function () {
      dentistas = []; salas = []; pacientes = []; citas = []; canceladas = []; bloqueos = []; sugerencias = []; fijo = null;
      ['agSugerencias', 'agBody', 'agHead'].forEach(function (id) { $(id).innerHTML = ''; });
      $('agDetalle').hidden = true;
    }
  });
})();
