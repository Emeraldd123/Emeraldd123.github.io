// One-time setup for lead emails: copies Pipit's Resend key into Supabase Vault and installs
// the trigger in backend/notify.sql. Reads secrets from Pipit's .env; prints none of them.
//   node backend/setup-alerts.cjs
const path = require('path');
const fs = require('fs');
const PIPIT = process.env.PIPIT_DIR || path.resolve(__dirname, '../../Pipit');
require(path.join(PIPIT, 'node_modules/dotenv')).config({ path: path.join(PIPIT, '.env'), quiet: true });
const { Client } = require(path.join(PIPIT, 'node_modules/pg'));

(async () => {
  const key = process.env.RESEND_API_KEY;
  const pipitFrom = process.env.EMAIL_FROM || '';
  const addr = (pipitFrom.match(/<([^>]+)>/) || [, pipitFrom])[1].trim();
  if (!key || !addr.includes('@')) throw new Error('RESEND_API_KEY / EMAIL_FROM missing in Pipit .env');
  const sender = `Portfolio Alerts <${addr}>`;

  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [name, value] of [['portfolio_resend_key', key], ['portfolio_email_from', sender]]) {
    const { rows } = await c.query('select id from vault.secrets where name = $1', [name]);
    if (rows.length) await c.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
    else await c.query('select vault.create_secret($1, $2)', [value, name]);
  }
  await c.query(fs.readFileSync(path.join(__dirname, 'notify.sql'), 'utf8'));
  console.log('Lead alerts installed. Sender:', sender.replace(/<.*@/, '<…@'));
  await c.end();
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
