import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(process.env.DASHBOARD_SOURCE || new URL('../../dashboard.js',import.meta.url),'utf8');
function section(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
const contextCode=section('async function loadRestaurantContext() {','\nlet roleRefreshInProgress');
const unassignedCode=section('async function showUnassignedAccountState()','\nfunction showForgotPassword');
let cases=0;
for(const scenario of ['owner','manager','staff','empty','multiple','invalid-role','invalid-restaurant','not-array','no-user','http500','http429','network','fetch-relogin','json-relogin','network-relogin','other-user','token-refresh']) {
  let token='fixture';
  let requests=0;
  const context=vm.createContext({
    dashboardText: value => value,
    availableRestaurantMemberships:[],selectRestaurantMembership:rows=>rows.length===1?rows[0]:null,renderRestaurantChoices(){},showRestaurantChooser(){},
    dashboardSessionVersion:1,restaurantContextReadFailed:false,currentUserId:'new-marker',currentRestaurantId:99,currentUserRole:'new-marker',
    SUPABASE_URL:'https://fixture.invalid',AbortSignal,
    getAccessToken:()=>token,parseJwt:()=>scenario==='no-user'?null:{sub:token==='other'?'other':'same-user'},getHeaders:()=>({}),
    console:{error(){}},
    fetch:async()=>{
      requests++;
      if(scenario==='fetch-relogin'||scenario==='network-relogin') {context.dashboardSessionVersion++;context.restaurantContextReadFailed='new-marker';}
      if(scenario==='other-user') token='other';
      if(scenario==='token-refresh') token='fresh';
      if(scenario==='network-relogin'||scenario==='network') throw new Error('fixture failure');
      return {ok:!['http500','http429'].includes(scenario),status:scenario==='http500'?500:scenario==='http429'?429:200,json:async()=>{
        if(scenario==='json-relogin') {context.dashboardSessionVersion++;context.restaurantContextReadFailed='new-marker';}
        if(scenario==='empty') return [];
        if(scenario==='not-array') return {};
        if(scenario==='multiple') return [{restaurant_id:7,role:'owner'},{restaurant_id:8,role:'owner'}];
        return [{restaurant_id:scenario==='invalid-restaurant'?0:7,role:scenario==='invalid-role'?'root':['manager','staff'].includes(scenario)?scenario:'owner'}];
      }};
    }
  });
  vm.runInContext(contextCode,context);
  const ok=await context.loadRestaurantContext();
  const success=['owner','manager','staff','token-refresh'].includes(scenario);
  assert.equal(ok,success,scenario);
  assert.equal(context.currentRestaurantId,success?7:99,scenario);
  if(scenario.endsWith('relogin')) assert.equal(context.restaurantContextReadFailed,'new-marker',scenario);
  if(scenario==='no-user') assert.equal(requests,0);
  cases++;
}
// The same user signing in again between attempts must cancel the old retry chain.
for(const scenario of ['same-user-new-session','token-refresh']) {
  let requests=0,waits=0;
  const context=vm.createContext({
    dashboardText: value => value,
    availableRestaurantMemberships:[],selectRestaurantMembership:rows=>rows.length===1?rows[0]:null,renderRestaurantChoices(){},showRestaurantChooser(){},
    dashboardSessionVersion:1,restaurantContextReadFailed:false,currentUserId:null,currentRestaurantId:null,currentUserRole:null,
    SUPABASE_URL:'https://fixture.invalid',AbortSignal,getAccessToken:()=> 'fixture',parseJwt:()=>({sub:'same-user'}),getHeaders:()=>({}),console:{error(){}},
    setTimeout:resolve=>{waits++;if(scenario==='same-user-new-session') context.dashboardSessionVersion++;resolve();},
    fetch:async()=>({ok:true,status:200,json:async()=>++requests===1?[]:[{restaurant_id:7,role:'owner'}]})
  });
  vm.runInContext(contextCode,context);
  const ok=await context.loadRestaurantContextWithRetry(3,1);
  assert.equal(ok,scenario==='token-refresh',scenario);
  assert.equal(requests,scenario==='token-refresh'?2:1,scenario);
  assert.equal(waits,1);
  cases++;
}
for(const scenario of ['new-owner','inactive','profile-linked','http-error','malformed','fetch-relogin','json-relogin','error-relogin','read-failed']) {
  let clears=0,logins=0,creates=0,requests=0;
  const error={textContent:''};
  const context=vm.createContext({
    dashboardText: value => value,
    availableRestaurantMemberships:[],selectRestaurantMembership:rows=>rows.length===1?rows[0]:null,renderRestaurantChoices(){},showRestaurantChooser(){},
    dashboardSessionVersion:1,restaurantContextReadFailed:scenario==='read-failed',SUPABASE_URL:'https://fixture.invalid',AbortSignal,
    getAccessToken:()=> 'fixture',parseJwt:()=>({sub:'same-user'}),getHeaders:()=>({}),document:{getElementById:()=>error},
    clearSession:()=>clears++,showLogin:()=>logins++,showCreateRestaurant:()=>creates++,
    fetch:async url=>{
      requests++;
      if(scenario==='fetch-relogin'||scenario==='error-relogin') context.dashboardSessionVersion++;
      if(scenario==='error-relogin') throw new Error('fixture offline');
      return {ok:scenario!=='http-error',json:async()=>{
        if(scenario==='json-relogin') context.dashboardSessionVersion++;
        if(scenario==='malformed') return {};
        if(scenario==='inactive'&&url.includes('restaurant_team')) return [{id:4}];
        if(scenario==='profile-linked'&&url.includes('/profiles?')) return [{restaurant_id:7}];
        return [];
      }};
    }
  });
  vm.runInContext(unassignedCode,context);
  await context.showUnassignedAccountState();
  if(scenario.endsWith('relogin')) {
    assert.equal(clears+logins+creates,0,scenario);
    assert.equal(error.textContent,'',scenario);
  } else if(scenario==='new-owner') assert.equal(creates,1);
  else {assert.equal(creates,0);assert.equal(logins,1);}
  if(scenario==='read-failed') assert.equal(requests,0);
  cases++;
}
console.log(`PASS ${cases} restaurant access cases: roles, inactive accounts, network errors, same-user re-login and retry cancellation; no external calls.`);
