// Plus Dental — Cobros y pagos + Estados de cuenta (solo Administrador y Super Administrador)
// Saldo = tratamientos realizados de presupuestos aprobados (con descuento) − pagos no anulados.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito' };
  var CLINICA = { nombre: 'Plus Dental', direccion: 'Reforma Montúfar, zona 10, Ciudad de Guatemala', telefono: '+502 3756-5739' };

  var saldos = [], saldoDe = {}, pagos = [], ecFiltro = 'saldo', cpPeriodo = 'mes', ecActual = null, movimientos = [];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#44585B'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function inicioMes(desplazar) { var d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + (desplazar || 0), 1)); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function recibo(id) { return 'N.º ' + ('00000' + id).slice(-6); }
  function telWa(t) { var n = String(t || '').replace(/\D/g, ''); if (n.length === 8) n = '502' + n; return n; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/relation .*(pagos|movimientos_cuenta|saldos_pacientes).* does not exist|could not find the (table|function)/i.test(m)) return 'Falta ejecutar en Supabase el script de cobros y estados de cuenta.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/foreign key/i.test(m)) return 'El paciente tiene pagos registrados y no se puede borrar.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }

  // ---------- Impresión (recibos y estados de cuenta) ----------
  function encabezado(titulo) {
    return '<div style="font-family:Manrope,system-ui,sans-serif;color:#0F2A2E;max-width:720px;margin:0 auto;padding:24px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0F2A2E;padding-bottom:14px;margin-bottom:18px">' +
      '<div><div style="font-family:\'Instrument Serif\',Georgia,serif;font-size:30px">' + CLINICA.nombre + '</div>' +
      '<div style="font-size:12px;color:#44585B">' + CLINICA.direccion + ' · ' + CLINICA.telefono + '</div></div>' +
      '<div style="text-align:right;font-size:13px;color:#44585B"><div style="font-size:18px;font-weight:700;color:#0F2A2E">' + titulo + '</div>Impreso el ' + fechaCorta(hoy()) + '</div></div>';
  }
  function imprimir(html) {
    $('impresion').innerHTML = html;
    document.body.classList.add('imprimir');
    window.print();
  }
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('imprimir');
    $('impresion').innerHTML = '';
  });

  function htmlRecibo(p) {
    var fila = function (k, v) { return '<tr><td style="padding:8px 0;color:#44585B;width:200px">' + k + '</td><td style="padding:8px 0;font-weight:600">' + v + '</td></tr>'; };
    var s = saldoDe[p.paciente_id];
    return encabezado('Recibo ' + recibo(p.id)) +
      (p.anulado ? '<div style="border:2px solid #9A3B2E;color:#9A3B2E;font-weight:700;padding:10px 14px;margin-bottom:14px">RECIBO ANULADO — ' + esc(p.anulado_motivo) + '</div>' : '') +
      '<table style="width:100%;border-collapse:collapse;font-size:15px">' +
      fila('Fecha', fechaCorta(p.fecha)) +
      fila('Recibimos de', esc(p.pacientes ? p.pacientes.nombre : '')) +
      fila('La cantidad de', '<span style="font-size:22px">' + q(p.monto) + '</span>') +
      fila('Forma de pago', METODOS[p.metodo] + (p.referencia ? ' · ' + esc(p.referencia) : '')) +
      (p.concepto ? fila('Concepto', esc(p.concepto)) : '') +
      (p.presupuesto_id ? fila('Presupuesto', 'N.º ' + p.presupuesto_id) : '') +
      (s && !p.anulado ? fila('Saldo pendiente a la fecha', q(Math.max(s.saldo, 0))) : '') +
      fila('Registrado por', esc(p.registrado_por || '—')) +
      '</table><div style="margin-top:60px;display:flex;justify-content:flex-end"><div style="border-top:1px solid #0F2A2E;width:260px;text-align:center;padding-top:6px;font-size:13px">Firma y sello</div></div></div>';
  }

  // ---------- Saldos ----------
  async function cargarSaldos() {
    var r = await sb.from('saldos_pacientes').select('*').order('nombre');
    if (r.error) { aviso('ecMsg', traducir(r.error), true); return false; }
    saldos = r.data.map(function (s) { s.cargos = Number(s.cargos); s.abonos = Number(s.abonos); s.saldo = Number(s.saldo); return s; });
    saldoDe = {};
    saldos.forEach(function (s) { saldoDe[s.paciente_id] = s; });
    return true;
  }

  function pintarSaldos() {
    var conSaldo = saldos.filter(function (s) { return s.saldo > 0.004; });
    $('ecPorCobrar').textContent = q(conSaldo.reduce(function (t, s) { return t + s.saldo; }, 0));
    $('ecConSaldo').textContent = conSaldo.length;
    document.querySelectorAll('#ecFiltros [data-ecfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.ecfiltro === ecFiltro); });

    var buscar = $('ecBuscar').value.trim().toLowerCase();
    var filas = (ecFiltro === 'saldo' ? conSaldo : saldos).filter(function (s) { return !buscar || s.nombre.toLowerCase().indexOf(buscar) >= 0; });
    if (ecFiltro === 'saldo') filas = filas.slice().sort(function (a, b) { return b.saldo - a.saldo; });
    if (!filas.length) {
      $('ecBody').innerHTML = '<tr><td colspan="6">' + (buscar ? 'Ningún paciente coincide.' : ecFiltro === 'saldo' ? 'Ningún paciente tiene saldo pendiente.' : 'Todavía no hay expedientes de pacientes.') + '</td></tr>';
      return;
    }
    $('ecBody').innerHTML = filas.map(function (s) {
      var clase = s.saldo > 0.004 ? 'saldo-debe' : s.saldo < -0.004 ? 'saldo-favor' : '';
      return '<tr><td><strong>' + esc(s.nombre) + '</strong></td><td class="num">' + q(s.cargos) + '</td><td class="num">' + q(s.abonos) + '</td>' +
        '<td class="num"><strong class="' + clase + '">' + q(s.saldo) + '</strong>' + (s.saldo < -0.004 ? '<br><span style="font-size:12px;color:#0B6E69">a favor</span>' : '') + '</td>' +
        '<td class="fecha">' + fechaCorta(s.ultimo_movimiento) + '</td>' +
        '<td><button type="button" class="adm-btn" data-ec="' + s.paciente_id + '">Ver</button></td></tr>';
    }).join('');
  }

  // ---------- Estado de cuenta de un paciente ----------
  async function abrirEstado(pid) {
    aviso('ecDetMsg', '');
    var r = await sb.from('movimientos_cuenta').select('*').eq('paciente_id', pid).order('fecha').order('tipo').order('referencia_id');
    if (r.error) { aviso('ecMsg', traducir(r.error), true); return; }
    ecActual = saldoDe[pid] || { paciente_id: pid, nombre: '', saldo: 0 };
    var acumulado = 0;
    movimientos = r.data.map(function (m) {
      acumulado = Math.round((acumulado + Number(m.cargo) - Number(m.abono)) * 100) / 100;
      return { fecha: m.fecha, tipo: m.tipo, concepto: m.concepto, cargo: Number(m.cargo), abono: Number(m.abono), saldo: acumulado };
    });
    $('ecNombre').textContent = ecActual.nombre;
    $('ecSub').textContent = movimientos.length + ' movimiento(s) · cargos ' + q(ecActual.cargos) + ' · pagos ' + q(ecActual.abonos);
    $('ecSaldoEtiqueta').textContent = acumulado < -0.004 ? 'Saldo a favor' : 'Saldo pendiente';
    $('ecSaldo').textContent = q(Math.abs(acumulado));
    $('ecSaldo').className = acumulado > 0.004 ? 'saldo-debe' : acumulado < -0.004 ? 'saldo-favor' : '';
    $('ecMovs').innerHTML = movimientos.length ? movimientos.map(function (m) {
      return '<tr><td class="fecha">' + fechaCorta(m.fecha) + '</td><td>' + esc(m.concepto) + '</td>' +
        '<td class="num">' + (m.cargo ? q(m.cargo) : '') + '</td><td class="num" style="color:#0B6E69">' + (m.abono ? q(m.abono) : '') + '</td>' +
        '<td class="num"><strong>' + q(m.saldo) + '</strong></td></tr>';
    }).join('') : '<tr><td colspan="5">Sin movimientos. Los cargos aparecen al marcar tratamientos como realizados en un presupuesto aprobado.</td></tr>';

    var wa = telWa(ecActual.telefono);
    var texto = 'Hola ' + ecActual.nombre + ', le compartimos su estado de cuenta en Plus Dental al ' + fechaCorta(hoy()) + ':\n\n' +
      'Tratamientos realizados: ' + q(ecActual.cargos) + '\nPagos recibidos: ' + q(ecActual.abonos) + '\n' +
      (acumulado < -0.004 ? 'Saldo a favor: ' + q(-acumulado) : 'Saldo pendiente: ' + q(acumulado)) + '\n\nQuedamos a la orden para cualquier duda.';
    $('ecAcciones').innerHTML = '<button type="button" class="dlg-submit" data-ecaccion="pago">Registrar pago</button>' +
      (wa ? '<a class="adm-btn" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Enviar por WhatsApp</a>' : '') +
      '<button type="button" class="adm-btn" data-ecaccion="imprimir">Imprimir</button>';
    $('ecLista').hidden = true; $('ecDetalle').hidden = false;
    $('ecDetalle').scrollIntoView({ block: 'start' });
  }

  function imprimirEstado() {
    var ultimo = movimientos.length ? movimientos[movimientos.length - 1].saldo : 0;
    var celda = 'padding:8px 6px;border-bottom:1px solid #DCE3E1';
    imprimir(encabezado('Estado de cuenta') +
      '<div style="font-size:16px;margin-bottom:14px"><strong>' + esc(ecActual.nombre) + '</strong></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
      ['Fecha', 'Concepto', 'Cargo', 'Pago', 'Saldo'].map(function (h, i) { return '<th style="' + celda + ';text-align:' + (i > 1 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + movimientos.map(function (m) {
        return '<tr><td style="' + celda + '">' + fechaCorta(m.fecha) + '</td><td style="' + celda + '">' + esc(m.concepto) + '</td>' +
          '<td style="' + celda + ';text-align:right">' + (m.cargo ? q(m.cargo) : '') + '</td><td style="' + celda + ';text-align:right">' + (m.abono ? q(m.abono) : '') + '</td>' +
          '<td style="' + celda + ';text-align:right">' + q(m.saldo) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div style="text-align:right;font-size:18px;margin-top:16px"><strong>' + (ultimo < -0.004 ? 'Saldo a favor: ' + q(-ultimo) : 'Saldo pendiente: ' + q(ultimo)) + '</strong></div></div>');
  }

  // ---------- Cobros ----------
  async function cargarPagos() {
    aviso('cpMsg', '');
    $('cpBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var consulta = sb.from('pagos').select('*,pacientes(nombre,telefono)').order('id', { ascending: false });
    if (cpPeriodo === 'mes') consulta = consulta.gte('fecha', inicioMes(0));
    if (cpPeriodo === 'anterior') consulta = consulta.gte('fecha', inicioMes(-1)).lt('fecha', inicioMes(0));
    if (cpPeriodo === 'todo') consulta = consulta.limit(500);
    var r = await consulta;
    if (r.error) { $('cpBody').innerHTML = ''; aviso('cpMsg', traducir(r.error), true); return; }
    pagos = r.data;
    pintarPagos();
  }

  // Resumen del mes en curso (independiente del periodo que se esté viendo)
  async function cargarResumen() {
    var r = await sb.from('pagos').select('fecha,monto,metodo').eq('anulado', false).gte('fecha', inicioMes(0));
    if (r.error) return;
    var h = hoy(), totalHoy = 0, totalMes = 0, porMetodo = {};
    r.data.forEach(function (p) {
      var m = Number(p.monto);
      totalMes += m;
      if (p.fecha === h) totalHoy += m;
      porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + m;
    });
    $('cpHoy').textContent = q(totalHoy);
    $('cpMes').textContent = q(totalMes);
    $('ecCobradoMes').textContent = q(totalMes);
    var claves = Object.keys(METODOS).filter(function (k) { return porMetodo[k]; });
    $('cpMetodos').innerHTML = claves.length
      ? claves.map(function (k) { return '<div><span>' + METODOS[k] + '</span><b>' + q(porMetodo[k]) + '</b></div>'; }).join('')
      : 'Sin cobros este mes.';
  }

  function pintarPagos() {
    document.querySelectorAll('#cpPeriodo [data-cpperiodo]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.cpperiodo === cpPeriodo); });
    var buscar = $('cpBuscar').value.trim().toLowerCase().replace(/^n\.?º?\s*/, '');
    var filas = pagos.filter(function (p) {
      return !buscar || String(p.id) === String(parseInt(buscar, 10)) || ((p.pacientes && p.pacientes.nombre) || '').toLowerCase().indexOf(buscar) >= 0;
    });
    if (!filas.length) {
      $('cpBody').innerHTML = '<tr><td colspan="7">' + (buscar ? 'Ningún pago coincide.' : 'No hay pagos en este periodo.') + '</td></tr>';
      return;
    }
    $('cpBody').innerHTML = filas.map(function (p) {
      var wa = telWa(p.pacientes && p.pacientes.telefono);
      var texto = 'Hola ' + (p.pacientes ? p.pacientes.nombre : '') + ', Plus Dental confirma la recepción de su pago:\n\nRecibo ' + recibo(p.id) +
        '\nFecha: ' + fechaCorta(p.fecha) + '\nMonto: ' + q(p.monto) + '\nForma de pago: ' + METODOS[p.metodo] + (p.concepto ? '\nConcepto: ' + p.concepto : '') + '\n\n¡Gracias!';
      var acciones = '<button type="button" class="adm-btn" data-recibo="' + p.id + '">Recibo</button>' +
        (wa && !p.anulado ? '<a class="adm-btn" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">WhatsApp</a>' : '') +
        (esSuper() && !p.anulado ? '<button type="button" class="adm-btn" data-anular="' + p.id + '">Anular</button>' : '');
      return '<tr class="' + (p.anulado ? 'anulado' : '') + '" data-pago="' + p.id + '"><td class="fecha"><strong>' + recibo(p.id) + '</strong>' +
        (p.anulado ? '<br><span class="estado estado-cancelada" title="' + esc(p.anulado_motivo) + '">Anulado</span>' : '') + '</td>' +
        '<td class="fecha">' + fechaCorta(p.fecha) + '</td><td><strong>' + esc(p.pacientes ? p.pacientes.nombre : '—') + '</strong></td>' +
        '<td>' + esc(p.concepto || (p.presupuesto_id ? 'Presupuesto N.º ' + p.presupuesto_id : '—')) + '</td>' +
        '<td>' + METODOS[p.metodo] + (p.referencia ? '<br><span style="color:#5B6E70;font-size:13px">' + esc(p.referencia) + '</span>' : '') + '</td>' +
        '<td class="num"><strong>' + q(p.monto) + '</strong></td><td><div class="acciones">' + acciones + '</div></td></tr>';
    }).join('');
  }

  function pintarSelectorPacientes(elegido) {
    var anterior = elegido || $('pgPaciente').value;
    $('pgPaciente').innerHTML = saldos.length
      ? '<option value="">Elige un paciente…</option>' + saldos.map(function (s) {
        return '<option value="' + s.paciente_id + '"' + (String(s.paciente_id) === String(anterior) ? ' selected' : '') + '>' + esc(s.nombre) +
          (s.saldo > 0.004 ? ' · debe ' + q(s.saldo) : '') + '</option>';
      }).join('')
      : '<option value="">Primero crea el expediente del paciente</option>';
    alElegirPaciente();
  }

  async function alElegirPaciente() {
    var pid = $('pgPaciente').value;
    var s = saldoDe[pid];
    $('pgSaldo').hidden = !s;
    if (s) {
      $('pgSaldo').innerHTML = s.saldo > 0.004 ? 'Saldo pendiente: <strong style="color:#9A3B2E">' + q(s.saldo) + '</strong>'
        : s.saldo < -0.004 ? 'Tiene saldo a favor: <strong style="color:#0B6E69">' + q(-s.saldo) + '</strong>'
          : 'No tiene saldo pendiente. El pago quedará como saldo a favor.';
    }
    $('pgPresupuesto').innerHTML = '<option value="">Sin presupuesto</option>';
    if (!pid) return;
    var r = await sb.from('presupuestos').select('id,fecha').eq('paciente_id', pid).eq('estado', 'aprobado').order('id', { ascending: false });
    if (r.error || $('pgPaciente').value !== pid) return;
    $('pgPresupuesto').innerHTML += r.data.map(function (p) { return '<option value="' + p.id + '">N.º ' + p.id + ' · ' + fechaCorta(p.fecha) + '</option>'; }).join('');
  }

  async function cargarTodo() {
    if (await cargarSaldos()) { pintarSaldos(); pintarSelectorPacientes(); }
    cargarResumen();
    cargarPagos();
  }

  // ---------- Eventos ----------
  $('ecFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ecfiltro]');
    if (b) { ecFiltro = b.dataset.ecfiltro; pintarSaldos(); }
  });
  $('ecBuscar').addEventListener('input', pintarSaldos);
  $('ecBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ec]');
    if (b) abrirEstado(b.dataset.ec);
  });
  $('ecVolver').addEventListener('click', function () {
    ecActual = null; movimientos = [];
    $('ecDetalle').hidden = true; $('ecLista').hidden = false;
  });
  $('ecAcciones').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ecaccion]');
    if (!b) return;
    if (b.dataset.ecaccion === 'imprimir') { imprimirEstado(); return; }
    // Registrar pago: ir a Cobros con el paciente ya elegido
    var pid = ecActual.paciente_id;
    $('tabCobros').click();
    pintarSelectorPacientes(pid);
    $('pagoForm').scrollIntoView({ block: 'start' });
    $('pgMonto').value = ecActual.saldo > 0.004 ? ecActual.saldo.toFixed(2) : '';
    $('pgMonto').focus();
  });

  $('pgPaciente').addEventListener('change', alElegirPaciente);
  $('pgMetodo').addEventListener('change', function () { $('pgRefWrap').hidden = this.value === 'efectivo'; });
  $('pagoForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var monto = Math.round(Number($('pgMonto').value) * 100) / 100;
    if (!(monto > 0)) { aviso('pgMsg', 'Escribe un monto mayor que cero.', true); return; }
    var datos = {
      paciente_id: +$('pgPaciente').value,
      presupuesto_id: $('pgPresupuesto').value ? +$('pgPresupuesto').value : null,
      fecha: $('pgFecha').value || hoy(),
      monto: monto,
      metodo: $('pgMetodo').value,
      referencia: $('pgMetodo').value === 'efectivo' ? null : ($('pgReferencia').value.trim() || null),
      concepto: $('pgConcepto').value.trim() || null
    };
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('pgMsg', 'Registrando…');
    var r = await sb.from('pagos').insert(datos).select('*,pacientes(nombre,telefono)').single();
    boton.disabled = false;
    if (r.error) { aviso('pgMsg', traducir(r.error), true); return; }
    var pid = datos.paciente_id;
    this.reset();
    $('pgFecha').value = hoy();
    $('pgRefWrap').hidden = true;
    aviso('pgMsg', 'Pago registrado con el recibo ' + recibo(r.data.id) + '. Puedes imprimirlo o enviarlo desde la lista.');
    cpPeriodo = 'mes';
    await cargarTodo();
    pintarSelectorPacientes(pid);
  });

  $('cpPeriodo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cpperiodo]');
    if (b) { cpPeriodo = b.dataset.cpperiodo; cargarPagos(); }
  });
  $('cpBuscar').addEventListener('input', pintarPagos);
  $('cpBody').addEventListener('click', async function (e) {
    var rb = e.target.closest('[data-recibo]');
    if (rb) {
      var p = pagos.filter(function (x) { return String(x.id) === rb.dataset.recibo; })[0];
      if (p) imprimir(htmlRecibo(p));
      return;
    }
    // Anular: pide el motivo en una fila debajo del pago
    var an = e.target.closest('[data-anular]');
    if (an) {
      var viejo = $('cpBody').querySelector('.anular-row');
      if (viejo) viejo.remove();
      var tr = an.closest('tr');
      tr.insertAdjacentHTML('afterend', '<tr class="anular-row"><td colspan="7"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
        '<label class="adm-field" style="flex:1 1 260px">Motivo de la anulación del recibo ' + recibo(an.dataset.anular) +
        '<input id="anMotivo" class="adm-input" maxlength="200" style="width:100%" placeholder="Ej.: monto equivocado"></label>' +
        '<button type="button" class="adm-btn" data-confirmar-anular="' + an.dataset.anular + '" style="border-color:#9A3B2E;color:#9A3B2E">Anular recibo</button>' +
        '<button type="button" class="adm-btn" data-cancelar-anular>Cancelar</button></div></td></tr>');
      $('anMotivo').focus();
      return;
    }
    if (e.target.closest('[data-cancelar-anular]')) { e.target.closest('tr').remove(); return; }
    var ca = e.target.closest('[data-confirmar-anular]');
    if (ca) {
      var motivo = $('anMotivo').value.trim();
      if (!motivo) { aviso('cpMsg', 'Escribe el motivo de la anulación.', true); $('anMotivo').focus(); return; }
      ca.disabled = true;
      var r = await sb.rpc('anular_pago', { p_id: +ca.dataset.confirmarAnular, p_motivo: motivo });
      if (r.error) { ca.disabled = false; aviso('cpMsg', traducir(r.error), true); return; }
      aviso('cpMsg', 'Recibo ' + recibo(ca.dataset.confirmarAnular) + ' anulado. Ya no cuenta en el estado de cuenta ni en los totales.');
      cargarTodo();
    }
  });

  // Al entrar a estas opciones del menú se recalculan los saldos (pudieron cambiar en Presupuestos)
  ['tabEstados', 'tabCobros'].forEach(function (id) {
    $(id).addEventListener('click', function () { if ($('ecDetalle').hidden) cargarTodo(); });
  });

  $('pgFecha').value = hoy();
  $('pgFecha').max = hoy();

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if ($('ecDetalle').hidden) cargarTodo(); },
    limpiar: function () {
      saldos = []; saldoDe = {}; pagos = []; ecActual = null; movimientos = [];
      ['ecBody', 'ecMovs', 'cpBody', 'pgPaciente', 'cpMetodos'].forEach(function (id) { $(id).innerHTML = ''; });
      $('ecDetalle').hidden = true; $('ecLista').hidden = false;
    }
  });
})();
