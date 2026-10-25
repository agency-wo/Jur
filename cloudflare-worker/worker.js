// Cloudflare Worker — AI key proxy for the Jur app.
//
// Holds GROQ_KEY / CEREBRAS_KEY / GEMINI_KEY as Worker secrets (set via `wrangler secret put`,
// never committed, never shipped to the browser). The client (ai.js) calls THIS worker instead
// of the providers directly, so the keys never appear in the page source or Network tab.
//
// Routes:
//   POST /chat   { strong?: boolean, ...restOfOpenAIChatBody }  → tries the same fallback chain
//                                                                  ai.js used to run client-side
//   POST /embed  { input: string[] }                            → Gemini embeddings
//   POST /ground { query: string }                              → Gemini grounded web search
//
// CORS is locked to ALLOWED_ORIGIN (set in wrangler.toml) — any other origin gets 403,
// so this can't be used as an open proxy by other sites.

const FETCH_TIMEOUT_MS = 45000;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const originOk = allowed.includes(origin);
  return {
    headers: {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    },
    ok: originOk
  };
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

// Same provider list/order as ai.js — but the keys live only here.
// Reasoning models bill their thinking against max_tokens. Measured 2026-10-25
// on gpt-oss: a 260-token budget spent 224 of them thinking at the default effort
// and the answer came back truncated; 'low' spent 12. At 40 tokens even 'low'
// returns nothing at all. max_tokens is a ceiling and not a charge, so flooring
// it is free insurance. Gated on the Groq host, so a provider that does not know
// these parameters is never sent them. Mirrors ai.js.
const AI_REASONER = /gpt-oss|qwen3|deepseek-r1|thinking|reason|-r1\b/i;
const AI_REASONER_MIN_TOKENS = 500;

function reasonerExtras(p, payload) {
  if (!p.url.includes('groq.com') || !AI_REASONER.test(p.model)) return null;
  const extra = { reasoning_effort: 'low', include_reasoning: false };
  if (!(payload.max_tokens > AI_REASONER_MIN_TOKENS)) extra.max_tokens = AI_REASONER_MIN_TOKENS;
  return extra;
}

function providerChain(env, strong) {
  const chain = [];
  const add = (key, url, model, isStrong) => { if (key) chain.push({ key, url, model, strong: !!isStrong }); };
  // 2026-10-25: the Groq ids were llama-3.3-70b-versatile and
  // moonshotai/kimi-k2-instruct. Groq no longer serves either; asking the key
  // directly it lists exactly four chat models, of which gpt-oss is the usable
  // pair. Kept identical to ai.js so the browser path and the Worker path cannot
  // answer from different models.
  add(env.GROQ_KEY,     'https://api.groq.com/openai/v1/chat/completions', 'openai/gpt-oss-20b');
  add(env.CEREBRAS_KEY, 'https://api.cerebras.ai/v1/chat/completions',     'gpt-oss-120b');
  add(env.GEMINI_KEY,   'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.5-flash');
  add(env.GROQ_KEY,     'https://api.groq.com/openai/v1/chat/completions', 'openai/gpt-oss-120b', true);
  add(env.CEREBRAS_KEY, 'https://api.cerebras.ai/v1/chat/completions',     'qwen-3-235b-a22b-instruct-2507', true);
  if (!strong) return chain;
  const strongOnes = chain.filter(p => p.strong);
  return strongOnes.length ? strongOnes.concat(chain.filter(p => !p.strong)) : chain;
}

async function handleChat(request, env) {
  const payload = await request.json();
  const strong = !!payload.strong;
  delete payload.strong;
  delete payload.model;
  const chain = providerChain(env, strong);
  if (!chain.length) return new Response(JSON.stringify({ error: 'No provider key configured on the Worker' }), { status: 500 });

  let lastRes = null;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const t = withTimeout(FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(p.url, {
        method: 'POST', signal: t.signal,
        headers: { Authorization: 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ model: p.model }, payload, reasonerExtras(p, payload)))
      });
      t.done();
      if (res.ok) return res;
      lastRes = res;
    } catch (e) {
      t.done();
      lastRes = new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 502 });
    }
  }
  return lastRes;
}

async function handleEmbed(request, env) {
  if (!env.GEMINI_KEY) return new Response(JSON.stringify({ error: 'no embed key' }), { status: 500 });
  const { input } = await request.json();
  return fetch('https://generativelanguage.googleapis.com/v1beta/openai/embeddings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.GEMINI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-embedding-001', input })
  });
}

async function handleGround(request, env) {
  if (!env.GEMINI_KEY) return new Response(JSON.stringify({ error: 'no gemini key' }), { status: 500 });
  const { query } = await request.json();
  return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(env.GEMINI_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: String(query || '') }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
    })
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors.headers });
    if (!cors.ok) return new Response('Forbidden origin', { status: 403, headers: cors.headers });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors.headers });

    const { pathname } = new URL(request.url);
    try {
      let res;
      if (pathname === '/chat') res = await handleChat(request, env);
      else if (pathname === '/embed') res = await handleEmbed(request, env);
      else if (pathname === '/ground') res = await handleGround(request, env);
      else return new Response('Not found', { status: 404, headers: cors.headers });

      const body = await res.text();
      return new Response(body, { status: res.status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors.headers) });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 502, headers: Object.assign({ 'Content-Type': 'application/json' }, cors.headers) });
    }
  }
};
