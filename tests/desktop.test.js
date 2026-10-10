// desktop feature pass
const { launch, newCtx, enter, back, notePos, check, results, HERE } = require('./lib');
const fs = require('fs');
const sharp = require('sharp');

function wav() { // 1 s 440 Hz mono 8 kHz
  const sr = 8000, n = sr, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / sr * 2 * Math.PI * 440) * 9000), 44 + i * 2);
  return buf;
}

(async () => {
  const browser = await launch();
  const { page, errors } = await newCtx(browser);
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.HS.state)));
  const room = async () => (await st()).rooms[await page.evaluate(() => window.HS.cur)];

  await page.waitForTimeout(600);
  await page.screenshot({ path: HERE + '/s1-corridor.png' });
  check('boot: 3 seed rooms', (await st()).rooms.length === 3);

  // corridor drag moves forward
  const z0 = await page.evaluate(() => window.HS.cor.z);
  await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(640, 420, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(700);
  const z1 = await page.evaluate(() => window.HS.cor.z);
  check('corridor: drag down advances', z1 < z0 - 1, { z0, z1 });

  await enter(page, 'Yapılacaklar');
  await page.screenshot({ path: HERE + '/s2-room-checklist.png' });
  // checklist toggle by clicking the box in 3D
  let r = await room(); const seedNote = r.notes[0];
  const bp = await notePos(page, seedNote.id, 0);
  await page.mouse.click(bp.x, bp.y); await page.waitForTimeout(200);
  r = await room();
  check('checklist: clicking the box ticks the item', /^\[x\] örnek: yarın/.test(r.notes[0].text), r.notes[0].text.split('\n')[0]);
  check('checklist: box click does not open editor', await page.locator('#editor').isHidden());

  // new note with list continuation
  await page.click('#btn-add-note'); await page.waitForTimeout(200);
  await page.keyboard.type('[ ] süt al'); await page.keyboard.press('Enter'); await page.keyboard.type('ekmek');
  r = await room();
  const mine = r.notes.find(n => n.text.includes('süt'));
  check('checklist: Enter continues the list', mine && mine.text === '[ ] süt al\n[ ] ekmek', mine && mine.text);
  await page.click('#btn-list'); r = await room();
  check('Liste button strips markers', r.notes.find(n => n.id === mine.id).text === 'süt al\nekmek');
  await page.click('#btn-list'); r = await room();
  check('Liste button adds markers', r.notes.find(n => n.id === mine.id).text === '[ ] süt al\n[ ] ekmek');

  // image attach
  const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 220, g: 60, b: 90 } } }).png().toBuffer();
  await page.setInputFiles('#file-img', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(id => window.HS.state.rooms[window.HS.cur].notes.find(n => n.id === id).img, mine.id, { timeout: 5000 });
  await page.waitForTimeout(500);
  check('image: attached to note', true);
  await page.screenshot({ path: HERE + '/s3-note-image-editor.png' });
  const imgId1 = (await room()).notes.find(n => n.id === mine.id).img;
  // drawing
  await page.click('#btn-draw'); await page.waitForTimeout(150);
  const pad = await page.locator('#draw-pad').boundingBox();
  await page.mouse.move(pad.x + 60, pad.y + 60); await page.mouse.down(); await page.mouse.move(pad.x + 260, pad.y + 180, { steps: 10 }); await page.mouse.move(pad.x + 380, pad.y + 80, { steps: 10 }); await page.mouse.up();
  await page.screenshot({ path: HERE + '/s4-draw.png' });
  await page.click('#btn-draw-save');
  await page.waitForFunction(([id, old]) => { const n = window.HS.state.rooms[window.HS.cur].notes.find(n => n.id === id); return n.img && n.img !== old; }, [mine.id, imgId1], { timeout: 5000 });
  check('drawing: saved as the note image', true);
  await page.click('#btn-done'); await page.waitForTimeout(400);

  // link two notes
  const pA = await notePos(page, mine.id);
  await page.mouse.click(pA.x, pA.y); await page.waitForTimeout(200);
  check('editor opens on note click', await page.locator('#editor').isVisible());
  await page.click('#btn-link');
  const pB = await notePos(page, seedNote.id);
  await page.mouse.click(pB.x + 30, pB.y); await page.waitForTimeout(300);
  r = await room();
  check('link: two notes connected', r.links.length === 1, r.links);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + '/s5-linked.png' });

  // settings: skies and sounds
  await page.click('#btn-settings'); await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + '/s6-settings.png' });
  const skies = await page.locator('#sky-opts button').allTextContents();
  for (const s of skies) { await page.locator('#sky-opts button', { hasText: s }).first().click(); await page.waitForTimeout(250); }
  check('sky: all ' + skies.length + ' options switch', (await room()).sky === 'bos', skies);
  await page.locator('#sky-opts button', { hasText: 'Bulutsu' }).click();
  const sounds = await page.locator('#snd-opts button').allTextContents();
  const heard = [], levels = {};
  for (const s of sounds) { await page.locator('#snd-opts button', { hasText: s }).first().click(); await page.waitForTimeout(1300); heard.push(await page.evaluate(() => window.HS.sound)); const lv = await page.evaluate(async () => { let r = 0, p = 0; for (let i = 0; i < 70; i++) { const l = window.HS.level(); r = Math.max(r, l.rms); p = Math.max(p, l.peak); await new Promise(x => setTimeout(x, 30)); } return { rms: +r.toFixed(4), peak: +p.toFixed(3) }; }); levels[s] = lv; }
  check('sound: all ' + sounds.length + ' options start', new Set(heard).size === sounds.length && heard[heard.length - 1] === 'saat', heard);
  check('sound: every built-in sound produces signal, none clips', Object.keys(levels).every(k => k === 'Sessiz' ? levels[k].rms < .002 : (levels[k].rms > .003 && levels[k].peak < 1)), levels);
  check('audio context running', (await page.evaluate(() => window.HS.audio)) === 'running');
  // is real signal produced? tap the master through an analyser
  await page.locator('#snd-opts button', { hasText: 'Deniz' }).click(); await page.waitForTimeout(1200);
  // own sound from a file
  await page.setInputFiles('#file-snd', { name: 'ton.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.waitForFunction(() => window.HS.state.sounds.length === 1, null, { timeout: 5000 });
  r = await room();
  check('own sound: file added and selected', r.sound.startsWith('c:'), r.sound);
  // own sound from the microphone (fake device)
  await page.click('#btn-snd-rec'); await page.waitForTimeout(1500); await page.click('#btn-snd-rec');
  const recOk = await page.waitForFunction(() => window.HS.state.sounds.length === 2, null, { timeout: 6000 }).then(() => true, () => false);
  check('own sound: microphone recording added', recOk, await page.locator('#toast').textContent());
  // hue, volume, mute
  await page.locator('#room-hue').fill('200'); await page.locator('#room-vol').fill('30');
  r = await room();
  check('settings: hue + volume stored', r.hue === 200 && Math.abs(r.vol - .3) < .001, { hue: r.hue, vol: r.vol });
  await page.fill('#room-name', 'İşler'); r = await room();
  check('settings: rename', r.name === 'İşler' && (await page.locator('#room-title').textContent()) === 'İşler');
  await page.screenshot({ path: HERE + '/s7-settings-after.png' });
  // fall
  await page.click('#btn-fall'); await page.waitForTimeout(2600);
  check('fall: notes on the floor', await page.evaluate(() => window.HS.fallen && window.HS.meshes.every(m => m.position.y < -3)));
  await page.screenshot({ path: HERE + '/s8-fallen.png' });
  // shake for ~3.4 s restores
  await page.evaluate(() => new Promise(res => { let n = 0; const iv = setInterval(() => {
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: (n % 2 ? 18 : -18), y: 3, z: 1 }, interval: 16 }));
    if (++n > 215) { clearInterval(iv); res(); } }, 16); }));
  await page.waitForTimeout(1600);
  check('shake: ~3 s of motion events restores the notes', await page.evaluate(() => !window.HS.fallen));
  // short shake must not trigger
  await page.evaluate(() => new Promise(res => { let n = 0; const iv = setInterval(() => {
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: (n % 2 ? 18 : -18), y: 3, z: 1 }, interval: 16 }));
    if (++n > 60) { clearInterval(iv); res(); } }, 16); }));
  await page.waitForTimeout(600);
  check('shake: 1 s of shaking does nothing', await page.evaluate(() => !window.HS.fallen));

  // gyro
  await page.click('#btn-settings'); await page.click('#btn-gyro'); await page.click('#btn-settings-close');
  const orient = (a, b, g) => page.evaluate(([a, b, g]) => { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g })); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ yaw: window.HS.R.yaw, pitch: window.HS.R.pitch })))); }, [a, b, g]);
  const o1 = await orient(0, 90, 0), o2 = await orient(40, 90, 0), o3 = await orient(40, 120, 0);
  const dyaw = Math.atan2(Math.sin(o2.yaw - o1.yaw), Math.cos(o2.yaw - o1.yaw));
  check('gyro: upright phone looks at the horizon', Math.abs(o1.pitch) < .02, o1);
  check('gyro: turning the phone 40° left turns the view 40° left', Math.abs(dyaw - 40 * Math.PI / 180) < .03, dyaw);
  check('gyro: tilting 30° up looks 30° up', Math.abs(o3.pitch - 30 * Math.PI / 180) < .03, o3.pitch);
  await page.click('#btn-settings'); await page.click('#btn-gyro'); await page.click('#btn-settings-close');

  // move note to another room
  const pM = await notePos(page, mine.id); await page.mouse.click(pM.x, pM.y); await page.waitForTimeout(200);
  await page.selectOption('#move-to', { label: '→ Projeler' }); await page.waitForTimeout(300);
  let s = await st();
  check('move: note left this room, arrived in Projeler, link dropped',
    !s.rooms.find(x => x.name === 'İşler').notes.some(n => n.text.includes('süt')) && s.rooms.find(x => x.name === 'Projeler').notes.some(n => n.text.includes('süt')) && s.rooms.find(x => x.name === 'İşler').links.length === 0);

  // search inside a room -> other room
  await page.keyboard.press('/'); await page.keyboard.type('süt'); await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + '/s9-search.png' });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.HS.busy && window.HS.state.rooms[window.HS.cur].name === 'Projeler', null, { timeout: 8000 });
  await page.waitForTimeout(1000);
  const aim = await page.evaluate(() => { const n = window.HS.state.rooms[window.HS.cur].notes.find(n => n.text.includes('süt')); return Math.abs(Math.atan2(Math.sin(n.t - window.HS.R.yaw), Math.cos(n.t - window.HS.R.yaw))) + Math.abs(n.p - window.HS.R.pitch); });
  check('search: jumps to the other room and looks at the note', aim < .05, aim);
  check('ambience follows the room (Projeler is silent)', (await page.evaluate(() => window.HS.sound)) === 'none');

  await back(page);
  // quick capture
  await page.click('#btn-quick'); await page.keyboard.type('akla gelen şey'); await page.click('#btn-quick-add'); await page.waitForTimeout(300);
  s = await st();
  check('quick note: inbox room created as the first door with the note', s.rooms[0].inbox && s.rooms[0].notes[0].text === 'akla gelen şey', s.rooms.map(x => x.name));
  // search from corridor
  await page.keyboard.press('/'); await page.keyboard.type('akla'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.HS.view === 'room' && !window.HS.busy, null, { timeout: 15000 });
  check('search from corridor enters the room', (await room()).inbox === true);
  await back(page);
  // new room -> settings open with name focused
  await page.click('#btn-add-room');
  await page.waitForFunction(() => window.HS.view === 'room' && !window.HS.busy, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  check('new room opens its settings', await page.locator('#settings').isVisible());
  await page.keyboard.type('Borsa'); await page.keyboard.press('Enter');
  check('new room renamed from keyboard', (await room()).name === 'Borsa');
  // delete room
  await page.click('#btn-settings'); await page.click('#btn-del-room'); await page.click('#btn-del-room');
  await page.waitForFunction(() => window.HS.view === 'corridor' && !window.HS.busy, null, { timeout: 15000 });
  s = await st();
  check('delete room: removed and tombstoned', !s.rooms.some(x => x.name === 'Borsa') && Object.keys(s.dead).length > 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: HERE + '/s10-corridor-after.png' });

  // persistence across reload
  await page.waitForTimeout(500); await page.reload();
  await page.waitForFunction(() => window.HS && document.getElementById('chips').children.length > 0);
  s = await st();
  check('reload: state persisted', s.rooms.length === 4 && s.rooms[0].inbox && s.sounds.length === 2, s.rooms.map(x => x.name));
  await enter(page, 'Projeler'); await page.waitForTimeout(800);
  await page.screenshot({ path: HERE + '/s11-reload-image.png' });
  // backup data panel
  await back(page); await page.click('#btn-data'); await page.waitForTimeout(200);
  await page.screenshot({ path: HERE + '/s12-data.png' });
  check('data panel: gist box shown outside Claude, status says off', await page.locator('#gist-box').isVisible() && /kapalı/.test(await page.locator('#sync-status').textContent()));

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
