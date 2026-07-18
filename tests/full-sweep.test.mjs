import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

// Use the REAL app.html body markup (extract it) so tab-switching and sidebar
// building has its actual DOM structure to work with, not a minimal stub.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
const bodyHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '') : '';

const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
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

const syms=['EURUSD','GBPUSD','NQ','ES','GC'];
const ratings=['A+','A','A-','B+'];
const testTrades=[];
for(let i=0;i<40;i++){
  const roll=Math.random();
  let r;
  if(roll<0.55) r=(Math.random()*2.5+0.3).toFixed(2);
  else if(roll<0.9) r=(-(Math.random()*1.5+0.3)).toFixed(2);
  else r='0';
  testTrades.push({
    id:i,dbId:'t'+i,date:'2026-0'+((i%9)+1)+'-0'+((i%9)+1),
    time:(8+i%8)+':00', sym:syms[i%5], dir:i%2===0?'Bullish':'Bearish',
    r, outcome:parseFloat(r)>0?'Win':parseFloat(r)<0?'Loss':'Breakeven',
    rating:ratings[i%4], vshape:i%3===0?'V-shape':'not V', liqSwept:i%2===0?'swept':'not swept',
    funded:i%4===0, ruleBreak:'None', accountId:null, pendingSync: i===0
  });
}

const testInvocation = `
;(function(){
  const results = {errors:[]};
  try{
    trades = ${JSON.stringify(testTrades)};
    profile = {name:'Test Trader', account: 25000};
    userAccounts = [ACCT_ALL];
    activeAccountId = 'all';

    const tabs = ['dashboard','log','new','analytics','weekly','calc','lb','import','templates'];
    const langs = ['en','ar'];
    for(const lang of langs){
      LANG = lang;
      document.documentElement.dir = lang==='ar' ? 'rtl' : 'ltr';
      for(const tb of tabs){
        try{
          showTab(tb);
        }catch(e){
          results.errors.push(lang+'/'+tb+': '+e.message);
        }
      }
    }
    // dark mode sweep too
    document.body.classList.add('dark');
    LANG='en'; document.documentElement.dir='ltr';
    for(const tb of tabs){
      try{ showTab(tb); }catch(e){ results.errors.push('dark/'+tb+': '+e.message); }
    }
    document.body.classList.remove('dark');

    results.finalAnalyticsLength = document.getElementById('tab-analytics').innerHTML.length;
    window.__testResult = {ok:true, results};
  }catch(e){
    window.__testResult = {ok:false, error: e.message, stack: e.stack};
  }
})();
`;

try {
  window.eval(fullScript + testInvocation);
} catch(e) {
  console.log('SCRIPT-LEVEL ERROR:', e.message);
  console.log(e.stack);
  process.exit(1);
}

console.log(JSON.stringify(window.__testResult, null, 2));
