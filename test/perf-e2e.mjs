// Speed statistics (src/shim.js, build.py PERF_EDITS, src/perf-url.js): Firebase Performance Monitoring loads only
// once the visitor allows visit statistics, records the game's start-up, nation read and saves, sends no player ID,
// nation name or #hash in any address, and stops when statistics are turned off. Nothing reaches Google: the
// installation, configuration and logging calls are answered here, and the logs are read from what the page posts.
import {BASE,check,finish,until,sleep,player,open,found,CONFIG,clearEmulators} from './lib.mjs';
await clearEmulators();
const ID='G-TEST12345',APP_ID='1:123456789012:web:0a1b2c3d4e5f6a7b';
async function visitor(tag,{perf=true}={}){
  const p=await player(tag);p.google=[];p.perfJs=0;p.logs=[];p.calls=[];
  await p.ctx.route(/googletagmanager\.com|google-analytics\.com/,r=>{p.google.push(r.request().url());return r.fulfill({status:200,contentType:'text/javascript',body:''});});
  await p.ctx.route(/firebaseinstallations\.googleapis\.com/,r=>{
    p.calls.push('installations');
    const b=JSON.parse(r.request().postData()||'{}');
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'projects/x/installations/'+b.fid,fid:b.fid,refreshToken:'rt',authToken:{token:'at',expiresIn:'604800s'}})});
  });
  await p.ctx.route(/firebaseremoteconfig\.googleapis\.com/,r=>{p.calls.push('config');return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'UPDATE',entries:{fpr_enabled:'true',fpr_vc_trace_sampling_rate:'1',fpr_vc_network_request_sampling_rate:'1'}})});});
  await p.ctx.route(/firebaselogging/,r=>{
    const at=Date.now();
    try{for(const e of JSON.parse(r.request().postData()).log_event)p.logs.push({at,...JSON.parse(e.source_extension_json_proto3)});}catch(e){p.logs.push({at,bad:String(e)});}
    return r.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  // stand-ins for a Firestore REST read and another site's picture, so their addresses are reported too
  await p.ctx.route(/^https:\/\/firestore\.googleapis\.com\/v1\//,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p.ctx.route(/^https:\/\/cdn\.discordapp\.com\//,r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64')}));
  p.on('request',q=>{if(/\/assets\/perf\.[0-9a-f]+\.js$/.test(q.url()))p.perfJs++;});
  await p.ctx.addInitScript(([id,cfg,perf])=>{
    window.EDICTUM_ANALYTICS_ID=id;window.EDICTUM_FIREBASE_CONFIG=cfg;if(perf)window.EDICTUM_PERF=true;
    // the logs go by fetch, which the test answers (a beacon might slip past it)
    const b=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=(u,d)=>/firebaselogging/.test(String(u))?false:b(u,d);
  },[ID,{...CONFIG,appId:APP_ID},perf]);
  return p;
}
const traces=p=>p.logs.filter(l=>l.trace_metric).map(l=>({at:l.at,...l.trace_metric}));
const requests=p=>p.logs.filter(l=>l.network_request_metric).map(l=>l.network_request_metric.url);
const hide=p=>p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});

// before an answer, and after No thanks, nothing is loaded
const A=await visitor('perf no');await open(A);await A.waitForSelector('.ed-stats');await sleep(1500);
check('before an answer the speed script is not loaded and Firebase is not asked',A.perfJs===0&&!A.calls.length);
await A.click('.ed-stats [data-ed="stats-n"]');await sleep(1500);
check('No thanks loads nothing either',A.perfJs===0&&!A.calls.length&&!A.logs.length);

// Allow: the script loads and the game's own steps arrive, without IDs, names or #hashes
const B=await visitor('perf yes');await open(B);await B.waitForSelector('.ed-stats');
await B.click('.ed-stats [data-ed="stats-y"]');
check('Allow loads the speed script once',await until(()=>B.perfJs===1)&&await until(()=>B.calls.includes('installations')),JSON.stringify(B.calls));
await found(B,'Speedland');
const uid=await B.evaluate(()=>G.myId());
await B.evaluate(id=>Promise.all([
  fetch('https://firestore.googleapis.com/v1/projects/demo-edictum/databases/(default)/documents/nations/'+id+'?mask.fieldPaths=rev'),
  new Promise(r=>{const i=new Image();i.onload=i.onerror=r;i.src='https://cdn.discordapp.com/avatars/123456789012345678/a1b2c3.png';}),
]),uid);
await B.evaluate(id=>{location.hash='#visit/'+id;},uid);
await until(()=>{const n=traces(B).map(t=>t.name);return n.includes('game_start')&&n.includes('nation_save');},30000,500);
const t=traces(B),start=t.find(x=>x.name==='game_start'),save=t.find(x=>x.name==='nation_save'),load=t.find(x=>x.name==='nation_load');
check('start-up is recorded in steps, as a first visit of a guest',start&&['script_ms','config_ms','firebase_ms','sign_in_ms','account_ms'].every(k=>k in (start.counters||{}))&&start.custom_attributes?.account==='guest'&&start.custom_attributes?.visit==='first'&&start.duration_us>0,JSON.stringify(start));
check('the first read of the nation is recorded',load&&load.custom_attributes?.found==='no',JSON.stringify(load));
check('saves are recorded with their result',save&&save.custom_attributes?.result==='saved'&&save.duration_us>0,JSON.stringify(save));
await until(()=>requests(B).some(u=>u.includes('cdn.discordapp.com')),20000,500);
const urls=requests(B);
check('download addresses keep Firebase’s path with the player ID masked',urls.includes('https://firestore.googleapis.com/v1/projects/demo-edictum/databases/(default)/documents/nations/*'),JSON.stringify(urls.filter(u=>/googleapis/.test(u))));
check('another site’s address is its host alone',urls.includes('https://cdn.discordapp.com/')&&!urls.some(u=>u.includes('avatars')));
check('the site’s own downloads are reported by path',urls.some(u=>u.startsWith(BASE+'/assets/game.')));
await hide(B);
await until(()=>traces(B).some(x=>x.name.startsWith('_wt_')),20000,500);
const page=traces(B).find(x=>x.name.startsWith('_wt_'));
check('the page load is recorded under the page’s address without its #hash',page&&page.name==='_wt_'+BASE+'/'&&'_fcp' in (page.counters||{}),JSON.stringify(page));
const all=JSON.stringify(B.logs);
check('no player ID, nation name, #hash or query is sent',!all.includes(uid)&&!all.includes('Speedland')&&!all.includes('#visit')&&!/"url":"[^"]*\?/.test(all)&&B.logs.every(l=>!l.bad&&!/#/.test(l.application_info?.web_app_info?.page_url||'')));
await B.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));location.hash='#nation';});

// Turn off: nothing more is sent, and the next visit loads nothing and drops the installation ID
await B.click('.ed-acct-b');await B.waitForSelector('.ed-dlg[open]');await B.click('.ed-dlg [data-ed="stats-n"]');await B.click('.ed-dlg [data-ed="close"]');
const off=Date.now();
await B.evaluate(()=>{const n=G.clone(G.S.nation);n.motto='Faster still';G.commit(n);G.PG.saveSoon();});
await sleep(16000);
check('after Turn off no step is recorded',!traces(B).some(x=>x.client_start_time_us/1000>off),JSON.stringify(traces(B).filter(x=>x.at>off).map(x=>x.name)));
const before=B.perfJs;await B.reload();await B.waitForSelector('.layout');await sleep(2000);
check('a visit after Turn off loads nothing and deletes the installation ID',B.perfJs===before&&await until(()=>B.evaluate(async()=>!(await indexedDB.databases()).some(d=>d.name==='firebase-installations-database'))));

// on this machine's emulators, speed statistics stay off unless a test turns them on
const C=await visitor('perf local',{perf:false});
await C.ctx.addInitScript(()=>{try{localStorage.setItem('edictum.analytics','y');}catch(e){}});
await open(C);await C.waitForSelector('#d-name');await sleep(2000);
check('the emulators never load the speed script',C.perfJs===0&&!C.calls.length&&C.google.length>0);
await finish();
