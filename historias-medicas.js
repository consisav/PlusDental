// Plus Dental — Expediente > Historia médica por fecha.
// Cada registro guarda fecha, número de cita (de la agenda), alergias, enfermedades y medicamentos.
// Botones: Guardar, Modificar, Eliminar (solo Super Administrador) y Agregar nuevo registro
// (copia los datos del registro más reciente para actualizar solo lo que cambió).
(function () {
  var sb = window.PD_SB;
  if (!sb || !document.getElementById('hmLista')) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function aviso(t, error) { var m = $('fHistoriaMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }
  function esSuper() { return !!(window.PD_SESION && window.PD_SESION.esSuper && window.PD_SESION.esSuper()); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/historias_medicas|guardar_historia|eliminar_historia/.test(m) && /does not exist|could not find/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para la historia médica por fecha.';
    if (/row-level security|permission denied|No tienes permiso/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  var ESTADOS_CITA = { pendiente: 'Programado', confirmada: 'Confirmado', reprogramada: 'Reprogramado', atendida: 'Atendido' };
  var CAMPOS = { alergias: 'pAlergias', enfermedades: 'pEnfermedades', medicamentos: 'pMedicamentos' };

  var paciente = null, registros = [], citas = [], elegido = null, modo = 'ver'; // ver | editar | nuevo

  function numeroCita(id) { for (var i = 0; i < citas.length; i++) if (citas[i].id === id) return i + 1; return null; }
  function textoCita(c, n) { return 'Cita ' + n + ' · ' + fechaCorta(c.fecha) + ' · ' + String(c.hora || '').slice(0, 5) + ' · ' + (c.servicio || '') + ' (' + (ESTADOS_CITA[c.estado] || c.estado) + ')'; }
  function actual() { return registros.filter(function (r) { return r.id === elegido; })[0] || null; }

  async function cargar(p, elegir) {
    paciente = p; registros = []; elegido = null; modo = 'ver';
    if (!p) return;
    aviso('');
    $('hmLista').innerHTML = '<span class="dlg-msg">Cargando…</span>';
    var rs = await Promise.all([
      sb.from('historias_medicas').select('*').eq('paciente_id', p.id).order('fecha', { ascending: false }).order('id', { ascending: false }),
      sb.from('citas').select('id,fecha,hora,servicio,estado').eq('paciente_id', p.id).neq('estado', 'cancelada').order('fecha').order('hora')
    ]);
    if (paciente !== p) return;
    citas = rs[1].error ? [] : rs[1].data;
    if (rs[0].error) { registros = []; $('hmLista').innerHTML = ''; pintar(); aviso(traducir(rs[0].error), true); return; }
    registros = rs[0].data;
    elegido = elegir || (registros[0] ? registros[0].id : null);
    if (!registros.length) { nuevo(true); return; }
    pintar();
  }

  function pintarLista() {
    $('hmLista').innerHTML = registros.length ? registros.map(function (r) {
      var activo = r.id === elegido && modo !== 'nuevo';
      return '<button type="button" class="hm-chip" data-hm="' + r.id + '" aria-pressed="' + activo + '">' + fechaCorta(r.fecha) +
        (r.cita_numero ? ' · Cita ' + r.cita_numero : '') + (r === registros[0] ? ' <small>más reciente</small>' : '') + '</button>';
    }).join('') + (modo === 'nuevo' ? '<span class="hm-chip hm-chip-nuevo" aria-current="true">Nuevo registro</span>' : '')
      : (modo === 'nuevo' ? '<span class="hm-chip hm-chip-nuevo" aria-current="true">Primer registro</span>' : '<span class="dlg-msg">Sin registros.</span>');
  }
  function opcionesCita(sel) {
    $('hmCita').innerHTML = '<option value="">Sin cita relacionada</option>' + citas.map(function (c, i) {
      return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(textoCita(c, i + 1)) + '</option>';
    }).join('');
  }
  function rellenar(r, base) {
    var fuente = r || base || {};
    Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = fuente[k] || ''; });
    $('hmFecha').value = r ? r.fecha : hoy();
    var citaSel = r ? r.cita_id : null;
    if (!r) { var deHoy = citas.filter(function (c) { return c.fecha === hoy(); })[0]; if (deHoy) citaSel = deHoy.id; }
    opcionesCita(citaSel);
    $('hmReg').innerHTML = r
      ? 'Grabado por <b>' + esc(r.creada_por || 'Sin usuario') + '</b> · ' + fechaHora(r.creada) + (r.modificada ? ' · Modificado por <b>' + esc(r.modificada_por || '') + '</b> · ' + fechaHora(r.modificada) : '')
      : 'Fecha, hora y usuario se registran al guardar · ' + esc((window.PD_SESION && window.PD_SESION.usuario()) || 'Sin usuario');
  }
  function botones() {
    var editando = modo !== 'ver', r = actual();
    $('pHistoriaCampos').disabled = !editando;
    $('hmGuardar').disabled = !editando;
    $('hmModificar').disabled = editando || !r;
    $('hmEliminar').disabled = editando || !r || !esSuper();
    $('hmEliminar').title = esSuper() ? '' : 'Solo el Super Administrador puede eliminar registros';
    $('hmNuevo').disabled = editando;
    $('hmCancelar').hidden = !editando;
  }
  function pintar() {
    pintarLista();
    if (modo !== 'nuevo') rellenar(actual());
    botones();
  }
  function nuevo(primero) {
    modo = 'nuevo';
    pintarLista();
    rellenar(null, registros[0]);
    botones();
    aviso(primero ? 'Este paciente aún no tiene historia médica: completa el primer registro y pulsa «Guardar».'
      : registros.length ? 'Nuevo registro con los datos del más reciente: actualiza lo que cambió y pulsa «Guardar».' : '');
    $('hmFecha').focus();
  }

  async function guardar(e) {
    if (e) e.preventDefault();
    if (modo === 'ver' || !paciente) return;
    if (!$('hmFecha').value) { aviso('Indica la fecha del registro.', true); return; }
    var citaId = $('hmCita').value ? +$('hmCita').value : null;
    $('hmGuardar').disabled = true;
    aviso('Guardando…');
    var r = await sb.rpc('guardar_historia', {
      p_id: modo === 'nuevo' ? null : elegido, p_paciente: paciente.id, p_fecha: $('hmFecha').value,
      p_cita: citaId, p_cita_numero: citaId ? numeroCita(citaId) : null,
      p_alergias: $('pAlergias').value, p_enfermedades: $('pEnfermedades').value, p_medicamentos: $('pMedicamentos').value
    });
    if (r.error) { $('hmGuardar').disabled = false; aviso(traducir(r.error), true); return; }
    var eraNuevo = modo === 'nuevo';
    await cargar(paciente, r.data);
    sincronizarPaciente();
    aviso(eraNuevo ? 'Registro de historia médica guardado.' : 'Cambios guardados.');
  }
  // La ficha del paciente (recetas, avisos de alergia) usa el registro más reciente
  function sincronizarPaciente() {
    var u = registros[0] || {};
    if (paciente) Object.keys(CAMPOS).forEach(function (k) { paciente[k] = u[k] || null; });
  }
  async function eliminar() {
    var r = actual();
    if (!r || !esSuper()) return;
    var b = $('hmEliminar');
    if (b.dataset.confirmar !== '1') {
      b.dataset.confirmar = '1'; b.textContent = '¿Eliminar el registro del ' + fechaCorta(r.fecha) + '?';
      setTimeout(function () { if (b.dataset.confirmar === '1') { b.dataset.confirmar = '0'; b.textContent = 'Eliminar'; } }, 5000);
      return;
    }
    b.dataset.confirmar = '0'; b.textContent = 'Eliminar';
    b.disabled = true;
    var x = await sb.rpc('eliminar_historia', { p_id: r.id });
    if (x.error) { b.disabled = false; aviso(traducir(x.error), true); return; }
    await cargar(paciente);
    sincronizarPaciente();
    aviso('Registro eliminado.');
  }

  // ---------- Eventos ----------
  $('fHistoria').addEventListener('submit', guardar);
  $('hmModificar').addEventListener('click', function () {
    if (!actual()) return;
    modo = 'editar'; botones(); aviso('Modo edición: haz los cambios y pulsa «Guardar».'); $('pAlergias').focus();
  });
  $('hmNuevo').addEventListener('click', function () { nuevo(false); });
  $('hmEliminar').addEventListener('click', eliminar);
  $('hmCancelar').addEventListener('click', function () {
    if (!registros.length) { nuevo(true); return; }
    modo = 'ver'; pintar(); aviso('Se descartaron los cambios.');
  });
  $('hmLista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-hm]');
    if (!b || modo !== 'ver') { if (b && modo !== 'ver') aviso('Guarda o cancela los cambios antes de cambiar de registro.', true); return; }
    elegido = +b.dataset.hm; aviso(''); pintar();
  });
  $('hmCita').addEventListener('change', function () {
    var c = citas.filter(function (x) { return x.id === +$('hmCita').value; })[0];
    if (c) $('hmFecha').value = c.fecha;
  });

  window.PD_HISTORIAS = { cargar: cargar, editando: function () { return modo !== 'ver'; }, modificar: function () { if (actual()) $('hmModificar').click(); else nuevo(!registros.length); } };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {},
    limpiar: function () { paciente = null; registros = []; citas = []; elegido = null; modo = 'ver'; $('hmLista').innerHTML = ''; aviso(''); }
  });
})();
