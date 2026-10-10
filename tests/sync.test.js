// sync, merge, migration
const { launch, newCtx, enter, back, check, results, gist, HERE } = require('./lib');
const sharp = require('sharp');
const st = page => page.evaluate(() => JSON.parse(JSON.stringify(window.HS.state)));
const sync = async page => { for (let i = 0; i < 40; i++) { const ok = await page.evaluate(() => window.HS.syncNow()); if (ok) return true; await page.waitForTimeout(150); } return false; };
const connect = async page => { await page.click('#btn-data'); await page.fill('#gist-token', 'tok123'); await page.click('#btn-gist'); await page.click('#btn-data-close');
  await page.waitForFunction(() => window.HS.lastSync > 0, null, { timeout: 10000 }); };

(async () => {
  const browser = await launch();

  // ---- pure merge logic
  const A = await newCtx(browser);
  const m = await A.page.evaluate(() => {
    const HS = window.HS, base = HS.seed(), out = {};
    const clone = o => JSON.parse(JSON.stringify(o)), T = Date.now();
    // different notes edited on two devices -> both survive
    let a = clone(base), b = clone(base);
    a.rooms[0].notes[0].text = 'A düzenledi'; a.rooms[0].notes[0].u = T + 10;
    b.rooms[0].notes[1].text = 'B düzenledi'; b.rooms[0].notes[1].u = T + 20;
    b.rooms[1].notes.push({ id: 'nb', text: 'B yeni not', t: 0, p: 0, r: 6, hue: 10, u: T + 5 });
    let r1 = HS.merge(a, b), r2 = HS.merge(b, a);
    out.bothEdits = r1.rooms[0].notes.some(n => n.text === 'A düzenledi') && r1.rooms[0].notes.some(n => n.text === 'B düzenledi') && r1.rooms[1].notes.some(n => n.id === 'nb');
    out.commutative = JSON.stringify(r1) === JSON.stringify(r2);
    out.idempotent = JSON.stringify(HS.merge(r1, r1)) === JSON.stringify(r1) && JSON.stringify(HS.merge(r1, a)) === JSON.stringify(r1);
    // same note edited on both -> newest wins
    a = clone(base); b = clone(base);
    a.rooms[0].notes[0].text = 'eski'; a.rooms[0].notes[0].u = T + 1; b.rooms[0].notes[0].text = 'yeni'; b.rooms[0].notes[0].u = T + 2;
    out.newestWins = HS.merge(a, b).rooms[0].notes.find(n => n.id === 'seed-1-0').text === 'yeni';
    // deletion beats an older copy, a later edit beats the deletion
    a = clone(base); b = clone(base);
    a.rooms[0].notes = a.rooms[0].notes.filter(n => n.id !== 'seed-1-0'); a.dead['seed-1-0'] = T + 5;
    out.deleteWins = !HS.merge(a, b).rooms[0].notes.some(n => n.id === 'seed-1-0') && !HS.merge(b, a).rooms[0].notes.some(n => n.id === 'seed-1-0');
    b.rooms[0].notes[0].u = T + 9; b.rooms[0].notes[0].text = 'silinmeden sonra düzenlendi';
    out.laterEditRevives = HS.merge(a, b).rooms[0].notes.some(n => n.id === 'seed-1-0');
    // room delete
    a = clone(base); b = clone(base); a.rooms.splice(1, 1); a.dead['seed-2'] = T;
    out.roomDelete = HS.merge(a, b).rooms.length === 2 && HS.merge(b, a).rooms.length === 2;
    // tie on timestamps must converge to the same result from both sides
    a = clone(base); b = clone(base); a.rooms[2].notes[0].text = 'örnek: yarın ilk iş…';
    out.tieConverges = JSON.stringify(HS.merge(a, b)) === JSON.stringify(HS.merge(b, a));
    // room settings + links
    a = clone(base); b = clone(base); a.rooms[0].name = 'Yeni ad'; a.rooms[0].u = T + 3; b.rooms[0].links = [['seed-1-0', 'seed-1-1']]; b.rooms[0].lu = T + 3;
    const r = HS.merge(a, b).rooms[0]; out.metaAndLinks = r.name === 'Yeni ad' && r.links.length === 1;
    // v1 data (no ids/timestamps) migrates onto the fixed seed ids
    const v1 = { rooms: [{ id: 'abc', name: 'Fikirler', hue: 45, notes: [{ id: 'x1', text: 'Boşluğa çift tıkla: yeni not', t: .28, p: .14, r: 6, hue: 45 }, { id: 'x2', text: 'benim notum', t: 1, p: 0, r: 6, hue: 45 }] },
      { id: 'def', name: 'Projeler', hue: 190, notes: [] }, { id: 'ghi', name: 'Yapılacaklar', hue: 320, notes: [{ id: 'x3', text: 'örnek: yarın ilk iş…', t: 0, p: .05, r: 6, hue: 320 }] }] };
    const mg = HS.normalize(v1);
    out.migration = mg.rooms.map(r => r.id).join() === 'seed-1,seed-2,seed-3' && mg.rooms[0].notes.some(n => n.id === 'seed-1-0') && mg.rooms[0].notes.some(n => n.id === 'x2') && mg.rooms[2].notes[0].id === 'seed-3-0';
    out.garbage = HS.normalize({ rooms: 'x' }) === null && HS.normalize(null) === null && HS.normalize({ rooms: [null, 5, { notes: 'bad' }] }).rooms.length === 1;
    return out;
  });
  for (const k in m) check('merge: ' + k, m[k]);

  // ---- two devices through the fake Gist
  const B = await newCtx(browser);
  // device A makes content first
  await enter(A.page, 'Projeler');
  await A.page.click('#btn-add-note'); await A.page.waitForTimeout(200); await A.page.keyboard.type('A cihazından not');
  const png = await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 30, g: 200, b: 120 } } }).png().toBuffer();
  await A.page.setInputFiles('#file-img', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await A.page.waitForFunction(() => window.HS.state.rooms[window.HS.cur].notes.some(n => n.img), null, { timeout: 5000 });
  await A.page.click('#btn-done'); await back(A.page);
  await connect(A.page);
  check('gist: device A connected and pushed', Object.keys(gist.files).filter(f => f.startsWith('r_')).length === 3 && !!gist.files['meta.json'], Object.keys(gist.files));
  check('gist: image uploaded as its own file', Object.keys(gist.files).some(f => f.startsWith('m_')));
  await A.page.click('#btn-data'); await A.page.waitForTimeout(150); await A.page.screenshot({ path: HERE + '/s20-sync-on.png' }); await A.page.click('#btn-data-close');

  await connect(B.page);
  let sb = await st(B.page);
  const bn = sb.rooms.find(r => r.name === 'Projeler').notes.find(n => n.text === 'A cihazından not');
  check('gist: device B received the note from A', !!bn, sb.rooms.map(r => r.notes.length));
  await enter(B.page, 'Projeler'); await B.page.waitForTimeout(1200);
  await B.page.screenshot({ path: HERE + '/s21-deviceB.png' });
  check('gist: device B downloaded the image', await B.page.evaluate(id => { const m = window.HS.meshes.find(x => x.userData.note.id === id); return m && m.userData.ch > 200; }, bn.id));

  // B edits while its room is open; A is sitting in the same room and should update live
  await enter(A.page, 'Projeler');
  await B.page.evaluate(id => window.HS.gotoNote(window.HS.state.rooms[window.HS.cur].id, id), bn.id);
  await B.page.click('#btn-add-note'); await B.page.waitForTimeout(200); await B.page.keyboard.type('B cihazından cevap'); await B.page.click('#btn-done');
  await B.page.waitForTimeout(400); check('sync B', await sync(B.page));
  check('sync A', await sync(A.page));
  check('gist: A sees B\'s new note without leaving the room', await A.page.evaluate(() => window.HS.meshes.some(m => m.userData.note.text === 'B cihazından cevap')));
  // concurrent edits on different notes
  await A.page.evaluate(() => { const n = window.HS.state.rooms[window.HS.cur].notes.find(n => n.text === 'A cihazından not'); n.text = 'A tekrar yazdı'; n.u = Date.now(); });
  await B.page.evaluate(() => { const n = window.HS.state.rooms[window.HS.cur].notes.find(n => n.text === 'B cihazından cevap'); n.text = 'B tekrar yazdı'; n.u = Date.now(); });
  await sync(A.page); await sync(B.page); await sync(A.page);
  const ta = (await st(A.page)).rooms.find(r => r.name === 'Projeler').notes.map(n => n.text).sort();
  const tb = (await st(B.page)).rooms.find(r => r.name === 'Projeler').notes.map(n => n.text).sort();
  check('gist: concurrent edits to different notes both survive on both devices', ta.includes('A tekrar yazdı') && ta.includes('B tekrar yazdı') && JSON.stringify(ta) === JSON.stringify(tb), { ta, tb });
  // delete on A propagates to B
  await A.page.evaluate(() => { const r = window.HS.state.rooms[window.HS.cur]; const n = r.notes.find(n => n.text === 'B tekrar yazdı'); r.notes = r.notes.filter(x => x !== n); window.HS.state.dead[n.id] = Date.now(); });
  await sync(A.page); await sync(B.page);
  check('gist: deletion on A removes the note on B', !(await B.page.evaluate(() => window.HS.meshes.some(m => m.userData.note.text === 'B tekrar yazdı'))));
  // room settings + new room propagate
  await back(B.page); await back(A.page);
  await A.page.click('#btn-add-room'); await A.page.waitForFunction(() => window.HS.view === 'room' && !window.HS.busy); await A.page.waitForTimeout(300);
  await A.page.keyboard.type('Ortak oda'); await A.page.locator('#snd-opts button', { hasText: 'Yağmur' }).click(); await A.page.locator('#sky-opts button', { hasText: 'Kar' }).click();
  await A.page.click('#btn-settings-close'); await A.page.waitForTimeout(400);
  await sync(A.page); await sync(B.page);
  const nr = (await st(B.page)).rooms.find(r => r.name === 'Ortak oda');
  check('gist: new room with its sky and sound reaches B', nr && nr.sky === 'kar' && nr.sound === 'yagmur', nr && { sky: nr.sky, sound: nr.sound });
  check('gist: B corridor shows the new door', (await B.page.locator('#chips .chip').count()) === 4);
  // stability: once equal, further syncs write nothing
  await sync(A.page); await sync(B.page);
  const p0 = gist.patches; await sync(A.page); await sync(B.page); await sync(A.page); await sync(B.page);
  check('gist: no ping-pong, idle syncs make zero writes', gist.patches === p0, { before: p0, after: gist.patches });
  check('gist: states identical on both devices', JSON.stringify(await A.page.evaluate(() => window.HS.normalize(window.HS.state))) === JSON.stringify(await B.page.evaluate(() => window.HS.normalize(window.HS.state))));
  // wrong token surfaces an error
  const C = await newCtx(browser);
  await C.page.click('#btn-data'); await C.page.fill('#gist-token', 'yanlis'); await C.page.click('#btn-gist'); await C.page.waitForTimeout(800);
  check('gist: bad token shows an error and keeps local notes', /geçersiz/.test(await C.page.locator('#sync-status').textContent()) && (await st(C.page)).rooms.length === 3, await C.page.locator('#sync-status').textContent());

  // ---- simulated Claude data store (same adapter code path the published page uses)
  const store = {}; let writes = 0;
  const setup = async ctx => ctx.exposeBinding('__db', (src, op, path, data) => {
    const seg = path.split('/');
    if (!seg.every(s => /^[A-Za-z0-9_\-.~:@+]+$/.test(s))) throw new Error('bad segment ' + path);
    if (op === 'list') { if (seg.length % 2 !== 1) throw new Error('collection parity ' + path); const o = {}; for (const k in store) if (k.startsWith(path + '/') && k.split('/').length === seg.length + 1) o[k.split('/').pop()] = store[k]; return JSON.stringify(o); }
    if (seg.length % 2 !== 0) throw new Error('doc parity ' + path);
    if (op === 'get') return store[path] ? JSON.stringify(store[path]) : null;
    if (op === 'set') { if (data.length > 256 * 1024) throw new Error('doc too big'); writes++; store[path] = JSON.parse(data); return null; }
    if (op === 'del') { writes++; delete store[path]; return null; }
  });
  const init = () => {
    const call = (op, path, data) => window.__db(op, path, data ? JSON.stringify(data) : null).then(r => r ? JSON.parse(r) : null);
    const docRef = path => ({ path, id: path.split('/').pop(),
      get: async () => { const d = await call('get', path); return { id: path.split('/').pop(), exists: !!d, data: () => d ? Object.freeze(d) : undefined, metadata: { fromCache: false, hasPendingWrites: false } }; },
      set: d => call('set', path, d), delete: () => call('del', path), onSnapshot: () => () => {}, collection: sub => colRef(path + '/' + sub) });
    const colRef = path => { const q = { path, doc: id => docRef(path + '/' + id), limit: () => q, onSnapshot: () => () => {},
      get: async () => { const all = await call('list', path); const docs = Object.keys(all).sort().map(id => ({ id, exists: true, data: () => Object.freeze(all[id]), metadata: {} })); return { docs, size: docs.length, empty: !docs.length }; } }; return q; };
    window.claude = { use: async name => name === 'db' ? Object.freeze({ doc: docRef, collection: colRef }) : name === 'user' ? Object.freeze({ id: async () => 'u_1' }) : null };
  };
  const D = await newCtx(browser, { setup }, init);
  await D.page.waitForFunction(() => window.HS.lastSync > 0, null, { timeout: 10000 });
  check('claude store (simulated): first device pushes rooms + meta under the private per-user path', Object.keys(store).filter(k => k.startsWith('data/users/u_1/saray/rooms/')).length === 3 && !!store['data/users/u_1/saray'], Object.keys(store));
  await enter(D.page, 'Fikirler'); await D.page.click('#btn-add-note'); await D.page.waitForTimeout(200); await D.page.keyboard.type('telefondan'); await D.page.click('#btn-done'); await D.page.waitForTimeout(400);
  await sync(D.page);
  const E = await newCtx(browser, { setup }, init);
  await E.page.waitForFunction(() => window.HS.lastSync > 0, null, { timeout: 10000 });
  check('claude store (simulated): second device receives the note', (await st(E.page)).rooms[0].notes.some(n => n.text === 'telefondan'));
  await back(D.page); await D.page.click('#btn-data'); await D.page.waitForTimeout(150);
  check('claude store (simulated): Gist box hidden, status says sync is on', await D.page.locator('#gist-box').isHidden() && /Claude hesabın/.test(await D.page.locator('#sync-status').textContent()), await D.page.locator('#sync-status').textContent());
  await D.page.click('#btn-data-close');
  const w0 = writes; await sync(D.page); await sync(E.page); await sync(D.page);
  check('claude store (simulated): idle syncs make zero writes', writes === w0, { w0, writes });

  for (const x of [A, B, C, D, E]) check('no page errors', x.errors.length === 0, x.errors);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
