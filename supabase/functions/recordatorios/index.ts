// Plus Dental — Recordatorios automáticos por correo (Supabase Edge Function)
// Se ejecuta una vez al día (programado con pg_cron) y envía un correo a cada paciente con cita al día siguiente.
// Variables (Supabase → Edge Functions → Secrets):
//   BREVO_API_KEY     clave de API de Brevo
//   CORREO_REMITENTE  correo verificado en Brevo como remitente (ej.: citas@plusdental.com o el Gmail de la clínica)
//   CRON_SECRET       clave privada que debe enviar la tarea programada para poder usar esta función
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las pone Supabase automáticamente.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CLINICA = {
  nombre: 'Plus Dental',
  direccion: 'Reforma Montúfar, zona 10, Ciudad de Guatemala',
  telefono: '+502 3756-5739',
  eslogan: 'La tranquilidad también es parte del tratamiento.'
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function esc(t: unknown) {
  return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
// Fecha de mañana en Guatemala (UTC-6, sin horario de verano)
function mananaGuatemala() {
  const ahora = new Date(Date.now() - 6 * 3600 * 1000);
  ahora.setUTCDate(ahora.getUTCDate() + 1);
  return ahora.toISOString().slice(0, 10);
}
function fechaLarga(f: string) {
  const [a, m, d] = f.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d, 12));
  return `${DIAS[fecha.getUTCDay()]} ${d} de ${MESES[m - 1]}`;
}

function correoHtml(c: any, correoPaciente: string) {
  const fila = (k: string, v: string) => v ? `<tr><td style="padding:6px 0;color:#5A6D7A;width:120px">${k}</td><td style="padding:6px 0;font-weight:600;color:#0B2B40">${esc(v)}</td></tr>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F9FC;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F9FC;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #D9E4EC">
    <tr><td style="padding:24px 28px;border-bottom:2px solid #005A87">
      <div style="font-family:Georgia,serif;font-size:26px;letter-spacing:4px;color:#0B2B40">PLUS DENTAL</div>
      <div style="font-size:11px;letter-spacing:3px;color:#188EC0;font-weight:bold;margin-top:4px">ODONTOLOGÍA INTEGRAL</div>
    </td></tr>
    <tr><td style="padding:24px 28px;color:#0B2B40;font-size:15px;line-height:1.6">
      <p style="margin:0 0 12px">Hola ${esc(c.nombre)}:</p>
      <p style="margin:0 0 16px">Le recordamos su cita de <b>mañana</b> en Plus Dental:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px;border-top:1px solid #D9E4EC;border-bottom:1px solid #D9E4EC;margin-bottom:16px">
        ${fila('Fecha', fechaLarga(c.fecha))}
        ${fila('Hora', String(c.hora).slice(0, 5))}
        ${fila('Tratamiento', c.servicio)}
        ${fila('Dentista', c.dentista?.nombre)}
        ${fila('Sala', c.sala ? `${c.sala.codigo} · ${c.sala.nombre}` : '')}
      </table>
      <p style="margin:0 0 8px"><b>Dirección:</b> ${esc(CLINICA.direccion)}</p>
      <p style="margin:0 0 16px">Si necesita cambiar o cancelar su cita, responda a este correo o comuníquese al <b>${esc(CLINICA.telefono)}</b> (WhatsApp).</p>
      <p style="margin:0;color:#5A6D7A;font-style:italic">${esc(CLINICA.eslogan)}</p>
    </td></tr>
  </table>
  <p style="font-size:12px;color:#94A6B2;margin:14px 0 0">Este recordatorio se envió a ${esc(correoPaciente)} porque tiene una cita registrada en Plus Dental.</p>
  </td></tr></table></body></html>`;
}

function correoTexto(c: any) {
  return `Hola ${c.nombre}:\n\nLe recordamos su cita de mañana en Plus Dental:\n\n` +
    `- Fecha: ${fechaLarga(c.fecha)}\n- Hora: ${String(c.hora).slice(0, 5)}\n- Tratamiento: ${c.servicio}\n` +
    (c.dentista?.nombre ? `- Dentista: ${c.dentista.nombre}\n` : '') +
    (c.sala ? `- Sala: ${c.sala.codigo} · ${c.sala.nombre}\n` : '') +
    `\nDirección: ${CLINICA.direccion}\nSi necesita cambiar o cancelar su cita, comuníquese al ${CLINICA.telefono}.\n\n${CLINICA.nombre} · ${CLINICA.eslogan}`;
}

Deno.serve(async (req) => {
  // Solo la tarea programada (o una prueba manual con la clave) puede usar esta función
  const secreto = Deno.env.get('CRON_SECRET');
  if (!secreto || req.headers.get('x-cron-secret') !== secreto) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const remitente = Deno.env.get('CORREO_REMITENTE');
  if (!apiKey || !remitente) {
    return new Response(JSON.stringify({ error: 'Faltan BREVO_API_KEY o CORREO_REMITENTE en los secretos de la función' }), { status: 500 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const manana = mananaGuatemala();
  const { data: citas, error } = await sb.from('citas')
    .select('id,fecha,hora,servicio,nombre,paciente:pacientes(correo),dentista:dentistas(nombre),sala:posiciones(codigo,nombre)')
    .eq('fecha', manana)
    .in('estado', ['pendiente', 'confirmada'])
    .is('recordatorio_enviado', null);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const resultado = { fecha: manana, citas: citas?.length ?? 0, enviados: 0, sin_correo: 0, fallidos: [] as string[] };
  for (const c of citas ?? []) {
    const correo = (c as any).paciente?.correo;
    if (!correo) { resultado.sin_correo++; continue; }
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        sender: { name: CLINICA.nombre, email: remitente },
        to: [{ email: correo, name: c.nombre }],
        replyTo: { email: remitente, name: CLINICA.nombre },
        subject: `Recordatorio: su cita en Plus Dental mañana a las ${String(c.hora).slice(0, 5)}`,
        htmlContent: correoHtml(c, correo),
        textContent: correoTexto(c)
      })
    });
    if (r.ok) {
      await sb.from('citas').update({ recordatorio_enviado: new Date().toISOString() }).eq('id', c.id);
      resultado.enviados++;
    } else {
      resultado.fallidos.push(`${c.nombre}: ${r.status} ${await r.text()}`);
    }
  }
  return new Response(JSON.stringify(resultado), { headers: { 'Content-Type': 'application/json' } });
});
