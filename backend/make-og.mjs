// Renders backend/og-card.html to assets/og-image.png at 1200x630 (the size LinkedIn, Reddit, X and Slack expect).
// Needs Google Chrome and playwright-core:  npm install --no-save playwright-core && node backend/make-og.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(pathToFileURL(path.join(here, 'og-card.html')).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(here, '../assets/og-image.png') });
await b.close();
console.log('wrote assets/og-image.png');
