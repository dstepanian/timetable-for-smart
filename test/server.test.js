process.env.TZ = 'Asia/Yerevan';   /* the schedule's own time zone */
/* Runs the real Code.gs + Mailer.gs + Booking.gs against a fake spreadsheet. */
const assert = require('assert');
const { fresh, dayIso, mon, iso, fmt } = require('./fixtures');

let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } }
function throwsMsg(fn, re) { try { fn(); } catch (e) { assert.match(e.message, re); return; } throw new Error('expected an error matching ' + re); }

t('getData includes me, settings and bookings', () => {
  const E = fresh('ani.hakobyan@example.org');
  const d = JSON.parse(E.ctx.getData());
  assert.equal(d.me.email, 'ani.hakobyan@example.org');
  assert.equal(d.me.name, 'Ani Hakobyan');
  assert.equal(d.me.isAdmin, false);
  assert.deepEqual(d.bookings, []);
  assert.equal(d.bookCfg.approval, false);
  assert.equal(d.bookCfg.open, '08:00');
  assert.ok(!d.bookErr, d.bookErr);
  assert.equal(d.weeks.length, 1);
});

t('admin = Staff admin e-mail or the owner', () => {
  assert.equal(JSON.parse(fresh('coordinator@example.org').ctx.getData()).me.isAdmin, true);
  assert.equal(JSON.parse(fresh('owner@example.org').ctx.getData()).me.isAdmin, true);
});

t('free hour books instantly, admin gets one e-mail', () => {
  const E = fresh('ani.hakobyan@example.org');
  const r = JSON.parse(E.ctx.createBooking({ room: 'Երկիր 1', date: dayIso(0), start: '14:00', end: '15:00', purpose: 'Ծնողական ժողով', name: 'Անի Հակոբյան' }));
  assert.equal(r.booking.status, 'ok');
  const sh = E.ss.getSheetByName('Ամրագրումներ');
  assert.ok(sh, 'bookings tab created');
  assert.equal(sh.rows[1][1], fmt(mon, 'dd.MM.yyyy'));
  assert.equal(sh.rows[1][4], 'Երկիր 1');
  assert.equal(sh.rows[1][8], 'Հաստատված');
  assert.equal(E.mail.length, 1);
  assert.equal(E.mail[0].to, 'coordinator@example.org');
  assert.equal(E.mail[0].replyTo, 'ani.hakobyan@example.org');
  assert.ok(!/ԹԵՍՏ/.test(E.mail[0].subject), 'admin mail not marked as test');
  const d = JSON.parse(E.ctx.getData());
  assert.equal(d.bookings.length, 1);
  assert.equal(d.bookings[0].mine, true);
  assert.equal(d.bookings[0].email, undefined, 'no e-mails for non-admins');
  assert.equal(d.me.name, 'Անի Հակոբյան', 'remembers the typed name');
});

t('class in the grid blocks the slot (16:00-18:00)', () => {
  const E = fresh('ani.hakobyan@example.org');
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 1', date: dayIso(0), start: '17:00', end: '17:30', purpose: 'x' }), /զբաղված է՝ 16:00-18:00 · Ծրագրավորում 74/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 1', date: dayIso(0), start: '15:30', end: '16:30', purpose: 'x' }), /զբաղված/);
});

t('last slot of the day is two hours (18:00-20:00)', () => {
  const E = fresh('ani.hakobyan@example.org');
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 1', date: dayIso(0), start: '19:30', end: '20:30', purpose: 'x' }), /18:00-20:00/);
  JSON.parse(E.ctx.createBooking({ room: 'Երկիր 1', date: dayIso(0), start: '20:00', end: '21:00', purpose: 'x' }));
});

t('a cell with its own hours is busy only then', () => {
  const E = fresh('ani.hakobyan@example.org');
  throwsMsg(() => E.ctx.createBooking({ room: 'Ասուպ 1', date: dayIso(0), start: '12:00', end: '13:00', purpose: 'x' }), /11:00-12:30/);
  JSON.parse(E.ctx.createBooking({ room: 'Ասուպ 1', date: dayIso(0), start: '12:30', end: '13:30', purpose: 'x' }));
  // lone start times = one-hour sessions: 16:00-17:00 and 17:00-18:00
  throwsMsg(() => E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(1), start: '17:15', end: '17:45', purpose: 'x' }), /17:00-18:00/);
  JSON.parse(E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(1), start: '18:00', end: '19:00', purpose: 'x' }));
});

t('two bookings cannot overlap; back-to-back is fine', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'Ա' });
  E.user.email = 'aram.petrosyan@example.org';
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '10:30', end: '11:30', purpose: 'Բ' }), /10:00-11:00 · Ա/);
  JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '11:00', end: '12:00', purpose: 'Բ' }));
  JSON.parse(E.ctx.createBooking({ room: 'երկիր 2', date: dayIso(2), start: '09:00', end: '10:00', purpose: 'Գ' }));
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '08:30', end: '09:30', purpose: 'Դ' }), /09:00-10:00/);
});

t('validation: past, hours, length, ahead, purpose, unknown room', () => {
  const E = fresh('ani.hakobyan@example.org');
  const y = new Date(); y.setDate(y.getDate() - 1);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: iso(y), start: '10:00', end: '11:00', purpose: 'x' }), /Անցած/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '07:00', end: '08:00', purpose: 'x' }), /08:00-21:00/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '09:00', end: '14:00', purpose: 'x' }), /4 ժամ/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '11:00', end: '10:00', purpose: 'x' }), /սկզբից հետո/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '10:00', end: '11:00', purpose: '  ' }), /ինչի համար/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Գաղտնի սենյակ', date: dayIso(3), start: '10:00', end: '11:00', purpose: 'x' }), /տարածքը չկա/);
  const far = new Date(); far.setDate(far.getDate() + 90);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: iso(far), start: '10:00', end: '11:00', purpose: 'x' }), /60 օր/);
  E.user.email = '';
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '10:00', end: '11:00', purpose: 'x' }), /coaf\.org հաշվով/);
});

t('week without its own tab uses Total', () => {
  const E = fresh('ani.hakobyan@example.org');
  const d = new Date(mon); d.setDate(mon.getDate() + 7); // the Monday after: no tab
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: iso(d), start: '10:00', end: '11:00', purpose: 'x' }), /Ֆինանսներ 74/);
  JSON.parse(E.ctx.createBooking({ room: 'Երկիր 1', date: iso(d), start: '16:00', end: '17:00', purpose: 'x' }));
});

t('approval mode: request waits, blocks the slot, admin approves', () => {
  const E = fresh('ani.hakobyan@example.org', [['Ամրագրման հաստատում', 'ON']]);
  const r = JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(4), start: '10:00', end: '11:00', purpose: 'Ժողով' }));
  assert.equal(r.booking.status, 'wait');
  assert.match(E.mail[0].subject, /Ամրագրման հայտ/);
  E.user.email = 'aram.petrosyan@example.org';
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(4), start: '10:00', end: '10:30', purpose: 'x' }), /զբաղված/);
  throwsMsg(() => E.ctx.approveBooking(r.booking.id), /ադմինիստրատորը/);
  E.user.email = 'coordinator@example.org';
  assert.equal(JSON.parse(E.ctx.approveBooking(r.booking.id)).status, 'ok');
  const last = E.mail[E.mail.length - 1];
  assert.match(last.subject, /հաստատվեց/);
  assert.equal(last.to, 'coordinator@example.org', 'test mode: booker mail goes to the admin');
  assert.match(last.htmlBody, /ani\.hakobyan@example\.org/);
  throwsMsg(() => E.ctx.approveBooking(r.booking.id), /արդեն/);
  // admin's own booking is never "waiting"
  assert.equal(JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(4), start: '12:00', end: '13:00', purpose: 'x' })).booking.status, 'ok');
});

t('reject frees the slot and tells the booker', () => {
  const E = fresh('ani.hakobyan@example.org', [['Ամրագրման հաստատում', 'ON']]);
  const id = JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(4), start: '10:00', end: '11:00', purpose: 'Ժողով' })).booking.id;
  E.user.email = 'coordinator@example.org';
  E.ctx.rejectBooking(id, 'Այդ օրը սենյակը վերանորոգվում է');
  assert.match(E.mail[E.mail.length - 1].htmlBody, /վերանորոգվում/);
  E.user.email = 'aram.petrosyan@example.org';
  JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(4), start: '10:00', end: '11:00', purpose: 'x' }));
});

t('cancel: only the owner or an admin; frees the slot', () => {
  const E = fresh('ani.hakobyan@example.org');
  const id = JSON.parse(E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'x' })).booking.id;
  E.user.email = 'aram.petrosyan@example.org';
  throwsMsg(() => E.ctx.cancelBooking(id), /միայն ձեր/);
  E.user.email = 'ani.hakobyan@example.org';
  const before = E.mail.length;
  assert.equal(JSON.parse(E.ctx.cancelBooking(id)).status, 'cancel');
  assert.match(E.mail[before].subject, /չեղարկվեց/);
  assert.equal(E.mail[before].to, 'coordinator@example.org');
  throwsMsg(() => E.ctx.cancelBooking(id), /արդեն/);
  E.user.email = 'aram.petrosyan@example.org';
  JSON.parse(E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'x' }));
  const d = JSON.parse(E.ctx.getData());
  assert.equal(d.bookings.filter(b => b.status !== 'cancel').length, 1, 'cancelled ones are hidden from others');
  E.user.email = 'ani.hakobyan@example.org';
  assert.equal(JSON.parse(E.ctx.getData()).bookings.length, 2, 'own cancelled booking still listed');
});

t('admin cancel e-mails the booker; admin sees e-mails', () => {
  const E = fresh('ani.hakobyan@example.org');
  const id = JSON.parse(E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(3), start: '10:00', end: '11:00', purpose: 'x' })).booking.id;
  E.user.email = 'coordinator@example.org';
  assert.equal(JSON.parse(E.ctx.getData()).bookings[0].email, 'ani.hakobyan@example.org');
  E.ctx.cancelBooking(id);
  assert.match(E.mail[E.mail.length - 1].subject, /Ձեր ամրագրումը չեղարկվեց/);
});

t('settings rows are read; Mailer settings are not disturbed', () => {
  const E = fresh('ani.hakobyan@example.org', [['Ամրագրման ժամեր', '09:00-20:00'], ['Ամրագրման տևողություն (ժամ)', '2'], ['Ամրագրում քանի օր առաջ', '14']]);
  const c = E.ctx.bookCfg_();
  assert.deepEqual([c.open, c.close, c.maxMin, c.maxDays, c.approval], ['09:00', '20:00', 120, 14, false]);
  const s = E.ctx.settings_();
  assert.deepEqual([s.admin, s.weekly, s.changes, s.test], ['coordinator@example.org', false, true, true]);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(3), start: '10:00', end: '12:30', purpose: 'x' }), /2 ժամ/);
});

t('hand-edited rows (real dates, odd status) are tolerated', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(3), start: '10:00', end: '11:00', purpose: 'x' });
  const sh = E.ss.getSheetByName('Ամրագրումներ');
  sh.rows[1][1] = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3);
  sh.rows[1][8] = 'հաստատված ';
  sh.rows.push(['', '', '', '', '', '', '', '', '', '', '']);
  const d = JSON.parse(E.ctx.getData());
  assert.equal(d.bookings.length, 1);
  assert.equal(d.bookings[0].date, dayIso(3));
  throwsMsg(() => E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(3), start: '10:30', end: '11:30', purpose: 'y' }), /զբաղված/);
});

t('real Staff labels: admin e-mail survives the test-mode row; OFF is read', () => {
  const E = fresh('coordinator@example.org');
  let s = E.ctx.settings_();
  assert.equal(s.admin, 'coordinator@example.org');
  assert.equal(s.test, true);
  assert.equal(JSON.parse(E.ctx.getData()).me.isAdmin, true);
  E.ss.getSheetByName('Staff').rows[4][5] = 'OFF';
  s = E.ctx.settings_();
  assert.equal(s.test, false);
  assert.equal(s.admin, 'coordinator@example.org');
});

t('a typed en dash in a cell is still read as a time range', () => {
  const E = fresh('ani.hakobyan@example.org');
  throwsMsg(() => E.ctx.createBooking({ room: 'Ասուպ 1', date: dayIso(1), start: '11:30', end: '12:30', purpose: 'x' }), /զբաղված է՝ 11:00-12:00/);
  JSON.parse(E.ctx.createBooking({ room: 'Ասուպ 1', date: dayIso(1), start: '12:00', end: '13:00', purpose: 'x' }));
});

t('groups: own groups from the Staff tab; admins get every group', () => {
  const E = fresh('ani.hakobyan@example.org');
  let me = JSON.parse(E.ctx.getData()).me;
  assert.deepEqual(me.groups, ['EQ Lab 10', 'Անգլերեն 62']);
  assert.deepEqual(me.allGroups, []);
  E.user.email = 'owner@example.org';
  me = JSON.parse(E.ctx.getData()).me;
  assert.deepEqual(me.groups, ['IT 1', 'IT 2']);
  assert.ok(me.allGroups.length >= 5 && me.allGroups.indexOf('EQ Lab 10') >= 0);
  E.user.email = 'aram.petrosyan@example.org';
  assert.deepEqual(JSON.parse(E.ctx.getData()).me.groups, []);
});

t('booking with a group: purpose optional, stored, shown to others; foreign group refused', () => {
  const E = fresh('ani.hakobyan@example.org');
  const b = JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '10:00', end: '11:00', group: 'eq lab 10' })).booking;
  assert.equal(b.group, 'EQ Lab 10');
  const sh = E.ss.getSheetByName('Ամրագրումներ');
  assert.equal(sh.rows[0][11], 'Խումբ');
  assert.equal(sh.rows[1][11], 'EQ Lab 10');
  assert.match(E.mail[0].htmlBody, /EQ Lab 10/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '12:00', end: '13:00', group: 'IT 1' }), /կապված չէ/);
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '12:00', end: '13:00' }), /Ընտրեք խումբը/);
  E.user.email = 'aram.petrosyan@example.org';
  throwsMsg(() => E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '10:30', end: '11:30', purpose: 'x' }), /10:00-11:00 · EQ Lab 10/);
  const d = JSON.parse(E.ctx.getData());
  assert.equal(d.bookings[0].group, 'EQ Lab 10');
  E.user.email = 'coordinator@example.org';
  assert.equal(JSON.parse(E.ctx.createBooking({ room: 'Երկիր 2', date: dayIso(2), start: '12:00', end: '13:00', group: 'IT 2', purpose: 'ցանցի տեղադրում' })).booking.group, 'IT 2');
});

t('an older bookings tab gets the group header added', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'x' });
  const sh = E.ss.getSheetByName('Ամրագրումներ');
  sh.rows.forEach(r => { r.length = 11; });
  E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(2), start: '11:00', end: '12:00', group: 'EQ Lab 10' });
  assert.equal(sh.rows[0][11], 'Խումբ');
  assert.equal(JSON.parse(E.ctx.getData()).bookings.length, 2);
});

/* ---------------- saved copy of the schedule ---------------- */
const { stats } = require('./gas-mock');
const { weekName } = require('./fixtures');
const strip = d => { const o = JSON.parse(d); delete o.updated; delete o.cached; return o; };

t('fast load: first time reads the sheet, then serves the saved copy with fewer reads', () => {
  const E = fresh('ani.hakobyan@example.org');
  stats.reads = 0;
  const a = E.ctx.getData('fast');
  const fullReads = stats.reads;
  assert.equal(JSON.parse(a).cached, false, 'nothing saved yet');
  stats.reads = 0;
  const b = E.ctx.getData('fast');
  const fastReads = stats.reads;
  assert.equal(JSON.parse(b).cached, true);
  assert.deepEqual(strip(b), strip(a), 'same data from the saved copy');
  assert.ok(fastReads < fullReads / 2, 'fast ' + fastReads + ' reads vs full ' + fullReads);
  assert.equal(JSON.parse(b).updated, JSON.parse(a).updated, 'shows when the copy was read');
});

t('the saved copy can be old; a full load reads the sheet and replaces it', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.getData();
  const wk = E.ss.getSheetByName(weekName);
  wk.rows[2][2] = 'Նոր դաս 99';
  const cell = d => JSON.parse(d).weeks[0].grid.rooms[0].cells[0];
  assert.equal(cell(E.ctx.getData('fast')), '', 'fast still shows the copy');
  assert.equal(cell(E.ctx.getData()), 'Նոր դաս 99', 'full reads the sheet');
  assert.equal(cell(E.ctx.getData('fast')), 'Նոր դաս 99', 'and the copy is updated');
});

t('bookings are live even when the schedule comes from the copy', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.getData();
  E.ctx.createBooking({ room: 'Արեգակ', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'x' });
  const d = JSON.parse(E.ctx.getData('fast'));
  assert.equal(d.cached, true);
  assert.equal(d.bookings.length, 1);
  assert.equal(d.me.name, 'Ani Hakobyan');
});

t('a large schedule is split over several cache keys; a broken or mixed copy is ignored', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.SCHED_CHUNK = 100;
  const a = E.ctx.getData();
  const keys = Array.from(E.cacheStore.keys()).filter(k => /^sched\d+$/.test(k));
  assert.ok(keys.length > 3, keys.length + ' parts');
  assert.deepEqual(strip(E.ctx.getData('fast')), strip(a));
  E.cacheStore.set('sched1', 'someother|AAAA');
  assert.equal(JSON.parse(E.ctx.getData('fast')).cached, false, 'mixed parts: reads the sheet instead');
  E.cacheStore.set('sched', 'x|garbage');
  assert.equal(JSON.parse(E.ctx.getData('fast')).cached, false);
  E.cacheStore.clear();
  assert.equal(JSON.parse(E.ctx.getData('fast')).cached, false, 'empty cache');
});

t('cache errors never break the page', () => {
  const E = fresh('ani.hakobyan@example.org');
  E.ctx.CacheService = { getScriptCache: () => { throw new Error('Service unavailable'); } };
  const d = JSON.parse(E.ctx.getData('fast'));
  assert.equal(d.cached, false);
  assert.equal(d.weeks.length, 1);
});

t('Armenian text survives the gzip round trip', () => {
  const E = fresh('ani.hakobyan@example.org');
  const a = strip(E.ctx.getData());
  const b = strip(E.ctx.getData('fast'));
  assert.deepEqual(b, a);
  assert.match(JSON.stringify(b), /Ծրագրավորում 74/);
  assert.match(JSON.stringify(b), /Լոգոպեդ 11:00\u201312:00/);
});

/* ---------------- moving my group to another room (that week only) ---------------- */
const { put, colOf } = require('./fixtures');
const NL = String.fromCharCode(10);
const ROW = { 'Երկիր 1': 3, 'Երկիր 2': 4, 'Ասուպ 1': 5, 'Արեգակ': 6 };
function moveEnv(user) {
  const E = fresh(user || 'ani.hakobyan@example.org');
  const rules = E.ss.getSheetByName('Rules');
  rules.rows.push(['', 'Դասի տարածքի փոփոխություն']); rules.bgs.push(['#ffff00']);
  const wk = E.ss.getSheetByName(weekName);
  put(wk.rows, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽');
  put(wk.rows, 'Երկիր 2', 3, '16:00', ['EQ Lab 10 🔽', 'Անգլերեն 57 ↘️'].join(NL));
  return { E, wk, at: (room, day, time) => [ROW[room], colOf(day, time) + 1] };
}
const mv = (E, o) => JSON.parse(E.ctx.moveSession(Object.assign({ monday: dayIso(0) }, o)));

t('move: my group to a free room; cell moved, painted, noted, logged; administrator told', () => {
  const { E, wk, at } = moveEnv();
  const r = mv(E, { day: 2, room: 'Երկիր 1', to: 'Երկիր 2', parts: [{ time: '09:30', line: 'EQ Lab 10 🔽' }] });
  assert.equal(r.ok, true); assert.equal(r.to, 'Երկիր 2'); assert.equal(r.color, '#ffff00');
  assert.equal(r.start + '-' + r.end, '09:30-11:00');
  assert.equal(wk.cell(...at('Երկիր 1', 2, '09:30')), '');
  assert.equal(wk.cell(...at('Երկիր 2', 2, '09:30')), 'EQ Lab 10 🔽');
  assert.equal(wk.bg(...at('Երկիր 2', 2, '09:30')), '#ffff00');
  assert.match(wk.note(...at('Երկիր 2', 2, '09:30')), /Երկիր 1.*ani\.hakobyan@example\.org/);
  const log = E.ss.getSheetByName('Տարածքի փոփոխություններ');
  assert.ok(log, 'log tab created');
  assert.deepEqual(log.rows[1].slice(4), ['EQ Lab 10 🔽', 'Երկիր 1', 'Երկիր 2', 'Ani Hakobyan', 'ani.hakobyan@example.org']);
  const m = E.mail[E.mail.length - 1];
  assert.equal(m.to, 'coordinator@example.org');
  assert.match(m.subject, /^Տարածքի փոփոխություն · EQ Lab 10/);
  assert.match(m.htmlBody, /Երկիր 1[\s\S]*Երկիր 2/);
  const q = E.ss.getSheetByName('Փոփոխությունների հերթ');
  assert.equal(q.rows.filter(x => x[7] === 'pending').length, 2, 'queued for the group change notice');
  const d = JSON.parse(E.ctx.getData());
  const w = d.weeks[0].grid, si = w.slots.findIndex(s => s.day === 2 && s.time === '09:30');
  assert.equal(w.rooms.find(x => x.name === 'Երկիր 2').cells[si], 'EQ Lab 10 🔽');
  assert.equal(w.rooms.find(x => x.name === 'Երկիր 2').colors[si], '#ffff00');
});

t('move: only my own groups; the administrator may move any', () => {
  const { E } = moveEnv();
  throwsMsg(() => mv(E, { day: 0, room: 'Երկիր 1', to: 'Արեգակ', parts: [{ time: '16:00', line: 'Ծրագրավորում 74' }] }), /միայն ձեր խմբի/);
  E.user.email = 'coordinator@example.org';
  const n = E.mail.length;
  assert.equal(mv(E, { day: 0, room: 'Երկիր 1', to: 'Արեգակ', parts: [{ time: '16:00', line: 'Ծրագրավորում 74' }] }).to, 'Արեգակ');
  assert.equal(E.mail.length, n, 'the administrator is not e-mailed about her own move');
});

t('move: refused when the room is taken in the grid or by a booking', () => {
  const { E, wk } = moveEnv();
  put(wk.rows, 'Արեգակ', 2, '09:30', 'Պար 74');
  throwsMsg(() => mv(E, { day: 2, room: 'Երկիր 1', to: 'Արեգակ', parts: [{ time: '09:30', line: 'EQ Lab 10 🔽' }] }), /Արեգակ.*զբաղված.*Պար 74/);
  E.ctx.createBooking({ room: 'Ասուպ 1', date: dayIso(2), start: '10:00', end: '11:00', purpose: 'x' });
  throwsMsg(() => mv(E, { day: 2, room: 'Երկիր 1', to: 'Ասուպ 1', parts: [{ time: '09:30', line: 'EQ Lab 10 🔽' }] }), /Ասուպ 1.*զբաղված/);
});

t('move: only weeks with their own tab (not Total)', () => {
  const { E } = moveEnv();
  const t0 = new Date(), m0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - ((t0.getDay() + 6) % 7));
  throwsMsg(() => E.ctx.moveSession({ monday: fmt(m0, 'yyyy-MM-dd'), day: 0, room: 'Երկիր 2', to: 'Արեգակ', parts: [{ time: '09:30', line: 'Ֆինանսներ 74' }] }), /առանձին թերթիկ/);
});

t('move: in a cell with two lines only my line moves; back-to-back slots move together; a stale page is told', () => {
  const { E, wk, at } = moveEnv();
  mv(E, { day: 3, room: 'Երկիր 2', to: 'Ասուպ 1', parts: [{ time: '16:00', line: 'EQ Lab 10 🔽' }] });
  assert.equal(wk.cell(...at('Երկիր 2', 3, '16:00')), 'Անգլերեն 57 ↘️');
  assert.equal(wk.cell(...at('Ասուպ 1', 3, '16:00')), 'EQ Lab 10 🔽');
  put(wk.rows, 'Արեգակ', 4, '09:30', 'EQ Lab 10 🔽'); put(wk.rows, 'Արեգակ', 4, '11:00', 'EQ Lab 10 🔽');
  const r = mv(E, { day: 4, room: 'Արեգակ', to: 'Երկիր 2', parts: [{ time: '09:30', line: 'EQ Lab 10 🔽' }, { time: '11:00', line: 'EQ Lab 10 🔽' }] });
  assert.equal(r.start + '-' + r.end, '09:30-13:00');
  assert.equal(wk.cell(...at('Երկիր 2', 4, '09:30')), 'EQ Lab 10 🔽');
  assert.equal(wk.cell(...at('Երկիր 2', 4, '11:00')), 'EQ Lab 10 🔽');
  assert.equal(wk.cell(...at('Արեգակ', 4, '09:30')) + wk.cell(...at('Արեգակ', 4, '11:00')), '');
  throwsMsg(() => mv(E, { day: 4, room: 'Արեգակ', to: 'Ասուպ 1', parts: [{ time: '09:30', line: 'EQ Lab 10 🔽' }] }), /այլևս.*Թարմացրեք/);
});

t('change and weekly e-mails find the group even with arrows and hours in the cell', () => {
  const E = fresh('ani.hakobyan@example.org');
  const map = E.ctx.recipients_();
  assert.equal(E.ctx.findRecipient_(map, 'Ծրագրավորում 74 🔼').name, 'Ծրագրավորում 74');
  assert.equal(E.ctx.findRecipient_(map, 'EQ Lab 10 🔽 14։00-14։50').name, 'EQ Lab 10');
  assert.equal(E.ctx.findRecipient_(map, 'Ծրագրավորում 75 🔼'), null);
});

/* ---------------- joint sessions: «EQ Lab 10 🔽, Յոգա 77 🔽» ---------------- */
function jointEnv(user) {
  const E = moveEnv(user);
  const st = E.E.ss.getSheetByName('Staff').rows;
  st.find(r => r[0] === 'EQ Lab 10')[0] = 'EQ Lab 10, Յոգա 77';
  st.push(['Յոգա 77, EQ Lab 10', 'yoga.teacher@example.org', '', '', '', '']);
  st.push(['Պար 74', 'dance.teacher@example.org', '', '', '', '']);
  st.push(['Թատերարվեստ 74', 'theatre.teacher@example.org', '', '', '', '']);
  st.push(['Երաժշտ․ գործիք․74', 'music.teacher@example.org', '', '', '', '']);
  return E;
}

t('joint sessions: each cell goes to the group it starts with; single names still find their teacher', () => {
  const { E } = jointEnv();
  const map = E.ctx.recipients_(), who = c => { const r = E.ctx.findRecipient_(map, c); return r ? r.emails.join(',') : null; };
  assert.equal(who('EQ Lab 10 🔽, Յոգա 77 🔽'), 'ani.hakobyan@example.org');
  assert.equal(who('Յոգա 77 🔽, EQ Lab 10 🔽'), 'yoga.teacher@example.org');
  assert.equal(who('Յոգա 77 🔼․ EQ Lab 10 🔼'), 'yoga.teacher@example.org', 'Armenian full stop as the separator');
  assert.equal(who('EQ Lab 10 🔽'), 'ani.hakobyan@example.org', 'a cell that only says EQ Lab 10');
  assert.equal(who('Յոգա 77 🔽'), 'yoga.teacher@example.org');
  assert.equal(who('Պար 74 🔽, EQ Lab 10 🔼'), 'dance.teacher@example.org');
  assert.equal(who('Թատերարվեստ 74 , նաև ընդմիջման ժամանակ ներկայացում մինչև 17։15'), 'theatre.teacher@example.org');
  assert.equal(who('Երաժշտ․ գործիք․ 74 🔽'), 'music.teacher@example.org', 'abbreviation dots are not separators');
  assert.equal(who('Ծրագրավորում 74 🔼'), 'prog@example.org');
  assert.deepEqual(E.ctx.together_('1. Առողջ ապրելակերպ'), ['1. Առողջ ապրելակերպ']);
  assert.deepEqual(E.ctx.together_('Անի Հակոբյան,'), ['Անի Հակոբյան,']);
  assert.deepEqual(E.ctx.together_(E.ctx.cleanLine_('Ագրո․66 🔼')), ['Ագրո․66']);
});

t('joint sessions: the change e-mail reaches the group of that room', () => {
  const { E } = jointEnv();
  const q = E.ctx.queueSheet_();
  q.appendRow([new Date(), weekName, 'Երկիր 1', 2, '09:30', 'EQ Lab 10 🔽, Յոգա 77 🔽', '', 'pending', '']);
  q.appendRow([new Date(), weekName, 'Երկիր 2', 2, '09:30', '', 'EQ Lab 10 🔽, Յոգա 77 🔽', 'pending', '']);
  q.appendRow([new Date(), weekName, 'Արեգակ', 3, '16:00', '', 'Յոգա 77 🔽', 'pending', '']);
  const n = E.mail.length;
  E.ctx.flushChangeEmails();
  const subj = E.mail.slice(n).map(m => m.subject).sort();
  assert.deepEqual(subj, ['[ԹԵՍՏ] EQ Lab 10, Յոգա 77 · տարածքի փոփոխություն', '[ԹԵՍՏ] Յոգա 77, EQ Lab 10 · տարածքի փոփոխություն']);
  assert.match(E.mail.slice(n).find(m => /^\[ԹԵՍՏ\] EQ/.test(m.subject)).htmlBody, /ani\.hakobyan@example\.org[\s\S]*Տեղափոխվել է՝ Երկիր 1/);
});

t('joint sessions: the instructor moves her own room only', () => {
  const { E, wk, at } = jointEnv();
  put(wk.rows, 'Երկիր 1', 0, '16:00', '');
  put(wk.rows, 'Երկիր 1', 4, '16:00', 'EQ Lab 10 🔽, Յոգա 77 🔽');
  put(wk.rows, 'Արեգակ', 4, '16:00', 'Յոգա 77 🔽, EQ Lab 10 🔽');
  assert.equal(E.ctx.ownsLine_(['EQ Lab 10, Յոգա 77'], 'EQ Lab 10 🔽'), true);
  assert.equal(E.ctx.ownsLine_(['EQ Lab 10, Յոգա 77'], 'Յոգա 77 🔽, EQ Lab 10 🔽'), false);
  throwsMsg(() => mv(E, { day: 4, room: 'Արեգակ', to: 'Ասուպ 1', parts: [{ time: '16:00', line: 'Յոգա 77 🔽, EQ Lab 10 🔽' }] }), /միայն ձեր խմբի/);
  const r = mv(E, { day: 4, room: 'Երկիր 1', to: 'Ասուպ 1', parts: [{ time: '16:00', line: 'EQ Lab 10 🔽, Յոգա 77 🔽' }] });
  assert.equal(r.to, 'Ասուպ 1');
  assert.equal(wk.cell(...at('Ասուպ 1', 4, '16:00')), 'EQ Lab 10 🔽, Յոգա 77 🔽');
  E.user.email = 'yoga.teacher@example.org';
  assert.equal(mv(E, { day: 4, room: 'Արեգակ', to: 'Երկիր 1', parts: [{ time: '16:00', line: 'Յոգա 77 🔽, EQ Lab 10 🔽' }] }).to, 'Երկիր 1');
});

console.log('\n' + pass + ' passed');
