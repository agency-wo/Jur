const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'..','mjete-ai.js'),'utf8');
const cut=(f,t)=>{const a=src.indexOf(f),b=src.indexOf(t);if(a<0||b<0||b<=a)throw new Error('slice '+f);return src.slice(a,b);};
(0,eval)(cut('// ── KP_OBJEKTI ─','// ── end KP_OBJEKTI ─').replace(/^\s{4}/gm,''));
(0,eval)(cut('function normAssess(v){','function doctrineSummaryText(d){').replace(/^\s{6}/gm,''));
(0,eval)(cut('function doctrineSummaryText(d){','var FORMAL_HEADS =').replace(/^\s{6}/gm,''));
globalThis.SCORE_LABEL=function(){return 'l';};
(0,eval)(cut('function computeStrengthScore(','function renderScoreBreakdown(').replace(/^\s{6}/gm,''));
let p=0,f=0;const ok=(n,c,d)=>{c?(p++):(f++,console.log('FAIL '+n+(d!==undefined?' — '+d:'')));};
// table
[['76','jeta e njeriut'],['85','jeta e njeriut'],['88','shëndeti dhe integriteti trupor'],
 ['100','liria dhe integriteti seksual'],['109','liria e personit'],['134','pronësia dhe posedimi mbi pasurinë'],
 ['143','pasuria dhe besueshmëria në qarkullimin pasuror'],['150','pronësia dhe paprekshmëria e saj'],
 ['186','besueshmëria e dokumenteve dhe siguria e qarkullimit juridik'],['201','mjedisi'],
 ['248','veprimtaria e rregullt e administratës publike'],['300','drejtësia dhe veprimtaria normale e gjykimit']]
 .forEach(([n,v])=>ok('neni '+n,kpObjekti(n)&&kpObjekti(n).drejtperdrejte===v,kpObjekti(n)&&kpObjekti(n).drejtperdrejte));
[1,12,47,72,334,335].forEach(n=>ok('neni '+n+' null',kpObjekti(n)===null));
ok('170/b<170/c<170/ç',kpKey('170/b')<kpKey('170/c')&&kpKey('170/c')<kpKey('170/ç'));
ok('kreu ascending',KP_OBJEKTI.kreu.every((x,i)=>i===0||x.from>KP_OBJEKTI.kreu[i-1].from));
ok('seksioni ascending',KP_OBJEKTI.seksioni.every((x,i)=>i===0||x.from>KP_OBJEKTI.seksioni[i-1].from));
// case selection
const href=nm=>/^Kodi Penal$/.test(nm)?'kodi-penal.html':'x.html';
ok('case majority',kpObjektiForCase([{name:'Kodi Penal',articles:['134','141','88']}],href).o.drejtperdrejte==='pronësia dhe posedimi mbi pasurinë');
ok('case KPP dropped',kpObjektiForCase([{name:'Kodi i Procedurës Penale',articles:['76']}],href)===null);
ok('case general-part null',kpObjektiForCase([{name:'Kodi Penal',articles:['12']}],href)===null);
// enforcement + scoring
const kc=kpObjektiForCase([{name:'Kodi Penal',articles:['134']}],href);
const legacy=()=>({kuadri:[{id:'objekti',titull:'Objekti',vleresim:'mungon',shenim:'',permbajtja:[
  {etikete:'I përgjithshëm',vlera:'...'},{etikete:'Specifik / i drejtpërdrejtë',vlera:'sendi i vjedhur'},
  {etikete:'Objekti material / subjekti pasiv',vlera:'telefoni'}]},
  {id:'ana_objektive',titull:'Ana objektive',vleresim:'plotesuar',permbajtja:[]}]});
const d=enforceObjekti(legacy(),kc), o=d.kuadri[0];
ok('table owns row1',/pasuria dhe marrëdhëniet/.test(o.permbajtja[0].vlera));
ok('table owns row2',/pronësia dhe posedimi/.test(o.permbajtja[1].vlera));
ok('wrong value dropped',!o.permbajtja.some(x=>/sendi i vjedhur/.test(x.vlera)));
ok('material split out',o.permbajtja.some(x=>x.etikete==='Objekti material'));
ok('placeholder dropped',!o.permbajtja.some(x=>/^\.\.\.$/.test(x.vlera)));
ok('_locked',o._locked===true);
const S={factors:{baza:{score:1.5},prova:{score:1.5},kundershtimi:{score:1},faktet:{score:1.5}},missing_evidence:[]};
ok('locked no 4.0 cap',computeStrengthScore(S,d,{found:[{},{},{}]},null).score>4);
ok('pinned not counted',computeStrengthScore(S,null,{found:Array(15).fill({pinned:true})},null).adjustments.some(a=>/Asnjë nen/.test(a)));
ok('normAssess munget',normAssess('munget')==='mungon');
ok('normAssess garbage',normAssess('po')==='');
ok('memo has OBJEKTI line',/OBJEKTI \(i detyrueshëm/.test(doctrineSummaryText(d)));
ok('memo no ...',!/\.\.\./.test(doctrineSummaryText(d)));
console.log((f===0?'ALL PASS':'FAILURES')+': '+p+' passed, '+f+' failed');
process.exit(f?1:0);
