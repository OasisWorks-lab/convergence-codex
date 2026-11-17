import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {once} from 'node:events';
import {openSqlite,initialize,defaultSettings} from '../src/db.ts';
import {application,hash,configuration} from '../src/server.ts';
import {Discord,deliverNext,type Config} from '../src/discord.ts';

test('Codex sign-in, current directory, player edit, Discord approval, and staff award through HTTP',async t=>{
  const db=openSqlite(':memory:');
  const ids={guild:'800000000000000001',owner:'800000000000000002',writer:'800000000000000003',judge:'800000000000000004',extra:'800000000000000005',app:'800000000000000006',role:'800000000000000007'};
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const config:Config={service:'http://localhost:4100',dashboard:'https://codex.example/convergence-codex/phoenixcore/',owner:ids.owner,guild:ids.guild,clientId:ids.app,
    publicKey:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),clientSecret:'example',token:'bot-test'};
  const origin=new URL(config.dashboard).origin;
  await initialize(db,ids.guild);
  const members=Object.entries(ids).filter(([k])=>['writer','owner','judge','extra'].includes(k)).map(([k,id])=>({user:{id,username:k,global_name:k.toUpperCase()},roles:k==='judge'?[ids.role]:[]}));
  const delivered:any[]=[];
  const discord=new Discord(config,async(u,init)=>{
    const path=new URL(String(u)).pathname;
    if(path.endsWith('/oauth2/token')) return Response.json({access_token:new URLSearchParams(String(init?.body)).get('code')});
    if(path.endsWith('/users/@me')) return Response.json({id:new Headers(init?.headers).get('Authorization')!.slice(7)});
    if(path.endsWith('/members'))return Response.json(members);
    if(path.includes('/members/')){const m=members.find(x=>x.user.id===path.split('/').pop());return Response.json(m||{}, {status:m?200:404});}
    if(path.endsWith('/users/@me/channels'))return Response.json({id:'testdm'});
    if(path.endsWith('/testdm/messages')){delivered.push(JSON.parse(String(init?.body)));return Response.json({id:'testmessage'});}
    throw Error('Unexpected fixture route '+path);
  });
  const server=application(db,config,discord);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise<void>(res=>server.close(()=>res()));await db.close();});
  const base='http://127.0.0.1:'+((server.address()) as any).port;
  const get=(p:string,opts:RequestInit={})=>fetch(base+p,{redirect:'manual',...opts});
  const post=(p:string,body:any,s='',from=origin)=>get(p,{method:'POST',headers:{origin:from,'content-type':'application/json',...(s?{Authorization:'Bearer '+s}:{})},body:JSON.stringify(body)});
  async function login(id:string) {
    const verifier=randomBytes(32).toString('base64url');
    const a=await get('/auth/start?challenge='+hash(verifier));
    const auth=new URL(a.headers.get('location')!);
    assert.equal(auth.origin,'https://discord.com');assert.equal(auth.searchParams.get('scope'),'identify');
    const cookie=a.headers.get('set-cookie')!.split(';')[0];
    const callback='/auth/callback?state='+auth.searchParams.get('state')+'&code='+id;
    assert.equal((await get(callback)).status,403);
    const cb=await get(callback,{headers:{cookie}});
    const uri=new URL(cb.headers.get('location')!);
    if(uri.hash==='#member-required')return '';
    assert.equal(uri.origin,origin);const ticket=uri.hash.slice(7);
    assert.equal((await post('/api/exchange',{ticket,verifier:'x'.repeat(43)})).status,403);
    const exchange=await post('/api/exchange',{ticket,verifier});assert.equal(exchange.status,200);
    assert.equal((await post('/api/exchange',{ticket,verifier})).status,403);
    return (await exchange.json()).session;
  }
  async function state(s:string){const res=await get('/api/state',{headers:{Authorization:'Bearer '+s,origin}});assert.equal(res.status,200);return res.json();}
  async function click(user:string,custom:string){
    const stamp=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({type:3,application_id:ids.app,user:{id:user},data:{custom_id:custom}});
    const signature=sign(null,Buffer.from(stamp+body),privateKey).toString('hex');
    return (await get('/discord/interactions',{method:'POST',headers:{'x-signature-timestamp':stamp,'x-signature-ed25519':signature},body})).json();
  }
  assert.equal((await get('/api/state')).status,401);
  assert.equal(await login('899999999999999999'),'');
  const writer=await login(ids.writer),owner=await login(ids.owner),judge=await login(ids.judge),extra=await login(ids.extra);
  const start=await state(writer);assert.equal(start.players.length,4);assert.equal(start.settings,null);
  const cfg={revision:1,value:{...defaultSettings,judgeRole:ids.role}};
  assert.equal((await post('/api/settings',cfg,judge)).status,403);
  assert.equal((await post('/api/settings',cfg,owner,'https://wrong.example')).status,403);
  assert.equal((await post('/api/settings',cfg,owner)).status,200);
  assert.equal((await state(judge)).actor.isJudge,true);
  const form={id:randomUUID(),kind:'create',fields:{name:'Rin',bpl:'10000'},reason:'First sheet'};
  assert.equal((await post('/api/requests',form,writer)).status,200);
  assert.equal((await state(extra)).requests.length,0);
  assert.equal((await state(owner)).requests.length,1);assert.equal((await state(owner)).characters.length,0);
  await deliverNext(db,discord);
  const control=delivered[0].components[0].components[0].custom_id;
  assert.equal((await click(ids.judge,control)).type,4);
  assert.equal((await click(ids.owner,control)).type,7);
  assert.equal((await state(writer)).characters[0].sheet.name,'Rin');
  const edit={id:randomUUID(),kind:'edit',characterId:form.id,version:1,fields:{strength:'Patient and precise'},reason:'Correct description'};
  assert.equal((await post('/api/requests',edit,extra)).status,403);
  assert.equal((await post('/api/requests',edit,writer)).status,200);
  assert.equal((await state(writer)).characters[0].sheet.strength,'');await deliverNext(db,discord);
  await click(ids.owner,delivered[1].components[0].components[0].custom_id);
  assert.equal((await state(writer)).characters[0].sheet.strength,'Patient and precise');
  const award={id:randomUUID(),kind:'award',characterId:form.id,version:2,award:{percent:'12.5',currency:'20',gear:['Journal']},reason:'Judged session'};
  assert.equal((await post('/api/requests',award,judge)).status,200);
  assert.equal((await state(writer)).characters[0].sheet.bpl,'10000');
  await deliverNext(db,discord);await click(ids.owner,delivered[2].components[0].components[0].custom_id);
  assert.equal((await state(writer)).characters[0].sheet.bpl,'11250');
  const filtered={revision:2,value:{...cfg.value,playerRole:ids.role}};
  assert.equal((await post('/api/settings',filtered,owner)).status,200);
  assert.deepEqual((await state(writer)).players.map((p:any)=>p.id),[ids.judge]);assert.equal((await state(writer)).characters.length,0);
  assert.equal((await post('/api/logout',{},writer)).status,200);assert.equal((await get('/api/state',{headers:{Authorization:'Bearer '+writer}})).status,401);
});
test('the service requires a fixed owner identity and an HTTPS or loopback origin',()=>{
  const env={SERVICE_ORIGIN:'https://service.example',DASHBOARD_URL:'https://codex.example/repo/phoenixcore/',DISCORD_CLIENT_ID:'111111111111111111',
    DISCORD_GUILD_ID:'222222222222222222',DISCORD_OWNER_ID:'333333333333333333',DISCORD_PUBLIC_KEY:'00'.repeat(32),DISCORD_TOKEN:'token',DISCORD_CLIENT_SECRET:'secret'};
  assert.equal(configuration(env).owner,env.DISCORD_OWNER_ID);
  assert.throws(()=>configuration({...env,DISCORD_OWNER_ID:''}),/Set DISCORD_OWNER_ID/);
  assert.throws(()=>configuration({...env,SERVICE_ORIGIN:'http://service.example'}),/Use HTTPS/);
});
