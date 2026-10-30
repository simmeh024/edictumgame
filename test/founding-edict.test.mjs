// The founding edict: its wording follows the type of state, every placeholder resolves, and its answers act.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const literal=name=>{const m=source.match(new RegExp('const '+name+'\\s*=\\s*([^;]+);'));assert.ok(m,name);return m[1];};
function edict(){
  const start=source.indexOf("const FD_ID='fd-settle'"),end=source.indexOf('/* three free sites near one another',start);
  assert.ok(start>0&&end>start);
  const ctx=vm.createContext({ISSUES:[],ISSUE_BY_ID:{},S:{fdSites:{cells:[10,20,30]}},landName:c=>'Isle '+c});
  vm.runInContext(`const MONARCH_PRE=${literal('MONARCH_PRE')};const MONARCH_LEADER=${literal('MONARCH_LEADER')};const PRETITLES=${literal('PRETITLES')};const STAT_KEYS=${literal('STAT_KEYS')};
    function fill(t,n){return t.replace(/\\{(N|CAP|L|D)\\}/g,(m,k)=>({N:n.name,CAP:n.capital,L:n.leader,D:n.demonym})[k]);}
    ${source.slice(start,end)}
    this.T={is:ISSUE_BY_ID[FD_ID],fill:(t,n)=>fill(t,n),fam:fdFam,PRETITLES,STAT_KEYS,TEXT:FD_TEXT};`,ctx);
  return ctx.T;
}
const nation=(pretitle,leader='Leader')=>({name:'Testoria',capital:'Port Test',leader,demonym:'Testorian',pretitle});
const read=(E,n)=>({t:E.fill(E.is.t,n),q:E.fill(E.is.q,n),o:E.is.o.map(o=>E.fill(o.t,n)),fx:E.is.o.map(o=>E.fill(o.fx,n))});

test('each type of state hears the matter in its own voice',()=>{
  const E=edict(),want={Republic:'rep',Kingdom:'crn',Queendom:'crn','Grand Duchy':'crn',Empire:'imp','Holy Empire':'imp',Sultanate:'sul',Theocracy:'the','People’s Republic':'peo',Colony:'col',Dominion:'col',Borough:'bor',Federation:'rep'};
  for(const [pt,fam] of Object.entries(want))assert.equal(E.fam(nation(pt)),fam,pt);
  assert.equal(E.fam(nation('Most Glorious Hamlet','Queen')),'crn','a crowned leader makes any state a crown');
  const fams=new Set(E.PRETITLES.map(pt=>E.fam(nation(pt))));assert.equal(fams.size,8,'every family is used by some type of state');
  const titles=new Set([...fams].map(f=>E.TEXT[f].t)),opening=new Set([...fams].map(f=>E.TEXT[f].o[0]));
  assert.equal(titles.size,8);assert.equal(opening.size,8);
  assert.notEqual(read(E,nation('Kingdom')).t,read(E,nation('Republic')).t);
});

test('every placeholder resolves, with the nation and the three places named',()=>{
  const E=edict();
  for(const pt of E.PRETITLES){const r=read(E,nation(pt)),all=[r.t,r.q,...r.o,...r.fx].join(' ');
    assert.ok(!/[{}]/.test(all),pt+': '+all.match(/\{[^}]*\}/));
    assert.ok(r.o[0].includes('Isle 10')&&r.o[1].includes('Isle 20')&&r.o[2].includes('Isle 30'),pt);
    assert.ok(r.o.every((o,i)=>o.includes(['I','II','III'][i])),pt+': each speech names its pin');
    assert.ok(r.fx.every(f=>f.includes('Port Test')),pt);}
});

test('its three answers act on the nation, each differently, and it never arrives at random',()=>{
  const E=edict(),o=E.is.o;
  assert.equal(o.length,3);assert.equal(E.is.fo,1);
  for(const x of o){const ks=Object.keys(x.e);assert.ok(ks.length>=2&&ks.every(k=>E.STAT_KEYS.includes(k)&&x.e[k]>0),JSON.stringify(x.e));}
  assert.equal(new Set(o.map(x=>JSON.stringify(x.e))).size,3);
});
