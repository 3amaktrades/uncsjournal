import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tab-lb"></div>
</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
const { window } = dom;
window.Chart = class { constructor(){} destroy(){} static register(){} getDatasetMeta(){return{data:[]};} };
window.Chart.registry = { plugins: { get: () => null } };
window.supabase = { createClient: () => ({
  auth: { getSession: async()=>({data:{session:null}}), getUser: async()=>({data:{user:null}}) },
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}) }) }),
}) };

const shim = `(function(){var orig=document.addEventListener.bind(document);document.addEventListener=function(type,fn,opts){if(type==='DOMContentLoaded')return;orig(type,fn,opts);};})();`;

const payload = '<img src=x onerror="window.__xssFired=true">';
const testInvocation = `
;(function(){
  try{
    lbData = [
      {name: ${JSON.stringify(payload)}, trades:10, rSecured:5, winRate:0.6, wins:6, topRuleBreak:${JSON.stringify(payload)}, joinDate:'', updated:'Jul 1'}
    ];
    mentorUnlocked = true;
    lbSort='r';
    profile = null;
    renderLB();
    const html = document.getElementById('tab-lb').innerHTML;
    window.__testResult = {
      ok: true,
      rawPayloadLeaked: html.includes('<img src=x onerror'),
      escapedPayloadPresent: html.includes('&lt;img src=x onerror'),
    };
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
console.log('XSS actually fired:', window.__xssFired === true);
