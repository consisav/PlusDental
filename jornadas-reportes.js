// Plus Dental — Jornadas › Reportes: 1. Pacientes atendidos (listado con procedimientos, por jornada) y
// 2. Gráfica de atención (pacientes por procedimiento, sexo, edad y jornada). Ambos se imprimen con firmas
// para entregarlos a la institución; el listado también se exporta a Excel.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admJorRepPacientes') || !document.getElementById('admJorRepGrafica')) return;

  var instituciones = [], sucursales = [], jornadas = [], jPacientes = [], jProcs = [], dentistas = [], cargado = false;
  var ESTADOS = { planificada: 'Planificada', realizada: 'Realizada', cerrada: 'Cerrada', cancelada: 'Cancelada' };
  var EDADES = [['0 a 5', 0, 5], ['6 a 12', 6, 12], ['13 a 17', 13, 17], ['18 a 59', 18, 59], ['60 o más', 60, 200]];
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n, d) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function cod(p, x) { return p + '-' + ('00' + (x.numero || x.id)).slice(-3); }
  function usuario() { return (window.PD_SESION && window.PD_SESION.usuario && window.PD_SESION.usuario()) || ''; }
  function aviso(id, t, error) { $(id).textContent = t || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function traducir(e) { var m = (e && e.message) || ''; return /jor_|could not find/i.test(m) ? 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para Jornadas.' : window.PD_GEO ? window.PD_GEO.traducir(e) : m; }
  async function todas(armar) {
    var l = [], desde = 0;
    for (;;) { var r = await armar().range(desde, desde + 999); if (r.error) throw r.error; l = l.concat(r.data); if (r.data.length < 1000) return l; desde += 1000; }
  }
  function campo(etq, html) { return '<label class="ic-campo"><span>' + etq + '</span>' + html + '</label>'; }
  function medicosDe(j) { var l = j.medicos && j.medicos.length ? j.medicos : j.dentista_id ? [j.dentista_id] : []; return l.map(function (id) { var d = porId(dentistas, id); return d ? d.nombre : ''; }).filter(Boolean); }

  // ---------- Pantallas (mismos parámetros en ambos reportes) ----------
  function filtros(p) {
    var mes = hoy().slice(0, 8) + '01';
    return '<section class="geo-panel ic-consulta"><div class="ik-titulo"><h4>Parámetros</h4><span id="' + p + 'Cuenta"></span></div>' +
      '<div class="jr-filtros">' + campo('Institución', '<select id="' + p + 'Inst"></select>') + campo('Sucursal', '<select id="' + p + 'Suc"></select>') +
      campo('Jornada', '<select id="' + p + 'Jor"></select>') +
      campo('Fecha inicial', '<input id="' + p + 'Desde" type="date" value="' + mes + '">') + campo('Fecha final', '<input id="' + p + 'Hasta" type="date" value="' + hoy() + '">') +
      campo('Estado', '<select id="' + p + 'Est"><option value="atendidas">Realizadas y cerradas</option><option value="">Todas (sin canceladas)</option><option value="planificada">Planificadas</option></select>') +
      '<button type="button" id="' + p + 'Ejecutar" class="adm-btn adm-primary jr-ejecutar">Ejecutar</button></div></section>';
  }
  $('admJorRepPacientes').innerHTML = '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Reporte de pacientes atendidos</h3>' +
    '<span class="jr-acc"><button type="button" id="jrpImprimir" class="adm-btn" disabled>Imprimir / PDF</button><button type="button" id="jrpExcel" class="adm-btn" disabled>Exportar Excel</button></span></div>' +
    filtros('jrp') + '<div id="jrpKpis" class="jr-kpis"></div><div class="roles-wrap ia-wrap"><table class="geo-tabla jr-tabla"><colgroup><col class="jr-c-n"><col><col class="jr-c-ed"><col class="jr-c-sx"><col class="jr-c-ref"><col><col class="jr-c-pz"><col class="jr-c-cant"><col class="jr-c-q"><col class="jr-c-q"></colgroup>' +
    '<thead><tr><th>#</th><th>Paciente</th><th class="num">Edad</th><th>Sexo</th><th>Grado / referencia</th><th>Procedimiento</th><th>Pieza</th><th class="num">Cant.</th><th class="num">Precio inst.</th><th class="num">Subtotal</th></tr></thead>' +
    '<tbody id="jrpLista"><tr><td colspan="10" class="geo-vacia">Elige los parámetros y presiona «Ejecutar».</td></tr></tbody></table></div><p id="jrpMsg" class="dlg-msg" role="status"></p></div>';
  $('admJorRepGrafica').innerHTML = '<div class="adm-pane"><div class="adm-pane-head"><h3 class="adm-h">Gráfica de atención</h3>' +
    '<span class="jr-acc"><button type="button" id="jrgImprimir" class="adm-btn" disabled>Imprimir / PDF</button></span></div>' +
    filtros('jrg') + '<div id="jrgCuerpo" class="jr-graf"><p class="geo-vacia">Elige los parámetros y presiona «Ejecutar».</p></div><p id="jrgMsg" class="dlg-msg" role="status"></p></div>';

  function opciones(p) {
    var fi = $(p + 'Inst').value, fs = $(p + 'Suc').value, fj = $(p + 'Jor').value;
    $(p + 'Inst').innerHTML = '<option value="">Todas las instituciones</option>' + instituciones.map(function (i) { return '<option value="' + i.id + '">' + esc(cod('INS', i) + ' · ' + i.nombre) + '</option>'; }).join('');
    $(p + 'Inst').value = fi && porId(instituciones, +fi) ? fi : '';
    var inst = +$(p + 'Inst').value || null, ls = inst ? sucursales.filter(function (x) { return x.institucion_id === inst; }) : [];
    $(p + 'Suc').innerHTML = '<option value="">' + (inst ? 'Todas las sucursales' : 'Elige la institución') + '</option>' + ls.map(function (x) { return '<option value="' + x.id + '">' + esc(cod('SUC', x) + ' · ' + x.nombre) + '</option>'; }).join('');
    $(p + 'Suc').value = fs && ls.some(function (x) { return String(x.id) === fs; }) ? fs : '';
    $(p + 'Suc').disabled = !inst;
    var lj = jornadas.filter(function (j) { return (!inst || j.institucion_id === inst) && j.estado !== 'cancelada'; });
    $(p + 'Jor').innerHTML = '<option value="">Todas las jornadas</option>' + lj.map(function (j) { var i = porId(instituciones, j.institucion_id); return '<option value="' + j.id + '">N.º ' + j.numero + ' · ' + fecha(j.fecha) + ' · ' + esc(i ? i.nombre : '') + '</option>'; }).join('');
    $(p + 'Jor').value = fj && lj.some(function (j) { return String(j.id) === fj; }) ? fj : '';
  }
  async function cargar(p) {
    try {
      var r = await Promise.all([
        todas(function () { return sb.from('jor_instituciones').select('id,numero,nombre,responsable,cargo,telefono').order('nombre'); }),
        todas(function () { return sb.from('jor_sucursales').select('id,numero,institucion_id,nombre').order('nombre'); }),
        todas(function () { return sb.from('jor_jornadas').select('*').order('fecha', { ascending: false }); }),
        todas(function () { return sb.from('jor_pacientes').select('id,jornada_id,orden,nombre,edad,sexo,referencia'); }),
        todas(function () { return sb.from('jor_procedimientos').select('id,paciente_id,orden,descripcion,pieza,cantidad,precio'); }),
        todas(function () { return sb.from('dentistas').select('id,nombre').order('nombre'); })
      ]);
      instituciones = r[0]; sucursales = r[1]; jornadas = r[2]; jPacientes = r[3]; jProcs = r[4]; dentistas = r[5]; cargado = true;
      aviso(p + 'Msg', '');
    } catch (e) { aviso(p + 'Msg', traducir(e), true); }
    opciones('jrp'); opciones('jrg');
  }

  // ---------- Datos según los parámetros ----------
  function datos(p) {
    var inst = +$(p + 'Inst').value || null, suc = +$(p + 'Suc').value || null, jor = +$(p + 'Jor').value || null, d = $(p + 'Desde').value, h = $(p + 'Hasta').value, est = $(p + 'Est').value;
    var lj = jornadas.filter(function (j) {
      if (j.estado === 'cancelada') return false;
      if (est === 'atendidas' ? ['realizada', 'cerrada'].indexOf(j.estado) < 0 : est && j.estado !== est) return false;
      return (!inst || j.institucion_id === inst) && (!suc || j.sucursal_id === suc) && (!jor || j.id === jor) && (!d || j.fecha >= d) && (!h || j.fecha <= h);
    }).sort(function (a, b) { return a.fecha.localeCompare(b.fecha) || a.numero - b.numero; });
    return lj.map(function (j) {
      var ps = jPacientes.filter(function (x) { return x.jornada_id === j.id; }).sort(function (a, b) { return a.orden - b.orden; }).map(function (x) {
        return { p: x, procs: jProcs.filter(function (y) { return y.paciente_id === x.id; }).sort(function (a, b) { return a.orden - b.orden; }) };
      });
      return { j: j, inst: porId(instituciones, j.institucion_id) || {}, suc: porId(sucursales, j.sucursal_id), pacientes: ps };
    });
  }
  function totales(g) {
    var t = { jornadas: g.length, pacientes: 0, procs: 0, q: 0 };
    g.forEach(function (x) { t.pacientes += x.pacientes.length; x.pacientes.forEach(function (y) { y.procs.forEach(function (z) { t.procs += Number(z.cantidad); t.q += z.cantidad * Number(z.precio); }); }); });
    return t;
  }
  function textoParametros(p) {
    function t(id) { var s = $(id); return s.selectedOptions && s.selectedOptions[0] ? s.selectedOptions[0].text : ''; }
    return [t(p + 'Inst'), $(p + 'Suc').value ? t(p + 'Suc') : '', 'del ' + fecha($(p + 'Desde').value) + ' al ' + fecha($(p + 'Hasta').value), $(p + 'Jor').value ? 'Jornada ' + t(p + 'Jor').split(' · ')[0] : '', t(p + 'Est')].filter(Boolean).join(' · ');
  }
  function kpis(t) {
    return [['Jornadas', num(t.jornadas, 0)], ['Pacientes atendidos', num(t.pacientes, 0)], ['Procedimientos', num(t.procs, 0)], ['Total institucional', 'Q' + num(t.q)],
      ['Procedimientos por paciente', t.pacientes ? num(t.procs / t.pacientes, 1) : '0']];
  }
  function encabezadoJornada(x) {
    var meds = medicosDe(x.j);
    return 'Jornada N.º ' + x.j.numero + ' · ' + fecha(x.j.fecha) + ' · ' + (x.inst.nombre || '') + (x.suc ? ' · ' + cod('SUC', x.suc) + ' ' + x.suc.nombre : '') +
      (x.j.lugar ? ' · ' + x.j.lugar : '') + (meds.length ? ' · Médicos: ' + meds.join(', ') : '') + ' · ' + (ESTADOS[x.j.estado] || x.j.estado);
  }

  // ---------- 1. Listado de pacientes atendidos ----------
  var ultimoP = null;
  function ejecutarListado() {
    var g = datos('jrp'), t = totales(g), html = '';
    ultimoP = { g: g, t: t, param: textoParametros('jrp') };
    g.forEach(function (x) {
      var sub = 0, subP = 0;
      html += '<tr class="jr-grupo"><td colspan="10">' + esc(encabezadoJornada(x)) + '</td></tr>';
      x.pacientes.forEach(function (y, i) {
        var filas = y.procs.length ? y.procs : [null];
        filas.forEach(function (z, k) {
          var st = z ? z.cantidad * Number(z.precio) : 0; sub += st; subP += z ? Number(z.cantidad) : 0;
          html += '<tr><td class="ik-cod">' + (k ? '' : i + 1) + '</td><td>' + (k ? '' : '<b class="ia-corto" title="' + esc(y.p.nombre) + '">' + esc(y.p.nombre) + '</b>') + '</td>' +
            '<td class="num">' + (k || y.p.edad == null ? '' : y.p.edad) + '</td><td>' + (k ? '' : esc(y.p.sexo || '—')) + '</td><td><span class="ia-corto">' + (k ? '' : esc(y.p.referencia || '—')) + '</span></td>' +
            '<td><span class="ia-corto" title="' + esc(z ? z.descripcion : '') + '">' + esc(z ? z.descripcion : 'Sin procedimientos') + '</span></td><td>' + esc(z && z.pieza || '—') + '</td>' +
            '<td class="num">' + (z ? z.cantidad : '') + '</td><td class="num">' + (z ? num(z.precio) : '') + '</td><td class="num"><b>' + (z ? num(st) : '') + '</b></td></tr>';
        });
      });
      html += '<tr class="jr-sub"><td></td><td colspan="6">Subtotal jornada N.º ' + x.j.numero + ' · ' + x.pacientes.length + ' paciente' + (x.pacientes.length === 1 ? '' : 's') + '</td><td class="num">' + subP + '</td><td></td><td class="num"><b>' + num(sub) + '</b></td></tr>';
    });
    $('jrpLista').innerHTML = html ? html + '<tr class="jr-total"><td></td><td colspan="6">Total · ' + t.jornadas + ' jornada' + (t.jornadas === 1 ? '' : 's') + ' · ' + t.pacientes + ' pacientes</td><td class="num">' + t.procs + '</td><td></td><td class="num"><b>Q' + num(t.q) + '</b></td></tr>'
      : '<tr><td colspan="10" class="geo-vacia">No hay jornadas con esos parámetros.</td></tr>';
    $('jrpKpis').innerHTML = kpis(t).map(function (k) { return '<div class="jr-kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b></div>'; }).join('');
    $('jrpCuenta').textContent = ultimoP.param;
    $('jrpImprimir').disabled = $('jrpExcel').disabled = !g.length;
  }
  function firmas() {
    return '<div style="display:flex;gap:40px;margin-top:46px;font-size:11px"><div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Odontólogo responsable · Plus Dental</div>' +
      '<div style="flex:1;border-top:1px solid #0B2B40;padding-top:4px;text-align:center">Responsable de la institución · firma y sello</div></div>' +
      '<p style="font-size:9px;color:#5A6D7A;margin-top:14px;text-align:right">Generado por ' + esc(usuario() || '—') + ' · ' + new Date().toLocaleString('es-GT', { hour12: false }) + '</p></div>';
  }
  function cajaKpis(t, param) {
    return '<p style="font-size:12px;margin:0 0 8px"><b>Parámetros:</b> ' + esc(param) + '</p><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px">' +
      kpis(t).map(function (k) { return '<div style="border:1px solid #D9E4EC;border-radius:8px;padding:6px 8px"><span style="display:block;font-size:9px;color:#5A6D7A;text-transform:uppercase">' + k[0] + '</span><b style="font-size:14px">' + k[1] + '</b></div>'; }).join('') + '</div>';
  }
  function imprimirListado() {
    if (!ultimoP || !window.PD_IMPRESION) return;
    var P = window.PD_IMPRESION, th = 'padding:5px 4px;border-bottom:2px solid #0B2B40;text-align:left;font-size:9px;text-transform:uppercase;color:#475B68', td = 'padding:4px;border-bottom:1px solid #E3EAF0;font-size:10.5px', filas = '';
    ultimoP.g.forEach(function (x) {
      var sub = 0;
      filas += '<tr><td colspan="9" style="' + td + ';background:#EEF5FA;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact">' + esc(encabezadoJornada(x)) + '</td></tr>';
      x.pacientes.forEach(function (y, i) {
        (y.procs.length ? y.procs : [null]).forEach(function (z, k) {
          var st = z ? z.cantidad * Number(z.precio) : 0; sub += st;
          filas += '<tr><td style="' + td + '">' + (k ? '' : i + 1) + '</td><td style="' + td + '">' + (k ? '' : '<b>' + esc(y.p.nombre) + '</b>') + '</td><td style="' + td + ';text-align:right">' + (k || y.p.edad == null ? '' : y.p.edad) + '</td><td style="' + td + '">' + (k ? '' : esc(y.p.sexo || '')) + '</td>' +
            '<td style="' + td + '">' + (k ? '' : esc(y.p.referencia || '')) + '</td><td style="' + td + '">' + esc(z ? z.descripcion : 'Sin procedimientos') + (z && z.pieza ? ' · pieza ' + esc(z.pieza) : '') + '</td>' +
            '<td style="' + td + ';text-align:right">' + (z ? z.cantidad : '') + '</td><td style="' + td + ';text-align:right">' + (z ? num(z.precio) : '') + '</td><td style="' + td + ';text-align:right">' + (z ? num(st) : '') + '</td></tr>';
        });
      });
      filas += '<tr><td colspan="8" style="' + td + ';font-weight:700;text-align:right">Subtotal jornada N.º ' + x.j.numero + ' · ' + x.pacientes.length + ' pacientes</td><td style="' + td + ';text-align:right;font-weight:700">' + num(sub) + '</td></tr>';
    });
    P.imprimir(P.encabezado('Reporte de pacientes atendidos') + cajaKpis(ultimoP.t, ultimoP.param) +
      '<table style="width:100%;border-collapse:collapse"><thead><tr>' + ['#', 'Paciente', 'Edad', 'Sexo', 'Grado / ref.', 'Procedimiento', 'Cant.', 'Precio', 'Subtotal Q'].map(function (h, i) { return '<th style="' + th + (i === 2 || i > 5 ? ';text-align:right' : '') + '">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + filas + '</tbody></table>' +
      '<p style="text-align:right;font-size:13px;margin-top:8px"><b>Total institucional Q ' + num(ultimoP.t.q) + '</b> · ' + ultimoP.t.pacientes + ' pacientes · ' + ultimoP.t.procs + ' procedimientos</p>' + firmas());
  }
  function cargarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, mal) { var s = document.createElement('script'); s.src = XLSX_URL; s.onload = function () { ok(window.XLSX); }; s.onerror = function () { mal(new Error('No se pudo cargar el generador de Excel. Revisa tu conexión.')); }; document.head.appendChild(s); });
  }
  async function exportarListado() {
    if (!ultimoP) return;
    try {
      var X = await cargarXlsx(), filas = [['Jornada', 'Fecha', 'Institución', 'Sucursal', 'Lugar', 'Médicos', 'Estado', 'N.º paciente', 'Paciente', 'Edad', 'Sexo', 'Grado / referencia', 'Procedimiento', 'Pieza', 'Cantidad', 'Precio institucional', 'Subtotal']];
      ultimoP.g.forEach(function (x) {
        x.pacientes.forEach(function (y, i) {
          (y.procs.length ? y.procs : [null]).forEach(function (z) {
            filas.push([x.j.numero, fecha(x.j.fecha), x.inst.nombre || '', x.suc ? x.suc.nombre : '', x.j.lugar || '', medicosDe(x.j).join(', '), ESTADOS[x.j.estado] || x.j.estado, i + 1, y.p.nombre, y.p.edad, y.p.sexo || '', y.p.referencia || '',
              z ? z.descripcion : '', z ? z.pieza || '' : '', z ? z.cantidad : 0, z ? Number(z.precio) : 0, z ? z.cantidad * Number(z.precio) : 0]);
          });
        });
      });
      var ws = X.utils.aoa_to_sheet(filas), wb = X.utils.book_new();
      ws['!cols'] = [6, 11, 24, 30, 24, 28, 11, 8, 30, 6, 6, 16, 30, 8, 9, 12, 11].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, ws, 'Pacientes atendidos');
      X.writeFile(wb, 'pacientes-atendidos-jornadas-' + hoy() + '.xlsx');
    } catch (e) { aviso('jrpMsg', e.message, true); }
  }

  // ---------- 2. Gráfica de atención ----------
  var ultimoG = null;
  function barras(lista, color, sufijo) {
    var max = Math.max.apply(null, lista.map(function (x) { return x[1]; }).concat([1]));
    return '<div class="jr-barras">' + lista.map(function (x) {
      return '<div class="jr-b-fila"><span class="jr-b-etq" title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><span class="jr-b-pista"><i style="width:' + Math.max(2, Math.round(x[1] / max * 100)) + '%;background:' + color + '"></i></span><b>' + num(x[1], 0) + '</b>' + (sufijo ? '<small>' + sufijo(x) + '</small>' : '<small></small>') + '</div>';
    }).join('') + '</div>';
  }
  function analizar(g) {
    var porProc = {}, sexo = { F: 0, M: 0, '': 0 }, edades = EDADES.map(function (e) { return [e[0], 0]; }).concat([['Sin dato', 0]]), porJor = [];
    g.forEach(function (x) {
      porJor.push(['N.º ' + x.j.numero + ' · ' + fecha(x.j.fecha) + ' · ' + (x.inst.nombre || ''), x.pacientes.length]);
      x.pacientes.forEach(function (y) {
        sexo[y.p.sexo === 'F' || y.p.sexo === 'M' ? y.p.sexo : '']++;
        var k = y.p.edad == null ? EDADES.length : EDADES.findIndex(function (e) { return y.p.edad >= e[1] && y.p.edad <= e[2]; });
        edades[k < 0 ? EDADES.length : k][1]++;
        var vistos = {};
        y.procs.forEach(function (z) {
          var n = z.descripcion, o = porProc[n] || (porProc[n] = { nombre: n, pacientes: 0, cantidad: 0, q: 0 });
          if (!vistos[n]) { o.pacientes++; vistos[n] = 1; }
          o.cantidad += Number(z.cantidad); o.q += z.cantidad * Number(z.precio);
        });
      });
    });
    return { procs: Object.keys(porProc).map(function (k) { return porProc[k]; }).sort(function (a, b) { return b.pacientes - a.pacientes || b.cantidad - a.cantidad; }), sexo: sexo, edades: edades, porJor: porJor };
  }
  function htmlGrafica(t, a, imprimir) {
    var tot = t.pacientes || 1, pf = Math.round(a.sexo.F / tot * 100), pm = Math.round(a.sexo.M / tot * 100);
    var colorAdj = '-webkit-print-color-adjust:exact;print-color-adjust:exact;';
    var tabla = '<table class="jr-resumen"' + (imprimir ? ' style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px"' : '') + '><thead><tr><th>Procedimiento</th><th class="num">Pacientes</th><th class="num">Cantidad</th><th class="num">% de pacientes</th><th class="num">Total Q</th></tr></thead><tbody>' +
      a.procs.map(function (p) { return '<tr><td>' + esc(p.nombre) + '</td><td class="num">' + p.pacientes + '</td><td class="num">' + p.cantidad + '</td><td class="num">' + num(p.pacientes / tot * 100, 1) + ' %</td><td class="num">' + num(p.q) + '</td></tr>'; }).join('') +
      '<tr class="jr-total"><td><b>Total</b></td><td class="num"><b>' + t.pacientes + '</b></td><td class="num"><b>' + t.procs + '</b></td><td></td><td class="num"><b>' + num(t.q) + '</b></td></tr></tbody></table>';
    return '<div class="jr-graf-g">' +
      '<section class="jr-card jr-ancha"><h5>Pacientes atendidos por procedimiento</h5>' + (a.procs.length ? barras(a.procs.map(function (p) { return [p.nombre, p.pacientes, p.cantidad]; }), '#2F78C4', function (x) { return x[2] + ' proc.'; }) : '<p class="geo-vacia">Sin procedimientos.</p>') + '</section>' +
      '<section class="jr-card"><h5>Pacientes por sexo</h5><div class="jr-sexo" style="' + colorAdj + '"><i style="width:' + pf + '%;background:#D4537E"></i><i style="width:' + pm + '%;background:#185FA5"></i><i style="width:' + Math.max(0, 100 - pf - pm) + '%;background:#B4B2A9"></i></div>' +
        '<p class="jr-ley"><span><i style="background:#D4537E"></i>Femenino ' + a.sexo.F + ' (' + pf + ' %)</span><span><i style="background:#185FA5"></i>Masculino ' + a.sexo.M + ' (' + pm + ' %)</span>' + (a.sexo[''] ? '<span><i style="background:#B4B2A9"></i>Sin dato ' + a.sexo[''] + '</span>' : '') + '</p></section>' +
      '<section class="jr-card"><h5>Pacientes por rango de edad</h5>' + barras(a.edades.filter(function (e) { return e[1] || e[0] !== 'Sin dato'; }), '#1D9E75') + '</section>' +
      '<section class="jr-card jr-ancha"><h5>Pacientes por jornada</h5>' + (a.porJor.length ? barras(a.porJor, '#0B2B40') : '') + '</section>' +
      '<section class="jr-card jr-ancha"><h5>Resumen por procedimiento</h5>' + tabla + '</section></div>';
  }
  function ejecutarGrafica() {
    var g = datos('jrg'), t = totales(g), a = analizar(g);
    ultimoG = { t: t, a: a, param: textoParametros('jrg') };
    $('jrgCuenta').textContent = ultimoG.param;
    $('jrgCuerpo').innerHTML = g.length ? '<div class="jr-kpis">' + kpis(t).map(function (k) { return '<div class="jr-kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b></div>'; }).join('') + '</div>' + htmlGrafica(t, a)
      : '<p class="geo-vacia">No hay jornadas con esos parámetros.</p>';
    $('jrgImprimir').disabled = !g.length;
  }
  function imprimirGrafica() {
    if (!ultimoG || !window.PD_IMPRESION) return;
    var P = window.PD_IMPRESION;
    // Estilos de la hoja impresa, solo dentro de #impresion (no alteran la pantalla)
    var css = '<style>#impresion .jr-graf-g{display:grid;grid-template-columns:1fr 1fr;gap:10px}#impresion .jr-card{border:1px solid #D9E4EC;border-radius:10px;padding:8px 10px;break-inside:avoid}#impresion .jr-ancha{grid-column:1/-1}#impresion .jr-card h5{margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#475B68}' +
      '#impresion .jr-b-fila{display:grid;grid-template-columns:150px 1fr 34px 50px;gap:6px;align-items:center;font-size:10.5px;margin:3px 0}#impresion .jr-b-etq{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}#impresion .jr-b-pista{height:10px;background:#EEF2F5;border-radius:3px;display:block}#impresion .jr-b-pista i{display:block;height:10px;border-radius:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}#impresion .jr-b-fila small{color:#5A6D7A;font-size:9px}' +
      '#impresion .jr-sexo{display:flex;height:12px;border-radius:4px;overflow:hidden}#impresion .jr-sexo i{display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact}#impresion .jr-ley{display:flex;flex-wrap:wrap;gap:10px;font-size:10.5px}#impresion .jr-ley i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '#impresion .jr-resumen th,#impresion .jr-resumen td{padding:4px;border-bottom:1px solid #E3EAF0;text-align:left}#impresion .jr-resumen .num{text-align:right}</style>';
    P.imprimir(P.encabezado('Gráfica de atención · jornadas dentales') + css + cajaKpis(ultimoG.t, ultimoG.param) + htmlGrafica(ultimoG.t, ultimoG.a, true) + firmas());
  }

  // ---------- Eventos ----------
  ['jrp', 'jrg'].forEach(function (p) {
    $(p + 'Inst').addEventListener('change', function () { $(p + 'Suc').value = ''; $(p + 'Jor').value = ''; opciones(p); });
    $(p + 'Ejecutar').addEventListener('click', async function () { await cargar(p); if (p === 'jrp') ejecutarListado(); else ejecutarGrafica(); });
  });
  $('jrpImprimir').addEventListener('click', imprimirListado);
  $('jrpExcel').addEventListener('click', exportarListado);
  $('jrgImprimir').addEventListener('click', imprimirGrafica);
  var PANELES = { admJorRepPacientes: 'jrp', admJorRepGrafica: 'jrg' };
  Object.keys(PANELES).forEach(function (id) { var tab = document.querySelector('[data-tab="' + id + '"]'); if (tab) tab.addEventListener('click', function () { setTimeout(function () { if (!cargado) cargar(PANELES[id]); }, 0); }); });
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { Object.keys(PANELES).forEach(function (id) { if (!$(id).hidden) cargar(PANELES[id]); }); },
    limpiar: function () { instituciones = []; sucursales = []; jornadas = []; jPacientes = []; jProcs = []; dentistas = []; cargado = false; ultimoP = ultimoG = null; }
  });
})();
