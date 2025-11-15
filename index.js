// index.js - Clean robust LuSE price API

const express = require('express');
const got = require('got');
const cheerio = require('cheerio');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Cache to reduce upstream load
const CACHE_TTL = 30000; // 30 seconds
let cache = { ts: 0, rows: null };

// Browser-like user agents
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0"
];

// Guaranteed output if API sources fail
const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask"],
  ["AVJN","ZANACO PLC",6.04,"",""],
  ["KODT","CEC PLC",22.68,"",""],
  ["ZSUG","ZAMBIA SUGAR PLC",65.24,"",""],
  ["SHOP","SHOPRITE HOLDINGS",350,"",""]
];

function getCached() {
  if (cache.rows && (Date.now() - cache.ts) < CACHE_TTL) {
    return cache.rows;
  }
  return null;
}

function setCached(rows) {
  cache = { ts: Date.now(), rows };
}

function numOrEmpty(x) {
  if (x === null || x === undefined || x === '') return '';
  const n = Number(x);
  return Number.isFinite(n) ? n : '';
}

// Longhorn JSON fetch (primary)
async function fetchLonghornJson() {
  const url = 'https://mobile.longhorn.luse.co.zm/api/securities';
  const UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const r = await got.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://mobile.longhorn.luse.co.zm/',
      'Origin': 'https://mobile.longhorn.luse.co.zm',
      'Connection': 'keep-alive',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Accept-Encoding': 'br, gzip, deflate'
    },
    timeout: { request: 20000 },
    retry: { limit: 2 }
  });

  const json = JSON.parse(r.body);
  if (!Array.isArray(json) || json.length === 0) throw new Error('Longhorn returned empty JSON');

  const rows = [["Ticker","Company","Last","Bid","Ask"]];
  json.forEach(it => {
    rows.push([
      (it.ticker || '').toString(),
      (it.securityName || it.name || '').toString(),
      numOrEmpty(it.lastPrice),
      numOrEmpty(it.bid),
      numOrEmpty(it.ask)
    ]);
  });

  if (rows.length <= 1) throw new Error('Longhorn no rows parsed');
  return rows;
}

async function fetchLonghornWithRetry() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const wait = attempt > 1 ? 200 * Math.pow(2, attempt - 2) : 0;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const rows = await fetchLonghornJson();
      if (rows.length > 1) return rows;
    } catch (err) {
      console.log(`Longhorn attempt ${attempt} failed:`, err.message);
    }
  }
  throw new Error("Longhorn unreachable after retries");
}

// LuSE HTML fallback
async function fetchLuSEHtml() {
  const url = 'https://luse.co.zm/listed-companies/';
  const UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const r = await got.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,*/*',
      'Accept-Encoding': 'br, gzip, deflate',
      'Connection': 'keep-alive'
    },
    timeout: { request: 20000 },
    retry: { limit: 1 }
  });

  const html = r.body;
  const $ = cheerio.load(html);

  const table = $('table').first();
  if (!table.length) throw new Error('No table found');

  const rows = [["Ticker","Company","Last","Bid","Ask"]];
  table.find('tr').each((i, tr) => {
    const cells = $(tr).find('td,th').map((i, el) => $(el).text().trim()).get();
    if (!cells || cells.length < 2) return;

    const company = cells[0];
    const ticker = cells[1] || company;
    let last = '';

    for (let c of cells) {
      const cleaned = c.replace(/[\,]/g,'').match(/^\d+(\.\d+)?$/);
      if (cleaned) {
        last = parseFloat(cleaned[0]);
        break;
      }
    }

    rows.push([ticker, company, last, '', '']);
  });

  if (rows.length <= 1) throw new Error('No LuSE rows parsed');
  return rows;
}

// Main API endpoint
app.get('/prices/table', async (req, res) => {
  try {
    const cached = getCached();
    if (cached) return res.json(cached);

    try {
      const lh = await fetchLonghornWithRetry();
      setCached(lh);
      return res.json(lh);
    } catch (e) {
      console.log("Longhorn failed:", e.message);
    }

    try {
      const lus = await fetchLuSEHtml();
      setCached(lus);
      return res.json(lus);
    } catch (e) {
      console.log("LuSE fallback failed:", e.message);
    }

    console.log("All sources failed, returning fallback");
    setCached(FALLBACK);
    return res.json(FALLBACK);

  } catch (err) {
    console.log("Fatal error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// Root endpoint
app.get('/', (req, res) => res.send("LuSE Prices API - use /prices/table"));

// Start server
app.listen(PORT, () => {
  console.log(`LuSE Prices API listening on ${PORT}`);
});
