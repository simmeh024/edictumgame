// The ranks of prestige and the border each one puts round the nation card (ID_BD in game/edictum.html):
// a nation is walked up the ladder by recording achievements, and at every rank the card on the Nation page
// must wear that rank's border and nameplate. Customise may choose an earlier border, never a later one.
// Screenshots of every rank land in test/out (rank-NN-<look>.png).
import {OUT,PROJECT,check,finish,until,player,open,found,nav,sleep} from './lib.mjs';
import path from 'node:path';
if(!PROJECT.startsWith('demo-'))throw Error('This suite requires demo emulators');

const A=await player('rank borders',{vp:{width:412,height:900},dpr:2,dark:true});await open(A);await found(A,'Eternia');
const info=await A.evaluate(()=>({ranks:G.RK.ACH_RANKS.length,borders:G.RK.ID_BD.length,max:G.RK.ACH.reduce((s,a)=>s+G.RK.ACH_TIER[a.t].p,0)}));
check('every rank has a border',info.ranks===info.borders,JSON.stringify(info));
check('the top rank can be reached with the achievements there are',info.max>=await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[0]),String(info.max));

/* record achievements until the nation's prestige sits inside rank i (never past the next one) */
const reach=i=>A.evaluate(i=>{
  const n=G.clone(G.S.nation),R=G.RK,lo=R.ACH_RANKS[i][0],hi=R.ACH_RANKS[i+1]?R.ACH_RANKS[i+1][0]:Infinity,ach=Object.assign({},n.ach||{});
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
  await A.locator('.hero.id-sec').screenshot({path:path.join(OUT,`rank-${String(i).padStart(2,'0')}-${id.slice(2)}.png`)});
}
check('each rank, from Footnote to Eternal, puts its own border and nameplate on the card',walked===info.ranks,`${walked} of ${info.ranks}`);

/* the ranks list shows every border, and the borders not yet reached are dimmed */
await nav(A,'achievements');await A.locator('.ach-ladder summary').click();
check('the ranks list shows a border beside every rank',await A.locator('.ach-ladder li .id-bdsw').count()===info.ranks);
await A.locator('.ach-ladder').screenshot({path:path.join(OUT,'rank-ladder.png')});

/* Customise: an earlier border can be chosen; the card keeps it, and Follow my rank brings the rank's back */
await nav(A,'customise');
check('Customise offers every border, the rank’s own first',await A.locator('.cz-g-bd .cz-tile').count()===info.borders+1);
await A.locator('.cz-g-bd').screenshot({path:path.join(OUT,'rank-customise.png')});
await A.click('#cz-bd-b-silver');
await until(()=>A.evaluate(()=>document.querySelector('.cz-prev .hero')?.className.includes('id-rk-silver')));
await nav(A,'nation');
check('a chosen earlier border replaces the rank’s on the card',(await card()).cls.includes('id-rk-silver'));
check('the nameplate still names the rank actually held',(await card()).plate===await A.evaluate(()=>G.RK.ACH_RANKS.at(-1)[1]));
await nav(A,'customise');await A.click('#cz-bd-none');await nav(A,'nation');
check('Follows your rank brings the rank’s border back',(await card()).cls.includes('id-rk-prism'));

/* a border above the rank held cannot be worn, whatever the record says; a computer nation keeps a plain card */
check('a border above the rank is never shown',await A.evaluate(()=>{const n=G.clone(G.S.nation);n.ach={};n.cz=Object.assign({},n.cz,{bd:'b-prism',u:['b-prism']});return G.RK.idBdIndex(n)===0;}));
check('computer nations keep the plain card',await A.evaluate(()=>G.RK.idBdIndex(Object.assign(G.clone(G.S.nation),{npc:true}))===0));

/* the identity card is printed with the rank's border too */
await A.click('[data-act="id-passport"]');
check('the identity card prints with the border',!!await until(()=>A.evaluate(()=>!!document.querySelector('#id-pp img.id-pp')),15000));
await A.locator('#id-pp img.id-pp').screenshot({path:path.join(OUT,'rank-idcard.png')});await A.click('.id-ppx');

/* light theme, desktop width: the top border once more */
await A.setViewportSize({width:1280,height:900});await A.emulateMedia({colorScheme:'light'});await nav(A,'nation');await A.evaluate(()=>scrollTo(0,0));await sleep(200);
await A.locator('.hero.id-sec').screenshot({path:path.join(OUT,'rank-top-desktop-light.png')});
await finish();
