(function(){
  "use strict";

  const state = { summary:null, reportPhoto:null, foundPhoto:null, lockHeartbeat:null, opsTab:"overview" };
  const L = (en, es) => (window.I18N && I18N.getLang && I18N.getLang()==="es") ? es : en;

  async function api(path, options={}){
    const opts={ credentials:"same-origin", ...options };
    if(opts.body && typeof opts.body !== "string"){
      opts.headers={"content-type":"application/json", ...(opts.headers||{})};
      opts.body=JSON.stringify(opts.body);
    }
    const res=await fetch(path,opts);
    let body={}; try{ body=await res.json(); }catch(e){}
    if(!res.ok){ const err=new Error(body.error||("http_"+res.status)); err.status=res.status; err.body=body; throw err; }
    return body;
  }

  function fmt(ts){
    if(!ts) return "—";
    try{return new Date(ts).toLocaleString(I18N.getLang()==="es"?"es-US":"en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
    catch(e){return ts;}
  }
  function age(ts){
    if(!ts) return "";
    const m=Math.max(0,Math.round((Date.now()-new Date(ts).getTime())/60000));
    if(m<60) return `${m}m`;
    const h=Math.floor(m/60), mm=m%60;
    if(h<24) return `${h}h ${mm}m`;
    return `${Math.floor(h/24)}d ${h%24}h`;
  }
  function statusLabel(s){
    return ({new:L("New","Nuevo"),acknowledged:L("Acknowledged","Recibido"),in_progress:L("In progress","En proceso"),resolved:L("Resolved","Resuelto")})[s]||s;
  }
  function priorityLabel(p){ return ({low:L("Low","Baja"),normal:L("Normal","Normal"),high:L("High","Alta"),critical:L("Critical","Crítica")})[p]||p; }

  function injectShell(){
    const app=document.getElementById("app");
    const header=app && app.querySelector("header.topbar");
    if(header && !document.getElementById("opsBanner")){
      const b=document.createElement("div"); b.id="opsBanner"; b.className="ops-banner";
      b.innerHTML='<span class="ops-badge">NOTICE</span><span class="ops-message"></span><button type="button">×</button>';
      header.insertAdjacentElement("afterend",b);
      b.querySelector("button").onclick=()=>b.classList.remove("show");
    }

    const signout=document.getElementById("signOutBtn");
    if(signout && !document.getElementById("opsCenterBtn")){
      const sec=document.createElement("div"); sec.className="dr-sec";
      sec.innerHTML='<button class="dr-item" id="opsCenterBtn"><span class="di">⚙</span><span>Operations Center</span></button>';
      signout.closest(".dr-sec").insertAdjacentElement("beforebegin",sec);
      document.getElementById("opsCenterBtn").onclick=()=>{ closeDrawer(); openOps(); };
    }

    if(!document.getElementById("opsModal")){
      document.body.insertAdjacentHTML("beforeend", `
      <div class="report-modal ops-modal" id="opsModal">
        <div class="report-box">
          <div class="report-head">${L("Operations Center","Centro de Operaciones")}</div>
          <div class="ops-lock" id="opsLockInfo"></div>
          <div class="ops-tabs" id="opsTabs"></div>
          <div class="ops-content" id="opsContent"></div>
          <div class="report-foot"><button id="opsClose">${L("Close","Cerrar")}</button></div>
        </div>
      </div>`);
      document.getElementById("opsClose").onclick=()=>document.getElementById("opsModal").classList.remove("show");
      document.getElementById("opsModal").onclick=e=>{if(e.target.id==="opsModal") e.currentTarget.classList.remove("show");};
    }
  }

  function injectReportFields(){
    const reportBody=document.querySelector("#reportModal .report-body");
    if(reportBody && !document.getElementById("reportPriority")){
      const anchor=reportBody.querySelector(".report-q");
      const wrap=document.createElement("div");
      wrap.innerHTML=`<div class="ops-inline">
        <label class="ops-field"><span>${L("Priority","Prioridad")}</span><select id="reportPriority"><option value="normal">${L("Normal","Normal")}</option><option value="high">${L("High","Alta")}</option><option value="critical">${L("Critical","Crítica")}</option><option value="low">${L("Low","Baja")}</option></select></label>
        <div class="ops-field"><span>${L("Evidence photo","Foto de evidencia")}</span><div class="ops-photo-row"><button type="button" class="ops-photo-btn" id="reportPhotoBtn">📷 ${L("Add photo","Agregar foto")}</button><span class="ops-photo-state" id="reportPhotoState"></span></div><input id="reportPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></div>
      </div>`;
      anchor.insertAdjacentElement("beforebegin",wrap.firstElementChild);
      wirePhoto("report");
    }
    const foundBody=document.querySelector("#foundModal .report-body");
    if(foundBody && !document.getElementById("foundPriority")){
      const note=document.getElementById("foundNote")?.closest("label");
      const wrap=document.createElement("div");
      wrap.innerHTML=`<div class="ops-inline">
        <label class="ops-field"><span>${L("Priority","Prioridad")}</span><select id="foundPriority"><option value="normal">${L("Normal","Normal")}</option><option value="high">${L("High","Alta")}</option><option value="critical">${L("Critical","Crítica")}</option><option value="low">${L("Low","Baja")}</option></select></label>
        <div class="ops-field"><span>${L("Evidence photo","Foto de evidencia")}</span><div class="ops-photo-row"><button type="button" class="ops-photo-btn" id="foundPhotoBtn">📷 ${L("Add photo","Agregar foto")}</button><span class="ops-photo-state" id="foundPhotoState"></span></div><input id="foundPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></div>
      </div>`;
      note.insertAdjacentElement("afterend",wrap.firstElementChild);
      wirePhoto("found");
    }
    const foot=document.querySelector("#reportModal .report-foot");
    if(foot && !document.getElementById("verifyCurrentBtn")){
      foot.classList.add("spread");
      const v=document.createElement("div"); v.className="ops-verify"; v.id="verifyBox";
      v.innerHTML=`<div class="txt" id="verifyTxt">${L("Not verified yet","Aún no verificado")}</div><button type="button" id="shareSkuBtn">↗ ${L("Share","Compartir")}</button><button type="button" id="verifyCurrentBtn">✓ ${L("Verify location","Verificar ubicación")}</button>`;
      foot.insertAdjacentElement("beforebegin",v);
      document.getElementById("verifyCurrentBtn").onclick=verifyCurrent;
      document.getElementById("shareSkuBtn").onclick=shareCurrentSku;
    }
  }

  function wirePhoto(prefix){
    const btn=document.getElementById(prefix+"PhotoBtn"), inp=document.getElementById(prefix+"PhotoInput"), st=document.getElementById(prefix+"PhotoState");
    if(!btn||!inp) return;
    btn.onclick=()=>inp.click();
    inp.onchange=async()=>{
      const f=inp.files?.[0]; if(!f) return;
      st.textContent=L("Preparing…","Preparando…");
      try{
        const dataUrl=await compressImage(f);
        state[prefix+"Photo"]=dataUrl;
        st.textContent=L("Ready ✓","Lista ✓");
        btn.textContent="📷 "+L("Replace photo","Cambiar foto");
      }catch(e){ st.textContent=L("Could not read photo","No se pudo leer la foto"); }
    };
  }

  function compressImage(file){
    return new Promise((resolve,reject)=>{
      const rd=new FileReader(); rd.onerror=reject; rd.onload=()=>{
        const im=new Image(); im.onerror=reject; im.onload=()=>{
          const max=1600, scale=Math.min(1,max/Math.max(im.width,im.height));
          const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(im.width*scale)); c.height=Math.max(1,Math.round(im.height*scale));
          c.getContext("2d").drawImage(im,0,0,c.width,c.height);
          resolve(c.toDataURL("image/jpeg",.82));
        }; im.src=rd.result;
      }; rd.readAsDataURL(file);
    });
  }

  async function uploadPending(dataUrl, sku){
    if(!dataUrl) return null;
    const r=await api("/api/upload",{method:"POST",body:{dataUrl,sku}});
    return r.url||null;
  }

  function patchSubmitAlert(){
    if(typeof window.submitAlert!=="function" || window.submitAlert.__opsWrapped) return;
    const base=window.submitAlert;
    const wrapped=async function(payload){
      const isFound=payload?.type==="found"||payload?.type==="unknown";
      const pfx=isFound?"found":"report";
      const priority=document.getElementById(pfx+"Priority")?.value||"normal";
      const photo=state[pfx+"Photo"];
      let photoUrl=null;
      if(photo){
        try{ photoUrl=await uploadPending(photo,payload.sku||payload.rawCode||"unknown"); }
        catch(e){ toast(L("Photo upload failed; report will still be sent.","Falló la foto; el reporte se enviará igual.")); }
      }
      const out=await base(Object.assign({},payload,{priority,photoUrl}));
      state[pfx+"Photo"]=null;
      const input=document.getElementById(pfx+"PhotoInput"); if(input) input.value="";
      const ps=document.getElementById(pfx+"PhotoState"); if(ps) ps.textContent="";
      const pb=document.getElementById(pfx+"PhotoBtn"); if(pb) pb.textContent="📷 "+L("Add photo","Agregar foto");
      return out;
    };
    wrapped.__opsWrapped=true; window.submitAlert=wrapped;
  }

  async function patchAlert(id, patch){
    try{
      const body=await api("/api/alerts",{method:"PATCH",body:{id,...patch}});
      if(body.items){
        Sync.state.alerts=body.items; ALERTS=body.items; Sync.state.alertsRev=body.rev||Sync.state.alertsRev;
        renderAlerts(); applyAlertMarks(); renderAlertPins();
      }else await Sync.loadAlerts();
      return true;
    }catch(e){ toast(e.status===403?t("session.noPermission"):L("Could not update report","No se pudo actualizar el reporte")); return false; }
  }

  function overrideAlerts(){
    window.resolveAlert=async id=>{ if(await patchAlert(id,{status:"resolved"})) toast(t("alerts.resolved")); };
    window.renderAlerts=function(){
      updateAlertBadge();
      const body=document.getElementById("alertsBody");
      const list=ALERTS.filter(a=>alertFilter==="all"?true:alertFilter==="done"?a.status==="resolved":a.status!=="resolved");
      if(!list.length){ body.innerHTML=`<div class="alerts-none">${t("alerts.none")}</div>`; return; }
      body.innerHTML=list.map(a=>{
        const done=a.status==="resolved";
        const meta=[t("alerts.by",{name:a.by||"—"}),t("alerts.at",{date:I18N.fmtDate(a.createdAt)})].join(" · ");
        const canGo=!!(a.foundAt || findTileBySku(a.sku));
        const recur=Number(a.recurringCount||0);
        return `<div class="alert-item ${done?"done":""}" data-id="${esc(a.id)}">
          <div class="atitle"><span class="atype ${esc(a.type)}">${esc(alertTypeLabel(a.type))}</span><span>${esc(a.sku||a.rawCode||"?")}</span></div>
          <div class="amsg">${esc(alertMessage(a))}${a.note?" · "+esc(a.note):""}</div>
          <div class="ameta">${esc(meta)}</div>
          <div class="ops-alert-meta"><span class="ops-pill ${esc(a.status||"new")}">${esc(statusLabel(a.status||"new"))}</span><span class="ops-pill ${esc(a.priority||"normal")}">${esc(priorityLabel(a.priority||"normal"))}</span>${!done?`<span class="ops-pill">${esc(L("Open ","Abierta ")+age(a.createdAt))}</span>`:""}${a.assignedTo?`<span class="ops-pill">${esc(L("Owner: ","Resp: ")+a.assignedTo)}</span>`:""}${recur>=2?`<span class="ops-pill high">${recur}× / 30d</span>`:""}</div>
          ${a.photoUrl?`<img class="ops-alert-photo" src="${esc(a.photoUrl)}" alt="Alert evidence" />`:""}
          <div class="ops-alert-actions">
            ${canGo?`<button data-act="go">${esc(t("alerts.goto"))}</button>`:""}
            ${(!done&&canEdit())?`<button data-act="ack">${esc(L("Acknowledge","Recibir"))}</button><button data-act="progress">${esc(L("In progress","En proceso"))}</button><button data-act="assign">${esc(L("Assign","Asignar"))}</button><button data-act="priority">${esc(L("Priority","Prioridad"))}</button><button class="ok" data-act="resolve">${esc(t("alerts.resolve"))}</button>`:""}
            ${(canEdit()&&a.type==="found"&&a.foundAt)?`<button data-act="movehere">${esc(L("Move map here","Mover mapa aquí"))}</button><button data-act="secondary">${esc(L("Secondary spot","Lugar secundario"))}</button><button data-act="keephome">${esc(L("Keep original","Mantener original"))}</button>`:""}
          </div>
        </div>`;
      }).join("");
      body.querySelectorAll(".alert-item").forEach(item=>{
        const a=ALERTS.find(x=>String(x.id)===item.dataset.id); if(!a) return;
        item.querySelector('[data-act="go"]')?.addEventListener("click",e=>{e.stopPropagation(); alertGoto(a);});
        item.querySelector('[data-act="ack"]')?.addEventListener("click",()=>patchAlert(a.id,{status:"acknowledged"}));
        item.querySelector('[data-act="progress"]')?.addEventListener("click",()=>patchAlert(a.id,{status:"in_progress"}));
        item.querySelector('[data-act="assign"]')?.addEventListener("click",()=>{const who=prompt(L("Assign to","Asignar a"),a.assignedTo||"");if(who!==null)patchAlert(a.id,{assignedTo:who});});
        item.querySelector('[data-act="priority"]')?.addEventListener("click",()=>{const p=prompt(L("Priority: low, normal, high, critical","Prioridad: low, normal, high, critical"),a.priority||"normal");if(p&&["low","normal","high","critical"].includes(p.toLowerCase()))patchAlert(a.id,{priority:p.toLowerCase()});});
        item.querySelector('[data-act="resolve"]')?.addEventListener("click",()=>resolveAlert(a.id));
        item.querySelector('[data-act="movehere"]')?.addEventListener("click",()=>moveFoundAlert(a,"move"));
        item.querySelector('[data-act="secondary"]')?.addEventListener("click",()=>moveFoundAlert(a,"secondary"));
        item.querySelector('[data-act="keephome"]')?.addEventListener("click",()=>patchAlert(a.id,{status:"resolved"}));
      });
    };
  }

  async function moveFoundAlert(a,mode){
    if(!canEdit()||!a.foundAt) return;
    const hit=findTileBySku(a.sku);
    if(!hit){toast(L("SKU is not currently on the map","El SKU no está actualmente en el mapa"));return;}
    const tile=data.tiles[hit.i];
    if(mode==="move"){
      tile.x=Math.round(a.foundAt.x-(tile.w||TW)/2); tile.y=Math.round(a.foundAt.y-(tile.h||TH)/2);
    }else{
      const copy=Object.assign({},tile,{x:Math.round(a.foundAt.x-(tile.w||TW)/2),y:Math.round(a.foundAt.y-(tile.h||TH)/2)});
      data.tiles.push(copy);
    }
    save(); render(); rebuildSkuList();
    await patchAlert(a.id,{status:"resolved"});
    toast(mode==="move"?L("Map location updated","Ubicación del mapa actualizada"):L("Secondary location added","Ubicación secundaria agregada"));
  }

  function patchVerification(){
    if(typeof window.openTileReport!=="function" || window.openTileReport.__opsWrapped) return;
    const base=window.openTileReport;
    const wrapped=function(i){ base(i); refreshVerification(); };
    wrapped.__opsWrapped=true; window.openTileReport=wrapped;
  }
  async function refreshVerification(){
    const txt=document.getElementById("verifyTxt"); if(!txt||!reportCtx?.sku) return;
    txt.textContent=L("Checking last verification…","Buscando última verificación…");
    try{
      const r=await api("/api/verification?sku="+encodeURIComponent(reportCtx.sku));
      const v=r.items?.[0];
      txt.textContent=v?`${L("Last verified","Última verificación")}: ${fmt(v.verified_at)} · ${v.verified_by}`:L("Not verified yet","Aún no verificado");
    }catch(e){ txt.textContent=L("Verification unavailable","Verificación no disponible"); }
  }

  async function shareCurrentSku(){
    if(!reportCtx?.sku) return;
    const u=new URL(location.href); u.search=""; u.searchParams.set("sku",reportCtx.sku);
    try{
      if(navigator.share) await navigator.share({title:`Tarter Yard Map · ${reportCtx.sku}`,url:u.toString()});
      else if(navigator.clipboard) { await navigator.clipboard.writeText(u.toString()); toast(L("SKU link copied","Link del SKU copiado")); }
      else prompt(L("Copy this link","Copia este link"),u.toString());
    }catch(e){}
  }

  async function verifyCurrent(){
    if(!reportCtx?.sku) return;
    try{
      await api("/api/verification",{method:"POST",body:{sku:reportCtx.sku,location:reportCtx.at,groupName:groupName(reportCtx.g)}});
      toast(L("Location verified","Ubicación verificada")); refreshVerification();
    }catch(e){toast(L("Could not verify location","No se pudo verificar la ubicación"));}
  }

  async function refreshSummary(){
    if(!window.Sync||Sync.mode!=="remote") return;
    try{
      state.summary=await api("/api/ops-summary");
      paintBanner(); paintLockInfo(); applyZoneOverlays();
    }catch(e){}
  }
  function paintBanner(){
    const b=document.getElementById("opsBanner"); if(!b) return;
    const a=state.summary?.announcements?.[0];
    if(!a){b.classList.remove("show");return;}
    b.classList.toggle("urgent",a.severity==="urgent"); b.classList.add("show");
    b.querySelector(".ops-badge").textContent=a.severity==="urgent"?L("URGENT","URGENTE"):L("NOTICE","AVISO");
    b.querySelector(".ops-message").textContent=a.message;
  }
  function paintLockInfo(){
    const e=document.getElementById("opsLockInfo"); if(!e) return;
    const lock=state.summary?.lock;
    e.textContent=lock?`${L("Map editor lock","Bloqueo de edición")}: ${lock.holder_name} · ${L("expires","expira")} ${fmt(lock.expires_at)}`:L("No active edit lock","Sin bloqueo de edición activo");
  }

  function applyZoneOverlays(){
    const svg=document.getElementById("bg"); if(!svg||!state.summary?.zones) return;
    svg.querySelectorAll(".ops-zone-tag").forEach(n=>n.remove());
    state.summary.zones.filter(z=>z.status!=="active").forEach(z=>{
      const idx=(data.bg||[]).findIndex(it=>String(it.label||"").trim().toUpperCase()===String(z.zone_key||"").trim().toUpperCase());
      if(idx<0) return; const it=data.bg[idx], c=itemCenter(it);
      const ns="http://www.w3.org/2000/svg", g=document.createElementNS(ns,"g"); g.setAttribute("class","ops-zone-tag");
      const label=(z.status==="maintenance"?"MAINT":z.status==="restricted"?"RESTRICTED":"TEMP")+(z.note?" · "+z.note:"");
      const w=Math.min(260,Math.max(90,label.length*7));
      const r=document.createElementNS(ns,"rect"); r.setAttribute("x",c.cx-w/2);r.setAttribute("y",c.cy-15);r.setAttribute("width",w);r.setAttribute("height",24);r.setAttribute("rx",7);r.setAttribute("fill",z.status==="restricted"?"#7b2924":"#5f4815");r.setAttribute("stroke",z.status==="restricted"?"#E23A2E":"#FFC02E");
      const t=document.createElementNS(ns,"text");t.setAttribute("x",c.cx);t.setAttribute("y",c.cy+1);t.setAttribute("text-anchor","middle");t.setAttribute("fill","#fff");t.textContent=label;
      g.append(r,t);svg.appendChild(g);
    });
  }

  function patchBackground(){
    if(typeof window.drawBackground!=="function"||window.drawBackground.__opsWrapped)return;
    const base=window.drawBackground; const wrapped=function(){const r=base.apply(this,arguments);setTimeout(applyZoneOverlays,0);return r;}; wrapped.__opsWrapped=true; window.drawBackground=wrapped;
  }

  async function acquireLock(){
    if(Sync.mode!=="remote") return true;
    try{ const r=await api("/api/lock",{method:"POST",body:{action:"acquire"}}); state.summary=state.summary||{}; state.summary.lock=r.lock; paintLockInfo(); return true; }
    catch(e){ const h=e.body?.lock?.holder_name||L("another editor","otro editor"); toast(L(`Map is being edited by ${h}`,`El mapa está siendo editado por ${h}`)); return false; }
  }
  async function releaseLock(){ if(Sync.mode!=="remote")return; try{await api("/api/lock",{method:"POST",body:{action:"release"}});}catch(e){} }
  function patchEditLock(){
    const e=document.getElementById("editBtn"), b=document.getElementById("bgBtn");
    if(e&&!e.dataset.opsLock){const old=e.onclick;e.onclick=async ev=>{const starting=!editing;if(starting&&!(await acquireLock()))return;old?.call(e,ev);if(!editing&&!bgEditing)releaseLock();};e.dataset.opsLock="1";}
    if(b&&!b.dataset.opsLock){const old=b.onclick;b.onclick=async ev=>{const starting=!bgEditing;if(starting&&!(await acquireLock()))return;old?.call(b,ev);if(!editing&&!bgEditing)releaseLock();};b.dataset.opsLock="1";}
    state.lockHeartbeat=setInterval(()=>{if(editing||bgEditing)acquireLock();},45000);
    window.addEventListener("pagehide",()=>{if(editing||bgEditing)fetch("/api/lock",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({action:"release"}),keepalive:true}).catch(()=>{});});
  }

  function deepLink(){
    const sku=new URLSearchParams(location.search).get("sku"); if(!sku)return;
    let n=0; const timer=setInterval(()=>{
      n++; if(n>30){clearInterval(timer);return;}
      if(document.getElementById("app")?.hidden)return;
      try{const r=resolveSku(sku); if(r?.found&&r.tileIdx!=null){clearInterval(timer);document.getElementById("q").value=r.sku;flyTo(r.tileIdx);flashTile(r.tileIdx);}}
      catch(e){}
    },250);
  }

  function tabs(){
    const items=[{id:"overview",label:L("Overview","Resumen")}];
    if(canEdit()) items.push({id:"users",label:L("Users","Usuarios")},{id:"history",label:L("History / Undo","Historial / Deshacer")},{id:"recurring",label:L("Recurring issues","Problemas repetidos")},{id:"audit",label:L("Audit log","Registro")},{id:"announcements",label:L("Announcements","Avisos")},{id:"zones",label:L("Zone status","Estado de zonas")},{id:"handoff",label:L("Shift handoff","Cambio de turno")});
    const t=document.getElementById("opsTabs"); t.innerHTML=items.map(x=>`<button data-tab="${x.id}" class="${state.opsTab===x.id?"on":""}">${x.label}</button>`).join("");
    t.querySelectorAll("button").forEach(b=>b.onclick=()=>{state.opsTab=b.dataset.tab;paintOps();});
  }
  async function openOps(){document.getElementById("opsModal").classList.add("show");await refreshSummary();paintOps();}
  function row(main,sub,actions=""){return `<div class="ops-row"><div class="main"><b>${main}</b>${sub?`<small>${sub}</small>`:""}</div>${actions}</div>`;}
  function empty(msg){return `<div class="ops-empty">${msg}</div>`;}
  async function paintOps(){
    tabs(); const c=document.getElementById("opsContent"); c.innerHTML=empty(L("Loading…","Cargando…"));
    try{
      if(state.opsTab==="overview") return paintOverview(c);
      if(state.opsTab==="users") return paintUsers(c,await api("/api/users"));
      if(state.opsTab==="history") return paintHistory(c,await api("/api/history"));
      if(state.opsTab==="recurring") return paintRecurring(c,await api("/api/recurring?days=30"));
      if(state.opsTab==="audit") return paintAudit(c,await api("/api/audit"));
      if(state.opsTab==="announcements") return paintAnnouncements(c,await api("/api/announcements?all=1"));
      if(state.opsTab==="zones") return paintZones(c,await api("/api/zones"));
      if(state.opsTab==="handoff") return paintHandoff(c,await api("/api/handoff"));
    }catch(e){c.innerHTML=empty(L("Could not load this section","No se pudo cargar esta sección"));}
  }
  function paintOverview(c){
    const s=state.summary||{}; const anns=s.announcements||[], zones=(s.zones||[]).filter(z=>z.status!=="active"), h=s.handoffs?.[0];
    c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Current operations","Operación actual")}</div>
      <div class="ops-list">${anns.length?anns.map(a=>row(esc(a.message),`${esc(a.severity)} · ${fmt(a.created_at)}`)).join(""):empty(L("No active announcements","No hay avisos activos"))}</div>
      <div class="ops-title">${L("Zone status","Estado de zonas")}</div><div class="ops-list">${zones.length?zones.map(z=>row(esc(z.zone_key),`${esc(z.status)}${z.note?" · "+esc(z.note):""}`)).join(""):empty(L("All zones active","Todas las zonas activas"))}</div>
      <div class="ops-title">${L("Latest shift handoff","Último cambio de turno")}</div>${h?row(esc(h.shift_label),`${esc(h.summary)} · ${h.open_alerts_count} ${L("open alerts","alertas abiertas")} · ${fmt(h.created_at)}`):empty(L("No handoff recorded","No hay cambio de turno registrado"))}
    </div>`;
  }
  function paintUsers(c,r){
    c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Add user","Agregar usuario")}</div><div class="ops-form"><label class="ops-field"><span>${L("Name","Nombre")}</span><input id="uName"></label><label class="ops-field"><span>${L("Role","Rol")}</span><select id="uRole"><option value="viewer">Viewer</option><option value="editor">Admin / Editor</option></select></label><label class="ops-field wide"><span>${L("Access code","Código de acceso")}</span><input id="uCode" type="password"></label><button class="wide" id="uAdd">${L("Create user","Crear usuario")}</button></div><div class="ops-title">${L("Users","Usuarios")}</div><div class="ops-list">${(r.items||[]).map(u=>row(esc(u.name),`${esc(u.role)} · ${u.active?L("active","activo"):L("disabled","desactivado")} · ${L("last login","último acceso")}: ${fmt(u.lastLoginAt)}`,`<button data-user="${u.id}" data-act="role">${u.role==="editor"?"→ Viewer":"→ Admin"}</button><button data-user="${u.id}" data-act="code">${L("Reset code","Cambiar código")}</button><button data-user="${u.id}" data-act="active">${u.active?L("Disable","Desactivar"):L("Enable","Activar")}</button>`)).join("")||empty(L("No users","Sin usuarios"))}</div></div>`;
    document.getElementById("uAdd").onclick=async()=>{try{await api("/api/users",{method:"POST",body:{name:document.getElementById("uName").value,role:document.getElementById("uRole").value,code:document.getElementById("uCode").value}});paintOps();}catch(e){toast(L("Could not create user","No se pudo crear el usuario"));}};
    c.querySelectorAll("[data-user]").forEach(b=>b.onclick=async()=>{const u=r.items.find(x=>x.id===b.dataset.user);let body={id:u.id};if(b.dataset.act==="role")body.role=u.role==="editor"?"viewer":"editor";if(b.dataset.act==="active")body.active=!u.active;if(b.dataset.act==="code"){const code=prompt(L("New access code","Nuevo código de acceso"));if(code===null)return;body.code=code;}try{await api("/api/users",{method:"PATCH",body});paintOps();}catch(e){toast(L("Update failed","No se pudo actualizar"));}});
  }
  function paintHistory(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Map versions","Versiones del mapa")}</div><div class="ops-list">${(r.items||[]).map(h=>row(`Rev ${h.rev} · ${esc(h.action)}`,`${esc(h.updated_by||"—")} · ${fmt(h.updated_at)}`,`<button data-h="${h.id}">${L("Restore","Restaurar")}</button>`)).join("")||empty(L("No history yet","Aún no hay historial"))}</div></div>`;c.querySelectorAll("[data-h]").forEach(b=>b.onclick=async()=>{if(!confirm(L("Restore this map version? A new history entry will be created.","¿Restaurar esta versión? Se creará una nueva entrada en el historial.")))return;try{const rr=await api("/api/history",{method:"POST",body:{historyId:Number(b.dataset.h)}});applyRemoteState({data:rr.data,rev:rr.rev,reason:"restore"});toast(L("Map restored","Mapa restaurado"));paintOps();}catch(e){toast(L("Restore failed","Falló la restauración"));}});}
  function paintRecurring(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Repeated issues · last 30 days","Problemas repetidos · últimos 30 días")}</div><div class="ops-list">${(r.items||[]).map(x=>row(esc(x.sku),`${x.report_count} ${L("reports","reportes")} · ${L("last","último")}: ${fmt(x.last_report_at)}`)).join("")||empty(L("No repeated issues","No hay problemas repetidos"))}</div></div>`;}
  function paintAudit(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Recent activity","Actividad reciente")}</div><div class="ops-list">${(r.items||[]).map(x=>row(`${esc(x.actor)} · ${esc(x.action)}`,`${esc(x.entity_type)}${x.entity_id?" · "+esc(x.entity_id):""} · ${fmt(x.created_at)}`)).join("")||empty(L("No activity yet","Aún no hay actividad"))}</div></div>`;}
  function paintAnnouncements(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("New announcement","Nuevo aviso")}</div><div class="ops-form"><label class="ops-field wide"><span>${L("Message","Mensaje")}</span><textarea id="annMsg"></textarea></label><label class="ops-field"><span>${L("Severity","Severidad")}</span><select id="annSev"><option value="info">Info</option><option value="warning">Warning</option><option value="urgent">Urgent</option></select></label><button id="annAdd">${L("Publish","Publicar")}</button></div><div class="ops-title">${L("Announcements","Avisos")}</div><div class="ops-list">${(r.items||[]).map(a=>row(esc(a.message),`${esc(a.severity)} · ${a.active?L("active","activo"):L("inactive","inactivo")} · ${fmt(a.created_at)}`,`<button data-ann="${a.id}">${a.active?L("Deactivate","Desactivar"):L("Activate","Activar")}</button>`)).join("")||empty(L("No announcements","Sin avisos"))}</div></div>`;document.getElementById("annAdd").onclick=async()=>{try{await api("/api/announcements",{method:"POST",body:{message:document.getElementById("annMsg").value,severity:document.getElementById("annSev").value}});await refreshSummary();paintOps();}catch(e){toast(L("Publish failed","No se pudo publicar"));}};c.querySelectorAll("[data-ann]").forEach(b=>b.onclick=async()=>{const a=r.items.find(x=>x.id===b.dataset.ann);await api("/api/announcements",{method:"PATCH",body:{id:a.id,active:!a.active}});await refreshSummary();paintOps();});}
  function paintZones(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Set zone status","Cambiar estado de zona")}</div><div class="ops-form"><label class="ops-field"><span>${L("Exact map zone label","Nombre exacto de zona")}</span><input id="zName" placeholder="CUSTOMER PICKUP"></label><label class="ops-field"><span>${L("Status","Estado")}</span><select id="zStatus"><option value="active">Active</option><option value="restricted">Restricted</option><option value="temporary">Temporary</option><option value="maintenance">Maintenance</option></select></label><label class="ops-field wide"><span>${L("Note","Nota")}</span><input id="zNote"></label><button class="wide" id="zSave">${L("Save zone status","Guardar estado")}</button></div><div class="ops-list">${(r.items||[]).map(z=>row(esc(z.zone_key),`${esc(z.status)}${z.note?" · "+esc(z.note):""} · ${fmt(z.updated_at)}`)).join("")||empty(L("No custom zone statuses","Sin estados especiales"))}</div></div>`;document.getElementById("zSave").onclick=async()=>{try{await api("/api/zones",{method:"POST",body:{zoneKey:document.getElementById("zName").value,status:document.getElementById("zStatus").value,note:document.getElementById("zNote").value}});await refreshSummary();paintOps();}catch(e){toast(L("Zone update failed","No se pudo actualizar la zona"));}};}
  function paintHandoff(c,r){c.innerHTML=`<div class="ops-section"><div class="ops-title">${L("Create shift handoff","Crear cambio de turno")}</div><div class="ops-form"><label class="ops-field"><span>${L("Shift label","Turno")}</span><input id="hLabel" placeholder="Day → Night"></label><label class="ops-field wide"><span>${L("Summary","Resumen")}</span><textarea id="hSummary"></textarea></label><button class="wide" id="hSave">${L("Save handoff","Guardar cambio")}</button></div><div class="ops-title">${L("Recent handoffs","Cambios recientes")}</div><div class="ops-list">${(r.items||[]).map(h=>row(esc(h.shift_label),`${esc(h.summary)} · ${h.open_alerts_count} ${L("open alerts","alertas abiertas")} · ${esc(h.created_by)} · ${fmt(h.created_at)}`)).join("")||empty(L("No handoffs yet","Aún no hay cambios de turno"))}</div></div>`;document.getElementById("hSave").onclick=async()=>{try{await api("/api/handoff",{method:"POST",body:{shiftLabel:document.getElementById("hLabel").value,summary:document.getElementById("hSummary").value}});await refreshSummary();paintOps();}catch(e){toast(L("Handoff save failed","No se pudo guardar"));}};}

  function registerPwa(){
    if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("/sw.js").catch(()=>{});
  }

  function init(){
    injectShell(); injectReportFields(); patchSubmitAlert(); patchVerification(); overrideAlerts(); patchBackground(); patchEditLock(); registerPwa(); deepLink();
    try{ if(!document.getElementById("app")?.hidden) renderAlerts(); }catch(e){}
    const wait=setInterval(()=>{if(window.Sync&&Sync.mode!=="unknown"){clearInterval(wait);refreshSummary();setInterval(refreshSummary,60000);}},500);
    if(window.I18N?.onLangChange) I18N.onLangChange(()=>{injectShell();paintBanner();if(document.getElementById("opsModal")?.classList.contains("show"))paintOps();});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
