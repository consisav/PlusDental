// Plus Dental — Manual del CRM
// Un capítulo por pantalla del panel. La IA (función manual-ia) lo redacta a partir de la estructura real de la pantalla
// (títulos, campos, botones, columnas) y de los datos que tiene cargados; se guarda en manual_capitulos (supabase.sql).
(function () {
  var sb = window.PD_SB || null;
  if (!sb || !document.getElementById('admManual')) return;

  var caps = {}, indice = [], actual = null, generando = false;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function aviso(texto, error) { $('mnMsg').textContent = texto || ''; $('mnMsg').style.color = error ? '#9A3B2E' : '#475B68'; }
  function usuario() { return (window.PD_SESION && window.PD_SESION.usuario()) || ''; }
  function limpio(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  // Texto propio de un botón o etiqueta (sin contadores ni el contenido de listas)
  function textoDe(el, quitar) {
    var c = el.cloneNode(true);
    c.querySelectorAll(quitar || 'span.adm-count, select, textarea, option').forEach(function (x) { x.remove(); });
    return limpio(c.textContent);
  }
  // Teléfonos, correos, DPI y NIT no viajan a la IA
  function enmascarar(t) {
    return t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
      .replace(/\b\d{4}\s?\d{5}\s?\d{4}\b/g, '[DPI]')
      .replace(/(\+?502\s?)?\b\d{4}[\s-]\d{4}\b/g, '[teléfono]')
      .replace(/\b\d{8,}\b/g, '[número]');
  }

  // ---- Índice: se arma con el menú del panel, así incluye cualquier pantalla nueva ----
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
    var lista = todos(), hechos = lista.filter(function (i) { return caps[i.clave]; }).length;
    $('mnAvance').textContent = hechos + ' de ' + lista.length + ' capítulos';
    $('mnAvanceBarra').style.width = (lista.length ? Math.round(hechos * 100 / lista.length) : 0) + '%';
    $('mnIndice').innerHTML = indice.map(function (g, gi) {
      var sub = '';
      return '<div class="mn-g"><b>' + (gi + 1) + '. ' + esc(g.nombre) + '</b>' + g.items.map(function (i) {
        var cab = i.sub && i.sub !== sub ? '<span class="mn-sg">' + esc(i.sub) + '</span>' : '';
        sub = i.sub;
        return cab + '<button type="button" data-cap="' + esc(i.clave) + '" aria-current="' + (actual === i.clave) + '"' + (i.sub ? ' class="mn-en-sub"' : '') + '>' +
          '<span>' + esc(i.nombre) + '</span>' + (caps[i.clave] ? '<i class="mn-ok" title="Generado" aria-label="Generado">✓</i>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('');
  }

  // ---- Capítulo ----
  function htmlContenido(c) {
    return '<p class="mn-resumen">' + esc(c.resumen) + '</p>' +
      '<ol class="mn-pasos">' + (c.pasos || []).map(function (p) {
        return '<li><div><b>' + esc(p.titulo) + '</b><p>' + esc(p.detalle) + '</p>' +
          (p.ejemplo ? '<div class="mn-ej"><span>Ejemplo</span>' + esc(p.ejemplo) + '</div>' : '') + '</div></li>';
      }).join('') + '</ol>' +
      ((c.consejos || []).length ? '<div class="mn-consejos"><b>Consejos</b><ul>' + c.consejos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '');
  }
  function pintar() {
    var i = buscar(actual), cap = caps[actual];
    if (!i) { $('mnCap').innerHTML = ''; return; }
    $('mnCap').innerHTML =
      '<div class="mn-cab"><div><small>' + esc(i.ruta) + '</small><h4>' + esc(i.nombre) + '</h4>' +
      (cap ? '<span class="mn-meta">Generado con IA el ' + fechaHora(cap.generado_en) + (cap.generado_por ? ' por ' + esc(cap.generado_por) : '') + '</span>' : '') + '</div>' +
      '<div class="mn-acc"><button type="button" class="adm-btn" data-accion="ir">Ir a la pantalla</button>' +
      (cap ? '<button type="button" class="adm-btn" data-accion="imprimir">Imprimir capítulo</button><button type="button" class="adm-btn" data-accion="generar">Regenerar</button>' : '') + '</div></div>' +
      (generando ? '<div class="mn-cargando"><i aria-hidden="true"></i><span>Redactando el capítulo con IA… puede tardar hasta un minuto.</span></div>' :
        cap ? htmlContenido(cap.contenido) :
          '<div class="mn-vacio"><div><b>Este capítulo aún no se ha generado</b><span>La IA lee esta pantalla del panel (campos, botones y columnas) y los datos que tiene cargados, y redacta el paso a paso con ejemplos de la clínica. Los datos de pacientes se abrevian.</span></div>' +
          '<button type="button" class="adm-btn adm-primary" data-accion="generar">Generar con IA</button></div>');
    pintarIndice();
  }
  function ver(clave) { actual = clave; aviso(''); pintar(); }

  // ---- Lo que la IA recibe de la pantalla ----
  function estructura(pane) {
    var lineas = [], vistos = {};
    function agregar(t) { t = limpio(t); if (t && !vistos[t]) { vistos[t] = 1; lineas.push(t); } }
    pane.querySelectorAll('h3, h4, h5, legend, label, th, button, [placeholder]').forEach(function (el) {
      var tag = el.tagName;
      if (tag === 'BUTTON') { var b = textoDe(el); if (b && b.length < 50) agregar('Botón: ' + b); return; }
      if (tag === 'TH') { if (!el.closest('thead') || el === el.parentNode.firstElementChild) agregar('Columnas: ' + [].map.call(el.parentNode.children, function (x) { return limpio(x.textContent); }).filter(Boolean).join(' | ')); return; }
      if (tag === 'LABEL') {
        var ctl = el.querySelector('select, textarea, input') || (el.htmlFor && $(el.htmlFor));
        var tipo = !ctl ? '' : ctl.tagName === 'SELECT' ? ' (lista)' : ctl.tagName === 'TEXTAREA' ? ' (texto largo)' : ctl.type && ctl.type !== 'text' ? ' (' + ctl.type + ')' : '';
        agregar('Campo: ' + textoDe(el) + tipo); return;
      }
      if (el.hasAttribute('placeholder') && tag !== 'LABEL') { agregar('Ayuda en campo: ' + el.getAttribute('placeholder')); return; }
      if (limpio(el.textContent)) agregar('Título: ' + el.textContent);
    });
    return lineas.join('\n').slice(0, 9000);
  }
  function ejemplos(pane) {
    var partes = [];
    pane.querySelectorAll('table').forEach(function (t) {
      var filas = [].slice.call(t.querySelectorAll('tbody tr')).slice(0, 3).map(function (tr) {
        return [].map.call(tr.children, function (td) { return limpio(td.textContent).slice(0, 60); }).filter(Boolean).join(' | ');
      }).filter(Boolean);
      if (filas.length) partes.push('Tabla:\n' + filas.join('\n'));
    });
    pane.querySelectorAll('select').forEach(function (s) {
      var ops = [].slice.call(s.options).map(function (o) { return limpio(o.textContent); }).filter(function (o) { return o && !/^(—|-|seleccion|elegir|todos|todas)/i.test(o); }).slice(0, 6);
      var et = s.closest('label') ? textoDe(s.closest('label')) : s.getAttribute('aria-label') || '';
      if (ops.length > 1) partes.push('Opciones de «' + et + '»: ' + ops.join(', '));
    });
    return enmascarar(partes.join('\n')).slice(0, 5000);
  }

  async function mensajeError(r) {
    var codigo = '';
    try { codigo = (await r.error.context.json()).error; } catch (e) { /* sin cuerpo */ }
    return { sin_clave: 'Falta configurar la clave de IA (ANTHROPIC_API_KEY) en Supabase.', permiso: 'Tu usuario no tiene permiso para generar el manual.',
      ocupado: 'La IA está ocupada en este momento. Intenta de nuevo en un minuto.' }[codigo] || 'No se pudo generar el capítulo. Intenta de nuevo.';
  }
  async function generar() {
    var i = buscar(actual), pane = i && $(i.clave);
    if (!i || !pane || generando) return;
    generando = true; aviso(''); pintar();
    var r = await sb.functions.invoke('manual-ia', { body: { ruta: i.ruta, pantalla: i.nombre, estructura: estructura(pane), ejemplos: ejemplos(pane) } });
    if (r.error || !r.data || !r.data.pasos) {
      generando = false; pintar(); aviso(r.error ? await mensajeError(r) : 'La IA no devolvió el capítulo. Intenta de nuevo.', true); return;
    }
    var fila = { clave: i.clave, ruta: i.ruta, titulo: i.nombre, contenido: r.data, generado_por: usuario(), generado_en: new Date().toISOString() };
    var g = await sb.from('manual_capitulos').upsert(fila).select().single();
    generando = false;
    if (g.error) {
      caps[i.clave] = fila; pintar();
      aviso(/manual_capitulos/.test(g.error.message) ? 'Falta ejecutar en Supabase el script del Manual (supabase.sql); el capítulo no quedó guardado.' : 'El capítulo no quedó guardado: ' + g.error.message, true);
      return;
    }
    caps[i.clave] = g.data; pintar(); aviso('Capítulo generado y guardado.');
  }

  // ---- Impresión ----
  function htmlImpreso(i, cap) {
    var c = cap.contenido;
    return '<div style="page-break-inside:auto;margin-bottom:26px"><div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#005A87;font-weight:800">' + esc(i.ruta) + '</div>' +
      '<h2 style="font-size:19px;margin:4px 0 8px;color:#0B2B40">' + esc(i.nombre) + '</h2>' +
      '<p style="font-size:12.5px;color:#475B68;margin:0 0 12px">' + esc(c.resumen) + '</p>' +
      (c.pasos || []).map(function (p, n) {
        return '<div style="display:flex;gap:10px;margin-bottom:10px;page-break-inside:avoid"><div style="flex:none;width:22px;height:22px;border-radius:50%;background:#0B2B40;color:#FFF;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">' + (n + 1) + '</div>' +
          '<div style="font-size:12.5px"><b>' + esc(p.titulo) + '</b><div style="color:#334652;margin-top:2px">' + esc(p.detalle) + '</div>' +
          (p.ejemplo ? '<div style="margin-top:5px;background:#FFF8E8;border-left:3px solid #D69E2E;padding:5px 8px;color:#5C4210"><b>Ejemplo:</b> ' + esc(p.ejemplo) + '</div>' : '') + '</div></div>';
      }).join('') +
      ((c.consejos || []).length ? '<div style="background:#EEF5FA;border-radius:8px;padding:8px 12px;font-size:12px;page-break-inside:avoid"><b>Consejos</b><ul style="margin:4px 0 0;padding-left:18px">' + c.consejos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }
  function imprimir(soloActual) {
    var P = window.PD_IMPRESION; if (!P) return;
    var lista = (soloActual ? [buscar(actual)] : todos()).filter(function (i) { return i && caps[i.clave]; });
    if (!lista.length) { aviso('Aún no hay capítulos generados para imprimir.', true); return; }
    var indiceImp = soloActual ? '' : '<div style="font-size:12px;margin-bottom:22px;columns:2"><b style="display:block;margin-bottom:4px">Contenido</b>' +
      lista.map(function (i, n) { return '<div>' + (n + 1) + '. ' + esc(i.ruta) + '</div>'; }).join('') + '</div>';
    P.imprimir(P.encabezado(soloActual ? 'Manual · ' + lista[0].nombre : 'Manual del CRM') + indiceImp + lista.map(function (i) { return htmlImpreso(i, caps[i.clave]); }).join('') + '</div>');
  }

  // ---- Carga ----
  async function cargar() {
    armarIndice();
    if (!actual || !buscar(actual)) actual = todos()[0] && todos()[0].clave;
    var r = await sb.from('manual_capitulos').select('*');
    caps = {};
    if (r.error) aviso(/manual_capitulos/.test(r.error.message) ? 'Falta ejecutar en Supabase el script del Manual (supabase.sql).' : '', true);
    else r.data.forEach(function (c) { caps[c.clave] = c; });
    pintar();
  }
  function limpiar() { caps = {}; $('mnIndice').innerHTML = ''; $('mnCap').innerHTML = ''; aviso(''); }

  $('mnIndice').addEventListener('click', function (e) { var b = e.target.closest('[data-cap]'); if (b) ver(b.dataset.cap); });
  $('mnCap').addEventListener('click', function (e) {
    var b = e.target.closest('[data-accion]'); if (!b) return;
    if (b.dataset.accion === 'generar') generar();
    else if (b.dataset.accion === 'imprimir') imprimir(true);
    else if (b.dataset.accion === 'ir') { var t = document.querySelector('.adm-menu [data-tab="' + actual + '"]'); if (t) t.click(); }
  });
  $('mnImprimirTodo').addEventListener('click', function () { imprimir(false); });
  $('tabManual').addEventListener('click', cargar);

  window.PD_MODULOS = window.PD_MODULOS || [];
  window.PD_MODULOS.push({ cargar: cargar, limpiar: limpiar });
})();
