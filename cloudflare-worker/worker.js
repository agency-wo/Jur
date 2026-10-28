// Cloudflare Worker — AI key proxy for the Jur app.
//
// Holds GROQ_KEY / GEMINI_KEY as Worker secrets (set via `wrangler secret put`, never committed,
// never shipped to the browser). The client (ai.js) calls THIS worker instead of the providers
// whenever config.js sets AI_PROXY to its URL, so the keys never appear in the page source or the
// Network tab. Without AI_PROXY the client still calls the providers itself, with keys that every
// visitor can read in config.js.
//
// Routes:
//   POST /chat   { strong?: boolean, ...restOfOpenAIChatBody }  → tries the same fallback chain
//                                                                  ai.js runs client-side
//                (also /chat?strong=1, which mjete-ai.js's own request builder uses)
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
      // Authorization too: mjete-ai.js's own builder always sends that header (empty, for the Worker).
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

// Gemini 2.5 flash thinks by default and bills it against max_tokens: at a 90-token budget it
// returned 2 characters (2026-10-28). "none" switches it off; gpt-oss refuses "none". Mirrors ai.js.
const AI_GEMINI_NO_THINKING = /gemini-2\.5-flash/i;

function reasonerExtras(p, payload) {
  if (p.url.includes('generativelanguage.googleapis.com') && AI_GEMINI_NO_THINKING.test(p.model)) {
    return { reasoning_effort: 'none' };
  }
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
  // 2026-10-28: Cerebras removed (402 on every call since August 2026); Gemini
  // 2.5-flash-lite (~800 a day) ahead of 2.5-flash (~20 a day). Mirrors ai.js.
  const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  add(env.GROQ_KEY,   GROQ,   'openai/gpt-oss-20b');
  add(env.GROQ_KEY,   GROQ,   'openai/gpt-oss-120b', true);
  add(env.GEMINI_KEY, GEMINI, 'gemini-2.5-flash-lite');
  add(env.GEMINI_KEY, GEMINI, 'gemini-2.5-flash');
  if (!strong) return chain;
  const strongOnes = chain.filter(p => p.strong);
  return strongOnes.length ? strongOnes.concat(chain.filter(p => !p.strong)) : chain;
}

async function handleChat(request, env) {
  const payload = await request.json();
  const strong = !!payload.strong || new URL(request.url).searchParams.get('strong') === '1';
  delete payload.strong;
  delete payload.model;
  const chain = providerChain(env, strong);
  if (!chain.length) return new Response(JSON.stringify({ error: 'No provider key configured on the Worker' }), { status: 500 });

  // A 200 with empty content is not an answer, so the next provider is asked; and a 429 is
  // kept and reported if nothing else answers, because "try again shortly" is the true message.
  let lastRes = null, limited = null;
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
      if (res.ok) {
        const text = await res.text();
        let content = '';
        try { content = String(JSON.parse(text).choices?.[0]?.message?.content || '').trim(); } catch (_) {}
        const ok = new Response(text, { status: 200 });
        if (content || i + 1 >= chain.length) return ok;
        lastRes = ok;
        continue;
      }
      if (res.status === 429 && !limited) limited = new Response(await res.text(), { status: 429 });
      else lastRes = res;
    } catch (e) {
      t.done();
      lastRes = new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 502 });
    }
  }
  return limited || lastRes;
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
  // Thinking off, and flash-lite behind flash on a 429 or 5xx (flash answered 503 "high demand"
  // on the first try on 2026-10-28; with thinking off both grounded with real sources). Mirrors ai.js.
  const body = JSON.stringify({
    contents: [{ parts: [{ text: String(query || '') }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } }
  });
  let res = null;
  for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(env.GEMINI_KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
  }
  return res;
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
