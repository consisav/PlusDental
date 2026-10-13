// Plus Dental — un solo cliente de Supabase para toda la página (null si config.js no está completo)
(function () {
  var cfg = window.PLUS_DENTAL_CONFIG || {};
  var listo = !!(window.supabase && /^https:\/\//.test(cfg.supabaseUrl || '') && cfg.supabaseKey && cfg.supabaseKey.indexOf('PEGAR') < 0);
  window.PD_SB = listo ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
})();
