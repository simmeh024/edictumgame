// Cities, expanded, in the real game: the one-city-at-a-time page, building upgrades, walls, mayors, a city's
// matters and mood, the plan filters, the queue, saving and reloading, and the phone layout.
import {OUT,PROJECT,check,finish,until,sleep,player,open,found,nav,text,localNation,nationDoc,clearEmulators} from './lib.mjs';
if(!PROJECT.startsWith('demo-'))throw Error('City tests require demo emulators');
await clearEmulators();
const A=await player('cities desktop'),uid=await open(A);await found(A,'Burgonia');
const saved=async()=>{if(!await until(async()=>{const n=await localNation(A),d=await nationDoc(uid);return n&&n._rev>0&&!n._dirty&&d?.rec&&JSON.stringify(d.rec.cities)===JSON.stringify(n.cities);},15000))throw Error('Save did not settle');};
await saved();
const cid=await A.evaluate(()=>G.S.nation.cities[0].id);
const rec=()=>A.evaluate(id=>G.S.nation.cities.find(c=>c.id===id),cid);
const set=f=>A.evaluate(f=>{const n=G.clone(G.S.nation);new Function('n','t',f)(n,Date.now());n._stockSet=true;G.commit(n);G.render();},String(f).replace(/^[^{]*\{|\}$/g,''));
const foodAdd=()=>A.evaluate(()=>G.NB.agg(G.S.nation).add.food);
const city=()=>A.evaluate(id=>{const T=G.territory();return G.CX.cityState(T).all.find(c=>c.id===id&&c.fid===G.myId());},cid);

/* a finished farm, a full stockpile */
await set(()=>{const c=n.cities[0];c.b=[{k:'farm',s:t-2*864e5,d:t-864e5,a:1}];n.stock={food:390,timber:390,iron:390,oil:390,goods:390};n.stockAt=t;});
await nav(A,'cities');
check('the page lists the cities beside one open city',await A.locator('.cx-list .cx-item').count()>=2&&await A.locator(`#city-${cid}.cx-detail`).count()===1);
check('the stockpile is one slim row',await A.locator('.cx-stock .cx-stk').count()===5);
check('the city opens in four tabs',await A.locator(`#city-${cid} .cx-tabs .stab`).count()===4);
check('what needs the player is listed',/no mayor/.test(await text(A,'.cx-todo')));
await A.screenshot({path:OUT+'/cities-plus-desktop.png',fullPage:true});

/* building upgrades: five coloured blocks, grey to gold */
const f1=await foodAdd();
const row=()=>text(A,`#city-${cid} .blds`),blocks=()=>A.evaluate(id=>[...document.querySelectorAll(`#city-${id} .blds .ugb`)].map(u=>[...u.children].map(i=>i.className).join(' ')),cid);
const farmRec=async()=>(await rec()).b.find(b=>b.k==='farm');
check('a finished farm shows five empty upgrade blocks',JSON.stringify(await blocks())===JSON.stringify(['ugb-grey ugb-green ugb-blue ugb-purple ugb-gold']),JSON.stringify(await blocks()));
check('and offers its grey upgrade',await A.locator(`[data-act="cx-up"][data-k="farm"]`).isEnabled()&&/Upgrade to grey/.test(await row()));
const st0=(await localNation(A)).stock;
await A.click(`[data-act="cx-up"][data-k="farm"]`);
const uu=(await farmRec()).uu,spent=st0.timber-(await localNation(A)).stock.timber;
check('upgrading starts work on block 1 and spends 0.4 times the cost',!!uu&&uu.u===1&&spent>3&&spent<6,`${JSON.stringify(uu)}, ${spent} timber`);
check('the block being fitted is striped',(await blocks())[0].split(' ')[0]==='ugb-grey'&&await A.locator(`#city-${cid} .ugb i.wip`).count()===1);
await set(()=>{const b=n.cities[0].b.find(b=>b.k==='farm');b.uu.s=t-7200e3;b.uu.d=t-1000;});
check('on completion the farm has one block',await until(async()=>(await farmRec()).ug===1));
const f2=await foodAdd();
check('and its food output is 10% higher',Math.abs(f2-f1*1.1)<0.05,`${f1} → ${f2}`);
check('the row fills the grey block and offers green',(await blocks())[0]==='ugb-grey on ugb-green ugb-blue ugb-purple ugb-gold'&&/Upgrade to green/.test(await row()));

/* a farm raised to the old level 2 counts four blocks */
await set(()=>{const b=n.cities[0].b.find(b=>b.k==='farm');delete b.ug;b.lv=2;});
check('an old level 2 reads as four blocks',await A.evaluate(id=>G.CX.ups(G.S.nation.cities.find(c=>c.id===id).b.find(b=>b.k==='farm'),Date.now()),cid)===4);
const f4=await foodAdd();
check('and gives 70% more, more than the old level’s 50%',Math.abs(f4-f1*1.7)<0.05,`${f1} → ${f4}`);
check('the row shows four blocks and offers gold',(await blocks())[0]==='ugb-grey on ugb-green on ugb-blue on ugb-purple on ugb-gold'&&/Upgrade to gold/.test(await row()));
await A.click(`[data-act="cx-up"][data-k="farm"]`);
const fr=await farmRec();
check('the gold upgrade is written in the new fields',fr.ug===4&&fr.uu&&fr.uu.u===5&&fr.lv===undefined,JSON.stringify(fr));
await set(()=>{const b=n.cities[0].b.find(b=>b.k==='farm');b.uu.s=t-7200e3;b.uu.d=t-1000;});
check('on completion the farm is gold',await until(async()=>(await farmRec()).ug===5));
const f5=await foodAdd();
check('and works at double strength',Math.abs(f5-f1*2)<0.05,`${f1} → ${f5}`);
check('the row says all five are done',/All five upgrades done/.test(await row())&&await A.locator(`[data-act="cx-up"][data-k="farm"]`).count()===0);
check('the upgrade achievements are earned',await until(()=>A.evaluate(()=>['land-cxlv2','bld-ug2','bld-ug3','bld-ug4','land-cxlv3'].every(id=>G.S.nation.ach&&G.S.nation.ach[id]))));

/* walls */
await A.click(`#city-${cid} [data-act="cx-tab"][data-k="def"]`);
check('the defence tab explains the city’s defence',/Being a city: \+20%/.test(await text(A,`#city-${cid} .cx-body`)));
await A.click(`[data-act="cx-wall"][data-id="${cid}"]`);
check('walls go up',!!(await rec()).wu);
await set(()=>{const c=n.cities[0];c.wu.s=t-7200e3;c.wu.d=t-1000;});
check('and reach level 1',await until(async()=>(await rec()).wl===1));
const def=await A.evaluate(c=>{const T=G.territory();return G.CX.def(T,T.byId[G.myId()],c).m;},(await rec()).c);
check('walls make the city 15% harder to take',Math.abs(def-1.15)<1e-9,String(def));

/* a mayor and a matter */
await A.click(`#city-${cid} [data-act="cx-tab"][data-k="ppl"]`);
check('three candidates stand for mayor',await A.locator('.cx-cands li').count()===3);
await A.click(`[data-act="cx-mayor"][data-i="0"]`);
const my=(await rec()).my;
check('a mayor is appointed, with a trait and a letter',!!my&&!!my.tr&&/Mayor of/.test(await text(A,'.cx-letter')));
const m0=(await city()).mood;
await set(()=>{n.cities[0].ne=t-1000;});
check('a matter arrives when it is due',await until(()=>A.locator('.cx-ev').count().then(c=>c===1)));
const ev=await A.evaluate(()=>{const h=document.querySelector('.cx-ev-h').textContent,nm=document.querySelector('.cx-detail .city-n').textContent;return G.CX.events.find(e=>e.t.replace(/\{C\}/g,nm)===h);});
await A.click(`[data-act="cx-ev"][data-i="0"]`);
const r2=await rec();
check('answering it schedules the next one in two to three days',r2.ne>Date.now()+1.9*864e5&&r2.ne<Date.now()+3.1*864e5);
check('and its mood effect is counted',ev?((await city()).mood-m0===(ev.o[0].m||0)):true,`${m0} → ${(await city()).mood}`);

/* the plans: filters and the queue */
await A.click(`[data-act="ct-open"][data-id="${cid}"]`);
check('the build tab shows the plans',await A.locator(`#city-${cid} .cat-wrap`).isVisible());
await A.click('[data-act="cx-cat"][data-k="soc"]');
check('a category filter shows only that category',await A.locator(`#city-${cid} .cat-h`).count()===1&&/Society/.test(await text(A,`#city-${cid} .cat-h`)));
await A.click('[data-act="cx-cat"][data-k="all"]');
await A.click(`[data-act="ct-build"][data-k="sawmill"]`);await A.click(`[data-act="ct-build"][data-k="market"]`);await A.click(`[data-act="ct-build"][data-k="theatre"]`);
await A.click(`#city-${cid} [data-act="cx-tab"][data-k="b"]`);
check('the queue offers to move a waiting building up',await A.locator(`[data-act="cx-qup"][data-k="theatre"]`).count()===1);
await A.click(`[data-act="cx-qup"][data-k="theatre"]`);
const q=(await rec()).b.filter(b=>b.s>Date.now()).sort((a,b)=>a.s-b.s).map(b=>b.k);
check('moving it up swaps the order',q.join()==='theatre,market',q.join());

/* saved and reloaded */
await saved();
const d=await nationDoc(uid),c0=d.rec.cities.find(c=>c.id===cid);
check('the server keeps the mayor, walls and upgrades',!!c0.my&&c0.wl===1&&c0.b.find(b=>b.k==='farm').ug===5);
await A.reload();await until(()=>A.evaluate(()=>!!(window.G&&G.S.nation)));
const c1=await rec();
check('and so does a reload',!!c1.my&&c1.wl===1&&c1.b.find(b=>b.k==='farm').ug===5);

/* the phone */
const P=await player('cities phone',{vp:{width:390,height:844}});await open(P);await found(P,'Pocketia');await nav(P,'cities');
check('on a phone the list becomes a row of tabs',await P.evaluate(()=>getComputedStyle(document.querySelector('.cx-list')).flexDirection==='row'));
check('without the page scrolling sideways',await P.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
await P.screenshot({path:OUT+'/cities-plus-phone.png',fullPage:true});
await finish();
