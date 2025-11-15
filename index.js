const FALLBACK = [
  ["Ticker","Company","Last","Bid","Ask"],
  ["AVJN","ZANACO PLC",6.04,"",""],
  ["KODT","CEC PLC",22.68,"",""],
  ["ZSUG","ZAMBIA SUGAR PLC",65.24,"",""],
  ["SHOP","SHOPRITE HOLDINGS",350.00,"",""],
];
// index.js
const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";


// Try Longhorn API first (fast & reliable)
async function tryLonghorn() {
  const url = 'https://mobile.longhorn.luse.co.zm/api/securities';
  const MAX_ATTEMPTS = 4;
  const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // progressive backoff for retries (250ms, 500ms, 1000ms, ...)
      if (attempt > 1) {
        const waitMs = 250 * Math.pow(2, attempt - 2);
        console.log(`Longhorn: waiting ${waitMs}ms before attempt ${attempt}`);
        await new Promise(res => setTimeout(res, waitMs));
      }

      console.log(`Longhorn: attempt ${attempt} fetching ${url}`);
      const r = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://mobile.longhorn.luse.co.zm/',
          'Origin': 'https://mobile.longhorn.luse.co.zm',
          'Connection': 'keep-alive',
          // some servers respond better if a realistic Accept header is supplied
        },
        // node-fetch v2 timeout in ms
        timeout: 25000
      });

      console.log(`Longhorn: attempt ${attempt} status ${r.status}`);

      if (!r.ok) {
        // non-200 — log and retry
        console.log(`Longhorn: non-ok status ${r.status}, text preview: ${await r.text().then(t=>t.substring(0,200)).catch(()=>'<no body>')}`);
        continue;
      }

      // parse JSON (Longhorn returns JSON)
      let j;
      try {
        j = await r.json();
      } catch (err) {
        console.log('Longhorn: JSON parse error:', err.message);
        continue;
      }

      // Build rows in the expected table format
      const rows = [['Ticker','Company','Last','Bid','Ask']];
      if (!Array.isArray(j) || j.length === 0) {
        console.log('Longhorn: returned empty array or invalid JSON; falling back');
        continue;
      }

      j.forEach(it => {
        try {
          const ticker = (it.ticker || '').toString();
          const company = (it.securityName || it.name || '').toString();
          const last = (typeof it.lastPrice === 'number') ? it.lastPrice : Number(it.lastPrice) || '';
          const bid = (typeof it.bid === 'number') ? it.bid : Number(it.bid) || '';
          const ask = (typeof it.ask === 'number') ? it.ask : Number(it.ask) || '';
          rows.push([ticker, company, last, bid, ask]);
        } catch (e) {
          // continue building rows even if a single item fails
          console.log('Longhorn: row parse error for item:', e.message);
        }
      });

      // If we have at least header + one data row, return it
      if (rows.length > 1) {
        console.log(`Longhorn: success on attempt ${attempt}, rows=${rows.length - 1}`);
        return rows;
      } else {
        console.log('Longhorn: no rows parsed - retrying');
      }

    } catch (err) {
      // network or other unexpected error — log and retry
      console.log(`Longhorn: attempt ${attempt} error:`, err.message || err);
    }
  }

  // If we reach here, Longhorn was unreachable — throw to allow fallback logic upstream
  throw new Error("Longhorn unreachable after multiple attempts");
}



// Fallback – scrape LuSE site (only if Longhorn is down)
async function tryLuSE() {
  const url = 'https://luse.co.zm/listed-companies/';
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('LuSE unreachable: ' + r.status);
  const html = await r.text();

  const $ = cheerio.load(html);
  const table = $('table').first();
  if (!table.length) throw new Error('No table found');

  const rows = [['Ticker','Company','Last','Bid','Ask']];
  table.find('tr').each((i,tr) => {
    const cells = $(tr).find('td,th').map((i,el)=>$(el).text().trim()).get();
    if (cells.length >= 3) {
      const ticker = cells[1] || cells[0];
      const company = cells[0];
      const last = parseFloat(cells.find(c=>/\d/.test(c)) || '') || '';
      rows.push([ticker, company, last, '', '']);
    }
  });

  return rows;
}

app.get('/prices/table', async (req,res) => {
  try {
    try { return res.json(await tryLonghorn()); }
    catch(e) { console.log('Longhorn failed:',e.message); }

    try { return res.json(await tryLuSE()); }
    catch(e) { console.log('LuSE fallback failed:',e.message); }

res.json(FALLBACK);

  } catch(err) {
    res.status(500).json({error:"Server error"});
  }
});

app.get('/', (req,res)=>res.send('LuSE Prices API – use /prices/table'));

app.listen(PORT, ()=>console.log(`API running on ${PORT}`));
