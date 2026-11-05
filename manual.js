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
      var t = [['Datos', 'Identificación, contacto, emergencia y atención', 'tab-datos'], ['Historia médica', 'Alergias, enfermedades y medicamentos', 'tab-historia'], ['Odontograma', 'Estado de cada pieza dental', 'tab-odonto'], ['Tratamientos', 'Procedimientos realizados y pendientes', 'tab-trat'],
        ['Notas', 'Notas de evolución', 'tab-notas'], ['Radiografías', 'Imágenes del paciente', 'tab-rx'], ['Recetas', 'Recetas con firma del odontólogo', 'tab-recetas'], ['Órdenes Laboratorio', 'Trabajos enviados al laboratorio', 'tab-lab']];
      return '<div class="mnf-tabs">' + t.map(function (x, i) { return '<button type="button" data-mn-ir="' + x[2] + '"' + (i ? '' : ' class="on"') + ' title="Ir a la explicación de ' + esc(x[0]) + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' +
        '<div class="mnf-tabdesc">' + t.map(function (x) { return '<button type="button" data-mn-ir="' + x[2] + '"><b>' + esc(x[0]) + '</b>' + esc(x[1]) + '<em>Ver explicación ›</em></button>'; }).join('') + '</div>';
    },
    'tab-historia': function () {
      return '<div class="mnf-2col"><div class="mnf-lista"><b class="mnf-mini">Registros por fecha</b><span class="on">05 nov 2026 · Cita 128</span><span>12 ago 2026 · Cita 97</span><em class="mnf-btn">+ Agregar nuevo registro</em></div><div>' +
        '<div class="mnf-barra"><em class="mnf-btn osc">Dictar historia médica</em><small class="mnf-ayuda">«alergias penicilina, enfermedades hipertensión, medicamentos losartán 50 mg cada 24 horas… guardar»</small></div>' +
        '<div class="mnf-grid">' + campo('Fecha *', '05/11/2026') + campo('Número de cita (agenda)', 'Cita 128 · Limpieza', { sel: true, ancho: 'm' }) + '<div></div>' +
        campo('Alergias', 'Penicilina', { ancho: 't', boton: 'Dictar' }) + campo('Enfermedades y condiciones', 'Hipertensión arterial controlada', { ancho: 't', boton: 'Dictar' }) + campo('Medicamentos actuales', 'Losartán 50 mg cada 24 horas', { ancho: 't', boton: 'Dictar' }) + '</div>' +
        '<div class="mnf-barra"><em class="mnf-btn osc">Guardar</em><em class="mnf-btn">Modificar</em><em class="mnf-btn">Eliminar</em></div></div></div>';
    },
    'tab-odonto': function () {
      var marcas = { 16: ['car', 'Caries O'], 21: ['azul', 'CR'], 36: ['rojo', 'EX'], 46: ['azul', 'TC'], 26: ['azul', 'Obt.'], 48: ['gris', 'AU'] };
      function pieza(n) { var m = marcas[n]; return '<span class="mnf-pieza' + (m ? ' ' + m[0] : '') + '" title="' + n + (m ? ' · ' + m[1] : '') + '"><i>' + (m ? esc(m[1]) : '') + '</i><small>' + n + '</small></span>'; }
      var sup = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], inf = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
      return '<div class="mnf-barra"><span class="on">Permanente</span><span>Mixta</span><span>Temporal</span><b class="mnf-mini" style="margin-left:8px">Por cara</b><span>Caries</span><span class="on">Obturación</span><b class="mnf-mini">Pieza completa</b><span>Corona</span><span>Endodoncia</span><span>Implante</span><span>Extracción</span><span>Ausente</span><span>Borrar</span><b class="mnf-mini">Toda la boca</b><span>Limpieza</span><em class="mnf-btn osc">Dictar odontograma</em></div>' +
        '<div class="mnf-boca"><div>' + sup.map(pieza).join('') + '</div><div>' + inf.map(pieza).join('') + '</div></div>' +
        '<div class="mnf-leyenda"><span><i class="rojo"></i>Requerido (rojo)</span><span><i class="azul"></i>Realizado (azul)</span><span><i class="gris"></i>Ausente</span></div>' +
        '<table class="mnf-tabla"><thead><tr><th>Fecha del cambio</th><th>Pieza</th><th>Cambio</th><th>Observaciones</th><th>Usuario</th></tr></thead><tbody>' +
        '<tr><td>05 nov 2026</td><td>16</td><td>Caries oclusal (requerido)</td><td>Pasa al presupuesto: Resina de una superficie</td><td>oliver</td></tr>' +
        '<tr><td>05 nov 2026</td><td>46</td><td>Endodoncia (realizado)</td><td>—</td><td>oliver</td></tr></tbody></table>';
    },
    'tab-trat': function () {
      return '<div class="mnf-kpis"><div><span>Tratamientos finalizados</span><b>Q1,750.00</b></div><div><span>Pagado</span><b>Q1,400.00</b></div><div class="alerta"><span>Saldo pendiente</span><b>Q350.00</b></div><div><span>Pendiente y en proceso</span><b>Q900.00</b></div></div>' +
        '<div class="mnf-barra"><span class="on">Finalizados (2)</span><span>En proceso (1)</span><span>Todos (3)</span><em class="mnf-btn">✦ Seguimientos</em><em class="mnf-btn">✦ Cuidados</em><em class="mnf-btn">Imprimir</em></div>' +
        '<table class="mnf-tabla"><thead><tr><th>Fecha estado</th><th>Tratamiento</th><th>Estado</th><th>Cant.</th><th>Precio</th><th>Total</th><th>Presupuesto</th></tr></thead><tbody>' +
        '<tr><td>05 nov 2026</td><td>Resina de una superficie · pieza 16</td><td><em class="mnf-est">Finalizado</em></td><td>1</td><td>Q350.00</td><td>Q350.00</td><td>PRE-0034</td></tr>' +
        '<tr><td>05 nov 2026</td><td>Limpieza dental (profilaxis)</td><td><em class="mnf-est">Finalizado</em></td><td>1</td><td>Q1,400.00</td><td>Q1,400.00</td><td>PRE-0034</td></tr>' +
        '<tr><td>05 nov 2026</td><td>Tratamiento de conductos unirradicular · pieza 46</td><td><em class="mnf-est proc">Proceso</em></td><td>1</td><td>Q900.00</td><td>Q900.00</td><td>PRE-0034</td></tr></tbody></table>';
    },
    'tab-notas': function () {
      return '<div class="mnf-grid">' + campo('Fecha de la visita', '05/11/2026') + campo('Nota', 'Paciente refiere sensibilidad al frío en pieza 16; se coloca resina y se dan indicaciones.', { ancho: 'g' }) + '</div>' +
        '<div class="mnf-barra"><em class="mnf-btn osc">Agregar nota</em></div>' +
        '<div class="mnf-notasvis"><div><b>05 nov 2026 · oliver</b>Paciente refiere sensibilidad al frío en pieza 16; se coloca resina y se dan indicaciones.</div><div><b>12 ago 2026 · oliver</b>Limpieza completa; se recomienda control en 6 meses.</div></div>';
    },
    'tab-rx': function () {
      return '<div class="mnf-barra"><em class="mnf-buscar" style="margin-left:0;min-width:260px">Archivo (JPG, PNG, WEBP o PDF, hasta 10 MB)</em><em class="mnf-btn osc">Subir</em></div>' +
        '<div class="mnf-rx"><figure><i></i><figcaption>Panorámica · 05 nov 2026</figcaption></figure><figure><i class="peri"></i><figcaption>Periapical pieza 46 · 05 nov 2026</figcaption></figure><figure><i class="pdf">PDF</i><figcaption>Informe radiológico · 12 ago 2026</figcaption></figure></div>';
    },
    'tab-recetas': function () {
      return '<div class="mnf-grid">' + campo('Fecha de atención *', '05/11/2026') + campo('Hora', '10:30') + campo('Médico que receta', 'Isaack Salaverria Donis', { sel: true, ancho: 'm' }) +
        campo('Diagnóstico', 'Pulpitis irreversible pieza 46', { ancho: 'g' }) + campo('Próxima cita', '12/11/2026') + '</div>' +
        '<div class="mnf-barra"><em class="mnf-btn osc">✦ Sugerir receta con IA</em><small class="mnf-ayuda">La IA propone medicamentos según el diagnóstico y las alergias registradas; el odontólogo revisa y ajusta.</small></div>' +
        '<table class="mnf-tabla"><thead><tr><th>Medicamento y presentación</th><th>Dosis</th><th>Frecuencia</th><th>Duración</th></tr></thead><tbody>' +
        '<tr><td>Ibuprofeno 400 mg, tabletas</td><td>1 tableta</td><td>Cada 8 horas</td><td>3 días</td></tr><tr><td>Clorhexidina 0.12 %, enjuague</td><td>15 ml</td><td>Cada 12 horas</td><td>7 días</td></tr></tbody></table>' +
        '<p class="mnf-ayuda" style="margin:8px 0 0">Indicaciones generales: tomar con alimentos. Alergia registrada: <b>penicilina</b> — no se recetan amoxicilinas.</p>';
    },
    'tab-lab': function () {
      return '<div class="mnf-2col"><div class="mnf-lista"><em class="mnf-btn osc">+ Nueva orden</em><em class="mnf-btn">Nueva orden por voz</em><span class="on">LAB-0012 · Corona sobre implante · pieza 36 <small>Dental Lab Guatemala · En proceso</small></span></div><div>' +
        '<div class="mnf-flujo"><span>Enviada · 05 nov</span><i>›</i><span class="clave">En proceso</span><i>›</i><span>Prueba en clínica</span><i>›</i><span>Recibida</span><i>›</i><span>Colocada</span></div>' +
        '<div class="mnf-grid" style="margin-top:10px">' + campo('Laboratorio', 'Dental Lab Guatemala', { sel: true, ancho: 'm' }) + campo('Tipo de trabajo', 'Corona sobre implante', { ancho: 'm' }) +
        campo('Piezas (FDI)', '36') + campo('Material', 'Disilicato de litio (e.max)') + campo('Color (VITA)', 'A2', { sel: true }) + campo('Entrega prometida', '20/11/2026') + '</div>' +
        '<div class="mnf-sec"><b>✓</b>Recepción del laboratorio</div><div class="mnf-grid">' + campo('Fecha y hora de recepción', '21/11/2026 15:15:00', { ancho: 'm' }) + campo('Persona que entrega', 'Mensajero del laboratorio') + campo('Persona que recibe', 'Recepción') + '</div></div></div>';
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
    if (Array.isArray(f)) return f.map(figura).join('');
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
        return '<li' + (p.id ? ' id="mnp-' + esc(p.id) + '"' : '') + '><div><b>' + esc(p.titulo) + '</b><p>' + esc(p.detalle) + '</p>' + figura(p.figura) +
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
  // Botones dentro de las figuras que llevan a otro paso del capítulo (p. ej. las pestañas del expediente)
  $('mnCap').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mn-ir]'), d = b && $('mnp-' + b.dataset.mnIr);
    if (d) { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); d.classList.remove('mn-resalta'); void d.offsetWidth; d.classList.add('mn-resalta'); }
  });
  $('mnImprimirTodo').addEventListener('click', imprimir);
  $('tabManual').addEventListener('click', cargar);

  window.PD_MODULOS = window.PD_MODULOS || [];
  window.PD_MODULOS.push({ cargar: cargar, limpiar: limpiar });
})();
