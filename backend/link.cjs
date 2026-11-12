// Make a personal tracking link for outreach, optionally opening on the section that person cares about.
//
//   node backend/link.cjs "Drew Beauchamp" cmu research
//   -> https://emeraldd123.github.io/?ref=drew-beauchamp_cmu#research
//
//   node backend/link.cjs "Jane Doe" synchron mindcode
//   node backend/link.cjs "LinkedIn post 1"          (a channel, no section)
//
// When they open it, `node backend/report.cjs` shows the visit under TRACKED LINKS: what they read, clicked, and
// whether they opened your resume. The tag is removed from their address bar after the page loads.
const SECTIONS = {
  research: 'research',   // labs, PIs, REU / research programs
  work: 'work',           // all software projects
  mindcode: 'mindcode',   // AI / software teams
  notes: 'pipit',         // Ben's Notes (ML + learning science)
  finance: 'finance',     // fintech / backend
  times: 'bentimes',
  fog: 'fog',             // Parkinson's gait ML
  emg: 'emg',             // CMU EMG work
  experience: 'experience',
  about: 'about',
  contact: 'contact',
};
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40);

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Usage: node backend/link.cjs "Person or channel" [company] [section]\nSections: ' + Object.keys(SECTIONS).join(', '));
  process.exit(1);
}
let section = '';
if (args.length > 1 && SECTIONS[String(args[args.length - 1]).toLowerCase()]) section = SECTIONS[String(args.pop()).toLowerCase()];
const parts = args.map(slug).filter(Boolean);
if (!parts.length) { console.log('Give a person or channel name.'); process.exit(1); }
console.log('https://emeraldd123.github.io/?ref=' + parts.join('_').slice(0, 80) + (section ? '#' + section : ''));
