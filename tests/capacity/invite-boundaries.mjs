import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../../api/invite-team-member.js', import.meta.url), 'utf8');
const ownerId='10000000-0000-4000-8000-000000000001', inviteeId='20000000-0000-4000-8000-000000000002';
const scenarios=[['missing-token',401],['invalid-token',401],['manager',403],['staff',403],['no-membership',403],['multiple-memberships',409],['foreign-target',403],['wrong-target-response',500],['invalid-target',400],['boolean-target',400],['existing-account',200],['existing-wrong-email',409],['existing-unconfirmed',409],['existing-auth-error',409],['active-invalid-json',500],['active-object',500],['active-null-row',500],['active-invalid-id',500],['active-invalid-user',500],['existing-object',500],['existing-invalid-id',500],['existing-active-owner',409],['forbidden-owner-role',400],['valid',200],['legacy-valid',200]];
for(const [scenario,expectedStatus] of scenarios){
 let writes=0,status=200,result;
 const json=data=>({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)});
 const existingAccount=scenario.startsWith('existing-')&&['existing-account','existing-wrong-email','existing-unconfirmed','existing-auth-error'].includes(scenario);
 const context=vm.createContext({URL,Date,module:{exports:{}},process:{env:{SUPABASE_SERVICE_ROLE_KEY:'fixture-only',APP_URL:'https://fixture.example.invalid'}},console:{error(){}},
 fetch:async(raw,options={})=>{
  const url=new URL(raw),method=options.method||'GET';
  assert.equal(url.hostname,'decpnnbaejxjbpmyjocs.supabase.co');
  if(method!=='GET'){
   writes++;assert.equal(expectedStatus,200,'Rejected operation attempted mutation or email');
   const body=JSON.parse(options.body);
   if(url.pathname==='/auth/v1/invite'){
    assert.equal(existingAccount,false);assert.equal(url.searchParams.get('redirect_to'),'https://fixture.example.invalid/invite.html');assert.equal(body.data.restaurant_id,2);assert.equal(body.data.role,'staff');return json({id:inviteeId});
   }
   assert.equal(url.pathname,'/rest/v1/restaurant_team');assert.equal(body.restaurant_id,2);assert.equal(body.user_id,inviteeId);assert.equal(body.role,'staff');return json([{restaurant_id:2,user_id:inviteeId}]);
  }
  if(url.pathname==='/auth/v1/user') return scenario==='invalid-token'?{ok:false,status:401}:json({id:ownerId});
  if(url.pathname.startsWith('/auth/v1/admin/users/')){
   assert.equal(existingAccount,true);assert.equal(url.pathname,'/auth/v1/admin/users/'+inviteeId);
   if(scenario==='existing-auth-error') return {ok:false,status:500,json:async()=>({})};
   return json({id:inviteeId,email:scenario==='existing-wrong-email'?'other@example.invalid':'test@example.invalid',email_confirmed_at:scenario==='existing-unconfirmed'?null:'2030-01-01T00:00:00Z'});
  }
  assert.equal(url.pathname,'/rest/v1/restaurant_team');
  if(url.searchParams.has('user_id')){
   assert.equal(url.searchParams.get('user_id'),'eq.'+ownerId);
   if(['no-membership','foreign-target'].includes(scenario)) return json([]);
   if(scenario==='multiple-memberships') {assert.equal(url.searchParams.has('restaurant_id'),false);return json([{restaurant_id:2,role:'owner'},{restaurant_id:3,role:'owner'}]);}
   if(scenario!=='legacy-valid') assert.equal(url.searchParams.get('restaurant_id'),'eq.'+(scenario==='foreign-target'?999:2));
   return json([{restaurant_id:scenario==='wrong-target-response'?3:2,role:['staff','manager'].includes(scenario)?scenario:'owner'}]);
  }
  if(!url.searchParams.has('restaurant_id')){
   if(scenario==='active-invalid-json') return {ok:true,json:async()=>{throw new SyntaxError('fixture');}};
   if(scenario==='active-object') return json({unexpected:true});
   if(scenario==='active-null-row') return json([null]);
   if(scenario==='active-invalid-id') return json([{restaurant_id:'invalid'}]);
   if(scenario==='active-invalid-user') return json([{restaurant_id:3,user_id:'invalid'}]);
   return json(existingAccount?[{restaurant_id:3,user_id:inviteeId}]:[]);
  }
  assert.equal(url.searchParams.get('restaurant_id'),'eq.2');
  if(scenario==='existing-object') return json({unexpected:true});
  if(scenario==='existing-invalid-id') return json([{id:'invalid',active:false,role:'staff'}]);
  if(scenario==='existing-active-owner') return json([{id:7,active:true,role:'owner'}]);
  return json([]);
 }});
 vm.runInContext(source,context);
 const headers={},res={setHeader(k,v){headers[k]=v;},status(n){status=n;return this;},json(v){result=v;return this;}};
 const target=['multiple-memberships','legacy-valid'].includes(scenario)?undefined:scenario==='foreign-target'?999:scenario==='invalid-target'?'bad':scenario==='boolean-target'?true:2;
 await context.module.exports({method:'POST',headers:scenario==='missing-token'?{}:{authorization:'Bearer fixture',host:'attacker.example.invalid'},body:{full_name:'Local fixture',email:'test@example.invalid',restaurant_id:target,role:scenario==='forbidden-owner-role'?'owner':'staff'}},res);
 assert.equal(status,expectedStatus,scenario);assert.equal(headers['Cache-Control'],'no-store');assert.equal(writes,expectedStatus===200?(existingAccount?1:2):0,scenario);
 if(expectedStatus===200) assert.equal(result.ok,true);else assert.equal(typeof result.error,'string');
}
console.log(`PASS ${scenarios.length} scoped invitation cases: owner role for chosen restaurant, verified existing accounts and safe legacy fallback; no external calls.`);
