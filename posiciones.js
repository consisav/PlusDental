// Plus Dental — Posiciones (sub-clínicas / boxes), personal, mantenimiento y rotación
// Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var ESTADOS = { libre: 'Libre', ocupado: 'Ocupado', limpieza: 'En limpieza / desinfección', mantenimiento: 'Fuera de servicio' };
  var ROLES = { odontologo: 'Odontólogo', especialista: 'Especialista', higienista: 'Higienista', auxiliar: 'Auxiliar dental', otro: 'Otro' };
  var TIPOS_MANT = { revision_sillon: 'Revisión técnica del sillón', calibracion_rx: 'Calibración de rayos X', filtros: 'Cambio de filtros de agua / aire', otro: 'Otro' };
  var DIAS = [['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sábado'], ['7', 'Domingo']];
  var DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  // Horario base de la clínica para posiciones nuevas
  var HORARIO_BASE = { 1: { abre: '08:00', cierra: '18:00' }, 2: { abre: '08:00', cierra: '18:00' }, 3: { abre: '08:00', cierra: '18:00' }, 4: { abre: '08:00', cierra: '18:00' }, 5: { abre: '08:00', cierra: '18:00' }, 6: { abre: '08:00', cierra: '12:30' } };

  var posiciones = [], personal = [], actual = null, canal = null, citasHoy = {}, dentistasPorPos = {}, dentistasLista = [], editando = false;
  var ESTADOS_REG = { activo: 'Activo', inactivo: 'Inactivo', baja: 'Baja' };
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function dentistaPrincipal() { var d = dentistasLista.filter(function (x) { return x.rol_sala === 'principal'; })[0] || dentistasLista[0]; return d ? d.id : null; }

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function sumarDias(f, n) { var p = f.split('-'); return iso(new Date(+p[0], p[1] - 1, +p[2] + n)); }
  function hoy() { return iso(new Date()); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function diaSemana(f) { var p = f.split('-'); var d = new Date(+p[0], p[1] - 1, +p[2]).getDay(); return d === 0 ? '7' : String(d); }
  function hace(ts) {
    if (!ts) return '';
    var min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    return 'desde ' + new Date(ts).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' });
  }
  function nombresPersonal(ids) {
    return (ids || []).map(function (id) { var p = personal.filter(function (x) { return x.id === id; })[0]; return p ? p.nombre : null; }).filter(Boolean);
  }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/(posiciones|personal|mantenimientos|posicion_id).*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las posiciones.';
    if (/posiciones_codigo_unico|duplicate key/i.test(m)) return 'Ya existe una posición con ese ID de clínica.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  function ver(id) { ['posLista', 'posFicha', 'posPersonal'].forEach(function (v) { $(v).hidden = v !== id; }); }

  // ---------- Carga ----------
  async function cargarPersonal() {
    var r = await sb.from('personal').select('*').order('nombre');
    if (r.error) { aviso('posMsg', traducir(r.error), true); return false; }
    personal = r.data;
    return true;
  }

  async function cargar() {
    aviso('posMsg', '');
    var ok = await cargarPersonal();
    if (!ok) return;
    var r = await sb.from('posiciones').select('*').order('activa', { ascending: false }).order('codigo');
    if (r.error) { aviso('posMsg', traducir(r.error), true); return; }
    posiciones = r.data;
    // Citas de hoy por posición (para las tarjetas)
    // Dentistas activos asignados a cada sala (opción «Dentistas»)
    dentistasPorPos = {};
    var den = await sb.from('dentistas').select('nombre,posicion_id,rol_sala').eq('estado', 'activo').not('posicion_id', 'is', null);
    if (den.error && /rol_sala/.test(den.error.message)) den = await sb.from('dentistas').select('nombre,posicion_id').eq('estado', 'activo').not('posicion_id', 'is', null);
    if (!den.error) {
      // El principal primero
      den.data.sort(function (a, b) { return (a.rol_sala === 'alterno') - (b.rol_sala === 'alterno'); }).forEach(function (d) {
        (dentistasPorPos[d.posicion_id] = dentistasPorPos[d.posicion_id] || []).push(d.nombre + (d.rol_sala === 'alterno' ? ' (alterno)' : ' (principal)'));
      });
    }
    var dl = await sb.from('dentistas').select('id,nombre,rol_sala,especialidades,estado').order('nombre');
    if (dl.error && /rol_sala/.test(dl.error.message)) dl = await sb.from('dentistas').select('id,nombre,especialidades,estado').order('nombre');
    dentistasLista = dl.error ? [] : dl.data;
    citasHoy = {};
    var c = await sb.from('citas').select('posicion_id').eq('fecha', hoy()).neq('estado', 'cancelada').not('posicion_id', 'is', null);
    if (!c.error) c.data.forEach(function (x) { citasHoy[x.posicion_id] = (citasHoy[x.posicion_id] || 0) + 1; });
    pintarLista();
    escucharCambios();
  }

  function pintarLista() {
    var activas = posiciones.filter(function (p) { return p.activa; });
    var cuenta = { libre: 0, ocupado: 0, limpieza: 0, mantenimiento: 0 };
    activas.forEach(function (p) { cuenta[p.estado]++; });
    $('posResumen').innerHTML = Object.keys(ESTADOS).map(function (k) {
      return '<div class="kpi"><span>' + ESTADOS[k] + '</span><b>' + cuenta[k] + '</b></div>';
    }).join('');
    if (!posiciones.length) {
      $('posGrid').innerHTML = '<p class="dlg-msg">Todavía no hay posiciones registradas. Crea la primera con «Nueva posición».</p>';
      return;
    }
    $('posGrid').innerHTML = posiciones.map(function (p) {
      var dResp = dentistasLista.filter(function (d) { return d.id === p.dentista_id; })[0];
      var resp = (dResp ? [dResp.nombre + ' (responsable)'] : []).concat(dentistasPorPos[p.id] || []).concat(nombresPersonal(p.responsables)).filter(function (n, i, a) { return a.indexOf(n) === i; });
      var opciones = Object.keys(ESTADOS).map(function (k) { return '<option value="' + k + '"' + (k === p.estado ? ' selected' : '') + '>' + ESTADOS[k] + '</option>'; }).join('');
      return '<article class="pos-card' + (p.activa ? '' : ' inactiva') + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><span class="cod">' + esc(p.codigo) + (p.activa ? '' : ' · ' + (ESTADOS_REG[p.estado_registro] || 'Inactiva').toLowerCase()) + '</span>' +
        '<select class="pos-estado est-' + p.estado + '" data-estado-pos="' + p.id + '" aria-label="Estado de ' + esc(p.nombre) + '"' + (p.activa ? '' : ' disabled') + '>' + opciones + '</select></div>' +
        '<h4>' + esc(p.nombre) + '</h4>' +
        '<div class="det">' + (p.ubicacion ? esc(p.ubicacion) + '<br>' : '') + (p.especialidad ? '<strong>' + esc(p.especialidad) + '</strong><br>' : '') +
        (resp.length ? 'Atiende: ' + esc(resp.join(', ')) : '<span style="color:#94A6B2">Sin responsable asignado</span>') + '</div>' +
        '<div class="det" style="font-size:12px;color:#5A6D7A">' + ESTADOS[p.estado] + ' ' + hace(p.estado_desde) + (p.estado_por ? ' · ' + esc(p.estado_por) : '') + '</div>' +
        '<div class="pie"><span class="det">Hoy: <strong>' + (citasHoy[p.id] || 0) + '</strong> cita(s)</span>' +
        '<button type="button" class="adm-btn" data-abrir-pos="' + p.id + '">Abrir</button></div></article>';
    }).join('');
  }

  // Estado en tiempo real: si otra persona cambia una posición, la lista se actualiza sola
  function escucharCambios() {
    if (canal || !sb.channel) return;
    canal = sb.channel('posiciones-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posiciones' }, function () {
        if (!$('posLista').hidden && !$('admPosiciones').hidden) cargar();
      })
      .subscribe();
  }
  function dejarDeEscuchar() { if (canal) { sb.removeChannel(canal); canal = null; } }

  async function cambiarEstado(sel) {
    var id = +sel.dataset.estadoPos, estado = sel.value;
    sel.disabled = true;
    var r = await sb.from('posiciones').update({ estado: estado }).eq('id', id).select('*').single();
    sel.disabled = false;
    if (r.error) { aviso('posMsg', traducir(r.error), true); cargar(); return; }
    posiciones = posiciones.map(function (p) { return p.id === id ? r.data : p; });
    aviso('posMsg', r.data.nombre + ': ' + ESTADOS[estado] + '.');
    pintarLista();
  }

  // ---------- Ficha ----------
  function parte(id) {
    document.querySelectorAll('#posTabs [data-pparte]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.pparte === id);
      $(b.dataset.pparte).hidden = b.dataset.pparte !== id;
    });
    if (id === 'pAgenda') cargarAgenda();
    if (id === 'pMant') cargarMantenimientos();
    if (id === 'pRot') cargarRotacion();
  }

  function pintarCabecera() {
    $('posTitulo').textContent = actual ? actual.nombre : 'Nueva posición';
    $('posSub').textContent = actual
      ? [actual.codigo, actual.ubicacion, actual.especialidad].filter(Boolean).join(' · ')
      : 'Llena los datos y guarda. Después podrás ver su agenda, mantenimiento y rotación.';
    $('posEstadoPill').hidden = !actual;
    if (actual) { $('posEstadoPill').className = 'estado est-' + actual.estado; $('posEstadoPill').textContent = ESTADOS[actual.estado]; }
    document.querySelectorAll('#posTabs [data-pparte]').forEach(function (b) { if (b.dataset.pparte !== 'pDatos') b.disabled = !actual; });
  }

  function casillas(contenedor, roles, elegidos) {
    var lista = personal.filter(function (p) { return roles.indexOf(p.rol) >= 0 && (p.activo || (elegidos || []).indexOf(p.id) >= 0); });
    $(contenedor).innerHTML = lista.length ? lista.map(function (p) {
      return '<label><input type="checkbox" value="' + p.id + '"' + ((elegidos || []).indexOf(p.id) >= 0 ? ' checked' : '') + '>' + esc(p.nombre) +
        '<span style="color:#5A6D7A;font-size:12px">' + ROLES[p.rol] + (p.especialidad ? ' · ' + esc(p.especialidad) : '') + '</span></label>';
    }).join('') : '<span class="dlg-msg">No hay personal con este rol. Agrégalo en «Personal».</span>';
  }

  function pintarHorario(h) {
    $('poHorario').innerHTML = DIAS.map(function (d) {
      var x = h[d[0]];
      return '<div class="pos-dia" data-dia="' + d[0] + '"><label class="nom"><input type="checkbox" data-abierto' + (x ? ' checked' : '') + '>' + d[1].slice(0, 3) + '</label>' +
        '<input type="time" data-abre value="' + (x ? x.abre : '08:00') + '" aria-label="' + d[1] + ': abre"' + (x ? '' : ' disabled') + '>' +
        '<span aria-hidden="true">–</span><input type="time" data-cierra value="' + (x ? x.cierra : '18:00') + '" aria-label="' + d[1] + ': cierra"' + (x ? '' : ' disabled') + '></div>';
    }).join('');
  }

  function leerHorario() {
    var h = {};
    $('poHorario').querySelectorAll('[data-dia]').forEach(function (fila) {
      if (fila.querySelector('[data-abierto]').checked) h[fila.dataset.dia] = { abre: fila.querySelector('[data-abre]').value, cierra: fila.querySelector('[data-cierra]').value };
    });
    return h;
  }

  function rellenar(p) {
    $('poCodigo').value = p ? p.codigo : '';
    $('poNombre').value = p ? p.nombre : '';
    $('poUbicacion').value = (p && p.ubicacion) || '';
    $('poSillon').value = (p && p.tipo_sillon) || '';
    $('poEquipo').value = p ? (p.equipamiento || []).join('\n') : '';
    $('poEspecialidad').value = (p && p.especialidad) || '';
    $('poNotas').value = (p && p.notas) || '';
    $('poEstadoReg').value = (p && p.estado_registro) || (p && !p.activa ? 'inactivo' : 'activo');
    $('poEstadoReg').dataset.estado = $('poEstadoReg').value;
    var dSel = p ? p.dentista_id : dentistaPrincipal();
    $('poDentista').innerHTML = '<option value="">Sin asignar</option>' + dentistasLista.filter(function (d) { return d.estado === 'activo' || d.id === dSel; }).map(function (d) {
      return '<option value="' + d.id + '"' + (d.id === dSel ? ' selected' : '') + '>' + esc(d.nombre) + (d.rol_sala === 'principal' ? ' · principal' : '') + ((d.especialidades || []).length ? ' · ' + esc(d.especialidades.join(', ')) : '') + '</option>';
    }).join('');
    $('poUsuario').textContent = p ? (p.registrado_por || '—') : ((window.PD_SESION && window.PD_SESION.usuario()) || '—');
    $('poFechaReg').textContent = p ? fechaHora(p.creado) : 'Se registra al grabar';
    casillas('poSoporte', ['higienista', 'auxiliar', 'otro'], p ? p.soporte : []);
    pintarHorario(p ? (p.horario || {}) : HORARIO_BASE);
  }

  // Ver (bloqueado) o editar: nueva posición = editar; para modificar una existente, solo el Super Administrador
  function aplicarModo() {
    var puede = !actual || esSuper(), ed = editando && puede;
    $('pDatos').querySelectorAll('fieldset.pos-sec').forEach(function (f) { f.disabled = !ed; });
    ['poNotas', 'poEstadoReg'].forEach(function (id) { $(id).disabled = !ed; });
    $('poGrabar').hidden = !ed;
    $('poGrabar').textContent = actual ? 'Guardar cambios' : 'Grabar';
    $('poModificar').hidden = ed || !actual || !esSuper();
    $('poCancelar').hidden = !ed || !actual;
    $('poSoloSuper').hidden = !(actual && !esSuper());
  }
  async function abrir(id) {
    aviso('poMsg', '');
    editando = false;
    var p = posiciones.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    actual = p;
    rellenar(p);
    aplicarModo();
    pintarCabecera();
    ver('posFicha');
    parte('pDatos');
    $('posFicha').scrollIntoView({ block: 'start' });
  }

  function nueva() {
    actual = null;
    editando = true;
    aviso('poMsg', '');
    rellenar(null);
    aplicarModo();
    pintarCabecera();
    ver('posFicha');
    parte('pDatos');
    $('poNombre').focus();
  }

  async function guardar(form) {
    var marcados = function (id) { return Array.prototype.map.call($(id).querySelectorAll('input:checked'), function (c) { return +c.value; }); };
    var horario = leerHorario();
    var malo = Object.keys(horario).filter(function (d) { return !horario[d].abre || !horario[d].cierra || horario[d].abre >= horario[d].cierra; });
    if (malo.length) { aviso('poMsg', 'Revisa el horario: la hora de cierre debe ser después de la de apertura.', true); return; }
    if (actual && !esSuper()) { aviso('poMsg', 'Solo el Super Administrador puede modificar los datos de la posición.', true); return; }
    var datos = {
      nombre: $('poNombre').value.trim(),
      ubicacion: $('poUbicacion').value.trim() || null,
      tipo_sillon: $('poSillon').value.trim() || null,
      equipamiento: $('poEquipo').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
      especialidad: $('poEspecialidad').value.trim() || null,
      dentista_id: $('poDentista').value ? +$('poDentista').value : null,
      soporte: marcados('poSoporte'),
      horario: horario,
      notas: $('poNotas').value.trim() || null,
      estado_registro: $('poEstadoReg').value
    };
    if (!datos.nombre) { aviso('poMsg', 'El nombre de la posición es obligatorio.', true); $('poNombre').focus(); return; }
    var boton = form.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('poMsg', 'Guardando…');
    var r = actual
      ? await sb.from('posiciones').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('posiciones').insert(Object.assign({ codigo: 'nuevo' }, datos)).select('*').single();
    if (r.error && /estado_registro|dentista_id|registrado_por/.test(r.error.message || '')) { boton.disabled = false; aviso('poMsg', 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las posiciones.', true); return; }
    boton.disabled = false;
    if (r.error) { aviso('poMsg', traducir(r.error), true); return; }
    var eraNueva = !actual;
    actual = r.data;
    posiciones = eraNueva ? posiciones.concat([r.data]) : posiciones.map(function (p) { return p.id === r.data.id ? r.data : p; });
    editando = false;
    rellenar(actual);
    aplicarModo();
    pintarCabecera();
    aviso('poMsg', eraNueva ? 'Posición creada. Ya puedes ver su agenda, mantenimiento y rotación.' : 'Cambios guardados.');
  }

  // ---------- Agenda vinculada ----------
  async function cargarAgenda() {
    if (!actual) return;
    var desde = $('poAgDesde').value || hoy();
    $('poAgDesde').value = desde;
    var hasta = sumarDias(desde, 6);
    $('poAgenda').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await sb.from('citas').select('fecha,hora,servicio,nombre,estado').eq('posicion_id', actual.id)
      .gte('fecha', desde).lte('fecha', hasta).neq('estado', 'cancelada').order('fecha').order('hora');
    if (r.error) { $('poAgenda').innerHTML = ''; aviso('poMsg', traducir(r.error), true); return; }
    var dias = [];
    for (var i = 0; i < 7; i++) dias.push(sumarDias(desde, i));
    $('poAgenda').innerHTML = dias.map(function (f) {
      var abierta = (actual.horario || {})[diaSemana(f)];
      var citas = r.data.filter(function (c) { return c.fecha === f; });
      var p = f.split('-'), d = new Date(+p[0], p[1] - 1, +p[2]);
      return '<div class="dia"' + (abierta ? '' : ' style="background:#F5F9FC"') + '><h5>' + DIAS_CORTOS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) +
        ' <span style="font-weight:500;color:#5A6D7A">' + (abierta ? abierta.abre + '–' + abierta.cierra : 'Cerrada') + '</span></h5>' +
        (citas.length ? citas.map(function (c) {
          return '<div class="cita ' + c.estado + '"><strong>' + String(c.hora).slice(0, 5) + '</strong> · ' + esc(c.nombre) + '<br><span style="color:#5A6D7A">' + esc(c.servicio) + (c.estado === 'pendiente' ? ' · sin confirmar' : '') + '</span></div>';
        }).join('') : '<span class="dlg-msg">Sin citas</span>') + '</div>';
    }).join('');
  }

  // ---------- Mantenimiento ----------
  async function cargarMantenimientos() {
    if (!actual) return;
    $('manFecha').value = $('manFecha').value || hoy();
    $('manBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var r = await sb.from('mantenimientos').select('*').eq('posicion_id', actual.id).order('fecha', { ascending: false }).order('id', { ascending: false });
    if (r.error) { $('manBody').innerHTML = ''; aviso('manMsg', traducir(r.error), true); return; }
    $('manBody').innerHTML = r.data.length ? r.data.map(function (m) {
      var vencida = m.proxima && m.proxima < hoy();
      return '<tr><td class="fecha">' + fechaCorta(m.fecha) + '</td><td>' + TIPOS_MANT[m.tipo] + '</td><td>' + esc(m.descripcion || '—') + '</td>' +
        '<td>' + esc(m.responsable || '—') + '</td><td class="fecha"' + (vencida ? ' style="color:#9A3B2E;font-weight:700"' : '') + '>' + (m.proxima ? fechaCorta(m.proxima) + (vencida ? ' · vencida' : '') : '—') + '</td>' +
        '<td>' + esc(m.registrado_por || '—') + '</td>' +
        '<td>' + (esSuper() ? '<button type="button" class="adm-btn" data-borrar-man="' + m.id + '" data-confirmar="0" style="min-height:34px;padding:5px 10px">Borrar</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7">Sin mantenimientos registrados.</td></tr>';
  }

  // ---------- Rotación / uso ----------
  async function cargarRotacion() {
    if (!actual) return;
    var h = hoy(), desde30 = sumarDias(h, -29);
    $('rotKpis').innerHTML = '';
    $('rotChart').innerHTML = '<p class="dlg-msg">Cargando…</p>';
    var r = await sb.from('citas').select('fecha').eq('posicion_id', actual.id).eq('estado', 'confirmada').gte('fecha', desde30).lte('fecha', h);
    if (r.error) { $('rotChart').innerHTML = ''; aviso('poMsg', traducir(r.error), true); return; }
    var porDia = {};
    r.data.forEach(function (c) { porDia[c.fecha] = (porDia[c.fecha] || 0) + 1; });
    var horario = actual.horario || {}, total7 = 0, total30 = 0, diasOperativos = 0;
    for (var i = 0; i < 30; i++) {
      var f = sumarDias(h, -i), n = porDia[f] || 0;
      total30 += n;
      if (i < 7) total7 += n;
      if (horario[diaSemana(f)]) diasOperativos++;
    }
    var promedio = diasOperativos ? (total30 / diasOperativos) : 0;
    $('rotKpis').innerHTML =
      '<div class="kpi"><span>Atendidos hoy</span><b>' + (porDia[h] || 0) + '</b></div>' +
      '<div class="kpi"><span>Últimos 7 días</span><b>' + total7 + '</b></div>' +
      '<div class="kpi"><span>Últimos 30 días</span><b>' + total30 + '</b></div>' +
      '<div class="kpi"><span>Promedio por día operativo</span><b>' + promedio.toLocaleString('es-GT', { maximumFractionDigits: 1 }) + '</b></div>';
    var dias = [];
    for (var j = 13; j >= 0; j--) dias.push(sumarDias(h, -j));
    var max = Math.max.apply(null, dias.map(function (f) { return porDia[f] || 0; }).concat([1]));
    $('rotChart').innerHTML = dias.map(function (f) {
      var n = porDia[f] || 0, p = f.split('-'), d = new Date(+p[0], p[1] - 1, +p[2]);
      var cerrado = !horario[diaSemana(f)];
      return '<div class="col' + (cerrado ? ' cerrado' : '') + '" title="' + fechaCorta(f) + ': ' + n + ' paciente(s)' + (cerrado ? ' · cerrada' : '') + '">' +
        '<span class="n">' + n + '</span><div class="bar" style="height:' + Math.round((n / max) * 130) + 'px"></div>' +
        '<span class="d">' + DIAS_CORTOS[d.getDay()] + ' ' + d.getDate() + '</span></div>';
    }).join('');
  }

  // ---------- Personal ----------
  function pintarPersonal() {
    $('perBody').innerHTML = personal.length ? personal.map(function (p) {
      var roles = Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (k === p.rol ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join('');
      var campo = function (c, v, w) { return '<input class="adm-input" data-c="' + c + '" value="' + esc(v || '') + '" style="width:' + w + ';border-radius:10px" aria-label="' + c + '">'; };
      return '<tr data-per="' + p.id + '"><td>' + campo('nombre', p.nombre, '100%') + '</td>' +
        '<td><select class="adm-input" data-c="rol" style="border-radius:10px" aria-label="Rol">' + roles + '</select></td>' +
        '<td>' + campo('especialidad', p.especialidad, '150px') + '</td><td>' + campo('colegiado', p.colegiado, '110px') + '</td><td>' + campo('telefono', p.telefono, '130px') + '</td>' +
        '<td><input type="checkbox" data-c="activo"' + (p.activo ? ' checked' : '') + ' aria-label="Activo" style="width:20px;height:20px;accent-color:#005A87"></td>' +
        '<td><button type="button" class="adm-btn" data-guardar-per="' + p.id + '">Guardar</button></td></tr>';
    }).join('') : '<tr><td colspan="7">Todavía no hay personal registrado.</td></tr>';
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
  $('posNueva').addEventListener('click', nueva);
  $('posVerPersonal').addEventListener('click', async function () { ver('posPersonal'); aviso('perMsg', ''); if (await cargarPersonal()) pintarPersonal(); });
  $('perVolver').addEventListener('click', function () { ver('posLista'); cargar(); });
  $('posVolver').addEventListener('click', function () { actual = null; ver('posLista'); cargar(); });
  $('posGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir-pos]');
    if (b) abrir(+b.dataset.abrirPos);
  });
  $('posGrid').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-estado-pos]');
    if (sel) cambiarEstado(sel);
  });
  $('posTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pparte]');
    if (b && !b.disabled) parte(b.dataset.pparte);
  });
  $('pDatos').addEventListener('submit', function (e) { e.preventDefault(); guardar(this); });
  $('poHorario').addEventListener('change', function (e) {
    var c = e.target.closest('[data-abierto]');
    if (!c) return;
    var fila = c.closest('[data-dia]');
    fila.querySelector('[data-abre]').disabled = !c.checked;
    fila.querySelector('[data-cierra]').disabled = !c.checked;
  });
  $('poAgDesde').addEventListener('change', cargarAgenda);

  $('manForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    var r = await sb.from('mantenimientos').insert({
      posicion_id: actual.id,
      fecha: $('manFecha').value || hoy(),
      tipo: $('manTipo').value,
      descripcion: $('manDesc').value.trim() || null,
      responsable: $('manResp').value.trim() || null,
      proxima: $('manProxima').value || null
    });
    boton.disabled = false;
    if (r.error) { aviso('manMsg', traducir(r.error), true); return; }
    ['manDesc', 'manResp', 'manProxima'].forEach(function (id) { $(id).value = ''; });
    aviso('manMsg', 'Mantenimiento registrado.');
    cargarMantenimientos();
  });
  $('manBody').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-borrar-man]');
    if (!b || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('mantenimientos').delete().eq('id', b.dataset.borrarMan);
    if (r.error) { b.disabled = false; aviso('manMsg', traducir(r.error), true); return; }
    aviso('manMsg', 'Registro borrado.');
    cargarMantenimientos();
  });

  $('perForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    var r = await sb.from('personal').insert({
      nombre: $('perNombre').value.trim(), rol: $('perRol').value,
      especialidad: $('perEsp').value.trim() || null, colegiado: $('perCol').value.trim() || null, telefono: $('perTel').value.trim() || null
    });
    boton.disabled = false;
    if (r.error) { aviso('perMsg', traducir(r.error), true); return; }
    this.reset();
    aviso('perMsg', 'Persona agregada. Ya se puede asignar a las posiciones.');
    if (await cargarPersonal()) pintarPersonal();
    $('perNombre').focus();
  });
  $('perBody').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-guardar-per]');
    if (!b) return;
    var fila = b.closest('tr'), v = function (c) { return fila.querySelector('[data-c=' + c + ']').value.trim(); };
    var datos = { nombre: v('nombre'), rol: v('rol'), especialidad: v('especialidad') || null, colegiado: v('colegiado') || null, telefono: v('telefono') || null, activo: fila.querySelector('[data-c=activo]').checked };
    if (!datos.nombre) { aviso('perMsg', 'El nombre no puede quedar vacío.', true); return; }
    b.disabled = true;
    var r = await sb.from('personal').update(datos).eq('id', b.dataset.guardarPer).select('id');
    b.disabled = false;
    if (r.error || !r.data || !r.data.length) { aviso('perMsg', r.error ? traducir(r.error) : 'No tienes permiso para esta acción.', true); return; }
    aviso('perMsg', 'Cambios guardados: ' + datos.nombre + '.');
    cargarPersonal();
  });

  $('tabPosiciones').addEventListener('click', function () { if ($('posLista').hidden === false) cargar(); });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('posLista').hidden) cargar(); },
    limpiar: function () {
      dejarDeEscuchar();
      posiciones = []; personal = []; actual = null; citasHoy = {};
      ['posGrid', 'posResumen', 'poAgenda', 'manBody', 'rotKpis', 'rotChart', 'perBody'].forEach(function (id) { $(id).innerHTML = ''; });
      ver('posLista');
    }
  });

  // Lista de posiciones activas para asignar citas en «Historial de citas»
  window.PD_POSICIONES = async function () {
    var r = await sb.from('posiciones').select('id,codigo,nombre').eq('activa', true).order('codigo');
    return r.error ? [] : r.data;
  };
  $('poModificar').addEventListener('click', function () { if (!esSuper()) return; editando = true; aplicarModo(); aviso('poMsg', 'Haz los cambios y pulsa «Guardar cambios».'); $('poNombre').focus(); });
  $('poCancelar').addEventListener('click', function () { editando = false; rellenar(actual); aplicarModo(); aviso('poMsg', 'Se descartaron los cambios.'); });
  $('poEstadoReg').addEventListener('change', function () { this.dataset.estado = this.value; });
})();
