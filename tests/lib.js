// Shared test harness: serves index.html on a fake https origin and stubs Google Fonts and the GitHub Gist API.
// three.js comes from tests/vendor/three.min.js when that file exists (offline runs), otherwise from the real CDN.
// Set CHROMIUM_PATH to use a specific browser binary.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const HERE = path.join(__dirname, 'out');
fs.mkdirSync(HERE, { recursive: true });
const vendored = path.join(__dirname, 'vendor', 'three.min.js');
const three = fs.existsSync(vendored) ? fs.readFileSync(vendored) : null;
const URL0 = 'https://hs.test/index.html';

const gist = { id: 'g1', description: 'hafiza-sarayi-sync', files: {}, patches: 0, gets: 0 };

async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
}
async function newCtx(browser, opts = {}, init) {
  const { setup, ...copts } = opts;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true }, copts));
  await ctx.grantPermissions(['microphone'], { origin: 'https://hs.test' }).catch(() => {});
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u === URL0) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'index.html')) });
    if (u.includes('cdnjs.cloudflare.com')) return three ? route.fulfill({ contentType: 'application/javascript', body: three }) : route.continue();
    if (u.includes('fonts.googleapis.com')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (u.startsWith('https://api.github.com/')) {
      const req = route.request(), m = req.method(), p = new URL(u).pathname;
      const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if ((req.headers()['authorization'] || '') !== 'Bearer tok123') return json({ message: 'Bad credentials' }, 401);
      if (m === 'GET' && p === '/gists') return json(gist.created ? [{ id: gist.id, description: gist.description }] : []);
      if (m === 'POST' && p === '/gists') { gist.created = true; const b = JSON.parse(req.postData()); for (const k in b.files) gist.files[k] = { content: b.files[k].content }; return json({ id: gist.id }, 201); }
      if (m === 'GET' && p === '/gists/' + gist.id) { gist.gets++; return json({ id: gist.id, files: gist.files }); }
      if (m === 'PATCH' && p === '/gists/' + gist.id) {
        gist.patches++; const b = JSON.parse(req.postData());
        for (const k in b.files) { if (b.files[k] === null) delete gist.files[k]; else gist.files[k] = { content: b.files[k].content }; }
        return json({ id: gist.id, files: gist.files });
      }
      return json({ message: 'nope' }, 404);
    }
    return route.abort();
  });
  await ctx.addInitScript(() => { window.__HS_TEST = true; });
  if (opts.setup) await opts.setup(ctx);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(URL0);
  await page.waitForFunction(() => window.HS && document.getElementById('chips').children.length > 0, null, { timeout: 20000 });
  return { ctx, page, errors };
}
const idle = page => page.waitForFunction(() => !window.HS.busy, null, { timeout: 15000 });
async function enter(page, name) {
  await page.locator('#chips .chip', { hasText: name }).first().click();
  await page.waitForFunction(() => window.HS.view === 'room' && !window.HS.busy, null, { timeout: 15000 });
  await page.waitForTimeout(900);
}
async function back(page) {
  await page.click('#btn-back');
  await page.waitForFunction(() => window.HS.view === 'corridor' && !window.HS.busy, null, { timeout: 15000 });
}
// screen position of a note (or of one of its checklist boxes)
const notePos = (page, id, boxIndex = -1) => page.evaluate(([id, bi]) => {
  const m = window.HS.meshes.find(x => x.userData.note.id === id); if (!m) return null;
  const u = m.userData, k = 0.0046;
  let lx = 0, ly = 0;
  if (bi >= 0) { const b = u.boxes[bi]; lx = (-(u.cw / 2) + 30 + 21) * k; ly = ((u.ch / 2) - (b.y0 + 30)) * k; }
  const v = new THREE.Vector3(lx, ly, 0); m.updateMatrixWorld(); m.localToWorld(v);
  window.HS.roomCam.updateMatrixWorld(); v.project(window.HS.roomCam);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}, [id, boxIndex]);
const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
module.exports = { launch, newCtx, idle, enter, back, notePos, check, results, gist, HERE };
