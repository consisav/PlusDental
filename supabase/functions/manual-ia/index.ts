// Plus Dental — Manual del CRM con IA (Supabase Edge Function)
// La usa el personal desde el panel > Manual. Recibe la estructura real de una pantalla (títulos, campos, botones,
// columnas) y ejemplos de los datos que hay en ella, y devuelve el capítulo del manual paso a paso.
// Variables (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  clave de API de Anthropic (la misma de receta-ia)
// SUPABASE_URL y SUPABASE_ANON_KEY las pone Supabase automáticamente.
// La función comprueba ella misma que quien llama sea del personal (sesión iniciada + es_personal).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(datos: unknown, estado = 200) {
  return new Response(JSON.stringify(datos), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function texto(v: unknown, max = 1500) { return String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max); }

const ESQUEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'Para qué sirve la pantalla y quién la usa, en dos o tres oraciones' },
    pasos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Acción del paso, verbo primero, p. ej. «Registrar un odontólogo»' },
          detalle: { type: 'string', description: 'Qué hacer, nombrando los campos y botones exactamente como aparecen en la pantalla' },
          ejemplo: { type: 'string', description: 'Ejemplo concreto con los datos reales de la clínica que se recibieron; vacío si no aplica' }
        },
        required: ['titulo', 'detalle', 'ejemplo'],
        additionalProperties: false
      }
    },
    consejos: { type: 'array', items: { type: 'string' }, description: 'Buenas prácticas, validaciones y errores comunes' }
  },
  required: ['resumen', 'pasos', 'consejos'],
  additionalProperties: false
};

const SISTEMA = `Redactas el manual de usuario del CRM de Plus Dental, una clínica odontológica de Ciudad de Guatemala.
Cada capítulo explica una pantalla del panel de la clínica al personal (recepción, odontólogos, administración).
- Usa SOLO lo que existe en la estructura recibida: nombra campos, botones, columnas y opciones exactamente como aparecen. No inventes funciones.
- Ordena los pasos como se usan en la práctica: entrar a la pantalla (menú › opción), consultar, crear, editar, imprimir, etc.
- En cada paso da un ejemplo concreto con los datos reales recibidos (nombres de odontólogos, salas, precios en quetzales, productos…).
- Privacidad: los datos de pacientes van abreviados (nombre e inicial del apellido, p. ej. «María G.») y nunca escribas teléfonos, correos, DPI ni NIT de pacientes.
- Escribe en español claro, en segunda persona (tú), sin tecnicismos de programación. Entre 4 y 10 pasos.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  // Solo el personal de la clínica
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const permiso = await sb.rpc('es_personal');
  if (permiso.error || permiso.data !== true) return json({ error: 'permiso' }, 403);

  let c: Record<string, unknown> = {};
  try { c = (await req.json()) ?? {}; } catch { return json({ error: 'datos' }, 400); }
  if (!texto(c.pantalla, 200) || !texto(c.estructura)) return json({ error: 'datos' }, 400);

  const clave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!clave) return json({ error: 'sin_clave' }, 503);
  const client = new Anthropic({ apiKey: clave });

  const caso = [
    `Menú: ${texto(c.ruta, 300)}`,
    `Pantalla: ${texto(c.pantalla, 200)}`,
    `Estructura de la pantalla:\n${texto(c.estructura, 9000)}`,
    `Datos que hay actualmente en la pantalla (ejemplos reales):\n${texto(c.ejemplos, 5000) || 'sin datos cargados'}`
  ].join('\n\n');

  try {
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SISTEMA,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: 'Escribe el capítulo del manual para esta pantalla:\n\n' + caso }]
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (r.stop_reason === 'refusal') return json({ error: 'rechazo' }, 422);
    if (r.stop_reason === 'max_tokens') return json({ error: 'incompleta' }, 502);
    const salida = r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    return json(JSON.parse(salida));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'ocupado' }, 429);
    if (err instanceof Anthropic.APIError) { console.error('Anthropic', err.status, err.message); return json({ error: 'ia' }, 502); }
    console.error(err);
    return json({ error: 'ia' }, 502);
  }
});
