import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tab-analytics"></div>
  <div id="tab-dashboard"></div>
  <div id="acct-pill-wrap" style="display:none"></div>
  <div class="hdr-l"></div>
  <div id="mob-bottom-nav"></div>
  <div id="sb-nav"></div>
  <div id="sidebar"></div>
</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
const { window } = dom;

class FakeChart {
  constructor(ctx, config){ this.ctx=ctx; this.config=config; }
  destroy(){}
  static register(){}
  getDatasetMeta(){ return {data:[]}; }
}
FakeChart.registry = { plugins: { get: () => null } };
window.Chart = FakeChart;
window.supabase = { createClient: () => ({
  auth: { getSession: async()=>({data:{session:null}}), getUser: async()=>({data:{user:null}}), onAuthStateChange: ()=>{}, signOut: async()=>{} },
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}), order: ()=>({}) }), upsert: async()=>({data:null,error:null}) }),
}) };

const syms=['EURUSD','GBPUSD','NQ'];
const testTrades=[];
for(let i=0;i<40;i++){
  const roll=Math.random();
  let r;
  if(roll<0.55) r=(Math.random()*2.5+0.3).toFixed(2);
  else if(roll<0.9) r=(-(Math.random()*1.5+0.3)).toFixed(2);
  else r='0';
  testTrades.push({id:i,dbId:'t'+i,date:'2026-0'+((i%9)+1)+'-01',r,outcome:parseFloat(r)>0?'Win':parseFloat(r)<0?'Loss':'Breakeven',sym:syms[i%3],ruleBreak:'None'});
}

const testInvocation = `
;(function(){
  const results = {};
  try{
    trades = ${JSON.stringify(testTrades)};
    profile = {name:'Test', account: 10000};
    LANG='en';
    renderAnalytics(); // builds #challenge-results, #ch-target, #ch-maxloss into the DOM

    // Verify the simulator's input fields exist with correct defaults
    const targetEl = document.getElementById('ch-target');
    const maxLossEl = document.getElementById('ch-maxloss');
    results.hasTargetInput = !!targetEl;
    results.hasMaxLossInput = !!maxLossEl;
    results.defaultTarget = targetEl ? targetEl.value : null;
    results.defaultMaxLoss = maxLossEl ? maxLossEl.value : null;

    // Now actually run the simulation (synchronous call; setTimeout inside won't fire
    // automatically in this harness, so call the inner logic path directly by
    // temporarily monkey-patching setTimeout to run immediately)
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (fn) => fn();
    runChallengeSimulation();
    window.setTimeout = realSetTimeout;

    const resultsHTML = document.getElementById('challenge-results').innerHTML;
    results.resultsRendered = resultsHTML.length > 50;
    results.hasTable = resultsHTML.includes('<table');
    results.hasRiskRows = ['0.25%','0.5%','0.75%','1%','1.5%','2%'].every(rl => resultsHTML.includes(rl));
    results.lastChallengeResultsSet = !!lastChallengeResults;
    results.rowCount = lastChallengeResults ? lastChallengeResults.rows.length : 0;
    results.samplePassRates = lastChallengeResults ? lastChallengeResults.rows.map(r => ({rl:r.rl, static:(r.stat.passRate*100).toFixed(1)+'%', trailing:(r.trail.passRate*100).toFixed(1)+'%'})) : [];

    // Test with too few trades
    trades = [{id:1,dbId:'x',date:'2026-01-01',r:'1',outcome:'Win',ruleBreak:'None'}];
    renderAnalytics();
    window.setTimeout = (fn) => fn();
    runChallengeSimulation();
    window.setTimeout = realSetTimeout;
    results.fewTradesMessage = document.getElementById('challenge-results').innerHTML.includes('at least 5') || document.getElementById('challenge-results').innerHTML.includes('Log at least 5');

    window.__testResult = {ok:true, results};
  }catch(e){
    window.__testResult = {ok:false, error: e.message, stack: e.stack};
  }
})();
`;

// This stub DOM doesn't have the full page structure init() expects (auth-screen
// etc). Suppress the app's own DOMContentLoaded->init() auto-wire so it doesn't
// fire against the incomplete stub; the test drives the target function directly.
const shim = `(function(){var orig=document.addEventListener.bind(document);document.addEventListener=function(type,fn,opts){if(type==='DOMContentLoaded')return;orig(type,fn,opts);};})();`;
try {
  window.eval(shim + fullScript + testInvocation);
} catch(e) {
  console.log('SCRIPT-LEVEL ERROR:', e.message);
  process.exit(1);
}

const result = window.__testResult;
console.log(JSON.stringify(result, null, 2));
