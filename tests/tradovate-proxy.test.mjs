import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async(url,options={})=>{
  const target=String(url);calls.push({target,options});
  if(target.includes('supabase.co/auth/v1/user'))return Response.json({id:'journal-user'});
  if(target.endsWith('/auth/accesstokenrequest'))return Response.json({accessToken:'tv-token',expirationTime:'2026-09-26T20:00:00Z'});
  if(target.endsWith('/account/list'))return Response.json([{id:7,name:'DEMO',active:true}]);
  if(target.endsWith('/fill/list'))return Response.json([{id:31,orderId:21,contractId:10,timestamp:'2026-09-25T14:30:00Z',action:'Buy',qty:1,price:20000}]);
  if(target.includes('/contract/items?'))return Response.json([{id:10,name:'MNQZ6'}]);
  if(target.includes('/order/items?'))return Response.json([{id:21,accountId:7}]);
  throw new Error('Unexpected fetch '+target);
};

try{
  const headers={'Content-Type':'application/json','Authorization':'Bearer journal-token','Origin':'https://uncsjournal.com'};
  const authReq=new Request('https://uncsjournal.com/api/tradovate/auth',{method:'POST',headers,body:JSON.stringify({environment:'demo',username:'trader',password:'password',cid:8,secret:'api-secret',deviceId:'device-1'})});
  const authRes=await worker.fetch(authReq,{ASSETS:{fetch(){throw new Error('asset fallback should not run')}}});
  assert.equal(authRes.status,200);assert.equal((await authRes.json()).accessToken,'tv-token');
  const tokenCall=calls.find(call=>call.target.endsWith('/auth/accesstokenrequest'));
  const payload=JSON.parse(tokenCall.options.body);
  assert.equal(tokenCall.target,'https://demo.tradovateapi.com/v1/auth/accesstokenrequest');
  assert.deepEqual({name:payload.name,appId:payload.appId,appVersion:payload.appVersion,cid:payload.cid,deviceId:payload.deviceId},{name:'trader',appId:'UncsJournal',appVersion:'1.0',cid:8,deviceId:'device-1'});

  const syncReq=new Request('https://uncsjournal.com/api/tradovate/sync',{method:'POST',headers,body:JSON.stringify({environment:'demo',tradovateToken:'tv-token'})});
  const syncRes=await worker.fetch(syncReq,{ASSETS:{fetch(){throw new Error('asset fallback should not run')}}});
  const sync=await syncRes.json();assert.equal(syncRes.status,200);assert.equal(sync.contracts[0].name,'MNQZ6');assert.equal(sync.orders[0].accountId,7);
  console.log('PASS Tradovate proxy authenticates journal users and uses official API domains');
}finally{globalThis.fetch=originalFetch;}
