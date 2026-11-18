(() => {
  'use strict';
  const root=new URL('../',document.currentScript.src);
  const dash=new URL('phoenixcore/',root);
  const api=String(window.PHOENIXCORE_API||'').replace(/\/$/,'');
  const key='pc:'+dash.pathname+':';
  const local=location.protocol==='file:'||new URLSearchParams(location.search).get('demo')==='1';
  const model=window.CodexModel,data=window.CONVERGENCE_DATA;
  let rows=[],authorized=false,editing=false;
  const read=k=>{try{return sessionStorage.getItem(key+k);}catch{return null;}};
  const put=(k,v)=>{try{sessionStorage.setItem(key+k,v);}catch{}};
  const cache='codex.publication.1:'+root.href;
  const page=document.body?.dataset.page||'';
  const pageId=['race','universal'].includes(page)?page+'-'+(document.body.dataset.race||document.body.dataset.universal||document.body.dataset.path||location.pathname.split('/').pop().replace('.html','')):page;
  const copy=new Map();
  function captureCopy(){
    if(!page)return;
    const nodes=document.querySelectorAll('main h1,main h2,main h3,main p,main .eyebrow,main .section-kicker,main .btn-primary,main .btn-secondary,main .text-link,.filter-set button,footer .footer-note,.site-header nav [data-link]');
    nodes.forEach((node,index)=>{
      if(!node.textContent.trim()||node.closest('[id$="List"],[id$="Grid"]'))return;
      const id=(node.id||node.dataset.link||node.tagName.toLowerCase()+'-'+index).toLowerCase();
      const key='pages/'+pageId+'/'+id;
      copy.set(key,{node,original:node.textContent.trim()});
      node.addEventListener('click',event=>{if(editing&&!node.closest('a,button')){event.preventDefault();event.stopImmediatePropagation();window.CodexEditor.open(key);}},true);
    });
  }
  async function request(path,method='GET',body,session=read('session')){
    const headers={};
    if(session)headers.authorization='Bearer '+session;
    const binary=body instanceof Blob;
    if(body)headers['content-type']=binary?body.type:'application/json';
    const response=await fetch(api+path,{method,headers,body:body?(binary?body:JSON.stringify(body)):undefined,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(9000)});
    const result=await response.json();
    if(!response.ok)throw Object.assign(Error(result.error||'PhoenixCore could not complete the request.'),{status:response.status});
    return result;
  }
  captureCopy();
  const ready=(async()=>{
    let saved=[];
    if(!local && api){
      try{const result=await request('/api/codex','GET',undefined,'');saved=result.entries;try{localStorage.setItem(cache,JSON.stringify(saved));}catch{}}
      catch{try{saved=JSON.parse(localStorage.getItem(cache)||'[]');}catch{}}
    }
    rows=Array.isArray(saved)?saved:[];
    model.apply(data,rows);
    for(const [k,{node}] of copy){const edit=data.pages[k.slice(6)];if(edit)node.textContent=edit.text;}
  })();
  function setEditing(on){
    editing=authorized&&on;put('edit-mode',editing?'1':'0');
    document.documentElement.classList.toggle('codex-editing',editing);
    const button=document.getElementById('codexEditToggle');
    if(button){button.textContent=editing?'Exit Edit Mode':'Edit Mode';button.setAttribute('aria-pressed',String(editing));}
  }
  async function access(){
    const header=document.querySelector('.site-header .header-inner');
    if(!header||local||!api)return;
    const session=read('session');
    if(!session){
      if(!page)return;
      if(header.querySelector('.codex-signin'))return;
      const sign=document.createElement('a');sign.href=new URL('#signin',dash).href;sign.className='codex-signin';sign.textContent='Sign in';
      sign.onclick=()=>put('codex-return',location.href);header.append(sign);return;
    }
    try{authorized=!!(await request('/api/codex/access')).canEdit;}
    catch(error){authorized=false;if(error.status===401){try{sessionStorage.removeItem(key+'session');}catch{}return access();}}
    document.querySelector('.codex-signin')?.remove();
    if(!authorized){setEditing(false);document.querySelector('#codexEditorTools')?.remove();return;}
    if(header.querySelector('#codexEditorTools'))return;
    const tools=document.createElement('div');tools.id='codexEditorTools';
    const toggle=document.createElement('button');toggle.type='button';toggle.id='codexEditToggle';toggle.onclick=()=>setEditing(!editing);
    const edit=document.createElement('button');edit.type='button';edit.className='codex-edit-only';edit.textContent='Edit content';edit.onclick=()=>window.CodexEditor.open();
    tools.append(toggle,edit);header.insertBefore(tools,header.querySelector('.mobile-menu'));
    setEditing(read('edit-mode')==='1');
  }
  const live={root,dash,ready,copy,request,access,get entries(){return rows;},get editing(){return editing;},get authorized(){return authorized;},setEditing};
  window.CodexLive=live;
  ready.then(()=>{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',access,{once:true});else access();});
})();
