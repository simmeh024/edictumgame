// The owner's one-off Cloudspine story. The normal Assembly tally decides the outcome.
export const DH_ASM_EVENT = 'dhaluun-condemnation-v1';
export const DH_ASM_REG = 'cloudspine';
export const DH_ASM_BY = 'npc-cloudspine-saaveri';
export const DH_ASM_TARGET = 'npc-cloudspine-dhaluun';
export const DH_ASM_TITLE = 'Condemnation of Dhaluun: On the Weaponisation of Customs';
export const DH_ASM_TEXT = `The World Assembly,

Noting Dhaluun’s failed espionage campaign against its neighbours;

Observing the subsequent construction of an immense border wall without a credible explanation;

Condemning the deliberate disruption of trade belonging to signatories of the Western Dhaluun Free Trade Agreement;

Rejecting the suggestion that the word “Free” constitutes reasonable grounds for economic sabotage;

Affirming that the elevation of a throne confers no jurisdiction over another nation’s commerce;

Hereby condemns Dhaluun and calls for the immediate restoration of trade, an explanation of its military preparations, and assurances against further interference.

The Assembly further requests that future customs notices contain an actual customs policy.`;
export const DH_ASM_ANNOUNCEMENT = 'We have traded peacefully for generations. Yesterday, an emperor discovered quotation marks and halved our commerce. We therefore bring this matter before the Assembly.';
export const DH_ASM_REPLY = 'His Imperial Loftiness acknowledges the Assembly’s concern. The wall shall be raised accordingly.';
const DAY = 864e5, EPOCH = Date.UTC(2026, 0, 5);
export const dhAsmT0 = c => EPOCH + c * 3 * DAY;
export function dhaluunMotion(c, now) {
  if (!Number.isSafeInteger(c) || c < 0) throw new Error('Invalid Assembly cycle.');
  return { c, k: DH_ASM_EVENT, ti: DH_ASM_TITLE, tx: DH_ASM_TEXT, cat: 'condemn', g: 0,
    by: DH_ASM_BY, bn: 'Saaveri', w: 'n', lt: now, tg: DH_ASM_TARGET, tn: 'Dhaluun', dt: 'AsmDebate' + String(c).padStart(11, '0') };
}
// Called only while the protected cycle is being finalised, in its voting transaction.
// No change to the wall's geometry or defence is implied by Dhaluun's boast.
export function dhaluunClosingReply(L, now) {
  return L && L.k === DH_ASM_EVENT && L.by === DH_ASM_BY && L.tg === DH_ASM_TARGET &&
    L.cat === 'condemn' && L.r === DH_ASM_REG && Number.isSafeInteger(L.c) && L.c >= 0 && L.dt === 'AsmDebate' + String(L.c).padStart(11, '0') &&
    L.f >= dhAsmT0(L.c + 1) && now >= L.f && now >= dhAsmT0(L.c + 1) ? DH_ASM_REPLY : '';
}
