// index.js - LuSE Market Data scraper API (Full data)
// Deploy on Render (or similar). Exposes /prices/table returning table-format JSON.

const express = require('express');
const got = require('got');
const cheerio = require('cheerio');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Cache (short TTL to avoid hitting LuSE too often)
const CACHE_TTL = 60 * 1000; // 60 seconds
let cache = { ts: 0, rows: null };

// Headers to mimic a real browser
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// fallback minimal table if scraping fails
const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"],
  ["AVJN","ZANACO PLC",6.04,"","","+0.00%",0,0],
  ["KODT","CEC PLC",22.68,"","","+0.00%",0,0]
];

function getCached() {
  if (cache.rows && (Date.now() - cache.ts) < CACHE_TTL) return cache.rows;
  return null;
}
function setCached(rows) { cache = { ts: Date.now(), rows }; }

function parseNumberStr(s) {
  if (s === null || s === undefined) return '';
  const cleaned = s.toString().replace(/[,]/g, '').replace(/[^\d\.\-]/g, '').trim();
  if (cleaned === '') return '';
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : '';
}

async function fetchLuSEMarketTable() {
  // target URL
  const url = 'https://www.luse.co.zm/trading/market-data/#market';

  // request options
  const opts = {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'br, gzip, deflate',
      'Connection': 'keep-alive',
      'Referer': 'https://www.luse.co.zm/'
    },
    timeout: { request: 20000 },
    retry: { limit: 1 }
  };

  const res = await got.get(url, opts);
  const html = res.body;
  const $ = cheerio.load(html);

  // The page contains the market table(s). We'll try to find the table with the header we expect.
  // Strategy: find any <table> that has "Company" and "Ticker" or "Last Price" headers.
  let targetTable = null;
  $('table').each((i, t) => {
    const headers = $(t).find('th').map((i, th) => $(th).text().trim().toLowerCase()).get();
    const hasCompany = headers.some(h => /company|name/.test(h));
    const hasTicker  = headers.some(h => /ticker|symbol/.test(h));
    const hasLast    = headers.some(h => /last|last price|price/.test(h));
    if (hasCompany && hasTicker && hasLast && !targetTable) targetTable = t;
  });

  // If not found, try first table as fallback
  if (!targetTable) {
    targetTable = $('table').first();
    if (!targetTable || targetTable.length === 0) throw new Error('No table found on LuSE page');
  }

  // Build rows: we will extract columns by header name mapping
  const headerCells = $(targetTable).find('th').map((i, th) => $(th).text().trim()).get();
  const headerKeys = headerCells.map(h => h.toLowerCase());

  // Map headers to our standard columns
  // We'll try to detect column indices for ticker/company/last/change/volume/value/bid/ask
  const idx = {
    ticker: headerKeys.findIndex(h => /ticker|symbol/.test(h)),
    company: headerKeys.findIndex(h => /company|name/.test(h)),
    last: headerKeys.findIndex(h => /last|last price|price/.test(h)),
    change: headerKeys.findIndex(h => /change|%/.test(h)),
    volume: headerKeys.findIndex(h => /volume/.test(h)),
    value: headerKeys.findIndex(h => /value|zmw|turnover/.test(h)),
    bid: headerKeys.findIndex(h => /bid/.test(h)),
    ask: headerKeys.findIndex(h => /ask/.test(h))
  };

  // Compose output rows with header row (standard order)
  const out = [["Ticker","Company","Last","Bid","Ask","Change","Volume","Value"]];

  // iterate rows
  $(targetTable).find('tbody tr').each((ri, tr) => {
    const cells = $(tr).find('td').map((ci, td) => $(td).text().trim()).get();

    // helper to safely get by index
    const val = (i) => (i !== -1 && i < cells.length) ? cells[i] : '';

    const ticker  = val(idx.ticker)  || val(idx.company) || ''; // sometimes ticker in different column
    const company = val(idx.company) || val(idx.ticker) || '';
    const lastRaw = val(idx.last);
    const bidRaw  = val(idx.bid);
    const askRaw  = val(idx.ask);
    const change  = val(idx.change) || '';
    const volumeRaw= val(idx.volume);
    const valueRaw = val(idx.value);

    const last = parseNumberStr(lastRaw);
    const bid  = parseNumberStr(bidRaw);
    const ask  = parseNumberStr(askRaw);
    const vol  = parseNumberStr(volumeRaw);
    const valAmt = parseNumberStr(valueRaw);

    out.push([ ticker, company, last, bid, ask, change, vol, valAmt ]);
  });

  if (out.length <= 1) throw new Error('Parsed table but no data rows');

  return out;
}

// Wrapper: tries LuSE primary, with fallback to small static table
async function getMarketTableWithFallback() {
  // use cache
  const cached = getCached();
  if (cached) return cached;

  // try primary
  try {
    const rows = await fetchLuSEMarketTable();
    setCached(rows);
    return rows;
  } catch (err) {
    console.log('LuSE scrape failed:', err.message || err);
  }

  // if primary fails, keep fallback (guarantee)
  setCached(FALLBACK);
  return FALLBACK;
}

app.get('/prices/table', async (req, res) => {
  try {
    const rows = await getMarketTableWithFallback();
    return res.json(rows);
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/', (req, res) => res.send('LuSE Market Data API - /prices/table'));

app.listen(PORT, () => console.log(`LuSE Market Data API listening on port ${PORT}`));
