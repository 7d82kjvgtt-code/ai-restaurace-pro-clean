import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(process.env.DASHBOARD_SOURCE || new URL('../../dashboard.js', import.meta.url), 'utf8');
const start = source.indexOf('async function inviteTeamMember(event) {');
const end = source.indexOf('\nfunction showDashboardSection', start);
assert.ok(start >= 0 && end > start);
const scenarios = ['success','staff','signed-out','fetch-logout','json-logout','json-switch','json-role','reload-logout','network-logout','http-error','invalid-response','duplicate'];
let cases = 0;
for (const action of ['invite','role','active']) for (const scenario of scenarios) {
  const inputs = { teamInviteName: {value:'Local Fixture'}, teamInviteEmail:{value:'local@example.invalid'}, teamInviteRole:{value:'staff'}, teamInviteButton:{disabled:false,textContent:'Pozvat zaměstnance'} };
  let requests = 0, reloads = 0, release;
  const notices = [];
  const context = vm.createContext({
    dashboardSessionVersion:1,currentRestaurantId:7,currentUserId:scenario === 'signed-out' ? null : 'fixture-owner',currentUserRole:scenario === 'staff' ? 'staff' : 'owner',
    SUPABASE_URL:'https://fixture.invalid',document:{getElementById:id=>inputs[id]},getCurrentUserEmail:()=> 'owner@example.invalid',getAccessToken:()=> 'fixture-token',getHeaders:x=>x,
    console:{error(){}},showDashboardNotice:(...args)=>notices.push(args),
    loadTeamMembers:async()=>{reloads++;if(scenario==='reload-logout') context.dashboardSessionVersion++;},
    authorizedFetch:async(url,options)=>{
      requests++;
      if(action!=='invite') assert.ok(url.includes('id=eq.4&restaurant_id=eq.7'));
      if(scenario==='duplicate') await new Promise(resolve=>{release=resolve;});
      if(scenario==='fetch-logout' || scenario==='network-logout') context.dashboardSessionVersion++;
      if(scenario==='network-logout') throw new Error('fixture offline');
      return {ok:scenario!=='http-error',text:async()=> 'fixture failure',json:async()=>{
        if(scenario==='json-logout') context.dashboardSessionVersion++;
        if(scenario==='json-switch') context.currentRestaurantId=8;
        if(scenario==='json-role') context.currentUserRole='staff';
        if(scenario==='invalid-response') return action==='invite'?{}:[];
        return action==='invite'?{ok:true}:[{id:4,restaurant_id:7,role:'manager',active:false}];
      }};
    }
  });
  vm.runInContext(source.slice(start,end),context);
  const run=()=>action==='invite'?context.inviteTeamMember():action==='role'?context.updateTeamMemberRole(4,'manager'):context.toggleTeamMemberActive(4,false);
  const pending=run();
  if(scenario==='duplicate' && action==='invite') {await run();assert.equal(requests,1);release();}
  else if(scenario==='duplicate') release();
  await pending;
  const denied=['staff','signed-out'].includes(scenario);
  const stale=['fetch-logout','json-logout','json-switch','json-role','reload-logout','network-logout'].includes(scenario);
  const successful=!denied&&!stale&&!['http-error','invalid-response'].includes(scenario);
  assert.equal(requests,denied?0:1,action+'/'+scenario);
  assert.equal(notices.some(n=>n[1]==='success'),successful,action+'/'+scenario);
  if(stale) assert.equal(notices.length,0,action+'/'+scenario);
  if(action==='invite' && !successful && scenario!=='reload-logout') assert.equal(inputs.teamInviteEmail.value,'local@example.invalid',scenario);
  if(action==='invite' && successful) assert.equal(inputs.teamInviteButton.disabled,false);
  cases++;
}
console.log(`PASS ${cases} team mutation cases: invitation duplicates, session changes, role changes and malformed responses; no email or external calls.`);
