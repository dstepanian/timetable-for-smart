/* A made-up SMART Center week for the README pictures and for trying the page locally.
   Every name and address here is invented. */
const path = require('path');
const { Sheet, makeEnv, fmt } = require('../test/gas-mock');

const SRC = path.join(__dirname, '..', 'src');
const DAYN = ['Երկուշաբթի', 'Երեքշաբթի', 'Չորեքշաբթի', 'Հինգշաբթի', 'Ուրբաթ', 'Շաբաթ', 'Կիրակի'];
const WEEKDAY = ['09:30', '11:00', '13:30', '16:00', '18:00'];
const WEEKEND = ['10:00', '12:00', '14:00', '16:00', '18:00'];
const SLOTS = [0, 1, 2, 3, 4, 5, 6].map(d => (d < 5 ? WEEKDAY : WEEKEND));

const ROOMS = [
  ['Երկիր 1', 'Համակարգչային լաբորատորիա'], ['Երկիր 2', 'Համակարգչային լաբորատորիա'], ['Երկիր 3', 'Լեզուների դասասենյակ'],
  ['Ծիր Կաթին', 'Ռոբոտաշինություն'], ['Նեպտուն', 'Դասասենյակ'], ['Յուպիտեր', 'Մեծ դահլիճ'], ['Սատուրն', 'Դասասենյակ'],
  ['Ուրան', 'Դասասենյակ'], ['Պլուտոն', 'Շարժման սենյակ'], ['Մարս', 'Պարի դահլիճ'], ['Մերկուրի', 'Երաժշտական սենյակ'],
  ['Լուսին', 'Արվեստանոց'], ['Արեգակ', 'Մանկական անկյուն'], ['Օրիոն', 'Հանդիպումների սենյակ']
];

/* program, room, its groups, teacher e-mail */
const PROGRAMS = [
  ['Ծրագրավորում', 'Երկիր 1', [74, 75, 76, 77, 78], 'aram.petrosyan@example.org'],
  ['Ֆինանսներ', 'Երկիր 2', [74, 75, 76, 77, 78], 'mariam.sargsyan@example.org'],
  ['Անգլերեն', 'Երկիր 3', [57, 58, 59, 60, 61], 'hasmik.avetisyan@example.org'],
  ['Ռոբոտաշինություն', 'Ծիր Կաթին', [74, 75, 76, 77, 78], 'tigran.harutyunyan@example.org'],
  ['Ռուսերեն', 'Նեպտուն', [74, 75, 76, 77, 78], 'gayane.martirosyan@example.org'],
  ['Ագրո', 'Ուրան', [66, 67, 68, 69, 70], 'vahe.grigoryan@example.org'],
  ['Պար', 'Մարս', [74, 75, 76, 77, 78], 'lilit.hovhannisyan@example.org'],
  ['Երաժշտ. գործիք', 'Մերկուրի', [74, 75, 76, 77, 78], 'narek.mkrtchyan@example.org'],
  ['Թվային նկարչություն', 'Լուսին', [74, 75, 76, 77, 78], 'anahit.vardanyan@example.org']
];
/* EQ Lab and yoga run together: half of the group in each room */
const JOINT = [[7, 74], [8, 75], [9, 76], [10, 77], [11, 78]];
const INSTRUCTOR = 'ani.hakobyan@example.org';   /* the yoga teacher, used for the pictures */
const ADMIN = 'coordinator@example.org';

function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function build(opts) {
  opts = opts || {};
  const monday = opts.monday || addDays(mondayOf(new Date()), 7);
  const sunday = addDays(monday, 6);
  const head1 = ['Տարածք', ''], head2 = ['', ''], colOf = {};
  SLOTS.forEach((ts, d) => ts.forEach((t, i) => { colOf[d + '|' + t] = head1.length; head1.push(i === 0 ? DAYN[d] : ''); head2.push(t); }));
  function grid(name) {
    const rows = [head1.slice(), head2.slice()].concat(ROOMS.map(r => r.concat(new Array(head1.length - 2).fill(''))));
    const bgs = rows.map(r => r.map(() => ''));
    const sheet = new Sheet(name, rows, bgs);
    sheet.put = (room, day, time, text, color) => {
      const ri = rows.findIndex(r => r[0] === room), ci = colOf[day + '|' + time];
      if (ri < 0 || ci === undefined) throw new Error('no cell ' + room + ' ' + day + ' ' + time);
      rows[ri][ci] = text;
      if (color) bgs[ri][ci] = color;
    };
    return sheet;
  }
  const arrow = g => (g % 2 ? ' 🔼' : ' 🔽');
  function fill(sh) {
    PROGRAMS.forEach(([prog, room, groups], p) => {
      groups.forEach((g, k) => {
        sh.put(room, k, p % 2 ? '18:00' : '16:00', prog + ' ' + g + arrow(g));
        sh.put(room, 5 + (k % 2), WEEKEND[(Math.floor(k / 2) + p) % 5], prog + ' ' + g + arrow(g));
      });
    });
    JOINT.forEach(([eq, yoga], k) => {
      const day = k, time = k % 2 ? '18:00' : '16:00';
      sh.put('Սատուրն', day, time, 'EQ Lab ' + eq + arrow(eq) + ', Յոգա ' + yoga + arrow(yoga));
      sh.put('Պլուտոն', day, time, 'Յոգա ' + yoga + arrow(yoga) + ', EQ Lab ' + eq + arrow(eq));
      const wd = 5 + (k % 2), wt = WEEKEND[Math.floor(k / 2)];
      sh.put('Սատուրն', wd, wt, 'EQ Lab ' + eq + arrow(eq) + ', Յոգա ' + yoga + arrow(yoga));
      sh.put('Պլուտոն', wd, wt, 'Յոգա ' + yoga + arrow(yoga) + ', EQ Lab ' + eq + arrow(eq));
    });
    for (let d = 0; d < 5; d++) {
      sh.put('Արեգակ', d, '09:30', 'Բ' + (d % 3 + 1) + ' Մանկան Զարգացման անկյուն');
      sh.put('Արեգակ', d, '11:00', 'Ա' + (d % 3 + 1) + ' Մանկան Զարգացման անկյուն');
    }
    sh.put('Երկիր 3', 1, '11:00', 'Լոգոպեդ 11:00-12:00');
    sh.put('Երկիր 3', 3, '11:00', 'Լոգոպեդ 11:00-12:00');
    sh.put('Նեպտուն', 2, '13:30', 'Հոգեբանի խորհրդատվություն 13:30-14:30');
    sh.put('Երկիր 2', 0, '09:30', 'Ծնողների թվային գրագիտություն 10:00-11:30');
    sh.put('Երկիր 2', 3, '09:30', 'Ծնողների թվային գրագիտություն 10:00-11:30');
  }
  const week = grid('Weekly schedule ' + fmt(monday, 'dd.MM') + '-' + fmt(sunday, 'dd.MM'));
  fill(week);
  /* colours: a moved lesson, a cancelled one, a meeting and an event */
  week.put('Ծիր Կաթին', 2, '18:00', '');
  week.put('Օրիոն', 2, '18:00', 'Ռոբոտաշինություն 76 🔽', '#ffff00');
  week.put('Ուրան', 3, '18:00', 'Ագրո 69 🔼', '#ff0000');
  week.put('Օրիոն', 1, '13:30', 'Թիմի հանդիպում 13:30-15:00', '#00ffff');
  week.put('Յուպիտեր', 4, '16:00', 'Ֆիլմի ցուցադրություն', '#ff9900');
  const total = grid('Total');
  fill(total);

  const rules = new Sheet('Rules', [
    ['', 'Դասի տարածքի փոփոխություն'], ['', 'Դասի չեղարկում'], ['', 'Դասընթաց'],
    ['', 'Դասի ժամի փոփոխություն'], ['', 'Միջոցառում'], ['', 'Ժողով']
  ], [['#ffff00'], ['#ff0000'], ['#4a86e8'], ['#9900ff'], ['#ff9900'], ['#00ffff']]);

  const settings = [
    ['Կարգավորումներ', 'Արժեք'],
    ['Ադմինիստրատորի հասցե', ADMIN],
    ['Շաբաթական նամակ (ON/OFF)', 'OFF'],
    ['Փոփոխությունների նամակ (ON/OFF)', 'ON'],
    ['Թեստային ռեժիմ՝ միայն ադմինիստրատորին (ON/OFF)', 'ON'],
    ['Օրացույցի հղում', 'https://example.org/calendar'],
    ['Ամրագրման հաստատում (ON/OFF)', 'OFF']
  ];
  const groupRows = [];
  PROGRAMS.forEach(([prog, , groups, email]) => groups.forEach(g => groupRows.push([prog + ' ' + g, email, ''])));
  JOINT.forEach(([eq, yoga]) => {
    groupRows.push(['EQ Lab ' + eq + ', Յոգա ' + yoga, 'sona.melkonyan@example.org', '']);
    groupRows.push(['Յոգա ' + yoga + ', EQ Lab ' + eq, INSTRUCTOR, '']);
  });
  const staffRows = [['Group', 'Email 1', 'Email 2', '', settings[0][0], settings[0][1]]];
  for (let i = 0; i < Math.max(groupRows.length, settings.length - 1); i++) {
    const g = groupRows[i] || ['', '', ''], s = settings[i + 1] || ['', ''];
    staffRows.push([g[0], g[1], g[2], '', s[0], s[1]]);
  }
  const staff = new Sheet('Staff', staffRows);

  const ev = addDays(monday, 3);
  const events = new Sheet('Events', [
    ['Start Date', 'Subject', 'Start Time', 'End Time', 'Location'],
    [fmt(ev, 'dd.MM.yyyy'), 'Ծնողական ժողով', '18:30', '19:30', 'Յուպիտեր']
  ]);

  const env = makeEnv({ dir: SRC, user: opts.user || INSTRUCTOR, owner: 'owner@example.org', sheets: [rules, staff, week, total, events] });
  /* a few bookings made from the page */
  const iso = n => fmt(addDays(monday, n), 'yyyy-MM-dd');
  [
    [INSTRUCTOR, 'Օրիոն', 1, '11:00', '12:00', 'Ծնողական հանդիպում', 'Անի Հակոբյան', 'Յոգա 75, EQ Lab 8'],
    ['aram.petrosyan@example.org', 'Երկիր 1', 4, '13:30', '15:00', 'Հաքաթոնի պատրաստում', 'Արամ Պետրոսյան', 'Ծրագրավորում 77'],
    ['hasmik.avetisyan@example.org', 'Օրիոն', 3, '14:00', '15:00', 'Speaking club', 'Հասմիկ Ավետիսյան', 'Անգլերեն 59']
  ].forEach(([who, room, d, start, end, purpose, name, group]) => {
    env.user.email = who;
    env.ctx.createBooking({ room, date: iso(d), start, end, purpose, name, group });
  });
  env.user.email = opts.user || INSTRUCTOR;
  env.mail.length = 0;
  return { env, monday, week, INSTRUCTOR, ADMIN };
}

module.exports = { build, INSTRUCTOR, ADMIN };
