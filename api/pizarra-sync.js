// api/pizarra-sync.js — Ingesta de Precios de Pizarra (Cámara Arbitral de Cereales · BCR)
// hacia Turso (libSQL) vía API HTTP (sin dependencias).
//
// La página de consultas es server-rendered: los precios vienen en el HTML según
// parámetros de URL. Soporta rango de fechas -> permite backfill histórico.
//   https://www.cac.bcr.com.ar/es/precios-de-pizarra/consultas
//     ?product=<id>&type=pizarra&date_start=YYYY-MM-DD&date_end=YYYY-MM-DD&year=&month=&period=day&op=Filtrar
//
// Protegido por CRON_SECRET (header Authorization: Bearer <secret> que envía Vercel Cron,
// o ?secret=<secret> para disparo manual).
//
// Uso:
//   /api/pizarra-sync?secret=XXX                      -> sincroniza últimos ~10 días
//   /api/pizarra-sync?secret=XXX&from=2015-01-01&to=2026-06-03  -> backfill de un rango
//   /api/pizarra-sync?secret=XXX&debug=1              -> agrega productos detectados + muestra de filas

export const maxDuration = 60;

const BASE = 'https://www.cac.bcr.com.ar/es/precios-de-pizarra/consultas';

// Granos objetivo. 'id' es fallback por si falla el autodescubrimiento del <select>.
// 're' se evalúa sobre la etiqueta normalizada (minúsculas, sin acentos).
const GRAINS = [
  { key: 'soja',    re: /^soja$/,   id: 13 },
  { key: 'maiz',    re: /^maiz/,    id: null },
  { key: 'trigo',   re: /^trigo/,   id: null },
  { key: 'girasol', re: /girasol/,  id: null },
  { key: 'sorgo',   re: /sorgo/,    id: null },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9',
  'Referer': 'https://www.cac.bcr.com.ar/',
};

// ── Turso (libSQL) por HTTP ────────────────────────────────────────
function tursoArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  return { type: 'text', value: String(v) };
}
function stmt(sql, args) { return { sql, args: (args || []).map(tursoArg) }; }

async function turso(statements) {
  let base = (process.env.TURSO_DATABASE_URL || '').trim()
    .replace(/^libsql:\/\//, 'https://')
    .replace(/\/+$/, '');
  if (!base || !process.env.TURSO_AUTH_TOKEN) throw new Error('Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');

  const requests = statements.map(s => ({ type: 'execute', stmt: typeof s === 'string' ? { sql: s } : s }));
  requests.push({ type: 'close' });

  const res = await fetch(base + '/v2/pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.TURSO_AUTH_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error('Turso HTTP ' + res.status + ' · ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  (json.results || []).forEach(r => {
    if (r.type === 'error') throw new Error('Turso: ' + (r.error?.message || 'error'));
  });
  return json.results;
}

// ── Helpers de parseo ──────────────────────────────────────────────
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function parseAR(s) {
  const m = String(s).replace(/[^\d.,]/g, '');
  if (!m) return NaN;
  const n = m.includes(',') ? m.replace(/\./g, '').replace(',', '.') : m.replace(/\.(?=\d{3}(\D|$))/g, '');
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : NaN;
}
function toISO(dmy) {
  const m = String(dmy).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Descubre IDs de producto desde cualquier <option value="N">Label</option> de la página.
function discoverProducts(html) {
  const map = {};
  const re = /<option[^>]*value=["'](\d+)["'][^>]*>([^<]+)<\/option>/gi;
  let m;
  while ((m = re.exec(html)) !== null) map[+m[1]] = stripTags(m[2]);
  return map;
}
function resolveIds(prodMap) {
  const ids = {};
  for (const g of GRAINS) {
    let found = null;
    for (const [id, label] of Object.entries(prodMap)) {
      if (g.re.test(norm(label))) { found = +id; break; }
    }
    ids[g.key] = found ?? g.id ?? null;
  }
  return ids;
}

// Extrae [{fecha:'YYYY-MM-DD', precio:Number}] de la tabla de la página.
function parseTable(html) {
  const out = [];
  const seen = new Set();
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [];
    const cRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cRe.exec(m[0])) !== null) cells.push(stripTags(c[1]));
    const dateCell = cells.find(x => /^\d{2}\/\d{2}\/\d{4}$/.test(x));
    if (!dateCell) continue;
    const priceCell = cells.find(x => x !== dateCell && parseAR(x) > 0);
    if (!priceCell) continue;
    const fecha = toISO(dateCell);
    const precio = parseAR(priceCell);
    if (fecha && Number.isFinite(precio) && precio > 0 && !seen.has(fecha)) {
      seen.add(fecha);
      out.push({ fecha, precio });
    }
  }
  return out;
}

// ── Fechas ─────────────────────────────────────────────────────────
function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

function pageUrl(id, from, to) {
  return `${BASE}?product=${id}&type=pizarra&date_start=${from}&date_end=${to}&year=&month=&period=day&op=Filtrar`;
}

// ── Handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const qs = req.query || {};
  const authorized = secret && (auth === `Bearer ${secret}` || qs.secret === secret);
  if (!authorized) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const debug = qs.debug;
  const to = qs.to || isoToday();
  const from = qs.from || isoDaysAgo(10);

  try {
    await turso(['CREATE TABLE IF NOT EXISTS pizarra (fecha TEXT NOT NULL, grano TEXT NOT NULL, precio REAL NOT NULL, PRIMARY KEY (fecha, grano))']);

    // Una sola request a Soja (id 13) nos da el <select> para descubrir + la tabla de Soja.
    const firstUrl = pageUrl(13, from, to);
    const firstRes = await fetch(firstUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!firstRes.ok) throw new Error(`BCR HTTP ${firstRes.status}`);
    const firstHtml = await firstRes.text();

    const prodMap = discoverProducts(firstHtml);
    const ids = resolveIds(prodMap);

    const summary = {};
    const sample = {};
    for (const g of GRAINS) {
      const id = ids[g.key];
      if (!id) { summary[g.key] = 'sin id'; continue; }
      let html = firstHtml;
      if (id !== 13) {
        const r = await fetch(pageUrl(id, from, to), { headers: HEADERS, signal: AbortSignal.timeout(15000) });
        if (!r.ok) { summary[g.key] = `HTTP ${r.status}`; continue; }
        html = await r.text();
      }
      const rows = parseTable(html);
      if (debug) sample[g.key] = rows.slice(0, 5);

      let n = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200).map(r => stmt(
          'INSERT INTO pizarra (fecha, grano, precio) VALUES (?, ?, ?) ON CONFLICT(fecha, grano) DO UPDATE SET precio = excluded.precio',
          [r.fecha, g.key, r.precio],
        ));
        if (batch.length) { await turso(batch); n += batch.length; }
      }
      summary[g.key] = n;
    }

    const out = { ok: true, from, to, ids, summary };
    if (debug) { out.products = prodMap; out.sample = sample; }
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
