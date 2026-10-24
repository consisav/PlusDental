// Plus Dental — Expediente > Órdenes de laboratorio.
// Solicitudes de trabajos a laboratorios dentales (coronas, puentes, prótesis, férulas…) con seguimiento por etapas,
// aviso de órdenes atrasadas, impresión / PDF con logo y firma, y envío al laboratorio por WhatsApp o correo.
(function () {
  var sb = window.PD_SB;
  if (!sb || !document.getElementById('fLab')) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function fechaCorta(f) { return f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function q(n) { return n == null || n === '' ? '—' : 'Q' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function edad(f) { if (!f) return ''; var n = new Date(f + 'T12:00:00'), h = new Date(), a = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--; return a + ' años'; }
  function telWa(t) { var n = String(t || '').replace(/\D/g, ''); if (n.length === 8) n = '502' + n; return n; }
  function aviso(t, error) { var m = $('olMsg'); m.textContent = t || ''; m.style.color = error ? '#9A3B2E' : ''; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/ordenes_lab|laboratorios/.test(m) && /does not exist|could not find|schema cache/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para las órdenes de laboratorio.';
    if (/laboratorios_nombre|duplicate key/i.test(m)) return 'Ya existe un laboratorio con ese nombre.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m.replace(/^.*?ERROR:\s*/, '') || 'No se pudo completar la acción.';
  }

  var ESTADOS = { borrador: 'Borrador', enviada: 'Enviada', proceso: 'En proceso', prueba: 'Prueba en clínica', recibida: 'Recibida', colocada: 'Colocada', devuelta: 'Devuelta al laboratorio', cancelada: 'Cancelada' };
  var ETAPAS = ['enviada', 'proceso', 'prueba', 'recibida', 'colocada'];
  var ABIERTAS = ['enviada', 'proceso', 'prueba', 'devuelta'];
  // Trabajos frecuentes y días hábiles habituales de entrega
  var TRABAJOS = { 'Corona unitaria': 7, 'Corona sobre implante': 10, 'Puente fijo': 10, 'Incrustación (inlay / onlay)': 7, 'Carilla': 7, 'Poste y núcleo colado': 5,
    'Prótesis parcial removible': 14, 'Prótesis total (dentadura)': 15, 'Prótesis flexible': 12, 'Férula oclusal / guarda': 5, 'Placa de ortodoncia': 7, 'Retenedor': 5,
    'Provisional de laboratorio': 4, 'Modelo de estudio': 3, 'Encerado diagnóstico': 5, 'Guía quirúrgica': 7, 'Reparación de prótesis': 3 };
  var MATERIALES = ['Zirconia', 'Disilicato de litio (e.max)', 'Metal-porcelana', 'Porcelana pura', 'Resina compuesta', 'PMMA (provisional)', 'Acrílico', 'Cromo-cobalto', 'Nylon flexible (Valplast)', 'Acetato / termoformado', 'Titanio'];
  var COLORES = ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'BL1 (blanqueado)', 'BL2 (blanqueado)'];
  var IMPRESIONES = ['Escaneo intraoral (archivo digital)', 'Impresión de silicona', 'Impresión de alginato', 'Modelos de yeso'];
  var ENVIA = ['Modelos de yeso', 'Impresión física', 'Archivo STL / escaneo', 'Registro de mordida', 'Antagonista', 'Fotografías', 'Provisional', 'Transfer y análogo de implante', 'Prótesis anterior'];

  var paciente = null, ordenes = [], labs = [], dentistas = [], citasPac = [], historial = {}, elegida = null, editando = null;

  function labDe(id) { return labs.filter(function (l) { return l.id === id; })[0] || null; }
  function dentDe(id) { return dentistas.filter(function (d) { return d.id === id; })[0] || null; }
  function atrasada(o) { return o.fecha_entrega && ABIERTAS.indexOf(o.estado) >= 0 && o.fecha_entrega < hoy(); }
  function diasHabiles(desde, n) { var d = new Date(desde + 'T12:00:00'); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) n--; } return iso(d); }
  function chipEstado(o) {
    if (atrasada(o)) { var dias = Math.round((new Date(hoy() + 'T12:00:00') - new Date(o.fecha_entrega + 'T12:00:00')) / 864e5); return '<span class="ol-est atrasada">Atrasada ' + dias + (dias === 1 ? ' día' : ' días') + '</span>'; }
    return '<span class="ol-est ' + o.estado + '">' + ESTADOS[o.estado] + (o.fecha_entrega && ABIERTAS.indexOf(o.estado) >= 0 ? ' · entrega ' + fechaCorta(o.fecha_entrega) : '') + '</span>';
  }
  function medicoPorDefecto() {
    if (paciente && paciente.dentista_id && dentDe(paciente.dentista_id)) return paciente.dentista_id;
    var d = dentistas.filter(function (x) { return x.rol_sala === 'principal' && x.estado === 'activo'; })[0] || dentistas.filter(function (x) { return x.estado === 'activo'; })[0];
    return d ? d.id : null;
  }
  // Piezas con trabajos protésicos pendientes en el odontograma (corona, implante, extracción, ausente)
  function piezasOdontograma() {
    var v = window.PD_ODONTOGRAMA_ACTUAL ? window.PD_ODONTOGRAMA_ACTUAL() : null;
    v = v && v.piezas ? v : paciente && paciente.odontograma;
    if (!v || !v.piezas) return [];
    return Object.keys(v.piezas).filter(function (n) {
      var e = v.piezas[n].estados || {};
      return e.corona === 'r' || e.implante === 'r' || e.ausente || e.extraccion;
    }).sort();
  }

  async function cargar(p, elegir) {
    paciente = p; ordenes = []; elegida = null; editando = null;
    if (!p) return;
    aviso('');
    $('olLista').innerHTML = '<p class="dlg-msg">Cargando…</p>'; $('olPanel').innerHTML = '';
    var rs = await Promise.all([
      sb.from('ordenes_lab').select('*').eq('paciente_id', p.id).order('creada', { ascending: false }),
      sb.from('laboratorios').select('*').order('nombre'),
      dentistas.length ? Promise.resolve({ data: dentistas }) : sb.from('dentistas').select('id,nombre,colegiado,rol_sala,estado').order('nombre'),
      sb.from('citas').select('id,fecha,hora,servicio,estado').eq('paciente_id', p.id).gte('fecha', hoy()).neq('estado', 'cancelada').order('fecha').order('hora')
    ]);
    if (paciente !== p) return;
    if (rs[0].error) { $('olLista').innerHTML = ''; aviso(traducir(rs[0].error), true); pintarVacio(); return; }
    ordenes = rs[0].data; labs = rs[1].error ? [] : rs[1].data;
    if (!rs[2].error) dentistas = rs[2].data;
    citasPac = rs[3].error ? [] : rs[3].data;
    elegida = elegir || (ordenes[0] ? ordenes[0].id : null);
    if (elegida) await cargarHistorial(elegida);
    pintar();
  }
  async function cargarHistorial(id) {
    var r = await sb.from('ordenes_lab_estados').select('*').eq('orden_id', id).order('fecha');
    historial[id] = r.error ? [] : r.data;
  }

  function pintarLista() {
    var abiertas = ordenes.filter(function (o) { return ABIERTAS.indexOf(o.estado) >= 0; }).length, atr = ordenes.filter(atrasada).length;
    $('olResumen').textContent = ordenes.length ? ordenes.length + (ordenes.length === 1 ? ' orden' : ' órdenes') + ' · ' + abiertas + ' en laboratorio' + (atr ? ' · ' + atr + ' atrasada' + (atr === 1 ? '' : 's') : '') : '';
    $('olLista').innerHTML = ordenes.length ? ordenes.map(function (o) {
      var l = labDe(o.laboratorio_id);
      return '<button type="button" class="rc-item' + (atrasada(o) ? ' ol-tarde' : '') + '" data-ol="' + o.id + '" aria-pressed="' + (o.id === elegida && !editando) + '">' +
        '<b>' + esc(o.numero || 'Orden') + '</b><span>' + esc(o.trabajo) + (o.piezas ? ' · pieza ' + esc(o.piezas) : '') + '</span>' +
        '<small>' + esc(l ? l.nombre : 'Sin laboratorio') + '</small>' + chipEstado(o) + '</button>';
    }).join('') : '<p class="rc-vacia">Este paciente aún no tiene órdenes de laboratorio.</p>';
  }
  function datosPaciente() {
    var p = paciente;
    return '<div class="rc-pac"><div><span>Paciente</span><b>' + esc(p.nombre) + '</b></div><div><span>Código</span>' + String(p.id).padStart(4, '0') + '</div>' +
      '<div><span>Edad</span>' + esc(edad(p.fecha_nacimiento) || '—') + '</div><div><span>Teléfono</span>' + esc(p.telefono || '—') + '</div></div>';
  }
  function pintarVacio() {
    $('olPanel').innerHTML = '<div class="rc-vacio"><b>Sin órdenes de laboratorio</b><p>Pulsa «+ Nueva orden» para solicitar un trabajo al laboratorio para ' + esc(paciente ? paciente.nombre : '') + '.</p></div>';
  }

  function pintarDetalle(o) {
    var l = labDe(o.laboratorio_id), d = dentDe(o.dentista_id), cita = citasPac.filter(function (c) { return c.id === o.cita_id; })[0];
    var idx = ETAPAS.indexOf(o.estado);
    var pasos = ETAPAS.map(function (e, k) {
      var h = (historial[o.id] || []).filter(function (x) { return x.estado === e; }).pop();
      var cls = o.estado === e ? 'on' : idx > k || h ? 'ok' : '';
      return '<span class="' + cls + '">' + ESTADOS[e] + (h ? ' · ' + fechaCorta(h.fecha) : '') + '</span>';
    }).join('<i>›</i>');
    var campo = function (t, v) { return '<div><span>' + t + '</span>' + v + '</div>'; };
    $('olPanel').innerHTML =
      '<div class="rc-head"><div><span class="rc-eti">Orden de laboratorio</span><h4>' + esc(o.numero || '') + '</h4></div>' +
      '<div class="rc-acc"><button type="button" class="adm-btn" data-ol-mod>Modificar</button>' +
      (l && l.telefono ? '<a class="adm-btn" target="_blank" rel="noopener" href="https://wa.me/' + telWa(l.telefono) + '?text=' + encodeURIComponent(textoOrden(o)) + '">Enviar por WhatsApp</a>' : '') +
      (l && l.correo ? '<a class="adm-btn" href="mailto:' + esc(l.correo) + '?subject=' + encodeURIComponent('Orden de laboratorio ' + (o.numero || '') + ' · Plus Dental') + '&body=' + encodeURIComponent(textoOrden(o)) + '">Correo</a>' : '') +
      '<button type="button" class="adm-btn adm-primary" data-ol-imp>Imprimir / PDF</button></div></div>' +
      (['cancelada', 'devuelta'].indexOf(o.estado) >= 0 ? '<p class="ol-aviso">' + ESTADOS[o.estado] + ' · ' + fechaHora(o.estado_fecha) + '</p>' : '<div class="ol-etapas">' + pasos + '</div>') +
      (atrasada(o) ? '<p class="ol-aviso tarde">⚠ La entrega prometida era el ' + fechaCorta(o.fecha_entrega) + '. Comunícate con el laboratorio.</p>' : '') +
      '<div class="rc-datos ol-datos">' +
      campo('Laboratorio', esc(l ? l.nombre : '—') + (l && l.telefono ? '<small>' + esc(l.telefono) + '</small>' : '')) +
      campo('Trabajo', '<b>' + esc(o.trabajo) + '</b>') + campo('Piezas', esc(o.piezas || '—')) +
      campo('Material · color', esc([o.material, o.color].filter(Boolean).join(' · ') || '—')) +
      campo('Impresión', esc(o.impresion || '—')) + campo('Enviada', fechaCorta(o.fecha_envio)) +
      campo('Entrega prometida', fechaCorta(o.fecha_entrega)) + campo('Recibida', fechaCorta(o.fecha_recibida)) +
      campo('Costo laboratorio', q(o.costo)) + campo('Dentista', esc(d ? d.nombre : '—')) +
      campo('Cita de colocación', cita ? fechaCorta(cita.fecha) + ' · ' + String(cita.hora).slice(0, 5) : '—') + '</div>' +
      ((o.envia || []).length ? '<div class="ol-envia"><span class="pos-lbl">Se envía al laboratorio</span>' + o.envia.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
      (o.indicaciones ? '<p class="rc-ind"><b>Indicaciones:</b> ' + esc(o.indicaciones) + '</p>' : '') +
      datosPaciente() +
      '<div class="ol-cambio"><label>Cambiar estado<select id="olNuevoEstado">' + Object.keys(ESTADOS).map(function (e) { return '<option value="' + e + '"' + (e === o.estado ? ' selected' : '') + '>' + ESTADOS[e] + '</option>'; }).join('') + '</select></label>' +
      '<label class="ol-nota">Nota (opcional)<input id="olNota" type="text" maxlength="200" placeholder="Ej.: prueba de metal con ajuste correcto"></label><button type="button" class="adm-btn adm-primary" data-ol-estado>Guardar estado</button></div>' +
      '<div class="ol-hist"><span class="pos-lbl">Historial</span>' + ((historial[o.id] || []).slice().reverse().map(function (h) {
        return '<div><b>' + (ESTADOS[h.estado] || h.estado) + '</b><span>' + fechaHora(h.fecha) + ' · ' + esc(h.usuario || '') + '</span>' + (h.nota ? '<em>' + esc(h.nota) + '</em>' : '') + '</div>';
      }).join('') || '<p class="dlg-msg">Sin cambios registrados.</p>') + '</div>' +
      '<p class="rc-reg">Registrada por ' + esc(o.creada_por || 'Sin usuario') + ' · ' + fechaHora(o.creada) + (o.modificada ? ' · Modificada por ' + esc(o.modificada_por || '') + ' · ' + fechaHora(o.modificada) : '') + '</p>';
  }

  function opciones(lista, sel, vacio) { return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function pintarFormulario(o) {
    var nueva = !o, med = o ? o.dentista_id : medicoPorDefecto(), sug = piezasOdontograma();
    $('olPanel').innerHTML =
      '<form id="olForm" class="rc-form">' +
      '<div class="rc-head"><div><span class="rc-eti">' + (nueva ? 'Nueva orden de laboratorio' : 'Modificar orden') + '</span><h4>' + (nueva ? 'N.º se asigna al grabar' : esc(o.numero)) + '</h4></div></div>' +
      datosPaciente() +
      '<fieldset class="pos-sec"><legend>Laboratorio y trabajo</legend><div class="exp-form rc-g4">' +
      '<label class="rc-span2">Laboratorio<select id="olLab"><option value="">Elegir laboratorio…</option>' + labs.filter(function (l) { return l.activo || (o && l.id === o.laboratorio_id); }).map(function (l) { return '<option value="' + l.id + '"' + (o && l.id === o.laboratorio_id ? ' selected' : '') + '>' + esc(l.nombre) + '</option>'; }).join('') + '<option value="nuevo">+ Nuevo laboratorio…</option></select></label>' +
      '<label class="rc-span2">Dentista que solicita<select id="olDent"><option value="">Sin asignar</option>' + dentistas.filter(function (d) { return d.estado === 'activo' || d.id === med; }).map(function (d) { return '<option value="' + d.id + '"' + (d.id === med ? ' selected' : '') + '>' + esc(d.nombre) + '</option>'; }).join('') + '</select></label>' +
      '<div id="olLabNuevo" class="full ol-labnuevo" hidden><span class="pos-lbl">Nuevo laboratorio</span><div class="exp-form rc-g4"><label class="rc-span2">Nombre *<input id="olLabNombre" maxlength="120"></label><label>Teléfono / WhatsApp<input id="olLabTel" maxlength="40"></label><label>Correo<input id="olLabCorreo" type="email" maxlength="120"></label><label class="rc-span2">Persona de contacto<input id="olLabContacto" maxlength="120"></label><label class="rc-span2">Dirección<input id="olLabDir" maxlength="200"></label></div></div>' +
      '<label class="rc-span2">Tipo de trabajo *<input id="olTrabajo" list="olListaTrabajos" maxlength="120" required value="' + esc(o ? o.trabajo : '') + '" placeholder="Ej.: Corona unitaria"></label>' +
      '<label class="rc-span2">Piezas (FDI)<input id="olPiezas" maxlength="120" value="' + esc(o ? o.piezas || '' : '') + '" placeholder="Ej.: 36 o 14 a 16"></label>' +
      (sug.length ? '<p class="full ol-sug">Del odontograma: ' + sug.map(function (n) { return '<button type="button" data-ol-pieza="' + n + '">' + n + '</button>'; }).join('') + '</p>' : '') +
      '<label class="rc-span2">Material<input id="olMaterial" list="olListaMat" maxlength="80" value="' + esc(o ? o.material || '' : '') + '"></label>' +
      '<label>Color (VITA)<select id="olColor">' + opciones(COLORES, o && o.color, 'No aplica') + '</select></label>' +
      '<label>Impresión<select id="olImpresion">' + opciones(IMPRESIONES, o && o.impresion, 'Elegir…') + '</select></label>' +
      '<div class="full"><span class="pos-lbl">Se envía al laboratorio</span><div class="ag-avisos ag-chips">' + ENVIA.map(function (x) { return '<label><input type="checkbox" data-ol-envia value="' + esc(x) + '"' + (o && (o.envia || []).indexOf(x) >= 0 ? ' checked' : '') + '> ' + esc(x) + '</label>'; }).join('') + '</div></div>' +
      '<label class="full rc-ind-campo">Indicaciones para el laboratorio<textarea id="olInd" rows="3" maxlength="1500" placeholder="Ej.: contacto proximal firme, oclusión con antagonista, línea de terminación en hombro, caracterización incisal">' + esc(o ? o.indicaciones || '' : '') + '</textarea></label>' +
      '</div></fieldset>' +
      '<fieldset class="pos-sec"><legend>Fechas, costo y seguimiento</legend><div class="exp-form rc-g4">' +
      '<label>Fecha de envío<input id="olEnvio" type="date" value="' + (o ? o.fecha_envio || '' : hoy()) + '"></label>' +
      '<label>Entrega prometida<input id="olEntrega" type="date" value="' + (o ? o.fecha_entrega || '' : '') + '"></label>' +
      '<label>Costo del laboratorio (Q)<input id="olCosto" type="number" min="0" step="0.01" value="' + (o && o.costo != null ? o.costo : '') + '"></label>' +
      '<label>Estado<select id="olEstado">' + Object.keys(ESTADOS).map(function (e) { return '<option value="' + e + '"' + ((o ? o.estado : 'enviada') === e ? ' selected' : '') + '>' + ESTADOS[e] + '</option>'; }).join('') + '</select></label>' +
      '<label class="rc-span2">Cita de colocación<select id="olCita"><option value="">Sin cita</option>' + citasPac.map(function (c) { return '<option value="' + c.id + '"' + (o && o.cita_id === c.id ? ' selected' : '') + '>' + fechaCorta(c.fecha) + ' · ' + String(c.hora).slice(0, 5) + ' · ' + esc(c.servicio || '') + '</option>'; }).join('') + '</select></label>' +
      '<p id="olEntregaInfo" class="rc-span2 dlg-msg"></p>' +
      '</div></fieldset>' +
      '<p class="rc-reg">' + (nueva ? 'Número, fecha, hora y usuario se registran al grabar · ' + esc((window.PD_SESION && window.PD_SESION.usuario()) || 'Sin usuario') : 'Registrada por ' + esc(o.creada_por || '') + ' · ' + fechaHora(o.creada)) + '</p>' +
      '<div class="rc-pie"><button type="button" class="adm-btn" data-ol-cancelar>Cancelar</button><button type="submit" class="dlg-submit" id="olGrabar">' + (nueva ? 'Grabar orden' : 'Guardar cambios') + '</button></div>' +
      '</form>';
    entregaManual = !nueva && !!(o && o.fecha_entrega);
    if (nueva) sugerirEntrega();
  }
  // Entrega prometida según el tipo de trabajo (días hábiles habituales), si no se cambió a mano
  var entregaManual = false;
  function sugerirEntrega() {
    if (!$('olEntrega')) return;
    var t = $('olTrabajo').value.trim(), k = Object.keys(TRABAJOS).filter(function (x) { return norm(x) === norm(t); })[0];
    var dias = k ? TRABAJOS[k] : 7, base = $('olEnvio').value || hoy();
    if (!entregaManual) $('olEntrega').value = diasHabiles(base, dias);
    $('olEntregaInfo').textContent = 'Entrega sugerida: ' + dias + ' días hábiles después del envío' + (k ? ' (habitual para «' + k + '»).' : '.');
  }

  function pintar() {
    pintarLista();
    if (editando) { pintarFormulario(editando === 'nueva' ? null : ordenes.filter(function (o) { return o.id === editando; })[0]); return; }
    var o = ordenes.filter(function (x) { return x.id === elegida; })[0];
    if (o) pintarDetalle(o); else pintarVacio();
  }

  async function grabar(e) {
    e.preventDefault();
    var trabajo = $('olTrabajo').value.trim();
    if (!trabajo) { aviso('Indica el tipo de trabajo.', true); $('olTrabajo').focus(); return; }
    var labId = $('olLab').value;
    $('olGrabar').disabled = true;
    // Laboratorio nuevo
    if (labId === 'nuevo') {
      var nom = $('olLabNombre').value.trim();
      if (!nom) { $('olGrabar').disabled = false; aviso('Escribe el nombre del laboratorio nuevo.', true); $('olLabNombre').focus(); return; }
      var rl = await sb.from('laboratorios').insert({ nombre: nom, telefono: $('olLabTel').value.trim() || null, correo: $('olLabCorreo').value.trim() || null, contacto: $('olLabContacto').value.trim() || null, direccion: $('olLabDir').value.trim() || null }).select('*').single();
      if (rl.error) { $('olGrabar').disabled = false; aviso(traducir(rl.error), true); return; }
      labs.push(rl.data); labId = rl.data.id;
    }
    var datos = {
      laboratorio_id: labId ? +labId : null, dentista_id: $('olDent').value ? +$('olDent').value : null, cita_id: $('olCita').value ? +$('olCita').value : null,
      trabajo: trabajo, piezas: $('olPiezas').value.trim() || null, material: $('olMaterial').value.trim() || null, color: $('olColor').value || null,
      impresion: $('olImpresion').value || null, envia: [].map.call(document.querySelectorAll('[data-ol-envia]:checked'), function (c) { return c.value; }),
      indicaciones: $('olInd').value.trim() || null, fecha_envio: $('olEnvio').value || null, fecha_entrega: $('olEntrega').value || null,
      costo: $('olCosto').value === '' ? null : Number($('olCosto').value), estado: $('olEstado').value
    };
    aviso('Grabando…');
    var id = editando === 'nueva' ? null : editando;
    var r = id ? await sb.from('ordenes_lab').update(datos).eq('id', id).select('*').single()
      : await sb.from('ordenes_lab').insert(Object.assign({ paciente_id: paciente.id }, datos)).select('*').single();
    if (r.error) { $('olGrabar').disabled = false; aviso(traducir(r.error), true); return; }
    var p = paciente;
    await cargar(p, r.data.id);
    aviso(id ? 'Cambios guardados.' : 'Orden ' + r.data.numero + ' grabada. Ya puedes imprimirla o enviarla al laboratorio.');
  }
  async function cambiarEstado(o, boton) {
    var nuevo = $('olNuevoEstado').value, nota = $('olNota').value.trim();
    if (nuevo === o.estado && !nota) { aviso('Elige un estado diferente o escribe una nota.', true); return; }
    boton.disabled = true;
    if (nuevo !== o.estado) {
      var r = await sb.from('ordenes_lab').update({ estado: nuevo }).eq('id', o.id).select('*').single();
      if (r.error) { boton.disabled = false; aviso(traducir(r.error), true); return; }
    }
    if (nota) {
      await cargarHistorial(o.id);
      var ult = (historial[o.id] || []).slice(-1)[0];
      if (ult) await sb.from('ordenes_lab_estados').update({ nota: nota }).eq('id', ult.id);
    }
    await cargar(paciente, o.id);
    aviso('Estado actualizado: ' + ESTADOS[nuevo] + '.');
  }

  // Texto para WhatsApp o correo al laboratorio
  function textoOrden(o) {
    var d = dentDe(o.dentista_id), p = paciente;
    return 'Plus Dental · Orden de laboratorio ' + (o.numero || '') + '\n' +
      'Paciente: ' + p.nombre + (p.fecha_nacimiento ? ' (' + edad(p.fecha_nacimiento) + ')' : '') + ' · Código ' + String(p.id).padStart(4, '0') + '\n' +
      'Dentista: ' + (d ? d.nombre : '—') + '\n' +
      'Trabajo: ' + o.trabajo + (o.piezas ? ' · Piezas: ' + o.piezas : '') + '\n' +
      (o.material || o.color ? 'Material: ' + (o.material || '—') + ' · Color: ' + (o.color || '—') + '\n' : '') +
      (o.impresion ? 'Impresión: ' + o.impresion + '\n' : '') +
      ((o.envia || []).length ? 'Se envía: ' + o.envia.join(', ') + '\n' : '') +
      (o.indicaciones ? 'Indicaciones: ' + o.indicaciones + '\n' : '') +
      'Entrega solicitada: ' + fechaCorta(o.fecha_entrega) + '\nGracias.';
  }

  async function imprimir(o) {
    var imp = window.PD_IMPRESION;
    if (!imp) return;
    var l = labDe(o.laboratorio_id), d = dentDe(o.dentista_id), p = paciente;
    var firma = window.PD_FIRMA ? await window.PD_FIRMA.cargar(o.dentista_id, d && d.nombre) : null;
    var caja = 'background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px';
    var dato = function (t, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t + '</span><b style="font-size:13.5px">' + v + '</b></div>'; };
    var sec = function (t) { return '<div style="font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#005A87;font-weight:800;margin:16px 0 8px;border-bottom:1px solid #D9E4EC;padding-bottom:4px">' + t + '</div>'; };
    var celda = 'padding:8px 6px;border-bottom:1px solid #D9E4EC;text-align:left;vertical-align:top';
    imp.imprimir(imp.encabezado('Orden de laboratorio · ' + esc(o.numero || '')) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div style="' + caja + '"><div style="font-size:10.5px;letter-spacing:.12em;font-weight:800;color:#005A87;margin-bottom:6px">LABORATORIO</div><b style="font-size:15px">' + esc(l ? l.nombre : '—') + '</b>' +
      (l ? '<div style="font-size:12.5px;color:#475B68;margin-top:3px;line-height:1.55">' + [l.contacto ? 'Contacto: ' + esc(l.contacto) : '', l.telefono ? 'Tel. ' + esc(l.telefono) : '', l.correo ? esc(l.correo) : '', l.direccion ? esc(l.direccion) : ''].filter(Boolean).join('<br>') + '</div>' : '') + '</div>' +
      '<div style="' + caja + '"><div style="font-size:10.5px;letter-spacing:.12em;font-weight:800;color:#005A87;margin-bottom:6px">PACIENTE</div><b style="font-size:15px">' + esc(p.nombre) + '</b>' +
      '<div style="font-size:12.5px;color:#475B68;margin-top:3px;line-height:1.55">Código ' + String(p.id).padStart(4, '0') + (p.fecha_nacimiento ? ' · ' + edad(p.fecha_nacimiento) : '') + '<br>Dentista: ' + esc(d ? d.nombre : '—') + (d && d.colegiado ? ' · Col. ' + esc(d.colegiado) : '') + '</div></div></div>' +
      sec('Trabajo solicitado') +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0B2B40;color:#FFFFFF">' + ['Trabajo', 'Piezas (FDI)', 'Material', 'Color', 'Impresión'].map(function (h) { return '<th style="' + celda + ';border-bottom:0;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em">' + h + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody><tr><td style="' + celda + '"><b>' + esc(o.trabajo) + '</b></td><td style="' + celda + '">' + esc(o.piezas || '—') + '</td><td style="' + celda + '">' + esc(o.material || '—') + '</td><td style="' + celda + '">' + esc(o.color || '—') + '</td><td style="' + celda + '">' + esc(o.impresion || '—') + '</td></tr></tbody></table>' +
      ((o.envia || []).length ? sec('Se envía al laboratorio') + '<div style="font-size:13px;line-height:1.8">' + o.envia.map(function (x) { return '☑ ' + esc(x); }).join('&nbsp;&nbsp;&nbsp; ') + '</div>' : '') +
      (o.indicaciones ? sec('Indicaciones') + '<div style="font-size:13.5px;line-height:1.6;white-space:pre-line">' + esc(o.indicaciones) + '</div>' : '') +
      sec('Fechas') + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' + dato('Fecha de envío', fechaCorta(o.fecha_envio)) + dato('Entrega solicitada', fechaCorta(o.fecha_entrega)) + dato('Estado', ESTADOS[o.estado]) + dato('Costo acordado', q(o.costo)) + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;margin-top:34px;flex-wrap:wrap">' +
      (firma ? window.PD_FIRMA.bloque(firma, { etiqueta: 'Firma y sello del dentista solicitante' }) : '<div style="width:260px;border-top:1.5px solid #0B2B40;padding-top:6px;text-align:center;font-size:12.5px">' + esc(d ? 'Dr(a). ' + d.nombre : 'Dentista solicitante') + '</div>') +
      '<div style="width:240px;text-align:center"><div style="border-top:1.5px solid #0B2B40;padding-top:7px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#475B68">Recibido por el laboratorio<br><span style="font-weight:600;letter-spacing:0;text-transform:none">Fecha: ____ / ____ / ______</span></div></div></div>' +
      '<p style="margin-top:20px;font-size:11px;color:#5A6D7A">Orden ' + esc(o.numero || '') + ' registrada por ' + esc(o.creada_por || '') + ' el ' + fechaHora(o.creada) + '. Ante dudas, comuníquese con Plus Dental: +502 3756-5739.</p></div>');
  }

  // ---------- Eventos ----------
  $('olNueva').addEventListener('click', function () { if (!paciente) return; editando = 'nueva'; aviso(''); pintar(); $('olLab').focus(); });
  $('olLista').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-ol]');
    if (!b) return;
    elegida = +b.dataset.ol; editando = null; aviso('');
    if (!historial[elegida]) await cargarHistorial(elegida);
    pintar();
  });
  $('olPanel').addEventListener('click', function (e) {
    var o = ordenes.filter(function (x) { return x.id === elegida; })[0];
    if (e.target.closest('[data-ol-mod]') && o) { editando = o.id; aviso(''); pintar(); return; }
    if (e.target.closest('[data-ol-imp]') && o) { imprimir(o); return; }
    var be = e.target.closest('[data-ol-estado]');
    if (be && o) { cambiarEstado(o, be); return; }
    if (e.target.closest('[data-ol-cancelar]')) { editando = null; aviso(''); pintar(); return; }
    var pz = e.target.closest('[data-ol-pieza]');
    if (pz) { var v = $('olPiezas').value.split(/[,\s]+/).filter(Boolean); if (v.indexOf(pz.dataset.olPieza) < 0) v.push(pz.dataset.olPieza); $('olPiezas').value = v.join(', '); }
  });
  $('olPanel').addEventListener('submit', function (e) { if (e.target.id === 'olForm') grabar(e); });
  $('olPanel').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'olLab') $('olLabNuevo').hidden = t.value !== 'nuevo';
    if (t.id === 'olTrabajo' || t.id === 'olEnvio') sugerirEntrega();
    if (t.id === 'olEntrega') entregaManual = true;
  });
  document.body.insertAdjacentHTML('beforeend',
    '<datalist id="olListaTrabajos">' + Object.keys(TRABAJOS).map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>' +
    '<datalist id="olListaMat">' + MATERIALES.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('') + '</datalist>');

  window.PD_LAB = { cargar: cargar };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () {},
    limpiar: function () { paciente = null; ordenes = []; labs = []; dentistas = []; citasPac = []; historial = {}; elegida = null; editando = null; $('olLista').innerHTML = ''; $('olPanel').innerHTML = ''; aviso(''); }
  });
})();
