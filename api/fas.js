// api/fas.js — Proxy para FAS oficial (DINEM / MAGYP)
// Subir a: /api/fas.js en tu proyecto Vercel
// Fuente: https://dinem.magyp.gob.ar/dinem_fas.cfas_all.aspx
// Uso:    /api/fas            -> { ok, fecha, fas:{soja, aceite, ...}, rows:[...] }
//         /api/fas?debug=1    -> agrega html_preview para inspeccionar el HTML crudo
//
// Devuelve el FAS en PESOS ($/tn) por grano. El parser es tolerante: si no logra
// leer la tabla, devuelve fas:{} y el front cae al FAS calculado (no rompe nada).

const SOURCE_URL = 'https://dinem.magyp.gob.ar/dinem_fas.cfas_all.aspx';

// Mapa de etiquetas de DINEM -> clave interna del sitio.
// El orden importa: las variantes (Ac.Soja, Harina) se chequean ANTES que "soja".
const LABEL_MAP = [
  { key: 'aceite',  re: /ac\.?\s*soja|aceite\s*(de\s*)?soja|aceite/i },
  { key: 'harina',  re: /harina|pellet|pellets|expeller/i },
  { key: 'maiz',    re: /ma[ií]z/i },
  { key: 'trigo',   re: /trigo/i },
  { key: 'girasol', re: /girasol/i },
  { key: 'sorgo',   re: /sorgo/i },
  { key: 'cebada',  re: /cebada/i },
  { key: 'soja',    re: /soja|poroto/i }, // catch-all al final
];

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Parsea números en formato argentino: "453.000,50" -> 453000.5 ; "453.000" -> 453000
function parseAR(raw) {
  if (raw == null) return NaN;
  const s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  let n;
  if (s.includes(',')) {
    n = s.replace(/\./g, '').replace(',', '.');           // coma = decimal
  } else {
    n = s.replace(/\.(?=\d{3}(\D|$))/g, '');               // puntos = miles
  }
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : NaN;
}

function getRows(tableHtml) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRe.exec(m[0])) !== null) cells.push(stripTags(c[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function matchProduct(label) {
  for (const { key, re } of LABEL_MAP) if (re.test(label)) return key;
  return null;
}

// Elige, dentro de una fila de producto, la celda que corresponde al FAS en pesos.
// 1) Si detectamos el índice de columna "FAS $" por el header, lo usamos.
// 2) Si no, tomamos el mayor número >= 1000 (los pesos son ~cientos de miles;
//    años/porcentajes/u$s quedan descartados).
function pickFasValue(cells, fasColIdx) {
  if (fasColIdx != null && fasColIdx < cells.length) {
    const v = parseAR(cells[fasColIdx]);
    if (Number.isFinite(v) && v >= 1000) return v;
  }
  let best = NaN;
  for (const cell of cells) {
    const v = parseAR(cell);
    if (Number.isFinite(v) && v >= 1000 && (!Number.isFinite(best) || v > best)) best = v;
  }
  return Number.isFinite(best) ? best : null;
}

// Busca una fila de header que contenga "FAS" y devuelve el índice de columna
// preferentemente marcada con $ / pesos.
function findFasColumn(rows) {
  for (const cells of rows) {
    const idxs = [];
    cells.forEach((c, i) => { if (/fas/i.test(c)) idxs.push(i); });
    if (!idxs.length) continue;
    const pesos = idxs.find(i => /\$|peso/i.test(cells[i]));
    return pesos != null ? pesos : idxs[idxs.length - 1];
  }
  return null;
}

function findFecha(html) {
  // dd/mm/aaaa en cualquier parte del documento
  const m = html.match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const debug = req.query?.debug;

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

    // Elegir la tabla con más coincidencias de productos
    const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
    let bestRows = [], bestScore = -1;
    for (const t of tables) {
      const rows = getRows(t);
      let score = 0;
      for (const cells of rows) if (cells.length && matchProduct(cells.join(' '))) score++;
      if (score > bestScore) { bestScore = score; bestRows = rows; }
    }
    // Si no hubo <table>, intentar sobre todo el documento
    if (!bestRows.length) bestRows = getRows(html);

    const fasColIdx = findFasColumn(bestRows);

    const fas = {};
    const rowsDebug = [];
    for (const cells of bestRows) {
      const label = cells.join(' ');
      const prod = matchProduct(label);
      if (!prod) continue;
      const val = pickFasValue(cells, fasColIdx);
      rowsDebug.push({ prod, label: cells[0] || label, cells, val });
      // Si un mismo producto aparece más de una vez, nos quedamos con el primero
      if (val != null && fas[prod] == null) fas[prod] = val;
    }

    const out = {
      ok: Object.keys(fas).length > 0,
      fecha: findFecha(html),
      fas,
      rows: rowsDebug,
      source: SOURCE_URL,
    };
    if (debug) out.html_preview = html.substring(0, 4000);

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, fas: {} });
  }
}
