import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSqlite, openPostgres, initialize, type Store } from './db.ts';
import { decide,judgeTraining, actorFor, discordId, Problem, requireThat, readSettings, saveSettings, propose, visibleRequest } from './domain.ts';
import { mediaPath, maxImageBytes, saveImage } from './media.ts';
import {provisionNext} from './forum-threads.ts';
import { RoleplayScope } from './scope.ts';
import { preferences, savePosting, lookupAuthor, startPosting } from './posting.ts';
import {archiveRequest,deleteArchived,removeCharacter} from './characters.ts';
import { accountAvatar, Discord, DiscordFailure, CommandRegistrationError, deliverNext, checkSignature, handleInteraction, type Config } from './discord.ts';

import {nicknameJob,announcement} from './bot-tools.ts';
import {bankAction,visibleAccounts,statement} from './economy.ts';
import { seedAzurik,ruleSheet,isAzurik } from './npc-catalog.ts';
import { aiOptions } from './npc-voice.ts';
import {expireTurn,deliverTurnNotice,restoreTurnClocks} from './npc-turns.ts';
import { deliverScene,sendNpcPost } from './npc-delivery.ts';
import {assess} from './review-rules.ts';
import {deliverOwnerDenial} from './review-delivery.ts';
import {editorRole, published, publish,racePaths} from './codex.ts';
const webDir=fileURLToPath(new URL('../../phoenixcore/',import.meta.url));
const token=()=>randomBytes(32).toString('base64url');
export const hash=(value:string)=>createHash('sha256').update(value).digest('base64url');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const allowedFiles=new Set(['index.html','config.js','app.js','templates.js','preview.js','styles.css']);
const codexAssets=new Set(['/assets/brand.png','/assets/art/world-planet-sadala.svg','/assets/themes.js','/assets/themes.css','/assets/data.js','/assets/content-model.js','/assets/live.js','/assets/live.css','/assets/editor.js']);
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};

function safeUrl(value:string, name:string) {
  const u=new URL(value);
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if ((u.protocol!=='https:' && !(local && u.protocol==='http:')) || u.hash || u.search || u.username || u.password) throw new Error('Invalid '+name+'. Use HTTPS, or HTTP on localhost.');
  return u;
}
export function configuration(env=process.env):Config {
  const required=['DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_PUBLIC_KEY','DISCORD_GUILD_ID','DISCORD_OWNER_ID','SERVICE_ORIGIN','DASHBOARD_URL'];
  const botToken=env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN;
  if(!botToken) throw new Error('Set DISCORD_BOT_TOKEN in the private service environment.');
  for (const key of required) if (!env[key]) throw new Error('Set '+key+' in the private service environment.');
  for(const key of ['DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DISCORD_OWNER_ID']) if (!discordId.test(env[key]!)) throw new Error('Invalid '+key);
  if (!/^[0-9a-f]{64}$/i.test(env.DISCORD_PUBLIC_KEY!)) throw new Error('Invalid DISCORD_PUBLIC_KEY');
  const service=safeUrl(env.SERVICE_ORIGIN!,'SERVICE_ORIGIN');
  if (service.pathname!=='/') throw new Error('SERVICE_ORIGIN must be an origin without a path.');
  const site=safeUrl(env.DASHBOARD_URL!,'DASHBOARD_URL');
  if(!site.pathname.endsWith('/')) throw new Error('DASHBOARD_URL must end in the dashboard directory and a trailing slash.');
  return {service:service.origin,dashboard:site.href,clientId:env.DISCORD_CLIENT_ID!,clientSecret:env.DISCORD_CLIENT_SECRET!,publicKey:env.DISCORD_PUBLIC_KEY!,
    token:botToken,guild:env.DISCORD_GUILD_ID!,owner:env.DISCORD_OWNER_ID!};
}
function json(res:ServerResponse,status:number,body:any) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}
async function rawBody(req:IncomingMessage, limit=384000) {
  const parts:Buffer[]=[];
  let length=0;
  for await (const part of req) {
    length+=part.length;
    requireThat(length<=limit,413,'Submission is too large.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
function parse(raw:Buffer) {
  try { return JSON.parse(raw.toString('utf8')); } catch {throw new Problem(400,'Expected JSON.');}
}
function cookie(req:IncomingMessage, name:string) {
  return (req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'';
}
function redirect(res:ServerResponse,location:string) {
  res.writeHead(302,{location});res.end();
}

export function application(db:Store, config:Config, discord=new Discord(config), scope=new RoleplayScope(config.guild),wake=()=>{}) {
  const uiOrigin=new URL(config.dashboard).origin;
  const cookieName='pc_login';
  const cookieFlags='; Path=/auth; HttpOnly; SameSite=Lax'+(config.service.startsWith('https:')?'; Secure':'');
  return createServer(async(req,res)=>{
    try {
      const url=new URL(req.url??'/',config.service);
      const path=url.pathname;
      const method=req.method;
      const origin=req.headers.origin;
      res.setHeader('cache-control','no-store');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('x-frame-options','DENY');
      if(path.startsWith('/api/')) {
        res.setHeader('vary','Origin');
        if (origin) {
          requireThat(origin===uiOrigin,403,'This dashboard origin is not configured.');
          res.setHeader('access-control-allow-origin',uiOrigin);
        }
        if (method==='OPTIONS') {
          res.writeHead(204,{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, Authorization','access-control-max-age':'300'});
          res.end();return;
        }
        if(method==='POST') {
          requireThat(origin===uiOrigin,403,'Open the configured Codex dashboard.');
          if(path==='/api/media') requireThat(['image/png','image/jpeg','image/gif','image/webp','application/octet-stream'].includes(req.headers['content-type']?.split(';')[0]||''),415,'Choose a PNG, JPEG, WebP or GIF file.');
          else requireThat(req.headers['content-type']?.split(';')[0]==='application/json',415,'Use JSON.');
        }
      }
      if(method==='GET' && path==='/api/codex'){json(res,200,{entries:await published(db)});return;}
      const media=mediaPath.exec(path);
      if(media && (method==='GET'||method==='HEAD')){
        const [image]=await db.query('SELECT bytes,mime,size FROM pc_images WHERE id=$1',[media[1]]);
        requireThat(image,404,'Image unavailable.');
        res.writeHead(200,{'content-type':image.mime,'content-length':image.size,'cache-control':'public, max-age=86400, immutable','content-security-policy':"default-src 'none'; sandbox"});
        res.end(method==='HEAD'?undefined:Buffer.from(image.bytes));return;
      }
      if(method==='GET' && path==='/health/roleplay'){
        json(res,200,{feature:'npc-scenes-v2',gateway:scope.online(),commandsRegistered:scope.npcCommandsReady,dialogue:aiOptions()?'guided-and-ai':'guided'});return;
      }
      if (method==='GET' && path==='/health') {json(res,200,{ok:true});return;}
      if(method==='GET' && uiOrigin!==config.service && ['/','/phoenixcore','/phoenixcore/','/phoenixcore/index.html'].includes(path)){
        redirect(res,config.dashboard+(url.searchParams.get('demo')==='1'?'?demo=1':''));return;
      }
      if (method==='GET' && (path==='/'||path==='/phoenixcore')) {redirect(res,'/phoenixcore/');return;}
      if (method==='GET' && (codexAssets.has(path) || /^\/assets\/uploads\/[a-zA-Z0-9_/-]+\.(png|jpe?g|webp|gif)$/i.test(path))) {
        let content;
        try { content=await readFile(resolve(webDir,'..','.'+path)); }
        catch { throw new Problem(404,'Codex asset missing from this checkout.'); }
        const images:Record<string,string>={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
        res.writeHead(200,{'content-type':mime[extname(path)]||images[extname(path).toLowerCase()]});res.end(content);return;
      }
      if (method==='GET' && path.startsWith('/phoenixcore/')) {
        const file=path.slice('/phoenixcore/'.length)||'index.html';
        requireThat(allowedFiles.has(file),404,'Unknown dashboard file.');
        const content = file==='config.js' ? 'window.PHOENIXCORE_API='+JSON.stringify(config.service)+';' : await readFile(resolve(webDir,file));
        res.writeHead(200,{'content-type':mime[extname(file)]});res.end(content);return;
      }
      if (method==='GET' && path==='/auth/start') {
        const challenge=url.searchParams.get('challenge')??'';
        requireThat(tokenPattern.test(challenge),400,'Start sign-in from the dashboard.');
        const state=token(),binding=token();
        await db.query('INSERT INTO pc_auth_state VALUES($1,$2,$3,$4)',[hash(state),hash(binding),challenge,Date.now()+600000]);
        res.setHeader('set-cookie',cookieName+'='+binding+cookieFlags+'; Max-Age=600');
        redirect(res,discord.authorizeUrl(state));return;
      }
      if (method==='GET' && path==='/auth/callback') {
        const state=url.searchParams.get('state')??'';
        const binding=cookie(req,cookieName);
        requireThat(tokenPattern.test(state)&&tokenPattern.test(binding),403,'Sign-in expired. Return to the dashboard and try again.');
        const [saved]=await db.query('DELETE FROM pc_auth_state WHERE id=$1 AND binding=$2 AND expires>$3 RETURNING *',[hash(state),hash(binding),Date.now()]);
        res.setHeader('set-cookie',cookieName+'='+cookieFlags+'; Max-Age=0');
        requireThat(saved,403,'That sign-in has expired.');
        if(url.searchParams.has('error')){redirect(res,config.dashboard+'#login-cancelled');return;}
        const issuer=url.searchParams.get('iss');
        requireThat(issuer===null||issuer==='https://discord.com',403,'Sign-in issuer is invalid.');
        const code=url.searchParams.get('code');
        requireThat(code,400,'Missing sign-in code.');
        const userId=await discord.identify(code);
        try {await discord.member(userId);} catch(e) {if(e instanceof Problem&&e.status===403){redirect(res,config.dashboard+'#member-required');return;}throw e;}
        const ticket=token();
        await db.query('INSERT INTO pc_exchanges VALUES($1,$2,$3,$4)',[hash(ticket),userId,saved.challenge,Date.now()+90000]);
        redirect(res,config.dashboard+'#login='+ticket);return;
      }
      if(method==='POST' && path==='/api/exchange') {
        const data=parse(await rawBody(req));
        requireThat(tokenPattern.test(data?.ticket??'') && tokenPattern.test(data?.verifier??''),403,'Invalid sign-in.');
        const session=token();
        await db.transaction(async q=>{
          const [handoff]=await q('DELETE FROM pc_exchanges WHERE id=$1 AND challenge=$2 AND expires>$3 RETURNING user_id',[hash(data.ticket),hash(data.verifier),Date.now()]);
          requireThat(handoff,403,'Sign-in expired. Sign in again.');
          await q('INSERT INTO pc_sessions VALUES($1,$2,$3)',[hash(session),handoff.user_id,Date.now()+30*86400000]);
        });
        json(res,200,{session});return;
      }
      if (method==='POST' && path==='/discord/interactions') {
        const raw=await rawBody(req);
        requireThat(checkSignature(raw,String(req.headers['x-signature-ed25519']??''),String(req.headers['x-signature-timestamp']??''),config.publicKey),401,'Invalid Discord signature.');
        const action=parse(raw);
        const deferred=(work:()=>Promise<string>)=>setImmediate(async()=>{
          let content;try{content=await work();wake();}catch{content=action.data?.name==='roleplay-start'?'PhoenixCore could not open this scene. Try /roleplay-start again.':'PhoenixCore could not catalog this post. Open the original message and try again.';}
          try{await discord.call('/webhooks/'+config.clientId+'/'+encodeURIComponent(action.token)+'/messages/@original',{method:'PATCH',body:JSON.stringify({content,components:[],allowed_mentions:{parse:[]}})});}catch{console.warn('Discord could not display the interaction result.');}
        });
        json(res,200,await handleInteraction(db,config,action,discord,deferred,scope));if(action.type===3)wake();return;
      }
      requireThat(path.startsWith('/api/'),404,'Unknown route.');
      const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
      requireThat(bearer,401,'Sign in to Convergence.');
      const sessionId=hash(bearer[1]);
      const [session]=await db.query('SELECT user_id,expires FROM pc_sessions WHERE id=$1 AND expires>$2',[sessionId,Date.now()]);
      requireThat(session,401,'Session ended. Sign in again.');
      if(method==='POST' && path==='/api/logout') {
        await db.query('DELETE FROM pc_sessions WHERE id=$1',[sessionId]);json(res,200,{ok:true});return;
      }
      const [member,settings]=await Promise.all([discord.member(session.user_id),readSettings(db)]);
      if(Number(session.expires)<Date.now()+29*86400000)await db.query('UPDATE pc_sessions SET expires=$1 WHERE id=$2',[Date.now()+30*86400000,sessionId]);
      const actor=actorFor(session.user_id,member.roles,config.owner,settings.value);
      if(path==='/api/codex/access' && method==='GET'){json(res,200,{canEdit:member.roles.includes(editorRole)});return;}
      if(path==='/api/codex' && method==='POST'){json(res,200,await publish(db,member.roles,actor.id,parse(await rawBody(req)),config.service));return;}
      if(method==='POST' && path==='/api/media'){
        requireThat(actor.isPlayer||member.roles.includes(editorRole),403,'A current player or Codex editor can upload artwork.');
        const image=await saveImage(db,actor.id,await rawBody(req,maxImageBytes),config.service);
        json(res,201,{url:image});return;
      }
      if(method==='GET' && path==='/api/posting/scope'){
        json(res,200,await scope.inventory(settings.value,actor));return;
      }
      if (method==='POST' && path==='/api/settings') {
        await saveSettings(db,actor,parse(await rawBody(req)));wake();json(res,200,{ok:true});return;
      }
      if(method==='POST'&&path==='/api/announcements'){
        json(res,200,await announcement(db,discord,actor,parse(await rawBody(req))));return;
      }
      const decision=/^\/api\/requests\/([\da-f-]{36})\/decision$/.exec(path);
      if(method==='POST'&&decision){
        const input=parse(await rawBody(req));requireThat(['approve','decline','uphold','veto'].includes(input?.action),400,'Choose a review action.');
        const action=input.action,result=await decide(db,actor.id,config.owner,decision[1],action==='approve',member.roles,['uphold','veto'].includes(action)?action:'review',input.note??'',input.decisionKey??'');
        json(res,200,{id:result.id,status:result.status});wake();return;
      }
      const ownerAction=/^\/api\/(requests|characters)\/([\da-f-]{36})\/(archive|remove)$/.exec(path);
      if(method==='POST'&&ownerAction){
        requireThat(actor.isOwner,403,'Only the configured PhoenixCore owner can make this change.');
        const input=parse(await rawBody(req));
        if(ownerAction[1]==='requests'&&ownerAction[3]==='archive'&&typeof input?.archived==='boolean')await archiveRequest(db,actor,ownerAction[2],input.archived);
        else if(ownerAction[1]==='requests'&&ownerAction[3]==='remove')await deleteArchived(db,actor,ownerAction[2]);
        else if(ownerAction[1]==='characters'&&ownerAction[3]==='remove')await removeCharacter(db,actor,ownerAction[2],input?.version);
        else throw new Problem(400,'Unknown owner action.');
        json(res,200,{ok:true});wake();return;
      }
      if(method==='POST' && path==='/api/posting'){
        const input=parse(await rawBody(req));
        const coverage=input?.kind==='default'?{divider:settings.value.rpDivider,channels:(await scope.inventory(settings.value,actor)).locations.map(c=>c.id)}:undefined;
        await savePosting(db,actor,input,coverage);json(res,200,{ok:true});return;
      }
      if(method==='GET' && path.startsWith('/api/posting/lookup/')){
        json(res,200,await lookupAuthor(db,actor,decodeURIComponent(path.slice('/api/posting/lookup/'.length)),config.guild));return;
      }
      if(method==='POST'&&path==='/api/favorites'){
        const input=parse(await rawBody(req));
        requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&typeof input.characterId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.characterId)&&typeof input.favorite==='boolean',400,'Choose a character and favorite status.');
        requireThat(Object.keys(input).every(key=>['characterId','favorite'].includes(key)),400,'Unsupported favorite change.');
        await db.transaction(async q=>{
          if(input.favorite){
            const [c]=await q('SELECT id FROM pc_characters WHERE id=$1',[input.characterId]);
            requireThat(c,404,'The character was removed.');
            await q('INSERT INTO pc_character_favorites(user_id,character_id,created_ms) VALUES($1,$2,$3) ON CONFLICT(user_id,character_id) DO NOTHING',[actor.id,input.characterId,Date.now()]);
          }else await q('DELETE FROM pc_character_favorites WHERE user_id=$1 AND character_id=$2',[actor.id,input.characterId]);
        });
        json(res,200,{ok:true});return;
      }
      if(method==='POST'&&path==='/api/economy/bank'){
        const result=await bankAction(db,actor,parse(await rawBody(req)));
        json(res,200,result);return;
      }
      const statementMatch=new RegExp('^/api/economy/characters/([0-9a-f-]{36})/statement$').exec(path);
      if(method==='GET'&&statementMatch){
        json(res,200,{transactions:await statement(db,actor,statementMatch[1])});return;
      }
      const roster=(await discord.members()).filter(m=>!settings.value.playerRole||m.roles.includes(settings.value.playerRole));
      const active=new Set(roster.map(m=>m.user.id));
      const completion=/^\/api\/requests\/([\da-f-]{36})\/complete$/.exec(path);
      if(method==='POST'&&completion){
        const [native]=await db.query('SELECT n.author_id,r.status,r.kind FROM pc_native n JOIN pc_requests r ON r.id=n.id WHERE n.id=$1',[completion[1]]);
        requireThat(native&&(actor.id===native.author_id||actor.isJudge),403,'Only the writer or a Helper can complete a Discord submission.');
        const author=roster.find(m=>m.user.id===native.author_id),input=parse(await rawBody(req,1048576));
        requireThat(author&&native.status==='needs_details'&&input.kind===native.kind,409,'Open the current Discord submission.');
        const result=await propose(db,actorFor(author.user.id,author.roles,config.owner,settings.value),{...input,id:completion[1]},active,config.service,true,actor.id);
        json(res,200,{id:result.id,status:result.status});wake();return;
      }
      if (method==='POST' && path==='/api/requests') {
        const r=await propose(db,actor,parse(await rawBody(req,1048576)),active,config.service);
        json(res,200,{id:r.id,status:r.status});wake();return;
      }
      const judgment=/^\/api\/requests\/([\da-f-]{36})\/judgment$/.exec(path);
      if(method==='POST' && judgment) {
        const r=await judgeTraining(db,actor,judgment[1],parse(await rawBody(req)),active);
        json(res,200,{id:r.id,status:r.status});wake();return;
      }
      requireThat(method==='GET' && path==='/api/state',404,'Unknown route.');
      const inventory=await scope.inventory(settings.value,actor);
      const [sheets,requests,designs,posting,threads,races,embeds,nick,pathEntries,favorites,accounts]=await Promise.all([
        db.query('SELECT c.*,t.tag,a.form_key FROM pc_characters c LEFT JOIN pc_active_forms a ON a.character_id=c.id LEFT JOIN pc_post_tags t ON c.id=t.character_id AND c.owner_id=t.owner_id ORDER BY c.id'),
        db.query('SELECT r.*,a.request_id AS archived,p.channel_id AS review_channel,p.message_id AS review_message,n.source_id,n.channel_id AS source_channel,n.raw_text,n.input AS native_input,n.attachments,d.helper,d.decision_key,d.note AS denial_note,d.dm_message FROM pc_requests r LEFT JOIN pc_native n ON n.id=r.id LEFT JOIN pc_denials d ON d.request_id=r.id LEFT JOIN pc_archives a ON a.request_id=r.id LEFT JOIN pc_review_posts p ON p.request_id=r.id '+(actor.isJudge?'':'WHERE r.author_id=$1 OR r.owner_id=$1 ')+'ORDER BY r.created_ms DESC,r.id',actor.isJudge?[]:[actor.id]),
        db.query("SELECT id,kind,fields AS after_sheet,author_id FROM pc_designs ORDER BY id"),
        actor.isPlayer?preferences(db,actor,settings.value,inventory.locations.map(c=>c.id)):null,
        db.query("SELECT subject,thread_id FROM pc_forum_threads WHERE forum_id=$1 AND thread_id IS NOT NULL AND subject LIKE 'player:%'"+(actor.isJudge?'':' AND subject=$2'),actor.isJudge?[settings.value.updatesForum]:[settings.value.updatesForum,'player:'+actor.id]),
        racePaths(db.query),actor.isOwner?db.query('SELECT * FROM pc_announcements'):[],actor.isOwner?db.query('SELECT status FROM pc_bot_profile WHERE slot=1'):[],member.roles.includes(editorRole)?published(db):[],db.query('SELECT character_id FROM pc_character_favorites WHERE user_id=$1',[actor.id]),visibleAccounts(db,actor)
      ]);
      const king=sheets.find(row=>isAzurik(row.id,JSON.parse(row.sheet)));
      if(king)king.sheet=JSON.stringify(await ruleSheet(db.query,king.id,JSON.parse(king.sheet)));
      const forumLinks=new Map(threads.map(t=>[t.subject,'https://discord.com/channels/'+config.guild+'/'+t.thread_id]));
      json(res,200,{actor,races,economyAccounts:accounts,favoriteCharacterIds:favorites.map(row=>row.character_id),canEditPaths:member.roles.includes(editorRole),pathRevisions:Object.fromEntries(pathEntries.map(x=>[x.key,x.revision])),announcements:embeds.map(e=>({kind:e.kind,revision:Number(e.revision),draft:JSON.parse(e.draft),url:e.message_id?'https://discord.com/channels/'+config.guild+'/'+e.channel_id+'/'+e.message_id:null})),nicknameStatus:nick[0]?.status,players:roster.map(m=>({id:m.user.id,username:m.user.username,updatesUrl:forumLinks.get('player:'+m.user.id),avatar:accountAvatar(m.user),display:m.nick||m.user.global_name||m.user.username})),
        characters:sheets.filter(s=>active.has(s.owner_id)||JSON.parse(s.sheet).characterType==='NPC').map(s=>{const sheet=JSON.parse(s.sheet);if(!actor.isJudge&&s.owner_id!==actor.id)delete sheet.wallet;return {id:s.id,ownerId:s.owner_id,version:s.revision,tag:s.tag||'',activeForm:s.form_key||'',sheet};}),
        posting,scope:inventory,catalogue:designs.map(d=>({id:d.id,kind:d.kind,fields:JSON.parse(d.after_sheet),authorId:d.author_id})),requests:requests.map(r=>({...visibleRequest(r),...(r.source_id?{native:{source:'https://discord.com/channels/'+config.guild+'/'+r.source_channel+'/'+r.source_id,text:r.raw_text,input:JSON.parse(r.native_input),attachments:JSON.parse(r.attachments)}}:{}),...(actor.isJudge?{assessment:assess(visibleRequest(r),settings.value),denial:r.helper?{helper:r.helper,key:r.decision_key,note:r.denial_note,delivered:!!r.dm_message}:null}:{}),reviewUrl:r.review_message?'https://discord.com/channels/'+config.guild+'/'+r.review_channel+'/'+r.review_message:undefined})),currency:settings.value.currency,settings:actor.isOwner?settings:null});
    } catch(e) {
      if (res.headersSent) {res.end();return;}
      if (e instanceof Problem) json(res,e.status,{error:e.message});
      else if (e instanceof DiscordFailure) json(res,503,{error:'Discord is unavailable ('+e.status+'). Check bot installation and Server Members Intent, then retry.'});
      else {console.error('PhoenixCore request failed:',e instanceof Error?e.name:'Unknown error');json(res,500,{error:'PhoenixCore could not complete the request. Please retry.'});}
    }
  });
}

async function start() {
  const config=configuration();
  const db=process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : openSqlite(process.env.SQLITE_FILE||resolve(homedir(),'.phoenixcore','convergence.sqlite'));
  await initialize(db,config.guild);
  await seedAzurik(db,config.owner);
  await restoreTurnClocks(db);
  const discord=new Discord(config);
  const scope=new RoleplayScope(config.guild);
  const server=application(db,config,discord,scope,()=>{void tick();});
  let stopPosting:(()=>unknown)|undefined, retry:ReturnType<typeof setTimeout>|undefined, stopping=false;
  async function connect(){
    try {
      const stop=await startPosting(db,config,scope);
      if(stopping)stop();else stopPosting=stop;
    }catch{
      console.warn('Discord RP connection failed. Check the bot token and Message Content Intent. Retrying in one minute.');
      if(!stopping)retry=setTimeout(connect,60000);
    }
  }
  if(process.env.DISCORD_RP_ENABLED==='true')void connect();
  let working=false;
  async function tick() {
    if(working) return;
    working=true;
    try {
      const {value}=await readSettings(db);
      await deliverOwnerDenial(db,discord);
      await nicknameJob(db,discord);
      await provisionNext(db,discord,value.updatesForum);
      for(let i=0;i<8;i++) if(!await deliverNext(db,discord)) break;
    }
    catch(e) {console.error('Review delivery check failed:',e instanceof Error?e.name:'Unknown error');}
    finally {working=false;}
  }
  const eligibleNpcChannel=async(channel:any)=>{
    const {value}=await readSettings(db);
    return scope.interactionEligible(value,{guild_id:config.guild,channel_id:channel.id,channel});
  };
  let deliveringNpc=false,checkingTurns=false;
  const turnClock=setInterval(async()=>{
    if(checkingTurns||stopping)return;
    checkingTurns=true;
    try{
      for(let i=0;i<8;i++)if(!await expireTurn(db))break;
      for(let i=0;i<8;i++)if(!await deliverTurnNotice(db,async(id,payload)=>{
        const channel=await discord.guildChannel(id);
        if(!await eligibleNpcChannel(channel))throw new Error('Outside current RP scope');
        return discord.call('/channels/'+id+'/messages',{method:'POST',body:JSON.stringify(payload)});
      }))break;
    }catch{console.warn('NPC turn announcements will retry.');}
    finally{checkingTurns=false;}
  },1500);
  const npcClock=setInterval(async()=>{
    if(deliveringNpc||stopping)return;
    deliveringNpc=true;
    try{for(let i=0;i<4;i++)if(!await deliverScene(db,(s,move,retry)=>sendNpcPost(discord,s,move,retry,eligibleNpcChannel)))break;}
    catch{console.warn('NPC scene delivery will retry.');}
    finally{deliveringNpc=false;}
  },1500);
  const notify=setInterval(tick,4000);
  const cleanup=setInterval(async()=>{
    try {await db.query('DELETE FROM pc_rp_receipts WHERE created_ms<$1',[Date.now()-86400000]);
      await db.query('DELETE FROM pc_images WHERE attached=0 AND created_ms<$1',[Date.now()-86400000]);
      for(const table of ['pc_sessions','pc_auth_state','pc_exchanges']) await db.query('DELETE FROM '+table+' WHERE expires<=$1',[Date.now()]);}
    catch {console.error('Expired login cleanup will retry.');}
  },3600000);
  const port=Number(process.env.PORT || process.env.SERVER_PORT || 4100);
  server.listen(port,()=>{
    const address=server.address();
    console.log('PhoenixCore is listening on port',typeof address==='object' && address ? address.port : port);
    if(process.env.DISCORD_RP_ENABLED==='true'){
      const register=async()=>{
        if(stopping)return;
        try {
          await discord.registerCommands();
          scope.npcCommandsReady=true;
          console.log('Verified /roleplay-start, /finish-turn, /roleplay-status, /roleplay-cancel and character commands in Convergence.');
        } catch(error) {
          const retryMs=error instanceof CommandRegistrationError && error.retryMs ? error.retryMs+500 : 15000;
          console.warn('Guild command registration: '+(error instanceof CommandRegistrationError?error.message:'unavailable')+'; retry in '+Math.ceil(retryMs/1000)+'s.');
          if(!stopping)setTimeout(register,Math.min(retryMs,2147483647)).unref();
        }
      };
      void register();
    }
    void tick();
  });
  const stop=()=>{stopping=true;clearTimeout(retry);if(stopPosting)void stopPosting();clearInterval(npcClock);clearInterval(turnClock);clearInterval(notify);clearInterval(cleanup);server.close(()=>{void db.close();});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
export function main() {
  start().catch(e=>{console.error(e.message);process.exitCode=1;});
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
