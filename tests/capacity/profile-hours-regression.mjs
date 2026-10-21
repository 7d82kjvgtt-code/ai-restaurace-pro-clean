import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(process.env.DASHBOARD_SOURCE || new URL('../../dashboard.js', import.meta.url),'utf8');
function section(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a);
  return source.slice(a,b);
}
const profileCode=section('async function persistCustomerProfile(', '\nfunction saveCustomerNote(');
let cases=0;
for(const scenario of ['success','staff','signed-out','unknown-role','empty','wrong-key','wrong-restaurant','multiple','null','reload-error','reload-mismatch','logout-json','logout-reload','payload-override']) {
  let requests=0,renders=0,cleared=0;
  const notices=[];
  const old={restaurant_id:7,customer_key:'fixture',note:'old',is_regular:false};
  const saved={...old,note:'new'};
  const context=vm.createContext({
    dashboardSessionVersion:1,currentRestaurantId:7,currentUserId:scenario==='signed-out'?null:'fixture-owner',currentUserRole:scenario==='unknown-role'?'unknown':scenario==='staff'?'staff':'owner',
    SUPABASE_URL:'https://fixture.invalid',customerProfiles:[{...old}],
    buildCustomers:()=>[{key:'fixture',name:'Local'}],getCustomerProfileForCustomer:()=>old,getHeaders:x=>x,
    console:{error(){}},renderCustomers:()=>renders++,clearSavedCustomerNoteDraft:()=>cleared++,
    getCustomerProfile:()=>scenario==='reload-mismatch'?old:saved,
    showDashboardNotice:(...args)=>notices.push(args),
    loadCustomerProfiles:async()=>{if(scenario==='logout-reload') context.dashboardSessionVersion++;if(scenario==='reload-error') throw new Error('fixture unavailable');},
    authorizedFetch:async(url,options)=>{
      requests++;
      assert.equal(url,'https://fixture.invalid/rest/v1/customer_profiles?on_conflict=restaurant_id,customer_key');
      const payload=JSON.parse(options.body);
      assert.equal(payload.restaurant_id,7);
      assert.equal(payload.customer_key,'fixture');
      return {ok:true,json:async()=>{
        if(scenario==='logout-json') context.dashboardSessionVersion++;
        if(scenario==='empty') return [];
        if(scenario==='null') return null;
        if(scenario==='wrong-key') return [{...saved,customer_key:'other'}];
        if(scenario==='wrong-restaurant') return [{...saved,restaurant_id:8}];
        if(scenario==='multiple') return [saved,saved];
        return [saved];
      }};
    }
  });
  vm.runInContext(profileCode,context);
  await context.persistCustomerProfile('fixture',scenario==='payload-override'?{note:'new',restaurant_id:8,customer_key:'other'}:{note:'new'});
  const success=['success','staff','payload-override'].includes(scenario);
  assert.equal(notices.some(n=>n[1]==='success'),success,scenario);
  assert.equal(cleared,success?1:0,scenario);
  if(['empty','wrong-key','wrong-restaurant','multiple','null','logout-json','signed-out','unknown-role'].includes(scenario)) {
    assert.equal(context.customerProfiles[0].note,'old',scenario);
    assert.equal(renders,0,scenario);
  }
  if(['signed-out','unknown-role'].includes(scenario)) assert.equal(requests,0);
  if(scenario.startsWith('logout')) assert.equal(notices.length,0);
  cases++;
}
const hoursCode=section('async function saveOpeningHours()', '\nasync function loadBlockedTimes');
for(const scenario of ['success','reordered','staff','signed-out','missing-input','duplicate-input','bad-day-input','closed','missing-result','duplicate-result','wrong-restaurant','changed-time','changed-open','bad-day-result','null','logout-json']) {
  let requests=0,renders=0;
  const notices=[];
  let rows=Array.from({length:7},(_,day)=>({restaurant_id:7,day_of_week:day,is_open:true,open_time:'10:00',close_time:'22:00'}));
  if(scenario==='closed') rows[0].is_open=false;
  if(scenario==='missing-input') rows.pop();
  if(scenario==='duplicate-input') rows[6].day_of_week=5;
  if(scenario==='bad-day-input') rows[6].day_of_week=9;
  const context=vm.createContext({
    dashboardSessionVersion:1,currentRestaurantId:7,currentUserId:scenario==='signed-out'?null:'fixture-owner',currentUserRole:scenario==='staff'?'staff':'owner',
    SUPABASE_URL:'https://fixture.invalid',openingHours:[{original:true}],openingHoursConfigured:false,
    console:{error(){}},getHeaders:x=>x,renderOpeningHours:()=>renders++,renderSetupChecklist(){},showDashboardNotice:(...args)=>notices.push(args),
    document:{querySelectorAll:()=>rows.map(row=>({dataset:{day:String(row.day_of_week)},querySelector:selector=>selector==='.day-open'?{checked:row.is_open}:{value:selector==='.day-from'?row.open_time:row.close_time}}))},
    authorizedFetch:async()=>{requests++;return {ok:true,json:async()=>{
      if(scenario==='logout-json') context.dashboardSessionVersion++;
      if(scenario==='null') return null;
      const result=rows.map(row=>({...row,open_time:row.open_time+':00',close_time:row.close_time+':00'}));
      if(scenario==='missing-result') result.pop();
      if(scenario==='duplicate-result') result[6]={...result[5]};
      if(scenario==='wrong-restaurant') result[0].restaurant_id=8;
      if(scenario==='changed-time') result[0].open_time='11:00:00';
      if(scenario==='changed-open') result[0].is_open=false;
      if(scenario==='bad-day-result') result[0].day_of_week=9;
      if(scenario==='closed') {result[0].open_time=null;result[0].close_time=null;}
      if(scenario==='reordered') result.reverse();
      return result;
    }};}
  });
  vm.runInContext(hoursCode,context);
  await context.saveOpeningHours();
  const success=['success','reordered','closed'].includes(scenario);
  assert.equal(renders,success?1:0,scenario);
  assert.equal(notices.some(n=>n[1]==='success'),success,scenario);
  assert.equal(context.openingHoursConfigured,success,scenario);
  if(!success) assert.equal(context.openingHours[0].original,true,scenario);
  if(['staff','signed-out','missing-input','duplicate-input','bad-day-input'].includes(scenario)) assert.equal(requests,0,scenario);
  cases++;
}
console.log(`PASS ${cases} profile/opening-hours cases: response identity, seven distinct days, readback failure and logout; no external calls.`);
