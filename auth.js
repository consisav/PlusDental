// Plus Dental — usuarios con Supabase: Conectarse, Crear usuario y tipos de usuario
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

  var dlg = $('loginDlg'), perfil = null, quiereAdmin = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function vista(id) {
    ['loginForm', 'signupForm', 'sessionView'].forEach(function (v) { $(v).hidden = v !== id; });
    dlg.classList.toggle('wide', id === 'sessionView' && !$('rolesPanel').hidden);
  }
  function titulo(eyebrow, texto) { $('dlgEyebrow').textContent = eyebrow; $('dlgTitle').textContent = texto; }
  function aviso(id, texto, error) { $(id).textContent = texto; $(id).style.color = error ? '#9A3B2E' : '#44585B'; }
  function ocupado(form, si) { form.querySelector('button[type=submit]').disabled = si; }

  function traducir(err) {
    var m = (err && err.message) || '';
    if (/Invalid login credentials/i.test(m)) return 'Usuario o clave incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'Tu usuario todavía no está activado. Comunícate con la clínica.';
    if (/already registered|already exists/i.test(m)) return 'Ese nombre de usuario ya existe. Elige otro o usa «Ingresar».';
    if (/email/i.test(m) && /invalid/i.test(m)) return 'Ese nombre de usuario no es válido.';
    if (/Password should be/i.test(m)) return 'La clave debe tener al menos 8 caracteres.';
    if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
    return 'No se pudo completar: ' + m;
  }

  function pintarBoton() {
    $('loginLabel').textContent = perfil ? nombreDe(perfil) : 'Conectarse';
  }

  async function cargarPerfil() {
    perfil = null;
    var s = (await sb.auth.getSession()).data.session;
    if (s) {
      var r = await sb.from('perfiles').select('id,usuario,correo,rol').eq('id', s.user.id).maybeSingle();
      perfil = r.data || { id: s.user.id, usuario: (s.user.user_metadata || {}).usuario, correo: s.user.email, rol: 'cliente' };
    }
    pintarBoton();
    if (dlg.open && !$('sessionView').hidden && !perfil) abrir(quiereAdmin);
  }

  function abrir(admin) {
    quiereAdmin = admin;
    if (sb && perfil) {
      mostrarSesion();
    } else {
      titulo(admin ? 'Solo personal autorizado' : 'Acceso', admin ? 'Administración' : 'Conectarse');
      $('rolesPanel').hidden = true;
      vista('loginForm');
      if (sb) aviso('loginMsg', AYUDA);
      else aviso('loginMsg', 'El acceso en línea todavía no está configurado. Comunícate con la clínica al +502 3756-5739.', true);
    }
    if (!dlg.open) dlg.showModal();
    var primero = dlg.querySelector('form:not([hidden]) input');
    if (primero) primero.focus();
  }

  function mostrarSesion() {
    var esPersonal = perfil.rol !== 'cliente';
    var esSuper = perfil.rol === 'super_administrador';
    titulo(quiereAdmin ? 'Administración' : 'Tu cuenta', nombreDe(perfil));
    $('sesCorreo').textContent = 'Usuario: ' + nombreDe(perfil);
    $('sesRol').textContent = ROLES[perfil.rol] || perfil.rol;
    $('adminNote').hidden = !quiereAdmin;
    $('adminNote').textContent = esPersonal
      ? 'El panel de citas estará disponible próximamente.'
      : 'Tu usuario es de tipo Cliente. Administración es solo para el personal de la clínica.';
    $('rolesPanel').hidden = !(quiereAdmin && esSuper);
    vista('sessionView');
    if (quiereAdmin && esSuper) cargarUsuarios();
  }

  async function cargarUsuarios() {
    var cuerpo = $('rolesBody');
    aviso('rolesMsg', '');
    cuerpo.innerHTML = '<tr><td colspan="2">Cargando…</td></tr>';
    var r = await sb.from('perfiles').select('id,usuario,correo,rol').order('creado');
    if (r.error) { cuerpo.innerHTML = ''; aviso('rolesMsg', traducir(r.error), true); return; }
    cuerpo.innerHTML = r.data.map(function (p) {
      var opciones = Object.keys(ROLES).map(function (k) {
        return '<option value="' + k + '"' + (k === p.rol ? ' selected' : '') + '>' + ROLES[k] + '</option>';
      }).join('');
      var yo = p.id === perfil.id;
      return '<tr><td><strong>' + esc(nombreDe(p)) + '</strong>' + (yo ? ' <span style="color:#5B6E70">(tú)</span>' : '') + '</td>' +
        '<td><select data-uid="' + p.id + '" data-prev="' + p.rol + '" aria-label="Tipo de usuario de ' + esc(nombreDe(p)) + '"' +
        (yo ? ' disabled title="No puedes cambiar tu propio tipo"' : '') + '>' + opciones + '</select></td></tr>';
    }).join('');
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
    mostrarSesion();
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
    abrir(quiereAdmin);
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
    sel.dataset.prev = sel.value;
    aviso('rolesMsg', 'Tipo actualizado: ' + ROLES[sel.value] + '.');
  });

  if (sb) {
    // No esperar llamadas a Supabase dentro del aviso de cambio de sesión (recomendación de supabase-js)
    sb.auth.onAuthStateChange(function () { setTimeout(cargarPerfil, 0); });
  }
})();
