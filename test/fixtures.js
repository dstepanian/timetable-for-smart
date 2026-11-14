/* Shared fake spreadsheet for the server and UI tests. */
const { Sheet, makeEnv, fmt, pad } = require('./gas-mock');
const DIR = require('path').join(__dirname, '..', 'src');
const SLOTS = [
  ['09:30', '11:00', '13:30', '16:00', '18:00'], ['09:30', '11:00', '13:30', '16:00', '18:00'],
  ['09:30', '11:00', '13:30', '16:00', '18:00'], ['09:30', '11:00', '13:30', '16:00', '18:00'],
  ['09:30', '11:00', '13:30', '16:00', '18:00'], ['10:00', '12:00', '14:00', '16:00'], ['10:00', '12:00']
];
const DAYN = ['Երկուշաբթի', 'Երեքշաբթի', 'Չորեքշաբթի', 'Հինգշաբթի', 'Ուրբաթ', 'Շաբաթ', 'Կիրակի'];
function colOf(day, time) { let c = 2; for (let d = 0; d < 7; d++) for (const t of SLOTS[d]) { if (d === day && t === time) return c; c++; } throw new Error('no slot'); }
function grid(name, fill) {
  const h1 = ['Տարածք', ''], h2 = ['', ''];
  SLOTS.forEach((ts, d) => ts.forEach((t, i) => { h1.push(i === 0 ? DAYN[d] : ''); h2.push(t); }));
  const rooms = [['Երկիր 1', 'Նախկին գրադարան'], ['Երկիր 2', 'Երկրորդ հարկ'], ['Ասուպ 1', 'Լոգոպեդի սենյակ'], ['Արեգակ', 'Մանկական անկյուն']];
  const rows = [h1, h2].concat(rooms.map(r => r.concat(new Array(h1.length - 2).fill(''))));
  fill(rows);
  return new Sheet(name, rows);
}
function put(rows, room, day, time, text) { const ri = rows.findIndex(r => r[0] === room); rows[ri][colOf(day, time)] = text; }

const now = new Date();
const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate()); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + 7); // next Monday
const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
const iso = d => fmt(d, 'yyyy-MM-dd');
const dayIso = n => { const d = new Date(mon); d.setDate(mon.getDate() + n); return iso(d); };
const weekName = 'Weekly schedule ' + fmt(mon, 'dd.MM') + '-' + fmt(sun, 'dd.MM');

function fresh(user, settingsExtra) {
  const staff = new Sheet('Staff', [
    ['Group', 'Email 1', 'Email 2', '', 'Կարգավորումներ', 'Արժեք'],
    ['Ծրագրավորում 74', 'prog@example.org', '', '', 'Ադմինիստրատորի հասցե', 'coordinator@example.org'],
    ['', '', '', '', 'Շաբաթական նամակ (ON/OFF)', 'OFF'],
    ['', '', '', '', 'Փոփոխությունների նամակ (ON/OFF)', 'ON'],
    ['', '', '', '', 'Թեստային ռեժիմ միայն ադմինիստրատորին (ON/OFF)', 'ON'],
    ['', '', '', '', 'Օրացույցի հղում', 'https://example/app'],
    ['EQ Lab 10', 'ani.hakobyan@example.org', '', '', '', ''],
    ['Անգլերեն 62', 'other.teacher@example.org', 'ani.hakobyan@example.org', '', '', ''],
    ['IT 1', 'owner@example.org', '', '', '', ''],
    ['IT 2', 'owner@example.org', '', '', '', '']
  ].concat((settingsExtra || []).map(x => ['', '', '', '', x[0], x[1]])));
  const week = grid(weekName, rows => {
    put(rows, 'Երկիր 1', 0, '16:00', 'Ծրագրավորում 74');
    put(rows, 'Երկիր 1', 0, '18:00', 'Ծրագրավորում 75');
    put(rows, 'Ասուպ 1', 0, '11:00', 'Լուսինե Գրիգորյան 11:00-12:30');
    put(rows, 'Ասուպ 1', 1, '11:00', 'Լոգոպեդ 11:00\u201312:00');
    put(rows, 'Արեգակ', 1, '16:00', '16:00 Անի Հակոբյան\n17:00 Սոնա Մելքոնյան');
  });
  const total = grid('Total', rows => { put(rows, 'Երկիր 2', 0, '09:30', 'Ֆինանսներ 74'); });
  const rules = new Sheet('Rules', [['', 'Դասընթաց']], [['#4a86e8']]);
  return makeEnv({ dir: DIR, user, owner: 'owner@example.org', sheets: [rules, staff, week, total] });
}

module.exports = { fresh, dayIso, mon, sun, iso, weekName, fmt, put, colOf };
