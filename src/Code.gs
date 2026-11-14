/** @OnlyCurrentDoc */
/**
 * Տարածքների օրացույց - staff web app
 * Reads the "Total" tab and every "Weekly schedule dd.mm-dd.mm" tab from this
 * spreadsheet and serves them to Index.html. Nothing is written to the sheet.
 */

var WEEK_RE = /weekly\s*schedule\s*(\d{1,2})\.(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\.(\d{1,2})/i;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Տարածքների օրացույց')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Called from the page. Returns everything as a JSON string.
 * mode 'fast': the room schedule may come from the last saved copy (script cache),
 * so the page can show it at once; the page then asks again without 'fast' to get
 * the sheet as it is now. Bookings and the signed-in user are always read live.
 */
function getData(mode) {
  var cached = mode === 'fast' ? schedFromCache_() : null;
  var at = cached ? cached.at : new Date().toISOString();
  var sched = cached ? cached.s : readSchedule_();
  if (!cached) schedToCache_(sched, at);
  var out = {
    base: sched.base, weeks: sched.weeks, events: sched.events, legend: sched.legend,
    updated: at, cached: !!cached
  };
  /* bookings (Booking.gs); the calendar still loads if this part fails */
  try {
    var list = readBookings_();
    out.me = me_(list);
    out.bookCfg = bookCfg_();
    out.bookings = bookingsForClient_(out.me, list);
  } catch (err) {
    out.bookings = [];
    out.bookErr = String(err && err.message || err);
  }
  return JSON.stringify(out);
}

/** The slow part: every weekly tab, Total, the events tab and the colour legend. */
function readSchedule_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = { base: null, weeks: [], events: [], legend: parseLegend_() };
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    var low = name.trim().toLowerCase();
    if (low === 'total') { out.base = parseGrid_(sh); return; }
    if (low === 'google calendar' || low === 'events') { out.events = out.events.concat(parseEvents_(sh)); return; }
    var m = name.match(WEEK_RE);
    if (m) {
      var g = parseGrid_(sh);
      if (g) out.weeks.push({ name: name, day: +m[1], month: +m[2], grid: g });
    }
  });
  return out;
}

/* ---------------- saved copy of the schedule (script cache) ---------------- */

var SCHED_KEY = 'sched';
var SCHED_CHUNK = 90000;      /* a cache value holds at most 100 KB */
var SCHED_TTL = 21600;        /* 6 hours, the longest the cache keeps anything */

/** Gzipped JSON split over a few keys; every part carries the same stamp so mixed copies are never used. */
function schedToCache_(sched, at) {
  try {
    var json = JSON.stringify({ at: at, s: sched });
    var blob = Utilities.newBlob('', 'application/json').setDataFromString(json, 'UTF-8');
    var b64 = Utilities.base64Encode(Utilities.gzip(blob).getBytes());
    var n = Math.ceil(b64.length / SCHED_CHUNK);
    if (n > 30) return;
    var stamp = at + '|', parts = {};
    for (var i = 0; i < n; i++) parts[SCHED_KEY + i] = stamp + b64.substr(i * SCHED_CHUNK, SCHED_CHUNK);
    parts[SCHED_KEY] = stamp + n;
    CacheService.getScriptCache().putAll(parts, SCHED_TTL);
  } catch (err) { /* the page still works, only slower */ }
}

function schedFromCache_() {
  try {
    var c = CacheService.getScriptCache(), head = c.get(SCHED_KEY);
    if (!head) return null;
    var cut = head.indexOf('|'), stamp = head.slice(0, cut + 1), n = +head.slice(cut + 1);
    if (!(n > 0)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(SCHED_KEY + i);
    var got = c.getAll(keys), b64 = '';
    for (i = 0; i < n; i++) {
      var part = got[keys[i]];
      if (!part || part.indexOf(stamp) !== 0) return null;
      b64 += part.slice(stamp.length);
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    var obj = JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
    return obj && obj.s ? obj : null;
  } catch (err) { return null; }
}

/** "16։00", "16:00", "4:00 PM" -> "16:00" */
function normTime_(s) {
  var str = String(s || '');
  var m = str.match(/(\d{1,2})\D(\d{2})/);
  if (!m) return null;
  var h = +m[1];
  if (/pm/i.test(str) && h < 12) h += 12;
  if (/am/i.test(str) && h === 12) h = 0;
  return ('0' + h).slice(-2) + ':' + m[2];
}

/**
 * Grid layout: row 1 = day headers, row 2 = times, rows 3+ = rooms
 * (col A = room name, col B = description, col C.. = one column per slot).
 * A new day starts whenever the time goes back down (18:00 -> 16:00).
 */
function parseGrid_(sh) {
  var range = sh.getDataRange();
  var v = range.getDisplayValues();
  var bg = range.getBackgrounds();
  if (v.length < 3) return null;
  var slots = [], day = 0, prev = -1;
  for (var c = 2; c < v[1].length; c++) {
    var t = normTime_(v[1][c]);
    if (!t) continue;
    var mins = (+t.slice(0, 2)) * 60 + (+t.slice(3));
    if (prev >= 0 && mins <= prev) day++;
    prev = mins;
    if (day > 6) break;
    slots.push({ col: c, day: day, time: t });
  }
  var rooms = [];
  for (var r = 2; r < v.length; r++) {
    var name = String(v[r][0]).trim(), desc = String(v[r][1]).trim();
    if (!name && !desc) { if (rooms.length) break; else continue; }
    rooms.push({
      name: name || desc,
      desc: name ? desc : '',
      cells: slots.map(function (s) { return String(v[r][s.col] || '').trim(); }),
      colors: slots.map(function (s) { return normColor_(bg[r][s.col]); })
    });
  }
  return { slots: slots.map(function (s) { return { day: s.day, time: s.time }; }), rooms: rooms };
}

/** "Google Calendar" tab: Start Date | Subject | Start Time | End Time | Location */
function parseEvents_(sh) {
  var v = sh.getDataRange().getDisplayValues();
  if (v.length < 2) return [];
  var h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var iD = h.indexOf('start date'), iS = h.indexOf('subject'), iT = h.indexOf('start time'),
      iE = h.indexOf('end time'), iL = h.indexOf('location');
  if (iD < 0 || iS < 0) return [];
  return v.slice(1).map(function (row) {
    var nums = String(row[iD] || '').match(/\d+/g);
    if (!nums || nums.length < 2) return null;
    var y = nums[2] ? +nums[2] : null;
    if (y !== null && y < 100) y += 2000;
    return {
      day: +nums[0], month: +nums[1], year: y,
      subject: String(row[iS] || '').trim(),
      start: iT >= 0 ? (normTime_(row[iT]) || String(row[iT]).trim()) : '',
      end: iE >= 0 ? (normTime_(row[iE]) || String(row[iE]).trim()) : '',
      location: iL >= 0 ? String(row[iL] || '').trim() : ''
    };
  }).filter(function (e) { return e && e.subject; });
}

/** '#ffffff' and empty backgrounds count as "no colour". */
function normColor_(c) {
  c = String(c || '').trim().toLowerCase();
  if (!c || c === '#ffffff' || c === '#fff' || c === 'white') return '';
  return c;
}

/**
 * "Rules" tab as a colour legend: a coloured cell in a row plus the text of
 * that row. The page shows these under the room filter and marks every cell
 * painted with a legend colour.
 */
function parseLegend_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Rules');
  if (!sh) return [];
  var range = sh.getDataRange();
  var v = range.getDisplayValues(), bg = range.getBackgrounds();
  var out = [], seen = {};
  for (var r = 0; r < v.length; r++) {
    for (var c = 0; c < Math.min(v[r].length, 4); c++) {
      var col = normColor_(bg[r][c]);
      if (!col || seen[col]) continue;
      var label = '';
      for (var k = 0; k < v[r].length; k++) {
        var tx = String(v[r][k]).trim();
        if (tx) { label = tx; break; }
      }
      seen[col] = true;
      out.push({ color: col, label: label });
      break;
    }
  }
  return out;
}
