// Plus Dental — Agentes comerciales (vendedores): código, nombre, inicio, % de comisión y estado.
// Quién ingresó el agente, cuándo, y el último cambio de estado los registra Supabase automáticamente.
// Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admAgentes')) return;

  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', inactivo: 'Inactivo' };
  var agentes = [], actual = null, editando = false, filtro = 'todos';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function porcentaje(n) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function usuarioActual() { return (window.PD_SESION && window.PD_SESION.usuario()) || '—'; }
  function pill(estado) { return '<span class="estado estado-' + estado + '">' + ESTADOS[estado] + '</span>'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/agentes.*(does not exist|could not find)|could not find the table/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los agentes comerciales.';
    if (/agentes_codigo_unico|duplicate key/i.test(m)) return 'Ya existe un agente con ese código.';
    if (/agentes_comision/i.test(m)) return 'La comisión debe estar entre 0 y 100 %.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function ver(id) { ['acLista', 'acFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // ---------- Lista ----------
  async function cargar() {
    aviso('acMsg', '');
    $('acBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('agentes').select('*').order('codigo');
    if (r.error) { $('acBody').innerHTML = ''; aviso('acMsg', traducir(r.error), true); return; }
    agentes = r.data || [];
    pintarLista();
  }
  function pintarLista() {
    document.querySelectorAll('[data-acfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.acfiltro === filtro); });
    var q = sinTildes($('acBuscar').value.trim());
    var lista = agentes.filter(function (a) {
      return (filtro === 'todos' || a.estado === filtro) && (!q || sinTildes(a.codigo + ' ' + a.nombre).indexOf(q) >= 0);
    });
    $('acBody').innerHTML = lista.length ? lista.map(function (a) {
      return '<tr><td><b>' + esc(a.codigo) + '</b></td><td>' + esc(a.nombre) + '</td><td class="fecha">' + fechaCorta(a.fecha_inicio) + '</td>' +
        '<td>' + porcentaje(a.comision) + '</td><td>' + pill(a.estado) + '</td>' +
        '<td><button type="button" class="adm-btn" data-acabrir="' + a.id + '">Abrir</button></td></tr>';
    }).join('') : '<tr><td colspan="6">' + (agentes.length ? 'No hay agentes con ese filtro.' : 'Aún no hay agentes. Pulsa «Nuevo agente» para agregar el primero.') + '</td></tr>';
  }

  // ---------- Ficha ----------
  function siguienteCodigo() {
    var mayor = 0;
    agentes.forEach(function (a) { var m = /^AGE-(\d+)$/i.exec(a.codigo); if (m) mayor = Math.max(mayor, +m[1]); });
    return 'AGE-' + ('00' + (mayor + 1)).slice(-3);
  }
  function pintarEstadoSelect() { $('acEstado').dataset.estado = $('acEstado').value; }
  function rellenar(a) {
    $('acCodigo').value = a ? a.codigo : siguienteCodigo();
    $('acNombre').value = a ? a.nombre : '';
    $('acInicio').value = a ? a.fecha_inicio : hoy();
    $('acComision').value = a ? Number(a.comision) : '';
    $('acEstado').value = a ? a.estado : 'activo';
    pintarEstadoSelect();
    $('acRegPor').textContent = a ? (a.registrado_por || '—') : usuarioActual();
    $('acRegFecha').textContent = a ? fechaCorta(a.creado) : fechaCorta(hoy());
    $('acCambioFecha').textContent = a && a.estado_cambiado ? fechaHora(a.estado_cambiado) : 'Sin cambios';
    $('acCambioPor').textContent = a && a.estado_cambiado_por ? a.estado_cambiado_por : '—';
  }
  function pintarCabecera() {
    $('acTitulo').textContent = actual ? actual.nombre : 'Nuevo agente';
    $('acSub').textContent = actual ? actual.codigo + ' · Comisión ' + porcentaje(actual.comision) : 'Llena los datos y pulsa «Grabar».';
    $('acPill').hidden = !actual;
    if (actual) { $('acPill').className = 'estado estado-' + actual.estado; $('acPill').textContent = ESTADOS[actual.estado]; }
  }
  function aplicarModo() {
    $('acCampos').disabled = !editando;
    document.querySelectorAll('[data-ac-accion]').forEach(function (b) {
      var a = b.dataset.acAccion;
      b.hidden = (a === 'modificar' || a === 'eliminar') ? (editando || !actual) : !editando;
    });
    $('acEliminar').dataset.confirmar = '0';
  }
  function abrir(a) {
    actual = a || null;
    editando = !a;
    rellenar(actual);
    pintarCabecera();
    aplicarModo();
    aviso('acFormMsg', '');
    ver('acFicha');
    if (editando) $('acNombre').focus();
  }

  async function grabar() {
    var codigo = $('acCodigo').value.trim(), nombre = $('acNombre').value.trim(), inicio = $('acInicio').value;
    var comision = $('acComision').value === '' ? NaN : Number($('acComision').value);
    if (!codigo) { aviso('acFormMsg', 'Escribe el código del agente.', true); $('acCodigo').focus(); return; }
    if (!nombre) { aviso('acFormMsg', 'Escribe el nombre del agente.', true); $('acNombre').focus(); return; }
    if (!inicio) { aviso('acFormMsg', 'Indica la fecha de inicio.', true); $('acInicio').focus(); return; }
    if (isNaN(comision) || comision < 0 || comision > 100) { aviso('acFormMsg', 'La comisión debe ser un porcentaje entre 0 y 100.', true); $('acComision').focus(); return; }
    var datos = { codigo: codigo, nombre: nombre, fecha_inicio: inicio, comision: Math.round(comision * 100) / 100, estado: $('acEstado').value };
    $('acGrabar').disabled = true;
    aviso('acFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('agentes').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('agentes').insert(datos).select('*').single();
    $('acGrabar').disabled = false;
    if (r.error) { aviso('acFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual, cambioEstado = actual && actual.estado !== r.data.estado;
    actual = r.data;
    agentes = nuevo ? agentes.concat([actual]) : agentes.map(function (a) { return a.id === actual.id ? actual : a; });
    editando = false;
    rellenar(actual); pintarCabecera(); aplicarModo();
    aviso('acFormMsg', nuevo ? 'Agente grabado.' : cambioEstado ? 'Cambios grabados. Se registró el cambio de estado.' : 'Cambios grabados.');
  }

  $('tabAgentes').addEventListener('click', function () { if (!$('acLista').hidden) cargar(); });
  $('acNuevo').addEventListener('click', function () { abrir(null); });
  $('acVolver').addEventListener('click', function () { actual = null; ver('acLista'); pintarLista(); });
  $('acBuscar').addEventListener('input', pintarLista);
  $('acFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acfiltro]');
    if (b) { filtro = b.dataset.acfiltro; pintarLista(); }
  });
  $('acBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acabrir]');
    if (b) abrir(agentes.filter(function (a) { return String(a.id) === b.dataset.acabrir; })[0]);
  });
  $('acEstado').addEventListener('change', pintarEstadoSelect);
  $('acForm').addEventListener('submit', function (e) { e.preventDefault(); if (editando) grabar(); });
  $('acModificar').addEventListener('click', function () {
    editando = true; aplicarModo();
    aviso('acFormMsg', 'Modo modificación: haz los cambios y pulsa «Grabar».');
    $('acNombre').focus();
  });
  $('acCancelar').addEventListener('click', function () {
    if (!actual) { ver('acLista'); pintarLista(); return; }
    editando = false; rellenar(actual); aplicarModo();
    aviso('acFormMsg', 'Se descartaron los cambios.');
  });
  $('acEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('agentes').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('acFormMsg', traducir(r.error), true); return; }
    var nombre = actual.nombre;
    agentes = agentes.filter(function (a) { return a.id !== actual.id; });
    actual = null;
    ver('acLista'); pintarLista();
    aviso('acMsg', 'Agente «' + nombre + '» eliminado.');
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('acLista').hidden) cargar(); },
    limpiar: function () {
      agentes = []; actual = null; editando = false;
      $('acBody').innerHTML = '';
      ver('acLista');
    }
  });
})();
