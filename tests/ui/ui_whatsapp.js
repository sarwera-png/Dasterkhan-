const BASE = process.env.UI_BASE || 'http://localhost:3000';
// Step AY (browser): the WhatsApp panel after Confirm, at 360 / 768 / 1280 px (server answers stubbed in the page)
const { chromium } = require('playwright'); const assert = require('assert');
const LINK = 'https://wa.me/923001234567?text=' + encodeURIComponent('[DEMO] test\nRef: KD-7F3A9\nTotal: 780 PKR');
const MSG = '[DEMO] کراچی دسترخوان — کورس کا ٹیسٹ آرڈر\nRef: KD-7F3A9\nItems:\n2 x Chicken Biryani (spice: mild) - 700 PKR\nTotal: 780 PKR <img src=x onerror="window.__xss=1">';
const NOTICE = 'Your order is NOT sent yet. Press the button to open WhatsApp, then press Send.\nآپ کا آرڈر ابھی نہیں گیا۔ بٹن دبا کر WhatsApp کھولیں، پھر Send دبائیں۔';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  for (const w of [360, 768, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    let confirmResponse = { status: 200, body: { ok: true, channel: 'whatsapp', sent: false, confirmed: false, saved: false, whatsapp: { link: LINK, ref: 'KD-7F3A9', message: MSG }, customerMessage: NOTICE, sessionToken: 'T' } };
    await p.route('**/api/chat', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Order review ...', sessionId: 'a'.repeat(32), sessionToken: 'T0', reviewVersion: 'aaaaaaaaaaaaaaaa' }) }));
    await p.route('**/api/order/confirm', r => r.fulfill({ status: confirmResponse.status, contentType: 'application/json', body: JSON.stringify(confirmResponse.body) }));
    await p.goto(BASE + '/'); await p.click('#chat-toggle'); await p.waitForTimeout(350);
    await p.fill('#chat-input', 'review'); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled);
    await p.click('#chat-confirm-btn'); await p.waitForSelector('.wa-panel'); await p.waitForTimeout(150);
    const info = await p.evaluate(() => { const panel = document.querySelector('.wa-panel'); const a = panel.querySelector('a.wa-open'); const win = document.getElementById('chat-window').getBoundingClientRect(); const ar = a.getBoundingClientRect(); const pr = panel.getBoundingClientRect(); const msgs = document.getElementById('chat-messages'); const last = [...document.querySelectorAll('.chat-msg-bot')].pop();
      return { href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.textContent.replace(/\s+/g, ' ').trim(), urLang: a.querySelector('.ur').getAttribute('lang'), pre: panel.querySelector('pre').textContent, notice: last.textContent, xss: window.__xss || 0, imgs: panel.querySelectorAll('img').length, color: getComputedStyle(a).backgroundColor,
        btnInside: ar.left >= win.left && ar.right <= win.right && ar.top >= win.top && ar.bottom <= win.bottom, panelInsideWidth: pr.left >= win.left - 1 && pr.right <= win.right + 1, overflowX: document.documentElement.scrollWidth <= innerWidth + 1, confirmHidden: document.getElementById('chat-confirm').hidden, msgsScroll: msgs.scrollHeight >= msgs.clientHeight }; });
    assert.strictEqual(info.href, LINK); assert.strictEqual(info.target, '_blank'); assert(/noopener/.test(info.rel) && /noreferrer/.test(info.rel)); assert.strictEqual(info.label, 'Open WhatsApp واٹس ایپ کھولیں'); assert.strictEqual(info.urLang, 'ur'); assert.strictEqual(info.pre, MSG, 'the message text is shown as plain text for copying');
    assert.strictEqual(info.xss, 0); assert.strictEqual(info.imgs, 0); assert(info.notice.includes('NOT sent yet') && info.notice.includes('ابھی نہیں گیا')); assert(!/\b(placed|received|confirmed|saved)\b/i.test(info.notice + ' ' + info.label), 'the UI never says the order was received'); assert.strictEqual(info.color, 'rgb(31, 143, 74)', 'green button');
    assert(info.btnInside && info.panelInsideWidth && info.overflowX, `layout at ${w}: ${JSON.stringify(info)}`); assert.strictEqual(info.confirmHidden, true, 'the Confirm button is gone after pressing it');
    // a link that is not wa.me is never shown as a button
    await p.fill('#chat-input', 'again'); await p.press('#chat-input', 'Enter'); await p.waitForFunction(() => !document.getElementById('chat-input').disabled); confirmResponse = { status: 200, body: { ...confirmResponse.body, whatsapp: { link: 'https://evil.example/?x=1', ref: 'KD-1', message: 'x' } } };
    const before = await p.locator('.wa-panel').count(); await p.click('#chat-confirm-btn'); await p.waitForFunction(() => document.getElementById('chat-confirm').hidden); await p.waitForTimeout(150); assert.strictEqual(await p.locator('.wa-panel').count(), before, 'only https://wa.me/ links get a button');
    assert.deepStrictEqual(errs, []); console.log(`width ${w}: WhatsApp panel (green "Open WhatsApp / واٹس ایپ کھولیں" button opens in a new tab with noopener, message text visible as plain text, NOT-sent notice in English and Urdu, no "received/placed" wording, inside the window, no sideways scroll, other links ignored, no console errors): PASS`);
  }
  await b.close(); console.log('ALL STEP-AY UI TESTS PASSED');
})().catch(e => { console.error('TEST FAILED:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); });
