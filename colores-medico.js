// Plus Dental — Color de cada odontólogo: lo identifica a él, a sus pacientes y a sus citas en la agenda.
// PD_COLOR.cargar() trae id → color; PD_COLOR.punto(id) devuelve un punto de color; PD_COLOR.estilo(id) la variable --med.
// Si la columna «color» aún no existe en Supabase, todo funciona igual, sin colores.
(function () {
  var sb = window.PD_SB || null;
  if (!sb) return;

  // Paleta de colores bien distintos entre sí (y legibles sobre fondo blanco)
  var PALETA = [['#2563EB', 'Azul'], ['#059669', 'Verde'], ['#D97706', 'Ámbar'], ['#DC2626', 'Rojo'], ['#7C3AED', 'Violeta'], ['#DB2777', 'Rosa'],
    ['#0891B2', 'Turquesa'], ['#65A30D', 'Lima'], ['#EA580C', 'Naranja'], ['#4F46E5', 'Índigo'], ['#0D9488', 'Verde azulado'], ['#A16207', 'Mostaza'],
    ['#475569', 'Pizarra'], ['#9F1239', 'Vino'], ['#0369A1', 'Azul océano'], ['#15803D', 'Verde bosque']];
  var colores = {}, nombres = {}, disponible = null, cargando = null;

  function cargar(forzar) {
    if (cargando && !forzar) return cargando;
    cargando = (async function () {
      var r = await sb.from('dentistas').select('id,nombre,color');
      disponible = !r.error;
      colores = {}; nombres = {};
      (r.data || []).forEach(function (d) { if (d.color) colores[d.id] = d.color; nombres[d.id] = d.nombre; });
    })();
    return cargando;
  }
  function color(id) { return id ? colores[id] || null : null; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function punto(id, titulo) {
    var c = color(id);
    return c ? '<span class="med-punto" style="--med:' + c + '" title="' + esc(titulo || nombres[id] || '') + '" aria-hidden="true"></span>' : '';
  }
  function estilo(id) { var c = color(id); return c ? ' style="--med:' + c + '"' : ''; }
  // Odontólogos que usan un color (para avisar si se repite)
  function quienUsa(c, exceptoId) {
    return Object.keys(colores).filter(function (id) { return +id !== exceptoId && String(colores[id]).toUpperCase() === String(c).toUpperCase(); }).map(function (id) { return nombres[id]; });
  }
  function nombrePaleta(c) { var p = PALETA.filter(function (x) { return x[0].toUpperCase() === String(c).toUpperCase(); })[0]; return p ? p[1] : 'Personalizado'; }

  window.PD_COLOR = { PALETA: PALETA, cargar: cargar, color: color, punto: punto, estilo: estilo, quienUsa: quienUsa, nombrePaleta: nombrePaleta,
    disponible: function () { return disponible; }, todos: function () { return Object.keys(colores).map(function (id) { return { id: +id, nombre: nombres[id], color: colores[id] }; }); } };
})();
