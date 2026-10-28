// ai-chain.test.js — the AI provider chain, in the browser (ai.js) and in the Worker.
// Plain Node, no dependencies, offline: fetch is replaced and the real files are loaded.
//   node tests/ai-chain.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AI_SRC = fs.readFileSync(path.join(ROOT, 'ai.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = text => ({ choices: [{ message: { content: text } }] });

// Load ai.js into a fresh browser-like context with the given config.js values and fetch.
function loadAi(config, fetchImpl) {
  const ctx = vm.createContext(Object.assign({
    fetch: fetchImpl, Response, AbortController, DOMException, setTimeout, clearTimeout, console, JSON, Promise,
  }, config));
  vm.runInContext(AI_SRC, ctx, { filename: 'ai.js' });
  return ctx;
}
function recorder(plan) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const call = { url: String(url), body, headers: (opts && opts.headers) || {} };
    calls.push(call);
    return plan(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}
const KEYS = { GROQ_KEY: 'gq', GEMINI_KEY: 'gm' };

(async () => {
  console.log('— ai.js, direct to the providers —');
  {
    const ai = loadAi(Object.assign({}, KEYS), async () => json(200, answer('x')));
    const models = ai.AI_PROVIDERS.map(p => p.model);
    ok('no Cerebras in the chain', !ai.AI_PROVIDERS.some(p => /cerebras/.test(p.url)), models.join(','));
    ok('the fast chain is 20b, 120b, flash-lite, flash',
      ai.aiChain(false).map(p => p.model).join(',') === 'openai/gpt-oss-20b,openai/gpt-oss-120b,gemini-2.5-flash-lite,gemini-2.5-flash',
      ai.aiChain(false).map(p => p.model).join(','));
    ok('the strong chain leads with 120b', ai.aiChain(true)[0].model === 'openai/gpt-oss-120b', ai.aiChain(true)[0].model);
    ok('no retired model is named', !models.some(m => /llama|kimi|gemma|qwen-3-235b|gemini-(1\.|2\.0)/.test(m)), models.join(','));
  }
  {
    const r = recorder(() => json(200, answer('ok')));
    const ai = loadAi(Object.assign({}, KEYS), r.fetchImpl);
    const gemini = ai.AI_PROVIDERS.find(p => p.model === 'gemini-2.5-flash');
    const groq = ai.AI_PROVIDERS.find(p => p.model === 'openai/gpt-oss-20b');
    const xg = ai.aiReasonerExtras(gemini, { max_tokens: 90 });
    const xq = ai.aiReasonerExtras(groq, { max_tokens: 90 });
    ok('Gemini flash is told not to think (90 tokens came back as 2 characters)', xg && xg.reasoning_effort === 'none', JSON.stringify(xg));
    ok('Groq gpt-oss keeps effort low and a 500-token floor', xq && xq.reasoning_effort === 'low' && xq.max_tokens === 500, JSON.stringify(xq));
  }
  {
    // The first model answers 200 with nothing: the next one is asked, and its answer returned.
    const r = recorder((c, i) => json(200, answer(i === 0 ? '' : 'përgjigje')));
    const ai = loadAi(Object.assign({}, KEYS), r.fetchImpl);
    const res = await ai.aiFetch({ body: JSON.stringify({ max_tokens: 90, messages: [{ role: 'user', content: 'x' }] }) });
    const d = await res.json();
    ok('an empty answer is walked past', r.calls.length === 2 && d.choices[0].message.content === 'përgjigje', r.calls.length + ' calls');
  }
  {
    // A 429, then errors: the 429 is what the caller reads ("try again shortly"), not the last error.
    const r = recorder((c, i) => (i === 0 ? json(429, { error: { message: 'rate limit' } }) : json(500, { error: { message: 'boom' } })));
    const ai = loadAi(Object.assign({}, KEYS), r.fetchImpl);
    const res = await ai.aiFetch({ body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
    ok('when nothing answers, the 429 is reported, not the last error', res.status === 429 && r.calls.length === 4, res.status + ' after ' + r.calls.length);
  }
  {
    // The web search: flash busy (503) falls to flash-lite, with thinking off.
    const r = recorder((c, i) => (i === 0 ? json(503, { error: { message: 'high demand' } })
      : json(200, { candidates: [{ content: { parts: [{ text: 'afati 15 ditë' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://qbz.gov.al', title: 'QBZ' } }] } }] })));
    const ai = loadAi(Object.assign({}, KEYS), r.fetchImpl);
    const g = await ai.aiGroundedSearch('afati i ankimit');
    ok('a busy flash falls to flash-lite for the web search', r.calls.length === 2 && /gemini-2\.5-flash-lite/.test(r.calls[1].url) && g.sources.length === 1,
      r.calls.map(c => c.url.split('/models/')[1]).join(' | '));
    ok('the web search asks for no thinking', r.calls.every(c => c.body.generationConfig.thinkingConfig.thinkingBudget === 0));
  }

  console.log('— ai.js, through the Worker (AI_PROXY set) —');
  {
    const r = recorder(c => (/\/ground$/.test(c.url)
      ? json(200, { candidates: [{ content: { parts: [{ text: 't' }] } }] })
      : /\/embed$/.test(c.url) ? json(200, { data: [{ index: 0, embedding: [1, 2] }] }) : json(200, answer('nga workeri'))));
    // Keys present on purpose: with AI_PROXY set they must never be used or sent.
    const ai = loadAi(Object.assign({ AI_PROXY: 'https://jur-ai.example.workers.dev/' }, KEYS), r.fetchImpl);
    ok('aiReady is true with a Worker and no key needed', ai.aiReady());
    await ai.aiFetch({ body: JSON.stringify({ model: 'old', messages: [{ role: 'user', content: 'x' }] }) });
    await ai.aiFetch({ body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) }, true);
    await ai.aiEmbed(['a']);
    await ai.aiGroundedSearch('q');
    const urls = r.calls.map(c => c.url);
    ok('every call goes to the Worker, never to a provider', urls.every(u => u.startsWith('https://jur-ai.example.workers.dev/')), urls.join(' | '));
    ok('a strong call says so in the query string', urls[1] === 'https://jur-ai.example.workers.dev/chat?strong=1', urls[1]);
    ok('no key and no model leave the browser', r.calls.every(c => !c.headers.Authorization && !c.body.model && !JSON.stringify(c).includes('gq')),
      JSON.stringify(r.calls[0]));
  }

  console.log('— the Worker —');
  {
    const src = fs.readFileSync(path.join(ROOT, 'cloudflare-worker', 'worker.js'), 'utf8');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    const worker = mod.default;
    const env = { GROQ_KEY: 'gq', GEMINI_KEY: 'gm', ALLOWED_ORIGIN: 'https://jur.example' };
    const realFetch = globalThis.fetch;
    const calls = [];
    const post = (p, body, origin = 'https://jur.example') => worker.fetch(new Request('https://w.example' + p,
      { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
    try {
      let plan = () => json(200, answer('ok'));
      globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return plan(calls.length - 1); };

      ok('the Worker names no Cerebras endpoint', !/api\.cerebras\.ai/.test(src));
      calls.length = 0; plan = i => json(200, answer(i === 0 ? '' : 'dy'));
      let res = await post('/chat', { messages: [{ role: 'user', content: 'x' }] });
      ok('the Worker walks past an empty answer', (await res.json()).choices[0].message.content === 'dy' && calls.length === 2);
      calls.length = 0; plan = () => json(200, answer('ok'));
      await post('/chat?strong=1', { messages: [{ role: 'user', content: 'x' }] });
      ok('the Worker reads strong from the query string', calls[0].body.model === 'openai/gpt-oss-120b', calls[0].body.model);
      calls.length = 0; plan = i => (i === 0 ? json(429, { error: { message: 'rl' } }) : json(503, { error: { message: 'busy' } }));
      res = await post('/chat', { messages: [{ role: 'user', content: 'x' }] });
      ok('the Worker reports the 429 when nothing answers', res.status === 429, String(res.status));
      // Both Groq models fail, so the third call is Gemini flash-lite, which must not be asked to think.
      calls.length = 0; plan = i => (i < 2 ? json(500, {}) : json(200, answer('g')));
      await post('/chat', { max_tokens: 90, messages: [{ role: 'user', content: 'x' }] });
      ok('a Gemini call from the Worker is told not to think',
        calls[2] && /generativelanguage/.test(calls[2].url) && calls[2].body.reasoning_effort === 'none',
        calls[2] && (calls[2].url + ' ' + JSON.stringify(calls[2].body)));
      const pre = await worker.fetch(new Request('https://w.example/chat', { method: 'OPTIONS', headers: { Origin: 'https://jur.example' } }), env);
      ok('the Worker allows the Authorization header mjete-ai.js sends', /Authorization/.test(pre.headers.get('Access-Control-Allow-Headers') || ''));
      res = await post('/chat', { messages: [] }, 'https://evil.example');
      ok('another origin is refused', res.status === 403, String(res.status));
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
