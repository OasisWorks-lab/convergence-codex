import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,initialize,defaultSettings} from '../src/db.ts';
import {actorFor,propose,decide} from '../src/domain.ts';
import {published,publish,editorRole} from '../src/codex.ts';
import {archiveRequest,removeCharacter,characterCommand} from '../src/characters.ts';
import {relay,savePosting,lookupAuthor} from '../src/posting.ts';
import {accountAvatar} from '../src/discord.ts';

const guild='900000000000000002',ownerId='910000000000000002',writerId='920000000000000002';
const channel='930000000000000002',thread='940000000000000002',post='950000000000000002';
const writer=actorFor(writerId,[],ownerId,defaultSettings),owner=actorFor(ownerId,[],ownerId,defaultSettings);
const config={guild,owner:ownerId,clientId:ownerId,token:'fixture',publicKey:'',clientSecret:'',service:'https://service.test',dashboard:'https://codex.test/phoenixcore/'};
const active=new Set([ownerId,writerId]);
async function dbFor(t:any){
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);return db;
}
test('Codex editing uses the exact role, publishes per entry, preserves other fields, and rejects a stale editor',async t=>{
  const db=await dbFor(t),key='worlds/planet-earth/messages/0';
  const patch={key,revision:0,fields:{html:'An open field.\n\nThe watch begins.'}};
  await assert.rejects(publish(db,[],ownerId,patch),/Owner role/);
  await assert.rejects(publish(db,[guild],writerId,patch),/Owner role/);
  await publish(db,[editorRole],writerId,patch);
  await assert.rejects(publish(db,[editorRole],ownerId,patch),/while you were editing/);
  await publish(db,[editorRole],ownerId,{key,revision:1,fields:{title:'The watch'}});
  const [entry]=await published(db);
  assert.deepEqual(entry,{key,revision:2,fields:{title:'The watch',html:'<p>An open field.</p><p>The watch begins.</p>'}});
  const guildKey='worlds/planet-earth/guilds/'+randomUUID();
  const itemKey='worlds/planet-sadala/items/'+randomUUID();
  await publish(db,[editorRole],ownerId,{key:guildKey,revision:0,fields:{name:'The Watch',leadership:'Three elders'}});
  await publish(db,[editorRole],ownerId,{key:itemKey,revision:0,fields:{name:'Temple bell',abilities:'Rings once at dusk.'}});
  assert.equal((await published(db)).length,3);
  await assert.rejects(publish(db,[editorRole],ownerId,{key:'themes/phoenix',revision:0,fields:{available:'no'}}),/available default/);
  await publish(db,[editorRole],ownerId,{key:'settings/default',revision:0,fields:{theme:'forest'}});
  await publish(db,[editorRole],ownerId,{key:'themes/phoenix',revision:0,fields:{available:'no'}});
  await assert.rejects(publish(db,[editorRole],ownerId,{key:guildKey,revision:1,fields:{source:'javascript:void(0)'}}),/HTTPS/);
});
test('forum inheritance, explicit thread identity, literal tags, approved forms and post sheets',async t=>{
  const db=await dbFor(t),first=randomUUID(),second=randomUUID(),form={id:'awakening',name:'Awakening',portrait:'https://art.test/awake.gif'};
  const character=(id:string,name:string,tag:string)=>({id,kind:'create',fields:{name,tag,bpl:'1250',lineage:'Saiyan',portrait:'https://art.test/base.png',attainedForms:JSON.stringify([form]),strengths:'Patient\nLoyal\nAgile',weaknesses:'Reckless\nDistrustful\nProud'},reason:'Character'});
  for(const c of [character(first,'Test','test-'),character(second,'Rin','rin')]){await propose(db,writer,c,active);await decide(db,ownerId,ownerId,c.id,true);}
  await db.query('UPDATE pc_config SET value=$1 WHERE slot=1',[JSON.stringify({...defaultSettings,rpChannels:channel})]);
  await savePosting(db,writer,{kind:'default',channel,characterId:second});
  let next=BigInt(post),seen:any;
  const speak=async(content:string)=>{
    seen=null;const id=String(next++),posted=String(next++);
    await relay(db,config,{id,channel:thread,parent:channel,guild,author:writerId,roles:[],content},async p=>{seen=p;return posted;},async()=>{});
    return posted;
  };
  await speak('On my way.');assert.equal(seen.name,'Rin');
  await speak('test-The embers stir.');assert.deepEqual(seen,{name:'Test',content:'The embers stir.',portrait:'https://art.test/base.png'});
  await speak('TEST-> A quoted line.');assert.equal(seen.content,'> A quoted line.');
  await speak('unknown> Hello');assert.equal(seen.content,'unknown> Hello');assert.equal(seen.name,'Rin');
  const coverage={divider:'',channels:[channel,thread]};
  await savePosting(db,writer,{kind:'default',channel:thread,characterId:first},coverage);
  await speak('Thread post.');assert.equal(seen.name,'Test');
  await savePosting(db,writer,{kind:'default',channel:thread,characterId:'',account:true},coverage);
  await speak('Thread post.');assert.equal(seen,null);
  await savePosting(db,writer,{kind:'default',channel:thread,characterId:''},coverage);
  await speak('Inherited again.');assert.equal(seen.name,'Rin');
  const transform=(user:string,form:string)=>characterCommand(db,guild,config.dashboard,{type:2,guild_id:guild,member:{user:{id:user},roles:[]},data:{name:'transform',options:[{name:'character',value:'Test'},{name:'form',value:form}]}});
  assert.match((await transform(ownerId,'Awakening')).data.content,/one of your/);
  assert.match((await transform(writerId,'Unattained')).data.content,/Choose an attained/);
  const transformed=await transform(writerId,'Awakening');assert.equal(transformed.data.flags,64);
  const message=await speak('test- A different light.');assert.equal(seen.portrait,form.portrait);
  const sheet=await characterCommand(db,guild,config.dashboard,{type:2,guild_id:guild,channel_id:thread,member:{user:{id:ownerId}},data:{name:'Character sheet',target_id:message}});
  assert.equal(sheet.data.embeds[0].fields[0].value,'1250');assert.equal(sheet.data.embeds[0].fields[1].value,'Awakening');
  await transform(writerId,'base');await speak('test- Quiet.');assert.equal(seen.portrait,'https://art.test/base.png');
  assert.equal((await lookupAuthor(db,owner,'https://discord.com/channels/'+guild+'/'+thread+'/'+message,guild)).authorId,writerId);
  assert.match(accountAvatar({id:writerId,username:'test',avatar:'a_123abc'}),/a_123abc\.gif/);
  assert.match(accountAvatar({id:writerId,username:'test'}),/embed\/avatars\/[0-5]\.png/);
});
test('owner archive pauses approvals and character removal preserves attribution without affecting siblings',async t=>{
  const db=await dbFor(t),id=randomUUID(),sibling=randomUUID();
  for(const [i,name] of [[id,'One'],[sibling,'Two']]){
    await propose(db,writer,{id:i,kind:'create',reason:'Roster',fields:{name,bpl:'12',strengths:'a\nb\nc',weaknesses:'d\ne\nf'}},active);
    await decide(db,ownerId,ownerId,i,true);
  }
  const edit=await propose(db,writer,{id:randomUUID(),kind:'edit',characterId:id,version:1,fields:{bio:'A new chapter'},reason:'Lore'},active);
  await assert.rejects(archiveRequest(db,writer,edit.id,true),/Only the configured owner/);
  await archiveRequest(db,owner,edit.id,true);await assert.rejects(decide(db,ownerId,ownerId,edit.id,true),/archived/);
  await archiveRequest(db,owner,edit.id,false);
  assert.equal((await decide(db,ownerId,ownerId,edit.id,true)).status,'approved');
  const claim=await propose(db,writer,{id:randomUUID(),kind:'edit',characterId:id,version:2,fields:{tag:'rp',bio:'One more chapter'},reason:'Change'},active);
  await archiveRequest(db,owner,claim.id,true);
  await db.query('INSERT INTO pc_posts VALUES($1,$2,$3,$4,$5,$6,$7)',[thread,post,channel,writerId,id,'One',1]);
  await assert.rejects(removeCharacter(db,writer,id,2),/Only the configured/);
  await assert.rejects(removeCharacter(db,owner,id,1),/changed/);
  await removeCharacter(db,owner,id,2);await archiveRequest(db,owner,claim.id,false);
  assert.equal((await decide(db,ownerId,ownerId,claim.id,true)).status,'stale');
  assert.equal((await db.query('SELECT id FROM pc_characters'))[0].id,sibling);
  assert.equal((await lookupAuthor(db,owner,post)).characterName,'One');
});
