import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const moduleSource = fs.readFileSync(new URL('../../restaurant-context.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../../dashboard.js', import.meta.url), 'utf8');
const start = dashboard.indexOf('async function loadRestaurantContext() {');
const end = dashboard.indexOf('\nlet roleRefreshInProgress', start);
assert.ok(start >= 0 && end > start);
const memberships = [
  {restaurant_id: 1, role: 'owner', restaurants: {name: 'Fixture A'}},
  {restaurant_id: 2, role: 'staff', restaurants: {name: '<script>Fixture B</script>'}}
];
function fixture(options = {}) {
  const values = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '', textContent: '', disabled: false, hidden: false, style: {}, children: [], appendChild(child){this.children.push(child);}, replaceChildren(){this.children=[];}});
    return elements.get(id);
  };
  let reloads = 0, requests = 0, notices = [], confirms = 0, resolveFetch;
  const context = vm.createContext({
    dashboardText: value => value,
    dashboardSessionVersion: 1, currentRestaurantId: null, currentUserId: null, currentUserRole: null, restaurantContextReadFailed: false,
    roleRefreshInProgress:false,lastRoleRefreshAt:0,ensureValidSession:async()=>true,
    SUPABASE_URL: 'https://fixture.invalid', AbortSignal, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000010' },
    sessionStorage: {getItem: key => values.get(key) || null, setItem: (key,value) => {if(options.storageError) throw new Error('fixture storage failure');values.set(key,value);}, removeItem: key => values.delete(key)},
    document: {getElementById: element, createElement: () => ({value:'',textContent:''})},
    getAccessToken: () => 'fixture-token', parseJwt: () => ({sub: options.userId || 'fixture-user'}), getHeaders: () => ({}),
    showLogin(){},hideLogin(){},setDashboardBackgroundInert(){},showDashboardNotice: (...args) => notices.push(args),
    console: {error(){}}, window: {confirm: () => {confirms++;return options.confirm !== false;}}, location: {reload: () => reloads++},
    fetch: async () => ({ok:true,status:200,json:async()=>options.memberships || memberships}),
    authorizedFetch: async (url, request) => {
      requests++;
      if(url.endsWith('/multi_restaurant_enabled')) return {ok:true,json:async()=>true};
      assert.equal(url,'https://fixture.invalid/rest/v1/rpc/create_additional_owner_restaurant');
      const payload = JSON.parse(request.body);
      assert.equal(payload.p_request_id,'00000000-0000-4000-8000-000000000010');
      assert.equal(payload.p_name,'New fixture');
      if(options.wait) await new Promise(resolve=>{resolveFetch=resolve;});
      if(options.network) throw new Error('fixture offline');
      if(options.relogin) {context.dashboardSessionVersion++;element('additionalRestaurantStatus').textContent='new session';}
      return {ok: options.status !== 500,status:options.status || 200,json:async()=>options.invalidResult?{}:3};
    }
  });
  vm.runInContext(moduleSource + '\n' + dashboard.slice(start,end), context);
  return {context, values, element, state:()=>({reloads,requests,notices,confirms}), resolve:()=>resolveFetch()};
}
const refreshStart=dashboard.indexOf('async function refreshCurrentUserContext(');
const refreshEnd=dashboard.indexOf('\nwindow.addEventListener("focus"',refreshStart);
let assertions=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
{
  const f=fixture();
  check(await f.context.loadRestaurantContext(),false);
  check(f.context.currentRestaurantId,null);
  f.context.showRestaurantChooser();
  check(f.element('restaurantChooserSelect').children.map(x=>x.textContent),['Vyber restauraci','Fixture A · Majitel','<script>Fixture B</script> · Obsluha']);
  check(f.element('restaurantChooserForm').style.display,'');
  f.context.switchDashboardRestaurant(2,false);
  check(f.state().reloads,1);
  check(JSON.parse(f.values.get('dashboardRestaurantSelection')),{userId:'fixture-user',restaurantId:2});
}
{
  const f=fixture();f.values.set('dashboardRestaurantSelection',JSON.stringify({userId:'fixture-user',restaurantId:2}));
  check(await f.context.loadRestaurantContext(),true);
  check(f.context.currentRestaurantId,2);check(f.context.currentUserRole,'staff');
  f.context.switchDashboardRestaurant(999,false);check(f.state().reloads,0);
  f.context.switchDashboardRestaurant(2,false);check(f.state().reloads,0);
  f.context.switchDashboardRestaurant(1);check(f.state().reloads,1);check(f.context.currentRestaurantId,null);check(f.context.currentUserRole,null);check(f.state().confirms,1);
}
for(const saved of ['bad-json',JSON.stringify({userId:'other-user',restaurantId:1}),JSON.stringify({userId:'fixture-user',restaurantId:999})]) {
  const f=fixture();f.values.set('dashboardRestaurantSelection',saved);check(await f.context.loadRestaurantContext(),false);
}
{
  const f=fixture({memberships:[memberships[0]]});check(await f.context.loadRestaurantContext(),true);check(f.context.currentUserRole,'owner');check(f.element('restaurantSwitcherWrapper').hidden,true);
}
{
  const f=fixture({confirm:false});await f.context.loadRestaurantContext();f.context.switchDashboardRestaurant(2);check(f.state().reloads,0);check(f.values.has('dashboardRestaurantSelection'),false);
}
{
  const f=fixture({storageError:true});await f.context.loadRestaurantContext();f.context.switchDashboardRestaurant(2,false);check(f.state().reloads,0);check(f.state().notices.length,1);
}
for(const response of [[memberships[0],memberships[0]],Array.from({length:101},(_,i)=>({...memberships[0],restaurant_id:i+1})),[{restaurant_id:1,role:'root'}]]) {
  const f=fixture({memberships:response});check(await f.context.loadRestaurantContext(),false);check(f.context.restaurantContextReadFailed,true);
}
for(const scenario of ['success','network','http500','invalid','relogin','storage','duplicate']) {
  const f=fixture({network:scenario==='network',status:scenario==='http500'?500:200,invalidResult:scenario==='invalid',relogin:scenario==='relogin',storageError:scenario==='storage',wait:scenario==='duplicate'});
  await f.context.loadRestaurantContext();
  // Capability read is separate from creation and grants no membership.
  f.context.currentUserId='fixture-user';f.context.currentRestaurantId=1;f.context.currentUserRole='owner';
  await f.context.loadMultiRestaurantCapability();
  f.context.showAdditionalRestaurantForm();f.element('additionalRestaurantName').value='New fixture';
  const pending=f.context.createAdditionalRestaurant({preventDefault(){}});
  if(scenario==='duplicate') {await f.context.createAdditionalRestaurant({preventDefault(){}});check(f.state().requests,2);f.resolve();}
  await pending;
  check(f.state().reloads,['success','duplicate'].includes(scenario)?1:0);
  if(['network','http500','invalid'].includes(scenario)) {
    const first = f.values.get('pendingAdditionalRestaurant');check(Boolean(first),true);
    f.context.showAdditionalRestaurantForm();check(f.element('additionalRestaurantName').disabled,true);
    await f.context.createAdditionalRestaurant({preventDefault(){}});check(f.values.get('pendingAdditionalRestaurant'),first);
  }
  if(scenario==='relogin') check(f.element('additionalRestaurantStatus').textContent,'new session');
  if(scenario==='storage') check(f.state().requests,1);
}
{
  const f=fixture({memberships:[memberships[1]]});
  f.context.currentRestaurantId=1;f.context.currentUserId='fixture-user';f.context.currentUserRole='owner';
  f.values.set('dashboardRestaurantSelection',JSON.stringify({userId:'fixture-user',restaurantId:1}));
  vm.runInContext(dashboard.slice(refreshStart,refreshEnd),f.context);
  await f.context.refreshCurrentUserContext({force:true});
  check(f.state().reloads,1);check(f.context.currentRestaurantId,null);check(f.context.currentUserRole,null);
}
console.log(`PASS ${assertions} multi-restaurant UI assertions: account-scoped selection, real roles, discard/cancel, untrusted IDs, pending creation replay, duplicate clicks and logout; no external calls.`);
