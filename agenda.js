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
      $('agSugerencias').innerHTML = '<p class="dlg-msg">No encontré horarios con esas condiciones en los próximos ' + DIAS_BUSQUEDA + ' días. Prueba con otro médico, otra preferencia de horario u otra fecha de inicio. Revisa también que los dentistas tengan su horario cargado.</p>';
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
        '<button type="button" class="adm-btn adm-primary" data-agendar="' + i + '">Agendar aquí</button></div>';
    }).join('');
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
    $('agPacInfo').textContent = p ? [p.telefono ? 'WhatsApp ' + p.telefono : 'Sin teléfono en el expediente', p.dentista_id ? 'Médico asignado: ' + nombreDentista(p.dentista_id) : 'Sin médico asignado'].join(' · ') : '';
    if (p && p.dentista_id && !$('agMedico').value) {
      // No se fija el médico: el asistente ya le da preferencia al médico asignado
    }
  }
  function alCambiarTratamiento() {
    var esp = especialidadRequerida();
    $('agEspDetectada').textContent = $('agEspecialidad').value ? '' : esp ? 'Especialidad detectada: ' + esp + '.' : 'No se detectó una especialidad: se buscará entre todos los dentistas.';
  }
  function pintarFijo() {
    $('agFijo').hidden = !fijo;
    if (fijo) $('agFijo').innerHTML = '<div class="ag-fijo">Horario elegido en la agenda: <b>' + textoFecha(fijo.fecha) + ' · ' + fijo.hora + (fijo.sala ? ' · ' + esc(nombreSala(fijo.sala)) : '') + '</b><button type="button" class="adm-btn" id="agQuitarFijo" style="min-height:34px;padding:5px 12px">Quitar</button></div>';
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
      p_estado: $('agConfirmada').checked ? 'confirmada' : 'pendiente'
    });
    boton.disabled = false;
    if (r.error) { aviso('agFormMsg', traducir(r.error), true); await cargarCitas(); return; }
    var nombre = p ? p.nombre : $('agNombre').value.trim(), tel = p ? p.telefono : $('agTelefono').value.trim();
    var texto = 'Hola ' + nombre + ', le confirmamos su cita en Plus Dental el ' + textoFecha(o.fecha) + ' a las ' + o.hora +
      (o.dentista ? ' con ' + o.dentista.nombre : '') + (o.sala ? ' en ' + o.sala.nombre : '') + ' para ' + $('agTratamiento').value.trim() + '. ¡Le esperamos!';
    var wa = telWa(tel);
    $('agSugerencias').innerHTML = '<div class="ag-fijo" style="background:#DCF2EC;border-color:#BFE6D8;color:#08504C">Cita agendada: <b>' + textoFecha(o.fecha) + ' · ' + o.hora + ' · ' + esc(nombre) + '</b>' +
      (wa ? '<a class="adm-btn" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;min-height:34px">Avisar por WhatsApp</a>' : '') + '</div>';
    aviso('agFormMsg', '');
    fijo = null; pintarFijo();
    $('agNotas').value = '';
    $('agDia').value = o.fecha;
    await cargarCitas();
  }

  // ---------- Agenda del día ----------
  // Lunes de la semana de una fecha
  function lunesDe(f) { var d = fecha(f).getDay(); return sumar(f, d === 0 ? -6 : 1 - d); }

  async function cargarCitas() {
    var inicio = lunesDe($('agDia').value), fin = sumar(inicio, 6);
    var desde = hoy() < inicio ? hoy() : inicio;
    var hasta = sumar(hoy(), DIAS_BUSQUEDA + 31);
    if (fin > hasta) hasta = fin;
    var r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id,paciente_id,prioridad,notas')
      .gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
    if (r.error && /paciente_id|prioridad|notas/.test(r.error.message)) {
      r = await sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista_id,posicion_id').gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada');
      aviso('agMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para agendar desde aquí.', true);
    }
    citas = r.error ? [] : r.data;
    pintar();
  }

  function pintar() {
    document.querySelectorAll('.ag-vista [data-vista]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.vista === vista); });
    $('agTitulo').textContent = vista === 'semana' ? 'Agenda de la semana' : 'Agenda del día';
    $('agAyuda').innerHTML = vista === 'semana'
      ? 'Toca un día o un <b>+ libre</b> para abrirlo por salas y agendar, o una cita para ver su detalle.'
      : 'Toca un espacio <b>Libre</b> para agendar ahí, o una cita para ver su detalle.';
    $('agPrev').setAttribute('aria-label', vista === 'semana' ? 'Semana anterior' : 'Día anterior');
    $('agNext').setAttribute('aria-label', vista === 'semana' ? 'Semana siguiente' : 'Día siguiente');
    if (vista === 'semana') pintarSemana(); else pintarDia();
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
            (sala ? '<b>' + esc(sala.codigo) + '</b> · ' : '') + esc(x.nombre) + '</button>';
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
          return '<button type="button" class="ag-celda cita ' + x.estado + (x.prioridad === 'urgente' ? ' urgente' : '') + '" data-cita="' + x.id + '"><b>' + esc(x.nombre) + '</b>' + (x.prioridad === 'urgente' ? '<span class="ag-urg">Urgente</span>' : '') +
            '<br>' + esc(x.servicio) + '<br><span style="color:#5A6D7A">' + esc(nombreDentista(x.dentista_id)) + (x.estado === 'pendiente' ? ' · sin confirmar' : '') + '</span></button>';
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
    var wa = telWa(c.telefono);
    var texto = 'Hola ' + c.nombre + ', le recordamos su cita en Plus Dental el ' + textoFecha(c.fecha) + ' a las ' + hhmm(c.hora) + (c.dentista_id ? ' con ' + nombreDentista(c.dentista_id) : '') + '. ¡Le esperamos!';
    $('agDetalle').hidden = false;
    $('agDetalle').innerHTML = '<div class="adm-pane-head"><h3 style="margin:0;font-size:18px;font-weight:700">' + esc(c.nombre) + '</h3><span class="estado estado-' + c.estado + '">' + (c.estado === 'pendiente' ? 'Pendiente' : 'Confirmada') + '</span></div>' +
      '<div class="pac-meta"><span><b>' + textoFecha(c.fecha) + ' · ' + hhmm(c.hora) + '</b></span><span>' + esc(c.servicio) + '</span><span>' + esc(nombreDentista(c.dentista_id)) + '</span><span>' + esc(c.posicion_id ? nombreSala(c.posicion_id) : 'Sin sala') + '</span>' +
      (c.telefono ? '<span>WhatsApp ' + esc(c.telefono) + '</span>' : '') + (c.prioridad === 'urgente' ? '<span class="ag-urg">Urgente</span>' : '') + '</div>' +
      (c.notas ? '<p class="dlg-msg">' + esc(c.notas) + '</p>' : '') +
      '<div class="acciones">' + (c.estado === 'pendiente' ? '<button type="button" class="adm-btn adm-primary" data-det-estado="confirmada" data-id="' + c.id + '">Confirmar</button>' : '') +
      '<button type="button" class="adm-btn" data-det-estado="cancelada" data-id="' + c.id + '" data-confirmar="0">Cancelar cita</button>' +
      (wa ? '<a class="adm-btn" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Recordatorio por WhatsApp</a>' : '') +
      '<button type="button" class="adm-btn" data-det-cerrar>Cerrar</button></div>';
    $('agDetalle').scrollIntoView({ block: 'nearest' });
  }

  // ---------- Carga general ----------
  async function cargar() {
    var hoyF = hoy();
    if (!$('agDesde').value) $('agDesde').value = sumar(hoyF, 1);
    if (!$('agDia').value) $('agDia').value = hoyF;
    var rs = await Promise.all([
      sb.from('dentistas').select('id,nombre,especialidades,posicion_id,rol_sala,horario,estado,fecha_ingreso,fecha_salida').eq('estado', 'activo').order('nombre'),
      sb.from('posiciones').select('id,codigo,nombre,especialidad,estado,activa,horario').order('codigo'),
      sb.from('pacientes').select('id,nombre,dpi,telefono,dentista_id,estado').order('nombre'),
      sb.from('tratamientos').select('nombre,activo').eq('activo', true).order('nombre'),
      sb.from('bloqueos').select('fecha,hora').gte('fecha', hoyF)
    ]);
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
    alCambiarPaciente();
    if (!dentistas.length) aviso('agFormMsg', 'Aún no hay dentistas activos con horario: registra a los dentistas para que el asistente pueda asignarlos.', true);
    await cargarCitas();
  }

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

  // ---------- Eventos ----------
  $('agPaciente').addEventListener('change', alCambiarPaciente);
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
    var b = e.target.closest('[data-agendar]');
    if (b) agendar(sugerencias[+b.dataset.agendar], b);
  });
  $('agFijo').addEventListener('click', function (e) { if (e.target.closest('#agQuitarFijo')) { fijo = null; pintarFijo(); } });

  $('agDia').addEventListener('change', cargarCitas);
  $('agPrev').addEventListener('click', function () { $('agDia').value = sumar($('agDia').value || hoy(), vista === 'semana' ? -7 : -1); cargarCitas(); });
  $('agNext').addEventListener('click', function () { $('agDia').value = sumar($('agDia').value || hoy(), vista === 'semana' ? 7 : 1); cargarCitas(); });
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
    var irDia = e.target.closest('[data-ir-dia]');
    if (irDia) { $('agDia').value = irDia.dataset.irDia; vista = 'dia'; pintar(); return; }
    var libre = e.target.closest('[data-libre]');
    if (libre) {
      fijo = { fecha: $('agDia').value, hora: libre.dataset.libre, sala: libre.dataset.sala ? +libre.dataset.sala : null };
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
    var b = e.target.closest('[data-det-estado]');
    if (!b) return;
    if (b.dataset.detEstado === 'cancelada' && !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('citas').update({ estado: b.dataset.detEstado }).eq('id', b.dataset.id).select('id');
    if (r.error || !r.data || !r.data.length) { b.disabled = false; aviso('agMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return; }
    aviso('agMsg', b.dataset.detEstado === 'cancelada' ? 'Cita cancelada: el horario quedó libre.' : 'Cita confirmada.');
    $('agDetalle').hidden = true;
    cargarCitas();
  });

  $('tabAgenda').addEventListener('click', cargar);

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admAgenda').hidden) cargar(); },
    limpiar: function () {
      dentistas = []; salas = []; pacientes = []; citas = []; bloqueos = []; sugerencias = []; fijo = null;
      ['agSugerencias', 'agBody', 'agHead'].forEach(function (id) { $(id).innerHTML = ''; });
      $('agDetalle').hidden = true;
    }
  });
})();
