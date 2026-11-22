(() => {
  'use strict';
  const api=String(window.PHOENIXCORE_API||'').replace(/\/$/,'');
  const demo=!api || location.protocol==='file:' || new URLSearchParams(location.search).get('demo')==='1';
  const preview=window.PhoenixPreview;
  const $=selector=>document.querySelector(selector);
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={name:'Character name',lineage:'Species or lineage',portrait:'Portrait',bio:'Background',bpl:'Base Power Level',speed:'Speed',durability:'Durability',intelligence:'Intelligence',control:'Energy control',wallet:'Wallet',gear:'Gear'};
  const traits=['speed','durability','intelligence','control'];
  const formatter=new Intl.NumberFormat('en-US');
  const num=s=>formatter.format(BigInt(s||'0'));
  let state=null,session='',loadGeneration=0,preferenceChannel='',communityData=null,communityLoading=false,supportData=null,supportDetail=null,supportLoading=false,supportSearch=null,supportSearchPage=1,supportSearchFilters={query:'',kind:'',status:''},supportTemplateId='',supportTemplateHistoryData=null,giveawayData=null,giveawayDetail=null,giveawayLoading=false,giveawayRoster=null,giveawayRosterError='',giveawayRosterEvent='',giveawayRosterPage=1,giveawayRosterFilter='all',shopsData=null,shopsLoading=false,shopSalesData=null,shopSalesLoading=false,inventoryData=null,rolePanelData=null,rolePanelLoading=false;
  const pathKey='pc:'+location.pathname.replace(/index\.html$/,'')+':';
  const store={
    get(k){
      const key=pathKey+k,tab=sessionStorage.getItem(key);
      if(k!=='session')return tab;
      try{const saved=localStorage.getItem(key);if(!saved&&tab)localStorage.setItem(key,tab);if(tab)sessionStorage.removeItem(key);return saved||tab;}catch{return tab;}
    },
    set(k,v){if(k==='session'){try{localStorage.setItem(pathKey+k,v);sessionStorage.removeItem(pathKey+k);return;}catch{}}sessionStorage.setItem(pathKey+k,v);},
    remove(k){sessionStorage.removeItem(pathKey+k);if(k==='session')try{localStorage.removeItem(pathKey+k);}catch{}}
  };
  const route=()=>location.hash.slice(1)||'directory';
  const go=r=>{if(route()===r)render();else location.hash=r;};
  const ownerName=id=>state.players.find(p=>p.id===id)?.display||'Discord member';
  const initials=s=>s.trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]||'').join('').toUpperCase();
  const practiceImages=new Map();
  const source=value=>practiceImages.get(value)||value;
  function artwork(value, description){
    if(!value || !window.PhoenixForms.validImage(value))return '';
    return '<img class="submission-art" referrerpolicy="no-referrer" loading="lazy" alt="'+h(description)+'" src="'+h(source(value))+'">';
  }
  function avatar(s,id,src=''){
    const tint=['',' sage',' rose'][String(id).charCodeAt(0)%3];
    return '<span class="avatar'+tint+'">'+(src?'<img referrerpolicy="no-referrer" alt="" src="'+h(source(src))+'">':h(initials(s)))+'</span>';
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
    return '<label class="field'+(wide?' wide':'')+'"><span>'+h(caption)+(required?' <i>*</i>':'')+'</span>'+(area?'<textarea'+attrs+'>'+h(value)+'</textarea>':'<input'+attrs+' value="'+h(value)+'">')+(hint?'<small>'+h(hint)+'</small>':'')+'</label>';
  }
  function status(s){return '<span class="pill status '+h(s)+'">'+h(s==='needs_details'?'Needs details':s==='owner_review'?'Owner review':s==='awaiting_judge'?'Awaiting Helper':s==='stale'?'Outdated':s.charAt(0).toUpperCase()+s.slice(1))+'</span>';}
  function hero(heading,description){document.title=heading+' · PhoenixCore';return '<section class="hero"><p class="eyeline">PhoenixCore</p><h1>'+h(heading)+'</h1><p>'+h(description)+'</p></section>';}
  async function call(path,method='GET',data) {
    const headers={};
    if(session)headers.authorization='Bearer '+session;
    const binary=data instanceof Blob;
    if(data!==undefined)headers['content-type']=binary?(data.type||'application/octet-stream'):'application/json';
    const res=await fetch(api+path,{method,headers,body:data===undefined?undefined:binary?data:JSON.stringify(data),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
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
    await window.CodexLive?.ready;
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
          if(/^(directory|npcs|community|support|support-[\da-f-]{36}|giveaways|giveaway-[\da-f-]{36}|shops|shop-[\da-f-]{36}|roles|roles-[\da-f-]{36}|requests|settings|posting|catalogue|new(?:-[a-z]+)?|edit-[\w-]+|train-[\w-]+|design-[\w-]+|player-[\w-]+|sheet-[\w-]+|request-[\w-]+)$/.test(previous)) history.replaceState(null,'','#'+previous);
        } catch(e){tell(e.message,true);}
      } else if(['login-cancelled','member-required'].includes(hash)) {
        history.replaceState(null,'','#directory');tell(hash==='member-required'?'Sign in with an account that belongs to Convergence.':'Sign-in cancelled.',true);
      }
    }
    if(!demo&&session){
      const back=store.get('codex-return');store.remove('codex-return');
      if(back){try{const u=new URL(back),root=new URL('../',location.href);
        if(u.origin===root.origin&&u.pathname.startsWith(root.pathname)&&u.pathname!==location.pathname){location.replace(u.href);return;}}catch{}}
      void window.CodexLive?.access();
    }else if(!demo&&hashIsSignIn()){await login();return;}
    await load();
  }
  function hashIsSignIn(){return route()==='signin';}
  function chrome(){
    const active=route(),nav=$('#nav');
    const tabs=[['directory','Directory'],...(state?[['requests','Requests'],['community','Community'],['support','Support Center'],['giveaways','Giveaways'],['shops','Shops & Inventory'],['roles','Role Panels']]:[]),...(state?.actor.isOwner?[['settings','Bot settings']]:[])];
    nav.innerHTML=tabs.map(([key,n])=>'<a href="#'+key+'"'+((active===key||(key==='directory'&&/^(npcs$|player-|sheet-|edit-|new|award-)/.test(active))||(key==='requests'&&/^(request-|catalogue|design-|archived)/.test(active)))?' aria-current="page"':'')+'>'+n+'</a>').join('');
    $('#identity').innerHTML=state?'<span>'+h(ownerName(state.actor.id))+'</span>'+(demo?'':btn('logout','Sign out','quiet')):'';
    const banner=$('#practice');banner.hidden=!demo;
    if(demo){banner.innerHTML='<span><b>Practice mode</b> · Fictional players. Refresh to reset.</span><label>View as <select id="persona" aria-label="Practice role"><option value="player">Player</option><option value="judge">Helper</option><option value="owner">Owner</option></select></label>';$('#persona').value=preview.role();}
  }
  function playerCard(p) {
    const n=state.characters.filter(c=>c.ownerId===p.id&&c.sheet.characterType!=='NPC').length;
    return '<a class="card person" href="#player-'+h(p.id)+'">'+avatar(p.display,p.id,p.avatar)+'<span class="who"><b>'+h(p.display)+'</b><small class="muted">@'+h(p.username)+'</small><small class="subtle">'+n+' character'+(n===1?'':'s')+'</small></span><span class="arrow" aria-hidden="true">↗</span></a>';
  }
  function directory(){
    const judge=state.actor.isJudge;
    const search='<input id="filter" name="message" type="search" maxlength="180" aria-label="'+(judge?'Search player names or look up a character post':'Search player names')+'" placeholder="'+(judge?'Player name or Discord post…':'Search players…')+'">';
    return hero('Player directory','Find a player by their Discord name and open their approved character sheets.')+
      '<div class="section-head"><h2>Current players</h2><div class="tools">'+link('npcs','NPC catalog','button')+(judge?'<form id="attributionForm" class="actions">'+search+'<button class="primary" hidden>Look up writer</button></form>':search)+(state.actor.isPlayer?link('new','New Submission','button primary'):'')+'</div></div>'+
      (judge?'<div id="attribution" role="status"></div>':'')+'<div id="players" class="grid"></div>';
  }
  function filterPlayers(){
    if(!$('#players'))return;
    const query=($('#filter')?.value||'').trim().toLowerCase();
    const lookup=$('#attributionForm button'),isPost=/^(?:\d{17,20}|https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}\/?)$/.test(query);
    if(lookup){lookup.hidden=!isPost;$('#attribution').textContent='';}
    const players=state.players.filter(p=>(p.display+' '+p.username+' '+p.id).toLowerCase().includes(query)).sort((a,b)=>a.display.localeCompare(b.display));
    $('#players').innerHTML=players.map(playerCard).join('')||(lookup&&isPost?'':'<p class="empty">No players match this view.</p>');
  }
  const isFavorite=id=>(state.favoriteCharacterIds||[]).includes(id);
  const byFavorite=(a,b)=>Number(isFavorite(b.id))-Number(isFavorite(a.id))||a.sheet.name.localeCompare(b.sheet.name);
  function characterCard(c){return '<a class="card char-card" href="#sheet-'+h(c.id)+'"><div class="char-art">'+avatar(c.sheet.name,c.id,c.sheet.portrait)+'</div><div class="card-copy"><h3>'+h(c.sheet.name)+(isFavorite(c.id)?' ★':'')+'</h3><p class="muted">'+h(c.sheet.lineage||'Lineage unlisted')+'</p><span class="bpl">'+h(num(c.sheet.bpl))+' BPL</span></div></a>';}
  function npcDirectory(){
    const npcs=state.characters.filter(c=>c.sheet.characterType==='NPC').sort(byFavorite);
    return breadcrumbs([link('directory','Directory'),'NPC catalog'])+title('NPC catalog','Choose one of these names in /roleplay-start in a Convergence RP channel or forum post.')+
      (npcs.length?'<div class="grid">'+npcs.map(characterCard).join('')+'</div>':'<p class="empty">Approved NPCs will appear here.</p>');
  }
  function player(id){
    const p=state.players.find(p=>p.id===id);if(!p)return missing();
    const chars=state.characters.filter(c=>c.ownerId===id&&c.sheet.characterType!=='NPC').sort(byFavorite);
    return breadcrumbs([link('directory','Directory'),h(p.display)])+'<div class="sheet-head">'+avatar(p.display,p.id,p.avatar)+title(p.display,'@'+p.username)+(p.updatesUrl?'<a class="button" href="'+h(p.updatesUrl)+'" target="_blank" rel="noopener">Open OC Updates ↗</a>':'')+'</div>'+
      '<div class="section-head"><h2>Characters</h2>'+(id===state.actor.id&&state.actor.isPlayer?link('new','New Submission','button primary'):'')+'</div>'+
      (chars.length?'<div class="grid">'+chars.map(characterCard).join('')+'</div>':'<p class="empty">This player has no approved characters yet.</p>');
  }
  function sheet(id){
    const c=state.characters.find(c=>c.id===id);if(!c)return missing();
    const s=c.sheet;document.title=s.name+' · PhoenixCore';
    const own=c.ownerId===state.actor.id&&s.characterType!=='NPC',account=(state.economyAccounts||[]).find(a=>a.characterId===id),active=forms.readForms(s.attainedForms).find(f=>f.id===c.activeForm),effective=forms.effectiveSheet(s,active);
    return breadcrumbs([link('directory','Directory'),(s.characterType==='NPC'?link('npcs','NPC catalog'):link('player-'+c.ownerId,ownerName(c.ownerId))),h(s.name)])+
      '<div class="sheet-head">'+avatar(s.name,c.id,active?.portrait||s.portrait)+'<div><p class="eyeline">Character sheet · Revision '+h(c.version)+'</p><h1>'+h(s.name)+'</h1><p class="muted">'+h(s.lineage||'Lineage unlisted')+'</p><p>RP posting tag · '+(c.tag?'<code>'+h(c.tag)+'</code>':'Unassigned')+'</p></div></div>'+
      '<div class="section-head"><h2>Approved stats</h2><div class="tools">'+btn('favorite-character',isFavorite(id)?'★ Remove favorite':'☆ Favorite')+(own?link('edit-'+id,'Propose edit','button primary')+link('forms-'+id,'Add attained transformation','button')+link('train-'+id,'Submit training','button'):'')+(state.actor.isJudge?link('award-'+id,'Judge a reward','button'):'')+'</div></div>'+
      '<div class="two"><div class="stack"><section class="panel"><h3>Base Power Level</h3><div class="big-number">'+h(num(s.bpl))+'</div>'+(active?'<h3>Power Level · '+h(active.name)+'</h3><div class="big-number">'+h(num(effective.bpl))+'</div>':'')+'</section><section class="panel"><h3>Attributes</h3>'+
      traits.map(k=>'<div class="stat-row"><span>'+h(label[k])+'</span><strong>'+h(effective[k]||'Unrecorded')+'</strong></div>').join('')+'</section></div>'+
      '<div class="stack"><section class="panel"><h3>Wallet &amp; gear</h3><p>Cash · <b>'+h(account?num(account.cash):'Private')+'</b> '+h(state.currency)+'</p>'+
       (account?'<p>Bank · <b>'+h(num(account.bank))+'</b> '+h(state.currency)+'</p>':'')+
       (own&&account?'<div class="actions">'+btn('bank-deposit','Deposit to bank')+btn('bank-withdraw','Withdraw from bank')+'</div>':'')+(account?'<div class="actions">'+btn('bank-statement','Transaction history')+'</div><div id="statement" class="muted" role="region" aria-label="Character transaction history" hidden></div>':'')+
       '<div class="pills">'+(s.gear.length?s.gear.map(g=>'<span class="pill">'+h(g)+'</span>').join(''):'<span class="muted">No gear recorded.</span>')+'</div></section></div></div><section class="panel dossier"><h3>Background</h3><p class="prewrap">'+h(s.bio||'No background recorded.')+'</p></section>'+
      (s.progress?.length?'<section class="panel dossier"><h3>Training stats</h3>'+s.progress.filter(x=>x.name.toLowerCase()!=='strength').map(x=>'<div class="stat-row"><span>'+h(x.name)+'</span><strong>'+h(num(x.amount))+'</strong></div>').join('')+'</section>':'')+
      '<div class="stack sheet-dossier">'+formsPanel(c)+displayGroups('create',s,['name','lineage','portrait','tag','bio','bpl','attainedForms',...traits])+'</div>'+
      (own?posting(c):'')+(state.actor.isOwner&&s.characterType!=='NPC'?'<section class="panel dossier"><h3>Owner controls</h3>'+btn('remove-character','Remove character from profile','danger')+'</section>':'');
  }
  const missing=()=>title('Unavailable','This entry is unavailable for your Discord account.')+link('directory','Back to directory','button');
  const forms=window.PhoenixForms;
  const drafts=new Map();
  const kindNames=Object.fromEntries(Object.entries(forms.forms).map(([key,v])=>[key,v.title]));
  const options=(items,value)=>items.map(([key,text])=>'<option value="'+h(key)+'"'+(key===value?' selected':'')+'>'+h(text)+'</option>').join('');
  function draftKey(kind,id,version=0){return [state.actor.id,kind,id||'',version].join('/');}
function formList(raw){
    const read=forms.readForms(raw);
    return read.length?read.map(f=>'<div class="form-art-row">'+artwork(f.portrait,f.name)+'<strong>'+h(f.name)+'</strong>'+(f.multiplier?'<span>Power Level ×'+h(f.multiplier)+'</span>':'')+Object.entries(f.modifiers||{}).map(([k,v])=>'<span>'+h(label[k]||k)+' '+h(v)+'</span>').join('')+'</div>').join(''):'—';
  }
  function formsPanel(c){
    const active=forms.readForms(c.sheet.attainedForms).find(f=>f.id===c.activeForm);
    return '<section class="panel"><h3>Attained transformations</h3><p>Current form · <b>'+h(active?.name||'Base')+'</b></p>'+
      (c.sheet.attainedForms?formList(c.sheet.attainedForms)+'<p class="hint">Use <code>/transform</code> in Convergence. Use <code>/revert-form</code> for base or an earlier attained form.</p>':'<p class="muted">No transformations recorded.</p>')+'</section>';
  }
  function availableForms(lineage){
    const data=window.CONVERGENCE_DATA, choices=[];
    const race=data.races.find(r=>r.name.toLowerCase()===String(lineage||'').toLowerCase());
    const plain=s=>String(s).normalize('NFKC').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu,'').trim().slice(0,100);
    for(const [pi,p] of (race?.paths||[]).entries())for(const [fi,f] of p.forms.entries()){
      const name=plain(f.title);if(name)choices.push({id:'race-'+(f.messageId||race.slug+'-'+pi+'-'+fi),name,group:p.name});
    }
    for(const u of data.universal)for(const [i,f] of u.messages.entries()){
      if(String(f.html||'').replace(/<[^>]*>/g,' ').trim().length<60)continue;
      const name=plain(f.title);if(name)choices.push({id:'univ-'+(f.messageId||u.slug+'-'+i),name,group:u.title});
    }
    for(const d of state.catalogue||[])if(d.kind==='transformation'&&(!d.fields.lineage||/universal/i.test(d.fields.lineage)||String(d.fields.lineage).toLowerCase()===String(lineage||'').toLowerCase()))choices.push({id:d.id,name:d.fields.name,group:'Approved designs',portrait:d.fields.art||'',multiplier:/^x?\d+(\.\d{1,4})?$/i.test(d.fields.multiplier||'')?d.fields.multiplier.replace(/^x/i,''):''});
    return choices;
  }
  function formChoices(lineage){
    const list=availableForms(lineage),groups=[...new Set(list.map(f=>f.group))];
    return '<option value="">Choose a form…</option>'+groups.map(g=>'<optgroup label="'+h(g)+'">'+list.filter(f=>f.group===g).map(f=>'<option value="'+h(f.id)+'">'+h(f.name)+'</option>').join('')+'</optgroup>').join('')+'<option value="custom">Custom attained form…</option>';
  }
  function formRow(f){
    return '<div class="attained-row media-picker" data-form-id="'+h(f.id)+'"><label>Form name<input data-form-name maxlength="100" value="'+h(f.name)+'" required></label>'+
      '<label>Form portrait URL<input data-media-url maxlength="2048" value="'+h(f.portrait)+'"></label><label>Upload form portrait<input type="file" data-media-file accept="image/png,image/jpeg,image/webp,image/gif"></label>'+
      '<label>Power Level multiplier<input data-multiplier value="'+h(f.multiplier||'')+'" placeholder="e.g. 2.5" maxlength="13"></label><details><summary>Form stat adjustments</summary>'+traits.map(k=>'<label>'+h(label[k])+'<input data-modifier="'+k+'" maxlength="20" placeholder="+2 or x1.5" value="'+h(f.modifiers?.[k]||'')+'"></label>').join('')+'</details>'+
      '<div data-media-preview>'+artwork(f.portrait,f.name)+'</div><small data-upload-status role="status"></small><div class="actions"><button type="button" data-move-form="up">Move earlier</button><button type="button" data-move-form="down">Move later</button><button type="button" data-remove-form>Remove form</button></div></div>';
  }
  function formPicker(value,lineage){
    let rows=[];try{rows=JSON.parse(value||'[]');}catch{}
    return '<div class="field wide attained-picker"><h3>Attained transformations</h3><p class="hint">List earned forms from lowest to highest. Only enter numeric effects supported by the form’s rules. A Helper reviews additions and changes.</p>'+
      '<input type="hidden" name="attainedForms" value="'+h(value)+'"><div data-attained-rows>'+rows.map(formRow).join('')+'</div>'+
      '<div class="actions"><label>Available forms<select data-form-choice aria-label="Available forms">'+formChoices(lineage)+'</select></label><button type="button" data-add-form>Add form</button></div></div>';
  }
  function syncForms(f){
    const hidden=f?.elements.attainedForms;if(!hidden)return;
    const rows=[...f.querySelectorAll('.attained-row')].map(row=>{
      const value={id:row.dataset.formId,name:row.querySelector('[data-form-name]').value.trim(),portrait:row.querySelector('[data-media-url]').value.trim()};
      const factor=row.querySelector('[data-multiplier]').value.trim();if(factor)value.multiplier=factor;
      const modifiers=Object.fromEntries([...row.querySelectorAll('[data-modifier]')].filter(el=>el.value.trim()).map(el=>[el.dataset.modifier,el.value.trim()]));
      if(Object.keys(modifiers).length)value.modifiers=modifiers;return value;
    });
    hidden.value=rows.length?JSON.stringify(rows):'';
  }
  function currentRaces(){
    return state.races||[...window.CONVERGENCE_DATA.races.map(r=>({id:r.slug,name:r.name,paths:r.playablePaths===undefined?r.paths.filter(p=>p.classification!=='foundational').map(p=>p.name):r.playablePaths.split(/\r?\n/).filter(Boolean)})),...(state.catalogue||[]).filter(d=>d.kind==='race').map(d=>({id:d.id,name:d.fields.name,paths:(d.fields.paths||'').split(/\r?\n/).filter(Boolean)}))];
  }
  function pathChoices(race,selected='',legacy=''){
    const paths=[...new Set([...(currentRaces().find(r=>r.name===race)?.paths||[]),...(legacy?[legacy]:[])])];
    return options([['',paths.length?'Choose a path…':'No paths listed'],...paths.map(p=>[p,p])],selected);
  }
  function refreshChoices(f){
    const path=f?.elements.namedItem('path'),lineage=f?.elements.namedItem('lineage')?.value;
    if(path){
      const sheet=state.characters.find(c=>c.id===f.dataset.id)?.sheet;
      path.innerHTML=pathChoices(lineage,path.value,sheet&&sheet.lineage===lineage?sheet.path:'');
    }
    const picker=f?.querySelector('[data-form-choice]');if(picker)picker.innerHTML=formChoices(f.elements.lineage.value);
  }

  function submissionField(f,values,editing=false){
    const val=values[f.key]??(editing?'':f.initial||'');
    const req=f.required && !editing;
    if(f.key==='attainedForms')return formPicker(val,values.lineage);
    if(f.key==='path')return '<label class="field">Path<select name="path" aria-label="Path">'+pathChoices(values.lineage,val,editing?val:'')+'</select></label>';
    if(f.key==='lineage'){
      const races=[...new Set([...currentRaces().map(r=>r.name),...(val?[val]:[])])].sort();
      return '<label class="field">Race / lineage<select data-lineage aria-label="Race / lineage">'+options([['','Choose…'],...races.map(n=>[n,n]),['__custom','Other lineage…']],val)+'</select></label><label class="field" data-custom-lineage hidden>Custom lineage<input name="lineage" maxlength="80" value="'+h(val)+'"></label>';
    }
    if(f.media) return '<div class="field wide media-picker"><label><span>'+h(f.label)+' URL</span><input data-media-url name="'+h(f.key)+'" value="'+h(val)+'" maxlength="'+f.max+'" placeholder="https://…"></label>'+
      '<label><span>Upload '+h(f.label.toLowerCase())+'</span><input type="file" data-media-file accept="image/png,image/jpeg,image/webp,image/gif"></label>'+
      '<small>Choose a PNG, JPG, WebP or GIF up to 5 MiB, or paste a direct HTTPS image link.</small><div data-media-preview>'+artwork(val,f.label+' preview')+'</div><small data-upload-status aria-live="polite"></small></div>';
    if(f.options) return '<label class="field"><span>'+h(f.label)+(req?' <i>*</i>':'')+'</span><select name="'+h(f.key)+'"'+(req?' required':'')+'>'+
      options([['','Choose…'],...f.options],val)+'</select></label>';
    return field(f.key,f.label,val,{area:f.area,wide:f.area,max:f.max,required:req,numeric:f.whole,hint:f.hint||'',pattern:f.whole?'0|[1-9][0-9]*':''});
  }
  function groups(kind,values,editing=false){
    return forms.forms[kind].sections.map((group,i)=>'<fieldset class="panel form-section" id="section-'+kind+'-'+i+'"><legend>'+h(group.title)+'</legend><div class="fields">'+
      group.fields.map(f=>submissionField(f,values,editing)).join('')+'</div>'+
      (kind==='item'&&i===3?'<details class="tier-guide" open><summary>Intelligence tier guide</summary><table><tbody>'+forms.tiers.map(([tier,description])=>'<tr><th scope="row">'+h(tier)+'</th><td>'+h(description)+'</td></tr>').join('')+'</tbody></table><p data-tier-feedback class="hint" aria-live="polite"></p></details>':'')+'</fieldset>').join('');
  }
  function tierFeedback(){
    const box=$('[data-tier-feedback]');if(!box)return;
    const f=$('#submissionForm'),current=f.elements.currentInt.value,required=f.elements.requiredInt.value;
    box.textContent=current&&required&&Number(current)<Number(required)?'Your Intelligence is below the proposed requirement. Staff can consider mentorship, assistance or a split submission.':'';
  }
  function editor(kind='create',id='',intake=null){
    if(!(state.actor.isPlayer||intake&&state.actor.isJudge) || !Object.hasOwn(forms.forms,kind))return missing();
    const targeted=kind==='edit'||kind==='training', mine=state.characters.filter(c=>c.ownerId===(intake?.authorId||state.actor.id)&&c.sheet.characterType!=='NPC');
    const c=targeted?mine.find(c=>c.id===id):null;
    if(targeted&&id&&!c)return missing();
    const d={...(intake?.native.input.fields||{}),...(intake?.native.input.details||{}),...(intake?{reason:intake.reason}:{}),...(drafts.get(intake?'intake:'+intake.id+':'+id:draftKey(kind,id,c?.version||0))||{})};
    const selector='<div class="submission-tools"><label class="field"><span>Submission type</span><select id="submissionType"'+(intake?' disabled':'')+'>'+options(Object.entries(kindNames),kind)+'</select></label>'+
      (targeted?'<label class="field"><span>Character</span><select id="submissionCharacter">'+options([['','Choose your character…'],...mine.map(c=>[c.id,c.sheet.name])],id)+'</select></label>':'')+'</div>';
    const head=title(intake?'Complete Discord submission':'New Submission',intake?'Transcribe the original post from '+ownerName(intake.authorId)+'.':'Choose a template. You can switch back to your draft in this tab.')+(intake?nativeSource(intake):'')+selector;
    if(targeted&&!c)return head+'<p class="empty">'+(mine.length?'Choose the character this submission belongs to.':'You need an approved character for this request. '+link('new','Submit a new character'))+'</p>';
    const isEdit=kind==='edit';
    const anchors=[...forms.forms[kind].sections.map((s,i)=>[s.title,'section-'+kind+'-'+i]),...(isEdit?forms.forms.create.sections.map((s,i)=>[s.title,'section-create-'+i]):[])];
    const copy=kind==='training'?'A Helper assesses the scene and proposed gains before an award can be approved.':isEdit?'A posting tag by itself saves immediately. Changing the portrait or any other sheet field sends the whole edit for review.':'Fields marked * are required.';
    const values=isEdit?{...c.sheet,tag:c.tag||'',...d}:d;
    return head+'<div class="submission-layout"><aside class="section-index"><h2>On this form</h2>'+anchors.map(([name,id])=>'<button type="button" data-section="'+id+'">'+h(name)+'</button>').join('')+'</aside>'+
      '<form id="submissionForm" class="form stack" data-kind="'+kind+'" data-intake="'+h(intake?.id||'')+'" data-id="'+h(id)+'" data-version="'+(c?.version||0)+'"><div><h2>'+h(kindNames[kind])+'</h2><p class="hint">'+h(copy)+'</p></div>'+
      groups(kind,values)+(isEdit?groups('create',values,true):'')+
      '<div class="panel form">'+field('reason',isEdit?'Reason for update':'Note for Gabe',d.reason||'',{area:true,wide:true,max:600,required:isEdit,hint:isEdit?'Explain the RP event, lore change or correction.':'Optional context for the review.'})+
      '<div class="actions"><button class="primary" type="submit">'+(kind==='training'?'Submit training claim':'Send for approval')+'</button>'+link(c?'sheet-'+id:'directory','Cancel','button')+'</div></div></form></div>';
  }
  function changesFor(c,fields){
    const old={...c.sheet,tag:c.tag||''};
    return Object.fromEntries(forms.allFields('create').map(f=>[f.key,(fields[f.key]??'').trim()])
      .filter(([k,v])=>v!==(old[k]??'')));
  }
  function syncEditMode(f){
    if(!f||f.dataset.kind!=='edit')return;
    const c=state.characters.find(x=>x.id===f.dataset.id);
    if(!c)return;
    const keys=Object.keys(changesFor(c,Object.fromEntries(new FormData(f))));
    const tagOnly=keys.length===1 && keys[0]==='tag';
    for(const key of ['summary','approval','reason']){
      const input=f.elements[key];input.required=!tagOnly;
      const mark=input.closest('label')?.querySelector('i');if(mark)mark.hidden=tagOnly;
    }
    f.querySelector('button[type="submit"]').textContent=tagOnly?'Save posting tag':'Send for approval';
  }
  async function uploadArt(input){
    const file=input.files?.[0];if(!file)return;
    const f=input.form, picker=input.closest('.media-picker'),url=picker.querySelector('[data-media-url]'),status=picker.querySelector('[data-upload-status]');
    const submit=f.querySelector('button[type="submit"]');
    input.disabled=true;url.readOnly=true;submit.disabled=true;f.dataset.uploading='1';
    try {
      if(file.size>5*1024*1024 || file.size===0)throw Error('Choose a nonempty file of 5 MiB or less.');
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Choose a PNG, JPG, WebP or GIF.');
      status.textContent='Uploading image…';
      let result;
      if(demo){
        result='../assets/uploads/practice-'+crypto.randomUUID()+'.'+(file.type==='image/jpeg'?'jpg':file.type.slice(6));
        practiceImages.set(result,URL.createObjectURL(file));
      }else result=(await call('/api/media','POST',file)).url;
      url.value=result;syncForms(f);picker.querySelector('[data-media-preview]').innerHTML=artwork(result,'Selected artwork');
      drafts.set(f.dataset.intake?'intake:'+f.dataset.intake+':'+f.dataset.id:draftKey(f.dataset.kind,f.dataset.id,f.dataset.version),Object.fromEntries(new FormData(f)));
      status.textContent='Image ready to submit.';
    }catch(error){status.textContent=error.message;}
    finally{input.value='';input.disabled=false;url.readOnly=false;submit.disabled=false;delete f.dataset.uploading;syncEditMode(f);}
  }
  function recordDraft(){
    const f=$('#submissionForm');if(f)drafts.set(f.dataset.intake?'intake:'+f.dataset.intake+':'+f.dataset.id:draftKey(f.dataset.kind,f.dataset.id,f.dataset.version),Object.fromEntries(new FormData(f)));
  }
  function displayGroups(kind,values,excluded=[]){
    return forms.forms[kind].sections.map(group=>{
      const visible=group.fields.filter(f=>!excluded.includes(f.key)&&values[f.key]);
      return visible.length?'<section class="panel dossier"><h3>'+h(group.title)+'</h3><dl>'+visible.map(f=>'<div><dt>'+h(f.label)+'</dt><dd class="prewrap">'+(f.media?artwork(values[f.key],f.label):f.key==='attainedForms'?formList(values[f.key]):h(values[f.key]))+'</dd></div>').join('')+'</dl></section>':'';
    }).join('');
  }
  function catalogue(id){
    const list=state.catalogue||[];
    if(id){
      const entry=list.find(e=>e.id===id);if(!entry)return missing();
      return requestTabs('catalogue')+breadcrumbs([link('catalogue','Approved designs'),h(kindNames[entry.kind])])+title(entry.fields.name,kindNames[entry.kind]+' · Submitted by '+ownerName(entry.authorId))+'<div class="stack">'+displayGroups(entry.kind,entry.fields,['name'])+(entry.kind==='race'&&state.canEditPaths?editPaths(currentRaces().find(r=>r.id===entry.id)):'')+'</div>';
    }
    return requestTabs('catalogue')+title('Approved designs','Techniques, items, races and transformations approved for Convergence.')+
      (list.length?'<div class="grid">'+list.map(e=>'<a class="card" href="#design-'+h(e.id)+'">'+artwork(e.fields.art,e.fields.name)+'<small class="eyeline">'+h(kindNames[e.kind])+'</small><h3>'+h(e.fields.name)+'</h3><p class="muted">'+h(ownerName(e.authorId))+'</p></a>').join('')+'</div>':'<p class="empty">The first approved design will appear here.</p>');
  }
  function award(id,claim=null){
    const c=state.characters.find(c=>c.id===id);if(!c||!state.actor.isJudge)return missing();
    return (claim?'<div class="section-head"><h2>Assess this claim</h2></div>':breadcrumbs([link('sheet-'+id,c.sheet.name),'Staff judgment'])+title('Judge a reward','Record the award earned by '+c.sheet.name+'. A Helper or Gabe can confirm the calculated change.'))+
      '<form class="panel form" id="awardForm" data-claim="' + h(claim?.id||'') + '" data-id="'+h(id)+'" data-version="'+c.version+'"><div class="fields">'+
      field('percent','Final BPL gain (%)','0',{max:12,required:true,hint:'Enter the judged percentage with up to two decimals, or use a fixed gain below.'})+
      field('points','Fixed BPL gain','0',{max:60,numeric:true,hint:'Use zero when awarding a percentage.'})+
      field('currency',state.currency+' to award','0',{numeric:true,required:true,max:60,pattern:'0|[1-9][0-9]{0,59}'})+
      field('gear','Gear to award','',{area:true,wide:true,max:2000,hint:'One item per line.'})+
      field('statGains','Other stat gains','',{area:true,wide:true,max:1700,hint:'One per line, e.g. Ki Control +2 or Ability Slots +1.'})+
      field('reason','Judgment and scene reference','',{area:true,wide:true,required:true,max:600})+'</div><p id="estimate" class="bpl" aria-live="polite"></p><button class="primary">Submit award for approval</button></form>';
  }
  function requestTabs(active){
    return '<nav class="actions request-tabs" aria-label="Request categories">'+[['requests','Submissions'],['catalogue','Approved designs'],['archived','Archived']].map(([id,text])=>'<a class="button" href="#'+id+'"'+(active===id?' aria-current="page"':'')+'>'+text+'</a>').join('')+'</nav>';
  }
  function requestList(archived=false){
    const list=state.requests.filter(r=>!!r.archived===archived);
    return title('Requests',state.actor.isOwner?'Review submitted changes and their Discord delivery status.':state.actor.isJudge?'Review submissions and judge training claims.':'Follow your submissions and character awards.')+
      requestTabs(archived?'archived':'requests')+(list.length?'<div class="stack">'+list.map(r=>'<a class="request-row" href="#request-'+h(r.id)+'"><span class="summary"><b>'+h(r.after.name)+'</b><small class="muted">'+h(kindNames[r.kind]||'Staff award')+' · '+h(ownerName(r.authorId))+'</small></span>'+status(r.status)+'<span class="arrow" aria-hidden="true">↗</span></a>').join('')+'</div>':'<p class="empty">No requests yet.</p>');
  }
  function display(v){
    if(Array.isArray(v))return v.map(x=>typeof x==='object'?x.name+' +'+x.amount:x).join(', ')||'—';
    return v===undefined||v===null||v===''?'—':String(v);
  }
  function nativeSource(r){
    if(!r.native)return '';
    return '<section class="panel dossier"><h2>Original Discord submission</h2><p><a href="'+h(r.native.source)+'" target="_blank" rel="noopener">Open original post ↗</a></p><div class="prewrap">'+h(r.native.text)+'</div>'+r.native.attachments.map(a=>'<p><a href="'+h(a.url)+'" target="_blank" rel="noopener">'+h(a.name)+'</a></p>').join('')+'</section>';
  }
  function requestView(id){
    const r=state.requests.find(r=>r.id===id);if(!r)return missing();
    const design=forms.catalogue.includes(r.kind),waiting=r.status==='awaiting_judge',pending=r.status==='pending',incomplete=r.status==='needs_details',appeal=r.status==='owner_review';
    const fields=forms.allFields(design?r.kind:'create'),captions={...label,progress:'Training stats',...Object.fromEntries(fields.map(f=>[f.key,f.label]))};
    const changed=Object.keys(r.after).filter(k=>!['portrait','art','strength'].includes(k)&&(r.before?JSON.stringify(r.before[k])!==JSON.stringify(r.after[k]):r.after[k]!==''&&(!Array.isArray(r.after[k])||r.after[k].length)));
    const value=(k,v)=>k==='attainedForms'?formList(v):h(display(v));
    const edits=changed.map(k=>'<div class="change-entry"><h3>'+h(captions[k]||k)+'</h3>'+(r.before?'<small>Previously approved</small><div class="prewrap previous">'+value(k,r.before[k])+'</div><small>Proposed</small>':'')+'<div class="prewrap">'+value(k,r.after[k])+'</div></div>').join('');
    const image=r.after.portrait||r.after.art,oldImage=r.before?.portrait||r.before?.art;
    const images=image||oldImage?'<figure class="panel request-portrait"><figcaption>'+h(design?'Submitted artwork':'Character portrait')+'</figcaption>'+artwork(image,'Proposed artwork')+(oldImage&&oldImage!==image?'<details><summary>Previously approved artwork</summary>'+artwork(oldImage,'Approved artwork')+'</details>':'')+'</figure>':'';
    const meanings={archived:'Review is paused.',pending:'Ready for a Helper or the owner to decide.',awaiting_judge:'A Helper needs to assess the scene and calculate the award.',owner_review:'A Helper denied this submission. Gabe has the final decision.',needs_details:'Complete the template from the original Discord post before approval.',stale:'The sheet changed. Review the current sheet before submitting again.',approved:design?'Published in approved designs.':'Applied to the character.',declined:'The submission was declined.'};
    const checks=r.assessment&&state.actor.isJudge?'<section class="panel staff-checks"><h2>Private staff checks</h2><p>'+h(r.assessment.summary)+'</p>'+r.assessment.checks.map(c=>'<div><strong>'+h(c.label)+'</strong><small>'+h(({met:'Met',review:'Reviewer judgment',attention:'Needs attention'})[c.state])+'</small><p>'+h(c.detail)+'</p></div>').join('')+'</section>':'';
    const ownerOnlyDesign=['race','transformation'].includes(r.kind);
    const canApprove=state.actor.isOwner||!ownerOnlyDesign;
    const review=state.actor.isJudge&&(pending||waiting||incomplete)?'<div class="actions">'+
      (pending&&canApprove?btn('review-approve',demo?'Practice approve':'Approve','primary'):'')+
      btn('review-decline',demo?'Practice decline':'Deny','danger')+'</div>'+
      (pending&&ownerOnlyDesign&&!state.actor.isOwner?'<p class="muted">Race and Transformation approvals require the server Owner. You may review or recommend denial.</p>':''):'';

    const ownerReview=state.actor.isOwner&&appeal?'<div class="actions">'+btn('review-uphold','Uphold denial','danger')+btn('review-veto','Veto denial','primary')+'</div>':'';
    const denial=appeal&&r.denial?'<p>Helper · '+h(ownerName(r.denial.helper))+(r.denial.note?' · '+h(r.denial.note):'')+'</p>'+(state.actor.isOwner?'<p>Owner DM · '+(r.denial.delivered?'Delivered':'Queued for delivery')+'</p>':''):'';
    const archive=state.actor.isOwner&&!appeal?'<div class="actions">'+(!r.archived?btn('archive-request','Archive request','quiet'):((r.status==='archived'?btn('restore-request','Restore request','quiet'):'')+btn('delete-request','Delete archived request','danger')))+'</div>':'';
    return breadcrumbs([link(r.archived?'archived':'requests',r.archived?'Archived':'Requests'),h(r.after.name)])+title(r.after.name,(kindNames[r.kind]||'Staff award')+' · Submitted by '+ownerName(r.authorId))+
      '<div class="stack request-reading"><section class="panel"><h2>Decision</h2>'+status(r.status)+'<p>'+h(meanings[r.status])+'</p>'+denial+review+ownerReview+
      (incomplete?link('intake-'+id,'Complete Discord submission','button primary'):'')+
      (r.reviewUrl?'<p><a href="'+h(r.reviewUrl)+'" target="_blank" rel="noopener">Open review in Discord ↗</a></p>':'')+
      (state.actor.isJudge&&(waiting||pending||incomplete)?'<p class="muted">Discord notification · '+h(r.delivery)+'</p>':'')+
      (state.characters.some(c=>c.id===r.characterId)?link('sheet-'+r.characterId,'View approved sheet'):design&&r.status==='approved'?link('design-'+r.id,'View approved design'):'')+archive+'</section>'+
      images+nativeSource(r)+(edits?'<section class="panel"><h2>Requested changes</h2>'+edits+'</section>':'')+
      (r.details?displayGroups(r.kind,r.details):'')+'<section class="panel"><h3>Submission note</h3><p class="prewrap">'+h(r.reason)+'</p>'+
      (r.award?'<p class="bpl">+'+h(num(r.award.gain))+' BPL · +'+h(num(r.award.currency))+' '+h(state.currency)+'</p>':'')+'</section>'+
      (r.judgment?'<section class="panel"><h3>Staff judgment</h3><p>'+h(ownerName(r.judgment.judgeId))+'</p><p class="prewrap">'+h(r.judgment.note)+'</p></section>':'')+checks+
      (waiting&&state.actor.isJudge?award(r.characterId,r):'')+'</div>';
  }
  function scopePanel(scope,divider){
    if(!scope)return '';
    const items=scope.locations||[],threads=items.filter(c=>[10,11,12].includes(c.type)).length;
    const missing=items.filter(c=>c.missing?.length);
    const present=scope.categories.some(c=>c.id===divider);
    return '<h2>Discord posting coverage</h2><p>Discord connection · <b>'+(scope.online?'Online':'Offline')+'</b></p>'+
      (divider&&!present?'<p>The saved divider is unavailable. Automatic posting is paused.</p>':'')+
      '<p>'+h(items.length-threads)+' channels · '+h(threads)+' visible threads'+(scope.scanning?' · Checking archived threads…':'')+'</p>'+
      (scope.incomplete?'<p>Archived threads could not be fully listed in '+h(scope.incomplete)+' channels.</p>':'')+
      (missing.length?'<p>'+h(missing.length)+' locations need additional bot permissions. See the list for details.</p>':'')+
      (items.length?'<details data-location-list><summary>Channel and thread IDs</summary><ul class="scope-list">'+items.map(c=>'<li><strong>'+h(c.name)+'</strong> <code>'+h(c.id)+'</code>'+(c.missing?.length?'<small>Needs '+h(c.missing.join(', '))+'</small>':'')+'</li>').join('')+'</ul></details>':'');
  }
  function dividerOptions(scope,id){
    const values=(scope?.categories||[]).map(c=>[c.id,c.name]);
    if(id&&!values.some(([v])=>v===id))values.push([id,'Unavailable category · '+id]);
    return options([['','Use manual channel IDs'],...values],id);
  }
  function embedForm(kind){
    const saved=state.announcements?.find(e=>e.kind===kind),d=saved?.draft||{};
    return '<details class="panel dossier"><summary>'+h(kind==='welcome'?'Welcome embed':'Guidelines embed')+'</summary><form class="embed-form form" data-kind="'+kind+'" data-version="'+(saved?.revision||0)+'"><div class="fields">'+
      field('channel','Destination channel or thread ID',d.channel||'',{max:20})+field('title','Embed title',d.title||'',{max:256,required:true})+
      field('body','Embed message',d.body||'',{area:true,wide:true,max:4096,required:true})+'<label class="field">Accent color<input type="color" name="color" value="'+h(d.color||'#ea875b')+'"></label>'+
      field('image','Optional image URL',d.image||'',{max:2048})+'</div><div class="embed-preview" aria-label="Embed preview"></div>'+
      (saved?.url?'<p><a href="'+h(saved.url)+'" rel="noopener" target="_blank">Open published embed ↗</a></p>':'')+
      '<div class="actions"><button type="submit" class="primary" value="save">Save draft</button><button type="submit" value="publish">Publish to Discord</button></div></form></details>';
  }
  function previewEmbed(form){
    const d=Object.fromEntries(new FormData(form)),box=form.querySelector('.embed-preview');
    box.style.borderInlineStartColor=d.color;box.innerHTML='<strong>'+h(d.title||'Embed preview')+'</strong><p class="prewrap">'+h(d.body)+'</p>'+artwork(d.image,'Embed image');
  }
  function editPaths(race){
    const key=(state.catalogue||[]).some(e=>e.id===race.id&&e.kind==='race')?'design-paths/'+race.id:'races/'+race.id;
    return '<form class="race-path-form form" data-key="'+h(key)+'" data-version="'+(state.pathRevisions?.[key]||0)+'">'+field('playablePaths','Selectable paths for '+race.name,race.paths.join('\n'),{wide:true,area:true,max:8000,hint:'One path per line. Saving an empty list removes all selectable paths for this race.'})+'<button class="primary">Save paths</button></form>';
  }
  function npcAiCapacity(){
    const ai=state.npcAi;
    if(!ai)return '<section class="panel dossier"><h2>NPC AI capacity</h2><p class="muted">Provider usage appears here when connected to the live PhoenixCore service.</p></section>';
    const providers=ai.providers||[];
    return '<section class="panel dossier"><h2>NPC AI capacity</h2>'+
      '<p><strong>'+h(ai.used)+' / '+h(ai.limit)+'</strong> shared NPC AI turns attempted today ('+h(ai.day)+' UTC).</p>'+
      '<p class="muted">The figures below are PhoenixCore’s local safeguards, not guaranteed remaining provider quota. Account free-tier limits and token ceilings can be lower.</p>'+
      (providers.length?'<div class="stack">'+providers.map(p=>
        '<div class="stat-row"><div><strong>'+h(p.provider)+' · '+h(p.model)+'</strong><p class="muted">'+
        h(p.dailyUsed)+'/'+h(p.dailyLimit)+' requests today · '+h(p.minuteUsed)+'/'+h(p.minuteLimit)+' this minute</p></div>'+
        '<span class="pill">'+h(p.retryAt>Date.now()?'Cooling down':p.lastStatus)+'</span></div>').join('')+'</div>':
        '<p>No AI providers configured in the host environment.</p>')+
      '<p class="muted">Read-only. Provider keys and caps are managed privately in Bot-Hosting.net. Use /roleplay-ai-status for live Discord diagnostics.</p></section>';
  }
  function settings(){
    if(!state.actor.isOwner||!state.settings)return missing();
    const s=state.settings.value;
    return title('Bot settings','Only your configured Discord owner account can save these settings.')+'<form id="settingsForm" class="panel form"><div class="fields">'+
      field('playerRole','Player role ID',s.playerRole,{wide:true,max:20,hint:'Leave blank to list every current human member. A role filters the directory, including players with no sheets.'})+
      field('judgeRole','Helper role ID',s.judgeRole,{wide:true,max:20,hint:'Receives submission pings. Helpers can approve, assess training and send denials to your DMs.'})+
      field('submissionMessage','Submission notification',s.submissionMessage||'{helper} A {type} submission for {character} is ready for review.',{area:true,wide:true,max:1300,required:true,hint:'Use {helper}, {type}, {character} and {player}. The Helper mention is included with every new review.'})+
      field('commandPrefixes','Bot command prefixes',s.commandPrefixes??'pc!',{max:150,hint:'Separate up to five prefixes with spaces. For example, pc!help or pc!transform Rin | Solar.'})+
      field('botNickname','Bot nickname in Convergence',s.botNickname||'',{max:32,hint:state.nicknameStatus||'Changes the name shown for the bot in this server.'})+
      field('loreParagraphs','Minimum backstory paragraphs',s.loreParagraphs||'0',{max:2,numeric:true,hint:'Zero leaves this check off.'})+
      field('loreSentences','Minimum sentences per paragraph',s.loreSentences||'0',{max:2,numeric:true})+
      field('loreWords','Minimum words per sentence',s.loreWords||'0',{max:2,numeric:true})+
      field('reviewGuidance','Private reviewer guidance',s.reviewGuidance||'',{area:true,wide:true,max:1500,hint:'Shown only to Helpers and the owner alongside the template checks.'})+
      field('characterChannel','Character submissions channel ID',s.characterChannel,{wide:true,max:20,required:true})+
      field('designChannel','Design submissions channel ID',s.designChannel,{wide:true,max:20,required:true,hint:'Techniques, items, races and transformations go here.'})+
      field('updatesForum','OC updates forum ID',s.updatesForum,{wide:true,max:20,required:true,hint:'Each player has one forum post for character updates and training.'})+
      '<label class="field wide"><span>Roleplay divider category</span><select name="rpDivider">'+dividerOptions(state.scope,s.rpDivider||'')+'</select><small>Includes channels in categories below this marker and their threads. Discord moves, new channels, and deletions update coverage automatically.</small></label>'+
      field('rpChannels','Roleplay channel IDs',s.rpChannels||'',{area:true,wide:true,max:2200,hint:'Used when no divider is selected. Enter one Discord channel or thread ID per line.'})+
      field('currency','Currency display name',s.currency,{max:32,required:true})+'</div><div class="actions"><button class="primary">Save settings</button></div></form><section id="live-scope" class="panel dossier">'+scopePanel(state.scope,s.rpDivider)+'</section>'+npcAiCapacity()+'<section class="stack dossier"><h2>Discord embeds</h2>'+embedForm('guidelines')+embedForm('welcome')+'</section>'+
      (state.canEditPaths?'<details class="panel dossier"><summary>Character paths by race</summary>'+currentRaces().map(r=>'<details><summary>'+h(r.name)+'</summary>'+editPaths(r)+'</details>').join('')+'</details>':'');
  }
  async function communityRefresh(){
    if(communityLoading||demo||!session)return;
    communityLoading=true;
    try{
      communityData=await call('/api/community');
      if(route()==='community')render();
    }catch(e){tell(e.message,true);}
    finally{communityLoading=false;}
  }
  function community(){
    if(demo)return title('Community','Informational tags and member suggestions appear here after connecting to the live PhoenixCore service.')+
      '<section class="panel"><p>Sign in to the live service to browse approved tags and submit suggestions. Practice mode does not write server data.</p></section>';
    if(!communityData){
      void communityRefresh();
      return title('Community','Server information and member suggestions.')+'<section class="panel"><p>Loading community content…</p></section>';
    }
    const data=communityData,staff=data.staff,owner=data.owner,active=data.modules||{};
    const tags=(data.tags||[]).map(item=>'<article class="panel dossier community-tag" data-community-name="'+h(item.name)+'"><h3>'+h(item.name)+'</h3><p class="prewrap">'+h(item.body)+'</p><small class="muted">Revision '+h(item.revision)+'</small></article>').join('');
    const suggestions=(data.suggestions||[]).map(item=>
      '<article class="panel dossier"><h3>'+h(item.title)+'</h3><p class="prewrap">'+h(item.body)+'</p>'+
      '<p><strong>'+h(item.status)+'</strong> · 👍 '+h(item.upvotes)+' · 👎 '+h(item.downvotes)+'</p>'+
      (item.staff_response?'<p class="prewrap"><b>Staff response:</b> '+h(item.staff_response)+'</p>':'')+
      (item.removed_ms?'<p class="muted"><strong>Removed from the community directory.</strong> An audit record is preserved.</p>':
      '<div class="actions"><button type="button" data-community-vote="1" data-suggestion-id="'+h(item.id)+'">👍 Upvote</button>'+
      '<button type="button" data-community-vote="-1" data-suggestion-id="'+h(item.id)+'">👎 Downvote</button>'+
      '<button type="button" data-community-vote="0" data-suggestion-id="'+h(item.id)+'">Remove vote</button></div>')+
      (staff&&!item.removed_ms?'<form class="community-review-form form" data-id="'+h(item.id)+'"><label class="field"><span>Decision</span><select name="status">'+
        ['Pending','Under Review','Approved','Denied','Implemented'].map(option=>'<option value="'+h(option)+'"'+(item.status===option?' selected':'')+'>'+h(option)+'</option>').join('')+
        '</select></label>'+field('response','Official staff response',item.staff_response||'',{area:true,max:950,wide:true})+'<button class="primary">Save decision</button></form>':'')+
      (owner?'<div class="actions"><button type="button" data-community-suggestion-action="'+(item.removed_ms?'restore':'remove')+'" data-suggestion-id="'+h(item.id)+'">'+(item.removed_ms?'Restore suggestion':'Remove suggestion')+'</button></div>':'')+
      '</article>').join('');
    const proposalCards=staff?(data.proposals||[]).map(p=>'<article class="panel dossier"><h3>'+h(p.name)+'</h3><p class="prewrap">'+h(p.body)+'</p>'+
      '<p class="muted">Submitted by '+h(p.author_id)+'</p><div class="actions"><button type="button" data-community-proposal="approve" data-proposal-id="'+h(p.id)+'">Approve</button>'+
      '<button type="button" data-community-proposal="decline" data-proposal-id="'+h(p.id)+'">Decline</button></div></article>').join(''):'';
    return title('Community','Share server knowledge and vote on ideas without replacing character roleplay tags.')+
      (owner?'<section class="panel dossier"><h2>Module switches</h2><p>Changes are owner-only and do not delete existing records.</p>'+
        ['tags','suggestions','moderation','reminders','support','giveaways','roles'].map(m=>'<label class="field"><span>'+h(m)+' enabled</span><input type="checkbox" data-community-toggle="'+m+'"'+(active[m]?' checked':'')+'></label>').join('')+'</section>':'')+
      (active.tags?'<section class="stack"><h2>Informational tags</h2><p>Published answers, guides and server references.</p>'+
        '<label class="field"><span>Search tags</span><input id="community-search" type="search" placeholder="Find a topic…"></label>'+
        (tags||'<section class="panel"><p>No information tags have been published yet.</p></section>')+
        '<section class="panel dossier"><h3>'+(staff?'Publish or update an information tag':'Propose an information tag')+'</h3>'+
        '<form id="community-tag-form" class="form">'+field('name','Short tag name','',{required:true,max:40})+
        field('content','Useful content','',{required:true,area:true,wide:true,max:1600})+
        '<button class="primary">'+(staff?'Publish tag':'Send proposal')+'</button></form></section>'+
        (staff?'<section class="stack"><h3>Pending tag proposals</h3>'+(proposalCards||'<p>No pending tag proposals.</p>')+
          '<form id="community-rollback-form" class="panel form">'+field('name','Tag to restore','',{required:true,max:40})+
          field('revision','Previous revision','',{required:true,max:8,numeric:true})+'<button class="primary">Restore version</button></form></section>':'')+'</section>':
        '<section class="panel"><h2>Informational tags</h2><p>This module is disabled.</p></section>')+
      (active.suggestions?'<section class="stack"><h2>Member suggestions</h2><p class="muted">New submissions from Discord or this website appear in the designated suggestions channel (ID '+h(data.suggestionChannelId||'1573908218260885614')+').</p>'+(suggestions||'<section class="panel"><p>No suggestions have been submitted yet.</p></section>')+
        '<section class="panel dossier"><h3>Submit a suggestion</h3><form id="community-suggest-form" class="form">'+
        field('title','Suggestion title','',{required:true,max:120})+
        field('content','What should be improved?','',{required:true,area:true,wide:true,max:1800})+
        '<label class="field"><span><input name="anonymous" type="checkbox"> Post anonymously to regular members</span></label>'+
        '<button class="primary">Submit suggestion</button></form></section></section>':
        '<section class="panel"><h2>Suggestions</h2><p>This module is disabled.</p></section>')+
      '<section class="panel dossier"><p>Want to post a public tag or launch an interactive vote inside Discord? Use /tag and /suggest. Character posting tags are a separate system.</p></section>';
  }
  async function supportRefresh(){
    if(supportLoading||demo||!session)return;
    supportLoading=true;
    try{
      supportData=await call('/api/support');
      const selected=/^support-([\da-f-]{36})$/i.exec(route());
      supportDetail=selected?await call('/api/support/'+selected[1]):null;
      if(route()==='support'||/^support-/.test(route()))render();
    }catch(error){tell(error.message,true);}
    finally{supportLoading=false;}
  }
  function supportTemplateManagement(){
    if(!supportData?.staff)return '';
    const available=supportData.templates||[],selected=available.find(x=>x.id===supportTemplateId)||null;
    const selector='<label class="field"><span>Existing saved reply</span>'+
      '<select id="support-template-picker"><option value="">New template</option>'+
      available.map(t=>'<option value="'+h(t.id)+'"'+(selected?.id===t.id?' selected':'')+'>'+
        h(t.name)+(t.active?'':' (archived)')+'</option>').join('')+'</select></label>';
    const history=supportTemplateHistoryData?.id===selected?.id?
      '<section class="stack"><h3>Revision history</h3>'+
      supportTemplateHistoryData.items.map(x=>'<div class="stat-row"><span>Revision '+h(x.revision)+
        ' · '+h(x.active?'Active':'Archived')+' · '+h(new Date(x.changedMs).toLocaleString())+
        '<small class="muted">'+h(x.actorId)+'</small></span></div>').join('')+'</section>':'';
    return '<section class="panel dossier"><h2>Staff saved replies</h2>'+
      '<p>Templates are private drafts. Picking one in a case fills an outward reply for review; it never sends automatically.</p>'+
      selector+'<form id="support-template-form" class="form" data-id="'+h(selected?.id||'')+
      '" data-revision="'+h(selected?.revision||'')+'">'+
      field('name','Template identifier',selected?.name||'',{required:true,max:40})+
      field('body','Reply text ({{case}}, {{member}}, {{staff}})',selected?.body||'',{area:true,wide:true,required:true,max:1800})+
      '<button class="primary">'+h(selected?'Save new revision':'Create saved reply')+'</button></form>'+
      (selected?'<div class="actions"><button type="button" data-support-template-action="history" data-id="'+h(selected.id)+
        '">Revision history</button>'+
        (selected.active?'<button type="button" data-support-template-action="archive" data-id="'+h(selected.id)+
        '" data-revision="'+h(selected.revision)+'">Archive template</button>':'')+'</div>':'')+
      history+'</section>';
  }
  async function supportSearchLoad(){
    if(!session||demo)return;
    try{
      const filters=supportSearchFilters;
      const q=new URLSearchParams({...filters,page:String(supportSearchPage),pageSize:'25'});
      supportSearch=await call('/api/support/search?'+q.toString());
      if(route()==='support')render();
    }catch(error){tell(error.message,true);}
  }
  function supportPage(){
    if(demo)return title('Support Center','Live, private tickets and Modmail conversations')+
      '<section class="panel"><p>The Support Center is available only when signed into the live PhoenixCore server. Practice mode does not create or transmit cases.</p></section>';
    if(!supportData){
      void supportRefresh();
      return title('Support Center','Private tickets, reports, appeals and Modmail.')+
        '<section class="panel"><p>Loading accessible support cases…</p></section>';
    }
    const match=/^support-([\da-f-]{36})$/i.exec(route());
    if(match){
      if(!supportDetail||supportDetail.case?.id!==match[1]){
        void supportRefresh();
        return title('SupportCase','Loading private conversation…')+'<section class="panel"><p>Verifying current case access.</p></section>';
      }
      const c=supportDetail.case,staff=c.isStaff,closed=['Resolved','Closed'].includes(c.status);
      const entries=(supportDetail.events||[]).map(e=>'<article class="panel dossier"><p class="eyeline">'+h(e.type.replaceAll('-',' '))+
        ' · '+h(new Date(e.createdMs).toLocaleString())+'</p><p class="prewrap">'+h(e.text)+'</p>'+
        (e.authorId?'<small class="muted">Sender '+h(e.authorId)+'</small>':'')+'</article>').join('');
      const input=(name,caption)=>'<form class="panel form support-message-form" data-mode="'+name+'" data-id="'+h(c.id)+'">'+
        '<h3>'+h(caption)+'</h3>'+field('message','Message','',{area:true,wide:true,required:true,max:1800})+
        (name==='send'?'<label class="field"><span><input type="checkbox" name="signed"> Sign with my Discord identity</span></label>':'')+
        '<button class="primary">'+h(name==='note'?'Save internal note':name==='send'?'Send DM to member':'Add message')+'</button></form>';
      const actions=staff?'<section class="panel dossier"><h3>Staff case controls</h3><p class="muted">Only staff can close/reopen cases. Internal notes are never sent to members.</p>'+
        '<div class="actions">'+(closed?
          '<button type="button" data-support-action="reopen" data-support-id="'+h(c.id)+'">Reopen</button>':
          ['claim','resolve','close'].map(a=>'<button type="button" data-support-action="'+a+'" data-support-id="'+h(c.id)+'">'+h(a)+'</button>').join(''))+
        (supportData.owner&&!c.sensitive?'<button type="button" data-support-action="sensitive" data-support-id="'+h(c.id)+'">Restrict to Owner</button>':'')+'</div></section>':'';
      return breadcrumbs([link('support','Support Center'),h(c.id)])+
        title('SupportCase · '+c.kind,c.status+' · '+(c.sensitive?'Restricted access':'Private case'))+
        '<section class="panel dossier"><h2>'+h(c.summary)+'</h2><p>Case ID: '+h(c.id)+'</p><p>Assigned staff: '+h(c.assignedId||'Unassigned')+'</p></section>'+
        '<section class="stack"><h2>Conversation and activity</h2>'+entries+'</section>'+actions+
        (!closed?(staff?input('send','Explicit outward staff reply')+input('note','Staff-only note'):input('reply','Reply to staff')):'<section class="panel"><p>This case is closed. Contact support staff to reopen it.</p></section>');
    }
    const stats=supportData.stats,staff=supportData.staff;
    const cases=(supportData.cases||[]).map(c=>'<a class="request-row" href="#support-'+h(c.id)+'"><span class="summary"><b>'+h(c.summary)+'</b>'+
      '<small class="muted">'+h(c.kind)+' · '+h(c.id)+' · '+h(c.assignedId?'Assigned':'Awaiting assignment')+'</small></span>'+
      '<span class="pill">'+h(c.status)+'</span></a>').join('');
    return title('Support Center','Private support cases in one place, including tickets, Modmail, reports and appeals.')+
      (stats?'<section class="panel dossier"><h2>Staff caseload</h2><p>'+h(stats.total)+' total · '+h(stats.open)+' active · '+h(stats.resolved)+' resolved/closed</p></section>':'')+
      '<section class="panel dossier"><h2>Open a support case</h2><p>One generic question or concern. No priority categories or extra forms.</p>'+
      '<form id="support-open-form" class="form"><label class="field"><span>Type</span><select name="kind">'+
      [['ticket','General ticket'],['report','Report'],['appeal','Moderation appeal']].map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+
      '</select></label>'+field('message','How can staff help?','',{area:true,required:true,wide:true,max:1800})+
      '<label class="field"><span><input type="checkbox" name="anonymous"> Anonymous report (does not hide identity from authorized senior staff)</span></label>'+
      '<button class="primary">Create private case</button></form></section>'+
      '<section class="stack"><h2>'+(staff?'Staff case queue':'Your cases')+'</h2>'+(cases||'<p>No cases to display.</p>')+'</section>'+
      '<section class="panel"><p>You can also use /support in Discord, or DM PhoenixCore to start Modmail. Staff replies require an explicit send action; notes remain internal.</p></section>';
  }
  async function giveawayRefresh(){
    if(giveawayLoading||demo||!session)return;
    giveawayLoading=true;
    try{
      giveawayData=await call('/api/giveaways');
      const selected=/^giveaway-([\da-f-]{36})$/i.exec(route());
      giveawayDetail=selected?await call('/api/giveaways/'+selected[1]):null;
      if(selected&&giveawayData.owner){
        const id=selected[1];
        if(giveawayRosterEvent!==id){
          giveawayRosterEvent=id;giveawayRosterPage=1;giveawayRosterFilter='all';
        }
        try{
          giveawayRoster=await call('/api/giveaways/'+id+'/participants?page='+giveawayRosterPage+
            '&filter='+encodeURIComponent(giveawayRosterFilter));
          giveawayRosterError='';
        }catch(error){
          giveawayRoster=null;giveawayRosterError=error.message||'Participant roster could not load.';
        }
      }else{
        giveawayRoster=null;giveawayRosterError='';giveawayRosterEvent='';
      }
      if(route()==='giveaways'||/^giveaway-/.test(route()))render();
    }catch(e){tell(e.message,true);}
    finally{giveawayLoading=false;}
  }
  function giveawayRosterSection(g){
    if(!giveawayData?.owner)return '';
    const roster=giveawayRoster?.giveawayId===g.id?giveawayRoster:null;
    const filters=[['all','All'],['active','Entered'],['withdrawn','Withdrawn']];
    const controls=filters.map(([value,label])=>
      '<button type="button" data-giveaway-roster-filter="'+value+'"'+
      (giveawayRosterFilter===value?' aria-pressed="true"':' aria-pressed="false"')+'>'+label+'</button>').join('');
    const rows=(roster?.participants||[]).map(p=>{
      const name=p.displayName||p.username||'Discord profile unavailable';
      const identity=p.username?'@'+p.username:'Discord ID only';
      const state=p.memberStatus==='left'?'Left the server':p.memberStatus==='unavailable'?'Profile unavailable':'Current member';
      const boost=p.booster===true?' · Server booster':p.booster===false?' · Not boosting':'';
      const ticketCount=roster.hasDrawSnapshot?p.drawTickets:p.currentTickets;
      const ticketText=ticketCount===null?'Tickets unavailable':
        String(ticketCount)+' '+(ticketCount===1?'ticket':'tickets')+(roster.hasDrawSnapshot?' at original draw':' currently eligible');
      const wins=p.wins.length?' · Winner slot '+p.wins.map(w=>w.slot).join(', '):'';
      return '<div class="card person">'+avatar(name,p.userId,p.avatarUrl||'')+
        '<span class="who"><b>'+h(name)+'</b><small class="muted">'+h(identity)+' · '+h(p.userId)+'</small>'+
        '<small>'+h(state+boost+' · '+ticketText+wins)+'</small>'+
        '<small class="subtle">Joined '+h(new Date(p.joinedMs).toLocaleString())+'</small></span>'+
        '<span class="pill">'+(p.active?'Entered':'Withdrawn')+'</span></div>';
    }).join('');
    const paging=roster?'<div class="actions">'+
      '<button type="button" data-giveaway-roster-page="'+(roster.page-1)+'"'+(roster.page<=1?' disabled':'')+'>Previous</button>'+
      '<span>Page '+h(roster.page)+' of '+h(roster.pages)+'</span>'+
      '<button type="button" data-giveaway-roster-page="'+(roster.page+1)+'"'+(roster.page>=roster.pages?' disabled':'')+'>Next</button></div>':'';
    return '<section class="panel dossier"><h3>Participant directory · Owner only</h3>'+
      '<p class="muted">Discord identities are verified against current guild membership. Historical draw tickets come from the saved original drawing; withdrawn members remain in the audit list.</p>'+
      (roster?'<p><b>'+h(roster.active)+'</b> entered · <b>'+h(roster.withdrawn)+'</b> withdrawn · <b>'+h(roster.active+roster.withdrawn)+'</b> total recorded</p>':'')+
      '<div class="actions">'+controls+'</div>'+
      (giveawayRosterError?'<p role="alert">'+h(giveawayRosterError)+'</p>':
        roster?'<div class="stack">'+(rows||'<p>No participants in this view.</p>')+'</div>'+paging:
        '<p>Loading participant identities…</p>')+
      '</section>';
  }
  function giveawayPage(){
    if(demo)return title('Giveaways','Community celebrations, unique drawings and prizes')+
      '<section class="panel"><p>Giveaway creation, entries and claims require a signed-in live account. Practice mode never awards Zeni or draws winners.</p></section>';
    if(!giveawayData){void giveawayRefresh();return title('Giveaways','Convergence giveaway events.')+
      '<section class="panel"><p>Loading current giveaways…</p></section>';}
    const data=giveawayData,match=/^giveaway-([\da-f-]{36})$/i.exec(route()),
      entered=new Set(data.enteredGiveawayIds||[]);
    if(match){
      if(!giveawayDetail||!giveawayDetail.giveaways?.length||giveawayDetail.giveaways[0].id!==match[1]){
        void giveawayRefresh();return title('Giveaway','Loading current draw…')+'<section class="panel"><p>Checking giveaway status.</p></section>';
      }
      const g=giveawayDetail.giveaways[0],mine=(g.winners||[]).find(w=>w.user_id===state.actor.id),
        prize=g.prizeKind==='zeni'?g.zeniAmount+' Zeni deposited to your chosen character bank':g.prizeText,
        active=g.status==='active'&&g.endsMs>Date.now(),staff=data.staff;
      const winners=(g.winners||[]).map(w=>'<div class="stat-row"><span>'+h(w.user_id)+' · Slot '+h(w.slot)+
        ' · '+h(w.status.replaceAll('_',' '))+'</span><span>'+h(w.claimed_ms?'Claimed':'Deadline '+new Date(Number(w.claim_deadline_ms)).toLocaleString())+'</span></div>').join('');
      const controls=active?'<div class="actions"><button type="button" data-giveaway-action="'+(entered.has(g.id)?'withdraw':'join')+
        '" data-giveaway-id="'+h(g.id)+'">'+(entered.has(g.id)?'Withdraw entry':'Enter giveaway')+'</button></div>':'';
      const characters=data.characters||[],claimForm=mine&&mine.status==='awaiting_claim'?
        '<form class="panel form" id="giveaway-claim-form" data-id="'+h(g.id)+'"><h3>Claim your prize</h3>'+
        (g.prizeKind==='zeni'?'<label class="field"><span>Approved winning character</span><select name="characterId" required>'+
          '<option value="">Choose a character</option>'+characters.map(c=>'<option value="'+h(c.id)+'">'+h(c.name)+'</option>').join('')+
          '</select></label>':'<p>Staff will confirm your manual prize after your claim.</p>')+
        '<button class="primary">Claim prize</button></form>':'';
      const staffActions=staff?'<section class="panel dossier"><h3>Staff controls</h3><div class="actions">'+
        (g.status==='active'?'<button type="button" data-giveaway-action="pause" data-giveaway-id="'+h(g.id)+'">Pause</button>'+
          '<button type="button" data-giveaway-action="end" data-giveaway-id="'+h(g.id)+'">End and draw now</button>':'')+
        (g.status==='paused'?'<button type="button" data-giveaway-action="resume" data-giveaway-id="'+h(g.id)+'">Resume</button>':'')+
        (['active','paused','scheduled'].includes(g.status)?'<button type="button" data-giveaway-action="extend" data-giveaway-id="'+h(g.id)+'" data-giveaway-version="'+h(g.version)+'">Extend time</button>':'')+
        (['active','paused','scheduled'].includes(g.status)?'<button type="button" data-giveaway-action="cancel" data-giveaway-id="'+h(g.id)+'">Cancel</button>':'')+
        (g.status==='ended'?'<button type="button" data-giveaway-action="reroll" data-giveaway-id="'+h(g.id)+'">Reroll unclaimed slot</button>':'')+
        (data.owner&&g.status==='ended'?'<button type="button" data-giveaway-action="manual-winner" data-giveaway-id="'+h(g.id)+'">Select manual winner</button>':'')+
        '</div></section>':'';
      const editable=['active','paused','scheduled'].includes(g.status),
        editForm=staff&&editable?
          '<form class="panel form" id="giveaway-edit-form" data-id="'+h(g.id)+'" data-version="'+h(g.version)+'">'+
          '<h3>Edit public giveaway details</h3>'+
          field('title','Giveaway title',g.title,{required:true,max:120})+
          field('description','Description',g.description,{area:true,wide:true,max:1600})+
          '<p class="muted">Prize and drawing rules cannot be changed after creation. Entry deadline changes use Extend time.</p>'+
          '<button class="primary">Save giveaway details</button></form>':'';
      return breadcrumbs([link('giveaways','Giveaways'),h(g.title)])+
        title(g.title,g.status+' · '+g.entries+' entrants · '+g.winnerCount+' winner position(s)')+
        '<section class="panel dossier"><p class="prewrap">'+h(g.description)+'</p><p><b>Prize:</b> '+h(prize)+'</p>'+
        '<p>Entries close <strong>'+h(new Date(g.endsMs).toLocaleString())+'</strong>. Winners have a per-giveaway claim deadline.</p>'+
        '<p class="muted">Boosters receive 3 total draw tickets. Every human can win only once.</p></section>'+
        controls+(winners?'<section class="panel"><h3>Draw results and claims</h3>'+winners+'</section>':'')+
        claimForm+giveawayRosterSection(g)+staffActions+editForm+
        '<section class="panel"><p>Public giveaway messages and entry buttons appear in <a href="https://discord.com/channels/'+h(data.guild||'950522987646418964')+'/'+h(g.channelId)+'">the designated Discord channel</a>.</p></section>';
    }
    const cards=(data.giveaways||[]).map(g=>
      '<a class="request-row" href="#giveaway-'+h(g.id)+'"><span class="summary"><b>'+h(g.title)+'</b>'+
      '<small class="muted">'+h(g.prizeKind==='zeni'?g.zeniAmount+' Zeni bank prize':g.prizeText)+
      ' · '+h(g.entries)+' member(s) entered</small></span><span class="pill">'+h(g.status)+'</span></a>').join('');
    const allowed=data.channels||[];
    const configure=data.owner?'<section class="panel dossier"><h2>Designated giveaway channels</h2>'+
      '<form id="giveaway-channels-form" class="form">'+field('channels','Allowed channel IDs, separated by lines',
        allowed.join('\n'),{wide:true,area:true,max:600,required:false})+
      '<button class="primary">Save allowed channels</button></form></section>':'';
    const creation=data.staff?'<section class="panel dossier"><h2>Staff giveaway creation</h2>'+
      (allowed.length?'<form id="giveaway-create-form" class="form">'+
        field('title','Giveaway title','',{required:true,max:120})+
        field('description','Description','',{area:true,wide:true,max:1100})+
        '<label class="field"><span>Designated destination</span><select name="channelId">'+
        allowed.map(id=>'<option value="'+h(id)+'">'+h(id)+'</option>').join('')+'</select></label>'+
        '<label class="field"><span>Prize type</span><select name="prizeKind"><option value="zeni">Zeni bank prize</option><option value="manual">Manual staff prize</option></select></label>'+
        field('amountOrPrize','Zeni amount or manual prize description','',{required:true,max:240})+
        field('durationMinutes','Entry duration in minutes','60',{required:true,max:7,numeric:true})+
        field('claimMinutes','Claim deadline in minutes (required for each giveaway)','120',{required:true,max:7,numeric:true})+
        field('winnerCount','Unique winners','1',{required:true,max:2,numeric:true})+
        field('startInMinutes','Start delay (minutes, 0 = immediately)','0',{required:true,max:7,numeric:true})+
        field('requiredRoles','Required role IDs (optional)','',{area:true,max:600})+
        field('excludedRoles','Excluded role IDs (optional)','',{area:true,max:600})+
        field('retentionDays','Archive retention in days','7',{required:true,max:3,numeric:true})+
        '<button class="primary">Create giveaway</button></form>':
        '<p>Ask the Owner to designate at least one channel before staff can create giveaways.</p>')+
      '</section>':'';
    return title('Giveaways','One entry per Discord member, fair draws and claim-time rewards.')+
      configure+creation+'<section class="stack"><h2>Giveaway events</h2>'+
      (cards||'<p>No giveaway events have been created yet.</p>')+'</section>';
  }
  async function shopsRefresh(){
    if(shopsLoading||demo||!session)return;
    shopsLoading=true;
    try{
      shopsData=await call('/api/economy/shops');
      if(route()==='shops'||/^shop-[\da-f-]{36}$/.test(route()))render();
    }catch(e){tell(e.message,true);}
    finally{shopsLoading=false;}
  }

  async function shopSalesRefresh(){
    if(shopSalesLoading||demo||!session||!state?.actor.isJudge)return;
    shopSalesLoading=true;
    try{
      shopSalesData=await call('/api/economy/shops/sales');
      if(route()==='shops'||/^shop-[\da-f-]{36}$/.test(route()))render();
    }catch(e){tell(e.message,true);}
    finally{shopSalesLoading=false;}
  }
  const salesStat=(label,value,unit='')=>'<div class="stat-row"><span>'+h(label)+'</span>'+
    '<strong>'+h(num(value||'0'))+(unit?' '+h(unit):'')+'</strong></div>';
  function shopkeeperControls(data,selected='',customName=''){
    const current=String(selected||''),custom=current==='custom';
    const npcs=(data.npcOptions||[]);
    return '<label class="field"><span>Shopkeeper · approved NPC or Custom Entry *</span>'+
      '<select name="shopkeeperChoice" data-shopkeeper-choice required>'+
      '<option value=""'+(!current?' selected':'')+'>Choose a shopkeeper…</option>'+
      npcs.map(n=>'<option value="'+h(n.id)+'"'+(current===n.id?' selected':'')+'>'+h(n.name)+'</option>').join('')+
      '<option value="custom"'+(custom?' selected':'')+'>Custom Entry — enter a new name</option>'+
      '</select><small>NPC choices come from current approved NPC records. A custom name does not create an NPC.</small></label>'+
      '<label class="field" data-shopkeeper-custom'+(custom?'':' hidden')+'><span>Custom shopkeeper name *</span>'+
      '<input name="ownerName" maxlength="100" value="'+h(custom?customName:'')+'"'+(custom?' required':'')+'>'+
      '</label>';
  }
  const shopkeeperSelection=fields=>fields.shopkeeperChoice==='custom'?
    {ownerNpcId:null,ownerName:fields.ownerName,shopkeeperMode:'custom'}:
    {ownerNpcId:fields.shopkeeperChoice};
  function shopPage(){
    if(demo)return title('Shops & Inventory','Staff-approved merchandise and character-owned possessions')+
      '<section class="panel">Live shops and purchases require Discord sign-in. Practice mode never spends Zeni.</section>';
    if(!shopsData){void shopsRefresh();return title('Shops & Inventory','Loading shops and merchandise…');}
    const data=shopsData,shopMatch=/^shop-([\da-f-]{36})$/.exec(route()),
      itemMap=new Map(data.items.map(item=>[item.id,item]));
    if(data.staff&&!shopSalesData&&!shopSalesLoading)void shopSalesRefresh();
    const allSales=shopSalesData?.overall;
    const saleOverview=data.staff?'<section class="panel dossier"><h2>Sales overview</h2>'+
      (!allSales?'<p>Loading recorded purchases…</p>':
        salesStat('All-time purchases',allSales.all.receipts)+
        salesStat('All-time items sold',allSales.all.units)+
        salesStat('All-time Zeni spent',allSales.all.zeni,'Zeni')+
        salesStat('Zeni spent in the last 30 days',allSales.last30.zeni,'Zeni')+
        salesStat('Cash purchases',allSales.all.cashZeni,'Zeni')+
        salesStat('Bank purchases',allSales.all.bankZeni,'Zeni'))+
      '<p class="muted">Recorded player purchases only. Zeni spent at NPC shops leaves circulation; these figures are not shop-wallet balances.</p>'+
      '</section>':'';
    const money=value=>h(String(value||'0'))+' Zeni';
    const inventoryChars=state.characters.filter(c=>c.ownerId===state.actor.id&&c.sheet.characterType!=='NPC');
    const ownInventory='<section class="panel dossier"><h2>Your character inventory</h2>'+
      '<form id="shop-inventory-form" class="form"><label class="field"><span>Approved character</span><select name="characterId" required>'+
      '<option value="">Choose a character</option>'+inventoryChars.map(c=>'<option value="'+h(c.id)+'">'+h(c.sheet.name)+'</option>').join('')+
      '</select></label><button class="primary">View inventory</button></form>'+
      (inventoryData?'<div class="stack"><h3>Owned items</h3>'+(inventoryData.items.length?
      inventoryData.items.map(x=>'<div class="stat-row"><span>'+h(x.name)+' · '+h(x.kind)+'</span><strong>×'+h(x.quantity)+'</strong></div>').join(''):
      '<p>No purchased items yet.</p>')+'</div>':'')+'</section>';
    if(shopMatch){
      const shop=data.shops.find(s=>s.id===shopMatch[1]);
      if(!shop)return title('Shop not found','The shop may have been removed.');
      const lines=shop.stock.map(stock=>{
        const item=itemMap.get(stock.itemId);
        return item?'<div class="stat-row shop-stock-row"><span><b>'+h(item.name)+'</b> · '+h(item.kind)+
          '<small class="muted">'+h(item.description)+'</small></span>'+
          '<span>'+money(stock.price)+' · '+h(stock.remaining===null?'Unlimited':stock.remaining+' available')+'</span>'+
          (data.staff?'<button type="button" data-shop-action="unlist" data-shop-id="'+h(shop.id)+'"'+
            ' data-shop-revision="'+h(shop.revision)+'" data-shop-item="'+h(item.id)+'">Remove from shop</button>':'')+
          '</div>':'';
      }).join('');
      const admin=data.staff?'<section class="panel dossier"><h2>Staff controls</h2>'+
        '<p>Shop revision '+h(shop.revision)+' · Only approved Helpers or Owner can save changes.</p>'+
        '<div class="actions"><button type="button" data-shop-action="status" data-shop-id="'+h(shop.id)+'" data-shop-revision="'+h(shop.revision)+'" data-shop-open="'+(shop.status!=='open')+'">'+
        (shop.status==='open'?'Close shop':'Open shop')+'</button></div>'+
        '<form id="shop-keeper-form" class="form" data-id="'+h(shop.id)+'" data-revision="'+h(shop.revision)+'">'+
        '<h3>Shopkeeper</h3>'+
        shopkeeperControls(data,shop.ownerNpcId&&(data.npcOptions||[]).some(n=>n.id===shop.ownerNpcId)?
          shop.ownerNpcId:'custom',shop.ownerNpcId?'':shop.ownerName)+
        (shop.ownerNpcId&&!shop.npcAvailable?'<p class="muted">Previously linked NPC is unavailable. Select a current NPC or Custom Entry.</p>':'')+
        '<button class="primary">Save shopkeeper</button></form>'+
        '<form id="shop-stock-form" class="form" data-id="'+h(shop.id)+'" data-revision="'+h(shop.revision)+'">'+
        '<h3>Add stock or update price</h3><label class="field"><span>Registered item</span><select name="itemId" required>'+
        data.items.map(item=>'<option value="'+h(item.id)+'">'+h(item.name)+'</option>').join('')+'</select></label>'+
        field('price','Price per item (Zeni)','100',{required:true,max:60,numeric:true})+
        field('remaining','Stock quantity (blank = unlimited)','',{max:10,numeric:true})+
        '<button class="primary">Save item stock</button></form>'+
        (shop.kind==='location'?'<form id="shop-locations-form" class="form" data-id="'+h(shop.id)+'" data-revision="'+h(shop.revision)+'">'+
          field('channels','Allowed Discord RP channel IDs (one per line)',shop.channels.join('\n'),{area:true,wide:true,max:1100})+
          '<button class="primary">Save shop locations</button></form>':'')+
        '</section>':'';
      const sales=shopSalesData?.shops.find(x=>x.id===shop.id);
      const saleDetail=data.staff?'<section class="panel dossier"><h2>Shop sales report</h2>'+
        (!sales?'<p>Loading shop receipts…</p>':
          salesStat('All-time transactions',sales.all.receipts)+
          salesStat('Units sold',sales.all.units)+
          salesStat('All-time Zeni spent',sales.all.zeni,'Zeni')+
          salesStat('Last 7 days',sales.last7.zeni,'Zeni')+
          salesStat('Last 30 days',sales.last30.zeni,'Zeni')+
          '<h3>Most purchased items</h3>'+
          (sales.topItems.length?sales.topItems.map(item=>salesStat(item.name,item.units,'units')).join(''):
            '<p>No sales recorded for this shop yet.</p>')+
          '<h3>Recent purchases</h3>'+
          (shopSalesData.recent.filter(x=>x.shopId===shop.id).slice(0,8)
            .map(x=>'<div class="stat-row"><span>'+h(x.itemName)+' · '+h(new Date(x.createdMs).toLocaleString())+
              '</span><strong>'+h(num(x.totalZeni))+' Zeni</strong></div>').join('')||
            '<p>No recent receipts.</p>'))+
        '</section>':'';
      return breadcrumbs([link('shops','Shops & Inventory'),h(shop.name)])+title(shop.name,shop.description)+
        '<section class="panel dossier"><p><b>'+h(shop.status.toUpperCase())+'</b> · '+h(shop.kind==='general'?'Available in eligible RP channels':'Restricted to configured RP locations')+
        ' · Shopkeeper: '+h(shop.ownerName||'Unlisted')+'</p>'+
        (shop.ownerPortrait?artwork(shop.ownerPortrait,shop.ownerName+' shopkeeper portrait'):'')+
        '<p>Purchases must be made through /shop in an eligible in-character Discord RP channel. The dashboard cannot bypass location rules.</p>'+
        (shop.kind==='location'?'<p>Location channel IDs: '+h(shop.channels.join(', ')||'Not configured')+'</p>':'')+
        (lines||'<p>No merchandise listed yet.</p>')+'</section>'+admin+saleDetail+ownInventory;
    }
    const create=data.staff?'<section class="panel dossier"><h2>Staff: create a shop</h2>'+
      '<form id="shop-create-form" class="form">'+field('name','Shop name','',{required:true,max:100})+
      field('description','Description','',{area:true,wide:true,max:1200})+
      shopkeeperControls(data)+
      '<label class="field"><span>Location type</span><select name="kind">'+
      '<option value="general">General Store (all eligible RP channels)</option>'+
      '<option value="location">Restricted shop (specific channels/threads)</option></select></label>'+
      '<button class="primary">Create closed shop</button></form></section>'+
      '<section class="panel dossier"><h2>Staff: define an item</h2><form id="shop-item-form" class="form">'+
      field('name','Item name','',{required:true,max:100})+
      field('description','Item description','',{area:true,wide:true,max:1200})+
      '<label class="field"><span>Item class</span><select name="kind"><option value="consumable">Consumable or material</option>'+
      '<option value="equipment">Equipment</option></select></label>'+
      field('basePrice','Base Zeni price','100',{required:true,max:60,numeric:true})+
      '<button class="primary">Create staff item definition</button></form></section>':'';
    const cards=data.shops.map(shop=>'<a class="request-row" href="#shop-'+h(shop.id)+'"><span class="summary"><b>'+
      h(shop.name)+'</b><small class="muted">'+h(shop.description||'No shop description')+' · '+
      h(shop.kind==='general'?'General Store access':'Location restricted')+'</small></span>'+
      '<span class="pill">'+h(shop.status)+'</span></a>').join('');
    return title('Shops & Inventory','Browse staff-managed merchandise. Purchases require your character to be present in the appropriate RP channel.')+
      saleOverview+ownInventory+'<section class="stack"><h2>Shops</h2>'+(cards||'<p>No shops configured yet.</p>')+'</section>'+create;
  }
  async function rolePanelRefresh(){
    if(rolePanelLoading||demo||!session)return;
    rolePanelLoading=true;
    try{
      rolePanelData=await call('/api/community/roles');
      if(route()==='roles'||/^roles-[\da-f-]{36}$/.test(route()))render();
    }catch(error){tell(error.message,true);}
    finally{rolePanelLoading=false;}
  }
  function rolePanelPage(){
    if(demo)return title('Role Panels','Discord member self-service roles')+
      '<section class="panel">Practice mode does not assign real Discord roles.</section>';
    if(!rolePanelData){void rolePanelRefresh();return title('Role Panels','Loading configured role panels…');}
    const data=rolePanelData,match=/^roles-([\da-f-]{36})$/.exec(route());
    if(match){
      const panel=data.panels.find(p=>p.id===match[1]);
      if(!panel)return title('Role panel unavailable','This panel is hidden or no longer exists.');
      const options=panel.options.map(o=>'<div class="stat-row role-panel-option"><span><b>'+h(o.label)+'</b>'+
        '<small class="muted">'+h(o.roleId)+' · '+h(o.recordedSelections)+' recorded selections</small></span>'+
        (data.owner?'<button type="button" data-rolepanel-action="remove" data-rolepanel-id="'+h(panel.id)+
          '" data-rolepanel-version="'+h(panel.revision)+'" data-rolepanel-role="'+h(o.roleId)+'">Remove option</button>':'')+
        '</div>').join('');
      const owner=data.owner?'<section class="panel dossier"><h2>Owner controls</h2>'+
        '<p>Revision '+h(panel.revision)+' · The Discord bot must outrank every selectable role. Staff and security permissions are prohibited.</p>'+
        '<div class="actions"><button type="button" data-rolepanel-action="publish" data-rolepanel-id="'+h(panel.id)+
          '" data-rolepanel-version="'+h(panel.revision)+'" data-rolepanel-active="'+(!panel.active)+'">'+
        (panel.active?'Disable role choices':'Publish role choices')+'</button></div>'+
        '<form id="rolepanel-add-form" class="form" data-id="'+h(panel.id)+'" data-revision="'+h(panel.revision)+'">'+
        '<h3>Add a safe Discord role</h3>'+field('roleId','Discord role ID','',{required:true,max:20})+
        field('label','Role label','',{required:true,max:80})+
        '<button class="primary">Add role option</button></form></section>':'';
      return breadcrumbs([link('roles','Role Panels'),h(panel.title)])+
        title(panel.title,panel.description)+
        '<section class="panel dossier"><p><b>'+h(panel.active?'Published':'Draft / inactive')+
        '</b> · '+h(panel.style==='buttons'?'Button panel':'Select-menu panel')+'</p>'+
        '<p>Discord channel: '+h(panel.channelId)+(panel.messageId?' · Message: '+h(panel.messageId):' · Not posted yet')+'</p>'+
        (options||'<p>No role options configured yet.</p>')+'</section>'+owner;
    }
    const cards=data.panels.map(panel=>'<a class="request-row" href="#roles-'+h(panel.id)+'">'+
      '<span class="summary"><b>'+h(panel.title)+'</b><small class="muted">'+
      h(panel.options.length)+' selectable roles · '+h(panel.style)+'</small></span>'+
      '<span class="pill">'+h(panel.active?'Published':'Draft')+'</span></a>').join('');
    const owner=data.owner?'<section class="panel dossier"><h2>Create a role panel</h2>'+
      '<form id="rolepanel-create-form" class="form">'+
      field('title','Panel title','',{required:true,max:120})+
      field('description','Description','',{area:true,wide:true,max:1500})+
      field('channelId','Destination Discord channel ID','',{required:true,max:20})+
      '<label class="field"><span>Selection style</span><select name="style">'+
      '<option value="buttons">Buttons (up to five roles)</option>'+
      '<option value="select">Select menu (up to 25 roles)</option></select></label>'+
      '<button class="primary">Create unpublished panel</button></form></section>':'';
    return title('Role Panels','Select community roles from approved Discord buttons or menus. Only the Owner can configure panels.')+
      (!data.enabled?'<section class="panel"><p>Role panel interactions are disabled by the Owner.</p></section>':'')+
      '<section class="stack"><h2>Configured role panels</h2>'+(cards||'<p>No role panels are published yet.</p>')+'</section>'+owner;
  }
  function render(){
    chrome();const view=$('#view');
    if(!state){view.innerHTML=hero('Player directory','Sign in with your Discord account to view Convergence players and their character sheets.')+'<div class="signin">'+btn('login','Sign in with Discord','primary')+'</div>';return;}
    const r=route();
    if(r==='directory')view.innerHTML=directory();
    else if(r==='npcs')view.innerHTML=npcDirectory();
    else if(r==='community')view.innerHTML=community();
    else if(r==='support'||/^support-[\da-f-]{36}$/i.test(r))view.innerHTML=supportPage();
    else if(r==='giveaways'||/^giveaway-[\da-f-]{36}$/i.test(r))view.innerHTML=giveawayPage();
    else if(r==='shops'||/^shop-[\da-f-]{36}$/i.test(r))view.innerHTML=shopPage();
    else if(r==='roles'||/^roles-[\da-f-]{36}$/i.test(r))view.innerHTML=rolePanelPage();
    else if(r==='requests'||r==='archived')view.innerHTML=requestList(r==='archived');
    else if(r==='settings')view.innerHTML=settings();
    else if(r==='new'||r.startsWith('new-'))view.innerHTML=editor(r==='new'?'create':r.slice(4));
    else if(r==='catalogue'||r.startsWith('design-'))view.innerHTML=catalogue(r==='catalogue'?'':r.slice(7));
    else if(r==='posting'){go('player-'+state.actor.id);return;}
    else if(r.startsWith('player-'))view.innerHTML=player(r.slice(7));
    else if(r.startsWith('sheet-'))view.innerHTML=sheet(r.slice(6));
    else if(r.startsWith('intake-')){
      const [id,selected]=r.slice(7).split('/'),req=state.requests.find(x=>x.id===id);
      view.innerHTML=req?.status==='needs_details'&&req.native?editor(req.kind,selected||req.native.input.characterId||'',req):missing();
    }
    else if(r.startsWith('forms-')){view.innerHTML=editor('edit',r.slice(6));view.querySelector('[data-form-choice]')?.focus();}
    else if(r.startsWith('edit-'))view.innerHTML=editor('edit',r.slice(5));
    else if(r.startsWith('train-'))view.innerHTML=editor('training',r.slice(6));
    else if(r.startsWith('award-'))view.innerHTML=award(r.slice(6));
    else if(r.startsWith('request-'))view.innerHTML=requestView(r.slice(8));
    else view.innerHTML=missing();
    document.querySelectorAll('.embed-form').forEach(previewEmbed);filterPlayers();estimate();tierFeedback();syncEditMode($('#submissionForm'));
  }
  function locationName(id){
    const locs=state.scope?.locations||[],location=locs.find(c=>c.id===id);if(!location)return id;
    const parent=locs.find(c=>c.id===location.parentId);
    const kind=[10,11,12].includes(location.type)?'Thread':location.type===15||location.type===16?'Forum':'Channel';
    return kind+' · '+(parent?parent.name+' › ':'')+location.name+' · '+id;
  }
  function savedDefault(prefs,id){
    const current=prefs.defaults.find(d=>d.channel===id);
    return current?(current.characterId||'account'):'';
  }
  function posting(c){
    const prefs=state.posting;if(!prefs)return '';
    const own=state.characters.filter(c=>c.ownerId===state.actor.id&&c.sheet.characterType!=='NPC');
    const selected=prefs.channels.includes(preferenceChannel)?preferenceChannel:prefs.channels[0];
    return '<section class="panel dossier"><h2>Posting preferences</h2><form class="tag-form actions" data-id="'+h(c.id)+'">'+field('tag',c.sheet.name+'’s tag',c.tag,{max:forms.tagLimit,hint:forms.tagHint})+'<button class="primary">Save tag</button></form>'+
      '<h3>Channel defaults</h3><p>Forum defaults apply to its posts. Choose a thread to set an exception. Start a post with <code>//</code> to speak as yourself.</p>'+
      (prefs.channels.length?'<form id="defaultForm" class="fields"><label class="field">Roleplay channel or thread<select name="channel">'+options(prefs.channels.map(id=>[id,locationName(id)]),selected)+'</select></label><label class="field">Post as<select name="characterId">'+options([['','Inherit parent default'],['account','My Discord account'],...own.map(c=>[c.id,c.sheet.name])],savedDefault(prefs,selected))+'</select></label><button class="primary">Save default</button></form>':'<p>No enabled roleplay channels.</p>')+
      (prefs.defaults.length?'<details><summary>Saved defaults ('+prefs.defaults.length+')</summary><ul>'+prefs.defaults.map(d=>'<li>'+h(locationName(d.channel))+' · '+h(own.find(c=>c.id===d.characterId)?.sheet.name||'My Discord account')+'</li>').join('')+'</ul></details>':'')+'</section>';
  }
  function parseAward(fields){
    const stats=fields.statGains.split(/\r?\n/).filter(v=>v.trim()).map(line=>{
      const match=/^(.+?)\s+\+([1-9]\d{0,59})$/.exec(line.trim());
      if(!match)throw Error('For each stat, use a name, a space and a gain such as Ki Control +2.');
      return {name:match[1],amount:match[2]};
    });
    return {percent:fields.percent.trim(),points:fields.points.trim()||'0',currency:fields.currency.trim(),
      gear:fields.gear.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),stats};
  }
  function estimate(){
    const f=$('#awardForm');if(!f)return;
    const c=state.characters.find(c=>c.id===f.dataset.id);
    try {
      const result=forms.calculateAward(c.sheet,parseAward(Object.fromEntries(new FormData(f))));
      $('#estimate').textContent='Base Power Level · '+num(c.sheet.bpl)+' → '+num(result.next.bpl)+' · Wallet '+num(result.next.wallet)+' '+state.currency;
    } catch(e) {$('#estimate').textContent=e.message;}
  }
  document.addEventListener('error',e=>{
    const preview=e.target.closest?.('[data-media-preview]');
    if(preview)preview.textContent='This link could not display an image. Paste a direct image link or upload the file.';
  },true);
  document.addEventListener('input',e=>{
    if(e.target.form?.matches('.embed-form'))previewEmbed(e.target.form);
    if(e.target.closest('.attained-row'))syncForms(e.target.form);
    if(e.target.name==='lineage')refreshChoices(e.target.form);
    if(e.target.id==='filter')filterPlayers();
    if(e.target.id==='community-search'){
      const word=e.target.value.trim().toLowerCase();
      document.querySelectorAll('.community-tag').forEach(card=>{card.hidden=!card.dataset.communityName.includes(word)&&!card.textContent.toLowerCase().includes(word);});
    }
    if(e.target.form?.id==='submissionForm' && !e.target.matches('[data-media-file]')){recordDraft();tierFeedback();syncEditMode(e.target.form);}
    if(e.target.form?.id==='awardForm')estimate();
  });
  document.addEventListener('change',async e=>{
    if(e.target.matches('[data-community-toggle]')){
      const control=e.target,module=control.dataset.communityToggle;
      try{
        await call('/api/community','POST',{action:'module-set',module,enabled:control.checked});
        communityData=null;await communityRefresh();tell(module+' module updated.');
      }catch(error){control.checked=!control.checked;tell(error.message,true);}
      return;
    }
    if(e.target.matches('[data-lineage]')){
      const f=e.target.form,custom=e.target.value==='__custom',input=f.elements.lineage;
      input.closest('label').hidden=!custom;input.value=custom?'':e.target.value;if(custom)input.focus();
      refreshChoices(f);recordDraft();syncEditMode(f);
    }
    if(e.target.matches('[data-media-file]')){await uploadArt(e.target);return;}
    if(e.target.matches('[data-media-url]'))e.target.closest('.media-picker').querySelector('[data-media-preview]').innerHTML=artwork(e.target.value.trim(),'Selected artwork');
    if(e.target.id==='persona'&&demo){recordDraft();preview.switchRole(e.target.value);tell('');await load();}
    if(e.target.id==='submissionType'){recordDraft();go(e.target.value==='create'?'new':'new-'+e.target.value);}
    if(e.target.id==='submissionCharacter'){
      recordDraft();if(route().startsWith('intake-')){go(route().split('/')[0]+'/'+e.target.value);return;}const kind=$('#submissionType').value;
      go(e.target.value?(kind==='edit'?'edit-':'train-')+e.target.value:'new-'+kind);
    }
    if(e.target.form?.id==='defaultForm'&&e.target.name==='channel'){
      preferenceChannel=e.target.value;
      e.target.form.elements.characterId.value=savedDefault(state.posting,e.target.value);
    }
  });
  window.addEventListener('hashchange',()=>{render();$('#view').focus({preventScroll:true});window.scrollTo(0,0);});
  function refreshReview(){
    if(!demo&&session&&!document.hidden&&/^(request|sheet-)/.test(route())&&!$('#awardForm')&&!document.activeElement?.closest('form'))void load().catch(e=>tell(e.message,true));
  }
  async function refreshScope(){
    if(demo||document.hidden||!session||!$('#live-scope'))return;
    try{
      const current=await call('/api/posting/scope');
      const panel=$('#live-scope');if(!panel)return;
      const open=panel.querySelector('details')?.open;
      state.scope=current;panel.innerHTML=scopePanel(current,state.settings.value.rpDivider);
      if(open&&panel.querySelector('details'))panel.querySelector('details').open=true;
      const select=$('#settingsForm').elements.rpDivider;
      if(document.activeElement!==select)select.innerHTML=dividerOptions(current,select.value);
    }catch{ /* Keep the last confirmed inventory until the next refresh. */ }
  }
  window.setInterval(refreshScope,15000);
  window.addEventListener('focus',refreshReview);
  window.setInterval(refreshReview,30000);
  document.addEventListener('click',async e=>{
    const roleButton=e.target.closest('[data-rolepanel-action]');
    if(roleButton){
      if(!confirm('Apply this role panel change?'))return;
      roleButton.disabled=true;
      try{
        const payload={action:roleButton.dataset.rolepanelAction,
          panelId:roleButton.dataset.rolepanelId,revision:Number(roleButton.dataset.rolepanelVersion)};
        if(payload.action==='publish')payload.active=roleButton.dataset.rolepanelActive==='true';
        if(payload.action==='remove')payload.roleId=roleButton.dataset.rolepanelRole;
        await call('/api/community/roles','POST',payload);
        rolePanelData=null;await rolePanelRefresh();tell('Role panel updated.');
      }catch(error){tell(error.message,true);}
      finally{roleButton.disabled=false;}
      return;
    }
    const shopButton=e.target.closest('[data-shop-action]');
    if(shopButton){
      if(!confirm(shopButton.dataset.shopAction==='unlist'?
        'Remove this item from the shop? Character inventories and purchase history stay intact.':
        'Change this shop open/closed status?'))return;
      shopButton.disabled=true;
      try{
        const params=shopButton.dataset.shopAction==='unlist'?
          {action:'unlist',shopId:shopButton.dataset.shopId,
            revision:Number(shopButton.dataset.shopRevision),itemId:shopButton.dataset.shopItem}:
          {action:'status',shopId:shopButton.dataset.shopId,
            revision:Number(shopButton.dataset.shopRevision),open:shopButton.dataset.shopOpen==='true'};
        await call('/api/economy/shops','POST',params);
        shopsData=null;await shopsRefresh();tell('Shop updated.');
      }catch(error){tell(error.message,true);}
      finally{shopButton.disabled=false;}
      return;
    }
    const rosterFilter=e.target.closest('[data-giveaway-roster-filter]');
    const rosterPage=e.target.closest('[data-giveaway-roster-page]');
    if(rosterFilter||rosterPage){
      if(rosterFilter){
        const filter=rosterFilter.dataset.giveawayRosterFilter;
        if(!['all','active','withdrawn'].includes(filter))return;
        giveawayRosterFilter=filter;giveawayRosterPage=1;
      }else{
        const page=Number(rosterPage.dataset.giveawayRosterPage);
        if(!Number.isSafeInteger(page)||page<1||page>(giveawayRoster?.pages||1))return;
        giveawayRosterPage=page;
      }
      giveawayRoster=null;
      await giveawayRefresh();
      return;
    }
    const give=e.target.closest('[data-giveaway-action]');
    if(give){
      const action=give.dataset.giveawayAction,id=give.dataset.giveawayId;
      const payload={action,id};
      if(action==='extend'){
        const value=prompt('Additional entry time in minutes (1–525600):');
        if(value===null)return;
        const minutes=Number(value);
        if(!Number.isSafeInteger(minutes)||minutes<1||minutes>525600){tell('Enter a whole number of minutes from 1 to 525600.',true);return;}
        payload.minutes=minutes;
        payload.version=Number(give.dataset.giveawayVersion);
      }
      if(action==='reroll'){
        const value=prompt('Which unclaimed winner slot should be rerolled? Enter its number (1–25).');
        if(value===null)return;
        payload.slot=Number(value);
      }
      if(action==='manual-winner'){
        const member=prompt('Discord user ID of the eligible entrant to select MANUALLY (not random):');
        if(member===null)return;
        payload.memberId=member.trim();
      }
      if(['end','cancel','manual-winner'].includes(action)&&!confirm(action==='manual-winner'?
        'Add a visibly MANUAL winner? This is not a random draw.':
        action==='end'?'Close entries and draw the eligible winner(s) now?':
        'Cancel this giveaway? Entries will be closed.'))return;
      give.disabled=true;
      try{
        await call('/api/giveaways','POST',payload);
        giveawayData=null;giveawayDetail=null;
        await giveawayRefresh();tell('Giveaway action recorded.');
      }catch(error){tell(error.message,true);}
      finally{give.disabled=false;}
      return;
    }
    const staffAction=e.target.closest('[data-support-action]');
    if(staffAction){
      const action=staffAction.dataset.supportAction,caseId=staffAction.dataset.supportId;
      if(['close','resolve','sensitive'].includes(action)&&!confirm(action==='sensitive'?
        'Restrict staff visibility to the Owner only?':'Apply '+action+' to this SupportCase?'))return;
      staffAction.disabled=true;
      try{
        await call('/api/support','POST',{action,caseId});
        supportDetail=null;await supportRefresh();tell('SupportCase updated.');
      }catch(error){tell(error.message,true);}
      finally{staffAction.disabled=false;}
      return;
    }
    const communityVote=e.target.closest('[data-community-vote]');
    if(communityVote){
      try{
        await call('/api/community','POST',{action:'suggest-vote',id:communityVote.dataset.suggestionId,choice:Number(communityVote.dataset.communityVote)});
        communityData=null;await communityRefresh();tell('Your vote was saved.');
      }catch(error){tell(error.message,true);}
      return;
    }
    const suggestionAction=e.target.closest('[data-community-suggestion-action]');
    if(suggestionAction){
      try{
        const action=suggestionAction.dataset.communitySuggestionAction,id=suggestionAction.dataset.suggestionId;
        if(!confirm(action==='remove'?'Remove this suggestion from the website and its central Discord channel? The audit record will remain.':'Restore this suggestion and repost it to the central channel?'))return;
        await call('/api/community','POST',{action:action==='remove'?'suggest-remove':'suggest-restore',id});
        communityData=null;await communityRefresh();tell(action==='remove'?'Suggestion removed.':'Suggestion restored.');
      }catch(error){tell(error.message,true);}
      return;
    }
    const communityProposal=e.target.closest('[data-community-proposal]');
    if(communityProposal){
      try{
        const decision=communityProposal.dataset.communityProposal,id=communityProposal.dataset.proposalId;
        if(!confirm((decision==='approve'?'Publish':'Decline')+' this informational tag proposal?'))return;
        await call('/api/community','POST',{action:'tag-review',id,decision});
        communityData=null;await communityRefresh();tell('Tag proposal reviewed.');
      }catch(error){tell(error.message,true);}
      return;
    }
    const move=e.target.closest('[data-move-form]');
    if(move){
      const row=move.closest('.attained-row'),parent=row.parentElement,up=move.dataset.moveForm==='up',sibling=up?row.previousElementSibling:row.nextElementSibling;
      if(sibling){if(up)parent.insertBefore(row,sibling);else parent.insertBefore(sibling,row);syncForms(move.form);recordDraft();syncEditMode(move.form);}
      return;
    }
    const add=e.target.closest('[data-add-form]'),remove=e.target.closest('[data-remove-form]');
    if(add||remove){
      const f=(add||remove).form;
      if(add){
        const select=f.querySelector('[data-form-choice]'),option=select.selectedOptions[0];
        if(!select.value)return;
        const custom=select.value==='custom',id=custom?crypto.randomUUID():select.value;
        if([...f.querySelectorAll('.attained-row')].some(r=>r.dataset.formId===id)){tell('This form is already listed.',true);return;}
        f.querySelector('[data-attained-rows]').insertAdjacentHTML('beforeend',formRow(availableForms(f.elements.lineage?.value).find(item=>item.id===id)||{id,name:custom?'':option.textContent,portrait:''}));
        f.querySelector('.attained-row:last-child [data-form-name]').focus();select.value='';
      }else remove.closest('.attained-row').remove();
      syncForms(f);recordDraft();syncEditMode(f);return;
    }
    const target=e.target.closest('[data-section]');
    if(target){const el=document.getElementById(target.dataset.section);if(el){el.scrollIntoView();el.querySelector('input,textarea,select')?.focus({preventScroll:true});}return;}
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    try{
      if(action.startsWith('review-')&&state.actor.isJudge){
        const id=route().slice(8),choice=action.slice(7);
        let note='';if(choice==='decline'&&!state.actor.isOwner){note=prompt('Reason for Gabe to review (optional)','');if(note===null)return;}
        const result=demo?preview.decision(id,choice==='approve'||choice==='veto',choice,note):await call('/api/requests/'+id+'/decision','POST',{action:choice,note,decisionKey:state.requests.find(r=>r.id===id)?.denial?.key});
        await load();tell(result?.status==='owner_review'?'Denial sent to Gabe for review.':'Decision recorded.');return;
      }
      if(action==='delete-request'&&state.actor.isOwner){
        const id=route().slice(8);if(!confirm('Permanently delete this archived request? Its approved character or design will stay available.'))return;
        if(demo)preview.purge(id);else await call('/api/requests/'+id+'/remove','POST',{});
        await load();go('archived');tell('Archived request deleted.');return;
      }
      if(action==='login'){await login();return;}
      if(action==='bank-statement'){
        const id=route().slice(6),target=$('#statement');if(!target)return;
        const records=demo?[]:(await call('/api/economy/characters/'+id+'/statement')).transactions;
        target.hidden=false;
        target.innerHTML=records.length?'<h4>Recent transactions</h4><div class="stack">'+records.slice(0,25).map(t=>
          '<p class="stat-row"><span>'+h(new Date(t.created).toLocaleString())+' · '+h(t.kind.replaceAll('_',' '))+
          '</span><strong>'+h(num(t.cashAfter))+' cash · '+h(num(t.bankAfter))+' bank</strong></p>').join('')+'</div>':
          '<p>No transactions recorded yet.</p>';
        return;
      }
      if(action==='bank-deposit'||action==='bank-withdraw'){
        const id=route().slice(6),character=state.characters.find(c=>c.id===id);
        if(!character||character.ownerId!==state.actor.id)return;
        const direction=action==='bank-deposit'?'deposit':'withdraw',amount=prompt('How much '+state.currency+' would you like to '+direction+'?');
        if(amount===null)return;
        if(!/^[1-9][0-9]{0,59}$/.test(amount.trim()))throw Error('Enter a positive whole-number amount, without commas.');
        if(demo)preview.bank(id,direction,amount.trim());
        else await call('/api/economy/bank','POST',{id:crypto.randomUUID(),characterId:id,action:direction,amount:amount.trim()});
        await load();tell(direction==='deposit'?'Deposit recorded.':'Withdrawal recorded.');return;
      }
      if(action==='favorite-character'){
        const id=route().slice(6),on=!isFavorite(id);
        if(!state.characters.some(c=>c.id===id))return;
        if(demo)preview.favorite(id,on);else await call('/api/favorites','POST',{characterId:id,favorite:on});
        await load();tell(on?'Character added to favorites.':'Character removed from favorites.');return;
      }
      if(action==='remove-character'&&state.actor.isOwner){
        const c=state.characters.find(c=>c.id===route().slice(6));
        if(!c||!confirm('Remove '+c.sheet.name+' from '+ownerName(c.ownerId)+'’s profile? This closes open requests and clears posting defaults for this character.'))return;
        if(demo)preview.remove(c.id);else await call('/api/characters/'+c.id+'/remove','POST',{version:c.version});
        await load();go('player-'+c.ownerId);tell('Character removed from the profile.');return;
      }
      if(['archive-request','restore-request'].includes(action)&&state.actor.isOwner){
        const id=route().slice(8),archived=action==='archive-request';
        if(demo)preview.archive(id,archived);else await call('/api/requests/'+id+'/archive','POST',{archived});
        await load();go(archived?'archived':'requests');tell(archived?'Request archived.':'Request restored.');return;
      }
      if(action==='logout'){await call('/api/logout','POST',{});store.remove('session');drafts.clear();session='';state=null;communityData=null;supportData=null;supportDetail=null;giveawayData=null;giveawayDetail=null;location.replace(location.pathname+'#directory');location.reload();return;}
      if(demo&&(action==='demo-approve'||action==='demo-decline')){preview.decision(route().slice(8),action==='demo-approve');await load();tell('Practice decision recorded.');}
    }catch(err){tell(err.message,true);}
  });
  function payload(f,fields){
    const kind=f.dataset.kind||'award', data={kind,version:Number(f.dataset.version)};
    const c=state.characters.find(c=>c.id===f.dataset.id);
    if(c)data.characterId=c.id;
    data.reason=fields.reason?.trim()||kindNames[kind]+' submission';
    delete fields.reason;
    if(kind==='award'){data.award=parseAward(fields);return data;}
    if(kind==='edit'||kind==='training'){
      const details=Object.fromEntries(forms.allFields(kind).map(v=>[v.key,fields[v.key]]));
      for(const k of Object.keys(details))delete fields[k];
      if(kind==='training'){data.details=forms.normalize(kind,details);return data;}
      const changed=changesFor(c,fields), changedKeys=Object.keys(changed);
      if(!changedKeys.length)throw Error('Change at least one sheet field.');
      if(changedKeys.length===1&&changedKeys[0]==='tag')data.reason='Updated RP posting tag';
      else data.details=forms.normalize(kind,details);
      data.fields=forms.normalize('create',changed,true);
    }else data.fields=forms.normalize(kind,fields);
    return data;
  }
  document.addEventListener('submit',async e=>{
    const f=e.target;
    if(!['rolepanel-create-form','rolepanel-add-form'].includes(f.id))return;
    e.preventDefault();
    const fields=Object.fromEntries(new FormData(f));
    const button=f.querySelector('button.primary');
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      const payload=f.id==='rolepanel-create-form'?{action:'create',
        channelId:fields.channelId,title:fields.title,description:fields.description,style:fields.style}:
        {action:'add',panelId:f.dataset.id,revision:Number(f.dataset.revision),
          roleId:fields.roleId,label:fields.label};
      const response=await call('/api/community/roles','POST',payload);
      rolePanelData=null;
      if(f.id==='rolepanel-create-form')location.hash='roles-'+response.result.id;
      await rolePanelRefresh();tell('Role panel saved.');
    }catch(error){tell(error.message,true);}
    finally{if(button)button.disabled=false;}
  });
  document.addEventListener('change',e=>{
    const picker=e.target.closest('select[data-shopkeeper-choice]');
    if(!picker)return;
    const wrapper=picker.form?.querySelector('[data-shopkeeper-custom]'),input=wrapper?.querySelector('input');
    if(!wrapper||!input)return;
    const isCustom=picker.value==='custom';
    wrapper.hidden=!isCustom;
    input.required=isCustom;
    if(!isCustom)input.value='';
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;
    if(!['shop-create-form','shop-keeper-form','shop-item-form','shop-stock-form','shop-locations-form','shop-inventory-form'].includes(f.id))return;
    e.preventDefault();
    const fields=Object.fromEntries(new FormData(f));
    const button=f.querySelector('button.primary');if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      if(f.id==='shop-inventory-form'){
        inventoryData=await call('/api/economy/inventory/'+encodeURIComponent(String(fields.characterId||'')));
        render();tell('Inventory loaded.');return;
      }
      let payload;
      if(f.id==='shop-create-form')payload={action:'create-shop',name:fields.name,description:fields.description,
        kind:fields.kind,...shopkeeperSelection(fields)};
      else if(f.id==='shop-keeper-form')payload={action:'shopkeeper',shopId:f.dataset.id,
        revision:Number(f.dataset.revision),...shopkeeperSelection(fields)};
      else if(f.id==='shop-item-form')payload={action:'create-item',name:fields.name,description:fields.description,
        kind:fields.kind,basePrice:fields.basePrice};
      else if(f.id==='shop-stock-form')payload={action:'stock',shopId:f.dataset.id,revision:Number(f.dataset.revision),
        itemId:fields.itemId,price:fields.price,remaining:String(fields.remaining).trim()===''?null:Number(fields.remaining)};
      else payload={action:'locations',shopId:f.dataset.id,revision:Number(f.dataset.revision),
        channels:String(fields.channels||'').split(/[\s,]+/).filter(Boolean)};
      await call('/api/economy/shops','POST',payload);
      shopsData=null;await shopsRefresh();
      tell('Shop configuration saved.');
    }catch(error){tell(error.message,true);}
    finally{if(button)button.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;
    if(!['giveaway-channels-form','giveaway-create-form','giveaway-claim-form','giveaway-edit-form'].includes(f.id))return;
    e.preventDefault();
    if(demo){tell('Practice mode cannot modify real giveaways.');return;}
    const values=Object.fromEntries(new FormData(f));
    let payload;
    if(f.id==='giveaway-channels-form')payload={action:'channels',revision:giveawayData.channelRevision,
      channels:String(values.channels||'').split(/[\s,]+/).map(v=>v.trim()).filter(Boolean)};
    else if(f.id==='giveaway-claim-form')payload={action:'claim',id:f.dataset.id,
      characterId:values.characterId||undefined};
    else if(f.id==='giveaway-edit-form')payload={action:'edit',id:f.dataset.id,
      version:Number(f.dataset.version),title:String(values.title||''),description:String(values.description||'')};
    else {
      if(!f.dataset.receipt)f.dataset.receipt=crypto.randomUUID();
      payload={action:'create',receipt:f.dataset.receipt,
        title:values.title,description:values.description,channelId:values.channelId,
        prizeKind:values.prizeKind,amountOrPrize:values.amountOrPrize,
        durationMinutes:Number(values.durationMinutes),claimMinutes:Number(values.claimMinutes),
        winnerCount:Number(values.winnerCount),startInMinutes:Number(values.startInMinutes),
        retentionDays:Number(values.retentionDays),
        requiredRoles:String(values.requiredRoles||'').split(/[\s,]+/).filter(Boolean),
        excludedRoles:String(values.excludedRoles||'').split(/[\s,]+/).filter(Boolean)};
    }
    const button=f.querySelector('button.primary');
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      const result=await call('/api/giveaways','POST',payload);
      delete f.dataset.receipt;giveawayData=null;giveawayDetail=null;
      if(f.id==='giveaway-create-form'&&result.result?.id)location.hash='giveaway-'+result.result.id;
      await giveawayRefresh();
      tell(f.id==='giveaway-create-form'?'Giveaway created and queued for its designated Discord channel.':
        f.id==='giveaway-claim-form'?'Prize claim recorded.':
        f.id==='giveaway-edit-form'?'Giveaway details updated.':'Giveaway destinations saved.');
    }catch(error){tell(error.message,true);}
    finally{if(button)button.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;
    if(f.id!=='support-open-form'&&!f.classList.contains('support-message-form'))return;
    e.preventDefault();
    if(demo){tell('Practice mode cannot submit private support messages.');return;}
    const button=f.querySelector('button.primary');if(button?.disabled)return;
    const fields=Object.fromEntries(new FormData(f)),receipt=f.dataset.receipt||crypto.randomUUID();
    f.dataset.receipt=receipt;
    const payload=f.id==='support-open-form'?
      {action:'create',kind:fields.kind,message:fields.message,anonymous:fields.anonymous==='on'&&fields.kind==='report',receipt}:
      {action:f.dataset.mode,caseId:f.dataset.id,message:fields.message,signed:fields.signed==='on',receipt};
    if(button)button.disabled=true;
    try{
      const result=await call('/api/support','POST',payload);
      delete f.dataset.receipt;
      supportDetail=null;supportData=null;
      if(f.id==='support-open-form'&&result.result?.id)location.hash='support-'+result.result.id;
      await supportRefresh();tell(f.id==='support-open-form'?'Private SupportCase created.':
        payload.action==='note'?'Private staff note saved; no member DM sent.':
        payload.action==='send'?'Explicit staff reply queued for a DM.':'Message added to the case.');
    }catch(error){tell(error.message,true);}
    finally{if(button)button.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;
    if(!['community-tag-form','community-suggest-form','community-rollback-form'].includes(f.id)&&!f.classList.contains('community-review-form'))return;
    e.preventDefault();
    if(demo){tell('Practice mode cannot publish community content.');return;}
    const fields=Object.fromEntries(new FormData(f));
    const action=f.id==='community-tag-form'?(communityData?.staff?'tag-save':'tag-propose'):
      f.id==='community-suggest-form'?'suggest-create':
      f.id==='community-rollback-form'?'tag-rollback':'suggest-review';
    const payload={action,...fields};
    if(action==='tag-save'||action==='tag-propose')payload.content=fields.content;
    if(action==='suggest-create')payload.anonymous=fields.anonymous==='on';
    if(action==='tag-rollback')payload.revision=Number(fields.revision);
    if(action==='suggest-review')payload.id=f.dataset.id;
    const submit=f.querySelector('button.primary');if(submit?.disabled)return;if(submit)submit.disabled=true;
    try{
      await call('/api/community','POST',payload);
      communityData=null;await communityRefresh();tell('Community changes saved.');
    }catch(error){tell(error.message,true);}
    finally{if(submit)submit.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    const f=e.target;if(!['submissionForm','awardForm','settingsForm','defaultForm','attributionForm'].includes(f.id)&&!f.matches('.tag-form,.race-path-form,.embed-form'))return;
    e.preventDefault();const submit=f.querySelector('button.primary');if(submit.disabled)return;
    const fields=Object.fromEntries(new FormData(f));submit.disabled=true;
    try{
      if(f.matches('.embed-form')){
        const action=e.submitter?.value||'save';
        if(action==='publish'&&!confirm('Publish this embed to Discord channel '+fields.channel+'?'))return;
        if(demo){preview.embed({kind:f.dataset.kind,draft:fields,revision:Number(f.dataset.version)+1});}
        else await call('/api/announcements','POST',{...fields,kind:f.dataset.kind,action,revision:Number(f.dataset.version)});
        await load();tell(demo?'Practice embed saved.':action==='publish'?'Embed published to Discord.':'Embed draft saved.');return;
      }
      if(f.matches('.race-path-form')){
        await call('/api/codex','POST',{key:f.dataset.key,revision:Number(f.dataset.version),fields});await load();tell('Selectable paths updated.');return;
      }
      if(f.id==='settingsForm'){
        const data={value:fields,revision:state.settings.revision};
        if(demo)preview.saveSettings(data);else await call('/api/settings','POST',data);
        await load();tell('Bot settings saved.');return;
      }
      if(f.id==='attributionForm'){
        if(submit.hidden)return;
        if(demo){$('#attribution').textContent='Practice mode has no Discord posts.';return;}
        const result=await call('/api/posting/lookup/'+encodeURIComponent(fields.message.trim()));
        if($('#filter')?.value.trim()!==fields.message.trim())return;
        $('#attribution').innerHTML=h(result.characterName)+' · '+link('player-'+result.authorId,ownerName(result.authorId))+' · '+h(result.authorId);return;
      }
      if(f.id==='defaultForm'||f.classList.contains('tag-form')){
        const data=f.id==='defaultForm'?{kind:'default',...fields}:{kind:'tag',characterId:f.dataset.id,tag:fields.tag};
        if(data.kind==='default'&&data.characterId==='account'){data.characterId='';data.account=true;}
        if(demo)preview.savePosting(data);else await call('/api/posting','POST',data);
        await load();tell('Posting preference saved.');return;
      }
      const data=payload(f,fields);
      if(f.dataset.claim){
        const input={award:data.award,note:data.reason};
        const result=demo?preview.judge(f.dataset.claim,input):await call('/api/requests/'+f.dataset.claim+'/judgment','POST',input);
        await load();tell(result.status==='stale'?'The sheet changed. The player can submit the claim against its current revision.':'Staff judgment recorded for review.');return;
      }
      const snapshot=JSON.stringify(data);
      if(f.dataset.payload!==snapshot){f.dataset.payload=snapshot;f.dataset.key=crypto.randomUUID();}
      data.id=f.dataset.key;
      const result=demo?preview.propose(data):await call(f.dataset.intake?'/api/requests/'+f.dataset.intake+'/complete':'/api/requests','POST',data);
      drafts.delete(draftKey(data.kind,f.dataset.id,f.dataset.version));
      if(data.kind==='edit'&&result.status==='approved'){await load();go('sheet-'+data.characterId);tell('Posting tag saved. You can use it in Discord now.');return;}
      await load();go('request-'+result.id);
      tell(data.kind==='training'?'Training submitted for staff judgment.':demo?'Practice request submitted. Switch to Owner to review.':'Submitted. PhoenixCore will notify the Helpers in Discord.');
    }catch(err){tell(err.message,true);$('#notice').scrollIntoView({block:'nearest'});}
    finally{submit.disabled=false;}
  });
  init().catch(e=>{render();tell(e.message,true);});
})();
