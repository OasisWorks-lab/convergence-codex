(() => {
  'use strict';
  const api=String(window.PHOENIXCORE_API||'').replace(/\/$/,'');
  const demo=!api || location.protocol==='file:' || new URLSearchParams(location.search).get('demo')==='1';
  const preview=window.PhoenixPreview;
  const $=selector=>document.querySelector(selector);
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={name:'Character name',lineage:'Species or lineage',portrait:'Portrait',bio:'Background',bpl:'Base Power Level',strength:'Strength',speed:'Speed',durability:'Durability',intelligence:'Intelligence',control:'Energy control',wallet:'Wallet',gear:'Gear'};
  const traits=['strength','speed','durability','intelligence','control'];
  const kindLabel={create:'New character',edit:'Sheet edit',award:'Training or reward'};
  const formatter=new Intl.NumberFormat('en-US');
  const num=s=>formatter.format(BigInt(s||'0'));
  let state=null,session='',loadGeneration=0;
  const pathKey='pc:'+location.pathname.replace(/index\.html$/,'')+':';
  const store={get:k=>sessionStorage.getItem(pathKey+k),set:(k,v)=>sessionStorage.setItem(pathKey+k,v),remove:k=>sessionStorage.removeItem(pathKey+k)};
  const route=()=>location.hash.slice(1)||'directory';
  const go=r=>{if(route()===r)render();else location.hash=r;};
  const ownerName=id=>state.players.find(p=>p.id===id)?.display||'Discord member';
  const initials=s=>s.trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]||'').join('').toUpperCase();
  function avatar(s,id,src=''){
    const tint=['',' sage',' rose'][String(id).charCodeAt(0)%3];
    return '<span class="avatar'+tint+'">'+(src?'<img referrerpolicy="no-referrer" alt="" src="'+h(src)+'">':h(initials(s)))+'</span>';
  }
  function tell(msg,error=false){const box=$('#notice');box.hidden=!msg;box.className=error?'error':'';box.textContent=msg;}
  function title(heading,support=''){
    document.title=heading+' · PhoenixCore';
    return '<div class="intro"><h1>'+h(heading)+'</h1>'+(support?'<p>'+h(support)+'</p>':'')+'</div>';
  }
  function link(r,t,cls=''){return '<a class="'+h(cls)+'" href="#'+h(r)+'">'+h(t)+'</a>';}
  function btn(action,text,css=''){return '<button class="'+css+'" type="button" data-action="'+action+'">'+h(text)+'</button>';}
  function breadcrumbs(parts){return '<div class="crumb">'+parts.join('<span aria-hidden="true">/</span>')+'</div>';}
  function field(key,caption,value='',options={}){
    const {area=false,wide=false,required=false,max=180,hint='',pattern='',numeric=false}=options;
    const attrs=' name="'+h(key)+'" maxlength="'+max+'"'+(required?' required':'')+(numeric?' inputmode="numeric"':'')+(pattern?' pattern="'+h(pattern)+'"':'');
    return '<label class="field'+(wide?' wide':'')+'"><span>'+h(caption)+'</span>'+(area?'<textarea'+attrs+'>'+h(value)+'</textarea>':'<input'+attrs+' value="'+h(value)+'">')+(hint?'<small>'+h(hint)+'</small>':'')+'</label>';
  }
  function status(s){return '<span class="pill status '+h(s)+'">'+h(s.charAt(0).toUpperCase()+s.slice(1))+'</span>';}
  function hero(heading,description){document.title=heading+' · PhoenixCore';return '<section class="hero"><p class="eyeline">PhoenixCore</p><h1>'+h(heading)+'</h1><p>'+h(description)+'</p></section>';}
  async function call(path,method='GET',data) {
    const headers={};
    if(session)headers.authorization='Bearer '+session;
    if(data!==undefined)headers['content-type']='application/json';
    const res=await fetch(api+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
    const result=await res.json().catch(()=>({}));
    if(!res.ok){if(res.status===401){session='';store.remove('session');state=null;render();}throw Error(result.error||'PhoenixCore is unavailable.');}
    return result;
  }
  async function load(){
    const turn=++loadGeneration;
    const data=demo?preview.state():session?await call('/api/state'):null;
    if(turn!==loadGeneration)return;
    state=data;render();
  }
  const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  async function login(){
    const verifier=b64(crypto.getRandomValues(new Uint8Array(32)));
    store.set('verifier',verifier);store.set('route',route());
    const challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    location.assign(api+'/auth/start?challenge='+encodeURIComponent(challenge));
  }
  async function init(){
    if(api && location.origin===api && location.pathname.startsWith('/phoenixcore/'))$('#codex').hidden=true;
    if(!demo){
      session=store.get('session')||'';
      const hash=route();
      if(hash.startsWith('login=')){
        const ticket=hash.slice(6),verifier=store.get('verifier');
        history.replaceState(null,'','#directory');store.remove('verifier');
        try{
          const data=await call('/api/exchange','POST',{ticket,verifier});
          session=data.session;store.set('session',session);
          const previous=store.get('route')||'directory';store.remove('route');
          if(/^(directory|requests|settings|player-[\w-]+|sheet-[\w-]+|request-[\w-]+)$/.test(previous)) history.replaceState(null,'','#'+previous);
        } catch(e){tell(e.message,true);}
      } else if(['login-cancelled','member-required'].includes(hash)) {
        history.replaceState(null,'','#directory');tell(hash==='member-required'?'Sign in with an account that belongs to Convergence.':'Sign-in cancelled.',true);
      }
    }
    await load();
  }
  function chrome(){
    const active=route(),nav=$('#nav');
    const tabs=[['directory','Directory'],...(state?[['requests','Requests']]:[]),...(state?.actor.isOwner?[['settings','Bot settings']]:[])];
    nav.innerHTML=tabs.map(([key,n])=>'<a href="#'+key+'"'+((active===key||(key==='directory'&&/^(player-|sheet-|edit-|new|award-)/.test(active))||(key==='requests'&&active.startsWith('request-')))?' aria-current="page"':'')+'>'+n+'</a>').join('');
    $('#identity').innerHTML=state?'<span>'+h(ownerName(state.actor.id))+'</span>'+(demo?'':btn('logout','Sign out','quiet')):'';
    const banner=$('#practice');banner.hidden=!demo;
    if(demo){banner.innerHTML='<span><b>Practice mode</b> · Fictional players. Refresh to reset.</span><label>View as <select id="persona" aria-label="Practice role"><option value="player">Player</option><option value="judge">Training judge</option><option value="owner">Owner</option></select></label>';$('#persona').value=preview.role();}
  }
  function playerCard(p) {
    const n=state.characters.filter(c=>c.ownerId===p.id).length;
    return '<a class="card person" href="#player-'+h(p.id)+'">'+avatar(p.display,p.id)+'<span class="who"><b>'+h(p.display)+'</b><small class="muted">@'+h(p.username)+'</small><small class="subtle">'+n+' character'+(n===1?'':'s')+'</small></span><span class="arrow" aria-hidden="true">↗</span></a>';
  }
  function directory(){
    return hero('Player directory','Find a player by their Discord name and open their approved character sheets.')+
      '<div class="section-head"><h2>Current players</h2><div class="tools"><input id="filter" type="search" aria-label="Search player names" placeholder="Search players…">'+(state.actor.isPlayer?link('new','New character','button primary'):'')+'</div></div><div id="players" class="grid"></div>';
  }
  function filterPlayers(){
    if(!$('#players'))return;
    const query=($('#filter')?.value||'').trim().toLowerCase();
    const players=state.players.filter(p=>(p.display+' '+p.username).toLowerCase().includes(query)).sort((a,b)=>a.display.localeCompare(b.display));
    $('#players').innerHTML=players.map(playerCard).join('')||'<p class="empty">No players match this view.</p>';
  }
  function player(id){
    const p=state.players.find(p=>p.id===id);if(!p)return missing();
    const chars=state.characters.filter(c=>c.ownerId===id).sort((a,b)=>a.sheet.name.localeCompare(b.sheet.name));
    return breadcrumbs([link('directory','Directory'),h(p.display)])+title(p.display,'@'+p.username)+
      '<div class="section-head"><h2>Characters</h2>'+(id===state.actor.id&&state.actor.isPlayer?link('new','New character','button primary'):'')+'</div>'+
      (chars.length?'<div class="grid">'+chars.map(c=>'<a class="card char-card" href="#sheet-'+h(c.id)+'"><div class="char-art">'+avatar(c.sheet.name,c.id,c.sheet.portrait)+'</div><div class="card-copy"><h3>'+h(c.sheet.name)+'</h3><p class="muted">'+h(c.sheet.lineage||'Lineage unlisted')+'</p><span class="bpl">'+h(num(c.sheet.bpl))+' BPL</span></div></a>').join('')+'</div>':'<p class="empty">This player has no approved characters yet.</p>');
  }
  function sheet(id){
    const c=state.characters.find(c=>c.id===id);if(!c)return missing();
    const s=c.sheet;document.title=s.name+' · PhoenixCore';
    const own=c.ownerId===state.actor.id;
    return breadcrumbs([link('directory','Directory'),link('player-'+c.ownerId,ownerName(c.ownerId)),h(s.name)])+
      '<div class="sheet-head">'+avatar(s.name,c.id,s.portrait)+'<div><p class="eyeline">Character sheet · Revision '+h(c.version)+'</p><h1>'+h(s.name)+'</h1><p class="muted">'+h(s.lineage||'Lineage unlisted')+'</p></div></div>'+
      '<div class="section-head"><h2>Approved stats</h2><div class="tools">'+(own?link('edit-'+id,'Propose edit','button primary'):'')+(state.actor.isJudge?link('award-'+id,'Judge a reward','button'):'')+'</div></div>'+
      '<div class="two"><div class="stack"><section class="panel"><h3>Base Power Level</h3><div class="big-number">'+h(num(s.bpl))+'</div></section><section class="panel"><h3>Attributes</h3>'+
      traits.map(k=>'<div class="stat-row"><span>'+h(label[k])+'</span><strong>'+h(s[k]||'Unrecorded')+'</strong></div>').join('')+'</section></div>'+
      '<div class="stack"><section class="panel"><h3>Wallet &amp; gear</h3><p><b>'+h(num(s.wallet))+'</b> '+h(state.currency)+'</p><div class="pills">'+(s.gear.length?s.gear.map(g=>'<span class="pill">'+h(g)+'</span>').join(''):'<span class="muted">No gear recorded.</span>')+'</div></section><section class="panel"><h3>Background</h3><p class="prewrap">'+h(s.bio||'No background recorded.')+'</p></section></div></div>';
  }
  const missing=()=>title('Unavailable','This entry is unavailable for your Discord account.')+link('directory','Back to directory','button');
  function editor(id){
    const create=!id,c=state.characters.find(c=>c.id===id);
    if(!state.actor.isPlayer || (!create && (!c||c.ownerId!==state.actor.id)))return missing();
    const s=c?.sheet||{bpl:'0'};
    return breadcrumbs([link('directory','Directory'),...(c?[link('sheet-'+id,s.name)]:[]),create?'New character':'Propose edit'])+
      title(create?'Submit a character':'Propose a sheet edit','Gabe reviews the proposed values in Discord before they appear on the approved sheet.')+
      '<form id="sheetForm" class="panel form" data-id="'+h(id||'')+'" data-version="'+(c?.version||0)+'"><div class="fields">'+
      field('name',label.name,s.name,{required:true,max:64})+field('lineage',label.lineage,s.lineage,{max:80})+
      field('bpl',label.bpl,s.bpl,{required:true,numeric:true,pattern:'0|[1-9][0-9]{0,59}',max:60})+
      field('portrait','Portrait image',s.portrait,{max:500,hint:'Optional Discord image URL or ../assets/uploads/ image path.'})+
      field('bio',label.bio,s.bio,{area:true,wide:true,max:1000})+traits.map(k=>field(k,label[k],s[k],{max:180})).join('')+
      field('reason','Reason for submission','',{area:true,wide:true,max:600,required:true})+
      '</div><div class="actions"><button class="primary" type="submit">Send for approval</button>'+link(c?'sheet-'+id:'directory','Cancel','button')+'</div></form>';
  }
  function award(id){
    const c=state.characters.find(c=>c.id===id);if(!c||!state.actor.isJudge)return missing();
    return breadcrumbs([link('sheet-'+id,c.sheet.name),'Staff judgment'])+title('Judge a reward','Record the award earned by '+c.sheet.name+'. Gabe confirms the calculated change in Discord.')+
      '<form class="panel form" id="awardForm" data-id="'+h(id)+'" data-version="'+c.version+'"><div class="fields">'+
      field('percent','Final BPL gain (%)','0',{max:12,required:true,hint:'One adjudicated percentage; up to two decimals.'})+
      field('currency',state.currency+' to award','0',{numeric:true,required:true,max:60,pattern:'0|[1-9][0-9]{0,59}'})+
      field('gear','Gear to award','',{area:true,wide:true,max:2000,hint:'One item per line.'})+
      field('reason','Judgment and scene reference','',{area:true,wide:true,required:true,max:600})+'</div><p id="estimate" class="bpl" aria-live="polite"></p><button class="primary">Submit award for approval</button></form>';
  }
  function requestList(){
    return title('Requests',state.actor.isOwner?'Review submitted changes and their Discord delivery status.':'Track changes to your characters and awards you submitted.')+
      (state.requests.length?'<div class="stack">'+state.requests.map(r=>'<a class="request-row" href="#request-'+h(r.id)+'"><span class="summary"><b>'+h(r.after.name)+'</b><small class="muted">'+h(kindLabel[r.kind])+' · '+h(ownerName(r.authorId))+'</small></span>'+status(r.status)+'<span class="arrow" aria-hidden="true">↗</span></a>').join('')+'</div>':'<p class="empty">No requests yet.</p>');
  }
  function display(v){return Array.isArray(v)?v.join(', ')||'—':v===undefined||v===null||v===''?'—':String(v);}
  function requestView(id){
    const r=state.requests.find(r=>r.id===id);if(!r)return missing();
    const changed=Object.keys(label).filter(k=>r.before?JSON.stringify(r.before[k])!==JSON.stringify(r.after[k]):r.after[k]!==''&&r.after[k]!==undefined&&(!Array.isArray(r.after[k])||r.after[k].length));
    const sample=demo && state.actor.isOwner && r.status==='pending';
    return breadcrumbs([link('requests','Requests'),h(r.after.name)])+title(r.after.name,kindLabel[r.kind]+' · Submitted by '+ownerName(r.authorId))+
      '<div class="two"><section class="panel"><h2>Requested changes</h2><div class="diff muted"><b>Field</b><b>Approved</b><b>Proposed</b></div>'+changed.map(k=>'<div class="diff"><span>'+h(label[k])+'</span><span>'+h(display(r.before?.[k]))+'</span><span class="new">'+h(display(r.after[k]))+'</span></div>').join('')+
      '</section><div class="stack"><section class="panel"><h3>Decision</h3>'+status(r.status)+'<p>'+h(r.status==='pending'?'Awaiting Gabe’s Discord decision.':r.status==='stale'?'The approved sheet changed first. Submit a new request against its current revision.':r.status==='approved'?'This change was applied to the character.':'The approved sheet was kept.')+'</p>'+
      (state.actor.isOwner&&r.status==='pending'?'<p class="muted">Discord notification · '+h(r.delivery)+'</p>':'')+
      (sample?'<div class="actions">'+btn('demo-approve','Practice approve','primary')+btn('demo-decline','Practice decline','danger')+'</div>':'')+
      (state.characters.some(c=>c.id===r.characterId)?link('sheet-'+r.characterId,'View approved sheet'):'')+'</section><section class="panel"><h3>Reason</h3><p class="prewrap">'+h(r.reason)+'</p>'+
      (r.award?'<p class="bpl">+'+h(r.award.percent)+'% · +'+h(r.award.gain)+' whole BPL</p>':'')+'</section></div></div>';
  }
  function settings(){
    if(!state.actor.isOwner||!state.settings)return missing();
    const s=state.settings.value;
    return title('Bot settings','Only your configured Discord owner account can save these settings.')+'<form id="settingsForm" class="panel form"><div class="fields">'+
      field('playerRole','Player role ID',s.playerRole,{wide:true,max:20,hint:'Leave blank to list every current human member. A role filters the directory, including players with no sheets.'})+
      field('judgeRole','Training judge role ID',s.judgeRole,{wide:true,max:20,hint:'Members with this role can submit awards for your approval.'})+
      field('reviewChannel','Fallback review channel ID',s.reviewChannel,{wide:true,max:20,hint:'PhoenixCore DMs you first. If DMs are blocked, it can mention you here. Choose a private channel.'})+
      field('currency','Currency display name',s.currency,{max:32,required:true})+'</div><div class="actions"><button class="primary">Save settings</button></div></form>';
  }
  function render(){
    chrome();const view=$('#view');
    if(!state){view.innerHTML=hero('Player directory','Sign in with your Discord account to view Convergence players and their character sheets.')+'<div class="signin">'+btn('login','Sign in with Discord','primary')+'</div>';return;}
    const r=route();
    if(r==='directory')view.innerHTML=directory();
    else if(r==='requests')view.innerHTML=requestList();
    else if(r==='settings')view.innerHTML=settings();
    else if(r==='new')view.innerHTML=editor('');
    else if(r.startsWith('player-'))view.innerHTML=player(r.slice(7));
    else if(r.startsWith('sheet-'))view.innerHTML=sheet(r.slice(6));
    else if(r.startsWith('edit-'))view.innerHTML=editor(r.slice(5));
    else if(r.startsWith('award-'))view.innerHTML=award(r.slice(6));
    else if(r.startsWith('request-'))view.innerHTML=requestView(r.slice(8));
    else view.innerHTML=missing();
    filterPlayers();estimate();
  }
  function estimate(){
    const form=$('#awardForm');if(!form)return;
    const raw=form.elements.percent.value, c=state.characters.find(c=>c.id===form.dataset.id);
    const [whole,part='']=raw.split('.');
    $('#estimate').textContent=/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(raw)?
      'Base Power Level · '+num(c.sheet.bpl)+' → '+num(BigInt(c.sheet.bpl)+BigInt(c.sheet.bpl)*(BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))/10000n):'Enter a valid percentage.';
  }
  document.addEventListener('input',e=>{if(e.target.id==='filter')filterPlayers();if(e.target.name==='percent')estimate();});
  document.addEventListener('change',async e=>{if(e.target.id==='persona'&&demo){preview.switchRole(e.target.value);tell('');await load();}});
  window.addEventListener('hashchange',()=>{render();$('#view').focus({preventScroll:true});window.scrollTo(0,0);});
  function refreshReview(){
    if(!demo && session && !document.hidden && /^(request|sheet-)/.test(route())) void load().catch(e=>tell(e.message,true));
  }
  window.addEventListener('focus',refreshReview);
  window.setInterval(refreshReview,30000);
  document.addEventListener('click',async e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    try{
      if(action==='login'){await login();return;}
      if(action==='logout'){await call('/api/logout','POST',{});store.remove('session');session='';state=null;go('directory');render();return;}
      if(demo && (action==='demo-approve'||action==='demo-decline')){preview.decision(route().slice(8),action==='demo-approve');await load();tell('Practice decision recorded.');}
    } catch(e){tell(e.message,true);}
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;if(!['sheetForm','awardForm','settingsForm'].includes(f.id))return;
    e.preventDefault();const submit=f.querySelector('button[type=submit],button.primary');if(submit.disabled)return;
    const fields=Object.fromEntries(new FormData(f));
    submit.disabled=true;
    try {
      if(f.id==='settingsForm'){
        const payload={value:fields,revision:state.settings.revision};
        if(demo)preview.saveSettings(payload);else await call('/api/settings','POST',payload);
        await load();tell('Bot settings saved.');return;
      }
      const reason=fields.reason;delete fields.reason;
      const data={kind:f.id==='awardForm'?'award':f.dataset.id?'edit':'create',reason,version:Number(f.dataset.version)};
      if(f.dataset.id)data.characterId=f.dataset.id;
      if(data.kind==='award')data.award={percent:fields.percent.trim(),currency:fields.currency.trim(),gear:fields.gear.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)};
      else data.fields=fields;
      const snapshot=JSON.stringify(data);
      if(f.dataset.payload!==snapshot){f.dataset.payload=snapshot;f.dataset.key=crypto.randomUUID();}
      data.id=f.dataset.key;
      const result=demo?preview.propose(data):await call('/api/requests','POST',data);
      await load();go('request-'+result.id);tell(demo?'Practice request submitted. Switch to Owner to review.':'Request submitted. PhoenixCore will notify Gabe in Discord.');
    } catch(err){tell(err.message,true);}
    finally{submit.disabled=false;}
  });
  init().catch(e=>{render();tell(e.message,true);});
})();
