// Peace offers between two players (emulators): the offer, saved for real, shows both sides when it takes effect by
// itself; 30 hours on, unanswered, the war is over for both, the bell says why, and a 72-hour truce stops war again.
// The clock is moved forward in the page by backdating the two records there (nothing of that is saved).
import { check, finish, until, player, open, found, register, nationDoc, errors, clearEmulators, OUT } from './lib.mjs';
await clearEmulators();
const H = 3600000;
const A = await player('pt-a', { vp: { width: 1366, height: 900 } }), B = await player('pt-b', { vp: { width: 1366, height: 900 } });
const ua = await open(A); await found(A, 'Halcyra');
const ub = await open(B); await found(B, 'Durnholt');
await register(A, { old: true }); await register(B, { old: true });

/* A goes to war with B, then offers peace (both saved) */
await A.evaluate(id => { const n = G.clone(G.S.nation); n.wars = { ...(n.wars || {}), [id]: { t: Date.now() } }; G.commit(n); }, ub);
check('the war is saved', await until(async () => { const d = await nationDoc(ua); return !!(d && d.rec && d.rec.wars && d.rec.wars[ub]); }, 15000));
await A.evaluate(id => { const n = G.clone(G.S.nation); n.peace = { ...(n.peace || {}), [id]: Date.now() }; n.pterm = { ...(n.pterm || {}), [id]: 'keep' }; G.commit(n); }, ub);
check('the offer is saved', await until(async () => { const d = await nationDoc(ua); return !!(d && d.rec && d.rec.peace && d.rec.peace[ub]); }, 15000));

const box = (p, id) => p.evaluate(id => { const x = G.allNations().find(y => y.id === id); return x ? G.HID().warControls(x).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : ''; }, id);
const bell = p => p.evaluate(() => { const { pin, ev } = G.NEWS.bell(); return { pin: pin.map(x => x.txt), ev: ev.map(x => x.txt) }; });

check('B sees the offer, with when it takes effect by itself', await until(async () => /Halcyra has offered peace\. Unless you answer first, the peace takes effect by itself at \d\d:\d\d( tomorrow| on \w+)\./.test(await box(B, ua)), 20000), await box(B, ua));
check('and B can still accept it', await B.evaluate(id => { const x = G.allNations().find(y => y.id === id); return /data-act="peace"/.test(G.HID().warControls(x)); }, ua));
const pin = (await bell(B)).pin.find(t => /Halcyra has offered peace/.test(t)) || '';
check('the bell pin gives the hour and the date', /Unless you answer first, it takes effect by itself at \d\d:\d\d on \d+ \w+ \d{4}\./.test(pin), pin);
check('A sees its offer will take effect by itself', /the war ends when Durnholt accepts, or by itself at \d\d:\d\d( tomorrow| on \w+) if Durnholt has not answered by then/.test(await box(A, ub)), await box(A, ub));

/* move the clock: in a page, A's war and offer as if made `ago` hours back, and both nations founded before them (a war
   older than a nation does not count); held only while it reads the page, then both records are put back */
const at = (p, ago) => p.evaluate(([ua, ub, ago, H]) => {
  const now = Date.now(), me = G.S.uid, keepN = G.S.nation, keepW = { ...G.S.world }, old = r => ({ ...r, founded: now - (ago + 10) * H });
  const war = r => ({ ...old(r), wars: { ...(r.wars || {}), [ub]: { t: now - (ago + 1) * H } }, peace: { ...(r.peace || {}), [ub]: now - ago * H } });
  for (const id of [ua, ub]) { const f = id === ua ? war : old; if (id === me) G.S.nation = f(G.S.nation); else G.S.world[id] = f(G.S.world[id]); }
  const offer = now - ago * H, other = me === ua ? ub : ua, x = G.allNations().find(y => y.id === other);
  const box = G.HID().warControls(x).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), { pin, ev } = G.NEWS.bell();
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  G.S.nation = keepN; G.S.world = Object.assign(G.S.world, keepW);
  return { box, pin: pin.map(x => x.txt), ev: ev.map(x => x.txt), truceAt: hm(offer + 102 * H), endsAt: hm(offer + 30 * H) };
}, [ua, ub, ago, H]);

/* 29 hours on: the offer still stands */
let s29 = await at(B, 29);
check('29 hours on, still at war, and it takes effect within the hour', /At war since/.test(s29.box) && s29.box.includes(`takes effect by itself at ${s29.endsAt}`), s29.box);
/* 31 hours on, nobody has answered */
const sb = await at(B, 31), sa = await at(A, 31);
check('31 hours on, for B the war is over and a truce holds until 72 hours after the peace', !/At war/.test(sb.box) && sb.box.includes(`A truce holds until ${sb.truceAt}`), sb.box + ' / ' + sb.truceAt);
check('and for A too', !/At war/.test(sa.box) && sa.box.includes(`A truce holds until ${sa.truceAt}`), sa.box);
const evB = sb.ev.find(t => /did not answer/.test(t)) || '';
check('B’s bell says the unanswered offer took effect, and for how long war is off', evB === 'You did not answer Halcyra’s peace offer within 30 hours, so the peace took effect. Neither of you may declare war again for 72 hours.', evB);
const evA = sa.ev.find(t => /did not answer/.test(t)) || '';
check('A’s bell says the same from its side', evA === 'Durnholt did not answer your peace offer within 30 hours, so the peace took effect. Neither of you may declare war again for 72 hours.', evA);
check('no pin for an offer that has already taken effect', !sb.pin.some(t => /offered peace/.test(t)), sb.pin.join(' | '));
/* the truce: 30 + 72 hours after the offer it ends */
const s101 = await at(B, 101), s103 = await at(B, 103);
check('101 hours on, the truce still holds', /A truce holds until/.test(s101.box), s101.box);
check('103 hours on, it is over', !/truce|At war/i.test(s103.box), s103.box);
check('the pages are put back as they were', await B.evaluate(id => !!G.S.world[id] && G.S.nation.founded > Date.now() - 3600000, ua));

await B.screenshot({ path: OUT + '/peace-timeout-b.png' }).catch(() => {});
check('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
await finish();
