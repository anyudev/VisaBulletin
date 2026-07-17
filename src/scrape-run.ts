import { scrapeBulletin } from "./scraper";
import { saveBulletin, bulletinExists, regenerateAggregates } from "./generate-json";

/**
 * Scrape the next month's visa bulletin and persist it.
 *
 * Once a month's bulletin is saved, subsequent runs short-circuit at the
 * `bulletinExists` check BEFORE any network request — so re-running during the
 * publish window (or on a cron) costs nothing once the data is in hand.
 *
 * @param fetchHtml Optional HTML fetcher passed through to `scrapeBulletin`.
 *                  Defaults to a plain HTTP request (blocked by Cloudflare);
 *                  pass the browser-based fetcher for `scrape:local`.
 */
export async function runScrape(
  fetchHtml?: (url: string) => Promise<string>,
): Promise<void> {
  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth() + 2; // +1 for 0-indexed, +1 for next month
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear++;
  }

  const bulletinDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  console.log(`Checking for bulletin: ${bulletinDate}`);

  // 一旦已存在就直接返回,不发任何网络请求(省抓取额度/时间)
  if (bulletinExists(bulletinDate)) {
    console.log(`Bulletin for ${bulletinDate} already exists, skipping.`);
    return;
  }

  // 爬取
  console.log(`Scraping bulletin for ${bulletinDate}...`);
  let data;
  try {
    data = await scrapeBulletin(targetYear, targetMonth, fetchHtml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) {
      console.log("Bulletin not yet published.");
      return;
    }
    throw e;
  }

  // 校验
  const ebCount = Object.keys(data.employmentBased.finalActionDates).length;
  const fbCount = Object.keys(data.familyBased.finalActionDates).length;
  if (ebCount === 0 || fbCount === 0) {
    console.log(`Parse error: EB=${ebCount}, FB=${fbCount} categories. Skipping.`);
    return;
  }

  // 保存
  saveBulletin(bulletinDate, data, now.toISOString().split("T")[0]);

  // 重新生成聚合文件
  regenerateAggregates();

  console.log(`Stored bulletin for ${bulletinDate} (EB: ${ebCount}, FB: ${fbCount} categories)`);
}
