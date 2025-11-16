/**
 * LuSE Market Data API – Auto-detect JSON source
 * Primary: Try LuSE JSON endpoints
 * Secondary: Try Longhorn JSON
 * Final: Fallback table
 */

const express = require("express");
const got = require("got");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

// Cache (1 minute)
const CACHE_TTL = 60000;
let cache = { ts: 0, rows: null };

// Final fallback
const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"],
  ["AVJN","ZANACO PLC",6.04,"","","+0.00%",0,0],
  ["KODT","CEC PLC",22.68,"","","+0.00%",0,0]
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Known LuSE endpoints to probe
const LUSE_JSON_ENDPOINTS = [
  "https://www.luse.co.zm/wp-json/luse/v1/market-data",
  "https://www.luse.co.zm/wp-json/luse/v1/market",
  "https://www.luse.co.zm/wp-json/market-data",
  "https://www.luse.co.zm/wp-json/wp/v2/market-data",
  "https://luse.co.zm/wp-json/luse/v1/market-data"
];

// Try multiple LuSE JSON endpoints
async function tryLuSEJson() {
  for (const url of LUSE_JSON_ENDPOINTS) {
    try {
      const r = await got.get(url, {
        headers: { "User-Agent": UA },
        timeout: { request: 10000 }
      });

      let json;
      try { json = JSON.parse(r.body); }
      catch { continue; }

      if (!json || typeof json !== "object") continue;

      // The JSON may have different structures depending on LuSE.
      // We normalize multiple known formats.

      let rows = [["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"]];

      // Format 1: array of objects
      if (Array.isArray(json)) {
        json.forEach(it => {
          rows.push([
            it.ticker || it.symbol || "",
            it.company || it.name || "",
            Number(it.last || it.price || "") || "",
            Number(it.bid || "") || "",
            Number(it.ask || "") || "",
            it.change || "",
            Number(it.volume || "") || "",
            Number(it.value || it.turnover || "") || ""
          ]);
        });
      }

      // Format 2: json.data
      if (json.data && Array.isArray(json.data)) {
        json.data.forEach(it => {
          rows.push([
            it.ticker || "",
            it.company || "",
            Number(it.last || "") || "",
            Number(it.bid || "") || "",
            Number(it.ask || "") || "",
            it.change || "",
            Number(it.volume || "") || "",
            Number(it.value || "") || ""
          ]);
        });
      }

      if (rows.length > 1) return rows;

    } catch (e) {
      // Try next endpoint
      continue;
    }
  }

  throw new Error("No LuSE JSON endpoint succeeded");
}

// Longhorn fallback
async function tryLonghorn() {
  try {
    const r = await got.get("https://mobile.longhorn.luse.co.zm/api/securities", {
      headers: { "User-Agent": UA },
      timeout: { request: 10000 }
    });

    const j = JSON.parse(r.body);
    if (!Array.isArray(j)) throw new Error();

    let rows = [["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"]];

    j.forEach(it => {
      rows.push([
        it.ticker || "",
        it.securityName || "",
        Number(it.lastPrice || "") || "",
        Number(it.bid || "") || "",
        Number(it.ask || "") || "",
        "",
        "",
        ""
      ]);
    });

    if (rows.length > 1) return rows;

    throw new Error("Longhorn returned no data");
  } catch {
    throw new Error("Longhorn failed");
  }
}

// Master fetch function
async function getPrices() {
  // Cache
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL) {
    return cache.rows;
  }

  // Primary: LuSE JSON
  try {
    const rows = await tryLuSEJson();
    cache = { ts: Date.now(), rows };
    return rows;
  } catch (e) {
    console.log("LuSE JSON failed:", e.message);
  }

  // Secondary: Longhorn JSON
  try {
    const rows = await tryLonghorn();
    cache = { ts: Date.now(), rows };
    return rows;
  } catch (e) {
    console.log("Longhorn failed:", e.message);
  }

  // Final fallback
  cache = { ts: Date.now(), rows: FALLBACK };
  return FALLBACK;
}

app.get("/prices/table", async (req, res) => {
  try {
    const rows = await getPrices();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
});

app.get("/", (req, res) => {
  res.send("LuSE Market API — use /prices/table");
});

app.listen(PORT, () =>
  console.log(`API listening on port ${PORT}`)
);
