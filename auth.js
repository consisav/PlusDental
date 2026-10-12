// Plus Dental — usuarios con Supabase: Conectarse, Crear usuario, panel de Administración y cambio de clave
(function () {
  var ROLES = { cliente: 'Cliente', administrador: 'Administrador', super_administrador: 'Super Administrador' };
  var AYUDA = '¿Olvidaste tu clave? Comunícate con la clínica al +502 3756-5739.';
  // Supabase exige un correo: el nombre de usuario se guarda como un correo interno que nadie ve ni recibe.
  var DOMINIO = 'usuarios.plusdental.com';
  var FORMATO = /^[a-z0-9._-]{3,30}$/;
  function correoInterno(usuario) { return usuario.trim().toLowerCase() + '@' + DOMINIO; }
  function nombreDe(p) { return p.usuario || (p.correo || '').split('@')[0]; }

  var cfg = window.PLUS_DENTAL_CONFIG || {};
  var configurado = !!(window.supabase && /^https:\/\//.test(cfg.supabaseUrl || '') && cfg.supabaseKey && cfg.supabaseKey.indexOf('PEGAR') < 0);
  var sb = configurado ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

  var dlg = $('loginDlg'), claveDlg = $('claveDlg'), panel = $('administracion');
  var perfil = null, quiereAdmin = false, usuarios = [], claveDe = null;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function vista(id) { ['loginForm', 'signupForm', 'sessionView'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function titulo(eyebrow, texto) { $('dlgEyebrow').textContent = eyebrow; $('dlgTitle').textContent = texto; }
  function aviso(id, texto, error) { $(id).textContent = texto; $(id).style.color = error ? '#9A3B2E' : '#44585B'; }
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
    cargarUsuarios();
  }
  function cerrarPanel() { panel.hidden = true; usuarios = []; $('rolesBody').innerHTML = ''; }

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
      return '<tr><td><strong>' + esc(nombreDe(p)) + '</strong>' + (yo ? ' <span style="color:#5B6E70">(tú)</span>' : '') + '</td>' +
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

  $('admRecargar').addEventListener('click', cargarUsuarios);
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

  if (sb) {
    // No esperar llamadas a Supabase dentro del aviso de cambio de sesión (recomendación de supabase-js)
    sb.auth.onAuthStateChange(function () { setTimeout(cargarPerfil, 0); });
  }
})();
