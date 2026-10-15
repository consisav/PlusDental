// Plus Dental — Recargos por pago en cuotas con tarjeta de crédito (grupo «Precios y paquetes»)
// Tabla de % por plan (1, 2, 3, 6, 10, 12, 18 y 24 cuotas); solo el Super Administrador la cambia.
// window.PD_CUOTAS: cálculo y tabla del plan de pago, usada en el odontograma y en Presupuesto.
(function () {
  var sb = window.PD_SB || null;
  var PLANES = [1, 2, 3, 6, 10, 12, 18, 24];
  // Valores de referencia (comisión Visa Cuotas publicada; 3 y 24 cuotas estimados) si aún no se corrió el SQL
  var REFERENCIA = { 1: 0, 2: 5.25, 3: 6, 6: 7, 10: 7.25, 12: 8, 18: 12, 24: 15 };
  var filas = [], porc = Object.assign({}, REFERENCIA), cargado = null, faltaSql = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function pctTxt(n) { return Number(n).toFixed(2) + ' %'; }
  function esSuper() { return !!(window.PD_SESION && window.PD_SESION.esSuper()); }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

  function cargar(forzar) {
    if (cargado && !forzar) return cargado;
    cargado = (async function () {
      if (!sb) return porc;
      var r = await sb.from('recargos_cuotas').select('*').order('cuotas');
      faltaSql = !!r.error;
      if (!r.error && r.data.length) { filas = r.data; porc = {}; r.data.forEach(function (x) { porc[x.cuotas] = Number(x.porcentaje); }); }
      document.dispatchEvent(new CustomEvent('pd-recargos'));
      return porc;
    })();
    return cargado;
  }

  // total con recargo y valor de cada cuota (pctFijo: el % guardado en un presupuesto ya creado)
  function calcular(total, n, pctFijo) {
    var pct = pctFijo != null ? Number(pctFijo) : (porc[n] || 0);
    var recargo = r2(total * pct / 100), pagar = r2(total + recargo);
    return { cuotas: n, pct: pct, recargo: recargo, total: pagar, cuota: r2(pagar / n) };
  }
  // Tabla para elegir el plan: cada fila lleva data-<atributo>="n"
  // sinRecargo: plan de cuotas sin recargo (tasa cero); el selector se elige con data-<atributo>-modo="con|sin"
  function tabla(total, sel, atributo, pctFijo, sinRecargo) {
    sel = +sel || 1;
    if (sinRecargo) pctFijo = 0;
    var filasHtml = PLANES.map(function (n) {
      var c = calcular(total, n, sinRecargo ? 0 : n === sel ? pctFijo : null), activo = n === sel;
      return '<tr class="cuo-fila' + (activo ? ' cuo-sel' : '') + '" data-' + atributo + '="' + n + '" tabindex="0" role="radio" aria-checked="' + activo + '">' +
        '<td><span class="cuo-radio" aria-hidden="true"></span></td><td>' + (n === 1 ? '1 pago' : n + ' cuotas') + '</td>' +
        '<td class="num">' + pctTxt(c.pct) + '</td><td class="num">' + q(c.recargo) + '</td><td class="num">' + q(c.cuota) + '</td><td class="num"><strong>' + q(c.total) + '</strong></td></tr>';
    }).join('');
    var e = calcular(total, sel, pctFijo);
    var modo = '<div class="cuo-modo" role="group" aria-label="Recargo del plan de cuotas">' +
      '<button type="button" data-' + atributo + '-modo="con" aria-pressed="' + !sinRecargo + '">Con recargo</button>' +
      '<button type="button" data-' + atributo + '-modo="sin" aria-pressed="' + !!sinRecargo + '">Sin recargo (tasa cero)</button></div>';
    return '<div class="cuo">' + modo + '<div class="roles-wrap" data-sin-tarjetas><table class="cuo-tabla" role="radiogroup" aria-label="Plan de pago"><thead><tr><th><span class="sr-only">Elegir</span></th><th>Plan</th><th class="num">% recargo</th><th class="num">Recargo</th><th class="num">Valor cuota</th><th class="num">Total a pagar</th></tr></thead>' +
      '<tbody>' + filasHtml + '</tbody></table></div>' +
      '<div class="cuo-res"><div><small>PLAN ELEGIDO</small><b>' + (sel === 1 ? '1 pago de ' : sel + ' cuotas de ') + q(e.cuota) + '</b></div>' +
      '<div><small>TOTAL A PAGAR</small><b>' + q(e.total) + '</b></div>' + (sinRecargo ? '<div class="cuo-cero"><small>RECARGO</small><b>Sin recargo</b></div>' : '') + '</div></div>';
  }

  window.PD_CUOTAS = { PLANES: PLANES, cargar: cargar, calcular: calcular, tabla: tabla, porcentaje: function (n) { return porc[n] || 0; } };

  // ---------- Pantalla «Recargos de tarjeta» ----------
  var panel = $('admRecargos');
  if (!panel || !sb) return;
  panel.innerHTML = '<div class="adm-pane-head"><h3 class="adm-h">Recargos de tarjeta</h3></div>' +
    '<p class="dlg-msg">Porcentaje que se suma al total del presupuesto cuando el paciente paga con tarjeta de crédito en cuotas. ' +
    'Ajústalo según el contrato de la clínica con su banco o VisaNet. Los valores iniciales son de referencia (3 y 24 cuotas, estimados).</p>' +
    '<p id="rcSoloSuper" class="dlg-msg" hidden>Solo el Super Administrador puede cambiar los porcentajes.</p>' +
    '<div class="roles-wrap"><table><thead><tr><th>Plan</th><th class="num">% recargo</th><th class="num">Ejemplo con Q1,000.00</th><th>Última modificación</th></tr></thead><tbody id="rcBody"></tbody></table></div>' +
    '<div class="exp-actions"><button type="button" id="rcGuardar" class="dlg-submit">Guardar cambios</button><p id="rcMsg" class="dlg-msg" role="status"></p></div>';

  function aviso(t, error) { $('rcMsg').textContent = t || ''; $('rcMsg').style.color = error ? '#9A3B2E' : ''; }
  function pintar() {
    var editar = esSuper() && !faltaSql;
    $('rcSoloSuper').hidden = esSuper();
    $('rcGuardar').hidden = !editar;
    $('rcBody').innerHTML = PLANES.map(function (n) {
      var f = filas.filter(function (x) { return x.cuotas === n; })[0], c = calcular(1000, n);
      var celda = editar && n !== 1
        ? '<input type="number" min="0" max="100" step="0.01" class="adm-input" data-rc="' + n + '" value="' + Number(porc[n] || 0).toFixed(2) + '" style="width:110px;text-align:right" aria-label="% recargo para ' + n + ' cuotas">'
        : pctTxt(porc[n] || 0);
      return '<tr><td><strong>' + (n === 1 ? '1 pago (sin cuotas)' : n + ' cuotas') + '</strong></td><td class="num">' + celda + '</td>' +
        '<td class="num">' + (n === 1 ? q(1000) : n + ' × ' + q(c.cuota) + ' = <strong>' + q(c.total) + '</strong>') + '</td>' +
        '<td class="fecha">' + (f ? fechaHora(f.actualizado) + (f.actualizado_por ? '<br><span class="hi-desc">por ' + esc(f.actualizado_por) + '</span>' : '') : '—') + '</td></tr>';
    }).join('');
    if (faltaSql) aviso('Falta ejecutar en Supabase el script actualizado (supabase.sql). Mientras tanto se usan los valores de referencia.', true);
  }
  $('rcBody').addEventListener('input', function (e) {
    var i = e.target.closest('[data-rc]');
    if (!i) return;
    var v = Number(i.value);
    if (!isNaN(v) && v >= 0 && v <= 100) { porc[i.dataset.rc] = v; var c = calcular(1000, +i.dataset.rc); i.closest('tr').cells[2].innerHTML = i.dataset.rc + ' × ' + q(c.cuota) + ' = <strong>' + q(c.total) + '</strong>'; }
  });
  $('rcGuardar').addEventListener('click', async function () {
    if (!esSuper()) { aviso('Solo el Super Administrador puede cambiar los porcentajes.', true); return; }
    var cambios = [];
    var malo = null;
    panel.querySelectorAll('[data-rc]').forEach(function (i) {
      var n = +i.dataset.rc, v = Number(i.value), antes = filas.filter(function (x) { return x.cuotas === n; })[0];
      if (i.value === '' || isNaN(v) || v < 0 || v > 100) { malo = malo || i; return; }
      if (!antes || r2(antes.porcentaje) !== r2(v)) cambios.push({ n: n, v: r2(v) });
    });
    if (malo) { aviso('Cada porcentaje debe estar entre 0 y 100.', true); malo.focus(); return; }
    if (!cambios.length) { aviso('No hay cambios que guardar.'); return; }
    this.disabled = true; aviso('Guardando…');
    for (var k = 0; k < cambios.length; k++) {
      var r = await sb.from('recargos_cuotas').update({ porcentaje: cambios[k].v }).eq('cuotas', cambios[k].n).select('cuotas');
      if (r.error || !r.data || !r.data.length) { this.disabled = false; aviso(r.error ? r.error.message : 'No tienes permiso para esta acción.', true); return; }
    }
    this.disabled = false;
    await cargar(true);
    pintar();
    aviso(cambios.length === 1 ? 'Se guardó el recargo de ' + cambios[0].n + ' cuotas.' : 'Se guardaron ' + cambios.length + ' recargos.');
  });

  var tab = $('tabRecargos');
  if (tab) tab.addEventListener('click', function () { cargar(true).then(pintar); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { cargar(true).then(pintar); },
    limpiar: function () { filas = []; porc = Object.assign({}, REFERENCIA); cargado = null; $('rcBody').innerHTML = ''; aviso(''); }
  });
})();
