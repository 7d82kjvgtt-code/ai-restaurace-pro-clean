import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const read=name=>fs.readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const source=read('dashboard.js'), languageSource=read('dashboard-i18n.js');
function extract(name) {
  const start=source.indexOf(`function ${name}(`), end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,name);
  return source.slice(start,end+2);
}
let assertions=0;
function check(a,b){assert.deepEqual(a,b);assertions++;}
function fixture(language,html=read('dashboard.html')) {
  const {document,Event}=parseHTML(html),storage=new Map([['dashboardLanguage',language]]);
  for(const select of document.querySelectorAll('[data-dashboard-language]')) Object.defineProperty(select,'value',{value:language,writable:true});
  const state={reloads:0};
  const context=vm.createContext({document,Event,console,Date,Intl,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    window:{confirm:()=>true,alert(){throw Error('unexpected alert');}},location:{reload(){state.reloads++;}}
  });
  vm.runInContext(languageSource,context);
  return {document,context,state};
}
// Verify placeholders and executable attributes across every translated source template.
const fixtureEN=fixture('en');
check(fixtureEN.context.dashboardApiError('Počet osob musí být od 2 do 20.'),'The number of guests must be between 2 and 20.');
check(fixtureEN.context.dashboardApiError('Rezervace musí celá proběhnout mezi 10:00 a 22:00.'),'The entire reservation must fit between 10:00 and 22:00.');
check(fixtureEN.context.dashboardApiError('Čas zasahuje do blokace: Čeká <private>'),'This time overlaps a blocked period: Čeká <private>');
check(fixtureEN.context.dashboardApiError('Unrecognized upstream message'),'Unrecognized upstream message');
check(fixtureEN.context.dashboardFoodCategory('Hlavní jídlo'),'Main course');
check(fixtureEN.context.dashboardFoodCategory('Vlastní kategorie'),'Vlastní kategorie');
const dictionary=JSON.parse(vm.runInContext('JSON.stringify(DASHBOARD_ENGLISH)',fixtureEN.context));
for(const [czech,english]of Object.entries(dictionary)) {
  check((english.match(/\{\d+\}/g)||[]).sort(),(czech.match(/\{\d+\}/g)||[]).sort());
  if(!/<[a-z/]/.test(czech))continue;
  const original=parseHTML('<html><body>'+czech+'</body></html>').document;
  const translated=parseHTML('<html><body>'+english+'</body></html>').document;
  for(const attr of ['value','onclick','onchange','data-reservation-status-value','data-customer-key','data-day','id']) {
    check([...translated.querySelectorAll(`[${attr}]`)].map(el=>el.getAttribute(attr)),[...original.querySelectorAll(`[${attr}]`)].map(el=>el.getAttribute(attr)));
  }
}
for(const language of ['cs','en']) {
  const f=fixture(language),{context,document}=f;
  Object.assign(context,{reservations:[],pendingStatusEmails:new Map(),reservationStatusUpdatesInFlight:new Set(),dashboardSessionVersion:1,currentRestaurantId:7,currentUserRole:'owner',currentUserId:'owner',
    getFilteredReservations:()=>[],getReservationTableLabel:()=>'<guest table>',getReservationGuestName:r=>r.name,
    renderTableSelect:()=>'<select><option value="7">Čeká</option></select>',isValidOptionalEmail:()=>true,formatDate:x=>x,
    roleLabel:role=>context.dashboardText({owner:'Majitel',manager:'Manažer',staff:'Obsluha'}[role]),
    teamMembers:[{id:9,role:'staff',full_name:'<img src=x onerror=alert(1)>',email:'staff@example.invalid',active:true,user_id:'staff'}],
    openingHours:[{day_of_week:1,is_open:false,open_time:'12:00',close_time:'22:00'}],
    DAY_NAMES:['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'].map(name=>context.dashboardText(name)),
    customerNoteDrafts:new Map(),getCustomerNoteDraftKey:key=>'7:'+key
  });
  for(const name of ['escapeHtml','getCalendarStatusLabel','renderReservations','renderTeamMembers','renderOpeningHours','renderCustomerSummary','renderCustomers']) vm.runInContext(extract(name),context);
  const raw={id:11,name:'Čeká',people:2,date:'2030-01-01',time:'18:00',status:'Potvrzeno',phone:'',email:'',note:'<script>guest</script>'};
  context.renderReservations([raw]);
  const row=document.querySelector('#reservationTable tr');
  check(row.querySelector('.status').textContent.trim(),language==='en'?'Confirmed':'Potvrzeno');
  check(row.querySelector('.status').className,'status Potvrzeno');
  check(row.querySelector('td').textContent.trim(),'Čeká');
  check(row.querySelector('script'),null);
  const cancel=row.querySelector('[data-reservation-status-value="Zrušeno"]');
  check(cancel.textContent.trim(),language==='en'?'Cancel':'Zrušit');
  check(cancel.getAttribute('onclick').includes("'Zrušeno'"),true);
  check(row.querySelector('select option').getAttribute('value'),'7');
  check(raw.status,'Potvrzeno');
  context.renderTeamMembers();
  check(document.querySelector('.team-name-line h3').textContent,'<img src=x onerror=alert(1)>');
  check(document.querySelector('.team-name-line img'),null);
  check(document.querySelector('.team-controls option[value="staff"]').textContent,language==='en'?'Staff':'Obsluha');
  check(document.querySelector('.team-action-button').textContent.trim(),language==='en'?'Deactivate':'Deaktivovat');
  context.renderOpeningHours();
  check(document.querySelector('.opening-day[data-day="1"] strong').textContent,language==='en'?'Monday':'Pondělí');
  check(document.querySelectorAll('.opening-day').length,7);
  check(document.querySelector('.opening-day[data-day="1"] .day-open').hasAttribute('checked'),false);
  const customer={name:'Restaurace',phone:'',email:'',key:'guest',isRegular:true,note:'Čeká',reservationCount:1,totalPeople:2,lastReservation:raw,reservations:[raw]};
  context.buildCustomers=()=>[customer];
  context.renderCustomers();
  check(document.querySelector('.customer-name-line h3').textContent,'⭐ Restaurace');
  check(document.querySelector('.customer-note-input').textContent,'Čeká');
  check(document.querySelector('.customer-reservation-history .status').textContent,language==='en'?'Confirmed':'Potvrzeno');
  check(document.querySelector('.customer-reservation-row span:nth-child(2)').textContent.trim(),language==='en'?'2 guests':'2 osob');
}
// The invitation must switch language without reloading or discarding its one-use session/password input.
{
  const f=fixture('cs',read('invite.html')), {context,document,state}=f;
  const password=document.getElementById('password');password.value='local-test-only';
  const listeners={};
  Object.assign(context,{supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})},sessionStorage:{setItem(){throw Error('No session may be saved in this fixture');}},window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},fetch:()=>{throw Error('No outbound request expected');},setTimeout});
  const inline=read('invite.html').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(inline,context);
  await listeners.DOMContentLoaded();
  check(document.getElementById('activateBtn').disabled,true);
  for(const language of ['en','cs','en']) {
    const select=document.getElementById('invitationLanguage');select.value=language;
    context.changeDashboardLanguage(select);
    check(document.documentElement.lang,language);check(state.reloads,0);check(password.value,'local-test-only');
    check(document.querySelector('h1').textContent,language==='en'?'👋 Welcome to the team':'👋 Vítejte v týmu');
    check(document.getElementById('message').textContent,language==='en'?'This invitation is invalid or has expired. Ask the owner for a new invitation.':'Pozvánka není platná nebo už vypršela. Požádej majitele o novou pozvánku.');
  }
}
console.log(`PASS ${assertions} operational language assertions: source placeholders, unchanged executable attributes, actual reservation/team/CRM/hour renders in both languages and live invitation translation without losing session input. No external calls.`);
