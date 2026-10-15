// Plus Dental — Ajustes para celulares.
// 1) En pantallas pequeñas las tablas del panel se muestran como tarjetas: cada celda lleva
//    como etiqueta el título de su columna (data-etq), que el CSS muestra a la izquierda.
// 2) Al elegir una opción del menú de Administración en el celular, la pantalla baja sola
//    hasta el contenido elegido (el menú queda arriba y antes había que buscarlo).
(function () {
  var MOVIL = window.matchMedia('(max-width: 640px)');
  var MENU_APILADO = window.matchMedia('(max-width: 960px)');

  // Tablas que NO se convierten: la agenda (cuadrícula de horarios) y lo que se imprime
  function convertible(t) { return !t.classList.contains('ag-grid') && !t.closest('#impresion') && !t.closest('[data-sin-tarjetas]'); }

  function etiquetar(t) {
    var head = t.tHead && t.tHead.rows[0];
    if (!head) return;
    var titulos = [], numerica = [];
    [].forEach.call(head.cells, function (th) {
      var texto = (th.querySelector('.sr-only') ? '' : th.textContent).trim();
      for (var i = 0; i < (th.colSpan || 1); i++) { titulos.push(texto); numerica.push(th.classList.contains('num')); }
    });
    t.classList.add('tabla-tarjetas');
    [].forEach.call(t.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr'), function (tr) {
      var col = 0;
      [].forEach.call(tr.cells, function (td) {
        var etq = td.colSpan > 1 && tr.cells.length === 1 ? '' : (titulos[col] || '');
        // En la fila de totales solo se rotulan las columnas de montos
        if (tr.parentElement.tagName === 'TFOOT' && !numerica[col]) etq = '';
        if (td.getAttribute('data-etq') !== etq) td.setAttribute('data-etq', etq);
        td.classList.toggle('td-sola', tr.cells.length === 1);
        col += td.colSpan || 1;
      });
    });
  }

  var pendiente = false;
  function revisar() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(function () {
      pendiente = false;
      [].forEach.call(document.querySelectorAll('#administracion table'), function (t) { if (convertible(t)) etiquetar(t); });
      // Aviso para deslizar el odontograma en pantallas angostas
      [].forEach.call(document.querySelectorAll('#administracion .odg-mapa'), function (m) {
        var prev = m.previousElementSibling;
        if (prev && prev.classList.contains('odg-pista')) return;
        var p = document.createElement('p');
        p.className = 'odg-pista';
        p.textContent = 'Desliza a los lados para ver todas las piezas ↔';
        m.parentNode.insertBefore(p, m);
      });
    });
  }

  function iniciar() {
    var panel = document.getElementById('administracion');
    if (!panel) return;
    revisar();
    // Las tablas se vuelven a dibujar al cargar datos o al cambiar de idioma
    new MutationObserver(revisar).observe(panel, { childList: true, subtree: true, characterData: true });

    panel.addEventListener('click', function (e) {
      var b = e.target.closest('.adm-menu [data-tab]');
      if (!b || !MENU_APILADO.matches) return;
      setTimeout(function () {
        var destino = document.getElementById(b.dataset.tab);
        if (!destino || destino.hidden) return;
        var barra = document.querySelector('.topbar');
        var alto = barra ? barra.getBoundingClientRect().height : 80;
        window.scrollTo({ top: destino.getBoundingClientRect().top + window.pageYOffset - alto - 12, behavior: 'smooth' });
      }, 30);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.PD_MOVIL = { esMovil: function () { return MOVIL.matches; } };
})();
