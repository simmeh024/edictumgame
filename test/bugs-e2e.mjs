// Report a bug: a player reports one from its own page under Other, with a screenshot and the game's technical
// details; the report shows on the admin portal's Bug reports page, an admin marks it fixed with a note, and the
// player is told and reads the note. Pacing, pasting a screenshot, deleting a report and deleting the account.
import { OUT, FS_HOST, PROJECT, player, open, ready, found, register, until, check, finish, setClaims, text, nav, openAccount, restListAdmin, clearEmulators, sleep } from './lib.mjs';
await clearEmulators();
const A = await player('admin'), B = await player('player');
const uidA = await open(A); await found(A, 'Adminland');
const uidB = await open(B); await found(B, 'Bugland');
await register(A);
await setClaims(uidA, { admin: true }); await A.reload(); await ready(A);
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const bugs = async () => (await restListAdmin('bugs')).filter(d => d.fields.by.stringValue === uidB);
const owner = (path, fields) => fetch(`http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });

// the menu: in Other, after Development news; the form starts at the page the player came from
check('Report a bug sits in Other, after Development news', /Development news\s*Report a bug/.test(await text(B, '.side .nav-grp[data-g="other"] .nav-g')));
await nav(B, 'map');
// an error the page hit (dispatched, so the test itself does not count it as one)
await B.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Test explosion', filename: location.origin + '/assets/game.abc.js', lineno: 12, colno: 3 })));
await nav(B, 'bugs');
await B.waitForSelector('#bg-form');
check('the page has its heading and form', /Report a bug/.test(await text(B, 'main h1')) && await B.$('#bg-ti') && await B.$('#bg-x'));
check('where in the game starts at the page the player came from', await B.$eval('#bg-where', s => s.value) === 'map');
check('the player has no reports yet', await until(async () => /You have not reported a bug yet/.test(await text(B, '.bg-mine'))));
const env = await text(B, '.bg-env dl');
check('the technical details are shown before sending', /Game version/.test(env) && /Browser.*Mozilla/.test(env) && /Screen.*1280×900 window/.test(env) && /Nation.*founded/.test(env));
check('with the last error the page hit', /Recent errors.*Test explosion \(game\.abc\.js:12:3\)/.test(env), env);

// a report needs a title and a description
await B.click('#bg-form button[type="submit"]');
check('an empty report asks for a title', /Give the report a title/.test(await text(B, '#bg-form .err')) && await B.evaluate(() => document.activeElement && document.activeElement.id) === 'bg-ti');
await B.fill('#bg-ti', 'The map stays blank');
await B.click('#bg-form button[type="submit"]');
check('and then for what happened', /Describe what happened/.test(await text(B, '#bg-form .err')));
const said = 'I claimed a hex and the whole map went white.\nReloading fixes it.';
await B.fill('#bg-x', said);
check('the counter follows the text', await text(B, '#bg-cc') === said.length + ' / 3000');
await B.check('input[name="bg-often"][value="sometimes"]');
await B.selectOption('#bg-where', 'map');

// a screenshot, chosen from a file: made smaller before it goes
const png = await B.screenshot();
await B.setInputFiles('#bg-file', { name: 'shot.png', mimeType: 'image/png', buffer: png });
check('the screenshot shows before sending', await until(() => B.$('.bg-shot img')) && /1280 × 900 pixels/.test(await text(B, '.bg-shot figcaption')));
check('what was typed survives the redraw', await B.$eval('#bg-ti', i => i.value) === 'The map stays blank' && /went white/.test(await B.$eval('#bg-x', t => t.value)));
await B.click('#bg-form button[type="submit"]');
check('sending thanks the player', await until(async () => /Thank you\. Your report “The map stays blank” is with the team/.test(await text(B, '.bg-sent'))));
check('the form is empty again', await B.$eval('#bg-ti', i => i.value) === '' && !(await B.$('.bg-shot img')));
check('the report is listed under Your reports, as new', await until(async () => /New The map stays blank/.test(await text(B, '.bg-mine')) && /with a screenshot/.test(await text(B, '.bg-mine'))));
await B.screenshot({ path: OUT + '/bugs-page.png', fullPage: true });
let list = await bugs();
const f = list[0] && list[0].fields;
check('one report is stored, as the player wrote it', list.length === 1 && f.ti.stringValue === 'The map stays blank' && f.where.stringValue === 'map' && f.often.stringValue === 'sometimes' && f.st.stringValue === 'new' && f.name.stringValue === 'Bugland' && f.img.booleanValue === true);
check('with the technical details', /Game version: /.test(f.env.stringValue) && /Test explosion/.test(f.env.stringValue));
const shot = (await restListAdmin('bugImg')).find(d => d.id === list[0].id);
check('and the screenshot, smaller, under the same ID', !!shot && Number(shot.fields.w.integerValue) <= 1600 && shot.fields.d.stringValue.length <= 700000 && /image\/(webp|jpeg)/.test(shot.fields.m.stringValue));
const bugId = list[0].id;

// one report a minute
await B.fill('#bg-ti', 'A second one');
await B.fill('#bg-x', 'Right away.');
await B.click('#bg-form button[type="submit"]');
check('a second report within the minute is refused, kindly', await until(async () => /one report a minute/.test(await text(B, '#bg-form .err'))));
check('and nothing more is stored', (await bugs()).length === 1);

// a screenshot pasted onto the page
await B.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')), dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  document.querySelector('main').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
});
check('a pasted image becomes the screenshot', await until(async () => /300 × 200 pixels/.test(await text(B, '.bg-shot figcaption'))));
await B.click('[data-act="bg-shot-rm"]');
check('and can be removed', !(await B.$('.bg-shot img')) && await B.evaluate(() => document.activeElement && document.activeElement.dataset.act) === 'bg-shot-add');
await B.setViewportSize({ width: 390, height: 844 });
await B.screenshot({ path: OUT + '/bugs-page-mobile.png', fullPage: true });
const wide = await B.evaluate(() => document.documentElement.scrollWidth - innerWidth);
check('the page fits a phone without sideways scrolling', wide <= 1, wide + ' px too wide');
await B.setViewportSize({ width: 1280, height: 900 });

// the admin portal: a count in the menu and on the overview, and its own page
await A.waitForSelector('.side-who .adm-pill'); await A.click('.side-who .adm-pill');
await A.waitForSelector('.adm-nav');
check('the portal lists Bug reports under Support, with one new', await until(async () => /Bug reports 1/.test(await text(A, '.adm-nav-group[aria-label="Support"]'))));
check('the overview counts the new bug report', await until(async () => /1 ?new bug reports/.test(await text(A, '.adm-kpis'))));
await A.click('.adm-nav [data-v="admin-bugs"]');
await A.waitForSelector('.adm-rep');
const card = await text(A, '.adm-rep');
check('the report shows with its title, place, frequency, nation and text', /New/.test(card) && /The map stays blank/.test(card) && /Map/.test(card) && /Sometimes/.test(card) && /Bugland/.test(card) && /whole map went white/.test(card));
check('with an Inspect link to the player', await A.$eval('.adm-rep [data-act="admin-inspect"]', b => b.dataset.id) === uidB);
await A.click('.adm-rep .bga-env summary');
check('and its technical details', /Game version/.test(await text(A, '.adm-rep .bga-env')) && /Test explosion/.test(await text(A, '.adm-rep .bga-env')));
await A.click('[data-act="bga-shot"]');
check('the screenshot loads on request', await until(() => A.$eval('.bga-shot img', i => i.complete && i.naturalWidth > 0).catch(() => false)));
await A.screenshot({ path: OUT + '/bugs-admin.png', fullPage: true });
await A.fill(`#bga-n-${bugId}`, 'Fixed in today’s update. Thank you!');
await A.click(`[data-act="bga-st"][data-st="fixed"][data-id="${bugId}"]`);
check('marking it fixed says so', await until(async () => /“The map stays blank” is now marked Fixed, with your note/.test(await text(A, '.adm-main'))));
check('the report leaves the open list', await until(async () => /No reports here/.test(await text(A, '.adm-main'))) && /Bug reports(?! 1)/.test(await text(A, '.adm-nav-group[aria-label="Support"]')));
await A.click('[data-act="bga-f"][data-f="fixed"]');
check('and shows under Fixed with the note', /Fixed/.test(await text(A, '.adm-rep .adm-rep-h')) && await A.$eval(`#bga-n-${bugId}`, t => t.value) === 'Fixed in today’s update. Thank you!');
list = await bugs();
check('the state, note and admin are stored', list[0].fields.st.stringValue === 'fixed' && /today’s update/.test(list[0].fields.note.stringValue) && list[0].fields.uby.stringValue === uidA);

// the player is told on their next visit (one that opens on Report a bug shows it there instead), and reads the note
await nav(B, 'nation');
await B.reload(); await ready(B);
check('the player is told the report is fixed', await until(async () => /Your bug report “The map stays blank” is now marked Fixed/.test(await toasts(B)), 15000));
await nav(B, 'bugs');
check('their page shows Fixed and the team’s note', await until(async () => /Fixed The map stays blank/.test(await text(B, '.bg-mine')) && /The Edictum team.*Fixed in today’s update/.test(await text(B, '.bg-mine'))));

// the Help page leads here
await nav(B, 'help');
await B.click('#sup-box [data-act="go"][data-v="bugs"]');
check('the Help page links to Report a bug', await until(() => B.evaluate(() => G.S.view === 'bugs')));

// the player deletes a report, screenshot and all
await B.click(`[data-act="bg-del"][data-id="${bugId}"]`);
await B.click(`[data-act="bg-del-yes"][data-id="${bugId}"]`);
check('a deleted report leaves the page', await until(async () => /You have not reported a bug yet/.test(await text(B, '.bg-mine'))));
check('and the database, with its screenshot', await until(async () => !(await bugs()).length && !(await restListAdmin('bugImg')).some(d => d.id === bugId)));

// deleting the account deletes the reports too
await owner('blimits/' + uidB, { b: { timestampValue: new Date(Date.now() - 120000).toISOString() } });
await B.fill('#bg-ti', 'One more');
await B.fill('#bg-x', 'Before I leave.');
await B.setInputFiles('#bg-file', { name: 'shot.png', mimeType: 'image/png', buffer: png });
await until(() => B.$('.bg-shot img'));
await B.click('#bg-form button[type="submit"]');
check('a report a minute later is accepted', await until(async () => (await bugs()).length === 1));
const lastId = (await bugs())[0].id;
await openAccount(B);
await B.click('[data-ed="delete"]');
await Promise.all([B.waitForNavigation({ timeout: 20000 }), B.click('[data-ed="delete-yes"]')]);
check('deleting the account deletes the player’s reports, screenshots and pacing', await until(async () => !(await bugs()).length && !(await restListAdmin('bugImg')).some(d => d.id === lastId) && !(await restListAdmin('blimits')).some(d => d.id === uidB)));
await finish();
