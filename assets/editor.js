(() => {
  'use strict';
  const live=window.CodexLive, model=window.CodexModel, data=window.CONVERGENCE_DATA;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const option=(value,text)=>new Option(text,value);
  const label=(text,input)=>{const l=el('label',text);input.setAttribute('aria-label',text);l.append(input);return l;};
  let dialog,entries,group,entry,inputs,feedback,form,current,original,saving=false;
  const groups={...model.titles,settings:'Site settings'};
  const rootField=key=>key.split('/')[0];
  function registry(){
    const all=model.records(data);
    for(const [k,c] of live.copy)all.set(k,{key:k,kind:'copy',obj:{text:data.pages[k.slice(6)]?.text??c.original},caption:c.original.slice(0,100)});
    return all;
  }
  function field(name,value){
    let node;
    const choices=['available','listed'].includes(name)?['yes','no']:name==='type'?['Planet','Realm','Landmark','Origin']:name==='group'?['In development','Completed','Events']:name==='theme'?data.themes.filter(t=>t.available!=='no').map(t=>t.id):null;
    if(choices){node=el('select');for(const v of choices)node.add(option(v,name==='theme'?data.themes.find(t=>t.id===v).name:v));}
    else if(['playablePaths','html','descriptionHtml','description','summary','excerpt','text','lore','abilities','limitations','membership','appearance'].includes(name)){node=el('textarea');node.rows=['html','descriptionHtml','lore','text'].includes(name)?8:3;}
    else {node=el('input');if(model.colors.includes(name)||name==='shade')node.type='color';}
    node.name=name;node.value=value??(['available','listed'].includes(name)?'yes':'');
    if(name==='art'){
      const wrap=el('div');wrap.append(label(model.friendly.art,node));
      const file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/gif,image/webp';
      file.onchange=async()=>{
        const picked=file.files[0];if(!picked)return;
        if(picked.size>5*1024*1024||!picked.size){feedback.textContent='Choose an image of up to 5 MiB.';return;}
        const selected=current;
        file.disabled=true;form.querySelector('[type="submit"]').disabled=true;feedback.textContent='Uploading artwork…';
        try{const result=await live.request('/api/media','POST',picked);if(current===selected){node.value=result.url;feedback.textContent='Artwork ready to publish.';}}
        catch(error){feedback.textContent=error.message;}
        finally{file.disabled=false;file.value='';form.querySelector('[type="submit"]').disabled=false;}
      };
      wrap.append(label('Upload artwork or GIF',file));return wrap;
    }
    if(name==='html'||name==='descriptionHtml'){const wrap=label(model.friendly[name],node);wrap.append(el('small','Enter paragraphs or use basic HTML for headings, lists and emphasis.'));return wrap;}
    return label(model.friendly[name]||name.charAt(0).toUpperCase()+name.slice(1),node);
  }
  function show(record){
    current=record;inputs.replaceChildren();feedback.textContent='';
    for(const key of model.groupFields[record.kind])inputs.append(field(key,key==='playablePaths'&&record.obj[key]===undefined?(record.obj.paths||[]).map(p=>p.name).join('\n'):record.obj[key]));
    original=Object.fromEntries(new FormData(form));
    if(record.isNew)inputs.querySelector('[name="name"]')?.focus();
  }
  function choose(key){
    const list=[...entries.values()].filter(e=>rootField(e.key)===group.value);
    entry.replaceChildren(...list.map(e=>option(e.key,e.caption)));
    if(key&&entries.has(key))entry.value=key;
    if(entry.value)show(entries.get(entry.value));else {current=null;inputs.replaceChildren();}
  }
  function unsaved(){return !saving&&current&&JSON.stringify(Object.fromEntries(new FormData(form)))!==JSON.stringify(original);}
  function discard(){return !unsaved()||confirm('Discard the unsaved changes to this entry?');}
  function addRecord(key,kind,obj){
    const record={key,kind,obj,caption:obj.name||'New '+kind,isNew:true};
    entries.set(key,record);group.value=rootField(key);choose(key);
  }
  function setup(){
    dialog=el('dialog');dialog.className='codex-editor';dialog.setAttribute('aria-labelledby','codexEditorTitle');
    const head=el('header'),title=el('h2','Edit Codex content');title.id='codexEditorTitle';
    const close=el('button','Close');close.type='button';close.onclick=()=>{if(discard()&&!saving)dialog.close();};head.append(title,close);
    group=el('select');entry=el('select');
    const selectors=el('div');selectors.className='editor-selectors';selectors.append(label('Section',group),label('Entry',entry));
    const add=el('button','Add theme');add.type='button';add.onclick=()=>{if(discard())addRecord('themes/'+crypto.randomUUID(),'theme',{...data.themes[0],name:'New theme',available:'yes'});};
    group.onchange=()=>{if(!discard()){group.value=rootField(current.key);return;}choose();add.hidden=group.value!=='themes';};
    entry.onchange=()=>{if(!discard()){entry.value=current.key;return;}show(entries.get(entry.value));};
    form=el('form');inputs=el('div');inputs.className='editor-fields';feedback=el('p');feedback.setAttribute('role','status');
    const save=el('button','Publish changes');save.type='submit';save.className='editor-publish';form.append(inputs,feedback,save);
    form.onsubmit=async e=>{
      e.preventDefault();if(!current||saving)return;
      const values=Object.fromEntries(new FormData(form));
      const fields=Object.fromEntries(Object.entries(values).filter(([k,v])=>current.isNew||original[k]!==v));
      if(!Object.keys(fields).length){feedback.textContent='No changes to publish.';return;}
      const revision=live.entries.find(r=>r.key===current.key)?.revision||0;
      saving=true;save.disabled=true;feedback.textContent='Publishing…';
      try{await live.request('/api/codex','POST',{key:current.key,revision,fields});original=values;location.reload();}
      catch(err){feedback.textContent=err.message;if(err.status===403){live.setEditing(false);save.disabled=true;}}
      finally{saving=false;save.disabled=!live.editing;}
    };
    dialog.append(head,selectors,add,form);dialog.addEventListener('cancel',e=>{if(saving||!discard())e.preventDefault();});
    dialog.updateAdd=()=>{add.hidden=group.value!=='themes';};document.body.append(dialog);
  }
  function open(key='',newKind=''){
    if(!live.editing)return;
    if(!dialog)setup();form.querySelector('[type="submit"]').disabled=false;entries=registry();
    group.replaceChildren(...Object.entries(groups).filter(([key])=>[...entries.keys()].some(k=>rootField(k)===key)).map(([k,v])=>option(k,v)));
    const page=document.body.dataset.page;
    const fallback=page==='race'?'races/'+document.body.dataset.race:page==='universal'?'universal/'+location.pathname.split('/').pop().replace('.html',''):'';
    const target=key||fallback||(['worlds','races','systems','chronicles'].includes(page)?[...entries.keys()].find(k=>rootField(k)===page):[...live.copy.keys()][0]);
    group.value=target?rootField(target):'themes';
    if(newKind)addRecord(key,newKind,{name:''});else choose(target);
    dialog.updateAdd();if(!dialog.open)dialog.showModal();
  }
  window.CodexEditor={open};
  document.addEventListener('click',e=>{const button=e.target.closest('[data-codex-edit]');if(button)open(button.dataset.codexEdit,button.dataset.newKind||'');});
})();
