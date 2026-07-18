import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('../app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const fullScript = scripts.join('\n;\n');

const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
const bodyHTML = bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '') : '';
const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/app.html' });
const { window } = dom;
const document = window.document;

window.Chart = class { constructor(){} destroy(){} static register(){} getDatasetMeta(){return{data:[]};} };
window.Chart.registry = { plugins: { get: () => null } };
window.supabase = { createClient: () => ({
  auth: { getSession: async()=>({data:{session:null}}), getUser: async()=>({data:{user:null}}), onAuthStateChange: ()=>{}, signOut: async()=>{} },
  // loadUserData() runs profiles.select().single() and trades.select().order() in
  // parallel via Promise.all — both need to resolve cleanly or it rejects.
  from: () => ({ select: () => ({ single: async()=>({data:null,error:null}), order: async()=>({data:[],error:null}) }) }),
}) };

// Sanity: no duplicate IDs anywhere in the real body markup
const idCounts = {};
[...document.querySelectorAll('[id]')].forEach(el => { idCounts[el.id] = (idCounts[el.id]||0)+1; });
const dupes = Object.entries(idCounts).filter(([,c]) => c > 1);

const testInvocation = `
;(function(){
  try{
    const results = {};
    results.duplicateIdsInInitialDOM = ${JSON.stringify(dupes)};

    // Simulate sign-in
    onSignedIn({email:'trader@test.com'});
    results.desktopAfterSignIn = document.getElementById('hdr-auth-btn').textContent;
    results.mobileAfterSignIn = document.getElementById('hdr-auth-btn-mobile').textContent;
    results.desktopAvatarDisplay = document.getElementById('hdr-av').style.display;
    results.mobileAvatarDisplay = document.getElementById('hdr-av-mobile').style.display;
    results.mobileAvatarText = document.getElementById('hdr-av-mobile').textContent;

    // Simulate sign-out
    onSignedOut();
    results.desktopAfterSignOut = document.getElementById('hdr-auth-btn').textContent;
    results.mobileAfterSignOut = document.getElementById('hdr-auth-btn-mobile').textContent;
    results.desktopAvatarDisplayAfterOut = document.getElementById('hdr-av').style.display;
    results.mobileAvatarDisplayAfterOut = document.getElementById('hdr-av-mobile').style.display;

    // Simulate updateUI() with a profile set (covers the general refresh path too)
    profile = {name:'Trader Joe', account:10000};
    updateUI();
    results.desktopAfterUpdateUI = document.getElementById('hdr-auth-btn').textContent;
    results.mobileAfterUpdateUI = document.getElementById('hdr-auth-btn-mobile').textContent;

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
  process.exit(1);
}
console.log(JSON.stringify(window.__testResult, null, 2));
