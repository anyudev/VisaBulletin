import { runScrape } from "./scrape-run";

// 默认(纯 HTTP)抓取入口。注意:travel.state.gov 现已启用 Cloudflare 防护,
// 纯 HTTP 会被 403 拦截。日常抓取请用 `npm run scrape:local`(真实浏览器)。
runScrape().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
