// Plus Dental — Odontograma por caras (notación FDI)
// Denticiones: permanente (adultos, 11–48), temporal (niños, 51–85) y mixta.
// Requerido = rojo, Realizado = azul. Datos: { v: 2, denticion, piezas: { "16": { caras: { O: { h, c } }, estados: { corona: "r" } } } }
(function () {
  var ROJO = '#D62839', AZUL = '#1F6FEB';
  var HERRAMIENTAS = [
    { id: 'caries', nombre: 'Caries', tipo: 'cara', fijo: 'r' },
    { id: 'obturacion', nombre: 'Obturación', tipo: 'cara' },
    { id: 'corona', nombre: 'Corona', tipo: 'pieza', abrev: 'CR' },
    { id: 'endodoncia', nombre: 'Endodoncia', tipo: 'pieza', abrev: 'TC' },
    { id: 'implante', nombre: 'Implante', tipo: 'pieza', abrev: 'IM' },
    { id: 'extraccion', nombre: 'Extracción indicada', tipo: 'pieza', fijo: 'r', abrev: 'EX' },
    { id: 'ausente', nombre: 'Ausente', tipo: 'pieza', fijo: 'a', abrev: 'AU' },
    { id: 'borrar', nombre: 'Borrar pieza', tipo: 'borrar' }
  ];
  var POR_ID = {}; HERRAMIENTAS.forEach(function (h) { POR_ID[h.id] = h; });
  var DENTICIONES = [['permanente', 'Permanente (adulto)'], ['temporal', 'Temporal (niño)'], ['mixta', 'Mixta']];
  var FILAS = {
    psup: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
    pinf: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
    tsup: [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65]],
    tinf: [[85, 84, 83, 82, 81], [71, 72, 73, 74, 75]]
  };
  var ORDEN = [].concat(FILAS.psup[0], FILAS.psup[1], FILAS.tsup[0], FILAS.tsup[1], FILAS.tinf[0], FILAS.tinf[1], FILAS.pinf[0], FILAS.pinf[1]);
  // Las 4 caras alrededor del centro (círculo exterior r=26, interior r=11, centro 30,30)
  var SEG = {
    arriba: 'M11.62 11.62A26 26 0 0 1 48.38 11.62L37.78 22.22A11 11 0 0 0 22.22 22.22Z',
    derecha: 'M48.38 11.62A26 26 0 0 1 48.38 48.38L37.78 37.78A11 11 0 0 0 37.78 22.22Z',
    abajo: 'M48.38 48.38A26 26 0 0 1 11.62 48.38L22.22 37.78A11 11 0 0 0 37.78 37.78Z',
    izquierda: 'M11.62 48.38A26 26 0 0 1 11.62 11.62L22.22 22.22A11 11 0 0 0 22.22 37.78Z'
  };

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Qué cara anatómica queda en cada posición del dibujo
  function geometria(n) {
    var cuad = Math.floor(n / 10), pos = n % 10;
    var superior = [1, 2, 5, 6].indexOf(cuad) >= 0;
    var ladoDerechoPaciente = [1, 4, 5, 8].indexOf(cuad) >= 0; // se dibuja a la izquierda de la pantalla
    return {
      superior: superior,
      arriba: superior ? 'V' : 'L',
      abajo: superior ? 'L' : 'V',
      derecha: ladoDerechoPaciente ? 'M' : 'D',
      izquierda: ladoDerechoPaciente ? 'D' : 'M',
      centro: pos <= 3 ? 'I' : 'O'
    };
  }
  function nombreCara(cara, n) {
    if (cara === 'L') return geometria(n).superior ? 'palatina' : 'lingual';
    return { V: 'vestibular', M: 'mesial', D: 'distal', O: 'oclusal', I: 'incisal' }[cara];
  }
  function color(h, c) { return h === 'caries' || c === 'r' ? ROJO : AZUL; }

  // Convierte el formato anterior { "16": "caries" } al actual
  function normalizar(datos, edad) {
    var vacio = { v: 2, denticion: edad != null && edad < 6 ? 'temporal' : edad != null && edad < 13 ? 'mixta' : 'permanente', piezas: {} };
    if (!datos || typeof datos !== 'object') return vacio;
    if (datos.v === 2) return { v: 2, denticion: datos.denticion || vacio.denticion, piezas: JSON.parse(JSON.stringify(datos.piezas || {})) };
    var conv = { v: 2, denticion: vacio.denticion, piezas: {} };
    Object.keys(datos).forEach(function (n) {
      var e = datos[n], p = { caras: {}, estados: {} }, centro = geometria(+n).centro;
      if (e === 'caries') p.caras[centro] = { h: 'caries', c: 'r' };
      else if (e === 'obturado') p.caras[centro] = { h: 'obturacion', c: 'a' };
      else if (e === 'extraccion') p.estados.extraccion = 'r';
      else if (POR_ID[e]) p.estados[e] = 'a';
      conv.piezas[n] = p;
    });
    if (Object.keys(datos).length) conv.denticion = 'permanente';
    return conv;
  }

  function inyectarEstilos() {
    if (document.getElementById('odg-estilos')) return;
    var css = [
      '.odg{font-family:Manrope,system-ui,sans-serif;color:#0F2A2E;display:flex;flex-direction:column;gap:16px}',
      '.odg-barra{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between}',
      '.odg-seg{display:inline-flex;border:1px solid #C9D4D2;border-radius:999px;padding:3px;background:#F7F8F6;flex-wrap:wrap}',
      '.odg-seg button{font:inherit;font-size:14px;font-weight:600;border:0;background:transparent;color:#44585B;padding:8px 14px;border-radius:999px;cursor:pointer;min-height:38px}',
      '.odg-seg button[aria-pressed="true"]{background:#0F2A2E;color:#FFFFFF}',
      '.odg-seg .r[aria-pressed="true"]{background:' + ROJO + '}.odg-seg .a[aria-pressed="true"]{background:' + AZUL + '}',
      '.odg-herr{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.odg-herr .grupo{font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#5B6E70;margin-right:2px}',
      '.odg-herr button{font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:7px;padding:7px 12px;min-height:36px;border-radius:10px;border:1px solid #C9D4D2;background:#FFFFFF;color:#0F2A2E;cursor:pointer}',
      '.odg-herr button:hover{border-color:#0F2A2E}',
      '.odg-herr button[aria-pressed="true"]{border-color:#0F2A2E;box-shadow:inset 0 0 0 1.5px #0F2A2E;background:#F1F5F4}',
      '.odg-herr svg{flex:0 0 auto}',
      '.odg-lienzo{overflow-x:auto;background:#FFFFFF;border:1px solid #DCE3E1;border-radius:18px;padding:18px 16px 10px}',
      '.odg-mapa{min-width:680px;display:flex;flex-direction:column;gap:6px}',
      '.odg-fila{display:grid;gap:4px;justify-content:center}',
      '.odg-sep{height:1px;background:#DCE3E1;margin:8px 0}',
      '.odg-etq{font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#5B6E70;text-align:center;margin:6px 0 2px}',
      '.odg-pz{display:flex;flex-direction:column;align-items:center;gap:2px;border-radius:10px;padding:3px 1px;outline:none}',
      '.odg-pz:focus-visible{box-shadow:0 0 0 2px #0B6E69}',
      '.odg-pz .num{font-size:12px;font-weight:700;color:#44585B;font-variant-numeric:tabular-nums}',
      '.odg-pz svg{width:100%;max-width:52px;height:auto;display:block;overflow:visible}',
      '.odg-pz path,.odg-pz .cen{stroke:#8A9A9C;stroke-width:1.2;fill:#FFFFFF;cursor:pointer;transition:fill .12s}',
      '.odg-pz path:hover,.odg-pz .cen:hover{fill:#EAF1F0}',
      '.odg-pz .tira{min-height:16px;display:flex;gap:2px;justify-content:center;flex-wrap:wrap}',
      '.odg-pz .tira span{font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 3px;border-radius:3px;color:#FFFFFF;line-height:1.3}',
      '.odg-pz.ausente svg .cuerpo{opacity:.35}',
      '.odg-ley{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:#44585B}',
      '.odg-ley i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}',
      '.odg-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}',
      '.odg-res div{background:#F7F8F6;border:1px solid #DCE3E1;border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.55}',
      '.odg-res h4{margin:0 0 6px;font-size:13px;letter-spacing:.5px;text-transform:uppercase}',
      '.odg-res ul{margin:0;padding-left:18px}',
      '@media (prefers-reduced-motion:reduce){.odg-pz path,.odg-pz .cen{transition:none}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'odg-estilos';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function icono(h, modo) {
    var c = h.fijo ? (h.fijo === 'r' ? ROJO : AZUL) : (modo === 'r' ? ROJO : AZUL);
    var base = '<svg width="18" height="18" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="26" fill="#FFFFFF" stroke="#8A9A9C" stroke-width="3"/>';
    var marca = {
      caries: '<circle cx="30" cy="30" r="12" fill="' + c + '"/>',
      obturacion: '<path d="' + SEG.arriba + '" fill="' + c + '"/><circle cx="30" cy="30" r="11" fill="' + c + '"/>',
      corona: '<circle cx="30" cy="30" r="27" fill="none" stroke="' + c + '" stroke-width="7"/>',
      endodoncia: '<line x1="30" y1="2" x2="30" y2="58" stroke="' + c + '" stroke-width="8"/>',
      implante: '<text x="30" y="40" text-anchor="middle" font-size="28" font-weight="800" fill="' + c + '">IM</text>',
      extraccion: '<path d="M10 10L50 50M50 10L10 50" stroke="' + c + '" stroke-width="8"/>',
      ausente: '<path d="M8 52L52 8" stroke="' + c + '" stroke-width="8"/>',
      borrar: '<path d="M18 18L42 42M42 18L18 42" stroke="#5B6E70" stroke-width="7"/>'
    }[h.id];
    return base + marca + '</svg>';
  }

  function crear(raiz, opciones) {
    opciones = opciones || {};
    inyectarEstilos();
    var datos = normalizar(null), herramienta = 'caries', modo = 'r';

    function pieza(n) { return datos.piezas[n] || (datos.piezas[n] = { caras: {}, estados: {} }); }
    function limpiarVacias(n) {
      var p = datos.piezas[n];
      if (p && !Object.keys(p.caras).length && !Object.keys(p.estados).length) delete datos.piezas[n];
    }
    function avisar() { if (opciones.onCambio) opciones.onCambio(); }

    function dibujarPieza(n) {
      var g = geometria(n), p = datos.piezas[n] || { caras: {}, estados: {} }, e = p.estados;
      function relleno(cara) {
        var m = p.caras[cara];
        return m ? ' style="fill:' + color(m.h, m.c) + '"' : '';
      }
      function titulo(cara) {
        var m = p.caras[cara];
        return '<title>' + n + ' · ' + nombreCara(cara, n) + (m ? ': ' + POR_ID[m.h].nombre + (m.h === 'caries' ? '' : m.c === 'r' ? ' (requerido)' : ' (realizado)') : '') + '</title>';
      }
      var svg = '<svg viewBox="-4 -4 68 68" role="img" aria-hidden="true"><g class="cuerpo">' +
        ['arriba', 'derecha', 'abajo', 'izquierda'].map(function (pos) {
          return '<path d="' + SEG[pos] + '" data-cara="' + g[pos] + '"' + relleno(g[pos]) + '>' + titulo(g[pos]) + '</path>';
        }).join('') +
        '<circle class="cen" cx="30" cy="30" r="11" data-cara="' + g.centro + '"' + relleno(g.centro) + '>' + titulo(g.centro) + '</circle></g>';
      if (e.corona) svg += '<circle cx="30" cy="30" r="29.5" fill="none" stroke="' + color('', e.corona) + '" stroke-width="2.6" pointer-events="none"/>';
      if (e.endodoncia) svg += '<line x1="30" y1="-3" x2="30" y2="63" stroke="' + color('', e.endodoncia) + '" stroke-width="3" pointer-events="none"/>';
      if (e.extraccion) svg += '<path d="M6 6L54 54M54 6L6 54" stroke="' + ROJO + '" stroke-width="3.2" stroke-linecap="round" pointer-events="none"/>';
      if (e.ausente) svg += '<path d="M2 58L58 2" stroke="' + AZUL + '" stroke-width="3.2" stroke-linecap="round" pointer-events="none"/>';
      svg += '</svg>';
      var tira = ['corona', 'endodoncia', 'implante', 'extraccion', 'ausente'].filter(function (k) { return e[k]; }).map(function (k) {
        return '<span style="background:' + color(k === 'extraccion' ? 'caries' : '', e[k]) + '" title="' + POR_ID[k].nombre + '">' + POR_ID[k].abrev + '</span>';
      }).join('');
      var resumen = describir(n).join('; ');
      var arriba = g.superior;
      return '<div class="odg-pz' + (e.ausente ? ' ausente' : '') + '" data-pieza="' + n + '" tabindex="0" role="button" aria-label="Pieza ' + n + (resumen ? ': ' + esc(resumen) : ', sin hallazgos') + '">' +
        (arriba ? '<span class="num">' + n + '</span>' + svg + '<span class="tira">' + tira + '</span>'
          : '<span class="tira">' + tira + '</span>' + svg + '<span class="num">' + n + '</span>') + '</div>';
    }

    function fila(izq, der) {

      return '<div class="odg-fila" style="grid-template-columns:repeat(' + izq.length + ',minmax(0,52px)) 18px repeat(' + der.length + ',minmax(0,52px))">' +
        izq.map(dibujarPieza).join('') + '<span></span>' + der.map(dibujarPieza).join('') + '</div>';
    }

    function describir(n) {
      var p = datos.piezas[n];
      if (!p) return [];
      var out = [];
      Object.keys(p.caras).forEach(function (cara) {
        var m = p.caras[cara];
        out.push(POR_ID[m.h].nombre + ' ' + nombreCara(cara, n) + (m.h === 'caries' ? '' : m.c === 'r' ? ' (requerido)' : ' (realizado)'));
      });
      Object.keys(p.estados).forEach(function (k) {
        out.push(POR_ID[k].nombre + (POR_ID[k].fijo ? '' : p.estados[k] === 'r' ? ' (requerido)' : ' (realizado)'));
      });
      return out;
    }

    function resumen() {
      var req = [], hecho = [];
      ORDEN.forEach(function (n) {
        var p = datos.piezas[n];
        if (!p) return;
        Object.keys(p.caras).forEach(function (cara) {
          var m = p.caras[cara];
          var linea = '<li><strong>' + n + '</strong> · ' + POR_ID[m.h].nombre + ' ' + nombreCara(cara, n) + '</li>';
          (m.h === 'caries' || m.c === 'r' ? req : hecho).push(linea);
        });
        Object.keys(p.estados).forEach(function (k) {
          var linea = '<li><strong>' + n + '</strong> · ' + POR_ID[k].nombre + '</li>';
          (p.estados[k] === 'r' ? req : hecho).push(linea);
        });
      });
      return '<div><h4 style="color:' + ROJO + '">Requerido (' + req.length + ')</h4>' + (req.length ? '<ul>' + req.join('') + '</ul>' : 'Sin tratamientos pendientes.') + '</div>' +
        '<div><h4 style="color:' + AZUL + '">Realizado / existente (' + hecho.length + ')</h4>' + (hecho.length ? '<ul>' + hecho.join('') + '</ul>' : 'Sin registros.') + '</div>';
    }

    function pintar() {
      var d = datos.denticion, mapa = [];
      if (d !== 'temporal') mapa.push('<div class="odg-etq">Arcada superior · permanente</div>', fila(FILAS.psup[0], FILAS.psup[1]));
      if (d !== 'permanente') mapa.push('<div class="odg-etq">Arcada superior · temporal</div>', fila(FILAS.tsup[0], FILAS.tsup[1]));
      mapa.push('<div class="odg-sep"></div>');
      if (d !== 'permanente') mapa.push(fila(FILAS.tinf[0], FILAS.tinf[1]), '<div class="odg-etq">Arcada inferior · temporal</div>');
      if (d !== 'temporal') mapa.push(fila(FILAS.pinf[0], FILAS.pinf[1]), '<div class="odg-etq">Arcada inferior · permanente</div>');

      var hActual = POR_ID[herramienta];
      raiz.innerHTML = '<div class="odg">' +
        '<div class="odg-barra">' +
        '<div class="odg-seg" role="group" aria-label="Dentición">' + DENTICIONES.map(function (x) {
          return '<button type="button" data-denticion="' + x[0] + '" aria-pressed="' + (d === x[0]) + '">' + x[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="odg-seg" role="group" aria-label="Marcar como">' +
        '<button type="button" class="r" data-modo="r" aria-pressed="' + (modo === 'r') + '"' + (hActual.fijo || hActual.tipo === 'borrar' ? ' disabled' : '') + '>Requerido</button>' +
        '<button type="button" class="a" data-modo="a" aria-pressed="' + (modo === 'a') + '"' + (hActual.fijo || hActual.tipo === 'borrar' ? ' disabled' : '') + '>Realizado</button></div>' +
        '</div>' +
        '<div class="odg-herr" role="group" aria-label="Herramienta">' +
        '<span class="grupo">Por cara</span>' + HERRAMIENTAS.filter(function (h) { return h.tipo === 'cara'; }).map(boton).join('') +
        '<span class="grupo" style="margin-left:8px">Pieza completa</span>' + HERRAMIENTAS.filter(function (h) { return h.tipo !== 'cara'; }).map(boton).join('') +
        '</div>' +
        '<div class="odg-lienzo"><div class="odg-mapa">' + mapa.join('') + '</div></div>' +
        '<div class="odg-ley"><span><i style="background:' + ROJO + '"></i>Requerido / caries</span><span><i style="background:' + AZUL + '"></i>Realizado / existente</span>' +
        '<span>CR corona · TC endodoncia · IM implante · EX extracción indicada · AU ausente</span></div>' +
        '<div class="odg-res">' + resumen() + '</div></div>';
    }
    function boton(h) {
      return '<button type="button" data-herr="' + h.id + '" aria-pressed="' + (herramienta === h.id) + '">' + icono(h, modo) + h.nombre + '</button>';
    }

    function aplicar(n, cara) {
      var h = POR_ID[herramienta], c = h.fijo || modo;
      if (h.tipo === 'borrar') { delete datos.piezas[n]; return true; }
      var p = pieza(n);
      if (h.tipo === 'cara') {
        if (!cara) return false;
        var m = p.caras[cara];
        if (m && m.h === h.id && m.c === c) delete p.caras[cara];
        else { p.caras[cara] = { h: h.id, c: c }; delete p.estados.ausente; }
      } else {
        if (p.estados[h.id] === c) delete p.estados[h.id];
        else {
          p.estados[h.id] = c;
          if (h.id === 'ausente') { p.caras = {}; p.estados = { ausente: 'a' }; }
          else delete p.estados.ausente;
        }
      }
      limpiarVacias(n);
      return true;
    }

    raiz.addEventListener('click', function (e) {
      var b = e.target.closest('[data-denticion],[data-modo],[data-herr]');
      if (b) {
        if (b.dataset.denticion) { datos.denticion = b.dataset.denticion; avisar(); }
        if (b.dataset.modo) modo = b.dataset.modo;
        if (b.dataset.herr) herramienta = b.dataset.herr;
        pintar();
        return;
      }
      var pz = e.target.closest('[data-pieza]');
      if (!pz) return;
      var caraEl = e.target.closest('[data-cara]');
      if (aplicar(+pz.dataset.pieza, caraEl && caraEl.dataset.cara)) {
        avisar();
        pintar();
        var mismo = raiz.querySelector('[data-pieza="' + pz.dataset.pieza + '"]');
        if (mismo && document.activeElement === document.body) mismo.focus({ preventScroll: true });
      }
    });
    // Teclado: Enter o espacio aplica la herramienta (por cara, sobre la cara oclusal/incisal)
    raiz.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var pz = e.target.closest('[data-pieza]');
      if (!pz) return;
      e.preventDefault();
      var n = +pz.dataset.pieza;
      if (aplicar(n, geometria(n).centro)) {
        avisar();
        pintar();
        var mismo = raiz.querySelector('[data-pieza="' + n + '"]');
        if (mismo) mismo.focus();
      }
    });

    pintar();
    return {
      cargar: function (valor, edad) { datos = normalizar(valor, edad); pintar(); },
      valor: function () { return JSON.parse(JSON.stringify(datos)); },
      hallazgos: function () { return Object.keys(datos.piezas).length; }
    };
  }

  // Qué cambió entre dos odontogramas, pieza por pieza: [{ clave, pieza, descripcion }]
  function etiquetaCara(m, cara, n) { return POR_ID[m.h].nombre + ' ' + nombreCara(cara, n) + (m.h === 'caries' ? '' : m.c === 'r' ? ' (requerido)' : ' (realizado)'); }
  function etiquetaEstado(k, c) { return POR_ID[k].nombre + (POR_ID[k].fijo ? '' : c === 'r' ? ' (requerido)' : ' (realizado)'); }
  function diferencias(antes, despues) {
    var a = normalizar(antes), b = normalizar(despues), out = [];
    var nombreDent = {}; DENTICIONES.forEach(function (d) { nombreDent[d[0]] = d[1]; });
    if (a.denticion !== b.denticion) {
      out.push({ clave: 'denticion', pieza: null, descripcion: 'Dentición: ' + nombreDent[a.denticion] + ' → ' + nombreDent[b.denticion] });
    }
    var piezas = Object.keys(a.piezas).concat(Object.keys(b.piezas))
      .filter(function (n, i, arr) { return arr.indexOf(n) === i; })
      .sort(function (x, y) { return ORDEN.indexOf(+x) - ORDEN.indexOf(+y); });
    piezas.forEach(function (n) {
      var pa = a.piezas[n] || { caras: {}, estados: {} }, pb = b.piezas[n] || { caras: {}, estados: {} };
      var agregado = [], quitado = [];
      Object.keys(pa.caras).concat(Object.keys(pb.caras)).filter(function (c, i, arr) { return arr.indexOf(c) === i; }).forEach(function (cara) {
        var ma = pa.caras[cara], mb = pb.caras[cara];
        if (ma && mb && ma.h === mb.h && ma.c === mb.c) return;
        if (ma) quitado.push(etiquetaCara(ma, cara, +n));
        if (mb) agregado.push(etiquetaCara(mb, cara, +n));
      });
      Object.keys(pa.estados).concat(Object.keys(pb.estados)).filter(function (k, i, arr) { return arr.indexOf(k) === i; }).forEach(function (k) {
        if (pa.estados[k] === pb.estados[k]) return;
        if (pa.estados[k]) quitado.push(etiquetaEstado(k, pa.estados[k]));
        if (pb.estados[k]) agregado.push(etiquetaEstado(k, pb.estados[k]));
      });
      if (agregado.length || quitado.length) {
        out.push({
          clave: String(n), pieza: +n,
          descripcion: [agregado.length ? 'Agregado: ' + agregado.join(', ') : '', quitado.length ? 'Quitado: ' + quitado.join(', ') : ''].filter(Boolean).join(' · ')
        });
      }
    });
    return out;
  }

  window.Odontograma = { crear: crear, diferencias: diferencias };
})();
