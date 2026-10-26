// Plus Dental — «Mi expediente»: portal de solo lectura para usuarios de tipo Cliente.
// El paciente se enlaza con su usuario en el expediente (campo «Usuario del portal»). Las funciones mi_portal() y
// mi_portal_detalle() de Supabase devuelven únicamente la información del paciente asignado al usuario conectado.
// Pestañas iguales a las del expediente (sin poder modificar nada) y una pestaña «Reportes» para imprimir o guardar en PDF.
// Si el usuario está asignado a un dentista, ve «Mis pacientes»: solo sus pacientes (dentista_pacientes) y el expediente de cada uno.
(function () {
  var sb = window.PD_SB;
  if (!sb) return;

  var BUCKET = 'expedientes';
  var PESTANAS = [['datos', 'Datos'], ['historia', 'Historia médica'], ['odontograma', 'Odontograma'], ['tratamientos', 'Tratamientos'],
    ['notas', 'Notas'], ['radiografias', 'Radiografías'], ['recetas', 'Recetas'], ['lab', 'Órdenes Laboratorio'], ['reportes', 'Reportes']];
  var ESTADOS_CITA = { pendiente: 'Programado', confirmada: 'Confirmado', reprogramada: 'Reprogramado', atendida: 'Atendido' };
  var ESTADOS_TRAT = { pendiente: 'Pendiente', proceso: 'En proceso', finalizado: 'Finalizado' };
  var ESTADOS_LAB = { enviada: 'Enviada', proceso: 'En proceso', prueba: 'En prueba', recibida: 'Recibida', colocada: 'Colocada', devuelta: 'Devuelta', cancelada: 'Cancelada' };
  var ESTADOS_PRE = { enviado: 'Enviado', aprobado: 'Aprobado', rechazado: 'No aprobado' };
  var METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Depósito' };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var datos = null, detalle = null, pestana = 'datos', firmas = {}, dent = null, filtro = '';

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(n) { return 'Q' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fecha(f) { if (!f) return '—'; var p = String(f).slice(0, 10).split('-'); return +p[2] + ' ' + MESES[p[1] - 1] + ' ' + p[0]; }
  function fechaLarga(f) { var p = String(f).slice(0, 10).split('-'), d = new Date(+p[0], p[1] - 1, +p[2]); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + p[0]; }
  function anios(f) {
    if (!f) return null;
    var n = new Date(f + 'T00:00:00'), h = new Date(), a = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
    return a;
  }
  function edad(f) { var a = anios(f); return a == null ? '' : a + ' años'; }
  function tarjeta(titulo, cuerpo, extra) { return '<article class="mp-card' + (extra || '') + '"><h3>' + titulo + '</h3>' + cuerpo + '</article>'; }
  function vacio(t) { return '<p class="mp-vacio">' + t + '</p>'; }
  function aviso(t) { $('mpTabs').innerHTML = ''; $('mpCuerpo').innerHTML = '<div class="mp-aviso">' + t + '</div>'; }
  function pill(clase, texto) { return '<span class="mp-pill mp-' + clase + '">' + texto + '</span>'; }
  function lista(items) { return '<ul class="mp-lista">' + items.join('') + '</ul>'; }
  function imp(tipo, i, texto) { return '<button type="button" class="adm-btn" data-mp-imp="' + tipo + '" data-i="' + i + '">' + (texto || 'Imprimir') + '</button>'; }
  function faltaDetalle() { return vacio('Esta sección todavía no está disponible. Comunícate con la clínica al +502 3756-5739.'); }

  async function abrir() {
    $('miPortal').hidden = false;
    $('mpNombre').textContent = 'Cargando…'; $('mpSub').textContent = '';
    $('mpTabs').innerHTML = ''; $('mpCuerpo').innerHTML = '';
    $('miPortal').scrollIntoView({ behavior: 'smooth', block: 'start' });
    var dr = await sb.rpc('dentista_pacientes');
    if (!dr.error && dr.data && dr.data.ok) { dent = dr.data; datos = detalle = null; listaDentista(); return; }
    dent = null;
    var r = await Promise.all([sb.rpc('mi_portal'), sb.rpc('mi_portal_detalle')]);
    if (r[0].error) {
      datos = null; $('mpNombre').textContent = 'Mi expediente';
      aviso(/mi_portal/.test(r[0].error.message || '') ? 'El portal todavía no está habilitado. Comunícate con la clínica al +502 3756-5739.' : 'No se pudo cargar tu información. Intenta de nuevo en unos minutos.');
      return;
    }
    datos = r[0].data;
    detalle = !r[1].error && r[1].data && r[1].data.ok ? r[1].data : null;
    if (!datos || !datos.ok) {
      $('mpNombre').textContent = 'Mi expediente';
      aviso(datos && datos.motivo === 'sin_paciente'
        ? 'Tu usuario <b>' + esc(datos.usuario) + '</b> aún no está enlazado a un expediente. Pide en recepción que lo asignen a tu ficha de paciente, o escríbenos al <a href="https://wa.me/50237565739" target="_blank" rel="noopener">WhatsApp +502 3756-5739</a>.'
        : 'Inicia sesión para ver tu expediente.');
      return;
    }
    mostrarExpediente();
  }

  // Encabezado y pestañas del expediente abierto (del paciente conectado, o del paciente elegido por el dentista)
  function mostrarExpediente() {
    var p = datos.paciente, c = datos.citas[0];
    $('mpEyebrow').textContent = dent ? 'Portal del dentista · expediente' : 'Mi expediente';
    $('mpNombre').textContent = p.nombre;
    $('mpSub').textContent = [p.dpi ? 'DPI ' + p.dpi : '', edad(p.fecha_nacimiento), c ? 'Próxima cita: ' + fechaLarga(c.fecha) + ', ' + c.hora : ''].filter(Boolean).join(' · ');
    $('mpTabs').innerHTML = (dent ? '<button type="button" class="mp-volver" data-mp-volver>← Mis pacientes</button>' : '') +
      PESTANAS.map(function (t) { return '<button type="button" role="tab" data-mp-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('');
    ver(pestana);
  }

  // ---------- Dentista: «Mis pacientes» ----------
  function listaDentista() {
    $('mpEyebrow').textContent = 'Portal del dentista';
    $('mpNombre').textContent = 'Mis pacientes';
    $('mpSub').textContent = 'Dr(a). ' + dent.dentista.nombre + (dent.dentista.colegiado ? ' · Colegiado ' + dent.dentista.colegiado : '') + ' · ' + dent.pacientes.length + (dent.pacientes.length === 1 ? ' paciente' : ' pacientes');
    $('mpTabs').innerHTML = '';
    $('mpCuerpo').innerHTML = tarjeta('Pacientes asignados o atendidos', '<input id="mpBuscar" class="mp-buscar" type="search" placeholder="Buscar por nombre, DPI o teléfono" value="' + esc(filtro) + '" aria-label="Buscar paciente">' +
      '<div id="mpPacientes"></div>', ' mp-dos');
    pintarPacientes();
  }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function pintarPacientes() {
    var t = sinTildes(filtro).trim();
    var l = dent.pacientes.filter(function (p) { return !t || sinTildes(p.nombre + ' ' + (p.dpi || '') + ' ' + (p.telefono || '')).indexOf(t) >= 0; });
    $('mpPacientes').innerHTML = l.length ? lista(l.map(function (p) {
      var info = [p.dpi ? 'DPI ' + p.dpi : '', p.ultima ? 'Última cita ' + fecha(p.ultima) : '', p.proxima ? 'Próxima ' + fecha(p.proxima) : ''].filter(Boolean).join(' · ');
      return '<li><div class="mp-txt"><b>' + esc(p.nombre) + '</b><span>' + esc(info || 'Sin citas registradas') + '</span></div>' + (p.asignado ? pill('t-finalizado', 'Asignado') : '') +
        '<button type="button" class="adm-btn" data-mp-paciente="' + p.id + '">Ver expediente</button></li>';
    })) : vacio(dent.pacientes.length ? 'Ningún paciente coincide con la búsqueda.' : 'Aún no tienes pacientes asignados ni atendidos.');
  }
  async function abrirPaciente(id) {
    $('mpCuerpo').innerHTML = vacio('Cargando expediente…');
    var r = await sb.rpc('dentista_expediente', { p_paciente: id });
    if (r.error || !r.data || !r.data.ok || !r.data.datos.ok) { listaDentista(); return; }
    datos = r.data.datos; detalle = r.data.detalle && r.data.detalle.ok ? r.data.detalle : null; firmas = {}; pestana = 'datos';
    mostrarExpediente();
    $('miPortal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function cerrar() { $('miPortal').hidden = true; $('mpTabs').innerHTML = ''; $('mpCuerpo').innerHTML = ''; datos = detalle = dent = null; firmas = {}; pestana = 'datos'; filtro = ''; }

  function ver(id) {
    pestana = id;
    document.querySelectorAll('#mpTabs [data-mp-tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mpTab === id); });
    $('mpCuerpo').innerHTML = VISTAS[id]();
    if (id === 'radiografias') cargarArchivos();
  }

  var VISTAS = {
    datos: function () {
      var p = datos.paciente;
      var dato = function (k, v) { return '<div><span>' + k + '</span><b>' + (v ? esc(v) : '—') + '</b></div>'; };
      return tarjeta(dent ? 'Datos del paciente' : 'Mis datos', '<div class="mp-datos">' + dato('DPI', p.dpi) + dato('NIT', p.nit) + dato('Fecha de nacimiento', p.fecha_nacimiento && fecha(p.fecha_nacimiento) + ' · ' + edad(p.fecha_nacimiento)) +
        dato('Teléfono', p.telefono) + dato('Correo', p.correo) + dato('Médico tratante', p.medico) + '<div class="mp-ancho"><span>Dirección</span><b>' + esc(p.direccion || '—') + '</b></div></div>' +
        (p.alergias ? '<p class="mp-alerta"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
        (dent ? '' : '<p class="mp-nota">¿Algún dato no es correcto? Avísanos en recepción para actualizarlo.</p>')) +
      tarjeta('Próximas citas', datos.citas.length ? lista(datos.citas.map(function (c) {
        return '<li><div class="mp-fecha"><b>' + esc(c.hora) + '</b><span>' + fechaLarga(c.fecha) + '</span></div><div class="mp-txt"><b>' + esc(c.servicio) + '</b><span>' + esc(c.dentista ? 'Dr(a). ' + c.dentista : 'Plus Dental') + '</span></div>' +
          pill(c.estado, ESTADOS_CITA[c.estado] || c.estado) + '</li>';
      })) : vacio(dent ? 'No tiene citas programadas.' : 'No tienes citas programadas.') + (dent ? '' : '<a class="mp-link" href="#agenda" data-mp-cerrar>Reservar una cita</a>'));
    },
    historia: function () {
      if (!detalle) return tarjeta('Historia médica', faltaDetalle(), ' mp-dos');
      return tarjeta('Historia médica', detalle.historias.length ? lista(detalle.historias.map(function (h) {
        var c = function (k, v) { return '<div><span>' + k + '</span><b>' + esc(v || 'Ninguna') + '</b></div>'; };
        return '<li class="mp-bloque"><div class="mp-txt"><b>' + fechaLarga(h.fecha) + (h.cita_numero ? ' · cita N.º ' + h.cita_numero : '') + '</b></div>' +
          '<div class="mp-datos">' + c('Alergias', h.alergias) + c('Enfermedades', h.enfermedades) + c('Medicamentos', h.medicamentos) + '</div></li>';
      })) : vacio('Aún no hay registros de historia médica.'), ' mp-dos');
    },
    odontograma: function () {
      if (!detalle) return tarjeta('Odontograma', faltaDetalle(), ' mp-dos');
      var img = window.Odontograma && window.Odontograma.imagen && detalle.odontograma ? window.Odontograma.imagen(detalle.odontograma, anios(detalle.fecha_nacimiento)) : '';
      return tarjeta('Odontograma', (img ? '<div class="mp-odg">' + img + '</div>' : vacio('Aún no hay odontograma registrado.')), ' mp-dos') +
        tarjeta('Historial de cambios', detalle.odontograma_cambios.length ? lista(detalle.odontograma_cambios.map(function (c) {
          return '<li><div class="mp-txt"><b>' + (c.pieza ? 'Pieza ' + c.pieza + ' · ' : '') + esc(c.descripcion) + '</b><span>' + fecha(c.fecha) + (c.observaciones ? ' · ' + esc(c.observaciones) : '') + '</span></div></li>';
        })) : vacio('Sin cambios registrados.'), ' mp-dos');
    },
    tratamientos: function () {
      return tarjeta('Tratamientos', datos.tratamientos.length ? tablaTrat(datos.tratamientos) : vacio('Aún no hay tratamientos en proceso o realizados.'), ' mp-dos');
    },
    notas: function () {
      if (!detalle) return tarjeta('Notas de visita', faltaDetalle(), ' mp-dos');
      return tarjeta('Notas de visita', detalle.notas.length ? lista(detalle.notas.map(function (n) {
        return '<li class="mp-bloque"><div class="mp-txt"><b>' + fechaLarga(n.fecha) + '</b><span>' + esc(n.autor ? 'Registrada por ' + n.autor : '') + '</span></div><p class="mp-texto">' + esc(n.texto) + '</p></li>';
      })) : vacio('Aún no hay notas de visita.'), ' mp-dos');
    },
    radiografias: function () {
      return tarjeta('Radiografías y fotografías', '<div id="mpRx" class="mp-rx">' + vacio('Cargando…') + '</div>', ' mp-dos');
    },
    recetas: function () {
      return tarjeta('Recetas', datos.recetas.length ? lista(datos.recetas.map(function (r, i) {
        return '<li><div class="mp-txt"><b>' + esc(r.numero || 'Receta') + ' · ' + fecha(r.fecha) + '</b><span>' + esc(r.items.map(function (x) { return x.medicamento; }).join(', ') || 'Sin medicamentos') +
          (r.dentista ? ' · Dr(a). ' + esc(r.dentista) : '') + '</span></div>' + imp('receta', i) + '</li>';
      })) : vacio('No tienes recetas registradas.'), ' mp-dos');
    },
    lab: function () {
      if (!detalle) return tarjeta('Órdenes de laboratorio', faltaDetalle(), ' mp-dos');
      return tarjeta('Órdenes de laboratorio', detalle.ordenes_lab.length ? lista(detalle.ordenes_lab.map(function (o) {
        var fechas = [o.fecha_envio ? 'Enviada ' + fecha(o.fecha_envio) : '', o.fecha_entrega ? 'Entrega ' + fecha(o.fecha_entrega) : '', o.fecha_recibida ? 'Recibida ' + fecha(o.fecha_recibida) : ''].filter(Boolean).join(' · ');
        return '<li><div class="mp-txt"><b>' + esc(o.numero) + ' · ' + esc(o.trabajo) + (o.piezas ? ' <small>· pieza ' + esc(o.piezas) + '</small>' : '') + '</b><span>' +
          esc([o.material, o.color ? 'color ' + o.color : '', o.laboratorio].filter(Boolean).join(' · ')) + (fechas ? '<br>' + fechas : '') + '</span></div>' + pill('l-' + o.estado, ESTADOS_LAB[o.estado] || o.estado) + '</li>';
      })) : vacio('No tienes órdenes de laboratorio.'), ' mp-dos');
    },
    reportes: function () {
      var s = datos.saldo || { cargos: 0, abonos: 0, saldo: 0 };
      var grupo = function (titulo, filas, tVacio) { return '<h4 class="mp-sub">' + titulo + '</h4>' + (filas.length ? lista(filas) : vacio(tVacio)); };
      var movs = movimientos(), ct = citasHist();
      var filaCita = function (c) {
        return '<li><div class="mp-fecha"><b>' + esc(c.hora) + '</b><span>' + fecha(c.fecha) + '</span></div><div class="mp-txt"><b>' + esc(c.servicio) + '</b><span>' + esc(c.dentista ? 'Dr(a). ' + c.dentista : 'Plus Dental') +
          (c.reprogramada_de ? ' · antes ' + esc(c.reprogramada_de) : '') + '</span></div>' + pill(c.estado, ESTADOS_CITA[c.estado] || c.estado) + '</li>';
      };
      return tarjeta('Estado de cuenta', '<div class="mp-saldo">' +
          '<div><span>Tratamientos</span><b>' + q(s.cargos) + '</b></div><div><span>Pagado</span><b>' + q(s.abonos) + '</b></div>' +
          '<div class="' + (s.saldo > 0.004 ? 'mp-debe' : 'mp-ok') + '"><span>' + (s.saldo < -0.004 ? 'Saldo a favor' : 'Saldo pendiente') + '</span><b>' + q(Math.abs(s.saldo)) + '</b></div></div>' +
          (movs.length ? '<div class="mp-scroll"><table class="mp-tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th class="mp-num">Cargo</th><th class="mp-num">Abono</th><th class="mp-num">Saldo</th></tr></thead><tbody>' +
            movs.map(function (m) { return '<tr><td>' + fecha(m.fecha) + '</td><td>' + esc(m.concepto) + '</td><td class="mp-num">' + (m.cargo ? q(m.cargo) : '—') + '</td><td class="mp-num">' + (m.abono ? q(m.abono) : '—') + '</td><td class="mp-num"><b>' + saldoTxt(m.saldo) + '</b></td></tr>'; }).join('') +
            '</tbody></table></div>' : vacio('Aún no hay movimientos en tu cuenta.')) +
          '<div class="mp-acciones">' + imp('cuenta', 0, 'Imprimir estado de cuenta') + imp('trat', 0, 'Imprimir tratamientos') + '</div>', ' mp-dos') +
        tarjeta('Citas', '<h4 class="mp-sub">Agendadas (' + ct.agendadas.length + ')</h4>' + (ct.agendadas.length ? lista(ct.agendadas.map(filaCita)) : vacio('No hay citas agendadas.')) +
          '<h4 class="mp-sub">Atendidas (' + ct.atendidas.length + ')</h4>' + (ct.atendidas.length ? lista(ct.atendidas.map(filaCita)) : vacio('Aún no hay citas atendidas.')) +
          ((ct.agendadas.length || ct.atendidas.length) ? '<div class="mp-acciones">' + imp('citas', 0, 'Imprimir citas') + '</div>' : '')) +
        tarjeta('Documentos',
          grupo('Presupuestos', detalle ? detalle.presupuestos.map(function (p, i) {
            return '<li><div class="mp-txt"><b>' + esc(p.codigo || 'Presupuesto ' + p.id) + ' · ' + fecha(p.fecha) + '</b><span>' + q(totalPre(p)) + ' · ' + (ESTADOS_PRE[p.estado] || p.estado) + '</span></div>' + imp('pre', i) + '</li>';
          }) : [], 'No tienes presupuestos.') +
          grupo('Comprobantes de pago', detalle ? detalle.comprobantes.map(function (g, i) {
            return '<li><div class="mp-txt"><b>' + esc(docPago(g)) + ' · ' + fecha(g.fecha) + '</b><span>' + q(g.monto) + ' · ' + esc(METODOS[g.metodo] || g.metodo) + '</span></div>' + imp('pago', i) + '</li>';
          }) : [], 'No tienes pagos registrados.') +
          grupo('Constancias médicas', datos.constancias.map(function (c, i) {
            return '<li><div class="mp-txt"><b>' + esc(c.numero) + ' · ' + fecha(c.fecha) + '</b><span>' + esc(c.dirigida || 'A quien interese') + '</span></div>' + imp('constancia', i) + '</li>';
          }), 'No tienes constancias emitidas.') +
          grupo('Recetas', datos.recetas.map(function (r, i) {
            return '<li><div class="mp-txt"><b>' + esc(r.numero || 'Receta') + ' · ' + fecha(r.fecha) + '</b></div>' + imp('receta', i) + '</li>';
          }), 'No tienes recetas registradas.'));
    }
  };

  function tablaTrat(lista) {
    return '<table class="mp-tabla"><thead><tr><th>Fecha</th><th>Tratamiento</th><th>Estado</th><th class="mp-num">Total</th></tr></thead><tbody>' + lista.map(function (t) {
      return '<tr><td>' + fecha(t.fecha) + '</td><td>' + esc(t.tratamiento) + (t.pieza ? ' <small>· pieza ' + esc(t.pieza) + '</small>' : '') + '</td><td>' + pill('t-' + t.estado, ESTADOS_TRAT[t.estado] || t.estado) + '</td><td class="mp-num">' + q(t.total) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  // Movimientos de la cuenta: tratamientos finalizados (cargo) y pagos (abono), con el saldo acumulado
  function movimientos() {
    var saldo = 0;
    return datos.tratamientos.filter(function (t) { return t.estado === 'finalizado'; }).map(function (t) { return { fecha: t.fecha, concepto: t.tratamiento + (t.pieza ? ' (pieza ' + t.pieza + ')' : ''), cargo: Number(t.total), abono: 0 }; })
      .concat(datos.pagos.map(function (g) { return { fecha: g.fecha, concepto: 'Pago · ' + (METODOS[g.metodo] || g.metodo) + (g.concepto ? ' · ' + g.concepto : ''), cargo: 0, abono: Number(g.monto) }; }))
      .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); })
      .map(function (m) { saldo += m.cargo - m.abono; m.saldo = saldo; return m; });
  }
  // Citas agendadas (próximas primero) y atendidas (más recientes primero)
  function citasHist() {
    var h = datos.historial_citas || datos.citas || [];
    return {
      agendadas: h.filter(function (c) { return c.estado !== 'atendida'; }).sort(function (a, b) { return (a.fecha + a.hora).localeCompare(b.fecha + b.hora); }),
      atendidas: h.filter(function (c) { return c.estado === 'atendida'; })
    };
  }
  function saldoTxt(n) { return n < -0.004 ? q(-n) + ' a favor' : q(n); }
  function totalPre(p) {
    var sub = p.items.reduce(function (a, i) { return a + i.cantidad * i.precio; }, 0);
    return sub * (1 - (Number(p.descuento_pct) || 0) / 100);
  }
  function docPago(g) { return (g.tipo_documento === 'factura' ? 'Factura' : 'Recibo') + ' ' + ([g.serie, g.numero_factura].filter(Boolean).join('-') || g.correlativo || 'N.º ' + g.id); }

  // Radiografías: carpeta privada con el número del paciente (el permiso de Supabase solo deja ver la propia)
  async function cargarArchivos() {
    var caja = $('mpRx'), carpeta = String(datos.paciente.id);
    var r = await sb.storage.from(BUCKET).list(carpeta, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (pestana !== 'radiografias' || !$('mpRx')) return;
    var archivos = r.error ? [] : (r.data || []).filter(function (f) { return f.id; });
    if (!archivos.length) { caja.innerHTML = vacio(r.error ? 'No se pudieron cargar tus archivos.' : 'Aún no hay radiografías ni fotografías.'); return; }
    var u = await sb.storage.from(BUCKET).createSignedUrls(archivos.map(function (f) { return carpeta + '/' + f.name; }), 3600);
    if (u.error) { caja.innerHTML = vacio('No se pudieron cargar tus archivos.'); return; }
    caja.innerHTML = archivos.map(function (f, i) {
      var url = u.data[i] && u.data[i].signedUrl, nombre = f.name.replace(/^\d+-/, ''), pdf = /\.pdf$/i.test(f.name);
      return '<a class="mp-rx-item" href="' + esc(url) + '" target="_blank" rel="noopener">' + (pdf ? '<span class="mp-rx-pdf">PDF</span>' : '<img src="' + esc(url) + '" alt="' + esc(nombre) + '" loading="lazy">') +
        '<span>' + esc(nombre) + '<small>' + fecha(f.created_at) + '</small></span></a>';
    }).join('');
  }

  // ---------- Impresión (mismos formatos que la clínica) ----------
  // Firma y sello del médico: imágenes del almacenamiento privado (el permiso deja verlas al paciente)
  function aDataUrl(blob) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ok(null); }; r.readAsDataURL(blob); }); }
  async function imagen(ruta) { var d = await sb.storage.from(BUCKET).download(ruta); return d.error || !d.data ? null : aDataUrl(d.data); }
  async function firma(d) {
    var info = { nombre: d.dentista || '', colegiado: d.colegiado || '', firma: null, sello: null };
    if (d.dentista_id) {
      if (!firmas[d.dentista_id]) firmas[d.dentista_id] = Promise.all([imagen('fotos/firma-dentista-' + d.dentista_id + '.png'), imagen('fotos/sello-dentista-' + d.dentista_id + '.png')]);
      var im = await firmas[d.dentista_id]; info.firma = im[0]; info.sello = im[1];
    }
    return window.PD_FIRMA ? window.PD_FIRMA.bloque(info, { ancho: 320 })
      : '<div style="width:300px;border-top:1.5px solid #0B2B40;padding-top:6px;text-align:center">' + esc(info.nombre ? 'Dr(a). ' + info.nombre : 'Médico tratante') + '<br><small>Firma y sello</small></div>';
  }
  var celda = 'padding:8px 6px;border-bottom:1px solid #D9E4EC;text-align:left;vertical-align:top';
  function th(h, der) { return '<th style="' + celda + ';border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em' + (der ? ';text-align:right' : '') + '">' + h + '</th>'; }
  function td(v, der) { return '<td style="' + celda + (der ? ';text-align:right;white-space:nowrap' : '') + '">' + v + '</td>'; }
  function tabla(cab, filas, pie) {
    return '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#0B2B40;color:#FFFFFF">' + cab.join('') + '</tr></thead><tbody>' + filas.join('') + '</tbody>' + (pie || '') + '</table>';
  }
  function datoImp(t, v) { return '<div><span style="display:block;font-size:10px;color:#5A6D7A;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t + '</span><b style="font-size:13.5px">' + v + '</b></div>'; }
  function cajaPaciente(extra) {
    var p = datos.paciente;
    return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 16px;background:#F5F9FC;border:1px solid #D9E4EC;border-radius:12px;padding:12px 14px;margin-bottom:14px">' +
      datoImp('Paciente', esc(p.nombre)) + datoImp('DPI', esc(p.dpi || '—')) + datoImp('NIT', esc(p.nit || 'CF')) + (extra || datoImp('Teléfono', esc(p.telefono || '—'))) + '</div>';
  }
  function pie(t) { return '<p style="margin-top:28px;font-size:11px;color:#5A6D7A;text-align:center">Copia impresa desde «Mi expediente». ' + (t || 'Para cualquier consulta comuníquese con Plus Dental al +502 3756-5739.') + '</p></div>'; }
  function totalFila(t, v) { return '<tfoot><tr><td colspan="9" style="padding:10px 6px;text-align:right;font-weight:800;background:#EEF5FA;border-top:2px solid #0B2B40">' + t + ' ' + v + '</td></tr></tfoot>'; }

  var IMPRIMIR = {
    receta: async function (r) {
      var p = datos.paciente, prox = r.proxima_cita ? fechaLarga(r.proxima_cita) + (r.proxima_hora ? ' · ' + esc(r.proxima_hora) : '') : 'Según indicación médica';
      return encabezado('Receta médica · ' + esc(r.numero || '')) + cajaPaciente(datoImp('Fecha', fechaLarga(r.fecha))) +
        (p.alergias ? '<p style="margin:0 0 12px;padding:8px 12px;border-radius:10px;background:#FDE2E4;color:#9F1239;font-size:13px"><b>Alergias:</b> ' + esc(p.alergias) + '</p>' : '') +
        '<div style="font-family:Georgia,serif;font-size:30px;color:#005A87;margin:4px 0 6px">℞</div>' +
        tabla([th('#'), th('Medicamento'), th('Dosis'), th('Frecuencia'), th('Duración')], r.items.map(function (i, k) {
          return '<tr>' + td(k + 1) + td('<b>' + esc(i.medicamento) + '</b>') + td(esc(i.dosis || '—')) + td(esc(i.frecuencia || '—')) + td(esc(i.duracion || '—')) + '</tr>';
        })) +
        (r.indicaciones ? '<p style="margin:14px 0 0;font-size:13.5px;line-height:1.55"><b>Indicaciones:</b> ' + esc(r.indicaciones) + '</p>' : '') +
        '<div style="display:flex;justify-content:center;margin-top:44px"><div style="text-align:center;font-size:13px">' + await firma(r) +
        '<div style="margin-top:12px;font-size:12px;color:#22394A"><span style="color:#5A6D7A">Próxima cita:</span> <b>' + prox + '</b></div></div></div>' +
        pie('Siga las indicaciones de su médico; ante cualquier reacción, suspenda el medicamento y comuníquese con la clínica.');
    },
    constancia: async function (c) {
      var parrafos = String(c.texto).split(/\n\s*\n/).map(function (x) { return '<p style="margin:0 0 14px;text-align:justify;text-indent:32px">' + esc(x.trim()) + '</p>'; }).join('');
      return encabezado('Constancia médica · ' + esc(c.numero)) +
        '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:15px;line-height:1.85;color:#0B2B40;padding:6px 10px 0">' +
        '<div style="text-align:center;font-family:Manrope,system-ui,sans-serif;font-size:20px;font-weight:800;letter-spacing:.18em;margin:10px 0 24px">CONSTANCIA MÉDICA</div>' +
        '<p style="margin:0 0 16px;font-weight:700">' + esc(c.dirigida || 'A quien interese') + ':</p>' + parrafos + '</div>' +
        '<div style="display:flex;justify-content:center;margin-top:46px">' + await firma(c) + '</div>' +
        pie('Constancia ' + esc(c.numero) + '. Para verificarla comuníquese con Plus Dental al +502 3756-5739.');
    },
    cuenta: async function () {
      var s = datos.saldo || { cargos: 0, abonos: 0, saldo: 0 }, movs = movimientos();
      return encabezado('Estado de cuenta') + cajaPaciente(datoImp('Saldo', q(s.saldo))) +
        tabla([th('Fecha'), th('Concepto'), th('Cargo', 1), th('Abono', 1), th('Saldo', 1)], movs.length ? movs.map(function (m) {
          return '<tr>' + td(fecha(m.fecha)) + td(esc(m.concepto)) + td(m.cargo ? q(m.cargo) : '—', 1) + td(m.abono ? q(m.abono) : '—', 1) + td(saldoTxt(m.saldo), 1) + '</tr>';
        }) : ['<tr>' + td('—') + td('Sin movimientos') + td('', 1) + td('', 1) + td('', 1) + '</tr>'],
        totalFila('Tratamientos ' + q(s.cargos) + ' · Pagado ' + q(s.abonos) + ' · ' + (s.saldo < -0.004 ? 'Saldo a favor' : 'Saldo pendiente'), q(Math.abs(s.saldo)))) + pie();
    },
    citas: async function () {
      var ct = citasHist();
      var cab = [th('Fecha'), th('Hora'), th('Tratamiento'), th('Dentista'), th('Estado')];
      var filas = function (l) {
        return l.length ? l.map(function (c) { return '<tr>' + td(fechaLarga(c.fecha)) + td(esc(c.hora)) + td(esc(c.servicio) + (c.reprogramada_de ? '<br><small style="color:#5A6D7A">Reprogramada de ' + esc(c.reprogramada_de) + '</small>' : '')) + td(esc(c.dentista ? 'Dr(a). ' + c.dentista : '—')) + td(ESTADOS_CITA[c.estado] || 'Atendido') + '</tr>'; })
          : ['<tr>' + td('—') + td('') + td('Sin citas') + td('') + td('') + '</tr>'];
      };
      var sec = function (t) { return '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#005A87;font-weight:800;margin:20px 0 8px">' + t + '</div>'; };
      return encabezado('Citas del paciente') + cajaPaciente(datoImp('Médico tratante', esc(datos.paciente.medico || '—'))) +
        sec('Citas agendadas (' + ct.agendadas.length + ')') + tabla(cab, filas(ct.agendadas)) +
        sec('Citas atendidas (' + ct.atendidas.length + ')') + tabla(cab, filas(ct.atendidas)) + pie();
    },
    trat: async function () {
      var total = datos.tratamientos.reduce(function (a, t) { return a + Number(t.total); }, 0);
      return encabezado('Tratamientos') + cajaPaciente(datoImp('Médico tratante', esc(datos.paciente.medico || '—'))) +
        tabla([th('Fecha'), th('Tratamiento'), th('Pieza'), th('Estado'), th('Total', 1)], datos.tratamientos.map(function (t) {
          return '<tr>' + td(fecha(t.fecha)) + td(esc(t.tratamiento)) + td(esc(t.pieza || '—')) + td(ESTADOS_TRAT[t.estado] || t.estado) + td(q(t.total), 1) + '</tr>';
        }), totalFila('TOTAL', q(total))) + pie();
    },
    pre: async function (p) {
      var sub = p.items.reduce(function (a, i) { return a + i.cantidad * i.precio; }, 0), tot = totalPre(p);
      var forma = p.forma_pago === 'tarjeta' ? 'Tarjeta de crédito' + (p.cuotas > 1 ? ' · ' + p.cuotas + ' cuotas' : '') : (p.forma_pago ? p.forma_pago.charAt(0).toUpperCase() + p.forma_pago.slice(1) : '—');
      return encabezado('Presupuesto · ' + esc(p.codigo || p.id)) + cajaPaciente(datoImp('Estado', ESTADOS_PRE[p.estado] || p.estado)) +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 16px;margin-bottom:14px">' + datoImp('Fecha', fechaLarga(p.fecha)) + datoImp('Forma de pago', esc(forma)) +
        datoImp('Aprobado', p.aprobado_en ? fecha(p.aprobado_en) : '—') + '</div>' +
        tabla([th('#'), th('Tratamiento'), th('Pieza'), th('Cant.', 1), th('Precio', 1), th('Subtotal', 1)], p.items.map(function (i, k) {
          return '<tr>' + td(k + 1) + td(esc(i.tratamiento)) + td(esc(i.pieza || '—')) + td(i.cantidad, 1) + td(q(i.precio), 1) + td(q(i.cantidad * i.precio), 1) + '</tr>';
        }), (Number(p.descuento_pct) ? '<tfoot><tr><td colspan="6" style="padding:8px 6px;text-align:right">Subtotal ' + q(sub) + ' · Descuento ' + Number(p.descuento_pct) + '%</td></tr></tfoot>' : '') + totalFila('TOTAL', q(tot))) +
        (p.notas ? '<p style="margin:14px 0 0;font-size:13px"><b>Notas:</b> ' + esc(p.notas) + '</p>' : '') +
        pie('Valores sujetos a la evaluación clínica.');
    },
    pago: async function (g) {
      return encabezado('Comprobante de pago · ' + esc(docPago(g))) + cajaPaciente(datoImp('NIT del documento', esc(g.nit || datos.paciente.nit || 'CF'))) +
        tabla([th('Fecha'), th('Concepto'), th('Forma de pago'), th('Monto', 1)], ['<tr>' + td(fechaLarga(g.fecha)) + td(esc(g.concepto || 'Abono a cuenta') + (g.numero_cuota ? ' · cuota ' + g.numero_cuota : '')) +
          td(esc(METODOS[g.metodo] || g.metodo) + (g.referencia ? ' · ref. ' + esc(g.referencia) : '')) + td(q(g.monto), 1) + '</tr>'], totalFila('TOTAL PAGADO', q(g.monto))) + pie();
    }
  };
  function encabezado(t) { return window.PD_IMPRESION.encabezado(t); }
  var FUENTES = { receta: function () { return datos.recetas; }, constancia: function () { return datos.constancias; }, pre: function () { return detalle.presupuestos; }, pago: function () { return detalle.comprobantes; } };

  async function imprimir(tipo, i) {
    if (!window.PD_IMPRESION || !IMPRIMIR[tipo]) return;
    var obj = FUENTES[tipo] ? FUENTES[tipo]()[i] : null;
    window.PD_IMPRESION.imprimir(await IMPRIMIR[tipo](obj));
  }

  $('mpTabs').addEventListener('click', function (e) {
    if (e.target.closest('[data-mp-volver]') && dent) { datos = detalle = null; listaDentista(); return; }
    var b = e.target.closest('[data-mp-tab]'); if (b && datos) ver(b.dataset.mpTab);
  });
  $('mpCuerpo').addEventListener('input', function (e) { if (e.target.id === 'mpBuscar') { filtro = e.target.value; pintarPacientes(); } });
  $('mpCuerpo').addEventListener('click', function (e) {
    var dp = e.target.closest('[data-mp-paciente]');
    if (dp && dent) { abrirPaciente(+dp.dataset.mpPaciente); return; }
    var b = e.target.closest('[data-mp-imp],[data-mp-cerrar]');
    if (!b || !datos) return;
    if (b.dataset.mpImp) imprimir(b.dataset.mpImp, +b.dataset.i);
    else cerrar();
  });
  $('mpActualizar').addEventListener('click', abrir);
  $('mpCerrar').addEventListener('click', cerrar);

  // ¿El usuario conectado está asignado a un dentista? (para mostrar «Mis pacientes» también al personal)
  async function esDentista() { var r = await sb.rpc('dentista_pacientes'); return !r.error && !!(r.data && r.data.ok); }

  window.PD_PORTAL = { abrir: abrir, cerrar: cerrar, esDentista: esDentista };
})();
