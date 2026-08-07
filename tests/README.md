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
