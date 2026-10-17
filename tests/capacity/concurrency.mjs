import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
const source=fs.readFileSync(new URL('../../api/send-email.js',import.meta.url),'utf8');
const scope=new AsyncLocalStorage();let reads=0,active=0,maxActive=0,writeAttempts=0;
const context=vm.createContext({createHash,URL,URLSearchParams,Date,Intl,AbortSignal,performance,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'local-fixture-only'}},console:{error(...a){throw Error(a.map(String).join(' '));},log(){},warn(){}},fetch:async(raw,opts={})=>{
 const tenant=scope.getStore();assert.ok(tenant>=1&&tenant<=100);
 if(String(opts.method||'GET').toUpperCase()!=='GET'){writeAttempts++;throw Error('External write forbidden in local test');}
 const u=new URL(raw);assert.equal(u.hostname,'decpnnbaejxjbpmyjocs.supabase.co');
 active++;maxActive=Math.max(maxActive,active);reads++;
 await new Promise(r=>setTimeout(r,10+(tenant%5)));
 let data;
 const table=u.pathname.split('/').at(-1);
 if(table==='restaurants'){
  assert.equal(u.searchParams.get('slug'),`eq.fixture-${tenant}`);
  data=[{id:tenant,name:`Fixture ${tenant}`,slug:`fixture-${tenant}`,is_published:true}];
 }else{
  assert.equal(u.searchParams.get('restaurant_id'),`eq.${tenant}`,'Cross-tenant service query');
  switch(table){
   case 'reservation_settings':data=[{restaurant_id:tenant,min_people:1,max_people:20,duration_1_2:90,duration_3_4:120,duration_5_6:150,duration_7_plus:180,min_advance_minutes:0,max_advance_days:90}];break;
   case 'opening_hours':data=[{is_open:true,open_time:'10:00',close_time:'22:00'}];break;
   case 'restaurant_tables':data=Array.from({length:20},(_,i)=>({id:tenant*100+i,name:`Tenant ${tenant} table ${i}`,capacity:4,active:true}));break;
   case 'reservations':data=[];break;
   case 'blocked_times':data=tenant%2?[{start_time:'10:00',end_time:'14:00',reason:'Fixture'}]:[];break;
   case 'table_groups':data=[];break;
   default:throw Error('Unexpected external request '+table);
  }
 }
 active--;return {ok:true,status:200,text:async()=>JSON.stringify(data)};
}});
vm.runInContext(source.replace('import { createHash } from "node:crypto";','').replace('export default async function handler','async function handler')+'\nthis.testHandler=handler;',context);
const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const elapsed=[];let requests=0;
const started=performance.now();
for(let wave=0;wave<10;wave++)await Promise.all(Array.from({length:100},(_,i)=>scope.run(i+1,async()=>{
 const tenant=i+1,start=performance.now();let status=200,body;
 const res={setHeader(){},status(n){status=n;return this;},json(v){body=v;return this;}};
 await context.testHandler({method:'POST',headers:{},body:{action:'available-times',slug:`fixture-${tenant}`,restaurant_id:tenant===100?1:tenant+1,date,people:2}},res);
 assert.equal(status,200);assert.equal(body.success,true);assert.equal(body.restaurant.id,tenant);assert.equal(body.restaurant.slug,`fixture-${tenant}`);
 assert.equal(body.slots.includes('10:00'),tenant%2===0);assert.ok(body.slots.includes('18:00'));
 requests++;elapsed.push(performance.now()-start);
})));
assert.equal(writeAttempts,0);assert.equal(requests,1000);
const sorted=elapsed.toSorted((a,b)=>a-b);
const result={pass:true,restaurants:100,simultaneousRequests:100,requests,stubbedDatabaseReads:reads,peakStubbedReads:maxActive,externalWrites:writeAttempts,elapsedMs:performance.now()-started,requestMs:{p50:sorted[499],p95:sorted[949],max:sorted.at(-1)},scope:'Actual current API handler; only database transport mocked with 10–14 ms latency. This is an application concurrency/isolation test, not hosted infrastructure capacity certification.'};
fs.writeFileSync(new URL('./concurrency-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
