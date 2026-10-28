// Plus Dental — Generación de usuario del portal para pacientes: usuario con las iniciales de los nombres + primer apellido
// (Oliver Asturias = oasturias, Juan Carlos Tut = jctut) y una clave aleatoria para entregarla al paciente.
// Si el paciente ya tiene clave generada, solo se muestra; si es la primera vez, se crea el usuario y se actualiza el paciente.
(function () {
  var sb = window.PD_SB || null;
  var panel = document.getElementById('admGenUsuario');
  if (!sb || !panel) return;

  var pacientes = [], actual = null, acceso = null, cargando = null;
  var PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'van', 'von', 'san'];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(texto, error) { $('guMsg').textContent = texto || ''; $('guMsg').style.color = error ? '#9A3B2E' : '#475B68'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/acceso_paciente|could not find the function/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para generar usuarios.';
    if (/permiso|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }

  // Iniciales de los nombres + primer apellido. 2 palabras: nombre + apellido; 3: dos nombres + apellido;
  // 4 o más: los dos últimos son apellidos. «de», «del», «la»… se omiten en las iniciales y se unen al apellido.
  function generarUsuario(nombre) {
    var w = sinTildes(nombre).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    var sig = [];
    w.forEach(function (x, i) { if (PARTICULAS.indexOf(x) < 0) sig.push(i); });
    if (!sig.length) return '';
    if (sig.length === 1) return w[sig[0]].slice(0, 30);
    var nNombres = sig.length === 2 ? 1 : sig.length === 3 ? 2 : sig.length - 2;
    var iApe = sig[nNombres], desde = iApe;
    while (desde > sig[nNombres - 1] + 1 && PARTICULAS.indexOf(w[desde - 1]) >= 0) desde--;
    var ini = sig.slice(0, nNombres).map(function (i) { return w[i].charAt(0); }).join('');
    return (ini + w.slice(desde, iApe + 1).join('')).slice(0, 30);
  }

  panel.innerHTML = '<div class="adm-pane-head"><h3 class="adm-h">Generación Usuario</h3><button type="button" id="guVolver" class="adm-btn" hidden>← Volver al expediente</button></div>' +
    '<p class="dlg-msg">Crea el usuario y la clave con los que el paciente entra a «Mi expediente». Si el paciente ya tiene clave generada, solo se muestra.</p>' +
    '<div class="gu-caja">' +
    '<label>Buscar paciente<input id="guBuscar" type="search" class="adm-input" placeholder="Nombre, DPI o usuario" autocomplete="off"></label>' +
    '<label>Paciente *<select id="guPaciente"><option value="">Elige el paciente…</option></select></label>' +
    '<div id="guFicha" hidden>' +
    '<div class="gu-paso"><span class="gu-num">1</span><div class="gu-cuerpo"><b>Usuario</b>' +
    '<div class="gu-fila"><input id="guUsuario" type="text" maxlength="30" autocomplete="off" spellcheck="false" aria-label="Usuario">' +
    '<button type="button" id="guGenUsuario" class="adm-btn">Generar usuario</button></div><small id="guUsuarioNota"></small></div></div>' +
    '<div class="gu-paso"><span class="gu-num">2</span><div class="gu-cuerpo"><b>Clave</b>' +
    '<div class="gu-fila"><output id="guClave" class="gu-clave">••••••••••</output>' +
    '<button type="button" id="guGenClave" class="adm-btn adm-primary">Generar clave</button></div><small id="guClaveNota"></small></div></div>' +
    '<div class="exp-actions" id="guEntregar" hidden><button type="button" id="guCopiar" class="adm-btn">Copiar usuario y clave</button>' +
    '<button type="button" id="guWhats" class="adm-btn">Enviar por WhatsApp</button></div>' +
    '</div><p id="guMsg" class="dlg-msg" role="status"></p></div>';

  function opciones() {
    var q = sinTildes($('guBuscar').value.trim()), sel = $('guPaciente'), antes = sel.value;
    var lista = pacientes.filter(function (p) { return !q || sinTildes(p.nombre + ' ' + (p.dpi || '') + ' ' + (p.usuario || '')).indexOf(q) >= 0; });
    sel.innerHTML = '<option value="">' + (lista.length ? 'Elige el paciente… (' + lista.length + ')' : 'Ningún paciente coincide') + '</option>' +
      lista.slice(0, 500).map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + (p.usuario ? ' · ' + esc(p.usuario) : '') + '</option>'; }).join('');
    if (lista.some(function (p) { return String(p.id) === antes; })) sel.value = antes;
    else if (lista.length === 1) { sel.value = lista[0].id; elegir(); }
  }

  async function cargar() {
    aviso('Cargando pacientes…');
    var r = await sb.from('pacientes').select('id,nombre,dpi,telefono,usuario').order('nombre');
    if (r.error) { aviso(traducir(r.error), true); return; }
    pacientes = r.data || [];
    opciones(); aviso('');
  }

  function pintarClave(mostrar) {
    var c = acceso && acceso.clave;
    $('guClave').textContent = mostrar && c ? c : '••••••••••';
    $('guClave').classList.toggle('vacia', !(mostrar && c));
    $('guClaveNota').textContent = c
      ? 'Clave generada el ' + fechaHora(acceso.generado) + (acceso.generado_por ? ' por ' + acceso.generado_por : '') + '.'
      : actual.usuario ? 'Este usuario se asignó a mano y su clave no se conoce. «Generar clave» le pondrá una clave nueva.' : 'Aún no tiene clave.';
    $('guEntregar').hidden = !(mostrar && c);
  }

  async function elegir() {
    actual = pacientes.find(function (p) { return String(p.id) === $('guPaciente').value; }) || null;
    acceso = null; aviso('');
    $('guFicha').hidden = !actual;
    if (!actual) return;
    $('guUsuario').value = actual.usuario || '';
    $('guUsuario').readOnly = !!actual.usuario;
    $('guUsuarioNota').textContent = actual.usuario ? 'El paciente ya tiene usuario.' : 'Aún no tiene usuario. Pulsa «Generar usuario».';
    pintarClave(false);
    var r = await sb.rpc('ver_acceso_paciente', { p_id: actual.id });
    if (r.error) { aviso(traducir(r.error), true); return; }
    if (!actual || actual.id !== +$('guPaciente').value) return;
    acceso = r.data;
    pintarClave(false);
  }

  $('guBuscar').addEventListener('input', opciones);
  $('guPaciente').addEventListener('change', elegir);

  // 1. Generar usuario: si ya tiene, se muestra con su clave; si no, se propone (iniciales + primer apellido)
  $('guGenUsuario').addEventListener('click', function () {
    if (!actual) return;
    if (actual.usuario) {
      $('guUsuario').value = actual.usuario;
      pintarClave(true);
      aviso(acceso && acceso.clave ? 'El paciente ya tiene usuario y clave.' : 'El paciente ya tiene usuario; aún no tiene clave generada.');
      return;
    }
    var u = generarUsuario(actual.nombre);
    if (u.length < 3) { aviso('No se pudo formar el usuario con el nombre del paciente. Escríbelo a mano.', true); $('guUsuario').focus(); return; }
    $('guUsuario').value = u;
    $('guUsuarioNota').textContent = 'Usuario propuesto (puedes ajustarlo). Se guarda al pulsar «Generar clave»; si ya existe, se le agrega un número.';
    aviso('');
  });

  // 2. Generar clave: si ya existe solo se muestra; si es la primera vez, se crea el usuario y se actualiza el paciente
  $('guGenClave').addEventListener('click', async function () {
    if (!actual) return;
    if (acceso && acceso.clave) { pintarClave(true); aviso('Este paciente ya tenía clave generada; se muestra la misma.'); return; }
    var u = $('guUsuario').value.trim().toLowerCase();
    if (!actual.usuario) {
      if (!u) u = generarUsuario(actual.nombre), $('guUsuario').value = u;
      if (!/^[a-z0-9._-]{3,30}$/.test(u)) { aviso('El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios ni tildes.', true); $('guUsuario').focus(); return; }
    }
    var b = this; b.disabled = true; aviso('Generando…');
    var r = await sb.rpc('generar_acceso_paciente', { p_id: actual.id, p_usuario: u });
    b.disabled = false;
    if (r.error) { aviso(traducir(r.error), true); return; }
    acceso = r.data;
    var cambio = actual.usuario !== acceso.usuario;
    actual.usuario = acceso.usuario;
    $('guUsuario').value = acceso.usuario; $('guUsuario').readOnly = true;
    $('guUsuarioNota').textContent = 'El paciente ya tiene usuario.';
    pintarClave(true);
    if (cambio) { opciones(); window.dispatchEvent(new CustomEvent('pd-usuario-generado', { detail: { paciente_id: actual.id, usuario: acceso.usuario } })); }
    aviso(acceso.nuevo ? 'Listo. Se guardaron el usuario y la clave en el paciente. Entrégaselos para que entre a «Mi expediente».' : 'Este paciente ya tenía clave generada; se muestra la misma.');
  });

  function textoEntrega() {
    return 'Plus Dental · Acceso a «Mi expediente»\nUsuario: ' + acceso.usuario + '\nClave: ' + acceso.clave + '\nIngresa en ' + location.origin + location.pathname + ' con el botón «Conectarse».';
  }
  $('guCopiar').addEventListener('click', function () {
    if (!acceso || !acceso.clave) return;
    navigator.clipboard.writeText(textoEntrega()).then(function () { aviso('Usuario y clave copiados.'); }, function () { aviso('No se pudo copiar; selecciona el texto a mano.', true); });
  });
  $('guWhats').addEventListener('click', function () {
    if (!acceso || !acceso.clave) return;
    var tel = String(actual.telefono || '').replace(/\D/g, '');
    if (tel.length === 8) tel = '502' + tel;
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(textoEntrega()), '_blank', 'noopener');
  });

  function recargar() { $('guVolver').hidden = true; return (cargando = cargar()); }
  var tab = $('tabGenUsuario');
  if (tab) tab.addEventListener('click', recargar);
  $('guVolver').addEventListener('click', function () { if ($('tabExpedientes')) $('tabExpedientes').click(); });
  // Desde el expediente del paciente: abre esta pantalla con el paciente ya elegido
  window.PD_GEN_USUARIO_ABRIR = async function (id) {
    tab.click();
    $('guVolver').hidden = false;
    await cargando;
    $('guBuscar').value = ''; opciones();
    $('guPaciente').value = String(id);
    await elegir();
    panel.scrollIntoView({ block: 'start' });
  };
  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!panel.hidden) cargar(); },
    limpiar: function () { pacientes = []; actual = null; acceso = null; $('guBuscar').value = ''; $('guPaciente').innerHTML = '<option value="">Elige el paciente…</option>'; $('guFicha').hidden = true; aviso(''); }
  });
  window.PD_GEN_USUARIO = generarUsuario;   // para pruebas
})();
