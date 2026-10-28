// Screenshot a URL with Playwright's bundled Chromium.
// usage: node shoot.cjs <url> <out.png> [width=1120] [height=760] [light|dark] [full=1] [actions-js-file]
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [url, out, w = "1120", h = "760", scheme = "light", full = "1", actions] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, colorScheme: scheme, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (actions) await new Function("page", `return (async () => { ${fs.readFileSync(actions, "utf8")} })()`)(page);
  await page.screenshot({ path: out, fullPage: full === "1" });
  if (errors.length) console.log("page errors:", JSON.stringify(errors.slice(0, 5)));
  await browser.close();
})();
