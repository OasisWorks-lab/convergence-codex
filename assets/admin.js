(()=>{'use strict';
const original=window.CONVERGENCE_DATA;
if(!original){alert('The Codex data file is missing.');return;}
const data=JSON.parse(JSON.stringify(original));
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types=$('entryType'),selectors=$('entrySelectors'),title=$('editTitle'),summary=$('editSummary'),summaryBlock=$('summaryBlock'),editor=$('richEditor'),preview=$('previewContent'),pTitle=$('previewTitle'),feedback=$('feedback'),state=$('saveState');
let current=null,changed=0,dirty=false;
const choices=(id,items,valueFn,labelFn)=>`<label for="${id}">${id==='first'?'Select entry':id==='second'?'Path / section':'Specific message'}</label><select id="${id}">${items.map((v,i)=>`<option value="${i}">${esc(labelFn(v,i))}</option>`).join('')}</select>`;
function viewType(){const k=types.value;
  if(k==='world')return data.worlds;
  if(k==='raceAbout'||k==='form')return data.races;
  if(k==='universal')return data.universal;
  if(k==='system')return data.systems;
  if(k==='chronicle')return data.chronicles;
  return [];
}
const displayName=o=>o.name||o.title||'Untitled';
function setSelectors(stage){const arr=viewType(),k=types.value;
 if(stage===0){selectors.innerHTML=choices('first',arr,null,displayName);$('first').addEventListener('change',()=>setSelectors(1));}
 const a=arr[+$('first').value]||arr[0];
 const messageMode=k==='raceAbout'||k==='universal'||k==='system'||k==='chronicle';
 if(stage<=1){let extra='';
  if(k==='form'){extra=choices('second',a?.paths||[],null,x=>x.name);}
  else if(messageMode){extra=choices('second',a?.[k==='raceAbout'?'about':'messages']||[],null,x=>x.title);}
  selectors.querySelector('#secondWrapper')?.remove();selectors.querySelector('#thirdWrapper')?.remove();
  if(extra){const wrap=document.createElement('div');wrap.id='secondWrapper';wrap.innerHTML=extra;selectors.querySelector('#secondWrapper')?.remove();selectors.appendChild(wrap);$('second').addEventListener('change',()=>setSelectors(2));}
 }
 if(k==='form' && stage<=2){const path=a?.paths?.[+$('second').value];const formMarkup=choices('third',path?.forms||[],null,x=>x.title);
 selectors.querySelector('#thirdWrapper')?.remove();const wrap=document.createElement('div');wrap.id='thirdWrapper';wrap.innerHTML=formMarkup;selectors.appendChild(wrap);$('third').addEventListener('change',loadSelection);
 }
 loadSelection();
}
function resolve(){const k=types.value,a=viewType()[+$('first').value];if(!a)return null;
 let obj=a,sectionName='';
 if(k==='form'){const p=a.paths[+$('second').value];obj=p?.forms?.[+$('third').value];sectionName=`${a.name} / ${p?.name||'Path'}`;}
 if(k==='raceAbout'){obj=a.about[+$('second').value];sectionName=a.name+' / Basic information';}
 if(k==='universal'||k==='system'||k==='chronicle'){obj=a.messages[+$('second').value];sectionName=a.title;}
 return obj?{obj,k,sectionName,parent:a}:null;
}
function loadSelection(){const r=resolve();if(!r)return;
 if(dirty && !confirm('You have unsaved changes to this entry. Discard them?'))return;
 current=r;title.value=r.obj.title||r.obj.name||'';
 const isWorld=r.k==='world',isBasic=r.k==='raceAbout';
 summaryBlock.hidden=!(isWorld||isBasic);
 summary.value=isWorld?(r.obj.excerpt||''):isBasic?(r.parent.description||''):'';
 editor.innerHTML=isWorld?r.obj.messages?.[0]?.html||'':r.obj.html||(r.obj.messages?.[0]?.html||'');
 $('editingLabel').textContent=r.sectionName||displayName(r.obj);
 dirty=false;setState('No changes');updatePreview();
}
function setState(s){state.textContent=s;state.classList.toggle('unsaved',dirty);}
function onChange(){dirty=true;setState('Unsaved edits');updatePreview();}
function updatePreview(){pTitle.textContent=title.value;preview.innerHTML=editor.innerHTML||'<em>This entry has no content.</em>';}
function save(){if(!current)return;
 const {obj,k,parent}=current;
 const value=title.value.trim();if(!value){feedback.textContent='Please enter a title before saving.';return;}
 if(k==='raceAbout'||k==='universal'||k==='system'||k==='chronicle'||k==='form'){obj.title=value;obj.html=editor.innerHTML;}
 if(k==='world'){obj.title=value;obj.excerpt=summary.value;if(!obj.messages?.length)obj.messages=[{title:value,html:''}];obj.messages[0].title=value;obj.messages[0].html=editor.innerHTML;}
 if(k==='raceAbout'){parent.description=summary.value;}
 if(k==='form')obj.excerpt=editor.textContent.slice(0,250);
 const isParentDoc=['system','chronicle','universal'].includes(k);
 if(isParentDoc && +$('second').value===0 && parent.title===current.obj.title) parent.title=value;
 changed++;$('changedCount').textContent=changed;dirty=false;setState('Saved in this session');feedback.textContent='Saved in the editor. Export data.js to prepare your update.';
}
function exportFile(){if(dirty){if(!confirm('This entry has unsaved changes. Save it before exporting?'))return;save();}
 const output='window.CONVERGENCE_DATA = '+JSON.stringify(data)+';\n';
 const blob=new Blob([output],{type:'text/javascript;charset=utf-8'});
 const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download='data.js';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 feedback.textContent='Downloaded data.js. Replace the existing assets/data.js in your GitHub repository and commit it to publish.';
}
types.addEventListener('change',()=>setSelectors(0));
[title,summary,editor].forEach(e=>e.addEventListener('input',onChange));
$('saveEntry').addEventListener('click',save);
$('undoEntry').addEventListener('click',()=>{if(!current)return;if(dirty&&!confirm('Revert all unsaved edits to this entry?'))return;dirty=false;loadSelection();});
$('downloadData').addEventListener('click',exportFile);
$('resetChanges').addEventListener('click',()=>{if(confirm('Discard all saved changes in this editor session?'))location.reload();});
document.querySelectorAll('.format-bar button').forEach(btn=>btn.addEventListener('mousedown',e=>e.preventDefault()));
document.querySelectorAll('.format-bar button').forEach(btn=>btn.addEventListener('click',()=>{editor.focus();document.execCommand(btn.dataset.command,false,btn.dataset.value||undefined);onChange();}));
setSelectors(0);
})();