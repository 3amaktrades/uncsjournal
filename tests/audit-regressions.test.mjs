import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

const html=fs.readFileSync('../app.html','utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
const body=html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
function setup(storage={}){
  const dom=new JSDOM(body,{runScripts:'outside-only',url:'https://journal.test/app',virtualConsole:new VirtualConsole()});
  const w=dom.window;w.setTimeout=()=>0;w.setInterval=()=>0;
  Object.entries(storage).forEach(([key,value])=>w.localStorage.setItem(key,JSON.stringify(value)));
  const add=w.document.addEventListener.bind(w.document);
  w.document.addEventListener=(name,fn,opts)=>{if(name!=='DOMContentLoaded')add(name,fn,opts)};
  w.Chart=class {constructor(){} destroy(){} static register(){} getDatasetMeta(){return {data:[]}}};
  w.Chart.registry={plugins:{get:()=>null}};
  const calls=[];
  let handler=({table,op,row})=>({data:op==='select'?(table==='profiles'?{name:'Test',account_size:10000}:[]):{id:'db-1',...row},error:null});
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'A'}}}}),getUser:async()=>({data:{user:{id:'A'}}}),onAuthStateChange:()=>{},signOut:async()=>({}),updateUser:async(value)=>{calls.push({table:'auth',op:'updateUser',row:value});return {data:{},error:null}}},
    from(table){
      let op='select',row;const filters=[];
      const q={select(){return q},single(){return q},order(){return q},limit(){return q},
        eq(key,value){filters.push([key,value]);return q},
        upsert(value){op='upsert';row=value;return q},update(value){op='update';row=value;return q},delete(){op='delete';return q},
        then(resolve,reject){const call={table,op,row,filters};calls.push(call);return Promise.resolve().then(()=>handler(call)).then(resolve,reject)}};
      return q;
    }};
  w.supabase={createClient:()=>client};
  w.eval(scripts+'\n;window.api={buildEditRow,renderForm,renderTemplates,openEditTemplate,renderAnalytics,renderLog,tradeOutcome,buildTradovateTrades,aiHTML,tradeToDb,dbToTrade,loadUserData,saveTradeDB,saveTrade,validateRequiredTemplateFields,savePendingCache,loadPendingCache,syncPendingTrade,updateTradeDB,saveEditedTrade,deleteTrade,saveProfileDB,saveWeekDB,postLBDB,makeTradeCSV,parseCSV,renderCSVStep3,renderCSVStep4,doCSVImport,renderAcctDropdown,openAcctModal,restoreTemplates,saveTemplates,generateMonthlySummary,showAuthModal,showResetModal,amTab,doSignIn,sendResetLink,shareTrade,downloadShareCard,downloadStoryCard,readUserJSON,writeUserJSON,saveSettings,doSignOut,showWelcomeScreen,updateWelcomeSlide,chooseWelcomeTemplate,'+
    'setState(x){if("session" in x)currentSession=x.session;if("trades" in x)trades=x.trades;if("profile" in x)profile=x.profile;if("accounts" in x)userAccounts=x.accounts;if("templates" in x)customTemplates=x.templates;if("active" in x)activeTemplates=x.active;if("csvData" in x)csvData=x.csvData;if("csvMap" in x)csvMap=x.csvMap;if("csvPlatform" in x)csvPlatform=x.csvPlatform;if("summaries" in x)weekSummaries=x.summaries;currentTab="new";},'+
    'state(){return {trades,profile,customTemplates,activeTemplates,weekSummaries,csvPreview,currentSession};},setAI(fn){callAI=fn;}};');
  const api=w.api;
  api.setState({session:{user:{id:'A'}},profile:{name:'Test',account:10000},accounts:[]});
  return {dom,w,api,client,calls,setHandler(fn){handler=fn},close(){dom.window.close()}};
}
const rich={id:'client-1',dbId:'db-1',ownerId:'A',sym:'NQ',date:'2026-09-01',time:'10:00',r:'0',stop:'20',maxRR:'3',mae:'0.5',
  news:'CPI',thoughts:'Wait',why:'Chased',postNotes:'Review',outcome:'Breakeven',valTF:'15m',customFields:{setup:'breakout'},
  entryDOL:['PDH'],exitDOL:['PDL'],ltf:['1min'],htf:['4H'],of:['Bullish'],funded:true,challenge:true,metPlan:true,followedPlan:true,aiAnalysis:{grade:'A'},accountId:'acct-A'};
const tests=[];
function test(name,fn){tests.push([name,fn])}
test('Tradovate connection stays hidden until the integration is resumed',()=>{
  assert.match(html,/#itab-tv,#import-tv-sec\{display:none!important\}/);
});
test('new-account onboarding offers and activates a template choice',({api,w})=>{
  api.setState({templates:[],active:['ict'],session:{user:{id:'A',user_metadata:{template_onboarding_pending:true}}}});
  api.showWelcomeScreen('New Trader',true);
  assert.match(w.document.getElementById('welcome-overlay').textContent,/Choose your trading template/);
  api.chooseWelcomeTemplate('bo');
  const state=api.state();
  assert.equal(state.customTemplates.length,1);
  assert.equal(state.customTemplates[0].name,'Breakout / Range');
  assert.deepEqual([...state.activeTemplates],[state.customTemplates[0].id]);
  assert.match(w.document.getElementById('tab-new').textContent,/Breakout level/);
});
test('chosen signup template restores on another device',async({api,w,calls,setHandler})=>{
  const template={id:'tmpl_breakout',name:'Breakout / Range',fields:[]};
  api.setState({templates:[],active:['ict'],session:{user:{id:'A',user_metadata:{active_templates:[template.id]}}}});
  setHandler(({table,op})=>({data:op==='select'?(table==='profiles'?{name:'Test',custom_templates:[template]}:[]):{},error:null}));
  await api.loadUserData();
  assert.equal(api.state().customTemplates[0].id,template.id);
  assert.deepEqual([...api.state().activeTemplates],[template.id]);
  api.chooseWelcomeTemplate('ict');
  assert.ok(calls.some(c=>c.table==='auth'&&c.op==='updateUser'&&c.row.data.active_templates[0]==='ict'));
});
test('required template fields block an incomplete first trade',async({api,w,calls})=>{
  api.chooseWelcomeTemplate('bo');
  w.document.getElementById('f-date').value='2026-09-27';
  w.document.getElementById('f-r').value='1';
  await api.saveTrade();
  assert.equal(api.state().trades.length,0);
  assert.match(w.document.getElementById('toast').textContent,/Breakout level/);
  const fields=api.state().customTemplates[0].fields;
  w.document.getElementById('cf-'+fields.find(f=>f.label==='Breakout level').id).value='21500';
  w.document.getElementById('cf-'+fields.find(f=>f.label==='Break type').id).value='Clean break';
  assert.equal(api.validateRequiredTemplateFields(),true);
});
test('strategy selector switches to only the chosen template',({api,w})=>{
  api.setState({templates:[{id:'tmpl_zone',name:'Zones',fields:[{id:'field1',label:'Zone',type:'text'}]}],active:['ict']});
  api.renderForm();
  const selector=w.document.getElementById('tmpl-select');
  selector.value='tmpl_zone';selector.dispatchEvent(new w.Event('change'));
  assert.deepEqual([...api.state().activeTemplates],['tmpl_zone']);
  assert.match(w.document.getElementById('tab-new').textContent,/Zone/);
  assert.doesNotMatch(w.document.getElementById('tab-new').textContent,/ICT CONFLUENCES/);
});
test('custom template text stays text in the selector, form, list and builder',({api,w})=>{
  const attack='<img id="template-injected" src=x>';
  const template={id:'tmpl_attack',name:attack,strategy:attack,icon:'🎯',fields:[{id:'field_attack',label:attack,type:'dropdown',placeholder:attack,options:[attack]}]};
  api.setState({templates:[template],active:[template.id]});
  api.renderForm();api.renderTemplates();api.openEditTemplate(template.id);
  assert.equal(w.document.getElementById('template-injected'),null);
  assert.match(w.document.getElementById('tab-templates').textContent,/<img id="template-injected"/);
});
test('AI trade analysis escapes model output and tolerates malformed lists',({api})=>{
  const rendered=api.aiHTML({grade:'<img src=x>',summary:'<script>bad()</script>',strengths:['<b>unsafe</b>'],improvements:'not-an-array',psychology:'<svg onload=bad()>',pattern:'<i>x</i>',verdict:'<a href=x>go</a>'});
  assert.doesNotMatch(rendered,/<script>|<img|<svg|<b>|<i>|<a /);
  assert.match(rendered,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered,/not-an-array/);
});
test('dashboard coach messages are never assigned as HTML',()=>{
  assert.doesNotMatch(html,/innerHTML=dashAIMsg/);
  assert.match(html,/dashAIMsg\?esc\(dashAIMsg\)/);
  assert.match(html,/el2\.textContent=dashAIMsg/);
});
test('trade log escapes imported and stored display values',({api,w})=>{
  const payload='<img src=x onerror=bad()>';
  api.setState({trades:[{...rich,id:'bad\' onclick=bad()',date:payload,sym:payload,dir:payload,r:'1',rating:payload,smt:'Bearish SMT',smtVs:payload,entryDOL:[payload],of:[payload],preState:payload,ruleBreak:payload}]});
  api.renderLog();
  const rendered=w.document.getElementById('tab-log').innerHTML;
  assert.doesNotMatch(rendered,/<img|onclick=bad/);
  assert.match(rendered,/&lt;img src=x onerror=bad\(\)&gt;/);
});
test('editor preserves legacy dropdowns, zero values and SMT correlation',async({api,w,calls})=>{
  const trade={...rich,r:0,rating:'A-',news:'News done',ruleBreak:'Sized down',liqSwept:'swept',vshape:'V-shape',valTF:'1min',smt:'Bearish SMT',smtVs:'ES'};
  api.setState({trades:[trade]});
  w.document.getElementById('tab-log').innerHTML='<table><tbody>'+api.buildEditRow(trade,'db-1')+'</tbody></table>';
  for(const [id,value] of Object.entries({'ed-r':'0','ed-rating':'A-','ed-news':'News done','ed-ruleBreak':'Sized down','ed-liqSwept':'swept','ed-vshape':'V-shape','ed-valTF':'1min'}))assert.equal(w.document.getElementById(id).value,value,id);
  await api.saveEditedTrade('db-1');
  assert.equal(calls.find(c=>c.op==='update').row.smt_vs,'ES');
});
test('editing retains imported symbols and updates saved strategy fields',async({api,w,calls})=>{
  const trade={...rich,sym:'CUSTOM-INDEX',customFields:{Zone:'Supply',Factors:['VWAP','News']}};
  api.setState({trades:[trade]});
  w.document.getElementById('tab-log').innerHTML='<table><tbody>'+api.buildEditRow(trade,'db-1')+'</tbody></table>';
  assert.equal(w.document.getElementById('ed-sym').value,'CUSTOM-INDEX');
  const zone=w.document.querySelector('[data-edit-custom-key="Zone"]');
  const factors=w.document.querySelector('[data-edit-custom-key="Factors"]');
  assert.equal(zone.value,'Supply');
  zone.value='Demand';factors.value='VWAP, EMA';
  await api.saveEditedTrade('db-1');
  const row=calls.find(c=>c.op==='update').row;
  assert.equal(row.sym,'CUSTOM-INDEX');
  assert.equal(row.custom_fields.Zone,'Demand');
  assert.deepEqual([...row.custom_fields.Factors],['VWAP','EMA']);
});
test('streak reflects the latest loss or breakeven rather than an earlier win',({api,w})=>{
  for(const [last,expected] of [['-1','-1'],['0','\u2014']]){
    api.setState({trades:[{...rich,date:'2026-09-01',r:'2'},{...rich,date:'2026-09-02',r:last}]});
    api.renderAnalytics();
    const label=[...w.document.querySelectorAll('#tab-analytics div')].find(e=>e.textContent==='Current Streak');
    assert.equal(label.previousElementSibling.textContent,expected);
  }
});
test('missing results are distinct from numeric breakevens',({api})=>{
  for(const r of ['',null,undefined,'invalid'])assert.equal(api.tradeOutcome({r,outcome:'Breakeven'}),'Missing R');
  for(const r of [0,'0'])assert.equal(api.tradeOutcome({r}),'Breakeven');
});
test('Tradovate fills reconstruct supported closed trades with real symbols and P&L',({api})=>{
  const result=api.buildTradovateTrades({
    contracts:[{id:10,name:'MNQZ6'}],orders:[{id:21,accountId:7},{id:22,accountId:7}],
    fills:[
      {id:31,orderId:21,contractId:10,timestamp:'2026-09-25T14:30:00Z',action:'Buy',qty:2,price:20000},
      {id:32,orderId:22,contractId:10,timestamp:'2026-09-25T15:00:00Z',action:'Sell',qty:2,price:20010}
    ]
  },100,7);
  assert.equal(result.trades.length,1);assert.equal(result.trades[0].sym,'MNQ');
  assert.equal(result.trades[0].pnl,40);assert.equal(result.trades[0].r,'0.40');
  assert.equal(result.trades[0].dir,'Bullish');assert.equal(result.trades[0].qty,2);
});
test('zero and every saved field survive the real reload path',async({api,setHandler})=>{
  const row=api.tradeToDb(rich);assert.equal(row.r_result,0);
  setHandler(({table})=>({data:table==='profiles'?{name:'Test'}:[{id:'db-1',user_id:'A',...row}],error:null}));
  await api.loadUserData();const loaded=api.state().trades[0];
  for(const key of ['r','stop','maxRR','mae','news','thoughts','why','postNotes','outcome','valTF','accountId'])
    assert.equal(loaded[key],rich[key],key);
  assert.equal(JSON.stringify(loaded.customFields),JSON.stringify(rich.customFields));
});
test('partial trade edits preserve flags, confluences and AI analysis',async({api,calls})=>{
  api.setState({trades:[rich]});await api.updateTradeDB('db-1',{notes:'Changed note'});
  const row=calls.at(-1).row;
  for(const key of ['funded','challenge','met_plan','followed_plan']) assert.equal(row[key],true,key);
  for(const key of ['entry_dol','exit_dol','ltf','htf','order_flow']) assert.ok(row[key].length,key);
  assert.equal(row.ai_analysis.grade,'A');assert.equal(row.notes,'Changed note');assert.equal(row.r_result,0);
});
test('pending trades are isolated by user, including the legacy cache',async({api,w,calls})=>{
  api.setState({trades:[{...rich,dbId:undefined,pendingSync:true}]});api.savePendingCache();
  w.localStorage.setItem('utf_pending_trades',JSON.stringify([{id:'legacy',r:1,pendingSync:true}]));
  api.setState({session:{user:{id:'B'}},trades:[]});
  assert.equal(api.loadPendingCache().length,0);await api.loadUserData();
  assert.equal(calls.filter(c=>c.op==='upsert').length,0);
  api.setState({session:{user:{id:'A'}}});assert.equal(api.loadPendingCache().length,1);
});
test('late sync response cannot overwrite another user state',async({api,setHandler})=>{
  let finish;const response=new Promise(r=>finish=r);
  setHandler(()=>response);
  const pending={...rich,dbId:undefined,pendingSync:true};
  api.setState({trades:[pending]});api.savePendingCache();
  const syncing=api.syncPendingTrade(pending);await Promise.resolve();await Promise.resolve();
  api.setState({session:{user:{id:'B'}},trades:[{id:'B-only'}]});
  finish({data:{id:'db-1'},error:null});await syncing;
  assert.equal(api.state().trades[0].id,'B-only');
});
test('edits during an in-flight save are retried instead of discarded',async({api,setHandler,calls})=>{
  let finish;let first=true;
  setHandler(({row})=>{if(first){first=false;return new Promise(r=>finish=r)}return {data:{id:'db-1',...row},error:null}});
  const pending={...rich,dbId:undefined,pendingSync:true,notes:'old'};
  api.setState({trades:[pending]});const syncing=api.syncPendingTrade(pending);
  await Promise.resolve();await Promise.resolve();
  api.setState({trades:[{...pending,notes:'new'}]});
  finish({data:{id:'db-1'},error:null});await syncing;
  assert.equal(api.state().trades[0].notes,'new');assert.equal(api.state().trades[0].pendingSync,false);
  assert.equal(calls.at(-1).row.notes,'new');assert.equal(calls.length,2);
});
test('failed deletes and rejected profile/leaderboard writes cannot claim success',async({api,setHandler,w})=>{
  setHandler(()=>({data:null,error:{message:'database rejected write'}}));
  api.setState({trades:[rich]});await api.deleteTrade('db-1');
  assert.equal(api.state().trades.length,1);
  assert.match(w.document.getElementById('toast').textContent,/Could not delete/);
  await assert.rejects(api.saveProfileDB({name:'Test'}),e=>/database rejected/.test(e.message));
  await assert.rejects(api.saveWeekDB('2026-09-01',{}),e=>/database rejected/.test(e.message));
  await api.postLBDB();assert.match(w.document.getElementById('toast').textContent,/Could not post/);
});
test('CSV imports use exactly the previewed R and custom direction',async({api,w,calls})=>{
  api.setState({csvPlatform:'custom',csvData:{headers:['date','pnl','side'],rows:[{date:'2026-09-01',pnl:'250',side:'UP'}]},csvMap:{date:'date',pnl:'pnl',dir:'side'}});
  w.document.getElementById('tab-import').innerHTML='<div id="import-step-content"></div>';
  api.renderCSVStep3();w.document.getElementById('csv-risk-dollar').value='250';w.document.getElementById('csv-dir-bull').value='UP';
  api.renderCSVStep4();assert.equal(api.state().csvPreview[0].r,'1.00');
  await api.doCSVImport();const row=calls.find(c=>c.table==='trades'&&c.op==='upsert').row;
  assert.equal(row.r_result,1);assert.equal(row.direction,'Bullish');
});
test('CSV import only saves selected rows beyond the first 100',async({api,w,calls})=>{
  const rows=Array.from({length:101},(_,i)=>({date:'2026-09-01',pnl:String(i+1)}));
  api.setState({csvPlatform:'custom',csvData:{headers:['date','pnl'],rows},csvMap:{date:'date',pnl:'pnl'}});
  w.document.getElementById('tab-import').innerHTML='<div id="import-step-content"></div>';
  api.renderCSVStep3();api.renderCSVStep4();
  const checkboxes=[...w.document.querySelectorAll('[id^="csv-chk-"]')];
  assert.equal(checkboxes.length,101);
  checkboxes.forEach(cb=>{cb.checked=false;});
  w.document.getElementById('csv-chk-100').checked=true;
  await api.doCSVImport();
  assert.equal(calls.filter(c=>c.table==='trades'&&c.op==='upsert').length,1);
});
test('CSV multiline notes, escaped quotes, commas and zero round-trip',({api})=>{
  const csv=api.makeTradeCSV([{...rich,notes:'one, "quoted"\r\nsecond line',r:0,pnl:0}]);
  const parsed=api.parseCSV(csv);assert.equal(parsed.rows.length,1);
  const row=parsed.rows[0];assert.equal(row.Notes,'one, "quoted"\r\nsecond line');assert.equal(row['R Result'],'0');assert.equal(row.PnL,'0');
  assert.equal(row['Order Flow'],'Bullish');assert.equal(row['Rule Breaks'],''); // absent input stays empty
  assert.equal(row.Psychology,'Wait');assert.equal(row['Post-trade Reflection'],'Review');assert.equal(row['AI Grade'],'A');
  assert.throws(()=>api.parseCSV('a,b\n"unfinished'),/unclosed/);
});
test('CSV headers and account attributes remain text, not HTML',({api,w})=>{
  const attack='</option></select><img id="injected" src=x onerror="alert(1)"><select><option>';
  api.setState({csvPlatform:'custom',csvData:{headers:[attack],rows:[{}]},accounts:[{id:'safe-id',name:'<img id="injected" src=x>',firm:'"><img id="injected">',color:'#fff'}]});
  w.document.getElementById('tab-import').innerHTML='<div id="import-step-content"></div>';api.renderCSVStep3();
  api.renderAcctDropdown();api.openAcctModal({id:'safe-id',name:'"><img id="injected">',firm:'"><img id="injected">',color:'#fff'});
  assert.equal(w.document.querySelector('#injected'),null);
  assert.match(w.document.getElementById('acct-mo-name').value,/<img/);
});
test('templates restore after refresh and do not cross accounts',async({api,w})=>{
  api.setState({templates:[{id:'test',name:'Test',fields:[]}],active:['test']});api.saveTemplates();
  await Promise.resolve();await Promise.resolve();
  api.setState({templates:[],active:['ict']});api.restoreTemplates();
  assert.equal(api.state().customTemplates[0].id,'test');assert.equal(api.state().activeTemplates[0],'test');
  const next=setup(Object.fromEntries(Object.entries(w.localStorage).map(([key,value])=>[key,JSON.parse(value)])));
  try{next.api.restoreTemplates();assert.equal(next.api.state().customTemplates[0].id,'test')}finally{next.close()}
  api.setState({session:{user:{id:'B'}}});api.restoreTemplates();assert.equal(api.state().customTemplates.length,0);
});
test('monthly coaching persists across reload and is scoped to its author',async({api})=>{
  api.setState({trades:[{...rich,date:new Date().toISOString().slice(0,10)}]});
  api.setAI(async()=>({content:[{text:JSON.stringify({grade:'A',headline:'Test',strengths:[],improvements:[]})}]}));
  await api.generateMonthlySummary();
  assert.equal(Object.keys(api.readUserJSON('utf_monthly_reports',{})).length,1);
  api.setState({summaries:{}});await api.loadUserData();
  assert.equal(Object.keys(api.state().weekSummaries).length,1);
  api.setState({session:{user:{id:'B'}}});await api.loadUserData();assert.equal(Object.keys(api.state().weekSummaries).length,0);
});
test('recovery navigation is visible, tabs are wired, network rejection unlocks sign-in',async({api,w,client})=>{
  api.showAuthModal();assert.equal(w.document.getElementById('am-tab-in').getAttribute('onclick'),"amTab('in')");
  api.amTab('up');api.amTab('in');assert.equal(w.document.getElementById('am-in').style.display,'block');
  api.showResetModal();assert.ok(w.document.getElementById('am-reset-email'));assert.equal(w.document.getElementById('mo').style.display,'flex');
  client.auth.signInWithPassword=async()=>{throw new Error('Network down')};
  w.document.getElementById('in-email').value='test@example.invalid';w.document.getElementById('in-pass').value='dummy';
  await api.doSignIn();assert.equal(w.document.getElementById('in-btn').disabled,false);
  assert.match(w.document.getElementById('auth-err').textContent,/Network down/);
});
test('media policy allows recordings and broker traffic stays same-origin',()=>{
  const headers=fs.readFileSync('../_headers','utf8');
  assert.match(headers,/media-src 'self' data: blob:/);
  const connect=headers.match(/connect-src ([^;]+)/)[1];
  for(const host of ['https://live.tradovate.com','https://demo.tradovate.com','https://live.tradovateapi.com','https://demo.tradovateapi.com']) assert.ok(!connect.split(' ').includes(host));
  assert.ok(!connect.includes('*'));assert.match(headers,/frame-ancestors 'none'/);
});
test('share downloads have a bundled renderer and use its canvas',async({api,w})=>{
  assert.match(html,/src="\/assets\/vendor\/html2canvas-1\.4\.1\.min\.js"/);
  assert.ok(fs.statSync('../assets/vendor/html2canvas-1.4.1.min.js').size>100000);
  let called=false;w.document.fonts={ready:Promise.resolve()};
  w.html2canvas=async()=>{called=true;return {toDataURL:()=> 'data:image/png;base64,AA=='}};
  await api.shareTrade(rich);await api.downloadShareCard();assert.equal(called,true);
  assert.match(w.document.getElementById('toast').textContent,/Card downloaded/);
});
let failures=0;
for(const [name,fn] of tests){
  const context=setup();
  try{await fn(context);console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+'\n'+e.stack)}finally{context.close()}
}
assert.equal(failures,0,failures+' audit regression(s) failed');
