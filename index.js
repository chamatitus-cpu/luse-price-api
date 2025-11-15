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

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive'
        },
        timeout: 20000
      });

      if (r.ok) {
        const j = await r.json();
        const rows = [['Ticker','Company','Last','Bid','Ask']];

        j.forEach(it => {
          rows.push([
            it.ticker || '',
            it.securityName || '',
            Number(it.lastPrice) || '',
            Number(it.bid) || '',
            Number(it.ask) || ''
          ]);
        });

        return rows;
      }

      console.log(`Longhorn attempt ${attempt} failed, status: ${r.status}`);

    } catch (err) {
      console.log(`Longhorn attempt ${attempt} error:`, err.message);
    }
  }

  throw new Error("Longhorn unreachable after 3 attempts");
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
