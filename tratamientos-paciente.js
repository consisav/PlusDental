// Plus Dental — Expediente > Tratamientos: procedimientos del paciente en Proceso o Finalizados.
// Salen de los presupuestos APROBADOS: cada procedimiento pasa aquí al cambiar su estado a Proceso o Finalizado
// (en el odontograma o en Presupuesto), con los datos de su presupuesto (código, forma de pago, estado).
// Muestra totales (realizado, pagado, saldo, por realizar), filtros y se puede imprimir.
(function () {
  var sb = window.PD_SB;
  if (!sb) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function aviso(t, error) { var m = $('trMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }

  var ESTADOS = { pendiente: 'Pendiente', proceso: 'Proceso', finalizado: 'Finalizado', eliminado: 'Eliminado' };
  var FORMAS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta de crédito', otro: 'Otro' };
  var paciente = null, items = [], saldo = null, filtro = 'finalizado';

  // Estado de un procedimiento (los anteriores al estado por procedimiento: realizado = Finalizado)
  function estadoDe(i) { return i.estado || (i.realizado ? 'finalizado' : 'pendiente'); }
  function fechaEstado(i) { return i.estado_fecha ? fechaHora(i.estado_fecha) : i.realizado_en ? fechaCorta(i.realizado_en) : '—'; }
  function total(i) { return Math.round(i.cantidad * i.precio * (1 - (Number(i.presupuesto.descuento_pct) || 0) / 100) * 100) / 100; }
  function formaPago(p) {
    var f = FORMAS[p.forma_pago] || '';
    if (p.forma_pago === 'tarjeta') f += ' · ' + (p.cuotas > 1 ? p.cuotas + ' cuotas' : '1 pago') + (p.sin_recargo ? ' sin recargo' : '');
    return f;
  }

  async function cargar(p) {
    paciente = p; items = []; saldo = null;
    if (!p) return;
    $('trBody').innerHTML = '<tr><td colspan="8">Cargando…</td></tr>';
    aviso('');
    var campos = 'id,tratamiento,pieza,cantidad,precio,realizado,realizado_en,estado,estado_fecha,estado_por,presupuesto:presupuestos!inner(id,codigo,fecha,estado,descuento_pct,paciente_id,forma_pago,cuotas,sin_recargo)';
    var r = await sb.from('presupuesto_items').select(campos).eq('presupuesto.paciente_id', p.id).eq('presupuesto.estado', 'aprobado');
    // Si aún no se ejecutó el script nuevo (sin estado por procedimiento), se usa la consulta anterior
    if (r.error && /estado_fecha|codigo|forma_pago|column/i.test(r.error.message || '')) {
      r = await sb.from('presupuesto_items').select('id,tratamiento,pieza,cantidad,precio,realizado,realizado_en,presupuesto:presupuestos!inner(id,fecha,estado,descuento_pct,paciente_id)')
        .eq('presupuesto.paciente_id', p.id).eq('presupuesto.estado', 'aprobado');
    }
    if (paciente !== p) return;
    if (r.error) { $('trBody').innerHTML = ''; aviso('No se pudieron cargar los tratamientos: ' + (r.error.message || ''), true); return; }
    items = r.data.filter(function (i) { return estadoDe(i) !== 'eliminado'; }).sort(function (a, b) {
      return String(b.estado_fecha || b.realizado_en || '').localeCompare(String(a.estado_fecha || a.realizado_en || '')) || a.presupuesto.id - b.presupuesto.id || a.id - b.id;
    });
    var s = await sb.from('saldos_pacientes').select('*').eq('paciente_id', p.id).maybeSingle();
    if (paciente !== p) return;
    saldo = !s.error && s.data ? s.data : null;
    pintar();
  }

  // En esta pestaña solo están los procedimientos en Proceso o Finalizados
  function trasladados() { return items.filter(function (i) { var e = estadoDe(i); return e === 'proceso' || e === 'finalizado'; }); }
  function filas() { return trasladados().filter(function (i) { return filtro === 'todos' || estadoDe(i) === filtro; }); }

  function pintar() {
    var fin = items.filter(function (i) { return estadoDe(i) === 'finalizado'; });
    var proc = items.filter(function (i) { return estadoDe(i) === 'proceso'; });
    var pend = items.filter(function (i) { return estadoDe(i) === 'pendiente'; });
    var tFin = fin.reduce(function (t, i) { return t + total(i); }, 0);
    var tPorHacer = pend.concat(proc).reduce(function (t, i) { return t + total(i); }, 0);
    var pagado = saldo ? Number(saldo.abonos) || 0 : 0;
    var sal = saldo ? Number(saldo.saldo) || 0 : tFin - pagado;
    $('trRealizado').textContent = q(tFin);
    $('trPagado').textContent = q(pagado);
    $('trSaldo').textContent = sal < -0.004 ? q(-sal) + ' a favor' : q(Math.max(sal, 0));
    $('trSaldo').parentElement.classList.toggle('tr-debe', sal > 0.004);
    $('trPendiente').textContent = q(tPorHacer);
    document.querySelectorAll('#trFiltros [data-trfiltro]').forEach(function (b) {
      var n = b.dataset.trfiltro === 'finalizado' ? fin.length : b.dataset.trfiltro === 'proceso' ? proc.length : fin.length + proc.length;
      b.querySelector('span').textContent = '(' + n + ')';
      b.setAttribute('aria-pressed', b.dataset.trfiltro === filtro);
    });
    var lista = filas();
    if (!lista.length) {
      $('trBody').innerHTML = '<tr><td colspan="8">' + (trasladados().length ? 'No hay tratamientos con este filtro.'
        : 'Aún no hay tratamientos en proceso ni finalizados. Cambia el estado de los procedimientos de un presupuesto aprobado.') + '</td></tr>';
      $('trPie').innerHTML = '';
      return;
    }
    var cant = 0, suma = 0;
    $('trBody').innerHTML = lista.map(function (i) {
      var e = estadoDe(i), p = i.presupuesto;
      cant += i.cantidad; suma += total(i);
      return '<tr><td class="fecha">' + fechaEstado(i) + (i.estado_por ? '<br><span class="tr-sub">' + esc(i.estado_por) + '</span>' : '') + '</td>' +
        '<td><strong>' + esc(i.tratamiento) + '</strong>' + (i.pieza ? '<br><span class="tr-sub">Pieza ' + esc(i.pieza) + '</span>' : '') + '</td>' +
        '<td><span class="tr-est tr-est-' + e + '">' + ESTADOS[e] + '</span></td>' +
        '<td class="num">' + i.cantidad + '</td><td class="num">' + q(i.precio) + '</td>' +
        '<td class="num">' + (Number(p.descuento_pct) || 0) + '%</td><td class="num"><strong>' + q(total(i)) + '</strong></td>' +
        '<td><strong>' + esc(p.codigo || 'N.º ' + p.id) + '</strong>' + (p.forma_pago ? '<br><span class="tr-sub">' + esc(formaPago(p)) + '</span>' : '') + '</td></tr>';
    }).join('');
    var etq = filtro === 'finalizado' ? 'TOTAL FINALIZADO' : filtro === 'proceso' ? 'TOTAL EN PROCESO' : 'TOTAL';
    $('trPie').innerHTML = '<tr><td></td><td>' + etq + '</td><td></td><td class="num">' + cant + '</td><td></td><td></td><td class="num">' + q(suma) + '</td><td></td></tr>';
  }

  function imprimirLista() {
    var imp = window.PD_IMPRESION;
    if (!imp || !paciente) return;
    var lista = filas();
    var celda = 'padding:7px 6px;border-bottom:1px solid #D9E4EC';
    var titulo = filtro === 'proceso' ? 'Tratamientos en proceso' : filtro === 'todos' ? 'Tratamientos' : 'Tratamientos finalizados';
    var suma = 0;
    var html = imp.encabezado(titulo) +
      '<div style="font-size:16px;margin-bottom:4px"><strong>' + esc(paciente.nombre) + '</strong></div>' +
      '<div style="font-size:13px;color:#475B68;margin-bottom:14px">' + [paciente.dpi ? 'DPI ' + esc(paciente.dpi) : '', paciente.nit ? 'NIT ' + esc(paciente.nit) : ''].filter(Boolean).join(' · ') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>' +
      ['Fecha estado', 'Tratamiento', 'Estado', 'Cant.', 'Precio', 'Desc.', 'Total', 'Presupuesto'].map(function (h, k) {
        return '<th style="' + celda + ';text-align:' + (k >= 3 && k <= 6 ? 'right' : 'left') + ';background:#0B2B40;color:#FFFFFF;font-size:10.5px;text-transform:uppercase">' + h + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      lista.map(function (i) {
        var p = i.presupuesto;
        suma += total(i);
        return '<tr><td style="' + celda + '">' + fechaEstado(i) + '</td><td style="' + celda + '">' + esc(i.tratamiento) + (i.pieza ? ' · pieza ' + esc(i.pieza) : '') + '</td>' +
          '<td style="' + celda + '">' + ESTADOS[estadoDe(i)] + '</td>' +
          '<td style="' + celda + ';text-align:right">' + i.cantidad + '</td><td style="' + celda + ';text-align:right">' + q(i.precio) + '</td>' +
          '<td style="' + celda + ';text-align:right">' + (Number(p.descuento_pct) || 0) + '%</td><td style="' + celda + ';text-align:right">' + q(total(i)) + '</td>' +
          '<td style="' + celda + '">' + esc(p.codigo || 'N.º ' + p.id) + (p.forma_pago ? '<br>' + esc(formaPago(p)) : '') + '</td></tr>';
      }).join('') +
      '<tr><td colspan="6" style="' + celda + ';font-weight:800;background:#EEF5FA">TOTAL</td><td style="' + celda + ';text-align:right;font-weight:800;background:#EEF5FA">' + q(suma) + '</td><td style="' + celda + ';background:#EEF5FA"></td></tr></tbody></table>' +
      '<div style="margin-top:18px;font-size:13px;color:#475B68">Finalizado: <b>' + $('trRealizado').textContent + '</b> · Pagado: <b>' + $('trPagado').textContent + '</b> · Saldo: <b>' + $('trSaldo').textContent + '</b></div></div>';
    imp.imprimir(html);
  }

  $('trFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-trfiltro]');
    if (b) { filtro = b.dataset.trfiltro; pintar(); }
  });
  $('trImprimir').addEventListener('click', imprimirLista);

  window.PD_TRATAMIENTOS = { cargar: cargar };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {},
    limpiar: function () { paciente = null; items = []; saldo = null; $('trBody').innerHTML = ''; $('trPie').innerHTML = ''; }
  });
})();
