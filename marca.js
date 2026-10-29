// Plus Dental — Marca dinámica: logo e imagen del slogan de la localidad / empresa (Catálogos › Organizaciones).
// El público ve la localidad marcada como «Marca de la página web»; el personal conectado, la de su sede.
// Se usa en el encabezado y el pie de la página y en el encabezado de todas las impresiones.
// Si la localidad no tiene imágenes, se deja la marca fija de la página (logo-plusdental-marca.png).
(function () {
  var sb = window.PD_SB || null;
  var CLAVE = 'pd_marca', marca = null, cargando = null;

  try { marca = JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { marca = null; }
  function url(ruta) { return ruta && sb ? sb.storage.from('publico').getPublicUrl(ruta).data.publicUrl : ''; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function logo() { return marca && marca.logo ? url(marca.logo) : ''; }
  function sloganImg() { return marca && marca.slogan_imagen ? url(marca.slogan_imagen) : ''; }

  // Encabezado y pie: el logo y, a la par, la imagen del slogan (como una sola imagen)
  function aplicar() {
    var lg = logo(), si = sloganImg(), nombre = marca && marca.nombre ? marca.nombre : 'PlusDental';
    document.querySelectorAll('a.marca').forEach(function (a) {
      var img = a.querySelector('.marca-logo'), txt = a.querySelector('.marca-texto'), simg = a.querySelector('.marca-slogan-img');
      if (img) { if (!img.dataset.fijo) img.dataset.fijo = img.getAttribute('src'); img.src = lg || img.dataset.fijo; if (lg) img.alt = nombre; }
      if (si) {
        if (!simg) { simg = document.createElement('img'); simg.className = 'marca-slogan-img'; simg.alt = marca.slogan || ''; img.insertAdjacentElement('afterend', simg); }
        simg.src = si; simg.hidden = false; if (txt) txt.hidden = true;
      } else { if (simg) simg.hidden = true; if (txt) txt.hidden = false; }
    });
    document.querySelectorAll('.pie-marca').forEach(function (p) {
      var img = p.querySelector('.pie-logo img'), fr = p.querySelector('.pie-frase'), simg = p.querySelector('.pie-slogan-img');
      if (img) { if (!img.dataset.fijo) img.dataset.fijo = img.getAttribute('src'); img.src = lg || img.dataset.fijo; }
      if (si) {
        if (!simg) { simg = document.createElement('img'); simg.className = 'pie-slogan-img'; simg.alt = marca.slogan || ''; img.insertAdjacentElement('afterend', simg); }
        simg.src = si; simg.hidden = false; if (fr) fr.hidden = true;
      } else { if (simg) simg.hidden = true; if (fr) fr.hidden = false; }
    });
  }

  async function refrescar() {
    if (!sb) return marca;
    if (cargando) return cargando;
    cargando = (async function () {
      var r = await sb.rpc('marca_localidad');
      if (!r.error) {
        marca = r.data || null;
        try { if (marca) localStorage.setItem(CLAVE, JSON.stringify(marca)); else localStorage.removeItem(CLAVE); } catch (e) { /* sin almacenamiento */ }
        aplicar();
      }
      cargando = null;
      return marca;
    })();
    return cargando;
  }

  // Para las impresiones: logo y, a la par, el slogan (imagen de la localidad o, si no tiene, el texto con el estilo
  // del encabezado de la página). Sin logo de la localidad se usa el logo fijo de Plus Dental.
  var LOGO_FIJO = 'logo-plusdental-marca.png?v=3', SLOGAN_FIJO = 'La tranquilidad también es parte del tratamiento.';
  function htmlImpresion(alto) {
    var lg = logo() || LOGO_FIJO, si = sloganImg(), h = alto || 64, nombre = marca && marca.nombre ? marca.nombre : 'Plus Dental';
    var slogan = si ? '<img src="' + esc(si) + '" alt="' + esc(marca.slogan || '') + '" style="height:' + Math.round(h * 0.78) + 'px;width:auto">'
      : '<div style="border-left:2px solid #188EC0;padding-left:10px;max-width:230px"><span style="display:block;font-family:Manrope,system-ui,sans-serif;font-size:9px;font-weight:700;letter-spacing:.22em;color:#188EC0;margin-bottom:3px">ODONTOLOGÍA INTEGRAL</span>' +
        '<span style="font-family:\'Playfair Display\',Georgia,serif;font-style:italic;font-weight:600;font-size:' + Math.max(12, Math.round(h * 0.24)) + 'px;line-height:1.3;color:#0B2B40">' + esc((marca && marca.slogan) || SLOGAN_FIJO) + '</span></div>';
    return '<div style="display:flex;align-items:center;gap:12px"><img src="' + esc(lg) + '" alt="' + esc(nombre) + '" style="height:' + h + 'px;width:auto">' + slogan + '</div>';
  }

  window.PD_MARCA = { refrescar: refrescar, aplicar: aplicar, htmlImpresion: htmlImpresion, actual: function () { return marca; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar); else aplicar();
  refrescar();
  // Al iniciar o cerrar sesión cambia la localidad (la del usuario o la de la página web)
  if (sb) sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') setTimeout(refrescar, 0);
  });
})();
