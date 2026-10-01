const BASE = process.env.UI_BASE || 'http://localhost:3000'; // the runner starts the server (no Gemini key) and sets UI_BASE
const { chromium } = require('playwright'); const assert = require('assert');
const GENERIC = 'Sorry, something went wrong. Please try again or contact staff.';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const w of [360, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    const confirmReqs = [], chatReqs = []; let nextChat = { reply: 'hello', sessionId: 'a'.repeat(32), reviewVersion: null }; let nextConfirm = { status: 200, body: {} }; let delay = 0;
    await p.route('**/api/chat', async r => { chatReqs.push(JSON.parse(r.request().postData())); if (delay) await new Promise(s => setTimeout(s, delay)); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nextChat) }); });
    await p.route('**/api/order/confirm', async r => { confirmReqs.push(JSON.parse(r.request().postData())); if (nextConfirm.abort) return r.abort('connectionrefused'); r.fulfill({ status: nextConfirm.status, contentType: 'application/json', body: JSON.stringify(nextConfirm.body) }); });
    await p.goto(BASE + '/'); await p.click('#chat-toggle'); await p.waitForTimeout(350);
    const hidden = () => p.evaluate(() => document.getElementById('chat-confirm').hidden); const send = async (t) => { await p.fill('#chat-input', t); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled); };
    assert.strictEqual(await hidden(), true); assert.strictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('chat-confirm')).display), 'none');
    // review shown -> button appears (hidden while waiting)
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'aaaaaaaaaaaaaaaa' }; delay = 500; await p.fill('#chat-input', 'I am done'); await p.press('#chat-input', 'Enter'); await p.waitForTimeout(150); assert.strictEqual(await hidden(), true, 'hidden while busy'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled); delay = 0;
    assert.strictEqual(await hidden(), false);
    const label = await p.evaluate(() => { const bt = document.getElementById('chat-confirm-btn'); const ur = bt.querySelector('[lang="ur"]'); return { text: bt.textContent.replace(/\s+/g, ' ').trim(), urLang: ur.getAttribute('lang'), urDir: ur.getAttribute('dir'), enabled: !bt.disabled }; });
    assert.deepStrictEqual(label, { text: 'Confirm order آرڈر کی تصدیق کریں', urLang: 'ur', urDir: 'rtl', enabled: true });
    // typing confirmations never call the confirm endpoint; a reply with no valid review hides the button
    nextChat = { reply: 'Please press the button.', sessionId: 'a'.repeat(32), reviewVersion: 'aaaaaaaaaaaaaaaa' }; for (const t of ['yes', 'ok', 'theek hai', 'Yes, confirm']) { await send(t); assert.strictEqual(confirmReqs.length, 0, t); assert.strictEqual(await hidden(), false); }
    nextChat = { reply: 'Changed.', sessionId: 'a'.repeat(32), reviewVersion: null }; await send('add a naan'); assert.strictEqual(await hidden(), true); assert.strictEqual(confirmReqs.length, 0);
    // failed chat request hides the button too
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'bbbbbbbbbbbbbbbb' }; await send('review please'); assert.strictEqual(await hidden(), false);
    // click -> exact body, server wording shown, button hidden, no success claim by the frontend
    nextConfirm = { status: 200, body: { ok: true, confirmed: true, saved: false, customerMessage: 'Your confirmation was received, but saving orders is not switched on yet, so the restaurant has NOT received this order. Please contact the restaurant.' } };
    if (w === 360) { const fit = await p.evaluate(() => { const win = document.getElementById('chat-window').getBoundingClientRect(), bt = document.getElementById('chat-confirm-btn').getBoundingClientRect(), cl = document.getElementById('chat-close').getBoundingClientRect(); return { winInside: win.left >= 0 && win.right <= innerWidth && win.top >= 0 && win.bottom <= innerHeight, btnInside: bt.left >= win.left && bt.right <= win.right && bt.top >= win.top && bt.bottom <= win.bottom, closeVisible: cl.top >= 0 && cl.right <= innerWidth, page: [document.documentElement.scrollWidth, innerWidth] }; }); assert(fit.winInside && fit.btnInside && fit.closeVisible && fit.page[0] === fit.page[1], JSON.stringify(fit)); }
    await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden);
    assert.deepStrictEqual(confirmReqs, [{ sessionId: 'a'.repeat(32), sessionToken: null, reviewVersion: 'bbbbbbbbbbbbbbbb' }]); // no token was offered by the stubbed server: null is sent
    let last = await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().textContent); assert(last.includes('NOT received') && !/KD-\d+|placed|saved successfully/i.test(last));
    // 409 outdated -> server text shown
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'cccccccccccccccc' }; await send('review again'); nextConfirm = { status: 409, body: { ok: false, error: 'review_outdated', customerMessage: 'Your order changed after the review. Please ask for the review again and check it before confirming.' } };
    await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); last = await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().textContent); assert(last.startsWith('Your order changed after the review.'));
    // network failure -> generic message, nothing claimed
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'dddddddddddddddd' }; await send('review once more'); nextConfirm = { abort: true };
    await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); last = await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().textContent); assert.strictEqual(last, GENERIC);
    // save failed (500) -> the server's "NOT been placed" text, never a receipt
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'ffffffffffffffff' }; await send('review save'); nextConfirm = { status: 500, body: { ok: false, error: 'save_failed', customerMessage: 'Sorry, we could not save your order, so it has NOT been placed. Please try again, or contact the restaurant.' } };
    await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); last = await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().textContent); assert(last.includes('NOT been placed') && !/KD-\d+|is confirmed and has been sent/i.test(last));
    // saved (200 with an order id) -> the server's receipt text is shown as plain text
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: '1111111111111111' }; await send('review saved'); nextConfirm = { status: 200, body: { ok: true, confirmed: true, saved: true, orderId: 'KD-1001', customerMessage: 'Your order KD-1001 is confirmed and has been sent to the restaurant. Payment: cash on pickup. Thank you!\nآپ کا آرڈر KD-1001 کنفرم ہو گیا ہے۔' } };
    await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); last = await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().textContent); assert(last.startsWith('Your order KD-1001 is confirmed')); assert.strictEqual(await p.evaluate(() => [...document.querySelectorAll('.chat-msg-bot')].pop().getAttribute('lang')), 'ur');
    // double click sends one request
    nextChat = { reply: 'Order review ...', sessionId: 'a'.repeat(32), reviewVersion: 'eeeeeeeeeeeeeeee' }; await send('review final'); nextConfirm = { status: 200, body: { ok: true, confirmed: true, saved: false, customerMessage: 'x' } }; const n = confirmReqs.length;
    await p.evaluate(() => { const bt = document.getElementById('chat-confirm-btn'); bt.click(); bt.click(); bt.click(); }); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); assert.strictEqual(confirmReqs.length, n + 1);
    // history stays in memory only
    const st = await p.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie })); assert.deepStrictEqual(st, { ls: 0, ss: 0, ck: '' });
    assert.deepStrictEqual(errs, []); console.log('width ' + w + ': confirm button hidden by default and while busy; appears only with a valid reviewVersion; bilingual label (lang=ur dir=rtl); typing "yes/ok/theek hai/Yes, confirm" never calls /api/order/confirm; reply without a review hides it; click sends {sessionId, reviewVersion}; server wording shown (409 and network error handled); triple-click = one request; no storage; no console errors: PASS' + (w === 360 ? '; window+button+close fit at 360 px, no sideways scroll' : '')); await p.close();
  }
  { // the sealed session token is kept in memory and sent back with chat and confirm requests (and replaced by every answer)
    const p = await b.newPage({ viewport: { width: 360, height: 800 } }); const chatBodies = [], confirmBodies = []; let n = 0;
    await p.route('**/api/chat', r => { chatBodies.push(JSON.parse(r.request().postData())); n += 1; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'ok ' + n, sessionId: 'c'.repeat(32), sessionToken: 'TOKEN-' + n, reviewVersion: n === 2 ? 'dddddddddddddddd' : null }) }); });
    await p.route('**/api/order/confirm', r => { confirmBodies.push(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, saved: true, orderId: 'KD-1', customerMessage: 'Your order KD-1 is confirmed', sessionToken: 'TOKEN-CONFIRMED' }) }); });
    await p.goto(BASE + '/'); await p.click('#chat-toggle'); await p.waitForTimeout(350);
    const send = async (t) => { await p.fill('#chat-input', t); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled); };
    await send('one'); await send('two'); await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); await send('three');
    assert.strictEqual(chatBodies[0].sessionToken, null); assert.strictEqual(chatBodies[1].sessionToken, 'TOKEN-1'); assert.strictEqual(confirmBodies[0].sessionToken, 'TOKEN-2'); assert.strictEqual(chatBodies[2].sessionToken, 'TOKEN-CONFIRMED');
    assert.strictEqual(await p.evaluate(() => JSON.stringify([localStorage.length, sessionStorage.length])), '[0,0]', 'the token is kept in memory only');
  }
  await b.close(); console.log('ALL STEP-34 UI TESTS PASSED');
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
