// Plus Dental — Agentes comerciales (vendedores): código, nombre, teléfono, foto, inicio, % de comisión y estado.
// Quién ingresó el agente, cuándo, y el último cambio de estado los registra Supabase automáticamente.
// Solo Administrador y Super Administrador.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admAgentes')) return;

  var BUCKET = 'expedientes';   // almacenamiento privado (las fotos se ven con enlaces temporales)
  var ESTADOS = { activo: 'Activo', suspendido: 'Suspendido', inactivo: 'Inactivo' };
  var agentes = [], actual = null, editando = false, filtro = 'todos';
  var fotoNueva = null, fotoVistaUrl = null, quitarFoto = false, fotosLista = {};

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(id, texto, error) { $(id).textContent = texto || ''; $(id).style.color = error ? '#9A3B2E' : '#475B68'; }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fechaCorta(f) {
    if (!f) return '—';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00') : new Date(f);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fechaHora(f) { return f ? new Date(f).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  function porcentaje(n) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function iniciales(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join('') || '?'; }
  function usuarioActual() { return (window.PD_SESION && window.PD_SESION.usuario()) || '—'; }
  function esFijo(a) { return !!a && a.codigo === '0'; } // agente 0 «NINGUNO»: del sistema, no se modifica ni se elimina
  function pill(estado) { return '<span class="estado estado-' + estado + '">' + ESTADOS[estado] + '</span>'; }
  function traducir(err) {
    var m = (err && err.message) || '';
    if (/agentes.*(does not exist|could not find)|could not find the table|column .*(telefono|foto)/i.test(m)) return 'Falta ejecutar en Supabase el script actualizado (supabase.sql) para los agentes comerciales.';
    if (/agente_fijo/i.test(m)) return 'El agente 0 (NINGUNO) es del sistema: no se puede modificar ni eliminar.';
    if (/agentes_codigo_unico|duplicate key/i.test(m)) return 'Ya existe un agente con ese código.';
    if (/agentes_comision/i.test(m)) return 'La comisión debe estar entre 0 y 100 %.';
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.';
    if (/exceeded the maximum allowed size|too large/i.test(m)) return 'La foto pesa demasiado.';
    return m || 'Ocurrió un error. Intenta de nuevo.';
  }
  function ver(id) { ['acLista', 'acFicha'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function pedirConfirmacion(b) {
    function restaurar() { b.dataset.confirmar = '0'; b.textContent = b.dataset.texto; b.style.borderColor = ''; b.style.color = ''; }
    if (b.dataset.confirmar === '1') { restaurar(); return true; }
    b.dataset.texto = b.textContent;
    b.dataset.confirmar = '1';
    b.textContent = '¿Seguro? ' + b.dataset.texto;
    b.style.borderColor = '#9A3B2E'; b.style.color = '#9A3B2E';
    setTimeout(function () { if (b.dataset.confirmar === '1') restaurar(); }, 4000);
    return false;
  }

  // ---------- Lista ----------
  async function cargar() {
    aviso('acMsg', '');
    $('acBody').innerHTML = '<tr><td colspan="6">Cargando…</td></tr>';
    var r = await sb.from('agentes').select('*').order('codigo');
    if (r.error) { $('acBody').innerHTML = ''; aviso('acMsg', traducir(r.error), true); return; }
    agentes = ordenar(r.data || []);
    pintarLista();
    cargarFotosLista();
  }
  // Orden por número de código (0, 1, 2… 10); después, los códigos con letras
  function ordenar(lista) {
    function n(a) { return /^\d+$/.test(a.codigo) ? +a.codigo : Infinity; }
    return lista.slice().sort(function (a, b) { return (n(a) - n(b)) || a.codigo.localeCompare(b.codigo); });
  }
  // Enlaces temporales para las fotos de la lista (una sola consulta)
  async function cargarFotosLista() {
    var rutas = agentes.map(function (a) { return a.foto; }).filter(Boolean);
    fotosLista = {};
    if (!rutas.length) return;
    var r = await sb.storage.from(BUCKET).createSignedUrls(rutas, 3600);
    if (r.error) return;
    r.data.forEach(function (x) { if (x.signedUrl) fotosLista[x.path] = x.signedUrl; });
    pintarLista();
  }
  function avatar(a) {
    var u = a.foto && fotosLista[a.foto];
    return '<span class="avatar">' + (u ? '<img src="' + esc(u) + '" alt="">' : esc(iniciales(a.nombre))) + '</span>';
  }
  function pintarLista() {
    document.querySelectorAll('[data-acfiltro]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.acfiltro === filtro); });
    var q = sinTildes($('acBuscar').value.trim());
    var lista = agentes.filter(function (a) {
      return (filtro === 'todos' || a.estado === filtro) && (!q || sinTildes(a.codigo + ' ' + a.nombre + ' ' + (a.telefono || '')).indexOf(q) >= 0);
    });
    $('acBody').innerHTML = lista.length ? lista.map(function (a) {
      return '<tr><td><b>' + esc(a.codigo) + '</b></td>' +
        '<td><div class="ac-quien">' + avatar(a) + '<span>' + esc(a.nombre) + (esFijo(a) ? ' <span class="ac-fijo">Del sistema</span>' : '') + (a.telefono ? '<br><span class="hi-desc">' + esc(a.telefono) + '</span>' : '') + '</span></div></td>' +
        '<td class="fecha">' + fechaCorta(a.fecha_inicio) + '</td><td>' + porcentaje(a.comision) + '</td><td>' + pill(a.estado) + '</td>' +
        '<td><button type="button" class="adm-btn" data-acabrir="' + a.id + '">Abrir</button></td></tr>';
    }).join('') : '<tr><td colspan="6">' + (agentes.length ? 'No hay agentes con ese filtro.' : 'Aún no hay agentes. Pulsa «Nuevo agente» para agregar el primero.') + '</td></tr>';
  }

  // ---------- Foto ----------
  function reducirImagen(archivo) {
    return new Promise(function (ok, falla) {
      var img = new Image(), u = URL.createObjectURL(archivo);
      img.onload = function () {
        var escala = Math.min(1, 600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? ok(b) : falla(new Error('No se pudo procesar la imagen.')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(u); falla(new Error('El archivo no es una imagen válida.')); };
      img.src = u;
    });
  }
  function soltarVista() { if (fotoVistaUrl) { URL.revokeObjectURL(fotoVistaUrl); fotoVistaUrl = null; } }
  async function pintarFoto() {
    var vista = $('acFotoVista');
    var tiene = !!fotoNueva || !!(actual && actual.foto && !quitarFoto);
    $('acFotoBtn').disabled = !editando;
    $('acFotoBtn').textContent = tiene ? 'Cambiar foto' : 'Subir foto';
    $('acFotoQuitar').hidden = !editando || !tiene;
    vista.innerHTML = esc(iniciales($('acNombre').value || (actual && actual.nombre)));
    if (fotoNueva) {
      soltarVista(); fotoVistaUrl = URL.createObjectURL(fotoNueva);
      vista.innerHTML = '<img src="' + fotoVistaUrl + '" alt="">';
      return;
    }
    if (!tiene) return;
    var ruta = actual.foto, u = fotosLista[ruta];
    if (!u) {
      var r = await sb.storage.from(BUCKET).createSignedUrl(ruta, 3600);
      if (r.error) return;
      u = fotosLista[ruta] = r.data.signedUrl;
    }
    if (actual && actual.foto === ruta && !fotoNueva && !quitarFoto) vista.innerHTML = '<img src="' + esc(u) + '" alt="Foto de ' + esc(actual.nombre) + '">';
  }

  // ---------- Ficha ----------
  function pintarEstadoSelect() { $('acEstado').dataset.estado = $('acEstado').value; }
  function rellenar(a) {
    // El código lo asigna Supabase al grabar (1, 2, 3…); no se escribe ni se cambia
    $('acCodigo').textContent = a ? a.codigo : 'Se asigna al grabar';
    $('acNombre').value = a ? a.nombre : '';
    $('acTelefono').value = a ? a.telefono || '' : '';
    $('acInicio').value = a ? a.fecha_inicio : hoy();
    $('acComision').value = a ? Number(a.comision) : '';
    $('acEstado').value = a ? a.estado : 'activo';
    pintarEstadoSelect();
    $('acRegPor').textContent = a ? (a.registrado_por || '—') : usuarioActual();
    $('acRegFecha').textContent = a ? fechaCorta(a.creado) : fechaCorta(hoy());
    $('acCambioFecha').textContent = a && a.estado_cambiado ? fechaHora(a.estado_cambiado) : 'Sin cambios';
    $('acCambioPor').textContent = a && a.estado_cambiado_por ? a.estado_cambiado_por : '—';
    fotoNueva = null; quitarFoto = false; soltarVista();
    aviso('acFotoMsg', '');
  }
  function pintarCabecera() {
    $('acTitulo').textContent = actual ? actual.nombre : 'Nuevo agente';
    $('acSub').textContent = esFijo(actual) ? 'Agente del sistema para cuando no hay agente comercial. No se puede modificar ni eliminar.' : actual ? [actual.codigo, actual.telefono, 'Comisión ' + porcentaje(actual.comision)].filter(Boolean).join(' · ') : 'Llena los datos y pulsa «Grabar».';
    $('acPill').hidden = !actual;
    if (actual) { $('acPill').className = 'estado estado-' + actual.estado; $('acPill').textContent = ESTADOS[actual.estado]; }
  }
  // Los cuatro botones siempre se ven al final; se activan solo cuando aplican
  function aplicarModo() {
    $('acCampos').disabled = !editando;
    $('acGrabar').disabled = !editando;
    $('acCancelar').disabled = !editando;
    var fijo = esFijo(actual) ? 'Agente del sistema: no se puede modificar ni eliminar.' : '';
    $('acModificar').disabled = editando || !actual || !!fijo;
    $('acEliminar').disabled = editando || !actual || !!fijo;
    $('acGrabar').title = editando ? '' : fijo || 'Pulsa «Modificar» para hacer cambios.';
    $('acModificar').title = fijo || (!actual ? 'Disponible después de grabar el agente.' : editando ? 'Ya estás modificando este agente.' : '');
    $('acEliminar').title = fijo || (!actual ? 'Disponible después de grabar el agente.' : editando ? 'Termina o cancela la modificación primero.' : '');
    $('acCancelar').title = editando ? '' : 'Solo se usa mientras haces cambios.';
    if ($('acEliminar').dataset.confirmar === '1') { $('acEliminar').dataset.confirmar = '0'; $('acEliminar').textContent = 'Eliminar'; $('acEliminar').style.borderColor = ''; $('acEliminar').style.color = ''; }
    pintarFoto();
  }
  function abrir(a) {
    actual = a || null;
    editando = !a;
    rellenar(actual);
    pintarCabecera();
    aplicarModo();
    aviso('acFormMsg', '');
    ver('acFicha');
    if (editando) $('acNombre').focus();
  }

  async function grabar() {
    var nombre = $('acNombre').value.trim(), inicio = $('acInicio').value;
    var comision = $('acComision').value === '' ? NaN : Number($('acComision').value);
    if (!nombre) { aviso('acFormMsg', 'Escribe el nombre del agente.', true); $('acNombre').focus(); return; }
    if (!inicio) { aviso('acFormMsg', 'Indica la fecha de inicio.', true); $('acInicio').focus(); return; }
    if (isNaN(comision) || comision < 0 || comision > 100) { aviso('acFormMsg', 'La comisión debe ser un porcentaje entre 0 y 100.', true); $('acComision').focus(); return; }
    var datos = {
      nombre: nombre, telefono: $('acTelefono').value.trim() || null, fecha_inicio: inicio,
      comision: Math.round(comision * 100) / 100, estado: $('acEstado').value
    };
    if (quitarFoto && !fotoNueva) datos.foto = null;
    $('acGrabar').disabled = true;
    aviso('acFormMsg', 'Grabando…');
    var r = actual
      ? await sb.from('agentes').update(datos).eq('id', actual.id).select('*').single()
      : await sb.from('agentes').insert(datos).select('*').single();
    if (r.error) { $('acGrabar').disabled = false; aviso('acFormMsg', traducir(r.error), true); return; }
    var nuevo = !actual, cambioEstado = actual && actual.estado !== r.data.estado, guardado = r.data, avisoFoto = '';
    // La foto se sube después de grabar (necesita el número del agente)
    if (fotoNueva) {
      var ruta = 'fotos/agente-' + guardado.id + '.jpg';
      var up = await sb.storage.from(BUCKET).upload(ruta, fotoNueva, { contentType: 'image/jpeg', upsert: true });
      if (up.error) avisoFoto = ' La foto no se pudo subir: ' + traducir(up.error);
      else {
        delete fotosLista[ruta];
        var f = await sb.from('agentes').update({ foto: ruta }).eq('id', guardado.id).select('*').single();
        if (!f.error) guardado = f.data;
      }
    }
    actual = guardado;
    agentes = nuevo ? ordenar(agentes.concat([actual])) : agentes.map(function (a) { return a.id === actual.id ? actual : a; });
    editando = false;
    rellenar(actual); pintarCabecera(); aplicarModo();
    aviso('acFormMsg', (nuevo ? 'Agente grabado.' : cambioEstado ? 'Cambios grabados. Se registró el cambio de estado.' : 'Cambios grabados.') + avisoFoto, !!avisoFoto);
  }

  $('tabAgentes').addEventListener('click', function () { if (!$('acLista').hidden) cargar(); });
  $('acNuevo').addEventListener('click', function () { abrir(null); });
  $('acVolver').addEventListener('click', function () { actual = null; soltarVista(); ver('acLista'); pintarLista(); });
  $('acBuscar').addEventListener('input', pintarLista);
  $('acFiltros').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acfiltro]');
    if (b) { filtro = b.dataset.acfiltro; pintarLista(); }
  });
  $('acBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acabrir]');
    if (b) abrir(agentes.filter(function (a) { return String(a.id) === b.dataset.acabrir; })[0]);
  });
  $('acEstado').addEventListener('change', pintarEstadoSelect);
  $('acNombre').addEventListener('input', function () { if (!fotoNueva && !(actual && actual.foto && !quitarFoto)) $('acFotoVista').textContent = iniciales(this.value); });
  $('acFotoBtn').addEventListener('click', function () { $('acFotoArchivo').click(); });
  $('acFotoArchivo').addEventListener('change', async function () {
    var archivo = this.files[0];
    this.value = '';
    if (!archivo) return;
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(archivo.type) < 0) { aviso('acFotoMsg', 'Elige una foto JPG, PNG o WEBP.', true); return; }
    try {
      fotoNueva = await reducirImagen(archivo);
      quitarFoto = false;
      aviso('acFotoMsg', 'La foto se guardará al pulsar «Grabar».');
      pintarFoto();
    } catch (e) { aviso('acFotoMsg', e.message, true); }
  });
  $('acFotoQuitar').addEventListener('click', function () {
    fotoNueva = null; soltarVista();
    quitarFoto = !!(actual && actual.foto);
    aviso('acFotoMsg', quitarFoto ? 'La foto se quitará al pulsar «Grabar».' : '');
    pintarFoto();
  });
  $('acForm').addEventListener('submit', function (e) { e.preventDefault(); if (editando) grabar(); });
  $('acModificar').addEventListener('click', function () {
    if (!actual || esFijo(actual)) return;
    editando = true; aplicarModo();
    aviso('acFormMsg', 'Modo modificación: haz los cambios y pulsa «Grabar».');
    $('acNombre').focus();
  });
  $('acCancelar').addEventListener('click', function () {
    if (!actual) { soltarVista(); ver('acLista'); pintarLista(); return; }
    editando = false; rellenar(actual); aplicarModo();
    aviso('acFormMsg', 'Se descartaron los cambios.');
  });
  $('acEliminar').addEventListener('click', async function () {
    var b = this;
    if (!actual || editando || esFijo(actual) || !pedirConfirmacion(b)) return;
    b.disabled = true;
    var r = await sb.from('agentes').delete().eq('id', actual.id);
    b.disabled = false;
    if (r.error) { aviso('acFormMsg', traducir(r.error), true); return; }
    if (actual.foto) await sb.storage.from(BUCKET).remove([actual.foto]); // si el usuario no puede borrar archivos, la foto queda guardada sin uso
    var nombre = actual.nombre;
    agentes = agentes.filter(function (a) { return a.id !== actual.id; });
    actual = null;
    ver('acLista'); pintarLista();
    aviso('acMsg', 'Agente «' + nombre + '» eliminado.');
  });

  // Catálogo para otras pantallas (p. ej. el agente comercial del paciente), ordenado por código
  window.PD_AGENTES = async function () {
    var r = await sb.from('agentes').select('id,codigo,nombre,estado');
    return r.error ? [] : ordenar(r.data || []);
  };

  (window.PD_MODULOS = window.PD_MODULOS || []).push({
    cargar: function () { if (!$('acLista').hidden) cargar(); },
    limpiar: function () {
      agentes = []; actual = null; editando = false; fotosLista = {}; fotoNueva = null; quitarFoto = false; soltarVista();
      $('acBody').innerHTML = ''; $('acFotoVista').innerHTML = '';
      ver('acLista');
    }
  });
})();
