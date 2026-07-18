import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="sb-nav"></div><div id="sidebar"></div><div id="mob-bottom-nav"></div>
</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html', pretendToBeVisual: true });
const { window } = dom;
window.Chart = class { constructor(){} destroy(){} static register(){} };
window.document.elementFromPoint = function(){ return null; };
window.supabase = { createClient: () => ({ auth: { getSession: async()=>({data:{session:null}}), onAuthStateChange:()=>{} }, from: () => ({}) }) };

const shim = `(function(){var orig=document.addEventListener.bind(document);document.addEventListener=function(type,fn,opts){if(type==='DOMContentLoaded')return;orig(type,fn,opts);};})();`;

function makeTouchEvent(type, x, y, opts) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  ev.touches = [{ clientX: x, clientY: y }];
  ev.changedTouches = [{ clientX: x, clientY: y }];
  return ev;
}

const testInvocation = `
;(async function(){
  const log = {};
  try {
    tabOrder = ['dashboard','new','log','analytics'];
    buildSidebar();
    const dash = document.getElementById('sb-dashboard');
    const logItem = document.getElementById('sb-log');
    log.itemsBuilt = !!dash && !!logItem;

    // Case 1: quick swipe (simulating a scroll attempt) — touchstart then IMMEDIATE
    // large-distance touchmove, no hold. Should NOT enter drag mode, should NOT
    // preventDefault (i.e. native scroll must be allowed to proceed).
    const ev1start = new Event('touchstart', {bubbles:true});
    ev1start.touches = [{clientX:100, clientY:100}];
    dash.dispatchEvent(ev1start);

    const ev1move = new Event('touchmove', {bubbles:true, cancelable:true});
    ev1move.touches = [{clientX:100, clientY:250}]; // moved 150px immediately
    let pdCalled = false;
    const origPD = ev1move.preventDefault.bind(ev1move);
    ev1move.preventDefault = function(){ pdCalled = true; origPD(); };
    dash.dispatchEvent(ev1move);
    log.quickSwipe_preventDefaultCalled = pdCalled;
    log.quickSwipe_opacityDuringMove = dash.style.opacity;

    const ev1end = new Event('touchend', {bubbles:true});
    ev1end.changedTouches = [{clientX:100, clientY:250}];
    dash.dispatchEvent(ev1end);

    // Case 2: genuine hold — touchstart, wait past the 450ms hold timer, THEN move.
    // Should enter drag mode (opacity dims) and preventDefault should fire on move.
    const ev2start = new Event('touchstart', {bubbles:true});
    ev2start.touches = [{clientX:100, clientY:100}];
    dash.dispatchEvent(ev2start);
    await new Promise(r => setTimeout(r, 500)); // past the 450ms hold threshold
    log.afterHold_opacity = dash.style.opacity;

    const ev2move = new Event('touchmove', {bubbles:true, cancelable:true});
    ev2move.touches = [{clientX:100, clientY:140}];
    let pd2Called = false;
    const origPD2 = ev2move.preventDefault.bind(ev2move);
    ev2move.preventDefault = function(){ pd2Called = true; origPD2(); };
    dash.dispatchEvent(ev2move);
    log.heldDrag_preventDefaultCalled = pd2Called;

    const ev2end = new Event('touchend', {bubbles:true});
    ev2end.changedTouches = [{clientX:100, clientY:140}];
    dash.dispatchEvent(ev2end);
    log.afterDrop_opacity = dash.style.opacity;

    window.__testResult = {ok:true, log};
  } catch(e) {
    window.__testResult = {ok:false, error: e.message, stack: e.stack};
  }
})();
`;

try {
  window.eval(shim + fullScript + testInvocation);
} catch (e) {
  console.log('SCRIPT-LEVEL ERROR:', e.message);
  process.exit(1);
}

// wait for the async IIFE (including its internal 500ms delay) to finish
await new Promise(r => setTimeout(r, 800));
console.log(JSON.stringify(window.__testResult, null, 2));
