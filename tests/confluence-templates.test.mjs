import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

function runCase(name, setupCode, checks) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="tab-analytics"></div><div id="tab-dashboard"></div>
    <div id="acct-pill-wrap" style="display:none"></div><div class="hdr-l"></div>
    <div id="mob-bottom-nav"></div><div id="sb-nav"></div><div id="sidebar"></div>
    <div id="auth-screen" style="display:flex"></div><div id="main-app" style="display:none"></div>
    <div id="mo" style="display:none"></div><div id="mo-t"></div><div id="mo-b"></div>
  </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
  const { window } = dom;
  class FakeChart {
    constructor(ctx, config){ this.ctx=ctx; this.config=config; }
    destroy(){} static register(){} getDatasetMeta(){ return {data:[]}; }
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
      const openDivs=(out.match(/<div/g)||[]).length, closeDivs=(out.match(/<\\/div>/g)||[]).length;
      window.__testResult = {ok:true, html: out, divBalance: openDivs===closeDivs, openDivs, closeDivs};
    }catch(e){
      window.__testResult = {ok:false, error: e.message, stack: e.stack};
    }
  })();
  `;
  // This stub DOM doesn't have the full page structure init() expects (tab-new etc).
  // Suppress the app's own DOMContentLoaded->init() auto-wire so it doesn't fire
  // against the incomplete stub; the test drives renderAnalytics() directly instead.
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
  console.log(`[${name}] divBalance=${result.divBalance?'OK':'MISMATCH '+result.openDivs+'/'+result.closeDivs}`);
  if (checks) checks(result.html, name);
}

const baseTradesCode = `
  trades = [
    {id:1,dbId:'a',date:'2026-07-01',r:'1.5',outcome:'Win',rating:'A+',dir:'Bullish',time:'09:00',sym:'NQ',ruleBreak:'None',
      vshape:'V-shape',liqSwept:'swept',funded:false},
    {id:2,dbId:'b',date:'2026-07-02',r:'-1',outcome:'Loss',rating:'A',dir:'Bearish',time:'10:00',sym:'ES',ruleBreak:'None',
      vshape:'not V',liqSwept:'not swept',funded:true,
      customFields:{'Volume spike':'Yes','Retest confirmed':'No','Break type':'Clean break'}},
    {id:3,dbId:'c',date:'2026-07-03',r:'2',outcome:'Win',rating:'A-',dir:'Bullish',time:'11:00',sym:'GC',ruleBreak:'None',
      customFields:{'Volume spike':'No','Retest confirmed':'Yes','Break type':'Fake-out then real'}}
  ];
  profile = {name:'Test', account: 10000};
  LANG='en';
`;

// Case 1: only ICT active (default) — should see V-Shape + Liquidity Sweep, nothing custom
runCase('ICT only', `
  ${baseTradesCode}
  activeTemplates = ['ict'];
  customTemplates = [];
`, (html) => {
  console.log('  has V-Shape card:', html.includes('>V-Shape<'));
  console.log('  has Liquidity Sweep card:', html.includes('Liquidity Sweep'));
  console.log('  has Volume spike card (should be false, no custom template active):', html.includes('Volume spike'));
});

// Case 2: switch OFF ict, switch ON a custom "Breakout / Range" style template with toggle fields
runCase('Custom template only (Breakout/Range-style)', `
  ${baseTradesCode}
  customTemplates = [{id:'tmpl_bo',name:'Breakout / Range',fields:[
    {id:'f1',label:'Volume spike',type:'toggle'},
    {id:'f2',label:'Retest confirmed',type:'toggle'},
    {id:'f3',label:'Break type',type:'dropdown',options:['Clean break','Fake-out then real','Failed breakout']},
    {id:'f4',label:'Range high',type:'number'}
  ]}];
  activeTemplates = ['tmpl_bo'];
`, (html) => {
  console.log('  has V-Shape card (should be FALSE, ICT inactive):', html.includes('>V-Shape<'));
  console.log('  has Liquidity Sweep card (should be FALSE):', html.includes('Liquidity Sweep'));
  console.log('  has Volume spike card (should be TRUE):', html.includes('Volume spike'));
  console.log('  has Retest confirmed card (should be TRUE):', html.includes('Retest confirmed'));
  console.log('  has Break type card (should be TRUE, 3 options <=6):', html.includes('Break type'));
  console.log('  has Range high card (should be FALSE, type=number not confluence):', html.includes('Range high'));
  console.log('  has template attribution "— Breakout / Range":', html.includes('Breakout / Range'));
});

// Case 3: BOTH ICT and custom template simultaneously active
runCase('ICT + custom template both active', `
  ${baseTradesCode}
  customTemplates = [{id:'tmpl_bo',name:'Breakout / Range',fields:[
    {id:'f1',label:'Volume spike',type:'toggle'}
  ]}];
  activeTemplates = ['ict','tmpl_bo'];
`, (html) => {
  console.log('  has V-Shape card (should be TRUE):', html.includes('>V-Shape<'));
  console.log('  has Volume spike card (should be TRUE):', html.includes('Volume spike'));
});

// Case 4: custom template with only high-cardinality dropdown (should be excluded) and a rating field (excluded)
runCase('Template with no qualifying confluence fields', `
  ${baseTradesCode}
  customTemplates = [{id:'tmpl_x',name:'Weird Template',fields:[
    {id:'f1',label:'Instrument',type:'dropdown',options:['A','B','C','D','E','F','G','H']},
    {id:'f2',label:'Setup Quality',type:'rating'},
    {id:'f3',label:'Notes',type:'textarea'}
  ]}];
  activeTemplates = ['tmpl_x'];
`, (html) => {
  console.log('  has empty-state message (should be TRUE):', html.includes('no toggle or short-list confluence fields') || html.includes('Confluence Analysis'));
  console.log('  does NOT include high-cardinality Instrument dropdown as a card:', !html.includes('<span>Instrument<'));
});

console.log('--- ALL TEMPLATE SCENARIOS COMPLETE ---');
