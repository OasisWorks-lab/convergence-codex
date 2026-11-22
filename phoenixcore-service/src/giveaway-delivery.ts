import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {DiscordFailure} from './discord.ts';
import {concludeGiveaway,giveawayPublic,rerollGiveawaySlot} from './giveaway.ts';

export function giveawayMessage(g:any){
  const active=g.status==='active'&&g.endsMs>Date.now();
  const prize=g.prizeKind==='zeni'?'**'+g.zeniAmount+' Zeni** to the winning character bank':g.prizeText;
  const current=g.winners.filter((w:any)=>!['expired','replaced'].includes(w.status));
  const names=current.length?current.map((w:any)=>'<@'+w.user_id+'> · '+w.status.replaceAll('_',' ')).join('\n'):'Not drawn yet';
  const safeTitle=String(g.title).slice(0,120);
  return {content:'',allowed_mentions:{parse:[]},
    embeds:[{title:'🎁 '+safeTitle,description:String(g.description||'Join for your chance to win.').slice(0,1550),
      color:0xDB953C,fields:[
        {name:'Status',value:g.status==='active'&&g.endsMs<=Date.now()?'Closing entries…':g.status,inline:true},
        {name:'Prize',value:String(prize).slice(0,600),inline:true},
        {name:'Participants',value:String(g.entries),inline:true},
        {name:'Winners',value:String(g.winnerCount),inline:true},
        {name:'Starts',value:'<t:'+Math.floor(g.startsMs/1000)+':F>',inline:true},
        {name:'Ends',value:'<t:'+Math.floor(g.endsMs/1000)+':F>',inline:true},
        ...(g.winners.length?[{name:'Drawn winners',value:names.slice(0,1000)}]:[])],
      footer:{text:'PhoenixCore giveaway '+g.id+' · Boosters: 3 total tickets at draw'}}],
    components:active?[{type:1,components:[
      {type:2,style:3,label:'Enter',custom_id:'pcg:enter:'+g.id},
      {type:2,style:2,label:'Withdraw',custom_id:'pcg:leave:'+g.id}]}]:[]};
}
export async function deliverGiveawayPost(db:Store,discord:Pick<Discord,'call'>,now=Date.now()){
  const token=randomUUID();
  const job=await db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_giveaway_posts WHERE revision>delivered_revision AND retry_ms<=$1 AND lease_until<=$1 ORDER BY retry_ms,giveaway_id LIMIT 1'+
      (db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_giveaway_posts SET lease=$1,lease_until=$2 WHERE giveaway_id=$3',[token,now+45000,row.giveaway_id]);
    return row;
  });
  if(!job)return false;
  try{
    const g=await giveawayPublic(db,job.giveaway_id),payload:any=giveawayMessage(g);
    let messageId=String(job.message_id||'');
    if(!messageId){
      payload.nonce=createHash('sha256').update('giveaway:'+g.id).digest('base64url').slice(0,24);
      payload.enforce_nonce=true;
    }
    let result:any;
    try{
      result=await discord.call('/channels/'+job.channel_id+'/messages'+(messageId?'/'+messageId:''),{
        method:messageId?'PATCH':'POST',body:JSON.stringify(payload)});
    }catch(e){
      if(messageId&&e instanceof DiscordFailure&&e.status===404){
        await db.query('UPDATE pc_giveaway_posts SET message_id=NULL,delivered_revision=0,retry_ms=0,lease=NULL,lease_until=0 WHERE giveaway_id=$1 AND lease=$2',
          [job.giveaway_id,token]);
        return true;
      }
      throw e;
    }
    messageId=String(result?.id||messageId);
    if(!/^\d{17,20}$/.test(messageId))throw Error('Discord did not confirm a giveaway message.');
    await db.query('UPDATE pc_giveaway_posts SET message_id=$1,delivered_revision=$2,retry_ms=0,lease=NULL,lease_until=0,last_error=NULL WHERE giveaway_id=$3 AND lease=$4',
      [messageId,Number(job.revision),job.giveaway_id,token]);
  }catch(error:any){
    const delay=error instanceof DiscordFailure?error.retryMs:0;
    await db.query('UPDATE pc_giveaway_posts SET retry_ms=$1,lease=NULL,lease_until=0,last_error=$2 WHERE giveaway_id=$3 AND lease=$4',
      [now+Math.max(delay||0,30000),error instanceof DiscordFailure?'Discord HTTP '+error.status:'Giveaway post delivery failed',job.giveaway_id,token]);
  }
  return true;
}
export async function advanceGiveaways(db:Store,discord:Pick<Discord,'call'>,config:Config,now=Date.now()){
  const [scheduled]=await db.query("SELECT id FROM pc_giveaways WHERE status='scheduled' AND starts_ms<=$1 ORDER BY starts_ms,id LIMIT 1",[now]);
  if(scheduled){
    await db.transaction(async q=>{
      const updated=await q("UPDATE pc_giveaways SET status='active',updated_ms=$1,version=version+1 WHERE id=$2 AND status='scheduled' RETURNING id",[now,scheduled.id]);
      if(updated.length){
        await q('INSERT INTO pc_giveaway_events(id,giveaway_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(),scheduled.id,'system','started','Scheduled giveaway started',now]);
        await q('UPDATE pc_giveaway_posts SET revision=revision+1,retry_ms=0 WHERE giveaway_id=$1',[scheduled.id]);
      }
    });
    return true;
  }
  const [ending]=await db.query("SELECT id FROM pc_giveaways WHERE status='active' AND ends_ms<=$1 ORDER BY ends_ms,id LIMIT 1",[now]);
  if(ending){
    await concludeGiveaway(db,ending.id,'system',userId=>discord.call('/guilds/'+config.guild+'/members/'+userId),now);
    return true;
  }
  const [expired]=await db.query("SELECT w.giveaway_id,w.slot FROM pc_giveaway_winners w JOIN pc_giveaways g ON g.id=w.giveaway_id WHERE w.status='awaiting_claim' AND w.claim_deadline_ms<=$1 AND g.status='ended' ORDER BY w.claim_deadline_ms LIMIT 1",[now]);
  if(expired){
    await rerollGiveawaySlot(db,expired.giveaway_id,Number(expired.slot),'system',
      userId=>discord.call('/guilds/'+config.guild+'/members/'+userId),now);
    return true;
  }
  return pruneGiveawayHistory(db,discord,now);
}

export async function pruneGiveawayHistory(db:Store,discord:Pick<Discord,'call'>,now=Date.now()):Promise<boolean>{
  const [candidate]=await db.query("SELECT g.id,g.updated_ms,g.drawn_ms,g.retention_days,p.message_id,p.channel_id FROM pc_giveaways g LEFT JOIN pc_giveaway_posts p ON p.giveaway_id=g.id WHERE g.status IN ('ended','cancelled') AND COALESCE(g.drawn_ms,g.updated_ms)+g.retention_days*86400000<=$1 AND NOT EXISTS (SELECT 1 FROM pc_giveaway_winners w WHERE w.giveaway_id=g.id AND w.status IN ('awaiting_claim','claim_pending')) ORDER BY COALESCE(g.drawn_ms,g.updated_ms) LIMIT 1",[now]);
  if(!candidate)return false;
  if(candidate.message_id){
    try{
      await discord.call('/channels/'+candidate.channel_id+'/messages/'+candidate.message_id,{method:'DELETE'});
    }catch(error){
      if(!(error instanceof DiscordFailure&&error.status===404))throw error;
    }
  }
  await db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[candidate.id]);
    if(!g||!['ended','cancelled'].includes(g.status))return;
    if(Number(g.drawn_ms||g.updated_ms)+Number(g.retention_days)*86400000>now)return;
    const [remaining]=await q("SELECT COUNT(*) AS total FROM pc_giveaway_winners WHERE giveaway_id=$1 AND status IN ('awaiting_claim','claim_pending')",[candidate.id]);
    if(Number(remaining.total)>0)return;
    await q('DELETE FROM pc_giveaway_winners WHERE giveaway_id=$1',[candidate.id]);
    await q('DELETE FROM pc_giveaway_draws WHERE giveaway_id=$1',[candidate.id]);
    await q('DELETE FROM pc_giveaway_posts WHERE giveaway_id=$1',[candidate.id]);
    await q('DELETE FROM pc_giveaway_entries WHERE giveaway_id=$1',[candidate.id]);
    await q('DELETE FROM pc_giveaway_events WHERE giveaway_id=$1',[candidate.id]);
    await q('DELETE FROM pc_giveaways WHERE id=$1',[candidate.id]);
  });
  return true;
}
