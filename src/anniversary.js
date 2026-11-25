/* One month of Edictum: five gifts, 27 November through 3 December 2026 (UTC). */
const ANN_START=Date.UTC(2026,10,27),ANN_END=Date.UTC(2026,11,4),ANN_ALL=31;
const ANN={later:false,busy:false,error:''};
const annBits=n=>n&&Number.isInteger(n.ann1)?n.ann1&ANN_ALL:0;
NORM_HOOKS.push((n,d)=>{const b=annBits(d);if(b)n.ann1=b;});
Object.assign(UNLOCKS,{
  'e-firstmonth':{k:'emblem',n:'First Month laurel',src:'anniversary'},
  'lp-firstmonth':{k:'paper',n:'First Month letterhead',src:'anniversary'},
  'ls-firstmonth':{k:'seal',n:'First Month seal',src:'anniversary'}
});
EMBLEMS['e-firstmonth']='First Month laurel';CZ_EMBS.push('e-firstmonth');
LP_X['lp-firstmonth']={n:'First Month letterhead',bg:'#fbf5e5',ink:'#30251b',bd:'#b18a3d',acc:'#825e18',g:'✦ 1 ✦'};
UNLOCK_SOURCES.push({earned:n=>[...(annBits(n)&4?['e-firstmonth']:[]),...(annBits(n)&8?['lp-firstmonth','ls-firstmonth']:[])],
  how:id=>['e-firstmonth','lp-firstmonth','ls-firstmonth'].includes(id)?'A gift for Edictum’s first month.':null});
czEmblemSVG=(f=>function(e,x,y,r,col){if(e!=='e-firstmonth')return f.apply(this,arguments);
  const s=r/40;return `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round"><path d="M-3 34C-36 24-38-9-25-28M3 34C36 24 38-9 25-28"/><path d="M-19 25l-13-4m17 0-3-13m-11 5-10-8m11-2-1-13m3 0-7-10M19 25l13-4m-17 0 3-13m11 5 10-8m-11-2 1-13m-3 0 7-10"/><path d="M-5-11l8-5v32m-9 0H12" stroke-width="5"/></g>`;})(czEmblemSVG);
achDef('odd','odd-first-month','p','First Month','Celebrate Edictum’s first month with your nation.',1,x=>achYes(!!(annBits(x.n)&1)),{fm:'bool'});
museumView=(f=>function(now){const h=f.apply(this,arguments);if((S.muHall||'entrance')!=='entrance'||S.museumFor&&S.museumFor!==myId()||!(annBits(S.nation)&1))return h;
  const cert=`<section class="ann-cert" aria-label="First Month certificate"><span aria-hidden="true">❧ Ⅰ ❧</span><p class="eyebrow">Certificate of celebration · 27 November 2026</p><h2>One month of Edictum</h2><p>This certifies that <b>${esc(fullName(S.nation))}</b> celebrated the first month of Edictum. Thank you for helping build this world.</p></section>`;
  return h.replace('<div class="mu-hall" data-hall="entrance">',v=>v+cert);})(museumView);
{const el=document.createElement('style');el.textContent=`
.lp-firstmonth{--lp-bg:#fbf5e5;--lp-ink:#30251b;--lp-bd:#b18a3d;--lp-acc:#825e18;--lp-bw:2px;--lp-sh:inset 0 0 0 3px #fbf5e5,inset 0 0 0 4px #c9a64b}
.dm-wax.ls-firstmonth{background:radial-gradient(circle at 35% 30%,#e7c968,#9a6b18);outline:1px dotted #fff4c5;outline-offset:-5px}.dm-wax.ls-firstmonth i{color:#513807}
.ann-cert{text-align:center;background:#fbf5e5;color:#30251b;border:6px double #b18a3d;padding:22px;margin:18px 0}.ann-cert>span{font:32px Georgia;color:#a47c28}.ann-cert h2{font-family:Georgia,serif}
.ann-bg{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#151b24c9;padding:16px;overflow:auto}.ann-dialog{background:var(--sheet,#fffaf0);color:var(--ink,#222);width:min(760px,100%);max-height:95vh;overflow:auto;padding:clamp(18px,4vw,36px);border:4px double #b28a3b;box-shadow:0 18px 60px #0007;text-align:center}.ann-dialog h2{font:clamp(26px,5vw,42px) Georgia,serif;margin:5px 0 12px}.ann-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:22px 0}.ann-box{min-width:0;border:1px solid #b18a3d;background:#f5ead0;color:#403218;padding:14px 5px;cursor:pointer;border-radius:5px}.ann-box:focus-visible{outline:3px solid #3868a1;outline-offset:3px}.ann-box .ann-icon{display:block;font-size:34px;line-height:1.2}.ann-box b{display:block;font-size:12px;overflow-wrap:anywhere}.ann-box.open{background:#e8f0e3;border-color:#60835c}.ann-box.open .ann-icon{animation:ann-spark .4s ease-out}@keyframes ann-spark{from{transform:scale(.5) rotate(-25deg);opacity:.2}to{transform:scale(1) rotate(0);opacity:1}}@media(prefers-reduced-motion:reduce){.ann-box.open .ann-icon{animation:none}}.ann-reveal{min-height:48px}.ann-error{color:#a31b27}.ann-actions{display:flex;justify-content:center;gap:16px;align-items:center;flex-wrap:wrap}@media(max-width:560px){.ann-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.ann-dialog{padding:18px}.ann-box{padding:10px 4px}}
`;document.head.appendChild(el);}
const ANN_LABEL=['First Month','Treasury','National Finery','Diplomatic Pouch','Chancery Club'];
const ANN_DESC=['Your First Month badge and museum certificate are yours.','50 goods and 50 food have been added to your stockpile.','Your First Month laurel emblem is in Customise → Flag.','Your anniversary letterhead and wax seal are in Customise → Stationery.','Three days of the Chancery Club are yours. Existing membership is extended by three days.'];
function annClose(){document.getElementById('anniversary')?.remove();}
function annShow(){if(document.getElementById('anniversary'))return;const n=S.nation,b=annBits(n),o=document.createElement('div');o.id='anniversary';o.className='ann-bg';
  o.innerHTML=`<div class="ann-dialog" role="dialog" aria-modal="true" aria-labelledby="ann-h" aria-describedby="ann-intro"><p class="eyebrow">27 November · five gifts for your nation</p><h2 id="ann-h">One month of Edictum</h2><p id="ann-intro">Thank you for building this world with us, ${esc(n.name)}. Five gifts await your nation. Open them in any order.</p><div class="ann-grid">${ANN_LABEL.map((v,i)=>`<button type="button" class="ann-box${b&(1<<i)?' open':''}" data-ann-box="${i}" aria-label="${b&(1<<i)?'Opened':'Open'} ${esc(v)}"><span class="ann-icon" aria-hidden="true">${b&(1<<i)?'✦':'🎁'}</span><b>${esc(v)}</b></button>`).join('')}</div><p class="ann-reveal" aria-live="polite">${ANN.error?`<span class="ann-error">${esc(ANN.error)}</span>`:b===ANN_ALL?'All five gifts are yours.':'Choose a gift to open.'}</p><div class="ann-actions"><button type="button" class="btn" data-ann-close>${b===ANN_ALL?'Continue':'Open the rest later'}</button></div><p class="hint">Available until 3 December, 23:59 UTC · once per nation</p></div>`;
  document.body.appendChild(o);o.querySelector('.ann-box:not(.open),[data-ann-close]')?.focus();}
async function annOpen(i){const bit=1<<i,n=S.nation;if(ANN.busy||!n||annBits(n)&bit)return;
  if(Date.now()<ANN_START||Date.now()>=ANN_END){ANN.error='The anniversary claim period has ended.';annClose();annShow();return;}
  ANN.busy=true;ANN.error='';
  try{if(i===4){const result=await shopReq({step:'anniversary'});if(!result||!result.ok)throw new Error('The Club gift could not be claimed. Please try again.');}
    const m=clone(S.nation),now=Date.now();m.ann1=annBits(m)|bit;
    if(i===1){const st=stockNow(m,now);st.goods=num0(st.goods)+50;st.food=num0(st.food)+50;xsMark(m,st,now);m.stock=roundStock(st);m.stockAt=now;m._stockSet=true;}
    commit(m);annClose();annShow();const say=document.querySelector('#anniversary .ann-reveal');if(say)say.textContent=ANN_DESC[i];
  }catch(e){ANN.error=e&&e.message||'Please reconnect and try again.';annClose();annShow();}finally{ANN.busy=false;}}
document.addEventListener('click',e=>{const box=e.target.closest&&e.target.closest('[data-ann-box]');if(box){annOpen(Number(box.dataset.annBox));return;}if(e.target.closest&&e.target.closest('[data-ann-close]')){ANN.later=true;annClose();quietRender();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('anniversary')){ANN.later=true;annClose();quietRender();}});
setInterval(()=>{try{const n=S.nation,now=Date.now();if(ANN.later||ANN.busy||now<ANN_START||now>=ANN_END||!n||n.npc||annBits(n)===ANN_ALL||document.hidden||OBS||PV||tabPassive||regBlocked()||S.mode!=='world'||S.moving||S.db&&!RCTRL.ready||!(n.cities&&n.cities.length)||navigator.webdriver&&!window.EDICTUM_ANNIVERSARY||document.getElementById('anniversary')||document.getElementById('m50')||document.getElementById('m100')||document.getElementById('m200')||m100Busy())return;annShow();}catch(e){}},2000);
if(typeof window.EDICTUM_PROBE==='function')window.EDICTUM_PROBE.ann={show:annShow,open:annOpen,bits:annBits};

