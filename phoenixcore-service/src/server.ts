import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSqlite, openPostgres, initialize, type Store } from './db.ts';
import { actorFor, discordId, Problem, requireThat, readSettings, saveSettings, propose, visibleRequest } from './domain.ts';
import { Discord, DiscordFailure, deliverNext, checkSignature, handleInteraction, type Config } from './discord.ts';

const webDir=fileURLToPath(new URL('../../phoenixcore/',import.meta.url));
const token=()=>randomBytes(32).toString('base64url');
export const hash=(value:string)=>createHash('sha256').update(value).digest('base64url');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const allowedFiles=new Set(['index.html','config.js','app.js','preview.js','styles.css']);
const codexAssets=new Set(['/assets/brand.png','/assets/art/world-planet-sadala.svg','/assets/themes.js','/assets/themes.css','/assets/data.js']);
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};

function safeUrl(value:string, name:string) {
  const u=new URL(value);
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if ((u.protocol!=='https:' && !(local && u.protocol==='http:')) || u.hash || u.search || u.username || u.password) throw new Error('Invalid '+name+'. Use HTTPS, or HTTP on localhost.');
  return u;
}
export function configuration(env=process.env):Config {
  const required=['DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_PUBLIC_KEY','DISCORD_TOKEN','DISCORD_GUILD_ID','DISCORD_OWNER_ID','SERVICE_ORIGIN','DASHBOARD_URL'];
  for (const key of required) if (!env[key]) throw new Error('Set '+key+' in the private service environment.');
  for(const key of ['DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DISCORD_OWNER_ID']) if (!discordId.test(env[key]!)) throw new Error('Invalid '+key);
  if (!/^[0-9a-f]{64}$/i.test(env.DISCORD_PUBLIC_KEY!)) throw new Error('Invalid DISCORD_PUBLIC_KEY');
  const service=safeUrl(env.SERVICE_ORIGIN!,'SERVICE_ORIGIN');
  if (service.pathname!=='/') throw new Error('SERVICE_ORIGIN must be an origin without a path.');
  const site=safeUrl(env.DASHBOARD_URL!,'DASHBOARD_URL');
  if(!site.pathname.endsWith('/')) throw new Error('DASHBOARD_URL must end in the dashboard directory and a trailing slash.');
  return {service:service.origin,dashboard:site.href,clientId:env.DISCORD_CLIENT_ID!,clientSecret:env.DISCORD_CLIENT_SECRET!,publicKey:env.DISCORD_PUBLIC_KEY!,
    token:env.DISCORD_TOKEN!,guild:env.DISCORD_GUILD_ID!,owner:env.DISCORD_OWNER_ID!};
}
function json(res:ServerResponse,status:number,body:any) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}
async function rawBody(req:IncomingMessage) {
  const parts:Buffer[]=[];
  let length=0;
  for await (const part of req) {
    length+=part.length;
    requireThat(length<=65536,413,'Submission is too large.');
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

export function application(db:Store, config:Config, discord=new Discord(config)) {
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
          requireThat(req.headers['content-type']?.split(';')[0]==='application/json',415,'Use JSON.');
        }
      }
      if (method==='GET' && path==='/health') {json(res,200,{ok:true});return;}
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
          await q('INSERT INTO pc_sessions VALUES($1,$2,$3)',[hash(session),handoff.user_id,Date.now()+8*3600000]);
        });
        json(res,200,{session});return;
      }
      if (method==='POST' && path==='/discord/interactions') {
        const raw=await rawBody(req);
        requireThat(checkSignature(raw,String(req.headers['x-signature-ed25519']??''),String(req.headers['x-signature-timestamp']??''),config.publicKey),401,'Invalid Discord signature.');
        json(res,200,await handleInteraction(db,config,parse(raw)));return;
      }
      requireThat(path.startsWith('/api/'),404,'Unknown route.');
      const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
      requireThat(bearer,401,'Sign in to Convergence.');
      const sessionId=hash(bearer[1]);
      const [session]=await db.query('SELECT user_id FROM pc_sessions WHERE id=$1 AND expires>$2',[sessionId,Date.now()]);
      requireThat(session,401,'Session ended. Sign in again.');
      if(method==='POST' && path==='/api/logout') {
        await db.query('DELETE FROM pc_sessions WHERE id=$1',[sessionId]);json(res,200,{ok:true});return;
      }
      const [member,settings]=await Promise.all([discord.member(session.user_id),readSettings(db)]);
      const actor=actorFor(session.user_id,member.roles,config.owner,settings.value);
      if (method==='POST' && path==='/api/settings') {
        await saveSettings(db,actor,parse(await rawBody(req)));json(res,200,{ok:true});return;
      }
      const roster=(await discord.members()).filter(m=>!settings.value.playerRole||m.roles.includes(settings.value.playerRole));
      const active=new Set(roster.map(m=>m.user.id));
      if (method==='POST' && path==='/api/requests') {
        const r=await propose(db,actor,parse(await rawBody(req)),active);
        json(res,200,{id:r.id,status:r.status});return;
      }
      requireThat(method==='GET' && path==='/api/state',404,'Unknown route.');
      const [sheets,requests]=await Promise.all([
        db.query('SELECT * FROM pc_characters ORDER BY id'),
        db.query(actor.isOwner?'SELECT * FROM pc_requests ORDER BY created_ms DESC,id':'SELECT * FROM pc_requests WHERE author_id=$1 OR owner_id=$1 ORDER BY created_ms DESC,id',actor.isOwner?[]:[actor.id])
      ]);
      json(res,200,{actor,players:roster.map(m=>({id:m.user.id,username:m.user.username,display:m.nick||m.user.global_name||m.user.username})),
        characters:sheets.filter(s=>active.has(s.owner_id)).map(s=>({id:s.id,ownerId:s.owner_id,version:s.revision,sheet:JSON.parse(s.sheet)})),
        requests:requests.map(visibleRequest),currency:settings.value.currency,settings:actor.isOwner?settings:null});
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
  const discord=new Discord(config);
  const server=application(db,config,discord);
  let working=false;
  async function tick() {
    if(working) return;
    working=true;
    try { for(let i=0;i<8;i++) if(!await deliverNext(db,discord)) break; }
    catch(e) {console.error('Review delivery check failed:',e instanceof Error?e.name:'Unknown error');}
    finally {working=false;}
  }
  const notify=setInterval(tick,4000);
  const cleanup=setInterval(async()=>{
    try {for(const table of ['pc_sessions','pc_auth_state','pc_exchanges']) await db.query('DELETE FROM '+table+' WHERE expires<=$1',[Date.now()]);}
    catch {console.error('Expired login cleanup will retry.');}
  },3600000);
  const port=Number(process.env.PORT||4100);
  server.listen(port,()=>{console.log('PhoenixCore is listening on port',port);void tick();});
  const stop=()=>{clearInterval(notify);clearInterval(cleanup);server.close(()=>{void db.close();});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(e=>{console.error(e.message);process.exitCode=1;});
}
