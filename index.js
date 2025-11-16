/**
 * LuSE Market Data API — AFX Source (FAST & STABLE)
 * Scrapes https://afx.kwayisi.org/luse/
 */

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_TTL = 5 * 60 * 1000; // 5 min cache
let cache = { ts: 0, rows: null };

const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"],
  ["AVJN","ZANACO PLC",6.04,"","","+0.00%",0,0],
  ["KODT","CEC PLC",22.68,"","","+0.00%",0,0]
];

async function fetchAFX() {
  const url = "https://afx.kwayisi.org/luse/";
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 30000
  });

  const $ = cheerio.load(data);

  const table = $("table").first();
  if (!table.length) throw new Error("AFX table missing");

  const rows = [
    ["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"]
  ];

  table.find("tr").each((i, tr) => {
    const cells = $(tr).find("td").map((i, el) => $(el).text().trim()).get();
    if (cells.length < 4) return;

    const ticker  = cells[0] || "";
    const company = cells[1] || "";
    const volume  = parseInt(cells[2].replace(/,/g,"")) || 0;
    const last    = parseFloat(cells[3].replace(/,/g,"")) || "";
    const change  = cells[4] || "+0.00%";

    const value   = volume && last ? volume * last : 0;

    rows.push([ticker, company, last, "", "", change, volume, value]);
  });

  if (rows.length <= 1) throw new Error("AFX returned no rows");
  return rows;
}

async function getPrices() {
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL) {
    return cache.rows;
  }

  try {
    const rows = await fetchAFX();
    cache = { ts: Date.now(), rows };
    return rows;
  } catch (err) {
    console.log("AFX failed:", err.message);
  }

  cache = { ts: Date.now(), rows: FALLBACK };
  return FALLBACK;
}

app.get("/prices/table", async (req, res) => {
  const rows = await getPrices();
  res.json(rows);
});

app.get("/", (req, res) =>
  res.send("LuSE Prices API (AFX source) — use /prices/table")
);

app.listen(PORT, () => console.log(`API running on ${PORT}`));
