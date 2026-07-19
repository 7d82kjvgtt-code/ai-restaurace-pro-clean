const SUPABASE_URL="https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY="sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

let reservations=[],foods=[],editingFoodId=null,editingImageUrl="";
let reservationChart=null,statusChart=null;

document.addEventListener("DOMContentLoaded",async()=>{
  setupNavigation();
  document.getElementById("search")?.addEventListener("input",applyFilters);
  document.getElementById("statusFilter")?.addEventListener("change",applyFilters);

  if(await ensureValidSession()){
    hideLogin();
    await Promise.all([loadReservations(),loadFoods()]);
  }else{
    showLogin();
  }
});

function setupNavigation(){
  document.querySelectorAll(".sidebar nav a").forEach(link=>{
    link.addEventListener("click",function(){
      document.querySelectorAll(".sidebar nav a").forEach(item=>item.classList.remove("active"));
      this.classList.add("active");
    });
  });
}

function showLogin(){document.getElementById("loginScreen").style.display="flex"}
function hideLogin(){document.getElementById("loginScreen").style.display="none"}
function getAccessToken(){return sessionStorage.getItem("supabaseAccessToken")}
function getRefreshToken(){return sessionStorage.getItem("supabaseRefreshToken")}
function clearSession(){
  sessionStorage.removeItem("dashboardLoggedIn");
  sessionStorage.removeItem("supabaseAccessToken");
  sessionStorage.removeItem("supabaseRefreshToken");
}
function getHeaders(extra={}){
  return{
    apikey:SUPABASE_KEY,
    Authorization:`Bearer ${getAccessToken()}`,
    "Content-Type":"application/json",
    ...extra
  };
}
function parseJwt(token){
  try{
    const part=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join("")));
  }catch{return null}
}
function tokenNeedsRefresh(){
  const token=getAccessToken();
  if(!token)return true;
  const payload=parseJwt(token);
  return !payload?.exp||payload.exp*1000<=Date.now()+60000;
}
async function refreshSession(){
  const refreshToken=getRefreshToken();
  if(!refreshToken)return false;
  try{
    const response=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{
      method:"POST",
      headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({refresh_token:refreshToken})
    });
    const data=await response.json();
    if(!response.ok||!data.access_token)return false;
    sessionStorage.setItem("dashboardLoggedIn","true");
    sessionStorage.setItem("supabaseAccessToken",data.access_token);
    if(data.refresh_token)sessionStorage.setItem("supabaseRefreshToken",data.refresh_token);
    return true;
  }catch{return false}
}
async function ensureValidSession(){
  if(!getAccessToken())return false;
  if(!tokenNeedsRefresh())return true;
  const ok=await refreshSession();
  if(!ok)clearSession();
  return ok;
}
async function authorizedFetch(url,options={}){
  if(!(await ensureValidSession())){
    showLogin();
    throw new Error("Přihlášení vypršelo.");
  }
  let response=await fetch(url,{...options,headers:options.headers||getHeaders()});
  if(response.status===401&&await refreshSession()){
    response=await fetch(url,{...options,headers:options.headers||getHeaders()});
  }
  if(response.status===401){
    clearSession();
    showLogin();
  }
  return response;
}

async function login(event){
  event?.preventDefault();
  const emailInput=document.getElementById("loginEmail");
  const passwordInput=document.getElementById("password");
  const error=document.getElementById("error");
  const button=document.getElementById("loginButton");
  const email=emailInput.value.trim(),password=passwordInput.value;

  if(!email||!password){error.textContent="Vyplň e-mail a heslo.";return}

  button.disabled=true;
  error.textContent="Přihlašuji...";

  try{
    const response=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{
      method:"POST",
      headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({email,password})
    });
    const data=await response.json();

    if(!response.ok||!data.access_token){
      error.textContent="Nesprávný e-mail nebo heslo.";
      passwordInput.value="";
      return;
    }

    sessionStorage.setItem("dashboardLoggedIn","true");
    sessionStorage.setItem("supabaseAccessToken",data.access_token);
    sessionStorage.setItem("supabaseRefreshToken",data.refresh_token);
    passwordInput.value="";
    error.textContent="";
    hideLogin();
    await Promise.all([loadReservations(),loadFoods()]);
  }catch(err){
    console.error(err);
    error.textContent="Přihlášení se nepodařilo.";
  }finally{
    button.disabled=false;
  }
}
function logoutDashboard(){clearSession();location.reload()}

function getLocalDateString(date=new Date()){
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().split("T")[0];
}
function formatDate(date){
  if(!date)return"-";
  const p=date.split("-");
  return p.length===3?`${p[2]}.${p[1]}.${p[0]}`:date;
}
function escapeHtml(value){
  return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

async function loadReservations(){
  const table=document.getElementById("reservationTable");
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`);
    const data=await response.json();
    if(!response.ok)throw new Error(JSON.stringify(data));
    reservations=Array.isArray(data)?data:[];
    updateStatistics();
    renderReservations(reservations);
    renderCharts();
  }catch(error){
    console.error(error);
    table.innerHTML='<tr><td colspan="9">Nepodařilo se načíst rezervace.</td></tr>';
  }
}
function updateStatistics(){
  const today=getLocalDateString();
  document.getElementById("todayCount").textContent=reservations.filter(r=>r.date===today).length;
  document.getElementById("totalCount").textContent=reservations.length;
  document.getElementById("pendingCount").textContent=reservations.filter(r=>(r.status||"Čeká")==="Čeká").length;
}
function renderReservations(data){
  const table=document.getElementById("reservationTable");
  if(!data.length){table.innerHTML='<tr><td colspan="9">Žádné rezervace.</td></tr>';return}

  table.innerHTML=data.map(r=>`
    <tr>
      <td>${escapeHtml(r.name||"-")}</td>
      <td>${escapeHtml(r.people||"-")}</td>
      <td>${escapeHtml(formatDate(r.date))}</td>
      <td>${escapeHtml(r.time||"-")}</td>
      <td>${r.phone?`<a class="contactLink" href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a>`:"-"}</td>
      <td>${r.email?`<a class="contactLink" href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`:"-"}</td>
      <td>${escapeHtml(r.note||"-")}</td>
      <td><span class="status ${escapeHtml(r.status||"Čeká")}">${escapeHtml(r.status||"Čeká")}</span></td>
      <td><div class="tableActions">
        <button class="editBtn" onclick="editReservation(${Number(r.id)})">✏️</button>
        <button onclick="updateStatus(${Number(r.id)},'Potvrzeno')">✅</button>
        <button onclick="updateStatus(${Number(r.id)},'Zrušeno')">❌</button>
        <button class="deleteBtn" onclick="deleteReservation(${Number(r.id)})">🗑️</button>
      </div></td>
    </tr>`).join("");
}
async function updateStatus(id,status){
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,{
      method:"PATCH",headers:getHeaders(),body:JSON.stringify({status})
    });
    if(!response.ok)throw new Error(await response.text());
    await loadReservations();
  }catch(error){console.error(error);alert("Nepodařilo se změnit stav.")}
}
async function deleteReservation(id){
  if(!confirm("Opravdu smazat rezervaci?"))return;
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,{method:"DELETE",headers:getHeaders()});
    if(!response.ok)throw new Error(await response.text());
    await loadReservations();
  }catch(error){console.error(error);alert("Nepodařilo se smazat rezervaci.")}
}
function getFilteredReservations(){
  const search=document.getElementById("search").value.toLowerCase().trim();
  const status=document.getElementById("statusFilter").value;
  return reservations.filter(r=>{
    const text=[r.name,r.phone,r.email].join(" ").toLowerCase();
    return text.includes(search)&&(!status||(r.status||"Čeká")===status);
  });
}
function applyFilters(){renderReservations(getFilteredReservations())}
function resetFilters(){
  document.getElementById("search").value="";
  document.getElementById("statusFilter").value="";
  renderReservations(reservations);
}
function editReservation(id){
  const r=reservations.find(item=>item.id===id);
  if(!r)return;
  const name=prompt("Jméno:",r.name||"");if(name===null)return;
  const people=prompt("Počet osob:",r.people||"");if(people===null)return;
  const date=prompt("Datum RRRR-MM-DD:",r.date||"");if(date===null)return;
  const time=prompt("Čas HH:MM:",r.time||"");if(time===null)return;
  const phone=prompt("Telefon:",r.phone||"");if(phone===null)return;
  const email=prompt("E-mail:",r.email||"");if(email===null)return;
  const note=prompt("Poznámka:",r.note||"");if(note===null)return;
  updateReservation(id,{name:name.trim(),people:Number(people),date,time,phone:phone.trim(),email:email.trim(),note:note.trim()});
}
async function updateReservation(id,data){
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,{
      method:"PATCH",headers:getHeaders(),body:JSON.stringify(data)
    });
    if(!response.ok)throw new Error(await response.text());
    await loadReservations();
  }catch(error){console.error(error);alert("Nepodařilo se upravit rezervaci.")}
}
function exportReservations(){
  const data=getFilteredReservations();
  if(!data.length){alert("Nejsou žádné rezervace ke stažení.");return}
  const columns=["Jméno","Počet osob","Datum","Čas","Telefon","E-mail","Poznámka","Stav"];
  const rows=data.map(r=>[r.name||"",r.people||"",r.date||"",r.time||"",r.phone||"",r.email||"",r.note||"",r.status||"Čeká"]);
  const quote=v=>`"${String(v).replace(/"/g,'""')}"`;
  const csv=[columns.map(quote).join(";"),...rows.map(row=>row.map(quote).join(";"))].join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`rezervace-${getLocalDateString()}.csv`;
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}

function renderCharts(){
  if(typeof Chart==="undefined")return;
  Chart.defaults.color="#cbd5e1";
  Chart.defaults.borderColor="rgba(148,163,184,.15)";

  const labels=[],counts=[];
  for(let i=6;i>=0;i--){
    const date=new Date();date.setDate(date.getDate()-i);
    const key=getLocalDateString(date);
    labels.push(date.toLocaleDateString("cs-CZ",{weekday:"short",day:"numeric",month:"numeric"}));
    counts.push(reservations.filter(r=>r.date===key).length);
  }

  reservationChart?.destroy();
  reservationChart=new Chart(document.getElementById("reservationChart"),{
    type:"bar",
    data:{labels,datasets:[{label:"Rezervace",data:counts,backgroundColor:"rgba(255,90,31,.75)",borderColor:"#ff5a1f",borderWidth:1,borderRadius:8}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}},x:{grid:{display:false}}}}
  });

  const statuses=["Čeká","Potvrzeno","Zrušeno"];
  statusChart?.destroy();
  statusChart=new Chart(document.getElementById("statusChart"),{
    type:"doughnut",
    data:{labels:statuses,datasets:[{data:statuses.map(s=>reservations.filter(r=>(r.status||"Čeká")===s).length),backgroundColor:["#f59e0b","#22c55e","#ef4444"],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"65%",plugins:{legend:{position:"bottom",labels:{padding:18,usePointStyle:true}}}}
  });
}

async function loadFoods(){
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`);
    const data=await response.json();
    if(!response.ok)throw new Error(JSON.stringify(data));
    foods=Array.isArray(data)?data:[];
    document.getElementById("foodCount").textContent=foods.length;
    renderFoods();
  }catch(error){
    console.error(error);
    document.getElementById("foodList").innerHTML="<p>Nepodařilo se načíst menu.</p>";
  }
}
async function saveFood(){
  const name=document.getElementById("foodName").value.trim();
  const price=document.getElementById("foodPrice").value.trim();
  const emoji=document.getElementById("foodEmoji").value.trim()||"🍽️";
  const category=document.getElementById("foodCategory").value;
  const description=document.getElementById("foodDescription").value.trim();
  const ingredients=document.getElementById("foodIngredients").value.trim();
  const allergens=document.getElementById("foodAllergens").value.trim();
  const weight=document.getElementById("foodWeight").value.trim();
  const imageFile=document.getElementById("foodImage").files?.[0];

  if(!name||!price){alert("Vyplň název i cenu.");return}
  let image_url=editingImageUrl||"";

  try{
    if(imageFile){
      const extension=imageFile.name.split(".").pop();
      const fileName=`${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const upload=await authorizedFetch(`${SUPABASE_URL}/storage/v1/object/food-images/${fileName}`,{
        method:"POST",
        headers:getHeaders({"Content-Type":imageFile.type,"x-upsert":"true"}),
        body:imageFile
      });
      if(!upload.ok)throw new Error(await upload.text());
      image_url=`${SUPABASE_URL}/storage/v1/object/public/food-images/${fileName}`;
    }

    const foodData={name,price:Number(price),emoji,image_url,category,description,ingredients,allergens,weight};
    const editing=editingFoodId!==null;
    const url=editing?`${SUPABASE_URL}/rest/v1/menu?id=eq.${editingFoodId}`:`${SUPABASE_URL}/rest/v1/menu`;
    const response=await authorizedFetch(url,{method:editing?"PATCH":"POST",headers:getHeaders(),body:JSON.stringify(foodData)});
    if(!response.ok)throw new Error(await response.text());
    resetFoodForm();
    await loadFoods();
  }catch(error){
    console.error(error);
    alert("Nepodařilo se uložit jídlo nebo nahrát fotku.");
  }
}
function renderFoods(){
  const list=document.getElementById("foodList");
  if(!foods.length){list.innerHTML="<p>Žádná jídla.</p>";return}
  list.innerHTML=foods.map(food=>`
    <div class="foodItem">
      ${food.image_url?`<img src="${escapeHtml(food.image_url)}" class="foodPhoto" alt="${escapeHtml(food.name||"Jídlo")}">`:`<div class="foodPhoto" style="display:grid;place-items:center;font-size:30px;background:#0f172a">${escapeHtml(food.emoji||"🍽️")}</div>`}
      <div class="foodInfo">
        <b>${escapeHtml(food.emoji||"🍽️")} ${escapeHtml(food.name||"Bez názvu")}</b>
        <div class="foodPrice">${escapeHtml(food.price||0)} Kč</div>
        <small>${escapeHtml(food.category||"Bez kategorie")}</small>
      </div>
      <div class="foodActions">
        <button class="editBtn" onclick="editFood(${Number(food.id)})">✏️</button>
        <button class="deleteBtn" onclick="deleteFood(${Number(food.id)})">🗑️</button>
      </div>
    </div>`).join("");
}
function editFood(id){
  const food=foods.find(item=>item.id===id);if(!food)return;
  editingFoodId=food.id;editingImageUrl=food.image_url||"";
  document.getElementById("foodName").value=food.name||"";
  document.getElementById("foodPrice").value=food.price||"";
  document.getElementById("foodEmoji").value=food.emoji||"";
  document.getElementById("foodCategory").value=food.category||"Pizza";
  document.getElementById("foodDescription").value=food.description||"";
  document.getElementById("foodIngredients").value=food.ingredients||"";
  document.getElementById("foodAllergens").value=food.allergens||"";
  document.getElementById("foodWeight").value=food.weight||"";
  document.getElementById("foodBtn").textContent="Uložit změny";
  document.getElementById("cancelEditBtn").style.display="inline-block";
  document.getElementById("foodName").scrollIntoView({behavior:"smooth",block:"center"});
}
function resetFoodForm(){
  editingFoodId=null;editingImageUrl="";
  ["foodName","foodPrice","foodEmoji","foodDescription","foodIngredients","foodAllergens","foodWeight"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("foodImage").value="";
  document.getElementById("foodBtn").textContent="Přidat jídlo";
  document.getElementById("cancelEditBtn").style.display="none";
}
async function deleteFood(id){
  if(!confirm("Opravdu smazat jídlo?"))return;
  try{
    const response=await authorizedFetch(`${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`,{method:"DELETE",headers:getHeaders()});
    if(!response.ok)throw new Error(await response.text());
    if(editingFoodId===id)resetFoodForm();
    await loadFoods();
  }catch(error){console.error(error);alert("Nepodařilo se smazat jídlo.")}
}
