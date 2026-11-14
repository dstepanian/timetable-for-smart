process.env.TZ = 'Asia/Yerevan';   /* the schedule's own time zone */
/* Drives the real Index.html in Chromium; google.script.run is wired to the real
   server code (Code.gs + Mailer.gs + Booking.gs) running on the fake spreadsheet. */
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { fresh, dayIso, mon, fmt } = require('./fixtures');

const PAGE = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'Index.html')).href;
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

const RUNNER = `
(function(){
  function runner(ok, fail){
    return new Proxy({}, { get: function(t, prop){
      if (prop === 'withSuccessHandler') return function(h){ return runner(h, fail); };
      if (prop === 'withFailureHandler') return function(h){ return runner(ok, h); };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        window.__calls = (window.__calls || 0) + 1;
        window.gasCall(prop, JSON.stringify(args)).then(function(r){
          var o = JSON.parse(r);
          setTimeout(function(){ if (o.err) { fail && fail(new Error(o.err)); } else { ok && ok(o.val); } }, 30);
        });
      };
    }});
  }
  window.google = { script: { run: runner(null, null) } };
})();`;

let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); process.exitCode = 1; }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(env, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 1000 }, locale: 'hy-AM', timezoneId: 'Asia/Yerevan' }, opts || {}));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.exposeFunction('gasCall', async (fn, args) => {
      try { return JSON.stringify({ val: await (env.hook && env.hook[fn] || env.ctx[fn]).apply(null, JSON.parse(args)) }); }
      catch (e) { return JSON.stringify({ err: e.message }); }
    });
    await page.addInitScript(RUNNER);
    await page.goto(PAGE);
    await page.waitForSelector('#stats .stat');
    return page;
  }
  const idle = page => page.waitForTimeout(250);

  /* ---------------- instructor ---------------- */
  const E = fresh('ani.hakobyan@example.org');
  const page = await open(E);

  await t('booking button, tab and signed-in user are shown', async () => {
    assert.ok(await page.isVisible('#bookBtn'));
    assert.ok(await page.isVisible('#tab-book'));
    assert.match(await page.textContent('#who'), /ani\.hakobyan@example\.org/);
  });

  await page.click('#nextWeek'); await idle(page);
  await page.click('#tab-time'); await idle(page);

  await t('“+” on a slot opens the form with that day and hour', async () => {
    const plus = page.locator('.dcol').nth(0).locator('.cell').nth(2).locator('.addbk'); // Monday 13:30
    await plus.click();
    assert.ok(await page.isVisible('#bkDlg'));
    assert.equal(await page.inputValue('#bkDate'), dayIso(0));
    assert.equal(await page.locator('#bkStart option:checked').textContent(), '13:30');
    assert.match(await page.locator('#bkEnd option:checked').textContent(), /^14:30/);
    assert.match(await page.textContent('#bkAvail'), /Ընտրեք տարածքը/);
    assert.ok(!(await page.isVisible('#bkDay')), 'day box hidden until a room is chosen (one hint only)');    assert.ok(await page.isDisabled('#bkSubmit'));
  });

  await t('choosing a room shows the day and availability; purpose is required', async () => {
    await page.selectOption('#bkRoom', 'Երկիր 1');
    assert.match(await page.textContent('#bkAvail'), /Ազատ է/);
    assert.ok(await page.isVisible('#bkDay'), 'day box shown once a room is chosen');
    assert.match(await page.textContent('#bkDay'), /16:00-18:00/);
    assert.match(await page.textContent('#bkDay'), /Ծրագրավորում 74/);
    assert.ok(await page.isDisabled('#bkSubmit'), 'no purpose yet');
    await page.fill('#bkPurpose', 'Ծնողական ժողով');
    assert.ok(!(await page.isDisabled('#bkSubmit')));
  });

  await t('a clash is shown before sending and blocks the button', async () => {
    await page.selectOption('#bkStart', { label: '15:30' });
    assert.match(await page.textContent('#bkAvail'), /զբաղված է՝ 16:00-18:00/);
    assert.ok(await page.isDisabled('#bkSubmit'));
    assert.match(await page.locator('#bkRoom option:checked').textContent(), /զբաղված/);
    await page.selectOption('#bkStart', { label: '13:30' });
    assert.match(await page.textContent('#bkAvail'), /Ազատ է/);
  });
  await page.screenshot({ path: SHOTS + '/1-form.png' });

  await t('no long dashes in the page chrome, the form or the stats', async () => {
    const txt = await page.evaluate(() => ['#bkDlg', '.weeklabel', '#stats', '.controls', 'footer'].map(q => document.querySelector(q).innerText).join(' ') +
      Array.from(document.querySelectorAll('#bkRoom option, #bkStart option, #bkEnd option')).map(o => o.textContent).join(' '));
    assert.ok(!/[\u2013\u2014]/.test(txt), 'found a long dash');
    assert.match(await page.textContent('#bkDay'), /16:00-18:00/);
  });

  await t('submitting books it: toast, list item in the slot, row in the sheet', async () => {
    await page.click('#bkSubmit');
    await page.waitForSelector('#bkDlg', { state: 'hidden' });
    await page.waitForSelector('#toast.on');
    assert.match(await page.textContent('#toast'), /Ամրագրված է՝ Երկիր 1/);
    await page.waitForSelector('li.booked');
    const li = await page.locator('.dcol').nth(0).locator('li.booked').first().textContent();
    assert.match(li, /13:30-14:30/); assert.match(li, /Ծնողական ժողով/);
    assert.equal(E.ss.getSheetByName('Ամրագրումներ').rows.length, 2);
    assert.match(await page.textContent('#tab-book'), /1/);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/2-time-view.png' });

  await t('server refuses a slot taken meanwhile; the message is shown', async () => {
    E.user.email = 'aram.petrosyan@example.org';
    E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(0), start: '14:00', end: '15:00', purpose: 'Արենի դաս' });
    E.user.email = 'ani.hakobyan@example.org';
    await page.locator('.dcol').nth(0).locator('.cell').nth(2).locator('.addbk').click();
    await page.selectOption('#bkRoom', 'Երկիր 2');
    await page.fill('#bkPurpose', 'Փորձ');
    assert.match(await page.textContent('#bkAvail'), /Ազատ է/, 'page does not know yet');
    await page.click('#bkSubmit');
    await page.waitForFunction(() => /զբաղված/.test(document.getElementById('bkAvail').textContent));
    assert.match(await page.textContent('#bkAvail'), /Արենի դաս/);
    assert.ok(await page.isVisible('#bkDlg'));
    await page.waitForTimeout(300);
    await page.selectOption('#bkStart', { label: '13:45' }); // any change re-checks with fresh data
    assert.match(await page.textContent('#bkAvail'), /զբաղված է՝ 14:00-15:00/);
    await page.keyboard.press('Escape');
  });

  await t('place view: free slot opens the form for that room; bookings show as pills', async () => {
    await page.click('#tab-place'); await idle(page);
    assert.ok(await page.locator('.pill.booked').count() >= 2);
    const free = page.locator('tr', { hasText: 'Արեգակ' }).locator('button.pill.free').first();
    await free.click();
    assert.equal(await page.inputValue('#bkRoom'), 'Արեգակ');
    await page.keyboard.press('Escape');
  });
  await page.screenshot({ path: SHOTS + '/3-place-view.png' });

  await t('free view: booked room is not listed as free; card has a booking button', async () => {
    await page.click('#tab-free'); await idle(page);
    await page.click('[data-fday="0"]'); await idle(page);
    await page.click('[data-ftime="13:30"]'); await idle(page);
    const cards = await page.locator('.fcard .t').allTextContents();
    assert.ok(!cards.some(c => /Երկիր 1/.test(c)), 'Երկիր 1 is booked 13:30');
    assert.ok(!cards.some(c => /Երկիր 2/.test(c)), 'Երկիր 2 is booked 14:00 (inside 13:30-15:30)');
    assert.ok(cards.some(c => /Արեգակ/.test(c)));
    await page.locator('.fcard', { hasText: 'Արեգակ' }).locator('[data-bk-room]').click();
    assert.equal(await page.inputValue('#bkRoom'), 'Արեգակ');
    assert.equal(await page.locator('#bkStart option:checked').textContent(), '13:30');
    await page.keyboard.press('Escape');
  });

  await t('my bookings tab lists only mine; cancel asks first, then frees the slot', async () => {
    await page.click('#tab-book'); await idle(page);
    const rows = await page.locator('.bkrow').allTextContents();
    assert.equal(rows.length, 1, 'only Ani’s own booking');
    assert.match(rows[0], /Երկիր 1/);
    await page.screenshot({ path: SHOTS + '/4-my-bookings.png' });
    await page.click('[data-act="cancel"]');
    assert.ok(await page.isVisible('#bvDlg'));
    assert.match(await page.textContent('#bvBody'), /Չեղարկե՞լ/);
    await page.click('[data-vact="do-cancel"]');
    await page.waitForSelector('#bvDlg', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('.bkrow.off').length === 1);
    assert.equal(E.ss.getSheetByName('Ամրագրումներ').rows[1][8], 'Չեղարկված');
    assert.match(E.mail[E.mail.length - 1].subject, /չեղարկվեց/);
  });

  await t('clicking a booking in the calendar opens its details', async () => {
    await page.click('#tab-time'); await idle(page);
    await page.locator('li.booked').first().click();
    assert.match(await page.textContent('#bvBody'), /Արենի դաս/);
    assert.ok(!(await page.isVisible('[data-vact="cancel"]')), 'not Ani’s booking');
    await page.keyboard.press('Escape');
  });

  await t('group: own groups listed, purpose optional, group shown in the calendar and remembered', async () => {
    await page.click('#tab-time'); await idle(page);
    await page.locator('.dcol').nth(2).locator('.cell').nth(0).locator('.addbk').click(); // Wednesday 09:30
    assert.ok(await page.isVisible('#bkGroupFld'));
    const opts = await page.locator('#bkGroup option').allTextContents();
    assert.deepEqual(opts, ['Առանց խմբի', 'EQ Lab 10', 'Անգլերեն 62']);
    await page.selectOption('#bkRoom', 'Երկիր 1');
    assert.ok(await page.isDisabled('#bkSubmit'));
    assert.match(await page.textContent('#bkAvail'), /Ընտրեք խումբը/);
    await page.selectOption('#bkGroup', 'EQ Lab 10');
    assert.ok(!(await page.isDisabled('#bkSubmit')), 'group alone is enough');
    assert.match(await page.getAttribute('#bkPurpose', 'placeholder'), /պարտադիր չէ/);
    await page.click('#bkSubmit');
    await page.waitForSelector('#bkDlg', { state: 'hidden' });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('li.booked')).some(li => /EQ Lab 10/.test(li.textContent)));
    await page.locator('.dcol').nth(2).locator('.cell').nth(1).locator('.addbk').click();
    assert.equal(await page.inputValue('#bkGroup'), 'EQ Lab 10', 'last group remembered');
    await page.keyboard.press('Escape');
  });
  await page.screenshot({ path: SHOTS + '/8-group.png' });

  /* ---------------- approval mode, administrator ---------------- */
  const A = fresh('ani.hakobyan@example.org', [['Ամրագրման հաստատում', 'ON']]);
  const p2 = await open(A);
  await t('approval mode: the instructor sends a request', async () => {
    await p2.click('#nextWeek'); await idle(p2);
    await p2.click('#bookBtn');
    assert.equal(await p2.textContent('#bkSubmit'), 'Ուղարկել հայտը');
    await p2.selectOption('#bkRoom', 'Արեգակ');
    await p2.fill('#bkDate', dayIso(2)); await p2.dispatchEvent('#bkDate', 'change');
    await p2.selectOption('#bkStart', { label: '10:00' });
    await p2.fill('#bkPurpose', 'Անհատական պարապմունք');
    await p2.click('#bkSubmit');
    await p2.waitForSelector('#toast.on');
    assert.match(await p2.textContent('#toast'), /Հայտն ուղարկվեց/);
    await p2.waitForSelector('li.booked.wait');
  });
  await p2.screenshot({ path: SHOTS + '/5-pending.png' });
  await p2.close();

  A.user.email = 'coordinator@example.org';
  const p3 = await open(A);
  await t('administrator sees the request with a badge and approves it', async () => {
    assert.match(await p3.textContent('#who'), /ադմինիստրատոր/);
    assert.match(await p3.textContent('#tab-book .badge'), /^1$/);
    await p3.click('#tab-book'); await idle(p3);
    assert.match(await p3.textContent('.bksec'), /Սպասում են հաստատման · 1/);
    assert.match(await p3.textContent('.bkrow.wait'), /ani\.hakobyan@example\.org/);
    await p3.screenshot({ path: SHOTS + '/6-admin.png' });
    await p3.click('[data-act="approve"]');
    await p3.waitForSelector('#toast.on');
    await p3.waitForFunction(() => !document.querySelector('.bkrow.wait'));
    assert.equal(A.ss.getSheetByName('Ամրագրումներ').rows[1][8], 'Հաստատված');
    assert.match(A.mail[A.mail.length - 1].subject, /հաստատվեց/);
    assert.equal(await p3.locator('#tab-book .badge').count(), 0);
  });

  await t('administrator rejects with a reason', async () => {
    A.user.email = 'aram.petrosyan@example.org';
    A.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '10:00', end: '11:00', purpose: 'Արենի հայտ' });
    A.user.email = 'coordinator@example.org';
    await p3.click('#refresh'); await p3.waitForSelector('.bkrow.wait');
    await p3.click('[data-act="reject"]');
    await p3.fill('#bvReason', 'Այդ ժամին սենյակը պետք է ժողովի համար');
    await p3.click('[data-vact="do-reject"]');
    await p3.waitForSelector('#bvDlg', { state: 'hidden' });
    assert.equal(A.ss.getSheetByName('Ամրագրումներ').rows[2][8], 'Մերժված');
    assert.match(A.mail[A.mail.length - 1].htmlBody, /ժողովի համար/);
  });

  /* ---------------- phone, dark ---------------- */
  const p4 = await open(E, { viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  await t('someone without groups does not see the group field', async () => {
    E.user.email = 'aram.petrosyan@example.org';
    await p4.click('#refresh'); await p4.waitForTimeout(400);
    await p4.click('#bookBtn');
    assert.ok(!(await p4.isVisible('#bkGroupFld')));
    await p4.keyboard.press('Escape');
    E.user.email = 'ani.hakobyan@example.org';
    await p4.click('#refresh'); await p4.waitForTimeout(400);
  });

  await t('phone layout: form fits, no horizontal scroll', async () => {
    await p4.click('#nextWeek'); await idle(p4);
    await p4.click('#bookBtn');
    await p4.selectOption('#bkRoom', 'Երկիր 1');
    const w = await p4.evaluate(() => [document.documentElement.scrollWidth, document.getElementById('bkDlg').getBoundingClientRect().width]);
    assert.ok(w[0] <= 390, 'page width ' + w[0]);
    assert.ok(w[1] <= 390, 'dialog width ' + w[1]);
    await p4.screenshot({ path: SHOTS + '/7-phone-dark.png' });
  });

  /* ---------------- fast first paint from the saved copy ---------------- */
  const F = fresh('ani.hakobyan@example.org');
  F.ctx.getData();                                   /* someone opened the page earlier: copy saved */
  F.ss.getSheetByName('Total').rows[2][2] = 'Նոր դաս 99';   /* then the sheet changed */
  const modes = [];
  F.hook = { getData: m => { modes.push(m); const v = F.ctx.getData(m); return m === 'full' ? new Promise(r => setTimeout(() => r(v), 1500)) : v; } };
  const p5 = await open(F);
  await t('opening shows the saved copy at once, then the current sheet a moment later', async () => {
    assert.doesNotMatch(await p5.textContent('#view'), /Նոր դաս 99/, 'first paint is the saved copy');
    assert.match(await p5.textContent('#updated'), /թարմացվում է/);
    await p5.waitForFunction(() => /Նոր դաս 99/.test(document.getElementById('view').textContent), null, { timeout: 4000 });
    assert.doesNotMatch(await p5.textContent('#updated'), /թարմացվում/);
    assert.deepEqual(modes, ['fast', 'full']);
  });
  await t('refresh button reads the sheet; booking actions use the quick path', async () => {
    modes.length = 0;
    await p5.click('#refresh');
    await p5.waitForFunction(() => !/թարմացվում/.test(document.getElementById('updated').textContent), null, { timeout: 4000 });
    assert.deepEqual(modes, ['full']);
    modes.length = 0;
    await p5.click('#bookBtn');
    await p5.selectOption('#bkRoom', 'Արեգակ');
    await p5.fill('#bkPurpose', 'Թեստ');
    await p5.click('#bkSubmit');
    await p5.waitForSelector('#toast.on');
    await p5.waitForTimeout(300);
    assert.deepEqual(modes, ['fast'], 'after booking: bookings refreshed without re-reading every tab');
  });

  /* ---------------- «Իմ ծրագիրը» ---------------- */
  const { weekName, put } = require('./fixtures');
  const G = fresh('ani.hakobyan@example.org');
  const gw = G.ss.getSheetByName(weekName).rows;
  put(gw, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽');
  put(gw, 'Երկիր 2', 0, '11:00', 'Երաժշտ․ գործ 74 🔽');
  put(gw, 'Երկիր 2', 2, '13:30', 'Երաժշտ․ գործիք․75 🔼');
  put(gw, 'Արեգակ', 3, '09:30', 'Երաժշտ․գործ 74 🔽');
  put(gw, 'Արեգակ', 3, '11:00', 'Երաժշտ․գործ 74 🔽');
  put(gw, 'Ասուպ 1', 4, '16:00', 'Բ1 Մանկան Զարգացման անկյուն 16:10-16:45 Ա3 Մանկան Զարգացման անկյուն 17։00-17։40');
  put(gw, 'Ասուպ 1', 2, '18:00', '1. Ֆինանսներ 75 🔼');
  put(gw, 'Երկիր 1', 5, '10:00', 'Ֆիլմի ցուցադրության քննարկում');
  G.ctx.createBooking({ room: 'Արեգակ', date: dayIso(4), start: '10:00', end: '11:00', group: 'EQ Lab 10', purpose: 'Լրացուցիչ դաս' });
  const p6 = await open(G);
  const rowsOf = pg => pg.$$eval('#view .prow', els => els.map(e => [e.querySelector('.pt').textContent, e.querySelector('.pg').textContent, e.querySelector('.pr b').textContent, e.classList.contains('booked')]));
  await t('program tab: my program is pre-selected from my Staff groups; group bookings are included', async () => {
    await p6.click('#nextWeek'); await idle(p6);
    await p6.click('#tab-prog'); await idle(p6);
    assert.equal(await p6.inputValue('#progSel'), 'eqlab');
    assert.equal(await p6.locator('#progSel optgroup').first().getAttribute('label'), 'Իմ խմբերի ծրագրերը');
    assert.deepEqual(await rowsOf(p6), [['09:30-11:00', 'Խումբ 10', 'Երկիր 1', false], ['10:00-11:00', 'Խումբ 10', 'Արեգակ', true]]);
    assert.match(await p6.textContent('#stats'), /Պարապմունքներ այս շաբաթ1/);
    assert.match(await p6.textContent('#stats'), /ևս 1 ամրագրում/);
    assert.ok(!(await p6.isVisible('#q')) && !(await p6.isVisible('#roomChips')), 'search and room chips hidden here');
    await p6.click('#view .prow.booked');
    assert.ok(await p6.isVisible('#bvDlg'), 'booking row opens its details');
    await p6.keyboard.press('Escape');
  });
  await t('spelling variants are one program; back-to-back slots are one session; totals', async () => {
    const opts = await p6.$$eval('#progSel option', o => o.map(x => x.textContent));
    assert.equal(opts.filter(x => /Երաժշտ/.test(x)).length, 1, opts.join(' | '));
    await p6.selectOption('#progSel', 'երաժշտգործ'); await idle(p6);
    assert.deepEqual(await rowsOf(p6), [
      ['11:00-13:00', 'Խումբ 74', 'Երկիր 2', false],
      ['13:30-15:30', 'Խումբ 75', 'Երկիր 2', false],
      ['09:30-13:00', 'Խումբ 74', 'Արեգակ', false]
    ]);
    const st = await p6.textContent('#stats');
    assert.match(st, /Պարապմունքներ այս շաբաթ3/);
    assert.match(st, /7 ժ 30 ր/);
    assert.match(st, /Տարածքներ2/);
    assert.match(st, /Խմբեր274, 75/);
    assert.match(await p6.textContent('#view'), /Պարապմունք չկա՝ Երք, Ուրբ, Շբթ, Կիր/);
    assert.match(await p6.textContent('#view .pgtab'), /Խումբ 74Երկ 11:00 · Երկիր 2Հնգ 09:30 · ԱրեգակԽումբ 75Չրք 13:30 · Երկիր 2/);
    await p6.screenshot({ path: SHOTS + '/9-program.png', fullPage: true });
  });
  await t('a line with two time ranges is two sessions', async () => {
    await p6.selectOption('#progSel', 'մանկանզարգացմանանկյուն'); await idle(p6);
    assert.deepEqual(await rowsOf(p6), [['16:10-16:45', 'Խումբ Բ1', 'Ասուպ 1', false], ['17:00-17:40', 'Խումբ Ա3', 'Ասուպ 1', false]]);
  });
  await t('a list number is not part of the name; one-off events are not in the list', async () => {
    const opts = await p6.$$eval('#progSel option', o => o.map(x => x.textContent));
    assert.equal(opts.filter(x => /Ֆինանսներ/.test(x)).length, 1, opts.join(' | '));
    assert.ok(!opts.some(x => /Ֆիլմի/.test(x)), 'one-off event left out');
    await p6.selectOption('#progSel', 'ֆինանսներ'); await idle(p6);
    assert.deepEqual(await rowsOf(p6), [['18:00-20:00', 'Խումբ 75', 'Ասուպ 1', false]]);
  });
  await p6.selectOption('#progSel', 'մանկանզարգացմանանկյուն'); await idle(p6);
  await t('an instructor always lands on her own program, even after looking at another tab or program', async () => {
    await p6.click('#tab-place'); await idle(p6);
    await p6.reload(); await p6.waitForSelector('#progSel');
    assert.equal(await p6.getAttribute('#tab-prog', 'aria-selected'), 'true');
    assert.equal(await p6.inputValue('#progSel'), 'eqlab');
    assert.match(await p6.textContent('#view .proghead'), /Էջը միշտ բացվում է ձեր ծրագրով/);
    const txt = await p6.textContent('body');
    assert.ok(!/[\u2013\u2014]/.test(txt), 'no long dashes');
  });
  /* someone with no group in Staff, and an administrator: the page remembers what they used last */
  const fillProg = E => { const w = E.ss.getSheetByName(weekName).rows; put(w, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽'); put(w, 'Ասուպ 1', 4, '16:00', 'Բ1 Մանկան Զարգացման անկյուն 16:10-16:45'); };
  const G2 = fresh('guest.user@example.org'); fillProg(G2);
  const pg2 = await open(G2);
  await t('others: the last view and program are remembered', async () => {
    assert.equal(await pg2.getAttribute('#tab-time', 'aria-selected'), 'true', 'not sent to the program tab');
    await pg2.click('#tab-prog'); await idle(pg2);
    await pg2.selectOption('#progSel', 'մանկանզարգացմանանկյուն'); await idle(pg2);
    await pg2.reload(); await pg2.waitForSelector('#progSel');
    assert.equal(await pg2.inputValue('#progSel'), 'մանկանզարգացմանանկյուն');
    assert.match(await pg2.textContent('#view .proghead'), /Ընտրությունը հիշվում է/);
    assert.match(await pg2.textContent('#view'), /Այս շաբաթ «Մանկան Զարգացման անկյուն» ծրագրի պարապմունք չկա/);
  });
  const G3 = fresh('coordinator@example.org'); fillProg(G3);
  G3.ss.getSheetByName('Staff').rows.push(['EQ Lab 11', 'coordinator@example.org', '', '', '', '']);
  const pg3 = await open(G3);
  await t('an administrator keeps her own last view even if she has a group', async () => {
    assert.equal(await pg3.getAttribute('#tab-time', 'aria-selected'), 'true');
    await pg3.click('#tab-place'); await idle(pg3);
    await pg3.reload(); await pg3.waitForSelector('#stats .stat'); await idle(pg3);
    assert.equal(await pg3.getAttribute('#tab-place', 'aria-selected'), 'true');
  });
  const p7 = await open(G, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await t('program tab on a phone: fits, no horizontal scroll', async () => {
    await p7.click('#nextWeek'); await idle(p7);
    await p7.click('#tab-prog'); await idle(p7);
    await p7.selectOption('#progSel', 'երաժշտգործ'); await idle(p7);
    const w = await p7.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, 'page width ' + w);
    assert.equal((await rowsOf(p7)).length, 3);
    await p7.screenshot({ path: SHOTS + '/10-program-phone.png', fullPage: true });
  });

  /* ---------------- moving my group to another room ---------------- */
  const { colOf } = require('./fixtures');
  const H = fresh('ani.hakobyan@example.org');
  const hRules = H.ss.getSheetByName('Rules'); hRules.rows.push(['', 'Դասի տարածքի փոփոխություն']); hRules.bgs.push(['#ffff00']);
  const hw = H.ss.getSheetByName(weekName);
  put(hw.rows, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽');
  put(hw.rows, 'Արեգակ', 2, '09:30', 'Պար 74');
  put(H.ss.getSheetByName('Total').rows, 'Ասուպ 1', 1, '09:30', 'EQ Lab 10 🔽');
  const p8 = await open(H);
  await t('move: my group has «Փոխել տարածքը»; other groups and the Total week do not', async () => {
    await p8.click('#tab-prog'); await idle(p8);
    assert.equal(await p8.inputValue('#progSel'), 'eqlab');
    assert.equal(await p8.locator('#view [data-mv]').count(), 0, 'this week is Total');
    assert.match(await p8.textContent('#view'), /դեռ չունի իր թերթիկը/);
    await p8.click('#nextWeek'); await idle(p8);
    assert.equal(await p8.locator('#view [data-mv]').count(), 1);
    await p8.selectOption('#progSel', 'ծրագրավորում'); await idle(p8);
    assert.equal(await p8.locator('#view [data-mv]').count(), 0, 'not my group');
    await p8.selectOption('#progSel', 'eqlab'); await idle(p8);
  });
  await t('move: only free rooms are offered; moving updates the page and the sheet', async () => {
    await p8.click('#view [data-mv]');
    assert.ok(await p8.isVisible('#mvDlg'));
    const opts = await p8.$$eval('#mvTo option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual(opts, ['Երկիր 2', 'Ասուպ 1'], 'not the current room, not the busy Արեգակ');
    assert.ok(await p8.isDisabled('#mvDlg [data-mvgo]'));
    assert.match(await p8.textContent('#mvDlg'), /միայն «Weekly schedule .*» թերթիկում/);
    await p8.selectOption('#mvTo', 'Ասուպ 1');
    await p8.click('#mvDlg [data-mvgo]');
    await p8.waitForSelector('#toast.on');
    assert.match(await p8.textContent('#toast'), /Երկիր 1 → Ասուպ 1/);
    assert.ok(!(await p8.isVisible('#mvDlg')));
    await p8.waitForTimeout(400);
    assert.deepEqual(await rowsOf(p8), [['09:30-11:00', 'Խումբ 10', 'Ասուպ 1', false]]);
    assert.equal(await p8.locator('#view .prow.tinted').count(), 1, 'painted as a room change');
    assert.match(await p8.textContent('#view .prow'), /Դասի տարածքի փոփոխ/);
    assert.equal(hw.cell(5, colOf(2, '09:30') + 1), 'EQ Lab 10 🔽');
    assert.equal(hw.cell(3, colOf(2, '09:30') + 1), '');
    assert.ok(H.mail.some(m => /Տարածքի փոփոխություն/.test(m.subject)));
    await p8.screenshot({ path: SHOTS + '/11-moved.png', fullPage: true });
  });
  await t('move: a refusal from the server is shown in the dialog', async () => {
    put(hw.rows, 'Երկիր 2', 2, '09:30', 'Յոգա 74');
    await p8.click('#view [data-mv]');
    await p8.selectOption('#mvTo', 'Երկիր 2');
    await p8.click('#mvDlg [data-mvgo]');
    await p8.waitForSelector('#mvDlg .avail.bad');
    assert.match(await p8.textContent('#mvDlg .avail.bad'), /Երկիր 2.*զբաղված.*Յոգա 74/);
    await p8.screenshot({ path: SHOTS + '/12-move-refused.png' });
    await p8.click('#mvDlg .dlg-foot [data-close]');
    assert.ok(!(await p8.isVisible('#mvDlg')));
  });

  /* ---------------- joint sessions «EQ Lab 10 🔽, Յոգա 77 🔽» ---------------- */
  const J = fresh('ani.hakobyan@example.org');
  const jst = J.ss.getSheetByName('Staff').rows;
  jst.find(r => r[0] === 'EQ Lab 10')[0] = 'EQ Lab 10, Յոգա 77';
  jst.push(['Յոգա 77, EQ Lab 10', 'yoga.teacher@example.org', '', '', '', '']);
  const jw = J.ss.getSheetByName(weekName).rows;
  put(jw, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽, Յոգա 77 🔽');
  put(jw, 'Արեգակ', 2, '09:30', 'Յոգա 77 🔽, EQ Lab 10 🔽');
  put(jw, 'Երկիր 2', 3, '16:00', 'EQ Lab 10 🔽');
  put(jw, 'Արեգակ', 3, '16:00', 'Յոգա 77 🔼․ EQ Lab 10 🔼');
  const p9 = await open(J);
  const jrows = pg => pg.$$eval('#view .prow', els => els.map(e => [e.querySelector('.pt').textContent, e.querySelector('.pg').textContent, e.querySelector('.pr b').textContent, (e.querySelector('.pw') || {}).textContent || '', !!e.querySelector('[data-mv]')]));
  await t('joint sessions: counted under their first group, the partner is shown, no mixed programs', async () => {
    assert.equal(await p9.getAttribute('#tab-prog', 'aria-selected'), 'true', 'first visit of an instructor opens her program');
    assert.ok(!(await p9.isVisible('#frow')), 'room filter hidden on the program tab');
    await p9.click('#nextWeek'); await idle(p9);
    assert.equal(await p9.inputValue('#progSel'), 'eqlab', 'Staff «EQ Lab 10, Յոգա 77» means the EQ Lab program');
    assert.deepEqual(await jrows(p9), [
      ['09:30-11:00', 'Խումբ 10', 'Երկիր 1', 'Յոգա 77-ի հետ', true],
      ['16:00-18:00', 'Խումբ 10', 'Երկիր 2', '', true]
    ]);
    const opts = await p9.$$eval('#progSel option', o => o.map(x => x.textContent));
    assert.ok(!opts.some(x => /,|․\s/.test(x)), 'no program made of two names: ' + opts.join(' | '));
    await p9.selectOption('#progSel', 'յոգա'); await idle(p9);
    assert.deepEqual(await jrows(p9), [
      ['09:30-11:00', 'Խումբ 77', 'Արեգակ', 'EQ Lab 10-ի հետ', false],
      ['16:00-18:00', 'Խումբ 77', 'Արեգակ', 'EQ Lab 10-ի հետ', false]
    ], 'yoga is not my group: no move button');
    await p9.selectOption('#progSel', 'eqlab'); await idle(p9);
    await p9.screenshot({ path: SHOTS + '/13-joint.png', fullPage: true });
  });

  /* ---------------- compact filter row ---------------- */
  const K = fresh('ani.hakobyan@example.org');
  const p10 = await open(K);
  const placeRooms = pg => pg.$$eval('#view tbody th.room', els => els.map(e => e.textContent));
  await t('filter row: rooms in a dropdown, picked rooms as removable chips, colours behind a button', async () => {
    await p10.click('#tab-place'); await idle(p10);
    assert.match(await p10.textContent('#roomBtn'), /Տարածքներ՝ Բոլորը/);
    assert.equal(await p10.locator('#roomChips .chip').count(), 0);
    assert.ok(!(await p10.isVisible('#roomPop')) && !(await p10.isVisible('#legend')), 'lists closed at start');
    assert.equal((await placeRooms(p10)).length, 4);
    await p10.click('#roomBtn');
    assert.ok(await p10.isVisible('#roomPop'));
    assert.equal(await p10.getAttribute('#roomBtn', 'aria-expanded'), 'true');
    assert.equal(await p10.locator('#roomPop input[type=checkbox]').count(), 4);
    await p10.check('#roomPop input[data-room="Արեգակ"]'); await idle(p10);
    await p10.check('#roomPop input[data-room="Երկիր 2"]'); await idle(p10);
    assert.ok(await p10.isVisible('#roomPop'), 'stays open while picking');
    assert.equal(await p10.evaluate(() => document.activeElement.getAttribute('data-room')), 'Երկիր 2', 'focus kept on the box');
    assert.match(await p10.textContent('#roomBtn'), /Տարածքներ՝ 2/);
    assert.deepEqual(await p10.$$eval('#roomChips .chip', c => c.map(x => x.textContent.replace('×', '').trim())), ['Երկիր 2', 'Արեգակ']);
    assert.equal((await placeRooms(p10)).length, 2);
    await p10.screenshot({ path: SHOTS + '/14-filter-open.png' });
    await p10.keyboard.press('Escape');
    assert.ok(!(await p10.isVisible('#roomPop')), 'Esc closes');
    assert.equal(await p10.evaluate(() => document.activeElement.id), 'roomBtn');
    await p10.click('#roomChips .chip[data-room="Արեգակ"]'); await idle(p10);
    assert.deepEqual(await p10.$$eval('#roomChips .chip', c => c.map(x => x.getAttribute('data-room'))), ['Երկիր 2']);
    await p10.click('#roomBtn'); await p10.click('#roomPop [data-all]'); await idle(p10);
    assert.equal(await p10.locator('#roomChips .chip').count(), 0);
    assert.match(await p10.textContent('#roomBtn'), /Բոլորը/);
    assert.equal((await placeRooms(p10)).length, 4);
    await p10.click('#legendBtn');
    assert.ok(await p10.isVisible('#legend') && !(await p10.isVisible('#roomPop')), 'one list open at a time');
    assert.match(await p10.textContent('#legend'), /Դասընթաց/);
    await p10.click('h1');
    assert.ok(!(await p10.isVisible('#legend')), 'a click outside closes it');
    const h = await p10.evaluate(() => document.getElementById('frow').getBoundingClientRect().height);
    assert.ok(h <= 40, 'filter row is one line: ' + h);
    await p10.click('#tab-time'); await idle(p10);
    await p10.screenshot({ path: SHOTS + '/15-compact.png' });
  });
  const p11 = await open(K, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await t('filter row on a phone: one line, list fits the screen', async () => {
    await p11.click('#roomBtn');
    const w = await p11.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, 'page width ' + w);
    const r = await p11.evaluate(() => { const b = document.getElementById('roomPop').getBoundingClientRect(); return [b.left, b.right]; });
    assert.ok(r[0] >= 0 && r[1] <= 390, 'list inside the screen ' + r);
    await p11.screenshot({ path: SHOTS + '/16-filter-phone.png' });
  });

  await t('no script errors', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log('\n' + pass + ' passed');
})();
