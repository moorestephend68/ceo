/* The debrief, as one page an instructor can print, project or email.

   Same computation as the dashboard — lib/analysis.mjs — laid out for reading
   rather than for watching. It is deliberately a single self-contained HTML file
   with no scripts and no fonts to fetch: it has to open on a lecture-theatre
   machine, survive being emailed to thirty students, and print without a
   surprise. */

import { fmtMoney as money } from './analysis.mjs';

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pctFrom = (index) => {
  const d = Math.round((index - 1) * 100);
  return d === 0 ? 'the same as the class' : `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} the class`;
};

export function classReport(a) {
  const t = a.totals;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(a.name)} — debrief</title>
<style>
  body{font:16px/1.55 Georgia,"Times New Roman",serif;color:#111;background:#fff;
    max-width:52rem;margin:0 auto;padding:2.5rem 1.5rem 4rem}
  h1{font-size:1.7rem;margin:0 0 .2rem} h2{font-size:1.2rem;margin:2rem 0 .6rem}
  h3{font-size:1rem;margin:1.4rem 0 .2rem}
  .sub{color:#555;margin:0 0 1.4rem}
  table{border-collapse:collapse;width:100%;font-size:.92rem;margin:.6rem 0 1rem}
  th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #e4e2dc}
  th{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
  td.v,th.v{text-align:right;font-variant-numeric:tabular-nums}
  .finding{border-left:3px solid #c9a227;padding:.1rem 0 .1rem .9rem;margin:1.1rem 0}
  .finding .h{font-weight:700}
  .finding .ask{color:#444;font-style:italic;margin-top:.3rem}
  .note{color:#555;font-size:.92rem}
  .big{font-size:1.5rem;font-weight:700}
  .cols{display:flex;gap:2.5rem;flex-wrap:wrap;margin:.5rem 0 0}
  footer{margin-top:3rem;color:#777;font-size:.82rem;border-top:1px solid #e4e2dc;padding-top:.8rem}
  @media print{body{padding:0} .finding{break-inside:avoid} table{break-inside:avoid}}
</style></head><body>

<h1>${esc(a.name)}</h1>
<p class="sub">${t.groups} groups · ${t.students} students · ${t.rounds} of ${t.totalRounds} rounds
${a.identical ? ` · every group ran the identical market (seed ${a.seed})` : ''}</p>

<div class="cols">
  <div><div class="big">${money(a.spread.best)}</div><div class="note">best company</div></div>
  <div><div class="big">${money(a.spread.median)}</div><div class="note">median</div></div>
  <div><div class="big">${money(a.spread.worst)}</div><div class="note">worst</div></div>
  <div><div class="big">${t.out}</div><div class="note">went under</div></div>
</div>

${a.identical ? `<p class="note" style="margin-top:1.2rem">Every group faced the same market:
the same customers, the same costs, the same shocks in the same rounds. Nobody drew a harder
economy than anybody else, so the differences below are differences in what people decided.</p>` : ''}

<h2>The groups, ranked</h2>
<table>
  <thead><tr><th>Group</th><th class="v">Median company</th><th class="v">Best</th>
    <th class="v">Price</th><th class="v">Advertising</th><th class="v">Went under</th></tr></thead>
  <tbody>${a.table.map((g) => `<tr>
    <td>Group ${g.group}</td>
    <td class="v">${money(g.medianValue)}</td>
    <td class="v">${money(g.bestValue)}</td>
    <td class="v">${esc(pctFrom(g.priceIndex))}</td>
    <td class="v">${esc(pctFrom(g.adsIndex))}</td>
    <td class="v">${g.out || '—'}</td>
  </tr>`).join('')}</tbody>
</table>

<h2>Things worth discussing</h2>
${a.findings.length ? a.findings.map((f) => `
<div class="finding">
  <div class="h">Group ${f.group} — ${esc(f.headline)}</div>
  <div>${esc(f.detail)}</div>
  <div class="ask">${esc(f.ask)}</div>
</div>`).join('') : '<p class="note">Nothing stood out yet — the class has not played far enough.</p>'}

<h2>Who filed, and who was carried</h2>
<p class="note">A student who misses a deadline is not stranded: their previous orders repeat.
It is recorded here because it is the difference between a company that was run and one that
was left running.</p>
<table>
  <thead><tr><th>Group</th><th>Company</th><th class="v">Rounds filed</th>
    <th class="v">Carried</th><th class="v">Company value</th></tr></thead>
  <tbody>${a.students.map((s) => `<tr>
    <td>${s.group}</td><td>${esc(s.name)}${s.out ? ' — went under' : ''}</td>
    <td class="v">${s.filed} of ${s.played}</td>
    <td class="v">${s.missed || '—'}</td>
    <td class="v">${money(s.value)}</td>
  </tr>`).join('')}</tbody>
</table>

<footer>Generated from the class's own record. Every figure above is read from what the
companies actually did, round by round.</footer>
</body></html>
`;
}
