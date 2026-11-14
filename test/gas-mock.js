/* Minimal Google Apps Script mocks: enough for Code.gs, Mailer.gs and Booking.gs. */
const fs = require('fs');
const vm = require('vm');

function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmt(d, f) {
  const map = {
    yyyy: d.getFullYear(), yy: String(d.getFullYear()).slice(2), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds())
  };
  return f.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, k => map[k]);
}

class Sheet {
  constructor(name, rows, bgs) {
    this.name = name; this.rows = rows || []; this.bgs = bgs || []; this.hidden = false;
  }
  getName() { return this.name; }
  getLastRow() { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every(v => v === '' || v == null)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  setFrozenRows() {} setColumnWidth() {} hideSheet() { this.hidden = true; }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); return this; }
  bg(r, c) { return ((this.bgs[r - 1] || [])[c - 1]) || ''; }
  note(r, c) { return (this.notes || {})[r + ',' + c] || ''; }
  cell(r, c) { const row = this.rows[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
}

const stats = { reads: 0 };
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  map(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j)); out.push(row); } return out; }
  getValues() { stats.reads++; return this.map((r, c) => this.sh.cell(r, c)); }
  getValue() { return this.sh.cell(this.r, this.c); }
  getDisplayValues() { stats.reads++; return this.map((r, c) => { const v = this.sh.cell(r, c); return v instanceof Date ? fmt(v, 'dd.MM.yyyy') : String(v); }); }
  getBackgrounds() { stats.reads++; return this.map((r, c) => ((this.sh.bgs[r - 1] || [])[c - 1]) || '#ffffff'); }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setDataValidation() { return this; }
  setBackground(col) { this.map((r, c) => { while (this.sh.bgs.length < r) this.sh.bgs.push([]); const row = this.sh.bgs[r - 1] || (this.sh.bgs[r - 1] = []); row[c - 1] = col || ''; }); return this; }
  setNote(n) { this.sh.notes = this.sh.notes || {}; this.map((r, c) => { this.sh.notes[r + ',' + c] = n; }); return this; }
  getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; }
  getSheet() { return this.sh; }
}

const zlib = require('zlib');
const signed = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const unsigned = arr => Buffer.from(Array.from(arr).map(b => b & 255));
class Blob {
  constructor(buf, type) { this.buf = buf; this.type = type || ''; }
  getBytes() { return signed(this.buf); }
  getDataAsString(cs) { if (cs && !/^utf-?8$/i.test(cs)) throw new Error('mock: utf-8 only'); return this.buf.toString('utf8'); }
  setDataFromString(s, cs) { if (cs && !/^utf-?8$/i.test(cs)) throw new Error('mock: utf-8 only'); this.buf = Buffer.from(s, 'utf8'); return this; }
}
function newBlob(data, type) { return new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : unsigned(data), type); }
/* Script cache with the real limits: 100 KB per value, string values only. */
function makeCache(store) {
  const put = (k, v) => {
    if (typeof v !== 'string') throw new Error('cache value must be a string');
    if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
    store.set(k, v);
  };
  return {
    get: k => (store.has(k) ? store.get(k) : null),
    put: (k, v) => put(k, v),
    putAll: o => { Object.keys(o).forEach(k => { if (Buffer.byteLength(o[k], 'utf8') > 100 * 1024) throw new Error('Argument too large: value'); }); Object.keys(o).forEach(k => put(k, o[k])); },
    getAll: ks => { const out = {}; ks.forEach(k => { if (store.has(k)) out[k] = store.get(k); }); return out; },
    remove: k => store.delete(k),
    removeAll: ks => ks.forEach(k => store.delete(k))
  };
}

function makeEnv(opts) {
  const sheets = opts.sheets;
  const mail = [];
  const cacheStore = opts.cacheStore || new Map();
  const ss = {
    getSheets: () => sheets,
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: (n, idx) => { const s = new Sheet(n, []); sheets.splice(idx == null ? sheets.length : idx, 0, s); return s; },
    toast() {}
  };
  const user = { email: opts.user };
  const ctx = {
    SpreadsheetApp: {
      getActive: () => ss, getActiveSpreadsheet: () => ss, flush() {},
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
      getUi: () => ({ alert() {}, ButtonSet: {} })
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => user.email }),
      getEffectiveUser: () => ({ getEmail: () => opts.owner }),
      getScriptTimeZone: () => 'Asia/Yerevan'
    },
    Utilities: {
      formatDate: (d, tz, f) => fmt(d, f),
      newBlob,
      gzip: b => new Blob(zlib.gzipSync(b.buf), 'application/x-gzip'),
      ungzip: b => new Blob(zlib.gunzipSync(b.buf)),
      base64Encode: bytes => unsigned(bytes).toString('base64'),
      base64Decode: s => signed(Buffer.from(s, 'base64'))
    },
    CacheService: { getScriptCache: () => makeCache(cacheStore) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: o => mail.push(o) },
    HtmlService: {}, ScriptApp: {}, Logger: { log() {} },
    console
  };
  vm.createContext(ctx);
  const dir = opts.dir;
  ['Code.gs', 'Mailer.gs', 'Booking.gs'].forEach(f => vm.runInContext(fs.readFileSync(dir + '/' + f, 'utf8'), ctx, { filename: f }));
  return { ctx, ss, mail, user, sheets, cacheStore };
}

module.exports = { Sheet, makeEnv, fmt, pad, stats };
