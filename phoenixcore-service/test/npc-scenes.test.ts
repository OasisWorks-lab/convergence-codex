import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,initialize,defaultSettings} from '../src/db.ts';
import {Discord,handleInteraction} from '../src/discord.ts';
import {azurikId,loadNpc,npcChoices,seedAzurik} from '../src/npc-catalog.ts';
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
    const b=message.data.components[0].components.find((p:any)=>p.custom_id.endsWith(':'+action));
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
  assert.match(panel.data.content,new RegExp(guest)); assert.match((await run(event(panel,'finish',guest))).data.content,/turn/);
  assert.equal(await captureTurn(db,thread,guest,'early',async()=>({name:'Rin',text:'Early attack'})),undefined);
  assert.equal(await captureTurn(db,thread,host,'m1',async()=>({name:'Kale',text:'I power up to Super Saiyan and invite you to transform.'})),'added');
  assert.equal(await captureTurn(db,thread,host,'m1',async()=>({name:'Kale',text:'same'})),'duplicate');
  const click=event(panel,'finish',host);
  const second=await run(click);assert.deepEqual(await run(click),second);assert.match(second.data.content,new RegExp(guest));
  assert.equal(await deliverScene(db,async()=>post),false);
  const modal=await run(event(second,'write',guest));assert.equal(modal.type,9);
  const sendModal=ctx(guest,{custom_id:modal.data.custom_id,components:[{components:[{custom_id:'post',value:'I take a guarded stance.'}]}]},5);
  const complete=await run(sendModal);assert.match(complete.data.content,/responding/);assert.equal(complete.data.embeds[0].description,'I take a guarded stance.');
  let delivered:any;
  assert.equal(await deliverScene(db,async (scene,move)=>{assert.equal(scene.posts.length,2);delivered=move;return post;}),true);
  assert.equal(delivered.pl,'850000000');assert.match(delivered.name,/Mastered Super Saiyan/);
  assert.equal(await deliverScene(db,async()=>{throw Error('duplicate');}),false);
  const card=await characterCommand(db,guild,config.dashboard,ctx(guest,{name:'Character sheet',target_id:post}));
  assert.equal(card.data.embeds[0].fields.find((f:any)=>f.name==='Current Power Level').value,'850000000');
  const status=await command('roleplay-status');assert.match(status.data.content,/Round 2/);
  assert.match((await run(event(first,'finish',host))).data.content,/Round 2/);
  assert.match((await command('roleplay-cancel',stranger)).data.content,/Only the writer/);
  const admin=ctx(stranger,{name:'roleplay-cancel'});admin.member.permissions='8';assert.match((await run(admin)).data.content,/ended/);
  const newer=await start();assert.ok(newer.data.embeds);assert.match((await run(event(first,'join',guest))).data.content,/earlier scene/);
  assert.match((await command('roleplay-cancel')).data.content,/ended/);
});
test('live Grade 4 rule changes apply without changing base or attained forms; replies survive failed delivery',async t=>{
  const {db,start,run,event}=await setup(t);
  await db.query('INSERT INTO pc_codex VALUES($1,1,$2,$3,$4)',['races/saiyan/paths/0/forms/1',JSON.stringify({html:'<h2>Requirements</h2>Grade 4: 25,000,000.<h2>Multipliers</h2>Grade 4: ×90'}),host,Date.now()]);
  const s=await loadNpc(db.query,azurikId);assert.equal(JSON.parse(s.attainedForms)[0].multiplier,'90');assert.equal(s.bpl,'10000000');
  const panel=await start('spar');await captureTurn(db,thread,host,'m2',async()=>({name:'Kale',text:'Please show me your form.'}));
  await run(event(panel,'finish',host));let calls=0;
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
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'“Whom would you protect?”'}]}]});
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
  assert.equal(writes.filter(s=>s==='POST roleplay-start').length,1);
  assert.deepEqual(writes.filter(s=>s.includes('roleplay-status')),['PATCH roleplay-status']);
  assert.equal(writes.some(s=>/unrelated|Character sheet/.test(s)),false);
  assert.deepEqual(installed.filter(s=>s.name.startsWith('roleplay-')).map(s=>s.name).sort(),['roleplay-cancel','roleplay-start','roleplay-status']);
});
