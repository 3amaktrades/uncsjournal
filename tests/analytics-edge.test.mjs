import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

function runCase(name, setupCode) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="tab-analytics"></div>
    <div id="tab-dashboard"></div>
    <div id="acct-pill-wrap" style="display:none"></div>
    <div class="hdr-l"></div>
    <div id="mob-bottom-nav"></div>
    <div id="sb-nav"></div>
    <div id="sidebar"></div>
    <div id="auth-screen" style="display:flex"></div><div id="main-app" style="display:none"></div>
    <div id="mo" style="display:none"></div><div id="mo-t"></div><div id="mo-b"></div>
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

  const testInvocation = `
  ;(function(){
    try{
      ${setupCode}
      renderAnalytics();
      const out = document.getElementById('tab-analytics').innerHTML;
      window.__testResult = {ok:true, html: out};
    }catch(e){
      window.__testResult = {ok:false, error: e.message, stack: e.stack};
    }
  })();
  `;

  const shim = `(function(){var orig=document.addEventListener.bind(document);document.addEventListener=function(type,fn,opts){if(type==='DOMContentLoaded')return;orig(type,fn,opts);};})();`;
  try {
    window.eval(shim + fullScript + testInvocation);
  } catch(e) {
    console.log(`[${name}] SCRIPT-LEVEL ERROR:`, e.message);
    return;
  }
  const result = window.__testResult;
  if (!result || !result.ok) {
    console.log(`[${name}] FAILED:`, result ? result.error : 'no result', result ? result.stack : '');
    return;
  }
  const out = result.html;
  const openDivs = (out.match(/<div/g)||[]).length;
  const closeDivs = (out.match(/<\/div>/g)||[]).length;
  console.log(`[${name}] OK — htmlLength=${out.length}, divBalance=${openDivs===closeDivs?'OK':'MISMATCH '+openDivs+'/'+closeDivs}`);
  return out;
}

// Case 1: very few trades (3), below rolling window minimum
runCase('3 trades (edge case)', `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1',outcome:'Win',rating:'A+',vshape:'V-shape',liqSwept:'swept',funded:false,time:'09:00',dir:'Bullish',sym:'NQ',ruleBreak:'None'},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',rating:'A',vshape:'not V',liqSwept:'not swept',funded:true,time:'10:00',dir:'Bearish',sym:'ES',ruleBreak:'None'},
    {id:3,dbId:'c',date:'2026-07-03',r:'0',outcome:'Breakeven',rating:'A-',vshape:'V-shape',liqSwept:'swept',funded:false,time:'11:00',dir:'Bullish',sym:'GC',ruleBreak:'None'}
  ];
  profile = {name:'Test', account: 10000};
  LANG='en';
`);

// Case 2: no account size set
runCase('No account size', `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1',outcome:'Win',rating:'A+',vshape:'V-shape',liqSwept:'swept',funded:false,time:'09:00',dir:'Bullish',sym:'NQ',ruleBreak:'None'},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',rating:'A',vshape:'not V',liqSwept:'not swept',funded:true,time:'10:00',dir:'Bearish',sym:'ES',ruleBreak:'None'}
  ];
  profile = {name:'Test'};
  LANG='en';
`);

// Case 3: no profile at all
runCase('No profile', `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1',outcome:'Win',rating:'A+',vshape:'V-shape',liqSwept:'swept',funded:false,time:'09:00',dir:'Bullish',sym:'NQ',ruleBreak:'None'},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',rating:'A',vshape:'not V',liqSwept:'not swept',funded:true,time:'10:00',dir:'Bearish',sym:'ES',ruleBreak:'None'}
  ];
  profile = null;
  LANG='en';
`);

// Case 4: Arabic language
runCase('Arabic (RTL)', `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1',outcome:'Win',rating:'A+',vshape:'V-shape',liqSwept:'swept',funded:false,time:'09:00',dir:'Bullish',sym:'NQ',ruleBreak:'None'},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',rating:'A',vshape:'not V',liqSwept:'not swept',funded:true,time:'10:00',dir:'Bearish',sym:'ES',ruleBreak:'None'}
  ];
  profile = {name:'Test', account: 10000};
  LANG='ar';
`);

// Case 5: trades with missing rating/vshape/liqSwept/time (undefined fields)
runCase('Missing optional fields', `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1',outcome:'Win',sym:'NQ',ruleBreak:'None'},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',sym:'ES',ruleBreak:'None'},
    {id:3,dbId:'c',date:'2026-07-03',r:'2',outcome:'Win',sym:'GC',ruleBreak:'None'}
  ];
  profile = {name:'Test', account: 10000};
  LANG='en';
`);

// Case 6: all trades same rating (single group)
runCase('All same rating', `
  trades = Array.from({length:10}, (_,i)=>({id:i,dbId:'t'+i,date:'2026-07-0'+(i+1),r:String(i%2===0?1:-1),outcome:i%2===0?'Win':'Loss',rating:'A+',vshape:'V-shape',liqSwept:'swept',funded:false,time:'09:00',dir:'Bullish',sym:'NQ',ruleBreak:'None'}));
  profile = {name:'Test', account: 10000};
  LANG='en';
`);

console.log('--- ALL EDGE CASES COMPLETE ---');
