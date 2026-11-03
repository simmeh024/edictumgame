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
check('an admin’s comment on their own post carries the developer mark', await until(async () => /Developer/.test(await text(B, '.nw-c.staff')), 15000));
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

// a pinned feature post with patch notes and a poll; the guest, on another page, gets a pop-up
await go(C, 'nation');
await A.click('[data-act="nwe-back"]'); await A.waitForSelector('[data-act="nwe-new"]'); await A.click('[data-act="nwe-new"]');
await A.fill('#nwe-ti', 'Patch 1.1: the poll'); await A.selectOption('#nwe-tg', 'feature'); await A.check('#nwe-pn');
await A.click('#nwe-body'); await A.keyboard.type('What changed. ');
await A.click('.nwe-b[data-nwc="patch"]');
await A.click('.nwe-poll summary'); await A.fill('#nwe-pq', 'Which region next?'); await A.fill('#nwe-po', 'Terra\nThe North\nThe Isles');
await A.click('[data-act="nwe-pub"]');
check('the pinned post with a poll publishes', await until(async () => /is published/.test(await text(A, '.nwe-msg'))));
const pid2 = await A.evaluate(() => G.NEWS.NWE.id), d2 = (await restGet('devnews/' + pid2)).body.fields || {};
check('the post keeps its kind, pin, poll and patch notes', d2.tg?.stringValue === 'feature' && d2.pn?.booleanValue === true && d2.pl?.mapValue?.fields?.o?.arrayValue?.values?.length === 3 && /<ul data-pn="add">/.test(d2.h?.stringValue || ''), d2.h?.stringValue);
check('a player elsewhere in the game gets a pop-up for it', await until(async () => /New development news: “Patch 1\.1: the poll”/.test(await text(C, '#toast')), 15000));
await go(C, 'settings'); await C.click('[data-act="ntf"][data-f="nwc"][data-v="0"]');
const G_unread = await C.evaluate(() => G.NEWS.nwUnread());
check('with the count turned off the menu shows none', await until(async () => await badge(C) === '') && G_unread > 0);
await C.click('[data-act="ntf"][data-f="nwc"][data-v="1"]');
check('turned back on, the count returns', await until(async () => Number(await badge(C)) === G_unread), G_unread);
const arc = (await restGet('devnewsMeta/archive')).body.fields?.p?.arrayValue?.values || [];
check('the archive lists every published post', arc.length === 3, arc.length);
await go(B, 'nation'); await go(B, 'devnews');
check('the pinned post leads the page with its kind', await until(async () => /Pinned/.test(await text(B, '.nw-post:first-child .nw-date')) && /New feature/.test(await text(B, '.nw-post:first-child .nw-date')) && /min read/.test(await text(B, '.nw-post:first-child .nw-date'))));
check('its patch notes show as Added, Changed and Fixed', (await B.$$('.nw-post:first-child .nw-body ul[data-pn]')).length === 3 && /Added/.test(await text(B, '.nw-post:first-child .nw-body')));

// reactions
await B.click(`[data-act="nw-rx"][data-id="${pid2}"][data-v="up"]`);
check('a reaction counts at once and on the server', await until(async () => /1/.test(await text(B, `[data-act="nw-rx"][data-id="${pid2}"][data-v="up"]`)) && (await restGet('devnewsStat/' + pid2)).body.fields?.r?.mapValue?.fields?.up?.integerValue === '1', 15000));
await B.click(`[data-act="nw-rx"][data-id="${pid2}"][data-v="party"]`);
check('choosing another reaction moves it', await until(async () => { const r = (await restGet('devnewsStat/' + pid2)).body.fields?.r?.mapValue?.fields || {}; return r.up?.integerValue === '0' && r.party?.integerValue === '1'; }, 15000));
const meDoc = await restGet('devnews/' + pid2 + '/me/' + uidB);
check('another player cannot read whom a nation reacted with', meDoc.status !== 200);

// the poll
check('the poll shows its answers to a player who has not voted', (await B.$$(`[data-act="nw-vote"][data-id="${pid2}"]`)).length === 3);
await B.click(`[data-act="nw-vote"][data-id="${pid2}"][data-v="1"]`);
check('a vote shows the results with the nation’s choice', await until(async () => /The North.*Your vote/.test(await text(B, '.nw-post:first-child .nw-pl')) && /100%/.test(await text(B, '.nw-post:first-child .nw-pl')), 15000));
const vt = (await restGet('devnewsStat/' + pid2)).body.fields?.v?.arrayValue?.values?.map(x => x.integerValue);
check('the server counts the vote once', JSON.stringify(vt) === '["0","1","0"]', vt);
await go(C, 'devnews');
check('a guest is told voting needs a Registered Nation', await until(async () => /Voting needs a Registered Nation/.test(await text(C, '.nw-post:first-child .nw-pl'))) && await C.$eval(`[data-act="nw-vote"][data-id="${pid2}"]`, b => b.disabled));

// replies, and the developer mark
await sleep(21000); // one post every 20 seconds
await B.waitForSelector('#nw-ct-' + pid2); await B.fill('#nw-ct-' + pid2, 'Terra please!');
await B.click(`#nw-cf-${pid2} button[type="submit"]`);
check('a player comments on the pinned post', await until(async () => /Terra please/.test(await text(B, `#nw-cm-${pid2}`)), 15000));
await A.click('.adm-return'); await go(A, 'devnews');
await A.waitForSelector(`#nw-cm-${pid2} [data-act="nw-c-re"]`); await A.click(`#nw-cm-${pid2} [data-act="nw-c-re"]`);
check('replying says to whom', /Replying to Playerland/.test(await text(A, `#nw-cf-${pid2}`)));
await A.fill('#nw-ct-' + pid2, 'Terra is next.'); await A.click(`#nw-cf-${pid2} button[type="submit"]`);
check('a reply sits under its comment, marked as from the developer', await until(async () => /Terra is next/.test(await text(B, `#nw-cm-${pid2} .nw-re`)) && /Developer/.test(await text(B, `#nw-cm-${pid2} .nw-re`)), 15000));
check('a reply has no Reply button of its own', !await B.$(`#nw-cm-${pid2} .nw-re [data-act="nw-c-re"]`));

// an unsent comment survives a reload
await B.fill('#nw-ct-' + pid2, 'Half a thought');
await sleep(700); await B.reload(); await ready(B); await go(B, 'devnews');
check('an unsent comment is still there after a reload', await until(async () => (await B.$eval('#nw-ct-' + pid2, t => t.value).catch(() => '')) === 'Half a thought'), await B.evaluate(id => (document.getElementById('nw-cm-' + id)?.innerText || 'no section') + ' | ' + location.hash + ' | ' + JSON.stringify(G.NEWS.NW.draft) + ' | ' + localStorage.getItem('edictum.newsDrafts'), pid2));
await B.fill('#nw-ct-' + pid2, '');

// search, kinds and the archive
await B.fill('#nw-q', 'fellow');
check('the search finds the post by its words', await until(async () => /1 post/.test(await text(B, '.nw-arc-n')) && /A word from Adminland/.test(await text(B, '.nw-arc'))));
await B.fill('#nw-q', '');
await B.click('.nw-bar [data-act="nw-tag"][data-v="feature"]');
check('a kind of post filters the list', await until(async () => /1 post/.test(await text(B, '.nw-arc-n')) && /Patch 1\.1/.test(await text(B, '.nw-arc'))));
await B.click('.nw-bar [data-act="nw-tag"][data-v="feature"]'); await B.click('[data-act="nw-arc"]');
check('the archive groups the posts by month', await until(async () => (await B.$$('.nw-month')).length >= 1 && (await B.$$('.nw-arc li')).length === 3));
await B.click(`.nw-arc [data-id="${pid}"]`);
check('a result opens the post on its own, at its own address', await until(async () => (await B.$$('.nw-post')).length === 1 && /The first development news/.test(await text(B, '.nw-ti'))) && await B.evaluate(() => location.hash) === '#devnews/' + pid);
await B.goto(await B.evaluate(() => location.href.split('#')[0]) + '#devnews/' + pid2); await B.reload(); await ready(B);
check('a shared link opens that post', await until(async () => /Patch 1\.1/.test(await text(B, '.nw-ti')) && /All development news/.test(await text(B, '.main'))));
await B.click('[data-act="nw-all"]');
check('and goes back to all the news', await until(async () => (await B.$$('.nw-post')).length === 3));

// the portal's totals, and 
await A.click('.side-who .adm-pill'); await A.click('.adm-nav [data-v="admin-news"]'); await A.waitForSelector('[data-act="nwe-new"]');
check('the portal shows the reactions and votes', await until(async () => /Poll: 1 vote/.test(await text(A, '.nwe-tbl'))));
await B.screenshot({ path: OUT + '/devnews-page.png', fullPage: true });
const phone = await player('phone', { vp: { width: 390, height: 844 } });
await open(phone); await found(phone, 'Phoneland');
await phone.click('#tab-more'); await phone.click('#more-sheet [data-v="devnews"]');
check('on a phone the page fits the screen', await until(async () => !!await phone.$('.nw-post')) && await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await phone.screenshot({ path: OUT + '/devnews-phone.png', fullPage: true });
await finish();
