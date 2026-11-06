// Staff alerts: every fifteen minutes the alerts job (jobs/stats/alerts.mjs, .github/workflows/alerts.yml) looks for
// what the team should know about and files each finding once as adminAlerts/<id> {t, k, lvl, ti, x, uid?, reg?, seen}.
// The admin portal's Watchlist & alerts page lists them (functions/admin.js, op 'alerts'), and the job also posts the
// new ones to a staff Discord channel when the repository has a STAFF_ALERT_WEBHOOK secret.
//
// What it looks for, with thresholds the page can change (adminCfg/alerts, ALERT_DEFAULTS):
//   reports  a player reported `reports` times or more in 24 hours
//   pop      a nation whose population grew by `popPct` per cent and `popMin` million or more in a day, from the
//            history points its own record keeps (recordHistory in the game takes one every few hours)
//   errors   `errors` players or more, and `errPct` per cent of those playing, whose game reported a save error in the
//            last hour (saveHealth)
//   spike    `spike` times the week's hourly average of nations founded in the last hour, and `spikeMin` or more
//   buys     every purchase (when on)
//   watch    a watched player (watch/<uid>) back after an hour away, renamed, moved, reported or gone (when on)
// The id of each finding says what it is and when, so a finding is filed once however often the job runs.
export const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const ALERT_DEFAULTS = { reports: 3, popPct: 50, popMin: 1, errors: 5, errPct: 20, spike: 3, spikeMin: 5, buys: true, watch: true, discord: true };
export const ALERT_LIMITS = { reports: [1, 100], popPct: [5, 100000], popMin: [0, 1e6], errors: [1, 10000], errPct: [1, 100], spike: [1.5, 100], spikeMin: [1, 100000] };
export const ALERT_KEEP = 30 * DAY;
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
const txt = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const hourKey = t => new Date(t).toISOString().slice(0, 13);
const pc = v => Math.round(v) + '%';
const mil = v => (Math.round(v * 100) / 100).toLocaleString('en-GB') + ' million';
const who = (name, uid) => name || 'Player ' + String(uid || '').slice(0, 8);

/* the thresholds as stored, each kept within its limits; anything missing or odd is the default */
export function alertConfig(raw) {
  const c = { ...ALERT_DEFAULTS }, r = raw && typeof raw === 'object' ? raw : {};
  for (const [k, [lo, hi]] of Object.entries(ALERT_LIMITS)) if (typeof r[k] === 'number' && Number.isFinite(r[k])) c[k] = Math.min(hi, Math.max(lo, r[k]));
  for (const k of ['buys', 'watch', 'discord']) if (typeof r[k] === 'boolean') c[k] = r[k];
  return c;
}

/* reports: [{id, target, name, reason, t}] */
export function reportAlerts(reports, cfg, now) {
  const by = new Map();
  for (const r of reports) if (r.target && ms(r.t) > now - DAY) (by.get(r.target) || by.set(r.target, []).get(r.target)).push(r);
  const out = [];
  for (const [uid, L] of by) {
    if (L.length < cfg.reports) continue;
    const why = {}; for (const r of L) why[r.reason || 'other'] = (why[r.reason || 'other'] || 0) + 1;
    out.push({ id: `rep~${uid}~${dayKey(now)}`, k: 'reports', lvl: 'warn', uid, ti: `${who(L.find(r => r.name)?.name, uid)} was reported ${L.length} times in 24 hours`,
      x: Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') });
  }
  return out;
}
/* the history point nearest a day ago, between 18 and 30 hours old */
export function dayAgo(hist, now) {
  let best = null;
  for (const h of Array.isArray(hist) ? hist : []) {
    const t = num(h?.t); if (t < now - 30 * HOUR || t > now - 18 * HOUR || !(num(h.p) > 0)) continue;
    if (!best || Math.abs(t - (now - DAY)) < Math.abs(best.t - (now - DAY))) best = { t, p: num(h.p) };
  }
  return best;
}
/* nations: [{id, name, reg, pop, hist}] */
export function popAlerts(nations, cfg, now) {
  const out = [];
  for (const n of nations) {
    const b = dayAgo(n.hist, now), pop = num(n.pop);
    if (!b) continue;
    const grew = pop - b.p, pct = grew / b.p * 100;
    if (grew >= cfg.popMin && pct >= cfg.popPct)
      out.push({ id: `pop~${n.id}~${dayKey(now)}`, k: 'pop', lvl: 'warn', uid: n.id, reg: n.reg || '', ti: `${who(n.name, n.id)} grew ${pc(pct)} in a day`, x: `From ${mil(b.p)} to ${mil(pop)}.` });
  }
  return out;
}
/* sessions: the save health reports of the last hour [{uid, status, error}] */
export function errorAlerts(sessions, cfg, now) {
  const all = new Set(), bad = new Set(), kinds = {};
  for (const s of sessions) {
    if (!s.uid) continue; all.add(s.uid);
    if (s.status === 'offline' || s.error) { bad.add(s.uid); const k = txt(s.error, 40) || 'offline'; kinds[k] = (kinds[k] || 0) + 1; }
  }
  if (bad.size < cfg.errors || bad.size / Math.max(1, all.size) * 100 < cfg.errPct) return [];
  return [{ id: `err~${hourKey(now)}`, k: 'errors', lvl: 'alert', ti: `${bad.size} of ${all.size} players had a save error in the last hour`,
    x: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ') }];
}
/* hour: nations founded in the last hour; week: in the last seven days */
export function spikeAlerts({ hour, week }, cfg, now) {
  const avg = week / (7 * 24);
  if (hour < cfg.spikeMin || hour < cfg.spike * Math.max(avg, 0.5)) return [];
  return [{ id: `spike~${hourKey(now)}`, k: 'spike', lvl: 'info', ti: `${hour} nations founded in the last hour`, x: `About ${Math.round(avg * 10) / 10} an hour this week.` }];
}
/* purchases since the last run: [{id, uid, payer, product, gift, name}] */
export function buyAlerts(txs, cfg) {
  if (!cfg.buys) return [];
  return txs.map(x => ({ id: `buy~${x.id}`, k: 'buy', lvl: 'info', uid: x.uid, ti: `${who(x.name, x.uid)} ${x.gift ? 'was given' : 'bought'} ${x.product || 'something'}`,
    x: x.gift && x.payer ? `A gift from ${who(x.payerName, x.payer)}.` : '' }));
}
/* Watched players. watched: [{uid, why}]; now: {uid: {name, reg, t} | null} from their summaries; before: the same as
   the last run saw it (alertState/run.w); reports: the reports since the last run. Returns the findings and what to
   remember for next time. */
export function watchAlerts(watched, cur, before, reports, cfg, now) {
  const out = [], seen = {};
  for (const w of watched) {
    const c = cur[w.uid] || null, b = before[w.uid] || null, name = who(c?.name || b?.name, w.uid), reason = w.why ? `Watched: ${txt(w.why, 120)}` : '';
    seen[w.uid] = c ? { t: num(c.t), name: c.name || '', reg: c.reg || '' } : null;
    if (!cfg.watch) continue;
    if (!c && b) { out.push({ id: `wgone~${w.uid}~${dayKey(now)}`, k: 'watch', lvl: 'warn', uid: w.uid, ti: `${name} no longer has a nation`, x: reason }); continue; }
    if (!c || !b) continue;
    if (num(c.t) > num(b.t) && num(b.t) < now - HOUR && num(c.t) > now - 2 * HOUR) out.push({ id: `won~${w.uid}~${hourKey(now)}`, k: 'watch', lvl: 'info', uid: w.uid, reg: c.reg, ti: `${name} is playing again`, x: reason });
    if (c.name && b.name && c.name !== b.name) out.push({ id: `wnm~${w.uid}~${num(c.t)}`, k: 'watch', lvl: 'warn', uid: w.uid, reg: c.reg, ti: `${who(b.name, w.uid)} renamed itself ${c.name}`, x: reason });
    if (c.reg && b.reg && c.reg !== b.reg) out.push({ id: `wrg~${w.uid}~${num(c.t)}`, k: 'watch', lvl: 'info', uid: w.uid, reg: c.reg, ti: `${name} moved to another region`, x: reason });
  }
  if (cfg.watch) {
    const ids = new Set(watched.map(w => w.uid));
    for (const r of reports) if (ids.has(r.target)) out.push({ id: `wrep~${r.id}`, k: 'watch', lvl: 'warn', uid: r.target, ti: `${who(cur[r.target]?.name || r.name, r.target)} was reported (${r.reason || 'other'})`, x: txt(r.note, 200) });
  }
  return { alerts: out, seen };
}

/* the text of a Discord message for the new alerts (Discord takes 2000 characters at most) */
const ICON = { alert: '🚨', warn: '⚠️', info: 'ℹ️' };
export function discordText(alerts, site) {
  const lines = [], more = n => `…and ${n} more.`;
  for (const a of alerts) {
    const line = `${ICON[a.lvl] || '•'} **${a.ti.replace(/[*_~`|>]/g, '')}**${a.x ? ' — ' + a.x.replace(/[*_~`|>]/g, '') : ''}`;
    if (lines.join('\n').length + line.length > 1800) { lines.push(more(alerts.length - lines.length)); break; }
    lines.push(line);
  }
  return `${lines.join('\n')}\n<${site.replace(/\/$/, '')}/#admin-watch>`;
}

/* One run: read what the checks need, file what is new, post it, remember the run. */
export async function runAlerts(db, { now = Date.now(), webhook = '', site = 'https://edictumgame.com', fetchImpl = globalThis.fetch, Timestamp } = {}) {
  const [cfgS, stS] = await Promise.all([db.doc('adminCfg/alerts').get(), db.doc('alertState/run').get()]);
  const cfg = alertConfig(cfgS.exists ? cfgS.data() : null), st = stS.exists ? stS.data() : {};
  const since = Math.max(now - 2 * HOUR, num(st.at) ? num(st.at) - 2 * MIN : now - 20 * MIN);
  const count = q => q.count().get().then(s => s.data().count, () => 0);
  const [reps, changed, health, hour, week, txs, paddle, watch] = await Promise.all([
    db.collection('reports').orderBy('t', 'desc').limit(300).get(),
    db.collection('summaries').where('t', '>', since).limit(1000).select('name').get(),
    db.collection('saveHealth').where('t', '>', Timestamp.fromMillis(now - HOUR)).select('uid', 'status', 'error').get(),
    count(db.collection('summaries').where('f', '>', now - HOUR)),
    count(db.collection('summaries').where('f', '>', now - 7 * DAY)),
    db.collection('shopTx').orderBy('paid', 'desc').limit(50).get(),
    db.doc('authConfig/paddle').get(),
    db.collection('watch').limit(500).get(),
  ]);
  const reports = reps.docs.map(d => ({ id: d.id, target: String(d.get('target') || ''), name: txt(d.get('name'), 60), reason: txt(d.get('reason'), 20), note: d.get('note') || '', t: ms(d.get('t')) }));
  /* the nations saved since the last run, with their history (the shared half keeps it) */
  const nations = [];
  for (let i = 0; i < changed.docs.length; i += 300) {
    const docs = await db.getAll(...changed.docs.slice(i, i + 300).map(d => db.doc('nations/' + d.id)));
    for (const d of docs) {
      if (!d.exists) continue;
      let r = null; try { r = typeof d.get('j') === 'string' ? JSON.parse(d.get('j')) : d.data(); } catch { r = null; }
      if (r) nations.push({ id: d.id, name: txt(d.get('name') || r.name, 60), reg: String(d.get('reg') || r.reg || ''), pop: num(d.get('pop')) || num(r.pop), hist: r.hist });
    }
  }
  const env = paddle.exists ? (paddle.get('env') === 'live' ? 'live' : paddle.get('env') || 'sandbox') : '';
  const fresh = txs.docs.filter(d => d.get('ok') === true && ms(d.get('paid')) > since && (!env || !d.get('env') || d.get('env') === env));
  const watched = watch.docs.map(d => ({ uid: d.id, why: d.get('why') || '' }));
  const sums = new Map();
  const want = [...new Set(fresh.flatMap(d => [d.get('uid'), d.get('payer')]).concat(watched.map(w => w.uid)).filter(u => typeof u === 'string' && u && !u.includes('/')))];
  for (let i = 0; i < want.length; i += 300)
    for (const d of await db.getAll(...want.slice(i, i + 300).map(u => db.doc('summaries/' + u)))) sums.set(d.id, d.exists ? d.data() : null);
  const cur = Object.fromEntries(watched.map(w => [w.uid, sums.get(w.uid) || null]));
  const w = watchAlerts(watched, cur, st.w || {}, reports.filter(r => r.t > since), cfg, now);
  const found = [
    ...reportAlerts(reports, cfg, now), ...popAlerts(nations, cfg, now),
    ...errorAlerts(health.docs.map(d => ({ uid: d.get('uid'), status: d.get('status'), error: d.get('error') })), cfg, now),
    ...spikeAlerts({ hour, week }, cfg, now),
    ...buyAlerts(fresh.map(d => ({ id: d.id, uid: d.get('uid'), payer: d.get('payer'), product: d.get('product'), gift: !!d.get('gift'),
      name: sums.get(d.get('uid'))?.name, payerName: sums.get(d.get('payer'))?.name })), cfg),
    ...w.alerts,
  ];
  /* file each once: create() refuses an id already filed */
  const filed = [];
  for (const a of found) {
    const doc = { t: now, k: a.k, lvl: a.lvl, ti: txt(a.ti, 200), x: txt(a.x, 400), seen: false, ...(a.uid ? { uid: a.uid } : {}), ...(a.reg ? { reg: a.reg } : {}) };
    try { await db.doc('adminAlerts/' + a.id.replace(/\//g, '_').slice(0, 300)).create(doc); filed.push(a); }
    catch (e) { if (e.code !== 6 && !/ALREADY_EXISTS/.test(String(e.message))) throw e; }
  }
  let discord = !webhook ? 'off' : !cfg.discord ? 'paused' : filed.length ? 'sent' : 'quiet';
  if (discord === 'sent') {
    try {
      const res = await fetchImpl(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: discordText(filed, site), allowed_mentions: { parse: [] } }) });
      if (!res.ok) discord = 'failed ' + res.status;
    } catch (e) { discord = 'failed'; }
  }
  /* alerts older than ALERT_KEEP go */
  const old = await db.collection('adminAlerts').where('t', '<', now - ALERT_KEEP).limit(400).get();
  if (old.size) { const b = db.batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  await db.doc('alertState/run').set({ at: now, w: w.seen, discord, filed: filed.length });
  const by = {}; for (const a of filed) by[a.k] = (by[a.k] || 0) + 1;
  return { at: now, since, checked: { reports: reports.length, nations: nations.length, sessions: health.size, foundedHour: hour, foundedWeek: week, purchases: fresh.length, watched: watched.length },
    filed: filed.length, by, discord, removed: old.size };
}
