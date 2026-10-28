// Headed Chromium on $DISPLAY cycling the scene screenshots, so the app has something to capture.
const { chromium } = require("playwright");
const path = require("path");
const imgs = Array.from({ length: 8 }, (_, i) => path.join(__dirname, "..", "halogen", "imgs", `scene${i}-1920.png`));
(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--window-position=0,0", "--window-size=1600,1000", "--app=about:blank"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (let i = 0; ; i = (i + 1) % imgs.length) {
    await page.setContent(`<body style="margin:0;background:#000"><img src="file://${imgs[i]}" style="width:100vw;height:100vh;object-fit:cover"></body>`);
    await page.waitForTimeout(9000);
  }
})();
