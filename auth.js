// Plus Dental — usuarios con Supabase: Conectarse, Crear usuario, panel de Administración y cambio de clave
(function () {
  var ROLES = { cliente: 'Cliente', administrador: 'Administrador', super_administrador: 'Super Administrador' };
  var AYUDA = '¿Olvidaste tu clave? Comunícate con la clínica al +502 3756-5739.';
  // Supabase exige un correo: el nombre de usuario se guarda como un correo interno que nadie ve ni recibe.
  var DOMINIO = 'usuarios.plusdental.com';
  var FORMATO = /^[a-z0-9._-]{3,30}$/;
  function correoInterno(usuario) { return usuario.trim().toLowerCase() + '@' + DOMINIO; }
  function nombreDe(p) { return p.usuario || (p.correo || '').split('@')[0]; }

  var sb = window.PD_SB || null;

  var dlg = $('loginDlg'), claveDlg = $('claveDlg'), panel = $('administracion');
  var perfil = null, quiereAdmin = false, usuarios = [], claveDe = null;
  var citas = [], bloqueos = [], filtro = 'pendiente', periodo = 'proximas', posicionesCita = [], dentistasCita = [];
  var ESTADOS = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada' };
  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function vista(id) { ['loginForm', 'signupForm', 'sessionView'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function titulo(eyebrow, texto) { $('dlgEyebrow').textContent = eyebrow; $('dlgTitle').textContent = texto; }
  function aviso(id, texto, error) { $(id).textContent = texto; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function ocupado(form, si) { form.querySelector('button[type=submit]').disabled = si; }
  function esPersonal() { return !!perfil && perfil.rol !== 'cliente'; }
  function esSuper() { return !!perfil && perfil.rol === 'super_administrador'; }
  // El Super Administrador cambia la clave de cualquiera; el Administrador, solo la de los Clientes
  function puedeCambiarClave(p) { return p.id !== perfil.id && (esSuper() || (esPersonal() && p.rol === 'cliente')); }

  function traducir(err) {
    var m = (err && err.message) || '';
    if (/Invalid login credentials/i.test(m)) return 'Usuario o clave incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'Tu usuario todavía no está activado. Comunícate con la clínica.';
    if (/already registered|already exists/i.test(m)) return 'Ese nombre de usuario ya existe. Elige otro o usa «Ingresar».';
    if (/email/i.test(m) && /invalid/i.test(m)) return 'Ese nombre de usuario no es válido.';
    if (/Password should be|al menos 8/i.test(m)) return 'La clave debe tener al menos 8 caracteres.';
    if (/should be different/i.test(m)) return 'La nueva clave debe ser distinta de la actual.';
    if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
    if (/cambiar_clave/i.test(m) && /not find|does not exist/i.test(m)) return 'Falta ejecutar en Supabase el script para cambiar claves.';
    if (/permiso/i.test(m)) return 'No tienes permiso para cambiar la clave de este usuario.';
    return 'No se pudo completar: ' + m;
  }

  function pintarBoton() { $('loginLabel').textContent = perfil ? nombreDe(perfil) : 'Conectarse'; }

  async function cargarPerfil() {
    perfil = null;
    var s = (await sb.auth.getSession()).data.session;
    if (s) {
      var r = await sb.from('perfiles').select('id,usuario,correo,rol').eq('id', s.user.id).maybeSingle();
      perfil = r.data || { id: s.user.id, usuario: (s.user.user_metadata || {}).usuario, correo: s.user.email, rol: 'cliente' };
    }
    pintarBoton();
    if (!esPersonal()) cerrarPanel();
    if (dlg.open && !$('sessionView').hidden && !perfil) abrir(quiereAdmin);
  }

  // ---- Ventana de acceso ----
  function abrir(admin) {
    quiereAdmin = admin;
    if (sb && perfil && admin && esPersonal()) { if (dlg.open) dlg.close(); abrirPanel(); return; }
    if (sb && perfil) {
      mostrarSesion();
    } else {
      titulo(admin ? 'Solo personal autorizado' : 'Acceso', admin ? 'Administración' : 'Conectarse');
      vista('loginForm');
      if (sb) aviso('loginMsg', AYUDA);
      else aviso('loginMsg', 'El acceso en línea todavía no está configurado. Comunícate con la clínica al +502 3756-5739.', true);
    }
    if (!dlg.open) dlg.showModal();
    var primero = dlg.querySelector('form:not([hidden]) input');
    if (primero) primero.focus();
  }

  function mostrarSesion() {
    titulo(quiereAdmin ? 'Administración' : 'Tu cuenta', nombreDe(perfil));
    $('sesCorreo').textContent = 'Usuario: ' + nombreDe(perfil);
    $('sesRol').textContent = ROLES[perfil.rol] || perfil.rol;
    $('adminNote').hidden = !(quiereAdmin && !esPersonal());
    $('adminNote').textContent = 'Tu usuario es de tipo Cliente. Administración es solo para el personal de la clínica.';
    $('goAdminBtn').hidden = !esPersonal();
    vista('sessionView');
  }

  // ---- Panel de Administración ----
  function abrirPanel() {
    panel.hidden = false;
    $('admQuien').textContent = 'Conectado como ' + nombreDe(perfil) + ' · ' + ROLES[perfil.rol] + '.' +
      (esSuper() ? ' Puedes cambiar el tipo y la clave de cualquier usuario.' : ' Puedes cambiar la clave de los Clientes.');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cargarPanel();
  }
  function cargarPanel() {
    cargarCitas(); cargarBloqueos(); cargarUsuarios();
    (window.PD_MODULOS || []).forEach(function (m) { m.cargar(); });
  }
  function cerrarPanel() {
    panel.hidden = true;
    (window.PD_MODULOS || []).forEach(function (m) { m.limpiar(); }); // no dejar datos de pacientes en pantalla
    usuarios = []; citas = []; bloqueos = [];
    $('rolesBody').innerHTML = ''; $('citasBody').innerHTML = ''; $('bloqLista').innerHTML = '';
  }
  function pestana(id) {
    document.querySelectorAll('.adm-menu [data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === id);
      $(b.dataset.tab).hidden = b.dataset.tab !== id;
    });
    var elegido = document.querySelector('.adm-menu [data-tab="' + id + '"]');
    if (elegido) abrirGrupo(elegido.closest('.adm-g'));
  }
  // Menú por grupos: solo uno abierto a la vez (null = todos cerrados)
  function abrirGrupo(g) {
    document.querySelectorAll('.adm-menu .adm-g').forEach(function (x) {
      x.classList.toggle('abierto', x === g);
      x.querySelector('.adm-grupo').setAttribute('aria-expanded', x === g);
    });
  }

  // ---- Citas ----
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function fechaLarga(f) { var p = f.split('-'), d = new Date(+p[0], p[1] - 1, +p[2]); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function hhmm(h) { return String(h || '').slice(0, 5); }
  function waPaciente(c) {
    var num = String(c.telefono).replace(/\D/g, '');
    if (num.length === 8) num = '502' + num; // número de Guatemala sin código de país
    var texto = 'Hola ' + c.nombre + ', le escribimos de Plus Dental para confirmar su cita de ' + c.servicio +
      ' el ' + fechaLarga(c.fecha) + ' a las ' + hhmm(c.hora) + '.';
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
  }

  async function cargarCitas() {
    aviso('citasMsg', '');
    $('citasBody').innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
    var desde = $('cbDesde').value, hasta = $('cbHasta').value;
    function consulta(campos) {
      var q = sb.from('citas').select(campos);
      if (desde || hasta) {
        if (desde) q = q.gte('fecha', desde);
        if (hasta) q = q.lte('fecha', hasta);
        return q.order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(1000);
      }
      return periodo === 'proximas'
        ? q.gte('fecha', hoyISO()).order('fecha').order('hora')
        : q.lt('fecha', hoyISO()).order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(300);
    }
    var r = await consulta('id,fecha,hora,servicio,nombre,telefono,estado,creada,posicion_id,dentista_id,paciente_id');
    if (r.error && /paciente_id/.test(r.error.message)) r = await consulta('id,fecha,hora,servicio,nombre,telefono,estado,creada,posicion_id,dentista_id');
    // Si todavía no existen las columnas nuevas, se muestran las citas sin ellas
    if (r.error && /dentista_id/.test(r.error.message)) r = await consulta('id,fecha,hora,servicio,nombre,telefono,estado,creada,posicion_id');
    if (r.error && /posicion_id/.test(r.error.message)) r = await consulta('id,fecha,hora,servicio,nombre,telefono,estado,creada');
    dentistasCita = window.PD_DENTISTAS ? await window.PD_DENTISTAS() : [];
    posicionesCita = window.PD_POSICIONES ? await window.PD_POSICIONES() : [];
    contarPendientes();
    if (r.error) {
      $('citasBody').innerHTML = '';
      aviso('citasMsg', /citas/.test(r.error.message) && /exist|find/i.test(r.error.message)
        ? 'Falta ejecutar en Supabase el script de la agenda.' : traducir(r.error), true);
      return;
    }
    citas = r.data;
    cargarOpcionesBusqueda();
    pintarCitas();
  }

  // Listas de la búsqueda: todos los pacientes y los procedimientos que tienen citas
  var opcionesCargadas = false;
  async function cargarOpcionesBusqueda() {
    if (opcionesCargadas) return;
    var rs = await Promise.all([sb.from('pacientes').select('id,nombre').order('nombre'), sb.from('citas').select('servicio').limit(5000)]);
    if (rs[0].error && rs[1].error) return;
    opcionesCargadas = true;
    var selP = $('cbPaciente'), antesP = selP.value;
    var nombresCitas = citas.map(function (c) { return c.nombre; });
    var pac = rs[0].error ? [] : rs[0].data;
    var conocidos = {}; pac.forEach(function (p) { conocidos[String(p.nombre).toLowerCase()] = 1; });
    var sueltos = nombresCitas.filter(function (n, i, a) { return n && a.indexOf(n) === i && !conocidos[n.toLowerCase()]; }).sort();
    selP.innerHTML = '<option value="">Todos los pacientes</option>' + pac.map(function (p) { return '<option value="id:' + p.id + '" data-nombre="' + esc(p.nombre) + '">' + esc(p.nombre) + '</option>'; }).join('') +
      (sueltos.length ? '<optgroup label="Sin expediente">' + sueltos.map(function (n) { return '<option value="n:' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</optgroup>' : '');
    selP.value = antesP;
    var selS = $('cbProc'), antesS = selS.value;
    var servicios = (rs[1].error ? citas : rs[1].data).map(function (c) { return String(c.servicio || '').trim(); })
      .filter(function (x, i, a) { return x && a.map(function (y) { return y.toLowerCase(); }).indexOf(x.toLowerCase()) === i; }).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    selS.innerHTML = '<option value="">Todos los procedimientos</option>' + servicios.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    selS.value = antesS;
  }
  // Paciente y procedimiento elegidos en la búsqueda
  function coincideBusqueda(c) {
    var p = $('cbPaciente').value, s = $('cbProc').value;
    if (p) {
      if (p.indexOf('id:') === 0) {
        var opt = $('cbPaciente').selectedOptions[0], nom = opt ? String(opt.dataset.nombre || '').toLowerCase() : '';
        if (!(c.paciente_id != null ? String(c.paciente_id) === p.slice(3) : String(c.nombre).toLowerCase() === nom)) return false;
      } else if (String(c.nombre) !== p.slice(2)) return false;
    }
    if (s && String(c.servicio || '').trim().toLowerCase() !== s.toLowerCase()) return false;
    return true;
  }

  // Contador del menú: citas próximas sin confirmar
  async function contarPendientes() {
    var r = await sb.from('citas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').gte('fecha', hoyISO());
    var n = r.error ? 0 : r.count || 0;
    $('nPend').hidden = !n;
    $('nPend').textContent = n;
  }

  function pintarCitas() {
    document.querySelectorAll('#citaFiltros [data-filtro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.filtro === filtro); });
    var rango = $('cbDesde').value || $('cbHasta').value;
    document.querySelectorAll('#citaPeriodo [data-periodo]').forEach(function (b) { b.setAttribute('aria-pressed', !rango && b.dataset.periodo === periodo); });

    var lista = citas.filter(function (c) { return (filtro === 'todas' || c.estado === filtro) && coincideBusqueda(c); });
    var buscando = rango || $('cbPaciente').value || $('cbProc').value;
    $('cbResumen').hidden = !buscando;
    if (buscando) $('cbResumen').textContent = lista.length + (lista.length === 1 ? ' cita encontrada' : ' citas encontradas') +
      (rango ? ' del ' + ($('cbDesde').value ? fechaLarga($('cbDesde').value) : 'inicio') + ' al ' + ($('cbHasta').value ? fechaLarga($('cbHasta').value) : 'último registro') : '') + '.';
    if (!lista.length && buscando) { $('citasBody').innerHTML = '<tr><td colspan="7">Ninguna cita coincide con la búsqueda.</td></tr>'; return; }
    if (!lista.length) {
      var cuando = periodo === 'proximas' ? 'próximas' : 'anteriores';
      var vacio = { pendiente: 'No hay citas pendientes ' + cuando + '.', confirmada: 'No hay citas confirmadas ' + cuando + '.', cancelada: 'No hay citas canceladas ' + cuando + '.', todas: 'No hay citas ' + cuando + '.' };
      $('citasBody').innerHTML = '<tr><td colspan="7">' + vacio[filtro] + '</td></tr>';
      return;
    }
    $('citasBody').innerHTML = lista.map(function (c) {
      var acciones = '';
      if (c.estado === 'pendiente') acciones += '<button type="button" class="adm-btn adm-primary" data-cita="' + c.id + '" data-estado="confirmada">Confirmar</button>';
      if (c.estado !== 'cancelada') acciones += '<button type="button" class="adm-btn" data-cita="' + c.id + '" data-estado="cancelada">Cancelar</button>';
      acciones += '<a class="adm-btn" style="text-decoration:none;display:inline-flex;align-items:center" href="' + esc(waPaciente(c)) + '" target="_blank" rel="noopener">WhatsApp</a>';
      return '<tr><td class="fecha"><strong style="color:#0B2B40">' + fechaLarga(c.fecha) + '</strong><br>' + hhmm(c.hora) + '</td>' +
        '<td><strong>' + esc(c.nombre) + '</strong><br><span style="color:#5A6D7A">' + esc(c.telefono) + '</span></td>' +
        '<td>' + esc(c.servicio) + '</td>' +
        '<td>' + selectorDentista(c) + '</td>' +
        '<td>' + selectorPosicion(c) + '</td>' +
        '<td><span class="estado estado-' + c.estado + '">' + ESTADOS[c.estado] + '</span></td>' +
        '<td><div class="acciones">' + acciones + '</div></td></tr>';
    }).join('');
  }

  function selectorPosicion(c) {
    if (!posicionesCita.length || !('posicion_id' in c)) return '<span style="color:#94A6B2">—</span>';
    return '<select class="adm-input" data-pos-cita="' + c.id + '" aria-label="Posición de la cita de ' + esc(c.nombre) + '" style="border-radius:10px;min-height:38px;padding:6px 8px;max-width:190px"' +
      (c.estado === 'cancelada' ? ' disabled' : '') + '><option value="">Sin asignar</option>' +
      posicionesCita.map(function (p) { return '<option value="' + p.id + '"' + (p.id === c.posicion_id ? ' selected' : '') + '>' + esc(p.codigo + ' · ' + p.nombre) + '</option>'; }).join('') +
      '</select>';
  }

  function selectorDentista(c) {
    if (!dentistasCita.length || !('dentista_id' in c)) return '<span style="color:#94A6B2">—</span>';
    return '<select class="adm-input" data-den-cita="' + c.id + '" aria-label="Dentista de la cita de ' + esc(c.nombre) + '" style="border-radius:10px;min-height:38px;padding:6px 8px;max-width:190px"' +
      (c.estado === 'cancelada' ? ' disabled' : '') + '><option value="">Sin asignar</option>' +
      dentistasCita.map(function (d) { return '<option value="' + d.id + '"' + (d.id === c.dentista_id ? ' selected' : '') + '>' + esc(d.nombre) + '</option>'; }).join('') +
      '</select>';
  }

  // Al asignar un dentista, si la cita no tiene sala, toma la sala del dentista
  async function asignarDentista(sel) {
    sel.disabled = true;
    var valor = sel.value ? +sel.value : null;
    var cita = citas.filter(function (c) { return String(c.id) === sel.dataset.denCita; })[0];
    var d = dentistasCita.filter(function (x) { return x.id === valor; })[0];
    var cambios = { dentista_id: valor };
    if (d && d.posicion_id && cita && !cita.posicion_id) cambios.posicion_id = d.posicion_id;
    var r = await sb.from('citas').update(cambios).eq('id', sel.dataset.denCita).select('id');
    sel.disabled = false;
    if (r.error || !r.data || !r.data.length) { aviso('citasMsg', r.error ? traducir(r.error) : 'No tienes permiso para cambiar esta cita.', true); return; }
    if (cita) { cita.dentista_id = valor; if (cambios.posicion_id) cita.posicion_id = cambios.posicion_id; }
    aviso('citasMsg', d ? 'Cita asignada a ' + d.nombre + (cambios.posicion_id ? ' y a su sala.' : '.') : 'La cita quedó sin dentista asignado.');
    if (cambios.posicion_id) pintarCitas();
  }

  async function asignarPosicion(sel) {
    sel.disabled = true;
    var valor = sel.value ? +sel.value : null;
    var r = await sb.from('citas').update({ posicion_id: valor }).eq('id', sel.dataset.posCita).select('id');
    sel.disabled = false;
    if (r.error || !r.data || !r.data.length) { aviso('citasMsg', r.error ? traducir(r.error) : 'No tienes permiso para cambiar esta cita.', true); return; }
    citas.forEach(function (c) { if (String(c.id) === sel.dataset.posCita) c.posicion_id = valor; });
    var p = posicionesCita.filter(function (x) { return x.id === valor; })[0];
    aviso('citasMsg', p ? 'Cita asignada a ' + p.codigo + ' · ' + p.nombre + '.' : 'La cita quedó sin posición asignada.');
  }

  async function cambiarEstado(id, estado, boton) {
    boton.disabled = true;
    var r = await sb.from('citas').update({ estado: estado }).eq('id', id).select('id');
    if (r.error || !r.data || !r.data.length) {
      boton.disabled = false;
      aviso('citasMsg', r.error ? traducir(r.error) : 'No tienes permiso para cambiar esta cita.', true);
      return;
    }
    citas.forEach(function (c) { if (String(c.id) === String(id)) c.estado = estado; });
    contarPendientes();
    aviso('citasMsg', estado === 'confirmada'
      ? 'Cita confirmada. Avísale al paciente con el botón WhatsApp.'
      : 'Cita cancelada. El horario quedó libre en la agenda.');
    pintarCitas();
  }

  // ---- Bloqueos de horario ----
  async function cargarBloqueos() {
    var r = await sb.from('bloqueos').select('id,fecha,hora,motivo').gte('fecha', hoyISO()).order('fecha').order('hora', { nullsFirst: true });
    if (r.error) { aviso('bloqMsg', /bloqueos/.test(r.error.message) ? 'Falta ejecutar en Supabase el script de la agenda.' : traducir(r.error), true); return; }
    bloqueos = r.data;
    pintarBloqueos();
  }
  function pintarBloqueos() {
    $('bloqLista').innerHTML = bloqueos.length
      ? bloqueos.map(function (b) {
        return '<li class="bloq-item"><span><strong>' + fechaLarga(b.fecha) + '</strong> · ' + (b.hora ? hhmm(b.hora) : 'Todo el día') +
          (b.motivo ? ' <span style="color:#5A6D7A">— ' + esc(b.motivo) + '</span>' : '') + '</span>' +
          '<button type="button" class="adm-btn" data-desbloquear="' + b.id + '">Quitar</button></li>';
      }).join('')
      : '<li class="bloq-item" style="color:#5A6D7A">No hay horarios bloqueados.</li>';
  }

  async function cargarUsuarios() {
    aviso('rolesMsg', '');
    $('rolesBody').innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
    var r = await sb.from('perfiles').select('id,usuario,correo,rol,creado').order('creado');
    if (r.error) { $('rolesBody').innerHTML = ''; aviso('rolesMsg', traducir(r.error), true); return; }
    usuarios = r.data;
    pintarUsuarios();
  }

  function pintarUsuarios() {
    var cuenta = { cliente: 0, administrador: 0, super_administrador: 0 };
    usuarios.forEach(function (p) { cuenta[p.rol] = (cuenta[p.rol] || 0) + 1; });
    $('admResumen').innerHTML = '<span class="adm-chip">Total <b>' + usuarios.length + '</b></span>' +
      Object.keys(ROLES).map(function (k) { return '<span class="adm-chip">' + ROLES[k] + ' <b>' + cuenta[k] + '</b></span>'; }).join('');

    var filtro = $('admBuscar').value.trim().toLowerCase();
    var lista = usuarios.filter(function (p) { return !filtro || nombreDe(p).toLowerCase().indexOf(filtro) >= 0; });
    if (!lista.length) { $('rolesBody').innerHTML = '<tr><td colspan="4">' + (filtro ? 'Ningún usuario coincide con «' + esc(filtro) + '».' : 'Todavía no hay usuarios.') + '</td></tr>'; return; }

    $('rolesBody').innerHTML = lista.map(function (p) {
      var yo = p.id === perfil.id;
      var tipo;
      if (esSuper() && !yo) {
        tipo = '<select data-uid="' + p.id + '" data-prev="' + p.rol + '" aria-label="Tipo de usuario de ' + esc(nombreDe(p)) + '">' +
          Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (k === p.rol ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join('') +
          '</select>';
      } else {
        tipo = '<span class="role-pill">' + (ROLES[p.rol] || p.rol) + '</span>';
      }
      var fecha = p.creado ? new Date(p.creado).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
      var boton = yo
        ? '<button type="button" class="adm-btn" data-mipass>Cambiar mi clave</button>'
        : '<button type="button" class="adm-btn" data-pass="' + p.id + '"' + (puedeCambiarClave(p) ? '' : ' disabled title="Solo el Super Administrador puede cambiar esta clave"') + '>Cambiar clave</button>';
      return '<tr><td><strong>' + esc(nombreDe(p)) + '</strong>' + (yo ? ' <span style="color:#5A6D7A">(tú)</span>' : '') + '</td>' +
        '<td>' + tipo + '</td><td class="fecha">' + fecha + '</td><td>' + boton + '</td></tr>';
    }).join('');
  }

  // ---- Cambiar clave ----
  function abrirClave(p) {
    claveDe = p; // null = mi propia clave
    $('claveTitle').textContent = p ? nombreDe(p) : 'Mi clave';
    $('claveNueva').value = ''; $('claveNueva2').value = '';
    aviso('claveMsg', p ? 'El usuario podrá ingresar con la nueva clave de inmediato.' : 'Escribe tu nueva clave dos veces.');
    if (dlg.open) dlg.close();
    claveDlg.showModal();
    $('claveNueva').focus();
  }

  // ---- Eventos ----
  document.querySelectorAll('[data-login]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      abrir(el.getAttribute('data-login') === 'admin');
    });
  });
  $('loginClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $('claveClose').addEventListener('click', function () { claveDlg.close(); });
  claveDlg.addEventListener('click', function (e) { if (e.target === claveDlg) claveDlg.close(); });

  dlg.querySelectorAll('[data-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      var destino = b.getAttribute('data-view');
      titulo('Acceso', destino === 'signupForm' ? 'Crear usuario' : 'Conectarse');
      vista(destino);
      if (destino === 'signupForm') aviso('signupMsg', sb ? 'Tu usuario se crea como Cliente.' : 'El registro en línea todavía no está configurado.', !sb);
      var primero = $(destino).querySelector('input');
      if (primero) primero.focus();
    });
  });

  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!sb) return;
    ocupado(this, true);
    aviso('loginMsg', 'Ingresando…');
    var r = await sb.auth.signInWithPassword({ email: correoInterno($('loginUser').value), password: $('loginPass').value });
    ocupado(this, false);
    $('loginPass').value = '';
    if (r.error) { aviso('loginMsg', traducir(r.error), true); return; }
    await cargarPerfil();
    abrir(quiereAdmin);
  });

  $('signupForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!sb) return;
    var usuario = $('signupUser').value.trim().toLowerCase();
    if (!FORMATO.test(usuario)) { aviso('signupMsg', 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.', true); return; }
    if ($('signupPass').value !== $('signupPass2').value) { aviso('signupMsg', 'Las dos claves no coinciden.', true); return; }
    ocupado(this, true);
    aviso('signupMsg', 'Creando usuario…');
    var r = await sb.auth.signUp({
      email: correoInterno(usuario),
      password: $('signupPass').value,
      options: { data: { usuario: usuario } }
    });
    ocupado(this, false);
    if (r.error) { aviso('signupMsg', traducir(r.error), true); return; }
    // Con la confirmación por correo activa, Supabase devuelve un usuario sin identidades si ya existía
    if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) {
      aviso('signupMsg', 'Ese nombre de usuario ya existe. Elige otro o usa «Ya tengo usuario, ingresar».', true);
      return;
    }
    $('signupPass').value = ''; $('signupPass2').value = '';
    if (r.data.session) { quiereAdmin = false; await cargarPerfil(); mostrarSesion(); return; }
    aviso('signupMsg', 'Tu usuario se creó, pero falta activarlo. Comunícate con la clínica.', true);
  });

  $('logoutBtn').addEventListener('click', async function () {
    await sb.auth.signOut();
    perfil = null;
    pintarBoton();
    cerrarPanel();
    abrir(false);
  });
  $('goAdminBtn').addEventListener('click', function () { dlg.close(); abrirPanel(); });
  $('myPassBtn').addEventListener('click', function () { abrirClave(null); });

  $('admRecargar').addEventListener('click', cargarPanel);
  document.querySelectorAll('.adm-menu [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { pestana(b.dataset.tab); });
  });
  // Títulos de grupo: abren su lista de opciones (y cierran las demás); si ya estaba abierta, la cierran
  document.querySelectorAll('.adm-menu .adm-grupo').forEach(function (t) {
    t.addEventListener('click', function () {
      var g = t.closest('.adm-g');
      abrirGrupo(g.classList.contains('abierto') ? null : g);
    });
  });
  // Al empezar, se abre el grupo de la opción seleccionada
  var inicial = document.querySelector('.adm-menu [data-tab][aria-selected="true"]');
  if (inicial) abrirGrupo(inicial.closest('.adm-g'));
  $('citaFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filtro]');
    if (b) { filtro = b.dataset.filtro; pintarCitas(); }
  });
  $('citaPeriodo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-periodo]');
    if (!b || b.dataset.periodo === periodo) return;
    periodo = b.dataset.periodo;
    $('cbDesde').value = ''; $('cbHasta').value = '';
    // En el historial lo útil es ver todo; en las próximas, lo que falta confirmar
    filtro = periodo === 'anteriores' ? 'todas' : 'pendiente';
    cargarCitas();
  });
  // Búsqueda: paciente y procedimiento filtran al momento; las fechas se aplican con «Buscar»
  $('cbPaciente').addEventListener('change', pintarCitas);
  $('cbProc').addEventListener('change', pintarCitas);
  $('cbBuscar').addEventListener('click', function () {
    if ($('cbDesde').value && $('cbHasta').value && $('cbDesde').value > $('cbHasta').value) { aviso('citasMsg', 'La fecha inicial no puede ser mayor que la final.', true); return; }
    if (($('cbDesde').value || $('cbHasta').value) && filtro === 'pendiente') filtro = 'todas';
    cargarCitas();
  });
  $('cbLimpiar').addEventListener('click', function () {
    ['cbPaciente', 'cbProc', 'cbDesde', 'cbHasta'].forEach(function (id) { $(id).value = ''; });
    cargarCitas();
  });
  $('citasBody').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-pos-cita]');
    if (sel) asignarPosicion(sel);
    var den = e.target.closest('[data-den-cita]');
    if (den) asignarDentista(den);
  });
  $('citasBody').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cita]');
    if (b) cambiarEstado(b.dataset.cita, b.dataset.estado, b);
  });

  $('bloqFecha').min = hoyISO();
  $('bloqForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fecha = $('bloqFecha').value, hora = $('bloqHora').value;
    if (!fecha) return;
    var ocupadas = citas.filter(function (c) { return c.estado !== 'cancelada' && c.fecha === fecha && (!hora || hhmm(c.hora) === hora); });
    ocupado(this, true);
    var r = await sb.from('bloqueos').insert({ fecha: fecha, hora: hora || null, motivo: $('bloqMotivo').value.trim() || null });
    ocupado(this, false);
    if (r.error) { aviso('bloqMsg', traducir(r.error), true); return; }
    $('bloqMotivo').value = '';
    aviso('bloqMsg', ocupadas.length
      ? 'Horario bloqueado. Ojo: ya hay ' + ocupadas.length + ' cita(s) en ese horario; el bloqueo no las cancela.'
      : 'Horario bloqueado.', ocupadas.length > 0);
    cargarBloqueos();
  });
  $('bloqLista').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-desbloquear]');
    if (!b) return;
    b.disabled = true;
    var r = await sb.from('bloqueos').delete().eq('id', b.dataset.desbloquear);
    if (r.error) { b.disabled = false; aviso('bloqMsg', traducir(r.error), true); return; }
    aviso('bloqMsg', 'Bloqueo quitado. Ese horario vuelve a estar disponible.');
    cargarBloqueos();
  });
  $('admCerrar').addEventListener('click', function () { cerrarPanel(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('admBuscar').addEventListener('input', pintarUsuarios);

  $('rolesBody').addEventListener('click', function (e) {
    if (e.target.closest('[data-mipass]')) { abrirClave(null); return; }
    var b = e.target.closest('button[data-pass]');
    if (!b || b.disabled) return;
    var p = usuarios.filter(function (u) { return u.id === b.dataset.pass; })[0];
    if (p) abrirClave(p);
  });

  $('rolesBody').addEventListener('change', async function (e) {
    var sel = e.target.closest('select[data-uid]');
    if (!sel) return;
    sel.disabled = true;
    var r = await sb.from('perfiles').update({ rol: sel.value }).eq('id', sel.dataset.uid).select('id');
    sel.disabled = false;
    if (r.error || !r.data || !r.data.length) {
      sel.value = sel.dataset.prev;
      aviso('rolesMsg', r.error ? traducir(r.error) : 'No tienes permiso para cambiar este usuario.', true);
      return;
    }
    usuarios.forEach(function (u) { if (u.id === sel.dataset.uid) u.rol = sel.value; });
    aviso('rolesMsg', 'Tipo actualizado: ' + ROLES[sel.value] + '.');
    pintarUsuarios();
  });

  $('claveForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var nueva = $('claveNueva').value;
    if (nueva.length < 8) { aviso('claveMsg', 'La clave debe tener al menos 8 caracteres.', true); return; }
    if (nueva !== $('claveNueva2').value) { aviso('claveMsg', 'Las dos claves no coinciden.', true); return; }
    ocupado(this, true);
    aviso('claveMsg', 'Guardando…');
    var r = claveDe
      ? await sb.rpc('cambiar_clave', { uid: claveDe.id, nueva: nueva })
      : await sb.auth.updateUser({ password: nueva });
    ocupado(this, false);
    if (r.error) { aviso('claveMsg', traducir(r.error), true); return; }
    $('claveNueva').value = ''; $('claveNueva2').value = '';
    aviso('claveMsg', claveDe ? 'Listo. La clave de ' + nombreDe(claveDe) + ' se cambió.' : 'Listo. Tu clave se cambió.');
    if (!claveDe) aviso('rolesMsg', 'Tu clave se cambió.');
  });

  // Lo que otros módulos del panel necesitan saber de la sesión
  window.PD_SESION = {
    esSuper: esSuper,
    usuario: function () { return perfil ? nombreDe(perfil) : ''; }
  };

  if (sb) {
    // No esperar llamadas a Supabase dentro del aviso de cambio de sesión (recomendación de supabase-js)
    sb.auth.onAuthStateChange(function () { setTimeout(cargarPerfil, 0); });
  }
})();
