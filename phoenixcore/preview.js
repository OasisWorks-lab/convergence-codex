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
  let requests=[],role='player',settings={revision:1,value:{playerRole:'',judgeRole:'',reviewChannel:'',currency:'Credits',rpChannels:sampleChannel}};
  const tags=[],defaults=[],clone=x=>JSON.parse(JSON.stringify(x));
  function state() {
    const id=ids[role],owner=role==='owner',judge=owner||role==='judge',channels=settings.value.rpChannels.split(/\s+/).filter(Boolean);
    return clone({actor:{id,isPlayer:true,isOwner:owner,isJudge:judge},players,characters,
      requests:requests.filter(r=>owner||r.ownerId===id||r.authorId===id||(judge&&r.kind==='training')),
      catalogue:requests.filter(r=>r.status==='approved'&&forms.catalogue.includes(r.kind)).map(r=>({id:r.id,fields:r.after,kind:r.kind,authorId:r.authorId})),
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
    let after,amount=null,details=null;
    if(design)after=forms.normalize(form.kind,form.fields);
    else if(create)after={wallet:'0',gear:[],...forms.normalize('create',form.fields)};
    else if(award)({next:after,award:amount}=forms.calculateAward(before,form.award));
    else if(form.kind==='training'){after=before;details=forms.normalize('training',form.details);}
    else {
      after={...before,...forms.normalize('create',form.fields,true)};
      if(form.details)details=forms.normalize('edit',form.details);
      if(JSON.stringify(before)===JSON.stringify(after))throw Error('Change a field before submitting.');
    }
    if(!form.reason.trim())throw Error('Enter a reason for the request.');
    const r={id:form.id,characterId:c?.id||form.id,ownerId:c?.ownerId||who.id,authorId:who.id,kind:form.kind,
      version:c?.version||0,before,after,award:amount,details,judgment:null,reason:form.reason,
      status:form.kind==='training'?'awaiting_judge':'pending',created:Date.now(),delivery:'Practice notification'};
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
  function decision(id,approve) {
    if(role!=='owner')throw Error('Only the owner can confirm a change.');
    const r=requests.find(x=>x.id===id);
    if(approve&&r?.status==='awaiting_judge')throw Error('Staff must assess the claim first.');
    if(!r||!['pending','awaiting_judge'].includes(r.status))return;
    const c=characters.find(x=>x.id===r.characterId);
    r.decided=Date.now();r.decidedBy=ids.owner;
    if(!approve){r.status='declined';return;}
    if((c?.version||0)!==r.version){r.status='stale';return;}
    r.status='approved';
    if(forms.catalogue.includes(r.kind))return;
    if(c){c.version++;c.sheet=clone(r.after);}
    else characters.push({id:r.characterId,ownerId:r.ownerId,version:1,sheet:clone(r.after)});
  }
  function savePosting(input){
    const owner=ids[role];
    if(input.characterId&&!characters.some(c=>c.id===input.characterId&&c.ownerId===owner))throw Error('Choose your approved character.');
    const isTag=input.kind==='tag',list=isTag?tags:defaults;
    const tag=(input.tag||'').trim().toLowerCase();
    if(isTag&&tag&&(!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(tag)||tags.some(t=>t.owner===owner&&t.tag===tag&&t.characterId!==input.characterId)))throw Error('Choose a valid, unused character tag.');
    if(!isTag&&!state().posting.channels.includes(input.channel))throw Error('Choose an enabled channel.');
    const index=list.findIndex(t=>t.owner===owner&&(isTag?t.characterId===input.characterId:t.channel===input.channel));
    if(index>=0)list.splice(index,1);
    if((isTag&&tag)||(!isTag&&input.characterId))list.push({...input,owner,tag});
  }
  window.PhoenixPreview={state,propose,decision,judge,savePosting,role:()=>role,switchRole:value=>{if(['player','judge','owner'].includes(value))role=value;},
    saveSettings:input=>{
      if(role!=='owner')throw Error('Only the owner can change settings.');
      if(input.revision!==settings.revision)throw Error('Reload current settings.');
      if(input.value.rpChannels.trim().split(/[\s,]+/).filter(Boolean).some(id=>!/^\d{17,20}$/.test(id)))throw Error('Enter valid roleplay channel IDs.');
      settings={revision:settings.revision+1,value:{...input.value,rpChannels:input.value.rpChannels.trim().split(/[\s,]+/).join('\n')}};
    }};
})();
