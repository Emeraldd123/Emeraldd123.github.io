// Private visitor report for Ben. Reads portfolio.visits from Pipit's Supabase using the
// database URL in Pipit's .env (never shipped to the website).
//
//   node backend/report.cjs            last 14 days
//   node backend/report.cjs 60         last 60 days
//   node backend/report.cjs 60 --csv   CSV to stdout (redirect to a file)
const path = require('path');
const PIPIT = process.env.PIPIT_DIR || path.resolve(__dirname, '../../Pipit');
require(path.join(PIPIT, 'node_modules/dotenv')).config({ path: path.join(PIPIT, '.env'), quiet: true });
const { Client } = require(path.join(PIPIT, 'node_modules/pg'));

const days = Number(process.argv[2]) || 14;
const csv = process.argv.includes('--csv');
const meOnly = process.argv.includes('--me'); // show only Ben's own visits instead of excluding them

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select * from portfolio.visits where started_at > now() - make_interval(days => $1) and is_owner = $2 order by started_at desc`, [days, meOnly]);
  await c.end();

  if (csv) {
    const cols = Object.keys(rows[0] || { session_id: 1 });
    const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    console.log(cols.join(','));
    for (const r of rows) console.log(cols.map((k) => q(r[k] instanceof Date ? r[k].toISOString() : r[k])).join(','));
    return;
  }

  const visitors = new Set(rows.map((r) => r.visitor_id));
  const warm = rows.filter((r) => r.warm_lead);
  const intros = rows.filter((r) => r.intro_name || r.intro_company);
  const linkedins = rows.filter((r) => r.intro_linkedin);
  const resumes = rows.filter((r) => r.resume_clicked);
  const tagged = rows.filter((r) => r.ref);
  const topDwell = (r, n = 3) => Object.entries(r.dwell_seconds || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k} ${v >= 60 ? Math.round(v / 6) / 10 + 'm' : v + 's'}`).join(', ') || '-';
  const count = (key) => {
    const m = {};
    for (const r of rows) for (const v of String(r[key] || '').split(', ').filter(Boolean)) m[v] = (m[v] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const line = (s) => console.log(s);
  const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const mins = (s) => (s >= 60 ? Math.round(s / 60) + ' min' : s + ' s');

  line(meOnly ? `\nYOUR OWN visits (marked with ?me=1), last ${days} days` : `\nPortfolio visitors, last ${days} days (your own browsers excluded)`);
  line(`  ${rows.length} visits from ${visitors.size} people · ${warm.length} warm leads · ${intros.length} said hi`);
  line(`  RESUMES DOWNLOADED: ${resumes.length} · LINKEDINS DROPPED: ${linkedins.length} · TRACKED-LINK VISITS: ${tagged.length}\n`);

  if (linkedins.length) {
    line('LINKEDIN DROPS');
    for (const r of linkedins) line(`  ${when(r.started_at)}  ${r.intro_linkedin}  (${r.network_org || '?'}, ${r.city || '?'}${r.ref ? ', ref ' + r.ref : ''})`);
    line('');
  }
  if (tagged.length) {
    line('TRACKED LINKS (people you sent a ?ref= link to)');
    for (const r of tagged) line(`  ${when(r.started_at)}  ${r.ref}${r.ref_returning ? ' (came back later)' : ''} · ${mins(r.seconds_on_site)} · read most: ${topDwell(r)} · clicked: ${r.clicked || '-'}${r.resume_clicked ? ' · RESUME' : ''}`);
    line('');
  }

  if (intros.length) {
    line('SAID HI');
    for (const r of intros) line(`  ${when(r.started_at)}  ${r.intro_name || '?'} · ${r.intro_company || '?'} · ${r.intro_role || ''} · ${r.intro_email || ''}\n      ${r.intro_note || ''}`);
    line('');
  }

  line('NETWORKS (company / university / ISP from IP)');
  for (const [k, n] of count('network_org').slice(0, 15)) line(`  ${String(n).padStart(3)}  ${k}`);
  line('\nWHERE FROM');
  for (const [k, n] of count('referrer').slice(0, 10)) line(`  ${String(n).padStart(3)}  ${k}`);
  line('\nATTENTION (total seconds on screen, all visits)');
  const att = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.dwell_seconds || {})) att[k] = (att[k] || 0) + v;
  for (const [k, v] of Object.entries(att).sort((a, b) => b[1] - a[1])) line(`  ${String(v).padStart(5)}s  ${k}`);
  line('\nPROJECTS SEEN');
  for (const [k, n] of count('sections_seen')) line(`  ${String(n).padStart(3)}  ${k}`);
  line('\nDEMO VIDEOS WATCHED');
  for (const [k, n] of count('videos_watched')) line(`  ${String(n).padStart(3)}  ${k}`);
  line('\nLINKS CLICKED');
  for (const [k, n] of count('clicked')) line(`  ${String(n).padStart(3)}  ${k}`);

  line('\nWARM LEADS (came from a ref link, reached experience/contact, clicked email/LinkedIn/resume, or said hi)');
  for (const r of warm.slice(0, 40)) {
    const where = [r.city, r.region, r.country].filter(Boolean).join(', ');
    line(`  ${when(r.started_at)}  ${r.network_org || 'unknown network'} · ${where || '?'} · ${mins(r.seconds_on_site)} · ${r.visits_by_this_visitor} visit(s)`);
    line(`      read most: ${topDwell(r)} | clicked: ${r.clicked || '-'}${r.resume_clicked ? ' | RESUME' : ''} | from: ${r.ref ? 'ref ' + r.ref : r.referrer || 'direct'}`);
  }
  line('');
})().catch((e) => { console.error('Report failed:', e.message); process.exit(1); });
