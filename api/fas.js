// api/fas.js — Proxy para FAS Teórico oficial (DINEM / MAGYP)
// Subir a: /api/fas.js en tu proyecto Vercel
// Fuente: https://dinem.magyp.gob.ar/dinem_fas.cfas_all.aspx
//
// La página es GeneXus: los datos NO están en una tabla HTML común, sino
// embebidos en un <input hidden> con un JSON posicional:
//   W0031GridContainerDataV  -> pestaña "Der.Export.Completo"  (default)
//   W0039GridContainerDataV  -> pestaña "Der.Export.Reducido"
// Cada fila (ordenadas de más reciente a más vieja):
//   [Fecha, TrigoPan, Maíz, CebadaCerv, CebadaForr, Sorgo, Soja, Girasol, Ac.Soja, Ac.Girasol]
// Los importes son pesos por tonelada (enteros, sin separadores). Ej: "487182" = $487.182/tn.
//
// Uso: /api/fas               -> Completo (default), última fecha disponible
//      /api/fas?tab=reducido  -> Derecho de Exportación Reducido
//      /api/fas?debug=1        -> agrega filas crudas + columnas para inspección

const SOURCE_URL = 'https://dinem.magyp.gob.ar/dinem_fas.cfas_all.aspx';

// Orden FIJO de columnas del grid DINEM -> clave interna del sitio.
// (índice 0 = Fecha). 'harina' no existe en DINEM, por eso el front cae al calculado.
const COL_KEYS = [
  'fecha', 'trigo', 'maiz', 'cebada_c', 'cebada_f',
  'sorgo', 'soja', 'girasol', 'aceite', 'aceite_girasol',
];

// Extrae y parsea el JSON del input hidden GeneXus (W0031 / W0039).
function extractGridData(html, gridId) {
  // El value va entre comillas simples y el JSON solo usa comillas dobles.
  const re = new RegExp(gridId + 'GridContainerDataV"\\s+value=\'([^\']*)\'');
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const reducido = req.query?.tab === 'reducido' || req.query?.tab === 'reduced';
  const gridId   = reducido ? 'W0039' : 'W0031';
  const debug    = req.query?.debug;

  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9',
        'Referer': 'https://dinem.magyp.gob.ar/',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: `DINEM HTTP ${response.status}`, fas: {} });
    }

    const html = await response.text();
    const rows = extractGridData(html, gridId);

    if (!Array.isArray(rows) || rows.length === 0) {
      const out = { ok: false, error: 'No se pudo leer el grid de DINEM', fas: {} };
      if (debug) out.html_preview = html.substring(0, 4000);
      return res.status(200).json(out);
    }

    const latest = rows[0];                 // ordenado DSC por fecha -> el más reciente
    const fecha  = latest[0] || null;

    const fas = {};
    for (let i = 1; i < COL_KEYS.length && i < latest.length; i++) {
      const v = parseInt(String(latest[i]).replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(v) && v > 0) fas[COL_KEYS[i]] = v;   // pesos/tn
    }

    const out = {
      ok:     Object.keys(fas).length > 0,
      tab:    reducido ? 'reducido' : 'completo',
      fecha,
      fas,                                  // {soja, maiz, trigo, girasol, aceite, sorgo, cebada_c, cebada_f, aceite_girasol}
      source: SOURCE_URL,
    };
    if (debug) {
      out.rows    = rows.slice(0, 5);
      out.columns = COL_KEYS;
    }
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, fas: {} });
  }
}
