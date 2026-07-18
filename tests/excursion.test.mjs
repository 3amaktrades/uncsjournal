import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tab-analytics"></div><div id="tab-dashboard"></div>
  <div id="acct-pill-wrap" style="display:none"></div><div class="hdr-l"></div>
  <div id="mob-bottom-nav"></div><div id="sb-nav"></div><div id="sidebar"></div>
</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
const { window } = dom;
class FakeChart { constructor(){} destroy(){} static register(){} getDatasetMeta(){return{data:[]};} }
FakeChart.registry = { plugins: { get: () => null } };
window.Chart = FakeChart;
window.supabase = { createClient: () => ({
  auth: { getSession: async()=>({data:{session:null}}), onAuthStateChange:()=>{} },
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}), order: async()=>({data:[],error:null}) }) }),
}) };

const shim = `(function(){var orig=document.addEventListener.bind(document);document.addEventListener=function(type,fn,opts){if(type==='DOMContentLoaded')return;orig(type,fn,opts);};})();`;

const testInvocation = `
;(function(){
  try{
    const results = {};

    // 1. mae round-trips through tradeToDb -> dbToTrade
    const original = {id:1, sym:'NQ', date:'2026-07-01', r:'2.5', maxRR:'5', mae:'0.8', ruleBreak:'None'};
    const row = tradeToDb(original);
    results.maeMapsToDbColumn = (row.mae === 0.8);
    const back = dbToTrade({id:99, r_result:2.5, max_rr:5, mae:0.8, trade_date:'2026-07-01', sym:'NQ'});
    results.maeReadsBack = (back.mae === '0.8');

    // 2. Capture efficiency: trade reached 5R (maxRR) but exited at 2.5R -> 50% capture.
    trades = [
      {id:1,dbId:'a',date:'2026-07-01',r:'2.5',maxRR:'5',mae:'0.8',outcome:'Win',ruleBreak:'None'},
      {id:2,dbId:'b',date:'2026-07-02',r:'1',maxRR:'4',mae:'0.5',outcome:'Win',ruleBreak:'None'}, // 25%
      {id:3,dbId:'c',date:'2026-07-03',r:'-1',maxRR:'2',mae:'1.2',outcome:'Loss',ruleBreak:'None'} // went +2R, gave it back -> 0%
    ];
    profile = {name:'Test', account:10000};
    LANG='en';
    renderAnalytics();
    const out = document.getElementById('tab-analytics').innerHTML;
    results.hasExecutionCard = out.includes('Trade Execution');
    results.showsCaptureEfficiency = out.includes('Capture efficiency');
    // Expected capture: (2.5/5 + 1/4 + max(0,-1/2)) / 3 = (0.5 + 0.25 + 0) / 3 = 25%
    results.showsCorrectEfficiency = out.includes('25%');
    // Avg heat = (0.8 + 0.5 + 1.2)/3 = 0.83
    results.showsAvgHeat = out.includes('0.83');

    // 3. Empty state when no excursion data logged
    trades = [{id:1,dbId:'a',date:'2026-07-01',r:'2',outcome:'Win',ruleBreak:'None'}];
    renderAnalytics();
    const out2 = document.getElementById('tab-analytics').innerHTML;
    results.emptyStateShown = out2.includes('unlock this analysis');

    window.__testResult = {ok:true, results};
  }catch(e){
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
console.log(JSON.stringify(window.__testResult, null, 2));
