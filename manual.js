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

  // ---- Manual completo ----
  function htmlContenido(c) {
    return '<p class="mn-resumen">' + esc(c.resumen) + '</p>' +
      '<ol class="mn-pasos">' + (c.pasos || []).map(function (p) {
        return '<li><div><b>' + esc(p.titulo) + '</b><p>' + esc(p.detalle) + '</p>' +
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
          '<div style="font-size:12.5px"><b>' + esc(p.titulo) + '</b><div style="color:#334652;margin-top:2px">' + esc(p.detalle) + '</div>' +
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
