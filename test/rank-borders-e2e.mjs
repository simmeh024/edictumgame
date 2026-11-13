// The ranks of prestige and the border each one puts round the nation card (ID_BD in game/edictum.html):
// a nation is walked up the ladder by recording achievements, and at every rank the card on the Nation page
// must wear that rank's border and nameplate. Customise may choose an earlier border, never a later one.
// Screenshots of every rank land in test/out (rank-NN-<look>.png).
import {OUT,PROJECT,check,finish,until,player,open,found,nav,czSection,sleep} from './lib.mjs';
import path from 'node:path';
if(!PROJECT.startsWith('demo-'))throw Error('This suite requires demo emulators');

const A=await player('rank borders',{vp:{width:412,height:900},dpr:2,dark:true});await open(A);await found(A,'Eternia');
const info=await A.evaluate(()=>({ranks:G.RK.ACH_RANKS.length,borders:G.RK.ID_BD.length,max:G.RK.ACH.reduce((s,a)=>s+G.RK.ACH_TIER[a.t].p,0)}));
check('every rank has a border',info.ranks===info.borders,JSON.stringify(info));
check('the top rank can be reached with the achievements there are',info.max>=await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[0]),String(info.max));
/* the Achievements page: a name belongs to one achievement, and every category has a picture for its icon (.ai-<category>) */
const twice=await A.evaluate(()=>{const by={};for(const a of G.RK.ACH)(by[a.n]=by[a.n]||[]).push(a.id);return Object.entries(by).filter(([,l])=>l.length>1).map(([n,l])=>n+': '+l.join(' + '));});
check('no two achievements share a name',twice.length===0,twice.join('; '));
const bare=await A.evaluate(()=>[...new Set(G.RK.ACH.map(a=>a.c))].filter(c=>{const e=document.createElement('span');e.className='ai-'+c;document.body.appendChild(e);const ok=/url\(/.test(getComputedStyle(e).getPropertyValue('--ai'));e.remove();return !ok;}));
check('every achievement category has an icon',bare.length===0,bare.join());

/* the page re-renders when a save lands, which can swap the card out from under a screenshot: try again */
const shot=async(sel,file)=>{for(let k=0;;k++){try{return await A.locator(sel).screenshot({path:path.join(OUT,file)});}catch(e){if(k>=3)throw e;await sleep(300);}}};

/* record achievements until the nation's prestige sits inside rank i (never past the next one) */
const reach=i=>A.evaluate(i=>{
  const n=G.clone(G.S.nation),R=G.RK,lo=R.ACH_RANKS[i][0],hi=R.ACH_RANKS[i+1]?R.ACH_RANKS[i+1][0]:Infinity,ach=Object.assign({},n.ach||{});
  /* the random founding cabinet can already earn honours (Rogues' Gallery, Resident Genius) and lift a new nation
     past the first rank: give it a plain cabinet, which earns none */
  if(R.achPoints({ach})>=hi){const c=G.clone(R.cabOf(n));for(const k in c)Object.assign(c[k],{tr:['honest'],sk:3,lo:60});n.cab=c;
    for(const a of R.ACH)if(a.id.startsWith('cab-'))delete ach[a.id];}
  let p=R.achPoints({ach});const t=Date.now();
  for(const a of R.ACH.slice().sort((x,y)=>R.ACH_TIER[y.t].p-R.ACH_TIER[x.t].p)){if(p>=lo)break;if(ach[a.id])continue;const v=R.ACH_TIER[a.t].p;if(p+v<hi){ach[a.id]=t;p+=v;}}
  n.ach=ach;G.commit(n);G.render();return R.achPoints(G.S.nation);
},i);
const card=()=>A.evaluate(()=>{const h=document.querySelector('.hero.id-sec'),b=h&&h.querySelector('.id-bd');
  return {cls:h?h.className:'',bd:b?b.className:'',plate:b&&b.querySelector('.id-bd-pl')?b.querySelector('.id-bd-pl').textContent:'',corners:b?b.querySelectorAll('.id-bd-c').length:0,
    rank:G.RK.achRank(G.RK.achPoints(G.S.nation)).i};});

await nav(A,'nation');
const looks=await A.evaluate(()=>G.RK.ID_BD.map(b=>b[2].split(' ')[0]));
let walked=0;
for(let i=0;i<info.ranks;i++){
  const pts=await reach(i);await nav(A,'nation');await A.evaluate(()=>scrollTo(0,0));await sleep(150);
  const c=await card(),[id,name,look,corner,plate]=await A.evaluate(i=>G.RK.ID_BD[i],i),rk=await A.evaluate(i=>G.RK.ACH_RANKS[i][1],i);
  const ok=c.rank===i&&(i===0?!c.bd&&!/id-rk/.test(c.cls):c.cls.includes('id-rk-'+looks[i])&&c.bd.includes('id-bd-'+looks[i])&&c.corners===(corner?4:0)&&(plate?c.plate===rk:!c.plate));
  if(ok)walked++;else check(`rank ${i} (${rk}, ${pts} prestige) wears the ${name} border`,false,JSON.stringify(c));
  await shot('.hero.id-sec',`rank-${String(i).padStart(2,'0')}-${id.slice(2)}.png`);
}
/* the next land credit is reckoned from every credit the nation has: at the top rank, its rank credits too (the forecast once
   left them out, and with them spent it named a population far past the real one) */
const lc=await A.evaluate(()=>{const n=G.S.nation,R=G.RK;return {rank:R.achRankCredits(n),earned:R.landEarned(n),at:R.earnedAt(n,R.popNow(n))};});
check('the next-credit forecast counts rank credits',lc.rank>0&&lc.at===lc.earned,JSON.stringify(lc));
check('each rank, from Footnote to The Blank Page, puts its own border and nameplate on the card',walked===info.ranks,`${walked} of ${info.ranks}`);

/* the newest top ranks' borders move, and stand still when motion is reduced */
await nav(A,'nation');
const anim=await A.evaluate(()=>{const r=document.querySelector('.hero.id-sec .id-bd .id-bd-r');return r?getComputedStyle(r).animationName:'';});
check('the top rank’s border is animated',/idBdSpin/.test(anim)&&/idBdGlow/.test(anim),anim);
check('so are the afterglow below it and three older moving borders',await A.evaluate(()=>['afterglow','comet','ember','tide'].every(k=>{const d=document.createElement('div');d.className='id-bd id-bd-'+k;d.innerHTML='<i class="id-bd-r"></i>';document.body.appendChild(d);const a=getComputedStyle(d.firstChild).animationName;d.remove();return a&&a!=='none';})));
check('the top ranks’ light spills past the card’s edge',/idLeak/.test(await A.evaluate(()=>getComputedStyle(document.querySelector('.hero.id-sec')).animationName)));
await shot('.hero.id-sec','rank-top-leak.png');
await A.emulateMedia({reducedMotion:'reduce'});
check('and stand still when motion is reduced',await A.evaluate(()=>{const r=document.querySelector('.hero.id-sec .id-bd .id-bd-r');return !!r&&getComputedStyle(r).animationName==='none';}));
await A.emulateMedia({reducedMotion:'no-preference'});

/* the fifth and sixth tiers: Prismatic (200) and secret Obsidian (500), shown only as "Obsidian (?)" until earned */
await nav(A,'achievements');await sleep(400);
const tiers=await A.evaluate(()=>({x:G.RK.ACH_TIER.x,o:G.RK.ACH_TIER.o,nx:G.RK.ACH.filter(a=>a.t==='x').length,no:G.RK.ACH.filter(a=>a.t==='o').length,sec:G.RK.ACH.filter(a=>a.t==='o').every(a=>a.sec)}));
check('a Prismatic tier worth 200 and a secret Obsidian tier worth 500',tiers.x&&tiers.x.p===200&&tiers.o&&tiers.o.p===500&&tiers.nx>=15&&tiers.no>=6&&tiers.sec,JSON.stringify(tiers));
/* the nation has earned everything by now: take one Obsidian back to see it hidden */
await A.evaluate(()=>{const n=G.clone(G.S.nation);delete n.ach['obs-pop'];G.commit(n);G.render();});await sleep(500);
const obs=await A.evaluate(()=>{const n=G.S.nation;const c=document.querySelector('#ach-obs-pop');return c?{t:c.textContent.replace(/\s+/g,' ').trim(),has:!!(n.ach&&n.ach['obs-pop'])}:null;});
check('an unearned Obsidian achievement shows only as “Obsidian (?)”',!!obs&&(obs.has||/Obsidian \(\?\)/.test(obs.t)&&!/Uncountable/.test(obs.t)&&/Obsidian · 500/.test(obs.t)),JSON.stringify(obs));
check('the tier summary counts Prismatic and Obsidian',/Prismatic/.test(await A.evaluate(()=>document.body.textContent))&&/Obsidian/.test(await A.evaluate(()=>document.body.textContent)));
await A.evaluate(()=>{const c=document.querySelector('#ach-obs-pop');if(c)c.scrollIntoView({block:'center'});});await sleep(200);
await A.screenshot({path:path.join(OUT,'ach-obsidian.png')});
await A.evaluate(()=>{const n=G.clone(G.S.nation);n.ach=Object.assign({},n.ach,{'obs-pop':Date.now()});G.commit(n);G.render();});await sleep(400);
await A.evaluate(()=>{const c=document.querySelector('.ach-card.on.at-x')||document.querySelector('.ach-card.at-x');if(c)c.scrollIntoView({block:'center'});});await sleep(200);
await A.screenshot({path:path.join(OUT,'ach-prismatic.png')});

/* the ranks list shows every border, and the borders not yet reached are dimmed */
await nav(A,'achievements');await A.locator('.ach-ladder summary').click();
check('the ranks list shows a border beside every rank',await A.locator('.ach-ladder li .id-bdsw').count()===info.ranks);
await shot('.ach-ladder','rank-ladder.png');
/* a border in the list opens larger: on a card with the nation's flag, with its rank and where the nation stands;
   the arrows step through the borders, and closing returns to the list */
const big=P=>P.evaluate(()=>{const d=document.querySelector('#bdz-root .bdz-modal');if(!d)return null;const sw=d.querySelector('.bdz-sw'),c=sw&&sw.querySelector('.id-bdsw-c'),r=sw?sw.getBoundingClientRect():null,nav=[...d.querySelectorAll('[data-act="bdz-go"]')],ae=document.activeElement;
  return {h:d.querySelector('#bdz-h').textContent,sum:d.querySelector('.bdz-sum').textContent.replace(/\s+/g,' '),cls:c?c.className:'',w:r?Math.round(r.width):0,plate:((c&&c.querySelector('.id-bd-pl'))||{}).textContent||'',
    flag:!!(c&&c.querySelector('.id-bdsw-f svg')),focus:ae?(ae.id||ae.dataset.d||''):'',off:nav.map(b=>b.disabled),cz:!!d.querySelector('.bdz-cz [data-v="customise"]'),fits:d.querySelector('.bdz-sheet').scrollWidth<=d.querySelector('.bdz-sheet').clientWidth+1};});
const kin=await A.evaluate(()=>G.RK.ACH_RANKS.findIndex(r=>r[1]==='Kingmaker')),small=await A.evaluate(()=>Math.round(document.querySelector('.ach-ladder .id-bdsw').getBoundingClientRect().width));
check('every border in the ranks list is a button',await A.locator('.ach-ladder button[data-act="bd-zoom"]').count()===info.ranks&&/Select a border to see it larger/.test(await A.locator('.ach-ladder-tip').textContent()));
await A.locator(`.ach-ladder [data-act="bd-zoom"][data-i="${kin}"]`).click();
let z=await big(A);
check('selecting a border opens it larger, on a card with the nation’s flag',!!z&&z.h===await A.evaluate(i=>G.RK.ID_BD[i][1],kin)&&z.cls.includes('id-rk-'+looks[kin])&&z.plate==='Kingmaker'&&z.w>=small*3&&z.flag&&z.fits&&z.focus==='bdz-x',JSON.stringify([small,z]));
check('it names the rank it belongs to, and says a border already earned can be worn',/The border of Kingmaker, at 4,000 prestige\. Yours to wear: choose it under Customise\./.test(z.sum)&&z.cz,z.sum);
await shot('#bdz-root .bdz-sheet','border-large.png');
await A.keyboard.press('ArrowRight');z=await big(A);
check('the right arrow steps to the next border',z.plate===await A.evaluate(i=>G.RK.ACH_RANKS[i+1][1],kin)&&z.cls.includes('id-rk-'+looks[kin+1]),JSON.stringify(z));
await A.click('#bdz-root [data-act="bdz-go"][data-d="-1"]');z=await big(A);
check('and the button back to the one before, keeping the focus on that button',z.plate==='Kingmaker'&&z.focus==='-1',JSON.stringify(z));
await A.keyboard.press('Escape');
check('Escape closes it and returns to that border in the list',await A.evaluate(k=>!document.querySelector('#bdz-root .bdz-modal')&&document.activeElement&&document.activeElement.dataset.act==='bd-zoom'&&+document.activeElement.dataset.i===k,kin));
await A.locator(`.ach-ladder [data-act="bd-zoom"][data-i="${info.ranks-1}"]`).click();z=await big(A);
check('the top border is the one the card wears, and nothing comes after it',/Your card wears it now\./.test(z.sum)&&!z.cz&&z.off[0]===false&&z.off[1]===true&&z.plate===await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[1]),JSON.stringify(z));
await shot('#bdz-root .bdz-sheet','border-large-top.png');
await A.click('#bdz-x');
check('the Close button closes it',await A.evaluate(()=>!document.querySelector('#bdz-root .bdz-modal')));

/* the Census page's Hall of Honours lists the region's player nations by prestige, each in its border */
await nav(A,'census');
const hon=await A.evaluate(()=>{const r=document.querySelector('.id-hon-r.me');return {rows:document.querySelectorAll('.id-hon-r').length,sw:r?r.querySelector('.id-bdsw-c').className:'',rank:r?r.querySelector('.id-hon-k').textContent:''};});
/* the top rank's look: its border's material (ID_BD), whatever the ladder's top is */
const topLook=await A.evaluate(()=>'id-rk-'+G.RK.ID_BD.at(-1)[2].split(' ')[0]);
check('the Census page’s Hall of Honours shows the nation in its border and rank',hon.rows>=1&&hon.sw.includes(topLook)&&hon.rank===await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[1]),JSON.stringify(hon));
await shot('.id-hon','rank-census.png');

/* Customise: an earlier border can be chosen; the card keeps it, and Follow my rank brings the rank's back */
await nav(A,'customise');await czSection(A,'b');
check('Customise offers every border, the rank’s own first',await A.locator('.cz-g-bd .cz-tile').count()===info.borders+1);
await shot('.cz-g-bd','rank-customise.png');
await A.click('#cz-bd-b-silver');
await until(()=>A.evaluate(()=>document.querySelector('.cz-prev .hero')?.className.includes('id-rk-silver')));
await nav(A,'nation');
check('a chosen earlier border replaces the rank’s on the card',(await card()).cls.includes('id-rk-silver'));
check('the nameplate still names the rank actually held',(await card()).plate===await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[1]));
await nav(A,'customise');await A.click('#cz-bd-none');await nav(A,'nation');
check('Follows your rank brings the rank’s border back',(await card()).cls.includes(topLook));

/* a border above the rank held cannot be worn, whatever the record says; a computer nation keeps a plain card */
check('a border above the rank is never shown',await A.evaluate(()=>{const n=G.clone(G.S.nation);n.ach={};n.cz=Object.assign({},n.cz,{bd:'b-prism',u:['b-prism']});return G.RK.idBdIndex(n)===0;}));
check('computer nations keep the plain card',await A.evaluate(()=>G.RK.idBdIndex(Object.assign(G.clone(G.S.nation),{npc:true}))===0));

/* the identity card is printed with the rank's border too */
await A.click('[data-act="id-passport"]');
check('the identity card prints with the border',!!await until(()=>A.evaluate(()=>!!document.querySelector('#id-pp img.id-pp')),15000));
await shot('#id-pp img.id-pp','rank-idcard.png');await A.click('.id-ppx');

/* light theme, desktop width: the top border once more */
await A.setViewportSize({width:1280,height:900});await A.emulateMedia({colorScheme:'light'});await nav(A,'nation');await A.evaluate(()=>scrollTo(0,0));await sleep(200);
await shot('.hero.id-sec','rank-top-desktop-light.png');
/* ── the ladder was stretched on 10 November 2026: a nation keeps the rank it held ──
   3,300 prestige was Eminence (rank 20, from 3,250). On the new ladder alone it is Elder Statesman (19, from 3,000).
   A nation from before the change has no mark yet; its first save writes down the rank it had. */
const B=await player('old hand',{vp:{width:412,height:900},dpr:2,dark:true});await open(B);await found(B,'Oldland');
const old=await B.evaluate(()=>{
  const R=G.RK,n=G.clone(G.S.nation),ach={},t=Date.now()-86400000;let p=0;
  const c=G.clone(R.cabOf(n));for(const k in c)Object.assign(c[k],{tr:['honest'],sk:3,lo:60});n.cab=c;
  for(const a of R.ACH.slice().sort((x,y)=>R.ACH_TIER[y.t].p-R.ACH_TIER[x.t].p)){if(a.id.startsWith('cab-'))continue;const v=R.ACH_TIER[a.t].p;if(p+v<=3300){ach[a.id]=t;p+=v;}if(p>=3300)break;}
  delete n.rkv;delete n.rkh;n.ach=ach;const before=R.achRankOf(n).i;G.commit(n);G.render();const m=G.S.nation,r=R.achRankOf(m);
  return {p:R.achPoints(m),before,rkv:m.rkv,rkh:m.rkh,i:r.i,name:r.name,held:!!r.held,next:r.next&&r.next.at,bare:R.achRank(R.achPoints(m)).i,credits:R.achRankCredits(m),bd:R.idBdIndex(m),
    fresh:R.achRankOf({ach:m.ach,rkv:2}).i,later:[R.achRankOf(m,3600).i,R.achRankOf(m,4000).i],has:G.WND.unlocks(m).includes(R.ID_BD[20][0]),hasNext:G.WND.unlocks(m).includes(R.ID_BD[21][0])};});
check('a nation from before the change reads as the old ladder had it, and its first save writes that rank down',old.before===20&&old.rkv===2&&old.rkh===20&&old.p>=3250&&old.p<3500,JSON.stringify(old));
check('it keeps the rank it held: Eminence, where the new ladder alone gives Elder Statesman',old.i===20&&old.name==='Eminence'&&old.held&&old.bare===19&&old.fresh===19&&old.next===4000,JSON.stringify(old));
check('with its land credits and its border',old.credits===200&&old.bd===20&&old.has&&!old.hasNext,JSON.stringify(old));
check('and climbs on from there: the next rank comes at the new mark',old.later[0]===20&&old.later[1]===21,JSON.stringify(old.later));
await nav(B,'nation');await B.evaluate(()=>scrollTo(0,0));await sleep(200);
const oc=await B.evaluate(()=>{const h=document.querySelector('.hero.id-sec'),b=h&&h.querySelector('.id-bd');return {cls:h?h.className:'',plate:b&&b.querySelector('.id-bd-pl')?b.querySelector('.id-bd-pl').textContent:'',look:G.RK.ID_BD[20][2].split(' ')[0]};});
check('its card wears that rank’s border and name',oc.cls.includes('id-rk-'+oc.look)&&oc.plate==='Eminence',JSON.stringify(oc));
await nav(B,'achievements');await sleep(400);
check('the Achievements page names the rank held and counts on to the next',/Eminence/.test(await B.locator('.ach-rank').first().textContent())&&/to Kingmaker at 4,000/.test((await B.locator('.ach-next').first().textContent()).replace(/\s+/g,' ')),await B.locator('.ach-hp').first().textContent());
await B.locator('.ach-ladder summary').click();
/* (the list is filled as the fold opens, and again after a redraw: wait for it) */
check('and its ranks list ticks every rank up to it',await until(async()=>await B.locator('.ach-ladder li.done').count()===21),String(await B.locator('.ach-ladder li.done').count()));
const ptsB=()=>B.evaluate(()=>G.RK.achPoints(G.S.nation)),p0=await ptsB();
await B.locator('.ach-ladder [data-act="bd-zoom"][data-i="21"]').click();
/* what is left to Kingmaker, from the nation's own prestige: about 650, but what a new nation earns by itself when it
   is founded differs from run to run (a silver more on CI on 13 Nov 2026: 3,365 at the first save, 3,340 here), and a
   save may write down the first visit to this page while it is open, so the prestige before the click or now */
const togo=async()=>{const m=/The border of Kingmaker, at 4,000 prestige\. (\d+) prestige to go\./.exec((await big(B)).sum);return m?+m[1]:-1;};
const left=await togo(),p1=await ptsB();
check('a border still ahead says how much prestige is to go',left>=500&&left<=700&&(left===4000-p0||left===4000-p1)&&!(await big(B)).cz,JSON.stringify({left,p0,p1,big:await big(B)}));
await B.keyboard.press('Escape');
/* the mark is kept by a reload, and the rank with it */
await B.evaluate(()=>G.S.nation&&0);await sleep(2500);await B.reload();await B.waitForSelector('.layout',{timeout:30000});
check('a reload keeps the rank',await until(()=>B.evaluate(()=>{const n=G.S&&G.S.nation;return !!n&&n.rkv===2&&n.rkh===20&&G.RK.achRankOf(n).i===20;}),15000),JSON.stringify(await B.evaluate(()=>({rkv:G.S.nation.rkv,rkh:G.S.nation.rkh,i:G.RK.achRankOf(G.S.nation).i}))));
await finish();
