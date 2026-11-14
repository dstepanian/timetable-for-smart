/**
 * Room booking from the staff calendar page.
 *
 * Bookings are stored in their own tab («Ամրագրումներ»), never in the weekly
 * grids, so the administrator's schedule cannot be damaged; the page shows both
 * together. The web app runs as its owner, so staff need no access to the
 * spreadsheet: who is booking comes from their signed-in coaf.org account.
 *
 * Settings (Staff tab, columns E:F, all optional):
 *   Ամրագրման հաստատում      ON / OFF   ON = the administrator approves each booking
 *   Ամրագրման ժամեր          08:00-21:00
 *   Ամրագրման տևողություն    4          longest booking, in hours
 *   Ամրագրում քանի օր առաջ   60         how far ahead people may book
 */

var BOOK_SHEET = 'Ամրագրումներ';
var BOOK_HEAD = ['ID', 'Ամսաթիվ', 'Սկիզբ', 'Ավարտ', 'Տարածք', 'Ով', 'Էլ. հասցե', 'Նպատակ', 'Կարգավիճակ', 'Ստեղծվել է', 'Վերջին փոփոխություն', 'Խումբ'];
var B_OK = 'Հաստատված', B_WAIT = 'Սպասում է', B_CANCEL = 'Չեղարկված', B_REJECT = 'Մերժված';
var B_LABEL = { ok: B_OK, wait: B_WAIT, cancel: B_CANCEL, reject: B_REJECT };
var B_COL = { id: 1, date: 2, start: 3, end: 4, room: 5, name: 6, email: 7, purpose: 8, status: 9, created: 10, changed: 11, group: 12 };
var B_MAX_ACTIVE = 30;
var SHORT_HY = ['Երկ', 'Երք', 'Չրք', 'Հնգ', 'Ուրբ', 'Շբթ', 'Կիր'];
var B_RANGE_RE = /(\d{1,2})[:։.∶](\d{2})\s*[-\u2013\u2014]\s*(\d{1,2})[:։.∶](\d{2})/;
var B_LEAD_RE = /^(\d{1,2})[:։.∶](\d{2})(?!\d)/;

/* ---------------- who, settings, sheet ---------------- */

/** list: the bookings, when the caller has already read them (saves a read). */
function me_(list) {
  var email = '', owner = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim(); } catch (e) {}
  try { owner = String(Session.getEffectiveUser().getEmail() || '').trim(); } catch (e) {}
  var s = settings_();
  var admins = String(s.admin || '').split(/[,;\s]+/).concat([owner])
    .map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
  var low = email.toLowerCase(), isAdmin = !!low && admins.indexOf(low) >= 0;
  var g = low ? groupsFor_(low, isAdmin) : { own: [], all: [] };
  return {
    email: email, name: email ? (lastNameUsed_(low, list) || nameFromEmail_(email)) : '', isAdmin: isAdmin,
    groups: g.own, allGroups: g.all
  };
}

/** Groups from the Staff tab (Group | Email 1 | Email 2), in sheet order; repeated names are merged. */
function staffGroups_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var byKey = {}, out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
    var name = String(r[0]).replace(/\s+/g, ' ').trim();
    if (!name) return;
    var emails = [r[1], r[2]].map(function (x) { return String(x).trim().toLowerCase(); })
      .filter(function (x) { return x.indexOf('@') > 0; });
    var k = name.toLowerCase();
    if (!byKey[k]) { byKey[k] = { name: name, emails: [] }; out.push(byKey[k]); }
    byKey[k].emails = byKey[k].emails.concat(emails);
  });
  return out;
}

/** The groups someone may book for: their own (their e-mail is next to the group), and every group for an administrator. */
function groupsFor_(lowEmail, isAdmin) {
  var all = staffGroups_();
  return {
    own: all.filter(function (g) { return g.emails.indexOf(lowEmail) >= 0; }).map(function (g) { return g.name; }),
    all: isAdmin ? all.map(function (g) { return g.name; }) : []
  };
}

/** How a booking reads in the calendar and in e-mails: group, then purpose. */
function bookingLabel_(b) {
  return [b.group, b.purpose].filter(function (x) { return x; }).join(' · ');
}

function nameFromEmail_(email) {
  return String(email).split('@')[0].split(/[._-]+/).filter(Boolean)
    .map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
}

/** The name this person typed on their latest booking, if any. */
function lastNameUsed_(lowEmail, list) {
  list = list || readBookings_();
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].email.toLowerCase() === lowEmail && list[i].name) return list[i].name;
  }
  return '';
}

function bookCfg_() {
  var cfg = { approval: false, open: '08:00', close: '21:00', maxMin: 240, maxDays: 60 };
  var sh = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET);
  if (!sh) return cfg;
  sh.getRange(1, 5, 20, 2).getDisplayValues().forEach(function (r) {
    var k = String(r[0]).toLowerCase(), v = String(r[1]).trim();
    if (k.indexOf('ամրագր') < 0 || !v) return;
    if (k.indexOf('հաստատ') >= 0) cfg.approval = /^on/i.test(v);
    else if (k.indexOf('ժամեր') >= 0) {
      var m = v.match(B_RANGE_RE);
      if (m) { cfg.open = pad_(+m[1]) + ':' + m[2]; cfg.close = pad_(+m[3]) + ':' + m[4]; }
    } else if (k.indexOf('տևող') >= 0 || k.indexOf('տեւող') >= 0) {
      var h = parseFloat(v.replace(',', '.'));
      if (h > 0) cfg.maxMin = Math.round(h * 60);
    } else if (k.indexOf('օր') >= 0) {
      var d = parseInt(v, 10);
      if (d > 0) cfg.maxDays = d;
    }
  });
  return cfg;
}

function bookSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(BOOK_SHEET);
  if (sh) {
    /* tabs made before the group column existed get its header */
    var last = BOOK_HEAD.length;
    if (sh.getLastColumn() < last || !String(sh.getRange(1, last).getValue()).trim()) {
      sh.getRange(1, last).setValue(BOOK_HEAD[last - 1]).setFontWeight('bold').setBackground('#EDF0F6');
    }
    return sh;
  }
  sh = ss.insertSheet(BOOK_SHEET, ss.getSheets().length);
  sh.getRange(1, 1, 1, BOOK_HEAD.length).setValues([BOOK_HEAD]).setFontWeight('bold').setBackground('#EDF0F6');
  sh.setFrozenRows(1);
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, 1, n, BOOK_HEAD.length).setNumberFormat('@');
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([B_OK, B_WAIT, B_CANCEL, B_REJECT], true).setAllowInvalid(true).build();
  sh.getRange(2, B_COL.status, n, 1).setDataValidation(rule);
  [110, 90, 60, 60, 120, 150, 210, 260, 110, 130, 300, 150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/* ---------------- reading ---------------- */

function toMin_(t) { return (+String(t).slice(0, 2)) * 60 + (+String(t).slice(3, 5)); }
function hm_(m) { return pad_(Math.floor(m / 60)) + ':' + pad_(m % 60); }
function roomKey_(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function dateFromIso_(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function isoToDm_(iso) { var p = String(iso).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v); }

function isoDate_(v, tz) {
  if (isDate_(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v || '').trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + pad_(+m[2]) + '-' + pad_(+m[3]);
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/))) return m[3] + '-' + pad_(+m[2]) + '-' + pad_(+m[1]);
  return '';
}

function timeCell_(v, tz) {
  if (isDate_(v)) return Utilities.formatDate(v, tz, 'HH:mm');
  return normTime_(v);
}

function statusKey_(v) {
  v = String(v || '').trim().toLowerCase();
  if (v.indexOf('սպաս') >= 0) return 'wait';
  if (v.indexOf('մերժ') >= 0) return 'reject';
  if (v.indexOf('չեղ') >= 0) return 'cancel';
  return 'ok';
}

/** Every booking row, oldest first. Rows edited by hand are tolerated. */
function readBookings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(BOOK_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = Session.getScriptTimeZone();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, BOOK_HEAD.length).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    var id = String(r[0]).trim();
    var date = isoDate_(r[1], tz), st = timeCell_(r[2], tz), en = timeCell_(r[3], tz);
    if (!id || !date || !st || !en) return;
    out.push({
      row: i + 2, id: id, date: date, start: st, end: en,
      room: String(r[4]).trim(), name: String(r[5]).trim(), email: String(r[6]).trim(),
      purpose: String(r[7]).trim(), status: statusKey_(r[8]), group: String(r[11] || '').trim()
    });
  });
  return out;
}

function active_(b) { return b.status === 'ok' || b.status === 'wait'; }

/** What the page receives: recent and future bookings; e-mail addresses for administrators only. */
function bookingsForClient_(me, list) {
  var tz = Session.getScriptTimeZone();
  var from = Utilities.formatDate(addDays_(new Date(), -21), tz, 'yyyy-MM-dd');
  var mine = String(me.email || '').toLowerCase();
  return (list || readBookings_()).filter(function (b) {
    var own = !!mine && b.email.toLowerCase() === mine;
    return b.date >= from && (active_(b) || own);
  }).map(function (b) {
    var o = {
      id: b.id, date: b.date, start: b.start, end: b.end, room: b.room, name: b.name,
      purpose: b.purpose, group: b.group, status: b.status, mine: !!mine && b.email.toLowerCase() === mine
    };
    if (me.isAdmin) o.email = b.email;
    return o;
  });
}

/* ---------------- the schedule grid ---------------- */

function totalSheet_() {
  var found = null;
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    if (!found && sh.getName().trim().toLowerCase() === 'total') found = sh;
  });
  return found;
}

function gridForDate_(date) {
  var sh = sheetForWeek_(mondayOf_(date)) || totalSheet_();
  return sh ? parseGrid_(sh) : null;
}

function findRoom_(grid, name) {
  var k = roomKey_(name);
  for (var i = 0; i < grid.rooms.length; i++) if (roomKey_(grid.rooms[i].name) === k) return grid.rooms[i];
  return null;
}

/**
 * Busy intervals of one room on one day: [{s, e, text}] in minutes.
 * A slot runs until the next slot of the day (at most two hours). A cell that
 * lists its own hours ("16:00 Աննա", "Անահիտ 11:00-12:30") is busy only then;
 * a lone start time means a one-hour session.
 */
function gridBusy_(grid, room, day) {
  var idx = [];
  grid.slots.forEach(function (s, i) { if (s.day === day) idx.push(i); });
  var out = [];
  idx.forEach(function (si, k) {
    var text = String(room.cells[si] || '').trim();
    if (!text) return;
    var s0 = toMin_(grid.slots[si].time);
    var next = k + 1 < idx.length ? toMin_(grid.slots[idx[k + 1]].time) : s0 + 120;
    var e0 = Math.min(next, s0 + 120);
    if (e0 <= s0) e0 = s0 + 60;
    var timed = [];
    text.split(/\n+/).forEach(function (ln) {
      ln = ln.trim();
      var m = ln.match(B_RANGE_RE);
      if (m && +m[1] < 24 && +m[3] < 24) {
        var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
        if (b > a) { timed.push({ s: a, e: b, text: ln }); return; }
      }
      m = ln.match(B_LEAD_RE);
      if (m && +m[1] < 24) { var c = +m[1] * 60 + +m[2]; timed.push({ s: c, e: c + 60, text: ln }); }
    });
    if (timed.length) out = out.concat(timed);
    else out.push({ s: s0, e: e0, text: text.replace(/\s+/g, ' ') });
  });
  return out;
}

/** Human-readable clashes for a room/date/time, from the schedule and from other bookings. */
function conflicts_(roomName, iso, s, e, ignoreId) {
  var out = [], d = dateFromIso_(iso);
  var grid = gridForDate_(d);
  var room = grid ? findRoom_(grid, roomName) : null;
  if (room) {
    gridBusy_(grid, room, (d.getDay() + 6) % 7).forEach(function (b) {
      if (b.s < e && s < b.e) out.push(hm_(b.s) + '-' + hm_(b.e) + ' · ' + b.text);
    });
  }
  readBookings_().forEach(function (b) {
    if (b.id === ignoreId || !active_(b) || b.date !== iso || roomKey_(b.room) !== roomKey_(roomName)) return;
    if (toMin_(b.start) < e && s < toMin_(b.end)) {
      out.push(b.start + '-' + b.end + ' · ' + (bookingLabel_(b) || 'ամրագրում') + (b.name ? ' (' + b.name + ')' : ''));
    }
  });
  return out;
}

/* ---------------- actions called from the page ---------------- */

function createBooking(p) {
  p = p || {};
  var me = me_();
  if (!me.email) throw new Error('Չհաջողվեց պարզել ձեր հաշիվը։ Բացեք էջը ձեր coaf.org հաշվով և փորձեք նորից։');
  var cfg = bookCfg_(), tz = Session.getScriptTimeZone(), now = new Date();
  var iso = isoDate_(p.date, tz), start = normTime_(p.start), end = normTime_(p.end);
  var purpose = String(p.purpose || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  var name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || me.name;
  if (!p.room) throw new Error('Ընտրեք տարածքը։');
  if (!iso) throw new Error('Նշեք օրը։');
  if (!start || !end) throw new Error('Նշեք սկզբի և ավարտի ժամը։');
  var group = String(p.group || '').replace(/\s+/g, ' ').trim();
  if (group) {
    var allowed = me.groups.concat(me.allGroups || []);
    var gi = allowed.map(function (x) { return x.toLowerCase(); }).indexOf(group.toLowerCase());
    if (gi < 0) throw new Error('«' + group + '» խումբը Staff ցանկում ձեր էլ. հասցեի հետ կապված չէ։');
    group = allowed[gi];
  }
  if (!purpose && !group) throw new Error('Ընտրեք խումբը կամ գրեք, թե ինչի համար է ամրագրումը։');
  var s = toMin_(start), e = toMin_(end);
  if (e <= s) throw new Error('Ավարտի ժամը պետք է լինի սկզբից հետո։');
  if (e - s > cfg.maxMin) throw new Error('Մեկ ամրագրումը կարող է լինել առավելագույնը ' + (cfg.maxMin / 60) + ' ժամ։');
  if (s < toMin_(cfg.open) || e > toMin_(cfg.close)) throw new Error('Ամրագրել կարելի է ' + cfg.open + '-' + cfg.close + ' ժամերին։');
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var nowMin = toMin_(Utilities.formatDate(now, tz, 'HH:mm'));
  if (iso < today || (iso === today && s < nowMin - 10)) throw new Error('Անցած ժամի համար ամրագրել հնարավոր չէ։');
  if (iso > Utilities.formatDate(addDays_(now, cfg.maxDays), tz, 'yyyy-MM-dd')) {
    throw new Error('Ամրագրել կարելի է առավելագույնը ' + cfg.maxDays + ' օր առաջ։');
  }
  var grid = gridForDate_(dateFromIso_(iso));
  var room = grid ? findRoom_(grid, p.room) : null;
  if (!room) throw new Error('«' + p.room + '» տարածքը չկա այդ շաբաթվա ժամանակացույցում։');

  var booking, lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var clash = conflicts_(room.name, iso, s, e, null);
    if (clash.length) throw new Error('Այս ժամին «' + room.name + '»-ը զբաղված է՝ ' + clash[0]);
    if (!me.isAdmin) {
      var mine = readBookings_().filter(function (b) { return active_(b) && b.date >= today && b.email.toLowerCase() === me.email.toLowerCase(); });
      if (mine.length >= B_MAX_ACTIVE) throw new Error('Դուք արդեն ունեք ' + mine.length + ' առաջիկա ամրագրում։ Չեղարկեք ավելորդները և փորձեք նորից։');
    }
    var status = cfg.approval && !me.isAdmin ? 'wait' : 'ok';
    var id = 'B' + Utilities.formatDate(now, tz, 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    var stamp = Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm');
    var sh = bookSheet_();
    var row = sh.getLastRow() + 1;
    var rng = sh.getRange(row, 1, 1, BOOK_HEAD.length);
    rng.setNumberFormat('@');
    rng.setValues([[id, isoToDm_(iso), start, end, room.name, name, me.email, purpose, B_LABEL[status], stamp, '', group]]);
    SpreadsheetApp.flush();
    booking = { id: id, date: iso, start: start, end: end, room: room.name, name: name, email: me.email, purpose: purpose, group: group, status: status };
  } finally {
    lock.releaseLock();
  }
  try { notifyBooking_('new', booking, me); } catch (err) { log_('Ամրագրում', 'նամակի սխալ', String(err)); }
  log_('Ամրագրում', B_LABEL[booking.status], booking.room + ' ' + booking.date + ' ' + booking.start + '-' + booking.end + (group ? ' · ' + group : '') + ' · ' + me.email);
  return JSON.stringify({ ok: true, booking: booking });
}

function cancelBooking(id) { return changeBooking_(id, 'cancel', ''); }
function approveBooking(id) { return changeBooking_(id, 'approve', ''); }
function rejectBooking(id, reason) { return changeBooking_(id, 'reject', reason); }

function changeBooking_(id, action, reason) {
  var me = me_();
  if (!me.email) throw new Error('Չհաջողվեց պարզել ձեր հաշիվը։');
  reason = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  var tz = Session.getScriptTimeZone(), b = null, lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var list = readBookings_();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) { b = list[i]; break; }
    if (!b) throw new Error('Ամրագրումը չի գտնվել։ Թարմացրեք էջը։');
    var own = b.email.toLowerCase() === me.email.toLowerCase();
    if (action === 'cancel') {
      if (!own && !me.isAdmin) throw new Error('Կարող եք չեղարկել միայն ձեր ամրագրումները։');
      if (!active_(b)) throw new Error('Այս ամրագրումն արդեն ' + B_LABEL[b.status].toLowerCase() + ' է։');
    } else {
      if (!me.isAdmin) throw new Error('Հաստատել կամ մերժել կարող է միայն ադմինիստրատորը։');
      if (b.status !== 'wait') throw new Error('Այս ամրագրումն արդեն ' + B_LABEL[b.status].toLowerCase() + ' է։');
      if (action === 'approve') {
        var clash = conflicts_(b.room, b.date, toMin_(b.start), toMin_(b.end), b.id);
        if (clash.length) throw new Error('Հնարավոր չէ հաստատել․ այդ ժամին զբաղված է՝ ' + clash[0]);
      }
    }
    var key = action === 'approve' ? 'ok' : action;
    var sh = bookSheet_();
    sh.getRange(b.row, B_COL.status).setValue(B_LABEL[key]);
    sh.getRange(b.row, B_COL.changed).setNumberFormat('@').setValue(
      B_LABEL[key] + ' · ' + me.email + ' · ' + Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm') + (reason ? ' · ' + reason : ''));
    SpreadsheetApp.flush();
    b.status = key;
    b.reason = reason;
  } finally {
    lock.releaseLock();
  }
  try { notifyBooking_(action, b, me); } catch (err) { log_('Ամրագրում', 'նամակի սխալ', String(err)); }
  log_('Ամրագրում', B_LABEL[b.status], b.room + ' ' + b.date + ' ' + b.start + '-' + b.end + ' · ' + me.email);
  return JSON.stringify({ ok: true, id: b.id, status: b.status });
}

/* ---------------- e-mail ---------------- */

/**
 * The administrator hears about new bookings and requests and about bookings
 * people cancel themselves; the person who booked hears when someone else
 * approves, rejects or cancels their booking. Nobody is told about their own action.
 */
function notifyBooking_(action, b, me) {
  var s = settings_();
  var cfg = bookCfg_();
  var adminEmails = String(s.admin || '').split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') > 0; });
  var meLow = me.email.toLowerCase(), byOwner = b.email.toLowerCase() === meLow;
  var d = dateFromIso_(b.date), dayIdx = (d.getDay() + 6) % 7;
  var when = SHORT_HY[dayIdx] + ' ' + dm_(d) + ' ' + b.start + '-' + b.end;
  var rows = row_(['<b>Տարածք</b>', '<b>' + esc_(b.room) + '</b>']) +
    row_(['<b>Օր</b>', esc_(DAYS_HY[dayIdx]) + ', ' + esc_(isoToDm_(b.date))]) +
    row_(['<b>Ժամ</b>', '<span style="font-family:Consolas,monospace">' + esc_(b.start + '-' + b.end) + '</span>']) +
    (b.group ? row_(['<b>Խումբ</b>', '<b>' + esc_(b.group) + '</b>']) : '') +
    (b.purpose ? row_(['<b>Նպատակ</b>', esc_(b.purpose)]) : '') +
    row_(['<b>Ով</b>', esc_(b.name || '') + ' <span style="color:#8C96AA">' + esc_(b.email) + '</span>']) +
    (b.reason ? row_(['<b>Պատճառ</b>', esc_(b.reason)]) : '');
  var table = '<table style="border-collapse:collapse;width:100%">' + rows + '</table>';

  if (action === 'new') {
    var toAdmins = adminEmails.filter(function (x) { return x.toLowerCase() !== meLow; });
    if (!toAdmins.length) return;
    var isReq = b.status === 'wait';
    var title = isReq ? 'Ամրագրման հայտ' : 'Նոր ամրագրում';
    var sub = isReq ? 'Հաստատեք կամ մերժեք օրացույցի «Ամրագրումներ» բաժնում։' : 'Ամրագրումն արդեն երևում է օրացույցում։ Անհրաժեշտության դեպքում կարող եք չեղարկել այն «Ամրագրումներ» բաժնում։';
    sendBooking_(toAdmins, title + ' · ' + b.room + ' · ' + when, shell_(title + ' · ' + b.room, sub, table, s), b.email, s, true);
    return;
  }
  if (action === 'cancel' && byOwner) {
    var admins2 = adminEmails.filter(function (x) { return x.toLowerCase() !== meLow; });
    if (admins2.length) sendBooking_(admins2, 'Ամրագրումը չեղարկվեց · ' + b.room + ' · ' + when,
      shell_('Ամրագրումը չեղարկվեց · ' + b.room, 'Տարածքը կրկին ազատ է։', table, s), b.email, s, true);
    return;
  }
  if (byOwner) return;
  var subj = { approve: 'Ձեր ամրագրումը հաստատվեց', reject: 'Ձեր ամրագրման հայտը մերժվեց', cancel: 'Ձեր ամրագրումը չեղարկվեց' }[action];
  var note = { approve: 'Տարածքը ձերն է նշված ժամին։', reject: 'Կարող եք ընտրել այլ ժամ կամ տարածք օրացույցում։', cancel: 'Ադմինիստրատորը չեղարկել է այս ամրագրումը։' }[action];
  sendBooking_([b.email], subj + ' · ' + b.room + ' · ' + when, shell_(subj, note, table, s), adminEmails[0] || '', s, false);
}

/** Like send_, with a reply-to. Messages to administrators skip test mode: they are meant for them anyway. */
function sendBooking_(emails, subject, html, replyTo, s, toAdmin) {
  emails = emails.filter(function (x) { return x && String(x).indexOf('@') > 0; });
  var test = s.test && !toAdmin;
  var to = test ? (s.admin || Session.getEffectiveUser().getEmail()) : emails.join(',');
  if (!to) return false;
  var note = test
    ? '<p style="margin:0 0 14px;padding:8px 12px;background:#FCEFDC;border:1px solid #E28B22;border-radius:8px;font:13px Arial,sans-serif;color:#7a4b00">' +
      'ԹԵՍՏԱՅԻՆ ՌԵԺԻՄ․ այս նամակը իրական հասցեատիրոջը չի ուղարկվել։ Հասցեատերը՝ ' + esc_(emails.join(', ')) + '</p>'
    : '';
  var opt = { to: to, subject: (test ? '[ԹԵՍՏ] ' : '') + subject, htmlBody: note + html, name: 'Տարածքների օրացույց' };
  if (replyTo) opt.replyTo = replyTo;
  MailApp.sendEmail(opt);
  return true;
}

/* ---------------- moving one's own group to another room (that week only) ----------------
 * An instructor moves a session of his own group (Staff tab: his e-mail next to the group)
 * to a room that is free at that time. Only the weekly tab of that week changes; Total and
 * other weeks stay as they are. The moved cell gets the Rules colour for a room change and a
 * note saying who moved it; the administrator gets an e-mail; the change is logged.
 */

var MOVE_SHEET = 'Տարածքի փոփոխություններ';
var MOVE_HEAD = ['Երբ', 'Շաբաթ', 'Օր', 'Ժամ', 'Դաս', 'Որտեղից', 'Ուր', 'Ով', 'Էլ. հասցե'];
var NL_ = String.fromCharCode(10);
var PIC_RE_ = /[\p{Extended_Pictographic}\p{Mn}\p{Cf}]/gu;

/** «Ծրագրավորում 74 🔼» -> program key «ծրագրավորում», group «74» (the same rules as the page).
 *  A joint session «EQ Lab 7 🔽, Յոգա 74 🔽» counts as its first group, EQ Lab 7. */
function progOf_(line) {
  var s = together_(cleanLine_(line))[0];
  var grp = '', m;
  if ((m = s.match(/^(\p{L}\d{1,2})\s+(\S.*)$/u))) { grp = m[1]; s = m[2]; }
  else if ((m = s.match(/^(.*\p{L}\D*?)\s*(\d{1,3})$/u))) { grp = m[2]; s = m[1]; }
  var name = s.replace(/[\s.,;:․·+-]+$/u, '').trim();
  var key = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return key.length >= 2 ? { key: key, name: name, group: grp } : null;
}
function sameProg_(a, b) {
  var lo = Math.min(a.length, b.length), hi = Math.max(a.length, b.length);
  return a === b || (lo >= 3 && lo / hi >= 0.75 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
}
/** The line is one of these Staff groups: same program and the same group number. */
function ownsLine_(groups, line) {
  var p = progOf_(line);
  if (!p) return false;
  return (groups || []).some(function (g) {
    var q = progOf_(g);
    return q && q.group === p.group && sameProg_(q.key, p.key);
  });
}

/** Minutes a line in a slot occupies: its own hours if it has them, else the slot. */
function slotSpan_(g, slot, line) {
  var list = g.slots.filter(function (s) { return s.day === slot.day; });
  var k = list.indexOf(slot), s0 = toMin_(slot.time);
  var next = k + 1 < list.length ? toMin_(list[k + 1].time) : s0 + 120;
  var e0 = Math.min(next, s0 + 120);
  if (e0 <= s0) e0 = s0 + 60;
  var m = line.match(B_RANGE_RE);
  if (m && +m[1] < 24 && +m[3] < 24) {
    var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (b > a) return { s: a, e: b };
  }
  m = line.match(B_LEAD_RE);
  if (m && +m[1] < 24) { var c = +m[1] * 60 + +m[2]; return { s: c, e: c + 60 }; }
  return { s: s0, e: e0 };
}

/** The Rules colour whose label talks about a room change («Դասի տարածքի փոփոխություն»). */
function moveColor_() {
  var L = parseLegend_();
  for (var i = 0; i < L.length; i++) {
    var t = String(L[i].label || '').toLowerCase();
    if (t.indexOf('տարածք') >= 0 && t.indexOf('փոփոխ') >= 0) return L[i].color;
  }
  return '#ffff00';
}

function moveSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(MOVE_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(MOVE_SHEET, ss.getSheets().length);
  sh.getRange(1, 1, 1, MOVE_HEAD.length).setValues([MOVE_HEAD]).setFontWeight('bold').setBackground('#EDF0F6');
  sh.setFrozenRows(1);
  [130, 190, 130, 110, 260, 140, 140, 150, 210].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/**
 * p = {monday: 'yyyy-MM-dd', day: 0-6, room, to, parts: [{time: '16:00', line: 'Ծրագրավորում 74 🔼'}]}
 * parts: the slots of one session (two when it runs over back-to-back slots).
 */
function moveSession(p) {
  p = p || {};
  var me = me_();
  if (!me.email) throw new Error('Չհաջողվեց պարզել ձեր հաշիվը։ Բացեք էջը ձեր coaf.org հաշվով և փորձեք նորից։');
  var tz = Session.getScriptTimeZone(), now = new Date();
  var mIso = isoDate_(p.monday, tz), day = +p.day;
  var parts = (p.parts || []).map(function (x) { return { time: normTime_(x && x.time), line: String(x && x.line || '').trim() }; })
    .filter(function (x) { return x.time && x.line; });
  if (!mIso || !(day >= 0 && day <= 6) || !p.room || !p.to || !parts.length) throw new Error('Տվյալները թերի են։ Թարմացրեք էջը և փորձեք նորից։');
  var monday = mondayOf_(dateFromIso_(mIso));
  var sh = sheetForWeek_(monday);
  if (!sh) throw new Error('Այս շաբաթի համար առանձին թերթիկ դեռ չկա (ցուցադրվում է Total-ը), ուստի տարածքը փոխել հնարավոր չէ։ Դիմեք ադմինիստրատորին։');
  var date = addDays_(monday, day), iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var res, lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var g = parseGridFull_(sh);
    if (!g) throw new Error('Շաբաթվա թերթիկը չհաջողվեց կարդալ։');
    var from = null, to = null;
    g.rooms.forEach(function (r) {
      if (!from && roomKey_(r.name) === roomKey_(p.room)) from = r;
      if (!to && roomKey_(r.name) === roomKey_(p.to)) to = r;
    });
    if (!from) throw new Error('«' + p.room + '» տարածքը չկա այս շաբաթվա թերթիկում։');
    if (!to) throw new Error('«' + p.to + '» տարածքը չկա այս շաբաթվա թերթիկում։');
    if (from.row === to.row) throw new Error('Ընտրեք այլ տարածք։');
    var span = null;
    var cells = parts.map(function (pt) {
      var slot = null;
      g.slots.forEach(function (s) { if (!slot && s.day === day && s.time === pt.time) slot = s; });
      if (!slot) throw new Error(pt.time + ' ժամային հատվածը չի գտնվել։ Թարմացրեք էջը։');
      var lines = String(g.values[from.row - 1][slot.col - 1] || '').split(NL_);
      var li = -1;
      lines.forEach(function (x, i) { if (li < 0 && x.trim() === pt.line) li = i; });
      if (li < 0) throw new Error('«' + pt.line + '»-ն այլևս «' + from.name + '»-ում չէ։ Թարմացրեք էջը։');
      if (!me.isAdmin && !ownsLine_(me.groups, pt.line)) throw new Error('Կարող եք փոխել միայն ձեր խմբի դասի տարածքը։ «' + pt.line + '»-ը Staff ցանկում ձեր էլ. հասցեի հետ կապված չէ։');
      var busy = String(g.values[to.row - 1][slot.col - 1] || '').trim();
      if (busy) throw new Error('«' + to.name + '»-ը ' + slot.time + '-ին զբաղված է՝ ' + busy.replace(/\s+/g, ' '));
      var t = slotSpan_(g, slot, pt.line);
      span = span ? { s: Math.min(span.s, t.s), e: Math.max(span.e, t.e) } : t;
      return { slot: slot, lines: lines, li: li, line: pt.line };
    });
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), nowMin = toMin_(Utilities.formatDate(now, tz, 'HH:mm'));
    if (iso < today || (iso === today && span.e <= nowMin)) throw new Error('Անցած դասի տարածքը փոխել հնարավոր չէ։');
    var clash = conflicts_(to.name, iso, span.s, span.e, null);
    if (clash.length) throw new Error('«' + to.name + '»-ը այդ ժամին զբաղված է՝ ' + clash[0]);

    var color = moveColor_(), stamp = Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm');
    var note = 'Տեղափոխված է «' + from.name + '»-ից · ' + (me.name || me.email) + ' (' + me.email + ') · ' + stamp;
    cells.forEach(function (c) {
      var rest = c.lines.filter(function (x, i) { return i !== c.li && x.trim(); }).join(NL_);
      var src = sh.getRange(from.row, c.slot.col), dst = sh.getRange(to.row, c.slot.col);
      dst.setValue(c.line);
      dst.setBackground(color);
      dst.setNote(note);
      if (rest) src.setValue(rest);
      else { src.setValue(''); src.setBackground(null); }
    });
    SpreadsheetApp.flush();
    var times = parts.map(function (x) { return x.time; });
    res = { ok: true, week: sh.getName(), day: day, date: iso, from: from.name, to: to.name, color: color,
            parts: parts, start: hm_(span.s), end: hm_(span.e), line: parts[0].line };
    try {
      moveSheet_().appendRow([stamp, sh.getName().trim(), DAYS_HY[day] + ' ' + dm_(date), res.start + '-' + res.end, res.line, from.name, to.name, me.name || '', me.email]);
    } catch (err) {}
    /* the group's teachers hear about it the same way as about the administrator's own edits */
    try {
      if (settings_().changes) {
        var q = queueSheet_(), qrows = [];
        times.forEach(function (tm) {
          qrows.push([now, sh.getName(), from.name, day, tm, res.line, '', 'pending', '']);
          qrows.push([now, sh.getName(), to.name, day, tm, '', res.line, 'pending', '']);
        });
        q.getRange(q.getLastRow() + 1, 1, qrows.length, 9).setValues(qrows);
      }
    } catch (err) {}
    /* the saved copy of the schedule is out of date now */
    try { CacheService.getScriptCache().remove(SCHED_KEY); } catch (err) {}
  } finally {
    lock.releaseLock();
  }
  try { notifyMove_(res, me); } catch (err) { log_('Տարածքի փոփոխություն', 'նամակի սխալ', String(err)); }
  log_('Տարածքի փոփոխություն', res.from + ' -> ' + res.to, res.line + ' · ' + res.date + ' ' + res.start + ' · ' + me.email);
  return JSON.stringify(res);
}

/** The administrator hears about every move made by someone else. */
function notifyMove_(r, me) {
  var s = settings_();
  var meLow = me.email.toLowerCase();
  var admins = String(s.admin || '').split(/[,;\s]+/).filter(function (x) { return x.indexOf('@') > 0 && x.toLowerCase() !== meLow; });
  if (!admins.length) return;
  var d = dateFromIso_(r.date), di = (d.getDay() + 6) % 7;
  var rows = row_(['<b>Դաս</b>', '<b>' + esc_(r.line) + '</b>']) +
    row_(['<b>Օր</b>', esc_(DAYS_HY[di]) + ', ' + esc_(isoToDm_(r.date))]) +
    row_(['<b>Ժամ</b>', '<span style="font-family:Consolas,monospace">' + esc_(r.start + '-' + r.end) + '</span>']) +
    row_(['<b>Որտեղից</b>', esc_(r.from)]) +
    row_(['<b>Ուր</b>', '<b>' + esc_(r.to) + '</b>']) +
    row_(['<b>Ով</b>', esc_(me.name || '') + ' <span style="color:#8C96AA">' + esc_(me.email) + '</span>']);
  var table = '<table style="border-collapse:collapse;width:100%">' + rows + '</table>';
  var sub = 'Փոփոխությունն արդեն գրված է «' + r.week.trim() + '» թերթիկում (դեղին գույնով, նշումով)։ Անհրաժեշտության դեպքում կարող եք այն ետ բերել ձեռքով։';
  sendBooking_(admins, 'Տարածքի փոփոխություն · ' + r.line + ' · ' + SHORT_HY[di] + ' ' + dm_(d) + ' ' + r.start,
    shell_('Տարածքի փոփոխություն · ' + r.to, sub, table, s), me.email, s, true);
}
