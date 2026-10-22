import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const html = read('dashboard.html'), source = read('dashboard-i18n.js'), dashboard = read('dashboard.js');
let assertions = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
function fixture(language = 'cs', options = {}) {
  const {document} = parseHTML(html);
  // linkedom implements select.value as a getter; provide the browser's setter for these fixtures.
  for (const select of document.querySelectorAll('[data-dashboard-language]')) {
    Object.defineProperty(select, 'value', {value:'cs',writable:true});
  }
  const values = new Map([['dashboardLanguage', language]]);
  let reloads = 0, alerts = [];
  const context = vm.createContext({document,
    localStorage:{getItem:key=>{if(options.readFailure) throw Error();return values.get(key);},setItem:(key,value)=>{if(options.writeFailure) throw Error();values.set(key,value);}},
    window:{confirm:()=>options.confirm !== false,alert:value=>alerts.push(value)},
    location:{reload:()=>reloads++}
  });
  vm.runInContext(source,context);
  return {context,document,values,state:()=>({reloads,alerts})};
}
const cs=fixture(), en=fixture('en');
check(cs.document.documentElement.lang,'cs'); check(en.document.documentElement.lang,'en');
check(en.document.querySelector('#loginForm h2').textContent,'Admin sign in');
check(cs.document.querySelector('#loginForm h2').textContent,'Přihlášení do administrace');
check(en.document.querySelector('a[data-section="rezervace"]').textContent.trim(),'Reservations');
check(en.document.getElementById('password').getAttribute('placeholder'),'Password');
check(en.document.getElementById('restaurantSwitcher').getAttribute('aria-label'),'Current restaurant');
check(en.document.querySelector('#createRestaurantForm button[type="submit"]').textContent,'Create restaurant');
// Every annotated dictionary string is translated before runtime data is inserted.
for (const element of en.document.querySelectorAll('[data-dashboard-i18n]')) {
  for (const node of element.childNodes) {
    if(node.nodeType===3) {
      const text=node.textContent.trim().replace(/\s+/g,' ');
      check(en.context.dashboardText(text),text);
    }
  }
}
// Translation must not change canonical values, DOM identities, handlers or validation.
for (const selector of ['option','input','textarea','button','form','a']) {
  const originals=[...cs.document.querySelectorAll(selector)], translated=[...en.document.querySelectorAll(selector)];
  check(translated.length,originals.length);
  originals.forEach((el,i)=>{
    for(const attr of ['value','id','type','href','onclick','onchange','onsubmit','required','min','max','minlength','maxlength','autocomplete']) {
      check(translated[i].getAttribute(attr),el.getAttribute(attr));
    }
  });
}
check(en.context.dashboardText('Name from database: Čeká'),'Name from database: Čeká');
check(en.context.dashboardText('toString'),'toString');
check(en.context.dashboardText('Missing translation'),'Missing translation');
// No observer: restaurant names and user input inserted after boot are never translated.
const label=en.document.getElementById('currentRestaurantNameLabel'); label.textContent='Restaurace';
const input=en.document.getElementById('newRestaurantName'); input.value='Čeká';
check(label.textContent,'Restaurace'); check(input.value,'Čeká');
for(const config of [{language:'en',confirm:false},{language:'en',writeFailure:true},{language:'invalid'},{language:'en'},{language:'cs'}]) {
  const f=fixture('cs',config), select={value:config.language};
  f.context.changeDashboardLanguage(select);
  check(f.state().reloads,config.language==='en'&&config.confirm!==false&&!config.writeFailure?1:0);
  if(config.confirm===false||config.writeFailure||config.language==='invalid') check(select.value,'cs');
}
check(fixture('en',{readFailure:true}).document.documentElement.lang,'cs');
check(fixture('<script>').document.documentElement.lang,'cs');
// Actual translated login/onboarding handlers: no outbound requests required for local validation.
const ranges=[['async function login(event)','async function logoutDashboard()'],['async function signupOwner(event)','async function createOwnerRestaurant(event)'],['async function saveRecoveredPassword(event)','function showSignup()']];
Object.assign(en.context,{dashboardSessionVersion:1,passwordRecoveryToken:null,getAccessToken:()=>null,parseJwt:()=>null,AbortSignal,console});
for(const [a,b] of ranges) vm.runInContext(dashboard.slice(dashboard.indexOf(a),dashboard.indexOf(b,dashboard.indexOf(a))),en.context);
await en.context.login({preventDefault(){}});
check(en.document.getElementById('error').textContent,'Enter your email and password.');
await en.context.signupOwner({preventDefault(){}});
check(en.document.getElementById('signupStatus').textContent,'The password must have at least 12 characters.');
await en.context.saveRecoveredPassword({preventDefault(){}});
check(en.document.getElementById('resetPasswordStatus').textContent,'Enter matching passwords with at least 12 characters.');
// Translation script must initialize synchronously before either source can insert user data.
check(html.indexOf('src="dashboard-i18n.js')<html.indexOf('src="restaurant-context.js'),true);
check(html.indexOf('src="dashboard-i18n.js')<html.indexOf('src="dashboard.js'),true);
// English per-restaurant roles, with exact user-provided names and IDs preserved.
Object.assign(en.context,{availableRestaurantMemberships:[],currentRestaurantId:null,sessionStorage:{getItem:()=>null}});
vm.runInContext(read('restaurant-context.js'),en.context);
vm.runInContext(`availableRestaurantMemberships = [{restaurant_id:1,role:'owner',restaurants:{name:'Restaurace'}},{restaurant_id:2,role:'staff',restaurants:{name:'<img src=x onerror=alert(1)>'}}]; renderRestaurantChoices();`,en.context);
const choices=[...en.document.querySelectorAll('#restaurantChooserSelect option')];
check(choices.map(o=>o.textContent),['Choose a restaurant','Restaurace · Owner','<img src=x onerror=alert(1)> · Staff']);
check(en.document.querySelector('#restaurantChooserSelect img'),null);
check(choices.map(o=>o.getAttribute('value')),['','1','2']);
console.log(`PASS ${assertions} language assertions: real HTML, canonical values, safe user content, persisted/cancelled/blocked language selection, English login and per-restaurant roles. No external calls.`);
