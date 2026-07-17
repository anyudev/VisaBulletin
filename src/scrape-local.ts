import { runScrape } from "./scrape-run";
import { fetchHtmlViaBrowser } from "./browser-fetch";

// 本地抓取入口:用真实 Chrome 通过 Cloudflare 防护。
// 在 bulletin 发布那天运行一次即可;当月抓到后再跑会自动跳过。
runScrape(fetchHtmlViaBrowser).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
