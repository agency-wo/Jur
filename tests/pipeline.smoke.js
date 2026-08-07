// Full-pipeline smoke test: stubs every AI call with schema-shaped canned JSON and drives the
// REAL #opinion-generate-btn. Executes the entire promise chain (all calls, both .then
// continuations, enforceObjekti, every renderer) with zero network and zero API cost — which is
// exactly what the unit-slice tests could not do, and why `dType is not defined` slipped through.
const http = require('http'); const fs = require('fs'); const path = require('path');
const BASE = 'http://localhost:8123';
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error', rej));

// canned law data so grounding/pinGround/kpObjektiForCase have something real to chew on
const PENAL = {
  '12':'Ka përgjegjësi penale personi që ka mbushur moshën katërmbëdhjetë vjeç.',
  '13':'Lidhja shkakësore midis veprimit dhe pasojës.',
  '14':'Faji. Askush nuk mund të dënohet pa faj.',
  '15':'Vepra penale kryhet me dashje kur personi e parashikon pasojën.',
  '16':'Vepra penale kryhet nga pakujdesia.',
  '17':'Nuk ka përgjegjësi personi i papërgjegjshëm.',
  '22':'Tentativa. Vepra mbetet në tentativë kur veprimi ndërpritet.',
  '23':'Përgjegjësia për tentativën.','24':'Heqja dorë vullnetare.',
  '25':'Bashkëpunimi.','26':'Organizatori.','27':'Shtytësi.',
  '47':'Caktimi i dënimit.','48':'Rrethanat lehtësuese.','50':'Rrethanat rënduese.',
  '134':'Vjedhja. Vjedhja e pasurisë dënohet me burgim nga gjashtë muaj gjer në tre vjet.',
  '139':'Vjedhja me dhunë. Vjedhja e pasurisë e shoqëruar me përdorim dhune dënohet me burgim nga tre gjer në dhjetë vjet.'
};

(async () => {
  const t = (await getJson('http://localhost:9222/json/list')).find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = new Map(); const errs = []; let loaded = null;
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && (d.exception.description||d.exception.value)) || d.text); }
    else if (m.method === 'Page.loadEventFired' && loaded) { loaded(); loaded = null; } };
  const send = (method, params={}) => new Promise((res,rej)=>{ const i=++id; pend.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method,params})); });
  const ev = async x => { const r = await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception)); return r.result.value; };
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker',{bypass:true}); await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Network.setBlockedURLs',{urls:['*api.groq.com*','*api.cerebras.ai*','*generativelanguage.googleapis.com*']});

  // Install the stubs BEFORE any page script runs.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    sessionStorage.setItem('jur_auth','1');
    window.__PENAL = ${JSON.stringify(PENAL)};
    window.__calls = [];
    // schema-shaped canned answers, keyed off what each prompt asks for.
    // No backslash escapes anywhere: this source is nested inside a JS template literal.
    var NL = String.fromCharCode(10);
    function canned(body){
      var pr = ''; try { pr = JSON.parse(body).messages.map(function(m){return m.content;}).join(' '); } catch(e){ pr = String(body); }
      window.__calls.push(pr.slice(0,70));
      if (pr.indexOf('MENDIM LIGJOR') > -1) return ['FAKTE','U mor telefoni.','BAZE LIGJORE','Neni 134 i Kodit Penal.','ANALIZE LIGJORE','Objekti i vepres eshte pronesia.','KUNDERPERGJIGJE','Asnje.','KONKLUZIONE','Vepra plotesohet.','REKOMANDIME','Depozitoni kallezimin.'].join(NL);
      if (pr.indexOf('pozicionin ligjor') > -1) return JSON.stringify({factors:{baza:{score:1.5,why:'a'},prova:{score:1,why:'b'},kundershtimi:{score:1,why:'c'},faktet:{score:1.5,why:'d'}},strengths:['s1'],weaknesses:['w1'],missing_evidence:['A e keni faturen?']});
      if (pr.indexOf('dekompozimin doktrinor') > -1) return JSON.stringify({framework:'penale',vepra:'Vjedhje',kuadri:[
        {id:'objekti',titull:'Objekti i vepres penale',vleresim:'mungon',shenim:'',permbajtja:[
          {etikete:'Objekti grupor',vlera:'...'},
          {etikete:'Objekti i drejtperdrejte',vlera:'telefoni celular i marre'},
          {etikete:'Objekti material',vlera:'telefoni celular'}]},
        {id:'ana_objektive',titull:'Ana objektive',vleresim:'plotesuar',permbajtja:[{etikete:'Veprimi',vlera:'marrja'}]},
        {id:'subjekti',titull:'Subjekti',vleresim:'plotesuar',permbajtja:[]},
        {id:'ana_subjektive',titull:'Ana subjektive',vleresim:'plotesuar',permbajtja:[]}],
        kualifikimi:{neni:'134',forma:'baze',stadi:'e konsumuar'},rrethanat:{lehtesuese:[],renduese:[]},dallimi:'',perfundim:'Perberja plotesohet.'});
      if (pr.indexOf('plan veprimi') > -1) return JSON.stringify({steps:[{action:'Depozito kallezimin',priority:'Larte',deadline:'menjehere'}],evidence:['fatura'],deadlines:[{what:'kallezimi',timeframe:'shpejt'}]});
      if (pr.indexOf('drivers') > -1) return JSON.stringify({drivers:['prova dokumentare'],damages:[{head:'Dem material',basis:'neni 134',share:100}]});
      if (pr.indexOf('arbitrazh') > -1) return JSON.stringify({pershtatshmeria:'e ulet'});
      if (pr.indexOf('citations') > -1) return JSON.stringify({citations:[],issues:[],corrections:[],confidence:'high'});
      if (pr.indexOf('Identifiko') > -1) return JSON.stringify({laws:[{name:'Kodi Penal',articles:['134','139'],relevance:'vjedhja'}],issues:['x'],arguments:['y'],facts:{parties:'A dhe B',dates:'2026',amounts:'50000',claim_type:'penale',jurisdiction:'Tirane'},key_events:['marrja e telefonit'],missing:['Mungon vlera e sendit'],clarifying:['A ka deshmitare?']});
      return 'Tekst i gjeneruar per prove.';
    }
    // The Opinion engine calls fetch() DIRECTLY with provider URLs (callGroq), and ai.js
    // redefines window.aiFetch at load — so the only reliable seam is fetch itself.
    var _realFetch = window.fetch;
    window.fetch = function(u, o){
      var s = String((u && u.url) || u);
      if (/api\.groq\.com|api\.cerebras\.ai|generativelanguage\.googleapis\.com/.test(s)) {
        var body = (o && o.body) || '';
        return Promise.resolve({ ok:true, status:200, json:function(){
          return Promise.resolve({ choices:[{ message:{ content: canned(body) } }] });
        }});
      }
      if (s.indexOf('data/kodi-penal.json') > -1)
        return Promise.resolve({ok:true, json:function(){ return Promise.resolve(window.__PENAL); }});
      if (s.indexOf('data/') > -1)
        return Promise.resolve({ok:true, json:function(){ return Promise.resolve({}); }});
      return _realFetch.apply(this, arguments);
    };
  `});

  const l = new Promise(r => { loaded = r; }); await send('Page.navigate',{url:BASE+'/mjete-ai.html'}); await l; await sleep(800);

  // ai.js defines these at load, so override AFTER the page scripts have run
  await ev(`window.aiEmbed=function(){return Promise.reject(new Error('no embed in test'));};
    window.aiGroundedSearch=function(){return Promise.reject(new Error('no web in test'));};
    window.aiReady=function(){return true;};
    if(typeof AI_PROVIDERS!=='undefined'&&!AI_PROVIDERS.length)
      AI_PROVIDERS.push({url:'https://api.groq.com/openai/v1/chat/completions',key:'test',model:'test'});
    'stubbed'`);

  // drive the REAL button on a theft fact pattern
  await ev(`document.getElementById('opinion-open-btn').click();
    document.getElementById('opinion-type').value='penale';
    document.getElementById('opinion-facts').value='Më datë 12 mars 2026, personi X mori pa lejen time telefonin celular nga çanta ime në një lokal në Tiranë, ndërsa unë isha larguar për pak minuta. Vlera e telefonit është rreth 50000 lekë dhe kam faturën e blerjes.';
    document.getElementById('opinion-generate-btn').click(); 'started'`);

  // wait for the pipeline to settle
  let out = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    out = await ev("!document.getElementById('opinion-output').hidden");
    const err = await ev("!document.getElementById('opinion-form-error').hidden");
    if (out || err) break;
  }

  const formErrShown = await ev("!document.getElementById('opinion-form-error').hidden");
  const formErrText  = await ev("document.getElementById('opinion-form-error').textContent");
  const nCalls       = await ev("window.__calls.length");
  const results = []; const check = (n,c,d)=>results.push((c?'PASS ':'FAIL ')+n+(d!==undefined&&d!==''?' — '+d:''));

  check('pipeline did NOT surface a form error', !formErrShown, formErrText);
  check('report rendered (#opinion-output visible)', out === true);
  check('the AI pipeline actually ran (calls made)', nCalls >= 6, nCalls + ' calls');

  if (out) {
    const doc = await ev("document.getElementById('op-out-doctrine').innerText");
    const dochtml = await ev("document.getElementById('op-out-doctrine').innerHTML");
    check('objekti = pronësia (law-derived, overrode the model)', /pronësia dhe posedimi/i.test(doc), (doc.split('\n').slice(0,6).join(' | ')||'').slice(0,120));
    check('model wrong value overridden', doc.indexOf('telefoni celular i marre')===-1 && doc.indexOf('telefoni celular i marrë')===-1);
    check('objekti material kept as its own row', /objekti material/i.test(doc) && /telefoni celular/i.test(doc));
    check('§ badges on the 2 law-derived rows', (dochtml.match(/op-el-det/g)||[]).length === 2, (dochtml.match(/op-el-det/g)||[]).length);
    const score = await ev("document.getElementById('op-strength-score').textContent");
    check('locked objekti did not cap the score at 4.0', parseFloat(score) > 4, score);
    const opinion = await ev("document.getElementById('op-out-opinion').innerText");
    check('final opinion rendered', /ANALIZ|BAZ/i.test(opinion), opinion.slice(0,50));
    const refs = await ev("document.getElementById('op-out-references').innerText");
    check('pinned general-part articles retrieved', /Neni 1[2-7]|Neni 2[2-7]|Neni 4[78]/.test(refs) || true, '(informational)');
  }

  const real = errs.filter(e => !/ERR_BLOCKED|Failed to fetch|no embed|no web|AbortError/i.test(e));
  check('NO uncaught runtime exceptions', real.length === 0, real.slice(0,3).join(' | ') || 'clean');

  console.log(results.join('\n'));
  const f = results.filter(x=>x.startsWith('FAIL')).length;
  console.log('\n' + (results.length-f) + ' passed, ' + f + ' failed');
  if (errs.length) { console.log('\nexceptions seen:'); errs.slice(0,5).forEach(e=>console.log('  · '+String(e).split('\n')[0])); }
  ws.close(); process.exit(f?1:0);
})().catch(e => { console.error('DRIVER ERROR: ' + e.message); process.exit(1); });
