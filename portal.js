// Plus Dental — «Mi expediente»: portal de solo lectura para usuarios de tipo Cliente.
// El paciente se enlaza con su usuario en el expediente (campo «Usuario del portal»). La función mi_portal() de Supabase
// devuelve únicamente la información del paciente asignado al usuario conectado.
(function () {
  var sb = window.PD_SB;
  if (!sb) return;

  var ESTADOS_CITA = { pendiente: 'Programado', confirmada: 'Confirmado', reprogramada: 'Reprogramado' };
  var ESTADOS_TRAT = { proceso: 'En proceso', finalizado: 'Finalizado' };
  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito' };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var datos = null;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return +p[2] + ' ' + MESES[p[1] - 1] + ' ' + p[0]; }
  function fechaLarga(f) { var p = String(f).slice(0, 10).split('-'), d = new Date(+p[0], p[1] - 1, +p[2]); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + p[0]; }
  function edad(f) {
    if (!f) return '';
    var n = new Date(f + 'T00:00:00'), h = new Date(), a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a + ' años';
  }
  function tarjeta(titulo, cuerpo, extra) { return '<article class="mp-card' + (extra || '') + '"><h3>' + titulo + '</h3>' + cuerpo + '</article>'; }
  function vacio(t) { return '<p class="mp-vacio">' + t + '</p>'; }
  function aviso(t) { $('mpCuerpo').innerHTML = '<div class="mp-aviso">' + t + '</div>'; }

  async function abrir() {
    $('miPortal').hidden = false;
    $('mpNombre').textContent = 'Cargando…';
    $('mpCuerpo').innerHTML = '';
    $('miPortal').scrollIntoView({ behavior: 'smooth', block: 'start' });
    var r = await sb.rpc('mi_portal');
    if (r.error) {
      datos = null; $('mpNombre').textContent = 'Mi expediente';
      aviso(/mi_portal/.test(r.error.message || '') ? 'El portal todavía no está habilitado. Comunícate con la clínica al +502 3756-5739.' : 'No se pudo cargar tu información. Intenta de nuevo en unos minutos.');
      return;
    }
    datos = r.data;
    if (!datos || !datos.ok) {
      $('mpNombre').textContent = 'Mi expediente';
      aviso(datos && datos.motivo === 'sin_paciente'
        ? 'Tu usuario <b>' + esc(datos.usuario) + '</b> aún no está enlazado a un expediente. Pide en recepción que lo asignen a tu ficha de paciente, o escríbenos al <a href="https://wa.me/50237565739" target="_blank" rel="noopener">WhatsApp +502 3756-5739</a>.'
        : 'Inicia sesión para ver tu expediente.');
      return;
    }
    pintar();
  }
  function cerrar() { $('miPortal').hidden = true; $('mpCuerpo').innerHTML = ''; datos = null; }

  function pintar() {
    var p = datos.paciente, s = datos.saldo || { cargos: 0, abonos: 0, saldo: 0 };
    $('mpNombre').textContent = p.nombre;
    var dato = function (k, v) { return '<div><span>' + k + '</span><b>' + (v ? esc(v) : '—') + '</b></div>'; };
    var html = '';

    html += tarjeta('Mis datos', '<div class="mp-datos">' + dato('DPI', p.dpi) + dato('NIT', p.nit) + dato('Fecha de nacimiento', p.fecha_nacimiento && fecha(p.fecha_nacimiento) + ' · ' + edad(p.fecha_nacimiento)) +
      dato('Teléfono', p.telefono) + dato('Correo', p.correo) + dato('Médico tratante', p.medico) + '<div class="mp-ancho"><span>Dirección</span><b>' + esc(p.direccion || '—') + '</b></div></div>' +
      (p.alergias ? '<p class="mp-alerta"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
      '<p class="mp-nota">¿Algún dato no es correcto? Avísanos en recepción para actualizarlo.</p>');

    html += tarjeta('Próximas citas', datos.citas.length ? '<ul class="mp-lista">' + datos.citas.map(function (c) {
      return '<li><div class="mp-fecha"><b>' + esc(c.hora) + '</b><span>' + fechaLarga(c.fecha) + '</span></div><div class="mp-txt"><b>' + esc(c.servicio) + '</b><span>' + esc(c.dentista ? 'Dr(a). ' + c.dentista : 'Plus Dental') + '</span></div>' +
        '<span class="mp-pill mp-' + c.estado + '">' + (ESTADOS_CITA[c.estado] || c.estado) + '</span></li>';
    }).join('') + '</ul>' : vacio('No tienes citas programadas.') + '<a class="mp-link" href="#agenda" data-mp-cerrar>Reservar una cita</a>');

    html += tarjeta('Estado de cuenta', '<div class="mp-saldo">' +
      '<div><span>Tratamientos</span><b>' + q(s.cargos) + '</b></div><div><span>Pagado</span><b>' + q(s.abonos) + '</b></div>' +
      '<div class="' + (s.saldo > 0.004 ? 'mp-debe' : 'mp-ok') + '"><span>' + (s.saldo < -0.004 ? 'Saldo a favor' : 'Saldo pendiente') + '</span><b>' + q(Math.abs(s.saldo)) + '</b></div></div>' +
      (datos.pagos.length ? '<table class="mp-tabla"><thead><tr><th>Fecha</th><th>Pago</th><th class="mp-num">Monto</th></tr></thead><tbody>' + datos.pagos.map(function (g) {
        return '<tr><td>' + fecha(g.fecha) + '</td><td>' + esc(METODOS[g.metodo] || g.metodo) + (g.concepto ? ' · ' + esc(g.concepto) : '') + '</td><td class="mp-num">' + q(g.monto) + '</td></tr>';
      }).join('') + '</tbody></table>' : vacio('Aún no hay pagos registrados.')));

    html += tarjeta('Recetas y constancias', '<h4 class="mp-sub">Recetas</h4>' + (datos.recetas.length ? '<ul class="mp-lista">' + datos.recetas.map(function (r, i) {
      return '<li><div class="mp-txt"><b>' + esc(r.numero || 'Receta') + ' · ' + fecha(r.fecha) + '</b><span>' + esc(r.items.map(function (x) { return x.medicamento; }).join(', ') || 'Sin medicamentos') + '</span></div>' +
        '<button type="button" class="adm-btn" data-mp-receta="' + i + '">Imprimir</button></li>';
    }).join('') + '</ul>' : vacio('No tienes recetas registradas.')) +
      '<h4 class="mp-sub">Constancias médicas</h4>' + (datos.constancias.length ? '<ul class="mp-lista">' + datos.constancias.map(function (c, i) {
      return '<li><div class="mp-txt"><b>' + esc(c.numero) + ' · ' + fecha(c.fecha) + '</b><span>' + esc(c.dirigida || 'A quien interese') + '</span></div>' +
        '<button type="button" class="adm-btn" data-mp-constancia="' + i + '">Imprimir</button></li>';
    }).join('') + '</ul>' : vacio('No tienes constancias emitidas.')));

    html += tarjeta('Tratamientos', datos.tratamientos.length ? '<table class="mp-tabla"><thead><tr><th>Fecha</th><th>Tratamiento</th><th>Estado</th><th class="mp-num">Total</th></tr></thead><tbody>' + datos.tratamientos.map(function (t) {
      return '<tr><td>' + fecha(t.fecha) + '</td><td>' + esc(t.tratamiento) + (t.pieza ? ' <small>· pieza ' + esc(t.pieza) + '</small>' : '') + '</td><td><span class="mp-pill mp-t-' + t.estado + '">' + (ESTADOS_TRAT[t.estado] || t.estado) + '</span></td><td class="mp-num">' + q(t.total) + '</td></tr>';
    }).join('') + '</tbody></table>' : vacio('Aún no hay tratamientos en proceso o realizados.'), ' mp-dos');

    $('mpCuerpo').innerHTML = html;
  }

  // ---------- Impresión (mismos formatos que la clínica) ----------
  function firma(d) {
    return window.PD_FIRMA ? window.PD_FIRMA.bloque({ nombre: d.dentista, colegiado: d.colegiado }, { ancho: 320 })
      : '<div style="width:300px;border-top:1.5px solid #0B2B40;padding-top:6px;text-align:center">' + esc(d.dentista ? 'Dr(a). ' + d.dentista : 'Médico tratante') + '<br><small>Firma y sello</small></div>';
  }
  function imprimirReceta(r) {
    var imp = window.PD_IMPRESION, p = datos.paciente;
    if (!imp) return;
    var celda = 'padding:8px 6px;border-bottom:1px solid #D9E4EC;text-align:left;vertical-align:top';
    var dato = function (t, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t + '</span><b style="font-size:13.5px">' + v + '</b></div>'; };
    var prox = r.proxima_cita ? fechaLarga(r.proxima_cita) + (r.proxima_hora ? ' · ' + esc(r.proxima_hora) : '') : 'Según indicación médica';
    imp.imprimir(imp.encabezado('Receta médica · ' + esc(r.numero || '')) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 16px;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;margin-bottom:12px">' +
      dato('Paciente', esc(p.nombre)) + dato('DPI', esc(p.dpi || '—')) + dato('Edad', esc(edad(p.fecha_nacimiento) || '—')) + dato('Fecha', fechaLarga(r.fecha)) + '</div>' +
      (p.alergias ? '<p style="margin:0 0 12px;padding:8px 12px;border-radius:10px;background:#FDE2E4;color:#9F1239;font-size:13px"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
      '<div style="font-family:Georgia,serif;font-size:30px;color:#005A87;margin:4px 0 6px">℞</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0B2B40;color:#FFFFFF">' +
      ['#', 'Medicamento', 'Dosis', 'Frecuencia', 'Duración'].map(function (h) { return '<th style="' + celda + ';border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      r.items.map(function (i, k) { return '<tr><td style="' + celda + '">' + (k + 1) + '</td><td style="' + celda + '"><b>' + esc(i.medicamento) + '</b></td><td style="' + celda + '">' + esc(i.dosis || '—') + '</td><td style="' + celda + '">' + esc(i.frecuencia || '—') + '</td><td style="' + celda + '">' + esc(i.duracion || '—') + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (r.indicaciones ? '<p style="margin:14px 0 0;font-size:13.5px;line-height:1.55"><b>Indicaciones:</b> ' + esc(r.indicaciones) + '</p>' : '') +
      '<div style="display:flex;justify-content:center;margin-top:44px"><div style="text-align:center;font-size:13px">' + firma(r) +
      '<div style="margin-top:12px;font-size:12px;color:#22394A"><span style="color:#5A6D7A">Próxima cita:</span> <b>' + prox + '</b></div></div></div>' +
      '<p style="margin-top:28px;font-size:11px;color:#5A6D7A;text-align:center">Copia impresa desde «Mi expediente». Siga las indicaciones de su médico; ante cualquier reacción, suspenda el medicamento y comuníquese con la clínica.</p></div>');
  }
  function imprimirConstancia(c) {
    var imp = window.PD_IMPRESION;
    if (!imp) return;
    var parrafos = String(c.texto).split(/\n\s*\n/).map(function (x) { return '<p style="margin:0 0 14px;text-align:justify;text-indent:32px">' + esc(x.trim()) + '</p>'; }).join('');
    imp.imprimir(imp.encabezado('Constancia médica · ' + esc(c.numero)) +
      '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:15px;line-height:1.85;color:#0B2B40;padding:6px 10px 0">' +
      '<div style="text-align:center;font-family:Manrope,system-ui,sans-serif;font-size:20px;font-weight:800;letter-spacing:.18em;margin:10px 0 24px">CONSTANCIA MÉDICA</div>' +
      '<p style="margin:0 0 16px;font-weight:700">' + esc(c.dirigida || 'A quien interese') + ':</p>' + parrafos + '</div>' +
      '<div style="display:flex;justify-content:center;margin-top:46px">' + firma(c) + '</div>' +
      '<p style="margin-top:34px;font-size:11px;color:#5A6D7A;text-align:center;font-family:Manrope,system-ui,sans-serif">Constancia ' + esc(c.numero) + ' · copia impresa desde «Mi expediente» · Para verificarla comuníquese con Plus Dental al +502 3756-5739.</p></div>');
  }

  $('mpCuerpo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mp-receta],[data-mp-constancia],[data-mp-cerrar]');
    if (!b || !datos) return;
    if (b.dataset.mpReceta) imprimirReceta(datos.recetas[+b.dataset.mpReceta]);
    else if (b.dataset.mpConstancia) imprimirConstancia(datos.constancias[+b.dataset.mpConstancia]);
    else cerrar();
  });
  $('mpActualizar').addEventListener('click', abrir);
  $('mpCerrar').addEventListener('click', cerrar);

  window.PD_PORTAL = { abrir: abrir, cerrar: cerrar };
})();
