// phone-size pass with real touch events
const { launch, newCtx, enter, back, notePos, check, results, HERE } = require('./lib');
(async () => {
  const browser = await launch();
  const { page, ctx, errors } = await newCtx(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  async function swipe(x0, y0, x1, y1, ms, hold = 0) {
    const steps = Math.max(2, Math.round(ms / 16));
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); await page.waitForTimeout(16); }
    if (hold) await page.waitForTimeout(hold);
    await touch('touchEnd', []);
  }
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await page.waitForTimeout(40); await touch('touchEnd', []); };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  await page.waitForTimeout(500);
  await page.screenshot({ path: HERE + '/m1-corridor.png' });
  check('phone: no horizontal overflow in corridor', !(await overflow()));
  check('phone: touch hint shown', /kaydır/.test(await page.locator('#hint').textContent()));
  // add rooms so the corridor is long enough to measure a flick
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.HS.state.rooms.push({ id: 'x' + i, name: 'Oda ' + i, hue: i * 30, sky: 'yildiz', sound: 'none', vol: .6, u: 1, o: 10 + i, lu: 1, links: [], notes: [] }); });
  await page.reload(); await page.waitForFunction(() => window.HS); await page.waitForTimeout(300);
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.HS.state.rooms.push({ id: 'x' + i, name: 'Oda ' + i, hue: i * 30, sky: 'yildiz', sound: 'none', vol: .6, u: 1, o: 10 + i, lu: 1, links: [], notes: [] }); });
  const z = () => page.evaluate(() => window.HS.cor.z);
  // violent flick: 500 px in ~60 ms
  let z0 = await z(); await swipe(195, 250, 195, 750, 60); await page.waitForTimeout(1800); let z1 = await z();
  check('phone: hard flick travels a bounded distance (was unbounded before)', z0 - z1 > 3 && z0 - z1 < 9, { travelled: +(z0 - z1).toFixed(2), doors: +((z0 - z1) / 3.4).toFixed(1) });
  // slow drag then hold: no glide at all
  z0 = await z(); await swipe(195, 300, 195, 600, 500, 200); const zr = await z(); await page.waitForTimeout(900); z1 = await z();
  check('phone: slow drag moves 1:1 and stops when the finger rests', Math.abs((z0 - zr) - 300 * .013) < .3 && Math.abs(zr - z1) < .05, { dragged: +(z0 - zr).toFixed(2), glide: +(zr - z1).toFixed(3) });
  await page.evaluate(() => { window.HS.cor.z = 1.5; });

  await page.locator('#chips .chip', { hasText: 'Fikirler' }).tap();
  await page.waitForFunction(() => window.HS.view === 'room' && !window.HS.busy, null, { timeout: 15000 }); await page.waitForTimeout(900);
  await page.screenshot({ path: HERE + '/m2-room.png' });
  check('phone: no horizontal overflow in room', !(await overflow()));
  // look around by swiping, bounded
  const y0 = await page.evaluate(() => window.HS.R.yaw); await swipe(100, 500, 340, 500, 50); await page.waitForTimeout(1500);
  const y1 = await page.evaluate(() => window.HS.R.yaw);
  check('phone: fast look-around swipe is bounded', y1 - y0 > .3 && y1 - y0 < 1.3, +(y1 - y0).toFixed(2));
  // pinch zoom
  const f0 = await page.evaluate(() => window.HS.roomCam.fov);
  await touch('touchStart', [[150, 500], [240, 500]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150 - i * 8, 500], [240 + i * 8, 500]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  const f1 = await page.evaluate(() => window.HS.roomCam.fov);
  check('phone: two-finger pinch zooms in', f1 < f0 - 10, { f0, f1: +f1.toFixed(1) });
  // double tap on empty space creates a note and opens the keyboard target
  const n0 = await page.evaluate(() => window.HS.meshes.length);
  await tap(200, 700); await page.waitForTimeout(120); await tap(200, 700); await page.waitForTimeout(300);
  check('phone: double tap creates a note', (await page.evaluate(() => window.HS.meshes.length)) === n0 + 1 && await page.locator('#editor').isVisible());
  await page.keyboard.type('[ ] telefondan madde');
  await page.screenshot({ path: HERE + '/m3-editor.png' });
  check('phone: no horizontal overflow with editor', !(await overflow()));
  const tools = await page.evaluate(() => { const t = document.querySelector('.tools'); return { scrolls: t.scrollWidth > t.clientWidth, inside: t.getBoundingClientRect().right <= innerWidth }; });
  check('phone: editor tool row scrolls inside the panel', tools.scrolls && tools.inside, tools);
  await page.locator('#btn-done').tap(); await page.waitForTimeout(400);
  // tap on the checkbox ticks it; tap on the note opens the editor without focusing the textarea
  const id = await page.evaluate(() => window.HS.state.rooms[window.HS.cur].notes.find(n => n.text.includes('telefondan')).id);
  await page.evaluate(i => { window.HS.roomCam.fov = 84; window.HS.roomCam.updateProjectionMatrix(); window.HS.focusNote(i); }, id); await page.waitForTimeout(1000);
  let bp = await notePos(page, id, 0); await tap(bp.x, bp.y); await page.waitForTimeout(250);
  check('phone: tapping the box ticks the item', await page.evaluate(i => window.HS.state.rooms[window.HS.cur].notes.find(n => n.id === i).text.startsWith('[x]'), id));
  bp = await notePos(page, id); await tap(bp.x + 30, bp.y); await page.waitForTimeout(250);
  check('phone: tapping a note opens the editor without popping the keyboard', await page.locator('#editor').isVisible() && await page.evaluate(() => document.activeElement.id !== 'note-text'));
  await page.locator('#btn-done').tap();
  // settings panel fits and scrolls
  await page.locator('#btn-settings').tap(); await page.waitForTimeout(250);
  await page.screenshot({ path: HERE + '/m4-settings.png' });
  const box = await page.locator('#settings').boundingBox();
  check('phone: settings panel fits the screen', box.x >= 15 && box.x + box.width <= 375.5 && box.y >= 0 && box.y + box.height <= 844, box);
  check('phone: no horizontal overflow with settings', !(await overflow()));
  await page.locator('#snd-opts button', { hasText: 'Kuşlar' }).tap(); await page.waitForTimeout(500);
  check('phone: ambience starts from a tap', await page.evaluate(() => window.HS.sound === 'kus' && window.HS.audio === 'running'));
  await page.locator('#btn-fall').tap(); await page.waitForTimeout(2400);
  await page.screenshot({ path: HERE + '/m5-fallen.png' });
  check('phone: Notları dök drops the notes', await page.evaluate(() => window.HS.fallen));
  await page.locator('#btn-back').tap(); await page.waitForFunction(() => window.HS.view === 'corridor' && !window.HS.busy, null, { timeout: 15000 });
  check('phone: ambience stops in the corridor', await page.evaluate(() => window.HS.sound === 'none'));
  await page.locator('#btn-quick').tap(); await page.waitForTimeout(200); await page.screenshot({ path: HERE + '/m6-quick.png' });
  await page.locator('#btn-quick-cancel').tap();
  await page.locator('#btn-data').tap(); await page.waitForTimeout(200); await page.screenshot({ path: HERE + '/m7-data.png' });
  const dbox = await page.locator('#data').boundingBox();
  check('phone: data panel fits the screen', dbox.y >= 0 && dbox.y + dbox.height <= 844, dbox);
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
