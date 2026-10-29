// Plus Dental — Cobros y pagos + Estados de cuenta (solo Administrador y Super Administrador)
// Saldo = tratamientos realizados de presupuestos aprobados (con descuento) − pagos no anulados.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito' };
  var CLINICA = { nombre: 'Plus Dental', direccion: 'Reforma Montúfar, zona 10, Nivel 9, Oficina 910, Ciudad de Guatemala', telefono: '+502 3756-5739' };

  var saldos = [], saldoDe = {}, pagos = [], ecFiltro = 'saldo', ecActual = null, movimientos = [], cpPag = 1, CP_PAG = 10;
  // Documento y detalle del pago
  var TIPOS_DOC = { factura: 'Factura', recibo: 'Recibo' };
  var ESTADOS_DOC = { emitido: 'Emitido', aplicado: 'Aplicado', certificado: 'Certificado', anulado: 'Anulado' };
  var CLASIF = { bien: 'Bien', servicio: 'Servicio' };
  var tiposProc = [], lineas = [], ultimoPago = null;
  // Productos de inventario que se venden en el detalle (salen de la bodega general de la sede)
  var invProductos = [], invPrecio = {}, invExist = {}, invBodega = null;
  function usd(n) { return 'US$' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
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
  // Logo y datos de la clínica (izquierda del encabezado de los reportes impresos)
  function logoClinica() {
    // Marca de la localidad (logo + imagen del slogan); si no tiene logo, la marca fija
    var m = window.PD_MARCA && window.PD_MARCA.htmlImpresion(62);
    if (m) return '<div style="display:flex;flex-direction:column;gap:6px">' + m +
      '<div style="font-size:11px;color:#475B68;line-height:1.5">' + CLINICA.direccion + ' · Tel. ' + CLINICA.telefono + '</div></div>';
    return '<div style="display:flex;align-items:center;gap:16px">' +
      '<img src="logo-plusdental-marca.png?v=3" alt="' + CLINICA.nombre + '" style="width:118px;height:auto">' +
      '<div style="font-size:12px;color:#475B68;line-height:1.55"><b style="display:block;font-size:11px;letter-spacing:.16em;color:#005A87">ODONTOLOGÍA INTEGRAL</b>' +
      CLINICA.direccion.replace(', Ciudad', '<br>Ciudad') + '<br>Tel. ' + CLINICA.telefono + '</div></div>';
  }
  function encabezado(titulo) {
    return '<div style="font-family:Manrope,system-ui,sans-serif;color:#0B2B40;max-width:720px;margin:0 auto;padding:24px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:24px;border-bottom:3px solid #0B2B40;padding-bottom:14px;margin-bottom:18px">' +
      logoClinica() +
      '<div style="text-align:right;font-size:13px;color:#475B68"><div style="font-size:18px;font-weight:700;color:#0B2B40">' + titulo + '</div>Impreso el ' + fechaCorta(hoy()) + '</div></div>';
  }
  // Serie, número de factura y DTE solo se muestran (y se graban) cuando el documento es factura
  function esFactura() { return $('pgTipoDoc').value === 'factura'; }
  function pintarTipoDoc() { document.querySelectorAll('#pagoForm .pg-solo-factura').forEach(function (l) { l.hidden = !esFactura(); }); }
  if ($('pgTipoDoc')) { $('pgTipoDoc').addEventListener('change', pintarTipoDoc); pintarTipoDoc(); }
  function imprimir(html) {
    $('impresion').innerHTML = html;
    document.body.classList.add('imprimir');
    // esperar a que cargue el logo antes de abrir la ventana de impresión
    var imgs = [].slice.call($('impresion').querySelectorAll('img')).filter(function (i) { return !i.complete; });
    if (!imgs.length) { window.print(); return; }
    var faltan = imgs.length, listo = false;
    var seguir = function () { if (!listo && --faltan <= 0) { listo = true; window.print(); } };
    imgs.forEach(function (i) { i.addEventListener('load', seguir); i.addEventListener('error', seguir); });
    setTimeout(function () { if (!listo) { listo = true; window.print(); } }, 2500);
  }
  window.PD_IMPRESION = { imprimir: imprimir, encabezado: encabezado };
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('imprimir');
    $('impresion').innerHTML = '';
  });

  function documento(p) {
    var num = [p.serie, p.numero_factura].filter(Boolean).join('-');
    return (TIPOS_DOC[p.tipo_documento] || 'Recibo') + (num ? ' ' + num : '');
  }
  // Comprobante de pago impreso: logo a la izquierda; correlativo, recibo y estado a la derecha
  var COLOR_ESTADO = { emitido: ['#DBEAFE', '#1E40AF'], aplicado: ['#FEF3C7', '#92400E'], certificado: ['#DCF2EC', '#08504C'], anulado: ['#FDE2E4', '#9F1239'] };
  function htmlRecibo(p, detalle) {
    var s = saldoDe[p.paciente_id];
    var est = p.anulado ? 'anulado' : (p.estado_doc || 'emitido');
    var ce = COLOR_ESTADO[est] || COLOR_ESTADO.emitido;
    var sec = function (t) { return '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#005A87;font-weight:800;margin:20px 0 8px;border-bottom:1px solid #D9E4EC;padding-bottom:5px">' + t + '</div>'; };
    var dato = function (k, v, ancho) {
      return '<div style="' + (ancho ? 'grid-column:' + ancho + ';' : '') + 'font-weight:600;font-size:13px;min-width:0;overflow-wrap:anywhere">' +
        '<span style="display:block;font-size:10.5px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + k + '</span>' + v + '</div>';
    };
    var grilla = function (h) { return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 18px">' + h + '</div>'; };
    var th = 'background:#0B2B40;color:#FFFFFF;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:8px';
    var td = 'padding:8px;border-bottom:1px solid #E3EAF0';
    var tf = 'padding:8px;font-weight:800;background:#EEF5FA;border-top:2px solid #0B2B40';
    var saldo = s && !p.anulado ? (s.saldo < -0.004 ? 'A favor ' + q(-s.saldo) : q(Math.max(s.saldo, 0))) : '—';
    var lineas = detalle || [];
    var ahora = new Date();
    return '<div style="font-family:Manrope,system-ui,sans-serif;color:#0B2B40;max-width:740px;margin:0 auto;padding:24px">' +
      // Encabezado
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;border-bottom:3px solid #0B2B40;padding-bottom:16px">' +
      logoClinica() +
      '<div style="text-align:right"><div style="font-family:\'Instrument Serif\',Georgia,serif;font-size:28px;line-height:1">Comprobante de pago</div>' +
      (p.correlativo ? '<div style="display:inline-block;margin-top:8px;background:#0B2B40;color:#FFFFFF;border-radius:10px;padding:6px 12px;font-weight:800;font-size:15px">' +
        '<small style="display:block;font-size:9.5px;letter-spacing:.14em;color:#9CC3DA">CORRELATIVO INTERNO</small>' + esc(p.correlativo) + '</div>' : '') +
      '<div style="font-size:12px;color:#475B68;margin-top:6px">Recibo ' + recibo(p.id) + ' · <span style="display:inline-block;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:800;background:' + ce[0] + ';color:' + ce[1] + '">' + ESTADOS_DOC[est].toUpperCase() + '</span></div>' +
      '</div></div>' +
      (p.anulado ? '<div style="border:2px solid #9A3B2E;color:#9A3B2E;font-weight:700;padding:10px 14px;margin-top:14px">PAGO ANULADO — ' + esc(p.anulado_motivo || '') + '</div>' : '') +
      // Paciente
      sec('Paciente') + grilla(
        dato('Nombre', esc(p.pacientes ? p.pacientes.nombre : '—'), 'span 2') + dato('NIT', esc(p.nit || 'CF')) + dato('Saldo a la fecha', saldo)) +
      // Documento fiscal
      sec('Documento fiscal') + grilla(
        dato('Tipo', TIPOS_DOC[p.tipo_documento] || 'Recibo') + dato('Serie', esc(p.serie || '—')) + dato('Número', esc(p.numero_factura || '—')) + dato('Cuota', p.numero_cuota || '—') +
        (p.numero_dte ? dato('Número DTE (FEL)', esc(p.numero_dte), '1/-1') : '')) +
      // Datos del pago
      sec('Datos del pago') + grilla(
        dato('Fecha', fechaCorta(p.fecha)) + dato('Método', METODOS[p.metodo] || '—') + dato('Autorización', esc(p.referencia || '—')) +
        (p.banco ? dato('Banco', esc(p.banco)) + dato('N.º de documento', esc(p.documento_banco || '—')) : '') +
        dato('Presupuesto', p.presupuesto_id ? 'N.º ' + p.presupuesto_id : '—') +
        (p.concepto ? dato('Concepto', esc(p.concepto), '1/-1') : '')) +
      // Detalle
      sec('Detalle') +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
      ['Línea', 'Procedimiento o producto', 'Clasificación', 'Monto Q', 'Monto US$'].map(function (h, i) { return '<th style="' + th + ';text-align:' + (i > 2 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (lineas.length ? lineas.map(function (d) {
        return '<tr><td style="' + td + '">' + d.linea + '</td><td style="' + td + '">' + (d.producto ? esc(d.producto.nombre + (d.producto.presentacion ? ' (' + d.producto.presentacion + ')' : '')) + ' × ' + Number(d.cantidad || 1) : esc(d.tipo ? d.tipo.nombre : '—')) + '</td><td style="' + td + '">' + (CLASIF[d.clasificacion] || '') + '</td>' +
          '<td style="' + td + ';text-align:right">' + q(d.monto) + '</td><td style="' + td + ';text-align:right">' + usd(d.monto_usd) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" style="' + td + ';color:#5A6D7A">' + esc(p.concepto || 'Pago') + '</td></tr>') +
      '</tbody><tfoot><tr><td style="' + tf + '"></td><td style="' + tf + '">TOTALES</td><td style="' + tf + '"></td>' +
      '<td style="' + tf + ';text-align:right">' + q(p.monto) + '</td><td style="' + tf + ';text-align:right">' + usd(p.monto_usd) + '</td></tr></tfoot></table>' +
      (p.observaciones ? sec('Observaciones') + '<div style="font-size:13px;white-space:pre-line">' + esc(p.observaciones) + '</div>' : '') +
      // Firmas y pie
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:56px;font-size:12px;text-align:center;color:#475B68">' +
      '<div style="border-top:1px solid #0B2B40;padding-top:6px">Recibido por: ' + esc(p.registrado_por || '—') + '</div>' +
      '<div style="border-top:1px solid #0B2B40;padding-top:6px">Firma del paciente</div></div>' +
      '<div style="margin-top:26px;font-size:10.5px;color:#7A8C98;display:flex;justify-content:space-between;border-top:1px solid #D9E4EC;padding-top:8px">' +
      '<span>' + CLINICA.nombre + ' · Comprobante interno</span><span>Impreso el ' + fechaCorta(hoy()) + ', ' + ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2) + '</span></div>' +
      '</div>';
  }

  // Imprime el comprobante de un pago guardado (con su detalle)
  async function imprimirComprobante(id) {
    var p = pagos.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) {
      var r = await sb.from('pagos').select('*,pacientes(nombre,telefono)').eq('id', id).maybeSingle();
      if (r.error || !r.data) return;
      p = r.data;
    }
    var det = await sb.from('pago_detalle').select('linea,clasificacion,monto,monto_usd,cantidad,tipo:tipos_procedimiento(nombre),producto:inv_productos(codigo,nombre,presentacion)').eq('pago_id', p.id).order('linea');
    if (det.error) det = await sb.from('pago_detalle').select('linea,clasificacion,monto,monto_usd,tipo:tipos_procedimiento(nombre)').eq('pago_id', p.id).order('linea');
    imprimir(htmlRecibo(p, det.error ? [] : det.data));
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

    // Lista de pacientes: «Todos los pacientes» o uno en particular (este muestra su fila aunque no tenga saldo)
    var elegido = $('ecBuscar').value;
    $('ecBuscar').innerHTML = '<option value="">Todos los pacientes</option>' + saldos.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }).map(function (s) {
      return '<option value="' + s.paciente_id + '">' + esc(s.nombre) + '</option>';
    }).join('');
    if (saldoDe[elegido]) $('ecBuscar').value = elegido; else elegido = '';
    var buscar = elegido;
    var filas = buscar ? saldos.filter(function (s) { return String(s.paciente_id) === buscar; }) : (ecFiltro === 'saldo' ? conSaldo : saldos);
    if (ecFiltro === 'saldo') filas = filas.slice().sort(function (a, b) { return b.saldo - a.saldo; });
    if (!filas.length) {
      $('ecBody').innerHTML = '<tr><td colspan="6">' + (buscar ? 'Ningún paciente coincide.' : ecFiltro === 'saldo' ? 'Ningún paciente tiene saldo pendiente.' : 'Todavía no hay expedientes de pacientes.') + '</td></tr>';
      return;
    }
    $('ecBody').innerHTML = filas.map(function (s) {
      var clase = s.saldo > 0.004 ? 'saldo-debe' : s.saldo < -0.004 ? 'saldo-favor' : '';
      return '<tr><td><strong>' + esc(s.nombre) + '</strong></td><td class="num">' + q(s.cargos) + '</td><td class="num">' + q(s.abonos) + '</td>' +
        '<td class="num"><strong class="' + clase + '">' + q(s.saldo) + '</strong>' + (s.saldo < -0.004 ? '<br><span style="font-size:12px;color:#005A87">a favor</span>' : '') + '</td>' +
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
        '<td class="num">' + (m.cargo ? q(m.cargo) : '') + '</td><td class="num" style="color:#005A87">' + (m.abono ? q(m.abono) : '') + '</td>' +
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

  // Estado de cuenta impreso: paciente, código de paciente y médico en el encabezado
  async function imprimirEstado() {
    var ultimo = movimientos.length ? movimientos[movimientos.length - 1].saldo : 0;
    var celda = 'padding:8px 6px;border-bottom:1px solid #D9E4EC';
    var pid = ecActual.paciente_id, pac = null;
    var r = await sb.from('pacientes').select('id,nombre,dpi,nit,dentista_id,medico:dentistas(nombre)').eq('id', pid).maybeSingle();
    if (r.error) r = await sb.from('pacientes').select('id,nombre,dpi,nit').eq('id', pid).maybeSingle();
    if (!r.error) pac = r.data;
    var medico = pac && pac.medico && pac.medico.nombre ? pac.medico.nombre : 'Sin asignar';
    var firmaMed = pac && pac.dentista_id && window.PD_FIRMA ? await window.PD_FIRMA.cargar(pac.dentista_id, medico) : null;
    var dato = function (k, v, ancho) {
      return '<div style="min-width:0' + (ancho ? ';grid-column:' + ancho : '') + '"><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + k + '</span><b style="font-size:14px">' + v + '</b></div>';
    };
    imprimir(encabezado('Estado de cuenta') +
      '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
      dato('Paciente', esc(ecActual.nombre || (pac && pac.nombre) || ''), 'span 2') + dato('Código del paciente', String(pid).padStart(4, '0')) + dato('Médico asignado', esc(medico)) +
      (pac && (pac.dpi || pac.nit) ? dato('DPI', esc(pac.dpi || '—')) + dato('NIT', esc(pac.nit || 'CF')) : '') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
      ['Fecha', 'Concepto', 'Cargo', 'Pago', 'Saldo'].map(function (h, i) { return '<th style="' + celda + ';text-align:' + (i > 1 ? 'right' : 'left') + '">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + movimientos.map(function (m) {
        return '<tr><td style="' + celda + '">' + fechaCorta(m.fecha) + '</td><td style="' + celda + '">' + esc(m.concepto) + '</td>' +
          '<td style="' + celda + ';text-align:right">' + (m.cargo ? q(m.cargo) : '') + '</td><td style="' + celda + ';text-align:right">' + (m.abono ? q(m.abono) : '') + '</td>' +
          '<td style="' + celda + ';text-align:right">' + q(m.saldo) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div style="text-align:right;font-size:18px;margin-top:16px"><strong>' + (ultimo < -0.004 ? 'Saldo a favor: ' + q(-ultimo) : 'Saldo pendiente: ' + q(ultimo)) + '</strong></div>' +
      (firmaMed ? '<div style="display:flex;justify-content:flex-end;margin-top:30px">' + window.PD_FIRMA.bloque(firmaMed, { etiqueta: 'Médico asignado' }) + '</div>' : '') +
      '</div>');
  }

  // ---------- Cobros ----------
  // Parámetros de la lista: fecha inicial y final, paciente (o todos) y N.º de recibo (este busca en todas las fechas)
  function reciboBuscado() { return $('cpRecibo').value.trim().replace(/^n\.?\s*º?\s*/i, '').replace(/[^\w-]/g, ''); }
  async function cargarPagos() {
    aviso('cpMsg', '');
    if (!$('cpDesde').value) $('cpDesde').value = inicioMes(0);
    if (!$('cpHasta').value) $('cpHasta').value = hoy();
    var d = $('cpDesde').value, h = $('cpHasta').value, pac = $('cpPaciente').value, rec = reciboBuscado();
    if (!rec && d > h) { aviso('cpMsg', 'La fecha inicial no puede ser posterior a la final.', true); return; }
    $('cpBody').innerHTML = '<tr><td colspan="9">Cargando…</td></tr>';
    var consulta = sb.from('pagos').select('*,pacientes(nombre,telefono)').order('id', { ascending: false });
    if (rec) consulta = /^\d+$/.test(rec) ? consulta.or('id.eq.' + parseInt(rec, 10) + ',correlativo.ilike.*' + rec + '*') : consulta.ilike('correlativo', '*' + rec + '*');
    else consulta = consulta.gte('fecha', d).lte('fecha', h);
    if (pac) consulta = consulta.eq('paciente_id', +pac);
    var r = await consulta.limit(1000);
    if (r.error) { $('cpBody').innerHTML = ''; aviso('cpMsg', traducir(r.error), true); return; }
    pagos = r.data; cpPag = 1;
    pintarPagos();
  }
  async function cargarPacientesLista() {
    var r = await sb.from('pacientes').select('id,nombre').order('nombre');
    if (r.error) return;
    var antes = $('cpPaciente').value;
    $('cpPaciente').innerHTML = '<option value="">Todos los pacientes</option>' + r.data.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('');
    $('cpPaciente').value = antes;
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

  var ICO = { recibo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/></svg>',
    anular: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>' };
  function pintarPagos() {
    var filas = pagos, validos = filas.filter(function (p) { return !p.anulado; });
    var total = validos.reduce(function (t, p) { return t + Number(p.monto); }, 0), rec = reciboBuscado();
    $('cpResumen').innerHTML = filas.length ? '<b>' + filas.length + '</b> pago' + (filas.length === 1 ? '' : 's') + (filas.length - validos.length ? ' (' + (filas.length - validos.length) + ' anulado' + (filas.length - validos.length === 1 ? '' : 's') + ')' : '') +
      ' · Total cobrado <b>' + q(total) + '</b>' + (rec ? ' · recibo «' + esc(rec) + '» en todas las fechas' : '') : '';
    var paginas = Math.max(1, Math.ceil(filas.length / CP_PAG)); cpPag = Math.min(Math.max(1, cpPag), paginas);
    var ini = (cpPag - 1) * CP_PAG, vis = filas.slice(ini, ini + CP_PAG);
    if (!vis.length) {
      $('cpBody').innerHTML = '<tr><td colspan="9" class="geo-vacia">' + (rec ? 'Ningún pago tiene ese número de recibo.' : 'No hay pagos con esos parámetros.') + '</td></tr>';
      $('cpPaginas').hidden = true;
      return;
    }
    $('cpBody').innerHTML = vis.map(function (p) {
      var wa = telWa(p.pacientes && p.pacientes.telefono);
      var texto = 'Hola ' + (p.pacientes ? p.pacientes.nombre : '') + ', Plus Dental confirma la recepción de su pago:\n\nRecibo ' + recibo(p.id) +
        '\nFecha: ' + fechaCorta(p.fecha) + '\nMonto: ' + q(p.monto) + '\nForma de pago: ' + METODOS[p.metodo] + (p.concepto ? '\nConcepto: ' + p.concepto : '') + '\n\n¡Gracias!';
      var acciones = '<button type="button" class="cp-ico" data-recibo="' + p.id + '" title="Ver e imprimir el recibo" aria-label="Recibo ' + recibo(p.id) + '">' + ICO.recibo + '</button>' +
        (wa && !p.anulado ? '<a class="cp-ico cp-wa" href="https://wa.me/' + wa + '?text=' + encodeURIComponent(texto) + '" target="_blank" rel="noopener" title="Enviar por WhatsApp" aria-label="Enviar por WhatsApp">' + ICO.wa + '</a>' : '') +
        (esSuper() && !p.anulado ? '<button type="button" class="cp-ico cp-anular" data-anular="' + p.id + '" title="Anular el pago" aria-label="Anular ' + recibo(p.id) + '">' + ICO.anular + '</button>' : '');
      var estado = p.anulado || p.estado_doc === 'anulado'
        ? '<span class="estado estado-cancelada" title="' + esc(p.anulado_motivo || '') + '">Anulado</span>'
        : '<select class="pg-estado-lista" data-estado-pago="' + p.id + '" data-estado="' + (p.estado_doc || 'emitido') + '" aria-label="Estado del documento ' + recibo(p.id) + '">' +
          ['emitido', 'aplicado', 'certificado'].map(function (k) { return '<option value="' + k + '"' + ((p.estado_doc || 'emitido') === k ? ' selected' : '') + '>' + ESTADOS_DOC[k] + '</option>'; }).join('') + '</select>';
      var doc = [p.numero_dte ? 'DTE ' + p.numero_dte : '', p.numero_cuota ? 'Cuota ' + p.numero_cuota : ''].filter(Boolean).join(' · ');
      return '<tr class="' + (p.anulado ? 'anulado' : '') + '" data-pago="' + p.id + '"><td><b>' + recibo(p.id) + '</b>' + (p.correlativo ? '<small class="cp-corr">' + esc(p.correlativo) + '</small>' : '') + '</td>' +
        '<td>' + fechaCorta(p.fecha) + '</td>' +
        '<td><b class="ia-corto" title="' + esc(p.pacientes ? p.pacientes.nombre : '') + '">' + esc(p.pacientes ? p.pacientes.nombre : '—') + '</b>' + (p.nit ? '<small>NIT ' + esc(p.nit) + '</small>' : '') + '</td>' +
        '<td><span class="ia-corto" title="' + esc(documento(p)) + '">' + esc(documento(p)) + '</span>' + (doc ? '<small title="' + esc(doc) + '">' + esc(doc) + '</small>' : '') + '</td>' +
        '<td><span class="ia-corto" title="' + esc(p.concepto || '') + '">' + esc(p.concepto || (p.presupuesto_id ? 'Presupuesto N.º ' + p.presupuesto_id : '—')) + '</span>' + (p.anulado && p.anulado_motivo ? '<small title="' + esc(p.anulado_motivo) + '">' + esc(p.anulado_motivo) + '</small>' : '') + '</td>' +
        '<td>' + METODOS[p.metodo] + (p.referencia ? '<small>' + esc(p.referencia) + '</small>' : '') + (p.banco ? '<small class="ia-corto" title="' + esc(p.banco) + '">' + esc(p.banco) + (p.documento_banco ? ' · ' + esc(p.documento_banco) : '') + '</small>' : '') +
          (p.comprobante ? '<button type="button" class="cp-comp" data-comprobante="' + esc(p.comprobante) + '">Ver comprobante</button>' : '') + '</td>' +
        '<td class="num"><b>' + q(p.monto) + '</b>' + (Number(p.monto_usd) > 0 ? '<small>' + usd(p.monto_usd) + '</small>' : '') + '</td>' +
        '<td>' + estado + '</td><td><div class="cp-acc">' + acciones + '</div></td></tr>';
    }).join('');
    var bt = [];
    if (paginas > 1) for (var n = 1; n <= paginas; n++) if (n === 1 || n === paginas || Math.abs(n - cpPag) <= 1) bt.push(n); else if (bt[bt.length - 1] !== '…') bt.push('…');
    $('cpPaginas').hidden = filas.length <= CP_PAG;
    $('cpPaginas').innerHTML = '<span>' + (ini + 1) + '–' + (ini + vis.length) + ' de ' + filas.length + ' pagos</span>' + (paginas > 1 ? '<nav aria-label="Páginas de pagos"><button type="button" class="ia-pag" data-cppag="' + (cpPag - 1) + '"' + (cpPag === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' +
      bt.map(function (n) { return n === '…' ? '<span class="ia-pag-mas">…</span>' : '<button type="button" class="ia-pag" data-cppag="' + n + '"' + (n === cpPag ? ' aria-current="page"' : '') + '>' + n + '</button>'; }).join('') +
      '<button type="button" class="ia-pag" data-cppag="' + (cpPag + 1) + '"' + (cpPag === paginas ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></nav>' : '');
  }

  // Institución y sucursal del pago (por defecto todas): reducen la lista de pacientes y se guardan con el pago
  var instPago = [], sucPago = [], pacInstDe = {};
  async function cargarInstPago() {
    var r = await Promise.all([sb.from('jor_instituciones').select('id,nombre').order('nombre'), sb.from('jor_sucursales').select('id,nombre,institucion_id').order('nombre'),
      sb.from('pacientes').select('id,institucion_id,sucursal_id')]);
    instPago = r[0].error ? [] : r[0].data || []; sucPago = r[1].error ? [] : r[1].data || [];
    pacInstDe = {}; (r[2].error ? [] : r[2].data || []).forEach(function (p) { pacInstDe[p.id] = p; });
    var v = $('pgInst').value;
    $('pgInst').innerHTML = '<option value="">Todas las instituciones</option>' + instPago.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    $('pgInst').value = instPago.some(function (i) { return String(i.id) === v; }) ? v : '';
    opcionesSucPago();
  }
  function opcionesSucPago(sel) {
    var ins = $('pgInst').value, v = sel !== undefined ? String(sel || '') : $('pgSuc').value;
    var nomInst = {}; instPago.forEach(function (i) { nomInst[i.id] = i.nombre; });
    var l = ins ? sucPago.filter(function (s) { return String(s.institucion_id) === ins; }) : sucPago;
    $('pgSuc').innerHTML = '<option value="">Todas las sucursales</option>' + l.map(function (s) { return '<option value="' + s.id + '">' + esc(s.nombre) + (ins ? '' : ' · ' + esc(nomInst[s.institucion_id] || '')) + '</option>'; }).join('');
    $('pgSuc').value = l.some(function (s) { return String(s.id) === v; }) ? v : '';
  }
  function pasaFiltroPago(s) {
    var ins = $('pgInst').value, suc = $('pgSuc').value, p = pacInstDe[s.paciente_id] || {};
    return (!ins || String(p.institucion_id) === ins) && (!suc || String(p.sucursal_id) === suc);
  }
  function pintarSelectorPacientes(elegido) {
    var anterior = elegido || $('pgPaciente').value;
    var lista = saldos.filter(pasaFiltroPago);
    $('pgPaciente').innerHTML = saldos.length
      ? '<option value="">' + (lista.length ? 'Elige un paciente…' : 'Ningún paciente con esa institución o sucursal') + '</option>' + lista.map(function (s) {
        return '<option value="' + s.paciente_id + '"' + (String(s.paciente_id) === String(anterior) ? ' selected' : '') + '>' + esc(s.nombre) +
          (s.saldo > 0.004 ? ' · debe ' + q(s.saldo) : '') + '</option>';
      }).join('')
      : '<option value="">Primero crea el expediente del paciente</option>';
    alElegirPaciente();
  }

  async function alElegirPaciente() {
    var pid = $('pgPaciente').value;
    // Paciente institucional con «Todas»: se proponen su institución y su sucursal
    var pi = pacInstDe[pid];
    if (pid && pi && pi.institucion_id && !$('pgInst').value) { $('pgInst').value = String(pi.institucion_id); opcionesSucPago(pi.sucursal_id || ''); }
    var s = saldoDe[pid];
    $('pgSaldo').hidden = !s;
    if (s) {
      $('pgSaldo').innerHTML = s.saldo > 0.004 ? 'Saldo pendiente: <strong style="color:#9A3B2E">' + q(s.saldo) + '</strong>'
        : s.saldo < -0.004 ? 'Tiene saldo a favor: <strong style="color:#005A87">' + q(-s.saldo) + '</strong>'
          : 'No tiene saldo pendiente. El pago quedará como saldo a favor.';
    }
    $('pgPresupuesto').innerHTML = '<option value="">Sin presupuesto</option>';
    if (presItems.length) { presItems = []; pintarDetalle(); }
    $('pgNit').value = ''; $('pgNitNota').hidden = true;
    if (!pid) return;
    // NIT del expediente del paciente (no se modifica aquí; sin NIT se usa CF, consumidor final)
    sb.from('pacientes').select('nit').eq('id', pid).maybeSingle().then(function (n) {
      if (n.error || $('pgPaciente').value !== pid) return;
      var nit = n.data && n.data.nit ? String(n.data.nit).trim() : '';
      $('pgNit').value = nit || 'CF';
      $('pgNitNota').hidden = !!nit;
    });
    var r = await sb.from('presupuestos').select('id,fecha').eq('paciente_id', pid).eq('estado', 'aprobado').order('id', { ascending: false });
    if (r.error || $('pgPaciente').value !== pid) return;
    $('pgPresupuesto').innerHTML += r.data.map(function (p) { return '<option value="' + p.id + '">N.º ' + p.id + ' · ' + fechaCorta(p.fecha) + '</option>'; }).join('');
    if (r.data.length) $('pgPresupuesto').value = String(r.data[0].id);
    cargarItemsPresupuesto();
  }

  // ---------- Detalle del pago ----------
  // Cada línea: tipo de procedimiento (del catálogo «Tipos de procedimientos»), clasificación, monto Q y US$.
  // Los montos del pago son los totales del detalle.
  async function cargarTiposProc() {
    var r = await sb.from('tipos_procedimiento').select('id,nombre,estado,orden').order('orden').order('codigo');
    tiposProc = r.error ? [] : r.data.filter(function (t) { return t.estado === 'activo'; });
    pintarDetalle();
  }
  async function cargarProductosInv() {
    var r = await sb.from('inv_productos').select('id,codigo,nombre,presentacion,estado,localidad_id').eq('estado', 'activo').order('nombre').range(0, 4999);
    if (r.error) { invProductos = []; return; }
    invProductos = window.PD_SEDES ? window.PD_SEDES.deSede(r.data) : r.data;
    var pr = await sb.from('inv_precios').select('producto_id,precio,precio_usd,vigente,localidad_id').eq('tipo', 'directo').eq('vigente', true).range(0, 4999);
    invPrecio = {};
    (pr.error ? [] : (window.PD_SEDES ? window.PD_SEDES.deSede(pr.data) : pr.data)).forEach(function (x) { invPrecio[x.producto_id] = x; });
    await cargarExistenciasInv();
    pintarDetalle();
  }
  async function cargarExistenciasInv() {
    var b = await sb.rpc('inv_bodega_general');
    invBodega = b.error ? null : b.data;
    invExist = {};
    if (!invBodega) return;
    var e = await sb.from('inv_existencias').select('producto_id,existencia').eq('bodega_id', invBodega).range(0, 4999);
    (e.error ? [] : e.data).forEach(function (x) { invExist[x.producto_id] = Number(x.existencia); });
  }
  // Solo se venden productos con existencia en la bodega general y con precio de venta al cliente (Cliente directo)
  function vendible(p) { var pr = invPrecio[p.id]; return (invExist[p.id] || 0) > 0 && !!pr && Number(pr.precio) > 0; }
  function etiquetaProd(p) { return (p.codigo ? p.codigo + ' · ' : '') + p.nombre + (p.presentacion ? ' (' + p.presentacion + ')' : ''); }
  // Cantidad pedida de un producto en todas las líneas (para avisar si no alcanza la existencia)
  function pedido(prodId) { return lineas.reduce(function (t, l) { return t + (l.tipo === 'producto' && String(l.producto_id) === String(prodId) ? Number(l.cantidad) || 0 : 0); }, 0); }
  function textoExistencia(l) {
    if (!l.producto_id) return '';
    var ex = invExist[l.producto_id] || 0, falta = pedido(l.producto_id) > ex;
    return '<span class="pg-stock' + (falta ? ' falta' : '') + '" title="' + (falta ? 'La existencia en bodega no alcanza; el pago se registrará igual' : 'Existencia en la bodega general') + '">Exist. ' + ex + (falta ? ' · no alcanza' : '') + '</span>';
  }
  function lineaNueva(monto) { return { tipo: 'procedimiento', item_id: '', tipo_procedimiento_id: '', producto_id: '', producto_texto: '', cantidad: '1', clasificacion: 'bien', monto: monto || '', monto_usd: '' }; }
  // Procedimientos del presupuesto actual (el elegido en «Presupuesto»); al elegir uno se proponen su tipo y su monto
  var presItems = [], tipoDeTrat = {};
  function normT(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
  async function cargarItemsPresupuesto() {
    var id = $('pgPresupuesto').value;
    presItems = [];
    if (id) {
      var r = await Promise.all([sb.from('presupuesto_items').select('id,orden,tratamiento,pieza,cantidad,precio,realizado').eq('presupuesto_id', +id).order('orden').order('id'),
        Object.keys(tipoDeTrat).length ? null : sb.from('tratamientos').select('nombre,tipo_id')]);
      if ($('pgPresupuesto').value !== id) return;
      presItems = r[0].error ? [] : r[0].data;
      if (r[1] && !r[1].error) r[1].data.forEach(function (t) { if (t.tipo_id) tipoDeTrat[normT(t.nombre)] = t.tipo_id; });
    }
    // Las líneas que venían de otro presupuesto pierden el procedimiento elegido
    lineas.forEach(function (l) { if (l.item_id && !presItems.some(function (x) { return String(x.id) === String(l.item_id); })) l.item_id = ''; });
    pintarDetalle();
  }
  function textoItem(x) { return x.tratamiento + (x.pieza ? ' · pieza ' + x.pieza : '') + (x.cantidad > 1 ? ' ×' + x.cantidad : '') + ' · ' + q(x.precio * x.cantidad) + (x.realizado ? ' · realizado' : ''); }
  function tipoDeItem(x) { var t = normT(x.tratamiento); if (tipoDeTrat[t]) return tipoDeTrat[t]; var k = Object.keys(tipoDeTrat).filter(function (n) { return n && (t.indexOf(n) === 0 || n.indexOf(t) === 0); })[0]; return k ? tipoDeTrat[k] : ''; }
  function opcionesProc(l) {
    var tipos = tiposProc.map(function (t) { return '<option value="t:' + t.id + '"' + (!l.item_id && String(l.tipo_procedimiento_id) === String(t.id) ? ' selected' : '') + '>' + esc(t.nombre) + '</option>'; }).join('');
    if (!presItems.length) return '<option value="">' + ($('pgPresupuesto').value ? 'Elige el tipo de procedimiento…' : 'Elige un tipo de procedimiento…') + '</option>' + tipos;
    return '<option value="">Elige el procedimiento…</option><optgroup label="Presupuesto N.º ' + esc($('pgPresupuesto').value) + '">' +
      presItems.map(function (x) { return '<option value="i:' + x.id + '"' + (String(l.item_id) === String(x.id) ? ' selected' : '') + '>' + esc(textoItem(x)) + '</option>'; }).join('') +
      '</optgroup><optgroup label="Otros tipos de procedimiento">' + tipos + '</optgroup>';
  }
  function pintarDetalle() {
    if (!lineas.length) lineas.push(lineaNueva());
    $('pgDetalle').innerHTML = lineas.map(function (l, k) {
      var prod = l.tipo === 'producto', sinTipo = !prod && l.item_id && !l.tipo_procedimiento_id;
      return '<tr data-linea="' + k + '"><td class="pg-linea">' + (k + 1) + '</td>' +
        '<td><div class="pg-fila' + (prod ? ' es-prod' : '') + '">' +
          (invProductos.length ? '<select data-pl="tipo" class="pg-clase" aria-label="Procedimiento o producto en la línea ' + (k + 1) + '"><option value="procedimiento"' + (!prod ? ' selected' : '') + '>Procedimiento</option><option value="producto"' + (prod ? ' selected' : '') + '>Producto</option></select>' : '') +
          (prod
            ? '<input data-pl="producto_texto" class="pg-principal" list="pgProdOpciones" value="' + esc(l.producto_texto) + '" placeholder="' + (invProductos.some(vendible) ? 'Código o nombre del producto' : 'Sin productos con existencia y precio') + '" aria-label="Producto de la línea ' + (k + 1) + '">' +
              '<label class="pg-cant" title="Cantidad"><span>Cant.</span><input data-pl="cantidad" placeholder="Cant." type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(l.cantidad) + '" aria-label="Cantidad del producto de la línea ' + (k + 1) + '"></label>' +
              '<span data-stock>' + textoExistencia(l) + '</span>'
            : '<select data-pl="proc" class="pg-principal" aria-label="Procedimiento de la línea ' + (k + 1) + '">' + opcionesProc(l) + '</select>' +
              (sinTipo ? '<select data-pl="tipo_procedimiento_id" class="pg-tipo-falta" aria-label="Tipo de procedimiento de la línea ' + (k + 1) + '" title="El tratamiento no tiene tipo de procedimiento en el catálogo: elígelo"><option value="">Tipo…</option>' +
                tiposProc.map(function (t) { return '<option value="' + t.id + '"' + (String(l.tipo_procedimiento_id) === String(t.id) ? ' selected' : '') + '>' + esc(t.nombre) + '</option>'; }).join('') + '</select>' : '')) +
        '</div></td>' +
        '<td><select data-pl="clasificacion" class="pg-clasif" aria-label="Clasificación de la línea ' + (k + 1) + '">' +
        Object.keys(CLASIF).map(function (c) { return '<option value="' + c + '"' + (l.clasificacion === c ? ' selected' : '') + '>' + CLASIF[c] + '</option>'; }).join('') + '</select></td>' +
        '<td class="num"><input data-pl="monto" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(l.monto) + '" placeholder="0.00" aria-label="Monto en quetzales de la línea ' + (k + 1) + '"></td>' +
        '<td class="num"><input data-pl="monto_usd" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(l.monto_usd) + '" placeholder="0.00" aria-label="Monto en dólares de la línea ' + (k + 1) + '"></td>' +
        '<td class="pg-acc">' + (lineas.length > 1 ? '<button type="button" class="pg-quitar" data-quitar-linea="' + k + '" aria-label="Quitar la línea ' + (k + 1) + '" title="Quitar línea">×</button>' : '') + '</td></tr>';
    }).join('');
    $('pgProdOpciones').innerHTML = invProductos.filter(vendible).map(function (p) { return '<option value="' + esc(etiquetaProd(p)) + '"></option>'; }).join('');
    pintarTotalesDetalle();
  }
  function pintarTotalesDetalle() {
    var tq = 0, tu = 0;
    lineas.forEach(function (l) { tq += Math.max(Number(l.monto) || 0, 0); tu += Math.max(Number(l.monto_usd) || 0, 0); });
    $('pgTotalQ').textContent = q(tq); $('pgTotalUsd').textContent = usd(tu);
    $('pgMonto').value = q(tq); $('pgMontoUsd').value = usd(tu);
    return { q: redondear(tq), usd: redondear(tu) };
  }
  // Transferencia o depósito: banco (lista del sistema), número de documento y comprobante
  function esBancario() { return $('pgMetodo').value === 'transferencia' || $('pgMetodo').value === 'deposito'; }
  function pintarBancario() {
    var b = esBancario();
    ['pgBancoWrap', 'pgDocBancoWrap', 'pgComprobanteWrap'].forEach(function (id) { $(id).hidden = !b; });
    if (b && $('pgBanco').options.length <= 1) $('pgBanco').innerHTML = '<option value="">Elige el banco…</option>' +
      (window.PD_BANCOS_GT || []).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '<option value="Otro">Otro</option>';
  }
  function nombreArchivo(n) { return String(n || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80); }
  async function guardarBancario(id) {
    var f = $('pgComprobante').files[0], ruta = null, aviso2 = '';
    if (f) {
      ruta = id + '/' + Date.now() + '-' + nombreArchivo(f.name);
      var up = await sb.storage.from('comprobantes').upload(ruta, f, { contentType: f.type, upsert: false });
      if (up.error) { ruta = null; aviso2 = ' No se pudo subir el comprobante: ' + traducir(up.error); }
    }
    var r = await sb.rpc('datos_bancarios_pago', { p_id: id, p_banco: $('pgBanco').value, p_documento: $('pgDocBanco').value.trim(), p_comprobante: ruta });
    if (r.error) aviso2 = /datos_bancarios_pago|could not find/i.test(r.error.message || '') ? ' Falta ejecutar en Supabase el script actualizado (supabase.sql) para guardar banco y comprobante.' : ' No se guardaron el banco y el documento: ' + traducir(r.error);
    return aviso2;
  }
  async function verComprobante(ruta) {
    var r = await sb.storage.from('comprobantes').createSignedUrl(ruta, 300);
    if (r.error) { aviso('cpMsg', traducir(r.error), true); return; }
    window.open(r.data.signedUrl, '_blank', 'noopener');
  }
  function pintarEstadoNuevo() { $('pgEstado').dataset.estado = $('pgEstado').value; }
  function limpiarFormulario() {
    lineas = [lineaNueva()];
    $('pgNitNota').hidden = true;
    ['pgNit', 'pgSerie', 'pgNumFactura', 'pgDte', 'pgCuota', 'pgConcepto', 'pgObservaciones'].forEach(function (id) { $(id).value = ''; });
    $('pgTipoDoc').value = 'factura'; $('pgMetodo').value = 'efectivo'; $('pgEstado').value = 'emitido'; pintarEstadoNuevo(); pintarTipoDoc();
    $('pgFecha').value = hoy();
    $('pgInst').value = ''; opcionesSucPago('');
    $('pgBanco').value = ''; $('pgDocBanco').value = ''; $('pgComprobante').value = ''; pintarBancario();
    $('pgUsuario').textContent = (window.PD_SESION && window.PD_SESION.usuario()) || '—';
    pintarDetalle();
  }

  // Próximo correlativo interno (Año-Mes-Número); el definitivo lo asigna la base de datos al registrar
  async function cargarCorrelativo() {
    var r = await sb.rpc('siguiente_correlativo_pago');
    $('pgCorrelativo').textContent = !r.error && r.data ? r.data : '—';
    $('pgCorrelativo').parentElement.classList.toggle('pg-prox', !r.error && !!r.data);
    $('pgCorrelativo').previousElementSibling.textContent = !r.error && r.data ? 'Próximo correlativo' : 'Correlativo interno';
  }

  async function cargarTodo() {
    $('pgUsuario').textContent = (window.PD_SESION && window.PD_SESION.usuario()) || '—';
    if (!tiposProc.length) cargarTiposProc();
    cargarProductosInv();
    cargarCorrelativo();
    if (await cargarSaldos()) { await cargarInstPago(); pintarSaldos(); pintarSelectorPacientes(); }
    cargarResumen();
    cargarPacientesLista();
    cargarPagos();
  }

  // ---------- Eventos ----------
  $('ecFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ecfiltro]');
    if (b) { ecFiltro = b.dataset.ecfiltro; pintarSaldos(); }
  });
  $('ecBuscar').addEventListener('change', pintarSaldos);
  // Mostrar: con un paciente elegido abre su estado de cuenta; con «Todos» muestra la lista
  $('ecMostrar').addEventListener('click', function () {
    var pid = $('ecBuscar').value;
    if (pid) abrirEstado(pid); else pintarSaldos();
  });
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
    // el saldo pendiente se propone en la primera línea del detalle
    lineas = [lineaNueva(ecActual.saldo > 0.004 ? ecActual.saldo.toFixed(2) : '')];
    pintarDetalle();
    $('pgDetalle').querySelector('select').focus();
  });

  $('pgPaciente').addEventListener('change', alElegirPaciente);
  $('pgInst').addEventListener('change', function () { opcionesSucPago(); pintarSelectorPacientes(); });
  $('pgSuc').addEventListener('change', function () {
    var s = sucPago.filter(function (x) { return String(x.id) === $('pgSuc').value; })[0];
    if (s && !$('pgInst').value) { $('pgInst').value = String(s.institucion_id); opcionesSucPago(s.id); }
    pintarSelectorPacientes();
  });
  $('pgPresupuesto').addEventListener('change', cargarItemsPresupuesto);
  $('pgMetodo').addEventListener('change', pintarBancario);
  $('pgComprobante').addEventListener('change', function () { var f = this.files[0]; if (f && f.size > 10 * 1024 * 1024) { this.value = ''; aviso('pgMsg', 'El comprobante pesa más de 10 MB.', true); } });
  // Detalle: cambios en las líneas, agregar y quitar
  $('pgDetalle').addEventListener('input', function (e) {
    var c = e.target.closest('[data-pl]');
    if (!c) return;
    var tr = c.closest('tr'), l = lineas[+tr.dataset.linea];
    l[c.dataset.pl] = c.value;
    if (c.dataset.pl === 'producto_texto' || c.dataset.pl === 'cantidad') {
      if (c.dataset.pl === 'producto_texto') {
        var p = invProductos.filter(function (x) { return vendible(x) && etiquetaProd(x) === c.value; })[0];
        l.producto_id = p ? p.id : '';
      }
      // Precio de venta «Cliente directo» × cantidad, si el producto lo tiene
      var pr = l.producto_id && invPrecio[l.producto_id];
      if (pr) {
        var n = Number(l.cantidad) || 1;
        l.monto = redondear(pr.precio * n).toFixed(2); tr.querySelector('[data-pl="monto"]').value = l.monto;
        if (pr.precio_usd != null) { l.monto_usd = redondear(pr.precio_usd * n).toFixed(2); tr.querySelector('[data-pl="monto_usd"]').value = l.monto_usd; }
      }
      $('pgDetalle').querySelectorAll('tr[data-linea]').forEach(function (fila) { var st = fila.querySelector('[data-stock]'); if (st) st.innerHTML = textoExistencia(lineas[+fila.dataset.linea]); });
    }
    pintarTotalesDetalle();
  });
  $('pgDetalle').addEventListener('change', function (e) {
    var c = e.target.closest('select[data-pl]');
    if (!c) return;
    var l = lineas[+c.closest('tr').dataset.linea];
    if (c.dataset.pl === 'proc') {
      var v = c.value, it = v.indexOf('i:') === 0 ? presItems.filter(function (x) { return 'i:' + x.id === v; })[0] : null;
      if (it) { l.item_id = it.id; l.tipo_procedimiento_id = tipoDeItem(it); l.clasificacion = 'servicio'; l.monto = (Number(it.precio) * Number(it.cantidad)).toFixed(2); }
      else { l.item_id = ''; l.tipo_procedimiento_id = v.indexOf('t:') === 0 ? v.slice(2) : ''; }
      pintarDetalle(); return;
    }
    l[c.dataset.pl] = c.value;
    if (c.dataset.pl === 'tipo') pintarDetalle();
  });
  $('pgDetalle').addEventListener('click', function (e) {
    var b = e.target.closest('[data-quitar-linea]');
    if (b) { lineas.splice(+b.dataset.quitarLinea, 1); pintarDetalle(); }
  });
  $('pgAgregarLinea').addEventListener('click', function () {
    lineas.push(lineaNueva());
    pintarDetalle();
    var s = $('pgDetalle').querySelectorAll('select[data-pl="proc"]');
    s[s.length - 1].focus();
  });
  $('pgEstado').addEventListener('change', pintarEstadoNuevo);
  $('pgImprimir').addEventListener('click', function () { if (ultimoPago) imprimirComprobante(ultimoPago); });

  $('pagoForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!$('pgPaciente').value) { aviso('pgMsg', 'Elige un paciente.', true); $('pgPaciente').focus(); return; }
    var usadas = lineas.filter(function (l) { return Number(l.monto) > 0 || Number(l.monto_usd) > 0 || l.tipo_procedimiento_id || l.producto_id || l.producto_texto; });
    if (!usadas.length) { aviso('pgMsg', 'Agrega al menos una línea al detalle del pago.', true); return; }
    if (usadas.some(function (l) { return l.tipo !== 'producto' && !l.tipo_procedimiento_id; })) { aviso('pgMsg', 'Elige el procedimiento en cada línea del detalle (y su tipo, si el tratamiento del presupuesto no lo tiene).', true); return; }
    if (usadas.some(function (l) { return l.tipo === 'producto' && !l.producto_id; })) { aviso('pgMsg', 'Elige cada producto de la lista (escribe el código o el nombre y selecciónalo).', true); return; }
    if (usadas.some(function (l) { return l.tipo === 'producto' && !(Number(l.cantidad) > 0); })) { aviso('pgMsg', 'La cantidad de cada producto debe ser mayor que cero.', true); return; }
    var faltan = usadas.filter(function (l) { return l.tipo === 'producto' && pedido(l.producto_id) > (invExist[l.producto_id] || 0); });
    if (faltan.length && !window.confirm('La existencia en bodega no alcanza para: ' + faltan.map(function (l) { return l.producto_texto; }).join(', ') + '.\n¿Registrar el pago de todos modos? El kardex quedará con saldo negativo hasta que ingrese la compra.')) return;
    if (esBancario() && !$('pgBanco').value) { aviso('pgMsg', 'Elige el banco de la ' + ($('pgMetodo').value === 'deposito' ? 'boleta de depósito.' : 'transferencia.'), true); $('pgBanco').focus(); return; }
    if (esBancario() && !$('pgDocBanco').value.trim()) { aviso('pgMsg', 'Escribe el número de documento del banco.', true); $('pgDocBanco').focus(); return; }
    var tot = pintarTotalesDetalle();
    if (!(tot.q > 0)) { aviso('pgMsg', 'El total en quetzales del detalle debe ser mayor que cero.', true); return; }
    var datos = {
      paciente_id: +$('pgPaciente').value,
      presupuesto_id: $('pgPresupuesto').value ? +$('pgPresupuesto').value : null,
      fecha: $('pgFecha').value || hoy(),
      metodo: $('pgMetodo').value,
      referencia: null,
      concepto: $('pgConcepto').value.trim() || null,
      nit: $('pgNit').value.trim(), tipo_documento: $('pgTipoDoc').value, serie: esFactura() ? $('pgSerie').value.trim() : '',
      numero_factura: esFactura() ? $('pgNumFactura').value.trim() : '', numero_dte: esFactura() ? $('pgDte').value.trim() : '',
      numero_cuota: $('pgCuota').value ? +$('pgCuota').value : null, estado_doc: $('pgEstado').value,
      observaciones: $('pgObservaciones').value.trim(),
      institucion_id: $('pgInst').value ? +$('pgInst').value : null, sucursal_id: $('pgSuc').value ? +$('pgSuc').value : null
    };
    var detalle = usadas.map(function (l) {
      if (l.tipo === 'producto') return { producto_id: +l.producto_id, cantidad: Number(l.cantidad), bodega_id: invBodega, clasificacion: l.clasificacion, monto: redondear(l.monto), monto_usd: redondear(l.monto_usd) };
      return { tipo_procedimiento_id: +l.tipo_procedimiento_id, clasificacion: l.clasificacion, monto: redondear(l.monto), monto_usd: redondear(l.monto_usd) };
    });
    var boton = this.querySelector('[type=submit]');
    boton.disabled = true;
    aviso('pgMsg', 'Registrando…');
    var r = await sb.rpc('registrar_pago', { p_datos: datos, p_lineas: detalle });
    boton.disabled = false;
    if (r.error) { aviso('pgMsg', /registrar_pago|could not find the function/i.test(r.error.message || '') ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los cobros con factura.' : traducir(r.error), true); return; }
    var pid = datos.paciente_id, avisoBanco = '';
    if (esBancario()) { aviso('pgMsg', 'Guardando el banco y el comprobante…'); avisoBanco = await guardarBancario(r.data); }
    if (detalle.some(function (l) { return l.producto_id; })) cargarExistenciasInv();
    limpiarFormulario();
    ultimoPago = r.data; $('pgImprimir').disabled = false; $('pgImprimir').title = '';
    var c = await sb.from('pagos').select('correlativo').eq('id', r.data).maybeSingle();
    var corr = !c.error && c.data && c.data.correlativo;
    aviso('pgMsg', (corr ? 'Pago registrado con el correlativo ' + corr + ' (recibo ' + recibo(r.data) + ')' : 'Pago registrado con el recibo ' + recibo(r.data)) + '. Puedes imprimirlo o enviarlo desde la lista.' + avisoBanco, !!avisoBanco);
    await cargarTodo();
    pintarSelectorPacientes(pid);
  });

  $('cpFiltros').addEventListener('submit', function (e) { e.preventDefault(); cargarPagos(); });
  $('cpPaginas').addEventListener('click', function (e) { var b = e.target.closest('[data-cppag]'); if (b && !b.disabled) { cpPag = +b.dataset.cppag; pintarPagos(); } });
  // Cambiar el estado del documento desde la lista (Emitido, Aplicado, Certificado)
  $('cpBody').addEventListener('change', async function (e) {
    var s = e.target.closest('[data-estado-pago]');
    if (!s) return;
    var antes = s.dataset.estado;
    s.disabled = true;
    var r = await sb.rpc('cambiar_estado_pago', { p_id: +s.dataset.estadoPago, p_estado: s.value });
    s.disabled = false;
    if (r.error) { s.value = antes; aviso('cpMsg', traducir(r.error), true); return; }
    s.dataset.estado = s.value;
    pagos.forEach(function (p) { if (String(p.id) === s.dataset.estadoPago) p.estado_doc = s.value; });
    aviso('cpMsg', 'Recibo ' + recibo(s.dataset.estadoPago) + ': estado cambiado a ' + ESTADOS_DOC[s.value] + '.');
  });
  $('cpBody').addEventListener('click', async function (e) {
    var vc = e.target.closest('[data-comprobante]');
    if (vc) { verComprobante(vc.dataset.comprobante); return; }
    var rb = e.target.closest('[data-recibo]');
    if (rb) {
      imprimirComprobante(rb.dataset.recibo);
      return;
    }
    // Anular: pide el motivo en una fila debajo del pago
    var an = e.target.closest('[data-anular]');
    if (an) {
      var viejo = $('cpBody').querySelector('.anular-row');
      if (viejo) viejo.remove();
      var tr = an.closest('tr');
      tr.insertAdjacentHTML('afterend', '<tr class="anular-row"><td colspan="9"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
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
  pintarEstadoNuevo();
  pintarDetalle();

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if ($('ecDetalle').hidden) cargarTodo(); },
    limpiar: function () {
      saldos = []; saldoDe = {}; pagos = []; ecActual = null; movimientos = [];
      tiposProc = []; limpiarFormulario();
      ultimoPago = null; $('pgImprimir').disabled = true;
      ['ecBody', 'ecMovs', 'cpBody', 'pgPaciente', 'cpMetodos'].forEach(function (id) { $(id).innerHTML = ''; });
      $('ecDetalle').hidden = true; $('ecLista').hidden = false;
    }
  });
})();
