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
  let state=null,session='',loadGeneration=0,preferenceChannel='';
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
          if(/^(directory|npcs|requests|settings|posting|catalogue|new(?:-[a-z]+)?|edit-[\w-]+|train-[\w-]+|design-[\w-]+|player-[\w-]+|sheet-[\w-]+|request-[\w-]+)$/.test(previous)) history.replaceState(null,'','#'+previous);
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
    const tabs=[['directory','Directory'],...(state?[['requests','Requests']]:[]),...(state?.actor.isOwner?[['settings','Bot settings']]:[])];
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
      (own?posting(c):'')+(state.actor.isOwner?'<section class="panel dossier"><h3>Owner controls</h3>'+btn('remove-character','Remove character from profile','danger')+'</section>':'');
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
    const review=state.actor.isJudge&&(pending||waiting||incomplete)?'<div class="actions">'+(pending?btn('review-approve',demo?'Practice approve':'Approve','primary'):'')+btn('review-decline',demo?'Practice decline':'Deny','danger')+'</div>':'';
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
      field('currency','Currency display name',s.currency,{max:32,required:true})+'</div><div class="actions"><button class="primary">Save settings</button></div></form><section id="live-scope" class="panel dossier">'+scopePanel(state.scope,s.rpDivider)+'</section><section class="stack dossier"><h2>Discord embeds</h2>'+embedForm('guidelines')+embedForm('welcome')+'</section>'+
      (state.canEditPaths?'<details class="panel dossier"><summary>Character paths by race</summary>'+currentRaces().map(r=>'<details><summary>'+h(r.name)+'</summary>'+editPaths(r)+'</details>').join('')+'</details>':'');
  }
  function render(){
    chrome();const view=$('#view');
    if(!state){view.innerHTML=hero('Player directory','Sign in with your Discord account to view Convergence players and their character sheets.')+'<div class="signin">'+btn('login','Sign in with Discord','primary')+'</div>';return;}
    const r=route();
    if(r==='directory')view.innerHTML=directory();
    else if(r==='npcs')view.innerHTML=npcDirectory();
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
    if(e.target.form?.id==='submissionForm' && !e.target.matches('[data-media-file]')){recordDraft();tierFeedback();syncEditMode(e.target.form);}
    if(e.target.form?.id==='awardForm')estimate();
  });
  document.addEventListener('change',async e=>{
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
      if(action==='logout'){await call('/api/logout','POST',{});store.remove('session');drafts.clear();session='';state=null;location.replace(location.pathname+'#directory');location.reload();return;}
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
