import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,defaultSettings} from '../src/db.ts';
import {Discord,handleInteraction} from '../src/discord.ts';
import {azurikId,loadNpc,npcChoices,seedAzurik} from '../src/npc-catalog.ts';
import {captureWriterPost} from '../src/posting.ts';
import {deliverTurnNotice,expireTurn,lockedScene,queueNotice,restoreTurnClocks,setClock,turnWindow,reminderDelay} from '../src/npc-turns.ts';
import {deliverScenePanel} from '../src/npc-panel.ts';
import {readSceneHistory} from '../src/npc-history.ts';
import {guided} from '../src/npc-voice.ts';
import {replyLength} from '../src/npc-prose.ts';
import {captureTurn} from '../src/npc-scenes.ts';
import {deliverScene,sendNpcPost} from '../src/npc-delivery.ts';
import {RoleplayScope} from '../src/scope.ts';
import {characterCommand,removeCharacter} from '../src/characters.ts';
import {narrate} from '../src/npc-voice.ts';

const guild='950522987646418964',host='110000000000000001',guest='110000000000000002',stranger='110000000000000003';
const channel='130000000000000001',thread='130000000000000002',post='140000000000000001';
const config={owner:host,guild,clientId:'110000000000000020',service:'https://service.example',dashboard:'https://codex.example/phoenixcore/',token:'test',publicKey:'',clientSecret:''};
async function setup(t:any) {
  const db=openSqlite(':memory:');await initialize(db,guild);await seedAzurik(db,host);t.after(()=>db.close());
  await db.query('UPDATE pc_config SET value=$1',[JSON.stringify({...defaultSettings,rpChannels:channel})]);
  const scope=new RoleplayScope(guild);
  const ctx=(user:string,data:any,type=2,extras:any={})=>({type,id:randomUUID(),application_id:config.clientId,guild_id:guild,member:{user:{id:user,username:user===host?'Writer one':'Writer two'},roles:[],permissions:'0'},channel_id:thread,channel:{type:11,parent_id:channel},data,...extras});
  const run=(p:any)=>handleInteraction(db,config,p,undefined,undefined,scope);
  const command=(name:string,user=host,extra:any={})=>run(ctx(user,{name,...extra}));
  const start=(mode='audience')=>command('roleplay-start',host,{options:[{name:'npc',value:azurikId},{name:'scene',value:mode}]});
  const event=(message:any,action:string,user:string,value='')=>{
    const b=message.data.components[0].components.find((p:any)=>p.custom_id.split(':')[3]===action);
    return ctx(user,{custom_id:b.custom_id},3);
  };
  return {db,scope,ctx,run,start,command,event};
}
test('catalog and scope use approved NPC sheets and live forum parents; archived outcomes cannot enter the seed',async t=>{
  const {db,ctx,run,start}=await setup(t);
  assert.deepEqual(await npcChoices(db.query,'azur'),[{name:'King Azurik',value:azurikId}]);
  const s=await loadNpc(db.query,azurikId);assert.equal(s.bpl,'10000000');assert.ok(s.portrait.endsWith('king-azurik.png'));assert.doesNotMatch(s.bio,/assassinated|betrayer/i);
  assert.equal(JSON.parse(s.attainedForms)[0].multiplier,'85');
  assert.equal((await run(ctx(host,{name:'roleplay-start',options:[{name:'npc',value:'az'}]},4))).data.choices[0].value,azurikId);
  assert.match((await run(ctx(host,{name:'roleplay-start'},2,{channel:{type:11,parent_id:stranger}}))).data.content,/configured RP/);
  assert.match((await run(ctx(host,{name:'roleplay-start'},2,{guild_id:stranger}))).data.content,/different installation/);
  const [one,two]=await Promise.all([start(),start()]);assert.equal([one,two].filter(o=>o.data.embeds).length,1);
  await db.query('UPDATE pc_characters SET sheet=$1 WHERE id=$2',[JSON.stringify({...s,name:'Azurik the King'}),azurikId]);await seedAzurik(db,host);
  assert.equal((await npcChoices(db.query))[0].name,'Azurik the King');
  await removeCharacter(db,{id:host,isOwner:true,isPlayer:true,isJudge:true},azurikId,1);await seedAzurik(db,host);
  assert.deepEqual(await npcChoices(db.query),[]);
});
test('two writers post, finish and pass in order; one reply per round, scene-specific form, access control and stale controls',async t=>{
  const {db,ctx,run,command,start,event}=await setup(t);
  const first=await start('spar'); const panel=await run(event(first,'join',guest));
  assert.match(panel.data.content,new RegExp(guest)); assert.match((await command('finish-turn',guest)).data.content,/turn/);
  assert.equal(await captureTurn(db,thread,guest,'early',async()=>({name:'Rin',text:'Early attack'})),undefined);
  assert.equal(await captureTurn(db,thread,host,'m1',async()=>({name:'Kale',text:'I power up to Super Saiyan and invite you to transform.'})),'added');
  assert.equal(await captureTurn(db,thread,host,'m1',async()=>({name:'Kale',text:'same'})),'duplicate');
  const click=ctx(host,{name:'finish-turn'});
  const second=await run(click);assert.deepEqual(await run(click),second);assert.match(second.data.content,new RegExp(guest));
  assert.equal(await deliverScene(db,async()=>post),false);
  assert.equal(await captureTurn(db,thread,guest,'guest-post',async()=>({name:'Rin',text:'I take a guarded stance.'})),'added');
  const complete=await command('finish-turn',guest);assert.match(complete.data.content,/responding/);
  let delivered:any;
  assert.equal(await deliverScene(db,async (scene,move)=>{assert.equal(scene.posts.length,2);delivered=move;return post;}),true);
  assert.match(delivered.artwork,/b03405cd172508e1410ef4dfbe4fb678.gif/);assert.equal(delivered.pl,'850000000');assert.match(delivered.name,/Mastered Super Saiyan/);
  assert.equal(await deliverScene(db,async()=>{throw Error('duplicate');}),false);
  const card=await characterCommand(db,guild,config.dashboard,ctx(guest,{name:'Character sheet',target_id:post}));
  assert.equal(card.data.embeds[0].fields.find((f:any)=>f.name==='Current Power Level').value,'850000000');
  const status=await command('roleplay-status');assert.match(status.data.content,/Round 2/);
  assert.match((await run(event(first,'pass',host))).data.content,/Round 2/);
  assert.match((await command('roleplay-cancel',stranger)).data.content,/Only the writer/);
  const admin=ctx(stranger,{name:'roleplay-cancel'});admin.member.permissions='8';assert.match((await run(admin)).data.content,/ended/);
  const newer=await start();assert.ok(newer.data.embeds);assert.match((await run(event(first,'join',guest))).data.content,/earlier scene/);
  assert.match((await command('roleplay-cancel')).data.content,/ended/);
});
test('live Grade 4 rule changes apply without changing base or attained forms; replies survive failed delivery',async t=>{
  const {db,start,command}=await setup(t);
  await db.query('INSERT INTO pc_codex VALUES($1,1,$2,$3,$4)',['races/saiyan/paths/0/forms/1',JSON.stringify({html:'<h2>Requirements</h2>Grade 4: 25,000,000.<h2>Multipliers</h2>Grade 4: ×90'}),host,Date.now()]);
  const s=await loadNpc(db.query,azurikId);assert.equal(JSON.parse(s.attainedForms)[0].multiplier,'90');assert.equal(s.bpl,'10000000');
  const panel=await start('spar');await captureTurn(db,thread,host,'m2',async()=>({name:'Kale',text:'Please show me your form.'}));
  await command('finish-turn');let calls=0;
  const voice=async(...args:Parameters<typeof narrate>)=>{calls++;return narrate(...args);};
  await deliverScene(db,async(_,move)=>{assert.equal(move.pl,'900000000');throw Error('transient');},voice);
  await db.query('UPDATE pc_rp_scenes SET ready_at=1 WHERE channel_id=$1',[thread]);
  await deliverScene(db,async(_,move,retry)=>{assert.equal(retry,true);assert.equal(move.pl,'900000000');return post;},voice);
  assert.equal(calls,1);
});
test('NPC webhook uses correct forum thread and portrait, reconciles retries, falls back on missing webhook permission',async t=>{
  const {db,start}=await setup(t);await start();
  const s=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state), sheet=await loadNpc(db.query,azurikId);
  const move=await narrate(db,s,sheet);let created:any,missing=false,found=false;
  const d=new Discord(config);
  d.call=async(path:string,init:any={})=>{
    if(path==='/channels/'+thread)return {id:thread,guild_id:guild,type:11,parent_id:channel};
    if(path==='/channels/'+channel+'/webhooks'){
      if(missing)throw Object.assign(Error(),{status:403});return [{id:'12',token:'fake',name:'PhoenixCore RP',user:{id:config.clientId}}];
    }
    if(path.includes('messages?limit'))return found?[{id:post,webhook_id:'12',embeds:created.embeds}]:[];
    if(path.startsWith('/webhooks/')||path==='/channels/'+thread+'/messages'){
      created=JSON.parse(init.body);if(!missing)assert.match(path,/thread_id=130000000000000002/);return {id:post};
    }
    throw Error(path);
  };
  assert.equal(await sendNpcPost(d,s,move,false),post);assert.equal(created.username,'King Azurik');assert.match(created.avatar_url,/king-azurik.png/);assert.deepEqual(created.allowed_mentions,{parse:[]});
  found=true;assert.equal(await sendNpcPost(d,s,move,true),post);
  missing=true;await sendNpcPost(d,s,move,false);assert.equal(created.enforce_nonce,true);assert.equal(created.embeds[0].author.name,'King Azurik');
});
test('AI dialogue is opt-in, bounded by its daily server budget, and falls back without blocking the next turn',async t=>{
  const {db,start}=await setup(t);await start();
  const scene=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state);
  const sheet=await loadNpc(db.query,azurikId);
  const keys=['PHOENIX_NPC_OPENAI_KEY','PHOENIX_NPC_AI_MODEL','PHOENIX_NPC_AI_DAILY_REPLIES'];
  const old=keys.map(k=>process.env[k]);t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));
  process.env.PHOENIX_NPC_OPENAI_KEY='fixture';process.env.PHOENIX_NPC_AI_MODEL='fixture';process.env.PHOENIX_NPC_AI_DAILY_REPLIES='1';
  let calls=0;
  const fake=async(_url:any,init:any)=>{
    calls++;const req=JSON.parse(init.body);assert.equal(req.store,false);assert.doesNotMatch(req.input,new RegExp(host));
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Azurik gives the question some thought. He opens his hand and looks toward the person who spoke. “Whom would you protect first, if you took that road? I would hear their name before I give my word about the journey.”'}]}]});
  };
  assert.equal((await narrate(db,scene,sheet,fake as any)).source,'Guided');assert.equal(calls,0);
  scene.ai=true;assert.equal((await narrate(db,scene,sheet,fake as any)).source,'AI');
  assert.equal((await narrate(db,scene,sheet,fake as any)).source,'Guided');assert.equal(calls,1);
  await db.query('DELETE FROM pc_npc_ai_usage');
  assert.equal((await narrate(db,scene,sheet,async()=>{throw Error('offline');})).source,'Guided');
});

test('adopts an existing owner NPC without duplicating the sheet, losing their gear or replacing their form ID',async t=>{
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);
  const id=randomUUID(),existing={name:'King Azurik',characterType:'NPC',bio:'Personal history.',wallet:'42',gear:['Royal seal'],bpl:'5000000',attainedForms:JSON.stringify([{id:'original',name:'Mastered Super Saiyan',portrait:''}])};
  await db.query('INSERT INTO pc_characters VALUES($1,$2,3,$3)',[id,host,JSON.stringify(existing)]);
  await seedAzurik(db,host);await seedAzurik(db,host);
  const choices=await npcChoices(db.query);assert.deepEqual(choices,[{name:'King Azurik',value:id}]);
  const sheet=await loadNpc(db.query,id);
  assert.equal(sheet.bpl,'10000000');assert.equal(sheet.wallet,'42');assert.deepEqual(sheet.gear,['Royal seal']);assert.equal(sheet.bio,existing.bio);
  assert.deepEqual(JSON.parse(sheet.attainedForms),[{id:'original',name:'Mastered Super Saiyan',portrait:'',multiplier:'85'}]);
  assert.equal((await db.query('SELECT revision FROM pc_characters'))[0].revision,4);
});
test('guild command registration resumes after throttling, updates changed definitions and verifies the live list',async()=>{
  const installed:any[]=[{id:'old',type:1,name:'roleplay-status',description:'Old wording'},
    {id:'other',type:1,name:'unrelated',description:'Keep me.'},{id:'sheet',type:3,name:'Character sheet',description:'',options:[]}];
  const writes:string[]=[];
  let throttle=true;
  const discord=new Discord(config,async(url,init)=>{
    assert.match(new Headers(init?.headers).get('user-agent')||'',/^DiscordBot \(https:\/\/github\.com\/OasisWorks-lab\/convergence-codex, \d/);
    const path=new URL(String(url)).pathname;
    if(!init?.method || init.method==='GET')return Response.json(installed);
    const data=JSON.parse(String(init.body));
    if(data.name==='roleplay-cancel' && throttle){throttle=false;return Response.json({retry_after:1.25,code:20028},{status:429});}
    writes.push(init.method+' '+data.name);
    if(init.method==='PATCH')Object.assign(installed.find(d=>d.id===path.split('/').at(-1)),data);
    else installed.push({...data,id:String(installed.length+1)});
    return Response.json(data);
  });
  await assert.rejects(discord.registerCommands(),(e:any)=>/roleplay-cancel.*429.*20028/.test(e.message)&&e.retryMs===1250);
  await discord.registerCommands();const after=[...writes];await discord.registerCommands();
  assert.deepEqual(writes,after);
  assert.equal(writes.filter(s=>s==='POST roleplay-start').length,1);assert.equal(writes.filter(s=>s==='POST finish-turn').length,1);
  assert.deepEqual(writes.filter(s=>s.includes('roleplay-status')),['PATCH roleplay-status']);
  assert.equal(writes.some(s=>/unrelated|Character sheet/.test(s)),false);
  assert.deepEqual(installed.filter(s=>s.name.startsWith('roleplay-')).map(s=>s.name).sort(),['roleplay-cancel','roleplay-join','roleplay-memory','roleplay-start','roleplay-status']);
});

test('start defers Discord history, reads the last five in this thread in order, and zero makes no read',async t=>{
  const {db,scope,ctx,command}=await setup(t);
  const discord=new Discord(config),actor={user:{id:host,username:'Writer'},permissions:'65536',roles:[]};
  const id='150000000000000099';
  const options=[{name:'npc',value:azurikId},{name:'context',value:5}];
  const history=[
    {id:'15',content:'// pause for lunch',author:{username:'Rin'}},
    {id:'14',content:'The hatch begins to open.',webhook_id:'94',author:{bot:true,username:'Rin'}},
    {id:'13',content:'Turn order',author:{bot:true,id:config.clientId}},
    {id:'12',content:'The signal sounds like three bells.',author:{username:'Iris'}},
    {id:'11',content:'Not from here.',channel_id:channel,author:{username:'Elsewhere'}}
  ].map(m=>({type:0,channel_id:thread,...m}));
  const paths:string[]=[];
  discord.call=async(path)=>{paths.push(path);return history;};
  let job:any;
  const initial=await handleInteraction(db,config,ctx(host,{name:'roleplay-start',options},2,{id,member:actor}),discord,w=>{job=w;},scope);
  assert.equal(initial.type,5);assert.equal(initial.data.flags,64);assert.equal(paths.length,0);
  assert.match(await job(),/Scene opened/);assert.deepEqual(paths,['/channels/'+thread+'/messages?limit=5&before='+id]);
  let s=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state);
  assert.equal(s.mode,'open');assert.deepEqual(s.history.map((m:any)=>m.name),['Iris','Rin']);
  assert.match(s.history[0].text,/three bells/);
  await command('roleplay-cancel');
  const zero=ctx(host,{name:'roleplay-start',options:[{name:'npc',value:azurikId},{name:'context',value:0}]},2,{member:actor});
  assert.match((await handleInteraction(db,config,zero,discord,undefined,scope)).data.content,/Fresh scene/);
  s=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state);
  assert.deepEqual(s.history,[]);assert.equal(paths.length,1);
  const denied=await readSceneHistory(db,discord,{member:{permissions:'0'},channel_id:thread},10,'pc!');
  assert.equal(paths.length,1);assert.match(denied.note,/Read Message History/);
  await command('roleplay-cancel');
  discord.call=async()=>{throw new Error('no history');};
  assert.match((await handleInteraction(db,config,ctx(host,{name:'roleplay-start',options},2,{member:actor}),discord,undefined,scope)).data.content,/context: 0/);
  assert.equal((await db.query('SELECT 1 FROM pc_rp_scenes')).length,0);
});

test('native tags and parent defaults feed identities while joins and handoffs silently edit a standing panel',async t=>{
  const {db,start,command,run,event}=await setup(t);
  const a=randomUUID(),b=randomUUID();
  for(const [id,who,name] of [[a,host,'Mira'],[b,guest,'Renn']])await db.query('INSERT INTO pc_characters VALUES($1,$2,1,$3)',[id,who,JSON.stringify({name,characterType:'OC'})]);
  await db.query('INSERT INTO pc_post_tags(owner_id,tag,character_id,tag_key) VALUES($1,$2,$3,$2)',[host,'m-',a]);
  await db.query('INSERT INTO pc_post_defaults VALUES($1,$2,$3)',[guest,channel,b]);
  const first=await start();
  const notices:any[]=[],panels:any[]=[];
  const deliver=()=>deliverScenePanel(db,async(ch,p,messageId)=>{assert.equal(ch,thread);panels.push({payload:p,messageId});return {id:post};});
  await deliver();assert.deepEqual(panels[0].payload.allowed_mentions,{parse:[]});
  assert.equal(await deliverTurnNotice(db,async(_,p)=>notices.push(p)),false);
  const panel=await run(event(first,'join',guest));assert.match(panel.data.content,new RegExp(host+'[\\s\\S]*'+guest+'[\\s\\S]*King Azurik'));assert.deepEqual(panel.data.allowed_mentions,{parse:[]});
  assert.equal(panel.data.flags,64);
  await deliver();assert.equal(panels.at(-1).messageId,post);
  assert.match(panels.at(-1).payload.embeds[0].fields[0].value,new RegExp(guest));
  assert.equal(panel.data.components,undefined);
  const postAs=(author:string,id:string,content:string)=>captureWriterPost(db,{guild,channel:thread,parent:channel,author,id,roles:[],content},'Account name');
  assert.equal(await postAs(guest,'early','I turn toward the gate.'),undefined);
  assert.equal(await postAs(host,'first','m-The gate is open.'),'added');
  assert.equal(await postAs(host,'aside','m-// OOC aside'),undefined);
  assert.equal(await postAs(host,'second','m-I wait for Renn.'),'added');
  assert.equal((await db.query('SELECT * FROM pc_rp_clocks')).length,0);
  await command('finish-turn');
  await deliver(); assert.equal(notices.length,0);assert.deepEqual(panels.at(-1).payload.allowed_mentions,{parse:[]});
  assert.equal(await postAs(guest,'third','I listen for the signal.'),'added');
  await command('finish-turn',guest);
  const joining=await run(event(first,'join',stranger));
  assert.match(joining.data.content,/next round/);
  await deliverScene(db,async (s,move)=>{
    assert.deepEqual(s.posts.map(p=>[p.name,p.text]),[['Mira','The gate is open.'],['Mira','I wait for Renn.'],['Renn','I listen for the signal.']]);
    assert.ok(move.text.length>10);return post;
  });
  while(await deliver()){}
  assert.equal(notices.length,0);assert.equal(panels.at(-1).messageId,post);
  const status=await command('roleplay-status');assert.match(status.data.content,new RegExp(stranger));assert.match(status.data.content,/Round 2/);
});

test('silent turns expire once, a quiet round pauses, and a real reply or a restart preserves the correct deadline',async t=>{
  const {db,start,run,event,command}=await setup(t),first=await start();
  const due=()=>db.query('SELECT due_at FROM pc_rp_clocks').then(rows=>Number(rows[0]?.due_at||0));
  const hostDeadline=await due();await run(event(first,'join',guest));assert.equal(await due(),hostDeadline);
  assert.equal(await expireTurn(db,hostDeadline-1),false);
  assert.equal(await captureTurn(db,thread,host,'ooc',async()=>({name:'Mira',text:'(( just chatting ))'})),undefined);
  const double=await Promise.all([expireTurn(db,hostDeadline),expireTurn(db,hostDeadline)]);
  assert.equal(double.filter(Boolean).length,1);const guestDeadline=await due();assert.equal(guestDeadline,hostDeadline+turnWindow);
  await restoreTurnClocks(db,guestDeadline-50);assert.equal(await due(),guestDeadline);
  const delivered:any[]=[];
  while(await deliverTurnNotice(db,async(_,p)=>{delivered.push(p);},hostDeadline+reminderDelay)){}
  assert.equal(delivered.length,1);assert.deepEqual(delivered[0].allowed_mentions.users,[guest]);
  assert.equal(await expireTurn(db,guestDeadline),true);
  assert.match((await command('roleplay-status')).data.content,/Paused/);
  assert.equal(await deliverScene(db,async()=>{throw Error('empty round');}),false);
  assert.equal(await due(),0);
  await captureTurn(db,thread,guest,'return',async()=>({name:'Renn',text:'I follow the signal.'}),guestDeadline+1);
  assert.equal(await due(),0);assert.equal(await expireTurn(db,guestDeadline+turnWindow*4),false);
  const s=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state);assert.equal(s.paused,false);assert.equal(s.cast[0].id,guest);
  assert.equal(s.posts[0].name,'Renn');
  await command('roleplay-cancel');assert.equal(await deliverTurnNotice(db,async()=>{throw Error('cancelled');}),false);
});

test('guided replies follow new subject matter and actual per-writer length, and fetch the latest form art on transition',async t=>{
  const {db,start}=await setup(t);await start('open');
  const sheet=await loadNpc(db.query,azurikId),s=JSON.parse((await db.query('SELECT state FROM pc_rp_scenes'))[0].state);
  s.history=[{name:'Renn',text:'A distress signal breaks up halfway through.'}];
  s.posts=[{writer:host,name:'Rin',source:'1',text:'What do you think, Azurik?'}];
  const short=guided(s,sheet);assert.doesNotMatch(short.text,/signal/);assert.ok(short.text.split(/\s+/).length<100);
  s.posts[0].text='A merchant wants to trade with us at the market. '.repeat(26);
  const long=guided(s,sheet);assert.match(long.text,/bargain|terms/);assert.notEqual(long.text,short.text);
  s.posts[0].text='a '.repeat(100);s.posts.push({...s.posts[0],source:'2',text:'b '.repeat(100)},{writer:guest,name:'Renn',source:'3',text:'c '.repeat(100)});assert.ok(replyLength(s)>=140&&replyLength(s)<=170);
  s.posts=[{writer:host,name:'Rin',source:'4',text:'Show me your Super Saiyan transformation.'}];
  const first=await narrate(db,s,sheet);assert.match(first.artwork||'',/pinimg.com.*gif$/);
  await db.query('INSERT INTO pc_codex VALUES($1,1,$2,$3,$4)',['races/saiyan/paths/0/forms/1',JSON.stringify({art:'https://images.example/owner-edit.gif'}),host,Date.now()]);
  const changed=await narrate(db,s,sheet);assert.equal(changed.artwork,'https://images.example/owner-edit.gif');assert.equal(changed.portrait,changed.artwork);
  s.form=changed.form;s.posts[0].text='I wait.';const staying=await narrate(db,s,sheet);assert.equal(staying.artwork,undefined);assert.equal(staying.portrait,changed.portrait);
  s.posts[0].text='Please stand down.';const base=await narrate(db,s,sheet);assert.equal(base.form,'');assert.equal(base.portrait,sheet.portrait);
});

test('PostgreSQL workers claim each timer and mention once and cascade a cancelled scene', {skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),database=await openPostgres(url.href);
  const schema='scene_test_'+randomUUID().replaceAll('-','');
  await database.query('CREATE SCHEMA '+schema);
  url.searchParams.set('options','-c search_path='+schema);const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await database.query('DROP SCHEMA '+schema+' CASCADE');await database.close();});
  await initialize(db,guild);
  const s:any={id:randomUUID(),npc:azurikId,title:'Azurik',channel:thread,cast:[{id:host,name:'Rin'},{id:guest,name:'Mira'}],round:1,turn:0,form:'',posts:[],past:[]};
  const now=Date.now();
  await db.transaction(async q=>{
    await q('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3)',[thread,s.id,JSON.stringify(s)]);
    await setClock(q,s,now);await queueNotice(q,s,'Round 1');await q('UPDATE pc_rp_scenes SET state=$1',[JSON.stringify(s)]);
  });
  const sends:any[]=[];
  const send=async(_:string,p:any)=>{sends.push(p);};
  await Promise.all([deliverTurnNotice(db,send),deliverTurnNotice(db,send)]);assert.equal(sends.length,1);assert.deepEqual(sends[0].allowed_mentions.users,[host]);
  await Promise.all([expireTurn(db,now+turnWindow),expireTurn(db,now+turnWindow)]);
  const saved=await db.transaction(q=>lockedScene(q,db,thread));assert.equal(JSON.parse(saved.state).turn,1);
  while(await deliverTurnNotice(db,send,now+turnWindow+reminderDelay)){}
  assert.equal(sends.length,2);assert.deepEqual(sends[1].allowed_mentions.users,[guest]);
  await db.query('DELETE FROM pc_rp_scenes WHERE scene_id=$1',[s.id]);assert.deepEqual(await db.query('SELECT * FROM pc_rp_clocks'),[]);
});

test('Azurik greets a writer in every mode, answers the next turn and only responds physically to a present action',async t=>{
  const {db}=await setup(t),sheet=await loadNpc(db.query,azurikId);
  for(const mode of ['open','audience','spar']){
    const scene:any={id:'live-repro',npc:azurikId,title:'King Azurik',mode,form:'',round:1,opening:'A day of training.',history:[{name:'Earlier writer',text:'An old spar ended beside the ruined gate.'}],past:[],posts:[]};
    const say=(text:string)=>{
      scene.posts=[{writer:host,name:'Mira',text,source:String(scene.round)}];
      const move=guided(scene,sheet);scene.form=move.form;
      scene.past.push({posts:[{name:'Mira',text}],reply:move.text});scene.round++;return move;
    };
    const first=say('Hey Azurik');assert.match(first.text,/hello|hey|good day/i);assert.doesNotMatch(first.text,/Mira|sound of his name|good to see you|there you are|old friend|guard|strike|feint|blow|opponent|fight|gate/i);
    const second=say('I just wanted to see how you were doing.');assert.match(second.text,/asked|tired|day|listen|appreciate/i);
    const third=say('What was your father’s name?');assert.match(third.text,/Ziex/);
    const denial=say('I don’t want to fight, I just came to say hello.');assert.doesNotMatch(denial.text,/practice lane|feints|Orga Blaster|Galick Gun/);
    assert.equal(new Set([first,second,third,denial].map(m=>m.text.split(/\s+/).slice(0,8).join(' '))).size,4);
    const neutral=say('Did you fight your father?');assert.equal(neutral.form,'');assert.doesNotMatch(neutral.text,/incoming strike|raises a guard/);
    const exhibit=say('Could you show me your Super Saiyan form?');assert.ok(exhibit.form);assert.doesNotMatch(exhibit.text,/forearm|opponent/);
    const defence=say('I throw a punch at Azurik.');assert.match(defence.text,/incoming strike|attack|line of the blow/);
  }
});


test('one Discord writer can join twice with distinct approved characters and each slot requires matching character posts',async t=>{
  const {db,command,start,run,ctx}=await setup(t);
  const first=await start('audience');
  assert.ok(first.data.embeds);
  const rin=randomUUID(),sola=randomUUID();
  for(const [id,name] of [[rin,'Rin'],[sola,'Sola']]){
    await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',[id,guest,JSON.stringify({name,characterType:'OC',bpl:'10000',wallet:'0',gear:[]})]);
  }
  const option=(id:string)=>({options:[{name:'character',value:id}]});
  assert.match((await command('roleplay-join',guest,option(rin))).data.content,/Rin/);
  assert.match((await command('roleplay-join',guest,option(sola))).data.content,/Sola/);
  assert.match((await command('roleplay-join',guest,option(rin))).data.content,/already/);
  const [row]=await db.query('SELECT state FROM pc_rp_scenes WHERE channel_id=$1',[thread]);
  const scene=JSON.parse(row.state);
  assert.deepEqual(scene.cast.map((p:any)=>p.characterId||null),[null,rin,sola]);
  assert.match((await command('roleplay-status')).data.content,/Rin/);
  await run(ctx(host,{custom_id:first.data.components[0].components.find((b:any)=>b.custom_id.includes(':pass:')).custom_id},3));
  assert.equal(await captureTurn(db,thread,guest,'wrong-one',async()=>({name:'Sola',characterId:sola,text:'I speak too early.'})),undefined);
  assert.equal(await captureTurn(db,thread,guest,'rin-one',async()=>({name:'Rin',characterId:rin,text:'Hello, Azurik.'})),'added');
  assert.match((await command('finish-turn',guest)).data.content,new RegExp(guest));
  assert.equal(await captureTurn(db,thread,guest,'wrong-two',async()=>({name:'Rin',characterId:rin,text:'Wrong turn.'})),undefined);
  assert.match((await command('finish-turn',guest)).data.content,/Post in character first/);
  assert.equal(await captureTurn(db,thread,guest,'sola-one',async()=>({name:'Sola',characterId:sola,text:'I have a question too.'})),'added');
  assert.match((await command('finish-turn',guest)).data.content,/responding/);
  const [done]=await db.query('SELECT state FROM pc_rp_scenes WHERE channel_id=$1',[thread]);
  assert.deepEqual(JSON.parse(done.state).posts.map((p:any)=>p.characterId),[rin,sola]);
});


test('an unintroduced NPC visitor stays a stranger even when Discord identifies the writer',async t=>{
  const {db}=await setup(t),sheet=await loadNpc(db.query,azurikId);
  const scene:any={id:'unintroduced',npc:azurikId,title:'King Azurik',mode:'open',form:'',round:1,opening:'',history:[],past:[],posts:[]};
  const say=(spoken:string,speaker='A Name He Has Never Heard')=>{
    scene.posts=[{writer:host,name:speaker,text:spoken,source:String(scene.round)}];
    const reply=guided(scene,sheet).text;
    scene.past.push({posts:[{name:speaker,text:spoken}],reply});scene.round++;
    return reply;
  };
  const first=say('Hello there!');
  assert.doesNotMatch(first,/A Name He Has Never Heard|sound of his name|good to see you|there you are|old friend/i);
  const second=say('How has your day been?');
  assert.doesNotMatch(second,/A Name He Has Never Heard|sound of his name|remember when we/i);
  const third=say('My name is Mira.');
  assert.match(third,/Mira/);
  const fourth=say('Hey again.');
  assert.match(fourth,/Mira|Hello|Hey|Good day/);
});
