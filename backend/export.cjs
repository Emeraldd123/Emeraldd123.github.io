// Dump EVERY raw event from portfolio.events: no owner filter, no bot filter, no scoring, no grouping.
// Each row is exactly what the browser sent, plus the database's own id and timestamp.
//
//   node backend/export.cjs                  writes exports/events-<timestamp>.jsonl and .csv
//   node backend/export.cjs --since 2026-11-09   only events on/after that date (UTC)
//
// Output goes to backend/../exports/, which is gitignored: this data is private and the repo is public.
const path = require('path');
const fs = require('fs');
const PIPIT = process.env.PIPIT_DIR || path.resolve(__dirname, '../../Pipit');
require(path.join(PIPIT, 'node_modules/dotenv')).config({ path: path.join(PIPIT, '.env'), quiet: true });
const { Client } = require(path.join(PIPIT, 'node_modules/pg'));

const sinceArg = process.argv.indexOf('--since');
const since = sinceArg > -1 ? process.argv[sinceArg + 1] : null;
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('--since needs a date like 2026-11-09'); process.exit(1); }

(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select id, created_at, session_id, visitor_id, type, data from portfolio.events
     ${since ? 'where created_at >= $1::date' : ''} order by id`, since ? [since] : []);
  await c.end();

  const dir = path.resolve(__dirname, '../exports');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const base = path.join(dir, `events-${stamp}`);

  // JSONL: one complete event per line, nothing dropped
  fs.writeFileSync(base + '.jsonl', rows.map((r) => JSON.stringify({ ...r, created_at: r.created_at.toISOString() })).join('\n') + '\n');

  // CSV: the raw columns, plus `data` as JSON text (open in Excel/Sheets/pandas and parse as needed)
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = ['id,created_at,session_id,visitor_id,type,data']
    .concat(rows.map((r) => [r.id, r.created_at.toISOString(), r.session_id, r.visitor_id, r.type, JSON.stringify(r.data)].map(q).join(',')));
  fs.writeFileSync(base + '.csv', csv.join('\n') + '\n');

  const byType = {};
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
  console.log(`${rows.length} events, ${new Set(rows.map((r) => r.session_id)).size} sessions, ${new Set(rows.map((r) => r.visitor_id)).size} visitor ids`);
  console.log('by type:', JSON.stringify(byType));
  console.log('wrote', base + '.jsonl');
  console.log('wrote', base + '.csv');
})().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
