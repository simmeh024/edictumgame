// "Your next land credit arrives at …": nextCreditPop reckons from earnedAt, which must count every credit landEarned
// counts. Province credits were once left out, and a nation of 34.5 million with 25 provinces was told 286 million
// instead of 35 million (the Great Power milestone). Run with: node --test test/next-credit.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=s=>{const i=source.indexOf(s);assert(i>=0,s);return source.slice(i,source.indexOf('\n',i));};
const block=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i,a);return source.slice(i,j+b.length);};

test('earnedAt counts the same credits as landEarned, base and every add-on',()=>{
  const terms=s=>[...s.matchAll(/\b([a-zA-Z]+Credits)\(n\)|\(n\.(lcb|mvl)\|\|0\)/g)].map(m=>m[1]||m[2]).sort();
  assert.deepEqual(terms(line('function earnedAt(n,p){')),terms(line('function landEarned(n){')),'the same credit sources in the base');
  const wraps=k=>[...source.matchAll(new RegExp('^'+k+'=\\(f=>function\\(n\\)\\{return f\\.apply\\(this,arguments\\)\\+(.*?);\\}\\)\\('+k+'\\);$','gm'))].map(m=>m[1]);
  const a=wraps('landEarned'),b=wraps('earnedAt');
  assert(a.length>=10,'the add-ons are found: '+a.length);
  assert.deepEqual(b,a,'every add-on to landEarned is added to earnedAt too');
});

function game(used){
  const ctx=vm.createContext({});
  vm.runInContext(`
    ${line('const budgetOf=p=>')}
    ${block('const MILESTONES=[','\n];')}
    ${line('function milesReached(pop){')}
    ${line('const CORE_HEXES=')}
    ${line('const MILE_NEW=')}
    ${line('function mileCredit(n,i){')}
    ${line('const PRV_CREDITS=')}
    ${line('function prvPeak(n){')}
    ${line('function prvCredits(n){')}
    ${line('function earnedAt(n,p){')}
    ${block('function nextCreditPop(n){','\n}')}
    function achRankCredits(){return 0;}function achTierCredits(){return 0;}
    function territory(){return {byId:{me:0}};}function myId(){return 'me';}function claimsUsed(){return USED;}function popNow(n){return n.pop;}
    let USED=0;this.G={nextCreditPop,earnedAt,setUsed:k=>{USED=k;}};`,ctx);
  return ctx.G;
}

test('a nation of 34.5 million with 25 provinces and every credit spent: the next ones come at 35 million',()=>{
  const G=game(),n={pop:34.5,mlk:9,prpk:25,prov:{on:true,l:new Array(25).fill({})},lcb:0};
  const now=G.earnedAt(n,34.5);G.setUsed(now);
  assert.equal(G.earnedAt(n,34.5)-G.earnedAt({...n,prpk:0,prov:null},34.5),72,'25 provinces are worth 72 credits');
  assert(Math.abs(G.nextCreditPop(n)-35)<1e-6,'the Great Power milestone, not 286 million: '+G.nextCreditPop(n));
  G.setUsed(now+2);assert(Math.abs(G.nextCreditPop(n)-36)<0.01,'then 36 million: '+G.nextCreditPop(n));
  G.setUsed(now-1);assert.equal(G.nextCreditPop(n),34.5,'a credit in hand is due now');
});
