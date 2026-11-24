// Build first with python build.py; runs entirely in local mode, without accounts or production writes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),pub=path.join(root,'public');
assert.ok(fs.existsSync(path.join(pub,'index.html')),'build the game first');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  let f=path.join(pub,decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!f.startsWith(pub+path.sep)&&f!==pub){res.writeHead(403).end();return;}
  if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');
  if(!fs.existsSync(f)){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.EDICTUM_NO_DESK=true;window.EDICTUM_PROBE=g=>window.__game=g;});
const read=()=>page.evaluate(()=>({paid:window.__game.S.nation.mbg||0,goods:window.__game.S.nation.stock.goods}));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.fill('#d-name','Backpay browser');await page.click('#found-btn');
  await page.waitForFunction(()=>window.__game?.S.nation);
  // Founding can also pay an achievement-rank gift; the back-payment marker is already complete.
  assert.equal((await read()).paid,20);console.log('ok new nation is already marked paid');
  // A record from the old build has no payment marker. Loading it does not itself save it.
  await page.evaluate(()=>{const G=window.__game,n=G.clone(G.S.nation);delete n.mbg;n.stock.goods=100;n.stockAt=Date.now();G.S.nation=n;G.render();});
  await page.waitForFunction(()=>window.__game.S.nation.mbg===20,{},{timeout:15000});
  assert.deepEqual(await read(),{paid:20,goods:120});console.log('ok existing nation is paid automatically on opening');
  await page.reload();await page.waitForFunction(()=>window.__game?.S.nation);
  assert.deepEqual(await read(),{paid:20,goods:120});console.log('ok reload keeps the payment marker and does not pay again');
  await page.evaluate(()=>{const G=window.__game,n=G.clone(G.S.nation);delete n.mbg;n.stock.goods=400;n.stockAt=Date.now();G.S.nation=n;G.render();});
  await page.waitForTimeout(5500);
  assert.deepEqual(await read(),{paid:0,goods:400});console.log('ok full stores leave the full 20 goods due');
  await page.evaluate(()=>{window.__game.S.nation.stock.goods=395;});
  await page.waitForFunction(()=>window.__game.S.nation.mbg===5,{},{timeout:15000});
  assert.deepEqual(await read(),{paid:5,goods:400});console.log('ok five goods fit and fifteen remain due');
  const spend=()=>page.evaluate(()=>{const G=window.__game,n=G.clone(G.S.nation);n.stock.goods-=10;n.stockAt=Date.now();n._stockSet=true;G.commit(n);});
  await spend();assert.deepEqual(await read(),{paid:15,goods:400});
  await spend();assert.deepEqual(await read(),{paid:20,goods:395});console.log('ok spending receives the rest, for exactly twenty goods total');
  assert.deepEqual(errors,[]);console.log('ok no page errors');
}finally{await browser.close();await new Promise(r=>server.close(r));}
