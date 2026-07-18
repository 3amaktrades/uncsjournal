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
  auth: { getSession: async()=>({data:{session:null}}), getUser: async()=>({data:{user:null}}), onAuthStateChange: ()=>{}, signOut: async()=>{}, updateUser: async()=>({error:null}) },
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}) }) }),
}) };

const testInvocation = `
;(function(){
  try{
    profile = {name:'Test', account:10000, risk:1};
    openSettings();
    const hasPwBtn = !!document.querySelector('button[onclick="showPasswordUpdateForm()"]');
    const modalTextBefore = document.getElementById('mo')?.textContent || document.body.innerHTML;
    // simulate clicking it
    showPasswordUpdateForm();
    const hasPwNew = !!document.getElementById('pw-new');
    const hasPwConfirm = !!document.getElementById('pw-confirm');
    const hasUpdateBtn = !!document.querySelector('button[onclick="doUpdatePassword()"]');
    window.__testResult = {ok:true, hasPwBtn, hasPwNew, hasPwConfirm, hasUpdateBtn};
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
