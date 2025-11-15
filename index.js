// index.js
const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (LuSE-Tracker/1.0; +your@email)';

// Try Longhorn API first (fast & reliable)
async function tryLonghorn() {
  const url = 'https://mobile.longhorn.luse.co.zm/api/securities';
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('Longhorn unreachable: ' + r.status);
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

    res.status(502).json({error:"All sources failed"});
  } catch(err) {
    res.status(500).json({error:"Server error"});
  }
});

app.get('/', (req,res)=>res.send('LuSE Prices API – use /prices/table'));

app.listen(PORT, ()=>console.log(`API running on ${PORT}`));
