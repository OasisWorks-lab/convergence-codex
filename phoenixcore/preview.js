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
  let requests=[],role='player',settings={revision:1,value:{playerRole:'',judgeRole:'',reviewChannel:'',currency:'Credits'}};
  const clone=x=>JSON.parse(JSON.stringify(x));
  function state() {
    const id=ids[role],owner=role==='owner';
    return clone({actor:{id,isPlayer:true,isOwner:owner,isJudge:owner||role==='judge'},players,characters,
      requests:requests.filter(r=>owner||r.ownerId===id||r.authorId===id),currency:settings.value.currency,settings:owner?settings:null});
  }
  function propose(form) {
    const who=state().actor;
    const c=characters.find(x=>x.id===form.characterId);
    const create=form.kind==='create',award=form.kind==='award';
    if (!create && (!c || form.version!==c.version)) throw Error('Sheet changed. Reload the current sheet.');
    if (!who.isJudge && award) throw Error('A training judge must assign awards.');
    if (!create && !award && c.ownerId!==who.id) throw Error('Only the character owner can propose edits.');
    const before=c?clone(c.sheet):null;
    let after={...(before||clone(base)),...form.fields},amount=null;
    if(award) {
      const a=form.award;
      if(!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(a.percent) || !/^(0|[1-9]\d{0,59})$/.test(a.currency)) throw Error('Enter an award percentage and a whole currency amount.');
      const [w,f='']=a.percent.split('.');
      const gain=BigInt(before.bpl)*(BigInt(w)*100n+BigInt(f.padEnd(2,'0')))/10000n;
      after={...before,bpl:String(BigInt(before.bpl)+gain),wallet:String(BigInt(before.wallet)+BigInt(a.currency)),gear:[...before.gear,...a.gear]};
      amount={...a,gain:String(gain)};
    }
    if (!after.name.trim() || !/^(0|[1-9]\d{0,59})$/.test(after.bpl)) throw Error('A name and whole-number BPL are required.');
    if(!form.reason.trim()) throw Error('Enter a reason for the request.');
    if(JSON.stringify(before)===JSON.stringify(after)) throw Error('There are no changes to review.');
    const r={id:form.id,characterId:c?.id||form.id,ownerId:c?.ownerId||who.id,authorId:who.id,kind:form.kind,
      version:c?.version||0,before,after,award:amount,reason:form.reason,status:'pending',created:Date.now(),delivery:'Practice notification'};
    requests.unshift(r);return {id:r.id,status:r.status};
  }
  function decision(id,approve) {
    if(role!=='owner') throw Error('Only the owner can confirm a change.');
    const r=requests.find(x=>x.id===id);
    if(!r||r.status!=='pending') return;
    const c=characters.find(x=>x.id===r.characterId);
    r.decided=Date.now();r.decidedBy=ids.owner;
    if(!approve){r.status='declined';return;}
    if((c?.version||0)!==r.version){r.status='stale';return;}
    r.status='approved';
    if(c){c.version++;c.sheet=clone(r.after);}
    else characters.push({id:r.characterId,ownerId:r.ownerId,version:1,sheet:clone(r.after)});
  }
  window.PhoenixPreview={state,propose,decision,role:()=>role,switchRole:value=>{if(['player','judge','owner'].includes(value))role=value;},
    saveSettings:input=>{
      if(role!=='owner') throw Error('Only the owner can change settings.');
      if(input.revision!==settings.revision) throw Error('Reload current settings.');
      settings={revision:settings.revision+1,value:{...input.value}};
    }};
})();
