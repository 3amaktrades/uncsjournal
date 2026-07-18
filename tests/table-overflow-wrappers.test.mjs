import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
const bodyHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '') : '';
const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
const { window } = dom;

window.Chart = class { constructor(){} destroy(){} static register(){} getDatasetMeta(){return{data:[]};} };
window.Chart.registry = { plugins: { get: () => null } };
window.supabase = { createClient: () => ({
  auth: { getSession: async()=>({data:{session:null}}), getUser: async()=>({data:{user:null}}), onAuthStateChange: ()=>{}, signOut: async()=>{} },
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}), order: ()=>({}) }), upsert: async()=>({data:null,error:null}) }),
}) };

const syms=['EURUSD','GBPUSD','NQ','ES','GC'];
const ratings=['A+','A','A-','B+'];
const testTrades=[];
for(let i=0;i<30;i++){
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
    funded:i%4===0, ruleBreak:i%7===0?'FOMO entry':'None', accountId:null
  });
}

const testInvocation = `
;(function(){
  try{
    trades = ${JSON.stringify(testTrades)};
    profile = {name:'Test Trader', account: 25000};
    userAccounts = [ACCT_ALL];
    activeAccountId = 'all';
    LANG='en';

    renderAnalytics();
    const analyticsHTML = document.getElementById('tab-analytics').innerHTML;
    // find every <table and check it is wrapped by an ancestor div with overflow-x:auto
    const dom2 = document;
    const tables = dom2.getElementById('tab-analytics').querySelectorAll('table');
    const tableWrapCheck = [...tables].map(tbl => {
      let p = tbl.parentElement;
      let wrapped = false;
      while(p && p.id !== 'tab-analytics'){
        if(p.style && p.style.overflowX === 'auto'){ wrapped = true; break; }
        p = p.parentElement;
      }
      return wrapped;
    });

    renderWeekly();
    const weeklyHTML = document.getElementById('tab-weekly').innerHTML;
    const weeklyTables = document.getElementById('tab-weekly').querySelectorAll('table');
    const weeklyWrapCheck = [...weeklyTables].map(tbl => {
      let p = tbl.parentElement;
      let wrapped = false;
      while(p && p.id !== 'tab-weekly'){
        if(p.style && p.style.overflowX === 'auto'){ wrapped = true; break; }
        p = p.parentElement;
      }
      return wrapped;
    });

    window.__testResult = {
      ok:true,
      analyticsTableCount: tables.length,
      analyticsAllWrapped: tableWrapCheck.every(Boolean),
      analyticsWrapDetail: tableWrapCheck,
      weeklyTableCount: weeklyTables.length,
      weeklyAllWrapped: weeklyWrapCheck.every(Boolean),
    };
  }catch(e){
    window.__testResult = {ok:false, error: e.message, stack: e.stack};
  }
})();
`;

try {
  window.eval(fullScript + testInvocation);
} catch(e) {
  console.log('SCRIPT-LEVEL ERROR:', e.message);
  process.exit(1);
}
console.log(JSON.stringify(window.__testResult, null, 2));
