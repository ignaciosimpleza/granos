// api/ai.js — Proxy seguro a Anthropic Messages API
// Lee ANTHROPIC_API_KEY desde Vercel env vars (jamás del cliente).
//
// POST /api/ai
// body: { prompt: string, system?: string, max_tokens?: number, model?: string }

const DEFAULT_MODEL      = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_VERSION  = '2023-06-01';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Falta env var ANTHROPIC_API_KEY en Vercel',
    });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const prompt     = String(body.prompt || '').trim();
  const system     = body.system ? String(body.system) : undefined;
  const maxTokens  = Number.isFinite(body.max_tokens) ? body.max_tokens : DEFAULT_MAX_TOKENS;
  const model      = body.model || DEFAULT_MODEL;

  if (!prompt) {
    return res.status(400).json({ error: 'Falta "prompt"' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(r.status).json({
        error: 'Anthropic API error',
        status: r.status,
        detail: data,
      });
    }

    const text = data?.content?.[0]?.text || '';
    return res.status(200).json({
      text,
      usage: data?.usage,
      model: data?.model,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
