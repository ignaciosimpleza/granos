// api/pizarra.js — Lectura de la serie histórica de Precios de Pizarra (Turso/libSQL por HTTP).
// Uso: /api/pizarra                          -> todas las series
//      /api/pizarra?grano=soja               -> solo soja
//      /api/pizarra?grano=soja&desde=2024-01-01&hasta=2024-12-31
//
// Respuesta: { ok, count, series: { soja:[{fecha,precio}], maiz:[...], ... } }

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const qs = req.query || {};
  const grano = (qs.grano || '').toLowerCase();
  const desde = qs.desde;
  const hasta = qs.hasta;

  try {
    let sql = 'SELECT fecha, grano, precio FROM pizarra';
    const where = [];
    const args = [];
    if (grano) { where.push('grano = ?'); args.push(grano); }
    if (desde) { where.push('fecha >= ?'); args.push(desde); }
    if (hasta) { where.push('fecha <= ?'); args.push(hasta); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY fecha ASC';

    const results = await turso([stmt(sql, args)]);
    const rowsRaw = results[0]?.response?.result?.rows || [];

    const series = {};
    rowsRaw.forEach(row => {
      const fecha  = row[0]?.value;
      const g      = row[1]?.value;
      const precio = Number(row[2]?.value);
      if (!fecha || !g || !Number.isFinite(precio)) return;
      (series[g] || (series[g] = [])).push({ fecha, precio });
    });

    let count = 0;
    Object.values(series).forEach(a => { count += a.length; });

    return res.json({ ok: true, count, series });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, series: {} });
  }
}
