// Explicit, bounded live verification. Never creates reservations, customers or emails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const enabled=process.argv.includes('--run-authorized-live-check');
if(!enabled)throw Error('Live traffic is opt-in: use --run-authorized-live-check');
const origin='https://ai-restaurace-pro-clean.vercel.app';
const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const results=[];const stages=[];let inFlight=0,peak=0,stopped=false;
const quantile=(a,p)=>a.toSorted((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]??0;
async function read(action='available-times'){
 const started=performance.now();inFlight++;peak=Math.max(peak,inFlight);
 let result;
 try{
  assert.ok(['available-times','restaurant-info'].includes(action));
  const response=await fetch(origin+'/api/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,slug:'restaurace-c03b641f',date,people:2}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.success,true);
  assert.equal(data.restaurant.slug,'restaurace-c03b641f');
  if(action==='available-times'){
   assert.ok(Array.isArray(data.slots));assert.ok(data.slots.every(x=>/^\d{2}:\d{2}$/.test(x)));assert.equal(new Set(data.slots).size,data.slots.length);
  }
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  result={ok:true,action,ms:performance.now()-started,status:response.status,slots:data.slots?.length,serverTiming:response.headers.get('server-timing'),region:response.headers.get('x-vercel-id')};
 }catch(e){result={ok:false,action,ms:performance.now()-started,error:String(e.message)};}
 finally{inFlight--;}
 results.push(result);return result;
}
function summarize(name,rows){
 const serverMs=rows.filter(x=>x.serverTiming).map(x=>[...x.serverTiming.matchAll(/dur=([\d.]+)/g)].reduce((sum,m)=>sum+Number(m[1]),0));
 const entry={name,requests:rows.length,failed:rows.filter(x=>!x.ok).length,p50Ms:quantile(rows.map(x=>x.ms),.5),p95Ms:quantile(rows.map(x=>x.ms),.95),maxMs:Math.max(...rows.map(x=>x.ms)),serverDataP95Ms:serverMs.length?quantile(serverMs,.95):null};
 stages.push(entry);console.log(JSON.stringify(entry));
 // Observed total latency varies by ~6 seconds despite much smaller measured DB
 // segments. This runner cannot separate proxy, network and invocation queue time.
 // Use fixed total-response and server-data safety ceilings, not a moving baseline.
 const networkLimit=12000;
 if(entry.failed>0||entry.p95Ms>networkLimit||(entry.serverDataP95Ms!==null&&entry.serverDataP95Ms>2000)){stopped=true;console.log('Stopped escalation: error, network p95 over 12 seconds, or server data p95 over 2 seconds.');}
 return entry;
}
// Optional static-CDN warmup reduces connection setup noise; it does not prove
// where remaining delays occur. Report it separately from the original cold run.
const transportWarmed=process.argv.includes('--warm-transport');
if(transportWarmed){
 let warmupFailures=0;
 await Promise.all(Array.from({length:100},async()=>{
  try {const r=await fetch(origin+'/style.css',{signal:AbortSignal.timeout(15000)});if(r.status!==200)warmupFailures++;await r.arrayBuffer();}
  catch{warmupFailures++;}
 }));
 console.log(JSON.stringify({staticTransportWarmup:100,warmupFailures}));
 if(warmupFailures)throw Error('CDN transport warmup failed; API load check not started.');
}
const preflight=await Promise.all([read('restaurant-info'),read()]);summarize('preflight',preflight);
for(const concurrency of [10,25,50,100]){
 if(stopped)break;
 const rows=await Promise.all(Array.from({length:concurrency},()=>read()));summarize('concurrency-'+concurrency,rows);
}
if(!stopped){
 const startIndex=results.length;const pending=new Set();
 for(let tick=0;tick<150&&!stopped;tick++){
  if(inFlight>=50){stopped=true;console.log('Stopped steady test: more than 50 outstanding reads.');break;}
  const task=read(tick%5===0?'restaurant-info':'available-times').then(r=>{if(!r.ok||r.ms>12000)stopped=true;}).finally(()=>pending.delete(task));pending.add(task);
  await new Promise(r=>setTimeout(r,200));
 }
 await Promise.all(pending);summarize('steady-up-to-30-seconds-5rps',results.slice(startIndex));
}
const report={completedAt:new Date().toISOString(),origin,transportWarmed,guards:{serverDataP95Ms:2000,absoluteNetworkP95Ms:12000,steadyOutstanding:50},scope:'Bounded read-only hosted endpoint check on the existing demo tenant. Not a 100-customer or write/email/sustained-capacity certification.',peakConcurrentRequests:peak,requests:results.length,failed:results.filter(x=>!x.ok).length,stopped,stages,results};
fs.writeFileSync(new URL('./live-readonly-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({done:true,requests:report.requests,failed:report.failed,peak,stopped}));
if(stopped||report.failed)process.exitCode=1;
