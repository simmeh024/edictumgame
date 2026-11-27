// The cabinet modifiers used by the game's minFx(), calculated from saved ministers, not a claimed vote weight.
export function cabinetAffinity(n) {
  let bonus = 0;
  for (const pf of ['fin','def','for','int','wrk','hea','cul']) {
    const m = n.cab?.[pf]; if (!m || !Array.isArray(m.tr)) continue;
    const tr = [...new Set(m.tr)].slice(0,2), skill = Number.isFinite(m.sk) ? Math.max(1,Math.min(5,m.sk)) : 3;
    let multiplier = tr.includes('genius') ? 2 : tr.includes('workaholic') ? 1.5 : 1;
    if (m.lo < 20) multiplier *= 0.5;
    if (pf === 'for') bonus += 2 * (skill-3) * multiplier;
    for (const t of tr) bonus += t === 'dove' ? 3 : t === 'hawk' ? -3 : t === 'gaffe' ? -2 : 0;
  }
  // A sacked official posted abroad as an ambassador (sacking edicts, n.skd): +3 for 14 days, or -3 if gaffe-prone.
  const amb = Array.isArray(n.skd) ? n.skd.find(e => e && e.f === 'ambassador' && !e.x && Number.isFinite(e.t) && Date.now() - e.t < 14 * 864e5) : null;
  if (amb) bonus += Array.isArray(amb.tr) && amb.tr.includes('gaffe') ? -3 : 3;
  // The Royal Palace is the sole affinity building; unfinished and dormant palaces do not contribute.
  if (/\b(king|queen|empire|imperial|crown|royal|realm|duchy|principality|sultanate|tsardom|emirate|monarchy|khanate|shogunate)/i.test(String(n.pretitle||'')) &&
    Array.isArray(n.cities) && n.cities.some(c=>Array.isArray(c.b)&&c.b.some(b=>b.k==='palace'&&Number.isFinite(b.d)&&b.d<=Date.now()))) bonus += 8;
  return bonus;
}
