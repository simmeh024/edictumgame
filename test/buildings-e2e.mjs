// The seven later buildings and their edicts in the real game: the catalogue, completion, the city
// effects, the edict boosts, the Central Bank's currency defence, saving and the drawings on the map.
import {OUT,PROJECT,check,finish,until,player,open,found,nav,text,localNation,nationDoc,clearEmulators} from './lib.mjs';
if(!PROJECT.startsWith('demo-'))throw Error('Building tests require demo emulators');
await clearEmulators();
const KEYS=['cbank','court','baths','recycle','reserve','observ','gardens'];
const A=await player('buildings desktop'),uid=await open(A);await found(A,'Masonia');
const saved=async()=>{if(!await until(async()=>{const n=await localNation(A),d=await nationDoc(uid);return n&&n._rev>0&&!n._dirty&&d?.rec&&JSON.stringify(d.rec.cities)===JSON.stringify(n.cities)&&JSON.stringify(d.rec.policies||{})===JSON.stringify(n.policies||{});},15000))throw Error('Save did not settle');};
await saved();
const cid=await A.evaluate(()=>G.S.nation.cities[0].id);
const agg=()=>A.evaluate(()=>{const a=G.NB.agg(G.S.nation);return a&&{up:a.up,add:a.add,nbOil:a.nbOil||0,prosper:a.prosper};});

/* before: in the catalogue, locked until their milestones, and no edict about them */
await nav(A,'cities');await A.click(`[data-act="ct-open"][data-id="${cid}"]`);
check('all seven appear in the city’s building plans',(await Promise.all(KEYS.map(k=>A.locator(`[data-act="ct-build"][data-id="${cid}"][data-k="${k}"]`).count()))).every(c=>c===1));
const bathsRow=A.locator('li.opt',{has:A.locator(`[data-act="ct-build"][data-k="baths"]`)});
check('the Public Baths wait for 6 million people',/Unlocks at 6 million people/.test(await bathsRow.innerText())&&await A.locator(`[data-act="ct-build"][data-k="baths"]`).isDisabled());
check('the Hanging Gardens are listed with the wonders',/Hanging Gardens/.test(await A.locator('.cat-wrap').innerText()));
check('none of the twenty edicts can arrive before the buildings work',await A.evaluate(()=>G.NB.issues.length===20&&G.NB.issues.every(is=>!is.req(G.S.nation))));
check('the new edicts come after every older one, so no number shifts',await A.evaluate(()=>G.NB.ISSUE_BY_ID[G.NB.FD_ID].no===1892&&G.NB.issues.every((is,i)=>is.no===1893+i&&G.NB.ISSUE_BY_ID[is.id]===is)&&G.NB.ISSUES.length===1912));
const lunar0=await A.evaluate(()=>G.NB.hours(G.S.nation,'lunar'));

/* finished buildings: a Factory and Power Station next to the Recycling Works, and all seven in the capital */
const s0=await A.evaluate(()=>({...G.S.nation.s}));
await A.evaluate(({id,keys})=>{const n=G.clone(G.S.nation),c=n.cities.find(c=>c.id===id),t=Date.now();for(const k of ['factory','power',...keys])c.b.push({k,s:t-3*864e5,d:t-2*864e5});G.commit(n);G.render();},{id:cid,keys:KEYS});
await saved();
const s1=await A.evaluate(()=>({...G.S.nation.s}));
check('completion applies their effects once',await A.evaluate(keys=>keys.every(k=>G.S.nation.bonce.includes(k==='gardens'?'w:gardens':G.S.nation.cities[0].id+':'+k)),KEYS));
check('crime and corruption fall, rights and equality rise',s1.crime<s0.crime&&s1.corrupt<s0.corrupt&&s1.civil>s0.civil&&s1.equal>s0.equal);
check('the environment, science and wealth rise',s1.env>s0.env&&s1.sci>s0.sci&&s1.wealth>s0.wealth);
check('each building counts as working',await A.evaluate(keys=>keys.every(k=>G.NB.works(G.S.nation,k)),KEYS));
let a1=await agg();
check('the Recycling Works halves the oil of the Factory and Power Station',a1.nbOil===1);
check('the Observatory builds the Lunar Colony 10% faster',Math.abs(await A.evaluate(()=>G.NB.hours(G.S.nation,'lunar'))-Math.round(lunar0*0.9*10)/10)<=0.15);
check('a Central Bank halves the forgery premium',await A.evaluate(()=>G.NB.cfPct(G.S.nation))===2);
check('all twenty edicts can now arrive',await A.evaluate(()=>G.NB.issues.every(is=>is.req(G.S.nation))));
check('every edict reads cleanly for this nation',await A.evaluate(()=>G.NB.issues.every(is=>[is.t,is.q,...is.o.flatMap(o=>[o.t,o.fx])].every(t=>!/[{}]/.test(G.NB.fill(t,G.S.nation,null))))));
await nav(A,'cities');
check('the city effects mention the oil saved',/recycling saves 1 oil a day/.test(await text(A,'main')));

/* two boost edicts, answered through the edicts page */
const now=Date.now();
await A.evaluate(now=>{const n=G.clone(G.S.nation);n.inbox=[{id:'bld-court-fees',at:now-3000},{id:'bld-recycle-bins',at:now-2000}];n.issueClock=now;G.commit(n);G.render();},now);
await saved();
const answer=async id=>{await nav(A,'issues');await A.click(`[data-act="open"][data-id="${id}"]`);await A.waitForSelector('.edict [data-act="answer"]');await A.click('.edict [data-act="answer"][data-o="0"]');await A.waitForSelector('.result');await saved();};
const goods0=a1.up.goods;
await answer('bld-court-fees');
let n=await localNation(A),a2=await agg();
check('Court Fees become a law of the land',n.policies.courtFees===true&&n.answered.some(x=>x.id==='bld-court-fees'&&x.o===0));
check('and the Courthouse stops using goods',Math.abs(goods0-a2.up.goods-0.5)<1e-6);
await answer('bld-recycle-bins');
a2=await agg();
check('Kerbside Sorting raises the oil saving to 60%',Math.abs(a2.nbOil-1.2)<1e-6&&(await localNation(A)).policies.recycleSort===true);
await nav(A,'cities');if(await A.locator(`[data-act="ct-open"][data-id="${cid}"][aria-expanded="true"]`).count()===0)await A.click(`[data-act="ct-open"][data-id="${cid}"]`);
check('the plans name the boost on the building',/Boosted by Court Fees: uses no goods\./.test(await A.locator('li.opt',{has:A.locator(`[data-act="ct-build"][data-k="court"]`)}).innerText()));
check('the boosts are saved with the nation’s laws',(await nationDoc(uid)).rec.policies.courtFees===true);

/* a reload keeps everything, and the map draws the new buildings */
await A.reload();await A.waitForSelector('.layout');
check('after a reload the boosts still work',await until(async()=>{const a=await agg();return a&&Math.abs(a.nbOil-1.2)<1e-6;},10000));
await nav(A,'map');await A.evaluate(c=>{G.MD.centerMain(c,18);G.render();},await A.evaluate(()=>G.S.nation.cities[0].c));
await A.waitForTimeout(800);
await A.locator('canvas[data-map="main"]').screenshot({path:OUT+'/buildings-map.png'});
check('the map draws the city with its new buildings',await A.locator('canvas[data-map="main"]').count()===1);
await finish();
