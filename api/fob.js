// api/fob.js — Proxy para FOB Oficiales MAGYP
// Subir a: /api/fob.js en tu proyecto Vercel
// Uso: /api/fob?fecha=DD/MM/AAAA

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { fecha } = req.query;

  if (!fecha) {
    return res.status(400).json({ error: 'Parámetro "fecha" requerido (DD/MM/AAAA)', posts: [] });
  }

  const url = `https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/ws/ssma/precios_fob.php?Fecha=${encodeURIComponent(fecha)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-AR,es;q=0.9',
        'Referer': 'https://www.magyp.gob.ar/',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `MAGYP HTTP ${response.status}`,
        posts: []
      });
    }

    // Intentar parsear JSON; si falla, devolver texto para debug
    const text = await response.text();

    try {
      const data = JSON.parse(text);
      // Normalizar: siempre devolver { posts: [...] }
      if (Array.isArray(data)) return res.json({ posts: data });
      if (data.posts) return res.json(data);
      return res.json({ posts: [], raw_keys: Object.keys(data) });
    } catch {
      // No es JSON válido
      return res.json({
        posts: [],
        parse_error: true,
        raw_preview: text.substring(0, 300)
      });
    }

  } catch (err) {
    res.status(500).json({ error: err.message, posts: [] });
  }
}
