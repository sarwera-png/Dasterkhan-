const BASE = process.env.UI_BASE || 'http://localhost:3000'; // the runner starts the server (no Gemini key) and sets UI_BASE
const { chromium } = require('playwright'); const assert = require('assert');
const PRICES = ['350 PKR', '450 PKR', '250 PKR', '220 PKR', '80 PKR', '100 PKR', '60 PKR', '150 PKR', '40 PKR', '100 PKR'];
const MENU = ['Chicken Biryani - 350 PKR', 'Beef Pulao - 450 PKR', 'Daal Chawal - 250 PKR', 'Chicken Roll - 220 PKR', 'Raita - 80 PKR', 'Salad - 100 PKR', 'Water 500 ml - 60 PKR', 'Kheer cup - 150 PKR', 'Naan - 40 PKR', 'Tea - 100 PKR'];
const REPLY = 'ہمارا مینو یہ ہے:\n\n' + MENU.join('\n') + '\n\nآرڈر کے لیے بتائیں۔';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const w of [360, 768, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: w === 360 ? 740 : 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    let next = { reply: REPLY, sessionId: 'a'.repeat(32), reviewVersion: null };
    await p.route('**/api/chat', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next) }));
    await p.goto(BASE + '/'); await p.addStyleTag({ content: 'html{scroll-behavior:auto!important}' }); await p.waitForTimeout(300);
    const width = () => p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); const out = {};
    // ---- header
    out.header = await p.evaluate(() => { const h = document.querySelector('.site-header'); return { position: getComputedStyle(h).position, height: Math.round(h.getBoundingClientRect().height) }; });
    if (w === 360) assert.strictEqual(out.header.position, 'static'); else assert.strictEqual(out.header.position, 'sticky');
    for (const id of ['about', 'menu', 'info']) { await p.evaluate((id) => { location.hash = ''; location.hash = '#' + id; }, id); await p.waitForTimeout(120);
      const v = await p.evaluate((id) => { const h2 = document.querySelector('#' + id + ' h2').getBoundingClientRect(); const hdr = document.querySelector('.site-header').getBoundingClientRect(); const el = document.elementFromPoint(h2.left + 5, h2.top + h2.height / 2); return { top: Math.round(h2.top), hdrBottom: Math.round(hdr.bottom), hit: el && el.closest('h2') !== null, headerCovers: getComputedStyle(document.querySelector('.site-header')).position === 'sticky' && h2.top < hdr.bottom }; }, id);
      assert(v.top >= 0 && v.hit && !v.headerCovers, `${w}px #${id}: ${JSON.stringify(v)}`); }
    // ---- every menu price readable and uncovered
    const prices = await p.evaluate(() => [...document.querySelectorAll('.price')].map(e => ({ text: e.firstChild.textContent.trim(), fs: parseFloat(getComputedStyle(e).fontSize), clipped: e.scrollWidth > e.clientWidth + 1 })));
    assert.deepStrictEqual(prices.map(x => x.text), PRICES); assert(prices.every(x => x.fs >= 14 && !x.clipped));
    for (let i = 0; i < 10; i++) { const ok = await p.evaluate((i) => { const el = document.querySelectorAll('.price')[i]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 10, r.top + r.height / 2); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && (top === el || el.contains(top)); }, i); assert(ok, `${w}px price #${i} covered or off-screen`); }
    assert.deepStrictEqual(await width(), [w, w]);
    // ---- training label visible at the bottom, not under the chat button
    await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(100);
    const label = await p.evaluate(() => { const l = document.querySelector('.demo-label').getBoundingClientRect(), t = document.getElementById('chat-toggle').getBoundingClientRect(); const hit = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2); return { inView: l.top >= 0 && l.bottom <= innerHeight && l.left >= 0 && l.right <= innerWidth, overlapsToggle: !(t.right < l.left || t.left > l.right || t.bottom < l.top || t.top > l.bottom), hitOk: hit && hit.classList.contains('demo-label'), text: document.querySelector('.demo-label').textContent }; });
    assert.deepStrictEqual([label.inView, label.overlapsToggle, label.hitOk], [true, false, true]); assert(label.text.startsWith('Training demo - fictional restaurant'));
    // ---- chat: mixed Urdu + English reply
    await p.click('#chat-toggle'); await p.waitForTimeout(350); await p.fill('#chat-input', 'menu'); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled);
    const chat = await p.evaluate((expected) => { const bub = [...document.querySelectorAll('.chat-msg-bot')].pop(); const rows = [...bub.querySelectorAll('.chat-line')]; const en = rows.filter(r => !r.getAttribute('lang') && r.textContent.trim()); const ur = rows.filter(r => r.getAttribute('lang') === 'ur');
      const lh = (e) => parseFloat(getComputedStyle(e).lineHeight); const tops = en.map(r => Math.round(r.getBoundingClientRect().top)); const pitch = tops.slice(1).map((t, i) => t - tops[i]);
      const win = document.getElementById('chat-window').getBoundingClientRect(), cl = document.getElementById('chat-close').getBoundingClientRect(), ms = document.getElementById('chat-messages').getBoundingClientRect();
      return { sameText: bub.textContent === expected, bubbleLang: bub.getAttribute('lang'), bubbleDir: bub.getAttribute('dir'), rows: rows.length, en: en.length, ur: ur.length, enLh: [...new Set(en.map(lh))], urLh: [...new Set(ur.map(lh))], pitch: [...new Set(pitch)], rowsDir: rows.every(r => r.getAttribute('dir') === 'auto'), winInside: win.left >= 0 && win.right <= innerWidth && win.top >= 0 && win.bottom <= innerHeight, closeVisible: cl.top >= 0 && cl.right <= innerWidth, msgH: Math.round(ms.height), imgs: bub.querySelectorAll('img,script,iframe,b').length }; }, REPLY);
    assert.strictEqual(chat.sameText, true); assert.deepStrictEqual([chat.bubbleLang, chat.bubbleDir, chat.en, chat.ur, chat.rowsDir, chat.imgs], ['ur', 'auto', 10, 2, true, 0]); assert.deepStrictEqual(chat.enLh, [23.2]); assert.deepStrictEqual(chat.urLh, [35.2]);
    assert(chat.pitch.every(x => x >= 23 && x <= 24), 'English lines are evenly tight: ' + chat.pitch); assert(chat.winInside && chat.closeVisible && chat.msgH >= 120);
    // ---- confirm button: visible, inside the window, not covered, does not hide the input
    next = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'aaaaaaaaaaaaaaaa' }; await p.fill('#chat-input', 'review'); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled);
    const cb = await p.evaluate(() => { const bt = document.getElementById('chat-confirm-btn').getBoundingClientRect(), win = document.getElementById('chat-window').getBoundingClientRect(), tg = document.getElementById('chat-toggle').getBoundingClientRect(), inp = document.getElementById('chat-input').getBoundingClientRect(), ms = document.getElementById('chat-messages').getBoundingClientRect(); const hit = document.elementFromPoint(bt.left + bt.width / 2, bt.top + bt.height / 2); return { visible: !document.getElementById('chat-confirm').hidden, inside: bt.left >= win.left && bt.right <= win.right && bt.top >= win.top && bt.bottom <= win.bottom, hitOk: !!hit && hit.closest('#chat-confirm-btn') !== null, toggleOverlap: !(tg.right < bt.left || tg.left > bt.right || tg.bottom < bt.top || tg.top > bt.bottom), inputBelow: inp.top >= bt.bottom - 1, msgH: Math.round(ms.height) }; });
    assert.deepStrictEqual([cb.visible, cb.inside, cb.hitOk, cb.toggleOverlap, cb.inputBelow], [true, true, true, false, true]); assert(cb.msgH >= 80, 'messages area still usable: ' + cb.msgH);
    assert.deepStrictEqual(await width(), [w, w]); assert.deepStrictEqual(errs, []);
    if (w === 360) { await p.evaluate(() => { document.getElementById('chat-messages').scrollTop = 0; }); await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'm360.png') }); }
    console.log(`width ${w}: header ${out.header.position} (${out.header.height}px); About/Menu/Hours anchors land visible and uncovered; all 10 prices readable (>=14px, not clipped, not covered); no sideways scroll; training-demo label visible and not under the chat button; mixed Urdu/English reply: textContent identical, English lines ${chat.enLh[0]}px line height (even pitch ${chat.pitch.join('/')}px) vs Urdu lines ${chat.urLh[0]}px; window+close fit; Confirm button visible, uncovered, inside the window, input below it, messages area ${cb.msgH}px; no console errors: PASS`);
    await p.close();
  }
  await b.close(); console.log('ALL STEP-M UI TESTS PASSED');
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
