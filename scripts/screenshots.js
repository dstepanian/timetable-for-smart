process.env.TZ = process.env.TZ || 'Asia/Yerevan';
/* Makes the pictures in docs/ from the made-up week in demo-data.js.
   Run: npm run screenshots   (needs Playwright's Chromium and ffmpeg for the GIF)
   FONTS_DIR=<folder with the @fontsource packages> serves the web fonts locally when
   fonts.googleapis.com cannot be reached. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { build } = require('./demo-data');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'src', 'Index.html')).href;
const OUT = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

/* google.script.run, answered by the real server code running on the demo sheet */
const RUNNER = `(function(){
  function runner(ok, fail){
    return new Proxy({}, { get: function(t, prop){
      if (prop === 'withSuccessHandler') return function(h){ return runner(h, fail); };
      if (prop === 'withFailureHandler') return function(h){ return runner(ok, h); };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        window.gasCall(prop, JSON.stringify(args)).then(function(r){
          var o = JSON.parse(r);
          setTimeout(function(){ if (o.err) { fail && fail(new Error(o.err)); } else { ok && ok(o.val); } }, 30);
        });
      };
    }});
  }
  window.google = { script: { run: runner(null, null) } };
})();`;

/* a visible mouse pointer for the GIF; it stays above open dialogs */
const CURSOR = `(function(){
  var c, r;
  function top(){ if (!c || !c.isConnected) return; try { c.hidePopover(); } catch (e) {} try { c.showPopover(); } catch (e) {} }
  function setup(){
    c = document.createElement('div'); c.setAttribute('popover', 'manual');
    c.style.cssText = 'position:fixed;inset:0 auto auto 0;margin:0;padding:0;border:0;background:transparent;overflow:visible;width:24px;height:24px;pointer-events:none;transform:translate(-80px,-80px)';
    c.innerHTML = '<span style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;background:rgba(245,158,11,.45);transform:scale(0);transition:transform .25s,opacity .35s;opacity:0"></span>' +
      '<svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:-3px;top:-2px"><path d="M4 2.5l6.8 18.2 2.6-7.6 7.4-2.7z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    r = c.firstChild;
    document.body.appendChild(c); top();
    new MutationObserver(top).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  addEventListener('mousemove', function(e){ if (c) c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  addEventListener('mousedown', function(){ if (!r) return; r.style.transition = 'none'; r.style.opacity = '1'; r.style.transform = 'scale(.3)';
    requestAnimationFrame(function(){ r.style.transition = 'transform .3s, opacity .45s'; r.style.transform = 'scale(1.2)'; r.style.opacity = '0'; }); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();`;

function fontRoutes(ctx) {
  const dir = process.env.FONTS_DIR;
  if (!dir) return;
  const pkgs = { 'Noto Sans Armenian': ['noto-sans-armenian', [400, 500, 600, 700]], 'Noto Serif Armenian': ['noto-serif-armenian', [600, 700]], 'JetBrains Mono': ['jetbrains-mono', [500, 700]] };
  const find = name => fs.readdirSync(dir).map(d => path.join(dir, d, 'package')).find(p => fs.existsSync(p) && JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).name === '@fontsource/' + name);
  let css = '';
  for (const fam in pkgs) {
    const [name, weights] = pkgs[fam], root = find(name);
    if (!root) continue;
    weights.forEach(w => { css += fs.readFileSync(path.join(root, w + '.css'), 'utf8').replace(/url\(\.\/files\//g, 'url(https://fonts.gstatic.com/fontsource/' + name + '/'); });
  }
  ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ contentType: 'text/css', body: css }));
  ctx.route(/fonts\.gstatic\.com\/fontsource\//, r => {
    const m = r.request().url().match(/fontsource\/([^/]+)\/(.+)$/);
    const root = m && find(m[1]);
    if (!root) return r.abort();
    r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(root, 'files', m[2])) });
  });
}

(async () => {
  const browser = await chromium.launch();
  const demo = build();
  const now = new Date(demo.monday); now.setDate(now.getDate() + 2); now.setHours(10, 20, 0, 0);  /* Wednesday morning */

  async function open(env, o) {
    o = o || {};
    const ctx = await browser.newContext(Object.assign({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'hy-AM', timezoneId: 'Asia/Yerevan', colorScheme: 'light'
    }, o.ctx || {}));
    fontRoutes(ctx);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(now);
    await page.exposeFunction('gasCall', async (fn, args) => {
      try { return JSON.stringify({ val: await env.ctx[fn].apply(null, JSON.parse(args)) }); }
      catch (e) { return JSON.stringify({ err: e.message }); }
    });
    await page.addInitScript(RUNNER);
    if (o.cursor) await page.addInitScript(CURSOR);
    await page.goto(PAGE);
    await page.waitForSelector('#stats .stat');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    return page;
  }
  const shot = (page, name, clip) => page.screenshot({ path: path.join(OUT, name), clip }).then(() => console.log('docs/' + name));

  /* the instructor lands on her own program */
  let p = await open(demo.env);
  await shot(p, 'program.png');
  await p.click('#view [data-mv] >> nth=2');
  await p.selectOption('#mvTo', { index: 3 });
  await p.waitForTimeout(200);
  await shot(p, 'move.png');
  await p.keyboard.press('Escape');
  await p.click('#tab-time'); await p.waitForTimeout(300);
  await shot(p, 'week.png');
  await p.click('#bookBtn');
  await p.selectOption('#bkRoom', 'Օրիոն');
  await p.selectOption('#bkGroup', { index: 3 });
  await p.fill('#bkPurpose', 'Ծնողական հանդիպում');
  await p.waitForTimeout(300);
  await shot(p, 'booking.png');
  await p.context().close();

  /* dark theme, rooms view */
  p = await open(demo.env, { ctx: { colorScheme: 'dark' } });
  await p.click('#tab-place'); await p.waitForTimeout(300);
  await shot(p, 'dark.png');
  await p.context().close();

  /* phone */
  p = await open(demo.env, { ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } });
  await shot(p, 'mobile.png');
  await p.context().close();

  /* the GIF: a fresh copy of the week, so the move really happens */
  const gifDemo = build();
  p = await open(gifDemo.env, { cursor: true, ctx: { viewport: { width: 1280, height: 800 } } });
  const frames = [];
  const cdp = await p.context().newCDPSession(p);
  cdp.on('Page.screencastFrame', async f => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });
  let pos = { x: 640, y: 420 };
  await p.mouse.move(pos.x, pos.y);
  async function moveTo(sel, dx, dy) {
    const loc = p.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const x = b.x + (dx == null ? b.width / 2 : dx), y = b.y + (dy == null ? b.height / 2 : dy);
    const steps = Math.max(8, Math.round(Math.hypot(x - pos.x, y - pos.y) / 40));
    await p.mouse.move(x, y, { steps });
    pos = { x, y };
  }
  async function click(sel, wait) { await moveTo(sel); await p.waitForTimeout(120); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(wait || 600); }
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  await p.waitForTimeout(1600);
  await click('#view [data-mv] >> nth=0', 900);
  await moveTo('#mvTo'); await p.waitForTimeout(300);
  await p.selectOption('#mvTo', { index: 3 }); await p.waitForTimeout(900);
  await click('#mvDlg [data-mvgo]', 2600);
  await click('#tab-time', 1200);
  await click('#roomBtn', 800);
  await click('#roomPop input[data-room="Սատուրն"]', 500);
  await click('#roomPop input[data-room="Պլուտոն"]', 1300);
  await p.keyboard.press('Escape'); await p.waitForTimeout(1400);
  await click('#legendBtn', 1800);
  await click('#roomChips .chip[data-room="Սատուրն"]', 500);
  await click('#roomChips .chip[data-room="Պլուտոն"]', 1200);
  await click('#bookBtn', 700);
  await moveTo('#bkRoom'); await p.selectOption('#bkRoom', 'Օրիոն'); await p.waitForTimeout(500);
  await moveTo('#bkGroup'); await p.selectOption('#bkGroup', { index: 3 }); await p.waitForTimeout(400);
  await moveTo('#bkPurpose'); await p.mouse.down(); await p.mouse.up();
  await p.keyboard.type('Ծնողական հանդիպում', { delay: 40 });
  await p.waitForTimeout(1600);
  await cdp.send('Page.stopScreencast');
  await p.context().close();
  await browser.close();

  /* frames -> GIF (each frame lasts until the next one) */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-'));
  let list = '';
  frames.forEach((f, i) => {
    const file = path.join(tmp, String(i).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    const dur = i + 1 < frames.length ? Math.max(0.04, frames[i + 1].t - f.t) : 2;
    list += "file '" + file + "'\nduration " + dur.toFixed(3) + '\n';
  });
  list += "file '" + path.join(tmp, String(frames.length - 1).padStart(5, '0') + '.jpg') + "'\n";
  fs.writeFileSync(path.join(tmp, 'list.txt'), list);
  const gif = path.join(OUT, 'demo.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'),
    '-vf', 'setpts=0.75*PTS,fps=12,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', gif]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('docs/demo.gif ' + Math.round(fs.statSync(gif).size / 1024) + ' KB, ' + frames.length + ' frames');
})();
