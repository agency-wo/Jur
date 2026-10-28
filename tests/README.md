# Tests

No framework, no dependencies — plain Node. Both suites read the real `mjete-ai.js` and slice
the functions under test out of it, so they can never drift from the shipped code.

## `doctrine.test.js` — pure logic (fast, offline)

```bash
node tests/doctrine.test.js
```

Covers the deterministic legal logic: the `KP_OBJEKTI` protected-value table (article → objekt
grupor / i drejtpërdrejtë, Albanian suffix ordering `170/b < 170/c < 170/ç`, `null` outside the
Pjesa e Posaçme, both tables strictly ascending), `kpObjektiForCase`, `enforceObjekti`,
`normAssess`, the `computeStrengthScore` caps, and `doctrineSummaryText`.

Needs no browser, no network and no `data/` — the tables are arithmetic.

## `ai-chain.test.js` — the AI provider chain (fast, offline)
```bash
node tests/ai-chain.test.js
```
Loads the real `ai.js` and `cloudflare-worker/worker.js` with `fetch` replaced, and checks:
- the chain's models and order, and that no retired model or dead provider is named;
- the reasoning settings each provider gets;
- that an empty answer moves on to the next provider;
- that a 429 is what the caller reads when nothing answers;
- the web search's fallback from flash to flash-lite;
- that with `AI_PROXY` set no key and no model leave the browser;
- the Worker's chain and CORS.

The free tiers rotate their models every few months, so this is the file to run after changing one.

## `pipeline.smoke.js` — the whole analysis end-to-end (headless)

```bash
python -m http.server 8123                     # from the repo root
msedge --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/edge about:blank
node tests/pipeline.smoke.js
```

Stubs `fetch` for the AI providers and `data/*.json` with schema-shaped canned answers, then
clicks the **real** `#opinion-generate-btn` and waits for the report. This executes the entire
promise chain — every `runCall`, both `.then` continuations, `enforceObjekti`, every renderer —
with zero network and zero API cost.

**Why it exists:** a `ReferenceError` (`dType is not defined`) once shipped because the unit
suites only tested sliced functions and injected renderers; nothing ever ran the real
`generate()` chain, and `node --check` validates syntax but not scope. This suite is the one
that catches that class of bug.

## Static sweep

`node --check` only checks syntax. For scope errors:

```bash
npx eslint@9 --no-config-lookup --config eslint.config.mjs *.js
```

`IntersectionObserver` (app.js) and `postMessage`/`onmessage` (the search worker) are expected
browser/worker globals, not findings.
