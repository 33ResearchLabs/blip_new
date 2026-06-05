// Temporary screenshot driver for the standardized headers. Safe to delete.
import { chromium } from "playwright";

const BASE = "http://localhost:3000/preview-headers";
const shots = [
  { name: "scan-light", url: `${BASE}?screen=scan&theme=light`, wait: "text=Scan to Pay" },
  { name: "support-light", url: `${BASE}?screen=support&theme=light`, wait: "text=Need help" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 430, height: 920 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const s of shots) {
  console.log(`Loading ${s.name} ...`);
  try {
    await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 300000 });
    // Wait for the real header content (route may still be compiling — up to 5 min).
    await page.waitForSelector(s.wait, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const out = `/tmp/preview-${s.name}.png`;
    await page.screenshot({ path: out, timeout: 120000, animations: "disabled" });
    console.log(`Saved ${out}`);
  } catch (e) {
    console.log(`FAILED ${s.name}: ${e.message}`);
  }
}

await browser.close();
console.log("done");
