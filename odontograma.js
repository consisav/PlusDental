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
    return disponibles().filter(function (c) { var n = norm(c.nombre); return cl.some(function (k) { return n.indexOf(k) >= 0; }); });
  }
  // Solo se ofrecen los procedimientos que tienen precio (en el tipo de precio elegido)
  function conPrecio(c) { return precioDe(c) != null; }
  function disponibles() { return catalogo.filter(conPrecio);
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
  function procN(p, clave) {
    var x = p && p.proc && p.proc[clave];
    if (!x) return '';
    return x.n + (x.cant > 1 ? ' × ' + x.cant : '') + (x.precio != null ? ' · ' + q(x.precio) : '') +
      (x.pieza ? ' · pieza ' + x.pieza : '') + (x.hallazgo ? ' · ' + x.hallazgo : '');
  }

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
      '.odg-res button.odg-ver-sin{font:inherit;font-size:13px;font-weight:700;color:#005A87;background:none;border:0;padding:10px 2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}',
      '.odg-res .odg-vacio{margin:4px 0 0;color:#5A6D7A}',
      '.odg-fila-acc{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
      '.odg-res .odg-det-wrap{overflow-x:auto;background:none;border:0;padding:0;border-radius:10px}',
      '.odg-det-c{table-layout:fixed;width:100%}',
      '.odg-det-c th,.odg-det-c td{overflow-wrap:anywhere;word-break:normal}',
      '.odg-det-c .odg-c-pz{width:18%}.odg-det-c .odg-c-val{width:14%}.odg-det-c .odg-c-est{width:19%}.odg-det-c .odg-c-acc{width:108px;text-align:right}',
      '.odg-det-c td small{display:block;font-size:12px;color:#5A6D7A;font-weight:500;margin-top:2px}',
      '.odg-det-c td.odg-c-pz strong{font-size:15px}',
      '.odg-det-c tfoot td small{font-weight:600}',
      '.odg-det-c select.odg-ie{width:100%;max-width:150px}',
      '.odg-det .odg-mod{font:inherit;font-size:12.5px;font-weight:700;border:1px solid #C4D4DF;border-radius:999px;padding:5px 10px;min-height:32px;background:#FFFFFF;color:#0B2B40;cursor:pointer;white-space:nowrap}',
      '.odg-det .odg-mod:hover{border-color:#0B2B40}',
      '.odg-res .odg-edit-g{display:grid;grid-template-columns:90px minmax(0,1.2fr) minmax(0,2fr) 90px 120px;gap:10px;align-items:end;background:none;border:0;padding:4px 0;border-radius:0}',
      '.odg-edit-g label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#5A6D7A;min-width:0}',
      '.odg-det tr.odg-edit .odg-edit-g input,.odg-det tr.odg-edit .odg-edit-g select{width:100%}',
      '.odg-res .odg-edit-g .odg-edit-acc{grid-column:1/-1;justify-content:flex-end;background:none;border:0;padding:0}',
      '@media (max-width:900px){.odg-res .odg-edit-g{grid-template-columns:repeat(2,minmax(0,1fr))}.odg-edit-g .odg-edit-proc{grid-column:1/-1}.odg-det-c .odg-c-acc{width:96px}}',
      '.odg-res .odg-pre .odg-fila-acc{display:flex}',
      '.odg-det .odg-mod{padding:5px 12px;min-height:32px;font-size:12.5px}',
      '.odg-det tr.odg-edit td{background:#FFF8E6}',
      '.odg-det tr.odg-edit input,.odg-det tr.odg-edit select{font:inherit;font-size:13.5px;border:1px solid #C4D4DF;border-radius:8px;padding:6px 8px;min-height:34px;box-sizing:border-box;max-width:100%;background:#FFFFFF}',

      '.odg-man{color:#B45309;font-size:12px}',
      '.odg-res .odg-pre-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}',
      '.odg-res .odg-pre .odg-pre-pie{display:flex;justify-content:space-between;align-items:center;gap:10px 14px;flex-wrap:wrap;border-top:1px solid #D9E4EC;padding-top:12px}',
      '.odg-pre-pie>span{font-size:12.5px;color:#5A6D7A}',
      '.odg-res .odg-pre .odg-fijo{border:1px solid #D9E4EC;border-radius:10px;padding:8px 10px;min-height:38px;box-sizing:border-box;background:#F1F5F9;font-size:14px;font-weight:500;display:flex;align-items:center}',
      '.odg-res .odg-pre .odg-fijo.odg-auto{background:#EEF5FA;border-style:dashed;color:#00476B;font-weight:700}',
      '.odg-pre-msg{margin:0;font-size:13px;color:#08504C;font-weight:600}.odg-pre-msg.error{color:#9F1239}',
      '.odg-ie{display:inline-block;font:inherit;font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 10px;border:1px solid transparent;white-space:nowrap}',
      'select.odg-ie{padding:5px 8px;cursor:pointer;min-height:32px}',
      '.odg-ie-pendiente{background:#EBF0F4;color:#475B68}.odg-ie-proceso{background:#FEF3C7;color:#92400E}.odg-ie-finalizado{background:#DCF2EC;color:#08504C}.odg-ie-eliminado{background:#FDE2E4;color:#9F1239}',
      '.odg-det tr.odg-elim td:not(:nth-last-child(-n+3)){text-decoration:line-through;color:#8A9DA9}',
      '.odg-por{font-size:11.5px;color:#5A6D7A}',
      '.odg-imagen{gap:8px}.odg-imagen .odg-lienzo{overflow:visible;padding:10px 6px 4px;border-radius:12px}.odg-imagen .odg-mapa{min-width:0}.odg-imagen .odg-pz path,.odg-imagen .odg-pz .cen{cursor:default}',
      '.odg-res .odg-aviso-est{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:#FFF8E6;border:1px solid #F3D9A4;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:13px;color:#7A4B00}',
      '.odg-res .odg-pre .odg-pre-cab .odg-est{cursor:default}',
      '.odg-dlg .op[aria-pressed="true"]{border-color:#005A87;box-shadow:inset 0 0 0 1.5px #005A87;background:#EEF5FA}',
      '.odg-res .odg-pre .cuo-res>div{background:#0B2B40;color:#FFFFFF;border-radius:12px;padding:8px 14px}',
      '.odg-res .odg-pre .cuo-res>div.cuo-cero{background:#DCF2EC;color:#08504C}',
      '.odg-res .odg-pre .cuo-modo{display:inline-flex;border:1px solid #C4D4DF;border-radius:999px;padding:3px;background:#FFFFFF;align-self:flex-start}',
      '.odg-res .odg-pre-ed{background:#FFFBF0;border-radius:12px;padding:14px;margin-top:14px;border-top:0}',
      '.odg-res .odg-pre select:disabled,.odg-res .odg-pre input:disabled,.odg-res select[data-tipo-precio]:disabled{background:#F1F5F9;color:#0B2B40;-webkit-text-fill-color:#0B2B40;opacity:1;cursor:not-allowed}',
      '.odg-est:disabled[aria-pressed="true"]{opacity:1}',
      '.odg-res .odg-pre{background:none;border:0;border-top:1px solid #D9E4EC;border-radius:0;padding:14px 0 0;margin-top:14px;display:flex;flex-direction:column;gap:12px}',
      '.odg-res .odg-pre div{background:none;border:0;padding:0;border-radius:0}',
      '.odg-pre-tit{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#005A87;font-weight:800}',
      '.odg-pre-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}',
      '.odg-pre-campo{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600}',
      '.odg-res .odg-pre-campo input{font:inherit;font-size:14px;border:1px solid #C4D4DF;border-radius:10px;padding:8px 10px;min-height:38px;box-sizing:border-box;background:#FFFFFF}',
      '.odg-res .odg-pre-campo select{min-height:38px}',
      '.odg-res .odg-pre .odg-cod{background:#0B2B40;color:#FFFFFF;border-radius:10px;padding:6px 12px;font-weight:800;font-size:15px;letter-spacing:.03em;min-height:38px;box-sizing:border-box}',
      '.odg-cod small{display:block;font-size:9.5px;letter-spacing:.12em;color:#9CC3DA;font-weight:700}',
      '.odg-pre-est{display:flex;gap:6px;flex-wrap:wrap}',
      '.odg-est{font:inherit;font-size:12.5px;font-weight:700;border-radius:999px;padding:6px 12px;border:2px solid transparent;cursor:pointer}',
      '.odg-est[aria-pressed="true"]{border-color:#0B2B40}.odg-est:disabled{cursor:not-allowed;opacity:.55}',
      '.odg-est-activo{background:#DBEAFE;color:#1E40AF}.odg-est-aprobado{background:#DCF2EC;color:#08504C}.odg-est-proceso{background:#FEF3C7;color:#92400E}',
      '.odg-est-finalizado{background:#E5E7EB;color:#374151}.odg-est-no_aprobado{background:#FDE2E4;color:#9F1239}',
      'dialog.odg-dlg{border:0;border-radius:18px;padding:0;width:min(480px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 40px));box-shadow:0 20px 50px rgba(0,0,0,.25);color:#0B2B40;font-family:Manrope,system-ui,sans-serif}',
      'dialog.odg-dlg::backdrop{background:rgba(11,43,64,.4)}',
      '.odg-dlg form{display:flex;flex-direction:column;gap:10px;padding:20px;max-height:inherit;box-sizing:border-box}',
      '.odg-dlg h4{margin:0;font-size:18px}.odg-dlg p{margin:0;color:#5A6D7A;font-size:13.5px}',
      '.odg-dlg input{font:inherit;font-size:14px;border:1px solid #C4D4DF;border-radius:10px;padding:9px 12px}',
      '.odg-dlg .lista{overflow:auto;display:flex;flex-direction:column;gap:8px;min-height:60px;padding:2px}',
      '.odg-dlg .op{display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;font:inherit;font-size:14.5px;font-weight:600;color:#0B2B40;background:#FFFFFF;border:1px solid #D9E4EC;border-radius:12px;padding:10px 14px;cursor:pointer}',
      '.odg-dlg .op:hover,.odg-dlg .op:focus-visible{border-color:#005A87;background:#EEF5FA;outline:none}',
      '.odg-dlg .op small{display:block;font-size:12px;color:#5A6D7A;font-weight:500}',
      '.odg-dlg .pr-ed{display:flex;align-items:center;gap:4px;flex:none;font-weight:700;color:#0B2B40;cursor:text}',
      '.odg-dlg .pr-ed input{width:104px;text-align:right;font-weight:700;padding:7px 9px;border-color:#C4D4DF;background:#FFFFFF}',
      '.odg-dlg .pr-ed input:focus{outline:2px solid #188EC0;outline-offset:1px;border-color:#188EC0}',
      '.odg-dlg .pr{font-weight:800;white-space:nowrap}.odg-dlg .sinp{color:#9A3B2E;font-size:12.5px;font-weight:700;white-space:nowrap}',
      '.odg-dlg .pie{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}',
      '.odg-dlg .pie button{font:inherit;font-weight:700;font-size:14px;border:1px solid #C4D4DF;border-radius:999px;padding:9px 16px;background:#FFFFFF;color:#0B2B40;cursor:pointer}',
      '.odg-dlg .pie a{font-size:13px;font-weight:700;color:#005A87;cursor:pointer}',
      '.odg-res .odg-acc{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;background:none;border:0;padding:0;border-radius:0}',
      '.odg-crear{font:inherit;font-size:13.5px;font-weight:700;border:0;border-radius:999px;padding:8px 16px;min-height:36px;background:#0B2B40;color:#FFFFFF;cursor:pointer}',
      '.odg-crear:hover{background:#005A87}.odg-crear:focus-visible{outline:2px solid #005A87;outline-offset:2px}',
      '.odg-imp{font:inherit;font-size:13.5px;font-weight:700;border:1px solid #0B2B40;border-radius:999px;padding:7px 16px;min-height:36px;background:#FFFFFF;color:#0B2B40;cursor:pointer}',
      '.odg-imp:hover{background:#EEF5FA}.odg-imp:focus-visible{outline:2px solid #005A87;outline-offset:2px}',
      '.odg-dlg .odg-det{font-size:13.5px}.odg-dlg .odg-det td{padding:6px 8px}.odg-dlg .tabla{overflow:auto;min-height:0}',
      '.odg-dlg .alerta{background:#FFF7E6;border:1px solid #F2D29B;color:#7A4B00;border-radius:10px;padding:8px 12px;font-size:13px;line-height:1.5}',
      '.odg-dlg .alerta ul{margin:4px 0 0;padding-left:18px}',
      '.odg-dlg .error{color:#9A3B2E;font-size:13.5px;font-weight:600}',
      '.odg-dlg .ok{display:flex;align-items:center;gap:10px}.odg-dlg .ok svg{flex:0 0 auto}',
      '.odg-dlg .pie.der{justify-content:flex-end}',
      '.odg-dlg .pie-acc{display:flex;gap:8px;margin-left:auto}',
      '.odg-dlg .pie .pri{background:#0B2B40;border-color:#0B2B40;color:#FFFFFF}.odg-dlg .pie .pri:disabled{opacity:.6;cursor:default}',
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
      var rel = relacionados(h), resto = disponibles().filter(function (c) { return rel.indexOf(c) < 0; });
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
    // Solo el Super Administrador modifica el detalle y los datos del presupuesto; el resto del personal solo ve e imprime
    function esSuper() { return opciones.esSuper ? !!opciones.esSuper() : true; }
    var editandoFila = null;            // 'pieza|clave' de la fila en modificación
    var editandoDatos = false, copiaDatos = null;
    // Valor de una fila: precio unitario (el escrito a mano o el del catálogo), cantidad y total
    function valorFila(f) {
      if (!f.proc) return { unit: null, cant: 1, total: null };
      var unit = f.proc.precio != null ? Number(f.proc.precio) : precioDe(buscarEnCatalogo(f.proc));
      var cant = Math.max(parseInt(f.proc.cant, 10) || 1, 1);
      return { unit: unit, cant: cant, total: unit == null ? null : Math.round(unit * cant * 100) / 100, manual: f.proc.precio != null };
    }
    function piezaDe(f) { return f.proc && f.proc.pieza ? f.proc.pieza : String(f.n); }
    function textoDe(f) { return f.proc && f.proc.hallazgo ? f.proc.hallazgo : f.texto; }
    // Estado de cada procedimiento: el de su línea en el presupuesto confirmado (Pendiente si aún no hay)
    var ESTADOS_ITEM = [['pendiente', 'Pendiente'], ['proceso', 'Proceso'], ['finalizado', 'Finalizado'], ['eliminado', 'Eliminado']];
    function itemDe(f) {
      if (!preActual || modoNuevo || !f.proc) return null;
      var pz = piezaDe(f), nom = String(f.proc.n).toLowerCase();
      return (preActual.presupuesto_items || []).filter(function (i) { return String(i.pieza || '') === pz && String(i.tratamiento).toLowerCase() === nom; })[0] || null;
    }
    function celdaEstado(f, it) {
      var est = it ? it.estado || (it.realizado ? 'finalizado' : 'pendiente') : 'pendiente';
      var nom = ESTADOS_ITEM.filter(function (x) { return x[0] === est; })[0][1];
      var aprobado = preActual && !modoNuevo && preActual.estado === 'aprobado';
      if (!it || !aprobado || !opciones.cambiarEstadoItem) {
        var motivo = !preActual || modoNuevo ? 'Se podrá cambiar cuando el presupuesto esté confirmado y aprobado' : !it ? 'Este procedimiento no está en el presupuesto confirmado' : 'Se podrá cambiar cuando el presupuesto esté aprobado';
        return '<span class="odg-ie odg-ie-' + est + '" title="' + motivo + '">' + nom + '</span>';
      }
      var sup = esSuper(), orden = ['pendiente', 'proceso', 'finalizado'];
      var permitidos = ESTADOS_ITEM.filter(function (x) {
        if (x[0] === est || sup) return true;
        return est !== 'eliminado' && x[0] !== 'eliminado' && orden.indexOf(x[0]) > orden.indexOf(est);
      });
      return '<select class="odg-ie odg-ie-' + est + '" data-item-estado="' + it.id + '" aria-label="Estado de ' + esc(f.proc.n) + ', pieza ' + esc(piezaDe(f)) + '">' +
        permitidos.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === est ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>';
    }
    // Qué falta para poder cambiar el estado de cada procedimiento
    function avisoEstado() {
      var texto = '', boton = '';
      if (!preActual || modoNuevo) texto = 'Para cambiar el estado de cada procedimiento, primero confirma el presupuesto y luego apruébalo.';
      else if ((preActual.presupuesto_items || []).length && !('estado' in preActual.presupuesto_items[0])) texto = 'Para cambiar el estado de cada procedimiento falta ejecutar en Supabase el script actualizado (supabase.sql).';
      else if (preActual.estado !== 'aprobado') {
        texto = 'El presupuesto ' + (preActual.codigo || 'N.º ' + preActual.id) + ' aún no está aprobado. Al aprobarlo podrás cambiar el estado de cada procedimiento (Pendiente, Proceso, Finalizado, Eliminado).';
        if (esSuper() && opciones.cambiarEstadoPresupuesto) boton = '<button type="button" class="odg-crear" data-ex-estado>Aprobar presupuesto</button>';
      }
      return texto ? '<div class="odg-aviso-est"><span>' + esc(texto) + '</span>' + boton + '</div>' : '';
    }
    function tablaDetalle(filas, conTotal) {
      var total = 0, sinProc = 0, sinPrecio = 0, sup = esSuper(), conEstado = conTotal, columnas = conEstado ? 5 : 4;
      var cuerpo = filas.map(function (f) {
        var v = valorFila(f), clave = f.n + '|' + f.clave, it = conEstado ? itemDe(f) : null;
        var eliminado = it && it.estado === 'eliminado';
        if (f.h !== 'ausente' && !eliminado) { if (!f.proc) sinProc++; else if (v.total == null) sinPrecio++; else total += v.total; }
        // Modificar: formulario a lo ancho de la tabla
        if (sup && editandoFila === clave && f.h !== 'ausente') {
          var item = buscarEnCatalogo(f.proc), base = item ? precioDe(item) : null;
          return '<tr class="odg-edit" data-fila="' + clave + '"><td colspan="' + columnas + '"><div class="odg-edit-g">' +
            '<label><span>Pieza</span><input data-ed="pieza" value="' + esc(piezaDe(f)) + '" maxlength="20"></label>' +
            '<label><span>Hallazgo</span><input data-ed="hallazgo" value="' + esc(textoDe(f)) + '" maxlength="80"></label>' +
            '<label class="odg-edit-proc"><span>Procedimiento</span><select data-ed="proc">' + opcionesProc(f.h, f.proc) + '</select></label>' +
            '<label><span>Cantidad</span><input data-ed="cant" type="number" min="1" max="32" step="1" value="' + v.cant + '"></label>' +
            '<label><span>Precio (Q)</span><input data-ed="precio" type="number" min="0" step="0.01" value="' + (v.unit != null ? v.unit.toFixed(2) : '') + '" placeholder="' + (base != null ? base.toFixed(2) : '0.00') + '"></label>' +
            '<div class="odg-fila-acc odg-edit-acc"><button type="button" class="odg-imp" data-fila-cancelar>Cancelar</button><button type="button" class="odg-crear" data-fila-guardar>Guardar</button></div>' +
            '</div></td></tr>';
        }
        var proc = f.h === 'ausente' ? '—' : f.proc ? esc(f.proc.n) : '<span class="sinp">Sin procedimiento</span>';
        var valor = v.total != null ? '<strong>' + q(v.total) + '</strong><small>' + v.cant + ' × ' + q(v.unit) + (v.manual ? ' <span class="odg-man" title="Precio modificado a mano">✎</span>' : '') + '</small>'
          : f.proc ? '<span class="sinp">Sin precio</span>' : '—';
        var estado = conEstado ? '<td class="odg-c-est">' + (f.proc ? celdaEstado(f, it) : '—') +
          (it && it.estado_fecha ? '<small>' + fechaHora(it.estado_fecha) + (it.estado_por ? ' · ' + esc(it.estado_por) : '') + '</small>' : '') + '</td>' : '';
        var mod = sup && f.h !== 'ausente' && !editandoFila ? '<button type="button" class="odg-mod" data-fila-mod="' + clave + '" title="Modificar" aria-label="Modificar pieza ' + esc(piezaDe(f)) + '">✎ Modificar</button>' : '';
        return '<tr' + (eliminado ? ' class="odg-elim"' : '') + '><td class="odg-c-pz"><strong>' + esc(piezaDe(f)) + '</strong><small>' + esc(textoDe(f)) + '</small></td>' +
          '<td class="proc">' + proc + '</td><td class="num odg-c-val">' + valor + '</td>' + estado + '<td class="odg-c-acc">' + mod + '</td></tr>';
      }).join('');
      var pie = conTotal && filas.length ? '<tfoot><tr><td colspan="2">TOTAL ESTIMADO' +
        ([sinProc ? sinProc + ' sin procedimiento' : '', sinPrecio ? sinPrecio + ' sin precio' : ''].filter(Boolean).length ? '<small>' + [sinProc ? sinProc + ' sin procedimiento' : '', sinPrecio ? sinPrecio + ' sin precio' : ''].filter(Boolean).join(' · ') + '</small>' : '') +
        '</td><td class="num">' + q(total) + '</td>' + (conEstado ? '<td></td>' : '') + '<td></td></tr></tfoot>' : '';
      return (conEstado ? avisoEstado() : '') + '<div class="odg-det-wrap"><table class="odg-det odg-det-c"><thead><tr><th class="odg-c-pz">Pieza · hallazgo</th><th>Procedimiento</th><th class="num odg-c-val">Valor</th>' +
        (conEstado ? '<th class="odg-c-est">Estado · fecha</th>' : '') + '<th class="odg-c-acc"><span class="sr-only">Acciones</span></th></tr></thead><tbody>' + cuerpo + '</tbody>' + pie + '</table></div>';
    }
    function guardarFila(tr) {
      var partes = tr.dataset.fila.split('|'), n = +partes[0], clave = partes[1], p = datos.piezas[n];
      if (!p) return;
      var v = function (k) { return tr.querySelector('[data-ed="' + k + '"]').value.trim(); };
      var sel = v('proc');
      if (sel === '-') { quitarProc(p, clave); editandoFila = null; avisar(); pintar(); return; }
      var actualProc = p.proc && p.proc[clave];
      var item = sel ? catalogo.filter(function (c) { return c.k === sel; })[0] : buscarEnCatalogo(actualProc);
      if (!item && !actualProc) { tr.querySelector('[data-ed="proc"]').focus(); return; }
      var nuevo = { id: item ? item.id || null : actualProc.id, n: item ? item.nombre : actualProc.n };
      var cant = Math.min(Math.max(parseInt(v('cant'), 10) || 1, 1), 32);
      if (cant > 1) nuevo.cant = cant;
      var base = item ? precioDe(item) : null, precio = v('precio');
      if (precio !== '' && !isNaN(Number(precio)) && Number(precio) >= 0 && (base == null || Math.round(Number(precio) * 100) !== Math.round(base * 100))) nuevo.precio = Math.round(Number(precio) * 100) / 100;
      var fila = filasDetalle().req.concat(filasDetalle().hecho).filter(function (x) { return x.n === n && x.clave === clave; })[0];
      if (v('pieza') && v('pieza') !== String(n)) nuevo.pieza = v('pieza');
      if (v('hallazgo') && fila && v('hallazgo') !== fila.texto) nuevo.hallazgo = v('hallazgo');
      p.proc = p.proc || {};
      p.proc[clave] = nuevo;
      editandoFila = null;
      avisar();
      pintar();
    }
    // Reporte impreso: los procedimientos requeridos que tienen valor, con el tipo de precio elegido
    // Datos para el reporte: el presupuesto confirmado (si hay) o el borrador, tal como están en este momento
    function imprimirDetalle() {
      if (!opciones.imprimir) return;
      var nombreDe = function (lista, k) { var x = lista.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : ''; };
      var hallazgos = {};
      filasDetalle().req.forEach(function (f) { if (f.proc) hallazgos[piezaDe(f) + '|' + f.proc.n.toLowerCase()] = textoDe(f); });
      var info, lineas = [];
      if (preActual && !modoNuevo) {
        var p = preActual, ev = estadoVisible(p);
        (p.presupuesto_items || []).slice().sort(function (a, b) { return a.orden - b.orden || a.id - b.id; }).forEach(function (i) {
          if (i.estado === 'eliminado') return;
          lineas.push({ pieza: i.pieza || '—', hallazgo: hallazgos[(i.pieza || '') + '|' + String(i.tratamiento).toLowerCase()] || '—', procedimiento: i.tratamiento,
            cantidad: i.cantidad, precio: Number(i.precio), total: Math.round(i.cantidad * i.precio * 100) / 100 });
        });
        info = { existe: true, codigo: p.codigo || 'N.º ' + p.id, fecha: fechaHora(p.creado), usuario: p.creado_por || '—', estado: nombreDe(ESTADOS_PRE, ev), estadoClave: ev,
          cambio: fechaHora(p.estado_cambiado) + (p.estado_cambiado_por ? ' · ' + p.estado_cambiado_por : ''), aprobado: fechaHora(p.aprobado_en),
          tipo: nombreDe(TIPOS_PRECIO, p.tipo_precio || 'directo'), forma: p.forma_pago || 'efectivo', cuotas: p.cuotas || 1, sinRecargo: !!p.sin_recargo,
          recargoPct: Number(p.recargo_pct) || 0, citas: p.citas || '', descuento: Number(p.descuento_pct) || 0, notas: p.notas || '' };
      } else {
        filasDetalle().req.forEach(function (f) {
          if (!f.proc) return;
          var v = valorFila(f);
          if (v.total == null) return;
          lineas.push({ pieza: piezaDe(f), hallazgo: textoDe(f), procedimiento: f.proc.n, cantidad: v.cant, precio: v.unit, total: v.total });
        });
        info = { existe: false, codigo: codigoPre ? codigoPre + ' (se asigna al confirmar)' : 'Se asigna al confirmar', fecha: fechaHora(new Date().toISOString()), usuario: '',
          estado: nombreDe(ESTADOS_PRE, datosPre.estado), estadoClave: datosPre.estado, cambio: '—', aprobado: '—', tipo: nombreDe(TIPOS_PRECIO, tipoPrecio),
          forma: datosPre.forma, cuotas: datosPre.cuotas, sinRecargo: datosPre.sinRecargo, recargoPct: null, citas: datosPre.citas, descuento: 0, notas: '' };
      }
      info.formaTexto = nombreDe(FORMAS, info.forma);
      var sub = lineas.reduce(function (s, l) { return s + l.total; }, 0);
      info.subtotal = Math.round(sub * 100) / 100;
      info.total = Math.round(sub * (1 - info.descuento / 100) * 100) / 100;
      if (info.forma === 'tarjeta' && window.PD_CUOTAS) {
        var c = window.PD_CUOTAS.calcular(info.total, info.cuotas, info.sinRecargo ? 0 : info.recargoPct);
        info.plan = (info.cuotas === 1 ? '1 pago de ' : info.cuotas + ' cuotas de ') + q(c.cuota) + (info.sinRecargo ? ' · sin recargo' : ' · recargo ' + c.pct + ' %');
        info.totalPagar = c.total;
      }
      opciones.imprimir({ info: info, lineas: lineas });
    }
    var verSinProc = false;
    // Datos del presupuesto que se creará desde el odontograma
    var FORMAS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta de crédito'], ['otro', 'Otro']];
    var CUOTAS = [1, 2, 3, 6, 10, 12, 18, 24];
    var ESTADOS_PRE = [['activo', 'Activo'], ['aprobado', 'Aprobado'], ['proceso', 'Proceso'], ['finalizado', 'Finalizado'], ['no_aprobado', 'No aprobado']];
    var datosPre = { forma: 'efectivo', cuotas: 1, sinRecargo: false, citas: '', estado: 'activo' }, codigoPre = '';
    // Presupuesto ya confirmado desde el odontograma (el último del paciente)
    var preActual = null, modoNuevo = false, editandoExist = false, datosExist = null, msgPre = null;
    function fechaHora(t) { return t ? new Date(t).toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
    function estadoVisible(p) {
      if (p.estado === 'rechazado') return 'no_aprobado';
      if (p.estado !== 'aprobado') return 'activo';
      var its = (p.presupuesto_items || []).filter(function (i) { return i.estado !== 'eliminado'; });
      var fin = its.filter(function (i) { return i.estado === 'finalizado' || i.realizado; }).length;
      var avance = its.filter(function (i) { return i.estado === 'proceso'; }).length + fin;
      return !avance ? 'aprobado' : its.length && fin === its.length ? 'finalizado' : 'proceso';
    }
    function totalPresupuesto(p) {
      var sub = (p.presupuesto_items || []).filter(function (i) { return i.estado !== 'eliminado'; }).reduce(function (t, i) { return t + Number(i.cantidad) * Number(i.precio); }, 0);
      return Math.round(sub * (1 - (Number(p.descuento_pct) || 0) / 100) * 100) / 100;
    }
    function bloqueExistente() {
      var p = preActual, ev = estadoVisible(p), sup = esSuper(), ed = editandoExist && sup;
      var editable = p.estado === 'borrador' || p.estado === 'enviado';
      var d = ed ? datosExist : { forma: p.forma_pago || 'efectivo', cuotas: p.cuotas || 1, sinRecargo: !!p.sin_recargo, citas: p.citas || '' };
      var nomEst = ESTADOS_PRE.filter(function (x) { return x[0] === ev; })[0][1];
      var forma = FORMAS.filter(function (x) { return x[0] === d.forma; })[0];
      var total = totalPresupuesto(p);
      var campoForma = ed ? '<select data-ex-campo="forma">' + FORMAS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === d.forma ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'
        : '<div class="odg-fijo">' + (forma ? forma[1] : '—') + (d.forma === 'tarjeta' ? ' · ' + (d.cuotas === 1 ? '1 pago' : d.cuotas + ' cuotas') + (d.sinRecargo ? ' sin recargo' : '') : '') + '</div>';
      var campoCitas = ed ? '<input type="number" min="1" max="99" step="1" inputmode="numeric" data-ex-campo="citas" value="' + esc(d.citas) + '" placeholder="Ej.: 3">' : '<div class="odg-fijo">' + esc(d.citas || '—') + '</div>';
      var plan = d.forma === 'tarjeta' && window.PD_CUOTAS
        ? '<div class="odg-pre-campo' + (ed ? '' : ' cuo-bloqueada') + '"><span>Plan de pago con tarjeta</span>' + window.PD_CUOTAS.tabla(total, d.cuotas, ed ? 'ex-cuota' : 'ex-fijo', ed ? null : p.recargo_pct, d.sinRecargo) + '</div>' : '';
      var pie = !sup ? '' : '<div class="odg-pre-pie">' + (ed
        ? '<span>Al guardar, el presupuesto sube de versión.</span><div class="odg-fila-acc"><button type="button" class="odg-imp" data-ex-cancelar>Cancelar</button><button type="button" class="odg-crear" data-ex-guardar>Guardar cambios</button></div>'
        : '<span>Fechas y usuario se registran solos y no se pueden modificar.</span><div class="odg-fila-acc">' +
          '<button type="button" class="odg-imp" data-ex-mod' + (editable ? '' : ' disabled title="Un presupuesto aprobado o no aprobado ya no se puede modificar"') + '>Modificar presupuesto</button>' +
          '<button type="button" class="odg-imp" data-ex-estado>Cambiar estado</button><button type="button" class="odg-crear" data-pre-nuevo>Nuevo presupuesto</button></div>') + '</div>';
      return '<div class="odg-pre' + (ed ? ' odg-pre-ed' : '') + '"><div class="odg-pre-cab"><div class="odg-pre-tit">Datos del presupuesto</div><span class="odg-est odg-est-' + ev + '" aria-hidden="true">' + nomEst + '</span></div>' +
        '<div class="odg-pre-g">' +
        '<div class="odg-pre-campo"><span>Código del presupuesto</span><div class="odg-cod"><small>ASIGNADO</small>' + esc(p.codigo || 'N.º ' + p.id) + '</div></div>' +
        '<div class="odg-pre-campo"><span>Fecha del presupuesto</span><div class="odg-fijo odg-auto">' + fechaHora(p.creado) + '</div></div>' +
        '<div class="odg-pre-campo"><span>Usuario</span><div class="odg-fijo odg-auto">' + esc(p.creado_por || '—') + '</div></div>' +
        '<div class="odg-pre-campo"><span>Total del presupuesto</span><div class="odg-fijo odg-auto">' + q(total) + '</div></div>' +
        '<label class="odg-pre-campo"><span>Forma de pago</span>' + campoForma + '</label>' +
        '<label class="odg-pre-campo"><span>Cantidad de citas</span>' + campoCitas + '</label>' +
        '<div class="odg-pre-campo"><span>Fecha cambio de estado</span><div class="odg-fijo odg-auto">' + fechaHora(p.estado_cambiado) + (p.estado_cambiado_por ? ' · ' + esc(p.estado_cambiado_por) : '') + '</div></div>' +
        '<div class="odg-pre-campo"><span>Fecha de aprobación</span><div class="odg-fijo odg-auto">' + fechaHora(p.aprobado_en) + '</div></div>' +
        '</div>' + plan +
        '<div class="odg-pre-campo"><span>Estado</span><div class="odg-pre-est">' + ESTADOS_PRE.map(function (x) {
          return '<span class="odg-est odg-est-' + x[0] + '" aria-current="' + (x[0] === ev) + '"' + (x[0] === ev ? '' : ' style="opacity:.45"') + '>' + x[1] + '</span>'; }).join('') + '</div></div>' +
        (msgPre ? '<p class="odg-pre-msg' + (msgPre.error ? ' error' : '') + '" role="status">' + esc(msgPre.texto) + '</p>' : '') + pie + '</div>';
    }
    function bloquePresupuesto(total) {
      if (preActual && !modoNuevo) return bloqueExistente();
      var tarjeta = datosPre.forma === 'tarjeta', ed = editandoDatos && esSuper(), dis = ed ? '' : ' disabled';
      // Barra final: guardar lo definido y confirmar (crear) el presupuesto
      var pie = !esSuper() ? '' : '<div class="odg-pre-pie">' + (ed
        ? '<span>Revisa los datos y guárdalos; luego confirma para crear el presupuesto.</span><div class="odg-fila-acc"><button type="button" class="odg-imp" data-datos-cancelar>Cancelar</button><button type="button" class="odg-imp" data-datos-guardar>Guardar</button>' +
          (opciones.crearPresupuesto ? '<button type="button" class="odg-crear" data-datos-confirmar>Guardar y confirmar presupuesto</button>' : '') + '</div>'
        : '<span>Todo lo definido arriba se guarda en el presupuesto al confirmarlo.</span><div class="odg-fila-acc"><button type="button" class="odg-imp" data-datos-mod>Modificar información del presupuesto</button>' +
          (opciones.crearPresupuesto ? '<button type="button" class="odg-crear" data-crear-presupuesto>Confirmar presupuesto</button>' : '') + '</div>') + '</div>';
      return '<div class="odg-pre' + (ed ? ' odg-pre-ed' : '') + '"><div class="odg-pre-cab"><div class="odg-pre-tit">' + (preActual ? 'Nuevo presupuesto' : 'Datos del presupuesto') + '</div>' +
        (preActual ? '<button type="button" class="odg-ver-sin" data-pre-volver>← Volver al presupuesto ' + esc(preActual.codigo || '') + '</button>' : '') + '</div><div class="odg-pre-g">' +
        '<div class="odg-pre-campo"><span>Código del presupuesto</span><div class="odg-cod"><small>SE ASIGNA AL CREAR</small>' + esc(codigoPre || '—') + '</div></div>' +
        '<label class="odg-pre-campo"><span>Forma de pago</span><select data-pre-campo="forma"' + dis + '>' + FORMAS.map(function (x) {
          return '<option value="' + x[0] + '"' + (x[0] === datosPre.forma ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="odg-pre-campo"><span>Cantidad de citas</span><input type="number" min="1" max="99" step="1" inputmode="numeric" data-pre-campo="citas" value="' + esc(datosPre.citas) + '" placeholder="Ej.: 3"' + dis + '></label>' +
        '</div>' + (tarjeta && window.PD_CUOTAS ? '<div class="odg-pre-campo' + (ed ? '' : ' cuo-bloqueada') + '"><span>Plan de pago con tarjeta</span>' + window.PD_CUOTAS.tabla(total, datosPre.cuotas, 'pre-cuota', null, datosPre.sinRecargo) + '</div>' : '') +
        '<div class="odg-pre-campo"><span>Estado</span><div class="odg-pre-est" role="group" aria-label="Estado del presupuesto">' + ESTADOS_PRE.map(function (x) {
          var auto = x[0] === 'proceso' || x[0] === 'finalizado';
          return '<button type="button" class="odg-est odg-est-' + x[0] + '" data-pre-estado="' + x[0] + '" aria-pressed="' + (datosPre.estado === x[0]) + '"' +
            (auto ? ' disabled title="Se pone solo al marcar tratamientos realizados en Presupuesto"' : ed ? '' : ' disabled') + '>' + x[1] + '</button>'; }).join('') + '</div></div>' + pie + '</div>';
    }
    function resumen() {
      var f = filasDetalle(), sup = esSuper();
      var selTipo = '<label class="odg-tp">Tipo de precio <select data-tipo-precio' + (sup && editandoDatos ? '' : ' disabled title="Pulsa «Modificar información del presupuesto» para cambiarlo"') + '>' + TIPOS_PRECIO.map(function (t) {
        return '<option value="' + t[0] + '"' + (t[0] === tipoPrecio ? ' selected' : '') + '>' + t[1] + '</option>';
      }).join('') + '</select></label>';
      var crearPre = (opciones.imprimir ? '<button type="button" class="odg-imp" data-imprimir-odg>Imprimir</button>' : '') +
        (opciones.crearPresupuesto && sup ? '<button type="button" class="odg-crear" data-crear-presupuesto>Crear presupuesto</button>' : '');
      // En el detalle «Requerido» solo se ven los hallazgos con procedimiento elegido;
      // el Super Administrador puede mostrar los demás para elegirles uno.
      var conProc = f.req.filter(function (x) { return x.proc; }), sinN = f.req.length - conProc.length;
      if (!sup) verSinProc = false;
      var visibles = verSinProc ? f.req : conProc;
      var enlace = sinN && sup ? '<button type="button" class="odg-ver-sin" data-ver-sin>' + (verSinProc ? 'Ocultar los hallazgos sin procedimiento'
        : 'Elegir procedimiento para ' + sinN + (sinN === 1 ? ' hallazgo' : ' hallazgos') + ' sin procedimiento') + '</button>' : '';
      var totalPre = conProc.reduce(function (t, x) { var v = valorFila(x); return t + (v.total || 0); }, 0);
      return '<div><div class="odg-cab"><h4 style="color:' + ROJO + '">Requerido (' + visibles.length + ')</h4>' +
        (f.req.length && catalogo.length ? '<div class="odg-acc">' + selTipo + crearPre + '</div>' : '') + '</div>' +
        (msgPre && preActual && !modoNuevo && !(opciones.crearPresupuesto && (conProc.length || preActual)) ? '<p class="odg-pre-msg' + (msgPre.error ? ' error' : '') + '">' + esc(msgPre.texto) + '</p>' : '') +
        (visibles.length ? tablaDetalle(visibles, true) : f.req.length ? '<p class="odg-vacio">Aún no hay hallazgos con procedimiento elegido.</p>' : 'Sin tratamientos pendientes.') + enlace +
        (opciones.crearPresupuesto && (conProc.length || (preActual && !modoNuevo)) ? bloquePresupuesto(totalPre) : '') + '</div>' +
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
    function ponerProc(n, clave, item, precio) {
      var p = datos.piezas[n];
      if (!p) return;
      if (item) {
        p.proc = p.proc || {}; p.proc[clave] = { id: item.id || null, n: item.nombre };
        // Valor real del procedimiento: el que se escribió al elegirlo (si no es el del catálogo)
        var base = precioDe(item);
        if (precio != null && !isNaN(precio) && precio >= 0 && (base == null || Math.round(precio * 100) !== Math.round(base * 100))) p.proc[clave].precio = Math.round(precio * 100) / 100;
      }
      else quitarProc(p, clave);
      avisar();
      pintar();
    }

    // Ventana para elegir el procedimiento de una marca «Requerido»
    var dlg = null;
    function llenarVentana() {
      var inf = dlg._info, bus = norm(dlg.querySelector('input').value.trim());
      var rel = relacionados(inf.h);
      var todos = disponibles();
      var lista = bus ? todos.filter(function (c) { return norm(c.nombre + ' ' + c.tipo).indexOf(bus) >= 0; })
        : dlg._todos || !rel.length ? todos : rel;
      dlg.querySelector('[data-todos]').hidden = !!(bus || lista === todos);
      dlg.querySelector('.lista').innerHTML = lista.length ? lista.map(function (c) {
        var pr = precioDe(c);
        var val = dlg._val[c.k] != null ? dlg._val[c.k] : (pr != null ? pr.toFixed(2) : '');
        return '<div class="op" role="button" tabindex="0" data-k="' + c.k + '" aria-pressed="' + (dlg._sel === c.k) + '"><span>' + esc(c.nombre) + (c.tipo ? '<small>' + esc(c.tipo) + '</small>' : '') + '</span>' +
          '<label class="pr-ed" title="Valor real del procedimiento: cámbialo si es necesario y luego elige el procedimiento"><span>Q</span><input type="number" min="0" step="0.01" inputmode="decimal" data-precio value="' + esc(val) + '" placeholder="' + (pr != null ? '' : 'Sin precio') + '" aria-label="Valor de ' + esc(c.nombre) + '"></label></div>';
      }).join('') : '<p>No hay procedimientos con ese nombre.</p>';
      dlg.querySelector('[data-confirmar]').disabled = !dlg._sel;
    }
    function marcarOp(o) {
      dlg._sel = o.dataset.k;
      dlg.querySelectorAll('.lista [data-k]').forEach(function (x) { x.setAttribute('aria-pressed', x === o); });
      dlg.querySelector('[data-confirmar]').disabled = false;
    }
    // Confirmar: aplica el procedimiento con su valor real a la pieza, graba el odontograma y pasa todos los
    // procedimientos requeridos al presupuesto (que queda aprobado)
    function confirmarOp() {
      var o = dlg._sel && dlg.querySelector('.lista [data-k="' + dlg._sel + '"]');
      if (!o) return;
      if (elegirOp(o) && opciones.guardar) {
        var items = lineasPresupuesto().lineas.map(function (l) { return { tratamiento: l.tratamiento, pieza: l.pieza, cantidad: l.cantidad, precio: l.precio }; });
        opciones.guardar({ items: items, tipo: tipoPrecio });
      }
    }
    function elegirOp(o) {
      var item = catalogo.filter(function (c) { return c.k === o.dataset.k; })[0];
      var inp = o.querySelector('[data-precio]'), val = inp && inp.value.trim() !== '' ? Number(inp.value) : null;
      if (val != null && (isNaN(val) || val < 0)) { inp.focus(); inp.select(); return false; }
      var inf = dlg._info;
      dlg.close();
      if (item && inf) { inf.elegir(inf.n, inf.clave, item, val); return true; }
      return false;
    }
    function abrirVentana(info) {
      if (!esSuper() || !disponibles().length || typeof HTMLDialogElement === 'undefined') return;
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'odg-dlg';
        dlg.innerHTML = '<form method="dialog"><h4></h4><p></p><input type="search" placeholder="Buscar procedimiento" aria-label="Buscar procedimiento"><div class="lista"></div>' +
          '<div class="pie"><a data-todos tabindex="0">Ver todo el catálogo</a><span class="pie-acc"><button value="despues">Decidir después</button><button type="button" class="pri" data-confirmar disabled>Confirmar</button></span></div></form>';
        document.body.appendChild(dlg);
        dlg.addEventListener('click', function (e) {
          if (e.target === dlg) { dlg.close(); return; }
          if (e.target.closest('[data-confirmar]')) { e.preventDefault(); confirmarOp(); return; }
          var o = e.target.closest('[data-k]');
          if (o) { if (!e.target.closest('.pr-ed')) e.preventDefault(); marcarOp(o); return; }
          if (e.target.closest('[data-todos]')) { dlg._todos = true; llenarVentana(); dlg.querySelector('input').focus(); }
        });
        dlg.querySelector('input').addEventListener('input', llenarVentana);
        // Al escribir un valor se marca ese procedimiento
        dlg.querySelector('.lista').addEventListener('input', function (e) {
          var inp = e.target.closest('[data-precio]'); if (!inp) return;
          var o = inp.closest('[data-k]'); dlg._val[o.dataset.k] = inp.value; marcarOp(o);
        });
        // Enter en el valor (o Enter/espacio sobre el procedimiento) lo elige
        dlg.addEventListener('keydown', function (e) {
          var o = e.target.closest && e.target.closest('[data-k]');
          if (!o) return;
          if (e.key === 'Enter') { e.preventDefault(); marcarOp(o); confirmarOp(); }
          else if (e.key === ' ' && e.target === o) { e.preventDefault(); marcarOp(o); }
        });
      }
      info.elegir = ponerProc;
      dlg._info = info; dlg._todos = false; dlg._sel = null; dlg._val = {};
      dlg.querySelector('h4').textContent = 'Pieza ' + info.n + ' · ' + info.texto;
      var tp = TIPOS_PRECIO.filter(function (t) { return t[0] === tipoPrecio; })[0];
      dlg.querySelector('p').innerHTML = '¿Qué procedimiento se hará? Precios de <b>' + (tp ? tp[1] : '') + '</b>. Elige el procedimiento, ajusta su valor si es necesario y pulsa «Confirmar»: ese será el valor real.';
      dlg.querySelector('input').value = '';
      llenarVentana();
      dlg.showModal();
      var primero = dlg.querySelector('.op');
      if (primero) primero.focus();
    }

    // Crear presupuesto con los hallazgos «Requerido» que ya tienen procedimiento (precio del tipo elegido)
    var dlgEst = null;
    function abrirCambioEstado() {
      if (typeof HTMLDialogElement === 'undefined' || !opciones.cambiarEstadoPresupuesto) return;
      if (!dlgEst) {
        dlgEst = document.createElement('dialog');
        dlgEst.className = 'odg-dlg';
        document.body.appendChild(dlgEst);
        dlgEst.addEventListener('click', function (e) {
          if (e.target === dlgEst && !dlgEst._ocupado) { dlgEst.close(); return; }
          var o = e.target.closest('[data-nuevo-estado]');
          if (o && !o.disabled) { dlgEst.querySelectorAll('[data-nuevo-estado]').forEach(function (x) { x.setAttribute('aria-pressed', x === o); }); dlgEst.querySelector('[data-est-ok]').disabled = false; return; }
          var ok = e.target.closest('[data-est-ok]');
          if (ok && !dlgEst._ocupado) {
            e.preventDefault();
            var sel = dlgEst.querySelector('[data-nuevo-estado][aria-pressed="true"]');
            if (!sel) return;
            dlgEst._ocupado = true; ok.disabled = true; ok.textContent = 'Cambiando…';
            opciones.cambiarEstadoPresupuesto(preActual, sel.dataset.nuevoEstado).then(function () {
              dlgEst._ocupado = false; dlgEst.close(); msgPre = { texto: 'Estado cambiado a ' + sel.textContent.split(' —')[0] + '.' }; pintar();
            }).catch(function (err) {
              dlgEst._ocupado = false; ok.disabled = false; ok.textContent = 'Cambiar estado';
              dlgEst.querySelector('.error').textContent = err.message || String(err);
            });
          }
        });
        dlgEst.addEventListener('cancel', function (e) { if (dlgEst._ocupado) e.preventDefault(); });
      }
      var p = preActual, actualBd = p.estado === 'enviado' ? 'borrador' : p.estado;
      var opcionesEst = [['borrador', 'Activo', ''], ['aprobado', 'Aprobado', ' — registra la fecha de aprobación'], ['rechazado', 'No aprobado', '']];
      dlgEst.innerHTML = '<form method="dialog"><h4>Cambiar estado · ' + esc(p.codigo || 'N.º ' + p.id) + '</h4>' +
        '<p>Estado actual: <b>' + ESTADOS_PRE.filter(function (x) { return x[0] === estadoVisible(p); })[0][1] + '</b> desde ' + fechaHora(p.estado_cambiado) + '</p>' +
        '<div class="lista">' + opcionesEst.map(function (x) {
          var dis = x[0] === actualBd;
          return '<button type="button" class="op" data-nuevo-estado="' + x[0] + '" aria-pressed="false"' + (dis ? ' disabled style="opacity:.5"' : '') + '><span>' + x[1] + '<small>' + (dis ? 'Estado actual' : x[2].replace(' — ', '')) + '</small></span></button>';
        }).join('') + '</div>' +
        '<p style="font-size:12.5px">Proceso y Finalizado se ponen solos al marcar tratamientos realizados en Presupuesto.</p>' +
        '<p class="error" role="alert"></p>' +
        '<div class="pie der"><button value="cancelar">Cancelar</button><button type="button" class="pri" data-est-ok disabled>Cambiar estado</button></div></form>';
      dlgEst._ocupado = false;
      dlgEst.showModal();
    }
    var dlgPre = null;
    function lineasPresupuesto() {
      var lineas = [], sinProc = [];
      filasDetalle().req.forEach(function (f) {
        if (f.h === 'ausente') return;
        if (!f.proc) { sinProc.push(f); return; }
        var item = buscarEnCatalogo(f.proc), v = valorFila(f);
        lineas.push({ tratamiento: item ? item.nombre : f.proc.n, pieza: piezaDe(f), cantidad: v.cant, precio: v.unit == null ? 0 : v.unit, sinPrecio: v.unit == null });
      });
      return { lineas: lineas, sinProc: sinProc };
    }
    function pieVentana(botones) { return '<div class="pie der">' + botones + '</div>'; }
    function abrirPresupuesto() {
      if (typeof HTMLDialogElement === 'undefined') return;
      if (!dlgPre) {
        dlgPre = document.createElement('dialog');
        dlgPre.className = 'odg-dlg';
        document.body.appendChild(dlgPre);
        dlgPre.addEventListener('click', function (e) {
          if (e.target === dlgPre && !dlgPre._ocupado) { dlgPre.close(); return; }
          if (e.target.closest('[data-pre-crear]')) { e.preventDefault(); confirmarPresupuesto(); return; }
          var ab = e.target.closest('[data-pre-abrir]');
          if (ab) { e.preventDefault(); dlgPre.close(); opciones.abrirPresupuesto(+ab.dataset.preAbrir); }
        });
        dlgPre.addEventListener('cancel', function (e) { if (dlgPre._ocupado) e.preventDefault(); });
      }
      var d = lineasPresupuesto(), tp = TIPOS_PRECIO.filter(function (t) { return t[0] === tipoPrecio; })[0];
      var nombre = opciones.paciente ? opciones.paciente() : '';
      dlgPre._datos = d;
      var html = '<form method="dialog"><h4>Crear presupuesto</h4>' +
        '<p>Nuevo presupuesto' + (nombre ? ' · <b>' + esc(nombre) + '</b>' : '') + '</p>' +
        '<p>Tipo de precio: <b>' + (tp ? tp[1] : '') + '</b></p>' +
        '<p>Forma de pago: <b>' + FORMAS.filter(function (x) { return x[0] === datosPre.forma; })[0][1] + (datosPre.forma === 'tarjeta' ? ' · ' + (datosPre.cuotas === 1 ? '1 pago' : datosPre.cuotas + ' cuotas') + (datosPre.sinRecargo ? ' sin recargo' : '') : '') + '</b>' +
        (datosPre.forma === 'tarjeta' && window.PD_CUOTAS ? ' · Total a pagar: <b>' + q(window.PD_CUOTAS.calcular(d.lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0), datosPre.cuotas, datosPre.sinRecargo ? 0 : null).total) + '</b>' : '') +
        (datosPre.citas ? ' · Citas: <b>' + esc(datosPre.citas) + '</b>' : '') + ' · Estado: <b>' + ESTADOS_PRE.filter(function (x) { return x[0] === datosPre.estado; })[0][1] + '</b></p>';
      if (!d.lineas.length) {
        html += '<div class="alerta">Ningún hallazgo «Requerido» tiene procedimiento. Elige el procedimiento en la tabla del detalle y vuelve a intentarlo.</div>' +
          pieVentana('<button value="cerrar">Cerrar</button>');
      } else {
        var total = d.lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0);
        var sinPrecio = d.lineas.filter(function (l) { return l.sinPrecio; });
        html += '<div class="tabla"><table class="odg-det"><thead><tr><th>Pieza</th><th>Tratamiento</th><th class="num">Precio</th></tr></thead><tbody>' +
          d.lineas.map(function (l) {
            return '<tr><td><strong>' + l.pieza + '</strong></td><td>' + esc(l.tratamiento) + '</td><td class="num">' + (l.sinPrecio ? '<span class="sinp">' + q(0) + '</span>' : (l.cantidad > 1 ? l.cantidad + ' × ' + q(l.precio) + ' = ' : '') + q(l.precio * l.cantidad)) + '</td></tr>';
          }).join('') + '</tbody><tfoot><tr><td></td><td>TOTAL</td><td class="num">' + q(total) + '</td></tr></tfoot></table></div>';
        if (sinPrecio.length) {
          html += '<div class="alerta"><b>Sin precio con este tipo:</b> se agregan en Q0.00 para que escribas el precio en el presupuesto.<ul>' +
            sinPrecio.map(function (l) { return '<li><b>' + l.pieza + '</b> ' + esc(l.tratamiento) + '</li>'; }).join('') + '</ul></div>';
        }
        if (d.sinProc.length) {
          html += '<div class="alerta"><b>Sin procedimiento:</b> estos hallazgos no se incluyen.<ul>' +
            d.sinProc.map(function (f) { return '<li><b>' + f.n + '</b> ' + esc(f.texto) + '</li>'; }).join('') + '</ul></div>';
        }
        html += '<p class="error" role="alert"></p>' +
          pieVentana('<button value="cancelar">Cancelar</button><button type="button" class="pri" data-pre-crear>Crear borrador</button>');
      }
      dlgPre.innerHTML = html + '</form>';
      dlgPre._ocupado = false;
      dlgPre.showModal();
      var foco = dlgPre.querySelector('[data-pre-crear]') || dlgPre.querySelector('button');
      if (foco) foco.focus();
    }
    async function confirmarPresupuesto() {
      var b = dlgPre.querySelector('[data-pre-crear]'), d = dlgPre._datos;
      if (!b || dlgPre._ocupado) return;
      dlgPre._ocupado = true;
      b.disabled = true; b.textContent = 'Creando…';
      dlgPre.querySelector('.error').textContent = '';
      try {
        var r = await opciones.crearPresupuesto({
          tipo: tipoPrecio,
          forma_pago: datosPre.forma, cuotas: datosPre.forma === 'tarjeta' ? datosPre.cuotas : null, sin_recargo: datosPre.forma === 'tarjeta' && datosPre.sinRecargo,
          citas: datosPre.citas ? +datosPre.citas : null, estado: datosPre.estado,
          items: d.lineas.map(function (l) { return { tratamiento: l.tratamiento, pieza: l.pieza, cantidad: l.cantidad, precio: l.precio }; })
        });
        var total = d.lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0);
        modoNuevo = false; editandoDatos = false;
        var puedeAbrir = opciones.abrirPresupuesto && (!opciones.puedeAbrirPresupuesto || opciones.puedeAbrirPresupuesto());
        dlgPre.innerHTML = '<form method="dialog"><div class="ok"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1B7F4B"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '<h4><span>Presupuesto ' + esc(r.codigo || 'N.º ' + r.id) + '</span> <span>creado</span></h4></div>' +
          '<p>' + ESTADOS_PRE.filter(function (x) { return x[0] === datosPre.estado; })[0][1] + ' · ' + d.lineas.length + (d.lineas.length === 1 ? ' tratamiento' : ' tratamientos') + ' · ' + q(total) + '</p>' +
          '<p>Puedes revisarlo, aplicar descuento y enviarlo desde Presupuesto.</p>' +
          pieVentana('<button value="cerrar">Seguir en el odontograma</button>' + (puedeAbrir ? '<button type="button" class="pri" data-pre-abrir="' + r.id + '">Abrir en Presupuesto</button>' : '')) +
          '</form>';
        dlgPre._ocupado = false;
        var ab = dlgPre.querySelector('[data-pre-abrir]') || dlgPre.querySelector('button');
        if (ab) ab.focus();
      } catch (err) {
        dlgPre._ocupado = false;
        b.disabled = false; b.textContent = 'Crear borrador';
        dlgPre.querySelector('.error').textContent = (err && err.message) || 'No se pudo crear el presupuesto.';
      }
    }

    raiz.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-tipo-precio]')) { tipoPrecio = t.value; pintar(); return; }
      if (t.matches('[data-item-estado]') && opciones.cambiarEstadoItem) {
        var nuevoEst = t.value; t.disabled = true;
        opciones.cambiarEstadoItem(+t.dataset.itemEstado, nuevoEst).then(function () {
          msgPre = { texto: 'Estado del procedimiento: ' + ESTADOS_ITEM.filter(function (x) { return x[0] === nuevoEst; })[0][1] + '.' + (nuevoEst === 'proceso' || nuevoEst === 'finalizado' ? ' Ya aparece en la pestaña Tratamientos.' : '') };
        }).catch(function (err) { msgPre = { texto: err.message || String(err), error: true }; }).then(pintar);
        return;
      }
      if (t.matches('[data-ex-campo]') && datosExist) {
        if (t.dataset.exCampo === 'forma') { datosExist.forma = t.value; if (t.value === 'tarjeta' && window.PD_CUOTAS) window.PD_CUOTAS.cargar(); pintar(); }
        else datosExist.citas = t.value ? String(Math.min(Math.max(parseInt(t.value, 10) || 1, 1), 99)) : '';
        return;
      }
      if (t.matches('[data-pre-campo]')) {
        var c = t.dataset.preCampo;
        if (c === 'forma') { datosPre.forma = t.value; if (t.value === 'tarjeta' && window.PD_CUOTAS) window.PD_CUOTAS.cargar(); pintar(); }
        else if (c === 'cuotas') datosPre.cuotas = +t.value;
        else if (c === 'citas') datosPre.citas = t.value ? String(Math.min(Math.max(parseInt(t.value, 10) || 1, 1), 99)) : '';
        return;
      }
      if (t.matches('[data-ed="proc"]')) {
        var it2 = catalogo.filter(function (c) { return c.k === t.value; })[0], pr = t.closest('tr').querySelector('[data-ed="precio"]');
        if (it2 && pr) { var b2 = precioDe(it2); pr.value = b2 != null ? b2.toFixed(2) : ''; pr.placeholder = b2 != null ? b2.toFixed(2) : '0.00'; }
        return;
      }
      if (t.matches('[data-proc-pieza]')) {
        if (t.value === '-') { ponerProc(+t.dataset.procPieza, t.dataset.procClave, null); return; }
        var item = catalogo.filter(function (c) { return c.k === t.value; })[0];
        if (item) ponerProc(+t.dataset.procPieza, t.dataset.procClave, item);
      }
    });
    raiz.addEventListener('click', function (e) {
      if (e.target.closest('select')) return;
      if (e.target.closest('[data-ver-sin]')) { verSinProc = !verSinProc; pintar(); return; }
      var fm = e.target.closest('[data-fila-mod]');
      if (fm && esSuper()) { editandoFila = fm.dataset.filaMod; pintar(); var pf = raiz.querySelector('.odg-edit [data-ed="proc"]'); if (pf) pf.focus(); return; }
      if (e.target.closest('[data-fila-guardar]')) { guardarFila(e.target.closest('tr')); return; }
      if (e.target.closest('[data-fila-cancelar]')) { editandoFila = null; pintar(); return; }
      if (e.target.closest('[data-datos-mod]') && esSuper()) { editandoDatos = true; copiaDatos = { d: JSON.parse(JSON.stringify(datosPre)), t: tipoPrecio }; pintar(); return; }
      if (e.target.closest('[data-datos-guardar]')) { editandoDatos = false; copiaDatos = null; pintar(); return; }
      if (e.target.closest('[data-pre-nuevo]') && esSuper()) { modoNuevo = true; editandoDatos = true; msgPre = null; datosPre = { forma: 'efectivo', cuotas: 1, sinRecargo: false, citas: '', estado: 'activo' }; copiaDatos = { d: JSON.parse(JSON.stringify(datosPre)), t: tipoPrecio }; pintar(); return; }
      if (e.target.closest('[data-pre-volver]')) { modoNuevo = false; editandoDatos = false; pintar(); return; }
      if (e.target.closest('[data-ex-mod]') && esSuper() && preActual) {
        editandoExist = true; msgPre = null;
        datosExist = { forma: preActual.forma_pago || 'efectivo', cuotas: preActual.cuotas || 1, sinRecargo: !!preActual.sin_recargo, citas: preActual.citas ? String(preActual.citas) : '' };
        if (window.PD_CUOTAS) window.PD_CUOTAS.cargar();
        pintar(); return;
      }
      if (e.target.closest('[data-ex-cancelar]')) { editandoExist = false; datosExist = null; pintar(); return; }
      if (e.target.closest('[data-ex-guardar]') && opciones.guardarPresupuesto) {
        var bt = e.target.closest('[data-ex-guardar]'); bt.disabled = true; bt.textContent = 'Guardando…';
        opciones.guardarPresupuesto(preActual, datosExist).then(function () { editandoExist = false; datosExist = null; msgPre = { texto: 'Cambios guardados.' }; })
          .catch(function (err) { msgPre = { texto: err.message || String(err), error: true }; }).then(pintar);
        return;
      }
      var exc = e.target.closest('[data-ex-cuota]');
      if (exc && editandoExist) { datosExist.cuotas = +exc.dataset.exCuota; pintar(); return; }
      var exm = e.target.closest('[data-ex-cuota-modo]');
      if (exm && editandoExist) { datosExist.sinRecargo = exm.dataset.exCuotaModo === 'sin'; pintar(); return; }
      if (e.target.closest('[data-ex-estado]') && esSuper() && preActual) { abrirCambioEstado(); return; }
      if (e.target.closest('[data-datos-confirmar]')) { editandoDatos = false; copiaDatos = null; pintar(); abrirPresupuesto(); return; }
      var modo = e.target.closest('[data-pre-cuota-modo]');
      if (modo) { if (editandoDatos && esSuper()) { datosPre.sinRecargo = modo.dataset.preCuotaModo === 'sin'; pintar(); } return; }
      if (e.target.closest('[data-datos-cancelar]')) { if (copiaDatos) { datosPre = copiaDatos.d; tipoPrecio = copiaDatos.t; } editandoDatos = false; copiaDatos = null; pintar(); return; }
      var cuo = e.target.closest('[data-pre-cuota]');
      if (cuo && !(editandoDatos && esSuper())) return;
      if (cuo) { datosPre.cuotas = +cuo.dataset.preCuota; pintar(); var f2 = raiz.querySelector('[data-pre-cuota="' + datosPre.cuotas + '"]'); if (f2) f2.focus({ preventScroll: true }); return; }
      var est = e.target.closest('[data-pre-estado]');
      if (est) { if (!est.disabled && editandoDatos && esSuper()) { datosPre.estado = est.dataset.preEstado; pintar(); } return; }
      if (e.target.closest('[data-crear-presupuesto]')) { abrirPresupuesto(); return; }
      if (e.target.closest('[data-imprimir-odg]')) { imprimirDetalle(); return; }
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
      var fc = e.target.closest('[data-pre-cuota]');
      if (fc) { e.preventDefault(); fc.click(); return; }
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

    // ---------- Dictado por voz ----------
    // Procedimiento dicho (por palabras) o, si no se dijo, el más adecuado del catálogo con precio
    function procDictado(texto, h, nCaras) {
      var lista = disponibles();
      if (texto) {
        var t = norm(texto), pal = t.split(/\s+/).filter(function (w) { return w.length > 2 && ['del', 'con', 'una', 'las', 'los'].indexOf(w) < 0; });
        var mejor = null;
        lista.forEach(function (c) {
          var nom = norm(c.nombre), pts = pal.filter(function (w) { return nom.indexOf(w.slice(0, 6)) >= 0; }).length;
          if (!pts) return;
          if (/\buna\b/.test(t) && /\buna\b/.test(nom)) pts += 1;
          if (/\b(varias|dos|tres)\b/.test(t) && /varias/.test(nom)) pts += 1;
          if (!mejor || pts > mejor.pts) mejor = { c: c, pts: pts };
        });
        if (mejor) return mejor.c;
      }
      var rel = relacionados(h);
      if (!rel.length) return null;
      if (h === 'caries' || h === 'obturacion') {
        var quiere = nCaras > 1 ? /varias|dos|tres|compuesta/ : /una|simple/;
        return rel.filter(function (c) { return quiere.test(norm(c.nombre)); })[0] || rel[0];
      }
      return rel[0];
    }
    // ins: { n, h, caras: ['O','D'], c: 'r'|'a', proc: 'texto dicho' } → { ok, texto, proc, precio }
    function dictar(ins) {
      var h = POR_ID[ins.h], n = +ins.n;
      if (!h) return { ok: false, texto: 'No entendí el hallazgo.' };
      if (ORDEN.indexOf(n) < 0) return { ok: false, texto: 'La pieza ' + ins.n + ' no existe en la notación FDI.' };
      var temporal = n >= 51;
      if ((temporal && datos.denticion === 'permanente') || (!temporal && datos.denticion === 'temporal')) datos.denticion = 'mixta';
      if (h.tipo === 'borrar') { delete datos.piezas[n]; avisar(); pintar(); return { ok: true, texto: 'Pieza ' + n + ': marcas borradas.' }; }
      var c = h.fijo || ins.c || 'r', p = pieza(n), claves = [];
      if (h.tipo === 'cara') {
        var g = geometria(n), caras = (ins.caras && ins.caras.length ? ins.caras : [g.centro]).map(function (k) { return k === 'O' && n % 10 <= 3 ? 'I' : k === 'I' && n % 10 > 3 ? 'O' : k; });
        caras.forEach(function (k) { if (p.caras[k] && p.caras[k].h !== h.id) quitarProc(p, k); p.caras[k] = { h: h.id, c: c }; if (claves.indexOf(k) < 0) claves.push(k); });
        delete p.estados.ausente; quitarProc(p, 'ausente');
      } else {
        if (h.id === 'ausente') { p.caras = {}; p.estados = { ausente: 'a' }; delete p.proc; }
        else { p.estados[h.id] = c; delete p.estados.ausente; quitarProc(p, 'ausente'); }
        claves.push(h.id);
      }
      var desc = h.nombre + (h.tipo === 'cara' ? ' ' + claves.map(function (k) { return nombreCara(k, n); }).join(' y ') : '') + (h.fijo ? '' : c === 'r' ? ' (requerido)' : ' (realizado)');
      var res = { ok: true, texto: 'Pieza ' + n + ': ' + desc };
      if (c === 'r' && h.id !== 'ausente') {
        var item = procDictado(ins.proc, h.id, claves.length);
        if (item) {
          p.proc = p.proc || {};
          p.proc[claves[0]] = { id: item.id || null, n: item.nombre };
          res.proc = item.nombre; res.precio = precioDe(item);
          res.texto += ' → ' + item.nombre + (res.precio != null ? ' ' + q(res.precio) : '');
        } else res.texto += ' (no hay procedimiento con precio en el catálogo)';
      }
      avisar();
      pintar();
      return res;
    }

    pintar();
    return {
      dictar: dictar,
      crearPresupuesto: function () { abrirPresupuesto(); },
      totalRequerido: function () { return lineasPresupuesto().lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0); },
      cargar: function (valor, edad) { datos = normalizar(valor, edad); pintar(); },
      valor: function () { return JSON.parse(JSON.stringify(datos)); },
      hallazgos: function () { return Object.keys(datos.piezas).length; },
      // lista: [{ id, nombre, tipo, base, precios: { directo: 350, vip: 300 } }] (id null = sugerido sin catálogo)
      codigoPresupuesto: function (texto) { codigoPre = texto || ''; pintar(); },
      // último presupuesto del paciente creado desde el odontograma (null = ninguno)
      presupuestoActual: function (p) {
        var mismo = preActual && p && preActual.id === p.id;
        preActual = p || null;
        if (!mismo) { modoNuevo = false; editandoExist = false; datosExist = null; msgPre = null; }
        pintar();
      },
      // al cargar los % de recargo se vuelve a dibujar la tabla de cuotas
      recargos: function () { if (datosPre.forma === 'tarjeta') pintar(); },
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

  // Imagen del odontograma (solo el dibujo y la leyenda) para los reportes impresos
  function imagen(valor, edad) {
    var div = document.createElement('div');
    crear(div, {}).cargar(valor, edad);
    var mapa = div.querySelector('.odg-lienzo'), ley = div.querySelector('.odg-ley');
    if (!mapa) return '';
    mapa.querySelectorAll('[tabindex]').forEach(function (e) { e.removeAttribute('tabindex'); e.removeAttribute('role'); });
    return '<div class="odg odg-imagen">' + mapa.outerHTML + (ley ? ley.outerHTML : '') + '</div>';
  }

  window.Odontograma = { crear: crear, diferencias: diferencias, imagen: imagen };
})();
