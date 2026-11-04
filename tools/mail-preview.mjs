// Renders every letter (functions/mail-core.js) with sample data into one page, to look at and refine.
//   node tools/mail-preview.mjs [out.html]     (default: mail-preview.html in the current folder; not committed)
import { writeFileSync } from 'node:fs';
import { verifyLetter, welcomeLetter, digestLetter, newsLetter, awayLetter } from '../functions/mail-core.js';

const cfg = { site: 'https://edictumgame.com' }, to = 'player@example.com', tok = 'sample-key';
const letters = [
  ['Confirmation seal', verifyLetter(cfg, { to, code: '428193', nation: 'Eternia' })],
  ['Welcome', welcomeLetter(cfg, { to, nation: 'Eternia', tok })],
  ['Digest (urgent)', digestLetter(cfg, { to, nation: 'Eternia', tok, pings: [{ k: 'war', nm: 'Ravenmark', t: 1 }, { k: 'msg', nm: 'Ravenmark', t: 2 }, { k: 'msg', nm: 'Ravenmark', t: 3 }, { k: 'trade', nm: 'Quietvale', t: 4 }, { k: 'aladmit', nm: 'Orlon', t: 5 }] })],
  ['Digest (calm)', digestLetter(cfg, { to, nation: 'Eternia', tok, pings: [{ k: 'msg', nm: 'Quietvale', t: 1 }, { k: 'shared', nm: 'Orlon', t: 2 }] })],
  ['Development news', newsLetter(cfg, { to, tok, posts: [{ ti: 'Letters by post have arrived', ex: 'Give the Herald your address in Settings and hear about wars, letters and news while you are away.' }, { ti: 'Seven new buildings', ex: 'Lighthouses, observatories and a Central Bank join the Ministry of Works.' }] })],
  ['Away reminder', awayLetter(cfg, { to, nation: 'Eternia', days: 4, tok })]
];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Edictum letters</title>
<style>body{margin:0;padding:16px;background:#555;font:14px system-ui,sans-serif;color:#eee}h2{margin:28px 0 6px;font-size:16px}
.s{margin:0 0 8px;color:#ccc}iframe{display:block;width:100%;max-width:640px;height:900px;border:0;background:#fff;border-radius:4px}</style></head><body>
<h1>Edictum letters: ${letters.length} kinds</h1>
${letters.map(([n, l], i) => `<h2>${i + 1}. ${esc(n)}</h2><p class="s">Subject: <b>${esc(l.subject)}</b></p><iframe srcdoc="${esc(l.html)}" title="${esc(n)}"></iframe>`).join('\n')}
</body></html>`;
const out = process.argv[2] || 'mail-preview.html';
writeFileSync(out, page);
console.log('wrote ' + out);
