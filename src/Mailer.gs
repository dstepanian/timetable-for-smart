/**
 * Email notifications for the room schedule.
 *  - Weekly digest (optional, OFF by default in the Staff settings): every group
 *    gets its rooms/times for the week (Monday 09:00).
 *  - Change notice: when the administrator edits a weekly tab, the affected
 *    groups get an email; changes are batched every 10 minutes.
 * Addresses live in the "Staff" tab: Group | Email 1 | Email 2, with a small
 * settings block in columns E:F.
 */

var STAFF_SHEET = 'Staff';
var QUEUE_SHEET = 'Փոփոխությունների հերթ';
var LOG_SHEET = 'Նամակների լոգ';
var DAYS_HY = ['Երկուշաբթի', 'Երեքշաբթի', 'Չորեքշաբթի', 'Հինգշաբթի', 'Ուրբաթ', 'Շաբաթ', 'Կիրակի'];

/* ---------------- settings & recipients ---------------- */

function settings_() {
  var out = { admin: '', weekly: true, changes: true, test: true, url: '' };
  var sh = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET);
  if (!sh) return out;
  var v = sh.getRange(1, 5, 20, 2).getDisplayValues();
  v.forEach(function (r) {
    var k = String(r[0]).toLowerCase(), val = String(r[1]).trim();
    if (!k || k.indexOf('ամրագր') >= 0) return; /* booking rows: Booking.gs */
    /* "Թեստային ռեժիմ միայն ադմինիստրատորին" mentions the administrator too, so test first */
    if (k.indexOf('թեստ') >= 0) out.test = /^on/i.test(val);
    else if (k.indexOf('շաբաթական') >= 0) out.weekly = /^on/i.test(val);
    else if (k.indexOf('փոփոխ') >= 0) out.changes = /^on/i.test(val);
    else if (k.indexOf('հղում') >= 0) out.url = val;
    else if (k.indexOf('ադմին') >= 0 && val.indexOf('@') > 0) out.admin = val;
  });
  return out;
}

/** "Երաժշտ․ գործիք․74" and "Երաժշտ. գործ 74" produce a comparable key.
 *  Arrows and hours in a cell ("Ծրագրավորում 74 🔼", "... 72 🔽 14։00-14։50") are ignored. */
function groupKey_(s) {
  s = String(s || '').replace(/[\p{Extended_Pictographic}\p{Mn}\p{Cf}]/gu, ' ')
    .replace(new RegExp(B_RANGE_RE.source, 'g'), ' ').replace(/\d{1,2}[:։.∶]\d{2}/g, ' ')
    .replace(/\s+/g, ' ').trim();
  var m = s.match(/(\d+)\s*$/);
  var num = m ? m[1] : '';
  var letters = s.replace(/\d+\s*$/, '').toLowerCase().replace(/[^\p{L}]/gu, '');
  return letters + '#' + num;
}

/** Joint sessions: «EQ Lab 7 🔽, Յոգա 74 🔽» is EQ Lab 7 in this room, together with Յոգա 74.
 *  A comma (or «․») right after a group number starts the next group; the first group is the
 *  one the cell belongs to. Lines without such a comma stay whole. */
var TOGETHER_RE_ = /(\d)\s*[,;․.]\s*(?=\p{L})/u;
function cleanLine_(s) {
  return String(s || '').replace(/[\p{Extended_Pictographic}\p{Mn}\p{Cf}]/gu, ' ')
    .replace(new RegExp(B_RANGE_RE.source, 'g'), ' ').replace(/\d{1,2}[:։.∶]\d{2}/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^\d{1,2}\s*[.․)]\s+/, '');
}
function together_(s) {
  s = String(s || '').trim();
  var parts = [], rest = s, m;
  while ((m = rest.match(TOGETHER_RE_))) { parts.push(rest.slice(0, m.index + 1).trim()); rest = rest.slice(m.index + m[0].length); }
  parts.push(rest.trim());
  parts = parts.filter(function (x) { return x; });
  return parts.length > 1 && parts.every(function (x) { return /\p{L}/u.test(x); }) ? parts : [s];
}
/** «EQ Lab 7 🔽, Յոգա 74 🔽» -> «EQ Lab 7»; '' when the line is not a joint session. */
function mainGroup_(s) {
  var p = together_(cleanLine_(s));
  return p.length > 1 ? p[0] : '';
}

function recipients_() {
  var map = {}, list = [];
  var sh = SpreadsheetApp.getActive().getSheetByName(STAFF_SHEET);
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
    var name = String(r[0]).trim();
    if (!name) return;
    var emails = [r[1], r[2]].map(function (x) { return String(x).trim(); })
      .filter(function (x) { return x.indexOf('@') > 0; });
    if (!emails.length) return;
    map[groupKey_(name)] = { name: name, emails: emails };
    list.push(name);
  });
  /* Staff «EQ Lab 7, Յոգա 74» also gets the cells that only say «EQ Lab 7» */
  list.forEach(function (name) {
    var main = mainGroup_(name), k = main ? groupKey_(main) : '';
    if (k && !map[k]) map[k] = map[groupKey_(name)];
  });
  return map;
}

function findRecipient_(map, activity) {
  var k = groupKey_(activity);
  if (map[k]) return map[k];
  /* a joint session goes to the group it belongs to in that room (the first one) */
  var main = mainGroup_(activity);
  if (main) { k = groupKey_(main); if (map[k]) return map[k]; }
  var p = k.split('#'), letters = p[0], num = p[1];
  if (!letters) return null;
  for (var kk in map) {
    var q = kk.split('#');
    if (q[1] === num && (q[0].indexOf(letters) === 0 || letters.indexOf(q[0]) === 0)) return map[kk];
  }
  return null;
}

/* ---------------- dates & grid ---------------- */

function pad_(n) { return (n < 10 ? '0' : '') + n; }
function dm_(d) { return pad_(d.getDate()) + '.' + pad_(d.getMonth() + 1); }
function addDays_(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function sheetForWeek_(monday) {
  var found = null;
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    var m = sh.getName().match(WEEK_RE);
    if (m && +m[1] === monday.getDate() && +m[2] === monday.getMonth() + 1) found = sh;
  });
  return found;
}

/** Monday date implied by a tab called "Weekly schedule dd.mm-dd.mm". */
function mondayFromSheetName_(name) {
  var m = String(name).match(WEEK_RE);
  if (!m) return null;
  var today = new Date(), best = null;
  [-1, 0, 1].forEach(function (off) {
    var d = new Date(today.getFullYear() + off, +m[2] - 1, +m[1]);
    if (!best || Math.abs(d - today) < Math.abs(best - today)) best = d;
  });
  return best;
}

/** Like parseGrid_, but keeps the sheet row/column of every room and slot. */
function parseGridFull_(sh) {
  var v = sh.getDataRange().getDisplayValues();
  if (v.length < 3) return null;
  var slotByCol = {}, slots = [], day = 0, prev = -1;
  for (var c = 2; c < v[1].length; c++) {
    var t = normTime_(v[1][c]);
    if (!t) continue;
    var mins = (+t.slice(0, 2)) * 60 + (+t.slice(3));
    if (prev >= 0 && mins <= prev) day++;
    prev = mins;
    if (day > 6) break;
    var slot = { col: c + 1, day: day, time: t };
    slots.push(slot);
    slotByCol[c + 1] = slot;
  }
  var roomByRow = {}, rooms = [];
  for (var r = 2; r < v.length; r++) {
    var name = String(v[r][0]).trim(), desc = String(v[r][1]).trim();
    if (!name && !desc) { if (rooms.length) break; else continue; }
    var room = { row: r + 1, name: name || desc, desc: name ? desc : '' };
    rooms.push(room);
    roomByRow[r + 1] = room;
  }
  return { slots: slots, slotByCol: slotByCol, rooms: rooms, roomByRow: roomByRow, values: v };
}

/* ---------------- sending ---------------- */

function send_(emails, subject, html, s) {
  var fallback = s.admin || Session.getEffectiveUser().getEmail();
  var to = s.test ? fallback : emails.join(',');
  if (!to) return false;
  var note = s.test
    ? '<p style="margin:0 0 14px;padding:8px 12px;background:#FCEFDC;border:1px solid #E28B22;border-radius:8px;font:13px Arial,sans-serif;color:#7a4b00">' +
      'ԹԵՍՏԱՅԻՆ ՌԵԺԻՄ․ այս նամակը իրական հասցեատերերին չի ուղարկվել։ Իրական հասցեներն են՝ ' + emails.join(', ') + '</p>'
    : '';
  MailApp.sendEmail({
    to: to,
    subject: (s.test ? '[ԹԵՍՏ] ' : '') + subject,
    htmlBody: note + html,
    name: 'Տարածքների օրացույց'
  });
  return true;
}

function shell_(title, sub, bodyHtml, s) {
  return '<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#131D36;max-width:640px">' +
    '<h2 style="margin:0 0 2px;font-size:19px">' + esc_(title) + '</h2>' +
    '<div style="color:#5B6680;font-size:13px;margin-bottom:16px">' + esc_(sub) + '</div>' +
    bodyHtml +
    (s.url ? '<p style="margin-top:18px"><a href="' + esc_(s.url) + '" style="color:#3140B8">Բացել ամբողջ օրացույցը</a></p>' : '') +
    '<p style="margin-top:16px;color:#8C96AA;font-size:12px">Այս նամակն ուղարկվել է ավտոմատ կերպով՝ տարածքների բաշխման աղյուսակից։</p></div>';
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function row_(cells, head) {
  var tag = head ? 'th' : 'td';
  var style = head
    ? 'text-align:left;padding:6px 10px;background:#EDF0F6;font-size:12px;color:#5B6680;border-bottom:1px solid #DCE2EC'
    : 'padding:7px 10px;border-bottom:1px solid #EDF0F6;font-size:13px';
  return '<tr>' + cells.map(function (c) { return '<' + tag + ' style="' + style + '">' + c + '</' + tag + '>'; }).join('') + '</tr>';
}

/* ---------------- weekly digest ---------------- */

function sendWeeklyDigest() {
  var s = settings_();
  if (!s.weekly) return;
  sendDigestForWeek_(mondayOf_(new Date()), s);
}

function sendDigestNow() { toast_(sendDigestForWeek_(mondayOf_(new Date()), settings_())); }
function sendDigestNextWeek() { toast_(sendDigestForWeek_(addDays_(mondayOf_(new Date()), 7), settings_())); }

function sendDigestForWeek_(monday, s) {
  var sh = sheetForWeek_(monday) || SpreadsheetApp.getActive().getSheetByName('Total');
  if (!sh) return 'Total թերթիկը չի գտնվել';
  var grid = parseGridFull_(sh);
  if (!grid) return 'Ժամանակացույցը չի կարդացվել';
  var map = recipients_();
  var byGroup = {};
  grid.rooms.forEach(function (room) {
    grid.slots.forEach(function (slot) {
      var cell = String(grid.values[room.row - 1][slot.col - 1] || '').trim();
      if (!cell) return;
      var rec = findRecipient_(map, cell);
      if (!rec) return;
      if (!byGroup[rec.name]) byGroup[rec.name] = { rec: rec, items: [] };
      byGroup[rec.name].items.push({ day: slot.day, time: slot.time, room: room.name, desc: room.desc });
    });
  });
  var names = Object.keys(byGroup), sent = 0;
  names.forEach(function (n) {
    var g = byGroup[n];
    g.items.sort(function (a, b) { return a.day - b.day || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); });
    var rows = g.items.map(function (it) {
      return row_([
        '<b>' + esc_(DAYS_HY[it.day]) + '</b> ' + dm_(addDays_(monday, it.day)),
        '<span style="font-family:Consolas,monospace">' + esc_(it.time) + '</span>',
        '<b>' + esc_(it.room) + '</b>' + (it.desc ? '<br><span style="color:#8C96AA;font-size:12px">' + esc_(it.desc) + '</span>' : '')
      ]);
    }).join('');
    var table = '<table style="border-collapse:collapse;width:100%">' +
      row_(['Օր', 'Ժամ', 'Տարածք'], true) + rows + '</table>';
    var subject = esc_(n) + ' · տարածքները ' + dm_(monday) + '-' + dm_(addDays_(monday, 6));
    var html = shell_(n, 'Շաբաթվա տարածքները՝ ' + dm_(monday) + '-' + dm_(addDays_(monday, 6)) +
      (sheetForWeek_(monday) ? '' : ' (հիմնական ժամանակացույց)'), table, s);
    if (send_(g.rec.emails, subject, html, s)) sent++;
  });
  log_('Շաբաթական', sent + ' խումբ', dm_(monday) + '-' + dm_(addDays_(monday, 6)));
  return 'Ուղարկվեց ' + sent + ' նամակ' + (s.test ? ' (թեստային ռեժիմ)' : '');
}

/* ---------------- change notices ---------------- */

function queueSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(QUEUE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(QUEUE_SHEET);
    sh.appendRow(['Ժամ', 'Թերթիկ', 'Տարածք', 'Օր', 'Ժամ', 'Նախկին', 'Նոր', 'Կարգավիճակ', 'Ուղարկվել է']);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function logSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(['Ժամ', 'Տեսակ', 'Արդյունք', 'Մանրամասն']);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function log_(type, result, detail) {
  try { logSheet_().appendRow([new Date(), type, result, detail || '']); } catch (err) {}
}

/** Installable edit trigger: queues every change made in a weekly tab. */
function onGridEdit(e) {
  try {
    var s = settings_();
    if (!s.changes) return;
    var sh = e.range.getSheet();
    if (!WEEK_RE.test(sh.getName())) return;
    var meta = parseGridFull_(sh);
    if (!meta) return;
    var r0 = e.range.getRow(), c0 = e.range.getColumn();
    var nR = e.range.getNumRows(), nC = e.range.getNumColumns();
    var vals = e.range.getDisplayValues();
    var single = (nR === 1 && nC === 1);
    var rows = [];
    for (var i = 0; i < nR; i++) {
      for (var j = 0; j < nC; j++) {
        var room = meta.roomByRow[r0 + i], slot = meta.slotByCol[c0 + j];
        if (!room || !slot) continue;
        var nv = String(vals[i][j] || '').trim();
        var ov = single ? String(e.oldValue === undefined ? '' : e.oldValue).trim() : '';
        if (nv === ov) continue;
        rows.push([new Date(), sh.getName(), room.name, slot.day, slot.time, ov, nv, 'pending', '']);
      }
    }
    if (rows.length) {
      var q = queueSheet_();
      q.getRange(q.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
    }
  } catch (err) {
    log_('Փոփոխություն', 'սխալ', String(err));
  }
}

/** Runs every 10 minutes: turns queued changes into one email per group. */
function flushChangeEmails() {
  var s = settings_();
  if (!s.changes) return 'Անջատված է';
  var q = queueSheet_();
  if (q.getLastRow() < 2) return 'Փոփոխություն չկա';
  var data = q.getRange(2, 1, q.getLastRow() - 1, 9).getValues();
  var map = recipients_();
  var byGroup = {}, touched = [];

  function push(activity, item) {
    var rec = findRecipient_(map, activity);
    if (!rec) return;
    if (!byGroup[rec.name]) byGroup[rec.name] = { rec: rec, items: [] };
    byGroup[rec.name].items.push(item);
  }

  data.forEach(function (r, i) {
    if (String(r[7]) !== 'pending') return;
    touched.push(i);
    var monday = mondayFromSheetName_(r[1]);
    var day = +r[3];
    var date = monday ? addDays_(monday, day) : null;
    var base = { room: String(r[2]), day: day, time: String(r[4]), date: date };
    var ov = String(r[5] || '').trim(), nv = String(r[6] || '').trim();
    if (nv) push(nv, { type: 'add', room: base.room, day: day, time: base.time, date: date, activity: nv });
    if (ov && ov !== nv) push(ov, { type: 'remove', room: base.room, day: day, time: base.time, date: date, activity: ov });
  });

  var sent = 0;
  Object.keys(byGroup).forEach(function (n) {
    var g = byGroup[n];
    var items = mergeMoves_(g.items);
    items.sort(function (a, b) { return a.day - b.day || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); });
    var rows = items.map(function (it) {
      var when = '<b>' + esc_(DAYS_HY[it.day]) + '</b>' + (it.date ? ' ' + dm_(it.date) : '') +
        ' <span style="font-family:Consolas,monospace">' + esc_(it.time) + '</span>';
      var what, color;
      if (it.type === 'move') { what = 'Տեղափոխվել է՝ ' + esc_(it.from) + ' → <b>' + esc_(it.room) + '</b>'; color = '#E28B22'; }
      else if (it.type === 'time') { what = 'Ժամը փոխվել է՝ ' + esc_(it.oldTime) + ' → <b>' + esc_(it.time) + '</b> · ' + esc_(it.room); color = '#7E3FF2'; }
      else if (it.type === 'add') { what = 'Ամրագրվել է՝ <b>' + esc_(it.room) + '</b>'; color = '#16664A'; }
      else { what = 'Չեղարկվել է՝ <b>' + esc_(it.room) + '</b>'; color = '#B33A3A'; }
      return row_([when, '<span style="color:' + color + '">' + what + '</span>']);
    }).join('');
    var table = '<table style="border-collapse:collapse;width:100%">' + row_(['Երբ', 'Ինչ է փոխվել'], true) + rows + '</table>';
    var subject = esc_(n) + ' · տարածքի փոփոխություն';
    if (send_(g.rec.emails, subject, shell_(n, 'Ձեր ժամանակացույցում փոփոխություն կա', table, s), s)) sent++;
  });

  touched.forEach(function (i) {
    q.getRange(i + 2, 8).setValue('sent');
    q.getRange(i + 2, 9).setValue(new Date());
  });
  log_('Փոփոխություն', sent + ' նամակ', touched.length + ' փոփոխություն');
  return 'Ուղարկվեց ' + sent + ' նամակ' + (s.test ? ' (թեստային ռեժիմ)' : '');
}

/** A removal and an addition in the same slot become one "moved" line. */
function mergeMoves_(items) {
  var out = [], used = {};
  items.forEach(function (a, i) {
    if (used[i]) return;
    if (a.type === 'remove') {
      var j, b;
      /* same slot, another room -> moved */
      for (j = 0; j < items.length; j++) {
        b = items[j];
        if (!used[j] && j !== i && b.type === 'add' && b.day === a.day && b.time === a.time && b.room !== a.room) {
          used[i] = used[j] = true;
          out.push({ type: 'move', from: a.room, room: b.room, day: a.day, time: a.time, date: b.date || a.date });
          return;
        }
      }
      /* same room and day, another time -> time changed */
      for (j = 0; j < items.length; j++) {
        b = items[j];
        if (!used[j] && j !== i && b.type === 'add' && b.day === a.day && b.room === a.room && b.time !== a.time) {
          used[i] = used[j] = true;
          out.push({ type: 'time', room: a.room, day: a.day, time: b.time, oldTime: a.time, date: b.date || a.date });
          return;
        }
      }
    }
    if (!used[i]) { used[i] = true; out.push(a); }
  });
  return out;
}

/* ---------------- menu & setup ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Տարածքներ')
    .addItem('Ուղարկել շաբաթական նամակը (այս շաբաթ)', 'sendDigestNow')
    .addItem('Ուղարկել շաբաթական նամակը (հաջորդ շաբաթ)', 'sendDigestNextWeek')
    .addItem('Ուղարկել սպասող փոփոխությունները', 'flushChangeEmailsMenu')
    .addItem('Թեստային նամակ ուղարկել ինձ', 'sendTestToMe')
    .addSeparator()
    .addItem('Ստուգել՝ որ խմբերը հասցե չունեն', 'checkMissingEmails')
    .addItem('Միացնել ավտոմատ ուղարկումը (այս հաշվից)', 'setupTriggers')
    .addItem('Անջատել ավտոմատ ուղարկումը (այս հաշվից)', 'removeMyTriggers')
    .addItem('Ո՞ր հաշիվն է ուղարկում', 'sendingStatus')
    .addToUi();
}

function flushChangeEmailsMenu() { toast_(flushChangeEmails()); }

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(String(msg), 'Տարածքների նամակներ', 8); } catch (err) {}
}

function checkMissingEmails() {
  var map = recipients_();
  var missing = {}, total = 0;
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name.toLowerCase() !== 'total' && !WEEK_RE.test(name)) return;
    var grid = parseGridFull_(sh);
    if (!grid) return;
    grid.rooms.forEach(function (room) {
      grid.slots.forEach(function (slot) {
        var cell = String(grid.values[room.row - 1][slot.col - 1] || '').trim();
        if (!cell) return;
        total++;
        if (!findRecipient_(map, cell)) missing[cell] = (missing[cell] || 0) + 1;
      });
    });
  });
  var names = Object.keys(missing).sort();
  var msg = names.length
    ? names.length + ' խումբ հասցե չունի Staff թերթիկում․\n\n' + names.slice(0, 40).join('\n') +
      (names.length > 40 ? '\n… և ևս ' + (names.length - 40) : '')
    : 'Բոլոր խմբերն ունեն էլ․ հասցե։';
  SpreadsheetApp.getUi().alert('Էլ․ հասցեների ստուգում', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function setupTriggers() {
  var ss = SpreadsheetApp.getActive();
  var names = ['sendWeeklyDigest', 'flushChangeEmails', 'onGridEdit'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var s0 = settings_();
  if (s0.weekly) ScriptApp.newTrigger('sendWeeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('flushChangeEmails').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onGridEdit').forSpreadsheet(ss).onEdit().create();
  var tz = Session.getScriptTimeZone();
  var msg = (s0.weekly ? 'Շաբաթական նամակ՝ երկուշաբթի 09:00 (' + tz + ')։ ' : 'Շաբաթական նամակն անջատված է (Staff թերթիկի կարգավորումը OFF է)։ ') + 'Փոփոխությունների նամակ՝ յուրաքանչյուր 10 րոպեն մեկ։';
  log_('Կարգավորում', 'տրիգերները միացված են', msg);
  try { SpreadsheetApp.getUi().alert('Ավտոմատ ուղարկումը միացված է', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) {}
  return msg;
}

/** Triggers belong to the account that created them; that account sends the mail. */
function removeMyTriggers() {
  var names = ['sendWeeklyDigest', 'flushChangeEmails', 'onGridEdit'];
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  var msg = n + ' ավտոմատ առաջադրանք անջատվեց այս հաշվի համար՝ ' + Session.getEffectiveUser().getEmail();
  log_('Կարգավորում', 'անջատված', msg);
  try { SpreadsheetApp.getUi().alert('Ավտոմատ ուղարկում', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) {}
  return msg;
}

function sendingStatus() {
  var names = ['sendWeeklyDigest', 'flushChangeEmails', 'onGridEdit'];
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return names.indexOf(t.getHandlerFunction()) >= 0; });
  var s = settings_();
  var msg = 'Այս հաշիվը՝ ' + Session.getEffectiveUser().getEmail() +
    '\nԱվտոմատ առաջադրանքներ այս հաշվի տակ՝ ' + mine.length +
    (mine.length ? ' (' + mine.map(function (t) { return t.getHandlerFunction(); }).join(', ') + ')' : '') +
    '\nԹեստային ռեժիմ՝ ' + (s.test ? 'ON - միայն ' + (s.admin || '-') : 'OFF - խմբերին') +
    '\n\nՆամակներն ուղարկվում են այն հաշվի անունից, որը միացրել է ավտոմատ ուղարկումը։';
  try { SpreadsheetApp.getUi().alert('Ավտոմատ ուղարկման վիճակ', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) {}
  return msg;
}

/** Sends one sample of each email type to whoever runs it. Groups get nothing. */
function sendTestToMe() {
  var s = settings_();
  var me = Session.getEffectiveUser().getEmail();
  var monday = mondayOf_(new Date());
  var sh = sheetForWeek_(monday) || SpreadsheetApp.getActive().getSheetByName('Total');
  if (!sh) { toast_('Ժամանակացույցը չի գտնվել'); return; }
  var grid = parseGridFull_(sh);
  if (!grid) { toast_('Ժամանակացույցը չի կարդացվել'); return; }
  var map = recipients_();
  var byGroup = {};
  grid.rooms.forEach(function (room) {
    grid.slots.forEach(function (slot) {
      var cell = String(grid.values[room.row - 1][slot.col - 1] || '').trim();
      if (!cell) return;
      var rec = findRecipient_(map, cell);
      var nm = rec ? rec.name : cell;
      if (!byGroup[nm]) byGroup[nm] = [];
      byGroup[nm].push({ day: slot.day, time: slot.time, room: room.name, desc: room.desc });
    });
  });
  var names = Object.keys(byGroup);
  if (!names.length) { toast_('Այս շաբաթում ամրագրումներ չկան'); return; }
  names.sort(function (a, b) { return byGroup[b].length - byGroup[a].length; });
  var nm = names[0], items = byGroup[nm];
  items.sort(function (a, b) { return a.day - b.day || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); });
  var direct = { admin: me, test: false, url: s.url };
  var intro = '<p style="margin:0 0 14px;padding:8px 12px;background:#FCEFDC;border:1px solid #E28B22;border-radius:8px;font:13px Arial,sans-serif;color:#7a4b00">Սա թեստային օրինակ է՝ ուղարկված միայն ' + esc_(me) + ' հասցեին։ Խմբերը ոչինչ չեն ստացել։</p>';
  var rows = items.map(function (it) {
    return row_(['<b>' + esc_(DAYS_HY[it.day]) + '</b> ' + dm_(addDays_(monday, it.day)),
      '<span style="font-family:Consolas,monospace">' + esc_(it.time) + '</span>',
      '<b>' + esc_(it.room) + '</b>' + (it.desc ? '<br><span style="color:#8C96AA;font-size:12px">' + esc_(it.desc) + '</span>' : '')]);
  }).join('');
  var weekTable = '<table style="border-collapse:collapse;width:100%">' + row_(['Օր', 'Ժամ', 'Տարածք'], true) + rows + '</table>';
  send_([me], 'ԹԵՍՏ · ' + nm + ' · տարածքները ' + dm_(monday) + '-' + dm_(addDays_(monday, 6)),
    intro + shell_(nm, 'Շաբաթվա տարածքները՝ ' + dm_(monday) + '-' + dm_(addDays_(monday, 6)), weekTable, direct), direct);
  var other = null;
  for (var i = 0; i < grid.rooms.length; i++) { if (grid.rooms[i].name !== items[0].room) { other = grid.rooms[i].name; break; } }
  var ch = [];
  ch.push(row_(['<b>' + esc_(DAYS_HY[items[0].day]) + '</b> ' + dm_(addDays_(monday, items[0].day)) + ' <span style="font-family:Consolas,monospace">' + esc_(items[0].time) + '</span>',
    '<span style="color:#E28B22">Տեղափոխվել է՝ ' + esc_(items[0].room) + ' → <b>' + esc_(other || '-') + '</b></span>']));
  if (items[1]) {
    ch.push(row_(['<b>' + esc_(DAYS_HY[items[1].day]) + '</b> ' + dm_(addDays_(monday, items[1].day)) + ' <span style="font-family:Consolas,monospace">' + esc_(items[1].time) + '</span>',
      '<span style="color:#16664A">Ամրագրվել է՝ <b>' + esc_(items[1].room) + '</b></span>']));
  }
  var chTable = '<table style="border-collapse:collapse;width:100%">' + row_(['Երբ', 'Ինչ է փոխվել'], true) + ch.join('') + '</table>';
  send_([me], 'ԹԵՍՏ · ' + nm + ' · տարածքի փոփոխություն',
    intro + shell_(nm, 'Ձեր ժամանակացույցում փոփոխություն կա (օրինակ)', chTable, direct), direct);
  log_('Թեստ', '2 նամակ', me);
  toast_('2 թեստային նամակ ուղարկվեց՝ ' + me);
}
