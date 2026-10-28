const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text()); });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto("http://127.0.0.1:4173/?view=overlay");
  await page.waitForTimeout(800);
  await page.evaluate(() => document.body.style.background = "#1e293b");
  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => window.danmaku.generateOnce());
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: process.argv[2] });
  const lines = await page.$$eval(".danmaku-line", (els) => els.map((e) => ({ top: e.style.top, text: e.textContent })));
  console.log("lines:", lines.length, "distinct tops:", new Set(lines.map((l) => l.top)).size, JSON.stringify(lines.slice(0, 14).map((l) => l.top)));
  await browser.close();
})();
