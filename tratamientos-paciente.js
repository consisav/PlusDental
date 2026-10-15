// Plus Dental — Expediente > Tratamientos: tratamientos del paciente con sus precios.
// Salen de los presupuestos APROBADOS (los realizados se marcan en Presupuesto).
// Muestra totales (realizado, pagado, saldo, por realizar), filtros y se puede imprimir.
(function () {
  var sb = window.PD_SB;
  if (!sb) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fechaCorta(f) { return f ? new Date(f + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function aviso(t, error) { var m = $('trMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }

  var paciente = null, items = [], saldo = null, filtro = 'realizados';

  function total(i) { return Math.round(i.cantidad * i.precio * (1 - (Number(i.presupuesto.descuento_pct) || 0) / 100) * 100) / 100; }

  async function cargar(p) {
    paciente = p; items = []; saldo = null;
    if (!p) return;
    $('trBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    aviso('');
    var r = await sb.from('presupuesto_items')
      .select('id,tratamiento,pieza,cantidad,precio,realizado,realizado_en,presupuesto:presupuestos!inner(id,fecha,estado,descuento_pct,paciente_id)')
      .eq('presupuesto.paciente_id', p.id).eq('presupuesto.estado', 'aprobado');
    if (paciente !== p) return;
    if (r.error) { $('trBody').innerHTML = ''; aviso('No se pudieron cargar los tratamientos: ' + (r.error.message || ''), true); return; }
    items = r.data.slice().sort(function (a, b) {
      return (b.realizado_en || '9999').localeCompare(a.realizado_en || '9999') || a.presupuesto.id - b.presupuesto.id || a.id - b.id;
    });
    var s = await sb.from('saldos_pacientes').select('*').eq('paciente_id', p.id).maybeSingle();
    if (paciente !== p) return;
    saldo = !s.error && s.data ? s.data : null;
    pintar();
  }

  function filas() {
    return items.filter(function (i) { return filtro === 'todos' || (filtro === 'realizados' ? i.realizado : !i.realizado); });
  }

  function pintar() {
    var hechos = items.filter(function (i) { return i.realizado; });
    var pend = items.filter(function (i) { return !i.realizado; });
    var tHecho = hechos.reduce(function (t, i) { return t + total(i); }, 0);
    var tPend = pend.reduce(function (t, i) { return t + total(i); }, 0);
    var pagado = saldo ? Number(saldo.abonos) || 0 : 0;
    var sal = saldo ? Number(saldo.saldo) || 0 : tHecho - pagado;
    $('trRealizado').textContent = q(tHecho);
    $('trPagado').textContent = q(pagado);
    $('trSaldo').textContent = sal < -0.004 ? q(-sal) + ' a favor' : q(Math.max(sal, 0));
    $('trSaldo').parentElement.classList.toggle('tr-debe', sal > 0.004);
    $('trPendiente').textContent = q(tPend);
    document.querySelectorAll('#trFiltros [data-trfiltro]').forEach(function (b) {
      var n = b.dataset.trfiltro === 'realizados' ? hechos.length : b.dataset.trfiltro === 'pendientes' ? pend.length : items.length;
      b.querySelector('span').textContent = '(' + n + ')';
      b.setAttribute('aria-pressed', b.dataset.trfiltro === filtro);
    });
    var lista = filas();
    if (!lista.length) {
      $('trBody').innerHTML = '<tr><td colspan="7">' + (items.length ? 'No hay tratamientos con este filtro.' : 'Este paciente aún no tiene tratamientos en presupuestos aprobados.') + '</td></tr>';
      $('trPie').innerHTML = '';
      return;
    }
    var cant = 0, suma = 0;
    $('trBody').innerHTML = lista.map(function (i) {
      cant += i.cantidad; suma += total(i);
      return '<tr><td class="fecha">' + (i.realizado ? fechaCorta(i.realizado_en) : '<span class="tr-pend">Pendiente</span>') + '</td>' +
        '<td><strong>' + esc(i.tratamiento) + '</strong>' + (i.pieza ? '<br><span class="tr-sub">Pieza ' + esc(i.pieza) + '</span>' : '') + '</td>' +
        '<td class="num">' + i.cantidad + '</td><td class="num">' + q(i.precio) + '</td>' +
        '<td class="num">' + (Number(i.presupuesto.descuento_pct) || 0) + '%</td><td class="num"><strong>' + q(total(i)) + '</strong></td>' +
        '<td>N.º ' + i.presupuesto.id + '</td></tr>';
    }).join('');
    var etq = filtro === 'realizados' ? 'TOTAL REALIZADO' : filtro === 'pendientes' ? 'TOTAL POR REALIZAR' : 'TOTAL';
    $('trPie').innerHTML = '<tr><td></td><td>' + etq + '</td><td class="num">' + cant + '</td><td></td><td></td><td class="num">' + q(suma) + '</td><td></td></tr>';
  }

  function imprimirLista() {
    var imp = window.PD_IMPRESION;
    if (!imp || !paciente) return;
    var lista = filas();
    var celda = 'padding:7px 6px;border-bottom:1px solid #D9E4EC';
    var titulo = filtro === 'pendientes' ? 'Tratamientos por realizar' : filtro === 'todos' ? 'Tratamientos' : 'Tratamientos realizados';
    var suma = 0;
    var html = imp.encabezado(titulo) +
      '<div style="font-size:16px;margin-bottom:4px"><strong>' + esc(paciente.nombre) + '</strong></div>' +
      '<div style="font-size:13px;color:#475B68;margin-bottom:14px">' + [paciente.dpi ? 'DPI ' + esc(paciente.dpi) : '', paciente.nit ? 'NIT ' + esc(paciente.nit) : ''].filter(Boolean).join(' · ') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
      ['Fecha', 'Tratamiento', 'Cant.', 'Precio', 'Desc.', 'Total', 'Presupuesto'].map(function (h, k) {
        return '<th style="' + celda + ';text-align:' + (k >= 2 && k <= 5 ? 'right' : 'left') + ';background:#0B2B40;color:#FFFFFF;font-size:11px;text-transform:uppercase">' + h + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      lista.map(function (i) {
        suma += total(i);
        return '<tr><td style="' + celda + '">' + (i.realizado ? fechaCorta(i.realizado_en) : 'Pendiente') + '</td><td style="' + celda + '">' + esc(i.tratamiento) + (i.pieza ? ' · pieza ' + esc(i.pieza) : '') + '</td>' +
          '<td style="' + celda + ';text-align:right">' + i.cantidad + '</td><td style="' + celda + ';text-align:right">' + q(i.precio) + '</td>' +
          '<td style="' + celda + ';text-align:right">' + (Number(i.presupuesto.descuento_pct) || 0) + '%</td><td style="' + celda + ';text-align:right">' + q(total(i)) + '</td>' +
          '<td style="' + celda + '">N.º ' + i.presupuesto.id + '</td></tr>';
      }).join('') +
      '<tr><td colspan="5" style="' + celda + ';font-weight:800;background:#EEF5FA">TOTAL</td><td style="' + celda + ';text-align:right;font-weight:800;background:#EEF5FA">' + q(suma) + '</td><td style="' + celda + ';background:#EEF5FA"></td></tr></tbody></table>' +
      '<div style="margin-top:18px;font-size:13px;color:#475B68">Realizado: <b>' + $('trRealizado').textContent + '</b> · Pagado: <b>' + $('trPagado').textContent + '</b> · Saldo: <b>' + $('trSaldo').textContent + '</b></div></div>';
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
