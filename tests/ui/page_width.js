const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const w of [360, 768, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } });
    await p.goto('file://' + require('path').join(__dirname, '..', '..', 'frontend', 'index.html'));
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); console.log(w, [sw, iw]);
    if (sw !== iw || iw !== w) { console.error('TEST FAILED: page width ' + sw + ' vs window ' + iw + ' at ' + w); process.exit(1); }
  }
  await b.close();
})();
