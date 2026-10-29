// Plus Dental — Reportes: listado de pacientes, estados de cuenta, citas agendadas y cobros por paciente
// (las comisiones están en comisiones.js). Parámetros: fecha inicial y final; estados con colores (se pueden filtrar).
// Cada reporte se puede imprimir o exportar a Excel (CSV). Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admRepPacientes')) return;

  var CLINICA = { nombre: 'Plus Dental', direccion: 'Reforma Montúfar, zona 10, Nivel 9, Oficina 910, Ciudad de Guatemala', telefono: '+502 3756-5739' };
  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito' };

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function inicioMes() { var d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function q(n) { n = Number(n) || 0; return (n < -0.004 ? '-Q' : 'Q') + Math.abs(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
  function num(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  // Inicio y fin del día en hora local (para campos con fecha y hora)
  function desdeHora(f) { return new Date(f + 'T00:00:00').toISOString(); }
  function hastaHora(f) { return new Date(f + 'T23:59:59.999').toISOString(); }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/does not exist|could not find|schema cache/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql).';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para ver este reporte.';
    return m || 'No se pudo generar el reporte.';
  }

  var TIPOS_CLIENTE = { directo: 'Cliente directo', institucional: 'Institucional', vip: 'VIP', referido: 'Referido', paquete: 'Paquete', especial: 'Especial' };
  function bancario(f) { return f.metodo === 'transferencia' || f.metodo === 'deposito'; }

  // ---------- Definición de los reportes ----------
  var REPORTES = {
    pacientes: {
      panel: 'admRepPacientes', titulo: 'Listado de pacientes', medicoInst: true, instSuc: true,
      nota: 'Pacientes registrados entre las dos fechas; se puede filtrar por odontólogo asignado, institución y sucursal.',
      estados: { activo: ['Activo', 'verde'], suspendido: ['Suspendido', 'ambar'], inactivo: ['Inactivo', 'gris'], baja: ['Baja', 'rojo'] },
      columnas: [
        ['Registro', function (f) { return fechaCorta(f.creado); }],
        ['Paciente', function (f) { return f.nombre; }],
        ['DPI', function (f) { return f.dpi || '—'; }],
        ['Teléfono', function (f) { return f.telefono || '—'; }],
        ['Correo', function (f) { return f.correo || '—'; }],
        ['Médico asignado', function (f) { return f.medico ? f.medico.nombre : '—'; }],
        ['Agente comercial', function (f) { return f.agente ? f.agente.codigo + ' · ' + f.agente.nombre : '—'; }],
        ['Tipo de cliente', function (f) { return TIPOS_CLIENTE[f.tipo_cliente] || 'Cliente directo'; }],
        ['Institución · sucursal', function (f) { return f.tipo_cliente === 'institucional' && f.institucion ? f.institucion.nombre + (f.sucursal ? ' · ' + f.sucursal.nombre : '') : '—'; }]
      ],
      cargar: async function (d, h, o) {
        var campos = 'id,nombre,dpi,telefono,correo,creado,estado,medico:dentistas(nombre),agente:agentes(codigo,nombre)';
        // Filtros: odontólogo asignado e institución (vacío = todos)
        function filtrar(x, conInst) { x = x.gte('creado', desdeHora(d)).lte('creado', hastaHora(h)).order('creado'); if (o && o.medico) x = x.eq('dentista_id', +o.medico); if (conInst && o && o.inst) x = x.eq('institucion_id', +o.inst); if (conInst && o && o.suc) x = x.eq('sucursal_id', +o.suc); return x; }
        var r = await filtrar(sb.from('pacientes').select(campos + ',tipo_cliente,institucion:jor_instituciones(nombre),sucursal:jor_sucursales(nombre)'), true);
        // Sin el SQL de pacientes institucionales: el listado sale sin institución ni sucursal
        if (r.error && /institucion|sucursal|tipo_cliente|jor_/i.test(r.error.message || '')) r = await filtrar(sb.from('pacientes').select(campos), false);
        if (r.error) throw r.error;
        return r.data;
      },
      totales: function (filas) { return [['Pacientes', filas.length]]; }
    },

    cuentas: {
      panel: 'admRepCuentas', titulo: 'Estados de cuenta', instSuc: true,
      nota: 'Saldo de cada paciente al inicio y al final del período, con los cargos (tratamientos realizados) y pagos entre las dos fechas; de una institución y sucursal o de todas.',
      estados: { pendiente: ['Saldo pendiente', 'ambar'], aldia: ['Al día', 'verde'], favor: ['Saldo a favor', 'azul'] },
      columnas: [
        ['Paciente', function (f) { return f.nombre; }],
        ['Teléfono', function (f) { return f.telefono || '—'; }],
        ['Saldo anterior', function (f) { return f.anterior; }, 'q'],
        ['Cargos', function (f) { return f.cargos; }, 'q'],
        ['Pagos', function (f) { return f.abonos; }, 'q'],
        ['Saldo final', function (f) { return f.final; }, 'q']
      ],
      cargar: async function (d, h, o) {
        var r = await Promise.all([
          sb.from('movimientos_cuenta').select('fecha,paciente_id,cargo,abono').lte('fecha', h),
          sb.from('pacientes').select('id,nombre,telefono,institucion_id,sucursal_id')
        ]);
        if (r[1].error && /institucion_id|sucursal_id/.test(r[1].error.message || '')) {
          if (o && (o.inst || o.suc)) throw new Error('Falta ejecutar en Supabase el script actualizado (supabase.sql) para filtrar por institución o sucursal.');
          r[1] = await sb.from('pacientes').select('id,nombre,telefono');
        }
        if (r[0].error) throw r[0].error;
        if (r[1].error) throw r[1].error;
        var pac = {};
        r[1].data.filter(function (p) { return (!(o && o.inst) || String(p.institucion_id) === String(o.inst)) && (!(o && o.suc) || String(p.sucursal_id) === String(o.suc)); }).forEach(function (p) { pac[p.id] = { nombre: p.nombre, telefono: p.telefono, anterior: 0, cargos: 0, abonos: 0, mov: 0 }; });
        r[0].data.forEach(function (m) {
          var p = pac[m.paciente_id]; if (!p) return;
          var f = String(m.fecha).slice(0, 10), c = Number(m.cargo) || 0, a = Number(m.abono) || 0;
          if (f < d) p.anterior += c - a;
          else { p.cargos += c; p.abonos += a; p.mov++; }
        });
        return Object.keys(pac).map(function (k) {
          var p = pac[k];
          p.anterior = num(p.anterior); p.cargos = num(p.cargos); p.abonos = num(p.abonos);
          p.final = num(p.anterior + p.cargos - p.abonos);
          p.estado = p.final > 0.004 ? 'pendiente' : p.final < -0.004 ? 'favor' : 'aldia';
          return p;
        }).filter(function (p) { return p.mov > 0 || Math.abs(p.anterior) > 0.004; })
          .sort(function (a, b) { return b.final - a.final || a.nombre.localeCompare(b.nombre); });
      },
      totales: function (filas) {
        var s = function (k) { return filas.reduce(function (t, f) { return t + f[k]; }, 0); };
        return [['Pacientes', filas.length], ['Cargos', q(s('cargos'))], ['Pagos', q(s('abonos'))], ['Saldo final', q(s('final'))]];
      },
      sumar: ['anterior', 'cargos', 'abonos', 'final']
    },

    citas: {
      panel: 'admRepCitas', titulo: 'Citas agendadas', medicoInst: true, instSuc: true,
      nota: 'Citas con fecha entre las dos fechas; de un odontólogo o de todos, y de pacientes de una institución y sucursal o de todas.',
      estados: { pendiente: ['Programado', 'ambar'], confirmada: ['Confirmado', 'verde'], reprogramada: ['Reprogramado', 'azul'], atendida: ['Atendido', 'azul'], cancelada: ['Cancelado', 'gris'] },
      columnas: [
        ['Fecha', function (f) { return fechaCorta(f.fecha); }],
        ['Hora', function (f) { return String(f.hora || '').slice(0, 5); }],
        ['Paciente', function (f) { return f.nombre; }],
        ['Teléfono', function (f) { return f.telefono || '—'; }],
        ['Servicio', function (f) { return f.servicio; }],
        ['Odontólogo', function (f) { return f.dentista ? f.dentista.nombre : '—'; }],
        ['Sala', function (f) { return f.sala ? f.sala.codigo + ' · ' + f.sala.nombre : '—'; }]
      ],
      cargar: async function (d, h, o) {
        var filtra = o && (o.inst || o.suc);
        var c = sb.from('citas').select('id,fecha,hora,servicio,nombre,telefono,estado,dentista:dentistas(nombre),sala:posiciones(codigo,nombre)' + (filtra ? ',pac:pacientes(institucion_id,sucursal_id)' : ''))
          .gte('fecha', d).lte('fecha', h);
        if (o && o.medico) c = c.eq('dentista_id', +o.medico);   // odontólogo de la cita
        var r = await c.order('fecha').order('hora');
        if (r.error) throw r.error;
        if (!filtra) return r.data;
        return r.data.filter(function (c) { var p = c.pac || {}; return (!o.inst || String(p.institucion_id) === String(o.inst)) && (!o.suc || String(p.sucursal_id) === String(o.suc)); });
      },
      totales: function (filas) { return [['Citas', filas.length]]; }
    },

    cobros: {
      panel: 'admRepCobros', titulo: 'Cobros por paciente', cliente: true, tipoBanco: true, instSuc: true,
      nota: 'Pagos con fecha entre las dos fechas, de un cliente o de todos (institucionales o privados), de una institución y sucursal o de todas, y de un banco o de todos, agrupados por paciente. Los recibos anulados no suman al total.',
      estados: { valido: ['Válido', 'verde'], anulado: ['Anulado', 'rojo'] },
      columnas: [
        ['Paciente', function (f) { return f.paciente; }],
        ['Recibo', function (f) { return 'N.º ' + f.id; }],
        ['Fecha', function (f) { return fechaCorta(f.fecha); }],
        ['Forma de pago', function (f) { return METODOS[f.metodo] || f.metodo; }],
        ['Banco', function (f) { return bancario(f) ? f.banco || '—' : '—'; }],
        ['Documento', function (f) { return bancario(f) ? f.documento_banco || '—' : '—'; }],
        ['Concepto', function (f) { return f.anulado ? 'ANULADO: ' + (f.anulado_motivo || '') : (f.concepto || '—'); }],
        ['Monto', function (f) { return Number(f.monto); }, 'q']
      ],
      grupo: function (f) { return f.paciente; },
      cuenta: function (f) { return f.estado === 'valido'; },
      cargar: async function (d, h, x) {
        function consulta(campos) {
          var c = sb.from('pagos').select(campos).gte('fecha', d).lte('fecha', h);
          if (x && x.cliente) c = c.eq('paciente_id', +x.cliente);
          if (x && x.banco) c = c.eq('banco', x.banco);
          return c.order('fecha');
        }
        var r = await consulta('id,fecha,monto,metodo,concepto,anulado,anulado_motivo,paciente_id,banco,documento_banco,institucion_id,sucursal_id,pac:pacientes(nombre,tipo_cliente,institucion_id,sucursal_id)');
        // Sin la institución y sucursal del pago: se usa la del paciente
        if (r.error && /institucion_id|sucursal_id/.test(r.error.message || '')) r = await consulta('id,fecha,monto,metodo,concepto,anulado,anulado_motivo,paciente_id,banco,documento_banco,pac:pacientes(nombre,tipo_cliente,institucion_id,sucursal_id)');
        if (r.error && /banco|tipo_cliente|institucion|sucursal/.test(r.error.message || '')) {
          if ((x && x.banco) || (x && x.tipo) || (x && x.inst) || (x && x.suc)) throw new Error('Falta ejecutar en Supabase el script actualizado (supabase.sql) para filtrar por banco, tipo de cliente, institución o sucursal.');
          r = await consulta('id,fecha,monto,metodo,concepto,anulado,anulado_motivo,paciente_id,pac:pacientes(nombre)');
        }
        if (r.error) throw r.error;
        var datos = r.data.filter(function (p) { var ins = p.pac && p.pac.tipo_cliente === 'institucional'; return !(x && x.tipo) || (x.tipo === 'institucional' ? ins : !ins); });
        // Institución y sucursal: las del pago (o, en los pagos anteriores, las del paciente)
        datos = datos.filter(function (p) {
          var pi = p.institucion_id || (p.pac && p.pac.institucion_id), ps = p.sucursal_id || (p.pac && p.pac.sucursal_id);
          return (!(x && x.inst) || String(pi) === String(x.inst)) && (!(x && x.suc) || String(ps) === String(x.suc));
        });
        return datos.map(function (p) { p.paciente = p.pac ? p.pac.nombre : '—'; p.estado = p.anulado ? 'anulado' : 'valido'; return p; })
          .sort(function (a, b) { return a.paciente.localeCompare(b.paciente) || String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id; });
      },
      totales: function (filas) {
        var v = filas.filter(function (f) { return f.estado === 'valido'; });
        var pacientes = {}; v.forEach(function (f) { pacientes[f.paciente_id] = 1; });
        return [['Pacientes', Object.keys(pacientes).length], ['Cobros válidos', v.length], ['Total cobrado', q(v.reduce(function (t, f) { return t + Number(f.monto); }, 0))]];
      },
      sumar: ['monto']
    },
  };

  // ---------- Motor común ----------
  var estadoRep = {};   // por reporte: { filas, desde, hasta, ocultos: {estado: true}, generado }

  function valor(col, f) { return col[1](f); }
  function texto(col, f) {
    var v = valor(col, f);
    return col[2] === 'q' ? q(v) : col[2] === 'pct' ? pct(v) : String(v == null ? '' : v);
  }
  function pill(def, e) { var x = def.estados[e] || [e, 'gris']; return '<span class="estado rep-e-' + x[1] + '">' + esc(x[0]) + '</span>'; }
  function visibles(clave) {
    var s = estadoRep[clave];
    return (s.filas || []).filter(function (f) { return !s.ocultos[f.estado]; });
  }

  function montar(clave) {
    var def = REPORTES[clave], p = $(def.panel);
    p.innerHTML =
      '<div class="adm-pane-head"><h3 class="adm-h">' + esc(def.titulo) + '</h3>' +
      '<div class="hi-botones"><button type="button" class="adm-btn" data-rep-imprimir="' + clave + '" disabled>Imprimir</button>' +
      '<button type="button" class="adm-btn" data-rep-excel="' + clave + '" disabled>Exportar a Excel</button></div></div>' +
      '<p class="dlg-msg">' + esc(def.nota) + '</p>' +
      '<form class="rep-param" data-rep-form="' + clave + '">' +
      '<label>Fecha inicial<input type="date" name="desde" value="' + inicioMes() + '" required></label>' +
      '<label>Fecha final<input type="date" name="hasta" value="' + hoy() + '" required></label>' +
      (def.cliente ? '<label class="rep-cliente">Cliente<select name="cliente"><option value="">Todos los clientes</option></select></label>' : '') +
      (def.tipoBanco ? '<label>Tipo de cliente<select name="tipo"><option value="">Todos</option><option value="institucional">Institucional</option><option value="privado">Cliente privado</option></select></label>' +
        '<label>Banco<select name="banco"><option value="">Todos los bancos</option></select></label>' : '') +
      (def.medicoInst ? '<label>Odontólogo<select name="medico"><option value="">Todos los odontólogos</option></select></label>' +
        (def.instSuc ? '' : '<label>Institución<select name="inst"><option value="">Todas las instituciones</option></select></label>') : '') +
      (def.instSuc ? '<label>Institución<select name="inst"><option value="">Todas las instituciones</option></select></label>' +
        '<label>Sucursal<select name="suc"><option value="">Todas las sucursales</option></select></label>' : '') +
      (def.agenteInst ? '<label>Agente comercial<select name="agente"><option value="">Todos los agentes</option></select></label>' +
        '<label>Institución<select name="inst"><option value="">Todas las instituciones</option></select></label>' : '') +
      '<button type="submit" class="dlg-submit">' + esc(def.boton || 'Generar reporte') + '</button></form>' +
      '<div class="rep-params" data-rep-params="' + clave + '"></div>' +
      '<div class="rep-chips" data-rep-chips="' + clave + '" aria-label="Filtrar por estado"></div>' +
      '<div class="rep-totales" data-rep-totales="' + clave + '"></div>' +
      '<div class="roles-wrap"><table class="rep-tabla"><thead><tr>' +
      def.columnas.map(function (c) { return '<th' + (c[2] ? ' class="num"' : '') + '>' + esc(c[0]) + '</th>'; }).join('') + '<th>Estado</th>' + (def.detalle ? '<th><span class="sr-only">Detalle</span></th>' : '') + '</tr></thead>' +
      '<tbody data-rep-body="' + clave + '"></tbody></table></div>' +
      (def.detalle ? '<div class="rep-det" data-rep-det="' + clave + '" hidden></div>' : '') +
      '<p class="dlg-msg" role="status" data-rep-msg="' + clave + '"></p>';
    estadoRep[clave] = { filas: null, ocultos: {}, generado: false };
    if (def.cliente) llenarClientes(p.querySelector('select[name=cliente]'));
    if (def.tipoBanco) llenarBancos(p.querySelector('select[name=banco]'));
    if (def.agenteInst) llenarAgentesInst(p);
    if (def.medicoInst) llenarMedicoInst(p);
    if (def.instSuc) llenarInstSuc(p);
  }
  // Listas de instituciones y sucursales (la sucursal se filtra por la institución elegida)
  async function llenarInstSuc(p) {
    var r = await Promise.all([sb.from('jor_instituciones').select('id,nombre').order('nombre'), sb.from('jor_sucursales').select('id,nombre,institucion_id').order('nombre')]);
    var si = p.querySelector('select[name=inst]'), ss = p.querySelector('select[name=suc]');
    if (!si || !si.isConnected) return;
    var insts = r[0].error ? [] : r[0].data || [], sucs = r[1].error ? [] : r[1].data || [], nom = {};
    insts.forEach(function (i) { nom[i.id] = i.nombre; });
    var vi = si.value;
    si.innerHTML = '<option value="">Todas las instituciones</option>' + insts.map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    si.value = insts.some(function (i) { return String(i.id) === vi; }) ? vi : '';
    function sucursales() {
      var ins = si.value, vs = ss.value, l = ins ? sucs.filter(function (s) { return String(s.institucion_id) === ins; }) : sucs;
      ss.innerHTML = '<option value="">Todas las sucursales</option>' + l.map(function (s) { return '<option value="' + s.id + '">' + esc(s.nombre) + (ins ? '' : ' · ' + esc(nom[s.institucion_id] || '')) + '</option>'; }).join('');
      ss.value = l.some(function (s) { return String(s.id) === vs; }) ? vs : '';
    }
    sucursales();
    si.onchange = sucursales;
    ss.onchange = function () { var s = sucs.filter(function (x) { return String(x.id) === ss.value; })[0]; if (s && !si.value) { si.value = String(s.institucion_id); sucursales(); ss.value = String(s.id); } };
  }
  // Listas de odontólogos e instituciones para el listado de pacientes
  async function llenarMedicoInst(p) {
    var r = await Promise.all([sb.from('dentistas').select('id,nombre,estado').order('nombre'), sb.from('jor_instituciones').select('id,nombre').order('nombre')]);
    var sm = p.querySelector('select[name=medico]'), si = tieneSucursal(p) ? null : p.querySelector('select[name=inst]');
    if (!sm || !sm.isConnected) return;
    var vm = sm.value, vi = si ? si.value : '';
    sm.innerHTML = '<option value="">Todos los odontólogos</option>' + (r[0].error ? [] : r[0].data).map(function (x) { return '<option value="' + x.id + '">' + esc(x.nombre) + (x.estado && x.estado !== 'activo' ? ' (' + x.estado + ')' : '') + '</option>'; }).join('');
    if (si) si.innerHTML = '<option value="">Todas las instituciones</option>' + (r[1].error ? [] : r[1].data).map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    sm.value = vm; if (si) si.value = vi;
  }
  // ¿El panel es de un reporte con institución y sucursal? (entonces esas listas las llena llenarInstSuc)
  function tieneSucursal(p) { return !!p.querySelector('select[name=suc]'); }
  // Listas de agentes comerciales e instituciones para el reporte de comisiones
  async function llenarAgentesInst(p) {
    var r = await Promise.all([sb.from('agentes').select('id,codigo,nombre,estado').order('codigo'), sb.from('jor_instituciones').select('id,nombre').order('nombre')]);
    var sa = p.querySelector('select[name=agente]'), si = p.querySelector('select[name=inst]');
    if (!sa || !sa.isConnected) return;
    var ord = function (c) { return /^\d+$/.test(c) ? +c : Infinity; };
    var va = sa.value, vi = si.value;
    sa.innerHTML = '<option value="">Todos los agentes</option>' + (r[0].error ? [] : r[0].data).filter(function (a) { return a.codigo !== '0'; })
      .sort(function (a, b) { return ord(a.codigo) - ord(b.codigo); })
      .map(function (a) { return '<option value="' + a.id + '">' + esc(a.codigo + ' · ' + a.nombre) + (a.estado !== 'activo' ? ' (' + a.estado + ')' : '') + '</option>'; }).join('');
    si.innerHTML = '<option value="">Todas las instituciones</option>' + (r[1].error ? [] : r[1].data).map(function (i) { return '<option value="' + i.id + '">' + esc(i.nombre) + '</option>'; }).join('');
    sa.value = va; si.value = vi;
  }
  // Bancos: los del sistema más los que ya tengan pagos registrados
  async function llenarBancos(sel) {
    var r = await sb.from('pagos').select('banco').not('banco', 'is', null);
    if (!sel.isConnected) return;
    var l = (window.PD_BANCOS_GT || []).slice();
    (r.error ? [] : r.data || []).forEach(function (x) { if (x.banco && l.indexOf(x.banco) < 0) l.push(x.banco); });
    var antes = sel.value;
    sel.innerHTML = '<option value="">Todos los bancos</option>' + l.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('');
    sel.value = antes;
  }
  // Lista de clientes (pacientes) para el parámetro «Cliente»
  async function llenarClientes(sel) {
    var r = await sb.from('pacientes').select('id,nombre').order('nombre');
    if (r.error || !sel.isConnected) return;
    var antes = sel.value;
    sel.innerHTML = '<option value="">Todos los clientes</option>' + r.data.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nombre) + '</option>'; }).join('');
    sel.value = antes;
  }
  // Parámetros con que se generó el reporte (se muestran en pantalla, en la impresión y en Excel)
  function parametros(s) { return [['Fecha inicial', fechaCorta(s.desde)], ['Fecha final', fechaCorta(s.hasta)]].concat(s.cliente !== undefined ? [['Cliente', s.clienteNombre || 'Todos los clientes']] : [], s.extras || []); }

  async function generar(clave) {
    var def = REPORTES[clave], p = $(def.panel), s = estadoRep[clave];
    var form = p.querySelector('[data-rep-form]'), d = form.desde.value, h = form.hasta.value, cli = form.cliente ? form.cliente.value : undefined;
    var msg = p.querySelector('[data-rep-msg]');
    if (!d || !h) { msg.textContent = 'Indica la fecha inicial y la final.'; msg.style.color = '#9A3B2E'; return; }
    if (d > h) { msg.textContent = 'La fecha inicial no puede ser posterior a la final.'; msg.style.color = '#9A3B2E'; return; }
    msg.textContent = 'Generando…'; msg.style.color = '#475B68';
    form.querySelector('button').disabled = true;
    try {
      var tipo = form.tipo ? form.tipo.value : '', banco = form.banco ? form.banco.value : '';
      var agente = form.agente ? form.agente.value : '', inst = form.inst ? form.inst.value : '', medico = form.medico ? form.medico.value : '', suc = form.suc ? form.suc.value : '';
      s.filas = await def.cargar(d, h, { cliente: cli, tipo: tipo, banco: banco, agente: agente, inst: inst, medico: medico, suc: suc });
      var txt = function (sel, def0) { return sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : def0; };
      var ex = [];
      if (def.tipoBanco) ex.push(['Tipo de cliente', txt(form.tipo, 'Todos')], ['Banco', banco || 'Todos los bancos']);
      if (def.agenteInst) ex.push(['Agente comercial', txt(form.agente, 'Todos los agentes')], ['Institución', txt(form.inst, 'Todas las instituciones')]);
      if (def.medicoInst) ex.push(['Odontólogo', txt(form.medico, 'Todos los odontólogos')]);
      if (def.medicoInst && !def.instSuc) ex.push(['Institución', txt(form.inst, 'Todas las instituciones')]);
      if (def.instSuc) ex.push(['Institución', txt(form.inst, 'Todas las instituciones')], ['Sucursal', txt(form.suc, 'Todas las sucursales')]);
      s.extras = ex.length ? ex : null;
      s.desde = d; s.hasta = h; s.generado = true;
      s.cliente = cli; s.clienteNombre = cli ? form.cliente.selectedOptions[0].textContent : '';
      msg.textContent = '';
    } catch (e) {
      s.filas = []; s.generado = false;
      msg.textContent = traducir(e); msg.style.color = '#9A3B2E';
    }
    form.querySelector('button').disabled = false;
    pintar(clave);
  }

  function filaHtml(def, f) {
    return '<tr>' + def.columnas.map(function (c) { return '<td' + (c[2] ? ' class="num"' : '') + '>' + esc(texto(c, f)) + '</td>'; }).join('') + '<td>' + pill(def, f.estado) + '</td>' +
      (def.detalle ? '<td>' + (f.lineas ? '<button type="button" class="adm-btn rep-det-btn" data-rep-detalle="' + f.id + '"' + (f.lineas.length ? '' : ' disabled') + '>Detalle</button>' : '') + '</td>' : '') + '</tr>';
  }
  function filaSuma(def, filas, etiqueta, clase) {
    var cuenta = def.cuenta ? filas.filter(def.cuenta) : filas;
    var primera = true;
    return '<tr class="' + clase + '">' + def.columnas.map(function (c) {
      var sumable = c[2] && def.sumar && def.columnas.indexOf(c) >= 0 && c[2] !== 'pct';
      if (sumable) {
        var t = cuenta.reduce(function (a, f) { return a + (Number(valor(c, f)) || 0); }, 0);
        return '<td class="num">' + esc(c[2] === 'q' ? q(t) : String(Math.round(t))) + '</td>';
      }
      if (primera) { primera = false; return '<td>' + esc(etiqueta) + '</td>'; }
      return '<td></td>';
    }).join('') + '<td></td>' + (def.detalle ? '<td></td>' : '') + '</tr>';
  }

  function pintar(clave) {
    var def = REPORTES[clave], p = $(def.panel), s = estadoRep[clave];
    var todas = s.filas || [], filas = visibles(clave);
    p.querySelector('[data-rep-params]').innerHTML = !s.generado ? '' : '<span class="rep-params-t">Parámetros</span>' +
      parametros(s).map(function (x) { return '<span class="rep-param-i">' + esc(x[0]) + ' <b>' + esc(x[1]) + '</b></span>'; }).join('');
    // Botones de estado con su color y cantidad (tocar para mostrar u ocultar)
    p.querySelector('[data-rep-chips]').innerHTML = !s.generado ? '' : Object.keys(def.estados).map(function (e) {
      var n = todas.filter(function (f) { return f.estado === e; }).length;
      return '<button type="button" class="rep-chip" data-rep-estado="' + e + '" aria-pressed="' + !s.ocultos[e] + '">' +
        '<span class="rep-dot rep-d-' + def.estados[e][1] + '"></span>' + esc(def.estados[e][0]) + ' <b>' + n + '</b></button>';
    }).join('');
    p.querySelector('[data-rep-totales]').innerHTML = !s.generado ? '' :
      def.totales(filas).map(function (t) { return '<div class="rep-total-caja"><span>' + esc(t[0]) + '</span><b>' + esc(String(t[1])) + '</b></div>'; }).join('');
    var cols = def.columnas.length + 1 + (def.detalle ? 1 : 0), cuerpo;
    var caja = p.querySelector('[data-rep-det]'); if (caja) { caja.hidden = true; caja.innerHTML = ''; }
    if (!s.generado) cuerpo = '';
    else if (!filas.length) cuerpo = '<tr><td colspan="' + cols + '">No hay datos para esas fechas' + (todas.length ? ' con los estados elegidos' : '') + '.</td></tr>';
    else if (def.grupo) {
      cuerpo = ''; var grupos = [], porGrupo = {};
      filas.forEach(function (f) { var g = def.grupo(f); if (!porGrupo[g]) { porGrupo[g] = []; grupos.push(g); } porGrupo[g].push(f); });
      grupos.forEach(function (g) { cuerpo += porGrupo[g].map(function (f) { return filaHtml(def, f); }).join('') + filaSuma(def, porGrupo[g], 'Subtotal ' + g, 'rep-sub'); });
    } else cuerpo = filas.map(function (f) { return filaHtml(def, f); }).join('');
    if (s.generado && filas.length && def.sumar) cuerpo += filaSuma(def, filas, 'TOTAL', 'rep-total');
    p.querySelector('[data-rep-body]').innerHTML = cuerpo;
    p.querySelector('[data-rep-imprimir]').disabled = !s.generado || !filas.length;
    p.querySelector('[data-rep-excel]').disabled = !s.generado || !filas.length;
  }

  // ---------- Detalle de comisiones de un agente ----------
  var CATEGORIA = { procedimientos: 'Procedimiento', medicamentos: 'Medicamento', laboratorio: 'Laboratorio', otros: 'Otro cobro' };
  function reglaTxt(l) { return !l.regla_id ? pct(l.valor) + ' (general)' : l.tipo === 'valor' ? q(l.valor) + ' c/u' : pct(l.valor); }
  function detalleHtml(clave, a) {
    var s = estadoRep[clave];
    var ls = a.lineas.slice().sort(function (x, y) {
      return String(x.paciente || '').localeCompare(String(y.paciente || ''), 'es') || (x.paciente_id - y.paciente_id) || (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0) || (x.ref_id - y.ref_id);
    });
    var grupos = [], porPac = {};
    ls.forEach(function (l) { var k = l.paciente_id; if (!porPac[k]) { porPac[k] = []; grupos.push(k); } porPac[k].push(l); });
    function suma(x, k) { return x.reduce(function (t, l) { return t + Number(l[k]); }, 0); }
    var cuerpo = grupos.map(function (k) {
      var g = porPac[k];
      return '<tr class="rep-det-pac"><td colspan="8">' + esc(g[0].paciente) + ' <small>· ' + g.length + (g.length === 1 ? ' línea' : ' líneas') + '</small></td></tr>' +
        g.map(function (l) {
          return '<tr><td>' + fechaCorta(l.fecha) + '</td><td>' + esc(l.documento) + '</td><td>' + esc(l.concepto) + (Number(l.cantidad) !== 1 ? ' × ' + Number(l.cantidad) : '') + '</td>' +
            '<td>' + esc(CATEGORIA[l.categoria] || l.categoria) + '</td><td class="num">' + q(l.base) + '</td><td class="num">' + esc(reglaTxt(l)) + '</td>' +
            '<td class="num">' + q(l.comision) + '</td><td>' + (l.pago_comision_id ? '<span class="estado rep-e-verde">Pagada · No. ' + l.pago_comision_id + '</span>' : '<span class="estado rep-e-ambar">Pendiente</span>') + '</td></tr>';
        }).join('') +
        '<tr class="rep-sub"><td colspan="4">Subtotal ' + esc(g[0].paciente) + '</td><td class="num">' + q(suma(g, 'base')) + '</td><td></td><td class="num">' + q(suma(g, 'comision')) + '</td><td></td></tr>';
    }).join('');
    return '<div class="rep-det-head"><div><h4>Detalle de comisiones · ' + esc(a.codigo + ' · ' + a.nombre) + '</h4>' +
      '<p class="dlg-msg">' + rango(s) + ' · ' + grupos.length + (grupos.length === 1 ? ' paciente' : ' pacientes') + ' · ' + ls.length + (ls.length === 1 ? ' línea' : ' líneas') + '. Ordenado por paciente y fecha.</p></div>' +
      '<div class="hi-botones"><button type="button" class="adm-btn" data-rep-det-imprimir="' + clave + '">Imprimir detalle</button><button type="button" class="adm-btn" data-rep-det-cerrar="' + clave + '">Cerrar</button></div></div>' +
      '<div class="roles-wrap"><table class="rep-tabla"><thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th>Tipo</th><th class="num">Base</th><th class="num">Regla</th><th class="num">Comisión</th><th>Estado</th></tr></thead><tbody>' +
      cuerpo + '<tr class="rep-total"><td colspan="4">TOTAL</td><td class="num">' + q(suma(ls, 'base')) + '</td><td></td><td class="num">' + q(suma(ls, 'comision')) + '</td><td></td></tr></tbody></table></div>';
  }
  function verDetalle(clave, id) {
    var def = REPORTES[clave], s = estadoRep[clave], caja = $(def.panel).querySelector('[data-rep-det]');
    var a = (s.filas || []).filter(function (f) { return String(f.id) === String(id); })[0];
    if (!a || !caja) return;
    caja.innerHTML = detalleHtml(clave, a); caja.hidden = false; caja.dataset.agente = a.id;
    caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function imprimirDetalle(clave) {
    var def = REPORTES[clave], caja = $(def.panel).querySelector('[data-rep-det]');
    var tabla = caja.querySelector('table').cloneNode(true), titulo = caja.querySelector('h4').textContent, sub = caja.querySelector('.dlg-msg').textContent;
    var celda = 'padding:5px 5px;border-bottom:1px solid #D9E4EC;text-align:left';
    tabla.setAttribute('style', 'width:100%;border-collapse:collapse;font-size:11px');
    tabla.querySelectorAll('th,td').forEach(function (c) { c.setAttribute('style', celda + (c.classList.contains('num') ? ';text-align:right' : '')); });
    tabla.querySelectorAll('tr.rep-det-pac td').forEach(function (c) { c.style.fontWeight = '800'; c.style.paddingTop = '10px'; c.style.borderBottom = '1px solid #0B2B40'; });
    tabla.querySelectorAll('tr.rep-sub td').forEach(function (c) { c.style.fontWeight = '700'; c.style.background = '#F5F9FC'; });
    tabla.querySelectorAll('tr.rep-total td').forEach(function (c) { c.style.fontWeight = '800'; c.style.borderTop = '2px solid #0B2B40'; });
    $('impresion').innerHTML = '<div style="font-family:Manrope,system-ui,sans-serif;color:#0B2B40;max-width:1000px;margin:0 auto;padding:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0B2B40;padding-bottom:12px;margin-bottom:14px">' +
      '<div><div style="font-family:\'Instrument Serif\',Georgia,serif;font-size:28px">' + CLINICA.nombre + '</div><div style="font-size:12px;color:#475B68">' + CLINICA.direccion + ' · ' + CLINICA.telefono + '</div></div>' +
      '<div style="text-align:right;font-size:12.5px;color:#475B68"><div style="font-size:17px;font-weight:700;color:#0B2B40">' + esc(titulo) + '</div>' + esc(sub) + '<br>Impreso el ' + fechaCorta(hoy()) + '</div></div>' +
      '<div style="font-size:12px;color:#475B68;margin-bottom:8px">Parámetros: ' + parametros(estadoRep[clave]).map(function (x) { return esc(x[0]) + ' <b>' + esc(x[1]) + '</b>'; }).join(' · ') + '</div>' +
      tabla.outerHTML + '</div>';
    document.body.classList.add('imprimir');
    window.print();
  }

  // ---------- Imprimir y exportar ----------
  function rango(s) { return 'Del ' + fechaCorta(s.desde) + ' al ' + fechaCorta(s.hasta); }
  function imprimir(clave) {
    var def = REPORTES[clave], s = estadoRep[clave], tabla = $(def.panel).querySelector('.rep-tabla').cloneNode(true);
    var celda = 'padding:6px 5px;border-bottom:1px solid #D9E4EC;text-align:left';
    tabla.querySelectorAll('.rep-det-btn').forEach(function (b) { b.remove(); });
    tabla.setAttribute('style', 'width:100%;border-collapse:collapse;font-size:11.5px');
    tabla.querySelectorAll('th,td').forEach(function (c) { c.setAttribute('style', celda + (c.classList.contains('num') ? ';text-align:right' : '')); });
    tabla.querySelectorAll('tr.rep-sub td').forEach(function (c) { c.style.fontWeight = '700'; c.style.background = '#F5F9FC'; });
    tabla.querySelectorAll('tr.rep-total td').forEach(function (c) { c.style.fontWeight = '800'; c.style.borderTop = '2px solid #0B2B40'; });
    var ocultos = Object.keys(s.ocultos).filter(function (e) { return s.ocultos[e]; });
    $('impresion').innerHTML =
      '<div style="font-family:Manrope,system-ui,sans-serif;color:#0B2B40;max-width:1000px;margin:0 auto;padding:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0B2B40;padding-bottom:12px;margin-bottom:14px">' +
      '<div><div style="font-family:\'Instrument Serif\',Georgia,serif;font-size:28px">' + CLINICA.nombre + '</div>' +
      '<div style="font-size:12px;color:#475B68">' + CLINICA.direccion + ' · ' + CLINICA.telefono + '</div></div>' +
      '<div style="text-align:right;font-size:12.5px;color:#475B68"><div style="font-size:18px;font-weight:700;color:#0B2B40">' + esc(def.titulo) + '</div>' +
      rango(s) + (s.cliente !== undefined ? '<br>Cliente: ' + esc(s.clienteNombre || 'Todos los clientes') : '') + '<br>Impreso el ' + fechaCorta(hoy()) + '</div></div>' +
      '<div style="font-size:12px;color:#475B68;margin-bottom:8px">Parámetros: ' + parametros(s).map(function (x) { return esc(x[0]) + ' <b>' + esc(x[1]) + '</b>'; }).join(' · ') + '</div>' +
      (ocultos.length ? '<div style="font-size:12px;color:#475B68;margin-bottom:8px">Sin incluir: ' + ocultos.map(function (e) { return esc(def.estados[e][0]); }).join(', ') + '</div>' : '') +
      '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;margin-bottom:12px">' +
      def.totales(visibles(clave)).map(function (t) { return '<div>' + esc(t[0]) + ': <b>' + esc(String(t[1])) + '</b></div>'; }).join('') + '</div>' +
      tabla.outerHTML + '</div>';
    document.body.classList.add('imprimir');
    window.print();
  }
  window.addEventListener('afterprint', function () {
    if (!$('impresion').querySelector('table')) return;
    document.body.classList.remove('imprimir');
    $('impresion').innerHTML = '';
  });

  function exportar(clave) {
    var def = REPORTES[clave], s = estadoRep[clave], filas = visibles(clave);
    function celda(v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lineas = [[def.titulo + ' · ' + rango(s)].map(celda).join(',')].concat(parametros(s).map(function (x) { return [x[0], x[1]].map(celda).join(','); }), ['']);
    lineas.push(def.columnas.map(function (c) { return celda(c[0]); }).concat(['Estado']).join(','));
    filas.forEach(function (f) {
      lineas.push(def.columnas.map(function (c) {
        var v = valor(c, f);
        return celda(c[2] === 'q' || c[2] === 'n' || c[2] === 'pct' ? num(v).toFixed(c[2] === 'n' ? 0 : 2) : v);
      }).concat([celda((def.estados[f.estado] || [f.estado])[0])]).join(','));
    });
    var blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reporte-' + clave + '-' + s.desde + '-al-' + s.hasta + (s.cliente ? '-cliente-' + s.cliente : '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- Eventos ----------
  Object.keys(REPORTES).forEach(montar);
  var TABS = { tabRepPacientes: 'pacientes', tabRepCuentas: 'cuentas', tabRepCitas: 'citas', tabRepCobros: 'cobros' };
  Object.keys(TABS).forEach(function (t) {
    $(t).addEventListener('click', function () {
      var def = REPORTES[TABS[t]];
      if (def.cliente) llenarClientes($(def.panel).querySelector('select[name=cliente]'));
      if (def.tipoBanco) llenarBancos($(def.panel).querySelector('select[name=banco]'));
      if (def.agenteInst) llenarAgentesInst($(def.panel));
      if (def.medicoInst) llenarMedicoInst($(def.panel));
      if (def.instSuc) llenarInstSuc($(def.panel));
      if (!estadoRep[TABS[t]].generado) generar(TABS[t]);
    });
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-rep-form]');
    if (!f) return;
    e.preventDefault();
    generar(f.dataset.repForm);
  });
  document.addEventListener('click', function (e) {
    var dt = e.target.closest('[data-rep-detalle],[data-rep-det-cerrar],[data-rep-det-imprimir]');
    if (dt) {
      var cl = dt.closest('[data-rep-det]') ? dt.closest('[data-rep-det]').dataset.repDet : null;
      if (dt.dataset.repDetalle) { var tb = dt.closest('[data-rep-body]'); verDetalle(tb.dataset.repBody, dt.dataset.repDetalle); return; }
      if (dt.dataset.repDetCerrar) { var cj = dt.closest('[data-rep-det]'); cj.hidden = true; cj.innerHTML = ''; return; }
      if (dt.dataset.repDetImprimir) { imprimirDetalle(cl); return; }
    }
    var b = e.target.closest('[data-rep-estado],[data-rep-imprimir],[data-rep-excel]');
    if (!b) return;
    if (b.dataset.repImprimir) { imprimir(b.dataset.repImprimir); return; }
    if (b.dataset.repExcel) { exportar(b.dataset.repExcel); return; }
    var clave = b.closest('[data-rep-chips]').dataset.repChips, s = estadoRep[clave];
    s.ocultos[b.dataset.repEstado] = !s.ocultos[b.dataset.repEstado];
    pintar(clave);
  });

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { /* los reportes se generan al abrirlos o al pulsar «Generar reporte» */ },
    limpiar: function () { Object.keys(REPORTES).forEach(montar); }   // no dejar datos en pantalla al cerrar sesión
  });
})();
