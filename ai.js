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
// The Cloudflare Worker in cloudflare-worker/ holds the keys as Worker secrets. When config.js names it
// (AI_PROXY), every call goes there and NO key is read from config.js: a key in config.js is a key in
// every visitor's browser, which is how a free quota gets spent by strangers.
var AI_PROXY_URL = (typeof AI_PROXY !== 'undefined' && AI_PROXY && String(AI_PROXY).indexOf('YOUR_') !== 0)
  ? String(AI_PROXY).replace(/\/+$/, '') : '';
(function () {
  function add(key, url, model, strong) {
    if (key && String(key).indexOf('YOUR_') !== 0) AI_PROVIDERS.push({ url: url, key: key, model: model, strong: !!strong });
  }
  if (AI_PROXY_URL) {
    // Two entries so aiChain() keeps its meaning: the Worker runs the real chain, and `strong` rides
    // in the query string because callGroq in mjete-ai.js builds its own body.
    AI_PROVIDERS.push({ url: AI_PROXY_URL + '/chat', key: '', model: '', strong: false, proxy: true });
    AI_PROVIDERS.push({ url: AI_PROXY_URL + '/chat?strong=1', key: '', model: '', strong: true, proxy: true });
    return;
  }
  var GROQ = 'https://api.groq.com/openai/v1/chat/completions';
  var GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  var groqKey = typeof GROQ_KEY !== 'undefined' ? GROQ_KEY : '';
  var geminiKey = typeof GEMINI_KEY !== 'undefined' ? GEMINI_KEY : '';
  // 2026-10-25: was llama-3.3-70b-versatile. Groq retired it along with
  // llama-3.1-8b-instant, gemma2-9b-it and kimi-k2; asking the key directly, it
  // can list exactly four chat models and gpt-oss is the usable pair. See the
  // REASONING note below — the replacements think before they answer.
  //
  // 2026-10-28: Cerebras removed. Its free tier answers 402 "Payment required" to
  // every call since August 2026, and as the LAST entry of the fast chain its 402
  // was the error a visitor saw in place of the real one (a Groq 429). The two Groq
  // models count their limits separately, so each backs up the other before Google
  // is asked. Google comes last: 2.5-flash-lite (~800 requests a day) and then
  // 2.5-flash (~20 a day, which the web search below also spends).
  add(groqKey,   GROQ,   'openai/gpt-oss-20b');
  add(groqKey,   GROQ,   'openai/gpt-oss-120b', true);
  add(geminiKey, GEMINI, 'gemini-2.5-flash-lite');
  add(geminiKey, GEMINI, 'gemini-2.5-flash');
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

// GEMINI THINKS TOO, and the same way. Measured 2026-10-28 on Google's
// OpenAI-compatible endpoint at a 90-token budget (the size of home.js's daily
// tip): gemini-2.5-flash returned 2 characters with finish_reason "length",
// having spent the budget thinking; with reasoning_effort "none" it answered in
// full. 2.5-flash-lite answered in full either way, and "low" (which switches
// thinking ON) truncated it. So Gemini gets "none", the opposite of Groq's "low":
// gpt-oss refuses "none" outright (400, measured the same day).
var AI_GEMINI_NO_THINKING = /gemini-2\.5-flash/i;

function aiReasonerExtras(p, payload) {
  if (p.url.indexOf('generativelanguage.googleapis.com') !== -1 && AI_GEMINI_NO_THINKING.test(p.model)) {
    return { reasoning_effort: 'none' };
  }
  if (p.url.indexOf('groq.com') === -1 || !AI_REASONER.test(p.model)) return null;
  var extra = { reasoning_effort: 'low', include_reasoning: false };
  if (!(payload.max_tokens > AI_REASONER_MIN_TOKENS)) extra.max_tokens = AI_REASONER_MIN_TOKENS;
  return extra;
}

// Did the model actually say anything? A 200 with empty content is not an answer, and
// before 2026-10-28 aiFetch returned it as one: the home tip and the bookmark note showed
// nothing at all. Reads a clone, so the caller can still read the Response itself.
function aiHasContent(res) {
  return res.clone().json().then(function (d) {
    var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return !!String(c || '').trim();
  }, function () { return false; });
}

function aiFetch(opts, strong) {
  var payload = {};
  try { payload = JSON.parse((opts && opts.body) || '{}'); } catch (e) { payload = {}; }
  delete payload.model;
  var signal = opts && opts.signal;
  var chain = (typeof aiChain === 'function') ? aiChain(strong) : AI_PROVIDERS;  // strong -> prefer strong reasoners
  if (!chain.length) return Promise.reject(new Error('No AI provider key configured'));
  if (AI_PROXY_URL) chain = chain.slice(0, 1);                  // the Worker walks the real chain itself
  // A 429 is the most useful thing to report when nothing answers ("try again shortly"),
  // so it is kept and returned instead of whichever error happened to come last.
  var limited = null;
  function tryP(i) {
    var p = chain[i];
    var body = JSON.stringify(Object.assign(p.proxy ? {} : { model: p.model }, payload, p.proxy ? null : aiReasonerExtras(p, payload)));
    var t = withTimeout(signal, AI_TIMEOUT_MS);
    return fetch(p.url, {
      method: 'POST', signal: t.signal,
      headers: p.proxy ? { 'Content-Type': 'application/json' }
                       : { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) {
      t.done();
      if (res.ok) {
        if (i + 1 >= chain.length) return res;                  // last one: the caller handles an empty answer
        return aiHasContent(res).then(function (has) { return has ? res : tryP(i + 1); });
      }
      if (res.status === 429 && !limited) limited = res;
      if (i + 1 < chain.length) return tryP(i + 1);             // bad key / rate-limit -> next provider
      return limited || res;                                    // last one: let caller read the error
    }).catch(function (err) {
      t.done();
      // user cancel propagates; a timeout only advances the chain
      if (err && err.name === 'AbortError' && !(signal && signal.aborted) && i + 1 < chain.length) return tryP(i + 1);
      if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;   // the user cancelled
      if (i + 1 < chain.length) return tryP(i + 1);             // network error -> next provider
      if (limited) return limited;
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
  if (!AI_PROXY_URL && (!k || String(k).indexOf('YOUR_') === 0)) return Promise.reject(new Error('no embed key'));
  var t = withTimeout(undefined, AI_TIMEOUT_MS);
  return fetch(AI_PROXY_URL ? AI_PROXY_URL + '/embed' : 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings', {
    method: 'POST', signal: t.signal,
    headers: AI_PROXY_URL ? { 'Content-Type': 'application/json' }
                          : { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' },
    body: JSON.stringify(AI_PROXY_URL ? { input: texts } : { model: 'gemini-embedding-001', input: texts })
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
// 2026-10-28: thinking switched off, and flash-lite behind flash. Measured that day: with thinking
// off, 2.5-flash grounded the same question with 8 sources, and flash-lite with 5; flash also
// answered 503 "high demand" on the first try, and its ~20 requests a day are shared with the chat
// fallback, so a spent or busy flash now falls to lite instead of making the web block disappear.
var AI_GROUND_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
function aiGroundBody(query) {
  return JSON.stringify({
    contents: [{ parts: [{ text: String(query || '') }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } }
  });
}
function aiGroundedSearch(query, signal) {
  var k = (typeof GEMINI_KEY !== 'undefined') ? GEMINI_KEY : '';
  if (!AI_PROXY_URL && (!k || String(k).indexOf('YOUR_') === 0)) return Promise.reject(new Error('no gemini key'));
  function tryModel(i) {
    var t = withTimeout(signal, AI_TIMEOUT_MS);
    var url = AI_PROXY_URL ? AI_PROXY_URL + '/ground'
      : 'https://generativelanguage.googleapis.com/v1beta/models/' + AI_GROUND_MODELS[i] + ':generateContent?key=' + encodeURIComponent(k);
    return fetch(url, {
      method: 'POST', signal: t.signal,
      headers: { 'Content-Type': 'application/json' },
      body: AI_PROXY_URL ? JSON.stringify({ query: String(query || '') }) : aiGroundBody(query)
    }).then(function (r) {
      t.done();
      if (r.ok) return r.json();
      if (!AI_PROXY_URL && (r.status === 429 || r.status >= 500) && i + 1 < AI_GROUND_MODELS.length) return tryModel(i + 1);
      throw new Error('ground HTTP ' + r.status);
    }, function (e) { t.done(); throw e; });
  }
  return tryModel(0)
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
