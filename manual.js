// Plus Dental — Manual del CRM
// Manual completo (solo lectura): un capítulo por pantalla del panel, redactado con IA y guardado en manual_capitulos
// (supabase.sql). El índice se arma con el menú del panel y lleva a cada capítulo dentro del documento.
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admManual')) return;

  var caps = {}, indice = [];

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(texto, error) { $('mnMsg').textContent = texto || ''; $('mnMsg').style.color = error ? '#9A3B2E' : '#475B68'; }
  function limpio(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  // Texto propio de un botón del menú (sin contadores)
  function textoDe(el) { var c = el.cloneNode(true); c.querySelectorAll('span.adm-count').forEach(function (x) { x.remove(); }); return limpio(c.textContent); }

  // ---- Índice: se arma con el menú del panel ----
  function armarIndice() {
    indice = [];
    document.querySelectorAll('.adm-menu > .adm-g').forEach(function (g) {
      var grupo = { nombre: textoDe(g.querySelector('.adm-grupo')), items: [] }, sub = '';
      g.querySelectorAll('.adm-subgrupo, [data-tab]').forEach(function (b) {
        if (b.classList.contains('adm-subgrupo')) { sub = textoDe(b); return; }
        var sg = b.closest('.adm-sg') ? sub : '';
        grupo.items.push({ clave: b.dataset.tab, nombre: textoDe(b), sub: sg, ruta: [grupo.nombre, sg, textoDe(b)].filter(Boolean).join(' › ') });
      });
      if (grupo.items.length) indice.push(grupo);
    });
  }
  function todos() { return [].concat.apply([], indice.map(function (g) { return g.items; })); }
  function buscar(clave) { return todos().filter(function (i) { return i.clave === clave; })[0]; }

  function pintarIndice() {
    $('mnIndice').innerHTML = indice.map(function (g, gi) {
      var sub = '';
      return '<div class="mn-g"><b>' + (gi + 1) + '. ' + esc(g.nombre) + '</b>' + g.items.map(function (i) {
        var cab = i.sub && i.sub !== sub ? '<span class="mn-sg">' + esc(i.sub) + '</span>' : '';
        sub = i.sub;
        return cab + '<button type="button" data-cap="' + esc(i.clave) + '"' + (i.sub ? ' class="mn-en-sub"' : '') + '><span>' + esc(i.nombre) + '</span></button>';
      }).join('') + '</div>';
    }).join('');
  }

  // ---- Figuras del manual: maquetas de la pantalla y gráficas (los capítulos las piden por su id en «figura») ----
  function campo(etq, valor, o) {
    o = o || {};
    return '<div class="mnf-campo' + (o.ancho ? ' mnf-' + o.ancho : '') + '"><span>' + esc(etq) + '</span>' +
      '<div class="mnf-input' + (o.sel ? ' sel' : '') + (o.calc ? ' calc' : '') + (o.verde ? ' verde' : '') + (valor ? '' : ' vacio') + '">' + esc(valor || o.ph || '') + '</div>' +
      (o.boton ? '<em class="mnf-btn">' + esc(o.boton) + '</em>' : '') + '</div>';
  }
  function seccion(n, titulo, campos) { return '<div class="mnf-sec"><b>' + n + '</b>' + esc(titulo) + '</div><div class="mnf-grid">' + campos + '</div>'; }
  function marca(n) { return '<i class="mnf-marca">' + n + '</i>'; }
  var MAQUETAS = {
    'exp-lista': function () {
      return '<div class="mnf-barra"><span class="on">Activos</span><span>Inactivos</span><span>Suspendidos</span><span>Baja</span><span>Todos</span><em class="mnf-buscar">Javier</em><em class="mnf-btn osc">Nuevo paciente</em></div>' +
        '<table class="mnf-tabla"><thead><tr><th>Paciente</th><th>DPI</th><th>Teléfono</th><th>Edad</th><th>Médico asignado</th><th>Estado</th><th>Paciente desde</th><th></th></tr></thead><tbody>' +
        '<tr class="on"><td><i class="mnf-av">JR</i>Javier R.</td><td>•••• ••••• ••••</td><td>+502 •••• 4636</td><td>83 años</td><td><i class="mnf-punto"></i>Isaack Salaverria Donis</td><td><em class="mnf-est">Activo</em></td><td>27 oct 2026</td><td><em class="mnf-btn">Abrir</em></td></tr>' +
        '</tbody></table>';
    },
    'exp-cabecera': function () {
      return '<div class="mnf-cab"><i class="mnf-av xl">JR</i><div><b class="mnf-nom">Javier R.</b>' +
        '<div class="mnf-chips"><em class="act">Activo</em>' + marca(1) + '<em>83 años</em>' + marca(2) + '<em>Cliente directo</em>' + marca(3) + '<em class="med"><i class="mnf-punto"></i>Azul · Isaack Salaverria Donis</em>' + marca(4) + '</div>' +
        '<small>Paciente desde <b>27 oct 2026, 15:59</b> · Registrado por <b>oliver</b> · Última modificación <b>27 oct 2026, 16:04</b> por <b>oliver</b> ' + marca(5) + '</small></div>' +
        '<em class="mnf-btn claro">Subir foto</em></div>';
    },
    'exp-pestanas': function () {
      var t = [['Datos', 'Identificación, contacto, emergencia y atención'], ['Historia médica', 'Alergias, enfermedades y medicamentos'], ['Odontograma', 'Estado de cada pieza dental'], ['Tratamientos', 'Procedimientos realizados y pendientes'],
        ['Notas', 'Notas de evolución'], ['Radiografías', 'Imágenes del paciente'], ['Recetas', 'Recetas con firma del odontólogo'], ['Órdenes Laboratorio', 'Trabajos enviados al laboratorio']];
      return '<div class="mnf-tabs">' + t.map(function (x, i) { return '<span' + (i ? '' : ' class="on"') + '>' + esc(x[0]) + '</span>'; }).join('') + '</div>' +
        '<div class="mnf-tabdesc">' + t.map(function (x) { return '<div><b>' + esc(x[0]) + '</b>' + esc(x[1]) + '</div>'; }).join('') + '</div>';
    },
    'exp-ident': function () {
      return seccion(1, 'Identificación', campo('Nombre completo *', 'Javier R.', { ancho: 'm' }) + campo('Fecha de nacimiento', '03/12/1942') + campo('Edad', '83 años', { calc: true }) +
        campo('DPI', '•••• ••••• ••••') + campo('NIT', '', { ph: 'Ej.: 1234567-8 o CF' }) + campo('Usuario del portal', 'Sin usuario', { sel: true, ancho: 'm', boton: 'Generar usuario' }));
    },
    'exp-contacto': function () {
      return seccion(2, 'Contacto', campo('Teléfono / WhatsApp', '+502 •••• 4636') + campo('Correo electrónico', 'b••••••@gmail.com', { ancho: 'g' }) + campo('Dirección', '', { ancho: 't', ph: 'Zona, colonia, municipio' })) +
        seccion(3, 'Contacto de emergencia', campo('Nombre del contacto', '', { ph: 'Ej.: familiar responsable' }) + campo('Parentesco', 'Elige el parentesco…', { sel: true }) + campo('Teléfono', '', { ph: '+502' }));
    },
    'exp-atencion': function () {
      return seccion(4, 'Atención y seguimiento', campo('Tipo de paciente', 'Odontología', { sel: true }) + campo('Odontólogo asignado', 'Isaack Salaverria Donis · principal', { sel: true, ancho: 'm' }) +
        campo('Agente comercial', '0 · NINGUNO', { sel: true }) + campo('Tipo de cliente', 'Cliente directo', { sel: true }) + campo('Estado del paciente', 'Activo', { sel: true, verde: true }) +
        campo('Organización', '2 · GRUPO PLUS DENTAL', { sel: true, ancho: 'm' }) + campo('Localidad / Empresa', '2-01 · PLUS DENTAL ZONA 10', { sel: true, ancho: 'm' }) + campo('Código sistema anterior', '', { ph: 'Ej.: 000123' }));
    },
    'exp-flujo': function () {
      var p = ['Nuevo paciente', '1 · Identificación', '2 · Contacto', '3 · Emergencia', '4 · Atención y seguimiento', 'Guardar datos', 'Historia médica', 'Odontograma y tratamientos'];
      return '<div class="mnf-flujo">' + p.map(function (x, i) { return '<span' + (i === 5 ? ' class="clave"' : '') + '>' + esc(x) + '</span>'; }).join('<i aria-hidden="true">→</i>') + '</div>';
    }
  };
  // Gráfica de barras horizontales (una serie, un color): datos [[etiqueta, valor], …]
  function barras(f) {
    var max = Math.max.apply(null, f.datos.map(function (d) { return d[1]; }).concat([1])), total = f.datos.reduce(function (t, d) { return t + d[1]; }, 0);
    return '<div class="mnf-graf"><b>' + esc(f.titulo) + '</b>' + f.datos.map(function (d) {
      var pct = Math.round(d[1] * 100 / (total || 1));
      return '<div class="mnf-barfila" title="' + esc(d[0] + ': ' + d[1] + ' (' + pct + ' %)') + '"><span>' + esc(d[0]) + '</span><div><i style="width:' + Math.max(2, d[1] * 100 / max) + '%"></i></div><em>' + d[1] + ' · ' + pct + ' %</em></div>';
    }).join('') + '</div>';
  }
  function figura(f) {
    if (!f) return '';
    var cuerpo = f.tipo === 'barras' ? barras(f) : MAQUETAS[f.id] ? MAQUETAS[f.id]() : '';
    if (!cuerpo) return '';
    return '<figure class="mnf"><div class="mnf-marco">' + cuerpo + '</div>' +
      ((f.notas || []).length ? '<ol class="mnf-notas">' + f.notas.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ol>' : '') +
      (f.pie ? '<figcaption>' + esc(f.pie) + '</figcaption>' : '') + '</figure>';
  }

  // ---- Manual completo ----
  function htmlContenido(c) {
    return '<p class="mn-resumen">' + esc(c.resumen) + '</p>' +
      '<ol class="mn-pasos">' + (c.pasos || []).map(function (p) {
        return '<li><div><b>' + esc(p.titulo) + '</b><p>' + esc(p.detalle) + '</p>' + figura(p.figura) +
          (p.ejemplo ? '<div class="mn-ej"><span>Ejemplo</span>' + esc(p.ejemplo) + '</div>' : '') + '</div></li>';
      }).join('') + '</ol>' +
      ((c.consejos || []).length ? '<div class="mn-consejos"><b>Consejos</b><ul>' + c.consejos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '');
  }
  function pintar() {
    var n = 0;
    $('mnCap').innerHTML = indice.map(function (g, gi) {
      return '<h3 class="mn-parte">' + (gi + 1) + '. ' + esc(g.nombre) + '</h3>' + g.items.map(function (i) {
        var cap = caps[i.clave]; n++;
        return '<section class="mn-sec" id="mn-' + esc(i.clave) + '"><div class="mn-cab"><div><small>' + esc(i.ruta) + '</small><h4>' + esc(i.nombre) + '</h4></div>' +
          '<div class="mn-acc"><button type="button" class="adm-btn" data-ir="' + esc(i.clave) + '">Ir a la pantalla</button></div></div>' +
          (cap ? htmlContenido(cap.contenido) : '<p class="mn-resumen">Este capítulo está en preparación.</p>') + '</section>';
      }).join('');
    }).join('');
    $('mnAvance').textContent = n + ' capítulos';
    $('mnAvanceBarra').style.width = '100%';
  }
  function irA(clave) {
    var s = $('mn-' + clave); if (!s) return;
    document.querySelectorAll('#mnIndice [data-cap]').forEach(function (b) { b.setAttribute('aria-current', b.dataset.cap === clave); });
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Impresión ----
  function htmlImpreso(i, cap) {
    var c = cap.contenido;
    return '<div style="page-break-inside:auto;margin-bottom:26px"><div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#005A87;font-weight:800">' + esc(i.ruta) + '</div>' +
      '<h2 style="font-size:19px;margin:4px 0 8px;color:#0B2B40">' + esc(i.nombre) + '</h2>' +
      '<p style="font-size:12.5px;color:#475B68;margin:0 0 12px">' + esc(c.resumen) + '</p>' +
      (c.pasos || []).map(function (p, n) {
        return '<div style="display:flex;gap:10px;margin-bottom:10px;page-break-inside:avoid"><div style="flex:none;width:22px;height:22px;border-radius:50%;background:#0B2B40;color:#FFF;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">' + (n + 1) + '</div>' +
          '<div style="font-size:12.5px;min-width:0;flex:1"><b>' + esc(p.titulo) + '</b><div style="color:#334652;margin-top:2px">' + esc(p.detalle) + '</div>' + figura(p.figura) +
          (p.ejemplo ? '<div style="margin-top:5px;background:#FFF8E8;border-left:3px solid #D69E2E;padding:5px 8px;color:#5C4210"><b>Ejemplo:</b> ' + esc(p.ejemplo) + '</div>' : '') + '</div></div>';
      }).join('') +
      ((c.consejos || []).length ? '<div style="background:#EEF5FA;border-radius:8px;padding:8px 12px;font-size:12px;page-break-inside:avoid"><b>Consejos</b><ul style="margin:4px 0 0;padding-left:18px">' + c.consejos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }
  function imprimir() {
    var P = window.PD_IMPRESION; if (!P) return;
    var lista = todos().filter(function (i) { return caps[i.clave]; });
    if (!lista.length) { aviso('El manual todavía no tiene capítulos.', true); return; }
    var indiceImp = '<div style="font-size:12px;margin-bottom:22px;columns:2"><b style="display:block;margin-bottom:4px">Contenido</b>' +
      lista.map(function (i, n) { return '<div>' + (n + 1) + '. ' + esc(i.ruta) + '</div>'; }).join('') + '</div>';
    P.imprimir(P.encabezado('Manual del CRM') + indiceImp + lista.map(function (i) { return htmlImpreso(i, caps[i.clave]); }).join('') + '</div>');
  }

  // ---- Carga ----
  async function cargar() {
    armarIndice();
    pintarIndice();
    var r = await sb.from('manual_capitulos').select('clave,contenido');
    caps = {};
    if (r.error) aviso(/manual_capitulos/.test(r.error.message) ? 'Falta ejecutar en Supabase el script del Manual (supabase.sql).' : 'No se pudo cargar el manual.', true);
    else { aviso(''); r.data.forEach(function (c) { caps[c.clave] = c; }); }
    pintar();
  }
  function limpiar() { caps = {}; $('mnIndice').innerHTML = ''; $('mnCap').innerHTML = ''; aviso(''); }

  $('mnIndice').addEventListener('click', function (e) { var b = e.target.closest('[data-cap]'); if (b) irA(b.dataset.cap); });
  $('mnCap').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ir]'); if (!b) return;
    var t = document.querySelector('.adm-menu [data-tab="' + b.dataset.ir + '"]'); if (t) t.click();
  });
  $('mnImprimirTodo').addEventListener('click', imprimir);
  $('tabManual').addEventListener('click', cargar);

  window.PD_MODULOS = window.PD_MODULOS || [];
  window.PD_MODULOS.push({ cargar: cargar, limpiar: limpiar });
})();
