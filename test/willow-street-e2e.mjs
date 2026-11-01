// Letters from Willow Street in the real game: a milestone reached through ordinary answers, a change of government
// while a letter waits, an answer, reloads, the next letter's callback on a second device, and a stale device's
// answer refused by the save revision. Run under the emulators: npm run test:willow
import {check,finish,until,player,open,found,nav,text,localNation,nationDoc,clearEmulators,errors,OUT} from './lib.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await clearEmulators();
const A=await player('willow desktop'),uid=await open(A);await found(A,'Lamplight');
const saved=async p=>{if(!await until(async()=>{const n=await localNation(p);return n?._rev>0&&!n._dirty;},15000))throw Error('Save did not settle');};
const ws=p=>p.evaluate(()=>JSON.parse(JSON.stringify(G.S.nation.ws)));
/* one arrival slot is due now */
const slot=p=>p.evaluate(()=>{const n=G.clone(G.S.nation);n.issueClock=Date.now()-n.freq*60000-1000;G.commit(n);G.S.openIssue=null;G.S.result=null;G.render();});
await saved(A);await nav(A,'issues');
check('the desk says when the first letter comes',/Next letter at 5 enacted edicts\. You have enacted 0\./.test(await text(A,'.ws-strip')),await text(A,'.ws-strip'));
check('a new nation starts the story at zero',(await ws(A)).e===0&&(await ws(A)).c.length===0);

/* five ordinary edicts answered through the page, and one vetoed */
for(let i=0;i<6;i++){
  await slot(A);await nav(A,'issues');
  await A.click('.issue-card:not([data-id^="ws-"])');await A.waitForSelector('.edict h1');
  if(i===2){await A.click('[data-act="dismiss"]');continue;}
  await A.click('[data-act="answer"][data-o="0"]');await A.waitForSelector('.result');
}
await saved(A);
check('five enacted edicts count, the veto does not',(await ws(A)).e===5,JSON.stringify(await ws(A)));
await nav(A,'issues');
check('no letter before an arrival slot, however many edicts were enacted',await A.locator('.issue-card[data-id^="ws-"]').count()===0);
check('the desk says the letter is earned and when it comes',/Letter I of VIII is earned/.test(await text(A,'.ws-strip')));
await A.evaluate(()=>{const n=G.clone(G.S.nation);n.inbox=n.inbox.slice(0,2);G.commit(n);});await slot(A);await nav(A,'issues');
check('the next slot brings letter I, marked as the citizen story',/Citizen story · Letter I of VIII/.test(await text(A,'.issue-card[data-id="ws-1"]')));
check('the desk shows it as waiting',/Letter I of VIII is on your desk/.test(await text(A,'.ws-strip')));
await A.click('.issue-card[data-id="ws-1"]');await saved(A);
check('the Republic’s letter: the lamp, addressed to the Senate',/A Light on Willow Street/.test(await text(A,'.edict h1'))&&/Dear Senators,/.test(await text(A,'.ws-letter')));
check('opening the letter resolves nothing',(await ws(A)).c.length===0&&(await localNation(A)).inbox.some(x=>x.id==='ws-1'&&x.ws&&x.ws.f==='rep'));
const letter1=await text(A,'.ws-letter'),opts1=await A.locator('.opt p').allTextContents();

/* a revolution while the letter waits: a crowned state with low civil rights */
await A.evaluate(()=>{const n=G.clone(G.S.nation);n.pretitle='Kingdom';n.leader='Queen';n.s.civil=10;n.policies.surveillance=true;G.commit(n);G.render();});await saved(A);
check('after the change of government the waiting letter reads exactly as it arrived',await text(A,'.ws-letter')===letter1&&JSON.stringify(await A.locator('.opt p').allTextContents())===JSON.stringify(opts1));
check('and says it was addressed before the change',/addressed to the Senate, before your change of government/.test(await text(A,'.ws-gov')));
await open(A);await nav(A,'issues');await A.click('.issue-card[data-id="ws-1"]');
check('a reload keeps the frozen letter',await text(A,'.ws-letter')===letter1);
const credits0=await A.evaluate(()=>G.S.nation.wsl||0);
await A.click('[data-act="answer"][data-id="ws-1"][data-o="0"]');await A.waitForSelector('.ws-out');await saved(A);
check('the result shows what came of it on Willow Street',/From Willow Street/.test(await text(A,'.ws-out'))&&/lamp is lit/.test(await text(A,'.ws-out')));
check('and the keepsake and land it brought',/5 land credits/.test(await text(A,'.result'))&&/the Well-Lit/.test(await text(A,'.result')));
let w=await ws(A);
check('the answer is recorded with the family it arrived under, and its facts',w.c.length===1&&w.c[0].o===0&&w.c[0].f==='rep'&&w.x.lp==='on'&&w.x.tr===1);
check('five land credits, once',(await A.evaluate(()=>G.S.nation.wsl))===credits0+5);
const doc=await nationDoc(uid);
check('the story is in the private half, the land count in the shared half',!!doc.rec.ws&&!doc.shared.ws&&doc.shared.wsl===5&&doc.rec.ws.c.length===1);
check('the keepsake is listed for other players',(doc.shared.cz?.u||[]).includes('t-welllit')||!doc.shared.cz);

/* five more, then the Crown's letter remembers the Senate and the mended lamp */
for(let i=0;i<5;i++){await A.evaluate(()=>{const n=G.clone(G.S.nation);n.issueClock=Date.now()-n.freq*60000-1000;G.commit(n);const v=G.syncInbox(G.S.nation,Date.now()),x=v.inbox.find(x=>!/^ws-/.test(x.id));G.answer(x.id,1);});}
await saved(A);check('ten enacted edicts',(await ws(A)).e===10);
await A.evaluate(()=>{const n=G.clone(G.S.nation);n.inbox=[];G.commit(n);});await slot(A);await nav(A,'issues');await A.click('.issue-card[data-id="ws-2"]');await saved(A);
const letter2=await text(A,'.ws-letter');
check('letter II comes in the Crown’s voice',/The Royal Inspection/.test(await text(A,'.edict h1')),await text(A,'.edict h1'));
check('it remembers where her letters used to go',/the Senate/.test(letter2),letter2.slice(0,300));
check('the recap repeats the actual earlier ruling',/mended within the week/.test(await text(A,'.ws-recap')));
check('the low civil-rights band is in her voice',/full name and address|in a folder, which I am told is permitted/.test(letter2));

/* a phone on the same account: the same letter, word for word, and readable */
const B=await player('willow phone',{vp:{width:390,height:844},dark:true,storageState:await A.ctx.storageState({indexedDB:true})});
check('the phone opens the same nation',await open(B)===uid);await B.waitForSelector('.layout');await nav(B,'issues');await B.click('.issue-card[data-id="ws-2"]');
check('the letter reads the same on another device',await text(B,'.ws-letter')===letter2);
check('the letter fits the phone without sideways scrolling',await B.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await B.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await B.screenshot({path:OUT+'/willow-letter-390.png',fullPage:true});
await A.screenshot({path:OUT+'/willow-letter-1280.png',fullPage:true});

/* the phone goes offline and answers too; the desktop's answer is saved first, so the phone's is refused */
await B.ctx.setOffline(true);
await A.click('[data-act="answer"][data-id="ws-2"][data-o="0"]');await A.waitForSelector('.ws-out');await saved(A);
await B.click('[data-act="answer"][data-id="ws-2"][data-o="2"]');await sleep(300);
check('offline, the phone resolves its own copy',(await ws(B)).c.length===2&&(await ws(B)).c[1].o===2);
await B.ctx.setOffline(false);await B.evaluate(()=>window.dispatchEvent(new Event('online')));
check('back online, the stale answer is refused and the saved one loaded',await until(async()=>{const x=await ws(B);return x.c.length===2&&x.c[1].o===0;},25000),JSON.stringify((await ws(B)).c));
await sleep(1500);
const fin=(await nationDoc(uid)).rec.ws;
check('the stored story has one answer to letter II, the first device’s',fin.c.length===2&&fin.c[1].o===0&&fin.c.filter(r=>r.o===2).length===0);
check('letter II’s answer moved the facts once',typeof fin.x.tr==='number');
await B.ctx.close();await A.ctx.close();
check('no page errors',!errors.length,errors.join(' | '));await finish();
