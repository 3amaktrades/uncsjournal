import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../index.html', 'utf8');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
const bodyHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '') : '';
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch[1];

const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, {
  runScripts: 'outside-only', url: 'http://localhost/index.html', pretendToBeVisual: true
});
const { window } = dom;

// Simulate an IntersectionObserver that NEVER fires (worst case: the exact
// failure mode we're guarding against) — proves the timeout fallback alone
// is what saves us, independent of whether the observer ever works.
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() {}
  unobserve() {}
};
window.fetch = async () => ({ json: async () => ({}) });

try {
  window.eval(script);
} catch (e) {
  console.log('SCRIPT THREW:', e.message);
  process.exit(1);
}

const revealEls = window.document.querySelectorAll('.reveal,.reveal-pop');
console.log('total reveal elements:', revealEls.length);
console.log('have .in class BEFORE timeout fires:', [...revealEls].filter(e => e.classList.contains('in')).length);

// Fast-forward real time by 1900ms (jsdom uses real timers, so actually wait)
await new Promise(r => setTimeout(r, 1900));

console.log('have .in class AFTER 1900ms:', [...revealEls].filter(e => e.classList.contains('in')).length);
console.log('sample element classList:', revealEls[0].className);
