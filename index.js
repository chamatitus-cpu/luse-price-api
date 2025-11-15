// index.js - Robust LuSE price API (Longhorn preferred, LuSE fallback)
// Requires: express, got, cheerio
// Designed for Render / similar PaaS.

const express = require('express');
const got = require('got');
const cheerio = require('cheerio');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Simple in-memory cache to reduce upstream calls (TTL in ms)
const CACHE_TTL = 30 * 1000; // 30 seconds
let cache = { ts: 0, rows: null };

// A short list of realistic modern browser user agents to rotate
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0"
];

// Basic fallback (guarantee the API always returns something)
const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask"],
  ["AVJN","ZANACO PLC",6.04,"",""],
  ["KODT","CEC PLC",22.68,"",""],
  ["ZSUG","ZAMBIA SUGAR PLC",65.24,"",""],
  ["SHOP","SHOPRITE HOLDINGS",350,"",""]
];

// Utility to return cached data if fresh
function getCached() {
  if (cache.rows && (Date.now() - cache.ts) < CACHE_TTL) {
    return cache.rows;
  }
  return null;
}
function setCached(rows) {
  cache = { ts: Date.now(), rows };
}

// Helper: safe parse number
function numOrEmpty(x) {
  if (x === null || x === undefined || x === '') return '';
  const n = Number(x);
  return Number.isFinite(n) ? n : '';
}

// Primary: try to fetch Longhorn mobile API (JSON)
async function fetchLonghornJson() {
  const url = 'https://mobile.longhorn.luse.co.zm/api/securities';
  // pick a random UA for each request
  const UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const gotOpts = {
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
    retry: { limit: 2, methods: ['GET','POST'], statusCodes: [408, 413, 429, 500, 502, 503, 504], errorCodes: ['ETIMEDOUT','ECONNRESET'] },
    https: { rejectUnauthorized: true } // default
  };

  const r = await got.get(url, gotOpts);
  // Expect JSON array
  if (!r || !r.body) throw new Error('Empty response from Longhorn');
  let j;
  try { j = JSON.parse(r.body); } catch (err) { throw new Error('Longhorn JSON parse failed'); }
  if (!Array.isArray(j) || j.length === 0) throw new Error('Invalid JSON payload from Longhorn');

  const rows = [['Ticker','Company','Last','Bid','Ask']];
  for (const it of j) {
    const ticker = (it.ticker || '').toString().trim();
    const company = (it.securityName || it.name || '').toString().trim();
    const last = numOrEmpty(it.lastPrice);
    const bid  = numOrEmpty(it.bid);
    const ask  = numOrEmpty(it.ask);
    rows.push([ticker, company, last, bid, ask]);
  }
  if (rows.length <= 1) throw new Error('No rows parsed from Longhorn JSON');
  return rows;
}

// Fallback: scrape luse.co.zm listed companies page
async function fetchLuSEHtml() {
  const url = 'https://luse.co.zm/listed-companies/';
  const UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const gotOpts = {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'br, gzip, deflate'
    },
    timeout: { request: 20000 },
    retry: { limit: 1 }
  };

  const r = await got.get(url, gotOpts);
  const html = r.body;
  const $ = cheerio.load(html);

  const table = $('table').first();
  if (!table || table.length === 0) throw new Error('No table found on LuSE site');

  const rows = [['Ticker','Company','Last','Bid','Ask']];
  table.find('tr').each((i, tr) => {
    const cells = $(tr).find('td,th').map((i, el) => $(el).text().trim()).get();
    if (!cells || cells.length < 2) return;
    // Heuristic: if second column looks like a ticker (short), use that
    // Many LuSE table formats vary; best effort extraction
    let company = cells[0] || '';
    let ticker = cells[1] || cells[0] || '';
    // try to find a numeric column for price
    let last = '';
    for (let c of cells) {
      const cleaned = c.replace(/[,]/g,'').match(/^\d+(\.\d+)?$/);
      if (cleaned) { last = Number(cleaned[0]); break; }
    }
    rows.push([ticker, company, last, '', '']);
  });

  if (rows.length <= 1) throw new Error('No rows parsed from LuSE HTML');
  return rows;
}

// Public endpoint
app.get('/prices/table', async (req, res) => {
  try {
    // 1) Use cache if fresh
    const cached = getCached();
    if (cached) return res.json(cached);

    // 2) Try Longhorn JSON with retries/backoff
    try {
      // We'll attempt Longhorn multiple times in the function itself
      const rows = await fetchLonghornWithResilience();
      setCached(rows);
      return res.json(rows);
    } catch (err) {
      console.log('Longhorn primary failed:', err.message || err);
    }

    // 3) Fallback to LuSE page scrape
    try {
      const rows = await fetchLuSEHtml();
      setCached(rows);
      return res.json(rows);
    } catch (err) {
      console.log('LuSE fallback failed:', err.message || err);
    }

    // 4) If all failed, return FALLBACK (never break Sheets)
    console.log('All sources failed: returning fallback data');
    setCached(FALLBACK);
    return res.json(FALLBACK);

  } catch (err) {
    console.error('Unexpected server error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// A wrapper providing additional resilience around fetchLonghornJson
async function fetchLonghornWithResilience() {
  const MAX_ATTEMPTS = 4;
  const BASE_WAIT = 250; // ms

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // small progressive backoff
      if (attempt > 1) {
        const wait = BASE_WAIT * Math.pow(2, attempt - 2);
        await new Promise(r => setTimeout(r, wait));
      }
      const rows = await fetchLonghornJson();
      // sanity check: many rows expected; otherwise treat as fail
      if (rows && rows.length > 2) return rows;
      console.log('Longhorn returned few rows - attempt', attempt);
    } catch (err) {
      console.log('Longhorn attempt', attempt, 'error:', err.message || err);
    }
  }
  throw new Error('Longhorn unreachable after attempts');
}

// Root
app.get('/', (req, res) => res.send('LuSE Prices API - use /prices/table'));

// Start server
app.listen(PORT, () => {
  console.log(`LuSE Prices API listening on port ${PORT}`);
});
