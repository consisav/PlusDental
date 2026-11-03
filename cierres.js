// Plus Dental — Cierres (corte de caja)
// Una caja abierta a la vez: lista los cobros y pagos de honorarios pendientes de corte y los gastos de caja.
// Al cerrar, los movimientos quedan asignados al corte y los totales se congelan (supabase.sql: caja_*).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admCierres')) return;

  var TIPOS = { general: 'Caja general', cuenta_ajena: 'Cuenta ajena' };
  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito', cheque: 'Cheque' };
  var cierres = [], actual = null, movs = [];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(texto, error) { $('ccMsg').textContent = texto || ''; $('ccMsg').style.color = error ? '#9A3B2E' : '#475B68'; }
  function esSuper() { return window.PD_SESION && window.PD_SESION.esSuper(); }
  function usuario() { return (window.PD_SESION && window.PD_SESION.usuario()) || ''; }
  function num(n) { return (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function q(n) { return 'Q' + num(n); }
  function celda(n) { return Number(n) ? num(n) : ''; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/caja_|cierre_id/.test(m) && /does not exist|could not find/i.test(m)) return 'Falta ejecutar en Supabase el script de Cierres (supabase.sql).';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }
  function abierta() { return actual && actual.estado === 'abierta'; }
  function incluidos() { return movs.filter(function (m) { return m.incluido; }); }
  function totales(lista) {
    var t = { efectivo: 0, tarjeta: 0, transferencia: 0, egreso: 0 };
    lista.forEach(function (m) { t.efectivo += +m.efectivo; t.tarjeta += +m.tarjeta; t.transferencia += +m.transferencia; t.egreso += +m.egreso; });
    t.ingreso = t.efectivo + t.tarjeta + t.transferencia;
    return t;
  }
  // Rango de documentos (primero–último) de un tipo dentro del corte
  function rango(tipo) {
    var d = incluidos().filter(function (m) { return m.tipo_documento === tipo; }).map(function (m) { return m.documento; });
    if (!d.length) return '—';
    return d.length === 1 ? d[0] : d[0] + ' – ' + d[d.length - 1];
  }

  // ---------- Carga ----------
  async function cargar(elegir) {
    aviso('');
    var r = await sb.from('caja_cierres').select('*').order('numero', { ascending: false }).limit(60);
    if (r.error) { aviso(traducir(r.error), true); $('ccCorte').hidden = true; $('ccVacio').hidden = true; return; }
    cierres = r.data || [];
    var abiertaHoy = cierres.filter(function (c) { return c.estado === 'abierta'; })[0];
    $('ccSel').innerHTML = cierres.length ? cierres.map(function (c) {
      return '<option value="' + c.id + '">N.º ' + c.numero + ' · ' + fechaHora(c.abierta_en) + ' · ' + (c.estado === 'abierta' ? 'Abierta' : 'Cerrada') + '</option>';
    }).join('') : '<option value="">Sin cortes</option>';
    $('ccSel').disabled = !cierres.length;
    $('ccVacio').hidden = !!abiertaHoy;
    if (!cierres.length) { $('ccCorte').hidden = true; actual = null; return; }
    var id = elegir || (actual && cierres.some(function (c) { return c.id === actual.id; }) ? actual.id : (abiertaHoy || cierres[0]).id);
    $('ccSel').value = id;
    await verCorte(+id);
  }

  async function verCorte(id) {
    actual = cierres.filter(function (c) { return c.id === id; })[0] || null;
    if (!actual) return;
    var r = await sb.rpc('caja_movimientos', { p_cierre: id });
    if (r.error) { aviso(traducir(r.error), true); return; }
    movs = r.data || [];
    pintar();
  }

  // ---------- Pintar ----------
  function pintar() {
    var c = actual, ab = abierta(), t = totales(incluidos());
    $('ccCorte').hidden = false;
    $('ccNumero').textContent = c.numero;
    $('ccEstado').textContent = ab ? 'Abierta' : 'Cerrada';
    $('ccEstado').className = 'cc-estado ' + (ab ? 'abierta' : 'cerrada');
    $('ccTipo').textContent = TIPOS[c.tipo] || c.tipo;
    var ingresos = ab ? t.ingreso : +c.ingresos, egresos = ab ? t.egreso : +c.egresos;
    var final = ab ? +c.saldo_inicial + ingresos - egresos : +c.saldo_final;
    $('ccSaldoIni').textContent = q(c.saldo_inicial);
    $('ccIng').textContent = '+ ' + q(ingresos);
    $('ccEgr').textContent = '− ' + q(egresos);
    $('ccSaldoFin').textContent = q(final);
    $('ccSaldoFinLbl').textContent = ab ? 'Saldo final (en curso)' : 'Saldo final';
    $('ccInfo').innerHTML =
      '<li><b>Operador</b>' + esc(c.operador || '—') + '</li>' +
      '<li><b>Apertura</b>' + fechaHora(c.abierta_en) + '</li>' +
      '<li><b>Cierre</b>' + (ab ? 'En curso' : fechaHora(c.cerrada_en)) + '</li>' +
      '<li><b>Facturas</b>' + esc(rango('factura')) + '</li>' +
      '<li><b>Recibos</b>' + esc(rango('recibo')) + '</li>' +
      '<li><b>Revisado</b>' + (c.revisado_por ? '<span class="cc-ok">✓ ' + esc(c.revisado_por) + ' · ' + fechaHora(c.revisado_en) + '</span>' : 'Pendiente') + '</li>' +
      (c.ajustado_por ? '<li class="cc-info-ancho"><b>Ajuste de saldo</b>' + esc(c.ajustado_por) + ' · ' + fechaHora(c.ajustado_en) + ' · ' + esc(c.ajuste_motivo || '') + '</li>' : '');

    var lista = incluidos();
    $('ccBody').innerHTML = lista.length ? lista.map(function (m, i) {
      var ing = m.tipo === 'Ingreso';
      return '<tr><td>' + (i + 1) + '</td><td><span class="cc-tipo-mov ' + (ing ? 'ing' : 'egr') + '">' + m.tipo + '</span></td>' +
        '<td class="cc-doc">' + esc(m.documento) + '</td>' +
        '<td class="cc-desc" title="' + esc(m.descripcion) + '">' + esc(m.descripcion) + (!ing ? ' <small>' + esc(METODOS[m.metodo] || m.metodo || '') + '</small>' : '') + '</td>' +
        '<td>' + esc(m.usuario || '—') + '</td>' +
        '<td class="num">' + celda(m.efectivo) + '</td><td class="num">' + celda(m.tarjeta) + '</td><td class="num">' + celda(m.transferencia) + '</td>' +
        '<td class="num cc-egr">' + celda(m.egreso) + '</td>' +
        '<td>' + (ab ? '<button type="button" class="cc-quitar" data-quitar="' + m.origen + ':' + m.ref_id + '" title="' + (m.origen === 'gasto' ? 'Anular el gasto' : 'Quitar del corte (pasa al siguiente)') + '" aria-label="Quitar ' + esc(m.documento) + ' del corte">✕</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="cc-sin">' + (ab ? 'Aún no hay movimientos pendientes de corte.' : 'Este corte no tiene movimientos.') + '</td></tr>';
    $('ccPie').innerHTML = '<tr><td colspan="5">Totales</td><td class="num">' + num(t.efectivo) + '</td><td class="num">' + num(t.tarjeta) + '</td><td class="num">' + num(t.transferencia) + '</td><td class="num">' + num(t.egreso) + '</td><td></td></tr>';

    var quitados = movs.filter(function (m) { return !m.incluido; });
    $('ccQuitados').hidden = !(ab && quitados.length);
    $('ccQuitados').innerHTML = '<b>Quitados de este corte</b> (pasan al siguiente): ' + quitados.map(function (m) {
      return '<span class="cc-chip">' + esc(m.documento) + ' · ' + q(+m.efectivo + +m.tarjeta + +m.transferencia + +m.egreso) +
        ' <button type="button" data-devolver="' + m.origen + ':' + m.ref_id + '">Devolver</button></span>';
    }).join(' ');

    $('ccObs').value = c.observaciones || '';
    $('ccObs').readOnly = !ab;
    $('ccGastoBtn').hidden = !ab;
    if (!ab) $('ccGastoForm').hidden = true;
    $('ccCerrar').hidden = !ab;
    $('ccAjustar').hidden = !esSuper();
    $('ccRevisar').hidden = ab || !!c.revisado_por || (c.operador === usuario() && !esSuper());
    $('ccAjusteForm').hidden = true;
  }

  // ---------- Impresión ----------
  function imprimir() {
    var P = window.PD_IMPRESION; if (!P || !actual) return;
    var c = actual, ab = abierta(), lista = incluidos(), t = totales(lista);
    var final = ab ? +c.saldo_inicial + t.ingreso - t.egreso : +c.saldo_final;
    var td = 'padding:5px 6px;border-bottom:1px solid #D9E4EC;font-size:11px', n = td + ';text-align:right;white-space:nowrap';
    var html = P.encabezado('Corte de caja N.º ' + c.numero) +
      '<table style="width:100%;font-size:12px;margin-bottom:14px;border-collapse:collapse"><tr>' +
      '<td><b>Tipo:</b> ' + esc(TIPOS[c.tipo]) + '</td><td><b>Estado:</b> ' + (ab ? 'Abierta' : 'Cerrada') + '</td><td><b>Operador:</b> ' + esc(c.operador || '—') + '</td></tr><tr>' +
      '<td><b>Apertura:</b> ' + fechaHora(c.abierta_en) + '</td><td><b>Cierre:</b> ' + (ab ? 'En curso' : fechaHora(c.cerrada_en)) + '</td><td><b>Revisado:</b> ' + esc(c.revisado_por || 'Pendiente') + '</td></tr><tr>' +
      '<td><b>Facturas:</b> ' + esc(rango('factura')) + '</td><td colspan="2"><b>Recibos:</b> ' + esc(rango('recibo')) + '</td></tr></table>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:14px"><tr>' +
      [['Saldo inicial', q(c.saldo_inicial)], ['Ingresos', q(t.ingreso)], ['Egresos', q(t.egreso)], ['Saldo final', q(final)]].map(function (k) {
        return '<td style="border:1px solid #D9E4EC;padding:8px 10px;width:25%"><div style="font-size:10px;color:#475B68;text-transform:uppercase;letter-spacing:.06em">' + k[0] + '</div><div style="font-size:15px;font-weight:700">' + k[1] + '</div></td>';
      }).join('') + '</tr></table>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#F5F9FC">' +
      ['#', 'Tipo', 'Doc.', 'Descripción', 'Usuario', 'Efectivo', 'Tarjeta', 'Transf./dep.', 'Egreso'].map(function (h, i) { return '<th style="' + (i > 4 ? n : td) + ';text-align:' + (i > 4 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      lista.map(function (m, i) {
        return '<tr><td style="' + td + '">' + (i + 1) + '</td><td style="' + td + '">' + m.tipo + '</td><td style="' + td + '">' + esc(m.documento) + '</td><td style="' + td + '">' + esc(m.descripcion) + '</td><td style="' + td + '">' + esc(m.usuario || '') + '</td>' +
          '<td style="' + n + '">' + celda(m.efectivo) + '</td><td style="' + n + '">' + celda(m.tarjeta) + '</td><td style="' + n + '">' + celda(m.transferencia) + '</td><td style="' + n + '">' + celda(m.egreso) + '</td></tr>';
      }).join('') +
      '<tr style="font-weight:700"><td style="' + td + '" colspan="5">Totales</td><td style="' + n + '">' + num(t.efectivo) + '</td><td style="' + n + '">' + num(t.tarjeta) + '</td><td style="' + n + '">' + num(t.transferencia) + '</td><td style="' + n + '">' + num(t.egreso) + '</td></tr></tbody></table>' +
      (c.observaciones ? '<p style="font-size:12px;margin-top:14px"><b>Observaciones:</b> ' + esc(c.observaciones) + '</p>' : '') +
      '<div style="display:flex;justify-content:space-around;margin-top:56px;font-size:12px;text-align:center"><div style="border-top:1px solid #0B2B40;padding-top:6px;width:220px">Operador</div><div style="border-top:1px solid #0B2B40;padding-top:6px;width:220px">Revisado</div></div></div>';
    P.imprimir(html);
  }

  // ---------- Acciones ----------
  async function rpc(nombre, args, ok) {
    var r = await sb.rpc(nombre, args);
    if (r.error) { aviso(traducir(r.error), true); return false; }
    if (ok) aviso(ok);
    return r;
  }
  async function abrirCaja(tipo) {
    var r = await rpc('caja_abrir', { p_tipo: tipo || 'general' }, 'Caja abierta.');
    if (r) await cargar(r.data);
  }
  $('ccAbrir').addEventListener('click', function () { abrirCaja($('ccTipoNuevo').value); });
  $('ccSel').addEventListener('change', function () { aviso(''); verCorte(+$('ccSel').value); });
  $('ccImprimir').addEventListener('click', imprimir);
  $('ccCerrar').addEventListener('click', async function () {
    var t = totales(incluidos());
    if (!confirm('¿Cerrar el corte N.º ' + actual.numero + '?\n\nIngresos: ' + q(t.ingreso) + '\nEgresos: ' + q(t.egreso) +
      '\nSaldo final: ' + q(+actual.saldo_inicial + t.ingreso - t.egreso) + '\n\nDespués de cerrarlo ya no se puede modificar.')) return;
    var b = $('ccCerrar'); b.disabled = true;
    var r = await rpc('caja_cerrar', { p_cierre: actual.id, p_observaciones: $('ccObs').value }, 'Corte N.º ' + actual.numero + ' cerrado.');
    b.disabled = false;
    if (r) await cargar(actual.id);
  });
  $('ccRevisar').addEventListener('click', async function () {
    var r = await rpc('caja_revisar', { p_cierre: actual.id }, 'Corte marcado como revisado.');
    if (r) await cargar(actual.id);
  });
  $('ccObs').addEventListener('change', function () { if (abierta()) rpc('caja_observaciones', { p_cierre: actual.id, p_observaciones: $('ccObs').value }); });

  // Quitar o devolver movimientos, anular gastos
  document.getElementById('admCierres').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-quitar],[data-devolver]');
    if (!b || !abierta()) return;
    var p = (b.dataset.quitar || b.dataset.devolver).split(':'), quitar = !!b.dataset.quitar;
    if (quitar && p[0] === 'gasto' && !confirm('¿Anular este gasto de caja?')) return;
    b.disabled = true;
    var r = await rpc('caja_quitar', { p_cierre: actual.id, p_origen: p[0], p_ref: +p[1], p_quitar: quitar },
      quitar ? (p[0] === 'gasto' ? 'Gasto anulado.' : 'Movimiento quitado del corte; pasa al siguiente.') : 'Movimiento devuelto al corte.');
    if (r) await verCorte(actual.id); else b.disabled = false;
  });

  // Gastos de caja
  $('ccGastoBtn').addEventListener('click', function () { $('ccGastoForm').hidden = !$('ccGastoForm').hidden; if (!$('ccGastoForm').hidden) $('ccGDesc').focus(); });
  $('ccGCancelar').addEventListener('click', function () { $('ccGastoForm').hidden = true; });
  $('ccGastoForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var monto = parseFloat(String($('ccGMonto').value).replace(',', '.'));
    if (!$('ccGDesc').value.trim()) { aviso('Escribe la descripción del gasto.', true); $('ccGDesc').focus(); return; }
    if (!(monto > 0)) { aviso('Escribe un monto mayor que cero.', true); $('ccGMonto').focus(); return; }
    var r = await rpc('caja_gasto', { p_cierre: actual.id, p_descripcion: $('ccGDesc').value, p_monto: monto, p_metodo: $('ccGMetodo').value, p_documento: $('ccGDoc').value }, 'Gasto registrado.');
    if (!r) return;
    $('ccGastoForm').reset(); $('ccGastoForm').hidden = true;
    await verCorte(actual.id);
  });

  // Ajuste de saldo inicial (Super Administrador)
  $('ccAjustar').addEventListener('click', function () {
    $('ccAjusteForm').hidden = !$('ccAjusteForm').hidden;
    $('ccASaldo').value = (+actual.saldo_inicial).toFixed(2); $('ccAMotivo').value = '';
    if (!$('ccAjusteForm').hidden) $('ccASaldo').focus();
  });
  $('ccACancelar').addEventListener('click', function () { $('ccAjusteForm').hidden = true; });
  $('ccAjusteForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = parseFloat(String($('ccASaldo').value).replace(',', '.'));
    if (isNaN(s)) { aviso('Escribe el saldo inicial.', true); return; }
    if (!$('ccAMotivo').value.trim()) { aviso('Escribe el motivo del ajuste.', true); $('ccAMotivo').focus(); return; }
    var r = await rpc('caja_ajustar_saldo', { p_cierre: actual.id, p_saldo: s, p_motivo: $('ccAMotivo').value }, 'Saldo inicial ajustado.');
    if (r) await cargar(actual.id);
  });

  $('tabCierres').addEventListener('click', function () { cargar(); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('admCierres').hidden) cargar(); },
    limpiar: function () { cierres = []; actual = null; movs = []; $('ccBody').innerHTML = ''; $('ccCorte').hidden = true; }
  });
})();
