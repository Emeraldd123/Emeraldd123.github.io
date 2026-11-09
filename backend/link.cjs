// Make a personal tracking link for cold outreach.
//   node backend/link.cjs "Drew Beauchamp" cmu      -> https://emeraldd123.github.io/?ref=drew-beauchamp_cmu
// When they open it, the report's TRACKED LINKS section shows the visit, what they read and clicked.
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40);
const parts = process.argv.slice(2).map(slug).filter(Boolean);
if (!parts.length) { console.log('Usage: node backend/link.cjs "Person Name" [company]'); process.exit(1); }
console.log('https://emeraldd123.github.io/?ref=' + parts.join('_').slice(0, 80));
