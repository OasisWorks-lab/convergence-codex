(()=>{
'use strict';
const D=window.CONVERGENCE_DATA||{};
const fallback=[{id:'phoenix',name:'Phoenix Embers',background:'#0b080f',panel:'#1b101b',card:'#261621',text:'#fff2e2',muted:'#c8abb9',accent:'#ffb76b',secondary:'#db5d35',border:'#ae5f5d'}];
const themes=(Array.isArray(D.themes)&&D.themes.length?D.themes:fallback).filter(t=>t&&/^[a-z0-9-]{1,40}$/.test(t.id));
const get=id=>themes.find(t=>t.id===id);
let preferred=null;
try{preferred=localStorage.getItem('convergence.codex.theme');}catch(_){}
let active=get(preferred)||get(D.defaultTheme)||themes[0];
const validHex=s=>/^#[0-9a-fA-F]{6}$/.test(String(s));
function apply(theme,persist=false){if(!theme)return;active=theme;
  const root=document.documentElement;root.dataset.codexTheme=theme.id;
  const fields=['background','panel','card','text','muted','accent','secondary','border'];
  fields.forEach(f=>root.style.setProperty('--ct-'+f,validHex(theme[f])?theme[f]:fallback[0][f]));
  root.style.setProperty('--bg',root.style.getPropertyValue('--ct-background'));
  root.style.setProperty('--panel',root.style.getPropertyValue('--ct-panel'));
  root.style.setProperty('--panel2',root.style.getPropertyValue('--ct-card'));
  root.style.setProperty('--text',root.style.getPropertyValue('--ct-text'));
  root.style.setProperty('--muted',root.style.getPropertyValue('--ct-muted'));
  root.style.setProperty('--gold',root.style.getPropertyValue('--ct-accent'));
  root.style.setProperty('--line',root.style.getPropertyValue('--ct-border'));
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme.background;
  if(persist)try{localStorage.setItem('convergence.codex.theme',theme.id);}catch(_){}
  document.querySelectorAll('.theme-choice').forEach(b=>{const selected=b.dataset.themeId===theme.id;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  const label=document.getElementById('themeCurrent');if(label)label.textContent=theme.name;
}
apply(active);
function picker(){const header=document.querySelector('.site-header .header-inner');if(!header)return;
 const host=document.createElement('div');host.className='theme-switcher';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='theme-trigger';trigger.setAttribute('aria-label','Choose your Codex theme');trigger.setAttribute('aria-expanded','false');trigger.innerHTML='<span aria-hidden="true">◐</span><span class="theme-trigger-label">Theme</span>';
 const panel=document.createElement('div');panel.className='theme-panel';panel.hidden=true;
 const title=document.createElement('strong');title.textContent='Choose your atmosphere';
 const sub=document.createElement('p');sub.textContent='Saved on this device. Only changes how the Codex looks to you.';
 const list=document.createElement('div');list.className='theme-options';
 for(const t of themes){const btn=document.createElement('button');btn.type='button';btn.className='theme-choice';btn.dataset.themeId=t.id;btn.setAttribute('aria-pressed',String(active.id===t.id));btn.innerHTML='<span class="theme-swatch"></span><span class="theme-name"></span><span class="theme-check" aria-hidden="true">✓</span>';
  btn.querySelector('.theme-swatch').style.background='linear-gradient(135deg,'+(validHex(t.background)?t.background:'#111')+' 50%,'+(validHex(t.accent)?t.accent:'#f97')+' 50%)';
  btn.querySelector('.theme-name').textContent=t.name;
  btn.classList.toggle('selected',t.id===active.id);btn.addEventListener('click',()=>{apply(t,true);panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();});list.appendChild(btn);
 }
 panel.append(title,sub,list);host.append(trigger,panel);
 const mobile=header.querySelector('.mobile-menu');if(mobile)header.insertBefore(host,mobile);else header.appendChild(host);
 trigger.addEventListener('click',()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));});
 document.addEventListener('click',e=>{if(!host.contains(e.target)){panel.hidden=true;trigger.setAttribute('aria-expanded','false');}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',picker);else picker();
window.ConvergenceThemes={get,apply,themes};
})();
