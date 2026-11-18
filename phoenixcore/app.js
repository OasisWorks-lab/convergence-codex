(() => {
  'use strict';
  const api=String(window.PHOENIXCORE_API||'').replace(/\/$/,'');
  const demo=!api || location.protocol==='file:' || new URLSearchParams(location.search).get('demo')==='1';
  const preview=window.PhoenixPreview;
  const $=selector=>document.querySelector(selector);
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label={name:'Character name',lineage:'Species or lineage',portrait:'Portrait',bio:'Background',bpl:'Base Power Level',strength:'Strength',speed:'Speed',durability:'Durability',intelligence:'Intelligence',control:'Energy control',wallet:'Wallet',gear:'Gear'};
  const traits=['strength','speed','durability','intelligence','control'];
  const formatter=new Intl.NumberFormat('en-US');
  const num=s=>formatter.format(BigInt(s||'0'));
  let state=null,session='',loadGeneration=0;
  const pathKey='pc:'+location.pathname.replace(/index\.html$/,'')+':';
  const store={get:k=>sessionStorage.getItem(pathKey+k),set:(k,v)=>sessionStorage.setItem(pathKey+k,v),remove:k=>sessionStorage.removeItem(pathKey+k)};
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
  function status(s){return '<span class="pill status '+h(s)+'">'+h(s==='awaiting_judge'?'Awaiting judge':s==='stale'?'Outdated':s.charAt(0).toUpperCase()+s.slice(1))+'</span>';}
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
          if(/^(directory|requests|settings|posting|catalogue|new(?:-[a-z]+)?|edit-[\w-]+|train-[\w-]+|design-[\w-]+|player-[\w-]+|sheet-[\w-]+|request-[\w-]+)$/.test(previous)) history.replaceState(null,'','#'+previous);
        } catch(e){tell(e.message,true);}
      } else if(['login-cancelled','member-required'].includes(hash)) {
        history.replaceState(null,'','#directory');tell(hash==='member-required'?'Sign in with an account that belongs to Convergence.':'Sign-in cancelled.',true);
      }
    }
    await load();
  }
  function chrome(){
    const active=route(),nav=$('#nav');
    const tabs=[['directory','Directory'],...(state?[['requests','Requests'],['catalogue','Approved designs'],...((state.actor.isPlayer||state.actor.isJudge)?[['posting','RP posting']]:[])]:[]),...(state?.actor.isOwner?[['settings','Bot settings']]:[])];
    nav.innerHTML=tabs.map(([key,n])=>'<a href="#'+key+'"'+((active===key||(key==='directory'&&/^(player-|sheet-|edit-|new|award-)/.test(active))||(key==='requests'&&active.startsWith('request-'))||(key==='catalogue'&&active.startsWith('design-')))?' aria-current="page"':'')+'>'+n+'</a>').join('');
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
      '<div class="section-head"><h2>Current players</h2><div class="tools"><input id="filter" type="search" aria-label="Search player names" placeholder="Search players…">'+(state.actor.isPlayer?link('new','New Submission','button primary'):'')+'</div></div><div id="players" class="grid"></div>';
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
      '<div class="section-head"><h2>Characters</h2>'+(id===state.actor.id&&state.actor.isPlayer?link('new','New Submission','button primary'):'')+'</div>'+
      (chars.length?'<div class="grid">'+chars.map(c=>'<a class="card char-card" href="#sheet-'+h(c.id)+'"><div class="char-art">'+avatar(c.sheet.name,c.id,c.sheet.portrait)+'</div><div class="card-copy"><h3>'+h(c.sheet.name)+'</h3><p class="muted">'+h(c.sheet.lineage||'Lineage unlisted')+'</p><span class="bpl">'+h(num(c.sheet.bpl))+' BPL</span></div></a>').join('')+'</div>':'<p class="empty">This player has no approved characters yet.</p>');
  }
  function sheet(id){
    const c=state.characters.find(c=>c.id===id);if(!c)return missing();
    const s=c.sheet;document.title=s.name+' · PhoenixCore';
    const own=c.ownerId===state.actor.id;
    return breadcrumbs([link('directory','Directory'),link('player-'+c.ownerId,ownerName(c.ownerId)),h(s.name)])+
      '<div class="sheet-head">'+avatar(s.name,c.id,s.portrait)+'<div><p class="eyeline">Character sheet · Revision '+h(c.version)+'</p><h1>'+h(s.name)+'</h1><p class="muted">'+h(s.lineage||'Lineage unlisted')+'</p><p>RP posting tag · '+(c.tag?'<code>'+h(c.tag)+'&gt;</code>':'Unassigned')+'</p></div></div>'+
      '<div class="section-head"><h2>Approved stats</h2><div class="tools">'+(own?link('edit-'+id,'Propose edit','button primary')+link('train-'+id,'Submit training','button'):'')+(state.actor.isJudge?link('award-'+id,'Judge a reward','button'):'')+'</div></div>'+
      '<div class="two"><div class="stack"><section class="panel"><h3>Base Power Level</h3><div class="big-number">'+h(num(s.bpl))+'</div></section><section class="panel"><h3>Attributes</h3>'+
      traits.map(k=>'<div class="stat-row"><span>'+h(label[k])+'</span><strong>'+h(s[k]||'Unrecorded')+'</strong></div>').join('')+'</section></div>'+
      '<div class="stack"><section class="panel"><h3>Wallet &amp; gear</h3><p><b>'+h(num(s.wallet))+'</b> '+h(state.currency)+'</p><div class="pills">'+(s.gear.length?s.gear.map(g=>'<span class="pill">'+h(g)+'</span>').join(''):'<span class="muted">No gear recorded.</span>')+'</div></section><section class="panel"><h3>Background</h3><p class="prewrap">'+h(s.bio||'No background recorded.')+'</p></section></div></div>'+
      (s.progress?.length?'<section class="panel dossier"><h3>Training stats</h3>'+s.progress.map(x=>'<div class="stat-row"><span>'+h(x.name)+'</span><strong>'+h(num(x.amount))+'</strong></div>').join('')+'</section>':'')+
      '<div class="stack sheet-dossier">'+displayGroups('create',s,['name','lineage','portrait','tag','bio','bpl',...traits])+'</div>';
  }
  const missing=()=>title('Unavailable','This entry is unavailable for your Discord account.')+link('directory','Back to directory','button');
  const forms=window.PhoenixForms;
  const drafts=new Map();
  const kindNames=Object.fromEntries(Object.entries(forms.forms).map(([key,v])=>[key,v.title]));
  const options=(items,value)=>items.map(([key,text])=>'<option value="'+h(key)+'"'+(key===value?' selected':'')+'>'+h(text)+'</option>').join('');
  function draftKey(kind,id,version=0){return [state.actor.id,kind,id||'',version].join('/');}
  function submissionField(f,values,editing=false){
    const val=values[f.key]??(editing?'':f.initial||'');
    const req=f.required && !editing;
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
  function editor(kind='create',id=''){
    if(!state.actor.isPlayer || !Object.hasOwn(forms.forms,kind))return missing();
    const targeted=kind==='edit'||kind==='training', mine=state.characters.filter(c=>c.ownerId===state.actor.id);
    const c=targeted?mine.find(c=>c.id===id):null;
    if(targeted&&id&&!c)return missing();
    const d=drafts.get(draftKey(kind,id,c?.version||0))||{};
    const selector='<div class="submission-tools"><label class="field"><span>Submission type</span><select id="submissionType">'+options(Object.entries(kindNames),kind)+'</select></label>'+
      (targeted?'<label class="field"><span>Character</span><select id="submissionCharacter">'+options([['','Choose your character…'],...mine.map(c=>[c.id,c.sheet.name])],id)+'</select></label>':'')+'</div>';
    const head=title('New Submission','You can switch templates and return to your draft in this tab. Gabe reviews submissions in Discord.')+selector;
    if(targeted&&!c)return head+'<p class="empty">'+(mine.length?'Choose the character this submission belongs to.':'You need an approved character for this request. '+link('new','Submit a new character'))+'</p>';
    const isEdit=kind==='edit';
    const anchors=[...forms.forms[kind].sections.map((s,i)=>[s.title,'section-'+kind+'-'+i]),...(isEdit?forms.forms.create.sections.map((s,i)=>[s.title,'section-create-'+i]):[])];
    const copy=kind==='training'?'Staff assess the scene and proposed gains before Gabe confirms the award.':isEdit?'A posting tag by itself saves immediately. Changing the portrait or any other sheet field sends the whole edit to Gabe.':'Fields marked * are required.';
    const values=isEdit?{...c.sheet,tag:c.tag||'',...d}:d;
    return head+'<div class="submission-layout"><aside class="section-index"><h2>On this form</h2>'+anchors.map(([name,id])=>'<button type="button" data-section="'+id+'">'+h(name)+'</button>').join('')+'</aside>'+
      '<form id="submissionForm" class="form stack" data-kind="'+kind+'" data-id="'+h(id)+'" data-version="'+(c?.version||0)+'"><div><h2>'+h(kindNames[kind])+'</h2><p class="hint">'+h(copy)+'</p></div>'+
      groups(kind,values)+(isEdit?groups('create',values,true):'')+
      '<div class="panel form">'+field('reason',isEdit?'Reason for update':'Note for Gabe',d.reason||'',{area:true,wide:true,max:600,required:isEdit,hint:isEdit?'Explain the RP event, lore change or correction.':'Optional context for the review.'})+
      '<div class="actions"><button class="primary" type="submit">'+(kind==='training'?'Submit training claim':'Send for approval')+'</button>'+link(c?'sheet-'+id:'directory','Cancel','button')+'</div></div></form></div>';
  }
  function changesFor(c,fields){
    const old={...c.sheet,tag:c.tag||''};
    return Object.fromEntries(forms.allFields('create').map(f=>[f.key,(fields[f.key]??'').trim()])
      .filter(([k,v])=>(k==='tag'?v.toLowerCase():v)!==(old[k]??'')));
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
      url.value=result;picker.querySelector('[data-media-preview]').innerHTML=artwork(result,'Selected artwork');
      drafts.set(draftKey(f.dataset.kind,f.dataset.id,f.dataset.version),Object.fromEntries(new FormData(f)));
      status.textContent='Image ready to submit.';
    }catch(error){status.textContent=error.message;}
    finally{input.value='';input.disabled=false;url.readOnly=false;submit.disabled=false;delete f.dataset.uploading;syncEditMode(f);}
  }
  function recordDraft(){
    const f=$('#submissionForm');if(f)drafts.set(draftKey(f.dataset.kind,f.dataset.id,f.dataset.version),Object.fromEntries(new FormData(f)));
  }
  function displayGroups(kind,values,excluded=[]){
    return forms.forms[kind].sections.map(group=>{
      const visible=group.fields.filter(f=>!excluded.includes(f.key)&&values[f.key]);
      return visible.length?'<section class="panel dossier"><h3>'+h(group.title)+'</h3><dl>'+visible.map(f=>'<div><dt>'+h(f.label)+'</dt><dd class="prewrap">'+(f.media?artwork(values[f.key],f.label):h(values[f.key]))+'</dd></div>').join('')+'</dl></section>':'';
    }).join('');
  }
  function catalogue(id){
    const list=state.catalogue||[];
    if(id){
      const entry=list.find(e=>e.id===id);if(!entry)return missing();
      return breadcrumbs([link('catalogue','Approved designs'),h(kindNames[entry.kind])])+title(entry.fields.name,kindNames[entry.kind]+' · Submitted by '+ownerName(entry.authorId))+'<div class="stack">'+displayGroups(entry.kind,entry.fields,['name'])+'</div>';
    }
    return title('Approved designs','Techniques, items, races and transformations approved for Convergence.')+
      (list.length?'<div class="grid">'+list.map(e=>'<a class="card" href="#design-'+h(e.id)+'">'+artwork(e.fields.art,e.fields.name)+'<small class="eyeline">'+h(kindNames[e.kind])+'</small><h3>'+h(e.fields.name)+'</h3><p class="muted">'+h(ownerName(e.authorId))+'</p></a>').join('')+'</div>':'<p class="empty">The first approved design will appear here.</p>');
  }
  function award(id,claim=null){
    const c=state.characters.find(c=>c.id===id);if(!c||!state.actor.isJudge)return missing();
    return (claim?'<div class="section-head"><h2>Assess this claim</h2></div>':breadcrumbs([link('sheet-'+id,c.sheet.name),'Staff judgment'])+title('Judge a reward','Record the award earned by '+c.sheet.name+'. Gabe confirms the calculated change in Discord.'))+
      '<form class="panel form" id="awardForm" data-claim="' + h(claim?.id||'') + '" data-id="'+h(id)+'" data-version="'+c.version+'"><div class="fields">'+
      field('percent','Final BPL gain (%)','0',{max:12,required:true,hint:'Enter the judged percentage with up to two decimals, or use a fixed gain below.'})+
      field('points','Fixed BPL gain','0',{max:60,numeric:true,hint:'Use zero when awarding a percentage.'})+
      field('currency',state.currency+' to award','0',{numeric:true,required:true,max:60,pattern:'0|[1-9][0-9]{0,59}'})+
      field('gear','Gear to award','',{area:true,wide:true,max:2000,hint:'One item per line.'})+
      field('statGains','Other stat gains','',{area:true,wide:true,max:1700,hint:'One per line, e.g. Ki Control +2 or Ability Slots +1.'})+
      field('reason','Judgment and scene reference','',{area:true,wide:true,required:true,max:600})+'</div><p id="estimate" class="bpl" aria-live="polite"></p><button class="primary">Submit award for approval</button></form>';
  }
  function requestList(){
    return title('Requests',state.actor.isOwner?'Review submitted changes and their Discord delivery status.':state.actor.isJudge?'Review training claims and track the awards you submitted.':'Follow your submissions and character awards.')+
      (state.requests.length?'<div class="stack">'+state.requests.map(r=>'<a class="request-row" href="#request-'+h(r.id)+'"><span class="summary"><b>'+h(r.after.name)+'</b><small class="muted">'+h(kindNames[r.kind]||'Staff award')+' · '+h(ownerName(r.authorId))+'</small></span>'+status(r.status)+'<span class="arrow" aria-hidden="true">↗</span></a>').join('')+'</div>':'<p class="empty">No requests yet.</p>');
  }
  function display(v){
    if(Array.isArray(v))return v.map(x=>typeof x==='object'?x.name+' +'+x.amount:x).join(', ')||'—';
    return v===undefined||v===null||v===''?'—':String(v);
  }
  function requestView(id){
    const r=state.requests.find(r=>r.id===id);if(!r)return missing();
    const design=forms.catalogue.includes(r.kind),waiting=r.status==='awaiting_judge',pending=r.status==='pending';
    const captions={...label,progress:'Training stats',...Object.fromEntries(forms.allFields(design?r.kind:'create').map(f=>[f.key,f.label]))};
    const changed=Object.keys(r.after).filter(k=>r.before?JSON.stringify(r.before[k])!==JSON.stringify(r.after[k]):r.after[k]!==''&&(!Array.isArray(r.after[k])||r.after[k].length));
    const meanings={pending:'Awaiting Gabe’s Discord decision.',awaiting_judge:'Staff must assess the training claim before Gabe can approve an award.',stale:'The sheet has a newer revision. Submit against the current sheet.',approved:design?'This design is in the approved collection.':'This change was applied to the character.',declined:'Gabe declined this submission.'};
    const changes=changed.length?'<section class="panel"><h2>Requested changes</h2><div class="diff muted"><b>Field</b><b>Approved</b><b>Proposed</b></div>'+changed.map(k=>'<div class="diff"><span>'+h(captions[k]||k)+'</span><span class="prewrap">'+(k==='portrait'||k==='art'?artwork(r.before?.[k],'Approved artwork')||'—':h(display(r.before?.[k])))+'</span><span class="new prewrap">'+(k==='portrait'||k==='art'?artwork(r.after[k],'Proposed artwork')||'—':h(display(r.after[k])))+'</span></div>').join('')+'</section>':'';
    const judged=r.judgment?'<section class="panel"><h3>Staff judgment</h3><p>'+h(ownerName(r.judgment.judgeId))+'</p><p class="prewrap">'+h(r.judgment.note)+'</p></section>':'';
    const note=r.details?displayGroups(r.kind,r.details):'';
    return breadcrumbs([link('requests','Requests'),h(r.after.name)])+title(r.after.name,(kindNames[r.kind]||'Staff award')+' · Submitted by '+ownerName(r.authorId))+
      '<div class="two"><div class="stack">'+note+judged+changes+'</div><div class="stack"><section class="panel"><h3>Decision</h3>'+status(r.status)+'<p>'+h(meanings[r.status])+'</p>'+
      (state.actor.isOwner&&(pending||waiting)?'<p class="muted">Discord notification · '+h(r.delivery)+'</p>':'')+
      (demo&&state.actor.isOwner&&(pending||waiting)?'<div class="actions">'+(pending?btn('demo-approve','Practice approve','primary'):'')+btn('demo-decline','Practice decline','danger')+'</div>':'')+
      (state.characters.some(c=>c.id===r.characterId)?link('sheet-'+r.characterId,'View approved sheet'):design&&r.status==='approved'?link('design-'+r.id,'View approved design'):'')+
      '</section><section class="panel"><h3>Submission note</h3><p class="prewrap">'+h(r.reason)+'</p>'+
      (r.award?'<p class="bpl">+'+h(num(r.award.gain))+' BPL · +'+h(num(r.award.currency))+' '+h(state.currency)+'</p>':'')+'</section></div></div>'+
      (waiting&&state.actor.isJudge?award(r.characterId,r):'');
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
  function settings(){
    if(!state.actor.isOwner||!state.settings)return missing();
    const s=state.settings.value;
    return title('Bot settings','Only your configured Discord owner account can save these settings.')+'<form id="settingsForm" class="panel form"><div class="fields">'+
      field('playerRole','Player role ID',s.playerRole,{wide:true,max:20,hint:'Leave blank to list every current human member. A role filters the directory, including players with no sheets.'})+
      field('judgeRole','Training judge role ID',s.judgeRole,{wide:true,max:20,hint:'Members with this role can submit awards for your approval.'})+
      field('reviewChannel','Fallback review channel ID',s.reviewChannel,{wide:true,max:20,hint:'PhoenixCore DMs you first. If DMs are blocked, it can mention you here. Choose a private channel.'})+
      '<label class="field wide"><span>Roleplay divider category</span><select name="rpDivider">'+dividerOptions(state.scope,s.rpDivider||'')+'</select><small>Includes channels in categories below this marker and their threads. Discord moves, new channels, and deletions update coverage automatically.</small></label>'+
      field('rpChannels','Roleplay channel IDs',s.rpChannels||'',{area:true,wide:true,max:2200,hint:'Used when no divider is selected. Enter one Discord channel or thread ID per line.'})+
      field('currency','Currency display name',s.currency,{max:32,required:true})+'</div><div class="actions"><button class="primary">Save settings</button></div></form><section id="live-scope" class="panel dossier">'+scopePanel(state.scope,s.rpDivider)+'</section>';
  }
  function render(){
    chrome();const view=$('#view');
    if(!state){view.innerHTML=hero('Player directory','Sign in with your Discord account to view Convergence players and their character sheets.')+'<div class="signin">'+btn('login','Sign in with Discord','primary')+'</div>';return;}
    const r=route();
    if(r==='directory')view.innerHTML=directory();
    else if(r==='requests')view.innerHTML=requestList();
    else if(r==='settings')view.innerHTML=settings();
    else if(r==='new'||r.startsWith('new-'))view.innerHTML=editor(r==='new'?'create':r.slice(4));
    else if(r==='catalogue'||r.startsWith('design-'))view.innerHTML=catalogue(r==='catalogue'?'':r.slice(7));
    else if(r==='posting')view.innerHTML=posting();
    else if(r.startsWith('player-'))view.innerHTML=player(r.slice(7));
    else if(r.startsWith('sheet-'))view.innerHTML=sheet(r.slice(6));
    else if(r.startsWith('edit-'))view.innerHTML=editor('edit',r.slice(5));
    else if(r.startsWith('train-'))view.innerHTML=editor('training',r.slice(6));
    else if(r.startsWith('award-'))view.innerHTML=award(r.slice(6));
    else if(r.startsWith('request-'))view.innerHTML=requestView(r.slice(8));
    else view.innerHTML=missing();
    filterPlayers();estimate();tierFeedback();syncEditMode($('#submissionForm'));
  }
  function posting(){
    if(!state.actor.isPlayer&&!state.actor.isJudge)return missing();
    const own=state.characters.filter(c=>c.ownerId===state.actor.id), prefs=state.posting||{tags:[],defaults:[],channels:[]};
    const choices=own.map(c=>[c.id,c.sheet.name]);
    return title('RP posting','Choose how to speak as your approved characters in Convergence.')+
      '<div class="two"><div class="stack"><section class="panel"><h2>Character tags</h2><p>With the tag <code>rin</code>, type <code>rin&gt; Your move.</code> to speak as Rin.</p>'+
      (own.length?own.map(c=>'<form class="tag-form actions" data-id="'+h(c.id)+'">'+field('tag',c.sheet.name+'’s tag',prefs.tags.find(t=>t.characterId===c.id)?.tag||'',{max:24,hint:'Letters, numbers, hyphens or underscores. Clear to remove.'})+'<button class="primary">Save tag</button></form>').join(''):'<p>'+link('new','Submit your first character')+'</p>')+
      '</section><section class="panel"><h2>Channel defaults</h2><p>A default lets you type <code>Your move.</code> directly. A different character’s tag overrides it for one post. Start a message with <code>//</code> to speak as yourself.</p>'+
      (prefs.channels.length&&own.length?'<form id="defaultForm" class="fields"><label class="field">Roleplay channel<select name="channel">'+options(prefs.channels.map(id=>[id,state.scope?.locations.find(c=>c.id===id)?.name||id]),prefs.channels[0])+'</select></label><label class="field">Post as<select name="characterId">'+options([['','My Discord account'],...choices],prefs.defaults.find(d=>d.channel===prefs.channels[0])?.characterId||'')+'</select></label><button class="primary">Save default</button></form>':'<p class="muted">An approved character and an enabled roleplay channel are needed to set a default.</p>')+
      (prefs.defaults.length?'<ul>'+prefs.defaults.map(d=>'<li>'+h(d.channel)+' · '+h(own.find(c=>c.id===d.characterId)?.sheet.name||'Unavailable character')+'</li>').join('')+'</ul>':'')+
      '</section></div><aside class="panel"><h3>Posting in Discord</h3><p>Character posts use the approved name and portrait. Replies, attachments and out-of-character messages stay in their original Discord format.</p>'+
      (state.actor.isJudge?'<form id="attributionForm" class="form">'+field('message','Look up a character post','',{max:20,required:true,hint:'Copy the Discord message ID to see the credited writer.'})+'<button class="primary">Look up writer</button><p id="attribution" role="status"></p></form>':'')+'</aside></div>';
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
    if(e.target.id==='filter')filterPlayers();
    if(e.target.form?.id==='submissionForm' && !e.target.matches('[data-media-file]')){recordDraft();tierFeedback();syncEditMode(e.target.form);}
    if(e.target.form?.id==='awardForm')estimate();
  });
  document.addEventListener('change',async e=>{
    if(e.target.matches('[data-media-file]')){await uploadArt(e.target);return;}
    if(e.target.matches('[data-media-url]'))e.target.closest('.media-picker').querySelector('[data-media-preview]').innerHTML=artwork(e.target.value.trim(),'Selected artwork');
    if(e.target.id==='persona'&&demo){recordDraft();preview.switchRole(e.target.value);tell('');await load();}
    if(e.target.id==='submissionType'){recordDraft();go(e.target.value==='create'?'new':'new-'+e.target.value);}
    if(e.target.id==='submissionCharacter'){
      recordDraft();const kind=$('#submissionType').value;
      go(e.target.value?(kind==='edit'?'edit-':'train-')+e.target.value:'new-'+kind);
    }
    if(e.target.form?.id==='defaultForm'&&e.target.name==='channel'){
      e.target.form.elements.characterId.value=state.posting.defaults.find(d=>d.channel===e.target.value)?.characterId||'';
    }
  });
  window.addEventListener('hashchange',()=>{render();$('#view').focus({preventScroll:true});window.scrollTo(0,0);});
  function refreshReview(){
    if(!demo&&session&&!document.hidden&&/^(request|sheet-)/.test(route())&&!$('#awardForm'))void load().catch(e=>tell(e.message,true));
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
    const target=e.target.closest('[data-section]');
    if(target){const el=document.getElementById(target.dataset.section);if(el){el.scrollIntoView();el.querySelector('input,textarea,select')?.focus({preventScroll:true});}return;}
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    try{
      if(action==='login'){await login();return;}
      if(action==='logout'){await call('/api/logout','POST',{});store.remove('session');drafts.clear();session='';state=null;go('directory');render();return;}
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
    const f=e.target;if(!['submissionForm','awardForm','settingsForm','defaultForm','attributionForm'].includes(f.id)&&!f.classList.contains('tag-form'))return;
    e.preventDefault();const submit=f.querySelector('button.primary');if(submit.disabled)return;
    const fields=Object.fromEntries(new FormData(f));submit.disabled=true;
    try{
      if(f.id==='settingsForm'){
        const data={value:fields,revision:state.settings.revision};
        if(demo)preview.saveSettings(data);else await call('/api/settings','POST',data);
        await load();tell('Bot settings saved.');return;
      }
      if(f.id==='attributionForm'){
        if(demo){$('#attribution').textContent='Practice mode has no Discord posts.';return;}
        const result=await call('/api/posting/lookup/'+encodeURIComponent(fields.message));
        $('#attribution').textContent=result.characterName+' · '+ownerName(result.authorId)+' · Discord ID '+result.authorId;return;
      }
      if(f.id==='defaultForm'||f.classList.contains('tag-form')){
        const data=f.id==='defaultForm'?{kind:'default',...fields}:{kind:'tag',characterId:f.dataset.id,tag:fields.tag};
        if(demo)preview.savePosting(data);else await call('/api/posting','POST',data);
        await load();tell('Posting preference saved.');return;
      }
      const data=payload(f,fields);
      if(f.dataset.claim){
        const input={award:data.award,note:data.reason};
        const result=demo?preview.judge(f.dataset.claim,input):await call('/api/requests/'+f.dataset.claim+'/judgment','POST',input);
        await load();tell(result.status==='stale'?'The sheet changed. The player can submit the claim against its current revision.':'Staff judgment recorded for Gabe’s review.');return;
      }
      const snapshot=JSON.stringify(data);
      if(f.dataset.payload!==snapshot){f.dataset.payload=snapshot;f.dataset.key=crypto.randomUUID();}
      data.id=f.dataset.key;
      const result=demo?preview.propose(data):await call('/api/requests','POST',data);
      drafts.delete(draftKey(data.kind,f.dataset.id,f.dataset.version));
      if(data.kind==='edit'&&result.status==='approved'){await load();go('sheet-'+data.characterId);tell('Posting tag saved. You can use it in Discord now.');return;}
      await load();go('request-'+result.id);
      tell(data.kind==='training'?'Training submitted for staff judgment.':demo?'Practice request submitted. Switch to Owner to review.':'Submitted. PhoenixCore will notify Gabe in Discord.');
    }catch(err){tell(err.message,true);$('#notice').scrollIntoView({block:'nearest'});}
    finally{submit.disabled=false;}
  });
  init().catch(e=>{render();tell(e.message,true);});
})();
