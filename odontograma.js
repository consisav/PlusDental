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
  // Procedimientos del catálogo relacionados con cada herramienta (por palabras en el nombre)
  var CLAVES = {
    caries: ['resina', 'obtura', 'amalgama', 'incrustac', 'ionomero', 'restaura'],
    obturacion: ['resina', 'obtura', 'amalgama', 'incrustac', 'ionomero', 'restaura'],
    corona: ['corona'],
    endodoncia: ['endodon', 'conducto', 'pulpot', 'pulpect', 'apicec'],
    implante: ['implante'],
    extraccion: ['extrac', 'exodon', 'cordal', 'tercer molar'],
    ausente: ['protesis', 'puente', 'implante']
  };
  var TIPOS_PRECIO = [['directo', 'Cliente directo'], ['institucional', 'Institucional'], ['vip', 'VIP'], ['referido', 'Referido'], ['paquete', 'Paquete'], ['especial', 'Especial']];
  var catalogo = [], tipoPrecio = 'directo';
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function relacionados(h) {
    var cl = CLAVES[h] || [];
    return catalogo.filter(function (c) { var n = norm(c.nombre); return cl.some(function (k) { return n.indexOf(k) >= 0; }); });
  }
  function buscarEnCatalogo(proc) {
    if (!proc) return null;
    return catalogo.filter(function (c) { return proc.id ? c.id === proc.id : norm(c.nombre) === norm(proc.n); })[0] || null;
  }
  function precioDe(item) {
    if (!item) return null;
    var v = item.precios[tipoPrecio];
    if (v == null && tipoPrecio === 'directo' && item.base > 0) v = item.base;
    return v == null ? null : Number(v);
  }
  function q(n) { return 'Q' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function procN(p, clave) { return p && p.proc && p.proc[clave] ? p.proc[clave].n : ''; }

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
      '.odg{font-family:Manrope,system-ui,sans-serif;color:#0B2B40;display:flex;flex-direction:column;gap:16px}',
      '.odg-barra{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between}',
      '.odg-seg{display:inline-flex;border:1px solid #C4D4DF;border-radius:999px;padding:3px;background:#F5F9FC;flex-wrap:wrap}',
      '.odg-seg button{font:inherit;font-size:14px;font-weight:600;border:0;background:transparent;color:#475B68;padding:8px 14px;border-radius:999px;cursor:pointer;min-height:38px}',
      '.odg-seg button[aria-pressed="true"]{background:#0B2B40;color:#FFFFFF}',
      '.odg-seg .r[aria-pressed="true"]{background:' + ROJO + '}.odg-seg .a[aria-pressed="true"]{background:' + AZUL + '}',
      '.odg-herr{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.odg-herr .grupo{font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#5A6D7A;margin-right:2px}',
      '.odg-herr button{font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:7px;padding:7px 12px;min-height:36px;border-radius:10px;border:1px solid #C4D4DF;background:#FFFFFF;color:#0B2B40;cursor:pointer}',
      '.odg-herr button:hover{border-color:#0B2B40}',
      '.odg-herr button[aria-pressed="true"]{border-color:#0B2B40;box-shadow:inset 0 0 0 1.5px #0B2B40;background:#EEF5FA}',
      '.odg-herr svg{flex:0 0 auto}',
      '.odg-lienzo{overflow-x:auto;background:#FFFFFF;border:1px solid #D9E4EC;border-radius:18px;padding:18px 16px 10px}',
      '.odg-mapa{min-width:680px;display:flex;flex-direction:column;gap:6px}',
      '.odg-fila{display:grid;gap:4px;justify-content:center}',
      '.odg-sep{height:1px;background:#D9E4EC;margin:8px 0}',
      '.odg-etq{font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#5A6D7A;text-align:center;margin:6px 0 2px}',
      '.odg-pz{display:flex;flex-direction:column;align-items:center;gap:2px;border-radius:10px;padding:3px 1px;outline:none}',
      '.odg-pz:focus-visible{box-shadow:0 0 0 2px #005A87}',
      '.odg-pz .num{font-size:12px;font-weight:700;color:#475B68;font-variant-numeric:tabular-nums}',
      '.odg-pz svg{width:100%;max-width:52px;height:auto;display:block;overflow:visible}',
      '.odg-pz path,.odg-pz .cen{stroke:#8A9DA9;stroke-width:1.2;fill:#FFFFFF;cursor:pointer;transition:fill .12s}',
      '.odg-pz path:hover,.odg-pz .cen:hover{fill:#E6F1F8}',
      '.odg-pz .tira{min-height:16px;display:flex;gap:2px;justify-content:center;flex-wrap:wrap}',
      '.odg-pz .tira span{font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 3px;border-radius:3px;color:#FFFFFF;line-height:1.3}',
      '.odg-pz.ausente svg .cuerpo{opacity:.35}',
      '.odg-ley{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:#475B68}',
      '.odg-ley i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}',
      '.odg-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}',
      '.odg-res div{background:#F5F9FC;border:1px solid #D9E4EC;border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.55}',
      '.odg-res h4{margin:0 0 6px;font-size:13px;letter-spacing:.5px;text-transform:uppercase}',
      '.odg-res ul{margin:0;padding-left:18px}',
      '.odg-res{grid-template-columns:minmax(0,1fr)}',
      '.odg-res .odg-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;background:none;border:0;padding:0;border-radius:0}',
      '.odg-res .odg-cab h4{margin:0}',
      '.odg-res label.odg-tp{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}',
      '.odg-res select{font:inherit;font-size:13.5px;border:1px solid #C4D4DF;border-radius:10px;padding:7px 10px;background:#FFFFFF;color:#0B2B40;max-width:100%;min-height:36px}',
      '.odg-res select.falta{border-color:' + ROJO + ';color:#9A3B2E;background:#FFF5F5}',
      '.odg-det{width:100%;border-collapse:collapse;font-size:14px;background:#FFFFFF;border-radius:10px;overflow:hidden}',
      '.odg-det th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5A6D7A;padding:8px 10px;border-bottom:1px solid #D9E4EC}',
      '.odg-det td{padding:7px 10px;border-bottom:1px solid #EEF3F7;vertical-align:middle}',
      '.odg-det .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.odg-det td.proc{min-width:220px}.odg-det td.proc select{width:100%}',
      '.odg-det tfoot td{font-weight:800;background:#EEF5FA;border-top:2px solid #0B2B40;border-bottom:0}',
      '.odg-det .sinp{color:#9A3B2E;font-size:12.5px;font-weight:700}',
      'dialog.odg-dlg{border:0;border-radius:18px;padding:0;width:min(480px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 40px));box-shadow:0 20px 50px rgba(0,0,0,.25);color:#0B2B40;font-family:Manrope,system-ui,sans-serif}',
      'dialog.odg-dlg::backdrop{background:rgba(11,43,64,.4)}',
      '.odg-dlg form{display:flex;flex-direction:column;gap:10px;padding:20px;max-height:inherit;box-sizing:border-box}',
      '.odg-dlg h4{margin:0;font-size:18px}.odg-dlg p{margin:0;color:#5A6D7A;font-size:13.5px}',
      '.odg-dlg input{font:inherit;font-size:14px;border:1px solid #C4D4DF;border-radius:10px;padding:9px 12px}',
      '.odg-dlg .lista{overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:60px;padding:2px}',
      '.odg-dlg .op{display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;font:inherit;font-size:14.5px;font-weight:600;color:#0B2B40;background:#FFFFFF;border:1px solid #D9E4EC;border-radius:12px;padding:10px 14px;cursor:pointer}',
      '.odg-dlg .op:hover,.odg-dlg .op:focus-visible{border-color:#005A87;background:#EEF5FA;outline:none}',
      '.odg-dlg .op small{display:block;font-size:12px;color:#5A6D7A;font-weight:500}',
      '.odg-dlg .pr{font-weight:800;white-space:nowrap}.odg-dlg .sinp{color:#9A3B2E;font-size:12.5px;font-weight:700;white-space:nowrap}',
      '.odg-dlg .pie{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}',
      '.odg-dlg .pie button{font:inherit;font-weight:700;font-size:14px;border:1px solid #C4D4DF;border-radius:999px;padding:9px 16px;background:#FFFFFF;color:#0B2B40;cursor:pointer}',
      '.odg-dlg .pie a{font-size:13px;font-weight:700;color:#005A87;cursor:pointer}',
      '@media (prefers-reduced-motion:reduce){.odg-pz path,.odg-pz .cen{transition:none}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'odg-estilos';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function icono(h, modo) {
    var c = h.fijo ? (h.fijo === 'r' ? ROJO : AZUL) : (modo === 'r' ? ROJO : AZUL);
    var base = '<svg width="18" height="18" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="26" fill="#FFFFFF" stroke="#8A9DA9" stroke-width="3"/>';
    var marca = {
      caries: '<circle cx="30" cy="30" r="12" fill="' + c + '"/>',
      obturacion: '<path d="' + SEG.arriba + '" fill="' + c + '"/><circle cx="30" cy="30" r="11" fill="' + c + '"/>',
      corona: '<circle cx="30" cy="30" r="27" fill="none" stroke="' + c + '" stroke-width="7"/>',
      endodoncia: '<line x1="30" y1="2" x2="30" y2="58" stroke="' + c + '" stroke-width="8"/>',
      implante: '<text x="30" y="40" text-anchor="middle" font-size="28" font-weight="800" fill="' + c + '">IM</text>',
      extraccion: '<path d="M10 10L50 50M50 10L10 50" stroke="' + c + '" stroke-width="8"/>',
      ausente: '<path d="M8 52L52 8" stroke="' + c + '" stroke-width="8"/>',
      borrar: '<path d="M18 18L42 42M42 18L18 42" stroke="#5A6D7A" stroke-width="7"/>'
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

    // Detalle: cada hallazgo con su procedimiento del catálogo y su precio
    function opcionesProc(h, actual) {
      var rel = relacionados(h), resto = catalogo.filter(function (c) { return rel.indexOf(c) < 0; });
      var sel = buscarEnCatalogo(actual);
      function op(c) { return '<option value="' + c.k + '"' + (sel === c ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }
      var html = !actual ? '<option value="" selected>Elegir procedimiento…</option>'
        : !sel ? '<option value="" selected>' + esc(actual.n) + '</option>' : '';
      if (rel.length) html += '<optgroup label="Relacionados">' + rel.map(op).join('') + '</optgroup>';
      if (resto.length) html += '<optgroup label="Todo el catálogo">' + resto.map(op).join('') + '</optgroup>';
      if (actual) html += '<option value="-">— Quitar procedimiento —</option>';
      return html;
    }
    function filasDetalle() {
      var req = [], hecho = [];
      ORDEN.forEach(function (n) {
        var p = datos.piezas[n];
        if (!p) return;
        Object.keys(p.caras).forEach(function (cara) {
          var m = p.caras[cara];
          (m.h === 'caries' || m.c === 'r' ? req : hecho).push({ n: n, clave: cara, h: m.h, texto: POR_ID[m.h].nombre + ' ' + nombreCara(cara, n), proc: p.proc && p.proc[cara] });
        });
        Object.keys(p.estados).forEach(function (k) {
          (p.estados[k] === 'r' ? req : hecho).push({ n: n, clave: k, h: k, texto: POR_ID[k].nombre, proc: p.proc && p.proc[k] });
        });
      });
      return { req: req, hecho: hecho };
    }
    function tablaDetalle(filas, conTotal) {
      var total = 0, sinProc = 0, sinPrecio = 0;
      var cuerpo = filas.map(function (f) {
        var item = buscarEnCatalogo(f.proc), precio = f.proc ? precioDe(item) : null;
        if (f.h !== 'ausente') { if (!f.proc) sinProc++; else if (precio == null) sinPrecio++; else total += precio; }
        var celda = f.h === 'ausente' ? '—' : catalogo.length
          ? '<select data-proc-pieza="' + f.n + '" data-proc-clave="' + f.clave + '" class="' + (f.proc ? '' : 'falta') + '" aria-label="Procedimiento de la pieza ' + f.n + ' · ' + esc(f.texto) + '">' + opcionesProc(f.h, f.proc) + '</select>'
          : esc(f.proc ? f.proc.n : '—');
        return '<tr><td><strong>' + f.n + '</strong></td><td>' + esc(f.texto) + '</td><td class="proc">' + celda + '</td>' +
          '<td class="num">' + (precio != null ? q(precio) : f.proc ? '<span class="sinp">Sin precio</span>' : '—') + '</td></tr>';
      }).join('');
      var pie = conTotal && filas.length ? '<tfoot><tr><td></td><td>TOTAL ESTIMADO</td><td>' +
        [sinProc ? sinProc + ' sin procedimiento' : '', sinPrecio ? sinPrecio + ' sin precio' : ''].filter(Boolean).join(' · ') +
        '</td><td class="num">' + q(total) + '</td></tr></tfoot>' : '';
      return '<table class="odg-det"><thead><tr><th>Pieza</th><th>Hallazgo</th><th>Procedimiento</th><th class="num">Precio</th></tr></thead><tbody>' + cuerpo + '</tbody>' + pie + '</table>';
    }
    function resumen() {
      var f = filasDetalle();
      var selTipo = '<label class="odg-tp">Tipo de precio <select data-tipo-precio>' + TIPOS_PRECIO.map(function (t) {
        return '<option value="' + t[0] + '"' + (t[0] === tipoPrecio ? ' selected' : '') + '>' + t[1] + '</option>';
      }).join('') + '</select></label>';
      return '<div><div class="odg-cab"><h4 style="color:' + ROJO + '">Requerido (' + f.req.length + ')</h4>' + (f.req.length && catalogo.length ? selTipo : '') + '</div>' +
        (f.req.length ? tablaDetalle(f.req, true) : 'Sin tratamientos pendientes.') + '</div>' +
        '<div><div class="odg-cab"><h4 style="color:' + AZUL + '">Realizado / existente (' + f.hecho.length + ')</h4></div>' +
        (f.hecho.length ? tablaDetalle(f.hecho, false) : 'Sin registros.') + '</div>';
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

    var agregado = null; // última marca «Requerido» agregada: se pregunta su procedimiento
    function quitarProc(p, clave) { if (p.proc) { delete p.proc[clave]; if (!Object.keys(p.proc).length) delete p.proc; } }
    function aplicar(n, cara) {
      var h = POR_ID[herramienta], c = h.fijo || modo;
      agregado = null;
      if (h.tipo === 'borrar') { delete datos.piezas[n]; return true; }
      var p = pieza(n);
      if (h.tipo === 'cara') {
        if (!cara) return false;
        var m = p.caras[cara];
        if (m && m.h === h.id && m.c === c) { delete p.caras[cara]; quitarProc(p, cara); }
        else {
          if (m && m.h !== h.id) quitarProc(p, cara);
          p.caras[cara] = { h: h.id, c: c }; delete p.estados.ausente; quitarProc(p, 'ausente');
          if (c === 'r') agregado = { n: n, clave: cara, h: h.id, texto: h.nombre + ' ' + nombreCara(cara, n) };
        }
      } else {
        if (p.estados[h.id] === c) { delete p.estados[h.id]; quitarProc(p, h.id); }
        else {
          p.estados[h.id] = c;
          if (h.id === 'ausente') { p.caras = {}; p.estados = { ausente: 'a' }; delete p.proc; }
          else { delete p.estados.ausente; quitarProc(p, 'ausente'); }
          if (c === 'r') agregado = { n: n, clave: h.id, h: h.id, texto: h.nombre };
        }
      }
      limpiarVacias(n);
      return true;
    }
    function ponerProc(n, clave, item) {
      var p = datos.piezas[n];
      if (!p) return;
      if (item) { p.proc = p.proc || {}; p.proc[clave] = { id: item.id || null, n: item.nombre }; }
      else quitarProc(p, clave);
      avisar();
      pintar();
    }

    // Ventana para elegir el procedimiento de una marca «Requerido»
    var dlg = null;
    function llenarVentana() {
      var inf = dlg._info, bus = norm(dlg.querySelector('input').value.trim());
      var rel = relacionados(inf.h);
      var lista = bus ? catalogo.filter(function (c) { return norm(c.nombre + ' ' + c.tipo).indexOf(bus) >= 0; })
        : dlg._todos || !rel.length ? catalogo : rel;
      dlg.querySelector('[data-todos]').hidden = !!(bus || lista === catalogo);
      dlg.querySelector('.lista').innerHTML = lista.length ? lista.map(function (c) {
        var pr = precioDe(c);
        return '<button type="button" class="op" data-k="' + c.k + '"><span>' + esc(c.nombre) + (c.tipo ? '<small>' + esc(c.tipo) + '</small>' : '') + '</span>' +
          (pr != null ? '<span class="pr">' + q(pr) + '</span>' : '<span class="sinp">Sin precio definido</span>') + '</button>';
      }).join('') : '<p>No hay procedimientos con ese nombre.</p>';
    }
    function abrirVentana(info) {
      if (!catalogo.length || typeof HTMLDialogElement === 'undefined') return;
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'odg-dlg';
        dlg.innerHTML = '<form method="dialog"><h4></h4><p></p><input type="search" placeholder="Buscar procedimiento" aria-label="Buscar procedimiento"><div class="lista"></div>' +
          '<div class="pie"><a data-todos tabindex="0">Ver todo el catálogo</a><button value="despues">Decidir después</button></div></form>';
        document.body.appendChild(dlg);
        dlg.addEventListener('click', function (e) {
          if (e.target === dlg) { dlg.close(); return; }
          var o = e.target.closest('[data-k]');
          if (o) {
            e.preventDefault();
            var item = catalogo.filter(function (c) { return c.k === o.dataset.k; })[0];
            var inf = dlg._info;
            dlg.close();
            if (item && inf) inf.elegir(inf.n, inf.clave, item);
            return;
          }
          if (e.target.closest('[data-todos]')) { dlg._todos = true; llenarVentana(); dlg.querySelector('input').focus(); }
        });
        dlg.querySelector('input').addEventListener('input', llenarVentana);
      }
      info.elegir = ponerProc;
      dlg._info = info; dlg._todos = false;
      dlg.querySelector('h4').textContent = 'Pieza ' + info.n + ' · ' + info.texto;
      var tp = TIPOS_PRECIO.filter(function (t) { return t[0] === tipoPrecio; })[0];
      dlg.querySelector('p').innerHTML = '¿Qué procedimiento se hará? Precios de <b>' + (tp ? tp[1] : '') + '</b>.';
      dlg.querySelector('input').value = '';
      llenarVentana();
      dlg.showModal();
      var primero = dlg.querySelector('.op');
      if (primero) primero.focus();
    }

    raiz.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-tipo-precio]')) { tipoPrecio = t.value; pintar(); return; }
      if (t.matches('[data-proc-pieza]')) {
        if (t.value === '-') { ponerProc(+t.dataset.procPieza, t.dataset.procClave, null); return; }
        var item = catalogo.filter(function (c) { return c.k === t.value; })[0];
        if (item) ponerProc(+t.dataset.procPieza, t.dataset.procClave, item);
      }
    });
    raiz.addEventListener('click', function (e) {
      if (e.target.closest('select')) return;
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
        if (agregado) abrirVentana(agregado);
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
        if (agregado) abrirVentana(agregado);
      }
    });

    pintar();
    return {
      cargar: function (valor, edad) { datos = normalizar(valor, edad); pintar(); },
      valor: function () { return JSON.parse(JSON.stringify(datos)); },
      hallazgos: function () { return Object.keys(datos.piezas).length; },
      // lista: [{ id, nombre, tipo, base, precios: { directo: 350, vip: 300 } }] (id null = sugerido sin catálogo)
      catalogo: function (lista) {
        catalogo = (lista || []).map(function (c, i) { return Object.assign({ k: c.id ? 'id' + c.id : 'n' + i }, c); });
        pintar();
      }
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
      var procs = [];
      function conProc(texto, p, clave) { var x = procN(p, clave); return x ? texto + ' → ' + x : texto; }
      function revisarProc(texto, clave) {
        var xa = procN(pa, clave), xb = procN(pb, clave);
        if (xa !== xb) procs.push(texto + ': ' + (xa || 'sin procedimiento') + ' → ' + (xb || 'sin procedimiento'));
      }
      Object.keys(pa.caras).concat(Object.keys(pb.caras)).filter(function (c, i, arr) { return arr.indexOf(c) === i; }).forEach(function (cara) {
        var ma = pa.caras[cara], mb = pb.caras[cara];
        if (ma && mb && ma.h === mb.h && ma.c === mb.c) { revisarProc(POR_ID[mb.h].nombre + ' ' + nombreCara(cara, +n), cara); return; }
        if (ma) quitado.push(etiquetaCara(ma, cara, +n));
        if (mb) agregado.push(conProc(etiquetaCara(mb, cara, +n), pb, cara));
      });
      Object.keys(pa.estados).concat(Object.keys(pb.estados)).filter(function (k, i, arr) { return arr.indexOf(k) === i; }).forEach(function (k) {
        if (pa.estados[k] === pb.estados[k]) { if (pb.estados[k]) revisarProc(POR_ID[k].nombre, k); return; }
        if (pa.estados[k]) quitado.push(etiquetaEstado(k, pa.estados[k]));
        if (pb.estados[k]) agregado.push(conProc(etiquetaEstado(k, pb.estados[k]), pb, k));
      });
      if (agregado.length || quitado.length || procs.length) {
        out.push({
          clave: String(n), pieza: +n,
          descripcion: [agregado.length ? 'Agregado: ' + agregado.join(', ') : '', quitado.length ? 'Quitado: ' + quitado.join(', ') : '',
            procs.length ? 'Procedimiento: ' + procs.join(', ') : ''].filter(Boolean).join(' · ')
        });
      }
    });
    return out;
  }

  window.Odontograma = { crear: crear, diferencias: diferencias };
})();
