// Plus Dental — Agenda de clínicas con asistente inteligente (reglas, sin servicios externos)
// Propone horarios combinando: especialidad que requiere el tratamiento, médico asignado del paciente,
// horario y citas de cada dentista, horario y estado de cada sala, bloqueos, prioridad y carga de trabajo.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var TURNOS = { semana: ['08:00', '09:30', '11:00', '14:00', '15:30', '17:00'], sabado: ['08:00', '09:30', '11:00'] };
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

  var dentistas = [], salas = [], pacientes = [], citas = [], bloqueos = [], fijo = null, sugerencias = [], diaCitas = [], vista = 'dia';

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
  var ESTADOS_CITA = { pendiente: 'Programado', confirmada: 'Confirmado', reprogramada: 'Reprogramado', atendida: 'Atendido', cancelada: 'Cancelado' };
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
  function bloqueado(f, h) { return bloqueos.some(function (b) { return b.fecha === f && (!b.hora || hhmm(b.hora) === h); }); }
  function citasEn(f, h) { return citas.filter(function (c) { return c.fecha === f && hhmm(c.hora) === h; }); }
  function dentistaOcupado(id, f, h) { return citasEn(f, h).some(function (c) { return c.dentista_id === id; }); }
  function salaOcupada(id, f, h) { return citasEn(f, h).some(function (c) { return c.posicion_id === id; }); }
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

    fechas.forEach(function (f, iDia) {
      var lista = fijo ? [fijo.hora] : turnos(f);
      lista.forEach(function (h, iTurno) {
        if (f < ahoraF || (f === ahoraF && h <= ahoraH)) return;
        if (bloqueado(f, h)) return;
        if (franja === 'manana' && h >= '12:00') return;
        if (franja === 'tarde' && h < '12:00') return;

        var candidatos = conHorario ? dentistas.filter(function (d) {
          return (!medico || d.id === medico) && atiende(d, f, h) && !dentistaOcupado(d.id, f, h);
        }) : [null];

        candidatos.forEach(function (d) {
          // Sala: la fija, la del dentista o la mejor libre
          var opcionesSala = salas.filter(function (s) { return salaAbierta(s, f, h) && !salaOcupada(s.id, f, h); });
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
      $('agSugerencias').innerHTML = '<p class="dlg-msg">No encontré horarios con esas condiciones en los próximos ' + DIAS_BUSQUEDA + ' días. Prueba con otro médico, otra preferencia de horario u otra fecha de inicio. Revisa también que los dentistas tengan su horario cargado, o guarda la cita abajo en un horario específico.</p>';
      return;
    }
    var max = sugerencias[0].puntos, min = sugerencias[sugerencias.length - 1].puntos;
    $('agSugerencias').innerHTML = sugerencias.map(function (o, i) {
      var pct = max === min ? 100 : Math.round(55 + 45 * (o.puntos - min) / (max - min));
      return '<div class="ag-sug' + (i === 0 ? ' mejor' : '') + '">' +
        (i === 0 ? '<span class="estado rol-principal" style="align-self:flex-start">Mejor opción</span>' : '') +
        '<span class="cuando">' + textoFecha(o.fecha) + ' · ' + o.hora + '</span>' +
        '<span class="quien">' + esc(o.dentista ? o.dentista.nombre : 'Dentista por asignar') + '<br>' + esc(o.sala ? o.sala.codigo + ' · ' + o.sala.nombre : 'Sin sala asignada') + '</span>' +
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
      '<table><thead><tr><th>#</th><th>Fecha y hora</th><th>Dentista</th><th>Sala</th></tr></thead><tbody>' +
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
    boton.disabled = true;
    var hechas = [], fallo = null, lista = serie.filter(function (o) { return !o.falta; });
    for (var i = 0; i < lista.length; i++) {
      var o = lista[i];
      aviso('agFormMsg', 'Agendando cita ' + (i + 1) + ' de ' + lista.length + '…');
      var r = await sb.rpc('agendar_cita', {
        p_fecha: o.fecha, p_hora: o.hora, p_paciente_id: p ? p.id : null,
        p_nombre: nuevo ? $('agNombre').value.trim() : null, p_telefono: nuevo ? $('agTelefono').value.trim() : null,
        p_servicio: $('agTratamiento').value.trim(), p_dentista_id: o.dentista ? o.dentista.id : null, p_posicion_id: o.sala ? o.sala.id : null,
        p_prioridad: $('agPrioridad').value, p_notas: [$('agNotas').value.trim(), lista.length > 1 ? '(cita ' + (i + 1) + ' de ' + lista.length + ')' : ''].filter(Boolean).join(' '),
        p_estado: $('agEstado').value
      });
      if (r.error) { fallo = textoFecha(o.fecha) + ' · ' + o.hora + ': ' + traducir(r.error); break; }
      hechas.push(o);
    }
    boton.disabled = false;
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
    $('agEspDetectada').textContent = $('agEspecialidad').value ? '' : esp ? 'Especialidad detectada: ' + esp + '.' : 'No se detectó una especialidad: se buscará entre todos los dentistas.';
  }
  function pintarFijo() {
    if (fijo) modoHorario('buscar');
    $('agFijo').hidden = !fijo;
    if (fijo) $('agFijo').innerHTML = '<div class="ag-fijo">Horario elegido en la agenda: <b>' + textoFecha(fijo.fecha) + ' · ' + fijo.hora + (fijo.sala ? ' · ' + esc(nombreSala(fijo.sala)) : '') + '</b><button type="button" class="adm-btn" id="agQuitarFijo" style="min-height:34px;padding:5px 12px">Quitar</button></div>';
  }

  // ---------- Avisos: WhatsApp al paciente y al médico, recordatorio por correo ----------
  var CLINICA = 'Reforma Montúfar, zona 10, Ciudad de Guatemala', TEL_CLINICA = '+502 3756-5739';
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
        '• Fecha y hora: ' + a.cuando + '\n• Tratamiento: ' + c.servicio + (a.dentista ? '\n• Dentista: ' + a.dentista.nombre : '') + (a.sala ? '\n• Sala: ' + a.sala : '') +
        '\n\nDirección: ' + CLINICA + '.\nSi necesita cambiar su cita, escríbanos o llame al ' + TEL_CLINICA + '.\n\nPlus Dental · La tranquilidad también es parte del tratamiento.';
      b.push(correo ? '<a class="adm-btn" href="mailto:' + encodeURIComponent(correo) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo) + '">Recordatorio por correo</a>'
        : '<span class="dlg-msg">El paciente no tiene correo registrado.</span>');
    }
    return b.length ? '<div class="ag-aviso-btns">' + b.join('') + '</div>' : '';
  }

  // Horas libres para guardar en un horario específico: sin horas pasadas, bloqueadas ni ocupadas
  // (ocupada = el médico elegido ya tiene cita, la sala elegida ya está usada, o no queda ninguna sala libre)
  function horaLibre(f, h, medicoId, salaId) {
    var ahora = new Date(), hAhora = ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);
    if (f < hoy() || (f === hoy() && h <= hAhora)) return false;
    if (bloqueado(f, h)) return false;
    if (medicoId && dentistaOcupado(medicoId, f, h)) return false;
    var activas = salas.filter(function (x) { return x.activa; });
    if (salaId) {
      var sala = salas.filter(function (x) { return x.id === salaId; })[0];
      return !!sala && salaAbierta(sala, f, h) && !salaOcupada(salaId, f, h);
    }
    if (activas.length) return activas.some(function (x) { return salaAbierta(x, f, h) && !salaOcupada(x.id, f, h); });
    return !citasEn(f, h).length;
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
    var lista = f ? turnos(f).filter(function (h) { return horaLibre(f, h, medicoId, salaId); }) : [];
    $('agHoraM').innerHTML = lista.length ? lista.map(function (h) { return '<option value="' + h + '">' + h + '</option>'; }).join('')
      : '<option value="">' + (!f ? 'Elige la fecha' : !turnos(f).length ? 'La clínica no atiende ese día' : 'Sin horarios libres ese día') + '</option>';
    $('agHoraM').disabled = !lista.length;
    if (lista.indexOf(actual) >= 0) $('agHoraM').value = actual;
  }

  // Guardar en el horario elegido: si hay médico elegido se usa; si no, el asistente elige el más adecuado para ese horario
  async function guardarDirecto(boton) {
    var f = $('agFechaM').value, h = $('agHoraM').value;
    if (!$('agPaciente').value) { aviso('agMsgM', 'Elige el paciente arriba.', true); return; }
    if (!$('agTratamiento').value.trim()) { aviso('agMsgM', 'Indica el tratamiento arriba.', true); return; }
    if (!f || !h) { aviso('agMsgM', 'Elige la fecha y la hora.', true); return; }
    if (bloqueado(f, h)) { aviso('agMsgM', 'Ese horario está bloqueado.', true); return; }
    if (!horaLibre(f, h, $('agMedico').value ? +$('agMedico').value : null, $('agSalaM').value ? +$('agSalaM').value : null)) { aviso('agMsgM', 'Ese horario ya pasó o está ocupado. Elige otra hora.', true); opcionesHorario(); return; }
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
    boton.disabled = true;
    aviso('agFormMsg', 'Agendando…');
    var r = await sb.rpc('agendar_cita', {
      p_fecha: o.fecha, p_hora: o.hora,
      p_paciente_id: p ? p.id : null,
      p_nombre: nuevo ? $('agNombre').value.trim() : null,
      p_telefono: nuevo ? $('agTelefono').value.trim() : null,
      p_servicio: $('agTratamiento').value.trim(),
      p_dentista_id: o.dentista ? o.dentista.id : null,
      p_posicion_id: o.sala ? o.sala.id : null,
      p_prioridad: $('agPrioridad').value,
      p_notas: $('agNotas').value.trim(),
      p_estado: $('agEstado').value
    });
    boton.disabled = false;
    if (r.error) { aviso('agFormMsg', traducir(r.error), true); await cargarCitas(); return; }
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
    if (vista === 'semana') { var l = lunesDe(f); return { desde: l, hasta: sumar(l, 5) }; }
    return { desde: f, hasta: f };
  }
  async function cargarCitas() {
    var rv = rangoVista(), inicio = rv.desde, fin = rv.hasta;
    var desde = hoy() < inicio ? hoy() : inicio;
    var hasta = sumar(hoy(), DIAS_BUSQUEDA + 31);
    if (fin > hasta) hasta = fin;
    if (inicio < desde) desde = inicio;
    var r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada,creada_por,reprogramada_de')
      .gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
    if (r.error && /creada_por|reprogramada_de/.test(r.error.message)) {
      r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas,creada')
        .gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
      if (!r.error) aviso('agMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los estados de la cita.', true);
    }
    if (r.error && /paciente_id|prioridad|notas/.test(r.error.message)) {
      r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id').gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
      aviso('agMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para agendar desde aquí.', true);
    }
    citas = r.error ? [] : r.data;
    $('agFechaM').min = hoy();
    if ($('agHoraM')) opcionesHorario();
    pintar();
  }

  function pintar() {
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
  }
  var COLOR_ESTADO = { pendiente: '#B45309', confirmada: '#4D8B1E', reprogramada: '#6D5BD0', atendida: '#2F78C4' };
  function pintarLeyenda() {
    var rv = rangoVista(), d = rv.mesDesde || rv.desde, h = rv.mesHasta || rv.hasta;
    var enRango = citas.filter(function (c) { return c.fecha >= d && c.fecha <= h; });
    var urg = enRango.filter(function (c) { return c.prioridad === 'urgente'; }).length;
    $('agLeyenda').innerHTML = Object.keys(COLOR_ESTADO).map(function (e) {
      var n = enRango.filter(function (c) { return c.estado === e; }).length;
      return '<span><i style="background:' + COLOR_ESTADO[e] + '"></i>' + ESTADOS_CITA[e] + ' · <b>' + n + '</b></span>';
    }).join('') + '<span class="ag-ley-urg">Urgente = borde rojo' + (urg ? ' · <b>' + urg + '</b>' : '') + '</span>';
  }

  // Vista de semana: lunes a sábado, todas las salas en cada casilla
  function pintarSemana() {
    var inicio = lunesDe($('agDia').value), dias = [];
    for (var i = 0; i < 6; i++) dias.push(sumar(inicio, i));
    var activas = salas.filter(function (s) { return s.activa; });
    var ahora = new Date(), hAhora = ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);
    $('agHead').innerHTML = '<tr><th>Hora</th>' + dias.map(function (f) {
      var n = citas.filter(function (c) { return c.fecha === f; }).length;
      return '<th><button type="button" class="ag-dia-btn' + (f === hoy() ? ' hoy' : '') + '" data-ir-dia="' + f + '">' + textoFecha(f) + '<small>' + (n ? n + (n === 1 ? ' cita' : ' citas') : 'Sin citas') + '</small></button></th>';
    }).join('') + '</tr>';
    $('agBody').innerHTML = TURNOS.semana.map(function (h) {
      return '<tr><td class="hora">' + h + '</td>' + dias.map(function (f) {
        if (turnos(f).indexOf(h) < 0) return '<td><span class="ag-mini cerrado">—</span></td>';
        var cs = citasEn(f, h);
        var html = cs.map(function (x) {
          var sala = salas.filter(function (s) { return s.id === x.posicion_id; })[0];
          return '<button type="button" class="ag-mini cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '" title="' + esc(x.nombre + ' · ' + x.servicio + ' · ' + nombreDentista(x.dentista_id)) + '">' +
            (sala ? '<b>' + esc(sala.codigo) + '</b> · ' : '') + nombrePaciente(x) + '<small class="ag-trat">' + esc(x.servicio || '') + '</small></button>';
        }).join('');
        var pasado = f < hoy() || (f === hoy() && h <= hAhora);
        if (bloqueado(f, h)) return '<td>' + html + '<span class="ag-mini cerrado">Bloqueado</span></td>';
        if (!pasado) {
          var libres = activas.length
            ? activas.filter(function (s) { return salaAbierta(s, f, h) && !salaOcupada(s.id, f, h); }).length
            : (cs.length ? 0 : 1);
          if (libres) html += '<button type="button" class="ag-mini libre" data-ir-dia="' + f + '">+ ' + libres + (libres === 1 ? ' libre' : ' libres') + '</button>';
        }
        return '<td>' + (html || '<span class="ag-mini cerrado">—</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    document.querySelector('.ag-grid').classList.add('semana');
  }

  // Vista de mes: calendario de lunes a domingo con las citas de cada día
  function pintarMes() {
    document.querySelector('.ag-grid').classList.remove('semana');
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
          return '<button type="button" class="ag-mini cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '" title="' + esc(hhmm(x.hora) + ' · ' + x.nombre + ' · ' + x.servicio) + '"><b>' + hhmm(x.hora) + '</b> ' + nombrePaciente(x) + '<small class="ag-trat">' + esc(x.servicio || '') + '</small></button>';
        }).join('') + (cs.length > 3 ? '<button type="button" class="mas ag-mini" data-ir-dia="' + d + '" style="border:0;background:none;padding:0">+ ' + (cs.length - 3) + ' más</button>' : '');
        return '<td class="' + (fuera ? 'fuera' : '') + (d === hoy() ? ' hoy' : '') + '"><button type="button" class="ag-mes-dia" data-ir-dia="' + d + '">' + fecha(d).getDate() +
          (cs.length ? '<small>' + cs.length + (cs.length === 1 ? ' cita' : ' citas') + '</small>' : '') + '</button>' + lista + '</td>';
      }).join('') + '</tr>';
    }).join('');
  }

  // Imprimir la agenda que se ve (día, semana o mes): lista ordenada por fecha y hora
  function imprimirAgenda() {
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
      '<div style="text-align:right"><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Citas</span><b style="font-size:15px">' + lista.length + '</b></div></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr><th style="' + th + '">Hora</th><th style="' + th + '">Paciente</th><th style="' + th + '">Tratamiento</th><th style="' + th + '">Dentista</th><th style="' + th + '">Sala</th><th style="' + th + '">Estado</th></tr></thead><tbody>' +
      (cuerpo || '<tr><td colspan="6" style="' + celda + '">No hay citas en este periodo.</td></tr>') + '</tbody></table></div>');
  }

  // Nombre del paciente: si tiene expediente, al tocarlo se abre su expediente
  function nombrePaciente(x) {
    return x.paciente_id && window.PD_EXPEDIENTE ? '<span class="ag-pac" data-ir-exp="' + x.paciente_id + '" title="Abrir expediente de ' + esc(x.nombre) + '">' + esc(x.nombre) + '</span>' : esc(x.nombre);
  }
  function irExpediente(id) { if (window.PD_EXPEDIENTE) window.PD_EXPEDIENTE.abrir(+id); }

  function pintarDia() {
    document.querySelector('.ag-grid').classList.remove('semana');
    var f = $('agDia').value;
    var lista = turnos(f);
    var columnas = salas.filter(function (s) { return s.activa; });
    var sinSala = citas.some(function (c) { return c.fecha === f && !c.posicion_id; });
    var cols = columnas.map(function (s) { return { id: s.id, titulo: s.codigo + ' · ' + s.nombre, sala: s }; });
    if (sinSala || !cols.length) cols.push({ id: null, titulo: 'Sin sala asignada', sala: null });
    $('agHead').innerHTML = '<tr><th>Hora</th>' + cols.map(function (c) { return '<th>' + esc(c.titulo) + '</th>'; }).join('') + '</tr>';
    if (!lista.length) { $('agBody').innerHTML = '<tr><td colspan="' + (cols.length + 1) + '">La clínica no atiende este día.</td></tr>'; return; }
    var ahora = new Date(), esHoy = f === hoy(), hAhora = ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);
    $('agBody').innerHTML = lista.map(function (h) {
      return '<tr><td class="hora">' + h + '</td>' + cols.map(function (c) {
        var cs = citasEn(f, h).filter(function (x) { return (x.posicion_id || null) === c.id; });
        if (cs.length) return '<td>' + cs.map(function (x) {
          return '<button type="button" class="ag-celda cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '"><b>' + nombrePaciente(x) + '</b>' + (x.prioridad === 'urgente' ? '<span class="ag-urg">Urgente</span>' : '') +
            '<br>' + esc(x.servicio) + '<br><span style="color:#5A6D7A">' + esc(nombreDentista(x.dentista_id)) + (x.estado === 'pendiente' ? ' · sin confirmar' : x.estado === 'reprogramada' ? ' · reprogramada' : x.estado === 'atendida' ? ' · atendida' : '') + '</span></button>';
        }).join('') + '</td>';
        var pasado = f < hoy() || (esHoy && h <= hAhora);
        if (bloqueado(f, h)) return '<td><span class="ag-celda cerrado">Bloqueado</span></td>';
        if (c.sala && !salaAbierta(c.sala, f, h)) return '<td><span class="ag-celda cerrado">' + (c.sala.estado === 'mantenimiento' ? 'Fuera de servicio' : 'Cerrada') + '</span></td>';
        if (pasado) return '<td><span class="ag-celda cerrado">—</span></td>';
        return '<td><button type="button" class="ag-celda libre" data-libre="' + h + '" data-sala="' + (c.id || '') + '">+ Libre</button></td>';
      }).join('') + '</tr>';
    }).join('');
  }

  function verDetalle(id) {
    var c = citas.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var pac = pacientes.filter(function (p) { return p.id === c.paciente_id; })[0];
    var conCorreo = Object.assign({}, c, { correo: pac && pac.correo });
    var activa = c.estado !== 'atendida';
    var campo = function (t, v) { return '<div><dt>' + t + '</dt><dd>' + v + '</dd></div>'; };
    $('agDetalle').hidden = false;
    $('agDetalle').classList.add('ag-det');
    $('agDetalle').innerHTML =
      '<div class="ag-det-head"><div><h3>' + esc(c.nombre) + (c.prioridad === 'urgente' ? ' <span class="ag-urg">Urgente</span>' : '') + '</h3>' +
      '<div class="ag-det-cuando">' + textoFecha(c.fecha) + ' · <b>' + hhmm(c.hora) + '</b>' + (c.servicio ? ' · ' + esc(c.servicio) : '') + '</div></div>' +
      '<div class="ag-det-der"><span class="estado estado-' + c.estado + '">' + (ESTADOS_CITA[c.estado] || c.estado) + '</span>' +
      '<button type="button" class="ag-det-x" data-det-cerrar aria-label="Cerrar">×</button></div></div>' +
      '<dl class="ag-det-grid">' +
      campo('Dentista', esc(nombreDentista(c.dentista_id))) +
      campo('Sala', esc(c.posicion_id ? nombreSala(c.posicion_id) : 'Sin sala')) +
      campo('WhatsApp', c.telefono ? esc(c.telefono) : '—') +
      campo('Fecha y hora de grabación', fechaHoraGrab(c.creada)) +
      campo('Usuario que graba', esc(c.creada_por || 'Sin usuario')) +
      campo('Reprogramada de', c.reprogramada_de ? esc(textoFecha(c.reprogramada_de.slice(0, 10)) + ' · ' + c.reprogramada_de.slice(11, 16)) : '—') +
      '</dl>' +
      (c.notas ? '<p class="ag-det-notas">' + esc(c.notas) + '</p>' : '') +
      '<div class="ag-det-acc">' +
      (c.estado === 'pendiente' || c.estado === 'reprogramada' ? '<button type="button" class="adm-btn adm-primary" data-det-estado="confirmada" data-id="' + c.id + '">Confirmar</button>' : '') +
      (activa ? '<button type="button" class="adm-btn' + (c.estado === 'confirmada' ? ' adm-primary' : '') + '" data-det-estado="atendida" data-id="' + c.id + '">Atendido</button>' : '') +
      (activa ? '<button type="button" class="adm-btn" data-det-repro="' + c.id + '">Reprogramar</button>' : '') +
      (c.paciente_id && window.PD_EXPEDIENTE ? '<button type="button" class="adm-btn" data-ir-exp="' + c.paciente_id + '">Ver expediente</button>' : '') +
      '<button type="button" class="adm-btn ag-det-cancel" data-det-estado="cancelada" data-id="' + c.id + '" data-confirmar="0">Cancelar cita</button>' +
      '</div>' +
      '<details class="ag-det-avisos"><summary>Avisos y recordatorios</summary><div>' + avisosHtml(conCorreo, { paciente: true, medico: true, correo: true }) + '</div></details>';
    $('agDetalle').scrollIntoView({ block: 'nearest' });
  }

  // ---------- Carga general ----------
  async function cargar() {
    var hoyF = hoy();
    if (!$('agDesde').value) $('agDesde').value = sumar(hoyF, 1);
    if (!$('agDia').value) $('agDia').value = hoyF;
    var rs = await Promise.all([
      sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono,correo').eq('estado', 'activo').order('nombre'),
      sb.from('posiciones').select('id,codigo,nombre,especialidad,estado,activa,horario').order('codigo'),
      sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado,correo').order('nombre'),
      sb.from('tratamientos').select('nombre,activo').eq('activo', true).order('nombre'),
      sb.from('bloqueos').select('fecha,hora').gte('fecha', hoyF)
    ]);
    if (rs[0].error && /correo/.test(rs[0].error.message)) rs[0] = await sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida,telefono').eq('estado', 'activo').order('nombre');
    if (rs[2].error && /correo/.test(rs[2].error.message)) rs[2] = await sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado').order('nombre');
    dentistas = rs[0].error ? [] : rs[0].data;
    salas = rs[1].error ? [] : rs[1].data;
    pacientes = rs[2].error ? [] : rs[2].data.filter(function (p) { return !p.estado || p.estado === 'activo'; });
    var catalogo = rs[3].error ? [] : rs[3].data.map(function (t) { return t.nombre; });
    bloqueos = rs[4].error ? [] : rs[4].data;

    var actual = $('agPaciente').value;
    $('agPaciente').innerHTML = '<option value="">Elige un paciente…</option><option value="nuevo">+ Paciente nuevo (sin expediente)</option>' +
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
    if (!dentistas.length) aviso('agFormMsg', 'Aún no hay dentistas activos con horario: registra a los dentistas para que el asistente pueda asignarlos.', true);
    await cargarCitas();
  }

  // ---------- Reprogramar: se consulta la nueva fecha y hora ----------
  var repro = null;
  async function horasRepro() {
    var f = $('reproFecha').value, c = repro.cita;
    $('reproHora').disabled = true;
    $('reproHora').innerHTML = '<option value="">' + (f ? 'Buscando horas libres…' : 'Elige la fecha') + '</option>';
    if (!f) return;
    var r = await sb.from('citas').select('id,hora,dentista_id,posicion_id').eq('fecha', f).neq('estado', 'cancelada');
    if ($('reproFecha').value !== f) return;
    var otras = (r.error ? [] : r.data).filter(function (x) { return String(x.id) !== String(c.id); });
    var ahora = new Date(), hAhora = ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);
    var sala = c.posicion_id ? salas.filter(function (x) { return x.id === c.posicion_id; })[0] : null;
    var lista = turnos(f).filter(function (h) {
      if (f < hoy() || (f === hoy() && h <= hAhora) || bloqueado(f, h)) return false;
      if (f === c.fecha && h === hhmm(c.hora)) return false;
      if (sala && !salaAbierta(sala, f, h)) return false;
      return !otras.some(function (x) { return hhmm(x.hora) === h && ((c.dentista_id && x.dentista_id === c.dentista_id) || (c.posicion_id && x.posicion_id === c.posicion_id)); });
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
    $('reproFecha').min = hoy();
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
  window.PD_AGENDA = { reprogramar: reprogramar, estados: ESTADOS_CITA };

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
      fijo = { fecha: $('agDia').value, hora: libre.dataset.libre, sala: libre.dataset.sala ? +libre.dataset.sala : null };
      if ($('admAgenda').hidden && $('tabAgenda')) $('tabAgenda').click();
      pintarFijo();
      $('agForm').scrollIntoView({ block: 'start' });
      aviso('agFormMsg', 'Completa el paciente y el tratamiento y pulsa «Sugerir horarios» para elegir el dentista de ese horario.');
      return;
    }
    var c = e.target.closest('[data-cita]');
    if (c) verDetalle(c.dataset.cita);
  });
  $('agDetalle').addEventListener('click', async function (e) {
    if (e.target.closest('[data-det-cerrar]')) { $('agDetalle').hidden = true; return; }
    var ex2 = e.target.closest('[data-ir-exp]');
    if (ex2) { irExpediente(ex2.dataset.irExp); return; }
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
    aviso('agMsg', b.dataset.detEstado === 'cancelada' ? 'Cita cancelada: el horario quedó libre.' : b.dataset.detEstado === 'atendida' ? 'Cita marcada como atendida.' : 'Cita confirmada.');
    $('agDetalle').hidden = true;
    cargarCitas();
  });

  $('tabAgenda').addEventListener('click', cargar);
  if ($('tabVerCitas')) $('tabVerCitas').addEventListener('click', cargar);

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admAgenda').hidden || ($('admVerCitas') && !$('admVerCitas').hidden)) cargar(); },
    limpiar: function () {
      dentistas = []; salas = []; pacientes = []; citas = []; bloqueos = []; sugerencias = []; fijo = null;
      ['agSugerencias', 'agBody', 'agHead'].forEach(function (id) { $(id).innerHTML = ''; });
      $('agDetalle').hidden = true;
    }
  });
})();
