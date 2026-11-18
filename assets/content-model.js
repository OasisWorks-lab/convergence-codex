(() => {
  'use strict';
  const colors=['background','panel','card','text','muted','accent','secondary','border'];
  const presets=[
    ['Slate',218,12],['Charcoal',225,5],['Silver',218,15,true],['Snow',208,30,true],
    ['Sand',39,40,true],['Cream',51,50,true],['Rose',343,40],['Coral',11,58],
    ['Copper',24,51],['Amber',40,61],['Gold',48,57],['Olive',68,38],
    ['Moss',91,32],['Forest',130,39],['Mint',149,48,true],['Teal',176,49],
    ['Cyan',188,66],['Sky',201,58,true],['Denim',213,47],['Indigo',238,46],
    ['Lavender',261,46,true],['Plum',287,38],['Orchid',306,48],['Berry',329,51]
  ];
  function hex(h,s,l) {
    s/=100;l/=100;
    const channel=n=>{const k=(n+h/30)%12;return Math.round(255*(l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
    return '#'+[0,8,4].map(channel).join('');
  }
  function prepare(data){
    for(const [name,hue,sat,light] of presets){
      const id=name.toLowerCase();
      if(data.themes.some(t=>t.id===id))continue;
      const levels=light?[94,98,90,14,30,27,35,49]:[7,12,18,95,76,74,61,47];
      data.themes.push({id,name,...Object.fromEntries(colors.map((c,i)=>[c,hex(hue,sat*(i===3?.35:1),levels[i])]))});
    }
    for(const world of data.worlds){world.guilds??=[];world.items??=[];}
    data.pages??={};
  }
  const groupFields={
    world:['title','type','excerpt','art','source'], race:['name','description','descriptionHtml','accent','shade','art','source'],
    path:['name','source'], form:['title','html','excerpt','art','url'], message:['title','html','art','url'],
    document:['title','excerpt','art','source'], chronicle:['title','excerpt','art','source','group'],
    guild:['name','summary','headquarters','leadership','membership','lore','art','source','listed'],
    item:['name','summary','appearance','abilities','limitations','lore','art','source','listed'],
    theme:['name',...colors,'available'], default:['theme'], copy:['text'], note:['text']
  };
  const friendly={listed:'Listed at this location',html:'Formatted text',descriptionHtml:'Additional race information',art:'Artwork URL or Codex image path',source:'Source link',url:'Original entry link',type:'Location type',group:'Chronicle category',available:'Available in theme picker',theme:'Default theme',text:'Text'};
  const titles={worlds:'Worlds',races:'Races & Forms',universal:'Universal paths',systems:'Systems',chronicles:'Chronicles',themes:'Themes',pages:'Page text'};
  function records(d){
    const all=new Map();
    const add=(key,kind,obj,caption)=>all.set(key,{key,kind,obj,caption});
    const messages=(key,list,caption)=>list?.forEach((m,i)=>add(key+'/'+(m.codexId||i),'message',m,caption+' / '+(m.title||'Section '+(i+1))));
    for(const w of d.worlds){
      const k='worlds/'+w.slug;add(k,'world',w,w.title);messages(k+'/messages',w.messages,w.title+' / Lore');
      for(const [collection,kind] of [['guilds','guild'],['items','item']])for(const entry of w[collection]||[])add(k+'/'+collection+'/'+entry.id,kind,entry,w.title+' / '+entry.name);
    }
    for(const r of d.races){
      const k='races/'+r.slug;add(k,'race',r,r.name);messages(k+'/about',r.about,r.name+' / About');
      (r.sparkingNotes||[]).forEach((s,i)=>add(k+'/sparkingNotes/'+i,'note',{text:s},r.name+' / Sparking note '+(i+1)));
      r.paths.forEach((p,i)=>{const pk=k+'/paths/'+i;add(pk,'path',p,r.name+' / '+p.name);
        messages(pk+'/notes',p.notes,r.name+' / '+p.name+' / Notes');
        p.forms.forEach((f,j)=>add(pk+'/forms/'+j,'form',f,r.name+' / '+p.name+' / '+f.title));});
    }
    for(const group of ['universal','systems','chronicles'])for(const doc of d[group]){
      const k=group+'/'+doc.slug;add(k,group==='chronicles'?'chronicle':'document',doc,doc.title);messages(k+'/messages',doc.messages,doc.title);
    }
    for(const theme of d.themes)add('themes/'+theme.id,'theme',theme,theme.name);
    add('settings/default','default',{theme:d.defaultTheme},'Default theme');
    for(const [key,value] of Object.entries(d.pages||{}))add('pages/'+key,'copy',value,key);
    return all;
  }
  function extraKind(d,key){
    const parts=key.split('/');
    if(parts.length===4 && parts[0]==='worlds' && d.worlds.some(w=>w.slug===parts[1]) && /^[0-9a-f-]{36}$/.test(parts[3]))return {guilds:'guild',items:'item',messages:'message'}[parts[2]];
    if(/^themes\/[a-z0-9-]{1,40}$/.test(key))return 'theme';
    if(/^pages\/(?:home|worlds|races|systems|chronicles|race-[a-z0-9-]+|universal-[a-z0-9-]+)\/[a-z0-9-]{1,70}$/.test(key))return 'copy';
  }
  function apply(d,rows){
    prepare(d);
    const known=records(d);
    for(const row of rows){
      const {key,fields}=row, parts=key.split('/');
      if(key==='settings/default'){d.defaultTheme=fields.theme;continue;}
      if(parts[0]==='pages'){d.pages[parts.slice(1).join('/')]=fields;continue;}
      if(parts[2]==='sparkingNotes'){const r=d.races.find(r=>r.slug===parts[1]);if(r)r.sparkingNotes[Number(parts[3])]=fields.text;continue;}
      const existing=known.get(key);
      if(existing){Object.assign(existing.obj,fields);continue;}
      const kind=extraKind(d,key);
      if(kind==='guild'||kind==='item')d.worlds.find(w=>w.slug===parts[1])[parts[2]].push({id:parts[3],...fields});
      if(kind==='message')d.worlds.find(w=>w.slug===parts[1]).messages.push({codexId:parts[3],...fields});
      if(kind==='theme')d.themes.push({id:parts[1],...fields});
    }
  }
  const model={prepare,records,extraKind,apply,colors,groupFields,friendly,titles};
  if(typeof module==='object'&&module.exports)module.exports=model;else window.CodexModel=model;
})();
