// Plus Dental — Firma electrónica y sello del médico en los reportes impresos.
// PD_FIRMA.cargar(idDentista) trae nombre, colegiado, firma y sello (como imágenes incrustadas, para imprimir al instante).
// PD_FIRMA.bloque(info) arma el bloque del médico; PD_FIRMA.conPaciente(info) lo pone junto a la línea de firma del paciente.
(function () {
  var sb = window.PD_SB;
  if (!sb) return;
  var BUCKET = 'expedientes', cache = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function aDataUrl(blob) {
    return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ok(null); }; r.readAsDataURL(blob); });
  }
  async function imagen(ruta) {
    if (!ruta) return null;
    var d = await sb.storage.from(BUCKET).download(ruta);
    return d.error || !d.data ? null : aDataUrl(d.data);
  }
  // info: { id, nombre, colegiado, firma (dataURL|null), sello (dataURL|null) }
  async function cargar(id, nombreRespaldo) {
    if (!id) return { id: null, nombre: nombreRespaldo || '', colegiado: '', firma: null, sello: null };
    if (cache[id]) return cache[id];
    var r = await sb.from('dentistas').select('id,nombre,colegiado,firma,sello').eq('id', id).maybeSingle();
    if (r.error && /firma|sello/.test(r.error.message || '')) r = await sb.from('dentistas').select('id,nombre,colegiado').eq('id', id).maybeSingle();
    var d = r.data || { id: id, nombre: nombreRespaldo || '' };
    var imgs = await Promise.all([imagen(d.firma), imagen(d.sello)]);
    cache[id] = { id: d.id, nombre: d.nombre || nombreRespaldo || '', colegiado: d.colegiado || '', firma: imgs[0], sello: imgs[1] };
    return cache[id];
  }
  function olvidar(id) { if (id) delete cache[id]; else cache = {}; }

  // Bloque del médico: firma sobre la línea, sello a la derecha, nombre, colegiado y «Firma y sello»
  function bloque(info, opc) {
    opc = opc || {};
    info = info || {};
    var ancho = opc.ancho || 300;
    var nombre = info.nombre ? 'Dr(a). ' + info.nombre : 'Médico tratante';
    return '<div style="width:' + ancho + 'px;max-width:100%;text-align:center;font-family:Manrope,system-ui,sans-serif;color:#0B2B40;break-inside:avoid;page-break-inside:avoid">' +
      '<div style="position:relative;height:96px">' +
      (info.firma ? '<img src="' + info.firma + '" alt="Firma" style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);max-width:' + (ancho - 40) + 'px;max-height:88px;object-fit:contain">' : '') +
      (info.sello ? '<img src="' + info.sello + '" alt="Sello" style="position:absolute;right:-22px;bottom:-14px;width:92px;height:92px;object-fit:contain;opacity:.92">' : '') +
      '</div>' +
      '<div style="border-top:1.5px solid #0B2B40;padding-top:7px">' +
      '<b style="display:block;font-size:14px;letter-spacing:.01em">' + esc(nombre) + '</b>' +
      (info.colegiado ? '<span style="display:block;font-size:12px;color:#475B68">Colegiado activo N.º ' + esc(info.colegiado) + '</span>' : '') +
      '<span style="display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#005A87;font-weight:800;margin-top:3px">' + esc(opc.etiqueta || 'Firma y sello del médico') + '</span>' +
      '</div></div>';
  }
  // Médico (izquierda) y paciente (derecha), alineados en la misma base
  function conPaciente(info, etiquetaPaciente, nombrePaciente) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:40px;margin-top:40px;flex-wrap:wrap">' +
      bloque(info) +
      '<div style="width:260px;max-width:100%;text-align:center;font-family:Manrope,system-ui,sans-serif;break-inside:avoid"><div style="height:96px"></div>' +
      '<div style="border-top:1.5px solid #0B2B40;padding-top:7px"><b style="display:block;font-size:14px;color:#0B2B40">' + (nombrePaciente ? esc(nombrePaciente) : '&nbsp;') + '</b>' +
      '<span style="display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#475B68;font-weight:800;margin-top:3px">' + esc(etiquetaPaciente || 'Firma del paciente') + '</span></div></div></div>';
  }
  window.PD_FIRMA = { cargar: cargar, olvidar: olvidar, bloque: bloque, conPaciente: conPaciente };
})();
