import { chromium } from "playwright";

const URL = process.env.URL || "https://raven-railgun-demo-production.up.railway.app/commit-tree";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await ctx.newPage();

const corsErrors = [];
const consoleErrors = [];
const failedFetch = [];
const networkRequests = { count: 0, byStatus: {}, cors: 0 };

page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error") consoleErrors.push(t.slice(0, 240));
  if (/CORS|cross-origin/i.test(t)) corsErrors.push(t.slice(0, 240));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message.slice(0, 240)));
page.on("requestfailed", (req) => {
  failedFetch.push({ url: req.url(), failure: req.failure()?.errorText });
});
page.on("response", (r) => {
  networkRequests.count += 1;
  const s = String(r.status());
  networkRequests.byStatus[s] = (networkRequests.byStatus[s] || 0) + 1;
});

console.log("nav " + URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForLoadState("load").catch(() => {});

const fireBtn = page.locator("main button").filter({ hasText: /Fetch path \+ verify on-chain/i }).first();
let booted = false;
for (let i = 0; i < 240; i += 1) {
  if (await fireBtn.isEnabled().catch(() => false)) { booted = true; break; }
  await page.waitForTimeout(1_000);
}
console.log("boot ready:", booted);
let outcome = "not-fired";
if (booted) {
  await fireBtn.click({ force: true });
  outcome = "running";
  for (let i = 0; i < 90; i += 1) {
    const okV = await page.locator("text=/Mainnet agrees/i").isVisible().catch(() => false);
    const errV = await page.locator("text=/Root not in mainnet history|verify failed|fold failed|chain verify failed/i").isVisible().catch(() => false);
    if (okV) { outcome = "agrees"; break; }
    if (errV) { outcome = "disagrees"; break; }
    await page.waitForTimeout(1_000);
  }
}
console.log("verify outcome:", outcome);

const toastCount = await page.locator("[role='status'], [role='alert']").count().catch(() => 0);
const toastTexts = await page.locator("[role='status'], [role='alert']").allTextContents().catch(() => []);
const bootStatusText = await page.locator("text=/boot status/i").locator("xpath=ancestor::*[2]").innerText().catch(() => "");
const errorBadge = await page.locator("text=/error/i").count().catch(() => 0);
const readyBadge = await page.locator("text=/ready/i").count().catch(() => 0);

await page.screenshot({ path: "/tmp/railway-deploy-verify.png", fullPage: true });

await browser.close();

console.log("\n=== verify report ===");
console.log("network requests total:", networkRequests.count);
console.log("by status:", networkRequests.byStatus);
console.log("failed fetches:", failedFetch.length);
for (const f of failedFetch.slice(0, 5)) console.log("  failed:", f.url, f.failure);
console.log("CORS-flavored console msgs:", corsErrors.length);
for (const e of corsErrors.slice(0, 3)) console.log("  cors:", e.slice(0, 200));
console.log("console errors:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 5)) console.log("  err:", e.slice(0, 200));
console.log("toast count rendered:", toastCount);
const uniqToasts = [...new Set(toastTexts.map((t) => t.slice(0, 80)))];
console.log("unique toast titles:", uniqToasts);
console.log("boot status text snippet:", bootStatusText.replace(/\s+/g, " ").slice(0, 300));
console.log("error badges in DOM:", errorBadge);
console.log("ready badges in DOM:", readyBadge);
console.log("screenshot:", "/tmp/railway-deploy-verify.png");

const ok = corsErrors.length === 0 && failedFetch.length === 0 && toastCount < 3;
console.log("\n=== RESULT:", ok ? "PASS" : "FAIL", "===");
process.exit(ok ? 0 : 1);
