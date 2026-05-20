// api/a3-test.js — Endpoint de diagnóstico A3 Mercados (MAE)
// Uso desde el navegador:
//   /api/a3-test                     → forex (UAT)
//   /api/a3-test?endpoint=forex
//   /api/a3-test?endpoint=rentafija
//   /api/a3-test?endpoint=cauciones
//   /api/a3-test?endpoint=repo
//   /api/a3-test?endpoint=reporteresumenfinal&fecha=20/05/2026
//   /api/a3-test?env=prod            → usa producción en vez de UAT

const ALLOWED = {
  forex:                'mercado/cotizaciones/forex',
  rentafija:            'mercado/cotizaciones/rentafija',
  cauciones:            'mercado/cotizaciones/cauciones',
  repo:                 'mercado/cotizaciones/repo',
  reporteresumenfinal:  'mercado/boletin/ReporteResumenFinal',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store');

  const endpoint = (req.query.endpoint || 'forex').toLowerCase();
  const env      = (req.query.env || 'uat').toLowerCase();
  const fecha    = req.query.fecha;

  const path = ALLOWED[endpoint];
  if (!path) {
    return res.status(400).json({
      error: 'endpoint inválido',
      validos: Object.keys(ALLOWED),
    });
  }

  const apiKey = env === 'prod'
    ? process.env.A3_API_KEY_PROD
    : process.env.A3_API_KEY_UAT;

  if (!apiKey) {
    return res.status(500).json({
      error: `Falta env var A3_API_KEY_${env.toUpperCase()} en Vercel`,
    });
  }

  const base = env === 'prod'
    ? 'https://api.mae.com.ar/MarketData/v1'
    : 'https://apiuat.mae.com.ar/MarketData/v1';

  let url = `${base}/${path}`;
  if (endpoint === 'reporteresumenfinal' && fecha) {
    url += `?fecha=${encodeURIComponent(fecha)}`;
  }

  try {
    const r = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Referer': env === 'prod' ? 'https://marketdata.mae.com.ar/' : 'https://marketdata.mae.com.ar/',
        'Origin': 'https://marketdata.mae.com.ar',
      },
    });

    const text = await r.text();
    const ct   = r.headers.get('content-type') || '';

    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    return res.status(200).json({
      meta: {
        endpoint,
        env,
        url,
        http_status: r.status,
        content_type: ct,
        body_length: text.length,
      },
      // Si parsea JSON, devolvemos como objeto; si no, primeros 2000 chars del texto crudo
      body: parsed !== null ? parsed : text.substring(0, 2000),
      parsed_ok: parsed !== null,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'fetch falló',
      message: err.message,
      url,
    });
  }
}
