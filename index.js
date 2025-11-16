/**
 * LuSE Market Data API with headless browser (Cloudflare bypass)
 * Uses puppeteer-core + chrome-aws-lambda for lightweight performance.
 */

const express = require("express");
const cheerio = require("cheerio");
const chromium = require("chrome-aws-lambda");

const app = express();
const PORT = process.env.PORT || 3000;

// Cache to avoid frequent browser launches
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cache = { ts: 0, rows: null };

const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"],
  ["AVJN","ZANACO PLC",6.04,"","","+0.00%",0,0],
  ["KODT","CEC PLC",22.68,"","","+0.00%",0,0]
];

function normalizeNumber(v) {
  if (!v) return "";
  const n = Number(v.toString().replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : "";
}

async function fetchLuSEBrowser() {
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  await page.goto("https://www.luse.co.zm/trading/market-data/", {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  // Wait for table(s) to load
  await page.waitForSelector("table", { timeout: 60000 });

  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);

  // Find the largest table on the page (market data)
  let target = null;
  let maxCols = 0;

  $("table").each((i, t) => {
    const ths = $(t).find("th").length;
    if (ths > maxCols) {
      maxCols = ths;
      target = t;
    }
  });

  if (!target) throw new Error("No table found");

  const rows = [["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"]];

  $(target).find("tbody tr").each((i, tr) => {
    const tds = $(tr).find("td").map((i, td) => $(td).text().trim()).get();
    if (tds.length < 3) return;

    const ticker  = tds[1] || "";
    const company = tds[0] || "";
    const last    = normalizeNumber(tds[2]);
    const change  = tds[3] || "";
    const volume  = normalizeNumber(tds[4]);
    const value   = normalizeNumber(tds[5]);

    rows.push([ ticker, company, last, "", "", change, volume, value ]);
  });

  if (rows.length <= 1) throw new Error("No rows parsed");

  return rows;
}

async function getPrices() {
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL) {
    return cache.rows;
  }

  try {
    const rows = await fetchLuSEBrowser();
    cache = { ts: Date.now(), rows };
    return rows;
  } catch (e) {
    console.log("Browser mode failed:", e.message);
  }

  cache = { ts: Date.now(), rows: FALLBACK };
  return FALLBACK;
}

app.get("/prices/table", async (req, res) => {
  try {
    const rows = await getPrices();
    res.json(rows);
  } catch {
    res.status(500).json({ error: "server error" });
  }
});

app.get("/", (req, res) =>
  res.send("LuSE Browser API — use /prices/table")
);

app.listen(PORT, () =>
  console.log("LuSE Browser API running on port", PORT)
);
