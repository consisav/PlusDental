// Plus Dental — Enviar una orden de compra al proveedor por correo, con el PDF adjunto (Supabase Edge Function)
// La usa el personal desde Inventarios › Órdenes de compra › «Enviar correo». El PDF lo arma la página y llega en base64.
// El destinatario NO viene de la página: es el correo registrado en la ficha del proveedor de esa orden.
// Variables (Supabase → Edge Functions → Secrets), las mismas de los recordatorios:
//   BREVO_API_KEY     clave de API de Brevo (app.brevo.com → SMTP y API → Claves API)
//   CORREO_REMITENTE  correo remitente verificado en Brevo
// SUPABASE_URL y SUPABASE_ANON_KEY las pone Supabase automáticamente.
// Quien llama debe ser del personal y ver la orden (la lectura pasa por las reglas de seguridad de Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(datos: unknown, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function esc(t: unknown) { return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function num(n: unknown, d = 2) { return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fecha(f: string) { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  // Solo el personal de la clínica
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const permiso = await sb.rpc('es_personal');
  if (permiso.error || permiso.data !== true) return json({ error: 'permiso' }, 403);

  let d: Record<string, unknown> = {};
  try { d = await req.json(); } catch { return json({ error: 'datos' }, 400); }
  const ordenId = Number(d.orden_id);
  const pdf = String(d.pdf ?? '').replace(/^data:application\/pdf;base64,/, '');
  const archivo = String(d.archivo ?? 'orden-de-compra.pdf').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'orden-de-compra.pdf';
  if (!ordenId) return json({ error: 'datos' }, 400);
  if (!d.prueba && (!pdf || pdf.length > 6_000_000 || !/^[A-Za-z0-9+/=]+$/.test(pdf))) return json({ error: 'pdf' }, 400);

  // La orden y su proveedor, con los permisos de quien llama (sede y personal)
  const { data: o, error } = await sb.from('inv_ordenes_compra')
    .select('id,numero,numero_orden,estado,fecha,total,total_mi,moneda,forma_pago,dias_credito,obs_proveedor,proveedor:inv_proveedores(nombre_comercial,correo,contacto)')
    .eq('id', ordenId).maybeSingle();
  if (error || !o) return json({ error: 'orden' }, 404);
  if (o.estado === 'anulada') return json({ error: 'anulada' }, 409);
  const prov = (o as any).proveedor ?? {};
  const para = String(prov.correo ?? '').split(/[\s,;]+/).find((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (!para) return json({ error: 'sin_correo' }, 422);

  const apiKey = Deno.env.get('BREVO_API_KEY');
  const remitente = Deno.env.get('CORREO_REMITENTE');
  if (d.prueba) return json({ prueba: true, para, configurado: !!(apiKey && remitente) });
  if (!apiKey || !remitente) return json({ error: 'sin_configuracion' }, 503);

  // Quien envía recibe copia y las respuestas del proveedor
  const yo = (await sb.auth.getUser()).data.user;
  const usuario = String(d.usuario ?? '').slice(0, 80);
  const num_orden = o.numero_orden || `folio ${o.numero}`;
  const usd = o.moneda === 'USD';
  const total = usd ? `Total $ ${num(o.total_mi)} (Q ${num(o.total)})` : `Total Q ${num(o.total)}`;
  const pago = o.forma_pago === 'contado' ? 'Contado' : `Crédito a ${o.dias_credito || 0} días`;
  const saludo = `Estimados ${prov.contacto || prov.nombre_comercial || ''}:`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0B2B40;line-height:1.5">
    <p>${esc(saludo)}</p>
    <p>Plus Dental les envía la <b>orden de compra ${esc(num_orden)}</b>${o.estado === 'solicitada' ? ' (solicitud pendiente de autorización)' : ''}. Adjuntamos el PDF con el detalle de los productos.</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr><td style="padding:3px 12px 3px 0;color:#5A6D7A">Fecha</td><td><b>${esc(fecha(o.fecha))}</b></td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#5A6D7A">Forma de pago</td><td><b>${esc(pago)}</b></td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#5A6D7A">Total</td><td><b>${esc(total)}</b></td></tr>
      ${o.obs_proveedor ? `<tr><td style="padding:3px 12px 3px 0;color:#5A6D7A">Observaciones</td><td>${esc(o.obs_proveedor)}</td></tr>` : ''}
    </table>
    <p>Por favor confirmar recepción y fecha de entrega.</p>
    <p>Atentamente,<br>${usuario ? esc(usuario) + ' · ' : ''}Plus Dental</p></div>`;
  const texto = `${saludo}\n\nPlus Dental les envía la orden de compra ${num_orden}. Adjuntamos el PDF con el detalle.\n\nFecha: ${fecha(o.fecha)}\nForma de pago: ${pago}\n${total}\n` +
    (o.obs_proveedor ? `Observaciones: ${o.obs_proveedor}\n` : '') + `\nPor favor confirmar recepción y fecha de entrega.\n\nAtentamente,\n${usuario ? usuario + ' · ' : ''}Plus Dental`;

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Plus Dental', email: remitente },
      to: [{ email: para, name: prov.nombre_comercial || para }],
      ...(yo?.email ? { cc: [{ email: yo.email }], replyTo: { email: yo.email } } : { replyTo: { email: remitente, name: 'Plus Dental' } }),
      subject: `Orden de compra ${num_orden} · Plus Dental`,
      htmlContent: html,
      textContent: texto,
      attachment: [{ content: pdf, name: archivo }]
    })
  });
  if (!r.ok) return json({ error: 'brevo', detalle: `${r.status} ${(await r.text()).slice(0, 300)}` }, 502);
  return json({ enviado: true, para, copia: yo?.email ?? null });
});
