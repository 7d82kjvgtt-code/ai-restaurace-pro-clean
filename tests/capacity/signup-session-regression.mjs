import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../dashboard.js',import.meta.url),'utf8');
const start=source.indexOf('async function signupOwner(event) {'),end=source.indexOf('async function createOwnerRestaurant(event)',start);
assert.ok(start>=0&&end>start);
let cases=0;
for(const scenario of ['confirmation','session','400','429','network','invalid-json','invalid-user','invalid-token-pair','short-password','duplicate','fetch-token-change','fetch-logout','json-relogin','json-token-change','error-relogin']) {
  let token='initial',requests=0,creates=0,resets=0,release;
  const values=new Map(),status={textContent:''},button={disabled:false};
  const form={querySelector:()=>button,reset(){resets++;}};
  const elements={signupForm:form,signupEmail:{value:'owner@example.invalid'},signupPassword:{value:scenario==='short-password'?'short':'synthetic-password'},signupStatus:status};
  const context=vm.createContext({dashboardSessionVersion:1,dashboardText:value=>value,AbortSignal,
    getAccessToken:()=>token, SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'fixture',location:{origin:'https://fixture.invalid'},document:{getElementById:id=>elements[id]},
    sessionStorage:{setItem(key,value){values.set(key,value);if(key==='supabaseAccessToken')token=value;}},
    showCreateRestaurant:()=>creates++,
    fetch:async(url,options)=>{
      requests++;assert.equal(new URL(url).hostname,'fixture.invalid');assert.equal(JSON.parse(options.body).email,'owner@example.invalid');
      if(scenario==='duplicate')await new Promise(resolve=>{release=resolve;});
      if(scenario==='fetch-token-change'){token='another-account';status.textContent='new account';button.disabled=true;}
      if(scenario==='fetch-logout'||scenario==='error-relogin'){context.dashboardSessionVersion++;status.textContent='new session';button.disabled=true;}
      if(scenario==='network'||scenario==='error-relogin')throw Error('synthetic offline');
      const http=Number(scenario)||200;
      return {ok:http===200,status:http,json:async()=>{
        if(scenario==='json-relogin'){context.dashboardSessionVersion++;status.textContent='new session';button.disabled=true;}
        if(scenario==='json-token-change'){token='another-account';status.textContent='new account';button.disabled=true;}
        if(scenario==='invalid-json')throw SyntaxError('synthetic');
        if(scenario==='session')return {access_token:'new-fixture-token',refresh_token:'new-fixture-refresh'};
        if(scenario==='invalid-token-pair')return {access_token:'new-fixture-token',user:{id:'10000000-0000-4000-8000-000000000001'}};
        return {id:scenario==='invalid-user'?'bad':'10000000-0000-4000-8000-000000000001'};
      }};
    }
  });
  vm.runInContext(source.slice(start,end),context);
  const submit=()=>context.signupOwner({preventDefault(){}});
  const pending=submit();if(scenario==='duplicate'){await submit();assert.equal(requests,1);release();}await pending;
  const stale=scenario.includes('change')||scenario.includes('logout')||scenario.includes('relogin');
  assert.equal(requests,scenario==='short-password'?0:1,scenario);
  assert.equal(creates,scenario==='session'?1:0,scenario);
  assert.equal(values.size,scenario==='session'?3:0,scenario+' stale results must never write account tokens');
  if(stale){assert.match(status.textContent,/^new /,scenario);assert.equal(button.disabled,true,scenario+' must not unlock another session form');assert.equal(resets,0,scenario);}
  else assert.equal(button.disabled,false,scenario);
  cases++;
}
console.log(`PASS ${cases} sign-up session cases: delayed responses, logout, same-user re-login, token replacement, duplicate submit and valid confirmation/session; no external calls or accounts created.`);
