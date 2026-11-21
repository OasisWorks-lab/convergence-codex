(async()=>{
await window.CodexLive?.ready;
'use strict';
const D=window.CONVERGENCE_DATA;
if(!D){console.error('Codex source data was not loaded.');return;}
const page=document.body.dataset.page;
const prefix=document.body.dataset.prefix||'';
const byId=id=>document.getElementById(id);
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cut=(s,len=155)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>len?s.slice(0,len).replace(/\s+\S*$/,'')+'…':s;};
const textOnly=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const art=p=>{const path=String(p||'');if(/^https?:\/\//.test(path)||path.startsWith('data:')||path.startsWith('blob:'))return path;
 if(path.startsWith('assets/'))return prefix+path;
 return path;};
const isCustom=p=>/^(https:\/\/|assets\/uploads\/)/i.test(String(p||''));
const entryArt=(p,alt)=>p&&isCustom(p)?`<figure class="entry-visual"><img src="${E(art(p))}" alt="${E(alt||'Entry illustration')}" loading="lazy"></figure>`:'';
const nav=byId('nav');
if (nav && !nav.querySelector('[data-link="phoenixcore"]')) {
  const directoryLink = document.createElement('a');
  directoryLink.href = prefix + 'phoenixcore/index.html';
  directoryLink.dataset.link = 'phoenixcore';
  directoryLink.textContent = 'PhoenixCore';
  nav.appendChild(directoryLink);
}
const menuBtn=byId('menuBtn');
if(menuBtn)menuBtn.addEventListener('click',()=>{const open=nav.classList.toggle('open');menuBtn.setAttribute('aria-expanded',String(open));});
[...document.querySelectorAll('[data-link]')].forEach(a=>a.classList.toggle('active',a.dataset.link===(page==='race'?'races':page)));
const modal=byId('detailModal'),modalTitle=byId('modalTitle'),modalEyebrow=byId('modalEyebrow'),modalBody=byId('modalBody'),modalSource=byId('modalSource');
const searchModal=byId('searchModal');
// Source HTML sometimes contains the same heading both in its message title and first line.
// Preserve all prose and collapse only exact consecutive heading duplicates.
const headingKey=s=>textOnly(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
function sourceHtml(raw,externalTitle='',dropFirst=false){
 const el=document.createElement('div');el.innerHTML=raw||'';
 let head=el.querySelector('h1,h2,h3,h4');
 if(head && (dropFirst || (externalTitle && headingKey(head.textContent)===headingKey(externalTitle)))){
  // Only remove the leading heading, not headings embedded later in the document.
  const prior=head.previousElementSibling;
  if(!prior || (prior.matches('hr') && !prior.previousElementSibling))head.remove();
 }
 let last='';
 Array.from(el.querySelectorAll('h1,h2,h3,h4')).forEach(h=>{
  const key=headingKey(h.textContent);
  if(key && key===last){h.remove();}else{last=key;}
 });
 return el.innerHTML;
}
function rich(messages){
 if(!messages?.length)return '<div class="section-piece"><p class="muted">The available export contains no readable text for this entry. Its original forum post may contain attachments.</p></div>';
 return messages.map((m,i)=>`<article class="section-piece">${messages.length>1?`<h3>${E(m.title)}</h3>`:''}<div class="rich-text">${sourceHtml(m.html||'<p>Source text unavailable.</p>',m.title,messages.length>1)}</div></article>`).join('');
}
function openDetail({title,eyebrow,body,source,hash}){
 modalTitle.textContent=title;
 modalEyebrow.textContent=eyebrow||'ARCHIVED SOURCE';
 modalBody.innerHTML=body;
 modalBody.scrollTop=0;
 modalSource.href=source||'#';
 modalSource.style.display=source?'inline-flex':'none';
 if(!modal.open)modal.showModal();
 if(hash && window.location.hash!==hash)history.replaceState(null,'',hash);
}
byId('closeModal').addEventListener('click',()=>modal.close());
modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
byId('copyModal').addEventListener('click',async e=>{
 const text=window.location.href;
 try{await navigator.clipboard.writeText(text);e.currentTarget.textContent='Copied!';setTimeout(()=>e.currentTarget.textContent='Copy link',1500)}catch(_){const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();e.currentTarget.textContent='Copied!';setTimeout(()=>e.currentTarget.textContent='Copy link',1500)}
});
function worldCard(w){return `<button class="world-card" type="button" data-world="${E(w.slug)}" aria-label="Explore ${E(w.title)}"><div class="world-art"><img src="${E(art(w.art))}" alt="Original illustrative artwork for ${E(w.title)}" loading="lazy"></div><div class="world-info"><span>${E(w.type)} · LORE ARCHIVE</span><h3>${E(w.title)}</h3><p>${E(cut(w.excerpt,220))}</p><div class="card-action">Explore location ↗</div></div></button>`;}
function editButton(key,label,kind=''){
 return '<button type="button" class="atlas-action codex-edit-only" data-codex-edit="'+E(key)+'" data-new-kind="'+E(kind)+'">'+E(label)+'</button>';
}
const atlasHref=segments=>(page==='worlds'?'':prefix+'worlds.html')+'#'+segments.map(encodeURIComponent).join('/');
function atlasRow(href,name,description=''){
 return '<a href="'+E(href)+'"><strong>'+E(name)+'</strong><small>'+E(description)+' ↗</small></a>';
}
function openWorld(route){
 const [slug,section,id]=route.split('/'),w=D.worlds.find(x=>x.slug===slug);if(!w)return;
 const base='worlds/'+slug;
 const heading={lore:'Lore',guilds:'Location Guild(s)',items:'Mystical Items'};
 const top=section?'<div class="atlas-toolbar"><a class="atlas-back" href="'+E(atlasHref(id?[slug,section]:[slug]))+'">← '+E(id?heading[section]:w.title)+'</a></div>':'';
 let title=w.title,body='',source='';
 if(!section){
  body=editButton(base,'Edit location')+'<div class="atlas-links">'+Object.entries(heading).map(([k,n])=>atlasRow(atlasHref([slug,k]),n,k==='lore'?'':String(w[k].filter(e=>e.listed!=='no').length))).join('')+'</div>';
 }else if(section==='lore'){
  title=w.title+' · Lore';source=w.source;
  body=entryArt(w.art,w.title)+'<div class="atlas-lore">'+w.messages.map((m,i)=>editButton(base+'/messages/'+(m.codexId||i),'Edit '+(w.messages.length===1?'lore':'lore section '+(i+1)))+(w.messages.length>1?'<h3>'+E(m.title)+'</h3>':'')+rich([m])).join('')+editButton(base+'/messages/'+crypto.randomUUID(),'Add lore section','message')+'</div>';
 }else if(section==='guilds'||section==='items'){
  title=heading[section]+' · '+w.title;
  const kind=section==='guilds'?'guild':'item',entries=w[section].filter(e=>e.listed!=='no'),key=base+'/'+section;
  if(id){
   const entry=entries.find(x=>x.id===id);
   if(!entry){body='<p>This entry is unavailable.</p>';}
   else {
    title=entry.name;source=entry.source;
    body=editButton(key+'/'+id,'Edit '+kind)+'<article class="atlas-entry">'+(entry.art?'<img alt="" src="'+E(art(entry.art))+'">':'')+
     window.CodexModel.groupFields[kind].filter(k=>!['name','art','source','listed'].includes(k)&&entry[k]).map(k=>'<h3>'+E(k[0].toUpperCase()+k.slice(1))+'</h3><p>'+E(entry[k])+'</p>').join('')+'</article>';
   }
  }else{
   body=editButton(key+'/'+crypto.randomUUID(),'Add '+(kind==='item'?'mystical item':'guild'),kind)+
    (entries.length?'<div class="atlas-links">'+entries.map(e=>atlasRow(atlasHref([slug,section,e.id]),e.name)).join('')+'</div>':'<p class="muted">No '+(kind==='guild'?'guilds':'mystical items')+' have been listed for this location.</p>');
  }
 }else return;
 openDetail({title,eyebrow:'ATLAS / '+w.title,body:top+body,source});
}
function visitWorld(slug){
 if(page==='worlds' && location.hash!=='#'+slug)location.hash=slug;
 else openWorld(slug);
}
function hookWorldCards(container){container.querySelectorAll('[data-world]').forEach(btn=>btn.addEventListener('click',()=>visitWorld(btn.dataset.world)));}
function drawWorlds(filter){const w=filter==='all'?D.worlds:D.worlds.filter(x=>x.type===filter);byId('worldList').innerHTML=w.map(worldCard).join('');byId('worldCount').textContent=w.length+' locations';hookWorldCards(byId('worldList'));}
function raceCard(r){return `<a class="race-card" href="${E(prefix)}races/${E(r.slug)}.html" style="--race-color:${E(r.accent)}"><img src="${E(art(r.art||'assets/art/world-planet-earth.svg'))}" loading="lazy" alt="Illustration for ${E(r.name)}" class="${isCustom(r.art)?'has-custom-art':''}"><div class="race-card-body"><div class="eyebrow">RACIAL FAMILY</div><h3>${E(r.name)}</h3><p>${E(cut(r.description,185))}</p><div class="race-card-footer"><span>${r.paths.length} paths · ${r.formCount} entries</span><strong>Explore lineage ↗</strong></div></div></a>`;}
function docCard(doc,label){const cover=doc.art?`<img class="document-preview-image" src="${E(art(doc.art))}" alt="${E(doc.title)}">`:"";const text=doc.excerpt||doc.messages?.map(m=>textOnly(m.html)).join(' ').slice(0,170)||'';return `<button class="doc-card" type="button" data-doc="${E(doc.slug)}" data-group="${E(label)}">${cover}<span class="eyebrow">${E(label)}</span><h3>${E(doc.title)}</h3><p>${E(cut(text,205))}</p><span class="card-action">Read source entry ↗</span></button>`;}
function attachDocs(container,arr,kind){container.querySelectorAll('button[data-doc]').forEach(btn=>btn.addEventListener('click',()=>{const d=arr.find(x=>x.slug===btn.dataset.doc);if(d)openDetail({title:d.title,eyebrow:kind.toUpperCase(),body:entryArt(d.art,d.title)+rich(d.messages),source:d.source,hash:'#'+d.slug});}));}
if(page==='home'){
 byId('homeWorldCount').textContent=D.worlds.length;
 byId('homeRaceCount').textContent=D.races.length;
 byId('homeFormCount').textContent=D.meta.counts.forms;
 const featured=['Planet Dathomir','Planet Sadala','Planet Earth'];
 const locs=featured.map(t=>D.worlds.find(w=>w.title===t)).filter(Boolean);
 byId('featuredWorlds').innerHTML=locs.map(worldCard).join('');
 hookWorldCards(byId('featuredWorlds'));
}
if(page==='worlds'){
 drawWorlds('all');
 byId('worldFilters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;byId('worldFilters').querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));drawWorlds(b.dataset.filter);});
 const readAtlas=()=>{if(location.hash)openWorld(location.hash.slice(1));else if(modal.open)modal.close();};
 readAtlas();window.addEventListener('hashchange',readAtlas);
 modal.addEventListener('close',()=>{if(location.hash)history.replaceState(null,'',location.pathname+location.search);});
}
function universalCard(u){
 const count=u.messages.filter(m=>textOnly(m.html).length>60).length;
 const synopsis=u.messages.find(m=>textOnly(m.html).length>60);
 const synopsisDiv=document.createElement('div');synopsisDiv.innerHTML=synopsis?.html||'';const firstHeading=synopsisDiv.querySelector('h1,h2,h3,h4');if(firstHeading)firstHeading.remove();
 return `<a class="universal-card" href="${E(prefix)}universal/${E(u.slug)}.html"><div class="universal-card-art"><img loading="lazy" src="${E(art(u.art||'assets/brand.png'))}" alt="Convergence phoenix insignia"></div><div class="universal-card-body"><span class="eyebrow">UNIVERSAL EVOLUTION</span><h3>${E(u.title)}</h3><p>${E(cut(synopsis?textOnly(synopsisDiv.innerHTML):'Archived universal techniques and transformations.',175))}</p><span class="card-action">${count} records · Explore path ↗</span></div></a>`;
}
if(page==='races'){
 byId('universalList').innerHTML=D.universal.map(universalCard).join('');
 byId('universalCount').textContent=D.universal.length+' paths';
 byId('raceList').innerHTML=D.races.map(raceCard).join('');
 byId('raceCount').textContent=D.races.length+' racial families';
}
function formCard(f,index,kind='standard',formId=''){
 const compact=(kind==='compact' || kind==='sparking');
 return `<button class="form-card ${compact?'form-card-compact':''}" type="button" data-form="${E(formId)}" aria-label="Read ${E(f.title)}"><div class="form-card-heading"><strong>${E(cut(f.title,80))}</strong><small>${String(index+1).padStart(2,'0')}</small></div><div class="form-card-image ${isCustom(f.art)?'has-custom-art':''}"><img src="${E(art(f.art))}" loading="lazy" alt="${E(f.title)} artwork"></div><div class="form-card-bottom"><span>Archived record</span><span>View form ↗</span></div></button>`;
}
function attachRaceForms(container,openForm){
 container.querySelectorAll('[data-form]').forEach(b=>b.addEventListener('click',()=>{const [pi,fi]=b.dataset.form.split('-').map(Number);openForm(pi,fi);}));
 container.querySelectorAll('[data-path-notes]').forEach(b=>b.addEventListener('click',()=>{const p=openForm._race.paths[+b.dataset.pathNotes];openDetail({title:p.name+' · supplementary notes',eyebrow:openForm._race.name.toUpperCase()+' / SOURCE REFERENCES',body:rich(p.notes),source:p.source});}));
}
if(page==='race'){
 const r=D.races.find(x=>x.slug===document.body.dataset.race);
 if(r){
  document.documentElement.style.setProperty('--race-color',r.accent);
  document.documentElement.style.setProperty('--race-glow',r.shade+'35');
  const core=r.paths.filter(p=>p.classification==='foundational'),normal=r.paths.filter(p=>p.classification==='normal'),sparking=r.paths.filter(p=>p.classification==='sparking');
  byId('raceHero').innerHTML=`<div class="breadcrumbs"><a href="../index.html">Codex</a><span>/</span><a href="../races.html">Races</a><span>/</span><span>${E(r.name)}</span></div><div class="race-hero-body"><div><div class="eyebrow">RACIAL ARCHIVE / ${E(r.slug.toUpperCase())}</div><h1><em>${E(r.name)}</em></h1><p>${E(cut(r.description,900))}</p><div class="race-hero-tags"><span>${normal.length} standard branches</span><span>${core.reduce((n,p)=>n+p.forms.length,0)} foundational entries</span><span>${sparking.length} SPARKING! branches</span></div></div><img src="${E(art(r.art||'assets/brand.png'))}" alt="Illustration for ${E(r.name)}" class="${isCustom(r.art)?'has-custom-art':''}"></div>`;
  if(r.about?.length){
   const first=r.about[0],others=r.about.slice(1).filter(m=>!/^Quick Trip$/i.test(m.title));
   byId('raceAbout').innerHTML=[{title:'Origins & identity',messages:[first]},{title:'Traits, abilities & starting information',messages:others.length?others:[first]}].map(s=>`<div class="about-card"><h3>${E(s.title)}</h3><div class="rich-text">${s.messages.map(m=>sourceHtml(m.html,m.title)).join('<hr class="subtle-rule">')}</div><button class="expand-btn" type="button" aria-expanded="false">Read complete section ↓</button></div>`).join('')+(r.descriptionHtml?`<div class="about-card expanded"><h3>Additional race information</h3><div class="rich-text">${r.descriptionHtml}</div></div>`:'');
   byId('raceAbout').querySelectorAll('.expand-btn').forEach(btn=>btn.addEventListener('click',()=>{const b=btn.closest('.about-card');const on=b.classList.toggle('expanded');btn.setAttribute('aria-expanded',String(on));btn.textContent=on?'Collapse section ↑':'Read complete section ↓';}));
  }else byId('raceAbout').innerHTML='<p class="muted">No written Basic Information was included in the current export.</p>';
  const openForm=(pi,fi)=>{
   const p=r.paths[pi],f=p?.forms[fi];if(!f)return;
   openDetail({title:f.title,eyebrow:`${r.name.toUpperCase()} / ${p.name.toUpperCase()}`,body:`<div class="soft-note" style="margin:0 0 23px"><span>✧</span><p><strong>Archived entry.</strong> The content below is from the existing Discord documentation, not an approved rework.</p></div><div class="rich-text">${entryArt(f.art,f.title)}${sourceHtml(f.html,f.title)}</div>`,source:f.url||p.source||r.source,hash:`#form-${pi}-${fi}`});
  };openForm._race=r;
  const coreEl=byId('foundationalSection');
  const coreCards=core.flatMap(p=>p.forms.map((f,fi)=>({p,f,fi})));
  if(coreCards.length){
   byId('foundationalCount').textContent=coreCards.length+' documented forms';
   byId('foundationalGrid').innerHTML=coreCards.map((x,i)=>formCard(x.f,i,'compact',`${r.paths.indexOf(x.p)}-${x.fi}`)).join('');
  }else coreEl.hidden=true;
  const normSection=byId('normalPathsSection');
  if(normal.length){
   byId('normalPathsCount').textContent=normal.length+' paths';
   byId('pathsGrid').innerHTML=normal.map((p,i)=>`<article class="path-column"><div class="path-column-header"><div class="eyebrow">PATH ${String(i+1).padStart(2,'0')}</div><h3>${E(p.name)}</h3><p>${p.forms.length} documented entries${p.imageOnly?' · image-only source':''}</p></div><div class="path-list">${p.forms.map((f,fi)=>formCard(f,fi,'standard',`${r.paths.indexOf(p)}-${fi}`)).join('')}${p.notes?.length?`<button type="button" class="path-notes-btn" data-path-notes="${r.paths.indexOf(p)}">Read supplementary path notes ↗</button>`:''}</div></article>`).join('');
  }else normSection.hidden=true;
  const spSection=byId('sparkingSection');
  if(sparking.length || r.sparkingNotes?.length){
   byId('sparkingCount').textContent=sparking.length+' identified SPARKING! path'+(sparking.length===1?'':'s');
   const ns=r.sparkingNotes||[];
   byId('sparkingInfo').innerHTML=ns.length?`<div class="sparking-info"><h3>SPARKING! · Basic information</h3>${ns.map(n=>`<p>${E(n)}</p>`).join('')}<small>Source-derived labels; unresolved role/path names remain subject to your review.</small></div>`:`<div class="sparking-info"><h3>SPARKING! · Basic information</h3><p>The current export identifies these as SPARKING! paths. Their complete rules remain in their original form details.</p></div>`;
   byId('sparkingGrid').innerHTML=sparking.map(p=>`<div class="sparking-path"><h3>${E(p.name)}</h3><div class="forms-four-grid">${p.forms.map((f,fi)=>formCard(f,fi,'sparking',`${r.paths.indexOf(p)}-${fi}`)).join('')}</div>${p.notes?.length?`<button type="button" class="path-notes-btn" data-path-notes="${r.paths.indexOf(p)}">Read supplementary path notes ↗</button>`:''}</div>`).join('');
  }else spSection.hidden=true;
  [byId('foundationalGrid'),byId('pathsGrid'),byId('sparkingGrid')].forEach(e=>attachRaceForms(e,openForm));
  const hash=location.hash.match(/^#form-(\d+)-(\d+)$/);if(hash)openForm(+hash[1],+hash[2]);
 }
}
if(page==='systems'){
 byId('systemList').innerHTML=D.systems.map(x=>docCard(x,'CURRENT MECHANICS')).join('');
 attachDocs(byId('systemList'),D.systems,'Core system');
 const id=decodeURIComponent(location.hash.slice(1));const d=D.systems.find(x=>x.slug===id);if(d)openDetail({title:d.title,eyebrow:'ARCHIVED SYSTEM',body:entryArt(d.art,d.title)+rich(d.messages),source:d.source});
}
if(page==='universal'){
 const u=D.universal.find(x=>x.slug===document.body.dataset.universal);
 if(u){
  const formEntries=u.messages.filter(m=>textOnly(m.html).length>60);
  byId('universalHero').innerHTML=`<div class="breadcrumbs"><a href="../index.html">Codex</a><span>/</span><a href="../races.html">Races &amp; Forms</a><span>/</span><span>${E(u.title)}</span></div><div class="universal-hero-inner"><div><div class="eyebrow">UNIVERSAL PATH ARCHIVE</div><h1>${E(u.title)}</h1><p>${u.description?E(textOnly(u.description)):"Universal techniques and forms from the current Convergence documentation. This page preserves their original descriptions without revising the rules."}</p><div class="race-hero-tags"><span>${formEntries.length} source entries</span><span>Not restricted to one racial family in this archive</span></div></div><img src="${E(art(u.art||'assets/brand.png'))}" alt="${E(u.title)} illustration"></div>`;
  byId('universalAbout').innerHTML=`<div class="about-card universal-about"><h3>Basic Path Information</h3><p>This archive currently contains <strong>${formEntries.length} documented entries</strong> in <strong>${E(u.title)}</strong>. Its available posts are organized as individual techniques or transformations.</p><p>No separate overarching Basic Path Information post was provided in the export. The cards below preserve the existing original descriptions and requirements; a dedicated introduction can be authored later.</p>${u.description?`<div class="rich-text">${u.description}</div>`:""}<div class="universal-chips">${formEntries.map(f=>`<span>${E(f.title)}</span>`).join('')}</div></div>`;
  byId('universalForms').innerHTML=formEntries.map((f,i)=>`<button class="form-card form-card-compact universal-form-card" type="button" data-universal-form="${i}"><div class="form-card-heading"><strong>${E(cut(f.title,80))}</strong><small>${String(i+1).padStart(2,'0')}</small></div><div class="form-card-image universal-form-art ${isCustom(f.art)?'has-custom-art':''}"><img src="${E(art(f.art||u.art||'assets/brand.png'))}" loading="lazy" alt="Convergence logo placeholder for ${E(f.title)}"></div><div class="form-card-bottom"><span>Source description</span><span>View form ↗</span></div></button>`).join('');
  const openU=i=>{const f=formEntries[i];if(!f)return;openDetail({title:f.title,eyebrow:`UNIVERSAL PATH / ${u.title.toUpperCase()}`,body:`<div class="soft-note"><span>✧</span><p>Archived source description. Any redesign or power balancing remains pending.</p></div><div class="rich-text">${entryArt(f.art,f.title)}${sourceHtml(f.html,f.title)}</div>`,source:f.url||u.source,hash:'#form-'+i});};
  byId('universalForms').querySelectorAll('[data-universal-form]').forEach(b=>b.addEventListener('click',()=>openU(+b.dataset.universalForm)));
  const hash=location.hash.match(/^#form-(\d+)$/);if(hash)openU(+hash[1]);
 }
}
if(page==='chronicles'){
 function drawChrons(filter){let arr=filter==='all'?D.chronicles:D.chronicles.filter(x=>x.group===filter);byId('chronicleList').innerHTML=arr.map(x=>docCard(x,x.group.toUpperCase())).join('');byId('chronicleCount').textContent=arr.length+' records';attachDocs(byId('chronicleList'),arr,'Chronicle');}
 drawChrons('all');byId('chronicleFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;byId('chronicleFilters').querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));drawChrons(b.dataset.filter);});
 const id=decodeURIComponent(location.hash.slice(1));const d=D.chronicles.find(x=>x.slug===id);if(d)openDetail({title:d.title,eyebrow:d.group.toUpperCase(),body:entryArt(d.art,d.title)+rich(d.messages),source:d.source});
}
// Lightweight client-side search over the bundled archive, including transformation names.
let searchIndex=[];
D.worlds.forEach(w=>searchIndex.push({type:'World',title:w.title,desc:w.excerpt,href:'worlds.html#'+w.slug}));
D.worlds.forEach(w=>['guilds','items'].forEach(k=>w[k].filter(e=>e.listed!=='no').forEach(e=>searchIndex.push({type:k==='guilds'?'Guild':'Mystical Item',title:e.name,desc:w.title+' '+(e.summary||''),href:atlasHref([w.slug,k,e.id]).replace(/^.*#/,'worlds.html#')}))));
D.races.forEach(r=>{searchIndex.push({type:'Race',title:r.name,desc:r.description,href:`races/${r.slug}.html`});r.paths.forEach((p,pi)=>p.forms.forEach((f,fi)=>searchIndex.push({type:r.name+' / '+p.name,title:f.title,desc:textOnly(f.html).slice(0,280),href:`races/${r.slug}.html#form-${pi}-${fi}`})));});
D.systems.forEach(s=>searchIndex.push({type:'System',title:s.title,desc:s.excerpt,href:'systems.html#'+s.slug}));
D.universal.forEach(s=>{searchIndex.push({type:'Universal Path',title:s.title,desc:s.messages.map(m=>textOnly(m.html)).join(' ').slice(0,170),href:'universal/'+s.slug+'.html'});s.messages.filter(m=>textOnly(m.html).length>60).forEach((m,i)=>searchIndex.push({type:s.title,title:m.title,desc:textOnly(m.html).slice(0,230),href:'universal/'+s.slug+'.html#form-'+i}));});
D.chronicles.forEach(s=>searchIndex.push({type:s.group,title:s.title,desc:s.excerpt,href:'chronicles.html#'+s.slug}));
const openSearch=()=>{if(!searchModal.open)searchModal.showModal();byId('searchInput').focus();};
byId('openSearch').addEventListener('click',openSearch);
byId('closeSearch').addEventListener('click',()=>searchModal.close());
searchModal.addEventListener('click',e=>{if(e.target===searchModal)searchModal.close();});
byId('searchInput').addEventListener('input',e=>{
 const q=e.target.value.trim().toLowerCase();const results=byId('searchResults');if(q.length<2){results.innerHTML='<p class="muted">Enter at least two characters to search the archive.</p>';return;}
 let rank=x=>{let t=x.title.toLowerCase(),d=x.desc.toLowerCase();return t===q?0:t.startsWith(q)?1:t.includes(q)?2:x.type.toLowerCase().includes(q)?3:d.includes(q)?4:99;};
 const found=searchIndex.map(x=>({...x,rank:rank(x)})).filter(x=>x.rank!==99).sort((a,b)=>a.rank-b.rank||a.title.localeCompare(b.title)).slice(0,40);
 results.innerHTML=found.length?found.map(x=>`<a class="search-row" href="${E(prefix+x.href)}"><small>${E(x.type)}</small><strong>${E(x.title)}</strong><p>${E(cut(x.desc,150))}</p></a>`).join(''):'<p class="muted">No matching archive entries. Try another term.</p>';
});
document.addEventListener('keydown',e=>{if((e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k')){e.preventDefault();openSearch();}});
})();
