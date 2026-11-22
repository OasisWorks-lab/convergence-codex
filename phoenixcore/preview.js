// Invented players and sheets for the offline walkthrough. This adapter makes no network requests.
(() => {
  const ids={player:'111111111111111111',judge:'222222222222222222',owner:'333333333333333333',newcomer:'444444444444444444'};
  const players=[
    {id:ids.player,username:'emberquill',display:'Ember Quill'},
    {id:ids.judge,username:'lanternscribe',display:'Lantern Scribe'},
    {id:ids.owner,username:'archivekeeper',display:'Archive Keeper'},
    {id:ids.newcomer,username:'newmoon',display:'New Moon'}
  ];
  const base={name:'',lineage:'',portrait:'',bio:'',bpl:'0',strength:'',speed:'',durability:'',intelligence:'',control:'',wallet:'0',gear:[]};
  let characters=[
    {id:'42cd18dc-4684-45fc-8817-e1c79ad1a9ee',ownerId:ids.player,version:1,sheet:{...base,name:'Rin',lineage:'Saiyan',bio:'A courier who knows every sparring ring on Sadala. Keeps a cracked scouter as a reminder of her first loss.',bpl:'10000',strength:'Powerful at close range.',speed:'Quick first step.',control:'Steady in short bursts.',wallet:'240',gear:['Cracked scouter','Weighted wraps']}},
    {id:'cd169004-e171-4a86-bc21-0e57af604fe6',ownerId:ids.player,version:1,sheet:{...base,name:'Sola',lineage:'Namekian',bio:'An apprentice healer collecting oral histories.',bpl:'3200',wallet:'45',gear:['Field journal']}},
    {id:'a4a12b86-6d0c-4aa9-80f1-c219352fb93f',ownerId:ids.judge,version:1,sheet:{...base,name:'Vey',lineage:'Cerealian',bio:'A scout learning to trust a partner.',bpl:'8600',wallet:'70'}}
  ];
  const forms=window.PhoenixForms, sampleChannel='555555555555555555';
  let requests=[],role='player',settings={revision:1,value:{playerRole:'',judgeRole:'1100315893864603649',commandPrefixes:'pc!',submissionMessage:'{helper} A {type} submission for {character} is ready for review.',reviewChannel:'',...forms.reviewRoutes,currency:'Zeni',rpChannels:sampleChannel,rpDivider:''}};
  const embeds=[],designs=[],tags=[],defaults=[],favorites=[],banks=new Map(),clone=x=>JSON.parse(JSON.stringify(x));
  function state() {
    const id=ids[role],owner=role==='owner',judge=owner||role==='judge',channels=settings.value.rpChannels.split(/\s+/).filter(Boolean);
    return clone({actor:{id,isPlayer:true,isOwner:owner,isJudge:judge},
       economyAccounts:characters.filter(c=>judge||c.ownerId===id).map(c=>({characterId:c.id,currencyId:'zeni',cash:c.sheet.wallet||'0',bank:banks.get(c.id)||'0',revision:1})),
       favoriteCharacterIds:favorites.filter(f=>f.owner===id).map(f=>f.characterId),players,characters:characters.map(c=>({...c,sheet:judge||c.ownerId===id?c.sheet:{...c.sheet,wallet:undefined},tag:tags.find(t=>t.characterId===c.id)?.tag||''})),
      scope:{online:true,categories:[{id:'566666666666666666',name:'Roleplay channels below'}],locations:channels.map(id=>({id,name:'Practice scene',type:0})),incomplete:0,scanning:false},
      requests:requests.filter(r=>judge||r.ownerId===id||r.authorId===id).map(r=>({...r,denial:judge?r.denial:null,...(judge?{assessment:{summary:'Ready for staff review',checks:[{label:'Roleplay review',state:'review',detail:'Check the character, requirements and limitations against the server rules.'}]}}:{})})),announcements:owner?embeds:[],
      catalogue:designs,
      posting:{tags:tags.filter(t=>t.owner===id),defaults:defaults.filter(d=>d.owner===id&&channels.includes(d.channel)),channels},
      currency:settings.value.currency,settings:owner?settings:null});
  }
  function propose(form) {
    const who=state().actor, design=forms.catalogue.includes(form.kind);
    const c=characters.find(x=>x.id===form.characterId);
    const create=form.kind==='create',award=form.kind==='award',targeted=!design&&!create;
    if(targeted&&(!c||form.version!==c.version))throw Error('Sheet changed. Reload the current sheet.');
    if(award&&!who.isJudge)throw Error('A training judge must assign awards.');
    if(targeted&&!award&&c.ownerId!==who.id)throw Error('Choose your own character.');
    const before=targeted?clone(c.sheet):null;
    let immediate=false;
    let after,amount=null,details=null;
    if(design)after=forms.normalize(form.kind,form.fields);
    else if(create)after={wallet:'0',gear:[],...forms.normalize('create',form.fields)};
    else if(award)({next:after,award:amount}=forms.calculateAward(before,form.award));
    else if(form.kind==='training'){after=before;details=forms.normalize('training',form.details);}
    else {
      after={...before,...forms.normalize('create',form.fields,true)};
      if(Object.hasOwn(after,'tag')){
        const old=tags.find(t=>t.characterId===c.id)?.tag||'';
        if(old===after.tag)delete after.tag;
        else {before.tag=old;immediate=Object.keys(after).every(k=>k==='tag'||JSON.stringify(after[k]??'')===JSON.stringify(before[k]??''));}
      }
      if(!immediate&&form.details)details=forms.normalize('edit',form.details);
      if(JSON.stringify(before)===JSON.stringify(after))throw Error('Change a field before submitting.');
    }
    if(!form.reason.trim())throw Error('Enter a reason for the request.');
    const r={id:form.id,characterId:c?.id||form.id,ownerId:c?.ownerId||who.id,authorId:who.id,kind:form.kind,
      version:c?.version||0,before,after,award:amount,details,judgment:null,reason:form.reason,
      status:form.kind==='training'?'awaiting_judge':'pending',created:Date.now(),delivery:'Practice notification'};
    if(immediate){savePosting({kind:'tag',characterId:c.id,tag:after.tag});r.status='approved';r.archived=true;r.decided=Date.now();r.decidedBy=who.id;}
    requests.unshift(r);return {id:r.id,status:r.status};
  }
  function judge(id,input){
    if(!state().actor.isJudge)throw Error('A training judge must assess the claim.');
    const r=requests.find(x=>x.id===id);
    if(r?.status!=='awaiting_judge')throw Error('This claim was already reviewed.');
    const result=forms.calculateAward(r.before,input.award);
    if(!input.note.trim())throw Error('Enter your judgment.');
    r.award=result.award;r.after=result.next;r.judgment={note:input.note,judgeId:ids[role]};
    r.status=characters.find(c=>c.id===r.characterId)?.version===r.version?'pending':'stale';
    return r;
  }
  function decision(id,approve,action=approve?'approve':'decline',note='') {
    if(!state().actor.isJudge)throw Error('Helper access required.');
    const r=requests.find(x=>x.id===id);
    if(r?.status==='owner_review'){
      if(role!=='owner'||!['uphold','veto'].includes(action))throw Error('Owner review required.');
      r.status=r.denial.stage;if(action==='veto'&&r.status==='awaiting_judge')return r;
    }else if(role==='judge'&&action==='decline'&&r&&['pending','awaiting_judge'].includes(r.status)){
      r.denial={helper:ids[role],note,stage:r.status,delivered:true};r.status='owner_review';return r;
    }
    if(approve&&r?.status==='awaiting_judge')throw Error('Staff must assess the claim first.');
    if(!r||!['pending','awaiting_judge'].includes(r.status))return;
    const c=characters.find(x=>x.id===r.characterId);
    r.decided=Date.now();r.decidedBy=ids[role];r.archived=true;
    if(!approve){r.status='declined';return;}
    if((c?.version||0)!==r.version){r.status='stale';return;}
    r.status='approved';
    if(forms.catalogue.includes(r.kind)){designs.push({id:r.id,fields:r.after,kind:r.kind,authorId:r.authorId});return;}
    const next=clone(r.after);
    if(r.kind==='create'&&next.characterType!=='NPC'&&['Low','Middle','High','Noble'].includes(next.societyClass))next.wallet=(BigInt(next.wallet||'0')+BigInt({Low:1000,Middle:2000,High:4000,Noble:8000}[next.societyClass])).toString();
    if(Object.hasOwn(next,'tag')){
      const previous=tags.find(t=>t.characterId===r.characterId)?.tag||'';
      if(previous!==(r.before?.tag||'') || tags.some(t=>t.owner===r.ownerId&&forms.tagKey(t.tag)===forms.tagKey(next.tag)&&t.characterId!==r.characterId)){r.status='stale';return;}
      const index=tags.findIndex(t=>t.characterId===r.characterId);
      if(index>=0)tags.splice(index,1);
      if(next.tag)tags.push({owner:r.ownerId,characterId:r.characterId,tag:next.tag});
      delete next.tag;
    }
    if(c){c.version++;c.sheet=next;}
    else characters.push({id:r.characterId,ownerId:r.ownerId,version:1,sheet:next});
  }
  function savePosting(input){
    const owner=ids[role];
    if(input.characterId&&!characters.some(c=>c.id===input.characterId&&c.ownerId===owner))throw Error('Choose your approved character.');
    const isTag=input.kind==='tag',list=isTag?tags:defaults;
    const tag=isTag?forms.normalizeTag(input.tag):'';
    if(isTag&&tag&&tags.some(t=>t.owner===owner&&forms.tagKey(t.tag)===forms.tagKey(tag)&&t.characterId!==input.characterId))throw Error('Choose a valid, unused character tag.');
    if(!isTag&&!state().posting.channels.includes(input.channel))throw Error('Choose an enabled channel.');
    const index=list.findIndex(t=>t.owner===owner&&(isTag?t.characterId===input.characterId:t.channel===input.channel));
    if(index>=0)list.splice(index,1);
    if((isTag&&tag)||(!isTag&&(input.characterId||input.account)))list.push({...input,owner,tag});
  }
  function archive(id,on){
    if(role!=='owner')throw Error('Owner access required.');
    const r=requests.find(r=>r.id===id);r.archived=on;
    if(on&&['pending','awaiting_judge'].includes(r.status)){r.previous=r.status;r.status='archived';}
    else if(!on&&r.status==='archived')r.status=r.previous;
  }
  function remove(id){
    if(role!=='owner')throw Error('Owner access required.');
    characters=characters.filter(c=>c.id!==id);
    banks.delete(id);
    for(const list of [tags,defaults,favorites])for(let i=list.length-1;i>=0;i--)if(list[i].characterId===id)list.splice(i,1);
    for(const r of requests)if(r.characterId===id&&['pending','awaiting_judge','archived'].includes(r.status))r.status='stale';
  }
  function purge(id){if(role!=='owner'||!requests.find(r=>r.id===id)?.archived)throw Error('Choose an archived request.');requests=requests.filter(r=>r.id!==id);}
  function embed(value){if(role!=='owner')throw Error('Owner access required.');const old=embeds.findIndex(x=>x.kind===value.kind);if(old<0)embeds.push(value);else embeds[old]=value;}
  window.PhoenixPreview={state,purge,embed,archive,remove,propose,decision,judge,savePosting,
     bank:(characterId,action,amount)=>{
       const c=characters.find(c=>c.id===characterId&&c.ownerId===ids[role]);
       if(!c||!['deposit','withdraw'].includes(action)||!/^[1-9][0-9]{0,59}$/.test(amount))throw Error('Choose an approved character and a positive amount.');
       const n=BigInt(amount),cash=BigInt(c.sheet.wallet||'0'),bank=BigInt(banks.get(characterId)||'0');
       if(action==='deposit'&&n>cash||action==='withdraw'&&n>bank)throw Error('Insufficient available funds.');
       c.sheet.wallet=String(cash+(action==='deposit'?-n:n));banks.set(characterId,String(bank+(action==='deposit'?n:-n)));c.version++;
     },
     favorite:(characterId,on)=>{
      if(!characters.some(c=>c.id===characterId))throw Error('Choose a current character.');
      const owner=ids[role],index=favorites.findIndex(f=>f.owner===owner&&f.characterId===characterId);
      if(index>=0)favorites.splice(index,1);
      if(on)favorites.push({owner,characterId});
    },role:()=>role,switchRole:value=>{if(['player','judge','owner'].includes(value))role=value;},
    saveSettings:input=>{
      if(role!=='owner')throw Error('Only the owner can change settings.');
      if(input.revision!==settings.revision)throw Error('Reload current settings.');
      if(Object.keys(forms.reviewRoutes).some(key=>!/^\d{17,20}$/.test(input.value[key])))throw Error('Enter valid Discord IDs for your review destinations.');
      if(input.value.rpChannels.trim().split(/[\s,]+/).filter(Boolean).some(id=>!/^\d{17,20}$/.test(id)))throw Error('Enter valid roleplay channel IDs.');
      settings={revision:settings.revision+1,value:{...input.value,rpChannels:input.value.rpChannels.trim().split(/[\s,]+/).join('\n')}};
    }};
})();
