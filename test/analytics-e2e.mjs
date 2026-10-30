// Visit statistics (src/shim.js): Google Analytics loads only once the visitor allows it, counts pages by
// their name alone, keeps Google's advertising features off, and the answer can be changed in the account
// menu and on the privacy notice. Nothing reaches Google: gtag.js is replaced by an empty script, and the
// commands the page queued for it are read from window.dataLayer.
import path from 'node:path';
import {BASE,OUT,check,finish,until,player,open,found,nav,clearEmulators} from './lib.mjs';
await clearEmulators();
const ID='G-TEST12345';
async function visitor(tag,opts){
  const p=await player(tag,opts);p.google=[];
  await p.ctx.route(/googletagmanager\.com|google-analytics\.com/,r=>{p.google.push(r.request().url());return r.fulfill({status:200,contentType:'text/javascript',body:''});});
  await p.ctx.addInitScript(id=>{window.EDICTUM_ANALYTICS_ID=id;},ID);
  return p;
}
const queued=p=>p.evaluate(()=>(window.dataLayer||[]).map(a=>Array.from(a)));
const views=async p=>(await queued(p)).filter(a=>a[0]==='event'&&a[1]==='page_view').map(a=>a[2]);
const choice=p=>p.evaluate(()=>localStorage.getItem('edictum.analytics'));
const statsLine=p=>p.locator('.ed-stats-set').textContent();
const openAccount=async p=>{await p.click('.ed-acct-b');await p.waitForSelector('.ed-dlg[open]');};

// a phone: the card asks first, above the founding page's Found bar, and nothing is loaded meanwhile
const A=await visitor('analytics phone',{vp:{width:390,height:780}});await open(A);
await A.waitForSelector('.ed-stats');
const lift=await A.evaluate(()=>{const c=document.querySelector('.ed-stats').getBoundingClientRect(),b=document.querySelector('.found-bar')?.getBoundingClientRect();return {card:c.bottom,bar:b&&b.height?b.top:innerHeight,left:c.left,right:c.right,w:innerWidth};});
check('the card sits above the Found bar and inside the screen',lift.card<=lift.bar&&lift.left>=0&&lift.right<=lift.w,JSON.stringify(lift));
await A.screenshot({path:path.join(OUT,'analytics-card-390.png')});
check('before an answer nothing is loaded from Google and no cookie is set',!A.google.length&&await A.evaluate(()=>!window.dataLayer&&!/_ga/.test(document.cookie)));
await A.click('.ed-stats [data-ed="stats-n"]');
check('No thanks closes the card, is remembered, and loads nothing',!(await A.$('.ed-stats'))&&await choice(A)==='n'&&!A.google.length);
await A.reload();await A.waitForSelector('#d-name');
check('a visitor who said no is not asked again',!(await A.$('.ed-stats'))&&!A.google.length);
await A.setViewportSize({width:1280,height:900});

// the account menu changes the answer either way
await openAccount(A);
check('the account menu says statistics are off and offers Allow',/off\.\s*Allow/.test(await statsLine(A)));
await A.click('.ed-dlg [data-ed="stats-y"]');
await until(()=>A.google.length>0);
const q=await queued(A),consent=q.find(a=>a[0]==='consent'&&a[1]==='default')?.[2],config=q.find(a=>a[0]==='config')?.[2];
check('Allow loads gtag.js with the measurement ID',A.google.some(u=>u.includes('gtag/js?id='+ID))&&await choice(A)==='y');
check('advertising storage and signals stay off',consent?.ad_storage==='denied'&&consent?.ad_user_data==='denied'&&consent?.ad_personalization==='denied'&&consent?.analytics_storage==='granted'&&config?.allow_google_signals===false&&config?.allow_ad_personalization_signals===false,JSON.stringify({consent,config}));
check('the automatic page view is off and one page view is sent by name',config?.send_page_view===false&&JSON.stringify(await views(A))===JSON.stringify([{page_location:BASE+'/',page_title:await A.title()}]));
check('the account menu now offers Turn off',/allowed\.\s*Turn off/.test(await statsLine(A)));
await A.click('.ed-dlg [data-ed="close"]');

// pages count by name, never with a nation's ID
await found(A,'Statland');await nav(A,'map');await nav(A,'nation');
await A.evaluate(()=>{location.hash='#visit/'+G.myId();});
await until(async()=>(await views(A)).some(v=>v.page_location===BASE+'/visit'));
const seen=await views(A),uid=await A.evaluate(()=>G.myId());
check('each page is counted once by its name',['/map','/nation','/visit'].every(x=>seen.filter(v=>v.page_location===BASE+x).length>=1)&&seen.every((v,i)=>!i||v.page_location!==seen[i-1].page_location),JSON.stringify(seen.map(v=>v.page_location)));
check('no player ID or nation name is queued for Google',!JSON.stringify(await queued(A)).includes(uid)&&!JSON.stringify(await queued(A)).includes('Statland'));

// Turn off stops sending and deletes Google's cookies
await A.evaluate(()=>{document.cookie='_ga=GA1.1.1.1; path=/';document.cookie='_ga_TEST12345=GS1.1.1; path=/';});
await openAccount(A);await A.click('.ed-dlg [data-ed="stats-n"]');
check('Turn off disables the tag, withdraws consent and deletes the cookies',await A.evaluate(id=>window['ga-disable-'+id]===true&&!/_ga/.test(document.cookie),ID)&&(await queued(A)).some(a=>a[0]==='consent'&&a[1]==='update'&&a[2].analytics_storage==='denied')&&await choice(A)==='n');
await A.click('.ed-dlg [data-ed="close"]');
const before=(await views(A)).length;await nav(A,'map');
check('no page view is queued while turned off',(await views(A)).length===before);

// the privacy notice shows the answer and changes it for an open game tab too
const P=await A.ctx.newPage();await P.goto(BASE+'/privacy#analytics');
check('the privacy notice shows the answer',(await P.locator('#stats-choice').textContent()).includes('off')&&await P.locator('#stats-choice [data-y]').isVisible()&&!(await P.locator('#stats-choice [data-n]').isVisible()));
await P.click('#stats-choice [data-y]');
check('Allow on the notice turns statistics back on in the open game',await until(()=>A.evaluate(id=>window['ga-disable-'+id]===false,ID))&&(await queued(A)).filter(a=>a[0]==='consent'&&a[1]==='update').pop()?.[2].analytics_storage==='granted');
await P.goto(BASE+'/privacidad#analytics');
check('the Spanish notice shows it too',(await P.locator('#stats-choice').textContent()).includes('permitidas'));
await P.close();

// a desktop that allows straight away; without a measurement ID nobody is asked
const B=await visitor('analytics desktop');await open(B);await B.waitForSelector('.ed-stats');
await B.screenshot({path:path.join(OUT,'analytics-card-1280.png')});
await B.click('.ed-stats [data-ed="stats-y"]');
check('Allow on the card loads gtag.js and counts the page',await until(()=>B.google.length>0)&&!(await B.$('.ed-stats'))&&(await views(B)).length===1);
const C=await player('analytics none');await open(C);await C.waitForSelector('#d-name');
check('without a measurement ID there is no card and no tag',!(await C.$('.ed-stats'))&&await C.evaluate(()=>!window.dataLayer));
await finish();
