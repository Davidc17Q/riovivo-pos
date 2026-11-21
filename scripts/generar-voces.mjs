// Genera con ElevenLabs los avisos de voz del POS ("Nuevo pedido, Mesa 3", "Nueva comanda…")
// y los guarda en public/voz/ junto con un manifiesto. Se corre una vez (o al cambiar de voz):
//   npm run voces              → genera solo los audios que faltan
//   npm run voces -- --todo    → vuelve a generarlos todos (por ejemplo, con otra voz)
// Necesita en el .env: ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID. La llave nunca sale de este
// computador: el POS en producción solo sirve los .mp3 ya generados.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch { /* sin .env: se usan las variables del entorno */ }

const LLAVE = process.env.ELEVENLABS_API_KEY;
const VOZ = process.env.ELEVENLABS_VOICE_ID;
const MODELO = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
const MESAS = Number(process.env.VOZ_MESAS ?? 20);
// Nombres que no son números: "Cabaña 1,Cabaña 2,Terraza" (separados por coma).
const EXTRA = (process.env.VOZ_NOMBRES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TODO = process.argv.includes('--todo');

if (!LLAVE || !VOZ) {
  console.error('Faltan ELEVENLABS_API_KEY y/o ELEVENLABS_VOICE_ID en el archivo .env');
  process.exit(1);
}

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'voz');
// Mismo criterio que usa el navegador para encontrar el audio (ver claveVoz en common.js).
const slug = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const lugares = [...Array.from({ length: MESAS }, (_, i) => `Mesa ${i + 1}`), ...EXTRA];
const frases = {
  'nuevo-pedido': 'Nuevo pedido.',
  'pedidos-nuevos': 'Tienes pedidos nuevos.',
  'nueva-comanda': 'Nueva comanda.',
  'comandas-nuevas': 'Hay comandas nuevas.',
};
for (const l of lugares) {
  frases[`pedido-${slug(l)}`] = `Nuevo pedido, ${l}.`;
  frases[`comanda-${slug(l)}`] = `Nueva comanda, ${l}.`;
}

const existe = (f) => access(f).then(() => true, () => false);

async function generar(texto) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': LLAVE, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: texto,
      model_id: MODELO,
      // Sin voice_settings: la voz suena tal como está configurada en ElevenLabs.
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

await mkdir(DIR, { recursive: true });
let hechos = 0, saltados = 0;
for (const [clave, texto] of Object.entries(frases)) {
  const archivo = path.join(DIR, `${clave}.mp3`);
  if (!TODO && (await existe(archivo))) { saltados++; continue; }
  try {
    await writeFile(archivo, await generar(texto));
    hechos++;
    console.log(`OK    ${clave}.mp3  «${texto}»`);
  } catch (e) {
    console.error(`FALLA ${clave}: ${e.message}`);
    process.exit(1);
  }
}

// El manifiesto le dice al navegador qué audios hay (los que falten usan la voz del sistema).
const manifiesto = path.join(DIR, 'manifiesto.json');
const previas = (await existe(manifiesto)) ? JSON.parse(await readFile(manifiesto, 'utf8')).claves ?? [] : [];
const claves = [...new Set([...previas, ...Object.keys(frases)])].sort();
await writeFile(manifiesto, JSON.stringify({ voz: VOZ, modelo: MODELO, claves }, null, 2) + '\n');
console.log(`\nListo: ${hechos} generados, ${saltados} ya existían. ${claves.length} audios en public/voz/.`);
