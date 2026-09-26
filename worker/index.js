const SUPABASE_URL='https://qfqssedstzdgwkhhlzrn.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcXNzZWRzdHpkZ3draGhsenJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwOTE0OTIsImV4cCI6MjA5NTY2NzQ5Mn0.zsEe1Eh-iGztPIC6btPIsNajpUpxBKnhqDeCibZHWww';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const baseFor=environment=>environment==='live'?'https://live.tradovateapi.com/v1':'https://demo.tradovateapi.com/v1';

async function requireJournalUser(request){
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer ')) throw Object.assign(new Error('Journal sign-in required'),{status:401});
  const response=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:SUPABASE_ANON_KEY}});
  if(!response.ok) throw Object.assign(new Error('Journal session expired'),{status:401});
  return response.json();
}

async function tradovateFetch(base,path,token,options={}){
  const response=await fetch(base+path,{...options,headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({errorText:'Tradovate returned an unreadable response'}));
  if(!response.ok||data?.errorText) throw Object.assign(new Error(data?.errorText||('Tradovate HTTP '+response.status)),{status:response.status>=400&&response.status<500?response.status:502,details:data});
  return data;
}

async function fetchItems(base,path,ids,token){
  const chunks=[];
  for(let index=0;index<ids.length;index+=100)chunks.push(ids.slice(index,index+100));
  return (await Promise.all(chunks.map(chunk=>tradovateFetch(base,path+'?ids='+chunk.join(','),token)))).flat();
}

async function handleTradovate(request){
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin) return json({error:'Cross-origin request blocked'},403);
  await requireJournalUser(request);
  const body=await request.json().catch(()=>({}));
  const environment=body.environment==='live'?'live':'demo';
  const base=baseFor(environment);
  const path=new URL(request.url).pathname;

  if(path==='/api/tradovate/auth'){
    if(!body.username||!body.password||!Number.isInteger(Number(body.cid))||!body.secret) return json({error:'Username, password, CID and API secret are required'},400);
    const auth=await tradovateFetch(base,'/auth/accesstokenrequest',null,{method:'POST',body:JSON.stringify({
      name:String(body.username),password:String(body.password),appId:'UncsJournal',appVersion:'1.0',
      cid:Number(body.cid),sec:String(body.secret),deviceId:String(body.deviceId||'uncsjournal-web').slice(0,64)
    })});
    const accounts=await tradovateFetch(base,'/account/list',auth.accessToken);
    return json({accessToken:auth.accessToken,expirationTime:auth.expirationTime,accounts});
  }

  if(path==='/api/tradovate/sync'){
    if(!body.tradovateToken) return json({error:'Tradovate connection required'},401);
    const token=String(body.tradovateToken);
    const [accounts,allFills]=await Promise.all([
      tradovateFetch(base,'/account/list',token),tradovateFetch(base,'/fill/list',token)
    ]);
    // Keep the complete fill history so an entry is never discarded while its
    // later closing fill remains. Contract and order lookups are batched below.
    const fills=[...(allFills||[])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
    const contractIds=[...new Set((fills||[]).map(fill=>fill.contractId).filter(Boolean))];
    const orderIds=[...new Set((fills||[]).map(fill=>fill.orderId).filter(Boolean))];
    const [contracts,orders]=await Promise.all([
      contractIds.length?fetchItems(base,'/contract/items',contractIds,token):[],
      orderIds.length?fetchItems(base,'/order/items',orderIds,token):[]
    ]);
    return json({accounts,fills,contracts,orders});
  }
  return json({error:'Not found'},404);
}

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    try{
      if(path.startsWith('/api/tradovate/')) return await handleTradovate(request);
      return env.ASSETS.fetch(request);
    }catch(error){
      return json({error:error.message,details:error.details||undefined},error.status||500);
    }
  }
};
