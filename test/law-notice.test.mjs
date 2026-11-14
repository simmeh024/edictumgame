// Laws an answer would end, said before and after (14 November 2026): a player chose the People's Bank and lost the
// Independent Central Bank with no word beforehand. The desk now names a held law an answer would end, the result page
// and the forecast say why, and the two bank laws may stand together. Run with: node --test test/law-notice.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const START='/* ───────── laws an answer would end, said before and after';
const sec=(()=>{const a=source.indexOf(START);assert(a>0,'the section exists');return source.slice(a,source.indexOf('\n/* ───────── ',a+START.length));})();
function gameFn(name){
  const a=source.indexOf('function '+name+'(');assert(a>=0,'the game has function '+name);
  let i=source.indexOf('{',a),depth=0;for(;i<source.length;i++){const c=source[i];if(c==='{')depth++;else if(c==='}'&&--depth===0)break;}
  return source.slice(a,i+1);
}
const line=start=>{const a=source.indexOf(start);assert(a>=0,start);return source.slice(a,source.indexOf('\n',a));};
const block=(start,end)=>{const a=source.indexOf(start);assert(a>=0,start);return source.slice(a,source.indexOf(end,a)+end.length);};
function sandbox(){
  const S={result:null,html:''};
  const code=[block('const POLICIES = {','\n};'),line('const POLICY_CONFLICTS='),gameFn('conflictsOf'),line('const MONARCH_PRE='),gameFn('list'),
    "let gmbOdds=function(o){return o.g?'<p class=\"opt-odds\">odds</p>':'';},resultView=function(){return S.html;};",sec,
    'this.X={lawsEnded,lawEndedBy,lawEndsNote,gmbOdds,resultView,POLICY_CONFLICTS};'].join('\n');
  const ctx=vm.createContext({S,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')});vm.runInContext(code,ctx);return {X:ctx.X,S};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('the People’s Bank and an independent central bank may stand together; the other pairs still cannot',()=>{
  const {X}=sandbox(),pairs=plain(X.POLICY_CONFLICTS).map(p=>p.join('+'));
  assert(!pairs.includes('centralBankIndependence+peoplesBank')&&!pairs.includes('peoplesBank+centralBankIndependence'));
  assert.equal(pairs.length,26);for(const p of ['surveillance+dataPrivacy','oilDrilling+fossilPhaseOut','censorship+whistleblowerProtection','openBorders+borderWall'])assert(pairs.includes(p),p);
  assert.deepEqual(plain(X.lawsEnded({policies:{centralBankIndependence:true}},{p:{peoplesBank:1}})),[],'the People’s Bank ends nothing now');
  assert(/\+ \(I\.cbi \? 12 : 0\) - \(I\.pbank \? 8 : 0\)/.test(readFileSync(new URL('../jobs/fx/engine.mjs',import.meta.url),'utf8')),'the currency job scores both at once');
  assert(source.includes("+(p.centralBankIndependence?12:0)-(p.peoplesBank?8:0)"),'and so does the game');
});

test('the laws held now that an answer would end, and why',()=>{
  const {X}=sandbox();
  assert.deepEqual(plain(X.lawsEnded({policies:{surveillance:true}},{p:{dataPrivacy:1}})),[{k:'surveillance',by:'dataPrivacy'}],'a rival law');
  assert.deepEqual(plain(X.lawsEnded({policies:{dataPrivacy:true,surveillance:true}},{p:{dataPrivacy:1}})),[],'a law already held ends nothing new');
  assert.deepEqual(plain(X.lawsEnded({policies:{gunControl:true}},{p:{gunControl:0}})),[{k:'gunControl',by:''}],'a repeal');
  assert.deepEqual(plain(X.lawsEnded({policies:{}},{p:{gunControl:0}})),[],'repealing a law not held ends nothing');
  assert.deepEqual(plain(X.lawsEnded({policies:{openBorders:true,freeMovement:true}},{p:{sealedBorders:1}})),[{k:'openBorders',by:'sealedBorders'},{k:'freeMovement',by:'sealedBorders'}],'two at once');
  assert.deepEqual(plain(X.lawsEnded({policies:{termLimits:true}},{pre:'Kingdom'})),[{k:'termLimits',by:'monarchy'}],'a crown ends term limits');
  assert.deepEqual(plain(X.lawsEnded({policies:{termLimits:true,monarchy:true}},{pre:'Kingdom'})),[],'not when there is a crown already');
  assert.deepEqual(plain(X.lawsEnded({policies:{surveillance:true}},{wealth:2})),[],'an answer without laws');
  assert.equal(X.lawEndedBy('surveillance',['dataPrivacy','gunControl']),'dataPrivacy');assert.equal(X.lawEndedBy('gunControl',['dataPrivacy']),'');
});

test('the desk says so under the speech, beside a gamble’s odds',()=>{
  const {X}=sandbox(),n={policies:{surveillance:true,openBorders:true,freeMovement:true}};
  assert.equal(X.gmbOdds({t:'x',e:{p:{dataPrivacy:1}}},n,{}),'<p class="opt-ends"><b>Ends a law you have:</b> Mass Surveillance, which cannot stand beside Data Protection.</p>');
  assert.equal(X.gmbOdds({t:'x',e:{p:{sealedBorders:1}},g:{p:50}},n,{}),'<p class="opt-odds">odds</p><p class="opt-ends"><b>Ends laws you have:</b> Open Borders and Free Movement, which cannot stand beside Sealed Borders.</p>');
  assert.equal(X.gmbOdds({t:'x',e:{p:{dataPrivacy:1,gunControl:0}}},{policies:{surveillance:true,gunControl:true}},{}),'<p class="opt-ends"><b>Ends laws you have:</b> Mass Surveillance, which cannot stand beside Data Protection; Gun Control.</p>','a repeal beside a rival');
  assert.equal(X.gmbOdds({t:'x',e:{wealth:2}},n,{}),'','nothing to say');
  assert(/\$\{gmbOdds\(o,n,x\)\}/.test(source.slice(source.indexOf('function issueView('),source.indexOf('function issueView(')+3000)),'the desk draws gmbOdds under every speech');
  assert(/\.opt-ends\{/.test(source.slice(0,source.indexOf('</style>'))),'styled');
});

test('the result page and the forecast say why a law went',()=>{
  const {X,S}=sandbox();
  S.result={repealed:['surveillance','gunControl'],enacted:['dataPrivacy']};
  S.html='<div class="polchg"><span><b>Enacted</b> · Data Protection</span><span><b>Repealed</b> · Mass Surveillance</span><span><b>Repealed</b> · Gun Control</span></div>';
  assert.equal(X.resultView(),'<div class="polchg"><span><b>Enacted</b> · Data Protection</span><span><b>Repealed</b> · Mass Surveillance, which cannot stand beside Data Protection</span><span><b>Repealed</b> · Gun Control</span></div>');
  assert(source.includes('for(const p of R.repealed||[]){const by=lawEndedBy(p,R.enacted);if(by&&POLICIES[p])L.push(`${POLICIES[p][0]} ends, because it cannot stand beside ${POLICIES[by][0]}.`);}'),'the adviser’s forecast says it too');
  const a=source.indexOf(START),b=source.indexOf('/* ───────── portraits of state: the faces of the government');assert(a>0&&a<b,'before the portraits section');
});
