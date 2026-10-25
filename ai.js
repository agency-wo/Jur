// ai.js — multi-provider fallback for the AI calls.
//
// Tries each provider whose key is configured, in order, so the app keeps working when
// one key expires or is rate-limited. All providers below use the OpenAI-compatible
// chat-completions API, so the exact same request/response code works across them.
//
// To add or swap a provider: add its key in config.js (and deploy.yml secrets), then add
// one add(...) line below with the provider's endpoint URL and model id. Order = priority.
'use strict';

var AI_PROVIDERS = [];
(function () {
  function add(key, url, model, strong) {
    if (key && String(key).indexOf('YOUR_') !== 0) AI_PROVIDERS.push({ url: url, key: key, model: model, strong: !!strong });
  }
  // Fast default chain (used for the bulk of calls):
  // 2026-10-25: was llama-3.3-70b-versatile. Groq retired it along with
  // llama-3.1-8b-instant, gemma2-9b-it and kimi-k2; asking the key directly, it
  // can list exactly four chat models and gpt-oss is the usable pair. See the
  // REASONING note below — the replacements think before they answer.
  add(typeof GROQ_KEY       !== 'undefined' ? GROQ_KEY       : '', 'https://api.groq.com/openai/v1/chat/completions',   'openai/gpt-oss-20b');
  add(typeof CEREBRAS_KEY   !== 'undefined' ? CEREBRAS_KEY   : '', 'https://api.cerebras.ai/v1/chat/completions',       'gpt-oss-120b');
  add(typeof GEMINI_KEY     !== 'undefined' ? GEMINI_KEY     : '', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-2.5-flash');
  // Stronger reasoners for the critical calls — reuse the EXISTING free Groq/Cerebras keys (no new key, CORS-OK).
  // If a model id is ever retired, the call just falls back to the fast chain. To swap, edit the model id here.
  // 2026-10-25: was moonshotai/kimi-k2-instruct, which Groq no longer serves.
  add(typeof GROQ_KEY       !== 'undefined' ? GROQ_KEY       : '', 'https://api.groq.com/openai/v1/chat/completions',   'openai/gpt-oss-120b',             true);
  add(typeof CEREBRAS_KEY   !== 'undefined' ? CEREBRAS_KEY   : '', 'https://api.cerebras.ai/v1/chat/completions',       'qwen-3-235b-a22b-instruct-2507',  true);
})();

function aiReady() { return AI_PROVIDERS.length > 0; }
// Provider order for a given call: when `strong`, try the strong reasoners first, then the fast chain.
function aiChain(strong) {
  if (!strong) return AI_PROVIDERS;
  var s = AI_PROVIDERS.filter(function (p) { return p.strong; });
  return s.length ? s.concat(AI_PROVIDERS.filter(function (p) { return !p.strong; })) : AI_PROVIDERS;
}

// Per-provider timeout: a hung provider must advance the fallback chain instead of
// blocking the whole tool until the browser gives up (there was previously NO timeout).
var AI_TIMEOUT_MS = 45000;
// Combine the caller's cancel signal with a per-attempt timeout signal.
function withTimeout(signal, ms) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(new DOMException('timeout', 'TimeoutError')); }, ms);
  function onAbort() { clearTimeout(timer); ctrl.abort(signal.reason); }
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    done: function () { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  };
}

// Drop-in replacement for fetch() to the chat endpoint. Accepts the same options object
// the call sites already build; it ignores the url/headers/model in there and instead
// tries each provider in order, returning the first OK Response (caller still does r.json()).
// REASONING MODELS AND THE TOKEN BUDGET.
//
// Every model Groq still serves free is a reasoning model: it spends tokens
// thinking before it answers, and that thinking is billed against max_tokens.
// Measured against the live API on 2026-10-25, asking gpt-oss the same shape of
// question this file sends:
//
//   budget 260, default effort -> 224 tokens spent thinking, answer TRUNCATED
//   budget 260, effort 'low'   ->  12 tokens spent thinking, answer complete
//   budget  40, effort 'low'   ->  36 tokens spent thinking, answer EMPTY
//
// The floor is 500 because the thinking cost is NOT stable: across runs on the
// same prompt it ranged from 7 to 105 tokens. A multi-sentence answer at a
// 260-token budget came back with finish_reason "length", cut off mid-sentence,
// and 400 was the smallest budget that completed. 500 leaves headroom above the
// worst thinking cost seen.
//
// Raising it is free: max_tokens is a ceiling, not a charge, the model stops when
// it is done (at a 1200 budget it used 79), and the prompts here state their own
// length, so a bigger ceiling does not produce a longer answer. A truncated or
// empty answer, by contrast, costs the user a working feature.
//
// Gated on the Groq host rather than the model id, so a provider that does not
// know these parameters is never sent them.
var AI_REASONER = /gpt-oss|qwen3|deepseek-r1|thinking|reason|-r1\b/i;
var AI_REASONER_MIN_TOKENS = 500;

function aiReasonerExtras(p, payload) {
  if (p.url.indexOf('groq.com') === -1 || !AI_REASONER.test(p.model)) return null;
  var extra = { reasoning_effort: 'low', include_reasoning: false };
  if (!(payload.max_tokens > AI_REASONER_MIN_TOKENS)) extra.max_tokens = AI_REASONER_MIN_TOKENS;
  return extra;
}

function aiFetch(opts, strong) {
  var payload = {};
  try { payload = JSON.parse((opts && opts.body) || '{}'); } catch (e) { payload = {}; }
  delete payload.model;
  var signal = opts && opts.signal;
  var chain = (typeof aiChain === 'function') ? aiChain(strong) : AI_PROVIDERS;  // strong -> prefer strong reasoners
  if (!chain.length) return Promise.reject(new Error('No AI provider key configured'));
  function tryP(i) {
    var p = chain[i];
    var body = JSON.stringify(Object.assign({ model: p.model }, payload, aiReasonerExtras(p, payload)));
    var t = withTimeout(signal, AI_TIMEOUT_MS);
    return fetch(p.url, {
      method: 'POST', signal: t.signal,
      headers: { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) {
      t.done();
      if (res.ok) return res;                                   // success
      if (i + 1 < chain.length) return tryP(i + 1);             // bad key / rate-limit -> next provider
      return res;                                               // last one: let caller read the error
    }).catch(function (err) {
      t.done();
      // user cancel propagates; a timeout only advances the chain
      if (err && err.name === 'AbortError' && !(signal && signal.aborted) && i + 1 < chain.length) return tryP(i + 1);
      if (err && err.name === 'AbortError') throw err;
      if (i + 1 < chain.length) return tryP(i + 1);             // network error -> next provider
      throw err;
    });
  }
  return tryP(0);
}

// Batch embeddings via Gemini (gemini-embedding-001) over the OpenAI-compatible endpoint.
// Returns Promise<number[][]> aligned to `texts`. Used for semantic citation ranking; the
// caller treats any rejection as "skip semantic, keep keyword grounding".
function aiEmbed(texts) {
  var k = (typeof GEMINI_KEY !== 'undefined') ? GEMINI_KEY : '';
  if (!k || String(k).indexOf('YOUR_') === 0) return Promise.reject(new Error('no embed key'));
  var t = withTimeout(undefined, AI_TIMEOUT_MS);
  return fetch('https://generativelanguage.googleapis.com/v1beta/openai/embeddings', {
    method: 'POST', signal: t.signal,
    headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-embedding-001', input: texts })
  }).then(function (r) {
    t.done();
    if (!r.ok) throw new Error('embed HTTP ' + r.status);
    return r.json();
  }, function (e) { t.done(); throw e; }).then(function (d) {
    return (d.data || []).slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); })
      .map(function (x) { return x.embedding; });
  });
}

// Maps an HTTP status (or a network/abort error) to a specific Albanian message.
// Shared by mjete-ai.js and app.js so every AI feature on every page speaks consistently.
function aiErrMsg(status, err){
  if (err && err.name === 'AbortError') return '';
  if (status === 429) return 'Limiti i kërkesave u arrit — provoni sërish pas pak.';
  if (status === 401 || status === 403) return 'Qasja te shërbimi AI u refuzua (çelës i pavlefshëm ose i skaduar).';
  if (status && status >= 500) return 'Shërbimi AI ka një problem të përkohshëm — provoni sërish.';
  if (status && status >= 400) return 'Shërbimi AI s\'u përgjigj siç duhet — provoni sërish.';
  return 'Gabim rrjeti — kontrolloni lidhjen dhe provoni sërish.';
}

// ── Shared Albanian legal-text parsing helpers ──
// Loaded on both mjete-ai.html and every generated law page, so both surfaces can pull
// numbers/deadlines straight from official article text instead of asking the AI for them.

// Albanian numeral words -> integers (covers 1-99, "qind"=100, "mijë"=1000, "milion"=1e6,
// including compounds like "njëzet e pesë" or "dyqind mijë"). Returns null on anything
// it doesn't recognize — callers must treat null as "don't guess a number here".
var SQ_NUM={ 'një':1,'nje':1,'dy':2,'tre':3,'tri':3,'katër':4,'kater':4,'pesë':5,'pese':5,'gjashtë':6,'gjashte':6,'shtatë':7,'shtate':7,'tetë':8,'tete':8,'nëntë':9,'nente':9,'dhjetë':10,'dhjete':10,
  'njëmbëdhjetë':11,'dymbëdhjetë':12,'trembëdhjetë':13,'katërmbëdhjetë':14,'pesëmbëdhjetë':15,'gjashtëmbëdhjetë':16,'shtatëmbëdhjetë':17,'tetëmbëdhjetë':18,'nëntëmbëdhjetë':19,
  'njëzet':20,'njezet':20,'tridhjetë':30,'tridhjete':30,'dyzet':40,'pesëdhjetë':50,'pesedhjete':50,'gjashtëdhjetë':60,'shtatëdhjetë':70,'tetëdhjetë':80,'nëntëdhjetë':90 };
function sqNum(phrase){
  var s=String(phrase||'').toLowerCase().trim();
  if(/^[\d.\s]+$/.test(s)){ var n=parseInt(s.replace(/[.\s]/g,''),10); return isFinite(n)?n:null; }
  var toks=s.split(/[\s-]+/), val=0, cur=0, seen=false;
  for(var i=0;i<toks.length;i++){ var w=toks[i];
    if(!w||w==='e'||w==='dhe') continue;
    if(/^\d+$/.test(w)){ cur+=parseInt(w,10); seen=true; continue; }
    if(w==='qind'||w==='njëqind'||w==='njeqind'){ cur=(cur||1)*100; seen=true; continue; }
    if(w==='mijë'||w==='mije'){ val+=(cur||1)*1000; cur=0; seen=true; continue; }
    if(w==='milion'||w==='milionë'||w==='milione'){ val+=(cur||1)*1000000; cur=0; seen=true; continue; }
    if(SQ_NUM[w]!=null){ cur+=SQ_NUM[w]; seen=true; continue; }
    if(w.length>4&&w.slice(-4)==='qind'&&SQ_NUM[w.slice(0,-4)]!=null){ cur+=SQ_NUM[w.slice(0,-4)]*100; seen=true; continue; }
    return null; // fjalë e panjohur → mos hamendëso numër
  }
  return seen?(val+cur):null;
}

// Extracts confidently-matched deadline phrases ("brenda 30 ditësh", "jo më vonë se
// pesëmbëdhjetë ditë", "afati është 60 ditë") from a plain-text law excerpt. Deadline
// phrasing is far more varied across Albanian law than sentencing phrasing, so this is
// deliberately conservative: only the handful of well-defined patterns below match, and
// an unparsable numeral phrase is skipped rather than guessed. Returns [] when nothing
// matches — callers must treat that as "no deterministic deadline found here", not an error.
function extractDeadlines(text){
  var t=String(text||'').replace(/\s+/g,' '), low=t.toLowerCase(), out=[], seen={}, m;
  var UNIT='(dit[ëe](?:sh)?|jav[ëe](?:sh)?|muaj(?:sh)?|vjet(?:[ëe]sh)?)';
  var PATTERNS=[
    new RegExp('brenda\\s+([^,;.()]{1,30}?)\\s+'+UNIT,'g'),
    new RegExp('jo\\s+m[ëe]\\s+von[ëe]\\s+se\\s+([^,;.()]{1,30}?)\\s+'+UNIT,'g'),
    new RegExp('afati\\s+(?:[ëe]sht[ëe]|prej)\\s+([^,;.()]{1,30}?)\\s+'+UNIT,'g')
  ];
  PATTERNS.forEach(function(re){
    while((m=re.exec(low))!==null){
      var amount=sqNum(m[1]);
      if(amount==null) continue; // fraza numerike s'u kuptua → mos e trego
      var raw=m[2].toLowerCase(), unit=raw.indexOf('dit')===0?'ditë':raw.indexOf('jav')===0?'javë':raw.indexOf('muaj')===0?'muaj':'vjet';
      var quote=t.substr(m.index,m[0].length).trim();
      var key=amount+'|'+unit;
      if(seen[key]) continue; seen[key]=1; // same deadline stated twice in one excerpt → one entry
      out.push({ quote:quote, amount:amount, unit:unit });
    }
  });
  return out;
}

// Web-grounded answer via Gemini's native Google-Search tool: returns { text, sources:[{title,uri}] }.
// Uses the existing Gemini key; rejects (gracefully) when no key / quota / HTTP error.
function aiGroundedSearch(query, signal) {
  var k = (typeof GEMINI_KEY !== 'undefined') ? GEMINI_KEY : '';
  if (!k || String(k).indexOf('YOUR_') === 0) return Promise.reject(new Error('no gemini key'));
  var t = withTimeout(signal, AI_TIMEOUT_MS);
  return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(k), {
    method: 'POST', signal: t.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: String(query || '') }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
    })
  }).then(function (r) { t.done(); if (!r.ok) throw new Error('ground HTTP ' + r.status); return r.json(); }, function (e) { t.done(); throw e; })
    .then(function (d) {
      var cand = d && d.candidates && d.candidates[0];
      var text = ((cand && cand.content && cand.content.parts) || []).map(function (p) { return p.text || ''; }).join(' ').replace(/\s+/g, ' ').trim();
      var sources = [], seen = {};
      var chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
      chunks.forEach(function (c) {
        if (c && c.web && c.web.uri && !seen[c.web.uri]) { seen[c.web.uri] = 1; sources.push({ title: c.web.title || c.web.uri, uri: c.web.uri }); }
      });
      return { text: text, sources: sources };
    });
}
