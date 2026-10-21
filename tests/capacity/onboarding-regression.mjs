import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(process.env.DASHBOARD_SOURCE||new URL('../../dashboard.js',import.meta.url),'utf8');
const a=source.indexOf('async function createOwnerRestaurant(event) {'),b=source.indexOf('\nfunction hideLogin()',a);
assert.ok(a>=0&&b>a);
let cases=0;
for(const scenario of ['success','duplicate','token-refresh','no-user','short-name','long-name','400','401','409','500','503','network','invalid-json','empty-id','object-id','wrong-context','missing-context','context-error','fetch-relogin','json-relogin','context-relogin','error-relogin']) {
  const name={value:scenario==='short-name'?'A':scenario==='long-name'?'A'.repeat(121):'Local fixture restaurant'};
  const status={textContent:''},button={disabled:false};
  let requests=0,reloads=0,contextLoads=0,navigations=0,release;
  let token='fixture';
  const context=vm.createContext({
    dashboardSessionVersion:1,currentRestaurantId:null,AbortSignal,SUPABASE_URL:'https://fixture.invalid',
    getAccessToken:()=>token,parseJwt:()=>scenario==='no-user'?null:{sub:'fixture-owner'},
    document:{getElementById:id=>id==='newRestaurantName'?name:status,querySelector:()=>button},
    history:{replaceState:()=>navigations++},location:{reload:()=>reloads++},getHeaders:()=>({}),
    loadRestaurantContextWithRetry:async()=>{
      contextLoads++;
      if(scenario==='context-relogin') {context.dashboardSessionVersion++;status.textContent='new session';button.disabled=false;}
      if(scenario==='context-error') throw new Error('fixture context failure');
      context.currentRestaurantId=scenario==='wrong-context'?8:7;
      return scenario!=='missing-context';
    },
    fetch:async(url,options)=>{
      requests++;
      assert.equal(url,'https://fixture.invalid/rest/v1/rpc/create_owner_restaurant');
      assert.equal(JSON.parse(options.body).p_name,'Local fixture restaurant');
      if(scenario==='duplicate') await new Promise(resolve=>{release=resolve;});
      if(scenario==='fetch-relogin'||scenario==='error-relogin') {context.dashboardSessionVersion++;status.textContent='new session';button.disabled=false;}
      if(scenario==='network'||scenario==='error-relogin') throw new Error('fixture network failure');
      if(scenario==='token-refresh') token='fresh';
      const responseStatus=Number(scenario)||200;
      return {ok:responseStatus===200,status:responseStatus,json:async()=>{
        if(scenario==='json-relogin') {context.dashboardSessionVersion++;status.textContent='new session';button.disabled=false;}
        if(scenario==='invalid-json') throw new Error('fixture invalid JSON');
        if(scenario==='empty-id') return null;
        if(scenario==='object-id') return {id:7};
        return 7;
      }};
    }
  });
  vm.runInContext(source.slice(a,b),context);
  const run=()=>context.createOwnerRestaurant({preventDefault(){}});
  const pending=run();
  if(scenario==='duplicate') {await run();assert.equal(requests,1);release();}
  await pending;
  const success=['success','duplicate','token-refresh'].includes(scenario);
  const stale=scenario.endsWith('relogin');
  const denied=['no-user','short-name','long-name'].includes(scenario);
  const uncertain=['500','503','network','invalid-json','empty-id','object-id','wrong-context','missing-context','context-error'].includes(scenario);
  assert.equal(requests,denied?0:1,scenario);
  assert.equal(reloads,success?1:0,scenario);
  assert.equal(navigations,success?1:0,scenario);
  if(stale){assert.equal(status.textContent,'new session',scenario);assert.equal(button.disabled,false,scenario);}
  else assert.equal(button.disabled,success||uncertain,scenario);
  if(uncertain) {await run();assert.equal(requests,1,scenario+' must not create again');}
  if(['500','503'].includes(scenario)) assert.match(status.textContent,/nelze ověřit/);
  if(['no-user','short-name','long-name','400','401','409','500','503','network','invalid-json','empty-id','object-id','fetch-relogin','json-relogin','error-relogin'].includes(scenario)) assert.equal(contextLoads,0,scenario);
  cases++;
}
console.log(`PASS ${cases} restaurant onboarding cases: created ID, context loading, session changes and uncertain creation; no external calls or new restaurants.`);
