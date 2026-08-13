// ===== SUPABASE設定（純粋fetch版）=====
var SUPA_URL = 'https://kidxeqjovvakcqalblre.supabase.co';
var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZHhlcWpvdnZha2NxYWxibHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjcxMjYsImV4cCI6MjA4OTQwMzEyNn0.YHz0cVTpwQi1zBAZyZuFImDJv2gKQo9HUyC8w86tgsI';

function getSupaHeaders() {
  return {
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

function supaUpsertOnce(table, data) {
  return fetch(SUPA_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: Object.assign({}, getSupaHeaders(), {'Prefer': 'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify(data)
  }).then(function(r){
    if(!r.ok) return r.text().then(function(t){console.error('upsert err',table,t);return Promise.reject(t);});
    return true;
  });
}
function supaUpsert(table, data, _attempt) {
  _attempt = _attempt || 1;
  return supaUpsertOnce(table, data).then(function(res){
    if(table!=='pos_logs' && table!=='pos_presence')setSaveStatus(true);
    return res;
  }).catch(function(e){
    if(_attempt < 3){
      return new Promise(function(res){setTimeout(res, 1000*_attempt);})
        .then(function(){return supaUpsert(table, data, _attempt+1);});
    }
    console.error('upsert failed after retries', table, e);
    if(table!=='pos_logs' && table!=='pos_presence'){
      setSaveStatus(false);
      if(typeof toast === 'function') toast('⚠️ クラウド保存に失敗しました（このデバイスには保存済み）。電波を確認してください', true);
    }
    try{
      var q=JSON.parse(localStorage.getItem('wc_sync_queue')||'[]');
      q.push({table:table,data:data,ts:Date.now()});
      localStorage.setItem('wc_sync_queue',JSON.stringify(q));
    }catch(qe){}
  });
}
function setSaveStatus(ok){
  var el=document.getElementById('save-status');if(!el)return;
  var t=new Date();var hh=String(t.getHours()).padStart(2,'0'),mm=String(t.getMinutes()).padStart(2,'0');
  if(ok){
    el.textContent='💾 保存済み '+hh+':'+mm;
    el.style.background='rgba(255,255,255,.25)';el.style.color='#fff';
  }else{
    el.textContent='⚠️ 未保存 '+hh+':'+mm;
    el.style.background='#fff';el.style.color='#e8838f';
  }
}
function flushSyncQueue(){
  var q=JSON.parse(localStorage.getItem('wc_sync_queue')||'[]');
  if(q.length===0)return;
  localStorage.setItem('wc_sync_queue','[]');
  q.forEach(function(item){supaUpsert(item.table,item.data);});
}
function getPendingSyncKeys(table){
  var q=JSON.parse(localStorage.getItem('wc_sync_queue')||'[]');
  var keys={};
  q.filter(function(item){return item.table===table;}).forEach(function(item){
    var k=item.data.id!==undefined?String(item.data.id):String(item.data.date);
    keys[k]=true;
  });
  return keys;
}

function supaDeleteOnce(table, id) {
  return fetch(SUPA_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(String(id)), {
    method: 'DELETE',
    headers: getSupaHeaders()
  }).then(function(r){
    if(!r.ok) return r.text().then(function(t){console.error('delete err',table,t);return Promise.reject(t);});
    return true;
  });
}
function supaDelete(table, id, _attempt) {
  _attempt = _attempt || 1;
  // 削除待ちとして記録しておく（クラウド側の削除が終わるまで、読み込み時に復活させないため）
  try{
    var dq=JSON.parse(localStorage.getItem('wc_delete_queue')||'[]');
    if(!dq.some(function(x){return x.table===table&&String(x.id)===String(id);})){
      dq.push({table:table,id:String(id)});
      localStorage.setItem('wc_delete_queue',JSON.stringify(dq));
    }
  }catch(qe){}
  return supaDeleteOnce(table, id).then(function(res){
    removeFromDeleteQueue(table,id);
    return res;
  }).catch(function(e){
    if(_attempt < 3){
      return new Promise(function(res){setTimeout(res, 1000*_attempt);})
        .then(function(){return supaDelete(table, id, _attempt+1);});
    }
    console.error('delete failed after retries', table, id, e);
    if(typeof toast === 'function') toast('⚠️ クラウドからの削除に失敗しました。電波を確認してください', true);
  });
}
function removeFromDeleteQueue(table,id){
  try{
    var dq=JSON.parse(localStorage.getItem('wc_delete_queue')||'[]');
    dq=dq.filter(function(x){return !(x.table===table&&String(x.id)===String(id));});
    localStorage.setItem('wc_delete_queue',JSON.stringify(dq));
  }catch(qe){}
}
function flushDeleteQueue(){
  var dq=JSON.parse(localStorage.getItem('wc_delete_queue')||'[]');
  dq.forEach(function(item){supaDelete(item.table,item.id);});
}
function getPendingDeleteIds(table){
  var dq=JSON.parse(localStorage.getItem('wc_delete_queue')||'[]');
  var ids={};dq.forEach(function(x){if(x.table===table)ids[x.id]=true;});
  return ids;
}

function supaLoad(table) {
  return fetch(SUPA_URL + '/rest/v1/' + table + '?select=*', {
    method: 'GET',
    headers: getSupaHeaders()
  }).then(function(r){
    if(!r.ok) {
      // テーブルが存在しない(404)場合はエラー表示せず静かに空扱い
      if(r.status===404){return null;}
      r.text().then(function(t){
        // PGRST205（テーブル未検出）も静かに無視
        if(t && t.indexOf('PGRST205')>=0) return;
        console.error('load err',table,t);
      });
      return null;
    }
    return r.json();
  }).catch(function(e){console.error('load err',table,e.message);return null;});
}

function manualRefresh(){
  var btn=document.getElementById('refresh-btn');
  if(btn){btn.style.transition='transform .6s';btn.style.transform='rotate(360deg)';setTimeout(function(){btn.style.transform='rotate(0deg)';},600);}
  toast('最新データを取得中...');
  loadFromSupabase();
}
function loadFromSupabase() {
  console.log('Loading from Supabase...');
  var tables = ['pos_guests','pos_merch','pos_merch_items','pos_customers','pos_cash','pos_settings','pos_cheki'];
  Promise.all(tables.map(supaLoad)).then(function(results) {
    var guests=results[0], merch=results[1], merchItems=results[2];
    var customers=results[3], cash=results[4], settings=results[5], cheki=results[6];

    flushSyncQueue();
    flushDeleteQueue();
    if(guests) {
      var pendingDelG=getPendingDeleteIds('pos_guests');
      var cloudG = guests.filter(function(g){return !pendingDelG[String(g.id)];}).map(function(g){return {
        id:g.id, d:g.date, tp:g.type, pt:g.pattern, member:g.member||'', operator:g.operator||'',
        a:g.adults, c:g.children, ci:g.checkin, co:g.checkout,
        pr:g.price, st:g.status, fn:g.free_nyan,
        bc:g.binder_color, bcn:g.binder_name, mo:g.memo, aq:g.survey||{}
      };});
      var cloudGIds={};cloudG.forEach(function(g){cloudGIds[String(g.id)]=true;});
      var pendingG=getPendingSyncKeys('pos_guests');
      var localGOnly=JSON.parse(localStorage.getItem('wc_g')||'[]').filter(function(g){return !cloudGIds[String(g.id)]&&pendingG[String(g.id)];});
      if(localGOnly.length>0){localGOnly.forEach(function(g){saveGuestToSupa(g);});}
      G = cloudG.concat(localGOnly);
    }
    if(merch) {
      var pendingDelMS=getPendingDeleteIds('pos_merch');
      var cloudMS = merch.filter(function(m){return !pendingDelMS[String(m.date)];}).map(function(m){return {id:m.id,d:m.date,i:m.items,total:m.total};});
      var cloudMSDates={};cloudMS.forEach(function(m){cloudMSDates[m.d]=true;});
      var pendingMS=getPendingSyncKeys('pos_merch');
      var localMSOnly=JSON.parse(localStorage.getItem('wc_ms')||'[]').filter(function(m){return !cloudMSDates[m.d]&&pendingMS[m.d];});
      if(localMSOnly.length>0){localMSOnly.forEach(function(m){saveMerchToSupa(m);});}
      MS = cloudMS.concat(localMSOnly);
    }
    if(merchItems && merchItems.length>0) {
      MI = merchItems.sort(function(a,b){return a.sort_order-b.sort_order;})
        .map(function(m){return {id:m.id,n:m.name,p:m.price};});
    }
    if(customers) {
      var pendingDelCU=getPendingDeleteIds('pos_customers');
      var cloudCU = customers.filter(function(c){return !pendingDelCU[String(c.id)];}).map(function(c){return {
        id:c.id, memberNo:c.member_no, name:c.name,
        look:c.look, pref:c.pref, alert:c.alert, birth:c.birth, photo:c.photo,
        trigger:c.trigger_list||[], companion:c.companion||[],
        gacha:c.gacha, oshiCats:c.oshi_cats||[],
        visits:c.visits||[], memos:c.memos||[]
      };});
      var cloudCUIds={};cloudCU.forEach(function(c){cloudCUIds[String(c.id)]=true;});
      var pendingCU=getPendingSyncKeys('pos_customers');
      var localCUOnly=JSON.parse(localStorage.getItem('wc_cu')||'[]').filter(function(c){return !cloudCUIds[String(c.id)]&&pendingCU[String(c.id)];});
      if(localCUOnly.length>0){localCUOnly.forEach(function(c){saveCustomerToSupa(c);});}
      CU = cloudCU.concat(localCUOnly);
    }
    if(cash) {
      var pendingDelCR=getPendingDeleteIds('pos_cash');
      var cloudCR = cash.filter(function(c){return !pendingDelCR[String(c.id)];}).map(function(c){return Object.assign({},c.data,{d:c.date,id:c.id});});
      var cloudCRIds={};cloudCR.forEach(function(c){cloudCRIds[String(c.id)]=true;});
      var pendingCR=getPendingSyncKeys('pos_cash');
      var localCROnly=JSON.parse(localStorage.getItem('wc_cr')||'[]').filter(function(c){return !cloudCRIds[String(c.id||c.d)]&&pendingCR[String(c.id||c.d)];});
      if(localCROnly.length>0){localCROnly.forEach(function(c){saveCashToSupa(c);});}
      CR = cloudCR.concat(localCROnly);
    }
    if(settings) {
      var ps=settings.find(function(s){return s.key==='price';});
      if(ps) Price=Object.assign({},DefaultPrice,ps.value);
      var bs=settings.find(function(s){return s.key==='binder_colors';});
      if(bs) BCs=bs.value;
      var cs=settings.find(function(s){return s.key==='cats';});
      if(cs) Cats=cs.value;
      var ts=settings.find(function(s){return s.key==='triggers';});
      if(ts) Tris=ts.value;
      var mbs=settings.find(function(s){return s.key==='members';});
      if(mbs && Array.isArray(mbs.value)){ Members=mbs.value; localStorage.setItem('wc_members',JSON.stringify(Members)); buildMemberSelects(); }
      var cms=settings.find(function(s){return s.key==='carry_members';});
      if(cms) CarryMembers=cms.value;
      var chs=settings.find(function(s){return s.key==='custom_holidays';});
      if(chs && Array.isArray(chs.value)){ CustomHolidays=chs.value; localStorage.setItem('wc_custom_hols',JSON.stringify(CustomHolidays)); }
      var sls=settings.find(function(s){return s.key==='staff_list';});
      if(sls){
        var sv2=sls.value;
        if(typeof sv2==='string'){try{sv2=JSON.parse(sv2);}catch(e){sv2=null;}}
        if(Array.isArray(sv2) && sv2.length>0){ StaffList=sv2; localStorage.setItem('wc_staff',JSON.stringify(StaffList)); }
      }
    }
    // settingsの有無に関わらず、担当者リストは必ず構築（空なら初期メンバー）
    buildOperatorSelect();

    if(cheki) {
      var pendingDelCheki=getPendingDeleteIds('pos_cheki');
      var cloudCheki = cheki.filter(function(c){return !pendingDelCheki[String(c.id)];}).map(function(c){return {id:c.id,d:c.date,cats:c.cats||[],multi:!!c.multi,qty:c.qty,price:c.price,total:c.total};});
      var cloudChekiIds={};cloudCheki.forEach(function(c){cloudChekiIds[String(c.id)]=true;});
      var pendingCheki=getPendingSyncKeys('pos_cheki');
      var localChekiOnly=JSON.parse(localStorage.getItem('wc_cheki')||'[]').filter(function(c){return !cloudChekiIds[String(c.id)]&&pendingCheki[String(c.id)];});
      if(localChekiOnly.length>0){localChekiOnly.forEach(function(c){saveChekiToSupa(c);});}
      Cheki = cloudCheki.concat(localChekiOnly);
    }

    // localStorageにデータがあってSupabaseが空なら移行（初回のみ）
    var migrated = localStorage.getItem('wc_migrated');
    if(!migrated) {
      var localG=JSON.parse(localStorage.getItem('wc_g')||'[]');
      var localMS=JSON.parse(localStorage.getItem('wc_ms')||'[]');
      var localCU=JSON.parse(localStorage.getItem('wc_cu')||'[]');
      var localCR=JSON.parse(localStorage.getItem('wc_cr')||'[]');
      if((!guests||guests.length===0)&&localG.length>0) {
        G=localG; localG.forEach(function(g){saveGuestToSupa(g);});
        localStorage.setItem('wc_migrated','1');
      }
      if((!merch||merch.length===0)&&localMS.length>0) {
        MS=localMS; localMS.forEach(function(m){saveMerchToSupa(m);});
        localStorage.setItem('wc_migrated','1');
      }
      if((!customers||customers.length===0)&&localCU.length>0) {
        CU=localCU; localCU.forEach(function(c){saveCustomerToSupa(c);});
        localStorage.setItem('wc_migrated','1');
      }
      if((!cash||cash.length===0)&&localCR.length>0) {
        CR=localCR; localCR.forEach(function(r){saveCashToSupa(r);});
        localStorage.setItem('wc_migrated','1');
      }
    }
        sv(); rfAll();
    console.log('Supabase load complete!');
  }).catch(function(e){console.error('loadFromSupabase error:',e.message);rfAll();});
}

function saveGuestToSupa(g) {
  supaUpsert('pos_guests',{
    id:String(g.id), date:g.d, type:g.tp, pattern:g.pt, member:g.member||'', operator:g.operator||'',
    adults:g.a, children:g.c, checkin:g.ci, checkout:g.co||'',
    price:g.pr, status:g.st, free_nyan:g.fn,
    binder_color:g.bc||'', binder_name:g.bcn||'',
    memo:g.mo||'', survey:g.aq||{}
  });
}
function saveMerchToSupa(m) {
  supaUpsert('pos_merch',{id:m.d,date:m.d,items:m.i,total:m.total});
}
function saveMerchItemsToSupa() {
  MI.forEach(function(item,i){
    supaUpsert('pos_merch_items',{id:String(item.id),name:item.n,price:item.p,sort_order:i});
  });
}
function saveCustomerToSupa(c) {
  supaUpsert('pos_customers',{
    id:String(c.id), member_no:c.memberNo||'', name:c.name,
    look:c.look||'', pref:c.pref||'', alert:c.alert||'',
    birth:c.birth||'', photo:c.photo||'',
    trigger_list:c.trigger||[], companion:c.companion||[],
    gacha:c.gacha||'', oshi_cats:c.oshiCats||[],
    visits:c.visits||[], memos:c.memos||[]
  });
}
function saveCashToSupa(r) {
  supaUpsert('pos_cash',{id:String(r.id||r.d),date:r.d,data:r});
}
function saveSettingToSupa(key,value) {
  supaUpsert('pos_settings',{key:key,value:value,updated_at:new Date().toISOString()});
}
function saveChekiToSupa(c) {
  supaUpsert('pos_cheki',{id:String(c.id),date:c.d,cats:c.cats||[],multi:!!c.multi,qty:c.qty,price:c.price,total:c.total});
}

// ===== 編集履歴ログ =====
var OWNER_PW = '0103';
var isOwnerMode = false;
// 担当者の初期メンバー（これは絶対に消えない）
var DEFAULT_STAFF = ["吉村","高橋","土橋","冨部","松中","松本","よしむら","田染"];
var StaffList = DEFAULT_STAFF.slice();
try{
  var savedStaff = JSON.parse(localStorage.getItem('wc_staff')||'null');
  if(Array.isArray(savedStaff) && savedStaff.length>0) StaffList = savedStaff;
}catch(e){}
var CurrentOperator = localStorage.getItem('wc_operator') || '';

// ===== 今アクセス中の表示 =====
function deviceId(){
  var id=localStorage.getItem('wc_device_id');
  if(!id){id='dev_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);localStorage.setItem('wc_device_id',id);}
  return id;
}
function heartbeatPresence(){
  var name=CurrentOperator||'未選択';
  fetch(SUPA_URL + '/rest/v1/pos_presence', {
    method: 'POST',
    headers: Object.assign({}, getSupaHeaders(), {'Prefer': 'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify({id:deviceId(),name:name,last_seen:new Date().toISOString()})
  }).catch(function(e){console.warn('presence sync skipped:',e.message);});
}
function loadPresence(){
  fetch(SUPA_URL + '/rest/v1/pos_presence?select=*', {method:'GET', headers: getSupaHeaders()})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(rows){
      if(!rows)return;
      var now=Date.now();
      var active=rows.filter(function(r){return r.last_seen && (now-new Date(r.last_seen).getTime())<90000;});
      renderPresence(active);
    }).catch(function(e){console.warn('presence load skipped:',e.message);});
}
function renderPresence(active){
  var badge=document.getElementById('presence-badge');
  var view=document.getElementById('presence-view');
  var myId=deviceId();
  var others=active.filter(function(r){return r.id!==myId;});
  if(badge){
    if(others.length>0){badge.style.display='block';badge.textContent='👥 '+others.length+'人 操作中';}
    else{badge.style.display='none';}
  }
  if(view){
    if(active.length===0){view.innerHTML='読み込み中...';}
    else{
      view.innerHTML=active.map(function(r){
        var secs=Math.round((Date.now()-new Date(r.last_seen).getTime())/1000);
        return (r.id===myId?'📍 ':'👤 ')+(r.name||'未選択')+(r.id===myId?'（あなた）':'')+' <span style="opacity:.6;">・'+secs+'秒前</span>';
      }).join('<br>');
    }
  }
}
function startPresenceLoop(){
  heartbeatPresence();loadPresence();
  setInterval(function(){heartbeatPresence();loadPresence();},60000);
}
function logAction(action, detail) {
  var log = {
    id: String(Date.now()),
    action: action,
    detail: detail,
    operator: CurrentOperator || '未選択',
    ts: new Date().toLocaleString('ja-JP'),
    ua: navigator.userAgent.substring(0,50)
  };
  // 操作履歴は補助的な記録なので、失敗しても警告は出さない（お客様データの保存失敗警告と区別するため）
  fetch(SUPA_URL + '/rest/v1/pos_logs', {
    method: 'POST',
    headers: Object.assign({}, getSupaHeaders(), {'Prefer': 'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify(log)
  }).catch(function(e){console.warn('logAction sync skipped:',e.message);});
}

// ===== 担当者選択 =====
function buildOperatorSelect(){
  var sel=document.getElementById('hdr-operator');
  if(!sel)return;
  // StaffListが万一空でも初期メンバーを使う（絶対に空にしない）
  var list = (Array.isArray(StaffList)&&StaffList.length>0) ? StaffList : DEFAULT_STAFF;
  var html='<option value="">👤 担当者を選択</option>';
  for(var i=0;i<list.length;i++){
    var nm=list[i];
    html+='<option value="'+nm+'"'+(nm===CurrentOperator?' selected':'')+'>'+nm+'</option>';
  }
  sel.innerHTML=html;
}
function setOperator(name){
  CurrentOperator=name;
  localStorage.setItem('wc_operator',name);
  if(typeof heartbeatPresence==='function')heartbeatPresence();
}
function saveStaffList(){ localStorage.setItem('wc_staff',JSON.stringify(StaffList)); saveSettingToSupa('staff_list',StaffList); }
function rStaffList(){
  var el=document.getElementById('staff-list');if(!el)return;
  var h='';
  for(var i=0;i<StaffList.length;i++){
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);">';
    h+='<span style="flex:1;font-size:14px;">'+StaffList[i]+'</span>';
    h+='<button onclick="delStaff('+i+')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:5px 10px;border-radius:18px;font-size:11px;cursor:pointer;">削除</button>';
    h+='</div>';
  }
  el.innerHTML=h||'<div style="color:var(--tx2);font-size:12px;padding:8px 0;">スタッフがいません</div>';
}
function addStaff(){
  var input=document.getElementById('staff-add-name');
  var n=input.value.trim();
  if(!n){toast('名前を入力してください',true);return;}
  if(StaffList.indexOf(n)>=0){toast('すでに登録されています',true);return;}
  StaffList.push(n);saveStaffList();input.value='';rStaffList();buildOperatorSelect();toast(n+' を追加しました');
}
function delStaff(idx){
  var n=StaffList[idx];
  askConfirm(n+' を削除しますか？',function(){
    StaffList.splice(idx,1);saveStaffList();rStaffList();buildOperatorSelect();
    if(CurrentOperator===n){CurrentOperator='';localStorage.removeItem('wc_operator');}
    toast('削除しました');
  });
}

// ===== 猫の名前管理 =====
function rCatList(){
  var el=document.getElementById('cat-list');if(!el)return;
  var h='';
  for(var i=0;i<Cats.length;i++){
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);">';
    h+='<span style="flex:1;font-size:14px;">'+Cats[i]+'</span>';
    h+='<button onclick="delCat('+i+')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:5px 10px;border-radius:18px;font-size:11px;cursor:pointer;">削除</button>';
    h+='</div>';
  }
  el.innerHTML=h||'<div style="color:var(--tx2);font-size:12px;padding:8px 0;">猫が登録されていません</div>';
}
function addCat(){
  var input=document.getElementById('cat-add-name');
  var n=input.value.trim();
  if(!n){toast('猫の名前を入力してください',true);return;}
  if(Cats.indexOf(n)>=0){toast('すでに登録されています',true);return;}
  Cats.push(n);sv();saveSettingToSupa('cats',Cats);input.value='';rCatList();buildAqChips();toast(n+' を追加しました');
}
function delCat(idx){
  var n=Cats[idx];
  askConfirm(n+' を削除しますか？',function(){
    Cats.splice(idx,1);sv();saveSettingToSupa('cats',Cats);rCatList();buildAqChips();toast('削除しました');
  });
}
function openStaffModal(){ rStaffList(); oModal('m-staff'); }
function openCatModal(){ rCatList(); oModal('m-cat'); }


(function(){
try{
  var c=document.createElement('canvas');
  c.width=c.height=180;
  var ctx=c.getContext('2d');
  ctx.fillStyle='#5c9e7e';
  ctx.beginPath();
  ctx.roundRect(0,0,180,180,[40]);
  ctx.fill();
  ctx.font='80px serif';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText('🐱',90,95);
  ctx.font='bold 18px sans-serif';
  ctx.fillStyle='white';
  ctx.fillText('POS',90,155);
  var png=c.toDataURL('image/png');
  var link=document.createElement('link');
  link.rel='apple-touch-icon';
  link.href=png;
  document.head.appendChild(link);
  var fav=document.querySelector("link[rel*='icon']")||document.createElement('link');
  fav.rel='icon';fav.href=png;
  document.head.appendChild(fav);
}catch(e){console.error('アイコン生成に失敗（本体の動作には影響しません）:',e);}
})();


(function(){
  var PW = '0000';
  var STORAGE_KEY = 'wc_auth';
  if(localStorage.getItem(STORAGE_KEY) === PW){
    document.getElementById('auth-screen').style.display = 'none';
  }
  window.checkAuth = function(){
    var input = document.getElementById('auth-input').value;
    if(input === PW){
      localStorage.setItem(STORAGE_KEY, PW);
      document.getElementById('auth-screen').style.display = 'none';
    } else {
      document.getElementById('auth-error').style.display = 'block';
      document.getElementById('auth-input').value = '';
    }
  };
})();


// ===== DATA =====
var G=JSON.parse(localStorage.getItem('wc_g')||'[]');
var CR=JSON.parse(localStorage.getItem('wc_cr')||'[]');
var MS=JSON.parse(localStorage.getItem('wc_ms')||'[]');
var MI=JSON.parse(localStorage.getItem('wc_mi')||'[{"id":1,"n":"ガチャ","p":400},{"id":2,"n":"靴下","p":200},{"id":3,"n":"ドリンク","p":200},{"id":4,"n":"チュールアイス","p":300}]');
var CU=JSON.parse(localStorage.getItem('wc_cu')||'[]');
var Cats=JSON.parse(localStorage.getItem('wc_cats')||'["にゃあな","にゃあ","こきん","なずな","すぎな","ももりん","あおい","くぅ","わらび","ブラン","ハニ","ルル","とら","あさひ","まひる","ふく","たまぞう","みーこ","あやめ"]');
var Cheki=JSON.parse(localStorage.getItem('wc_cheki')||'[]'); // {id,d:date,cats:[name,...] or null,multi:bool,qty,price,total}
var chekiSel=[]; // 現在選択中の猫（1匹モード用）
var chekiMulti=false; // 複数モードかどうか
var chekiQty=1;
var Tris=JSON.parse(localStorage.getItem('wc_tris')||'["Google Maps","インスタ","TikTok","友人紹介","X","アメブロ","その他"]');
var Members=JSON.parse(localStorage.getItem('wc_members')||'[]');
function saveMembers(){localStorage.setItem('wc_members',JSON.stringify(Members));saveSettingToSupa('members',Members);}
function buildMemberSelects(){
  var ids=['r-member','ge-member'];
  for(var k=0;k<ids.length;k++){
    var sel=document.getElementById(ids[k]);if(!sel)continue;
    var cur=sel.value;
    var h='<option value="">— 選択なし —</option>';
    for(var i=0;i<Members.length;i++)h+='<option value="'+Members[i]+'">'+Members[i]+'</option>';
    sel.innerHTML=h;sel.value=cur;
  }
}
function addMemberPrompt(selId){
  window._memberTargetSel=selId;
  document.getElementById('member-add-input').value='';
  oModal('m-member-add');
  setTimeout(function(){try{document.getElementById('member-add-input').focus();}catch(e){}},100);
}
function doAddMember(){
  var name=document.getElementById('member-add-input').value.trim();
  if(!name){toast('お名前を入力してください',true);return;}
  if(Members.indexOf(name)<0){Members.push(name);saveMembers();buildMemberSelects();}
  var sel=document.getElementById(window._memberTargetSel);if(sel)sel.value=name;
  cModal('m-member-add');
  toast(name+' さんを追加しました');
}
var BCs=JSON.parse(localStorage.getItem('wc_bcs')||'[{"id":1,"n":"赤","c":"#f28b82"},{"id":2,"n":"オレンジ","c":"#f9b468"},{"id":3,"n":"黄","c":"#f7d86c"},{"id":4,"n":"緑","c":"#81c995"},{"id":5,"n":"青","c":"#76b9ed"},{"id":6,"n":"紫","c":"#b39ddb"},{"id":7,"n":"ピンク","c":"#f48fb1"},{"id":8,"n":"茶","c":"#a1887f"}]');
var MQ={};
var PastData=JSON.parse(localStorage.getItem('wc_past')||'[]');

// 売上タブ専用データ
var ESales=JSON.parse(localStorage.getItem('wc_esales')||'{}'); // {year: {month: {sales, visitors}}}
function loadExpBase(){return JSON.parse(localStorage.getItem('wc_expense')||'{"balance":0,"history":[]}');}
function saveExpBase(d){localStorage.setItem('wc_expense',JSON.stringify(d));}

var coId=null;
var aC=1,cC=0,isFN=false,isKD=false;
var selBC_id=null;
var aqCh={tri:[],exp:'',cats:[]};
var vD=new Date(),vM=new Date(),aM=new Date(),kM=new Date();
var eYear=new Date().getFullYear();
var eCurrentRcpt=null;

// Charts
var eChartS=null,eChartV=null;

// ===== HELPERS =====
function p2(n){return String(n).padStart(2,'0');}
function ft(d){return p2(d.getHours())+':'+p2(d.getMinutes());}
// 時刻セレクト（時・分）を生成してコンテナに入れる
function buildTimeSelect(containerId,onchg){
  var c=document.getElementById(containerId);if(!c)return;
  var hOpts='';for(var h=0;h<24;h++)hOpts+='<option value="'+p2(h)+'">'+p2(h)+'</option>';
  var mOpts='';for(var m=0;m<60;m++)mOpts+='<option value="'+p2(m)+'">'+p2(m)+'</option>';
  var chg=onchg?(' onchange="'+onchg+'"'):'';
  c.innerHTML='<div style="display:flex;align-items:center;gap:8px;">'
    +'<select class="tsel" data-role="h"'+chg+'>'+hOpts+'</select><span style="font-weight:700;color:var(--tx2);font-size:18px;">時</span>'
    +'<span style="font-weight:700;color:var(--tx2);font-size:22px;">:</span>'
    +'<select class="tsel" data-role="m"'+chg+'>'+mOpts+'</select><span style="font-weight:700;color:var(--tx2);font-size:18px;">分</span></div>';
}
// 時刻コンテナから "HH:MM" を取得
function getTime(containerId){
  var c=document.getElementById(containerId);if(!c)return '';
  var h=c.querySelector('[data-role=h]'),m=c.querySelector('[data-role=m]');
  if(!h||!m)return '';
  if(c.getAttribute('data-empty')==='1')return '';
  return h.value+':'+m.value;
}
// 時刻コンテナに "HH:MM" をセット（空文字なら未設定状態に）
function setTime(containerId,val){
  var c=document.getElementById(containerId);if(!c)return;
  var h=c.querySelector('[data-role=h]'),m=c.querySelector('[data-role=m]');
  if(!h||!m)return;
  if(!val){c.setAttribute('data-empty','1');h.value='00';m.value='00';return;}
  c.removeAttribute('data-empty');
  var parts=val.split(':');h.value=p2(parseInt(parts[0])||0);m.value=p2(parseInt(parts[1])||0);
}
function fYMD(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
function td(){return fYMD(new Date());}
function yn(n){return '¥'+Number(n).toLocaleString();}
function sv(){
  localStorage.setItem('wc_g',JSON.stringify(G));
  localStorage.setItem('wc_cr',JSON.stringify(CR));
  localStorage.setItem('wc_ms',JSON.stringify(MS));
  localStorage.setItem('wc_mi',JSON.stringify(MI));
  localStorage.setItem('wc_cu',JSON.stringify(CU));
  localStorage.setItem('wc_cats',JSON.stringify(Cats));
  localStorage.setItem('wc_tris',JSON.stringify(Tris));
  localStorage.setItem('wc_bcs',JSON.stringify(BCs));
  localStorage.setItem('wc_past',JSON.stringify(PastData));
  localStorage.setItem('wc_esales',JSON.stringify(ESales));
  localStorage.setItem('wc_cheki',JSON.stringify(Cheki));
}
function toast(msg,err){
  var t=document.getElementById('toast');
  t.textContent=msg;t.className='toast'+(err?' err':'');
  t.classList.add('on');setTimeout(function(){t.classList.remove('on');},2500);
}
var _confirmCb=null;
function askConfirm(msg,onYes,yesLabel){
  document.getElementById('confirm-msg').textContent=msg;
  var yb=document.getElementById('confirm-yes');
  yb.textContent=yesLabel||'削除する';
  _confirmCb=onYes;
  document.getElementById('m-confirm').classList.add('on');
  yb.onclick=function(){var cb=_confirmCb;closeConfirm();if(cb)cb();};
}
function closeConfirm(){
  document.getElementById('m-confirm').classList.remove('on');
  _confirmCb=null;
}
function oModal(id){document.getElementById(id).classList.add('on');if(id==='m-bc')rBCList();if(id==='m-price')loadPriceModal();if(id==='m-menu'){loadPresence();rCustomHolidays();}}
function cModal(id){document.getElementById(id).classList.remove('on');}
function sp(id){
  var pages=['p-g','p-r','p-m','p-s','p-k'];
  var navs=['n-g','n-r','n-m','n-s','n-k'];
  for(var i=0;i<pages.length;i++){
    document.getElementById(pages[i]).classList.remove('active');
    document.getElementById(navs[i]).classList.remove('active');
  }
  document.getElementById(id).classList.add('active');
  var map={'p-g':'n-g','p-r':'n-r','p-m':'n-m','p-s':'n-s','p-k':'n-k'};
  if(map[id])document.getElementById(map[id]).classList.add('active');
  // 物販タブを開いたとき、編集モードでなければ数量を今日基準にリセット
  if(id==='p-m' && !window._editMerchDate){
    var t2=td(),tr2=MS.find(function(m){return m.d===t2;});
    var tq={};if(tr2){for(var z=0;z<tr2.i.length;z++)tq[String(tr2.i[z].id)]=tr2.i[z].q;}
    for(var y=0;y<MI.length;y++)MQ[String(MI[y].id)]=tq[String(MI[y].id)]||0;
  }
  rfAll();
}

// ===== CLOCK =====
function clk(){
  var n=new Date();
  var w=['日','月','火','水','木','金','土'];
  document.getElementById('hdate').innerHTML='<span style="font-size:9px;opacity:.8;">'+n.getFullYear()+'/'+p2(n.getMonth()+1)+'/'+p2(n.getDate())+'（'+w[n.getDay()]+'）</span><br><span style="font-size:18px;font-family:\'Noto Sans JP\',sans-serif;letter-spacing:1px;">'+p2(n.getHours())+':'+p2(n.getMinutes())+'<span style="font-size:12px;">:'+p2(n.getSeconds())+'</span></span>';
}

// ===== PRICING =====
var DefaultPrice = {wd30:1000,wd60:1500,wdext:500,hd30:1200,hd60:1800,fn:2600,cheki:500};
var Price = JSON.parse(localStorage.getItem('wc_price') || JSON.stringify(DefaultPrice));
var CustomHolidays = JSON.parse(localStorage.getItem('wc_custom_hols') || '[]');
if(!Price.cheki) Price.cheki = DefaultPrice.cheki;
function savePrice(){ localStorage.setItem('wc_price', JSON.stringify(Price)); }
function loadPriceModal(){
  document.getElementById('pr-wd30').value = Price.wd30;
  document.getElementById('pr-wd60').value = Price.wd60;
  document.getElementById('pr-wdext').value = Price.wdext;
  document.getElementById('pr-hd30').value = Price.hd30;
  document.getElementById('pr-hd60').value = Price.hd60;
  document.getElementById('pr-fn').value = Price.fn;
  document.getElementById('pr-cheki').value = Price.cheki;
}
function savePriceSettings(){
  Price.wd30 = parseInt(document.getElementById('pr-wd30').value)||0;
  Price.wd60 = parseInt(document.getElementById('pr-wd60').value)||0;
  Price.wdext = parseInt(document.getElementById('pr-wdext').value)||0;
  Price.hd30 = parseInt(document.getElementById('pr-hd30').value)||0;
  Price.hd60 = parseInt(document.getElementById('pr-hd60').value)||0;
  Price.fn = parseInt(document.getElementById('pr-fn').value)||0;
  Price.cheki = parseInt(document.getElementById('pr-cheki').value)||0;
  savePrice();
  saveSettingToSupa('price', Price);
  updateMenuPriceView();
  toast('料金設定を保存しました ✅');
  cModal('m-price');
}
function updateMenuPriceView(){
  var el = document.getElementById('menu-price-view');
  if(!el) return;
  el.innerHTML = '📋 料金表<br>平日：30分¥'+Price.wd30.toLocaleString()+' / 1時間¥'+Price.wd60.toLocaleString()+' / 延長30分¥'+Price.wdext.toLocaleString()+'<br>休日：30分¥'+Price.hd30.toLocaleString()+' / 1時間¥'+Price.hd60.toLocaleString()+'<br>フリーにゃん：¥'+Price.fn.toLocaleString()+'（1名）<br>🌙 夜カフェ：¥3,000（1名・2時間制・完全予約制）<br>キッズデイ（土）：1時間以上で小学生以下半額';
}


// ===== 日本の祝日判定 =====
function nthMonday(year,month,n){
  // その月のn番目の月曜日を返す（1始まり）
  var d=new Date(year,month-1,1);
  var add=(8-d.getDay())%7; // 最初の月曜日までの日数
  d.setDate(1+add+(n-1)*7);
  return d;
}
function vernalEquinox(year){
  // 春分の日の近似計算（2000〜2099年用の簡易式）
  return Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4));
}
function autumnalEquinox(year){
  // 秋分の日の近似計算（2000〜2099年用の簡易式）
  return Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));
}
function jpHolidaySet(year){
  var hols={};
  function add(m,d){hols[year+'-'+p2(m)+'-'+p2(d)]=true;}
  add(1,1);                              // 元日
  var seijin=nthMonday(year,1,2);add(1,seijin.getDate());       // 成人の日（1月第2月曜）
  add(2,11);                             // 建国記念の日
  add(2,23);                             // 天皇誕生日
  add(3,vernalEquinox(year));            // 春分の日
  add(4,29);                             // 昭和の日
  add(5,3);add(5,4);add(5,5);            // 憲法記念日・みどりの日・こどもの日
  var umi=nthMonday(year,7,3);add(7,umi.getDate());             // 海の日（7月第3月曜）
  add(8,11);                             // 山の日
  var keiro=nthMonday(year,9,3);add(9,keiro.getDate());         // 敬老の日（9月第3月曜）
  add(9,autumnalEquinox(year));          // 秋分の日
  var sports=nthMonday(year,10,2);add(10,sports.getDate());     // スポーツの日（10月第2月曜）
  add(11,3);                             // 文化の日
  add(11,23);                            // 勤労感謝の日
  // 振替休日：祝日が日曜なら翌平日（月曜、ただし連休なら空いてる日）まで繰り下げ
  var addSub={};
  Object.keys(hols).forEach(function(key){
    var d=new Date(key);
    if(d.getDay()===0){
      var sub=new Date(d);
      do{sub.setDate(sub.getDate()+1);}while(hols[sub.getFullYear()+'-'+p2(sub.getMonth()+1)+'-'+p2(sub.getDate())]);
      addSub[sub.getFullYear()+'-'+p2(sub.getMonth()+1)+'-'+p2(sub.getDate())]=true;
    }
  });
  Object.assign(hols,addSub);
  return hols;
}
var _jpHolCache={};
function isJpHoliday(ds){
  var d=new Date(ds);
  var y=d.getFullYear();
  if(!_jpHolCache[y])_jpHolCache[y]=jpHolidaySet(y);
  var key=y+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
  return !!_jpHolCache[y][key];
}
function isInCustomHoliday(ds){
  var d=ds||td();
  for(var i=0;i<CustomHolidays.length;i++){
    var h=CustomHolidays[i];
    if(d>=h.start && d<=h.end)return true;
  }
  return false;
}
function isHol(ds){var d=ds||td();var w=new Date(d).getDay();return w===0||w===6||isJpHoliday(d)||isInCustomHoliday(d);}
function isSat(ds){return new Date(ds||td()).getDay()===6;}
function saveCustomHolidays(){
  localStorage.setItem('wc_custom_hols',JSON.stringify(CustomHolidays));
  saveSettingToSupa('custom_holidays',CustomHolidays);
}
function addCustomHoliday(){
  var name=document.getElementById('ch-name').value.trim();
  var start=document.getElementById('ch-start').value;
  var end=document.getElementById('ch-end').value;
  var noFN=document.getElementById('ch-noFN').checked;
  var noKD=document.getElementById('ch-noKD').checked;
  if(!name){toast('名前を入力してください',true);return;}
  if(!start||!end){toast('開始日と終了日を入力してください',true);return;}
  if(start>end){toast('終了日は開始日より後にしてください',true);return;}
  CustomHolidays.push({name:name,start:start,end:end,noFN:noFN,noKD:noKD});
  CustomHolidays.sort(function(a,b){return a.start.localeCompare(b.start);});
  saveCustomHolidays();
  document.getElementById('ch-name').value='';
  document.getElementById('ch-start').value='';
  document.getElementById('ch-end').value='';
  document.getElementById('ch-noFN').checked=false;
  document.getElementById('ch-noKD').checked=false;
  rCustomHolidays();
  toast('追加しました ✅');
}
function delCustomHoliday(idx){
  askConfirm('この期間を削除しますか？',function(){
    CustomHolidays.splice(idx,1);
    saveCustomHolidays();
    rCustomHolidays();
    toast('削除しました');
  });
}
function rCustomHolidays(){
  var el=document.getElementById('ch-list');if(!el)return;
  if(CustomHolidays.length===0){el.innerHTML='<div style="font-size:12px;color:var(--tx2);text-align:center;padding:10px;">追加した期間はありません</div>';return;}
  var h='';
  CustomHolidays.forEach(function(hd,i){
    var restrict=[];
    if(hd.noFN)restrict.push('🐱フリーにゃん禁止');
    if(hd.noKD)restrict.push('🧒キッズデイ禁止');
    h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd);">';
    h+='<div><div style="font-size:13px;font-weight:700;">'+hd.name+'</div><div style="font-size:11px;color:var(--tx2);">'+hd.start+' 〜 '+hd.end+(restrict.length?'<br>'+restrict.join('・'):'')+'</div></div>';
    h+='<button onclick="delCustomHoliday('+i+')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:4px 10px;border-radius:10px;font-size:11px;cursor:pointer;">🗑</button></div>';
  });
  el.innerHTML=h;
}
function getFNKDBlock(date){
  var d=date||td();
  for(var i=0;i<CustomHolidays.length;i++){
    var hcd=CustomHolidays[i];
    if(d>=hcd.start && d<=hcd.end && (hcd.noFN||hcd.noKD)) return hcd;
  }
  return null;
}
function calcP(a,c,ci,co,dt,fn,forceKD){
  var ds=dt||td();
  if(fn){return {t:Price.fn*(a+c),bd:'フリーにゃんタイム ¥'+Price.fn+'×'+(a+c)+'名',dur:'〜4時間',m:0};}
  var hol=isHol(ds),sat=(forceKD!==undefined)?!!forceKD:isSat(ds);
  var ciArr=ci.split(':');var ih=parseInt(ciArr[0]),im=parseInt(ciArr[1]);
  var m=0;
  if(co){var coArr=co.split(':');var oh=parseInt(coArr[0]),om=parseInt(coArr[1]);m=(oh*60+om)-(ih*60+im);if(m<0)m+=1440;}
  var dur=co?(Math.floor(m/60)+'時間'+(m%60)+'分'):null;
  var mn=co?m:60;
  function adultP(){if(mn<=30)return hol?Price.hd30:Price.wd30;if(mn<=60)return hol?Price.hd60:Price.wd60;var base=hol?Price.hd60:Price.wd60;var ext=Price.wdext*Math.ceil((mn-60)/30);return base+ext;}
  function childP(){
    // キッズデイ＝土曜。30分を超えると1時間料金扱い＝半額対象（料金表の「1時間以上」）
    if(!sat) return adultP();        // 土曜以外は大人と同額
    if(mn<=30) return adultP();      // 30分以内は通常料金（半額なし）
    var base=Math.floor((hol?Price.hd60:Price.wd60)/2);
    var ext=mn<=60?0:Math.floor(Price.wdext*Math.ceil((mn-60)/30)/2);
    return base+ext;
  }
  var kidsHalf = sat && mn>30;      // 表示用：実際に半額が適用されたか
  var ap=adultP(),cp=childP();
  var t=ap*a+(c>0?cp*c:0);
  var bd='大人 '+yn(ap)+'×'+a+'名';
  if(c>0)bd+=' + 子ども '+yn(cp)+'×'+c+'名'+(kidsHalf?' (キッズデイ半額)':'');
  return {t:t,bd:bd,dur:dur,m:m};
}
function ppCalc(){
  var ppEl=document.getElementById('pp');var pbEl=document.getElementById('pb');
  if(!ppEl||!pbEl)return;
  var t=getTime('r-time');if(!t)return;
  var ds=td(),hol=isHol(ds),sat=isSat(ds);
  if(isFN){ppEl.textContent=yn(2600*(aC+cC));pbEl.textContent='フリーにゃんタイム　¥2,600×'+(aC+cC)+'名';return;}
  var a30=hol?Price.hd30:Price.wd30,a60=hol?Price.hd60:Price.wd60;
  // キッズデイ＝土曜。1時間以上で小学生以下半額（30分は対象外）
  var c30=a30,c60=sat?Math.floor(a60/2):a60;
  var p30=a30*aC+(cC>0?c30*cC:0),p60=a60*aC+(cC>0?c60*cC:0);
  var parts=['大人 '+yn(a60)+'×'+aC+'名'];
  if(cC>0)parts.push('子ども '+yn(c60)+'×'+cC+'名'+(sat?' (キッズデイ半額)':''));
  ppEl.textContent=yn(p30)+'　/　'+yn(p60);
  pbEl.textContent='30分 / 1時間\n'+parts.join(' + ');
}
function togFN(){
  if(!isFN){var blk=getFNKDBlock(td());if(blk&&blk.noFN){toast('⚠️ '+blk.name+'期間中はフリーにゃんタイムを利用できません',true);return;}}
  isFN=!isFN;
  var btn=document.getElementById('fn-btn');if(!btn)return;
  if(isFN){btn.style.background='linear-gradient(135deg,#f0f8ee,#e4f4e0)';btn.style.borderColor='var(--ac2)';btn.style.color='#5a8050';btn.textContent='🐱 フリーにゃん　ON ✓';}
  else{btn.style.background='var(--sf2)';btn.style.borderColor='var(--bd)';btn.style.color='var(--tx2)';btn.textContent='🐱 フリーにゃん　OFF';}
  ppCalc();
}
function togKD(){
  if(!isKD){var blk=getFNKDBlock(td());if(blk&&blk.noKD){toast('⚠️ '+blk.name+'期間中はキッズデイを利用できません',true);return;}}
  isKD=!isKD;
  var btn=document.getElementById('kd-btn');if(!btn)return;
  if(isKD){btn.style.background='linear-gradient(135deg,#fff8e8,#ffe0a0)';btn.style.borderColor='var(--wn)';btn.style.color='#a06010';btn.textContent='🧒 キッズデイ　ON ✓';}
  else{btn.style.background='var(--sf2)';btn.style.borderColor='var(--bd)';btn.style.color='var(--tx2)';btn.textContent='🧒 キッズデイ　OFF';}
  ppCalc();
}
function togGEFN(){
  if(!window._geFN){var geDate=(document.getElementById('ge-date')||{}).value||td();var blk=getFNKDBlock(geDate);if(blk&&blk.noFN){toast('⚠️ '+blk.name+'期間中はフリーにゃんタイムを利用できません',true);return;}}
  window._geFN=!window._geFN;
  var btn=document.getElementById('ge-fn-btn');if(!btn)return;
  if(window._geFN){btn.style.background='linear-gradient(135deg,#f0f8ee,#e4f4e0)';btn.style.borderColor='var(--ac2)';btn.style.color='#5a8050';btn.textContent='🐱 フリーにゃん ON ✓';}
  else{btn.style.background='var(--sf2)';btn.style.borderColor='var(--bd)';btn.style.color='var(--tx2)';btn.textContent='🐱 フリーにゃん OFF';}
}
function togGEKD(){
  if(!window._geKD){var geDate2=(document.getElementById('ge-date')||{}).value||td();var blk=getFNKDBlock(geDate2);if(blk&&blk.noKD){toast('⚠️ '+blk.name+'期間中はキッズデイを利用できません',true);return;}}
  window._geKD=!window._geKD;
  var btn=document.getElementById('ge-kd-btn');if(!btn)return;
  if(window._geKD){btn.style.background='linear-gradient(135deg,#fff8e8,#ffe0a0)';btn.style.borderColor='var(--wn)';btn.style.color='#a06010';btn.textContent='🧒 キッズデイ ON ✓';}
  else{btn.style.background='var(--sf2)';btn.style.borderColor='var(--bd)';btn.style.color='var(--tx2)';btn.textContent='🧒 キッズデイ OFF';}
}



// ===== BINDER =====
function buildBCChips(){
  var el=document.getElementById('bc-chips');if(!el)return;
  var h='';
  for(var i=0;i<BCs.length;i++){var bc=BCs[i];var on=selBC_id===bc.id?' on':'';h+='<div class="bc'+on+'" data-id="'+bc.id+'" style="background:'+bc.c+';" title="'+bc.n+'" onclick="selBc('+bc.id+')"></div>';}
  el.innerHTML=h;
}
function selBc(id){selBC_id=(selBC_id===id)?null:id;buildBCChips();}
function rBCList(){
  var el=document.getElementById('bc-list');if(!el)return;
  var h='';
  for(var i=0;i<BCs.length;i++){
    var bc=BCs[i];
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);">';
    h+='<div style="width:28px;height:28px;border-radius:50%;background:'+bc.c+';flex-shrink:0;border:1px solid rgba(0,0,0,.1);"></div>';
    h+='<input type="text" value="'+bc.n+'" onchange="updBCN('+bc.id+',this.value)" style="flex:1;background:var(--sf2);border:1.5px solid var(--bd);color:var(--tx);padding:5px 8px;border-radius:8px;font-size:13px;font-family:\'Zen Maru Gothic\',sans-serif;outline:none;">';
    h+='<input type="color" value="'+bc.c+'" onchange="updBCC('+bc.id+',this.value)" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--bd);cursor:pointer;padding:1px;">';
    h+='<button onclick="delBC('+bc.id+')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:5px 10px;border-radius:18px;font-size:11px;cursor:pointer;">削除</button>';
    h+='</div>';
  }
  el.innerHTML=h;
}
function updBCN(id,n){var bc=BCs.find(function(x){return x.id===id;});if(bc&&n.trim())bc.n=n.trim();sv();buildBCChips();}
function updBCC(id,c){var bc=BCs.find(function(x){return x.id===id;});if(bc){bc.c=c;sv();buildBCChips();rBCList();}}
function delBC(id){if(BCs.length<=2){toast('最低2色は必要です',true);return;}BCs=BCs.filter(function(x){return x.id!==id;});if(selBC_id===id)selBC_id=null;sv();buildBCChips();rBCList();}
function addBC(){
  var n=document.getElementById('bc-n').value.trim();var c=document.getElementById('bc-c').value;
  if(!n){toast('色の名前を入力してください',true);return;}
  BCs.push({id:Date.now(),n:n,c:c});document.getElementById('bc-n').value='';
  sv();buildBCChips();rBCList();toast(n+' を追加しました');
}

// ===== COUNTER =====
function cc2(t,d){
  if(t==='a'){aC=Math.max(0,aC+d);if(aC===0&&cC===0)aC=1;document.getElementById('ca').textContent=aC;}
  else{cC=Math.max(0,cC+d);document.getElementById('cc3').textContent=cC;}
  ppCalc();
}

// ===== ANKET =====
function buildAqChips(){
  var te=document.getElementById('aq-tri');var ce=document.getElementById('aq-cats');if(!te||!ce)return;
  var icons={'Google Maps':'📍','インスタ':'📸','TikTok':'🎵','友人紹介':'👥','X':'🐦','アメブロ':'📖','その他':'💬'};
  var h='';
  for(var i=0;i<Tris.length;i++){var t=Tris[i];var on=aqCh.tri.indexOf(t)>=0?' on2':'';h+='<div class="chip'+on+'" data-v="'+t+'" onclick="togAqTri(this)">'+(icons[t]||'💬')+' '+t+'</div>';}
  te.innerHTML=h;h='';
  for(var j=0;j<Cats.length;j++){var cat=Cats[j];var on2=aqCh.cats.indexOf(cat)>=0?' on2':'';h+='<div class="chip'+on2+'" data-v="'+cat+'" onclick="togAqCat(this)">'+cat+'</div>';}
  ce.innerHTML=h;
}
function togAqTri(el){var v=el.getAttribute('data-v');var idx=aqCh.tri.indexOf(v);if(idx>=0){aqCh.tri.splice(idx,1);el.classList.remove('on2');}else{aqCh.tri.push(v);el.classList.add('on2');}}
function togAqCat(el){var v=el.getAttribute('data-v');var idx=aqCh.cats.indexOf(v);if(idx>=0){aqCh.cats.splice(idx,1);el.classList.remove('on2');}else{aqCh.cats.push(v);el.classList.add('on2');}}
function addAqTri(){var v=document.getElementById('aq-tri-add').value.trim();if(!v)return;if(Tris.indexOf(v)<0)Tris.push(v);if(aqCh.tri.indexOf(v)<0)aqCh.tri.push(v);document.getElementById('aq-tri-add').value='';sv();buildAqChips();}
function selOne(el,gid){var els=document.querySelectorAll('#'+gid+' .chip');for(var i=0;i<els.length;i++)els[i].classList.remove('on');el.classList.add('on');}
// ===== アンケート後編集 =====
var eaqCh={tri:[],exp:'',cats:[]};
function openAqEdit(id){
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;
  var aq=g.aq||{};
  eaqCh={tri:(aq.tri||[]).slice(),exp:aq.exp||'',cats:(aq.cats||[]).slice()};
  document.getElementById('eaq-gid').value=id;
  buildEaqChips();
  // 初めてか？の選択状態を反映
  var exps=document.querySelectorAll('#eaq-exp .chip');
  for(var i=0;i<exps.length;i++){exps[i].classList.remove('on');if(exps[i].getAttribute('data-v')===eaqCh.exp)exps[i].classList.add('on');}
  cModal('m-det');
  oModal('m-aqedit');
}
function buildEaqChips(){
  var icons={'Google Maps':'📍','インスタ':'📸','TikTok':'🎵','友人紹介':'👥','X':'🐦','アメブロ':'📖','その他':'💬'};
  var h='';
  for(var i=0;i<Tris.length;i++){var t=Tris[i];var on=eaqCh.tri.indexOf(t)>=0?' on2':'';h+='<div class="chip'+on+'" data-v="'+t+'" onclick="togEaqTri(this)">'+(icons[t]||'💬')+' '+t+'</div>';}
  document.getElementById('eaq-tri').innerHTML=h;
  var ch='';
  for(var j=0;j<Cats.length;j++){var cat=Cats[j];var on2=eaqCh.cats.indexOf(cat)>=0?' on2':'';ch+='<div class="chip'+on2+'" data-v="'+cat+'" onclick="togEaqCat(this)">'+cat+'</div>';}
  document.getElementById('eaq-cats').innerHTML=ch;
}
function togEaqTri(el){var v=el.getAttribute('data-v');var idx=eaqCh.tri.indexOf(v);if(idx>=0){eaqCh.tri.splice(idx,1);el.classList.remove('on2');}else{eaqCh.tri.push(v);el.classList.add('on2');}}
function togEaqCat(el){var v=el.getAttribute('data-v');var idx=eaqCh.cats.indexOf(v);if(idx>=0){eaqCh.cats.splice(idx,1);el.classList.remove('on2');}else{eaqCh.cats.push(v);el.classList.add('on2');}}
function addEaqTri(){var v=document.getElementById('eaq-tri-add').value.trim();if(!v)return;if(Tris.indexOf(v)<0){Tris.push(v);sv();saveSettingToSupa('triggers',Tris);}if(eaqCh.tri.indexOf(v)<0)eaqCh.tri.push(v);document.getElementById('eaq-tri-add').value='';buildEaqChips();}
function saveAqEdit(){
  var id=document.getElementById('eaq-gid').value;
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;
  var expEl=document.querySelector('#eaq-exp .chip.on');
  var exp=expEl?expEl.getAttribute('data-v'):'';
  g.aq={tri:eaqCh.tri.slice(),exp:exp,cats:eaqCh.cats.slice()};
  sv();saveGuestToSupa(g);cModal('m-aqedit');rfAll();toast('アンケートを保存しました 📋');
}

// ===== REGISTER =====
var _regBusy=false;
function regGuest(){
  if(_regBusy)return;_regBusy=true;setTimeout(function(){_regBusy=false;},1200);
  var t=getTime('r-time');if(!t){toast('入店時間を入力してください',true);_regBusy=false;return;}
  var expEl=document.querySelector('#aq-exp .chip.on');var exp=expEl?expEl.getAttribute('data-v'):'';
  var selBcObj=selBC_id?BCs.find(function(x){return x.id===selBC_id;}):null;
  var g={id:Date.now(),d:td(),tp:document.getElementById('r-tp').value,pt:document.getElementById('r-pt').value,member:document.getElementById('r-member')?document.getElementById('r-member').value:'',operator:CurrentOperator||'',a:aC,c:cC,ci:t,co:null,mo:document.getElementById('r-memo').value,pr:0,st:'stay',fn:isFN,kd:isKD,bc:selBcObj?selBcObj.c:'',bcn:selBcObj?selBcObj.n:'',aq:{tri:aqCh.tri.slice(),exp:exp,cats:aqCh.cats.slice()}};
  G.push(g);sv();saveGuestToSupa(g);logAction('入店登録','区分:'+g.tp+' '+g.pt+' 大人'+g.a+'名 入店'+g.ci);toast('入店登録しました 🐾');
  aC=1;cC=0;document.getElementById('ca').textContent='1';document.getElementById('cc3').textContent='0';
  document.getElementById('r-tp').value='new';document.getElementById('r-pt').value='友人';
  setTime('r-time',ft(new Date()));document.getElementById('r-memo').value='';
  isFN=false;isKD=false;selBC_id=null;aqCh={tri:[],exp:'',cats:[]};var rm=document.getElementById('r-member');if(rm)rm.value='';
  var fnBtn=document.getElementById('fn-btn');
  if(fnBtn){fnBtn.style.background='var(--sf2)';fnBtn.style.borderColor='var(--bd)';fnBtn.style.color='var(--tx2)';fnBtn.textContent='🐱 フリーにゃん　OFF';}
  var kdBtn=document.getElementById('kd-btn');
  if(kdBtn){kdBtn.style.background='var(--sf2)';kdBtn.style.borderColor='var(--bd)';kdBtn.style.color='var(--tx2)';kdBtn.textContent='🧒 キッズデイ　OFF';}
  buildBCChips();buildAqChips();
  var chips=document.querySelectorAll('#aq-exp .chip');for(var i=0;i<chips.length;i++)chips[i].classList.remove('on');
  ppCalc();sp('p-g');
}

// ===== CHECKOUT =====
function oCO(id){
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;
  coId=id;
  window._coFN=!!g.fn;  // 退店処理中のフリーにゃん状態
  document.getElementById('co-info').innerHTML='<div style="display:flex;gap:5px;flex-wrap:wrap;"><span class="tag pk">'+(g.tp==='new'?'ご新規様':'リピーター様')+'</span><span class="tag">'+g.pt+'</span><span class="tag gr">大人'+g.a+'名'+(g.c>0?'・子'+g.c+'名':'')+'</span><span class="tag">入店 '+g.ci+'</span></div>';
  setTime('co-ci',g.ci);setTime('co-co',ft(new Date()));
  document.getElementById('co-cup').value=0;document.getElementById('co-tkt').value=0;document.getElementById('co-sup').value=0;
  document.getElementById('co-othn').value='';document.getElementById('co-otha').value=0;
  document.getElementById('co-mo').value=g.mo||'';
  updateCOFNBtn();
  rcCO();oModal('m-co');
}
function togCOFN(){
  if(!window._coFN){var g4=G.find(function(x){return String(x.id)===String(coId);});var blk=getFNKDBlock(g4?g4.d:td());if(blk&&blk.noFN){toast('⚠️ '+blk.name+'期間中はフリーにゃんタイムを利用できません',true);return;}}
  window._coFN=!window._coFN;
  updateCOFNBtn();
  rcCO();
}
function updateCOFNBtn(){
  var btn=document.getElementById('co-fn-btn');if(!btn)return;
  if(window._coFN){
    btn.textContent='🐱 フリーにゃん　ON';
    btn.style.background='linear-gradient(135deg,#eeebfa,#ddd4f4)';btn.style.borderColor='var(--ac2)';btn.style.color='#6a5fb0';btn.style.fontWeight='700';
  }else{
    btn.textContent='🐱 フリーにゃん　OFF';
    btn.style.background='var(--sf2)';btn.style.borderColor='var(--bd)';btn.style.color='var(--tx2)';btn.style.fontWeight='normal';
  }
}
function rcCO(){
  var g=G.find(function(x){return String(x.id)===String(coId);});if(!g)return;
  var ci=getTime('co-ci')||g.ci;
  var co=getTime('co-co');
  var cup=parseInt(document.getElementById('co-cup').value)||0;
  var tkt=parseInt(document.getElementById('co-tkt').value)||0;
  var sup=parseInt(document.getElementById('co-sup').value)||0;
  var othn=document.getElementById('co-othn').value.trim();
  var otha=parseInt(document.getElementById('co-otha').value)||0;
  var disc=cup+tkt+sup+otha;
  var r=calcP(g.a,g.c,ci,co,g.d,window._coFN,g.kd?true:undefined);isKD=g.kd?true:isSat(g.d);
  document.getElementById('co-dur').textContent=r.dur||'—';
  document.getElementById('co-det').textContent=r.bd;
  document.getElementById('co-tot').textContent=yn(Math.max(0,r.t-disc));
  var parts=[];if(cup>0)parts.push('クーポン -'+yn(cup));if(tkt>0)parts.push('振興券 -'+yn(tkt));if(sup>0)parts.push('応援券 -'+yn(sup));if(otha>0)parts.push((othn||'その他割引')+' -'+yn(otha));
  document.getElementById('co-bd').textContent=parts.join('　');
}
function confCO(){
  var g=G.find(function(x){return String(x.id)===String(coId);});
  if(!g){toast('対象のお客様が見つかりません',true);return;}
  var ci=getTime('co-ci')||g.ci;
  var co=getTime('co-co')||ft(new Date());
  var cup=parseInt(document.getElementById('co-cup').value)||0;
  var tkt=parseInt(document.getElementById('co-tkt').value)||0;
  var sup=parseInt(document.getElementById('co-sup').value)||0;
  var othn=document.getElementById('co-othn').value.trim();
  var otha=parseInt(document.getElementById('co-otha').value)||0;
  var r=calcP(g.a,g.c,ci,co,g.d,window._coFN,g.kd?true:undefined);isKD=g.kd?true:isSat(g.d);
  var mo=document.getElementById('co-mo').value;
  if(otha>0)mo=(mo?mo+' ':'')+(othn||'その他割引')+' -¥'+otha.toLocaleString();
  g.ci=ci;g.co=co;g.pr=Math.max(0,r.t-cup-tkt-sup-otha);g.mo=mo;g.st='done';g.fn=window._coFN;
  sv();
  cModal('m-co');
  rfAll();
  toast('退店登録しました ✅');
  // Supabase保存とログは画面更新後に（失敗しても退店登録は完了済み）
  try{ saveGuestToSupa(g); }catch(e){ console.log('supa save err',e); }
  try{ logAction('退店登録','料金:'+yn(g.pr)+' 退店'+g.co); }catch(e){ console.log('log err',e); }
}
function showRcpt(){
  var g=G.find(function(x){return String(x.id)===String(coId);});if(!g)return;
  var ci=getTime('co-ci')||g.ci;
  var co=getTime('co-co');
  var cup=parseInt(document.getElementById('co-cup').value)||0;
  var tkt=parseInt(document.getElementById('co-tkt').value)||0;
  var sup=parseInt(document.getElementById('co-sup').value)||0;
  var othn=document.getElementById('co-othn').value.trim();
  var otha=parseInt(document.getElementById('co-otha').value)||0;
  var disc=cup+tkt+sup+otha;
  var r=calcP(g.a,g.c,ci,co,g.d,window._coFN,g.kd?true:undefined);isKD=g.kd?true:isSat(g.d);
  var tot=Math.max(0,r.t-disc);
  document.getElementById('rc-ppl').textContent='大人 '+g.a+'名'+(g.c>0?' ・ 子ども '+g.c+'名':'');
  document.getElementById('rc-dur').textContent=r.dur||'—';
  document.getElementById('rc-tot').textContent=yn(tot);
  var bdParts=[r.bd];
  if(cup>0)bdParts.push('割引クーポン　-'+yn(cup));if(tkt>0)bdParts.push('振興券　-'+yn(tkt));if(sup>0)bdParts.push('応援券　-'+yn(sup));if(otha>0)bdParts.push((othn||'その他割引')+'　-'+yn(otha));
  var bdHtml='<div style="border-top:1px solid var(--bd);margin-top:12px;padding-top:12px;text-align:left;">';
  for(var bi=0;bi<bdParts.length;bi++)bdHtml+='<div style="font-size:13px;color:var(--tx2);padding:3px 0;">'+bdParts[bi]+'</div>';
  bdHtml+='</div>';
  document.getElementById('rc-bd').innerHTML=bdHtml;
  oModal('m-rcpt');
}

// ===== GUEST DETAIL =====
function oDet(id){
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;
  var st=g.st==='stay';var sd='';
  if(st){var now=new Date();var ciArr=g.ci.split(':');var ih=parseInt(ciArr[0]),im=parseInt(ciArr[1]);var mn=(now.getHours()*60+now.getMinutes())-(ih*60+im);sd=Math.floor(mn/60)+'時間'+(mn%60)+'分';}
  document.getElementById('det-tit').textContent=(g.tp==='new'?'ご新規様':'リピーター様');
  var aq=g.aq||{};
  var h='<table class="st">';
  h+='<tr><td class="il">パターン</td><td>'+g.pt+'</td></tr>';
  h+='<tr><td class="il">人数</td><td>大人'+g.a+'名'+(g.c>0?' ・ 子ども'+g.c+'名':'')+'</td></tr>';
  h+='<tr><td class="il">入店</td><td>'+g.ci+'</td></tr>';
  if(g.co)h+='<tr><td class="il">退店</td><td>'+g.co+'</td></tr>';
  if(st)h+='<tr><td class="il">滞在</td><td style="color:var(--ac);font-family:\'Noto Sans JP\',sans-serif;font-size:16px;">'+sd+'</td></tr>';
  if(g.pr)h+='<tr><td class="il">料金</td><td style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;font-size:18px;">'+yn(g.pr)+'</td></tr>';
  if(g.fn)h+='<tr><td class="il">コース</td><td><span class="tag gr">🐱 フリーにゃん</span></td></tr>';
  if(g.kd)h+='<tr><td class="il">コース</td><td><span class="tag gd">🧒 キッズデイ（子ども1時間以上半額）</span></td></tr>';
  if(aq.tri&&aq.tri.length)h+='<tr><td class="il">きっかけ</td><td>'+aq.tri.join(' / ')+'</td></tr>';
  if(aq.exp)h+='<tr><td class="il">経験</td><td>'+aq.exp+'</td></tr>';
  if(aq.cats&&aq.cats.length)h+='<tr><td class="il">推し猫</td><td>'+aq.cats.join('・')+'</td></tr>';
  if(g.mo)h+='<tr><td class="il">メモ</td><td>'+g.mo+'</td></tr>';
  h+='</table>';
  document.getElementById('det-body').innerHTML=h;
  document.getElementById('det-act').innerHTML=st
    ?'<button class="btn bsu bf" onclick="cModal(\'m-det\');oCO('+id+')" style="font-size:16px;padding:16px;margin-bottom:8px;">退店処理</button><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;"><button class="btn bs bf" onclick="cModal(\'m-det\')">閉じる</button><button class="btn bso bf" onclick="oGEdit('+id+')">✏️ 編集</button></div><button class="btn bf" onclick="openAqEdit('+id+')" style="background:#eef2fb;border:1px solid #aab8de;color:#5a6ea8;font-size:12px;padding:8px;">📋 アンケート（任意）</button>'
    :'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;"><button class="btn bs bf" onclick="cModal(\'m-det\')">閉じる</button><button class="btn bp bf" onclick="oGEdit('+id+')">✏️ 編集</button></div><button class="btn bf" onclick="openAqEdit('+id+')" style="background:#eef2fb;border:1px solid #aab8de;color:#5a6ea8;font-size:12px;padding:8px;">📋 アンケート（任意）</button>';
  oModal('m-det');
}

// ===== RENDER GUESTS =====
function rGuests(){
  var expBase=loadExpBase();
  var t=td();
  var tg=G.filter(function(g){return g.d===t;});
  var stay=tg.filter(function(g){return g.st==='stay';}).sort(function(a,b){return a.ci.localeCompare(b.ci);});
  var done=tg.filter(function(g){return g.st==='done';}).sort(function(a,b){return a.ci.localeCompare(b.ci);});
  document.getElementById('bs').textContent=stay.length;
  document.getElementById('bd2').textContent=done.length;
  var tp=0;for(var i=0;i<tg.length;i++)tp+=tg[i].a+tg[i].c;
  var ts=0;for(var j=0;j<done.length;j++)ts+=done[j].pr;
  var tm=MS.find(function(m){return m.d===t;});
  var tc=0;Cheki.forEach(function(c){if(c.d===t)tc+=c.total;});
  document.getElementById('sg').textContent=tp;
  document.getElementById('ss').textContent=(ts+(tm?tm.total:0)+tc).toLocaleString();
  var now=new Date();var sh='';
  if(stay.length===0){sh='<div class="empty"><div class="ei">🐱</div>滞在中のお客様はいません</div>';}
  else{
    for(var k=0;k<stay.length;k++){
      var g=stay[k];
      var ciArr=g.ci.split(':');var ih=parseInt(ciArr[0]),im=parseInt(ciArr[1]);
      var mn=(now.getHours()*60+now.getMinutes())-(ih*60+im);
      var dur=mn>=0?(Math.floor(mn/60)+':'+p2(mn%60)+' 経過'):'';
      var bcS=g.bc?'background:'+g.bc+'22;border-left:4px solid '+g.bc+';':'';
      var bcD=g.bc?'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+g.bc+';margin-right:3px;border:1px solid rgba(0,0,0,.1);"></span>':'';
      sh+='<div class="gi" style="'+bcS+'" onclick="oDet(\''+g.id+'\')" >';
      sh+='<div class="gtop"><span class="gname">'+bcD+(g.tp==='new'?'ご新規様':'リピーター様')+(g.bcn?' <span style="font-size:10px;color:var(--tx2);">('+g.bcn+')</span>':'')+'</span><span class="sbdg">'+dur+'</span></div>';
      sh+='<div class="gmeta"><span class="tag">'+g.pt+'</span><span class="tag gr">大人'+g.a+'名'+(g.c>0?'・子'+g.c+'名':'')+'</span><span class="tag">入店 '+g.ci+'</span>'+(g.fn?'<span class="tag gr">🐱フリーにゃん</span>':'')+(g.mo?'<span class="tag">'+g.mo+'</span>':'')+'</div>';
      sh+='<div style="margin-top:8px;display:flex;gap:6px;"><button class="btn bso bsm" onclick="event.stopPropagation();oGEdit(\''+g.id+'\')" >✏️</button><button class="btn bsu bsm" style="flex:1;" onclick="event.stopPropagation();oCO(\''+g.id+'\')" >退店処理</button></div>';
      sh+='</div>';
    }
  }
  document.getElementById('gl-s').innerHTML=sh;
  var dh='';
  if(done.length===0){dh='<div class="empty"><div class="ei">✅</div>退店済みのお客様はいません</div>';}
  else{
    for(var l=0;l<done.length;l++){
      var gd=done[l];var bcS2=gd.bc?'border-left:4px solid '+gd.bc+';':'';
      dh+='<div class="gi done" style="'+bcS2+'" onclick="oDet(\''+gd.id+'\')">';
      dh+='<div class="gtop"><span class="gname">'+(gd.tp==='new'?'ご新規様':'リピーター様')+'</span><span class="gprice">'+yn(gd.pr)+'</span></div>';
      dh+='<div class="gmeta"><span class="tag">'+gd.pt+'</span><span class="tag gr">大人'+gd.a+'名'+(gd.c>0?'・子'+gd.c+'名':'')+'</span><span class="tag">'+gd.ci+' → '+gd.co+'</span>'+(gd.mo?'<span class="tag">'+gd.mo+'</span>':'')+'</div>';
      dh+='<div style="margin-top:8px;display:flex;gap:6px;"><button class="btn bso bsm" onclick="event.stopPropagation();oGEdit(\''+gd.id+'\')" >✏️ 編集・削除</button></div>';
      dh+='</div>';
    }
  }
  document.getElementById('gl-d').innerHTML=dh;
}
function gtab(t){
  document.getElementById('ts1').classList.toggle('active',t==='stay');
  document.getElementById('ts2').classList.toggle('active',t==='done');
  document.getElementById('gl-s').style.display=t==='stay'?'block':'none';
  document.getElementById('gl-d').style.display=t==='done'?'block':'none';
}

// ===== NIGHT CAFE TICKET =====
var ncTktN = 1;
function ncTktQty(d){
  ncTktN = Math.max(1, ncTktN + d);
  document.getElementById('nc-tkt-qty').textContent = ncTktN;
  document.getElementById('nc-tkt-qty2').textContent = ncTktN;
  document.getElementById('nc-tkt-total').textContent = yn(3000 * ncTktN);
}
function toggleNcTkt(){
  var on=document.getElementById('nc-tkt-on').checked;
  document.getElementById('nc-tkt-body').style.display=on?'block':'none';
}

// ===== CHEKI =====
function openChekiModal(){
  chekiSel=[];chekiMulti=false;chekiQty=1;
  renderChekiCatGrid();
  updateChekiTotal();
  oModal('m-cheki');
}
function chekiSetType(multi){
  chekiMulti=multi;chekiSel=[];
  document.getElementById('cheki-type-single').style.background=multi?'#fff':'var(--ac)';
  document.getElementById('cheki-type-single').style.color=multi?'var(--tx)':'#fff';
  document.getElementById('cheki-type-single').style.borderColor=multi?'var(--bd)':'var(--ac)';
  document.getElementById('cheki-type-multi').style.background=multi?'var(--ac)':'#fff';
  document.getElementById('cheki-type-multi').style.color=multi?'#fff':'var(--tx)';
  document.getElementById('cheki-type-multi').style.borderColor=multi?'var(--ac)':'var(--bd)';
  var grid=document.getElementById('cheki-cat-grid');
  grid.style.display=multi?'none':'grid';
  updateChekiTotal();
}
function renderChekiCatGrid(){
  var grid=document.getElementById('cheki-cat-grid');
  var h='';
  for(var i=0;i<Cats.length;i++){
    var name=Cats[i];
    h+='<div class="cat-chip-sel" data-name="'+name+'" onclick="chekiToggleCat(this,\''+name+'\')" style="background:#fff;border:1.5px solid var(--bd);border-radius:14px;padding:10px 4px;text-align:center;font-size:12px;font-weight:600;color:var(--tx);cursor:pointer;">'+name+'</div>';
  }
  grid.innerHTML=h;
}
function chekiToggleCat(el,name){
  var idx=chekiSel.indexOf(name);
  if(idx>=0){chekiSel.splice(idx,1);el.style.background='#fff';el.style.borderColor='var(--bd)';el.style.color='var(--tx)';}
  else{chekiSel.push(name);el.style.background='var(--ac)';el.style.borderColor='var(--ac)';el.style.color='#fff';}
}
function chekiQtyChange(d){
  chekiQty=Math.max(1,chekiQty+d);
  document.getElementById('cheki-qty').textContent=chekiQty;
  updateChekiTotal();
}
function updateChekiTotal(){
  var total=Price.cheki*chekiQty;
  document.getElementById('cheki-total').textContent='¥'+Price.cheki.toLocaleString()+' × '+chekiQty+'枚 ＝ ¥'+total.toLocaleString();
}
function saveCheki(){
  if(!chekiMulti && chekiSel.length===0){toast('猫を選んでください',true);return;}
  var total=Price.cheki*chekiQty;
  var rec={id:Date.now(),d:td(),cats:chekiMulti?[]:chekiSel.slice(),multi:chekiMulti,qty:chekiQty,price:Price.cheki,total:total};
  Cheki.push(rec);sv();saveChekiToSupa(rec);
  logAction('チェキ販売',(chekiMulti?'複数':chekiSel.join('・'))+' '+chekiQty+'枚 '+yn(total));
  cModal('m-cheki');toast('📸 チェキを記録しました');
  renderChekiToday();rGuests();rMerch();
}
function renderChekiToday(){
  var el=document.getElementById('cheki-today');if(!el)return;
  var t=td();
  var todays=Cheki.filter(function(c){return c.d===t;});
  if(todays.length===0){el.innerHTML='';return;}
  var h='<div style="font-size:11px;font-weight:700;color:var(--tx2);margin-bottom:8px;">本日の記録</div>';
  var totalQty=0,totalAmt=0;
  for(var i=0;i<todays.length;i++){
    var c=todays[i];
    var label=c.multi?'複数（'+c.qty+'枚分）':c.cats.join('・');
    h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12px;">';
    h+='<span>'+label+' × '+c.qty+'</span>';
    h+='<span style="display:flex;gap:8px;align-items:center;"><span style="color:var(--ok);font-weight:700;">'+yn(c.total)+'</span><button onclick="delCheki('+c.id+')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:2px 7px;border-radius:8px;font-size:10px;cursor:pointer;">🗑</button></span>';
    h+='</div>';
    totalQty+=c.qty;totalAmt+=c.total;
  }
  h+='<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-weight:700;font-size:13px;"><span>合計 '+totalQty+'枚</span><span style="color:var(--ok);">'+yn(totalAmt)+'</span></div>';
  el.innerHTML=h;
}
function delCheki(id){
  askConfirm('この記録を削除しますか？',function(){
    logAction('チェキ記録を削除','id:'+id);
    Cheki=Cheki.filter(function(c){return c.id!==id;});sv();supaDelete('pos_cheki',id);
    renderChekiToday();rMerch();toast('削除しました');
  });
}

// ===== MERCH =====
function rMerch(){
  var t=td(),tr=MS.find(function(m){return m.d===t;});
  // 入力中の数量(MQ)から点数・売上を計算して表示（＋を押すと即反映）
  var cnt=0,sal=0;
  for(var i=0;i<MI.length;i++){var qq=parseInt(MQ[String(MI[i].id)])||0;cnt+=qq;sal+=qq*MI[i].p;}
  // 保存済みデータのうち、商品リストにない項目（夜カフェチケットなど）も合算
  if(tr){
    for(var k=0;k<tr.i.length;k++){
      var it=tr.i[k];
      var inList=MI.some(function(m){return String(m.id)===String(it.id);});
      if(!inList && it.q>0){cnt+=it.q;sal+=it.q*it.p;}
    }
  }
  // チェキ販売も物販点数・売上に合算する
  var todaysCheki=Cheki.filter(function(c){return c.d===t;});
  for(var ci=0;ci<todaysCheki.length;ci++){cnt+=todaysCheki[ci].qty;sal+=todaysCheki[ci].total;}
  document.getElementById('mc').textContent=cnt;document.getElementById('ms').textContent=sal.toLocaleString();
  // 編集モード表示バナー
  var banner=document.getElementById('merch-edit-banner');
  if(banner){
    if(window._editMerchDate){
      banner.style.display='block';
      banner.innerHTML='<div style="background:linear-gradient(135deg,#fff8e8,#ffe8c0);border:1.5px solid var(--wn);border-radius:12px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:12px;color:#a06010;font-weight:700;">✏️ '+window._editMerchDate+' の物販を編集中</span><button onclick="exitMerchEdit()" style="background:#fff;border:1.5px solid var(--wn);color:#a06010;padding:5px 12px;border-radius:16px;font-size:11px;font-weight:700;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">編集をやめる</button></div>';
    }else{
      banner.style.display='none';banner.innerHTML='';
    }
  }
  var h='';
  for(var j=0;j<MI.length;j++){
    var item=MI[j];var iid=String(item.id);var q=parseInt(MQ[iid])||0,sub=q*item.p;
    h+='<div class="mi"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    h+='<div><div style="font-size:14px;font-weight:500;">'+item.n+'</div><div style="font-size:11px;color:var(--tx2);">'+yn(item.p)+'/個</div></div>';
    h+='<div style="display:flex;gap:5px;align-items:center;"><span id="msub-'+iid+'" style="font-family:\'Noto Sans JP\',sans-serif;font-size:16px;color:var(--ok);">'+(sub>0?yn(sub):'')+'</span>';
    h+='<button onclick="oMF(\''+iid+'\')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:5px 10px;border-radius:16px;font-size:11px;cursor:pointer;">✏️</button>';
    h+='<button onclick="delMI(\''+iid+'\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:5px 10px;border-radius:16px;font-size:11px;cursor:pointer;">削除</button>';
    h+='</div></div>';
    h+='<div style="display:flex;align-items:center;gap:10px;"><button class="cb" onclick="chMQ(\''+iid+'\',-1)">－</button><div id="mq-'+iid+'" style="font-family:\'Noto Sans JP\',sans-serif;font-size:24px;color:var(--ac);min-width:32px;text-align:center;">'+q+'</div><button class="cb" onclick="chMQ(\''+iid+'\',1)">＋</button></div>';
    h+='</div>';
  }
  document.getElementById('ml').innerHTML=h;
  var se=document.getElementById('ml-saved');
  if(tr&&tr.i.some(function(i){return i.q>0;})){
    var sh='<div class="card" style="background:linear-gradient(135deg,#f0f8ee,#e8f4e0);border-color:var(--ac2);">';
    sh+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="ct" style="color:var(--ok);margin-bottom:0;">✅ 本日の保存済み物販</div>';
    sh+='<div style="display:flex;gap:6px;"><button onclick="editMerch()" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">✏️ 編集</button>';
    sh+='<button onclick="cancelMerch()" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">🗑 取消</button></div></div>';
    for(var k=0;k<tr.i.length;k++){if(tr.i[k].q>0)sh+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;"><span>'+tr.i[k].n+' × '+tr.i[k].q+'</span><span style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;">'+yn(tr.i[k].q*tr.i[k].p)+'</span></div>';}
    sh+='<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-weight:700;font-size:13px;"><span>合計</span><span style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;">'+yn(tr.total)+'</span></div></div>';
    se.innerHTML=sh;
  }else{se.innerHTML='';}
  // 過去の物販履歴を表示
  rMerchHistory();
}
function rMerchHistory(){
  var he=document.getElementById('ml-history');if(!he)return;
  var t=td();
  // 過去7日分の物販データを表示（本日以外）
  var history=MS.filter(function(m){return m.d!==t&&m.i.some(function(i){return i.q>0;});})
    .sort(function(a,b){return b.d.localeCompare(a.d);}).slice(0,10);
  if(history.length===0){he.innerHTML='<div style="text-align:center;color:var(--tx2);font-size:12px;padding:16px;">過去の物販記録なし</div>';return;}
  var h='';
  for(var i=0;i<history.length;i++){
    var m=history[i];
    h+='<div class="card" style="margin-bottom:8px;">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    h+='<div style="font-size:13px;font-weight:700;">'+m.d+'</div>';
    h+='<div style="display:flex;gap:5px;align-items:center;">';
    h+='<span style="font-family:\'Noto Sans JP\',sans-serif;font-size:16px;color:var(--ok);">'+yn(m.total)+'</span>';
    h+='<button onclick="openMerchEdit(\''+m.d+'\')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:4px 8px;border-radius:10px;font-size:11px;cursor:pointer;">✏️ 編集</button>';
    h+='<button onclick="deleteMerchHistory(\''+m.d+'\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:4px 8px;border-radius:10px;font-size:11px;cursor:pointer;">🗑</button>';
    h+='</div></div>';
    for(var j=0;j<m.i.length;j++){
      if(m.i[j].q>0)h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--bd);"><span>'+m.i[j].n+' × '+m.i[j].q+'</span><span style="color:var(--ok);">'+yn(m.i[j].q*m.i[j].p)+'</span></div>';
    }
    h+='</div>';
  }
  he.innerHTML=h;
}
function jumpToMerchEdit(date){
  sp('p-m');
  setTimeout(function(){openMerchEdit(date);},50);
}
function openMerchEdit(date){
  // 指定日の物販データをMQに読み込んで編集
  var m=MS.find(function(x){return x.d===date;});
  if(!m)return;
  // 一旦その日のデータを削除
  MS=MS.filter(function(x){return x.d!==date;});
  // MQに数量を設定
  for(var i=0;i<m.i.length;i++) MQ[String(m.i[i].id)]=m.i[i].q;
  // 保存日付を変更するためにtd()の代わりにdateを使う必要がある
  // → 編集用の日付をグローバルに保持
  window._editMerchDate=date;
  var de=document.getElementById('merch-date');if(de)de.value=date;
  sv();
  rMerch();
  toast(date+'の物販を編集モードにしました。変更後「保存」を押してください');
}
function deleteMerchHistory(date){
  askConfirm(date+'の物販記録を削除しますか？',function(){
    logAction('物販記録を削除',date);
    var target=MS.find(function(m){return m.d===date;});
    var delId=target&&target.id?target.id:date;
    MS=MS.filter(function(m){return m.d!==date;});
    sv();supaDelete('pos_merch',delId);rMerch();rGuests();if(typeof rDay==='function')rDay();toast('削除しました');
  });
}
function exitMerchEdit(){
  window._editMerchDate=null;
  for(var i=0;i<MI.length;i++)MQ[String(MI[i].id)]=0;
  rMerch();rGuests();
  toast('編集をやめて通常モードに戻りました');
}
function chMQ(id,d){id=String(id);MQ[id]=(parseInt(MQ[id])||0)+d;if(MQ[id]<0)MQ[id]=0;rMerch();}
function updateMerchSummary(){
  var cnt=0,sal=0;
  for(var i=0;i<MI.length;i++){var q=parseInt(MQ[String(MI[i].id)])||0;cnt+=q;sal+=q*MI[i].p;}
  var mc=document.getElementById('mc'),ms=document.getElementById('ms');
  // 保存済み今日分がある場合はそちらを優先表示（従来通り）
  var t=td(),tr=MS.find(function(m){return m.d===t;});
  if(!window._editMerchDate&&tr){var c2=0,s2=0;for(var k=0;k<tr.i.length;k++){c2+=tr.i[k].q;s2+=tr.i[k].q*tr.i[k].p;}if(mc)mc.textContent=c2;if(ms)ms.textContent=s2.toLocaleString();}
  else{if(mc)mc.textContent=cnt;if(ms)ms.textContent=sal.toLocaleString();}
}
function saveMerchCombined(){
  var dateEl=document.getElementById('merch-date');
  var t=window._editMerchDate||(dateEl&&dateEl.value?dateEl.value:td());
  var items=[];
  for(var i=0;i<MI.length;i++)items.push({id:MI[i].id,n:MI[i].n,p:MI[i].p,q:MQ[String(MI[i].id)]||0});

  // 既に保存済みの夜カフェチケット数量を引き継ぐ（チェックし忘れても消えないように）
  var existingRec = MS.find(function(m){return m.d===t;});
  var priorNc = existingRec ? existingRec.i.find(function(x){return x.id==='nc-ticket';}) : null;
  var priorNcQty = priorNc ? (priorNc.q||0) : 0;
  var ncOn=document.getElementById('nc-tkt-on').checked;
  var newNcQty = priorNcQty + (ncOn ? ncTktN : 0);
  if(newNcQty>0){
    items.push({id:'nc-ticket',n:'🌙 夜カフェチケット',p:3000,q:newNcQty});
  }

  var total=0;for(var j=0;j<items.length;j++)total+=items[j].q*items[j].p;
  MS=MS.filter(function(m){return m.d!==t;});MS.push({id:t,d:t,i:items,total:total});
  sv();saveMerchToSupa(MS.find(function(m){return m.d===t;}));
  logAction('物販保存','日付:'+t+' 合計:'+yn(total)+(ncOn?' (夜カフェ'+ncTktN+'枚含む)':''));
  var wasEdit=window._editMerchDate;window._editMerchDate=null;
  for(var r=0;r<MI.length;r++)MQ[String(MI[r].id)]=0;
  if(ncOn){
    ncTktN=1;document.getElementById('nc-tkt-qty').textContent='1';document.getElementById('nc-tkt-qty2').textContent='1';document.getElementById('nc-tkt-total').textContent=yn(3000);
    document.getElementById('nc-tkt-on').checked=false;document.getElementById('nc-tkt-body').style.display='none';
  }
  rMerch();rGuests();
  toast(wasEdit?(wasEdit+' の物販を保存しました 🛍️'):'物販を保存しました 🛍️');
}
function oMF(id){
  document.getElementById('mf-id').value=id||'';
  if(id){var item=MI.find(function(x){return String(x.id)===String(id);});if(!item)return;document.getElementById('mf-tit').textContent='✏️ 商品編集';document.getElementById('mf-n').value=item.n;document.getElementById('mf-p').value=item.p;}
  else{document.getElementById('mf-tit').textContent='🛍️ 商品追加';document.getElementById('mf-n').value='';document.getElementById('mf-p').value='';}
  oModal('m-mf');
}
function saveMI(){
  var n=document.getElementById('mf-n').value.trim();var p=parseInt(document.getElementById('mf-p').value)||0;
  if(!n||p<=0){toast('名前と単価を入力してください',true);return;}
  var eid=parseInt(document.getElementById('mf-id').value);
  if(eid){var item=MI.find(function(x){return x.id===eid;});if(item){item.n=n;item.p=p;}}
  else MI.push({id:Date.now(),n:n,p:p});
  sv();saveMerchItemsToSupa();cModal('m-mf');rMerch();toast(eid?(n+' を更新しました'):(n+' を追加しました'));
}
function editMerch(){
  // 保存済み数量をMQに反映してそのまま編集可能にする
  var t=td();var tr=MS.find(function(m){return m.d===t;});
  if(!tr)return;
  for(var i=0;i<tr.i.length;i++) MQ[tr.i[i].id]=tr.i[i].q;
  window._editMerchDate=t;
  // 一旦保存データを削除して編集モードへ
  MS=MS.filter(function(m){return m.d!==t;});
  sv();rMerch();rGuests();
  toast('編集モードにしました。変更後「保存」を押してください');
}
function delMI(id){
  askConfirm('削除しますか？',function(){
    MI=MI.filter(function(x){return String(x.id)!==String(id);});
    delete MQ[id];
    sv();
    saveMerchItemsToSupa();
    supaDelete('pos_merch_items',id);
    rMerch();
    toast('削除しました');
  });
}
function cancelMerch(){
  askConfirm('本日の物販記録を取り消しますか？',function(){
    var t=td();
    var targetRec=MS.find(function(m){return m.d===t;});
    var delId2=targetRec&&targetRec.id?targetRec.id:t;
    MS=MS.filter(function(m){return m.d!==t;});
    for(var id in MQ) MQ[id]=0;
    sv(); // localStorage全体を更新
    // Supabaseから削除してから画面更新
    supaDelete('pos_merch', delId2).then(function(){
      rMerch();rGuests();
      toast('物販記録を取り消しました');
    });
  },'取り消す');
}

// ===== CARTE =====


// ===== STATS =====
function rDay(){
  var ds=fYMD(vD);document.getElementById('d-lbl').textContent=ds;
  var dg=G.filter(function(g){return g.d===ds&&g.st==='done';});
  dg.sort(function(a,b){return (a.ci||'').localeCompare(b.ci||'');});
  var p=0;for(var i=0;i<dg.length;i++)p+=dg[i].a+dg[i].c;
  var s=0;for(var j=0;j<dg.length;j++)s+=dg[j].pr;
  var m=MS.find(function(x){return x.d===ds;});
  var dc=Cheki.filter(function(c){return c.d===ds;});
  var tc=0;dc.forEach(function(c){tc+=c.total;});
  document.getElementById('d-g').textContent=p;document.getElementById('d-s').textContent=(s+(m?m.total:0)+tc).toLocaleString();
  var me=document.getElementById('d-ms'),md=document.getElementById('d-md');
  if((m&&m.i.some(function(i){return i.q>0;}))||dc.length>0){
    me.style.display='block';var mh='';
    if(m)for(var k=0;k<m.i.length;k++){if(m.i[k].q>0)mh+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;"><span>'+m.i[k].n+' × '+m.i[k].q+'</span><span style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;">'+yn(m.i[k].q*m.i[k].p)+'</span></div>';}
    if(dc.length>0)mh+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;"><span>📸 チェキ × '+dc.length+'</span><span style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;">'+yn(tc)+'</span></div>';
    mh+='<div style="display:flex;justify-content:space-between;padding:6px 0 0;font-weight:700;font-size:12px;"><span>物販合計</span><span style="color:var(--ok);font-family:\'Noto Sans JP\',sans-serif;">'+yn((m?m.total:0)+tc)+'</span></div>';
    mh+='<div style="display:flex;gap:8px;margin-top:8px;">';
    mh+='<button onclick="jumpToMerchEdit(\''+ds+'\')" style="flex:1;background:#fff8e8;border:1px solid var(--wn);color:#a06010;padding:6px;border-radius:10px;font-size:11px;cursor:pointer;">✏️ この日の物販を編集</button>';
    mh+='<button onclick="deleteMerchHistory(\''+ds+'\')" style="flex:1;background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:6px;border-radius:10px;font-size:11px;cursor:pointer;">🗑 この日の物販を削除</button>';
    mh+='</div>';
    md.innerHTML=mh;
  }else me.style.display='none';
  var le=document.getElementById('d-list');
  var dsStr=fYMD(vD);
  var lh='<div style="margin-bottom:8px;"><button onclick="openDayAdd()" class="btn bp bsm">➕ 記録を追加</button></div>';
  if(dg.length===0){le.innerHTML=lh+'<div class="empty"><div class="ei">📋</div>記録なし</div>';return;}
  lh+='<table class="st"><thead><tr><th>区分</th><th>人数</th><th>入店</th><th>退店</th><th style="text-align:right;">料金</th><th></th></tr></thead><tbody>';
  for(var l=0;l<dg.length;l++){
    var g=dg[l];
    lh+='<tr>';
    lh+='<td>'+(g.tp==='new'?'新規':'リピ')+(g.operator?'<div style="font-size:9px;color:var(--tx2);white-space:nowrap;">担当:'+g.operator+'</div>':'')+'</td>';
    lh+='<td>'+g.a+(g.c>0?'+子'+g.c:'')+'</td>';
    lh+='<td>'+g.ci+'</td>';
    lh+='<td>'+(g.co||'-')+'</td>';
    lh+='<td class="amt">'+yn(g.pr)+'</td>';
    lh+='<td style="white-space:nowrap;">';
    lh+='<button onclick="oGEdit(\''+String(g.id)+'\')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:2px 7px;border-radius:8px;font-size:10px;cursor:pointer;margin-right:3px;">✏️</button>';
    lh+='<button onclick="dayDelGuest(\''+String(g.id)+'\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:2px 7px;border-radius:8px;font-size:10px;cursor:pointer;">🗑</button>';
    lh+='</td></tr>';
  }
  lh+='</tbody></table>';le.innerHTML=lh;
}
function rMon(){
  var yr=vM.getFullYear(),mo=vM.getMonth();document.getElementById('m-lbl').textContent=yr+'/'+p2(mo+1);
  var mg=G.filter(function(g){var d=new Date(g.d);return d.getFullYear()===yr&&d.getMonth()===mo&&g.st==='done';});
  var p=0;for(var i=0;i<mg.length;i++)p+=mg[i].a+mg[i].c;
  var sb=0;for(var j=0;j<mg.length;j++)sb+=mg[j].pr;
  var mm=MS.filter(function(m){var d=new Date(m.d);return d.getFullYear()===yr&&d.getMonth()===mo;});
  var sm=0;for(var k=0;k<mm.length;k++)sm+=mm[k].total;
  var mc=Cheki.filter(function(c){var d=new Date(c.d);return d.getFullYear()===yr&&d.getMonth()===mo;});
  var sc=0;for(var ci=0;ci<mc.length;ci++)sc+=mc[ci].total;
  document.getElementById('m-g').textContent=p;document.getElementById('m-s').textContent=(sb+sm+sc).toLocaleString();
  var bd={};
  for(var l=0;l<mg.length;l++){var g=mg[l];if(!bd[g.d])bd[g.d]={c:0,s:0};bd[g.d].c+=g.a+g.c;bd[g.d].s+=g.pr;}
  for(var n=0;n<mm.length;n++){var mx=mm[n];if(!bd[mx.d])bd[mx.d]={c:0,s:0};bd[mx.d].s+=mx.total;}
  for(var ni=0;ni<mc.length;ni++){var cx=mc[ni];if(!bd[cx.d])bd[cx.d]={c:0,s:0};bd[cx.d].s+=cx.total;}
  var dates=Object.keys(bd).sort();
  var le=document.getElementById('m-list');
  if(dates.length===0){le.innerHTML='<div class="empty"><div class="ei">📅</div>記録なし</div>';return;}
  var lh='<table class="st"><thead><tr><th>日付</th><th>人数</th><th style="text-align:right;">売上</th><th></th></tr></thead><tbody>';
  for(var q=0;q<dates.length;q++){
    lh+='<tr><td>'+dates[q]+'</td><td>'+bd[dates[q]].c+'名</td><td class="amt">'+yn(bd[dates[q]].s)+'</td>';
    lh+='<td style="white-space:nowrap;"><button onclick="editMonDay(\''+dates[q]+'\')" style="background:#fef0ec;border:1px solid var(--ac);color:var(--ac);padding:3px 7px;border-radius:10px;font-size:11px;cursor:pointer;margin-right:4px;">✏️</button>';
    lh+='<button onclick="delMonDay(\''+dates[q]+'\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:3px 8px;border-radius:10px;font-size:11px;cursor:pointer;">🗑</button></td></tr>';
  }
  lh+='</tbody></table>';le.innerHTML=lh;
}
function delMonDay(date){
  var g1=G.filter(function(g){return g.d===date;});
  var m1=MS.filter(function(m){return m.d===date;});
  if(g1.length===0&&m1.length===0){toast('削除対象が見つかりません',true);return;}
  if(!confirm(date+'の記録（来店'+g1.length+'件・物販'+m1.length+'件）を全て削除しますか？\nこの操作は元に戻せません。'))return;
  logAction('日別まとめ削除',date+' 来店'+g1.length+'件・物販'+m1.length+'件');
  g1.forEach(function(g){supaDelete('pos_guests',g.id);});
  m1.forEach(function(m){supaDelete('pos_merch',m.id||m.d);});
  G=G.filter(function(g){return g.d!==date;});
  MS=MS.filter(function(m){return m.d!==date;});
  sv();rMon();rGuests();toast(date+'の記録を削除しました');
}
function editMonDay(date){
  var g1=G.filter(function(g){return g.d===date;});
  var m1=MS.find(function(m){return m.d===date;});
  document.getElementById('day-edit-title').textContent=date+'の記録';
  var h='';
  if(g1.length===0&&!m1){h='<div class="empty"><div class="ei">📅</div>記録なし</div>';}
  if(g1.length>0){
    h+='<div class="ct" style="margin-top:6px;">🐾 来店記録</div>';
    g1.forEach(function(g){
      h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--bd);">';
      h+='<div><div style="font-size:14px;font-weight:700;">'+g.ci+(g.co?'〜'+g.co:'（滞在中）')+'　大人'+g.a+'名'+(g.c>0?'・子ども'+g.c+'名':'')+'</div>';
      h+='<div style="font-size:12px;color:var(--tx2);">'+(g.member?'⭐'+g.member+'　':'')+yn(g.pr||0)+'</div></div>';
      h+='<button class="btn bp bsm" onclick="cModal(\'m-day-edit\');oGEdit(\''+g.id+'\')">✏️</button></div>';
    });
  }
  if(m1){
    var mtotal=0;m1.i.forEach(function(i){mtotal+=i.q*i.p;});
    h+='<div class="ct" style="margin-top:12px;">🛍️ 物販</div>';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--bd);">';
    h+='<div style="font-size:14px;font-weight:700;">'+yn(mtotal)+'</div>';
    h+='<button class="btn bp bsm" onclick="cModal(\'m-day-edit\');sp(\'p-m\');openMerchEdit(\''+date+'\');">✏️</button></div>';
  }
  document.getElementById('day-edit-body').innerHTML=h;
  oModal('m-day-edit');
}
function rAnket(){
  var yr=aM.getFullYear(),mo=aM.getMonth();document.getElementById('am-lbl').textContent=yr+'/'+p2(mo+1);
  var ag=G.filter(function(g){var d=new Date(g.d);return d.getFullYear()===yr&&d.getMonth()===mo&&g.aq;});
  function mkChart(el,counts,cls){
    var keys=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];});var tot=0;for(var i=0;i<keys.length;i++)tot+=counts[keys[i]];
    if(tot===0){el.innerHTML='<div style="color:var(--tx2);font-size:12px;">データなし</div>';return;}
    var h='';for(var j=0;j<keys.length;j++){var pct=Math.round(counts[keys[j]]/tot*100);h+='<div class="cbar"><div class="cbar-l"><span>'+keys[j]+'</span><span>'+counts[keys[j]]+'件（'+pct+'%）</span></div><div class="cbar-bg"><div class="cbar-fill'+(cls?' '+cls:'')+'" style="width:'+pct+'%;"></div></div></div>';}
    el.innerHTML=h;
  }
  var tc={},ec={},cc2={},chc={};
  for(var i=0;i<ag.length;i++){var aq=ag[i].aq;if(aq.tri)for(var j=0;j<aq.tri.length;j++)tc[aq.tri[j]]=(tc[aq.tri[j]]||0)+1;if(aq.exp)ec[aq.exp]=(ec[aq.exp]||0)+1;if(aq.cats)for(var k=0;k<aq.cats.length;k++)cc2[aq.cats[k]]=(cc2[aq.cats[k]]||0)+1;}
  var monthCheki=Cheki.filter(function(c){var d=new Date(c.d);return d.getFullYear()===yr&&d.getMonth()===mo;});
  for(var ci=0;ci<monthCheki.length;ci++){
    var c=monthCheki[ci];
    if(c.multi){chc['複数']=(chc['複数']||0)+c.qty;}
    else{for(var cj=0;cj<c.cats.length;cj++)chc[c.cats[cj]]=(chc[c.cats[cj]]||0)+c.qty;}
  }
  mkChart(document.getElementById('ch-tri'),tc,'');mkChart(document.getElementById('ch-exp'),ec,'gr');mkChart(document.getElementById('ch-cat'),cc2,'pu');mkChart(document.getElementById('ch-cheki'),chc,'pk');
}
function openCal(inputId){
  var el=document.getElementById(inputId);if(!el)return;
  try{el.showPicker();}catch(e){el.style.pointerEvents='auto';el.focus();el.click();}
}
function jumpD(val){if(!val)return;var p=val.split('-');vD=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));rDay();}
function jumpM(val){if(!val)return;var p=val.split('-');vM=new Date(parseInt(p[0]),parseInt(p[1])-1,1);rMon();}
function jumpAM(val){if(!val)return;var p=val.split('-');aM=new Date(parseInt(p[0]),parseInt(p[1])-1,1);rAnket();}
function jumpZM(val){if(!val)return;var p=val.split('-');zM=new Date(parseInt(p[0]),parseInt(p[1])-1,1);rZAnalysis();}
function jumpKM(val){if(!val)return;var p=val.split('-');kM=new Date(parseInt(p[0]),parseInt(p[1])-1,1);window._kShowAll=false;rCash();}
function chD(d){vD.setDate(vD.getDate()+d);rDay();}
function chM(d){vM.setMonth(vM.getMonth()+d);rMon();}
function chAM(d){aM.setMonth(aM.getMonth()+d);rAnket();}
function dayDelGuest(id){
  askConfirm('この記録を削除しますか？',function(){
    var g=G.find(function(x){return String(x.id)===String(id);});
    logAction('来店記録を削除',(g?(g.d+' '+g.ci+'〜'+(g.co||'滞在中')+' 大人'+g.a+'名 ¥'+(g.pr||0)):('id:'+id)));
    G=G.filter(function(x){return String(x.id)!==String(id);});
    sv();supaDelete('pos_guests',id);rDay();rGuests();toast('削除しました');
  });
}
function geCnt(which,delta){
  var el=document.getElementById('ge-'+which);
  var v=Math.max(0,(parseInt(el.value)||0)+delta);
  el.value=v;
  var disp=document.getElementById('ge-'+which+'-disp');if(disp)disp.textContent=v;
}
function geSetCnt(which,v){
  var el=document.getElementById('ge-'+which);if(el)el.value=v;
  var disp=document.getElementById('ge-'+which+'-disp');if(disp)disp.textContent=v;
}
function resetPastForm(keepDate){
  document.getElementById('ge-id').value='';
  document.getElementById('ge-tp').value='new';
  document.getElementById('ge-pt').value='友人';
  geSetCnt('a',1);geSetCnt('c',0);
  setTime('ge-ci','12:00');
  setTime('ge-co','13:00');
  document.getElementById('ge-pr').value='';
  document.getElementById('ge-mo').value='';
  var dn=document.getElementById('ge-disc-name');if(dn)dn.value='';
  var da=document.getElementById('ge-disc-amt');if(da)da.value=0;
  var gm=document.getElementById('ge-member');if(gm)gm.value='';
  // アンケートもクリア
  eaqCh={tri:[],exp:'',cats:[]};
  if(typeof buildEaqChips==='function')buildEaqChips();
  var exps=document.querySelectorAll('#eaq-exp .chip');for(var i=0;i<exps.length;i++)exps[i].classList.remove('on');
  // 日付は保持
  if(keepDate){document.getElementById('ge-id').setAttribute('data-date',keepDate);var de=document.getElementById('ge-date');if(de)de.value=keepDate;}
}
function openPastAdd(){
  // 今日の日付をデフォルトにセット（過去の日付にしたい場合は日付欄で変更可能）
  var tStr=td();
  document.getElementById('ge-id').value='';
  document.getElementById('ge-tp').value='new';
  document.getElementById('ge-pt').value='友人';
  geSetCnt('a',1);geSetCnt('c',0);
  setTime('ge-ci','12:00');
  setTime('ge-co','13:00');
  document.getElementById('ge-pr').value='';
  document.getElementById('ge-mo').value='';
  document.getElementById('ge-id').setAttribute('data-date', tStr);
  var dateEl=document.getElementById('ge-date');
  if(dateEl)dateEl.value=tStr;
  window._geFN=false;window._geKD=false;
  var geFnBtn0=document.getElementById('ge-fn-btn'),geKdBtn0=document.getElementById('ge-kd-btn');
  if(geFnBtn0){geFnBtn0.style.background='var(--sf2)';geFnBtn0.style.borderColor='var(--bd)';geFnBtn0.style.color='var(--tx2)';geFnBtn0.textContent='🐱 フリーにゃん OFF';}
  if(geKdBtn0){geKdBtn0.style.background='var(--sf2)';geKdBtn0.style.borderColor='var(--bd)';geKdBtn0.style.color='var(--tx2)';geKdBtn0.textContent='🧒 キッズデイ OFF';}
  oModal('m-gedit');
}

function openDayAdd(){
  // 日別追加：ge-idを空にしてgeditモーダルを開く
  document.getElementById('ge-id').value='';
  document.getElementById('ge-tp').value='new';
  document.getElementById('ge-pt').value='友人';
  geSetCnt('a',1);geSetCnt('c',0);
  setTime('ge-ci','12:00');
  setTime('ge-co','13:00');
  document.getElementById('ge-pr').value='';
  document.getElementById('ge-mo').value='';
  // 日付をvDの日付にセット
  document.getElementById('ge-id').setAttribute('data-date', fYMD(vD));
  var dateEl2=document.getElementById('ge-date');
  if(dateEl2)dateEl2.value=fYMD(vD);
  window._geFN=false;window._geKD=false;
  var geFnBtn0=document.getElementById('ge-fn-btn'),geKdBtn0=document.getElementById('ge-kd-btn');
  if(geFnBtn0){geFnBtn0.style.background='var(--sf2)';geFnBtn0.style.borderColor='var(--bd)';geFnBtn0.style.color='var(--tx2)';geFnBtn0.textContent='🐱 フリーにゃん OFF';}
  if(geKdBtn0){geKdBtn0.style.background='var(--sf2)';geKdBtn0.style.borderColor='var(--bd)';geKdBtn0.style.color='var(--tx2)';geKdBtn0.textContent='🧒 キッズデイ OFF';}
  oModal('m-gedit');
}
function stab(t){
  var tabs={d:'ts-d',m:'ts-m',a:'ts-a',p:'ts-p',e:'ts-e',z:'ts-z'};var divs={d:'s-d',m:'s-m',a:'s-a',p:'s-p',e:'s-e',z:'s-z'};
  for(var k in tabs){document.getElementById(tabs[k]).classList.toggle('active',k===t);document.getElementById(divs[k]).style.display=k===t?'block':'none';}
  if(t==='p')rPastData();
  if(t==='e'){rESummary2();}
}

// ===== CASH =====
// 持ち帰りメンバー管理
var CarryMembers = JSON.parse(localStorage.getItem('wc_carry_members') || '["オーナー","田染"]');
function saveCarryMembers(){ localStorage.setItem('wc_carry_members', JSON.stringify(CarryMembers)); }
function buildCarrySelect(){
  var sel = document.getElementById('k-carry-name');
  if(!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">— 氏名を選択 —</option>';
  for(var i=0; i<CarryMembers.length; i++){
    var opt = document.createElement('option');
    opt.value = CarryMembers[i];
    opt.textContent = CarryMembers[i];
    if(CarryMembers[i] === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}
function addCarryMember(){
  var name = prompt('追加する氏名を入力してください');
  if(!name || !name.trim()) return;
  name = name.trim();
  if(CarryMembers.indexOf(name) >= 0){ toast('すでに登録されています', true); return; }
  CarryMembers.push(name);
  saveCarryMembers();
  buildCarrySelect();
  document.getElementById('k-carry-name').value = name;
  toast(name + ' を追加しました');
}

var BILLS=[{id:'b10k',l:'1万円',v:10000},{id:'b5k',l:'5千円',v:5000},{id:'b2k',l:'2千円',v:2000},{id:'b1k',l:'千円',v:1000},{id:'b500',l:'500円',v:500}];
var COINS=[{id:'c100',l:'100円',v:100},{id:'c50',l:'50円',v:50},{id:'c10',l:'10円',v:10},{id:'c5',l:'5円',v:5},{id:'c1',l:'1円',v:1}];
var AD=BILLS.concat(COINS);var CQ={};
function buildDenomRows(){
  function mkR(d){return '<div class="drow"><div class="dlbl">'+d.l+'</div><div class="dprev" id="pv-'+d.id+'">—</div><div class="dctrl"><button class="dbtn" onclick="chDQ(\''+d.id+'\',-1)">－</button><input type="number" inputmode="numeric" pattern="[0-9]*" class="dqin" id="dq-'+d.id+'" value="0" min="0" onchange="setDQ(\''+d.id+'\',this.value)" onfocus="this.select()"><button class="dbtn" onclick="chDQ(\''+d.id+'\',1)">＋</button></div><div class="dsub" id="ds-'+d.id+'">—</div></div>';}
  var bh='',ch='';for(var i=0;i<BILLS.length;i++)bh+=mkR(BILLS[i]);for(var j=0;j<COINS.length;j++)ch+=mkR(COINS[j]);
  document.getElementById('d-bills').innerHTML=bh;document.getElementById('d-coins').innerHTML=ch;
}
function setDQ(id,val){
  var q=parseInt(val)||0;if(q<0)q=0;
  CQ[id]=q;
  var d=null;for(var i=0;i<AD.length;i++){if(AD[i].id===id){d=AD[i];break;}}if(!d)return;
  var inEl=document.getElementById('dq-'+id);if(inEl)inEl.value=q;
  var dsEl=document.getElementById('ds-'+id);if(dsEl)dsEl.textContent=q>0?yn(q*d.v):'—';
  var pvEl=document.getElementById('pv-'+id);
  if(pvEl){
    var prevVal=parseInt(pvEl.getAttribute('data-prev'))||0;var diffQ=q-prevVal;
    if(diffQ>0){pvEl.style.color='var(--ok)';pvEl.style.fontWeight='700';pvEl.title='前日比 +'+diffQ;}
    else if(diffQ<0){pvEl.style.color='var(--ng)';pvEl.style.fontWeight='700';pvEl.title='前日比 '+diffQ;}
    else{pvEl.style.color='var(--tx2)';pvEl.style.fontWeight='normal';pvEl.title='';}
  }
  rcCash();
}
function oCash(){
  window._editCashId=null;
  document.getElementById('k-d').value=td();document.getElementById('k-sup').value=0;document.getElementById('k-carry').value=0;document.getElementById('k-mo').value='';
  var se=document.getElementById('k-sales');if(se)se.value='';
  buildCarrySelect();
  loadPrev();rcCash();oModal('m-cash');
}
function editCash(idOrDate){
  var rec=CR.find(function(r){return String(r.id)===String(idOrDate);});
  if(!rec)rec=CR.find(function(r){return r.d===idOrDate;});
  if(!rec)return;
  var date=rec.d;
  window._editCashId=rec.id||null;
  document.getElementById('k-d').value=date;
  document.getElementById('k-sup').value=rec.sup||0;
  document.getElementById('k-carry').value=rec.carry||0;
  document.getElementById('k-mo').value=rec.memo||'';
  var se=document.getElementById('k-sales');if(se)se.value=(typeof rec.sales==='number')?rec.sales:'';
  buildCarrySelect();
  var cn=document.getElementById('k-carry-name');if(cn)cn.value=rec.carryName||'';
  // 保存済みの各金種枚数を読み込む（前日ではなく実データ）
  for(var i=0;i<AD.length;i++){
    var d=AD[i];var q=rec[d.id]||0;
    CQ[d.id]=q;
    var dqEl=document.getElementById('dq-'+d.id);var dsEl=document.getElementById('ds-'+d.id);
    if(dqEl)dqEl.value=q;if(dsEl)dsEl.textContent=q>0?yn(q*d.v):'—';
    // 前日比の表示も更新
    var prevSorted=CR.filter(function(r){return r.d<date;}).sort(function(a,b){return b.d.localeCompare(a.d);});
    var prev=prevSorted.length?prevSorted[0]:null;
    var pq=prev?(prev[d.id]||0):0;
    var pvEl=document.getElementById('pv-'+d.id);
    if(pvEl){pvEl.textContent=pq>0?pq:'—';pvEl.setAttribute('data-prev',pq);
      var diffQ=q-pq;
      if(diffQ>0){pvEl.style.color='var(--ok)';pvEl.style.fontWeight='700';}
      else if(diffQ<0){pvEl.style.color='var(--ng)';pvEl.style.fontWeight='700';}
      else{pvEl.style.color='var(--tx2)';pvEl.style.fontWeight='normal';}
    }
  }
  rcCash();
  oModal('m-cash');
}
function delCash(idOrDate){
  var rec=CR.find(function(r){return String(r.id)===String(idOrDate);});
  // 旧データ（idなし）は日付で1件だけ探す
  if(!rec)rec=CR.find(function(r){return r.d===idOrDate;});
  if(!rec){toast('記録が見つかりません',true);return;}
  askConfirm(rec.d+' の金種記録を削除しますか？',function(){
    logAction('金種記録を削除',rec.d);
    // ID一致で1件だけ消す（同じ日付の他の記録は残す）
    if(rec.id){CR=CR.filter(function(r){return String(r.id)!==String(rec.id);});}
    else{CR=CR.filter(function(r){return r!==rec;});}
    sv();
    if(rec.id)supaDelete('pos_cash',String(rec.id));
    rCash();toast('削除しました');
  });
}
function loadPrev(){
  var date=document.getElementById('k-d').value;
  var sorted=CR.filter(function(r){return r.d<date;}).sort(function(a,b){return b.d.localeCompare(a.d);});
  var prev=sorted.length?sorted[0]:null;
  for(var i=0;i<AD.length;i++){var d=AD[i];var pq=prev?(prev[d.id]||0):0;var pvEl=document.getElementById('pv-'+d.id);var dqEl=document.getElementById('dq-'+d.id);var dsEl=document.getElementById('ds-'+d.id);if(pvEl){pvEl.textContent=pq>0?pq:'—';pvEl.setAttribute('data-prev',pq);pvEl.style.color='var(--tx2)';pvEl.style.fontWeight='normal';pvEl.title='';}CQ[d.id]=pq;if(dqEl)dqEl.value=pq;if(dsEl)dsEl.textContent=pq>0?yn(pq*d.v):'—';}
  // 日付が変わったら、常にその日の売上を計算し直す（前の日付の数字を持ち越さない）
  var se=document.getElementById('k-sales');if(se)se.value='';
  rcCash();
}
function chDQ(id,delta){
  var cur=parseInt(CQ[id])||0;
  setDQ(id, Math.max(0,cur+delta));
}
function recalcKSales(){
  var se=document.getElementById('k-sales');
  if(se)se.value='';
  rcCash();
  toast('最新の来店・物販データで再計算しました');
}
function rcCash(){
  var date=document.getElementById('k-d').value||td();var dt=0;for(var i=0;i<AD.length;i++)dt+=(CQ[AD[i].id]||0)*AD[i].v;
  var sup=parseInt(document.getElementById('k-sup').value)||0;var carry=parseInt(document.getElementById('k-carry').value)||0;
  var grand=dt+sup;
  // 実際の金庫の金額 = 数えた金種合計そのもの（持ち帰りは「あるべき金額」の計算にだけ使う）
  var net=grand;
  // 本日の売上：自動集計（来店料金＋物販）
  var dg=G.filter(function(g){return g.d===date&&g.st==='done';});var gs=0;for(var j=0;j<dg.length;j++)gs+=dg[j].pr;
  var mr=MS.find(function(m){return m.d===date;});var autoTot=gs+(mr?mr.total:0);
  // 訂正欄に値があればそれを使う。空なら自動集計値を欄に反映
  var salesEl=document.getElementById('k-sales');
  var tot;
  if(salesEl && salesEl.value!==''){ tot=parseInt(salesEl.value)||0; }
  else { tot=autoTot; if(salesEl)salesEl.value=autoTot; }
  // 前日のレジ残高を取得
  var prevSorted=CR.filter(function(r){return r.d<date;}).sort(function(a,b){return b.d.localeCompare(a.d);});
  var prevRec=prevSorted.length?prevSorted[0]:null;
  var prevNet=prevRec?(prevRec.net||prevRec.grand):0;
  // あるべき金額 = 前日残高 + 本日売上 − 持ち帰り
  var expected=prevNet+tot-carry;
  // 過不足 = 実際の金庫（数えた金種合計） − あるべき金額
  var diff=net-expected;
  var noPrev = !prevRec;
  var ch=document.getElementById('k-carry-h');if(ch)ch.textContent=carry>0?('金種合計 '+yn(grand)+' から '+yn(carry)+' を回収'):'金種合計から引かれます';
  var dc=diff>0?'ov2':diff<0?'un':'';
  var diffColor=diff>0?'var(--ok)':diff<0?'var(--ng)':'var(--tx2)';
  var msg=diff>0?('⚠️ '+yn(Math.abs(diff))+' 多いです'):diff<0?('⚠️ '+yn(Math.abs(diff))+' 足りません'):'✅ ぴったりです';
  var h='';
  // 金種合計・回収
  h+='<div class="csb tot full"><div class="csl">金種合計（回収前）</div><div class="csv">'+yn(grand)+'</div></div>';
  if(carry>0)h+='<div class="csb car full"><div class="csl">🏦 回収額</div><div class="csv">'+yn(carry)+'</div></div>';
  // わかりやすい内訳表（上から順に読める）
  h+='<div class="csb full" style="background:#fff;border:1.5px solid var(--bd);"><div style="width:100%;font-size:13px;line-height:2.2;">';
  h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">前日の金庫</span><b>'+(noPrev?'記録なし':yn(prevNet))+'</b></div>';
  h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">＋ 本日の売上</span><b style="color:var(--ok);">'+yn(tot)+'</b></div>';
  if(carry>0)h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">－ 持ち帰り</span><b style="color:var(--wn);">'+yn(carry)+'</b></div>';
  h+='<div style="display:flex;justify-content:space-between;border-top:1.5px dashed var(--bd);margin-top:4px;padding-top:4px;"><span style="font-weight:700;">＝ あるべき金額</span><b style="font-size:15px;">'+(noPrev?'—':yn(expected))+'</b></div>';
  h+='<div style="display:flex;justify-content:space-between;"><span style="font-weight:700;">実際の金額</span><b style="font-size:15px;color:var(--ac);">'+yn(net)+'</b></div>';
  h+='</div></div>';
  // 判定（大きく・差額を強調）
  if(noPrev){
    h+='<div class="csb full" style="text-align:center;padding:14px;background:var(--sf2);"><div style="font-size:13px;color:var(--tx2);">前日の記録がないため<br>過不足は判定できません</div></div>';
  }else{
    h+='<div class="csb '+dc+' full" style="text-align:center;padding:14px;"><div class="csl" style="margin-bottom:4px;">過不足の判定</div><div style="font-size:20px;font-weight:800;color:'+diffColor+';">'+msg+'</div></div>';
  }
  document.getElementById('k-sum').innerHTML=h;
  // 保存ボタン用に現在の差額を保持
  window._cashDiff = noPrev ? 0 : diff;
  window._cashNoPrev = noPrev;
  var moEl=document.getElementById('k-mo');
  if(moEl && diff!==0 && !moEl.value){
    moEl.placeholder = diff>0 ? '例：チェキ売上の計上漏れ／つり銭多め' : '例：レジ打ち忘れ／釣銭間違い';
  } else if(moEl && diff===0){
    moEl.placeholder='';
  }
}
function saveCash(){
  var date=document.getElementById('k-d').value;
  if(!date){toast('日付を入力してください',true);return;}
  // 同じ日付が既にある＆編集中でない → 上書き確認
  var existing=CR.find(function(r){return r.d===date;});
  if(existing && !window._editCashId){
    askConfirm(date+' の金種はすでに登録されています。\n上書きしますか？',function(){
      window._editCashId=existing.id;  // 既存を上書き対象に
      proceedSaveCash();
    },'上書きする');
    return;
  }
  proceedSaveCash();
}
function proceedSaveCash(){
  // 過不足チェック（前日記録があってズレている場合は警告）
  rcCash(); // 最新の差額を計算
  var diff=window._cashDiff||0;
  var noPrev=window._cashNoPrev;
  var memo=document.getElementById('k-mo').value.trim();
  if(!noPrev && diff!==0){
    // ズレている → メモ必須
    if(!memo){
      var msg=diff<0?('現金が '+yn(Math.abs(diff))+' 足りません。'):('現金が '+yn(Math.abs(diff))+' 多いです。');
      askConfirm(msg+'\n金庫を数え直してください。\nそれでも保存する場合は、メモに理由を書いてから保存してください。',function(){
        document.getElementById('k-mo').focus();
      },'メモを書く');
      return;
    }
  }
  // 担当者を選ぶ
  openCashStaffPicker();
}
function openCashStaffPicker(){
  var el=document.getElementById('cash-staff-btns');
  var h='';
  for(var i=0;i<StaffList.length;i++){
    h+='<button onclick="doSaveCash(\''+StaffList[i].replace(/'/g,"\\'")+'\')" style="width:100%;padding:13px;background:var(--sf2);border:1.5px solid var(--bd);border-radius:12px;font-size:15px;font-weight:700;color:var(--tx);cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">'+StaffList[i]+'</button>';
  }
  h+='<button onclick="doSaveCash(\'\')" style="width:100%;padding:11px;background:none;border:1.5px dashed var(--bd);border-radius:12px;font-size:12px;color:var(--tx2);cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">担当者なしで保存</button>';
  el.innerHTML=h;
  oModal('m-cash-staff');
}
function doSaveCash(staffName){
  cModal('m-cash-staff');
  var date=document.getElementById('k-d').value;var sup=parseInt(document.getElementById('k-sup').value)||0;var carry=parseInt(document.getElementById('k-carry').value)||0;
  var dt=0;for(var i=0;i<AD.length;i++)dt+=(CQ[AD[i].id]||0)*AD[i].v;
  var grand=dt+sup,net=grand;
  var carryName=document.getElementById('k-carry-name')?document.getElementById('k-carry-name').value:'';
  var salesEl=document.getElementById('k-sales');var sales=salesEl&&salesEl.value!==''?parseInt(salesEl.value)||0:0;
  // 編集中なら既存IDを引き継ぐ。新規なら新しいID
  var useId=window._editCashId||Date.now();
  var data={d:date,memo:document.getElementById('k-mo').value,sup:sup,carry:carry,carryName:carryName,sales:sales,grand:grand,net:net,staff:staffName||'',id:useId};
  for(var j=0;j<AD.length;j++)data[AD[j].id]=CQ[AD[j].id]||0;
  // 同じIDの記録だけ置き換える（同じ日付の別記録は消さない）
  CR=CR.filter(function(r){return String(r.id)!==String(useId);});
  CR.push(data);sv();saveCashToSupa(data);
  window._editCashId=null;
  cModal('m-cash');rCash();
  toast('金種登録しました 💴'+(staffName?'（'+staffName+'）':''));
}
function chKM(d){kM.setMonth(kM.getMonth()+d);window._kShowAll=false;rCash();}
function toggleKShowAll(){
  window._kShowAll=!window._kShowAll;
  rCash();
}
function rCash(){
  var yr=kM.getFullYear(),mo=kM.getMonth();document.getElementById('k-lbl').textContent=yr+'/'+p2(mo+1);
  var recs=CR.filter(function(r){var d=new Date(r.d);return d.getFullYear()===yr&&d.getMonth()===mo;}).sort(function(a,b){return a.d.localeCompare(b.d);});
  var el=document.getElementById('k-list');
  if(recs.length===0){
    el.innerHTML='<div class="empty"><div class="ei">💴</div>金種記録なし</div>';
    var kCtxEmpty=document.getElementById('k-chart');
    if(kCtxEmpty && window.kChart){window.kChart.destroy();window.kChart=null;}
    return;
  }
  // 全期間分を毎回スキャンしないよう、事前に1回だけ整理しておく（記録が増えても重くならないように）
  var crSorted=CR.slice().sort(function(a,b){return a.d.localeCompare(b.d);});
  var gSalesByDate={};
  G.forEach(function(g){if(g.st==='done'){gSalesByDate[g.d]=(gSalesByDate[g.d]||0)+g.pr;}});
  var msByDate={};
  MS.forEach(function(m){msByDate[m.d]=m;});
  var h='';
  // 表示は新しい日付が上に来るように並び替え。最初は直近7件だけ描画し、
  // 「もっと見る」ボタンで残りをまとめて表示する（件数が多い月でも軽くするため）
  var dispRecs=recs.slice().reverse();
  var showAll=!!window._kShowAll;
  var visibleRecs=showAll?dispRecs:dispRecs.slice(0,7);
  for(var i=0;i<visibleRecs.length;i++){
    var r=visibleRecs[i];
    // 前日比で過不足を計算（月をまたいでも全期間から直前の記録を探す）
    var prevRec=null;
    for(var pIdx=crSorted.length-1;pIdx>=0;pIdx--){if(crSorted[pIdx].d<r.d){prevRec=crSorted[pIdx];break;}}
    // 前日・当日とも「数えた金種合計(grand)」を実際の金庫として使う
    var prevNet=prevRec?(prevRec.grand||prevRec.net):0;
    var todayNet=r.grand||r.net;
    // 本日の売上
    var gs=gSalesByDate[r.d]||0;
    var mr=msByDate[r.d];var autoSales=gs+(mr?mr.total:0);
    var daySales=(typeof r.sales==='number' && r.sales>0)?r.sales:autoSales;
    // あるべき金額 = 前日残高 ＋ 本日売上 − 持ち帰り
    var expected=prevNet+daySales-(r.carry||0);
    var diff=prevRec?(todayNet-expected):0;
    var dc=diff>0?'plus':diff<0?'minus':'zero';var dl=diff>0?('+'+yn(diff)+' 多い'):diff<0?(yn(Math.abs(diff))+' 不足'):'✅ ぴったり';
    h+='<div class="card" style="margin-bottom:8px;">';
    // 日付・担当者・実際の金庫
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div style="font-size:14px;font-weight:700;">'+r.d+(r.staff?' <span style="font-size:11px;color:var(--tx2);font-weight:400;">／'+r.staff+'</span>':'')+'</div></div>';
    // 内訳（前日＋売上−持ち帰り＝あるべき、実際）
    h+='<div style="font-size:13px;line-height:2;background:var(--sf2);border-radius:10px;padding:10px 12px;margin-bottom:8px;">';
    h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">前日の金庫</span><b>'+(prevRec?yn(prevNet):'記録なし')+'</b></div>';
    h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">＋ 売上</span><b style="color:var(--ok);">'+yn(daySales)+'</b></div>';
    if(r.carry>0)h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tx2);">－ 持ち帰り（'+(r.carryName||'')+'）</span><b style="color:#a06010;">'+yn(r.carry)+'</b></div>';
    h+='<div style="display:flex;justify-content:space-between;border-top:1.5px dashed var(--bd);margin-top:2px;padding-top:2px;"><span style="font-weight:700;">あるべき金額</span><b>'+(prevRec?yn(expected):'—')+'</b></div>';
    h+='<div style="display:flex;justify-content:space-between;"><span style="font-weight:700;">実際の金庫</span><b style="font-size:16px;color:var(--ac);">'+yn(todayNet)+'</b></div>';
    h+='</div>';
    // 判定
    var diffStyle=dc==='plus'?'background:#eaf5ef;border:1px solid var(--ok);color:var(--ok);':dc==='minus'?'background:#fef0ec;border:1px solid var(--pk);color:var(--ng);':'background:#eaf5ef;border:1px solid var(--ok);color:var(--ok);';
    h+='<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">';
    h+='<span style="font-size:12px;padding:3px 12px;border-radius:16px;font-weight:700;'+diffStyle+'">'+(prevRec?dl:'前日記録なし')+'</span>';
    if(r.memo)h+='<span class="tag">📝 '+r.memo+'</span>';
    h+='</div>';
    h+='<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px;">';
    h+='<button onclick="editCash(\''+(r.id||r.d)+'\')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:4px 12px;border-radius:12px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">✏️ 編集</button>';
    h+='<button onclick="delCash(\''+(r.id||r.d)+'\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:4px 12px;border-radius:12px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">🗑 削除</button>';
    h+='</div>';
    h+='</div>';
  }
  if(dispRecs.length>7){
    if(showAll){
      h+='<button onclick="toggleKShowAll()" class="btn bs bf" style="margin-bottom:8px;">▲ 直近7件だけ表示</button>';
    }else{
      h+='<button onclick="toggleKShowAll()" class="btn bs bf" style="margin-bottom:8px;">▼ 残り'+(dispRecs.length-7)+'件をもっと見る</button>';
    }
  }
  // 持ち帰り月次集計
  var carryByPerson={};
  for(var ci=0;ci<recs.length;ci++){
    var rc=recs[ci];
    if(rc.carry>0){
      var nm=rc.carryName||'不明';
      carryByPerson[nm]=(carryByPerson[nm]||0)+rc.carry;
    }
  }
  var ckeys=Object.keys(carryByPerson);
  if(ckeys.length>0){
    var ch='<div class="card" style="border-top:3px solid var(--wn);margin-bottom:10px;"><div class="ct">🏦 今月の持ち帰り集計</div>';
    for(var ck=0;ck<ckeys.length;ck++){
      ch+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:13px;"><span>'+ckeys[ck]+'</span><span style="color:var(--wn);font-weight:700;">'+yn(carryByPerson[ckeys[ck]])+'</span></div>';
    }
    ch+='</div>';
    h = ch + h;
  }
  el.innerHTML=h;
  // 月内残高推移グラフ
  var kCtx=document.getElementById('k-chart');
  if(kCtx){
    if(window.kChart){window.kChart.destroy();}
    var labels=recs.map(function(r){return r.d.slice(5);});
    var vals=recs.map(function(r){return r.grand||r.net;});
    window.kChart=new Chart(kCtx.getContext('2d'),{
      type:'line',
      data:{labels:labels,datasets:[{data:vals,borderColor:'#e8838f',backgroundColor:'rgba(232,131,143,.15)',borderWidth:2,pointRadius:3,fill:true,tension:.3}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:function(v){return v>=10000?(v/10000)+'万':v;}}}}}
    });
  }
}

// ===== EXPORT/IMPORT =====
function expData(){
  var data=JSON.stringify({G:G,CR:CR,MS:MS,MI:MI,CU:CU,Cats:Cats,Tris:Tris,BCs:BCs,ESales:ESales},null,2);
  var blob=new Blob([data],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wecats_'+td()+'.json';a.click();cModal('m-menu');
}
function impData(e){
  var f=e.target.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(ev){
    try{var d=JSON.parse(ev.target.result);if(d.G)G=d.G;if(d.CR)CR=d.CR;if(d.MS)MS=d.MS;if(d.MI)MI=d.MI;if(d.CU)CU=d.CU;if(d.Cats)Cats=d.Cats;if(d.Tris)Tris=d.Tris;if(d.BCs)BCs=d.BCs;if(d.ESales)ESales=d.ESales;sv();rfAll();cModal('m-menu');toast('インポートしました！');}
    catch(err){toast('インポートエラー',true);}
  };r.readAsText(f);
}

// ===== GUEST EDIT =====
function oGEdit(id){
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;cModal('m-det');
  document.getElementById('ge-id').value=id;document.getElementById('ge-tp').value=g.tp;document.getElementById('ge-pt').value=g.pt;
  geSetCnt('a',g.a);geSetCnt('c',g.c);setTime('ge-ci',g.ci);
  setTime('ge-co',g.co||'');document.getElementById('ge-pr').value=g.pr||'';document.getElementById('ge-mo').value=g.mo||'';
  document.getElementById('ge-disc-name').value='';document.getElementById('ge-disc-amt').value=0;
  buildMemberSelects();var gem=document.getElementById('ge-member');if(gem)gem.value=g.member||'';
  window._geFN=!!g.fn;window._geKD=!!g.kd;
  var geFnBtn=document.getElementById('ge-fn-btn'),geKdBtn=document.getElementById('ge-kd-btn');
  if(geFnBtn){if(window._geFN){geFnBtn.style.background='linear-gradient(135deg,#f0f8ee,#e4f4e0)';geFnBtn.style.borderColor='var(--ac2)';geFnBtn.style.color='#5a8050';geFnBtn.textContent='🐱 フリーにゃん ON ✓';}else{geFnBtn.style.background='var(--sf2)';geFnBtn.style.borderColor='var(--bd)';geFnBtn.style.color='var(--tx2)';geFnBtn.textContent='🐱 フリーにゃん OFF';}}
  if(geKdBtn){if(window._geKD){geKdBtn.style.background='linear-gradient(135deg,#fff8e8,#ffe0a0)';geKdBtn.style.borderColor='var(--wn)';geKdBtn.style.color='#a06010';geKdBtn.textContent='🧒 キッズデイ ON ✓';}else{geKdBtn.style.background='var(--sf2)';geKdBtn.style.borderColor='var(--bd)';geKdBtn.style.color='var(--tx2)';geKdBtn.textContent='🧒 キッズデイ OFF';}}
  // アンケートを読み込む
  var aq=g.aq||{};
  eaqCh={tri:(aq.tri||[]).slice(),exp:aq.exp||'',cats:(aq.cats||[]).slice()};
  window._eaqGid=id;
  buildEaqChips();
  var exps=document.querySelectorAll('#eaq-exp .chip');
  for(var ei=0;ei<exps.length;ei++){exps[ei].classList.remove('on');if(exps[ei].getAttribute('data-v')===eaqCh.exp)exps[ei].classList.add('on');}
  oModal('m-gedit');
}
function saveGEdit(){
  var id=document.getElementById('ge-id').value;
  // idが空なら新規追加
  if(!id){
    var dateAttr=document.getElementById('ge-date').value||document.getElementById('ge-id').getAttribute('data-date')||td();
    var newId=String(Date.now());
    var a=parseInt(document.getElementById('ge-a').value)||1;
    var c=parseInt(document.getElementById('ge-c').value)||0;
    var ci=getTime('ge-ci');
    var co=getTime('ge-co');
    var prInput=document.getElementById('ge-pr').value;
    var pr=prInput!==''?parseInt(prInput):0;
    if(prInput===''&&co){var r=calcP(a,c,ci,co,dateAttr,!!window._geFN,window._geKD?true:undefined);pr=r.t;}
    var discAmt2=parseInt(document.getElementById('ge-disc-amt').value)||0;
    if(discAmt2>0)pr=Math.max(0,pr-discAmt2);
    var discName2=document.getElementById('ge-disc-name').value.trim();
    var moVal2=document.getElementById('ge-mo').value;
    if(discName2&&discAmt2>0)moVal2=(moVal2?moVal2+' ':'')+discName2+' -¥'+discAmt2.toLocaleString();
    var expEl0=document.querySelector('#eaq-exp .chip.on');var exp0=expEl0?expEl0.getAttribute('data-v'):'';
    var newG={id:newId,d:dateAttr,tp:document.getElementById('ge-tp').value,pt:document.getElementById('ge-pt').value,member:document.getElementById('ge-member')?document.getElementById('ge-member').value:'',a:a,c:c,ci:ci,co:co||null,pr:pr,mo:moVal2,st:co?'done':'stay',fn:!!window._geFN,kd:!!window._geKD,bc:'',bcn:'',aq:{tri:eaqCh.tri.slice(),exp:exp0,cats:eaqCh.cats.slice()}};
    G.push(newG);sv();saveGuestToSupa(newG);rfAll();
    // 連続入力のためフォームをリセット（日付は保持）。モーダルは開いたまま
    resetPastForm(dateAttr);
    toast('📅 '+dateAttr+' に記録を追加しました ✅ 続けて入力できます');return;
  }
  var g=G.find(function(x){return String(x.id)===String(id);});if(!g)return;
  var a=parseInt(document.getElementById('ge-a').value)||1;var c=parseInt(document.getElementById('ge-c').value)||0;
  var ci=getTime('ge-ci');var co=getTime('ge-co');
  var prInput=document.getElementById('ge-pr').value;var pr=prInput!==''?parseInt(prInput):0;
  if(prInput===''&&co){var r=calcP(a,c,ci,co,g.d,!!window._geFN,window._geKD?true:undefined);pr=r.t;}
  var discAmt=parseInt(document.getElementById('ge-disc-amt').value)||0;
  if(discAmt>0)pr=Math.max(0,pr-discAmt);
  var discName=document.getElementById('ge-disc-name').value.trim();
  var moVal=document.getElementById('ge-mo').value;
  if(discName&&discAmt>0)moVal=(moVal?moVal+' ':'')+discName+' -¥'+discAmt.toLocaleString();
  g.tp=document.getElementById('ge-tp').value;g.pt=document.getElementById('ge-pt').value;g.member=document.getElementById('ge-member')?document.getElementById('ge-member').value:'';g.a=a;g.c=c;g.ci=ci;g.co=co||null;g.pr=pr;g.mo=moVal;g.st=co?'done':'stay';g.fn=!!window._geFN;g.kd=!!window._geKD;
  var expElE=document.querySelector('#eaq-exp .chip.on');g.aq={tri:eaqCh.tri.slice(),exp:expElE?expElE.getAttribute('data-v'):'',cats:eaqCh.cats.slice()};
  sv();var editedG=G.find(function(x){return String(x.id)===String(id);});if(editedG)saveGuestToSupa(editedG);cModal('m-gedit');rfAll();toast('編集しました ✅');
}
function delGuest(){var id=document.getElementById('ge-id').value;var g=G.find(function(x){return String(x.id)===String(id);});askConfirm('この記録を削除しますか？',function(){logAction('来店記録を削除',(g?(g.d+' '+g.ci+'〜'+(g.co||'滞在中')+' 大人'+g.a+'名 ¥'+(g.pr||0)):('id:'+id)));G=G.filter(function(x){return String(x.id)!==String(id);});sv();supaDelete('pos_guests',id);cModal('m-gedit');rfAll();toast('削除しました');});}

// ===== PAST DATA =====
function addPastData(){
  var yr=parseInt(document.getElementById('pd-yr').value);var mo=parseInt(document.getElementById('pd-mo').value);
  var ppl=parseInt(document.getElementById('pd-ppl').value)||0;var sales=parseInt(document.getElementById('pd-sales').value)||0;
  var key=yr+'-'+String(mo).padStart(2,'0');
  PastData=PastData.filter(function(d){return d.key!==key;});PastData.push({key:key,yr:yr,mo:mo,ppl:ppl,sales:sales});
  PastData.sort(function(a,b){return a.key.localeCompare(b.key);});sv();rPastData();toast('追加しました');
}
function editPastData(key){
  var d=PastData.find(function(x){return x.key===key;});if(!d)return;
  document.getElementById('pd-yr').value=d.yr;
  document.getElementById('pd-mo').value=d.mo;
  document.getElementById('pd-ppl').value=d.ppl;
  document.getElementById('pd-sales').value=d.sales;
  // 既存データを削除（再入力で上書き）
  PastData=PastData.filter(function(x){return x.key!==key;});
  sv();rPastData();
  toast(d.yr+'年'+d.mo+'月のデータを編集フォームに読み込みました');
}
function delPastData(key){PastData=PastData.filter(function(d){return d.key!==key;});sv();rPastData();toast('削除しました');}
function rPastData(){
  var el=document.getElementById('pd-list');if(!el)return;
  if(PastData.length===0){el.innerHTML='<div class="empty"><div class="ei">📅</div>データなし</div>';return;}
  var h='<div class="card"><div class="ct">登録済み過去データ</div><table class="st"><thead><tr><th>年月</th><th>人数</th><th style="text-align:right;">売上</th><th></th></tr></thead><tbody>';
  for(var i=0;i<PastData.length;i++){
    var d=PastData[i];
    var k=d.key;
    h+='<tr><td>'+d.yr+'/'+String(d.mo).padStart(2,'0')+'</td>';
    h+='<td>'+d.ppl+'名</td>';
    h+='<td class="amt">¥'+d.sales.toLocaleString()+'</td>';
    h+='<td style="display:flex;gap:4px;">';
    h+='<button onclick="editPastData(\'' + k + '\')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);padding:3px 8px;border-radius:12px;font-size:10px;cursor:pointer;">編集</button>';
    h+='<button onclick="delPastData(\'' + k + '\')" style="background:#fef0ec;border:1px solid var(--pk);color:var(--ng);padding:3px 8px;border-radius:12px;font-size:10px;cursor:pointer;">削除</button>';
    h+='</td></tr>';
  }
  h+='</tbody></table></div>';
  el.innerHTML=h;
}

function etab(t){
  var tabs=['te-1','te-2','te-3'];var ids=['sum','inp','exp'];
  var tMap={sum:0,inp:1,exp:2};
  for(var i=0;i<tabs.length;i++){document.getElementById(tabs[i]).classList.toggle('active',i===tMap[t]);document.getElementById('e-'+ids[i]).style.display=i===tMap[t]?'block':'none';}
  if(t==='sum')rESummary();
  if(t==='inp')rEMonthList();
  if(t==='exp')rEExpense();
}
function chEY(d){eYear+=d;rESummary();}

function getESalesData(yr,mo){
  // ESalesに手入力データがあればそれを使う
  var key=String(yr);
  if(ESales[key]&&ESales[key][mo]){return ESales[key][mo];}
  // PastDataに過去データがあればそれを使う
  var pastKey=yr+'-'+String(mo).padStart(2,'0');
  var pastItem=PastData.find(function(p){return p.key===pastKey;});
  if(pastItem){return {sales:pastItem.sales,visitors:pastItem.ppl};}
  // なければPOSのGデータから集計
  var gVisitors=0,gSales=0;
  for(var i=0;i<G.length;i++){
    var g=G[i];if(g.st!=='done')continue;
    var d=new Date(g.d);
    if(d.getFullYear()===yr&&(d.getMonth()+1)===mo){gVisitors+=g.a+g.c;gSales+=g.pr;}
  }
  // 物販も加算
  for(var j=0;j<MS.length;j++){
    var md=new Date(MS[j].d);
    if(md.getFullYear()===yr&&(md.getMonth()+1)===mo){gSales+=MS[j].total;}
  }
  return {sales:gSales,visitors:gVisitors};
}

function rESummary(){
  rESummary2();return;
  document.getElementById('e-yr-lbl').textContent=eYear+'年';
  var MONTHS=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var totalSales=0,totalVisitors=0;
  var salesData=[],visitorsData=[];
  for(var m=1;m<=12;m++){
    var d=getESalesData(eYear,m);
    totalSales+=d.sales;totalVisitors+=d.visitors;
    salesData.push(d.sales);visitorsData.push(d.visitors);
  }
  document.getElementById('e-annual').textContent=yn(totalSales);
  document.getElementById('e-annual-sub').textContent='年間来店 '+totalVisitors.toLocaleString()+'人';
  document.getElementById('e-tot-v').textContent=totalVisitors.toLocaleString();
  var avg=totalVisitors>0?Math.round(totalSales/totalVisitors):0;
  document.getElementById('e-avg').textContent=avg>0?yn(avg):'¥—';

  var now=new Date();var thisM=eYear===now.getFullYear()?(now.getMonth()+1):null;

  // 売上グラフ
  var ctx1=document.getElementById('e-chart-s').getContext('2d');
  if(eChartS)eChartS.destroy();
  eChartS=new Chart(ctx1,{
    type:'bar',
    data:{labels:MONTHS,datasets:[{data:salesData,backgroundColor:salesData.map(function(_,i){return(i+1)===thisM?'rgba(42,157,143,0.9)':'rgba(42,157,143,0.35)';}),borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}},y:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10},callback:function(v){return v>=10000?(v/10000)+'万':v;}}}}}
  });

  // 来店グラフ
  var ctx2=document.getElementById('e-chart-v').getContext('2d');
  if(eChartV)eChartV.destroy();
  eChartV=new Chart(ctx2,{
    type:'line',
    data:{labels:MONTHS,datasets:[{data:visitorsData,borderColor:'rgba(232,131,143,0.9)',backgroundColor:'rgba(232,131,143,0.15)',borderWidth:2,pointBackgroundColor:visitorsData.map(function(_,i){return(i+1)===thisM?'#e8838f':'rgba(232,131,143,0.5)';}),pointRadius:4,fill:true,tension:0.4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}},y:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}}}}
  });
}

function saveEData(){
  saveEData2();return;
  var month=document.getElementById('ei-month').value;
  var sales=parseInt(document.getElementById('ei-sales').value)||0;
  var visitors=parseInt(document.getElementById('ei-visitors').value)||0;
  if(!sales&&!visitors){toast('金額または人数を入力してください',true);return;}
  var yr=String(eYear);
  if(!ESales[yr])ESales[yr]={};
  ESales[yr][month]={sales:sales,visitors:visitors};
  sv();document.getElementById('ei-sales').value='';document.getElementById('ei-visitors').value='';
  rEMonthList();rESummary();toast(month+'月のデータを保存しました！');
}

function rEMonthList(){
  rEMonthList2();return;
  var yr=String(eYear);var data=ESales[yr]||{};
  var el=document.getElementById('e-month-list');
  var entries=Object.keys(data).sort(function(a,b){return parseInt(b)-parseInt(a);});
  if(entries.length===0){el.innerHTML='<div class="empty"><div class="ei">📋</div>データがまだありません</div>';return;}
  var h='';
  for(var i=0;i<entries.length;i++){
    var m=entries[i];var d=data[m];
    h+='<div style="background:var(--sf);border:1.5px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--sh);">';
    h+='<div style="font-size:14px;color:var(--tx2);">'+eYear+'年'+m+'月</div>';
    h+='<div style="text-align:right;"><div style="font-family:\'Noto Sans JP\',sans-serif;font-size:18px;color:var(--ac);">'+yn(d.sales||0)+'</div><div style="font-size:11px;color:var(--tx2);">'+(d.visitors||0)+'人来店</div></div>';
    h+='<button onclick="openEEdit('+m+')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">編集</button>';
    h+='</div>';
  }
  el.innerHTML=h;
}
function openEEdit(m){
  var yr=String(eYear);var d=(ESales[yr]||{})[m]||{};
  document.getElementById('medit-tit').textContent=eYear+'年'+m+'月 編集';
  document.getElementById('medit-sales').value=d.sales||'';
  document.getElementById('medit-visitors').value=d.visitors||'';
  document.getElementById('medit-month').value=m;
  oModal('m-medit');
}
function saveEEdit(){
  var m=document.getElementById('medit-month').value;var yr=String(eYear);
  if(!ESales[yr])ESales[yr]={};
  ESales[yr][m]={sales:parseInt(document.getElementById('medit-sales').value)||0,visitors:parseInt(document.getElementById('medit-visitors').value)||0};
  sv();cModal('m-medit');rEMonthList();rESummary();toast('更新しました');
}

// 経費
function eCharge(){
  xCharge();return;
  var amount=parseInt(document.getElementById('e-ch-amt').value)||0;if(!amount){toast('金額を入力してください',true);return;}
  var memo=document.getElementById('e-ch-memo').value||'チャージ';
  var base=loadExpBase();base.balance+=amount;base.history.unshift({type:'charge',amount:amount,memo:memo,date:new Date().toLocaleDateString('ja-JP')});
  saveExpBase(base);document.getElementById('e-ch-amt').value='';document.getElementById('e-ch-memo').value='';rEExpense();toast('残高を追加しました！');
}
function eOpenRcpt(){
  xOpenRcpt();return;
  var desc=document.getElementById('e-ex-desc').value;var amt=document.getElementById('e-ex-amt').value;
  if(!desc||!amt){toast('内容と金額を入力してください',true);return;}
  eCurrentRcpt=null;document.getElementById('e-rcpt-prev').classList.remove('show');document.getElementById('e-rcpt-in').value='';
  document.getElementById('m-ercpt').setAttribute('data-mode','e');
  oModal('m-ercpt');
}
function ePreviewRcpt(input){
  var f=input.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(e){eCurrentRcpt=e.target.result;var img=document.getElementById('e-rcpt-prev');img.src=eCurrentRcpt;img.classList.add('show');};
  r.readAsDataURL(f);
}
function eSaveExpWithRcpt(){
  var mode=document.getElementById('m-ercpt').getAttribute('data-mode')||'e';
  if(mode==='x'){xSaveExp(eCurrentRcpt);}else{eSaveExp(eCurrentRcpt);}
  cModal('m-ercpt');
}
function eSaveExp(rcpt){
  xSaveExp(rcpt);return;
  var desc=document.getElementById('e-ex-desc').value;var amount=parseInt(document.getElementById('e-ex-amt').value)||0;
  var cat=document.getElementById('e-ex-cat').value;var memo=document.getElementById('e-ex-memo').value;
  if(!desc||!amount){toast('内容と金額を入力してください',true);return;}
  var base=loadExpBase();base.balance-=amount;
  base.history.unshift({id:Date.now(),type:'expense',desc:desc,amount:amount,cat:cat,memo:memo,date:new Date().toLocaleDateString('ja-JP'),receipt:rcpt||null});
  saveExpBase(base);
  document.getElementById('e-ex-desc').value='';document.getElementById('e-ex-amt').value='';document.getElementById('e-ex-memo').value='';
  eCurrentRcpt=null;rEExpense();toast('支出を記録しました');
}
function eDelExp(id){
  askConfirm('削除しますか？',function(){
    var base=loadExpBase();var item=base.history.find(function(h){return h.id===id;});
    if(item){base.balance+=item.amount;base.history=base.history.filter(function(h){return h.id!==id;});}
    saveExpBase(base);rEExpense();toast('削除しました');
  });
}
function rEExpense(){
  rXExpense();return;
  var base=loadExpBase();var balance=base.balance;var threshold=50000;
  var balEl=document.getElementById('e-bal-val');var balBox=document.getElementById('e-bal-box');
  var alarm=document.getElementById('e-alarm');var fill=document.getElementById('e-bar-fill');
  balEl.textContent=yn(balance);
  if(balance<threshold){balEl.className='exp-bal-val warn';balBox.classList.add('warn');alarm.classList.add('show');}
  else{balEl.className='exp-bal-val safe';balBox.classList.remove('warn');alarm.classList.remove('show');}
  var pct=Math.max(0,Math.min(100,(balance/200000)*100));
  fill.style.width=pct+'%';fill.style.background=balance<threshold?'#d65f5f':balance<80000?'#e8838f':'#5c9e7e';
  document.getElementById('e-bal-sub').textContent=balance<0?'⚠️ 残高がマイナスです':balance<threshold?('残り '+yn(balance)+' — 補充してください'):('残り '+yn(balance));
  var expenses=base.history.filter(function(h){return h.type==='expense';});
  var el=document.getElementById('e-exp-list');
  if(expenses.length===0){el.innerHTML='<div class="empty"><div class="ei">💴</div>支出記録がまだありません</div>';return;}
  var h='';
  for(var i=0;i<expenses.length;i++){
    var e=expenses[i];
    h+='<div class="exp-item">';
    h+='<div class="exp-top"><div><div style="font-size:14px;">'+e.desc+'</div>'+(e.memo?'<div style="font-size:11px;color:var(--tx2);margin-top:2px;">'+e.memo+'</div>':'')+'</div>';
    h+='<div style="display:flex;align-items:center;gap:6px;"><div class="exp-amt">-'+yn(e.amount)+'</div><button onclick="eDelExp('+e.id+')" style="background:none;border:none;color:var(--tx2);cursor:pointer;font-size:16px;">🗑</button></div></div>';
    h+='<div class="exp-bottom"><span class="exp-cat-badge">'+e.cat+'</span><span style="font-size:11px;color:var(--tx2);">'+e.date+'</span>'+(e.receipt?'<span style="font-size:11px;color:var(--ac);cursor:pointer;" onclick="eViewRcpt('+e.id+')">📷 レシート</span>':'')+'</div>';
    h+='</div>';
  }
  el.innerHTML=h;
}
function eViewRcpt(id){
  var base=loadExpBase();var item=base.history.find(function(h){return h.id===id;});
  if(item&&item.receipt){var w=window.open('','_blank');w.document.write('<html><body style="margin:0;background:#000"><img src="'+item.receipt+'" style="max-width:100%;display:block"></body></html>');}
}

// ===== 経費タブ独立レンダリング =====
var xChartS2=null,xChartV2=null;

function rESummary2(){
  document.getElementById('e-yr-lbl2').textContent=eYear+'年';
  var MONTHS=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var totalSales=0,totalVisitors=0;
  var salesData=[],visitorsData=[];
  for(var m=1;m<=12;m++){
    var d=getESalesData(eYear,m);
    totalSales+=d.sales;totalVisitors+=d.visitors;
    salesData.push(d.sales);visitorsData.push(d.visitors);
  }
  document.getElementById('e-annual2').textContent=yn(totalSales);
  document.getElementById('e-annual-sub2').textContent='年間来店 '+totalVisitors.toLocaleString()+'人';
  document.getElementById('e-tot-v2').textContent=totalVisitors.toLocaleString();
  var avg=totalVisitors>0?Math.round(totalSales/totalVisitors):0;
  document.getElementById('e-avg2').textContent=avg>0?yn(avg):'¥—';
  var now=new Date();var thisM=eYear===now.getFullYear()?(now.getMonth()+1):null;
  var ctx1=document.getElementById('e-chart-s2').getContext('2d');
  if(xChartS2)xChartS2.destroy();
  xChartS2=new Chart(ctx1,{type:'bar',data:{labels:MONTHS,datasets:[{data:salesData,backgroundColor:salesData.map(function(_,i){return(i+1)===thisM?'rgba(42,157,143,0.9)':'rgba(42,157,143,0.35)';}),borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}},y:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10},callback:function(v){return v>=10000?(v/10000)+'万':v;}}}}}});
  var ctx2=document.getElementById('e-chart-v2').getContext('2d');
  if(xChartV2)xChartV2.destroy();
  xChartV2=new Chart(ctx2,{type:'line',data:{labels:MONTHS,datasets:[{data:visitorsData,borderColor:'rgba(232,131,143,0.9)',backgroundColor:'rgba(232,131,143,0.15)',borderWidth:2,pointBackgroundColor:visitorsData.map(function(_,i){return(i+1)===thisM?'#e8838f':'rgba(232,131,143,0.5)';}),pointRadius:4,fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}},y:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#c9a0a6',font:{size:10}}}}}});
  // 入力済みリスト
  rEMonthList2();
}
function saveEData2(){
  var month=document.getElementById('ei-month2').value;
  var sales=parseInt(document.getElementById('ei-sales2').value)||0;
  var visitors=parseInt(document.getElementById('ei-visitors2').value)||0;
  if(!sales&&!visitors){toast('金額または人数を入力してください',true);return;}
  var yr=String(eYear);
  if(!ESales[yr])ESales[yr]={};
  ESales[yr][month]={sales:sales,visitors:visitors};
  sv();document.getElementById('ei-sales2').value='';document.getElementById('ei-visitors2').value='';
  rEMonthList2();rESummary2();toast(month+'月のデータを保存しました！');
}
function rEMonthList2(){
  var yr=String(eYear);var data=ESales[yr]||{};
  var el=document.getElementById('e-month-list2');if(!el)return;
  var entries=Object.keys(data).sort(function(a,b){return parseInt(b)-parseInt(a);});
  if(entries.length===0){el.innerHTML='<div class="empty"><div class="ei">📋</div>データがまだありません</div>';return;}
  var h='';
  for(var i=0;i<entries.length;i++){
    var m=entries[i];var d=data[m];
    h+='<div style="background:var(--sf);border:1.5px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--sh);">';
    h+='<div style="font-size:14px;color:var(--tx2);">'+eYear+'年'+m+'月</div>';
    h+='<div style="text-align:right;"><div style="font-family:\'Noto Sans JP\',sans-serif;font-size:18px;color:var(--ac);">'+yn(d.sales||0)+'</div><div style="font-size:11px;color:var(--tx2);">'+(d.visitors||0)+'人来店</div></div>';
    h+='<button onclick="openEEdit('+m+')" style="background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:\'Zen Maru Gothic\',sans-serif;">編集</button>';
    h+='</div>';
  }
  el.innerHTML=h;
}

function rXExpense(){
  var el=document.getElementById('x-exp-list');if(!el)return;
  var base=loadExpBase();var balance=base.balance;var threshold=50000;
  var balEl=document.getElementById('x-bal-val');
  var balBox=document.getElementById('x-bal-box');
  var alarm=document.getElementById('x-alarm');
  var fill=document.getElementById('x-bar-fill');
  if(!balEl)return;
  balEl.textContent=yn(balance);
  if(balance<threshold){balEl.className='exp-bal-val warn';balBox.classList.add('warn');alarm.classList.add('show');}
  else{balEl.className='exp-bal-val safe';balBox.classList.remove('warn');alarm.classList.remove('show');}
  var pct=Math.max(0,Math.min(100,(balance/200000)*100));
  fill.style.width=pct+'%';fill.style.background=balance<threshold?'#d65f5f':balance<80000?'#e8838f':'#5c9e7e';
  document.getElementById('x-bal-sub').textContent=balance<0?'⚠️ 残高がマイナスです':balance<threshold?('残り '+yn(balance)+' — 補充してください'):('残り '+yn(balance));
  var expenses=base.history.filter(function(h){return h.type==='expense';});
  var el=document.getElementById('x-exp-list');if(!el)return;
  if(expenses.length===0){el.innerHTML='<div class="empty"><div class="ei">💴</div>支出記録がまだありません</div>';return;}
  var h='';
  for(var i=0;i<expenses.length;i++){
    var e=expenses[i];
    h+='<div class="exp-item">';
    h+='<div class="exp-top"><div><div style="font-size:14px;">'+e.desc+'</div>'+(e.memo?'<div style="font-size:11px;color:var(--tx2);margin-top:2px;">'+e.memo+'</div>':'')+'</div>';
    h+='<div style="display:flex;align-items:center;gap:6px;"><div class="exp-amt">-'+yn(e.amount)+'</div><button onclick="xDelExp('+e.id+')" style="background:none;border:none;color:var(--tx2);cursor:pointer;font-size:16px;">🗑</button></div></div>';
    h+='<div class="exp-bottom"><span class="exp-cat-badge">'+e.cat+'</span><span style="font-size:11px;color:var(--tx2);">'+e.date+'</span>'+(e.receipt?'<span style="font-size:11px;color:var(--ac);cursor:pointer;" onclick="eViewRcpt('+e.id+')">📷 レシート</span>':'')+'</div>';
    h+='</div>';
  }
  el.innerHTML=h;
}
function xCharge(){
  var el=document.getElementById('x-ch-amt');if(!el)return;
  var amount=parseInt(el.value)||0;if(!amount){toast('金額を入力してください',true);return;}
  var memo=document.getElementById('x-ch-memo').value||'チャージ';
  var base=loadExpBase();base.balance+=amount;base.history.unshift({type:'charge',amount:amount,memo:memo,date:new Date().toLocaleDateString('ja-JP')});
  saveExpBase(base);document.getElementById('x-ch-amt').value='';document.getElementById('x-ch-memo').value='';
  rXExpense();
  toast('残高を追加しました！');
}
function xOpenRcpt(){
  var el=document.getElementById('x-ex-desc');if(!el)return;
  var desc=el.value;var amt=document.getElementById('x-ex-amt').value;
  if(!desc||!amt){toast('内容と金額を入力してください',true);return;}
  eCurrentRcpt=null;document.getElementById('e-rcpt-prev').classList.remove('show');document.getElementById('e-rcpt-in').value='';
  oModal('m-ercpt');
  // レシートモーダルの保存ボタンをx用に
  document.getElementById('m-ercpt').setAttribute('data-mode','x');
}
function xSaveExp(rcpt){
  var el=document.getElementById('x-ex-desc');if(!el)return;
  var desc=el.value;var amount=parseInt(document.getElementById('x-ex-amt').value)||0;
  var cat=document.getElementById('x-ex-cat').value;var memo=document.getElementById('x-ex-memo').value;
  if(!desc||!amount){toast('内容と金額を入力してください',true);return;}
  var base=loadExpBase();base.balance-=amount;
  base.history.unshift({id:Date.now(),type:'expense',desc:desc,amount:amount,cat:cat,memo:memo,date:new Date().toLocaleDateString('ja-JP'),receipt:rcpt||null});
  saveExpBase(base);
  document.getElementById('x-ex-desc').value='';document.getElementById('x-ex-amt').value='';document.getElementById('x-ex-memo').value='';
  eCurrentRcpt=null;
  rXExpense();
  toast('支出を記録しました');
}
function xDelExp(id){
  askConfirm('削除しますか？',function(){
    var base=loadExpBase();var item=base.history.find(function(h){return h.id===id;});
    if(item){base.balance+=item.amount;base.history=base.history.filter(function(h){return h.id!==id;});}
    saveExpBase(base);rXExpense();toast('削除しました');
  });
}

// ===== MONTH EDIT MODAL (売上タブ用) =====
// m-meditは上のHTMLに定義済み

// ===== MAIN RENDER =====
// ===== 分析タブ =====
var zD=new Date(), zM=new Date(), zMode='d';

var zY=new Date();
function toggleSection(bodyId,titleEl){
  var body=document.getElementById(bodyId);
  var arrow=titleEl.querySelector('span');
  var show=body.style.display==='none';
  body.style.display=show?'block':'none';
  if(arrow)arrow.textContent=show?'▲':'▼';
}
function ztab(t){
  zMode=t;
  document.getElementById('tz-d').classList.toggle('active',t==='d');
  document.getElementById('tz-m').classList.toggle('active',t==='m');
  document.getElementById('tz-y').classList.toggle('active',t==='y');
  document.getElementById('z-d').style.display=t==='d'?'block':'none';
  document.getElementById('z-m').style.display=t==='m'?'block':'none';
  document.getElementById('z-y').style.display=t==='y'?'block':'none';
  rZAnalysis();
}
function chZD(d){zD.setDate(zD.getDate()+d);rZAnalysis();}
function openZDCal(){
  var cal=document.getElementById('z-d-cal');if(!cal)return;
  // 現在の日付をカレンダーにセット
  cal.value=fYMD(zD);
  // カレンダーを開く（showPickerが使える場合）
  try{cal.showPicker();}catch(e){cal.style.pointerEvents='auto';cal.focus();cal.click();}
}
function jumpZD(val){
  if(!val)return;
  var parts=val.split('-');
  zD=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
  rZAnalysis();
}
function chZM(d){zM.setMonth(zM.getMonth()+d);rZAnalysis();}
function chZY(d){zY.setFullYear(zY.getFullYear()+d);rZAnalysis();}

function mkBar(el,counts,cls){
  var keys=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];});
  var tot=0;for(var i=0;i<keys.length;i++)tot+=counts[keys[i]];
  if(tot===0){el.innerHTML='<div style="color:var(--tx2);font-size:12px;text-align:center;padding:12px;">データなし</div>';return;}
  var h='';
  for(var j=0;j<keys.length;j++){
    var pct=Math.round(counts[keys[j]]/tot*100);
    var color=cls==='gr'?'linear-gradient(90deg,var(--ok),#90c880)':cls==='pu'?'linear-gradient(90deg,#c090e0,#a060c0)':cls==='wn'?'linear-gradient(90deg,var(--wn),#f0a830)':'linear-gradient(90deg,var(--ac),#e09080)';
    h+='<div class="cbar"><div class="cbar-l"><span>'+keys[j]+'</span><span>'+counts[keys[j]]+'件（'+pct+'%）</span></div>';
    h+='<div class="cbar-bg"><div class="cbar-fill" style="width:'+pct+'%;background:'+color+';"></div></div></div>';
  }
  el.innerHTML=h;
}

function rZAnalysis(){
  var gs, ms, ds;
  var sfx = zMode;
  if(zMode==='d'){
    ds=fYMD(zD);
    document.getElementById('z-d-lbl').textContent='📅 '+ds;
    gs=G.filter(function(g){return g.d===ds&&g.st==='done';});
    var msItem=MS.find(function(m){return m.d===ds;});
    ms=msItem?msItem.i:[];
  } else if(zMode==='m'){
    var yr=zM.getFullYear(),mo=zM.getMonth();
    document.getElementById('z-m-lbl').textContent=yr+'/'+p2(mo+1);
    gs=G.filter(function(g){var d=new Date(g.d);return d.getFullYear()===yr&&d.getMonth()===mo&&g.st==='done';});
    var msMap={};
    var msSalesMap={};
    MS.filter(function(m){var d=new Date(m.d);return d.getFullYear()===yr&&d.getMonth()===mo;})
      .forEach(function(m){m.i.forEach(function(item){if(item.q>0){
        msMap[item.n]=(msMap[item.n]||0)+item.q;
        msSalesMap[item.n]=(msSalesMap[item.n]||0)+item.q*item.p;
      }});});
    ms=Object.keys(msMap).map(function(n){return {n:n,q:msMap[n],p:msSalesMap[n]?Math.round(msSalesMap[n]/msMap[n]):0};});
    // 物販売上グラフ
    var salesEl=document.getElementById('z-m-merch-sales');
    var totalEl=document.getElementById('z-m-merch-total');
    if(salesEl){
      var salesKeys=Object.keys(msSalesMap).sort(function(a,b){return msSalesMap[b]-msSalesMap[a];});
      var totalSales=0;for(var si=0;si<salesKeys.length;si++)totalSales+=msSalesMap[salesKeys[si]];
      if(salesKeys.length===0){salesEl.innerHTML='<div style="color:var(--tx2);font-size:12px;text-align:center;padding:12px;">データなし</div>';}
      else{
        var sh='';
        for(var sj=0;sj<salesKeys.length;sj++){
          var sn=salesKeys[sj];var sv2=msSalesMap[sn];var sq=msMap[sn];
          var pct=totalSales>0?Math.round(sv2/totalSales*100):0;
          sh+='<div class="cbar"><div class="cbar-l"><span>'+sn+' × '+sq+'個</span><span>'+yn(sv2)+'（'+pct+'%）</span></div>';
          sh+='<div class="cbar-bg"><div class="cbar-fill gr" style="width:'+pct+'%;background:linear-gradient(90deg,var(--ok),#90c880);"></div></div></div>';
        }
        salesEl.innerHTML=sh;
        if(totalEl)totalEl.textContent='物販合計　'+yn(totalSales);
      }
    }
    // 猫別チェキ人気ランキング
    var chekiCatEl=document.getElementById('z-m-cheki-cat');
    if(chekiCatEl){
      var monthCheki2=Cheki.filter(function(c){var d=new Date(c.d);return d.getFullYear()===yr&&d.getMonth()===mo;});
      var chekiCatCount={};
      monthCheki2.forEach(function(c){
        if(c.multi){chekiCatCount['複数']=(chekiCatCount['複数']||0)+c.qty;}
        else{c.cats.forEach(function(catName){chekiCatCount[catName]=(chekiCatCount[catName]||0)+c.qty;});}
      });
      var chekiKeys=Object.keys(chekiCatCount).sort(function(a,b){return chekiCatCount[b]-chekiCatCount[a];});
      var chekiTotal=0;for(var cki=0;cki<chekiKeys.length;cki++)chekiTotal+=chekiCatCount[chekiKeys[cki]];
      if(chekiKeys.length===0){chekiCatEl.innerHTML='<div style="color:var(--tx2);font-size:12px;text-align:center;padding:12px;">データなし</div>';}
      else{
        var ckh='';
        var medals=['🥇','🥈','🥉'];
        for(var ckj=0;ckj<chekiKeys.length;ckj++){
          var ckn=chekiKeys[ckj];var ckq=chekiCatCount[ckn];
          var ckpct=chekiTotal>0?Math.round(ckq/chekiTotal*100):0;
          var medal=medals[ckj]||'';
          ckh+='<div class="cbar"><div class="cbar-l"><span>'+medal+' '+ckn+'</span><span>'+ckq+'枚（'+ckpct+'%）</span></div>';
          ckh+='<div class="cbar-bg"><div class="cbar-fill pk" style="width:'+ckpct+'%;"></div></div></div>';
        }
        chekiCatEl.innerHTML=ckh;
      }
    }
  } else {
    var yr=zY.getFullYear();
    document.getElementById('z-y-lbl').textContent=yr+'年';
    gs=G.filter(function(g){var d=new Date(g.d);return d.getFullYear()===yr&&g.st==='done';});
    var msMap2={};
    MS.filter(function(m){var d=new Date(m.d);return d.getFullYear()===yr;})
      .forEach(function(m){m.i.forEach(function(item){if(item.q>0){msMap2[item.n]=(msMap2[item.n]||0)+item.q;}});});
    ms=Object.keys(msMap2).map(function(n){return {n:n,q:msMap2[n],p:0};});
    var monthCount={};
    for(var mi=1;mi<=12;mi++) monthCount[mi+'月']=0;
    gs.forEach(function(g){var mo2=(new Date(g.d).getMonth()+1)+'月';monthCount[mo2]=(monthCount[mo2]||0)+1;});
    mkBarSorted(document.getElementById('z-y-monthly'),monthCount,'gr');
  }

  // 新規/リピーター
  var typeCount={'新規':0,'リピーター':0};
  gs.forEach(function(g){typeCount[g.tp==='new'?'新規':'リピーター']++;});
  mkBar(document.getElementById('z-'+sfx+'-type'),typeCount,'gr');

  // 常連さん（会員）別の来店回数
  var memberCount={};
  gs.forEach(function(g){if(g.member){memberCount[g.member]=(memberCount[g.member]||0)+1;}});
  var memEl=document.getElementById('z-'+sfx+'-member');
  if(memEl){
    var memKeys=Object.keys(memberCount).sort(function(a,b){return memberCount[b]-memberCount[a];});
    if(memKeys.length===0){memEl.innerHTML='<div style="color:var(--tx2);font-size:12px;text-align:center;padding:12px;">常連さんの来店なし</div>';}
    else{
      var mh='';
      for(var mk=0;mk<memKeys.length;mk++){
        mh+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--bd);"><span style="font-weight:700;">⭐ '+memKeys[mk]+'</span><span style="font-family:\'Noto Sans JP\',sans-serif;color:var(--ac);font-weight:700;">'+memberCount[memKeys[mk]]+' 回</span></div>';
      }
      memEl.innerHTML=mh;
    }
  }

  // 来店パターン
  var patCount={};
  gs.forEach(function(g){patCount[g.pt]=(patCount[g.pt]||0)+1;});
  mkBar(document.getElementById('z-'+sfx+'-pattern'),patCount,'pu');

  // 時間帯別
  var timeCount={};
  gs.forEach(function(g){
    if(g.ci){
      var h=g.ci.split(':')[0]+'時台';
      timeCount[h]=(timeCount[h]||0)+1;
    }
  });
  mkBar(document.getElementById('z-'+sfx+'-time'),timeCount,'wn');

  // 物販商品別
  var merchCount={};
  ms.forEach(function(item){if(item.q>0)merchCount[item.n]=(merchCount[item.n]||0)+item.q;});
  mkBar(document.getElementById('z-'+sfx+'-merch'),merchCount,'');
}

// 月順で固定表示するバー
function mkBarSorted(el,counts,cls){
  var keys=Object.keys(counts);
  var tot=0;for(var i=0;i<keys.length;i++)tot+=counts[keys[i]];
  if(tot===0){el.innerHTML='<div style="color:var(--tx2);font-size:12px;text-align:center;padding:12px;">データなし</div>';return;}
  var h='';
  for(var j=0;j<keys.length;j++){
    var pct=tot>0?Math.round(counts[keys[j]]/Math.max.apply(null,Object.values(counts))*100):0;
    var color='linear-gradient(90deg,var(--ok),#90c880)';
    h+='<div class="cbar"><div class="cbar-l"><span>'+keys[j]+'</span><span>'+counts[keys[j]]+'件</span></div>';
    h+='<div class="cbar-bg"><div class="cbar-fill" style="width:'+pct+'%;background:'+color+';"></div></div></div>';
  }
  el.innerHTML=h;
}

function openOwnerLogin(){
  document.getElementById('owner-pw').value='';
  document.getElementById('owner-content').style.display='block';
  document.getElementById('owner-logs').style.display='none';
  oModal('m-owner');
}
function checkOwnerPw(){
  var pw=document.getElementById('owner-pw').value;
  if(pw===OWNER_PW){
    isOwnerMode=true;
    document.getElementById('owner-content').style.display='none';
    document.getElementById('owner-logs').style.display='block';
    loadOwnerLogs();
  } else {
    toast('パスワードが違います',true);
  }
}
function ownerLogout(){
  isOwnerMode=false;
  cModal('m-owner');
}
function recalcAllGuests(){
  askConfirm('全ての退店済み記録を現在の料金で再計算します。よろしいですか？',function(){
    var changed=0,skipped=0;
    for(var i=0;i<G.length;i++){
      var g=G[i];
      if(g.st!=='done'||!g.co){continue;}
      // 手動割引・手動金額の記録（メモに割引記載）はスキップして保護
      if(g.mo && (g.mo.indexOf('-¥')>=0 || g.mo.indexOf('割引')>=0)){skipped++;continue;}
      var r=calcP(g.a,g.c,g.ci,g.co,g.d,g.fn);
      if(g.pr!==r.t){
        g.pr=r.t;changed++;
        saveGuestToSupa(g);
      }
    }
    sv();rfAll();
    toast('再計算完了：'+changed+'件を修正'+(skipped>0?'（手動割引'+skipped+'件は保護）':''));
  },'再計算する');
}
async function loadOwnerLogs(){
  var el=document.getElementById('log-list');
  el.innerHTML='<div style="text-align:center;color:var(--tx2);font-size:12px;padding:16px;">読み込み中...</div>';
  var data=await supaLoad('pos_logs');
  if(!data||data.length===0){el.innerHTML='<div style="text-align:center;color:var(--tx2);font-size:12px;padding:16px;">履歴なし</div>';return;}
  // 7日より古いログを自動削除
  var cutoff=Date.now()-7*24*60*60*1000;
  var fresh=[],stale=[];
  for(var d=0;d<data.length;d++){
    var idNum=parseInt(data[d].id);
    if(!isNaN(idNum)&&idNum<cutoff){stale.push(data[d]);}
    else{fresh.push(data[d]);}
  }
  stale.forEach(function(log){supaDelete('pos_logs',log.id);});
  data=fresh;
  if(data.length===0){el.innerHTML='<div style="text-align:center;color:var(--tx2);font-size:12px;padding:16px;">履歴なし</div>';return;}
  data.sort(function(a,b){return b.ts.localeCompare(a.ts);});
  var h='';
  if(stale.length>0)h+='<div style="text-align:center;color:var(--tx2);font-size:10px;padding:0 0 8px;">（7日より古い'+stale.length+'件を自動削除しました）</div>';
  for(var i=0;i<Math.min(data.length,50);i++){
    var log=data[i];
    h+='<div style="border-bottom:1px solid var(--bd);padding:8px 0;">';
    h+='<div style="display:flex;justify-content:space-between;margin-bottom:3px;">';
    h+='<span style="font-size:12px;font-weight:700;color:var(--ac);">'+log.action+(log.operator&&log.operator!=='未選択'?' <span style="color:var(--tx2);font-weight:400;">／'+log.operator+'</span>':'')+'</span>';
    h+='<span style="font-size:10px;color:var(--tx2);">'+log.ts+'</span></div>';
    h+='<div style="font-size:11px;color:var(--tx2);">'+log.detail+'</div>';
    h+='</div>';
  }
  el.innerHTML=h;
}

function rfAll(){
  try{rGuests();}catch(e){}
  try{rMerch();}catch(e){}
  try{renderChekiToday();}catch(e){}
  try{rDay();}catch(e){}
  try{rMon();}catch(e){}
  try{rAnket();}catch(e){}
  try{rCash();}catch(e){}
  try{ppCalc();}catch(e){}
  try{rESummary2();}catch(e){}
}

function init(){
  clk();setInterval(clk,1000);setInterval(rGuests,60000);
  var rt=document.getElementById('r-time');if(rt)rt.value=ft(new Date());
  try{document.getElementById('ei-month').value=new Date().getMonth()+1;}catch(e){}
  try{document.getElementById('merch-date').value=td();}catch(e){}
  try{document.getElementById('ei-month2').value=new Date().getMonth()+1;}catch(e){}
  var allOvs=document.querySelectorAll('.ov');
  for(var i=0;i<allOvs.length;i++){allOvs[i].addEventListener('click',function(ev){if(ev.target===this)this.classList.remove('on');});}
  var ts=MS.find(function(m){return m.d===td();});if(ts){for(var j=0;j<ts.i.length;j++)MQ[ts.i[j].id]=ts.i[j].q;}
  buildDenomRows();buildBCChips();buildAqChips();updateMenuPriceView();buildOperatorSelect();buildMemberSelects();
  buildTimeSelect('r-time');buildTimeSelect('co-ci','rcCO()');buildTimeSelect('co-co','rcCO()');buildTimeSelect('ge-ci');buildTimeSelect('ge-co');
  // Supabaseからデータロード
  loadFromSupabase();
  startPresenceLoop();
}
init();
