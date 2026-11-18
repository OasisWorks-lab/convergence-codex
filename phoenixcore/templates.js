// Shared by the offline dashboard and the live review service.
(() => {
  'use strict';
  const line = (key, label, options = {}) => ({key, label, max: 240, ...options});
  const prose = (key, label, options = {}) => line(key, label, {area: true, max: 2400, ...options});
  const pick = (key, label, options, extra = {}) => line(key, label, {options, ...extra});
  const section = (title, ...fields) => ({title, fields});
  const required = {required: true};
  const image = (key, label) => line(key, label, {media:true, max:2048});
  const reviewRoutes={characterChannel:'1572638034359226558',designChannel:'1572638183991283904',updatesForum:'1572638583930626250'};
  const tagLimit=64;
  const tagHint='Use your own prefix, such as Rin, [Ash], test- or 🔥. Type the tag before your post. Follow a word with a space or punctuation.';
  const tagKey=value=>value.normalize('NFC').toLowerCase();
  function normalizeTag(raw) {
    if (typeof raw!=='string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(raw)) throw Error('Enter a single-line posting tag.');
    const tag=raw.trim();
    if (tag.length>tagLimit || (tag && !/[\p{L}\p{N}\p{P}\p{S}]/u.test(tag))) throw Error('Use a visible posting tag of up to 64 characters.');
    return tag;
  }
  function readForms(value){
    if(!value)return [];
    let list;
    try{list=JSON.parse(value);}catch{throw Error('Choose the attained forms on the character sheet.');}
    if(!Array.isArray(list)||list.length>40)throw Error('Choose up to 40 attained forms.');
    const ids=new Set(),names=new Set();
    return list.map(f=>{
      if(!f||typeof f.id!=='string'||!/^[a-z0-9_-]{1,90}$/.test(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||f.name.trim().toLowerCase()==='base'||typeof f.portrait!=='string'||f.portrait.length>2048||(f.portrait&&!validImage(f.portrait)))throw Error('Check each form name and portrait.');
      const name=f.name.trim(),key=name.toLowerCase();
      if(ids.has(f.id)||names.has(key))throw Error('Each attained form needs a unique name.');
      ids.add(f.id);names.add(key);
      const form={id:f.id,name,portrait:f.portrait};
      if(f.multiplier){
        if(typeof f.multiplier!=='string'||!validFactor(f.multiplier))throw Error('Enter a positive Power Level multiplier with up to four decimal places.');
        form.multiplier=f.multiplier;
      }
      if(f.modifiers){
        if(typeof f.modifiers!=='object'||Array.isArray(f.modifiers))throw Error('Check the form stat adjustments.');
        const modifiers={};
        for(const [stat,value] of Object.entries(f.modifiers)){
          if(!stats.includes(stat)||typeof value!=='string'||!(/^[+-]\d{1,18}$/.test(value)||(/^x/.test(value)&&validFactor(value.slice(1)))))throw Error('Use a flat stat adjustment such as +2 or a multiplier such as x1.5.');
          modifiers[stat]=value;
        }
        if(Object.keys(modifiers).length)form.modifiers=modifiers;
      }
      return form;
    });
  }
  const validFactor=s=>/^(0|[1-9]\d{0,7})(\.\d{1,4})?$/.test(s)&&/[1-9]/.test(s);
  function effectiveSheet(sheet,form){
    const value={...sheet};
    if(!form)return value;
    function adjusted(base,modifier){
      if(!modifier||!/^\d+$/.test(String(base)))return base;
      if(!modifier.startsWith('x')){const result=BigInt(base)+BigInt(modifier);return String(result<0n?0n:result);}
      const [whole,part='']=modifier.slice(1).split('.');
      return String(BigInt(base)*BigInt(whole+part)/10n**BigInt(part.length));
    }
    if(form.multiplier)value.bpl=adjusted(sheet.bpl,'x'+form.multiplier);
    for(const key of stats)if(form.modifiers?.[key])value[key]=adjusted(sheet[key],form.modifiers[key]);
    return value;
  }
  function validImage(value) {
    if (/^\.\.\/assets\/uploads\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|gif)$/i.test(value) && !value.slice(3).includes('..')) return true;
    try {
      const url=new URL(value);
      const localUpload=url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && /^\/media\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(url.pathname);
      return !url.username && !url.password && (url.protocol==='https:' || localUpload);
    } catch { return false; }
  }
  const stats = ['speed', 'durability', 'intelligence', 'control'];
  const character = [
    section('History',
      line('name','Character name',{max:64,required:true}), line('alias','Alias'),
      line('tag','RP posting tag',{max:tagLimit,hint:tagHint}),
      pick('characterType','Character type',[['OC','Player character (OC)'],['NPC','Non-player character (NPC)']],{initial:'OC'}),
      prose('bio','Lore / backstory',{max:60000,hint:'Up to 60,000 characters. Leave a blank line between paragraphs.'}),
      prose('family','Family in RP',{hint:'Known relatives, living or deceased.'}), prose('enemies','Enemies in RP',{hint:'Rivals, grudges or vendettas.'}),
      line('occupation','Occupation / role')),
    section('Characteristics',
      line('age','Age'),line('gender','Gender'),line('lineage','Race / lineage',{max:80}),
      line('path','Path'),line('className','Class'),line('height','Height'),line('weight','Weight'),
      prose('personality','Personality & mannerisms',{hint:'Speech, behavior, quirks and emotional tone.'}),
      line('alignment','Alignment'),image('portrait','Character portrait'),line('attainedForms','Attained transformations',{max:100000})),
    section('Strengths, weaknesses & equipment',
      prose('strengths','Personal strengths',{required:true,minLines:3,hint:'Enter at least three distinct personal strengths, one per line. Think beyond racial abilities.'}),
      prose('weaknesses','Personal weaknesses',{required:true,minLines:3,hint:'Enter at least three distinct flaws that affect play, one per line.'}),
      prose('techniquesItems','Non-racial techniques / items',{hint:'List custom techniques, weapons, relics or gear in the character concept.'})),
    section('Character sheet',
      line('bpl','Base Power Level',{max:60,whole:true,initial:'0',required:true}),
      ...stats.map((key,index)=>line(key,['Speed','Durability','Intelligence','Energy control'][index],{max:180})))
  ];
  const technique = [
    section('Basic information',line('name','Technique name',{max:100,...required}),
      pick('techType','Technique type',[['ULT','ULT · Ultimate'],['SUP','SUP · Support'],['SPT','SPT · Special'],['STK','STK · Strike']],required),
      prose('appearance','Visual / appearance'),image('art','Technique artwork')),
    section('Details',prose('description','Description',{...required,hint:'Explain what it does and any connection to a racial identity.'}),
      prose('requirements','Requirements',{...required,hint:'Include form thresholds, stat gates, Ki types or transformation dependencies.'}),
      prose('drawbacks','Drawbacks',{...required,hint:'Describe the risks, costs and limits.'}))
  ];
  const item = [
    section('Basic information',line('name','Item name',{max:100,...required}),prose('description','Description',required),prose('lore','Lore'),
      prose('appearance','Appearance'),image('art','Item artwork')),
    section('Mechanics',prose('effects','Effects / abilities',{...required,hint:'Include active abilities, passives, utility and any modes.'}),
      prose('drawbacks','Drawbacks / limitations',required)),
    section('Special details',line('energySource','Energy source'),line('itemType','Item type'),
      line('cooldown','Cooldown / use limit'),prose('companions','Companion systems',{hint:'List required equipment, companions, runes or other systems.'})),
    section('Intelligence tier',line('currentInt','Your current Intelligence',{...required,whole:true,max:6}),
      line('requiredInt','Required Intelligence level',{...required,whole:true,max:6,min:1}),
      prose('designNotes','Designer comments',{hint:'Include inspiration, assistance, mentorship or a plan to split the design.'}))
  ];
  const race = [
    section('Internal information',line('name','Race name',{max:100,...required}),line('bplRolls','BPL rolls',{...required,hint:'Describe the dice and range for starting Base Power Level.'}),
      line('homeworld','Homeworld / primary location'),line('lifespan','Lifespan'),line('alignment','Usual alignment'),
      prose('coreTraits','Core abilities / traits',{...required,maxLines:4,hint:'Enter up to four distinct racial mechanics, one per line.'}),
      prose('paths','Available character paths',{hint:'One selectable path per line.'}),
      prose('transformations','Race transformations',{hint:'List their names here and submit each form separately as a Transformation.'}),
      prose('factions','Faction affiliations'),prose('hybrid','Hybrid potential'),prose('perks','Roleplay perks'),
      prose('history','Race history',{max:12000})),
    section('Cultural information',line('build','Average height / weight'),prose('traditions','Traditions / practices'),prose('religion','Religious views'),
      prose('opposition','Discrimination / opposition'),prose('mannerisms','Common mannerisms'),prose('reproduction','Reproduction / offspring'),
      prose('appearance','Appearance overview'),image('art','Race artwork'))
  ];
  const transformation = [
    section('Basic information',line('name','Form name',{max:100,...required}),line('lineage','Associated race / universal path'),
      prose('appearance','Visual appearance',required),image('art','Transformation artwork'),prose('aura','Aura / FX details')),
    section('Description',prose('description','What the form means',{...required,max:6000,hint:'Describe what entering this form feels like and how it fits the character’s journey or race.'})),
    section('Mechanics',prose('requirements','Requirements',required),prose('drawbacks','Drawbacks',required),
      line('multiplier','Multiplier',{...required,hint:'Enter the proposed multiplier and any condition that changes it.'}),prose('effects','Additional effects'))
  ];
  const edit = [section('Update request',prose('summary','Updated description',{...required,hint:'Describe only the sections that are changing.'}),
    prose('approval','Approval requested',{...required,hint:'Specify the lore tweak, stat correction, power adjustment or other decision you need.'}))];
  const training = [
    section('Character & scene',line('location','Training location',required),line('trainingType','Training type',{...required,hint:'Solo, partnered, magic, reserve, mental or another type.'}),
      prose('goals','Training goals',required),prose('boosts','Training boosts claimed',{hint:'List percentages, items and active multipliers.'}),
      line('scene','Discord scene link',{max:400,hint:'Optional Discord message link. Regular RP messages and character posts both count as evidence.'})),
    section('Mathematics',prose('formula','Formula & breakdown',{...required,hint:'Show base values, each modifier and your arithmetic.'}),
      prose('claimed','Final PL / stat increase claimed',{...required,hint:'Include the BPL, mastery or other sheet changes you believe the scene earned.'}))
  ];
  const forms = {
    create:{title:'New Character',sections:character},technique:{title:'Technique',sections:technique},item:{title:'Item',sections:item},
    race:{title:'Race',sections:race},transformation:{title:'Transformation',sections:transformation},
    edit:{title:'OC Update Request',sections:edit},training:{title:'Training Submission',sections:training}
  };
  const catalogue = ['technique','item','race','transformation'];
  const tiers = [['1–10','Basic Tool / Simple Enchantment'],['11–20','Modified Weapon / Utility Device / Magic Charm'],
    ['21–35','Custom Multi-Function Gear / Advanced Gadget / Rune Script'],['36–49','Rare Artifact / Portable System / A.I.-linked Item'],
    ['50+','Legendary Construct / Living Tech / Interdimensional Tech/Magic']];
  const allFields = kind => forms[kind].sections.flatMap(group => group.fields);
  function normalize(kind, input, partial = false) {
    if (!Object.hasOwn(forms,kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a submission form.');
    const fields=allFields(kind), output={};
    if (Object.keys(input).some(k=>!fields.some(f=>f.key===k))) throw Error('An unsupported field was submitted.');
    for (const f of fields) {
      if (partial && !Object.hasOwn(input,f.key)) continue;
      const raw=input[f.key] ?? (partial?'':f.initial||'');
      if (typeof raw!=='string') throw Error(f.label+' must be text.');
      const value=raw.trim();
      if (value.length>f.max || (f.required&&!value)) throw Error('Check '+f.label+' (maximum '+f.max+' characters).');
      if (value && f.options && !f.options.some(([v])=>value===v)) throw Error('Choose a valid '+f.label+'.');
      if (value && f.whole && (!/^(0|[1-9]\d*)$/.test(value) || (f.min && BigInt(value)<BigInt(f.min)))) throw Error('Enter a whole number for '+f.label+'.');
      if (value && (f.minLines||f.maxLines)) {
        const entries=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const distinct=new Set(entries.map(s=>s.toLowerCase()));
        if (distinct.size!==entries.length || entries.length<(f.minLines||1) || entries.length>(f.maxLines||Infinity)) throw Error(f.label+' needs '+(f.minLines?'at least '+f.minLines:'up to '+f.maxLines)+' distinct entries, one per line.');
      }
      if (f.key==='scene' && value && !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}\/?$/.test(value)) throw Error('Use a Discord message link for the training scene.');
      if (f.media && value && !validImage(value)) throw Error('Use an HTTPS image or GIF link, or upload an image.');
      output[f.key]=f.key==='tag'?normalizeTag(raw):f.key==='attainedForms'?(readForms(value).length?JSON.stringify(readForms(value)):''):value;
    }
    return output;
  }
  function assert(ok,message) { if(!ok) throw Error(message); }
  function checkKeys(obj,allowed) {
    assert(obj && typeof obj==='object' && !Array.isArray(obj) && Object.keys(obj).every(k=>allowed.includes(k)),'An unsupported award field was submitted.');
  }
  function integer(value,name) {
    assert(typeof value==='string' && /^(0|[1-9]\d{0,59})$/.test(value),name+' must be a whole number of up to 60 digits.');
    return value;
  }
  function trimmed(value,max,name) {
    assert(typeof value==='string' && value.trim() && value.trim().length<=max,'Check '+name+' (maximum '+max+' characters).');
    return value.trim();
  }
  function calculateAward(before, input) {
    checkKeys(input, ['percent', 'points', 'currency', 'gear', 'stats']);
    const percent = trimmed(input.percent ?? '0', 12, 'Percentage');
    assert(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(percent), 'Enter a nonnegative percentage with up to two decimal places.');
    const [whole, fraction = ''] = percent.split('.');
    const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    const points=integer(input.points ?? '0','Fixed BPL gain');
    assert(points==='0' || basisPoints===0n,'Choose either a percentage or a fixed BPL gain.');
    const currency = integer(input.currency ?? '0', 'Currency grant');
    assert(Array.isArray(input.gear ?? []) && (input.gear ?? []).length <= 20, 'Use up to 20 gear entries per award.');
    const gear = (input.gear ?? []).map((v) => trimmed(v, 100, 'Gear'));
    const gain = BigInt(points) + BigInt(before.bpl) * basisPoints / 10000n;
    const next = { ...before, bpl: integer(String(BigInt(before.bpl) + gain), 'Resulting BPL'),
      wallet: integer(String(BigInt(before.wallet) + BigInt(currency)), 'Resulting wallet'), gear: [...before.gear, ...gear] };
    const stats=input.stats ?? [];
    assert(Array.isArray(stats) && stats.length<=20,'Use up to 20 stat gains.');
    const awards=[];
    if(stats.length) {
      next.progress=(before.progress??[]).map((entry)=>({...entry}));
      const seen=new Set();
      for(const entry of stats) {
        checkKeys(entry,['name','amount']);
        const name=trimmed(entry.name,80,'Stat name'),key=name.toLowerCase(),amount=integer(entry.amount,'Stat gain');
        assert(key!=='strength','Use Power Level for Strength awards.');
        assert(amount!=='0' && !seen.has(key),'Each stat gain needs a distinct name and a positive amount.');
        seen.add(key);
        const existing=next.progress.find((v)=>v.name.toLowerCase()===key);
        if(existing) existing.amount=integer(String(BigInt(existing.amount)+BigInt(amount)),'Resulting stat');
        else next.progress.push({name,amount});
        awards.push({name,amount});
      }
    }
    assert(gain > 0n || BigInt(currency) > 0n || gear.length || awards.length, 'The award must change the sheet after whole-point rounding.');
    return { next, award: { percent, gain: String(gain), currency, gear,...(points!=='0'?{points}:{}),...(awards.length?{stats:awards}:{}) } };
  }
  const api={effectiveSheet,reviewRoutes,tagLimit,tagHint,tagKey,readForms,normalizeTag,validImage,calculateAward,forms,allFields,normalize,catalogue,tiers,stats};
  if(typeof module==='object' && module.exports) module.exports=api;
  else globalThis.PhoenixForms=api;
})();
