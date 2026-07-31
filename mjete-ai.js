    'use strict';

    // ── Shared date utilities ── the ONLY date parsing/arithmetic/formatting in this file.
    // Native <input type="date"> yields ISO 'yyyy-mm-dd'; new Date('yyyy-mm-dd') would parse it
    // as UTC midnight and shift a day in negative-offset timezones, so parse components locally.
    var JurDate = {
      parseISO: function (s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
        if (!m) return null;
        var y = +m[1], mo = +m[2], d = +m[3];
        var dt = new Date(y, mo - 1, d);
        return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? dt : null;
      },
      addDays: function (dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); },
      addYears: function (dt, n) {
        var r = new Date(dt.getFullYear() + n, dt.getMonth(), dt.getDate());
        // 29 shkurt + N vjet në vit jo të brishtë → 28 shkurt, jo 1 mars
        if (r.getMonth() !== dt.getMonth()) r = new Date(r.getFullYear(), r.getMonth(), 0);
        return r;
      },
      diffDays: function (a, b) {
        var A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
        var B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
        return Math.round((B - A) / 86400000);
      },
      fmt: function (dt) {
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return p(dt.getDate()) + '.' + p(dt.getMonth() + 1) + '.' + dt.getFullYear();
      },
      today: function () { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); },
      todayISO: function () {
        var n = new Date();
        function p(x) { return (x < 10 ? '0' : '') + x; }
        return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
      },
      // Calendar-accurate span between two dates: whole years + leftover days.
      span: function (a, b) {
        var years = b.getFullYear() - a.getFullYear();
        var anniv = JurDate.addYears(a, years);
        if (anniv > b) { years--; anniv = JurDate.addYears(a, years); }
        if (years < 0) return { years: 0, days: 0 };
        return { years: years, days: Math.max(0, JurDate.diffDays(anniv, b)) };
      },
      spanText: function (a, b) {
        var s = JurDate.span(a, b);
        if (s.years <= 0) return JurDate.diffDays(a, b) + ' ditë';
        return s.years + ' vjet' + (s.days ? ' e ' + s.days + ' ditë' : '');
      }
    };

    // Single HTML-escaper for the whole file (was duplicated 3× with drifting behavior).
    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    // ── Fuzzy text matching for de-duplicating the "what's missing" questions ──
    // The three gap sources (understanding.missing / .clarifying / strength.missing_evidence)
    // routinely say the same thing in different words, so near-duplicates must collapse.
    // Length-preserving fold (ë→e, ç→c), same idea as ligjet-search.js.
    function gapFold(s){ return String(s == null ? '' : s).toLowerCase().replace(/ë/g,'e').replace(/ç/g,'c').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }
    var GAP_STOP={ te:1,per:1,nga:1,dhe:1,ose:1,qe:1,nje:1,eshte:1,jane:1,ka:1,kane:1,juaj:1,tuaj:1,kete:1,kesaj:1,apo:1,ndonje:1,pala:1,rastin:1,duhet:1,mund:1,ne:1,me:1,nuk:1,sipas:1 };
    // Albanian is heavily inflected — "kontratë"/"kontrata"/"kontratës" are the same word to a
    // reader but different strings. Strip one common ending (longest first) so they collapse,
    // while keeping the stem ≥4 chars so distinct words ("kontratë" vs "kontroll") stay apart.
    var GAP_SUF=['eve','ave','ove','ive','esh','ish','ur','it','in','un','es','et','ve','sh','te','ta','ti','ja','en','a','e','i','u','t','n'];
    function gapStem(w){
      if(w.length<=4) return w;
      for(var i=0;i<GAP_SUF.length;i++){
        var s=GAP_SUF[i];
        if(w.length-s.length>=4 && w.slice(-s.length)===s) return w.slice(0,w.length-s.length);
      }
      return w;
    }
    function gapTokens(s){ var out=[],seen={}; gapFold(s).split(' ').forEach(function(w){ if(w.length>2&&!GAP_STOP[w]){ var k=gapStem(w); if(!seen[k]){ seen[k]=1; out.push(k); } } }); return out; }
    // Containment (hits / shorter length), NOT Jaccard: a short question and a long restatement
    // of the same gap must still match — Jaccard would score them far apart.
    function gapSimilar(a,b){
      var A=gapTokens(a), B=gapTokens(b); if(!A.length||!B.length) return 0;
      var m={},hit=0; A.forEach(function(w){ m[w]=1; }); B.forEach(function(w){ if(m[w]) hit++; });
      return hit/Math.min(A.length,B.length);
    }
    // Union a field across the 3 self-consistency samples, fuzzy-dedup, rank by agreement.
    // No hard ≥2 vote: at temps .12/.25/.4 the phrasings differ, so exact voting yields nothing.
    function mergeQ(lists){
      var out=[];
      (lists||[]).forEach(function(arr){ (arr||[]).forEach(function(x){
        x=String(x==null?'':x).trim(); if(!x||x==='...') return;
        for(var i=0;i<out.length;i++){ if(gapSimilar(out[i].q,x)>=0.6){ out[i].n++; return; } }
        out.push({q:x,n:1});
      }); });
      return out.sort(function(a,b){ return b.n-a.n; }).map(function(o){ return o.q; });
    }

    // ── Canonical limitation (parashkrim) rules ── ONE table for every tool.
    // Both the Opinion engine (checkLimitation) and the Parashkrim calculator (solCompute)
    // read from here, so the same case can never get two different verdicts.
    var JUR_LIMITS = {
      rules: {
        'Kërkesë civile (kontratë)': { years: 10, law: 'kodi-civil.html', basis: 'detyrimet kontraktore (Kodi Civil)' },
        'Dëmshpërblim civil':        { years: 3,  law: 'kodi-civil.html', basis: 'dëmi jashtëkontraktor (Kodi Civil)' },
        'Mosmarrëveshje pune':       { years: 3,  law: 'kodi-civil.html', basis: 'kërkesa nga marrëdhënia e punës' },
        'Ankesë administrative':     { days: 45,  law: 'kodi-procedure-civile.html', basis: 'afati i ankimit ndaj aktit administrativ (KPA)' },
        'Kërkesë pronësore':         { none: true, law: 'kodi-civil.html', basis: 'padia rivendikuese si rregull nuk parashkruhet' },
        'Akuzë penale':              { tiered: true, law: 'kodi-penal.html', basis: 'parashkrimi i ndjekjes penale sipas peshës së veprës (neni 67 KP)' },
        'Garanci konsumatori':       { years: 2,  law: 'kodi-civil.html', basis: 'garancia ligjore e konsumatorit' }
      },
      // Opinion-tool case types → claim kinds that can apply to them.
      byCaseType: {
        civile:         ['Kërkesë civile (kontratë)', 'Dëmshpërblim civil'],
        tregtare:       ['Kërkesë civile (kontratë)'],
        prone:          ['Kërkesë pronësore'],
        konsumator:     ['Garanci konsumatori'],
        pune:           ['Mosmarrëveshje pune'],
        familjare:      [],
        penale:         ['Akuzë penale'],
        administrative: ['Ankesë administrative']
      },
      // Short human note per case type, derived from the same rules (no duplicated prose).
      describe: function (type) {
        var kinds = JUR_LIMITS.byCaseType[type];
        if (!kinds) return '';
        if (!kinds.length) return 'Shumica e padive të kësaj natyre nuk kanë parashkrim klasik; kërkesat pasurore sipas rastit.';
        return kinds.map(function (k) {
          var r = JUR_LIMITS.rules[k];
          var t = r.none ? 'nuk parashkruhet' : r.tiered ? 'afat sipas veprës' : r.days ? (r.days + ' ditë') : (r.years + ' vjet');
          return k + ': ' + t;
        }).join('; ') + '.';
      }
    };

    // ── GROQ API ── key loaded from config.js ─────

    var aiQuestion = document.getElementById('ai-question');
    var aiAsk      = document.getElementById('ai-ask');
    var aiAnswer   = document.getElementById('ai-answer');
    var aiText     = aiAnswer.querySelector('.ai-answer-text');

    var _SYS_HOME =
      'Jeni asistent ligjor i specializuar në legjislacionin shqiptar. ' +
      'Kjo platformë përmban 18 akte ligjore:\n\n' +
      '1. Kushtetuta e Republikës së Shqipërisë (1998) - të drejtat themelore, ndarje pushtetesh\n' +
      '2. Kodi Civil - prona, kontratat, detyrimet, trashëgimia\n' +
      '3. Kodi Penal - veprat penale dhe dënimet\n' +
      '4. Kodi i Procedurës Civile - procesi gjyqësor civil\n' +
      '5. Kodi i Procedurës Penale - procesi penal, të drejtat e të pandehurit\n' +
      '6. Kodi i Familjes - martesa, divorci, kujdestaria, birësimi\n' +
      '7. Kodi Rrugor - trafiku, lejet e drejtimit, aksidentet\n' +
      '8. Kodi Ajror - aviacioni civil, operatorët ajrorë\n' +
      '9. Kodi Doganor - importi, eksporti, tarifat doganore\n' +
      '10. Kodi i Drejtësisë Penale për të Mitur - personat nën 18 vjeç\n' +
      '11. Dispozita Zbatuese të Kodit Doganor - procedura doganore të detajuara\n' +
      '12. Ligj për Tregtarët dhe Shoqëritë Tregtare - sh.p.k., sh.a., bizneset\n' +
      '13. Ligj për Falimentimin - procedurat e falimentimit\n' +
      '14. Statusi i Gjyqtarëve dhe Prokurorëve - karriera gjyqësore\n' +
      '15. Organizimi i Pushtetit Gjyqësor - struktura e gjykatave\n' +
      '16. Organizimi i Pushtetit Gjyqësor (i përditësuar)\n' +
      '17. Ligj për Noterinë - aktet noteriale\n' +
      '18. Shërbimi Përmbarimor Gjyqësor Privat - ekzekutimi i vendimeve\n\n' +
      'Ndihmoni përdoruesin të gjejë ligjin e duhur dhe kuptojë dispozitat. ' +
      'Nëse pyetja është shqip, përgjigjuni shqip. Nëse është anglisht, përgjigjuni anglisht. ' +
      'Jini të saktë dhe konciz (3-5 fjali).';

    var _askCtrl = null;
    function askGroq() {
      if (_askCtrl) { _askCtrl.abort(); return; } // running → the button acts as "Anulo"
      var q = aiQuestion.value.trim();
      if (!q) return;
      if (!aiConfigured()) { aiAnswer.hidden = false; toolFail(aiText, 'Shërbimi AI nuk është i konfiguruar (mungon çelësi).'); return; }

      _askCtrl = new AbortController();
      aiAsk.textContent = 'Anulo';
      aiAnswer.style.opacity = '0';
      aiAnswer.hidden = false;
      aiText.textContent = '';
      requestAnimationFrame(function () { aiAnswer.style.opacity = '1'; });

      aiFetch({
        signal: _askCtrl.signal,
        body: JSON.stringify({
          max_tokens: 450,
          messages: [
            { role: 'system', content: _SYS_HOME },
            { role: 'user',   content: q }
          ]
        })
      })
      .then(function (r) { if (!r.ok) { var e = new Error('http'); e.status = r.status; throw e; } return r.json(); })
      .then(function (data) {
        aiText.innerHTML = toolMd((data.choices && data.choices[0] && data.choices[0].message.content) || 'Gabim në përgjigje.');
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') { aiAnswer.hidden = true; return; }
        toolFail(aiText, aiErrMsg(err && err.status, err), askGroq);
      })
      .finally(function () {
        _askCtrl = null;
        aiAsk.textContent = 'Pyet →';
      });
    }

    aiAsk.addEventListener('click', askGroq);
    aiQuestion.addEventListener('keydown', function (e) { if (e.key === 'Enter') askGroq(); });

    // ── Scenario buttons ──────────────────────────
    document.querySelectorAll('.sc-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        aiQuestion.value = btn.dataset.q;
        aiAnswer.hidden = false;
        aiText.textContent = '';
        askGroq();
      });
    });

    // ── Law Finder Wizard ─────────────────────────
    var _wRole = '';
    var _wSit  = '';
    var _wSituations = {
      'Individ':         ['Pronë', 'Familje / Divorc', 'Akuzë penale', 'Punë', 'Trashëgimi', 'Aksident rrugor', 'Kontratë'],
      'Biznes':          ['Regjistrim biznesi', 'Kontratë tregtare', 'Dogana & taksa', 'Punëmarrës', 'Falimentim', 'Shoqëri tregtare'],
      'Avokat / Jurist': ['Procedurë civile', 'Procedurë penale', 'Ekzekutim vendimi', 'Çështje familjare', 'E drejtë doganore'],
      'Studiues':        ['E drejtë kushtetuese', 'E drejtë civile', 'E drejtë penale', 'E drejtë tregtare', 'Organizim gjyqësor']
    };

    function _wSetStep(n) {
      document.querySelectorAll('.wizard-step').forEach(function (s, i) {
        s.classList.toggle('active', (i + 1) === n);
      });
    }

    document.querySelectorAll('[data-role]').forEach(function (pill) {
      pill.addEventListener('click', function () {
        _wRole = pill.dataset.role;
        var pills2 = document.getElementById('w-step2-pills');
        pills2.innerHTML = '';
        (_wSituations[_wRole] || []).forEach(function (sit) {
          var btn = document.createElement('button');
          btn.className = 'w-pill';
          btn.textContent = sit;
          btn.addEventListener('click', function () { _wSit = sit; _wRunWizard(); });
          pills2.appendChild(btn);
        });
        _wSetStep(2);
      });
    });

    document.getElementById('w-back').addEventListener('click',    function () { _wSetStep(1); });
    document.getElementById('w-back2').addEventListener('click',   function () { _wSetStep(2); });
    document.getElementById('w-restart').addEventListener('click', function () { _wSetStep(1); });

    function _wRunWizard() {
      _wSetStep(3);
      var resultEl = document.getElementById('w-result');
      var alsoEl   = document.getElementById('w-also');
      resultEl.textContent = 'Duke analizuar…';
      alsoEl.hidden = true;
      if (!aiConfigured()) { toolFail(resultEl, 'Shërbimi AI nuk është i konfiguruar (mungon çelësi).'); return; }

      aiFetch({
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 350,
          messages: [
            { role: 'system', content: _SYS_HOME },
            { role: 'user',   content: 'Profili: ' + _wRole + '. Situata: ' + _wSit + '. Cilat ligje nga koleksioni janë më relevante dhe pse? Listo 2-3 ligje me emra të plotë dhe shpjego shkurt çfarë rregullon secili.' }
          ]
        })
      })
      .then(function (r) { if (!r.ok) { var e = new Error('http'); e.status = r.status; throw e; } return r.json(); })
      .then(function (data) {
        resultEl.innerHTML = toolMd((data.choices && data.choices[0] && data.choices[0].message.content) || 'Nuk u gjet asgjë.');
        alsoEl.hidden = false;
      })
      .catch(function (err) { toolFail(resultEl, aiErrMsg(err && err.status, err), _wRunWizard); document.getElementById('w-back2').hidden = false; });
    }

    var _wizFreeQ      = document.getElementById('wizard-free-q');
    var _wizFreeSend   = document.getElementById('wizard-free-send');
    var _wizFreeAnswer = document.getElementById('wizard-free-answer');

    function _wFreeAsk() {
      var q = _wizFreeQ.value.trim();
      if (!q) return;
      if (!aiConfigured()) { _wizFreeAnswer.style.display = 'block'; toolFail(_wizFreeAnswer, 'Shërbimi AI nuk është i konfiguruar (mungon çelësi).'); return; }
      _wizFreeSend.disabled = true;
      _wizFreeAnswer.style.opacity = '0'; _wizFreeAnswer.style.display = 'block'; requestAnimationFrame(function () { _wizFreeAnswer.style.opacity = '1'; });
      _wizFreeAnswer.textContent = 'Duke menduar…';

      aiFetch({
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 350,
          messages: [
            { role: 'system', content: _SYS_HOME },
            { role: 'user',   content: 'Kontekst: profil ' + _wRole + ', situatë ' + _wSit + '. Pyetje: ' + q }
          ]
        })
      })
      .then(function (r) { if (!r.ok) { var e = new Error('http'); e.status = r.status; throw e; } return r.json(); })
      .then(function (data) {
        _wizFreeAnswer.innerHTML = toolMd((data.choices && data.choices[0] && data.choices[0].message.content) || 'Gabim.');
      })
      .catch(function (err) { toolFail(_wizFreeAnswer, aiErrMsg(err && err.status, err), _wFreeAsk); })
      .finally(function () { _wizFreeSend.disabled = false; });
    }

    _wizFreeSend.addEventListener('click', _wFreeAsk);
    _wizFreeQ.addEventListener('keydown', function (e) { if (e.key === 'Enter') _wFreeAsk(); });

    // ── Two-law comparison ────────────────────────
    var _cmpCtrl = null;
    document.getElementById('cmp-btn').addEventListener('click', function () {
      var btn = document.getElementById('cmp-btn');
      if (_cmpCtrl) { _cmpCtrl.abort(); return; } // running → the button acts as "Anulo"
      var law1 = document.getElementById('cmp-law1').value;
      var law2 = document.getElementById('cmp-law2').value;
      if (!law1 || !law2) { return; }
      if (law1 === law2) { return; }

      var result = document.getElementById('cmp-result');
      if (!aiConfigured()) { toolFail(result, 'Shërbimi AI nuk është i konfiguruar (mungon çelësi).'); return; }
      var origLabel = btn.textContent;
      _cmpCtrl = new AbortController();
      btn.textContent = 'Anulo';
      result.style.opacity = '0'; result.style.display = 'block'; requestAnimationFrame(function () { result.style.opacity = '1'; });
      result.textContent = 'Duke krahasuar…';

      aiFetch({
        signal: _cmpCtrl.signal,
        body: JSON.stringify({
          max_tokens: 450,
          messages: [
            { role: 'system', content: 'Jeni ekspert i legjislacionit shqiptar.' },
            { role: 'user',   content: 'Krahaso këto dy ligje:\n\n(1) ' + law1 + '\n(2) ' + law2 + '\n\nTrego: fushat e ndryshme të rregullimit, kur zbatohet secili, nëse ka mbivendosje, dhe cilin duhet konsultuar për situata specifike.' }
          ]
        })
      })
      .then(function (r) { if (!r.ok) { var e = new Error('http'); e.status = r.status; throw e; } return r.json(); })
      .then(function (data) {
        result.innerHTML = toolMd((data.choices && data.choices[0] && data.choices[0].message.content) || 'Gabim.');
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') { result.style.display = 'none'; return; }
        toolFail(result, aiErrMsg(err && err.status, err), function () { document.getElementById('cmp-btn').click(); });
      })
      .finally(function () { _cmpCtrl = null; btn.textContent = origLabel; });
    });

    // ── Case Study / Document / Email drafters → RichReport engine (csConfig/ddConfig/edConfig at end of script) ──

    // ── Legal Glossary ────────────────────────────
    (function () {
      // ~240 Albanian legal terms in 12 categories. Terms are GLOBALLY UNIQUE: the string is
      // simultaneously the label, the AI prompt argument and the cache key, so shared
      // procedural words are disambiguated (e.g. "apel penal" vs "ankim (apel) civil").
      // Each category carries its law file so linkNene points "Neni X" at the right code.
      var _glCats = [
        { n:'Konceptet themelore', law:'kodi-civil.html', t:[
          'normë juridike','subjekt i së drejtës','zotësi juridike','zotësi për të vepruar','e drejtë subjektive',
          'detyrim juridik','fakt juridik','veprim juridik','akt normativ','hierarkia e normave',
          'interpretim i ligjit','analogji ligjore','parashkrim','dekadencë','afat procedural',
          'prezumim ligjor','barra e provës','gjë e gjykuar','ligj material','ligj procedural','fuqi prapavepruese',
          'neni','kreu','urdhër','vendim'] },

        { n:'Kushtetuta & të drejtat themelore', law:'kushtetuta.html', t:[
          'kushtetutshmëri','Gjykata Kushtetuese','ndarja e pushteteve','sovranitet','shtetësi','referendum',
          'imunitet','e drejta e jetës','liria e shprehjes','liria e besimit','e drejta e pronës',
          'proces i rregullt ligjor','akses në gjykatë','ankim kushtetues','dekret presidencial',
          'Avokati i Popullit','gjendje e jashtëzakonshme','marrëveshje ndërkombëtare','barazi para ligjit',
          'mbrojtje e të dhënave personale','gjykatë','gjyqtar','prokuroria','avokat'] },

        { n:'Pronë & të drejta reale', law:'kodi-civil.html', t:[
          'pronësi','posedim','mbajtje','bashkëpronësi','pronësi e përbashkët','servitut','uzufrukt',
          'e drejta e përdorimit','e drejta e banimit','hipotekë','peng','barrë siguruese','regjistrim pasurie',
          'kartelë pasurie','padi rivendikuese','padi mohuese','fitim pronësie me parashkrim','aksesion',
          'tjetërsim','shpronësim për interes publik','e drejta e parablerjes','uzurpim'] },

        { n:'Detyrime & kontrata', law:'kodi-civil.html', t:[
          'kontratë','ofertë','pranim i ofertës','pëlqim','shkak i kontratës','objekt i kontratës',
          'formë e detyrueshme','pavlefshmëri absolute','pavlefshmëri relative','anulim kontrate',
          'zgjidhje kontrate','mospërmbushje','vonesë në përmbushje','kamatëvonesë','dëmshpërblim',
          'dëm i dalshëm','fitim i munguar','dëm jopasuror','forcë madhore','klauzolë penale','kaparr',
          'dorëzani','cedim i kredisë','subrogim','kompensim detyrimesh','pasurim pa shkak',
          'përgjegjësi jashtëkontraktore','garanci','kaution','kreditor','debitor'] },

        { n:'Familje & trashëgimi', law:'kodi-familjes.html', t:[
          'martesë','kurorëzim','regjim pasuror martesor','pasuri në bashkësi','zgjidhje e martesës',
          'ndarje faktike','përgjegjësi prindërore','kujdestari','e drejta e takimit','detyrim ushqimor',
          'atësi','birësim','dhunë në marrëdhëniet familjare','urdhër mbrojtjeje','trashëgimi ligjore',
          'trashëgimi me testament','testament olograf','testament noterial','trashëgimtar ligjor','legatar',
          'rezervë ligjore','pjesë e disponueshme','heqje dorë nga trashëgimia','dëshmi trashëgimie'] },

        { n:'E drejta penale — pjesa e përgjithshme', law:'kodi-penal.html', t:[
          'vepër penale','krim','kundërvajtje penale','përbërja e veprës penale','objekt i veprës penale',
          'ana objektive','subjekt i veprës penale','ana subjektive','dashje','pakujdesi','lidhje shkakësore',
          'tentativë','bashkëpunim në vepër penale','organizator','shtytës','ndihmës','mbrojtje e nevojshme',
          'nevojë ekstreme','papërgjegjshmëri','rrethana lehtësuese','rrethana rënduese','recidivizëm',
          'burgim','gjobë penale','pezullim i ekzekutimit të dënimit','lirim me kusht','amnisti','falje'] },

        { n:'Procedura penale', law:'kodi-procedure-penale.html', t:[
          'kallëzim penal','regjistrim i procedimit','hetim paraprak','prokuror','oficer i policisë gjyqësore',
          'i dyshuar','i pandehur','mbrojtës','mbrojtje e detyrueshme','e drejta e heshtjes',
          'masë sigurie personale','arrest në burg','arrest në shtëpi','detyrim paraqitjeje','ndalim',
          'arrestim në flagrancë','sekuestro provash','kontroll','këqyrje','përballje','seancë paraprake',
          'gjykim i shkurtuar','marrëveshje për pranimin e fajësisë','apel penal','rekurs penal',
          'rishikim i vendimit'] },

        { n:'Procedura civile', law:'kodi-procedure-civile.html', t:[
          'padi','kërkesëpadi','kundërpadi','palë ndërgjyqëse','legjitimim aktiv','legjitimim pasiv',
          'ndërhyrje kryesore','ndërhyrje dytësore','juridiksion','kompetencë lëndore','kompetencë tokësore',
          'njoftim procedural','seancë përgatitore','seancë gjyqësore','provë','provë me shkresë','dëshmitar',
          'ekspertizë','masë e sigurimit të padisë','pezullim i gjykimit','pushim i gjykimit','vendim gjyqësor',
          'formë e prerë','ankim (apel) civil','rekurs në Gjykatën e Lartë','shpenzime gjyqësore',
          'paditës','i paditur','apelim'] },

        { n:'Shoqëri tregtare & biznes', law:'shoqerite-tregtare.html', t:[
          'tregtar','veprimtari tregtare','regjistrim në QKB','shoqëri me përgjegjësi të kufizuar',
          'shoqëri aksionare','shoqëri kolektive','shoqëri komandite','kapital themeltar','kuotë','aksion',
          'ortak','aksionar','asamble e përgjithshme','administrator','këshill administrimi',
          'këshill mbikëqyrës','dividend','statut','akt themelimi','bashkim shoqërish','ndarje shoqërie',
          'transformim','likuidim','degë e shoqërisë së huaj','konkurrencë e pandershme'] },

        { n:'Falimentim & ekzekutim', law:'falimentimi.html', t:[
          'paaftësi paguese','mbingarkesë me borxhe','procedurë falimentimi','masa e falimentimit',
          'administrator falimentimi','kreditor i siguruar','kreditor i pasiguruar','radhë e kreditorëve',
          'plan riorganizimi','përmbarues gjyqësor privat','titull ekzekutiv','ekzekutim i detyrueshëm',
          'sekuestro konservative','sekuestro ekzekutive','ankand publik','vlerësim i pasurisë',
          'shpërndarje e të ardhurave','kundërshtim i veprimeve përmbarimore'] },

        { n:'Administrative, doganore & rrugore', law:'kodi-doganor.html', t:[
          'akt administrativ','akt nënligjor','organ administrativ','procedurë administrative',
          'ankim administrativ','heshtje administrative','pavlefshmëri e aktit administrativ','revokim i aktit',
          'gjykatë administrative','deklaratë doganore','regjim doganor','import','eksport','transit',
          'tarifë doganore','vlerë doganore','origjinë e mallrave','magazinim doganor','kontrabandë',
          'patentë drejtimi','pikë penalizuese','gjobë rrugore','aksident rrugor','sigurim i detyrueshëm TPL',
          'operator ajror','hapësirë ajrore'] },

        { n:'Noteria, aktet & provat', law:'noteria.html', t:[
          'noter','akt noterial','formë noteriale','legalizim i nënshkrimit','vërtetim kopjeje','prokurë',
          'prokurë e posaçme','prokurë e përgjithshme','deklaratë noteriale','regjistër noterial',
          'kopje e njësuar','datë e sigurt','dokument publik','dokument privat','vërtetësi e dokumentit',
          'falsifikim dokumenti','apostilë','përkthim zyrtar','arkivë noteriale','arbitrazh','ndërmjetës',
          'noterizim','ekzekutim'] }
      ];

      // Length-preserving fold so "padites" finds "paditës" (same idea as ligjet-search.js).
      function glFold(s){ return String(s == null ? '' : s).toLowerCase().replace(/ë/g,'e').replace(/ç/g,'c'); }

      // Definitions cache persists across sessions. v2: new prompt + new entry shape, and the
      // cap had to grow — 50 would thrash badly against 240 terms.
      var GL_LS = 'gl-cache-v2', GL_MAX = 240, GL_PROMPT_V = 2;
      var _glCache = {};
      try { _glCache = JSON.parse(localStorage.getItem(GL_LS) || '{}') || {}; } catch (e) { _glCache = {}; }
      try { localStorage.removeItem('gl-cache-v1'); } catch (e) {}
      var _glDirty = false, _glTimer = null;
      function glWrite() {
        _glTimer = null; if (!_glDirty) return;
        try { localStorage.setItem(GL_LS, JSON.stringify(_glCache)); _glDirty = false; }
        catch (e) {
          // Quota hit: drop the oldest half and retry once, else every future write would
          // fail silently forever (the old bare catch{} did exactly that).
          try {
            var keys = Object.keys(_glCache).sort(function (a, b) { return (_glCache[a].t || 0) - (_glCache[b].t || 0); });
            keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (k) { delete _glCache[k]; });
            localStorage.setItem(GL_LS, JSON.stringify(_glCache)); _glDirty = false;
          } catch (e2) {}
        }
      }
      // Debounced: a cache HIT used to trigger a full stringify + write of the whole map.
      function glPersistSoon() { _glDirty = true; if (!_glTimer) _glTimer = setTimeout(glWrite, 500); }
      window.addEventListener('pagehide', glWrite);
      function glGet(term) {
        var e = _glCache[term];
        if (!e || typeof e.v !== 'string' || e.p !== GL_PROMPT_V) return null;  // prompt bump self-invalidates
        e.t = Date.now(); glPersistSoon();
        return e.v;
      }
      function glPut(term, txt) {
        _glCache[term] = { v: txt, t: Date.now(), p: GL_PROMPT_V };
        var keys = Object.keys(_glCache);
        if (keys.length > GL_MAX) {
          keys.sort(function (a, b) { return (_glCache[a].t || 0) - (_glCache[b].t || 0); });
          keys.slice(0, keys.length - GL_MAX).forEach(function (k) { delete _glCache[k]; });
        }
        glPersistSoon();
      }

      var termsEl  = document.getElementById('glossary-terms');
      var resultEl = document.getElementById('glossary-result');
      var searchEl = document.getElementById('glossary-search');
      var emptyEl  = document.getElementById('glossary-empty');
      var lookupEl = document.getElementById('glossary-lookup');
      var qEl      = document.getElementById('gl-q');
      if (!termsEl || !resultEl || !searchEl) return;

      // ── Build the collapsible category groups (collapsed by default) ──
      var _glSeen = {}, _glTotal = 0;
      _glCats.forEach(function (cat) {
        var d = document.createElement('details');
        d.className = 'gl-group';
        d.dataset.law = cat.law;
        var s = document.createElement('summary');
        s.appendChild(document.createTextNode(cat.n));
        var cnt = document.createElement('span');
        cnt.className = 'gl-count';
        var wrap = document.createElement('div');
        wrap.className = 'gl-terms';
        var n = 0;
        cat.t.forEach(function (term) {
          if (_glSeen[term]) return;              // guard: term is also the cache key
          _glSeen[term] = 1; n++; _glTotal++;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gl-term';
          btn.textContent = term;
          btn.dataset.term = term;
          btn.dataset.fold = glFold(term);
          wrap.appendChild(btn);
        });
        cnt.textContent = String(n);
        cnt.dataset.total = String(n);
        s.appendChild(cnt);
        d.appendChild(s);
        d.appendChild(wrap);
        termsEl.appendChild(d);
      });

      // ── Lookup (shared by pill clicks, the AI button and Enter) ──
      var _glCtrl = null, _glSeq = 0, _glActive = null;
      function glLookup(term, lawFile, sourceBtn) {
        if (_glCtrl) _glCtrl.abort();
        var ctrl = _glCtrl = new AbortController();
        var my = ++_glSeq;                        // the controller alone still loses to an
        var law = lawFile || 'kodi-civil.html';   // already-resolved earlier response
        resultEl.hidden = false;
        if (emptyEl) emptyEl.hidden = true;
        if (!aiConfigured()) { toolFail(resultEl, 'Shërbimi AI nuk është i konfiguruar (mungon çelësi).'); _glCtrl = null; return; }

        var cached = glGet(term);
        if (cached) { resultEl.innerHTML = toolMd(cached, law); _glCtrl = null; return; }

        resultEl.textContent = 'Duke kërkuar…';
        if (lookupEl) lookupEl.textContent = 'Anulo';
        aiFetch({
          signal: ctrl.signal,
          body: JSON.stringify({
            max_tokens: 320,
            messages: [
              { role: 'system', content: 'Jeni jurist shqiptar. Jepni definicione juridike të qarta, të sakta dhe praktike. Cito nene vetëm kur je i sigurt.' },
              { role: 'user',   content: 'Shpjego termin juridik "' + term + '" sipas legjislacionit shqiptar. Struktura:\n**Definicion** — 2 fjali të qarta.\n**Ku gjendet** — ligji/kodi kryesor dhe neni nëse je i sigurt.\n**Shembull praktik** — një rast i shkurtër.\nMax 7 fjali gjithsej. Nëse termi nuk është juridik, thuaje shkurt.' }
            ]
          })
        })
        .then(function (r) { if (!r.ok) { var e = new Error('http'); e.status = r.status; throw e; } return r.json(); })
        .then(function (data) {
          if (my !== _glSeq) return;              // a newer lookup superseded this one
          var txt = data.choices && data.choices[0] && data.choices[0].message.content;
          // Never cache an empty answer — it must stay retryable.
          if (!txt) { toolFail(resultEl, 'Përgjigje boshe nga modeli — provoni sërish.', function () { glLookup(term, law, sourceBtn); }); return; }
          glPut(term, txt);
          resultEl.innerHTML = toolMd(txt, law);
        })
        .catch(function (err) {
          if (my !== _glSeq) return;
          if (err && err.name === 'AbortError') return;
          toolFail(resultEl, aiErrMsg(err && err.status, err), function () { glLookup(term, law, sourceBtn); });
        })
        .then(function () {
          if (my === _glSeq) { _glCtrl = null; if (lookupEl) lookupEl.textContent = 'Kërko me AI →'; }
        });
      }

      // One delegated listener instead of ~240 individual ones.
      termsEl.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.gl-term') : null;
        if (!btn || !termsEl.contains(btn)) return;
        if (_glActive) _glActive.classList.remove('active');
        _glActive = btn; btn.classList.add('active');
        var grp = btn.closest('.gl-group');
        glLookup(btn.dataset.term, grp && grp.dataset.law, btn);
      });

      // ── Search: filter across every category, auto-expand hits, offer AI when none ──
      var _glDebounce = null;
      function glFilter() {
        var raw = searchEl.value.trim(), q = glFold(raw), total = 0;
        Array.prototype.forEach.call(termsEl.querySelectorAll('.gl-group'), function (grp) {
          var shown = 0;
          Array.prototype.forEach.call(grp.querySelectorAll('.gl-term'), function (b) {
            var hit = true;
            if (q) {
              var f = b.dataset.fold;
              // word-prefix match, plus substring once the query is long enough — a bare
              // "i" used to match half the list with the old .includes() rule
              hit = f.split(' ').some(function (w) { return w.indexOf(q) === 0; }) || (q.length >= 3 && f.indexOf(q) !== -1);
            }
            b.hidden = !hit; if (hit) shown++;
          });
          total += shown;
          var cnt = grp.querySelector('.gl-count');
          if (cnt) cnt.textContent = q ? (shown + ' / ' + cnt.dataset.total) : cnt.dataset.total;
          grp.hidden = !!q && shown === 0;
          grp.open = !!q && shown > 0;
        });
        if (emptyEl) {
          var none = !!q && total === 0;
          emptyEl.hidden = !none;
          if (qEl) qEl.textContent = raw;
          // Hide the stale definition: it belonged to a previous term, not to what was typed.
          if (none) resultEl.hidden = true;
        }
      }
      searchEl.addEventListener('input', function () {
        clearTimeout(_glDebounce);
        _glDebounce = setTimeout(glFilter, 150);
      });

      // AI lookup for a word that isn't in the dictionary. Never fires on keystroke —
      // only Enter or the explicit button.
      var GL_FREE_RE = /^[A-Za-zÇçËë0-9 .\-']{2,60}$/;
      function glFreeLookup() {
        var raw = searchEl.value.trim();
        if (!raw || !GL_FREE_RE.test(raw)) return;
        if (_glCtrl) { _glCtrl.abort(); _glCtrl = null; if (lookupEl) lookupEl.textContent = 'Kërko me AI →'; return; }
        var f = glFold(raw), exact = null;
        Array.prototype.forEach.call(termsEl.querySelectorAll('.gl-term'), function (b) {
          if (!exact && b.dataset.fold === f) exact = b;
        });
        if (exact) { exact.click(); return; }     // hits the cache instead of re-asking
        if (_glActive) { _glActive.classList.remove('active'); _glActive = null; }
        glLookup(raw, 'kodi-civil.html', null);
      }
      searchEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_glDebounce); glFilter(); glFreeLookup(); }
      });
      if (lookupEl) lookupEl.addEventListener('click', glFreeLookup);
    }());

    // ── Penalty Estimator → now handled by the RichReport engine (penConfig) at end of script ──

    // ── Statute of Limitations → now handled by the RichReport engine (solConfig) at end of script ──

    // ── Contract Analyzer ──────────────────────────
    // Lazy loader for the heavy PDF/OCR libraries (~1.3MB) — fetched only when a file is attached,
    // never on page load. Promise-cached so repeat attachments don't re-inject the script tag.
    var _scriptCache = {};
    function loadScript(src) {
      if (_scriptCache[src]) return _scriptCache[src];
      _scriptCache[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { delete _scriptCache[src]; reject(new Error('script-load-failed')); };
        document.head.appendChild(s);
      });
      return _scriptCache[src];
    }
    var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    var PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    function ensurePdfJs(onStatus) {
      if (window.pdfjsLib) return Promise.resolve();
      if (onStatus) onStatus('Duke shkarkuar lexuesin e PDF…');
      return loadScript(PDFJS_URL);
    }
    function ensureTesseract(onStatus) {
      if (window.Tesseract) return Promise.resolve();
      if (onStatus) onStatus('Duke shkarkuar modulin OCR…');
      return loadScript(TESS_URL).catch(function () {}); // OCR opsional — teksti i PDF-së lexohet gjithsesi
    }
    // Reusable client-side PDF text extraction (pdf.js). Returns Promise<string>.
    function extractPdfText(file, cap, onStatus) {
      cap = cap || 12000;
      return ensurePdfJs(onStatus).then(function () {
        try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL; } catch (e) {}
        return file.arrayBuffer();
      }).then(function (buf) {
        return pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function (pdf) {
        var pages = [], chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (i) { chain = chain.then(function () {
            return pdf.getPage(i).then(function (p) { return p.getTextContent(); }).then(function (tc) {
              pages.push(tc.items.map(function (it) { return it.str; }).join(' '));
            });
          }); })(i);
        }
        return chain.then(function () {
          var txt = pages.join('\n').replace(/\s+/g, ' ').trim();
          if (txt.length >= 60) return txt;   // text-layer present — no OCR needed
          return ensureTesseract(onStatus).then(function () {
            if (!window.Tesseract) return txt;
            return ocrPdf(pdf, onStatus).then(function (o) { return (o && o.length > txt.length) ? o : txt; });
          });
        });
      }).then(function (txt) {
        return String(txt || '').replace(/\s+/g, ' ').trim().slice(0, cap);
      });
    }
    // OCR fallback for scanned/image PDFs: render up to 8 pages to canvas, recognize via Tesseract (Albanian+English).
    function ocrPdf(pdf, onStatus) {
      if (!window.Tesseract) return Promise.resolve('');
      var maxPages = Math.min(pdf.numPages, 8), out = [];
      if (onStatus) onStatus('Duke lexuar me OCR (mund të zgjasë pak)…');
      return Tesseract.createWorker('sqi+eng').then(function (worker) {
        var chain = Promise.resolve();
        for (var i = 1; i <= maxPages; i++) {
          (function (i) { chain = chain.then(function () {
            if (onStatus) onStatus('OCR faqja ' + i + '/' + maxPages + '…');
            return pdf.getPage(i).then(function (p) {
              var vp = p.getViewport({ scale: 2 });
              var canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height;
              return p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
                .then(function () { return worker.recognize(canvas); })
                .then(function (res) { out.push((res && res.data && res.data.text) || ''); });
            });
          }); })(i);
        }
        return chain.then(function () { return worker.terminate(); })
          .then(function () { return out.join('\n').replace(/\s+/g, ' ').trim(); })
          .catch(function () { try { worker.terminate(); } catch (e) {} return out.join('\n').trim(); });
      }).catch(function () { return ''; });
    }

    // "Check the uploaded PDF" — toggle a read-only preview of the extracted text.
    function attachPdfPreview(viewBtn, previewEl, getText) {
      if (!viewBtn || !previewEl) return;
      viewBtn.addEventListener('click', function () {
        if (previewEl.hidden) { previewEl.textContent = getText() || '(pa tekst)'; previewEl.hidden = false; viewBtn.textContent = 'Fshih tekstin'; }
        else { previewEl.hidden = true; viewBtn.textContent = 'Shiko tekstin'; }
      });
    }

    // ── ADR (ndërmjetësim/arbitrazh) — shared by both engines ──
    var ADR_TYPES = { civile:1, tregtare:1, familjare:1, pune:1, prone:1, konsumator:1 };
    function adrApplicable(type){ return !!ADR_TYPES[type]; }
    function adrApplicableInh(c, inp){ var n=0; (c&&c.heirs||[]).forEach(function(h){ n+=h.count; }); return n>1 || !!(inp&&inp.hasWill) || ((inp&&inp.predeceasedWithKids)|0)>0; }
    function adrSuitability(type, forecast){
      var base=({familjare:3,pune:3,konsumator:3,tregtare:2,civile:2,prone:2})[type]; if(base==null) base=2;
      var settle=forecast?Math.round(forecast.settle||0):0;
      var sc=base+(settle>=40?1:0)-(settle>0&&settle<15?1:0);
      var level=sc>=3?'hi':sc>=2?'mid':'lo';
      var lbl={hi:['op-conf-hi','E përshtatshme'],mid:['op-conf-mid','Mesatarisht e përshtatshme'],lo:['op-conf-lo','Pak e përshtatshme']}[level];
      return { level:level, cls:lbl[0], label:lbl[1], settle:settle, note:'Bazuar te lloji i çështjes'+(settle?(' dhe gjasat e marrëveshjes (~'+settle+'%)'):'')+'.' };
    }
    function adrHtml(det, ai){
      ai=ai||{};
      function e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      var html='';
      if(det) html+='<p>Përshtatshmëria për zgjidhje alternative: <span class="op-conf '+det.cls+'">'+e(det.label)+'</span> <small>('+e(det.note)+')</small></p>';
      if(ai.mode||ai.likelihood) html+='<p class="op-fc-basis">'+(ai.mode?('<strong>Rruga:</strong> '+e(ai.mode)):'')+(ai.likelihood?((ai.mode?' · ':'')+'<strong>Gjasat për zgjidhje:</strong> '+e(ai.likelihood)):'')+'</p>';
      if(ai.best_case||ai.worst_case){ html+='<div class="op-stat-grid">';
        if(ai.best_case) html+='<div class="op-stat"><div class="op-stat-label">Skenari më i mirë</div><div class="op-stat-value" style="font-size:.88rem;font-weight:500;line-height:1.5">'+e(ai.best_case)+'</div></div>';
        if(ai.worst_case) html+='<div class="op-stat"><div class="op-stat-label">Skenari më i keq</div><div class="op-stat-value" style="font-size:.88rem;font-weight:500;line-height:1.5">'+e(ai.worst_case)+'</div></div>';
        html+='</div>'; }
      function lst(t,cls,arr){ if(!arr||!arr.length) return ''; return '<p class="op-subhead '+cls+'" style="margin:12px 0 4px;">'+t+'</p><ul class="op-checklist">'+arr.filter(Boolean).map(function(x){ return '<li>'+e(x)+'</li>'; }).join('')+'</ul>'; }
      html+=lst('Faktorë në favor','op-green',ai.factors_for);
      html+=lst('Faktorë kundër','op-amber',ai.factors_against);
      if(ai.recommendation) html+='<p class="op-subhead" style="margin:12px 0 4px;">Rekomandim</p><p>'+e(ai.recommendation)+'</p>';
      return html || '<p class="op-degraded">Vlerësimi i zgjidhjes alternative nuk u gjenerua.</p>';
    }
    var ADR_SYS='Jeni ndërmjetës dhe arbitër me përvojë në Shqipëri (kuadri i ndërmjetësimit, Ligji nr. 10385/2011). Vlerësoni realisht nëse mosmarrëveshja mund të zgjidhet me ndërmjetësim ose arbitrazh. Mos shpikni numra nenesh apo vendime. Përgjigjuni VETËM me JSON të vlefshëm.';
    var ADR_JSON='\n\nJSON:\n{"mode":"ndërmjetësim|arbitrazh|të dyja","likelihood":"e lartë/e mesme/e ulët + arsye e shkurtër","best_case":"rezultati më i mirë i mundshëm me ADR","worst_case":"rezultati më i keq / rreziqet nëse dështon","factors_for":["..."],"factors_against":["..."],"recommendation":"mendim i përgjithshëm: a ia vlen dhe si t\'i qasesh"}';

    // ── Self-consistency: aggregate N samples of the law/article identification (Call 1) ──
    function aggregateLaws(samples){
      var valid=(samples||[]).filter(Boolean), n=valid.length||1, thr=n>=2?2:1;
      var cnt={}, disp={}, arts={}, rel={}, understanding=null;
      valid.forEach(function(j){
        // facts/key_events stay first-sample-wins (they must remain internally coherent),
        // but missing/clarifying are unioned across all samples below — otherwise samples
        // 2–3's questions were discarded wholesale just because sample 1 had facts.
        if(!understanding && j.facts) understanding={facts:j.facts||{},key_events:j.key_events||[],missing:[],clarifying:[]};
        (j.laws||[]).forEach(function(l){
          var name=String(l&&l.name||'').trim(); if(!name) return; var k=name.toLowerCase();
          cnt[k]=(cnt[k]||0)+1; disp[k]=disp[k]||name; if(l.relevance && !rel[k]) rel[k]=l.relevance;
          arts[k]=arts[k]||{}; (l.articles||[]).forEach(function(a){ var an=String(a).trim(); if(an) arts[k][an]=1; });
        });
      });
      var laws=Object.keys(cnt).filter(function(k){ return cnt[k]>=thr; })
        .sort(function(a,b){ return cnt[b]-cnt[a]; })
        .map(function(k){ return { name:disp[k], articles:Object.keys(arts[k]), relevance:rel[k]||'' }; });
      if(!laws.length){ var first=valid[0]; laws=(first&&first.laws)||[]; }
      var u=understanding||{facts:{},key_events:[],missing:[],clarifying:[]};
      u.missing=mergeQ(valid.map(function(j){ return j.missing; }));
      u.clarifying=mergeQ(valid.map(function(j){ return j.clarifying; }));
      return { laws:laws, understanding:u };
    }

    // ── Article cross-linking → full law text (absolute URLs so links work in saved PDFs too) ──
    var LAW_BASE = (function(){ try { return location.href.replace(/[^\/]*(?:[?#].*)?$/, ''); } catch(e){ return ''; } })();
    function linkNene(html, lawFile){
      if(html==null) return '';
      lawFile = lawFile || 'kodi-civil.html';
      return String(html).replace(/(<a\b[^>]*>[\s\S]*?<\/a>)|(<[^>]+>)|([^<]+)/g, function(m, anchor, tag, text){
        if(anchor||tag) return m;
        return text.replace(/\bnen(?:i|it|in|e|et|eve)?\s+\d+(?:\/[\w]+)?(?:\s*[,–\-]\s*\d+(?:\/[\w]+)?)*/gi, function(run){
          return run.replace(/\d+(?:\/[\w]+)?/g, function(numTok){
            var base=numTok.split('/')[0];
            return '<a class="opinion-law-link" target="_blank" rel="noopener noreferrer" href="'+LAW_BASE+lawFile+'#neni-'+base+'">'+numTok+'</a>';
          });
        });
      });
    }

    // Lightweight markdown -> HTML (+ clickable "Neni X" links) for the simpler tool outputs.
    function toolMd(raw, lawFile){
      function escH(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      function inl(t){ return t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>'); }
      var lines=escH(raw).split('\n'), out='', list=false;
      function close(){ if(list){ out+='</ul>'; list=false; } }
      lines.forEach(function(ln){ ln=ln.trim();
        if(!ln){ close(); return; }
        var h=ln.match(/^#{1,4}\s+(.*)$/); if(h){ close(); out+='<h4 class="op-subhead">'+inl(h[1])+'</h4>'; return; }
        var b=ln.match(/^[-•*]\s+(.*)$/); if(b){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(b[1])+'</li>'; return; }
        var o=ln.match(/^\d+[.)]\s+(.*)$/); if(o){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(o[1])+'</li>'; return; }
        close(); out+='<p>'+inl(ln)+'</p>';
      });
      close();
      return linkNene(out, lawFile||'kodi-civil.html');
    }

    // ── Shared AI failure handling (used by the RichReport engine + the remaining light tools) ──
    function aiConfigured(){ return (typeof aiReady === 'function') ? aiReady() : (typeof GROQ_KEY !== 'undefined' && GROQ_KEY && String(GROQ_KEY).indexOf('YOUR_') !== 0); }
    // aiErrMsg() now lives in ai.js — shared with app.js, which is loaded on every law page.
    // Render a failure into a result element with an optional "Provo sërish" button.
    function toolFail(el, msg, retryFn){
      if (!el) return;
      el.innerHTML = '';
      el.hidden = false;
      el.style.display = 'block';
      var p = document.createElement('p'); p.className = 'tool-error-msg'; p.textContent = msg; el.appendChild(p);
      if (typeof retryFn === 'function') {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tool-retry-btn'; b.textContent = 'Provo sërish';
        b.addEventListener('click', retryFn); el.appendChild(b);
      }
    }

    // Contract Analyzer — PDF upload fills the textarea
    (function () {
      var inp = document.getElementById('ca-pdf'),
          status = document.getElementById('ca-pdf-status'),
          clr = document.getElementById('ca-pdf-clear'),
          ta = document.getElementById('ca-text');
      if (!inp) return;
      clr.addEventListener('click', function () { inp.value = ''; status.textContent = ''; status.classList.remove('warn'); clr.hidden = true; });
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        status.classList.remove('warn'); status.textContent = 'Duke lexuar PDF…'; clr.hidden = false;
        extractPdfText(f, 12000, function (m) { status.textContent = m; }).then(function (txt) {
          if (!txt) { status.textContent = 'PDF-ja duket e skanuar (pa tekst) — ngjit tekstin manualisht.'; status.classList.add('warn'); return; }
          ta.value = txt;
          status.textContent = f.name + ' · ' + txt.split(/\s+/).length + ' fjalë';
        }).catch(function () { status.textContent = 'Nuk u lexua dot PDF-ja.'; status.classList.add('warn'); });
      });
    })();

    // ── Contract Analyzer → now handled by the RichReport engine (CONTRACT) at end of script ──

    // ── Rights / Court / Evidence / Timeline → RichReport engine (rightsConfig/courtConfig/evidenceConfig/timelineConfig at end of script) ──

    // ── Negotiation Coach → now handled by the RichReport engine (negoConfig) at end of script ──

    // ── Inheritance Engine lives in its own IIFE near the end of this script ──

    // ── Business Compliance / Consumer Rights → RichReport engine (bizConfig/consumerConfig at end of script) ──

    /* ── Legal Opinion Engine (7-call pipeline) ── */
    (function () {
      'use strict';

      var GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';
      var MODEL          = 'llama-3.3-70b-versatile';
      var PARALLEL_LIMIT = 5;
      var MAX_RETRIES    = 3;

      function $(id){ return document.getElementById(id); }
      function delay(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
      function backoff(n){ return 600 * Math.pow(2, n) + Math.random() * 250; }
      function clampPct(v){ var n = Number(v); return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
      function fmtNum(n){ n = Math.round(Number(n) || 0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
      function getKey(){ return (typeof GROQ_KEY !== 'undefined') ? GROQ_KEY : ''; }
      function keyMissing(){ if(typeof aiReady==='function') return !aiReady(); var k = getKey(); return !k || k === 'YOUR_GROQ_KEY_HERE'; }

      function safeJson(raw){
        if (raw && typeof raw === 'object') return raw;
        try { var s = String(raw).replace(/```json|```/g, ''); var m = s.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; }
        catch(e){ return {}; }
      }

      var LAW_MAP = {
        'Kushtetutës':'kushtetuta.html','Kushtetuta':'kushtetuta.html',
        'Kodit Civil':'kodi-civil.html','Kodi Civil':'kodi-civil.html',
        'Kodit Penal':'kodi-penal.html','Kodi Penal':'kodi-penal.html',
        'Kodit të Procedurës Civile':'kodi-procedure-civile.html','Procedurës Civile':'kodi-procedure-civile.html',
        'Kodit të Procedurës Penale':'kodi-procedure-penale.html','Procedurës Penale':'kodi-procedure-penale.html',
        'Kodit të Familjes':'kodi-familjes.html','Kodi i Familjes':'kodi-familjes.html',
        'Kodit Rrugor':'kodi-rrugor.html','Kodi Rrugor':'kodi-rrugor.html',
        'Shoqërive Tregtare':'shoqerite-tregtare.html',
        'Falimentimit':'falimentimi.html',
        'Noterinë':'noteria.html','Noteria':'noteria.html',
        'Drejtësisë Penale për të Mitur':'drejtesia-penale-mitur.html',
        'Shërbimit Përmbarimor':'sherbimi-permbarimor.html',
        'Organizimit të Pushtetit Gjyqësor':'organizimi-pushtetit-gjyqesor.html',
        'Kodit Doganor':'kodi-doganor.html','Kodi Doganor':'kodi-doganor.html',
        'Kodit Ajror':'kodi-ajror.html','Kodi Ajror':'kodi-ajror.html',
        'Dispozitave Zbatuese të Kodit Doganor':'dispozita-zbatuese-kodi-doganor.html','Dispozita Zbatuese':'dispozita-zbatuese-kodi-doganor.html',
        'Statusit të Gjyqtarëve dhe Prokurorëve':'statusi-gjyqtareve-prokuroreve.html','Gjyqtarëve dhe Prokurorëve':'statusi-gjyqtareve-prokuroreve.html',
        'Organizimit të Pushtetit Gjyqësor (i përditësuar)':'organizimi-pushtetit-gjyqesor-v2.html'
      };
      var LAW_NAMES_SORTED = Object.keys(LAW_MAP).sort(function(a,b){ return b.length - a.length; });
      var LAW_RE = new RegExp('(' + LAW_NAMES_SORTED.map(function(n){ return n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }).join('|') + ')','g');

      var _artHref={};  // base article number -> {href,anchor}, for linking "Neni X" to real text
      function linkifyText(t){
        t = t.replace(LAW_RE, function(m){ return '<a href="' + LAW_BASE + LAW_MAP[m] + '" target="_blank" rel="noopener noreferrer" class="opinion-law-link">' + m + '</a>'; });
        t = t.replace(/\b([Nn]eni(?:t|n|ve)?)\s+(\d+(?:\/[\w]+)?)/g, function(m,word,num){
          var a=_artHref[String(num).split('/')[0]];
          return a ? '<a href="'+LAW_BASE+a.href+'#'+a.anchor+'" target="_blank" rel="noopener noreferrer" class="opinion-law-link">'+m+'</a>' : m;
        });
        return t;
      }
      function linkifyHtml(html){ return html.replace(/(<[^>]+>)|([^<]+)/g, function(_,tag,text){ return tag ? tag : linkifyText(text); }); }

      // ── Grounding: fetch real article text from data/<slug>.json ─────────────
      function lawDataPath(htmlFile){ return 'data/'+htmlFile.replace(/\.html$/,'.json'); }
      var _lawCache={};
      function fetchLawData(htmlFile){
        if(_lawCache[htmlFile]) return Promise.resolve(_lawCache[htmlFile]);
        return fetch(lawDataPath(htmlFile),{signal:abortCtrl?abortCtrl.signal:undefined})
          .then(function(r){ return r.ok?r.json():{}; })
          .catch(function(e){ if(e&&e.name==='AbortError') throw e; return {}; })
          .then(function(d){ _lawCache[htmlFile]=d||{}; return _lawCache[htmlFile]; });
      }
      function artKey(s){ var m=String(s).match(/\d+(?:\/[\w]+)?/); return m?m[0]:''; }
      function artAnchor(num){ return 'neni-'+String(num).replace('/','-'); }
      function lawHrefFor(name){
        if(LAW_MAP[name]) return LAW_MAP[name];
        for(var i=0;i<LAW_NAMES_SORTED.length;i++){
          var k=LAW_NAMES_SORTED[i];
          if(name.indexOf(k)!==-1||k.indexOf(name)!==-1) return LAW_MAP[k];
        }
        return '';
      }
      function retrieveGrounding(laws){
        laws=laws||[];
        var jobs=laws.map(function(l){
          var href=lawHrefFor(String(l.name||''));
          if(!href) return Promise.resolve({law:l,href:'',data:{}});
          return fetchLawData(href).then(function(data){ return {law:l,href:href,data:data}; });
        });
        return Promise.all(jobs).then(function(rows){
          var found=[],missing=[],nums={},seen={},blocks=[];
          rows.forEach(function(row){
            var name=String(row.law.name||'').trim();
            (row.law.articles||[]).forEach(function(a){
              var num=artKey(a);
              if(!num) return;
              var key=name+'|'+num;
              if(seen[key]) return;
              seen[key]=true;
              var text=row.data[num];
              if(text){
                var clean=String(text).replace(/\s+/g,' ').trim();
                found.push({law:name,num:num,href:row.href,anchor:'neni-'+String(num).replace('/','-'),text:clean});
                nums[num.split('/')[0]]=true;
                blocks.push('Neni '+num+' ('+name+'): «'+clean.slice(0,1200)+'»');
              } else {
                missing.push({law:name,num:num});
              }
            });
          });
          // cross-reference expansion: pull nene cited INSIDE the grounded texts (one hop, capped)
          var dataByLaw={}; rows.forEach(function(r){ dataByLaw[String(r.law.name||'').trim()]={data:r.data,href:r.href}; });
          var baseFound=found.slice(), extra=0, XCAP=6;
          baseFound.forEach(function(f){
            if(extra>=XCAP) return; var li=dataByLaw[f.law]; if(!li) return;
            var rr=/nen(?:i|it|in|et|eve)?\s+(\d+(?:\/[\w]+)?)/gi, mm;
            while(extra<XCAP && (mm=rr.exec(f.text))!==null){
              var rn=artKey(mm[1]); if(!rn) continue;
              var key=f.law+'|'+rn; if(seen[key]) continue;
              var t=li.data[rn]; if(!t) continue;
              seen[key]=true;
              var clean=String(t).replace(/\s+/g,' ').trim();
              found.push({law:f.law,num:rn,href:li.href,anchor:'neni-'+String(rn).replace('/','-'),text:clean,xref:true});
              nums[rn.split('/')[0]]=true;
              blocks.push('Neni '+rn+' ('+f.law+', referuar brenda tekstit): «'+clean.slice(0,900)+'»');
              extra++;
            }
          });
          var text=blocks.length
            ?'TEKSTI ZYRTAR I NENEVE (mbështetu VETËM mbi këto; mos cito nene që nuk janë dhënë këtu):\n\n'+blocks.join('\n\n')
            :'';
          return {text:text,found:found,missing:missing,nums:nums};
        });
      }

      // ── Property-protection concept: detection, primer, keyword grounding ──
      var PROP_RE = /pron|rivendik|mohues|posedim|cenim|pengo|servitut|kufi|uzurp|tjet[ëe]rsim|mbajt[ëe]s/i;
      function detectProperty(s){ return PROP_RE.test(String(s||'')); }
      var PROPERTY_PRIMER = '\n\nUDHËZIM (mbrojtja e pronësisë): Kjo çështje lidhet me mbrojtjen e së drejtës reale. Merr parasysh paditë reale të së drejtës civile shqiptare: padia rivendikuese (pronari kërkon sendin nga poseduesi ose mbajtësi pa titull), padia mohuese (pronari kërkon pushimin e cenimeve ose shqetësimeve që NUK përbëjnë privim të posedimit) dhe padia pohuese e pronësisë. Identifiko dhe cito nenet përkatëse të Kodit Civil për mbrojtjen e pronësisë dhe të posedimit, sipas tekstit zyrtar të dhënë.';
      var PROPERTY_KEYWORDS = [
        {w:'mohues',s:3},{w:'rivendik',s:3},{w:'cenim',s:3},{w:'cenon',s:2},{w:'posedim',s:3},{w:'posedues',s:2},
        {w:'pronar',s:2},{w:'pronës',s:2},{w:'mbajtës',s:2},
        {w:'send',s:1},{w:'pengo',s:1},{w:'tjetërsim',s:1}
      ];
      var FAMILY_PRIMER = '\n\nUDHËZIM (e drejta familjare): Çështja lidhet me Kodin e Familjes. Merr parasysh: padinë për zgjidhjen e martesës (divorci) dhe shkaqet e saj, kujdestarinë dhe interesin më të lartë të fëmijës, pjesëtimin e pasurisë bashkëshortore dhe detyrimin ushqimor, si dhe atësinë ose birësimin sipas rastit. Identifiko dhe cito nenet përkatëse të Kodit të Familjes sipas tekstit zyrtar të dhënë.';
      var FAMILY_KEYWORDS = [
        {w:'divorc',s:3},{w:'kujdestar',s:3},{w:'birësim',s:3},{w:'detyrim ushqimor',s:3},
        {w:'martes',s:2},{w:'fëmij',s:2},{w:'pasuri',s:2},{w:'atësi',s:2},{w:'ushqim',s:1}
      ];
      // Concept library: case types whose governing law IS in the corpus get proactive grounding.
      var CONCEPTS = {
        prone:     {primer:PROPERTY_PRIMER, href:'kodi-civil.html',    name:'Kodi Civil',      kw:PROPERTY_KEYWORDS, limit:6},
        familjare: {primer:FAMILY_PRIMER,   href:'kodi-familjes.html', name:'Kodi i Familjes', kw:FAMILY_KEYWORDS,   limit:6}
      };
      // Scan a law's article JSON and return the top-scoring articles by keyword weight.
      function keywordGround(href, lawName, kw, limit){
        return fetchLawData(href).then(function(data){
          if(!data) return {found:[]};
          var scored=[];
          Object.keys(data).forEach(function(num){
            var t=String(data[num]||'').toLowerCase();
            if(!t) return;
            var score=0;
            kw.forEach(function(o){ if(t.indexOf(o.w)!==-1) score+=o.s; });
            if(score>=4) scored.push({num:num,score:score,text:String(data[num]).replace(/\s+/g,' ').trim()});
          });
          scored.sort(function(a,b){ return b.score-a.score; });
          var found=scored.slice(0,limit).map(function(x){
            return {law:lawName,num:x.num,href:href,anchor:'neni-'+String(x.num).replace('/','-'),text:x.text};
          });
          return {found:found};
        }).catch(function(e){ if(e&&e.name==='AbortError') throw e; return {found:[]}; });
      }
      // Merge keyword-grounded articles into an existing grounding object (dedup by law|num).
      function mergeGrounding(g, kg){
        if(!g||!kg||!kg.found||!kg.found.length) return;
        g.found=g.found||[]; g.nums=g.nums||{};
        var seen={}; g.found.forEach(function(f){ seen[f.law+'|'+f.num]=true; });
        var added=[];
        kg.found.forEach(function(f){
          var k=f.law+'|'+f.num; if(seen[k]) return; seen[k]=true;
          g.found.push(f); g.nums[String(f.num).split('/')[0]]=true;
          added.push('Neni '+f.num+' ('+f.law+'): «'+String(f.text).slice(0,1200)+'»');
        });
        if(!added.length) return;
        var intro='TEKSTI ZYRTAR I NENEVE (mbështetu VETËM mbi këto; mos cito nene që nuk janë dhënë këtu):\n\n';
        g.text=(g.text? g.text+'\n\n' : intro)+added.join('\n\n');
      }

      // ── Semantic citation re-ranking (Gemini embeddings; additive + graceful) ──
      function _cosine(a,b){ var s=0,na=0,nb=0,n=Math.min(a.length,b.length); for(var i=0;i<n;i++){ s+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; } return (na&&nb)?s/(Math.sqrt(na)*Math.sqrt(nb)):0; }
      var _STOP={}; 'dhe ose njё nje per nga me te ta se si ku kur qe ne eshte jane qene ka kane pas para mbi nen sipas cdo kjo ato kete keto'.split(' ').forEach(function(w){ _STOP[w]=1; });
      function _factTerms(s){ var seen={},out=[]; String(s||'').toLowerCase().split(/[^a-zçë0-9]+/).forEach(function(w){ if(w.length>=4&&!_STOP[w]&&!seen[w]){ seen[w]=1; out.push(w); } }); return out; }
      // Keyword-recall candidates from the identified laws -> one batch embedding -> cosine top-K.
      function semanticGround(laws, factsText){
        if(typeof aiEmbed!=='function') return Promise.resolve(null);
        var terms=_factTerms(factsText); if(!terms.length) return Promise.resolve(null);
        return Promise.all((laws||[]).map(function(l){
          var href=lawHrefFor(String(l.name||'')); if(!href) return Promise.resolve(null);
          return fetchLawData(href).then(function(data){ return {name:String(l.name||'').trim(),href:href,data:data||{}}; }).catch(function(){ return null; });
        })).then(function(rows){
          var cands=[];
          rows.forEach(function(row){ if(!row) return;
            Object.keys(row.data).forEach(function(num){
              var t=String(row.data[num]||''); if(!t) return; var tl=t.toLowerCase(), sc=0;
              terms.forEach(function(w){ if(tl.indexOf(w)!==-1) sc++; });
              if(sc>0) cands.push({law:row.name,href:row.href,num:num,text:t.replace(/\s+/g,' ').trim(),kw:sc});
            });
          });
          if(!cands.length) return null;
          cands.sort(function(a,b){ return b.kw-a.kw; });
          cands=cands.slice(0,40);
          var inputs=[String(factsText).slice(0,1500)].concat(cands.map(function(c){ return c.text.slice(0,500); }));
          return aiEmbed(inputs).then(function(vecs){
            if(!vecs||vecs.length!==inputs.length) return null;
            var q=vecs[0];
            cands.forEach(function(c,i){ c.sim=_cosine(q,vecs[i+1]); });
            cands.sort(function(a,b){ return b.sim-a.sim; });
            return {found: cands.slice(0,6).map(function(c){ return {law:c.law,num:c.num,href:c.href,anchor:'neni-'+String(c.num).replace('/','-'),text:c.text}; })};
          });
        }).catch(function(){ return null; });
      }

      function doctrineSpec(type){
        if(type==='penale'){
          return {
            sys:'Jeni profesor i së drejtës penale shqiptare. Analizoni përbërjen e veprës penale sipas teorisë klasike me katër elementë (objekti, ana objektive, subjekti, ana subjektive). Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas. Mbështetuni te teksti zyrtar i neneve të dhëna; mos shpikni numra nenesh apo emra veprash penale.',
            tmpl:'{"framework":"penale","vepra":"emri i mundshëm i veprës penale","kuadri":[{"id":"objekti","titull":"Objekti i veprës penale","permbajtja":[{"etikete":"I përgjithshëm","vlera":"..."},{"etikete":"Specifik / i drejtpërdrejtë","vlera":"..."},{"etikete":"Objekti material / subjekti pasiv","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"çfarë e provon ose çfarë mungon"},{"id":"ana_objektive","titull":"Ana objektive","permbajtja":[{"etikete":"Veprimi / mosveprimi","vlera":"..."},{"etikete":"Pasoja","vlera":"..."},{"etikete":"Lidhja shkakësore","vlera":"..."},{"etikete":"Rrethanat (kohë/vend/mjet)","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"subjekti","titull":"Subjekti i veprës penale","permbajtja":[{"etikete":"Lloji i subjektit","vlera":"..."},{"etikete":"Përgjegjshmëria","vlera":"..."},{"etikete":"Mosha","vlera":"..."},{"etikete":"Cilësi të veçanta","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"ana_subjektive","titull":"Ana subjektive","permbajtja":[{"etikete":"Forma e fajit","vlera":"dashje e drejtpërdrejtë/e tërthortë ose pakujdesi (me vetëbesim/nga shkujdesja)"},{"etikete":"Motivi","vlera":"..."},{"etikete":"Qëllimi","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"neni":"neni/paragrafi i mundshëm","forma":"bazë / e kualifikuar / e privilegjuar","stadi":"përgatitje / tentativë / e konsumuar","bashkepunimi":"nëse ka: organizator/ekzekutor/shtytës/ndihmës"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga vepra penale të ngjashme","perfundim":"a përmbushet përbërja e veprës penale dhe ku qëndron pika kyçe"}'
          };
        }
        if(type==='prone'){
          return {
            sys:'Jeni profesor i së drejtës civile shqiptare, i specializuar në të drejtat reale dhe mbrojtjen e pronësisë. Analizoni çështjen sipas padive reale (padia rivendikuese, padia mohuese, padia pohuese e pronësisë), jo sipas përgjegjësisë për dëmin. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas. Mbështetuni te teksti zyrtar i neneve të dhëna; mos shpikni numra nenesh.',
            tmpl:'{"framework":"prone","vepra":"lloji i padisë reale dhe e drejta që mbrohet","kuadri":[{"id":"titulli","titull":"E drejta reale e paditësit (titulli)","permbajtja":[{"etikete":"Lloji i së drejtës","vlera":"pronësi / posedim / e drejtë tjetër reale"},{"etikete":"Prova e titullit","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"çfarë e provon ose çfarë mungon"},{"id":"cenimi","titull":"Cenimi ose privimi","permbajtja":[{"etikete":"Natyra","vlera":"privim posedimi (→ rivendikuese) ose shqetësim pa privim (→ mohuese)"},{"etikete":"Vazhdimësia / rreziku","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"paligjshmeria","titull":"Paligjshmëria e veprimit të të paditurit","permbajtja":[{"etikete":"Mungesa e titullit/të drejtës së tij","vlera":"..."},{"etikete":"Mbrojtje të mundshme të të paditurit","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"mbrojtja","titull":"Kërkimi / mbrojtja juridike","permbajtja":[{"etikete":"Çfarë kërkohet","vlera":"kthim sendi / pushim cenimi / njohje pronësie"},{"etikete":"Baza ligjore","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"lloji_padise":"rivendikuese / mohuese / pohuese","parashkrimi":"padia rivendikuese si rregull nuk parashkruhet; për të tjerat sipas rastit"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi mes padisë rivendikuese, mohuese dhe asaj të posedimit","perfundim":"a përmbushen elementet, lloji i padisë së përshtatshme dhe pika kyçe"}'
          };
        }
        if(type==='familjare'){
          return {
            sys:'Jeni profesor i së drejtës familjare shqiptare. Analizoni çështjen sipas Kodit të Familjes (zgjidhja e martesës, kujdestaria dhe interesi më i lartë i fëmijës, pjesëtimi i pasurisë bashkëshortore, detyrimi ushqimor, atësia/birësimi). Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas. Mbështetuni te teksti zyrtar i neneve të dhëna; mos shpikni numra.',
            tmpl:'{"framework":"familjare","vepra":"natyra e çështjes familjare","kuadri":[{"id":"marredhenia","titull":"Marrëdhënia familjare & legjitimimi","permbajtja":[{"etikete":"Lidhja (martesë/farefisni)","vlera":"..."},{"etikete":"Palët & legjitimimi","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"çfarë e provon ose çfarë mungon"},{"id":"baza","titull":"Baza ligjore e kërkesës","permbajtja":[{"etikete":"Shkaqet/kushtet","vlera":"shkaqet e divorcit ose kushtet e kujdestarisë/ushqimores"}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"femija","titull":"Interesi më i lartë i fëmijës","permbajtja":[{"etikete":"Kujdestaria/takimet","vlera":"..."},{"etikete":"Faktorët e vlerësimit","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"nëse nuk ka fëmijë, shëno se nuk zbatohet"},{"id":"pasoja","titull":"Pasojat pasurore & detyrimi ushqimor","permbajtja":[{"etikete":"Pjesëtimi i pasurisë","vlera":"..."},{"etikete":"Detyrimi ushqimor","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"lloji_ceshtjes":"divorc / kujdestari / ushqimore / birësim / atësi","afatet":"afate të mundshme"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga procedura të ngjashme familjare","perfundim":"a përmbushen kushtet dhe pika kyçe për interesin e fëmijës dhe palëve"}'
          };
        }
        if(type==='pune'){
          return {
            sys:'Jeni profesor i së drejtës së punës shqiptare. Analizoni vlefshmërinë e masës ndaj punëmarrësit (zgjidhja e kontratës, pushimi, diskriminimi). SHËNIM: Kodi i Punës mund të mos jetë në bazën e dhënë; mos shpikni numra nenesh dhe mbështetuni te teksti zyrtar kur jepet. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas.',
            tmpl:'{"framework":"pune","vepra":"natyra e mosmarrëveshjes së punës","kuadri":[{"id":"marredhenia","titull":"Marrëdhënia e punës","permbajtja":[{"etikete":"Ekzistenca & lloji i kontratës","vlera":"..."},{"etikete":"Kohëzgjatja","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"shkaku","titull":"Shkaku i masës/zgjidhjes","permbajtja":[{"etikete":"Arsyeja","vlera":"..."},{"etikete":"A është i justifikuar","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"procedura","titull":"Procedura & afatet","permbajtja":[{"etikete":"Njoftimi/dëgjimi","vlera":"..."},{"etikete":"Forma & afati","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"pasoja","titull":"Pasojat & mbrojtja","permbajtja":[{"etikete":"Dëmshpërblim/rikthim","vlera":"..."},{"etikete":"Të drejta të papaguara","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"lloji":"zgjidhje kontrate / pushim / diskriminim / pagesa","parashkrimi":"afati i mundshëm i padisë"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga institute të ngjashme të punës","perfundim":"a është e vlefshme masa dhe pika kyçe"}'
          };
        }
        if(type==='administrative'){
          return {
            sys:'Jeni profesor i së drejtës administrative shqiptare. Analizoni ligjshmërinë e aktit administrativ sipas shkaqeve klasike të pavlefshmërisë (kompetenca, procedura/forma, ligjshmëria materiale dhe qëllimi, cenimi i të drejtave). Mos shpikni numra nenesh; mbështetuni te teksti zyrtar kur jepet. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas.',
            tmpl:'{"framework":"administrative","vepra":"akti administrativ i kundërshtuar","kuadri":[{"id":"kompetenca","titull":"Kompetenca e organit","permbajtja":[{"etikete":"A ishte organ kompetent","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"procedura","titull":"Procedura & forma","permbajtja":[{"etikete":"Respektimi i procedurës","vlera":"..."},{"etikete":"Arsyetimi & forma","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"ligjshmeria","titull":"Ligjshmëria materiale & qëllimi","permbajtja":[{"etikete":"Baza ligjore","vlera":"..."},{"etikete":"Keqpërdorim i pushtetit","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"e_drejta","titull":"Cenimi i të drejtës & afati","permbajtja":[{"etikete":"Interesi i cenuar","vlera":"..."},{"etikete":"Afati i ankimit","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"lloji_aktit":"individual / nënligjor","afati_ankimit":"afati i mundshëm"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga ankimi në rrugë administrative kundrejt asaj gjyqësore","perfundim":"a është i ligjshëm akti dhe baza më e fortë e kundërshtimit"}'
          };
        }
        if(type==='konsumator'){
          return {
            sys:'Jeni jurist shqiptar i specializuar në mbrojtjen e konsumatorit. Analizoni çështjen sipas të drejtave të konsumatorit (mospërputhja/defekti, garancia, detyrimet e tregtarit, mjetet juridike). Mos shpikni numra nenesh; mbështetuni te teksti zyrtar kur jepet. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas.',
            tmpl:'{"framework":"konsumator","vepra":"natyra e ankesës konsumatore","kuadri":[{"id":"subjektet","titull":"Cilësia e konsumatorit & tregtarit","permbajtja":[{"etikete":"Konsumator","vlera":"..."},{"etikete":"Tregtar/ofrues","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"mosperputhja","titull":"Mospërputhja ose defekti","permbajtja":[{"etikete":"Defekti/mungesa e konformitetit","vlera":"..."},{"etikete":"Koha e shfaqjes","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"detyrimet","titull":"Detyrimet e tregtarit & garancia","permbajtja":[{"etikete":"Garancia ligjore/tregtare","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"mjetet","titull":"Mjetet juridike","permbajtja":[{"etikete":"Riparim/zëvendësim","vlera":"..."},{"etikete":"Ulje çmimi/zgjidhje/dëm","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"baza":"Kodi Civil / legjislacioni i mbrojtjes së konsumatorit","afatet":"afati i ankesës ose i garancisë"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga përgjegjësia e përgjithshme civile","perfundim":"a përmbushen kushtet dhe mjeti më i përshtatshëm"}'
          };
        }
        if(type==='civile'||type==='tregtare'){
          return {
            sys:'Jeni profesor i së drejtës private shqiptare. Analizoni elementet e përgjegjësisë juridike (veprimi i paligjshëm, dëmi, lidhja shkakësore, faji ose përgjegjësia objektive). Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas. Mbështetuni te teksti zyrtar i neneve të dhëna.',
            tmpl:'{"framework":"'+type+'","vepra":"natyra e mosmarrëveshjes","kuadri":[{"id":"veprimi","titull":"Veprimi / mosveprimi i paligjshëm","permbajtja":[{"etikete":"Sjellja","vlera":"..."},{"etikete":"Kundërligjshmëria","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"demi","titull":"Dëmi","permbajtja":[{"etikete":"Dëmi i dalshëm","vlera":"..."},{"etikete":"Fitimi i munguar","vlera":"..."},{"etikete":"Dëmi jopasuror","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"lidhja","titull":"Lidhja shkakësore","permbajtja":[{"etikete":"Shkak → pasojë","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"faji","titull":"Faji / përgjegjësia","permbajtja":[{"etikete":"Forma e fajit","vlera":"..."},{"etikete":"Përgjegjësi objektive (pa faj)?","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"lloji_pergjegjesise":"kontraktore / jashtëkontraktore","parashkrimi":"afati i mundshëm"},"rrethanat":{"lehtesuese":["..."],"renduese":["..."]},"dallimi":"dallimi nga institute të ngjashme","perfundim":"a përmbushen elementet dhe ku qëndron pika kyçe"}'
          };
        }
        return {
          sys:'Jeni jurist i specializuar shqiptar. Dekompononi çështjen në elementet juridike përbërëse. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas. Mbështetuni te teksti zyrtar i neneve të dhëna.',
          tmpl:'{"framework":"'+(type||'juridik')+'","vepra":"natyra juridike e çështjes","kuadri":[{"id":"subjektet","titull":"Subjektet e marrëdhënies","permbajtja":[{"etikete":"Palët / legjitimimi","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"objekti","titull":"Objekti i marrëdhënies","permbajtja":[{"etikete":"E drejta / detyrimi","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"faktet","titull":"Faktet juridike","permbajtja":[{"etikete":"Veprimi / ngjarja","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."},{"id":"pasojat","titull":"Pasojat juridike","permbajtja":[{"etikete":"Efektet","vlera":"..."}],"vleresim":"plotesuar|pjeserisht|munget","shenim":"..."}],"kualifikimi":{"baza":"baza ligjore","afatet":"afatet e zbatueshme"},"rrethanat":{"lehtesuese":[],"renduese":[]},"dallimi":"","perfundim":"..."}'
        };
      }
      function doctrineSummaryText(d){
        if(!d||!d.kuadri||!d.kuadri.length) return '';
        var lines=d.kuadri.map(function(e){ return '- '+(e.titull||e.id)+': '+(e.vleresim||'')+(e.shenim?(' — '+e.shenim):''); });
        var q='';
        if(d.kualifikimi){ q=Object.keys(d.kualifikimi).map(function(k){ return d.kualifikimi[k]?(k.replace(/_/g,' ')+': '+d.kualifikimi[k]):''; }).filter(Boolean).join('; '); }
        return '\n\nDEKOMPOZIMI DOKTRINOR (përfshije në seksionin ANALIZË LIGJORE):\n'+lines.join('\n')+(q?('\nKualifikimi: '+q):'')+(d.perfundim?('\nPërfundim: '+d.perfundim):'');
      }

      var FORMAL_HEADS = /^(FAKTE|BAZ[ËE] LIGJORE|BAZE LIGJORE|ANALIZ[ËE] LIGJORE|ANALIZE LIGJORE|KUND[ËE]RP[ËE]RGJIGJE|KUNDERPERGJIGJE|KONKLUZIONE|REKOMANDIME)\s*:?\s*$/;
      function inlineMd(t){ return t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>'); }
      function mdToHtml(raw){
        var lines = esc(raw).split('\n'), out = '', listType = null, olIdx = 0;
        function closeList(){ if(listType){ out += '</'+listType+'>'; listType = null; } }
        for(var i=0;i<lines.length;i++){
          var line=lines[i].trim();
          if(!line){ closeList(); continue; }
          var h=line.match(/^#{1,4}\s+(.*)$/);
          if(h){ closeList(); olIdx=0; out+='<h3 class="opinion-section-head">'+inlineMd(h[1])+'</h3>'; continue; }
          if(FORMAL_HEADS.test(line)){ closeList(); olIdx=0; out+='<h3 class="opinion-section-head">'+line.replace(/:$/,'')+'</h3>'; continue; }
          var ul=line.match(/^[-•*]\s+(.*)$/);
          if(ul){ if(listType!=='ul'){ closeList(); olIdx=0; out+='<ul class="opinion-md-list">'; listType='ul'; } out+='<li>'+inlineMd(ul[1])+'</li>'; continue; }
          var ol=line.match(/^\d+[.)]\s+(.*)$/);
          if(ol){ if(listType!=='ol'){ closeList(); out+='<ol class="opinion-md-list">'; listType='ol'; } out+='<li value="'+(++olIdx)+'">'+inlineMd(ol[1])+'</li>'; continue; }
          closeList(); olIdx=0; out+='<p>'+inlineMd(line)+'</p>';
        }
        closeList(); return linkifyHtml(out);
      }

      var steps = [1,2,3,4,5,6,7,8,9].map(function(i){ return $('op-step-'+i); });
      function rowActive(i){ steps[i].classList.add('active'); steps[i].classList.remove('done','failed'); }
      function rowDone(i){ steps[i].classList.remove('active','failed'); steps[i].classList.add('done'); }
      function rowFail(i){ steps[i].classList.remove('active','done'); steps[i].classList.add('failed'); }
      function resetRows(){ steps.forEach(function(s){ s.classList.remove('active','done','failed'); }); }

      var abortCtrl = null;

      function callGroq(sys, usr, maxTok, temp, strong){
        var payload = { max_tokens:maxTok, temperature:(typeof temp==='number')?temp:0.4, messages:[{role:'system',content:sys},{role:'user',content:usr}] };
        var chain = (typeof aiChain==='function') ? aiChain(strong) : (typeof AI_PROVIDERS!=='undefined'?AI_PROVIDERS:null);
        var providers = (chain && chain.length) ? chain : [{url:GROQ_URL, key:getKey(), model:MODEL}];
        function tryProvider(pi){
          var p = providers[pi];
          var body = JSON.stringify(Object.assign({model:p.model}, payload));
          function attempt(n){
            // Per-attempt timeout (same AI_TIMEOUT_MS/withTimeout as ai.js's aiFetch) so a
            // hung provider advances the retry/fallback chain instead of stalling forever.
            var t=withTimeout(abortCtrl?abortCtrl.signal:undefined, AI_TIMEOUT_MS);
            return fetch(p.url, { method:'POST', signal:t.signal, headers:{'Authorization':'Bearer '+p.key,'Content-Type':'application/json'}, body:body })
            .then(function(res){
              t.done();
              if((res.status===429||res.status>=500)&&n<MAX_RETRIES) return delay(backoff(n)).then(function(){ return attempt(n+1); });
              return res.json().catch(function(){ return {}; }).then(function(data){
                if(!res.ok){ var msg=(data&&data.error&&data.error.message)||('HTTP '+res.status); var e=new Error(msg); e.status=res.status; throw e; }
                var content=(data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
                if(!content) throw new Error('Përgjigje boshe nga modeli');
                return content;
              });
            }).catch(function(err){
              t.done();
              var callerAborted=abortCtrl&&abortCtrl.signal&&abortCtrl.signal.aborted;
              if(err&&err.name==='AbortError'&&callerAborted) throw err;   // real user cancel -> propagate
              if(err&&err.name==='AbortError'&&n<MAX_RETRIES) return delay(backoff(n)).then(function(){ return attempt(n+1); }); // our own timeout -> retry/fallback
              var st=err&&err.status;
              if(st&&st>=400&&st<500&&st!==429) throw err;   // bad key/model -> don't retry, fall to next provider
              if(n<MAX_RETRIES) return delay(backoff(n)).then(function(){ return attempt(n+1); });
              throw err;
            });
          }
          // per-provider retries exhausted -> fall back to the next configured provider
          // (an AbortError here is only a real cancel if the caller's own signal fired —
          // one that came from our per-attempt timeout must still advance the chain)
          return attempt(0).catch(function(err){
            var callerAborted=abortCtrl&&abortCtrl.signal&&abortCtrl.signal.aborted;
            if(err&&err.name==='AbortError'&&callerAborted) throw err;
            if(pi+1 < providers.length) return tryProvider(pi+1);
            throw err;
          });
        }
        return tryProvider(0);
      }

      function runCall(id, sys, usr, maxTok, temp, strong){ return callGroq(sys, usr, maxTok, temp, strong); }

      function runLimited(tasks, limit){
        var results=new Array(tasks.length), idx=0;
        function worker(){ if(idx>=tasks.length) return Promise.resolve(); var cur=idx++; return Promise.resolve().then(function(){ return tasks[cur](); }).then(function(v){ results[cur]=v; return worker(); }); }
        var n=Math.min(limit,tasks.length), workers=[];
        for(var i=0;i<n;i++) workers.push(worker());
        return Promise.all(workers).then(function(){ return results; });
      }

      var TYPE_LABELS = { civile:'Çështje Civile',penale:'Çështje Penale',tregtare:'Çështje Tregtare',administrative:'Çështje Administrative',familjare:'E Drejtë Familjare',pune:'E Drejtë Pune',prone:'E Drejtë Prone',konsumator:'Mbrojtja e Konsumatorit' };
      var DEGRADED = '<p class="op-degraded">Kjo pjesë nuk u gjenerua. Mund të rishtypni analizën ose të vazhdoni me seksionet e tjera.</p>';
      var ANTI_HALLUC = ' Cito vetëm ligje dhe nene për të cilat je i sigurt; nëse nuk je i sigurt për numrin e saktë të nenit, përshkruaje ligjin pa shpikur numra. Mos shpik emra ose numra çështjesh gjyqësore.';

      function pad2(n){ return String(n).padStart(2,'0'); }

      function renderMeta(type){ $('opinion-doc-meta').textContent=JurDate.fmt(new Date())+' · '+(TYPE_LABELS[type]||''); }

      function renderStrength(s){
        var score=parseFloat(s.score); if(!isFinite(score)) score=5;
        var pct=Math.max(0,Math.min(10,score)), col=pct>=7?'#3d706a':pct>=4?'#b8923a':'#b15c44';
        var bar=$('op-strength-bar');
        requestAnimationFrame(function(){ bar.style.width=(pct*10)+'%'; bar.style.background=col; });
        var el=$('op-strength-score'); el.textContent=pct.toFixed(1)+' / 10'+(s.label?' - '+s.label:'')+(s._capped?' · i kufizuar: '+s._capped:''); el.style.color=col;
      }

      function renderAnalysis(laws, s){
        var html='';
        if(laws.length){ html+='<ul class="opinion-list">'; laws.forEach(function(l){ html+='<li><strong>'+esc(l.name)+'</strong>'; if(l.articles&&l.articles.length) html+=' <span class="op-articles">'+esc(l.articles.join(', '))+'</span>'; if(l.relevance) html+='<br><span class="op-relevance">'+esc(l.relevance)+'</span>'; html+='</li>'; }); html+='</ul>'; }
        function bullets(title,cls,arr){ if(!arr||!arr.length) return ''; var h='<p class="op-subhead '+cls+'">'+title+'</p><ul class="opinion-list">'; arr.forEach(function(x){ h+='<li>'+esc(x)+'</li>'; }); return h+'</ul>'; }
        html+=bullets('Forcat e pozicionit','op-green',s.strengths);
        html+=bullets('Dobësi dhe rreziqe','op-amber',s.weaknesses);
        // missing_evidence now lives solely in the answerable "Çfarë mungon" block
        $('op-out-analysis').innerHTML=html;
      }

      // ── Compensation/forecast: deterministic computation (replaces LLM number guesses) ──
      function parseAmount(s){
        if(s==null) return null;
        var str=String(s).toLowerCase().replace(/\s/g,'');
        var mult=1;
        if(/milion|mln/.test(str)) mult=1000000; else if(/mij[ëe]|mije/.test(str)) mult=1000;
        var m=str.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?/);
        if(!m) return null;
        var num=parseFloat(m[1].replace(/[.,]/g,'')+(m[2]?('.'+m[2]):''));
        if(!isFinite(num)||num<=0) return null;
        return Math.round(num*mult);
      }
      function extractClaimFromFacts(facts){
        var best=null, re=/(\d{1,3}(?:[.\s,]\d{3})+|\d{3,})\s*(lek[ëe]?|leke|€|eur|euro|usd|\$|mij[ëe]|milion|mln)?/gi, m;
        while((m=re.exec(String(facts||'')))!==null){ var v=parseAmount(m[0]); if(v&&(best==null||v>best)) best=v; }
        return best;
      }
      var DURATION={ civile:[8,18], tregtare:[8,18], prone:[8,20], konsumator:[6,14], pune:[4,12], familjare:[3,10], penale:[6,18], administrative:[4,12] };
      function scoreWinLose(score){
        var sc=parseFloat(score); if(!isFinite(sc)) sc=5; sc=Math.max(0,Math.min(10,sc));
        var win=Math.round(Math.max(5,Math.min(88, sc*8.5)));
        var lose=Math.round(Math.max(5,Math.min(80, (10-sc)*5.5)));
        return {win:win, settle:Math.max(5,100-win-lose), lose:lose};
      }
      function computeForecast(claim, score, type){
        var wl=scoreWinLose(score), d=DURATION[type]||[6,16];
        var f={win:wl.win, settle:wl.settle, lose:wl.lose, currency:'L', months_min:d[0], months_max:d[1], basis:[]};
        f.basis.push('Gjasat rrjedhin nga pozicioni ('+((parseFloat(score)||5)).toFixed(1)+'/10), pra përputhen me vlerësimin.');
        f.basis.push('Kohëzgjatja: vlerësim orientues për shkallën e parë sipas llojit të çështjes.');
        if(claim&&claim>0){
          var tax=Math.round(claim*0.01), lawMin=Math.max(15000,Math.round(claim*0.04)), lawMax=Math.max(40000,Math.round(claim*0.10));
          f.cost_min=tax+lawMin; f.cost_max=tax+lawMax; f.claim=claim;
          f.basis.push('Kosto = taksa gjyqësore ~1% ('+fmtNum(tax)+' L) + tarifa avokati/ekspertize (vlerësim).');
        }
        return f;
      }

      // ── deterministic limitation (parashkrim) check — reads the canonical JUR_LIMITS table ──
      // A case type can map to several claim kinds (e.g. civile → kontratë 10 vjet / dëm 3 vjet):
      // 'likely-barred' only when ALL applicable periods have run out; 'partial' when only some have.
      function checkLimitation(type, dateStr){
        if(!dateStr) return {status:'na'};
        var d=JurDate.parseISO(dateStr);
        if(!d) return {status:'na', note:'Data e dhënë nuk është e vlefshme.'};
        var today=JurDate.today();
        if(d>today) return {status:'future', note:'Data e ngjarjes është në të ardhmen — kontrolloni datën.'};
        var elapsedText=JurDate.spanText(d,today);
        var kinds=JUR_LIMITS.byCaseType[type]||[];
        var out={ status:'within', note:'', elapsedText:elapsedText, elapsedDays:JurDate.diffDays(d,today), rules:[] };
        if(!kinds.length){ out.note='Për këtë lloj çështjeje shumë kërkesa nuk kanë parashkrim klasik; afati varet nga kërkesa konkrete. Kanë kaluar '+elapsedText+'.'; return out; }
        var judged=[];
        kinds.forEach(function(k){
          var r=JUR_LIMITS.rules[k]; if(!r) return;
          if(r.none||r.tiered){ out.rules.push({kind:k, status:'info', note:r.basis}); return; }
          var deadline=r.days?JurDate.addDays(d,r.days):JurDate.addYears(d,r.years);
          var remaining=JurDate.diffDays(today,deadline), span=JurDate.diffDays(d,deadline);
          var st=remaining<0?'barred':(remaining<span*0.2?'near':'ok');
          var row={kind:k, status:st, deadline:deadline, remainingDays:remaining, limitLabel:r.days?(r.days+' ditë'):(r.years+' vjet')};
          judged.push(row); out.rules.push(row);
        });
        function ruleTxt(r){ return '«'+r.kind+'» ('+r.limitLabel+', '+(r.remainingDays<0?('skadoi më '+JurDate.fmt(r.deadline)):('skadon më '+JurDate.fmt(r.deadline)))+')'; }
        var barred=judged.filter(function(r){ return r.status==='barred'; });
        var near=judged.filter(function(r){ return r.status==='near'; });
        if(judged.length&&barred.length===judged.length){
          out.status='likely-barred';
          out.note='Kanë kaluar '+elapsedText+' — '+judged.map(ruleTxt).join('; ')+'. Kërkesa MUND të jetë parashkruar; verifikoni shkaqet e ndërprerjes/pezullimit.';
        } else if(barred.length){
          out.status='partial';
          out.note='Kanë kaluar '+elapsedText+'. Afati për '+barred.map(ruleTxt).join('; ')+' ka skaduar, ndërsa '+judged.filter(function(r){ return r.status!=='barred'; }).map(ruleTxt).join('; ')+' është ende brenda afatit. Saktësoni natyrën e kërkesës.';
        } else if(near.length){
          out.status='near';
          out.note='Kanë kaluar '+elapsedText+' — afati për '+near.map(ruleTxt).join('; ')+' po afrohet; veproni shpejt.';
        } else if(judged.length){
          out.note='Brenda afatit: '+judged.map(ruleTxt).join('; ')+'. Kanë kaluar '+elapsedText+'.';
        } else {
          out.note=out.rules.map(function(r){ return '«'+r.kind+'»: '+r.note; }).join('; ')+'. Kanë kaluar '+elapsedText+'.';
        }
        return out;
      }

      // ── strength score: AI rates sub-factors, app COMPUTES the 0–10 score ──
      function SCORE_LABEL(sc){ return sc>=7.5?'Pozicion i fortë':sc>=5?'Pozicion mesatar':sc>=3.5?'Pozicion i dobët':'Pozicion shumë i dobët'; }
      function computeStrengthScore(strength, doctrine, grounding, limitation){
        function clamp2(x){ x=parseFloat(x); return isFinite(x)?Math.max(0,Math.min(2,x)):1; }
        function fval(x){ return clamp2(x&&typeof x==='object'&&x.score!=null ? x.score : x); }
        function fwhy(x){ return (x&&typeof x==='object'&&x.why)?String(x.why):''; }
        var br=[], adj=[], f=(strength&&strength.factors)||null, base;
        if(f && (f.baza!=null||f.prova!=null||f.faktet!=null||f.kundershtimi!=null)){
          var baza=fval(f.baza), prova=fval(f.prova), kund=fval(f.kundershtimi), fakt=fval(f.faktet);
          base=(baza*0.30 + prova*0.25 + (2-kund)*0.25 + fakt*0.20)*5;
          br.push({k:'Baza ligjore', v:baza, max:2, why:fwhy(f.baza)});
          br.push({k:'Forca e provave', v:prova, max:2, why:fwhy(f.prova)});
          br.push({k:'Pozicioni ndaj kundërshtimit', v:Math.round((2-kund)*10)/10, max:2, why:fwhy(f.kundershtimi)});
          br.push({k:'Qartësia e fakteve', v:fakt, max:2, why:fwhy(f.faktet)});
        } else {
          base=parseFloat(strength&&strength.score); if(!isFinite(base)) base=5;
          br.push({k:'Vlerësim bazë', v:base, max:10});
        }
        var score=base;
        var gf=(grounding&&grounding.found&&grounding.found.length)||0;
        if(gf===0){ score-=1.5; adj.push('Asnjë nen i konfirmuar në bazën ligjore: −1.5'); }
        else if(gf>=3){ score+=0.3; adj.push(gf+' nene të konfirmuara: +0.3'); }
        var miss=((strength&&strength.missing_evidence)||[]).length;
        if(miss>0){ var mp=Math.min(1.5,miss*0.3); score-=mp; adj.push(miss+' prova që mungojnë: −'+mp.toFixed(1)); }
        var capNote='';
        if(doctrine&&doctrine.kuadri&&doctrine.kuadri.length){
          var hasMissing=false,hasPartial=false,tot=0,ful=0;
          doctrine.kuadri.forEach(function(e){ var v=String(e&&e.vleresim||'').toLowerCase(); tot++; if(v.indexOf('mung')===0) hasMissing=true; else if(v.indexOf('plot')===0) ful+=1; else { hasPartial=true; ful+=0.5; } });
          if(tot>0){ var fr=ful/tot; score+=(fr-0.75)*0.8; adj.push('Përmbushja doktrinore '+Math.round(fr*100)+'%'); }
          if(hasMissing){ score=Math.min(score,4); capNote='një element thelbësor mungon'; }
          else if(hasPartial){ score=Math.min(score,6.5); capNote='një element pjesërisht i plotësuar'; }
        }
        if(limitation){
          if(limitation.status==='likely-barred'){ score=Math.min(score,3); adj.push('Mundësisht i parashkruar → kufizim te 3.0'); if(!capNote) capNote='mundësisht i parashkruar'; }
          else if(limitation.status==='partial'){ score-=1; adj.push('Një nga afatet e mundshme ka skaduar: −1.0'); }
          else if(limitation.status==='near'){ score-=1; adj.push('Afati po skadon: −1.0'); }
        }
        score=Math.max(0,Math.min(10,score));
        return { score:score, label:SCORE_LABEL(score), factors:br, adjustments:adj, capNote:capNote };
      }

      function renderScoreBreakdown(store){
        var el=$('op-out-breakdown'); if(!el) return; var sc=store.strengthCalc; if(!sc){ el.innerHTML=''; return; }
        var html='<details class="op-breakdown"><summary>Pse ky vlerësim? (logjika e pikëve)</summary><div class="op-bd-body">';
        sc.factors.forEach(function(fa){ var pct=Math.round((fa.v/fa.max)*100); html+='<div class="op-bd-row"><span class="op-bd-k">'+esc(fa.k)+'</span><span class="op-bd-track"><span class="op-bd-fill" style="width:'+pct+'%"></span></span><span class="op-bd-v">'+(Math.round(fa.v*10)/10)+'/'+fa.max+'</span></div>'+(fa.why?'<div class="op-bd-why">'+esc(fa.why)+'</div>':''); });
        if(sc.adjustments&&sc.adjustments.length){ html+='<p class="op-subhead" style="margin:12px 0 4px;">Rregullime logjike (deterministe)</p><ul class="op-checklist">'+sc.adjustments.map(function(a){ return '<li>'+esc(a)+'</li>'; }).join('')+'</ul>'; }
        var L=store.limitation;
        if(L&&L.status&&L.status!=='na'){ var cls=L.status==='likely-barred'?'op-red':(L.status==='near'||L.status==='partial'||L.status==='future')?'op-amber':'op-green'; html+='<p class="op-subhead '+cls+'" style="margin:12px 0 4px;">Afati &amp; Parashkrimi</p><div class="op-deadline-note"><div>'+esc(L.note||'')+'</div></div>'; }
        html+='<p class="op-bd-final">Rezultati i llogaritur: <strong>'+sc.score.toFixed(1)+'/10</strong>'+(sc.capNote?(' · i kufizuar: '+esc(sc.capNote)):'')+'</p>';
        el.innerHTML=html+'</div></details>';
      }

      // ── F3 damages, F4 consistency/confidence, F1 verifier ──
      function buildDamages(raw, claim, type){
        var OK={civile:1,tregtare:1,pune:1,konsumator:1,prone:1};
        if(!OK[type] || !(claim>0) || !raw || !raw.length) return null;
        var items=raw.filter(function(d){ return d&&d.head; }).map(function(d){ return {head:String(d.head), basis:String(d.basis||''), share:Math.max(0,parseFloat(d.share)||0)}; });
        if(!items.length) return null;
        var tot=items.reduce(function(s,d){ return s+d.share; },0); if(tot<=0){ items.forEach(function(d){ d.share=100/items.length; }); tot=100; }
        items.forEach(function(d){ d.pct=d.share/tot*100; d.amount=Math.round(d.pct/100*claim); });
        return items;
      }
      function stripFakeCitations(t){ if(!t) return t; return String(t).replace(/\bVendim(?:i|in|it|et|eve)?\s*nr\.?\s*[\d\/.\-]+(?:\s*,?\s*dat[ëe][^,.;\n]*)?/gi,'praktikë gjyqësore përkatëse'); }
      function enforceConsistency(text, f, score){
        if(!text||!f) return text;
        var ok=[Math.round(f.win||0),Math.round(f.settle||0),Math.round(f.lose||0)]; var sc=parseFloat(score); if(isFinite(sc)) ok.push(Math.round(sc*10));
        var ODDS=/fitim|humbj|gjas|sukses|marr[ëe]veshj|probabilitet|shanse/i;
        var bad=false, m, re=/(\d{1,3})\s*%/g;
        while((m=re.exec(text))!==null){ var p=parseInt(m[1],10); if(p<15||p>95) continue;
          var ctx=text.slice(Math.max(0,m.index-40), m.index+m[0].length+8); // only odds-context %
          if(ODDS.test(ctx) && !ok.some(function(x){ return Math.abs(x-p)<=12; })){ bad=true; }
        }
        if(!bad) return text;
        return text+'\n\n— Shënim: gjasat zyrtare të kësaj analize janë fitim '+ok[0]+'%, marrëveshje '+ok[1]+'%, humbje '+ok[2]+'%; çdo përqindje tjetër në tekst është ilustruese.';
      }
      // ── D: deterministic logical-consistency check (narrative vs computed) ──
      function enforceLogic(text, score, forecast){
        if(!text) return null;
        var sc=parseFloat(score), win=forecast?Math.round(forecast.win||0):null, lower=String(text).toLowerCase();
        var strong=/pozicion (shum[ëe] )?i fort[ëe]|gjasa? (shum[ëe] )?t[ëe] larta|shum[ëe] i favorsh[ëe]m|fitim i sigurt|mjaft i fort[ëe]/;
        var weak=/pozicion i dob[ëe]t|gjasa? t[ëe] ul[ëe]ta|i pafavorsh[ëe]m|v[ëe]shtir[ëe] p[ëe]r t[ëe] fituar/;
        if(strong.test(lower) && ((isFinite(sc)&&sc<4.5) || (win!=null&&win<40)))
          return { dir:'over', msg:'Konkluzioni përshkruan pozicion të fortë, por vlerësimi i llogaritur ('+(isFinite(sc)?sc.toFixed(1):'?')+'/10) dhe gjasat e fitimit (~'+(win!=null?win:'?')+'%) nuk e mbështesin plotësisht — vlejnë shifrat e llogaritura.' };
        if(weak.test(lower) && isFinite(sc) && sc>7)
          return { dir:'under', msg:'Konkluzioni përshkruan pozicion të dobët, por vlerësimi i llogaritur ('+sc.toFixed(1)+'/10) është i lartë.' };
        return null;
      }
      // ── B: self-correction — rewrite the opinion to fix auditor-flagged problems ──
      function runCorrection(store, problems){
        if(!problems.length || !store.opinion) return Promise.resolve(null);
        var sc=parseFloat(store.strength&&store.strength.score); sc=isFinite(sc)?sc.toFixed(1):'?';
        var f=store.forecast||{};
        var usr='MENDIMI EKZISTUES:\n'+String(store.opinion).slice(0,5200)
          +'\n\nPROBLEME TË GJETURA NGA AUDITUESI (rregulloji të gjitha):\n- '+problems.join('\n- ')
          +(store.groundingText||'')
          +'\n\nSHIFRAT AUTORITATIVE: vlerësim '+sc+'/10; fitim '+Math.round(f.win||0)+'%, marrëveshje '+Math.round(f.settle||0)+'%, humbje '+Math.round(f.lose||0)+'%.'
          +'\n\nRishkruaj TË NJËJTIN mendim ligjor me të njëjtat seksione (FAKTE, BAZË LIGJORE, ANALIZË LIGJORE, KUNDËRPËRGJIGJE, KONKLUZIONE, REKOMANDIME), duke RREGULLUAR problemet: hiq ose korrigjo citimet e kundërshtuara, mos cito nene jashtë tekstit zyrtar, dhe bëje konkluzionin në përputhje me shifrat e llogaritura. Mos shto pohime të reja të paverifikuara.';
        return runCall(11,'Jeni jurist i lartë shqiptar që rishikon e korrigjon një mendim ligjor sipas vërejtjeve të audituesit. Mbështetu vetëm te teksti zyrtar i dhënë.', usr, 2300, 0.35, true)
          .then(function(r){ return r||null; });
      }
      function computeConfidence(store){
        var found=((store.grounding&&store.grounding.found)||[]).length;
        var v=store.verify, vc=(v&&v.confidence)||'';
        var base=found>=4?2:found>=2?1:0;
        if(vc==='high') base+=1; else if(vc==='low') base-=1;
        var contra=(v&&v.citations)?v.citations.filter(function(c){ return String(c.verdict||'').indexOf('contra')===0; }).length:0;
        if(contra>0) base-=1;
        return { level:(base>=2?'hi':base>=1?'mid':'lo'), found:found, vconf:vc };
      }
      var CONF_INFO={ hi:['op-conf-hi','besueshmëri e lartë'], mid:['op-conf-mid','besueshmëri mesatare'], lo:['op-conf-lo','besueshmëri e ulët'] };
      function applyConfidenceBadges(store){
        var c=store.confidence; if(!c) return; var info=CONF_INFO[c.level]||CONF_INFO.mid;
        ['op-summary-block','op-references-block'].forEach(function(id){ var b=$(id); if(!b) return; var lab=b.querySelector('.opinion-block-label'); if(!lab) return; var old=lab.querySelector('.op-conf'); if(old) old.parentNode.removeChild(old); var s=document.createElement('span'); s.className='op-conf '+info[0]; s.textContent=info[1]; lab.appendChild(s); });
      }
      function runVerifier(store){
        if(typeof runCall!=='function') return Promise.resolve(null);
        var cited=[], seen={}, m, re=/\b[Nn]eni(?:t|n|ve)?\s+(\d+(?:\/[\w]+)?)/g;
        while((m=re.exec(store.opinion||''))!==null){ var n=m[1]; if(!seen[n]){ seen[n]=1; cited.push(n); } }
        var f=store.forecast||{}, sc=parseFloat(store.strength&&store.strength.score); sc=isFinite(sc)?sc.toFixed(1):'?';
        var usr='MENDIMI PËR T\'U KONTROLLUAR:\n'+String(store.opinion||'').slice(0,5000)
          +'\n\nNENET E CITUARA: '+(cited.slice(0,14).join(', ')||'(asnjë)')
          +(store.groundingText||'')
          +'\n\nSHIFRAT AUTORITATIVE: vlerësim '+sc+'/10; fitim '+Math.round(f.win||0)+'%, marrëveshje '+Math.round(f.settle||0)+'%, humbje '+Math.round(f.lose||0)+'%.'
          +'\n\nPër secilin nen të cituar jep verdiktin "verified" (teksti zyrtar e mbështet), "unconfirmed" (s\'ka tekst për ta vërtetuar), ose "contradicted" (teksti e kundërshton). Listo mospërputhjet dhe teprite kundrejt shifrave. JSON:\n{"citations":[{"neni":"X","verdict":"verified|unconfirmed|contradicted","note":"..."}],"issues":["..."],"corrections":["..."],"confidence":"high|medium|low"}';
        return runCall(9,'Jeni auditues i pavarur ligjor. Kontrolloni mendimin kundrejt tekstit zyrtar të neneve dhe shifrave të dhëna. Përgjigjuni VETËM me JSON të vlefshëm.',usr,800,0.2,true)
          .then(function(r){ var j=safeJson(r)||{}; return { citations:j.citations||[], issues:j.issues||[], corrections:j.corrections||[], confidence:String(j.confidence||'').toLowerCase() }; });
      }
      function renderVerify(store){
        var block=$('op-verify-block'), el=$('op-out-verify'); if(!block||!el) return;
        var v=store.verify; if(!v){ block.hidden=true; return; }
        var c=store.confidence||{level:'mid'}, lab={hi:['op-conf-hi','E lartë'],mid:['op-conf-mid','Mesatare'],lo:['op-conf-lo','E ulët']}[c.level]||['op-conf-mid','Mesatare'];
        var html='<p>Besueshmëria e përgjithshme: <span class="op-conf '+lab[0]+'">'+lab[1]+'</span> <small>('+c.found+' nene të konfirmuara në bazën ligjore)</small></p>';
        if(store.corrected) html+='<p class="op-fc-basis" style="margin-top:8px"><strong>✎ Rishikuar pas kontrollit:</strong> mendimi u rishkrua automatikisht për të rregulluar mospërputhjet e gjetura nga audituesi.</p>';
        var issues=(v.issues||[]).filter(Boolean), corr=(v.corrections||[]).filter(Boolean);
        var contra=(v.citations||[]).filter(function(x){ return String(x.verdict||'').indexOf('contra')===0; });
        if(contra.length){ html+='<p class="op-subhead op-red" style="margin:10px 0 4px;">Citime të kundërshtuara nga teksti zyrtar</p><ul class="op-checklist">'+contra.map(function(x){ return '<li>Neni '+esc(x.neni)+(x.note?': '+esc(x.note):'')+'</li>'; }).join('')+'</ul>'; }
        if(issues.length){ html+='<p class="op-subhead op-amber" style="margin:10px 0 4px;">Mospërputhje / vërejtje</p><ul class="op-checklist">'+issues.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'; }
        if(corr.length){ html+='<p class="op-subhead" style="margin:10px 0 4px;">Korrigjime të sugjeruara</p><ul class="op-checklist">'+corr.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'; }
        if(!contra.length&&!issues.length&&!corr.length) html+='<p>Nuk u gjetën mospërputhje thelbësore me tekstin zyrtar të neneve.</p>';
        el.innerHTML=html; block.hidden=false;
      }

      function renderADR(store){
        var block=$('op-adr-block'), el=$('op-out-adr'); if(!block||!el) return;
        if(!store.adr || !adrApplicable(store.type)){ block.hidden=true; return; }
        el.innerHTML=adrHtml(adrSuitability(store.type, store.forecast), store.adr); block.hidden=false;
      }
      function buildWebQuery(laws, type, facts){
        var names=(laws||[]).map(function(l){ return l.name; }).filter(Boolean).slice(0,4).join('; ');
        return 'Në shqip, shkurt: a janë ende në fuqi dhe a kanë pasur ndryshime/amendamente të fundit këto akte ligjore shqiptare: '+(names||'legjislacioni përkatës')+'? Jep statusin aktual dhe 2–4 burime zyrtare ose të besueshme (p.sh. QBZ, Kuvendi, vendime). Konteksti: çështje '+type+' — '+String(facts||'').slice(0,300)+'.';
      }
      function renderWebGround(store){
        var block=$('op-webground-block'), el=$('op-out-webground'); if(!block||!el) return;
        var w=store.webground;
        if(!w || (!w.text && (!w.sources||!w.sources.length))){ block.hidden=true; return; }
        var html='';
        if(w.text) html+='<p>'+esc(w.text)+'</p>';
        if(w.sources&&w.sources.length){ html+='<p class="op-subhead" style="margin:12px 0 6px;">Burime nga uebi</p><ul class="op-ref-list">';
          w.sources.slice(0,8).forEach(function(s){ html+='<li class="op-ref op-ref-ok"><span class="op-ref-icon">↗</span><a class="op-ref-label opinion-law-link" href="'+esc(s.uri)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a></li>'; });
          html+='</ul>'; }
        html+='<p class="op-fc-basis" style="margin-top:10px">Informacion i marrë nga kërkimi në ueb — orientues, verifikoni te burimi zyrtar.</p>';
        el.innerHTML=html; block.hidden=false;
      }
      function renderForecast(f){
        var el=$('op-out-forecast');
        if(!f||(f.win==null&&f.settle==null&&f.lose==null)){ el.innerHTML=DEGRADED; return; }
        var win=clampPct(f.win),settle=clampPct(f.settle),lose=clampPct(f.lose),sum=win+settle+lose;
        if(sum>0){ win=win/sum*100; settle=settle/sum*100; lose=lose/sum*100; }
        var cur=f.currency||'L';
        function seg(cls,val){ var w=val.toFixed(0); return '<div class="op-fc-seg '+cls+'" style="width:'+w+'%">'+(val>=12?w+'%':'')+'</div>'; }
        var html='<div class="op-forecast-bar">'+seg('op-fc-win',win)+seg('op-fc-settle',settle)+seg('op-fc-lose',lose)+'</div>'
          +'<div class="op-fc-legend"><span><i class="op-fc-dot" style="background:#3d706a"></i>Fitim '+win.toFixed(0)+'%</span><span><i class="op-fc-dot" style="background:#b8923a"></i>Marrëveshje '+settle.toFixed(0)+'%</span><span><i class="op-fc-dot" style="background:#b15c44"></i>Humbje '+lose.toFixed(0)+'%</span></div>';
        html+='<div class="op-stat-grid">';
        if(f.months_min!=null||f.months_max!=null) html+='<div class="op-stat"><div class="op-stat-label">Kohëzgjatja (orientuese, jo afat ligjor)</div><div class="op-stat-value">'+esc(f.months_min)+'–'+esc(f.months_max)+' <small>muaj</small></div></div>';
        if(f.cost_min!=null||f.cost_max!=null) html+='<div class="op-stat"><div class="op-stat-label">Kosto e vlerësuar</div><div class="op-stat-value">'+fmtNum(f.cost_min)+'–'+fmtNum(f.cost_max)+' <small>'+esc(cur)+'</small></div></div>';
        html+='</div>';
        if(f.cost_min==null) html+='<p class="op-fc-note">Jepni «Vlerën e kontestit ose dëmin» në formular për një vlerësim të kostos.</p>';
        if(f.drivers&&f.drivers.length){ html+='<p class="op-subhead op-green">Faktorët vendimtarë</p><ul class="opinion-md-list">'; f.drivers.forEach(function(d){ html+='<li>'+esc(d)+'</li>'; }); html+='</ul>'; }
        if(f.damages&&f.damages.length){ html+='<p class="op-subhead">Zbërthimi i dëmit (orientues)</p>'; var DC=['#3d706a','#b8923a','#b15c44','#6a8caf'], dseg=''; f.damages.forEach(function(d,i){ dseg+='<div class="op-fc-seg" style="width:'+d.pct.toFixed(0)+'%;background:'+DC[i%4]+'">'+(d.pct>=12?d.pct.toFixed(0)+'%':'')+'</div>'; }); html+='<div class="op-forecast-bar">'+dseg+'</div><div class="op-stat-grid">'; f.damages.forEach(function(d){ html+='<div class="op-stat"><div class="op-stat-label">'+esc(d.head)+(d.basis?' <small>('+esc(d.basis)+')</small>':'')+'</div><div class="op-stat-value">'+fmtNum(d.amount)+' <small>'+esc(cur)+'</small></div></div>'; }); html+='</div>'; }
        if(f.basis&&f.basis.length){ html+='<p class="op-fc-basis"><strong>Si u llogarit:</strong> '+f.basis.map(function(b){ return esc(b); }).join(' ')+' <em>Vlerësime orientuese — verifikoni.</em></p>'; }
        el.innerHTML=html;
      }

      function renderSummary(store){
        var block=$('op-summary-block'), el=$('op-out-summary'); if(!block||!el) return;
        var s=store.strength||{}, f=store.forecast||{};
        var score=parseFloat(s.score); if(!isFinite(score)) score=5;
        var path=(f.win>=55)?'ndjekje gjyqësore':((f.settle>=f.win&&f.settle>=f.lose)?'zgjidhje me marrëveshje':((f.lose>50)?'marrëveshje mbrojtëse ose rishikim strategjie':'ndjekje e kujdesshme'));
        var risk=(s.weaknesses&&s.weaknesses[0])?s.weaknesses[0]:'';
        var L=store.limitation, limWarn=(L&&L.status==='likely-barred')?'<strong style="color:#b15c44">⚠ Kujdes: kërkesa mund të jetë e parashkruar ('+esc(L.elapsedText||'')+' nga ngjarja). </strong>':(L&&L.status==='partial')?'<strong style="color:#b8923a">⚠ Kujdes: një nga afatet e mundshme ka skaduar — saktësoni natyrën e kërkesës. </strong>':'';
        el.innerHTML='<p>'+limWarn+'Pozicioni vlerësohet <strong>'+score.toFixed(1)+'/10</strong>'+(s.label?' ('+esc(s.label)+')':'')+'. '
          +'Gjasat: fitim ~'+Math.round(f.win||0)+'%, marrëveshje ~'+Math.round(f.settle||0)+'%, humbje ~'+Math.round(f.lose||0)+'%. '
          +'Rruga e rekomanduar: <strong>'+path+'</strong>. '
          +'Kohëzgjatja orientuese '+esc(f.months_min)+'–'+esc(f.months_max)+' muaj.'
          +(risk?(' Rreziku kryesor: '+esc(risk)+'.'):'')+'</p>';
        block.hidden=false;
      }

      function renderFactSheet(store){
        var u=store.understanding, block=$('op-factsheet-block'), el=$('op-out-factsheet'); if(!block||!el) return;
        if(!u){ block.hidden=true; return; }
        var f=u.facts||{};
        function row(k,v){ return (v&&String(v).trim()&&String(v).trim()!=='...')?('<div class="op-fact-row"><span class="op-fact-k">'+k+'</span><span class="op-fact-v">'+esc(String(v))+'</span></div>'):''; }
        var grid=row('Palët',f.parties)+row('Data',f.dates)+row('Shuma',f.amounts)+row('Lloji i kërkesës',f.claim_type)+row('Juridiksioni',f.jurisdiction);
        var html=grid?('<div class="op-fact-grid">'+grid+'</div>'):'';
        if(u.key_events&&u.key_events.length){ html+='<p class="op-subhead" style="margin:12px 0 4px;">Ngjarjet kryesore (si i kuptuam)</p><ul class="opinion-list">'+u.key_events.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'; }
        // u.missing / u.clarifying now feed the answerable "Çfarë mungon" block instead of
        // being restated here (they were previously shown in four places with overlap).
        if(!html){ block.hidden=true; return; }
        el.innerHTML=html; block.hidden=false;
      }
      // ── "Çfarë mungon": one consolidated, answerable gap list ──
      // Merges the three AI gap sources (previously rendered in FOUR places with overlap)
      // plus the deterministic ones, de-duplicated fuzzily. Each item gets an input so the
      // user can answer it and re-run — see refine() below.
      function collectGaps(store){
        var det=[], ai=[];
        function push(arr,kind,q,src){
          q=String(q==null?'':q).trim(); if(!q||q==='...') return;
          var all=det.concat(ai);
          for(var i=0;i<all.length;i++){ if(gapSimilar(all[i].q,q)>=0.6) return; }
          arr.push({kind:kind,q:q,src:src});
        }
        // Deterministic first — one tap each, and the date can flip the whole verdict
        // (checkLimitation → score cap), so it earns the top slot.
        if(!store.eventDate) push(det,'date','Kur ndodhi ngjarja ose shkelja? Data përcakton afatin e parashkrimit.','det');
        if(!(store.claim>0)) push(det,'claim','Sa është vlera e kontestit ose dëmi i pretenduar, në Lekë?','det');
        var u=store.understanding||{};
        // clarifying first: it is already question-shaped, so on a near-duplicate collision
        // the question form survives instead of a flat "X mungon" statement.
        (u.clarifying||[]).forEach(function(x){ push(ai,'q',x,'clarifying'); });
        (u.missing||[]).forEach(function(x){ push(ai,'q',x,'missing'); });
        ((store.strength&&store.strength.missing_evidence)||[]).forEach(function(x){ push(ai,'q',x,'evidence'); });
        return det.concat(ai.slice(0,6));
      }

      function renderGaps(store){
        var block=$('op-gaps-block'), el=$('op-out-gaps'), row=$('op-refine-row');
        if(!block||!el) return;
        var gaps=collectGaps(store), advice=[];
        var d=store.doctrine;
        if(d&&d.kuadri) d.kuadri.forEach(function(e){
          var v=String(e&&e.vleresim||'').toLowerCase();
          if(v.indexOf('plot')!==0&&(e&&(e.titull||e.id)))
            advice.push('Forconi elementin «'+esc(e.titull||e.id)+'»'+(e.shenim?(': '+esc(e.shenim)):''));
        });
        if(!gaps.length&&!advice.length){ block.hidden=true; el.innerHTML=''; if(row) row.hidden=true; return; }
        var html='';
        if(gaps.length){
          html+='<p class="op-gap-intro">Përgjigju pyetjeve më poshtë dhe shtyp «Përditëso analizën» — analiza rikryhet me përgjigjet e tua.</p><ul class="op-gap-list">';
          gaps.forEach(function(g,i){
            var id='op-gap-'+i, inp;
            if(g.kind==='date') inp='<input type="date" id="'+id+'" data-gap="date" max="'+JurDate.todayISO()+'">';
            else if(g.kind==='claim') inp='<input type="text" inputmode="numeric" autocomplete="off" id="'+id+'" data-gap="claim" placeholder="p.sh. 800000">';
            else inp='<input type="text" autocomplete="off" id="'+id+'" data-gap="q" data-q="'+esc(g.q)+'" placeholder="Përgjigja juaj (lëre bosh nëse nuk e di)">';
            html+='<li class="op-gap-item"><label class="op-gap-q" for="'+id+'">'+esc(g.q)+'</label>'+inp+'</li>';
          });
          html+='</ul>';
        }
        // advice strings are pre-escaped in their parts (same contract the old renderStrengthen used)
        if(advice.length)
          html+='<p class="op-subhead op-amber" style="margin:16px 0 4px;">Çfarë do ta forconte çështjen</p><ul class="op-checklist">'+advice.slice(0,4).map(function(x){ return '<li>'+x+'</li>'; }).join('')+'</ul>';
        el.innerHTML=html;
        if(row) row.hidden=!gaps.length;
        var b=$('op-refine-btn'); if(b) b.disabled=true;
        block.hidden=false;
      }

      function priorityPill(p){ var v=String(p||'').toLowerCase(); if(v.indexOf('lart')===0||v.indexOf('high')===0) return '<span class="op-pill op-pill-high">Lartë</span>'; if(v.indexOf('mesat')===0||v.indexOf('mid')===0||v.indexOf('med')===0) return '<span class="op-pill op-pill-mid">Mesatare</span>'; if(v.indexOf('ul')===0||v.indexOf('low')===0) return '<span class="op-pill op-pill-low">Ulët</span>'; return p?'<span class="op-pill op-pill-mid">'+esc(p)+'</span>':''; }

      function renderPlan(p, type, lim){
        var el=$('op-out-plan'), steps_=(p&&p.steps)||[];
        var par=JUR_LIMITS.describe(type), hasDl=p&&p.deadlines&&p.deadlines.length;
        if(!steps_.length&&(!p||(!p.evidence&&!p.deadlines))&&!par){ el.innerHTML=DEGRADED; return; }
        var html='';
        steps_.forEach(function(s,i){ html+='<div class="op-plan-step"><div class="op-plan-num">'+(i+1)+'</div><div class="op-plan-body"><div class="op-plan-action">'+esc(s.action)+'</div><div class="op-plan-meta">'+priorityPill(s.priority)+(s.deadline?'<span class="op-pill op-pill-deadline">'+esc(s.deadline)+'</span>':'')+'</div></div></div>'; });
        if(p&&p.evidence&&p.evidence.length){ html+='<p class="op-subhead op-amber" style="margin-top:18px;">Prova për t\'u siguruar</p><ul class="op-checklist">'; p.evidence.forEach(function(e){ html+='<li>'+esc(e)+'</li>'; }); html+='</ul>'; }
        if(par||hasDl||(lim&&lim.status&&lim.status!=='na')){
          html+='<p class="op-subhead op-red" style="margin-top:18px;">Afate kritike</p>';
          if(lim&&lim.status&&lim.status!=='na') html+='<div class="op-deadline-note"><div><strong>Llogaritje afati'+(lim.status==='likely-barred'?' — ⚠ MUND TË JETË PARASHKRUAR':(lim.status==='partial'?' — ⚠ një afat i mundshëm ka skaduar':(lim.status==='near'?' — afati po skadon':'')))+'</strong> — '+esc(lim.note||'')+'</div></div>';
          if(par) html+='<div class="op-deadline-note"><div><strong>Parashkrimi (orientues)</strong> — '+esc(par)+'. Verifikoni për rastin tuaj konkret.</div></div>';
          if(hasDl) p.deadlines.forEach(function(d){ html+='<div class="op-deadline-note"><div><strong>'+esc(d.what)+'</strong>'+(d.timeframe?' - '+esc(d.timeframe):'')+'</div></div>'; });
        }
        el.innerHTML=html;
      }

      function renderText(elId,raw){ $(elId).innerHTML=raw?mdToHtml(raw):DEGRADED; }

      function renderReferences(store){
        var block=$('op-references-block'),el=$('op-out-references');
        var g=store.grounding||{found:[],missing:[],nums:{}};

        var docText=store.doctrine?JSON.stringify(store.doctrine):'';
        var corpus=[store.opposition,store.jurisprudence,store.opinion,docText].filter(Boolean).join('\n');
        var citedNums={},m,artRe=/\b[Nn]eni(?:t|n|ve)?\s+(\d+(?:\/[\w]+)?)/g;
        while((m=artRe.exec(corpus))!==null) citedNums[m[1].split('/')[0]]=true;

        var confirmed=[],seenHref={};
        (store.laws||[]).forEach(function(l){
          var name=String(l.name||'').trim(); if(!name) return;
          var href=lawHrefFor(name); if(!href||seenHref[href]) return;
          seenHref[href]=true; confirmed.push({name:name,href:href});
        });

        var grounded=(g.found||[]).slice();
        var groundedBase=g.nums||{};
        var unsourced=Object.keys(citedNums)
          .filter(function(n){ return !groundedBase[n]; })
          .sort(function(a,b){ return parseInt(a,10)-parseInt(b,10); })
          .map(function(n){ return 'Neni '+n; });
        (g.missing||[]).forEach(function(x){
          var lbl='Neni '+x.num; if(unsourced.indexOf(lbl)===-1) unsourced.push(lbl);
        });

        // Post-hoc grounding: any cited article that actually exists in this case's law
        // data (full article JSON is cached) gets its real text shown and is reclassified
        // from "Pa burim" to confirmed. Only when the number resolves to a SINGLE law.
        function postHocGround(num){
          var hits=[],seen={};
          (store.laws||[]).forEach(function(l){
            var href=lawHrefFor(String(l.name||'')); if(!href||seen[href]) return; seen[href]=true;
            var data=_lawCache[href];
            if(data && data[num]!=null){
              hits.push({law:String(l.name||'').trim(),href:href,num:num,anchor:'neni-'+String(num).replace('/','-'),text:String(data[num]).replace(/\s+/g,' ').trim()});
            }
          });
          return hits;
        }
        var seenGN={}; grounded.forEach(function(a){ seenGN[a.law+'|'+a.num]=true; });
        var stillUnsourced=[];
        unsourced.forEach(function(lbl){
          var n=String(lbl).replace(/[^\d\/]/g,'').split('/')[0];
          var hits=n?postHocGround(n):[];
          if(hits.length===1){ var k=hits[0].law+'|'+hits[0].num; if(!seenGN[k]){ seenGN[k]=true; grounded.push(hits[0]); } }
          else { stillUnsourced.push(lbl); }
        });
        unsourced=stillUnsourced;

        var decSeen={},decRe=/[Vv]endim(?:in|it|et)?\s+(?:[Nn]r\.?\s*)?(\d+(?:\/\d{2,4})?)/g;
        while((m=decRe.exec(corpus))!==null) decSeen['Vendim nr. '+m[1]]=true;
        var decisions=Object.keys(decSeen);

        var total=confirmed.length+grounded.length+unsourced.length+decisions.length;
        if(!total){ block.hidden=true; el.innerHTML=''; return; }
        block.hidden=false;

        var gCount=grounded.length, aCount=grounded.length+unsourced.length;
        var html='<p class="op-ref-intro"><b>'+gCount+' nga '+(aCount||gCount)+' nene</b> u mbështetën në tekstin zyrtar të ligjit. '+
          '<span style="color:#3d706a;font-weight:600">✓ Me tekst</span> — burim i konfirmuar, kliko për ta lexuar. '+
          '<span style="color:#b8923a;font-weight:600">⚠ Pa burim</span> — cituar nga AI por jo nga teksti i dhënë; verifikoje te '+
          '<a href="https://qbz.gov.al" target="_blank" rel="noopener noreferrer" class="opinion-law-link">QBZ</a> para se t\'i mbështetesh.</p>';

        var vmap={}; ((store.verify&&store.verify.citations)||[]).forEach(function(c){ var k=String(c.neni||'').split('/')[0]; if(k) vmap[k]=String(c.verdict||'').toLowerCase(); });
        function vMark(num){ var v=vmap[String(num).split('/')[0]]; if(!v) return ''; if(v.indexOf('verif')===0) return ' <span class="op-vmark op-vmark-ok">✓ verifikuar</span>'; if(v.indexOf('contra')===0) return ' <span class="op-vmark op-vmark-bad">✗ kundërshtuar</span>'; return ' <span class="op-vmark op-vmark-warn">⚠ e pakonfirmuar</span>'; }
        if(grounded.length){
          html+='<div class="op-ref-group"><div class="op-ref-count">Nene me tekst zyrtar — '+grounded.length+'</div><ul class="op-ref-list">';
          grounded.forEach(function(a){
            html+='<li class="op-ref op-ref-ok"><details class="op-ref-details"><summary>'+
              '<span class="op-ref-icon">✓</span>'+
              '<span class="op-ref-label">Neni '+esc(a.num)+' <span style="color:var(--muted);font-weight:400">— '+esc(a.law)+(a.xref?' · referuar':'')+'</span>'+vMark(a.num)+'</span>'+
              '<a href="'+esc(a.href)+'#'+esc(a.anchor)+'" target="_blank" rel="noopener noreferrer" class="op-ref-hint" style="text-decoration:none">hap nenin →</a>'+
              '</summary><p class="op-ref-text">'+esc(a.text)+'</p></details></li>';
          });
          html+='</ul></div>';
        }
        if(confirmed.length){
          html+='<div class="op-ref-group"><div class="op-ref-count">Ligje të konfirmuara — '+confirmed.length+'</div><ul class="op-ref-list">';
          confirmed.forEach(function(l){
            html+='<li class="op-ref op-ref-ok"><span class="op-ref-icon">✓</span>'+
              '<a href="'+esc(l.href)+'" target="_blank" rel="noopener noreferrer" class="opinion-law-link op-ref-label">'+esc(l.name)+'</a>'+
              '<span class="op-ref-hint">faqja e ligjit</span></li>';
          });
          html+='</ul></div>';
        }
        if(unsourced.length){
          html+='<div class="op-ref-group"><div class="op-ref-count">Cituar pa burim — '+unsourced.length+'</div><ul class="op-ref-list">';
          unsourced.forEach(function(r){
            html+='<li class="op-ref op-ref-warn"><span class="op-ref-icon">⚠</span>'+
              '<span class="op-ref-label">'+esc(r)+'</span><span class="op-ref-hint">verifiko</span></li>';
          });
          html+='</ul></div>';
        }
        if(decisions.length){
          html+='<div class="op-ref-group"><div class="op-ref-count">Vendime gjyqësore — '+decisions.length+'</div><ul class="op-ref-list">';
          decisions.forEach(function(r){
            html+='<li class="op-ref op-ref-decision"><span class="op-ref-icon">⚠</span>'+
              '<span class="op-ref-label">'+esc(r)+'</span><span class="op-ref-hint">verifiko QBZ</span></li>';
          });
          html+='</ul></div>';
        }
        el.innerHTML=html;
      }

      function renderDoctrine(store){
        var block=$('op-doctrine-block'),el=$('op-out-doctrine'),labelEl=$('op-doctrine-label');
        var d=store.doctrine;
        if(!d||!d.kuadri||!d.kuadri.length){ if(block) block.hidden=true; return; }
        if(block) block.hidden=false;
        function txt(s){ return linkifyHtml(esc(String(s==null?'':s))); }
        if(labelEl){ var DLABEL={penale:'Përbërja e Veprës Penale',prone:'Mbrojtja e Pronësisë',familjare:'Elementet e Çështjes Familjare',pune:'Elementet e Marrëdhënies së Punës',administrative:'Ligjshmëria e Aktit Administrativ',konsumator:'Mbrojtja e Konsumatorit'}; labelEl.textContent=DLABEL[(d&&d.framework)||store.type]||'Elementet e Përgjegjësisë Juridike'; }
        function assess(v){ v=String(v||'').toLowerCase(); if(v.indexOf('plot')===0) return {c:'#3d706a',t:'Plotësuar',cls:'op-el-ok'}; if(v.indexOf('mung')===0) return {c:'#b15c44',t:'Mungon',cls:'op-el-no'}; return {c:'#b8923a',t:'Pjesërisht',cls:'op-el-part'}; }
        var html=d.vepra?'<p class="op-doc-vepra"><span>Natyra</span>'+txt(d.vepra)+'</p>':'';
        html+='<div class="op-el-grid">';
        d.kuadri.forEach(function(e){
          if(!e) return;
          var a=assess(e.vleresim);
          html+='<div class="op-el-card '+a.cls+'"><div class="op-el-head"><span class="op-el-title">'+esc(e.titull||e.id||'')+'</span><span class="op-el-badge" style="color:'+a.c+';border-color:'+a.c+'">'+a.t+'</span></div>';
          if(e.permbajtja&&e.permbajtja.length){ html+='<dl class="op-el-list">'; e.permbajtja.forEach(function(p){ if(!p) return; html+='<dt>'+esc(p.etikete||'')+'</dt><dd>'+txt(p.vlera||'—')+'</dd>'; }); html+='</dl>'; }
          if(e.shenim) html+='<p class="op-el-note">'+txt(e.shenim)+'</p>';
          html+='</div>';
        });
        html+='</div>';
        if(d.kualifikimi&&typeof d.kualifikimi==='object'){
          var rows=''; Object.keys(d.kualifikimi).forEach(function(k){ var v=d.kualifikimi[k]; if(!v) return; rows+='<div class="op-qual-row"><span class="op-qual-k">'+esc(k.replace(/_/g,' '))+'</span><span class="op-qual-v">'+txt(v)+'</span></div>'; });
          if(rows) html+='<div class="op-qual"><p class="op-subhead op-amber">Kualifikimi ligjor</p>'+rows+'</div>';
        }
        function chips(title,cls,arr){ if(!arr||!arr.length) return ''; var h='<p class="op-subhead '+cls+'">'+title+'</p><ul class="opinion-md-list">'; arr.forEach(function(x){ if(x) h+='<li>'+txt(x)+'</li>'; }); return h+'</ul>'; }
        if(d.rrethanat){ html+=chips('Rrethana lehtësuese','op-green',d.rrethanat.lehtesuese); html+=chips('Rrethana rënduese','op-red',d.rrethanat.renduese); }
        if(d.dallimi) html+='<p class="op-subhead op-amber">Dallimi nga figura të ngjashme</p><p class="op-el-note">'+txt(d.dallimi)+'</p>';
        if(d.perfundim) html+='<div class="op-doc-concl">'+txt(d.perfundim)+'</div>';
        el.innerHTML=html;
      }

      var running=false, thinConfirmed=false;
      // lastStore is assigned only at the END of a successful run, so refine() can never
      // read a half-built store from a run the user restarted mid-flight.
      var attachedText='', resetPdf=function(){}, lastOpinion='', lastStore=null;
      function showError(msg){ var box=$('opinion-form-error'); box.textContent=msg; box.hidden=false; }
      var lawListText=function(laws){ if(!laws.length) return 'Ligjet zbatuese të të drejtës shqiptare.'; return laws.map(function(l){ return '• '+l.name+' ('+((l.articles||[]).join(', ')||'nenet zbatuese')+'): '+(l.relevance||''); }).join('\n'); };

      function generate(){
        if(running) return;
        $('opinion-form-error').hidden=true;
        if(keyMissing()){ showError('Çelësi i AI mungon.'); return; }
        var type=$('opinion-type').value, facts=$('opinion-facts').value.trim(), parties=$('opinion-parties').value.trim(), goal=$('opinion-goal').value.trim();
        if(!facts && !attachedText){ showError('Përshkruaj faktet ose ngarko një dokument PDF për të vazhduar.'); $('opinion-facts').focus(); return; }
        if(facts && facts.length<120 && !attachedText && !thinConfirmed){ var _tg=$('opinion-thin-gate'); if(_tg){ _tg.hidden=false; return; } }
        thinConfirmed=false; var _tg2=$('opinion-thin-gate'); if(_tg2) _tg2.hidden=true;
        var attach=attachedText?('\n\nDOKUMENT I NGARKUAR (përmbajtje e nxjerrë):\n'+attachedText.slice(0,8000)):'';
        // When the user has answered gap questions, those answers are confirmed facts —
        // every downstream call must treat them as settled and stop re-asking.
        var refineNote = facts.indexOf(REFINE_MARK)>-1
          ? '\n\n(Seksioni «'+REFINE_MARK+'» brenda fakteve përmban përgjigje TË KONFIRMUARA nga klienti — trajtoji si fakte të vërtetuara dhe MOS i ripyet.)' : '';
        var ctx='Lloji: çështje '+type+'.\nFaktet: '+(facts||'(shih dokumentin e ngarkuar)')+(parties?'\nPalët: '+parties:'')+(goal?'\nQëllimi: '+goal:'')+refineNote+attach;
        var isProp=(type==='prone')||((type==='civile'||type==='tregtare')&&detectProperty(facts+' '+parties+' '+goal+' '+attachedText));
        var conceptKey=isProp?'prone':(CONCEPTS[type]?type:'');
        var concept=conceptKey?CONCEPTS[conceptKey]:null;
        var primer=concept?concept.primer:'';
        running=true; abortCtrl=new AbortController();
        $('opinion-generate-btn').disabled=true;
        $('opinion-form').hidden=true;
        $('opinion-progress').hidden=false;
        resetRows();
        var store={};
        store.type=type;
        store.claim=parseAmount($('opinion-claim')?$('opinion-claim').value:'')||extractClaimFromFacts(facts);
        store.eventDate=($('opinion-event-date')&&$('opinion-event-date').value)||'';
        store.limitation=checkLimitation(type, store.eventDate);
        rowActive(0);
        var _c1sys='Jeni analist ligjor shqiptar me përvojë. Përgjigjuni VETËM me JSON të vlefshëm, pa tekst para ose pas dhe pa shenja ```.'+ANTI_HALLUC;
        var _c1usr=ctx+primer+'\n\nIdentifiko 3–5 ligjet shqiptare më relevante dhe nenet kryesore zbatuese (ji gjithëpërfshirës: deri në 8 nene gjithsej, vetëm nene për të cilat je i sigurt). Gjithashtu nxirr një PËRMBLEDHJE të fakteve të kuptuara dhe listo çfarë mungon ose supozohet.\nJSON: {"laws":[{"name":"...","articles":["..."],"relevance":"..."}],"issues":["..."],"arguments":["..."],"facts":{"parties":"...","dates":"...","amounts":"...","claim_type":"...","jurisdiction":"..."},"key_events":["..."],"missing":["..."],"clarifying":["..."]}'
          +'\n\nUDHËZIM PËR "clarifying": jep deri në 6 PYETJE TË SHKURTRA, konkrete dhe të përgjigjshme, drejtuar klientit. Secila max 12 fjalë, fillon me "A ", "Kur ", "Sa ", "Kush ", "Ku " ose "Cili/Cila", dhe i përgjigjet me një fjali. SHEMBUJ TË MIRË: "A ekziston kontratë me shkrim?"; "Kur e njoftuat palën tjetër?"; "Sa është vlera e faturës së papaguar?". TË NDALUARA: "Më shumë detaje", "Sqaroni situatën", "Dokumentacion shtesë". Mos pyet për gjëra që tashmë janë në faktet e dhëna dhe mos e përsërit të njëjtën pyetje me fjalë të tjera.'
          +'\n\nUDHËZIM PËR "missing": deri në 5 fakte thelbësore që MUNGOJNË ose i kemi supozuar, secili një fjali e shkurtër dhe konkrete.';
        Promise.all([0.12,0.25,0.4].map(function(tmp){ return runCall(1,_c1sys,_c1usr,700,tmp).then(function(r){ return safeJson(r); }, function(e){ if(e&&e.name==='AbortError') throw e; return null; }); }))
        .then(function(samples){
          var agg=aggregateLaws(samples); store.laws=agg.laws; store.understanding=agg.understanding;
          store.lawList=lawListText(store.laws);
          store.groundingP=retrieveGrounding(store.laws);
          store.webgroundP=(typeof aiGroundedSearch==='function') ? aiGroundedSearch(buildWebQuery(store.laws,type,facts), abortCtrl?abortCtrl.signal:undefined).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }) : Promise.resolve(null);
          rowDone(0); rowActive(1);
          return runCall(2,'Jeni vlerësues i pavarur ligjor. Përgjigjuni VETËM me JSON të vlefshëm.',
            ctx+'\n\nBazë ligjore:\n'+store.lawList+'\n\nVlerëso pozicionin ligjor në mënyrë realiste. Për secilin faktor, jep fillimisht një arsye të shkurtër ("why") dhe pastaj notën nga 0 në 2 ("score"; 0=shumë dobët, 1=mesatar, 2=shumë mirë). Kujdes: "kundershtimi" mat sa i FORTË është pozicioni i palës kundërshtare (2 = kundërshtim shumë i fortë kundër klientit). JSON:\n{"factors":{"baza":{"score":1.5,"why":"..."},"prova":{"score":1.0,"why":"..."},"kundershtimi":{"score":1.0,"why":"..."},"faktet":{"score":1.5,"why":"..."}},"strengths":["..."],"weaknesses":["..."],"missing_evidence":["..."]}'
                  +'\n\nUDHËZIM PËR "missing_evidence": deri në 5 prova KONKRETE që i mungojnë çështjes, secila e formuluar si pyetje e shkurtër drejtuar klientit ("A e keni kontratën e nënshkruar?", "A keni foto ose raport eksperti për dëmin?"), max 12 fjalë. Emërto provën konkrete — dokument, faturë, dëshmitar, foto, raport eksperti, komunikim me shkrim — kurrë "prova shtesë".',650,0.2);
        })
        .then(function(r2){
          store.strength=safeJson(r2); rowDone(1);
          return (store.groundingP||Promise.resolve({text:'',found:[],missing:[],nums:{}})).then(function(g){
            store.grounding=g;
            return (concept?keywordGround(concept.href,concept.name,concept.kw,concept.limit):Promise.resolve(null)).then(function(kg){
            mergeGrounding(g,kg);
            return semanticGround(store.laws, facts).then(function(sg){
            mergeGrounding(g,sg);
            store.groundingText=g.text?('\n\n'+g.text):'';
            var GT=store.groundingText;
            [2,3,4,5,6].forEach(rowActive);
            var W=store.strength.weaknesses||[];
            var tasks=[
              function(){ return runCall(3,'Jeni avokati i palës kundërshtare. Ndërtoni argumentet më të forta kundër pozicionit të dhënë. Mbështetu te teksti zyrtar i neneve të dhëna; mos cito nene jashtë tij.',
                  ctx+'\n\nBazë ligjore:\n'+store.lawList+'\n\nDobësitë e palës: '+W.join('; ')+GT+'\n\nGjenero 4–5 argumente të forta. Citoji nenet sipas tekstit zyrtar të mësipërm.',700,0.5)
                .then(function(v){ rowDone(2); return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; rowFail(2); return null; }); },
              function(){ return runCall(4,'Jeni ekspert i praktikës gjyqësore shqiptare. Përshkruani tendencat e përgjithshme pa shpikur vendime ose numra çështjesh. Mbështetu te teksti zyrtar i neneve të dhëna.',
                  'Ligjet: '+store.laws.map(function(l){ return l.name; }).join(', ')+'\nLloji: '+type+'\nSituata: '+facts.slice(0,400)+GT+'\n\nPërshkruaj: (1) si i kanë trajtuar gjykatat shqiptare raste të ngjashme, (2) parimet interpretuese dominuese, (3) çfarë duhet pasur parasysh.',700,0.4)
                .then(function(v){ rowDone(3); return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; rowFail(3); return null; }); },
              function(){ return runCall(5,'Jeni analist risku ligjor. Përgjigjuni VETËM me JSON të vlefshëm.',
                  ctx+'\n\nBazë ligjore:\n'+store.lawList+'\n\nListo 3–5 faktorët kryesorë cilësorë që përcaktojnë rezultatin (mos jep shifra). Nëse ka dëm pasuror, jep edhe zbërthimin e dëmit në zëra (dëm material, dëm jo-pasuror/moral, fitim i munguar) me bazën ligjore dhe një peshë përqindjeje (share 0–100) për secilin. JSON:\n{"drivers":["..."],"damages":[{"head":"Dëm material","basis":"neni ...","share":60}]}',550,0.3)
                .then(function(v){ rowDone(4); return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; rowFail(4); return null; }); },
              function(){ return runCall(6,'Jeni strateg ligjor. Përgjigjuni VETËM me JSON të vlefshëm.',
                  ctx+'\n\nBazë ligjore:\n'+store.lawList+'\n\nKrijo plan veprimi praktik. JSON:\n{"steps":[{"action":"...","priority":"Lartë|Mesatare|Ulët","deadline":"..."}],"evidence":["..."],"deadlines":[{"what":"...","timeframe":"..."}]}',600,0.35)
                .then(function(v){ rowDone(5); return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; rowFail(5); return null; }); },
              function(){
                var spec=doctrineSpec(isProp?'prone':type);
                return runCall(8,spec.sys,
                  'SITUATA:\n'+ctx+primer+'\n\nBazë ligjore:\n'+store.lawList+GT+
                  '\n\nKryej dekompozimin doktrinor të çështjes. Për çdo element jep vlerësimin "plotesuar", "pjeserisht" ose "munget" te fusha "vleresim", dhe te "shenim" shpjego shkurt çfarë e provon elementin ose çfarë mungon për ta vërtetuar. Mbështetu te teksti zyrtar i neneve të dhëna; mos shpik numra ose vepra. Përdor SAKTËSISHT këtë strukturë JSON:\n'+spec.tmpl,
                  1900,0.3)
                .then(function(v){ rowDone(6); return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; rowFail(6); return null; }); }
            ];
            if(adrApplicable(type)) tasks.push(function(){ return runCall(10, ADR_SYS, ctx+'\n\nLLOJI: çështje '+type+'. Vlerëso nëse kjo mosmarrëveshje mund të zgjidhet me ndërmjetësim ose arbitrazh, sa gjasa ka, dhe skenarët më të mirë/të keq.'+ADR_JSON, 750,0.4).then(function(v){ return v; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }); });
            return runLimited(tasks,PARALLEL_LIMIT);
            });
            });
          });
        })
        .then(function(res){
          store.opposition=res[0]; store.jurisprudence=res[1]; var _r5=safeJson(res[2])||{}; store.forecastDrivers=_r5.drivers||[]; store.forecastDamages=_r5.damages||[]; store.plan=safeJson(res[3]); store.doctrine=safeJson(res[4]);
          store.adr=adrApplicable(type)?(safeJson(res[5])||null):null;
          rowActive(7);
          var S=store.strength;
          return runCall(7,'Jeni jurist i lartë shqiptar. Shkruani mendim ligjor formal, të strukturuar dhe profesional. Citoni nenet sipas tekstit zyrtar të dhënë më poshtë dhe, kur është e mundur, përdorni formulimin e tij. MOS citoni nene që nuk janë dhënë. Përfshi në analizë dekompozimin doktrinor të dhënë (objekti, ana objektive, subjekti, ana subjektive ose elementet e përgjegjësisë), duke vlerësuar nëse secili element përmbushet.',
            'SITUATA:\n'+ctx+primer+'\n\nLIGJET ZBATUESE:\n'+store.lawList+'\n\nFORCAT:\n'+((S.strengths||[]).join('\n')||'-')+'\n\nDOBËSITË:\n'+((S.weaknesses||[]).join('\n')||'-')+(store.opposition?'\n\nARGUMENTET KUNDËRSHTARE:\n'+store.opposition:'')+(store.jurisprudence?'\n\nJURISPRUDENCA:\n'+store.jurisprudence:'')+(store.groundingText||'')+doctrineSummaryText(store.doctrine)+'\n\nDrafto MENDIM LIGJOR formal me seksionet (secili titull në krye rreshti):\nFAKTE\nBAZË LIGJORE\nANALIZË LIGJORE\nKUNDËRPËRGJIGJE\nKONKLUZIONE\nREKOMANDIME\n\nTe KUNDËRPËRGJIGJE, përgjigju argumenteve kundërshtare. Ji i plotë, specifik dhe profesional.',2400,0.45,true);
        })
        .then(function(r7){
          store.opinion=r7; lastOpinion=r7||''; rowDone(7);
          renderMeta($('opinion-type').value);
          if(!store.strength) store.strength={};
          store.strengthCalc=computeStrengthScore(store.strength, store.doctrine, store.grounding, store.limitation);
          store.strength.score=store.strengthCalc.score;
          store.strength.label=store.strengthCalc.label;
          store.strength._capped=store.strengthCalc.capNote||'';
          _artHref={}; var _amb={};
          ((store.grounding&&store.grounding.found)||[]).forEach(function(a){
            var b=String(a.num).split('/')[0];
            if(_amb[b]) return;
            if(_artHref[b]&&_artHref[b].href!==a.href){ _amb[b]=true; delete _artHref[b]; return; }
            _artHref[b]={href:a.href,anchor:a.anchor};
          });
          store.forecast=computeForecast(store.claim,(store.strength&&store.strength.score),type);
          store.forecast.drivers=store.forecastDrivers||[];
          store.forecast.damages=buildDamages(store.forecastDamages,store.claim,type);
          store.jurisprudence=stripFakeCitations(store.jurisprudence);
          store.opinion=enforceConsistency(store.opinion,store.forecast,(store.strength&&store.strength.score));
          lastOpinion=store.opinion||'';
          rowActive(8);
          var verifyP = store.opinion
            ? runVerifier(store).then(function(vr){ store.verify=vr; rowDone(8); }, function(e){ if(e&&e.name==='AbortError') throw e; rowFail(8); store.verify=null; })
            : Promise.resolve().then(function(){ store.verify=null; rowDone(8); });
          return verifyP
          .then(function(){
            // ── self-correction: if the auditor found real problems, rewrite the opinion to fix them ──
            var probs=[];
            var contra=((store.verify&&store.verify.citations)||[]).filter(function(c){ return String(c.verdict||'').indexOf('contra')===0; });
            contra.forEach(function(c){ probs.push('Citimi i nenit '+c.neni+' kundërshtohet nga teksti zyrtar'+(c.note?(': '+c.note):'')+'.'); });
            store.logic=enforceLogic(store.opinion, store.strength&&store.strength.score, store.forecast);
            if(store.logic) probs.push(store.logic.msg);
            if(store.verify&&String(store.verify.confidence)==='low') ((store.verify.corrections)||[]).forEach(function(x){ if(x) probs.push(String(x)); });
            var corrP = (probs.length && store.opinion)
              ? runCorrection(store, probs).then(function(fixed){ if(fixed){ store.opinion=enforceConsistency(fixed, store.forecast, store.strength&&store.strength.score); store.corrected=true; lastOpinion=store.opinion; } }, function(e){ if(e&&e.name==='AbortError') throw e; })
              : Promise.resolve();
            return corrP;
          })
          .then(function(){ return store.webgroundP||Promise.resolve(null); })
          .then(function(wg){
            store.webground=wg;
            if(store.logic && !store.corrected && store.opinion.indexOf(store.logic.msg)<0) store.opinion=store.opinion+'\n\n— '+store.logic.msg;
            store.confidence=computeConfidence(store);
            lastStore=store;   // only now is the store complete enough for refine()
            renderFactSheet(store);
            renderSummary(store);
            renderStrength(store.strength);
            renderScoreBreakdown(store);
            renderAnalysis(store.laws,store.strength);
            renderDoctrine(store);
            renderText('op-out-opposition',store.opposition);
            renderText('op-out-jurisprudence',store.jurisprudence);
            renderWebGround(store);
            renderForecast(store.forecast);
            renderADR(store);
            renderPlan(store.plan,store.type,store.limitation);
            renderGaps(store);
            renderText('op-out-opinion',store.opinion);
            renderVerify(store);
            renderReferences(store);
            applyConfidenceBadges(store);
            // link article/law citations across the structured sections (skip ones that already have links)
            // NOTE: 'op-out-gaps' is deliberately NOT in this list — linkifyHtml round-trips
            // innerHTML, which does not serialize an <input>'s .value and would wipe answers.
            ['op-out-summary','op-out-factsheet','op-out-analysis','op-out-forecast','op-out-doctrine','op-out-adr','op-out-plan','op-out-verify','op-out-breakdown'].forEach(function(id){ var e=$(id); if(e&&e.innerHTML&&e.innerHTML.indexOf('<a ')<0) e.innerHTML=linkifyHtml(e.innerHTML); });
            $('opinion-progress').hidden=true;
            $('opinion-output').hidden=false;
            $('opinion-modal-inner').scrollTop=0;
          });
        })
        .catch(function(err){
          if(err&&err.name==='AbortError') return;
          $('opinion-progress').hidden=true;
          $('opinion-form').hidden=false;
          showError('Gabim gjatë analizës: '+(err&&err.message?err.message:'provoni sërish.'));
        })
        .then(function(){ running=false; $('opinion-generate-btn').disabled=false; });
      }

      function openModal(){ $('opinion-modal').hidden=false; document.body.style.overflow='hidden'; $('opinion-close').focus(); }
      function closeModal(){ if(abortCtrl) abortCtrl.abort(); $('opinion-modal').hidden=true; document.body.style.overflow=''; }
      function restart(){
        if(abortCtrl) abortCtrl.abort(); running=false; $('opinion-generate-btn').disabled=false;
        $('opinion-output').hidden=true; $('opinion-progress').hidden=true; $('opinion-form').hidden=false;
        $('opinion-form-error').hidden=true; resetRows(); $('op-strength-bar').style.width='0';
        $('op-references-block').hidden=true; $('op-out-references').innerHTML='';
        var _db=$('op-doctrine-block'); if(_db) _db.hidden=true;
        var _do=$('op-out-doctrine'); if(_do) _do.innerHTML='';
        var _sb=$('op-summary-block'); if(_sb) _sb.hidden=true;
        var _gb=$('op-gaps-block'); if(_gb) _gb.hidden=true;
        lastStore=null;
      }

      // ── Refine: answer the gaps, re-run with the answers folded into the facts ──
      // Answers are written into the REAL form fields, so generate() rebuilds ctx from them
      // with zero extra plumbing. A sentinel block keeps repeated refines idempotent.
      var REFINE_MARK='=== SQARIME SHTESË NGA KLIENTI ===';

      function parseRefineBlock(txt){
        var i=String(txt==null?'':txt).indexOf(REFINE_MARK); if(i<0) return [];
        var out=[], lines=String(txt).slice(i+REFINE_MARK.length).split('\n'), cur=null;
        lines.forEach(function(ln){
          var q=/^Pyetje:\s*(.+)$/.exec(ln), a=/^Përgjigje:\s*(.+)$/.exec(ln);
          if(q){ cur={q:q[1].trim(),a:''}; out.push(cur); }
          else if(a&&cur) cur.a=a[1].trim();
        });
        return out.filter(function(p){ return p.q&&p.a; });
      }

      // Claim-only changes need ZERO AI calls: the claim never enters a prompt, and the
      // damages breakdown is returned as percentage shares, so it re-scales locally.
      function recomputeLocal(){
        var s=lastStore; if(!s||!s.type) return false;
        s.claim=parseAmount($('opinion-claim').value)||extractClaimFromFacts($('opinion-facts').value);
        s.forecast=computeForecast(s.claim,(s.strength&&s.strength.score),s.type);
        s.forecast.drivers=s.forecastDrivers||[];
        s.forecast.damages=buildDamages(s.forecastDamages,s.claim,s.type);
        renderForecast(s.forecast);
        renderSummary(s);
        renderGaps(s);
        var fe=$('op-out-forecast'); if(fe&&fe.innerHTML&&fe.innerHTML.indexOf('<a ')<0) fe.innerHTML=linkifyHtml(fe.innerHTML);
        return true;
      }

      function refine(){
        if(running) return;
        var el=$('op-out-gaps'); if(!el) return;
        var pairs=[], claimChanged=false, deepChanged=false;
        Array.prototype.forEach.call(el.querySelectorAll('input'), function(inp){
          var v=String(inp.value||'').trim(); if(!v) return;
          var k=inp.getAttribute('data-gap');
          if(k==='date'){ $('opinion-event-date').value=v; deepChanged=true; }
          else if(k==='claim'){ $('opinion-claim').value=v; claimChanged=true; }
          else { pairs.push({q:inp.getAttribute('data-q')||'(pyetje)',a:v}); deepChanged=true; }
        });
        if(!pairs.length&&!claimChanged&&!deepChanged) return;
        if(pairs.length){
          var ta=$('opinion-facts');
          var prev=parseRefineBlock(ta.value), base=String(ta.value||'').split(REFINE_MARK)[0].replace(/\s+$/,'');
          pairs.forEach(function(p){
            for(var i=0;i<prev.length;i++){ if(gapSimilar(prev[i].q,p.q)>=0.8){ prev[i].a=p.a; return; } }
            prev.push(p);
          });
          ta.value=base+'\n\n'+REFINE_MARK+'\n'+prev.map(function(p){ return 'Pyetje: '+p.q+'\nPërgjigje: '+p.a; }).join('\n');
        }
        if(claimChanged&&!deepChanged&&recomputeLocal()) return;
        thinConfirmed=true;                 // the narrative was already vetted on the first run
        $('opinion-output').hidden=true;    // else progress + stale output render together
        generate();
      }

      (function(){
        var el=$('op-out-gaps'), btn=$('op-refine-btn'); if(!el||!btn) return;
        function anyAnswered(){ var q=el.querySelectorAll('input'); for(var i=0;i<q.length;i++){ if(String(q[i].value||'').trim()) return true; } return false; }
        el.addEventListener('input', function(){ btn.disabled=!anyAnswered(); });
        el.addEventListener('keydown', function(e){ if(e.key==='Enter'&&e.target&&e.target.tagName==='INPUT'){ e.preventDefault(); if(!btn.disabled) refine(); } });
        btn.addEventListener('click', refine);
      })();

      $('opinion-open-btn').addEventListener('click',openModal);
      $('opinion-close').addEventListener('click',closeModal);
      $('opinion-generate-btn').addEventListener('click',generate);
      (function(){ var tp=$('opinion-thin-proceed'); if(tp) tp.addEventListener('click',function(){ thinConfirmed=true; $('opinion-thin-gate').hidden=true; generate(); }); })();
      function printScope(sel){ var ds=Array.prototype.slice.call(document.querySelectorAll(sel+' .op-breakdown')); var were=ds.map(function(d){ return d.open; }); ds.forEach(function(d){ d.open=true; }); function restore(){ ds.forEach(function(d,i){ d.open=were[i]; }); window.removeEventListener('afterprint',restore); } window.addEventListener('afterprint',restore); setTimeout(restore,3000); window.print(); }
      $('opinion-print-btn').addEventListener('click',function(){ printScope('#opinion-modal'); });
      $('opinion-copy-btn').addEventListener('click',function(){
        var t=lastOpinion; if(!t) return;
        var done=function(){ var b=$('opinion-copy-btn'),o=b.textContent; b.textContent='U kopjua ✓'; setTimeout(function(){ b.textContent=o; },1500); };
        if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done).catch(function(){}); }
        else { try{ var ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); }catch(e){} }
      });
      $('opinion-restart-btn').addEventListener('click',restart);
      if($('opinion-cancel-btn')) $('opinion-cancel-btn').addEventListener('click',closeModal);
      $('opinion-modal').addEventListener('click',function(e){ if(e.target===this) closeModal(); });
      document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!$('opinion-modal').hidden) closeModal(); });

      // ── PDF upload → client-side text extraction via pdf.js ──
      (function(){
        var inp=$('opinion-pdf'), status=$('opinion-pdf-status'), clr=$('opinion-pdf-clear'), view=$('opinion-pdf-view'), preview=$('opinion-pdf-preview');
        if(!inp) return;
        attachPdfPreview(view, preview, function(){ return attachedText; });
        function reset(){ attachedText=''; inp.value=''; if(status){ status.textContent=''; status.classList.remove('warn'); } if(clr) clr.hidden=true; if(view){ view.hidden=true; view.textContent='Shiko tekstin'; } if(preview){ preview.hidden=true; preview.textContent=''; } }
        resetPdf=reset;
        if(clr) clr.addEventListener('click',reset);
        inp.addEventListener('change',function(){
          var f=inp.files&&inp.files[0]; if(!f) return;
          status.classList.remove('warn'); status.textContent='Duke lexuar PDF…'; clr.hidden=false; attachedText=''; if(view){ view.hidden=true; view.textContent='Shiko tekstin'; } if(preview){ preview.hidden=true; preview.textContent=''; }
          extractPdfText(f, 8000, function(m){ status.textContent=m; }).then(function(txt){
            if(!txt){ status.textContent='PDF-ja duket e skanuar (pa tekst) — shkruani faktet manualisht.'; status.classList.add('warn'); attachedText=''; return; }
            attachedText=txt;
            status.textContent=f.name+' · '+txt.split(/\s+/).length+' fjalë'; if(view) view.hidden=false;
          }).catch(function(){
            status.textContent='Nuk u lexua dot PDF-ja.'; status.classList.add('warn'); attachedText='';
          });
        });
      })();
    })();

    // ── AI category tabs ──
    (function(){
      var pills  = document.querySelectorAll('.aicat-pill');
      var groups = document.querySelectorAll('.aicat-group[data-aicat]');
      function show(cat){
        groups.forEach(function(g){ g.hidden = !(cat==='all' || g.dataset.aicat===cat); });
        pills.forEach(function(p){ p.classList.toggle('active', p.dataset.aicat===cat); });
      }
      pills.forEach(function(p){ p.addEventListener('click', function(){ show(p.dataset.aicat); if(history.replaceState) history.replaceState(null,'','#'+p.dataset.aicat); }); });
      var slugs=['analiza','hartim','orientim','pergatitje','meso','all'];
      var initial=(location.hash||'').replace('#','');
      show(slugs.indexOf(initial)>-1?initial:'analiza');
    })();

    /* ── Inheritance Engine (deterministic shares + AI explanation) ── */
    (function(){
      'use strict';
      function $(id){ return document.getElementById(id); }
      function fmtN(n){ n=Math.round(Number(n)||0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' '); }
      function gcd(a,b){ a=Math.abs(a); b=Math.abs(b); while(b){ var t=b; b=a%b; a=t; } return a||1; }
      function fracStr(x){ if(!isFinite(x)||x<=0) return '0'; for(var den=1;den<=24;den++){ var num=x*den; if(Math.abs(num-Math.round(num))<1e-6){ var nu=Math.round(num); var g=gcd(nu,den); return (nu/g)+'/'+(den/g); } } return (x*100).toFixed(1)+'%'; }
      function parseAmt(s){ if(s==null) return null; var str=String(s).toLowerCase().replace(/\s/g,''); var mult=1; if(/milion|mln/.test(str)) mult=1000000; else if(/mij[ëe]|mije/.test(str)) mult=1000; var m=str.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?/); if(!m) return null; var num=parseFloat(m[1].replace(/[.,]/g,'')+(m[2]?('.'+m[2]):'')); return (isFinite(num)&&num>0)?Math.round(num*mult):null; }
      function inl(t){ return t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>'); }
      function iMd(raw){ if(!raw) return '<p class="op-degraded">Nuk u gjenerua kjo pjesë.</p>'; var lines=esc(raw).split('\n'), out='', list=false; function close(){ if(list){ out+='</ul>'; list=false; } } lines.forEach(function(ln){ ln=ln.trim(); if(!ln){ close(); return; } var b=ln.match(/^[-•*]\s+(.*)$/); if(b){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(b[1])+'</li>'; return; } var o=ln.match(/^\d+[.)]\s+(.*)$/); if(o){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(o[1])+'</li>'; return; } var h=ln.match(/^#{1,4}\s+(.*)$/); if(h){ close(); out+='<h3 class="opinion-section-head">'+inl(h[1])+'</h3>'; return; } close(); out+='<p>'+inl(ln)+'</p>'; }); close(); return linkNene(out, 'kodi-civil.html'); }

      // ── soundproof calculator (verified in node) ──
      function computeInheritance(inp){
        inp=inp||{};
        var spouse=!!inp.spouse, childrenAlive=Math.max(0,inp.childrenAlive|0), childrenMinor=Math.max(0,Math.min(childrenAlive,inp.childrenMinor|0)),
            predeceasedWithKids=Math.max(0,inp.predeceasedWithKids|0), parentsAlive=Math.max(0,Math.min(2,inp.parentsAlive|0)),
            siblings=Math.max(0,inp.siblings|0), grandparents=Math.max(0,inp.grandparents|0), dependents=Math.max(0,inp.dependents|0),
            hasWill=!!inp.hasWill, debts=(inp.debts>0)?inp.debts:0,
            regime=(inp.regime==='ndarje')?'ndarje':'bashkesi', community=(inp.community>0)?inp.community:0, personal=(inp.personal>0)?inp.personal:0;
        var heirs=[], basis=[], order;
        var spousePropertyShare=(spouse&&regime!=='ndarje'&&community>0)?community/2:0;
        var grossEstate=community+personal;
        var netEstate=Math.max(0, grossEstate-spousePropertyShare-debts);
        if(spousePropertyShare>0) basis.push(358);
        function push(who,frac,count,note){ heirs.push({who:who,fraction:frac,count:count||1,note:note||''}); }
        var childSlots=childrenAlive+predeceasedWithKids;
        if(childSlots>0){ order='I'; basis.push(360,361); var each=1/(childSlots+(spouse?1:0));
          if(childrenAlive>0) push('Fëmijët', each, childrenAlive, 'secili në pjesë të barabarta (neni 361)');
          if(predeceasedWithKids>0) push('Degë përfaqësimi (fëmijë i paravdekur)', each, predeceasedWithKids, 'pjesa ndahet mes paslindurve (zëvendësim, neni 361)');
          if(spouse) push('Bashkëshorti pasjetues', each, 1, 'pjesë e barabartë me një fëmijë');
        } else { var second=parentsAlive+dependents;
          if(second>0){ order='II'; basis.push(363,361); if(spouse) push('Bashkëshorti pasjetues',0.5,1,'merr 1/2 (neni 361)'); var per2=(spouse?0.5:1)/second; if(parentsAlive>0) push('Prindërit',per2,parentsAlive,''); if(dependents>0) push('Persona të paaftë në ngarkim',per2,dependents,'neni 363');
          } else { var third=grandparents+siblings+dependents;
            if(third>0){ order='III'; basis.push(364,361); if(spouse) push('Bashkëshorti pasjetues',0.5,1,'merr 1/2 (neni 361)'); var per3=(spouse?0.5:1)/third; if(grandparents>0) push('Gjyshërit',per3,grandparents,''); if(siblings>0) push('Vëllezër/motra',per3,siblings,'neni 364'); if(dependents>0) push('Persona të paaftë në ngarkim',per3,dependents,'');
            } else if(spouse){ order='spouse'; basis.push(361); push('Bashkëshorti pasjetues',1,1,'pa trashëgimtarë të rendeve të tjera (neni 361)');
            } else { order='distant'; basis.push(365,366); }
          }
        }
        var out={order:order,heirs:heirs,basis:basis,netEstate:netEstate,grossEstate:grossEstate,debts:debts,spousePropertyShare:spousePropertyShare,community:community,personal:personal,regime:regime};
        if(hasWill){ var nHeirs=0; heirs.forEach(function(h){ nHeirs+=h.count; }); var perHeir=nHeirs>0?1/nHeirs:0; var protectedCount=(childrenMinor||0)+(dependents||0); var reservedFrac=Math.min(1,perHeir*protectedCount);
          out.reserve={ perHeir:perHeir, protectedCount:protectedCount, reservedFrac:reservedFrac, disposableFrac:Math.max(0,1-reservedFrac), warning:(inp.willExcludesReserved&&protectedCount>0)?'Testamenti që përjashton ose cenon trashëgimtarët e mbrojtur (të mitur ose të paaftë për punë) është i pavlefshëm për atë pjesë (neni 407); ata mund të kërkojnë plotësimin (neni 412).':'' };
          basis.push(379,413); if(out.reserve.warning) basis.push(407,412);
        }
        return out;
      }

      // ── conditional grounding: inject only the articles relevant to THIS case ──
      function groundingArticles(inp){
        var s={}; function add(){ for(var i=0;i<arguments.length;i++) s[arguments[i]]=1; }
        add(316,317,320,330,360,361,413);
        if(inp.childrenAlive>0) add(362);
        if(inp.predeceasedWithKids>0) add(326,327,329,370);
        if(inp.dependents>0) add(363,371);
        if(inp.parentsAlive>0) add(363);
        if(inp.siblings>0||inp.grandparents>0) add(364,369);
        if(inp.community>0 && inp.regime!=='ndarje') add(358);
        if(inp.hasWill) add(372,378,379,380,392,393,397,402,403,404,405,406,407,408,409,410,411,412);
        add(322,323,324,369,370); // padenjësi / heqje dorë / shtim (rreziqet)
        return Object.keys(s).map(Number).sort(function(a,b){ return a-b; });
      }
      var _civil=null, abortCtrl=null;
      function loadCivil(){ if(_civil) return Promise.resolve(_civil); return fetch('data/kodi-civil.json',{signal:abortCtrl?abortCtrl.signal:undefined}).then(function(r){ return r.ok?r.json():{}; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; return {}; }).then(function(d){ _civil=d||{}; return _civil; }); }
      function buildGrounding(arts){ return loadCivil().then(function(data){ var blocks=[],refs=[],have={};
        (arts||[]).forEach(function(n){ var t=data[String(n)]; if(t){ have[String(n)]=true; var clean=String(t).replace(/\s+/g,' ').trim(); blocks.push('Neni '+n+': «'+clean.slice(0,650)+'»'); refs.push({num:n,text:clean}); } });
        // cross-reference expansion (one hop, capped): pull nene cited inside the grounded texts
        var extra=0; refs.slice().forEach(function(r){ if(extra>=6) return; var rr=/nen(?:i|it|in|et|eve)?\s+(\d+)/gi, mm; while(extra<6 && (mm=rr.exec(r.text))!==null){ var rn=mm[1]; if(have[rn]) continue; var t=data[rn]; if(!t) continue; have[rn]=true; var clean=String(t).replace(/\s+/g,' ').trim(); blocks.push('Neni '+rn+' (referuar): «'+clean.slice(0,600)+'»'); refs.push({num:parseInt(rn,10),text:clean,xref:true}); extra++; } });
        return {text:blocks.length?('TEKSTI ZYRTAR I NENEVE (Kodi Civil — mbështetu VETËM te këto, mos cito nene jashtë tyre):\n\n'+blocks.join('\n\n')):'', refs:refs}; }); }
      var INH_FEWSHOT='SHEMBUJ TË SAKTË (mëso prej logjikës, mos kopjo verbatim):\n'+
        '• Bashkëshort + 2 fëmijë → secili (2 fëmijët dhe bashkëshorti) merr 1/3 (neni 361, pjesë të barabarta).\n'+
        '• Pa fëmijë + bashkëshort + 2 prindër → bashkëshorti 1/2 (neni 361), secili prind 1/4 (gjysma tjetër barazisht, neni 363).\n'+
        '• Pa fëmijë + bashkëshort + 2 vëllezër + 1 gjyshe (rendi III) → bashkëshorti 1/2, secili nga 3 të tjerët 1/6 (nenet 361, 364).\n'+
        '• Vetëm bashkëshort, pa trashëgimtarë të tjerë → bashkëshorti merr gjithçka (neni 361).\n'+
        '• Fëmijë i paravdekur me fëmijë → dega merr pjesën e një fëmije, ndarë mes paslindurve (zëvendësim, nenet 361, 326–327).\n'+
        '• Testament që përjashton një fëmijë të mitur → i pavlefshëm për rezervën; i mituri merr pjesën ligjore (nenet 379, 407, 412–413).';
      function validFracs(c){ var s={'1/1':1,'1':1,'1/2':1}; c.heirs.forEach(function(h){ s[fracStr(h.fraction)]=1; }); if(c.reserve){ s[fracStr(c.reserve.reservedFrac)]=1; s[fracStr(c.reserve.disposableFrac)]=1; } return s; }
      function enforceShares(text, c){
        if(!text) return text; var ok=validFracs(c), bad=false, seen={};
        String(text).replace(/\b(\d{1,2})\/(\d{1,2})\b/g, function(m,a,b){ var f=fracStr(parseInt(a,10)/parseInt(b,10)); if(!ok[m]&&!ok[f]&&!seen[m]){ seen[m]=1; bad=true; } return m; });
        return bad ? (text+'\n\n⚠ Çdo fraksion në tekst që ndryshon nga tabela e llogaritur më sipër është i pasaktë — vlejnë shifrat e llogaritura.') : text;
      }

      function iCall(sys,usr,maxTok,temp){
        if(typeof aiFetch!=='function') return Promise.reject(new Error('AI mungon'));
        return aiFetch({ signal:abortCtrl?abortCtrl.signal:undefined, body:JSON.stringify({ max_tokens:maxTok, temperature:(typeof temp==='number')?temp:0.4, messages:[{role:'system',content:sys},{role:'user',content:usr}] }) })
          .then(function(r){ return r.json(); }).then(function(d){ var c=(d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||''; if(!c) throw new Error('bosh'); return c; });
      }

      // ── renderers ──
      var ORDER_NAME={ 'I':'Rendi i parë (fëmijët + bashkëshorti)','II':'Rendi i dytë (prindërit + persona në ngarkim)','III':'Rendi i tretë (gjyshër, vëllezër/motra)','spouse':'Vetëm bashkëshorti pasjetues','distant':'Të afërm deri në shkallën e gjashtë / shteti' };
      var COLORS=['#3d706a','#b8923a','#b15c44','#6a8caf','#8a6a1e','#5a7d6a'];
      function expandHeirs(c, names){
        names=names||[]; var out=[], ni=0;
        c.heirs.forEach(function(h){ for(var k=0;k<h.count;k++){ var nm=names[ni]||'', label;
          if(h.who==='Fëmijët') label=nm?('Fëmija — '+nm):'Fëmija '+(k+1);
          else if(h.who==='Bashkëshorti pasjetues') label=nm?('Bashkëshorti — '+nm):'Bashkëshorti pasjetues';
          else if(h.who==='Prindërit') label=nm?('Prindi — '+nm):'Prindi '+(k+1);
          else if(h.who.indexOf('Vëllezër')===0) label=nm?('Vëlla/motër — '+nm):'Vëlla/motër '+(k+1);
          else if(h.who.indexOf('Gjyshërit')===0) label=nm?('Gjyshi/ja — '+nm):'Gjyshi/ja '+(k+1);
          else if(h.who.indexOf('Degë')===0) label=nm?('Degë përfaqësimi — '+nm):'Degë përfaqësimi '+(k+1);
          else label=nm?(h.who+' — '+nm):(h.who+(h.count>1?(' '+(k+1)):''));
          out.push({label:label, fraction:h.fraction, note:h.note, who:h.who}); ni++;
        } });
        return out;
      }
      var NENI_OF={ 'I':'361','II':'361 & 363','III':'361 & 364','spouse':'361' };
      function renderPropertyDivision(c){
        var el=$('inh-out-property'), block=$('inh-property-block'); if(!el||!block) return;
        if(!(c.spousePropertyShare>0)){ block.hidden=true; return; }
        var half=Math.round(c.spousePropertyShare), fromComm=Math.round((c.community||0)-c.spousePropertyShare), pers=Math.round(c.personal||0), debts=Math.round(c.debts||0), net=Math.round(c.netEstate);
        var html='<p class="op-fc-basis">Bashkëshorti mban gjysmën e vet të pasurisë së përbashkët si <strong>e drejtë pasurore</strong> (neni 358) — kjo NUK është trashëgimi. Trashëgimia zbatohet vetëm mbi pjesën e mbetur.</p><div class="op-stat-grid">';
        html+='<div class="op-stat"><div class="op-stat-label">Bashkëshorti mban — ½ e së përbashkëtit</div><div class="op-stat-value">'+fmtN(half)+' <small>L · neni 358</small></div></div>';
        html+='<div class="op-stat"><div class="op-stat-label">Nga e përbashkëta → trashëgim</div><div class="op-stat-value">'+fmtN(fromComm)+' <small>L</small></div></div>';
        if(pers>0) html+='<div class="op-stat"><div class="op-stat-label">Pasuria vetjake → trashëgim</div><div class="op-stat-value">'+fmtN(pers)+' <small>L</small></div></div>';
        if(debts>0) html+='<div class="op-stat"><div class="op-stat-label">Minus borxhe</div><div class="op-stat-value">−'+fmtN(debts)+' <small>L</small></div></div>';
        html+='<div class="op-stat"><div class="op-stat-label">Pasuria neto për trashëgim</div><div class="op-stat-value">'+fmtN(net)+' <small>L</small></div></div></div>';
        el.innerHTML=html; block.hidden=false;
      }
      function renderShares(c){
        var el=$('inh-out-shares'), html='';
        if(c.order==='distant'){ el.innerHTML='<p>Nuk u dha trashëgimtar i rendeve I–III. Pasuria u kalon të afërmve deri në shkallën e gjashtë, ose, në mungesë, shtetit (nenet 365–366).</p>'; return; }
        var segs=''; c.heirs.forEach(function(h,i){ segs+='<div class="inh-bar-seg" title="'+esc(h.who)+'" style="width:'+Math.round(h.fraction*h.count*100)+'%;background:'+COLORS[i%COLORS.length]+'"></div>'; });
        html+='<div class="inh-bar">'+segs+'</div>';
        var nmEl=$('inh-names'), names=(nmEl?nmEl.value:'').split(/[\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
        expandHeirs(c,names).forEach(function(p){ var amt=(c.netEstate>0)?(fmtN(Math.round(p.fraction*c.netEstate))+' L'):''; var neni=(p.who.indexOf('Degë')===0?'361, 326–327':(NENI_OF[c.order]||'361'));
          html+='<div class="inh-share-row"><div class="inh-share-who">'+esc(p.label)+'<small>Baza: neni '+neni+(p.note?(' · '+esc(p.note)):'')+'</small></div><div style="text-align:right"><div class="inh-share-frac">'+fracStr(p.fraction)+'</div>'+(amt?'<div class="inh-share-amt">'+amt+'</div>':'')+'</div></div>'; });
        var sp=c.heirs.filter(function(h){ return h.who==='Bashkëshorti pasjetues'; })[0];
        if(c.spousePropertyShare>0 && sp){ var prop=Math.round(c.spousePropertyShare), inh=Math.round(sp.fraction*c.netEstate);
          html+='<div class="inh-share-row" style="border-top:2px solid var(--border);margin-top:8px;padding-top:10px"><div class="inh-share-who">Bashkëshorti — gjithsej<small>pjesa pasurore (½ e përbashkëtit) + pjesa trashëgimore</small></div><div style="text-align:right"><div class="inh-share-amt"><strong>'+fmtN(prop+inh)+' L</strong></div><div style="font-size:.7rem;color:var(--muted)">'+fmtN(prop)+' + '+fmtN(inh)+'</div></div></div>'; }
        html+='<p class="inh-order-note">'+esc(ORDER_NAME[c.order]||'')+(c.grossEstate>0?(' · Pasuria neto për trashëgim: '+fmtN(Math.round(c.netEstate))+' L'+(c.debts>0?(' (pas '+fmtN(c.debts)+' L borxhe)'):'')):'')+'</p>';
        el.innerHTML=html;
      }
      function renderAssumptions(inp,c){
        var el=$('inh-out-assume'), block=$('inh-assume-block'); if(!el) return; var items=[];
        if(inp.spouse && inp.community>0 && inp.regime!=='ndarje') items.push('Regjimi: bashkësi ligjore. U zbatua neni 358 — bashkëshorti mban ½ e pasurisë së përbashkët si e drejtë pasurore (jo trashëgimi); vetëm pjesa e mbetur trashëgohet.');
        else if(inp.spouse && inp.regime==='ndarje') items.push('Regjimi: ndarje pasurore — nuk zbatohet ndarja ½ e nenit 358; e gjithë pasuria e të ndjerit hyn në trashëgim.');
        else if(inp.spouse) items.push('Nuk u fut pasuri e përbashkët martesore; nëse ka (regjim bashkësie), bashkëshorti mban ½ e saj para trashëgimit (neni 358).');
        items.push('Supozohet se asnjë trashëgimtar nuk është i padenjë (nenet 322–324) dhe askush nuk ka hequr dorë, përveç sa treguar.');
        if(inp.hasWill) items.push('Testamenti mund të ndryshojë ndarjen vetëm brenda pjesës së disponueshme; rezerva ligjore e të miturve/të paaftëve mbetet e pacenueshme (neni 379).');
        else items.push('Llogaritja është për trashëgimi ligjore (pa testament); një testament i vlefshëm mund ta ndryshojë brenda pjesës së disponueshme.');
        if(c.netEstate>0) items.push('Vlerat monetare janë mbi pasurinë neto ('+fmtN(Math.round(c.netEstate))+' L) dhe janë orientuese.');
        el.innerHTML='<ul class="op-checklist">'+items.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'; block.hidden=false;
      }
      function renderScenarios(inp,c){
        var el=$('inh-out-scenarios'), block=$('inh-scenarios-block'); if(!el) return; var rows=[];
        if(inp.hasWill&&c.reserve){ rows.push(['Pa testament (vetëm ligji)','Ndarja e plotë sipas rendeve.']); rows.push(['Me testament','I lirë vetëm '+fracStr(c.reserve.disposableFrac)+' (pjesa e disponueshme); pjesa tjetër mbetet rezervë.']); }
        else { var c2=computeInheritance(Object.assign({},inp,{hasWill:true,willExcludesReserved:false})); if(c2.reserve&&c2.reserve.protectedCount>0) rows.push(['Nëse bën testament','Do të mund të disponoje '+fracStr(c2.reserve.disposableFrac)+'; '+fracStr(c2.reserve.reservedFrac)+' do mbetej rezervë për të miturit/të paaftët (nenet 379, 413).']); else rows.push(['Nëse bën testament','Pa trashëgimtarë të mbrojtur, mund të disponosh të gjithë pasurinë me testament (neni 378).']); }
        if(inp.childrenAlive>1){ var cr=computeInheritance(Object.assign({},inp,{childrenAlive:inp.childrenAlive-1})); var ch=cr.heirs.filter(function(h){ return h.who==='Fëmijët'; })[0]; if(ch) rows.push(['Nëse një fëmijë heq dorë','Pjesa e tij u shtohet të tjerëve (neni 370); secili trashëgimtar do të merrte '+fracStr(ch.fraction)+'.']); }
        else if(inp.spouse&&(inp.childrenAlive>0||inp.parentsAlive>0||inp.siblings>0)){ rows.push(['Nëse bashkëshorti heq dorë','Pjesa e tij u shtohet trashëgimtarëve të tjerë të rendit (neni 370).']); }
        if(!rows.length){ block.hidden=true; return; }
        el.innerHTML='<div class="op-qual">'+rows.map(function(r){ return '<div class="op-qual-row"><span class="op-qual-k">'+esc(r[0])+'</span><span class="op-qual-v">'+esc(r[1])+'</span></div>'; }).join('')+'</div>'; block.hidden=false;
      }
      function renderPreview(){
        var el=$('inh-preview'); if(!el) return; var inp=readForm();
        if(!inp.spouse&&!inp.childrenAlive&&!inp.predeceasedWithKids&&!inp.parentsAlive&&!inp.siblings&&!inp.grandparents&&!inp.dependents){ el.innerHTML=''; return; }
        var c=computeInheritance(inp);
        if(c.order==='distant'){ el.innerHTML='<div class="inh-prev-label">Parashikim i shpejtë</div><p style="font-size:.8rem;color:var(--muted);margin:0">Pa trashëgimtarë të rendeve I–III.</p>'; return; }
        var segs=''; c.heirs.forEach(function(h,i){ segs+='<div class="inh-bar-seg" style="width:'+Math.round(h.fraction*h.count*100)+'%;background:'+COLORS[i%COLORS.length]+'"></div>'; });
        var rows=c.heirs.map(function(h){ return '<span style="font-size:.78rem">'+(h.count>1?(h.count+'× '):'')+esc(h.who.replace(' pasjetues',''))+': <strong>'+fracStr(h.fraction)+'</strong></span>'; }).join(' · ');
        el.innerHTML='<div class="inh-prev-label">Parashikim i shpejtë (llogaritje e saktë)</div><div class="inh-bar">'+segs+'</div><div style="display:flex;flex-wrap:wrap;gap:10px">'+rows+'</div>';
      }
      function renderReserve(c){ var block=$('inh-reserve-block'), el=$('inh-out-reserve'); if(!c.reserve){ block.hidden=true; return; } var r=c.reserve, html='<p>Fëmijët e mitur dhe personat e paaftë për punë nuk mund të përjashtohen me testament (neni 379); pjesa e tyre llogaritet sipas nenit 413.</p>'; html+='<div class="op-stat-grid"><div class="op-stat"><div class="op-stat-label">Pjesa e rezervuar (e pacenueshme)</div><div class="op-stat-value">'+fracStr(r.reservedFrac)+(c.netEstate>0?' <small>≈ '+fmtN(Math.round(r.reservedFrac*c.netEstate))+' L</small>':'')+'</div></div><div class="op-stat"><div class="op-stat-label">Pjesa e disponueshme me testament</div><div class="op-stat-value">'+fracStr(r.disposableFrac)+(c.netEstate>0?' <small>≈ '+fmtN(Math.round(r.disposableFrac*c.netEstate))+' L</small>':'')+'</div></div></div>'; if(r.warning) html+='<div class="op-deadline-note"><div>⚠ '+esc(r.warning)+'</div></div>'; el.innerHTML=html; block.hidden=false; }
      function renderRefs(refs){ var block=$('inh-refs-block'), el=$('inh-out-refs'); if(!refs||!refs.length){ block.hidden=true; return; } var html='<p style="margin:0 0 12px"><a class="opinion-law-link" target="_blank" rel="noopener noreferrer" href="'+LAW_BASE+'kodi-civil.html">Shiko Kodin Civil të plotë →</a></p><ul class="op-ref-list">'; refs.forEach(function(a){ html+='<li class="op-ref op-ref-ok"><details class="op-ref-details"><summary><span class="op-ref-icon">✓</span><span class="op-ref-label">Neni '+a.num+(a.xref?' <span style="color:var(--muted);font-weight:400">· referuar</span>':'')+'</span><a href="'+LAW_BASE+'kodi-civil.html#neni-'+a.num+'" target="_blank" rel="noopener noreferrer" class="op-ref-hint" style="text-decoration:none">hap →</a></summary><p class="op-ref-text">'+esc(a.text)+'</p></details></li>'; }); el.innerHTML=html+'</ul>'; block.hidden=false; }
      function inhVerifier(ctx, sharesText, draft){
        if(typeof iCall!=='function') return Promise.resolve(null);
        var usr='ARSYETIMI PËR T\'U KONTROLLUAR:\n'+String(draft||'').slice(0,4000)+'\n\nNDARJA E SAKTË E LLOGARITUR (autoritative): '+sharesText+'\n\n'+ctx+'\n\nKontrollo nëse arsyetimi pajtohet me ndarjen e llogaritur dhe me tekstin zyrtar të neneve. Jep JSON:\n{"confidence":"high|medium|low","issues":["..."]}';
        return iCall('Jeni auditues i pavarur i së drejtës së trashëgimisë. Kontrolloni kundrejt ndarjes së llogaritur dhe tekstit zyrtar të neneve. Përgjigjuni VETËM me JSON të vlefshëm.', usr, 500, 0.2)
          .then(function(r){ try{ var j=JSON.parse(String(r).replace(/```json?|```/g,'').trim()); return {confidence:String(j.confidence||'').toLowerCase(), issues:j.issues||[]}; }catch(e){ return null; } })
          .catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; });
      }
      function renderADRInh(c, inp, raw){
        var block=$('inh-adr-block'), el=$('inh-out-adr'); if(!block||!el) return;
        var ai=null; try{ ai=JSON.parse(String(raw||'').replace(/```json?|```/g,'').trim()); }catch(e){ ai=null; }
        if(!ai || !adrApplicableInh(c,inp)){ block.hidden=true; return; }
        var det={ cls:'op-conf-hi', label:'E përshtatshme', note:'Mosmarrëveshjet e trashëgimisë mes familjarëve i përshtaten zakonisht ndërmjetësimit.' };
        el.innerHTML=adrHtml(det, ai); block.hidden=false;
      }
      function renderInhVerify(v){
        var re=$('inh-out-refs'), rb=$('inh-refs-block'); if(!re||!v) return;
        var lab={high:['op-conf-hi','E lartë'],medium:['op-conf-mid','Mesatare'],low:['op-conf-lo','E ulët']}[v.confidence]||['op-conf-mid','Mesatare'];
        var note='<p style="margin:0 0 10px"><strong>Kontroll cilësie:</strong> besueshmëria <span class="op-conf '+lab[0]+'">'+lab[1]+'</span></p>';
        if(v.issues&&v.issues.length) note+='<ul class="op-checklist" style="margin:0 0 12px">'+v.issues.filter(Boolean).slice(0,5).map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>';
        re.innerHTML=note+re.innerHTML; if(rb) rb.hidden=false;
      }

      var running=false, attachedWill='', resetWillPdf=function(){};
      function step(i,cls){ var e=$('inh-step-'+i); if(e){ e.classList.remove('active','done','failed'); if(cls) e.classList.add(cls); } }
      function readForm(){ return { spouse:$('inh-spouse').value==='po', childrenAlive:parseInt($('inh-children').value,10)||0, childrenMinor:parseInt($('inh-minor').value,10)||0, predeceasedWithKids:parseInt($('inh-predeceased').value,10)||0, parentsAlive:parseInt($('inh-parents').value,10)||0, siblings:parseInt($('inh-siblings').value,10)||0, grandparents:parseInt($('inh-grandparents').value,10)||0, dependents:parseInt($('inh-dependents').value,10)||0, hasWill:$('inh-will').value==='po', willExcludesReserved:$('inh-willexcl').value==='po', regime:$('inh-regime')?$('inh-regime').value:'bashkesi', community:parseAmt($('inh-community').value), personal:parseAmt($('inh-personal').value), debts:parseAmt($('inh-debts').value) }; }

      function generate(){
        if(running) return; $('inherit-form-error').hidden=true;
        var inp=readForm();
        if(!inp.spouse&&!inp.childrenAlive&&!inp.predeceasedWithKids&&!inp.parentsAlive&&!inp.siblings&&!inp.grandparents&&!inp.dependents){ var bx=$('inherit-form-error'); bx.textContent='Plotësoni të paktën një trashëgimtar (bashkëshort, fëmijë, prind, etj.).'; bx.hidden=false; return; }
        running=true; abortCtrl=new AbortController();
        $('inherit-generate-btn').disabled=true; $('inherit-form').hidden=true; $('inherit-progress').hidden=false; [0,1,2,3,4].forEach(function(i){ step(i,''); });
        var c=computeInheritance(inp), details=$('inh-details').value.trim();
        var fam='Bashkëshorti: '+(inp.spouse?'po':'jo')+'; fëmijë të gjallë: '+inp.childrenAlive+' (të mitur: '+inp.childrenMinor+'); degë përfaqësimi: '+inp.predeceasedWithKids+'; prindër: '+inp.parentsAlive+'; vëllezër/motra: '+inp.siblings+'; gjyshër: '+inp.grandparents+'; persona të paaftë në ngarkim: '+inp.dependents+'; testament: '+(inp.hasWill?'po':'jo')+(details?('. Detaje: '+details):'');
        var sharesText=c.heirs.map(function(h){ return (h.count>1?h.count+'× ':'')+h.who+' = '+fracStr(h.fraction)+' secili'; }).join('; ')||'(pa trashëgimtarë të afërt)';
        step(0,'active');
        buildGrounding(groundingArticles(inp)).then(function(g){
          step(0,'done'); [1,2,3,4].forEach(function(i){ step(i,'active'); });
          var propNote=(c.spousePropertyShare>0)?('\nNDARJA PASURORE (neni 358): bashkëshorti mban '+fmtN(Math.round(c.spousePropertyShare))+' L (½ e pasurisë së përbashkët) si E DREJTË PASURORE, jo trashëgimi. Pasuria neto për trashëgim: '+fmtN(Math.round(c.netEstate))+' L.'):((inp.spouse&&inp.regime==='ndarje')?'\nRegjimi: ndarje pasurore — pa ndarje 1/2 të nenit 358.':'');
          var ctx='SITUATA FAMILJARE:\n'+fam+'\n\nNDARJA E LLOGARITUR (e saktë sipas Kodit Civil — MOS e ndrysho):\n'+sharesText+propNote+(g.text?('\n\n'+g.text):'');
          var tasks=[
            iCall('Jeni profesor i së drejtës së trashëgimisë shqiptare. Shkruani arsyetim ligjor të strukturuar, duke cituar VETËM nenet e dhëna. MOS i ndryshoni fraksionet e llogaritura — ato janë të sakta.', INH_FEWSHOT+'\n\n'+ctx+'\n\nShkruaj arsyetimin me KËTA tituj (secili në krye rreshti):\nRENDI I ZBATUESHËM\nPJESA E BASHKËSHORTIT\nPËRFAQËSIMI\nREZERVA LIGJORE\nKONKLUZION\nNën secilin, 1–3 fjali të qarta me referenca te nenet. Nëse një titull nuk zbatohet, shkruaj «Nuk zbatohet».', 1000,0.25).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }),
            (attachedWill ? iCall('Jeni jurist shqiptar, ekspert testamentesh sipas Kodit Civil.', ctx+'\n\nTEKSTI I TESTAMENTIT TË NGARKUAR:\n'+attachedWill.slice(0,6000)+'\n\nVlerëso: (1) formën (ollograf/noterial, nenet 392–400), (2) a cenon rezervën ligjore të të miturve/të paaftëve (nenet 379, 407), (3) afatin e kontestimit (neni 411). Cito nenet.', 800,0.35).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }) : Promise.resolve(null)),
            iCall('Jeni avokat shqiptar i trashëgimisë.', ctx+'\n\nListo rreziqet dhe shkaqet e mundshme të kontestimit: padenjësia, heqja dorë, përfaqësimi, atësia/birësimi, pasuria e përbashkët martesore (neni 358). 4–6 pika.', 600,0.45).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }),
            iCall('Jeni noter/jurist shqiptar.', ctx+'\n\nJep hapat praktikë: dëshmia e trashëgimisë te noteri, inventari (neni 415), regjistrimi i pronës, afatet, heqja dorë nëse duhet. Listë e numëruar.', 600,0.4).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; })
          ];
          tasks.push(adrApplicableInh(c,inp) ? iCall(ADR_SYS, ctx+'\n\nVlerëso nëse mosmarrëveshja e mundshme mes trashëgimtarëve (ndarja ose kontestimi i testamentit) mund të zgjidhet me ndërmjetësim familjar ose arbitrazh, sa gjasa ka, dhe skenarët më të mirë e më të keq.'+ADR_JSON, 700,0.4).catch(function(e){ if(e&&e.name==='AbortError') throw e; return null; }) : Promise.resolve(null));
          return Promise.all(tasks).then(function(res){
            step(1,res[0]?'done':'failed'); step(2,attachedWill?(res[1]?'done':'failed'):'done'); step(3,res[2]?'done':'failed'); step(4,res[3]?'done':'failed');
            $('inherit-doc-meta').textContent=JurDate.fmt(new Date())+' · Trashëgimi ligjore';
            renderPropertyDivision(c);
            renderShares(c);
            $('inh-out-explain').innerHTML=iMd(enforceShares(res[0], c));
            renderReserve(c);
            renderAssumptions(inp,c);
            renderScenarios(inp,c);
            if(attachedWill&&res[1]){ $('inh-out-will').innerHTML=iMd(res[1]); $('inh-will-block').hidden=false; } else { $('inh-will-block').hidden=true; }
            $('inh-out-risks').innerHTML=iMd(res[2]);
            renderADRInh(c, inp, res[4]);
            $('inh-out-plan').innerHTML=iMd(res[3]);
            renderRefs(g.refs);
            ['inh-out-shares','inh-out-property','inh-out-reserve','inh-out-assume','inh-out-scenarios','inh-out-adr'].forEach(function(id){ var e=$(id); if(e&&e.innerHTML&&e.innerHTML.indexOf('<a ')<0) e.innerHTML=linkNene(e.innerHTML,'kodi-civil.html'); });
            var draft=[res[0],res[1],res[2]].filter(Boolean).join('\n\n');
            return inhVerifier(ctx,sharesText,draft).then(function(v){ if(v) renderInhVerify(v); $('inherit-progress').hidden=true; $('inherit-output').hidden=false; $('inherit-modal-inner').scrollTop=0; });
          });
        }).catch(function(err){ if(err&&err.name==='AbortError') return; $('inherit-progress').hidden=true; $('inherit-form').hidden=false; var bx=$('inherit-form-error'); bx.textContent='Gabim gjatë analizës: '+(err&&err.message?err.message:'provoni sërish.'); bx.hidden=false; })
        .then(function(){ running=false; $('inherit-generate-btn').disabled=false; });
      }

      // PDF (reuses shared extractPdfText with OCR)
      (function(){ var inp=$('inh-pdf'), st=$('inh-pdf-status'), clr=$('inh-pdf-clear'), view=$('inh-pdf-view'), preview=$('inh-pdf-preview'); if(!inp) return;
        attachPdfPreview(view, preview, function(){ return attachedWill; });
        function reset(){ attachedWill=''; inp.value=''; if(st){ st.textContent=''; st.classList.remove('warn'); } if(clr) clr.hidden=true; if(view){ view.hidden=true; view.textContent='Shiko tekstin'; } if(preview){ preview.hidden=true; preview.textContent=''; } } resetWillPdf=reset; if(clr) clr.addEventListener('click',reset);
        inp.addEventListener('change',function(){ var f=inp.files&&inp.files[0]; if(!f) return; if(typeof extractPdfText!=='function'){ st.textContent='Lexuesi i PDF mungon.'; st.classList.add('warn'); return; } st.classList.remove('warn'); st.textContent='Duke lexuar…'; clr.hidden=false; attachedWill=''; if(view){ view.hidden=true; view.textContent='Shiko tekstin'; } if(preview){ preview.hidden=true; preview.textContent=''; } extractPdfText(f,8000,function(m){ st.textContent=m; }).then(function(t){ if(!t){ st.textContent='PDF pa tekst (i skanuar?).'; st.classList.add('warn'); return; } attachedWill=t; st.textContent=f.name+' · '+t.split(/\s+/).length+' fjalë'; if(view) view.hidden=false; }).catch(function(){ st.textContent='Nuk u lexua dot.'; st.classList.add('warn'); }); });
      })();

      function openModal(){ $('inherit-modal').hidden=false; document.body.style.overflow='hidden'; $('inherit-close').focus(); }
      function closeModal(){ if(abortCtrl) abortCtrl.abort(); $('inherit-modal').hidden=true; document.body.style.overflow=''; }
      function restart(){ if(abortCtrl) abortCtrl.abort(); running=false; $('inherit-generate-btn').disabled=false; $('inherit-output').hidden=true; $('inherit-progress').hidden=true; $('inherit-form').hidden=false; $('inherit-form-error').hidden=true; }
      $('inherit-open-btn').addEventListener('click',openModal);
      $('inherit-close').addEventListener('click',closeModal);
      $('inherit-generate-btn').addEventListener('click',generate);
      $('inherit-restart-btn').addEventListener('click',restart);
      if($('inherit-cancel-btn')) $('inherit-cancel-btn').addEventListener('click',closeModal);
      $('inherit-print-btn').addEventListener('click',function(){ var ds=Array.prototype.slice.call(document.querySelectorAll('#inherit-modal .op-breakdown')); var were=ds.map(function(d){ return d.open; }); ds.forEach(function(d){ d.open=true; }); function restore(){ ds.forEach(function(d,i){ d.open=were[i]; }); window.removeEventListener('afterprint',restore); } window.addEventListener('afterprint',restore); setTimeout(restore,3000); window.print(); });
      $('inherit-modal').addEventListener('click',function(e){ if(e.target===this) closeModal(); });
      document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!$('inherit-modal').hidden) closeModal(); });
      ['inh-spouse','inh-children','inh-minor','inh-predeceased','inh-parents','inh-siblings','inh-grandparents','inh-dependents','inh-will','inh-willexcl','inh-regime','inh-community','inh-personal','inh-debts','inh-names'].forEach(function(id){ var e=$(id); if(e){ e.addEventListener('input',renderPreview); e.addEventListener('change',renderPreview); } });
    })();

    /* ── Rich-report engine for the upgraded tools (Contract / Penal / Negotiator) ── */
    (function(){
      'use strict';
      if(typeof aiFetch!=='function' || !document.getElementById('tool-report-modal')) return;
      function $(id){ return document.getElementById(id); }
      function inl(t){ return t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>'); }
      function md(raw, lawFile){
        var lines=esc(raw||'').split('\n'), out='', list=false;
        function close(){ if(list){ out+='</ul>'; list=false; } }
        lines.forEach(function(ln){ ln=ln.trim();
          if(!ln){ close(); return; }
          var h=ln.match(/^#{1,4}\s+(.*)$/); if(h){ close(); out+='<h3 class="opinion-section-head">'+inl(h[1])+'</h3>'; return; }
          var b=ln.match(/^[-•*]\s+(.*)$/); if(b){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(b[1])+'</li>'; return; }
          var o=ln.match(/^\d+[.)]\s+(.*)$/); if(o){ if(!list){ out+='<ul class="opinion-md-list">'; list=true; } out+='<li>'+inl(o[1])+'</li>'; return; }
          close(); out+='<p>'+inl(ln)+'</p>';
        });
        close();
        return (typeof linkNene==='function') ? linkNene(out, lawFile||'kodi-civil.html') : out;
      }
      var abort=null, running=false;
      function ai(sys, usr, maxTok, temp){
        return aiFetch({ signal:abort?abort.signal:undefined, body:JSON.stringify({ max_tokens:maxTok||900, temperature:(typeof temp==='number')?temp:0.4, messages:[{role:'system',content:sys},{role:'user',content:usr}] }) }, true)
          .then(function(r){ if(!r.ok){ var e=new Error('http '+r.status); e.status=r.status; throw e; } return r.json(); })
          .then(function(d){ var c=(d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||''; if(!c) throw new Error('bosh'); return c; });
      }
      var STOP={}; 'dhe ose nje per nga me te ta se si ku kur qe ne eshte jane qene ka kane mbi nen sipas cdo kjo ato kete keto'.split(' ').forEach(function(w){ STOP[w]=1; });
      function terms(s){ var seen={},out=[]; String(s||'').toLowerCase().split(/[^a-zçë0-9]+/).forEach(function(w){ if(w.length>=4&&!STOP[w]&&!seen[w]){ seen[w]=1; out.push(w); } }); return out; }
      function ground(lawFiles, text){
        var tms=terms(text); if(!tms.length||!(lawFiles&&lawFiles.length)) return Promise.resolve({textBlock:'',refs:[]});
        return Promise.all(lawFiles.map(function(f){
          return fetch('data/'+f.replace(/\.html$/,'.json'),{signal:abort?abort.signal:undefined}).then(function(r){ return r.ok?r.json():{}; }).catch(function(e){ if(e&&e.name==='AbortError') throw e; return {}; }).then(function(data){ return {file:f,data:data||{}}; });
        })).then(function(rows){
          var cands=[];
          rows.forEach(function(row){ Object.keys(row.data).forEach(function(num){ var t=String(row.data[num]||''); if(!t) return; var tl=t.toLowerCase(),sc=0; tms.forEach(function(w){ if(tl.indexOf(w)!==-1) sc++; }); if(sc>0) cands.push({file:row.file,num:num,text:t.replace(/\s+/g,' ').trim(),kw:sc}); }); });
          if(!cands.length) return {textBlock:'',refs:[]};
          cands.sort(function(a,b){ return b.kw-a.kw; }); cands=cands.slice(0,30);
          function finish(top){ var refs=top.map(function(c){ return {file:c.file,num:c.num,text:c.text}; });
            var block=top.length?('TEKSTI ZYRTAR I NENEVE (mbështetu VETËM te këto; mos cito nene jashtë tyre):\n\n'+top.map(function(c){ return 'Neni '+c.num+': «'+c.text.slice(0,650)+'»'; }).join('\n\n')):'';
            return {textBlock:block, refs:refs}; }
          if(typeof aiEmbed!=='function') return finish(cands.slice(0,8));
          var inputs=[String(text).slice(0,1500)].concat(cands.map(function(c){ return c.text.slice(0,500); }));
          return aiEmbed(inputs).then(function(vecs){ if(!vecs||vecs.length!==inputs.length) return finish(cands.slice(0,8));
            function cos(a,b){ var s=0,na=0,nb=0,n=Math.min(a.length,b.length); for(var i=0;i<n;i++){ s+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; } return (na&&nb)?s/(Math.sqrt(na)*Math.sqrt(nb)):0; }
            var q=vecs[0]; cands.forEach(function(c,i){ c.sim=cos(q,vecs[i+1]); }); cands.sort(function(a,b){ return b.sim-a.sim; }); return finish(cands.slice(0,8));
          }).catch(function(){ return finish(cands.slice(0,8)); });
        }).catch(function(e){ if(e&&e.name==='AbortError') throw e; return {textBlock:'',refs:[]}; });
      }
      function refsHtml(refs){ if(!refs||!refs.length) return ''; var base=(typeof LAW_BASE!=='undefined')?LAW_BASE:'';
        var html='<ul class="op-ref-list">';
        refs.forEach(function(a){ var href=base+a.file+'#neni-'+String(a.num).split('/')[0];
          html+='<li class="op-ref op-ref-ok"><details class="op-ref-details"><summary><span class="op-ref-icon">✓</span><span class="op-ref-label">Neni '+esc(a.num)+'</span><a href="'+href+'" target="_blank" rel="noopener noreferrer" class="op-ref-hint" style="text-decoration:none">hap →</a></summary><p class="op-ref-text">'+esc(a.text)+'</p></details></li>'; });
        return html+'</ul>'; }
      var BLK=['opinion-block-a','opinion-block-b','opinion-block-c','opinion-block-d','opinion-block-e','opinion-block-f'];
      function section(label, body, i){ return '<div class="opinion-section-block '+BLK[i%BLK.length]+'"><div class="opinion-block-label">'+esc(label)+'</div><div class="opinion-section-body">'+body+'</div></div>'; }
      function openModal(){ $('tool-report-modal').hidden=false; document.body.style.overflow='hidden'; $('tool-close').focus(); }
      function closeModal(){ if(abort) abort.abort(); running=false; $('tool-report-modal').hidden=true; document.body.style.overflow=''; }

      function showToolError(msg, cfg){
        $('tool-progress').hidden=true; $('tool-output').hidden=true;
        var e=$('tool-error'); e.innerHTML='';
        var p=document.createElement('p'); p.className='tool-error-msg'; p.textContent=msg||'Ndodhi një gabim — provoni sërish.'; e.appendChild(p);
        var b=document.createElement('button'); b.type='button'; b.className='tool-retry-btn'; b.textContent='Provo sërish';
        b.addEventListener('click', function(){ e.hidden=true; running=false; runToolReport(cfg); }); e.appendChild(b);
        e.hidden=false;
      }
      var lastRun=null; // context for per-section retry after a partial failure
      function failedSectionBody(idx){
        return '<p class="op-degraded">Kjo pjesë nuk u gjenerua. <button type="button" class="tool-sec-retry tool-retry-btn" data-sec="'+idx+'" style="margin-left:8px">Provo sërish</button></p>';
      }
      function runToolReport(cfg){
        if(running) return;
        var primary=(cfg.lawFiles&&cfg.lawFiles[0])||'kodi-civil.html';
        openModal();
        $('tool-modal-title').textContent=cfg.title||'Raport';
        $('tool-doc-eyebrow').textContent=cfg.eyebrow||cfg.title||'Raport Ligjor';
        $('tool-doc-meta').textContent=JurDate.fmt(new Date());
        $('tool-error').hidden=true; $('tool-output').hidden=true; $('tool-sections').innerHTML='';
        if(!aiConfigured()){ showToolError('Shërbimi AI nuk është i konfiguruar (mungon çelësi). Analiza me AI nuk mund të kryhet.', cfg); return; }
        running=true; abort=new AbortController();
        $('tool-progress').hidden=false; $('tool-progress-label').textContent='Duke lexuar bazën ligjore…';
        var hardErr=null;
        ground(cfg.lawFiles, cfg.input).then(function(g){
          $('tool-progress-label').textContent='Duke analizuar…';
          var GT=g.textBlock?('\n\n'+g.textBlock):'';
          lastRun={cfg:cfg, GT:GT, primary:primary};
          // Deterministic block first — computed from the grounded refs, independent of the AI.
          var det=null;
          if(typeof cfg.compute==='function'){ try{ det=cfg.compute(cfg.input, g); }catch(e){ det=null; } }
          var tasks=(cfg.aiSections||[]).map(function(sec, idx){
            return ai(sec.sys, sec.usr(cfg.input, GT), sec.maxTok, sec.temp)
              .then(function(t){ return {label:sec.label, body:md(t, primary), ok:true}; })
              .catch(function(e){ if(e&&e.name==='AbortError') throw e; if(e&&e.status&&!hardErr) hardErr=e; return {label:sec.label, body:failedSectionBody(idx), ok:false}; });
          });
          return Promise.all(tasks).then(function(aiRes){
            var okCount=aiRes.filter(function(r){ return r&&r.ok; }).length;
            if(aiRes.length && okCount===0 && !(det&&det.body)){ showToolError(aiErrMsg(hardErr&&hardErr.status, hardErr), cfg); return; }
            var html='', i=0;
            // Deterministic block survived but every AI section failed → say so, don't degrade silently.
            if(aiRes.length && okCount===0 && det&&det.body){
              html+='<div class="opinion-form-error" style="margin:0 0 16px">Seksionet me AI nuk u gjeneruan — '+esc(aiErrMsg(hardErr&&hardErr.status, hardErr))+' Përdorni «Provo sërish» te secili seksion.</div>';
            }
            if(det&&det.body) html+=section(det.label, det.body, i++);
            aiRes.forEach(function(r){ if(r) html+=section(r.label, r.body, i++); });
            if(g.refs&&g.refs.length) html+=section('Referencat (nene të lidhura)', refsHtml(g.refs), i++);
            $('tool-sections').innerHTML=html;
            $('tool-progress').hidden=true; $('tool-output').hidden=false; $('tool-report-inner').scrollTop=0;
          });
        }).catch(function(err){ if(err&&err.name==='AbortError') return; showToolError(aiErrMsg(err&&err.status, err), cfg); })
        .then(function(){ running=false; });
      }
      // Re-run just one failed section in place.
      $('tool-sections').addEventListener('click', function(ev){
        var btn=ev.target&&ev.target.closest?ev.target.closest('.tool-sec-retry'):null;
        if(!btn||!lastRun) return;
        var sec=(lastRun.cfg.aiSections||[])[+btn.getAttribute('data-sec')]; if(!sec) return;
        var blk=btn.closest('.opinion-section-block'), bodyEl=blk?blk.querySelector('.opinion-section-body'):null; if(!bodyEl) return;
        btn.disabled=true; btn.textContent='Duke provuar…';
        if(!abort||(abort.signal&&abort.signal.aborted)) abort=new AbortController();
        ai(sec.sys, sec.usr(lastRun.cfg.input, lastRun.GT), sec.maxTok, sec.temp)
          .then(function(t){ bodyEl.innerHTML=md(t, lastRun.primary); })
          .catch(function(e){ if(e&&e.name==='AbortError') return; btn.disabled=false; btn.textContent='Provo sërish'; });
      });

      // ── Deterministic sanction ("diapazon") extraction from official article text.
      // The range is shown ONLY when the grounded law text literally states it; if no
      // sanction phrase is found in the retrieved articles, no range is shown at all.
      // sqNum() (Albanian numeral parser) lives in ai.js — shared with extractDeadlines()
      // there, since ai.js is loaded on both this page and every generated law page.
      function fmtN(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' '); }
      function extractSanctions(refs){
        var out=[];
        (refs||[]).forEach(function(a){
          var t=String(a.text||'').replace(/\s+/g,' '), low=t.toLowerCase(), items=[], m;
          function push(kind, m0, minPh, maxPh, unit){
            items.push({ kind:kind, text:t.substr(m0.index,m0[0].length), min:minPh!=null?sqNum(minPh):null, max:maxPh!=null?sqNum(maxPh):null, unit:unit||'' });
          }
          var reBR=/me\s+burgim\s+nga\s+([^,;.()]{1,40}?)\s+(?:gjer|deri)\s+(?:në\s+)?([^,;.()]{1,40}?)\s+(vjet|muaj|javë|ditë)/g;
          while((m=reBR.exec(low))!==null) push('burgim', m, m[1], m[2], m[3]);
          var reBM=/me\s+burgim\s+(?:gjer|deri)\s+(?:në\s+)?([^,;.()]{1,40}?)\s+(vjet|muaj|javë|ditë)/g;
          while((m=reBM.exec(low))!==null) push('burgim', m, null, m[1], m[2]);
          var reGR=/me\s+gjobë\s+nga\s+([^,;()]{1,60}?)\s+(?:gjer|deri)\s+(?:në\s+)?([^,;()]{1,60}?)\s+lek[ëe]?/g;
          while((m=reGR.exec(low))!==null) push('gjobë', m, m[1], m[2], 'lekë');
          var reGM=/me\s+gjobë\s+(?:gjer|deri)\s+(?:në\s+)?([^,;()]{1,60}?)\s+lek[ëe]?/g;
          while((m=reGM.exec(low))!==null) push('gjobë', m, null, m[1], 'lekë');
          var mP=/burgimi?\s+(?:t[ëe]|i)\s+p[ëe]rjetsh[ëe]m/.exec(low);
          if(mP) items.push({ kind:'përjetshëm', text:t.substr(mP.index,mP[0].length), min:null, max:null, unit:'' });
          if(items.length) out.push({ file:a.file, num:a.num, items:items });
        });
        return out;
      }
      function penCompute(input, g){
        var found=extractSanctions(g&&g.refs);
        if(!found.length) return null; // s'ka masë dënimi në tekstin e gjetur → asnjë diapazon
        var base=(typeof LAW_BASE!=='undefined')?LAW_BASE:'';
        var body='<p>Diapazoni i nxjerrë automatikisht nga teksti zyrtar i neneve të gjetura (llogaritje, jo AI):</p><ul class="tool-checklist">';
        found.forEach(function(a){
          var href=base+a.file+'#neni-'+String(a.num).split('/')[0];
          a.items.forEach(function(it){
            var sum='';
            if(it.kind==='përjetshëm') sum='burgim i përjetshëm';
            else if(it.min!=null&&it.max!=null) sum=it.kind+' '+fmtN(it.min)+'–'+fmtN(it.max)+' '+it.unit;
            else if(it.max!=null) sum=it.kind+' deri në '+fmtN(it.max)+' '+it.unit;
            body+='<li><a href="'+href+'" target="_blank" rel="noopener noreferrer">Neni '+esc(a.num)+'</a>: «'+esc(it.text)+'»'+(sum?' <b>→ '+esc(sum)+'</b>':'')+'</li>';
          });
        });
        body+='</ul><p class="sol-note">Diapazoni tregon kufijtë e nenit përkatës — dënimi konkret caktohet nga gjykata sipas rrethanave, dhe kualifikimi i saktë i veprës duhet verifikuar.</p>';
        return { label:'Sanksioni sipas tekstit zyrtar (diapazoni)', body:body };
      }

      // Deterministic deadline list — a SUPPLEMENT to the AI's "Fazat & afatet" discussion,
      // never a replacement (deadline phrasing is too varied to trust a regex for full
      // coverage). Shown only when extractDeadlines() finds a confident match; omitted otherwise.
      function deadlinesCompute(input, g){
        var base=(typeof LAW_BASE!=='undefined')?LAW_BASE:'';
        var rows=[];
        (g&&g.refs||[]).forEach(function(a){
          (typeof extractDeadlines==='function'?extractDeadlines(a.text):[]).forEach(function(d){
            rows.push({ file:a.file, num:a.num, quote:d.quote, amount:d.amount, unit:d.unit });
          });
        });
        if(!rows.length) return null;
        var body='<p>Afate të gjetura automatikisht në tekstin zyrtar (llogaritje, jo AI) — diskutimi i plotë vijon më poshtë:</p><ul class="tool-checklist">';
        rows.forEach(function(d){
          var href=base+d.file+'#neni-'+String(d.num).split('/')[0];
          body+='<li><a href="'+href+'" target="_blank" rel="noopener noreferrer">Neni '+esc(d.num)+'</a>: «'+esc(d.quote)+'» <b>→ '+d.amount+' '+esc(d.unit)+'</b></li>';
        });
        body+='</ul>';
        return { label:'Afatet e gjetura në tekst', body:body };
      }

      // ── tool configs ──
      function need(text, ws){ var t=String(text||'').toLowerCase(); return !ws.some(function(w){ return t.indexOf(w)!==-1; }); }
      var CONTRACT={ title:'Analizë e Kontratës', eyebrow:'Analizë Kontrate', lawFiles:['kodi-civil.html','shoqerite-tregtare.html'], input:'',
        compute:function(text){
          var checks=[['Afati / kohëzgjatja',['afat','kohëzgjatj','periudh','vlefshmër']],['Zgjidhja/anulimi i kontratës',['zgjidh','anulim','ndërpres','prish']],['Përgjegjësia & dëmshpërblimi',['përgjegjës','dëmshpërblim','penalitet','gjob']],['Garancia',['garanci','garanton']],['Forcë madhore',['forcë madhore','force majeure']],['Gjykata kompetente / juridiksioni',['gjykat','juridiksion','arbitrazh','mosmarrëveshj']],['Konfidencialiteti',['konfidencial','fshehtës']],['Pagesa (mënyra & afatet)',['pages','paguh','faturë','këst']]];
          var body='<p>Kontroll automatik i klauzolave thelbësore — mungesat shpesh rrisin rrezikun:</p><ul class="tool-checklist">';
          checks.forEach(function(c){ var miss=need(text,c[1]); body+='<li class="'+(miss?'tc-miss':'tc-ok')+'"><span class="tc-mark">'+(miss?'⚠':'✓')+'</span> '+esc(c[0])+(miss?' — mungon ose e paqartë':'')+'</li>'; });
          return { label:'Lista e Klauzolave (kontroll automatik)', body:body+'</ul>' };
        },
        aiSections:[
          { label:'Klauzola problematike & rreziqe', maxTok:1050, temp:0.4, sys:'Jeni avokat shqiptar ekspert në kontrata, kritik dhe specifik. Mbështetu te teksti zyrtar i neneve të dhëna; mos shpik numra nenesh.', usr:function(input,gt){ return 'Analizo klauzolë për klauzolë kontratën që vijon. Identifiko klauzolat problematike, të njëanshme ose abuzive, dhe nenet konkrete të cenuara.'+gt+'\n\nKONTRATA:\n'+String(input).slice(0,7000); } },
          { label:'Mbrojtje që mungojnë & ndryshime të rekomanduara', maxTok:850, temp:0.4, sys:'Jeni avokat shqiptar. Rekomandime praktike e konkrete, me referenca te nenet e dhëna.', usr:function(input,gt){ return 'Për të njëjtën kontratë: (1) të drejtat/mbrojtjet që mungojnë për klientin; (2) ndryshime konkrete të rekomanduara në tekst.'+gt+'\n\nKONTRATA:\n'+String(input).slice(0,5000); } }
        ]
      };
      var PEN_LAW={'Shkelje penale':'kodi-penal.html','Shkelje rrugore':'kodi-rrugor.html','Shkelje doganore':'kodi-doganor.html','Shkelje kontraktuale':'kodi-civil.html','Shkelje e marrëdhënies së punës':'kodi-civil.html'};
      function penConfig(){ var typ=$('pen-type').value, sit=$('pen-sit').value.trim(); if(!sit){ $('pen-sit').focus(); return null; } var lf=PEN_LAW[typ]||'kodi-penal.html';
        return { title:'Analizë e Shkeljes & Sanksioni', eyebrow:'Analizë Sanksioni', lawFiles:[lf], input:(typ?('Lloji: '+typ+'. '):'')+sit,
          compute:penCompute, // diapazoni vetëm nga teksti zyrtar; pa gjetje → pa diapazon
          aiSections:[
            { label:'Kualifikimi i shkeljes & përbërja', maxTok:1100, temp:0.3, sys:'Jeni jurist penalist shqiptar. Mbështetu te teksti zyrtar i neneve të dhëna; mos shpik numra nenesh apo emra veprash. Nëse është vepër penale, analizo përbërjen me 4 elementet (OBJEKTI, ANA OBJEKTIVE, SUBJEKTI, ANA SUBJEKTIVE); përndryshe kualifiko shkeljen.', usr:function(input,gt){ return 'Kualifiko shkeljen që vijon dhe analizo përbërjen e saj.'+gt+'\n\nSITUATA:\n'+input; } },
            { label:'Forma e veprës & zbatimi i sanksionit', maxTok:700, temp:0.3, sys:'Jeni jurist shqiptar. Për masën e dënimit cito VETËM fjalë për fjalë nga teksti zyrtar i neneve të dhëna. Nëse asnjë nen i dhënë nuk përcakton masë dënimi, mos përmend fare shifra apo diapazon — thuaj se teksti i dhënë nuk e përcakton masën.', usr:function(input,gt){ return 'Shpjego formën bazë vs të kualifikuar të veprës dhe stadin (tentativë/e konsumuar) nëse zbatohet. Çdo masë dënimi që përmend duhet të jetë citim fjalë për fjalë nga nenet e dhëna; mos jep shifra që nuk gjenden në to.'+gt+'\n\nSITUATA:\n'+input; } },
            { label:'Rrethana lehtësuese/rënduese & mbrojtja', maxTok:700, temp:0.4, sys:'Jeni avokat mbrojtës shqiptar.', usr:function(input,gt){ return 'Listo rrethanat lehtësuese dhe rënduese, dhe linjat kryesore të mbrojtjes/kundërshtimit.'+gt+'\n\nSITUATA:\n'+input; } }
          ] }; }
      var NEGO_LAW={'Kontratë / detyrim civil':'kodi-civil.html','Qira / marrëdhënie pronësore':'kodi-civil.html','Punë / marrëdhënie pune':'kodi-civil.html','Familje / trashëgimi':'kodi-familjes.html','Biznes / ortakëri':'shoqerite-tregtare.html','Konsumator / garanci':'kodi-civil.html'};
      function negoConfig(){ var p1=$('nego-pos1').value.trim(), p2=$('nego-pos2').value.trim(), typ=$('nego-type').value; if(!p1&&!p2){ $('nego-pos1').focus(); return null; } var lf=NEGO_LAW[typ]||'kodi-civil.html';
        var input='Lloji: '+(typ||'mosmarrëveshje')+'.\nPozicioni i klientit: '+p1+'\nPozicioni i palës tjetër: '+p2;
        return { title:'Strategji Negocimi', eyebrow:'Strategji Negocimi & Ndërmjetësim', lawFiles:[lf], input:input,
          aiSections:[
            { label:'BATNA, ZOPA & pikat e levës', maxTok:900, temp:0.45, sys:'Jeni strateg negocimi dhe ndërmjetës shqiptar. Mbështetu te nenet e dhëna ku është e rëndësishme; mos shpik numra nenesh.', usr:function(input,gt){ return 'Analizo: BATNA e secilës palë, zona e marrëveshjes së mundshme (ZOPA), dhe pikat kryesore të levës për klientin.'+gt+'\n\n'+input; } },
            { label:'Plani i lëshimeve & skenarët', maxTok:800, temp:0.45, sys:'Jeni strateg negocimi shqiptar.', usr:function(input,gt){ return 'Jep një plan lëshimesh (çfarë të ofrosh dhe çfarë të mbash), plus skenarin më të mirë dhe më të keq të një marrëveshjeje.'+gt+'\n\n'+input; } },
            { label:'Draft kushtesh marrëveshjeje', maxTok:800, temp:0.4, sys:'Jeni jurist shqiptar që harton marrëveshje.', usr:function(input,gt){ return 'Harto një draft të shkurtër me 4–7 kushte kryesore për një marrëveshje/akord pajtimi mes palëve.'+gt+'\n\n'+input; } }
          ] }; }

      // ── Parashkrim (statute-of-limitations): deterministic date math + grounded explanation.
      // Rules come from the canonical JUR_LIMITS table (shared with the Opinion engine).
      var SOL_RULES=JUR_LIMITS.rules;
      function solCompute(type, dateStr, rule){
        var d=JurDate.parseISO(dateStr), today=JurDate.today();
        if(!d) return { label:'Verdikti i afatit (llogaritje)', body:'<p class="op-degraded">Data e dhënë nuk është e vlefshme.</p>' };
        if(d>today) return { label:'Verdikti i afatit (llogaritje)', body:'<p class="op-degraded">Data e ngjarjes është në të ardhmen — kontrolloni datën.</p>' };
        var elapsedText=JurDate.spanText(d,today);
        var rows='<ul class="sol-facts"><li><span>Lloji</span><b>'+esc(type)+'</b></li>'
               + '<li><span>Data e ngjarjes</span><b>'+JurDate.fmt(d)+'</b></li>'
               + '<li><span>Koha e kaluar</span><b>'+elapsedText+'</b></li>';
        var verdict;
        if(rule.none){
          verdict='<div class="sol-badge sol-info">Nuk parashkruhet</div><p>'+esc(rule.basis)+'. Afati varet nga kërkesa konkrete — verifikoni rastin specifik.</p>';
        } else if(rule.tiered){
          verdict='<div class="sol-badge sol-info">Varion sipas veprës</div><p>Parashkrimi i ndjekjes penale ndryshon sipas dënimit maksimal të veprës (neni 67 i Kodit Penal) — p.sh. ~2, 5, 10 ose 20+ vjet. Përcaktoni veprën konkrete për afatin e saktë. Koha e kaluar: '+elapsedText+'.</p>';
        } else {
          var deadline=rule.days?JurDate.addDays(d,rule.days):JurDate.addYears(d,rule.years);
          var label2=rule.days?(rule.days+' ditë'):(rule.years+' vjet');
          var remDays=JurDate.diffDays(today,deadline), span=JurDate.diffDays(d,deadline);
          rows+='<li><span>Afati ligjor</span><b>'+label2+'</b></li><li><span>Data e skadimit</span><b>'+JurDate.fmt(deadline)+'</b></li>';
          if(remDays<0){
            verdict='<div class="sol-badge sol-barred">Mund të jetë parashkruar</div><p>Afati ('+label2+') ka skaduar më '+JurDate.fmt(deadline)+' ('+Math.abs(remDays)+' ditë më parë). Verifikoni shkaqet e ndërprerjes/pezullimit që mund ta zgjasin.</p>';
          } else if(remDays===0){
            verdict='<div class="sol-badge sol-near">Afati skadon SOT</div><p>Dita e fundit e afatit ('+label2+') është sot, '+JurDate.fmt(deadline)+'. Veproni menjëherë.</p>';
          } else {
            var near=remDays<span*0.2;
            verdict='<div class="sol-badge '+(near?'sol-near':'sol-ok')+'">'+(near?'Afati po afrohet':'Brenda afatit')+'</div><p>Kanë mbetur '+remDays+' ditë (skadon më '+JurDate.fmt(deadline)+').'+(near?' Veproni shpejt.':'')+'</p>';
          }
        }
        return { label:'Verdikti i afatit (llogaritje)', body:verdict+rows+'</ul><p class="sol-note">Llogaritje orientuese mbi datën dhe llojin e dhënë — afati i saktë dhe ndërprerjet/pezullimet duhen verifikuar me tekstin e ligjit.</p>' };
      }
      function solConfig(){
        var type=$('sol-type').value, dateStr=$('sol-date').value;
        if(!type){ $('sol-type').focus(); return null; }
        if(!dateStr){ $('sol-date').focus(); return null; }
        var rule=SOL_RULES[type]||{ years:10, law:'kodi-civil.html', basis:'afat i përgjithshëm' };
        var input='Lloji i kërkesës: '+type+'. Data e ngjarjes/shkeljes: '+dateStr+'. '+rule.basis+'.';
        return { title:'Kalkulator i Parashkrimit', eyebrow:'Afati i Parashkrimit', lawFiles:[rule.law], input:input,
          compute:function(){ return solCompute(type, dateStr, rule); },
          aiSections:[
            { label:'Baza ligjore e afatit', maxTok:700, temp:0.3, sys:'Jeni jurist shqiptar ekspert në afatet ligjore dhe parashkrimin. Mbështetu te teksti zyrtar i neneve të dhëna; mos shpik numra nenesh.', usr:function(inp,gt){ return 'Shpjego bazën ligjore të afatit të parashkrimit për këtë rast dhe nenin/nenet konkrete që e përcaktojnë.'+gt+'\n\n'+inp; } },
            { label:'Ndërprerja/pezullimi & si të veproni', maxTok:700, temp:0.35, sys:'Jeni avokat shqiptar.', usr:function(inp,gt){ return 'Shpjego si mund të ndërpritet ose pezullohet afati i parashkrimit (p.sh. ngritja e padisë, njohja e borxhit) dhe çfarë hapash duhen ndërmarrë urgjentisht.'+gt+'\n\n'+inp; } }
          ] };
      }

      // ── Case Study: generate a teaching case grounded on the selected law ──
      var CS_LAW={'Kushtetuta e Republikës së Shqipërisë':'kushtetuta.html','Kodi Civil':'kodi-civil.html','Kodi Penal':'kodi-penal.html','Kodi i Procedurës Civile':'kodi-procedure-civile.html','Kodi i Procedurës Penale':'kodi-procedure-penale.html','Kodi i Familjes':'kodi-familjes.html','Kodi Rrugor':'kodi-rrugor.html','Kodi Ajror':'kodi-ajror.html','Kodi Doganor':'kodi-doganor.html','Kodi i Drejtësisë Penale për të Mitur':'drejtesia-penale-mitur.html','Dispozita Zbatuese të Kodit Doganor':'dispozita-zbatuese-kodi-doganor.html','Ligj për Tregtarët dhe Shoqëritë Tregtare':'shoqerite-tregtare.html','Ligj për Falimentimin':'falimentimi.html','Statusi i Gjyqtarëve dhe Prokurorëve':'statusi-gjyqtareve-prokuroreve.html','Organizimi i Pushtetit Gjyqësor':'organizimi-pushtetit-gjyqesor.html','Organizimi i Pushtetit Gjyqësor (i përditësuar)':'organizimi-pushtetit-gjyqesor-v2.html','Ligj për Noterinë':'noteria.html','Shërbimi Përmbarimor Gjyqësor Privat':'sherbimi-permbarimor.html'};
      function csConfig(){ var law=$('cs-law').value; if(!law){ $('cs-law').focus(); return null; } var lf=CS_LAW[law]||'kodi-civil.html';
        return { title:'Rast Ligjor Mësimor', eyebrow:'Rast Studimor — '+law, lawFiles:[lf], input:'Ligji: '+law,
          aiSections:[
            { label:'Rasti mësimor (skenar, pyetje, analizë)', maxTok:1300, temp:0.55, sys:'Jeni pedagog i së drejtës shqiptare. Krijoni një rast hipotetik realist të bazuar te teksti zyrtar i neneve të dhëna, me: (1) skenarin/faktet, (2) pyetjet juridike, (3) analizën e zgjidhjes me referenca te nenet. Mos shpik numra nenesh jashtë tyre.', usr:function(inp,gt){ return 'Krijo një rast të plotë mësimor që ilustron zbatimin e '+law+'.'+gt; } },
            { label:'Nenet kyçe & parimet', maxTok:700, temp:0.4, sys:'Jeni pedagog i së drejtës shqiptare. Mbështetu te nenet e dhëna.', usr:function(inp,gt){ return 'Shpjego shkurt nenet dhe parimet kyçe të '+law+' që lidhen me rastin.'+gt; } }
          ] }; }

      // ── Document drafter ──
      var DD_LAW={'Kontratë qiraje banesë':'kodi-civil.html','Kontratë shitjeje':'kodi-civil.html','Kontratë pune':'kodi-civil.html','Prokurë e posaçme':'kodi-civil.html','Ankesë administrative':'kodi-procedure-civile.html','Njoftim ligjor':'kodi-civil.html','Marrëveshje ndërmjetësimi':'kodi-civil.html','Testament':'kodi-civil.html'};
      function ddConfig(){ var typ=$('dd-type').value, det=$('dd-details').value.trim(); if(!typ){ $('dd-type').focus(); return null; } var lf=DD_LAW[typ]||'kodi-civil.html';
        return { title:'Dokument i Hartuar', eyebrow:'Hartim: '+typ, lawFiles:[lf], input:'Lloji i dokumentit: '+typ+(det?('. Detaje: '+det):'.'),
          aiSections:[
            { label:typ, maxTok:1300, temp:0.5, sys:'Jeni jurist shqiptar që harton dokumente ligjore të sakta e të plota sipas praktikës shqiptare, me klauzolat thelbësore. Mos shpik numra nenesh jashtë atyre të dhëna.', usr:function(inp,gt){ return 'Harto një '+typ+' të plotë e profesional në shqip, gati për përdorim (me vendet për plotësim si [...]).'+gt+'\n\n'+inp; } },
            { label:'Baza ligjore & klauzola kritike', maxTok:600, temp:0.4, sys:'Jeni jurist shqiptar.', usr:function(inp,gt){ return 'Listo bazën ligjore dhe klauzolat kritike që s\'duhen harruar për këtë '+typ+'.'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Email/letter drafter ──
      var ED_LAW={'Ankesë ndaj punëdhënësit':'kodi-civil.html','Kërkesë ndaj qiradhënësit':'kodi-civil.html','Njoftim kontraktual':'kodi-civil.html','Kundërshtim ndaj vendimit':'kodi-procedure-civile.html','Kërkesë kompensimi':'kodi-civil.html','Kërkesë informacioni (LIGJI)':'kodi-procedure-civile.html','Letër paralajmëruese ligjore':'kodi-civil.html'};
      function edConfig(){ var typ=$('ed-type').value, det=$('ed-details').value.trim(); if(!typ){ $('ed-type').focus(); return null; } var lf=ED_LAW[typ]||'kodi-civil.html';
        return { title:'Letër / Email i Hartuar', eyebrow:'Hartim: '+typ, lawFiles:[lf], input:'Lloji: '+typ+(det?('. Situata: '+det):'.'),
          aiSections:[
            { label:typ, maxTok:900, temp:0.5, sys:'Jeni jurist shqiptar që harton letra/email-e ligjore bindëse e korrekte në ton profesional. Mos shpik numra nenesh jashtë atyre të dhëna.', usr:function(inp,gt){ return 'Harto një '+typ+' të gatshëm për dërgim në shqip, të qartë e profesional.'+gt+'\n\n'+inp; } },
            { label:'Baza ligjore', maxTok:500, temp:0.4, sys:'Jeni jurist shqiptar.', usr:function(inp,gt){ return 'Shpjego shkurt bazën ligjore që e mbështet këtë kërkesë/letër.'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Rights finder (free-text situation) ──
      function rightsConfig(){ var sit=$('rights-sit').value.trim(); if(!sit){ $('rights-sit').focus(); return null; }
        return { title:'Të Drejtat Tuaja', eyebrow:'Analizë e të Drejtave', lawFiles:['kodi-civil.html','kodi-penal.html'], input:'Situata: '+sit,
          aiSections:[
            { label:'Të drejtat që keni', maxTok:900, temp:0.4, sys:'Jeni avokat shqiptar. Identifiko të drejtat konkrete të personit sipas tekstit zyrtar të neneve të dhëna; mos shpik numra nenesh.', usr:function(inp,gt){ return 'Për situatën, listo të drejtat konkrete që keni dhe bazën ligjore.'+gt+'\n\n'+inp; } },
            { label:'Si t\'i ushtroni (hapat)', maxTok:700, temp:0.4, sys:'Jeni avokat shqiptar praktik.', usr:function(inp,gt){ return 'Jep hapat konkretë për t\'i ushtruar këto të drejta (kërkesa, afate, ku drejtohemi).'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Court / competent-authority finder (free-text situation) ──
      function courtConfig(){ var sit=$('court-sit').value.trim(); if(!sit){ $('court-sit').focus(); return null; }
        return { title:'Autoriteti Kompetent', eyebrow:'Ku të Drejtoheni', lawFiles:['kodi-procedure-civile.html','kodi-procedure-penale.html','organizimi-pushtetit-gjyqesor.html'], input:'Problemi: '+sit,
          aiSections:[
            { label:'Autoriteti / gjykata kompetente', maxTok:800, temp:0.35, sys:'Jeni jurist shqiptar ekspert në kompetencën dhe juridiksionin. Mbështetu te nenet e dhëna; mos shpik numra.', usr:function(inp,gt){ return 'Përcakto autoritetin ose gjykatën kompetente për këtë problem dhe pse.'+gt+'\n\n'+inp; } },
            { label:'Procedura & hapat', maxTok:700, temp:0.4, sys:'Jeni jurist shqiptar praktik.', usr:function(inp,gt){ return 'Jep hapat procedurialë për t\'iu drejtuar këtij autoriteti (ku, si, çfarë dokumentesh).'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Evidence checklist ──
      var EV_LAW={'Çështje civile (kontratë / detyrim)':'kodi-procedure-civile.html','Çështje penale':'kodi-procedure-penale.html','Çështje administrative':'kodi-procedure-civile.html','Çështje familjare (divorc / kujdestari)':'kodi-familjes.html','Çështje pune (pushim / diskriminim)':'kodi-procedure-civile.html','Çështje pronësore':'kodi-civil.html','Dëm trupor / aksidenti':'kodi-civil.html'};
      function evidenceConfig(){ var typ=$('evidence-type').value, sit=$('evidence-sit').value.trim(); if(!typ){ $('evidence-type').focus(); return null; } var lf=EV_LAW[typ]||'kodi-procedure-civile.html';
        return { title:'Lista e Provave', eyebrow:'Provat — '+typ, lawFiles:[lf], input:'Lloji: '+typ+(sit?('. Situata: '+sit):'.'),
          aiSections:[
            { label:'Provat që duhen mbledhur', maxTok:900, temp:0.4, sys:'Jeni jurist shqiptar ekspert në të drejtën procedurale dhe provat. Mbështetu te nenet e dhëna.', usr:function(inp,gt){ return 'Listo provat konkrete që duhen mbledhur për këtë çështje dhe rëndësinë e secilës.'+gt+'\n\n'+inp; } },
            { label:'Si t\'i siguroni & administroni', maxTok:700, temp:0.4, sys:'Jeni jurist shqiptar praktik.', usr:function(inp,gt){ return 'Shpjego si të sigurohen e administrohen ligjërisht këto prova (afate, forma, rreziku i papranueshmërisë).'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Procedural timeline ──
      var TL_LAW={'Padi civile (gjykatë e shkallës I)':'kodi-procedure-civile.html','Apel civil':'kodi-procedure-civile.html','Procedim penal':'kodi-procedure-penale.html','Ankesë administrative':'kodi-procedure-civile.html','Divorc me marrëveshje':'kodi-familjes.html','Divorc i kontestuar':'kodi-familjes.html','Regjistrim biznesi (NIPT)':'shoqerite-tregtare.html','Ekzekutim vendimi gjyqësor':'sherbimi-permbarimor.html','Çregjistrimi i pronës':'kodi-civil.html'};
      function timelineConfig(){ var typ=$('timeline-type').value, det=$('timeline-details').value.trim(); if(!typ){ $('timeline-type').focus(); return null; } var lf=TL_LAW[typ]||'kodi-procedure-civile.html';
        return { title:'Vija Kohore Procedurale', eyebrow:'Procedura — '+typ, lawFiles:[lf], input:'Procedura: '+typ+(det?('. Detaje: '+det):'.'),
          compute:deadlinesCompute,
          aiSections:[
            { label:'Fazat & afatet', maxTok:1000, temp:0.35, sys:'Jeni jurist shqiptar ekspert në procedurë. Jep një vijë kohore me faza dhe afate. Mbështetu te nenet e dhëna; mos shpik numra.', usr:function(inp,gt){ return 'Jep vijën kohore hap-pas-hapi (faza + afate + veprime) për këtë procedurë.'+gt+'\n\n'+inp; } },
            { label:'Këshilla & rreziqe', maxTok:600, temp:0.4, sys:'Jeni jurist shqiptar praktik.', usr:function(inp,gt){ return 'Jep këshilla praktike dhe afatet/rreziqet kritike që s\'duhen humbur.'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Consumer rights ──
      function consumerConfig(){ var typ=$('consumer-type').value, sit=$('consumer-sit').value.trim(); if(!typ){ $('consumer-type').focus(); return null; }
        return { title:'Të Drejtat e Konsumatorit', eyebrow:'Konsumatori — '+typ, lawFiles:['kodi-civil.html'], input:'Problemi: '+typ+(sit?('. Situata: '+sit):'.'),
          aiSections:[
            { label:'Të drejtat tuaja si konsumator', maxTok:800, temp:0.4, sys:'Jeni jurist shqiptar ekspert në mbrojtjen e konsumatorit. Mbështetu te nenet e dhëna; mos shpik numra.', usr:function(inp,gt){ return 'Listo të drejtat konkrete të konsumatorit për këtë problem dhe bazën ligjore.'+gt+'\n\n'+inp; } },
            { label:'Si të ankoheni (hapat)', maxTok:600, temp:0.4, sys:'Jeni jurist shqiptar praktik.', usr:function(inp,gt){ return 'Jep hapat për ankim dhe zgjidhje (te shitësi, institucionet, afatet).'+gt+'\n\n'+inp; } }
          ] }; }

      // ── Business compliance ──
      function bizConfig(){ var typ=$('biz-type').value, act=$('biz-activity').value.trim(); if(!typ){ $('biz-type').focus(); return null; }
        return { title:'Përputhshmëria e Biznesit', eyebrow:'Biznes — '+typ, lawFiles:['shoqerite-tregtare.html'], input:'Forma: '+typ+(act?('. Aktiviteti: '+act):'.'),
          aiSections:[
            { label:'Detyrimet ligjore & regjistrimi', maxTok:900, temp:0.4, sys:'Jeni jurist shqiptar ekspert në të drejtën tregtare. Mbështetu te nenet e dhëna; mos shpik numra.', usr:function(inp,gt){ return 'Listo detyrimet ligjore, regjistrimin dhe kërkesat kryesore për këtë formë biznesi dhe aktivitet.'+gt+'\n\n'+inp; } },
            { label:'Rreziqet & përputhshmëria', maxTok:600, temp:0.4, sys:'Jeni këshilltar ligjor biznesi shqiptar.', usr:function(inp,gt){ return 'Jep rreziqet kryesore të përputhshmërisë dhe si t\'i shmangni.'+gt+'\n\n'+inp; } }
          ] }; }

      // rewire the upgraded tool buttons (clone to drop the old single-call handlers)
      function rewire(id, build){ var b=$(id); if(!b) return; var nb=b.cloneNode(true); b.parentNode.replaceChild(nb,b);
        nb.addEventListener('click', function(){ var cfg=build(); if(cfg) runToolReport(cfg); }); }
      // Future dates make no sense for a limitation check — block them in the picker too.
      if($('sol-date')) $('sol-date').max=JurDate.todayISO();
      if($('opinion-event-date')) $('opinion-event-date').max=JurDate.todayISO();

      rewire('ca-btn', function(){ var t=$('ca-text').value.trim(); if(!t){ $('ca-text').focus(); return null; } return Object.assign({},CONTRACT,{input:t}); });
      rewire('pen-btn', penConfig);
      rewire('nego-btn', negoConfig);
      rewire('sol-btn', solConfig);
      rewire('cs-btn', csConfig);
      rewire('dd-btn', ddConfig);
      rewire('ed-btn', edConfig);
      rewire('rights-btn', rightsConfig);
      rewire('court-btn', courtConfig);
      rewire('evidence-btn', evidenceConfig);
      rewire('timeline-btn', timelineConfig);
      rewire('consumer-btn', consumerConfig);
      rewire('biz-btn', bizConfig);

      $('tool-close').addEventListener('click', closeModal);
      if($('tool-cancel-btn')) $('tool-cancel-btn').addEventListener('click', closeModal);
      $('tool-restart-btn').addEventListener('click', closeModal);
      $('tool-report-modal').addEventListener('click', function(e){ if(e.target===this) closeModal(); });
      document.addEventListener('keydown', function(e){ if(e.key==='Escape'&&!$('tool-report-modal').hidden) closeModal(); });
      $('tool-print-btn').addEventListener('click', function(){ window.print(); });
    })();
  
