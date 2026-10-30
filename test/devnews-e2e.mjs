// Development news: an admin writes a post with formatting and an image, players see a count in the menu, read
// it and comment; moderators and admins remove comments, admins close comments and handle a report.
import { OUT, player, open, ready, found, register, until, check, finish, setClaims, text, restGet, restListAdmin, clearEmulators, sleep } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('player'), C = await player('guest'), M = await player('moderator');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Playerland');
await open(C); await found(C, 'Guestland');
const uidM = await open(M); await found(M, 'Modland');
await register(A); await register(B); await register(M);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
await setClaims(uidM, { mod: true }); await M.reload(); await ready(M);
const badge = p => p.evaluate(() => document.querySelector('.nav [data-v="devnews"] .badge')?.textContent || '');
const go = (p, v) => p.evaluate(v => document.querySelector(`.nav [data-v="${v}"]`).click(), v);

// the menu: a group Other, above Options, holding the page
const groups = await B.$$eval('.side .nav-grp', g => g.map(x => x.dataset.g));
check('Development news sits in Other, the group just above Options', groups.indexOf('other') >= 0 && groups.indexOf('other') === groups.indexOf('opts') - 1
  && await text(B, '.side .nav-grp[data-g="other"] .nav-gl') === 'Other' && /Development news/.test(await text(B, '.side .nav-grp[data-g="other"] .nav-g')));
await go(B, 'devnews');
check('with nothing published the page says so', await until(async () => /No news yet/.test(await text(B, '.main'))));
await go(B, 'nation');

// the sanitiser keeps formatting and drops everything that could run or track
const clean = await A.evaluate(() => G.NEWS.nwClean('<div onclick="x()"><h1 style="color:red">Title</h1><p>ok <b>bold</b> <i>it</i> <span>plain</span></p></div><script>alert(1)</script><img src="https://evil.example/t.gif"><img data-img="abc"><img data-img="AbCdEfGhIjKlMnOpQrSt" src="x" onerror="alert(1)" alt="A map"><a href="javascript:alert(1)">bad</a> <a href="https://edictumgame.com" onmouseover="x">good</a><iframe src="https://x"></iframe><style>*{}</style><ul><li>one</li></ul>'));
check('the sanitiser keeps headings, emphasis, lists, uploaded images and web links only',
  clean === '<h2>Title</h2><p>ok <strong>bold</strong> <em>it</em> plain</p><img data-img="AbCdEfGhIjKlMnOpQrSt" alt="A map">bad <a href="https://edictumgame.com" target="_blank" rel="noopener noreferrer">good</a><ul><li>one</li></ul>', clean);

// the admin writes a post in the portal
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.click('.adm-nav [data-v="admin-news"]');
check('the portal lists Development news under Game content', /Development news/.test(await text(A, '.adm-nav-group[aria-label="Game content"]')));
await A.waitForSelector('[data-act="nwe-new"]'); await A.click('[data-act="nwe-new"]');
await A.waitForSelector('#nwe-body');
check('a post is signed Pascal, Founder & Developer, by default', await A.$eval('.nwe-opt input[value="staff"]', i => i.checked) && /Pascal \(Founder & Developer\)/.test(await text(A, '.nwe-opt')));
check('or by the admin’s own nation', /Adminland/.test(await text(A, '.nwe-as')));
await A.fill('#nwe-ti', 'The first development news');
await A.click('#nwe-body'); await A.keyboard.type('Hello players. ');
await A.click('.nwe-b[data-nwc="bold"]'); await A.keyboard.type('Bold news'); await A.click('.nwe-b[data-nwc="bold"]');
await A.keyboard.press('Enter'); await A.click('.nwe-b[data-nwc="h2"]'); await A.keyboard.type('Next up');
await A.keyboard.press('Enter'); await A.click('.nwe-b[data-nwc="insertUnorderedList"]'); await A.keyboard.type('Trade routes'); await A.keyboard.press('Enter'); await A.keyboard.type('Elections');
await A.keyboard.press('Enter'); await A.keyboard.press('Enter');   // out of the list: the images go where the caret is
const png = (w, h, noise) => A.evaluate(([w, h, noise]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#0F6E67'; g.fillRect(0, 0, w, h);
  if (noise) { const d = g.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i++) d.data[i] = Math.random() * 255 | 0; g.putImageData(d, 0, 0); }
  g.fillStyle = '#fff'; g.font = '90px serif'; g.fillText('Edictum', 60, 160); return c.toDataURL('image/png').split(',')[1]; }, [w, h, noise]);
await A.setInputFiles('#nwe-file', [{ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(await png(900, 500, false), 'base64') },
  { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.from(await png(3200, 2400, true), 'base64') }]);
check('two images upload into the text', await until(async () => (await A.$$('#nwe-body img[data-img][src^="blob:"]')).length === 2 && !await A.evaluate(() => G.NEWS.NWE.up), 30000));
await A.click('[data-act="nwe-prev"]');
check('the preview shows the post as players will see it', /The first development news/.test(await text(A, '.nwe-prev')) && /Bold news/.test(await text(A, '.nwe-prev')));
await A.screenshot({ path: OUT + '/devnews-editor.png', fullPage: true });
await A.click('[data-act="nwe-pub"]');
check('publishing says players will see it', await until(async () => /is published/.test(await text(A, '.nwe-msg'))));
const pid = await A.evaluate(() => G.NEWS.NWE.id);
const doc = await restGet('devnews/' + pid), f = doc.body.fields || {};
check('anyone reads the published post, with its formatting and nothing else', doc.status === 200 && /<strong>Bold news<\/strong>/.test(f.h?.stringValue) && /<h2>Next up<\/h2>/.test(f.h.stringValue)
  && /<ul><li>Trade routes<\/li><li>Elections<\/li><\/ul>(<p>)?<img data-img="\w{20}" alt="">/.test(f.h.stringValue) && !/src=|class=/.test(f.h.stringValue) && f.nm?.stringValue === 'Pascal' && f.rl?.stringValue === 'Founder & Developer', f.h?.stringValue);
const imgs = (f.im?.arrayValue?.values || []).map(v => v.stringValue), big = imgs.length === 2 ? await restGet('devnewsImg/' + imgs[1]) : null;
check('a large image is made smaller before it uploads', big?.status === 200 && Number(big.body.fields.w.integerValue) <= 1600 && big.body.fields.d.stringValue.length <= 960000, big && big.body.fields?.w?.integerValue);

// players see the count, then the post
check('a player’s menu counts the new post', await until(async () => await badge(B) === '1', 15000));
check('the guest’s too', await until(async () => await badge(C) === '1', 15000));
await go(B, 'devnews');
check('opening the page clears the count', await until(async () => await badge(B) === ''));
check('the post shows its title, byline and staff mark', await until(async () => /The first development news/.test(await text(B, '.nw-post .nw-ti')) && /Pascal/.test(await text(B, '.nw-by')) && /Founder & Developer/.test(await text(B, '.nw-by')) && /Edictum staff/.test(await text(B, '.nw-by'))));
check('its images load from the database', await until(async () => (await B.$$('.nw-post .nw-body img[src^="blob:"]')).length === 2, 15000));
check('a post newer than the last visit is marked New', /New/.test(await text(B, '.nw-date')));
check('players see no staff controls', !await B.$('.nw-ctl') && !await B.$('[data-act="nw-c-rm"]'));

// comments
await B.waitForSelector('#nw-ct-' + pid);
await B.fill('#nw-ct-' + pid, 'Looking forward to the elections!\nAnd the trade routes.');
await B.click(`#nw-cf-${pid} button[type="submit"]`);
check('a registered player comments as their nation', await until(async () => /Playerland/.test(await text(B, '.nw-cl')) && /Looking forward to the elections!/.test(await text(B, '.nw-cl')), 15000));
check('the comment keeps its line break', await B.$eval('.nw-c .post-x', el => el.textContent.includes('\n')));
await go(C, 'devnews');
check('a guest reads the comments but is asked to link a sign-in to comment', await until(async () => /Playerland/.test(await text(C, '.nw-cl')) && /Commenting on the development news requires a Registered Nation/.test(await text(C, '.nw-cm'))));
await B.reload(); await ready(B);
check('the count stays cleared after a reload (the nation remembers)', await until(async () => !!await B.$('.nav [data-v="devnews"]')) && (await sleep(2500), await badge(B) === ''));

// staff on the page
await A.click('.adm-return'); await go(A, 'devnews');
check('admins see the post’s staff controls', await until(async () => /Edit/.test(await text(A, '.nw-ctl')) && /Close comments/.test(await text(A, '.nw-ctl')) && /Delete post/.test(await text(A, '.nw-ctl'))));
check('and Remove, Hide nation and Ban on a player’s comment', await until(async () => !!await A.$('[data-act="nw-c-rm"]') && !!await A.$('[data-act="nw-c-hide"]') && !!await A.$('[data-act="nw-c-ban"]')));
await A.fill('#nw-ct-' + pid, 'Thank you all for playing.');
await A.click(`#nw-cf-${pid} button[type="submit"]`);
check('an admin’s comment carries the staff mark', await until(async () => /Edictum staff/.test(await text(B, '.nw-c.staff')), 15000));
await go(M, 'devnews');
check('a moderator sees Remove on comments, and no post controls or bans', await until(async () => !!await M.$('[data-act="nw-c-rm"]')) && !await M.$('.nw-ctl') && !await M.$('[data-act="nw-c-ban"]'));
const bobsComment = await M.$eval('.nw-c:not(.staff) [data-act="nw-c-rm"]', b => b.dataset.id);
await M.click(`[data-act="nw-c-rm"][data-id="${bobsComment}"]`); await M.click(`[data-act="nw-c-rm-yes"][data-id="${bobsComment}"]`);
check('a moderator removes a comment, for everyone', await until(async () => !/Looking forward/.test(await text(B, '.nw-cl')), 15000));
const audit = await restListAdmin('adminAudit');
check('the audit log keeps what the removed comment said', audit.some(d => d.fields?.action?.stringValue === 'news_comment_remove' && /Looking forward/.test(d.fields?.x?.stringValue || '')));

// a report goes to the admin's queue, which removes the comment
await sleep(21000); // one post every 20 seconds
await B.fill('#nw-ct-' + pid, 'Buy cheap gold at spam.example');
await B.click(`#nw-cf-${pid} button[type="submit"]`);
await until(async () => /spam\.example/.test(await text(A, '.nw-cl')), 15000);
const spam = await A.$$eval('.nw-c', li => li.find(x => /spam\.example/.test(x.textContent))?.id.slice(4));
await C.waitForSelector(`[data-act="nw-c-rep"][data-id="${spam}"]`); await C.click(`[data-act="nw-c-rep"][data-id="${spam}"]`);
await C.waitForSelector('dialog.ed-dlg[open] input[value="spam"]'); await C.check('dialog.ed-dlg[open] input[value="spam"]');
await C.click('dialog.ed-dlg[open] [data-ed="report-yes"]');
await until(async () => /with the moderators/.test(await text(C, 'body')), 8000);
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-reports"]');
check('the report arrives in the queue as a news comment', await until(async () => /News comment/.test(await text(A, '.adm-reps')) && /Playerland/.test(await text(A, '.adm-reps')), 15000));
await A.click('[data-act="adm-delpost"]');
check('removing it from the queue deletes the comment', await until(async () => !/spam\.example/.test(await text(B, '.nw-cl')), 15000));

// closing comments, and a post signed by a nation
await A.click('.adm-return'); await go(A, 'devnews');
await A.waitForSelector(`[data-act="nw-lock"][data-id="${pid}"]`); await A.click(`[data-act="nw-lock"][data-id="${pid}"]`);
await B.reload(); await ready(B); await go(B, 'devnews');
check('closed comments refuse new ones', await until(async () => /Comments are closed on this post/.test(await text(B, '.nw-cm'))) && !await B.$('#nw-ct-' + pid));
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-news"]'); await A.waitForSelector('[data-act="nwe-new"]'); await A.click('[data-act="nwe-new"]');
await A.fill('#nwe-ti', 'A word from Adminland'); await A.check('.nwe-opt input[value="nation"]');
await A.click('#nwe-body'); await A.keyboard.type('Greetings from a fellow nation.');
await A.click('[data-act="nwe-draft"]');
check('a draft is saved for admins only', await until(async () => /draft is saved/.test(await text(A, '.nwe-msg'))) && (await restGet('devnews/' + await A.evaluate(() => G.NEWS.NWE.id))).status !== 200);
await go(C, 'nation'); await sleep(2000);
check('a draft adds nothing to the count', await badge(C) === '');
await A.click('[data-act="nwe-pub"]');
check('publishing it counts one new post for a player who read the first', await until(async () => await badge(C) === '1', 15000));
await go(B, 'nation'); await go(B, 'devnews');
check('the nation’s post shows its flag and name', await until(async () => /Adminland/.test(await text(B, '.nw-post:first-child .nw-by')) && !!await B.$('.nw-post:first-child .nw-by .nw-fl svg')));
await B.screenshot({ path: OUT + '/devnews-page.png', fullPage: true });
const phone = await player('phone', { vp: { width: 390, height: 844 } });
await open(phone); await found(phone, 'Phoneland');
await phone.click('#tab-more'); await phone.click('#more-sheet [data-v="devnews"]');
check('on a phone the page fits the screen', await until(async () => !!await phone.$('.nw-post')) && await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await phone.screenshot({ path: OUT + '/devnews-phone.png', fullPage: true });
await finish();
