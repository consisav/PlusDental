// Plus Dental — Sugerencia de receta con IA (Supabase Edge Function)
// La usa el personal desde Expediente > Recetas. Recibe el diagnóstico, los tratamientos de la fecha y los datos
// clínicos del paciente, y devuelve medicamentos disponibles en Guatemala con dosis, frecuencia y duración.
// Es una SUGERENCIA: el médico la revisa y la ajusta antes de grabar la receta.
// Variables (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  clave de API de Anthropic (console.anthropic.com → API Keys)
// SUPABASE_URL y SUPABASE_ANON_KEY las pone Supabase automáticamente.
// Dejar activado «Verify JWT»: solo usuarios con sesión iniciada (y del personal) pueden usarla.
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
function texto(v: unknown, max = 1500) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }

const ESQUEMA = {
  type: 'object',
  properties: {
    medicamentos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          medicamento: { type: 'string', description: 'Nombre genérico, concentración y presentación, p. ej. «Ibuprofeno 400 mg, tabletas»' },
          dosis: { type: 'string', description: 'Cantidad por toma, p. ej. «1 tableta»' },
          frecuencia: { type: 'string', description: 'p. ej. «Cada 8 horas»' },
          duracion: { type: 'string', description: 'p. ej. «3 días»' }
        },
        required: ['medicamento', 'dosis', 'frecuencia', 'duracion'],
        additionalProperties: false
      }
    },
    indicaciones: { type: 'string', description: 'Indicaciones generales para el paciente, en español sencillo' },
    advertencias: { type: 'array', items: { type: 'string' }, description: 'Alergias, interacciones o precauciones que el médico debe revisar' },
    razonamiento: { type: 'string', description: 'Una o dos oraciones para el médico: por qué se eligieron estos medicamentos' }
  },
  required: ['medicamentos', 'indicaciones', 'advertencias', 'razonamiento'],
  additionalProperties: false
};

const SISTEMA = `Eres un asistente clínico para odontólogos de Plus Dental (Ciudad de Guatemala). Propones una receta odontológica
para que el odontólogo tratante la revise, la ajuste y la firme; él decide la indicación final.
- Usa medicamentos de uso odontológico que se consiguen en farmacias de Guatemala, por nombre genérico con concentración y presentación habituales allí.
- Basa la receta en el diagnóstico y en los tratamientos realizados en la fecha. Si no hace falta medicamento, devuelve la lista vacía y explícalo.
- Respeta las alergias registradas y evita los medicamentos de la misma familia (p. ej. penicilina → ninguna amoxicilina ni amoxicilina con ácido clavulánico).
- Ten en cuenta la edad, las enfermedades y los medicamentos actuales (interacciones, ajustes, AINE en hipertensión, embarazo, anticoagulantes, etc.) y escríbelo en advertencias.
- Antibióticos solo cuando el cuadro lo justifique (infección, absceso, profilaxis indicada); analgésicos por el menor tiempo útil.
- Dosis para adultos salvo que la edad indique un niño; en niños, indica la dosis por kilo en la advertencia si no se conoce el peso.
- Escribe todo en español claro.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  // Solo el personal de la clínica
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const permiso = await sb.rpc('es_personal');
  if (permiso.error || permiso.data !== true) return json({ error: 'permiso' }, 403);

  let c: Record<string, unknown> = {};
  try { c = (await req.json())?.contexto ?? {}; } catch { return json({ error: 'datos' }, 400); }
  if (!texto(c.diagnostico) && !texto(c.tratamientos)) return json({ error: 'sin_diagnostico' }, 400);

  const clave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!clave) return json({ error: 'sin_clave' }, 503);
  const client = new Anthropic({ apiKey: clave });

  const caso = [
    `Fecha de atención: ${texto(c.fecha, 20)}`,
    `Paciente: ${texto(c.edad, 30) || 'edad no registrada'}`,
    `Alergias: ${texto(c.alergias) || 'no registradas'}`,
    `Enfermedades y condiciones: ${texto(c.enfermedades) || 'no registradas'}`,
    `Medicamentos que ya toma: ${texto(c.medicamentos) || 'ninguno registrado'}`,
    `Diagnóstico: ${texto(c.diagnostico, 2000) || 'no indicado'}`,
    `Tratamientos realizados o en proceso en esa fecha: ${texto(c.tratamientos, 2000) || 'ninguno registrado'}`,
    `Cita del día: ${texto(c.cita, 300) || 'sin cita'}`,
    `Hallazgos pendientes en el odontograma: ${texto(c.hallazgos, 1500) || 'sin datos'}`
  ].join('\n');

  try {
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SISTEMA,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: 'Propón la receta para este caso:\n' + caso }]
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
