import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

/**
 * Dedicated Chrome profile for scraping. It is separate from your everyday
 * Chrome profile (so it never conflicts with a running Chrome), and it persists
 * the Cloudflare clearance cookie between runs — the first run may show the
 * "Verify you are human" checkbox, later runs usually pass automatically.
 */
const PROFILE_DIR = path.join(os.homedir(), ".cache", "visa-bulletin-chrome");

const CHALLENGE_RE = /just a moment|attention required|performing security|verify you are human/i;
const NOT_FOUND_RE = /page not found|page you requested|page cannot be found|404 -|error 404/i;
// 正文标志:签证公告页一定包含这些字样
const CONTENT_RE = /Final Action Dates|STATUTORY NUMBERS FOR/i;

/**
 * Fetch a page's HTML through a real Chrome instance, passing Cloudflare's
 * bot challenge. Runs headed so you can solve an interactive checkbox if one
 * appears. Throws an Error whose message contains "404" when the page is not
 * found (e.g. a bulletin month not yet published).
 */
export async function fetchHtmlViaBrowser(url: string): Promise<string> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome", // 用系统安装的真实 Chrome,而非 bundled chromium
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 等 Cloudflare 挑战过掉 / 正文出现 / 判定为 404。
    // 给足时间以便必要时手动点 "Verify you are human"。
    // 首次运行可用 SCRAPE_CHALLENGE_TIMEOUT_MS 调大,方便手动点击。
    const timeoutMs = Number(process.env.SCRAPE_CHALLENGE_TIMEOUT_MS) || 120000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [title, body] = await Promise.all([
        page.title(),
        page.innerText("body").catch(() => ""),
      ]);

      if (CONTENT_RE.test(body)) {
        return await page.content();
      }
      if (NOT_FOUND_RE.test(title) || NOT_FOUND_RE.test(body)) {
        throw new Error(`Failed to fetch ${url}: 404 Not Found`);
      }
      if (CHALLENGE_RE.test(title)) {
        console.log("  Cloudflare 验证中… 如出现勾选框请在打开的窗口中点击。");
      }
      await page.waitForTimeout(2500);
    }

    throw new Error(
      `Timed out waiting for ${url} to load (Cloudflare challenge not cleared).`,
    );
  } finally {
    await context.close();
  }
}
