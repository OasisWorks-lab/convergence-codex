import {defaultSettings} from '../src/db.ts';
import {type Config} from '../src/discord.ts';

export class ReviewFixture {
  config:Config;
  channels=new Map<string,any>();
  messages=new Map<string,any>();
  names=new Map<string,string>();
  calls:{path:string;method:string;body:any}[]=[];
  cards:{channel:string;id:string;body:any}[]=[];
  sequence=800000000000000000n;
  constructor(config:Config){
    this.config=config;
    for(const [id,type] of [[defaultSettings.characterChannel,0],[defaultSettings.designChannel,15],[defaultSettings.updatesForum,15]] as const)
      this.channels.set(id,{id,type,guild_id:config.guild,flags:0});
  }
  respond=(path:string,init?:RequestInit)=>{
    path=path.replace(/^\/api\/v10/,'');
    const method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):undefined;
    this.calls.push({path,method,body});
    const parts=path.split('/'),id=parts[2],target=this.channels.get(id),last=parts.at(-1)!;
    const missing=()=>Response.json({code:10003},{status:404});
    const store=(channel:string,key:string,value:any)=>{
      const msg={...value,id:key,channel_id:channel,author:{id:this.config.clientId}};
      this.messages.set(key,msg);
      if(value.embeds?.[0]?.footer?.text?.startsWith('PhoenixCore request '))this.cards.push({channel,id:key,body:value});
      return msg;
    };
    if(path.endsWith('/threads/active'))return Response.json({threads:[...this.channels.values()].filter(t=>t.type===11&&!t.thread_metadata.archived)});
    if(path.includes('/threads/archived/public'))return Response.json({threads:[...this.channels.values()].filter(t=>t.parent_id===id&&t.thread_metadata.archived),has_more:false});
    if(parts[1]==='guilds' && parts[3]==='members')return Response.json({user:{id:last,username:this.names.get(last)||'emberquill',global_name:'Ember Quill'},nick:'Server nickname',roles:[]});
    if(parts[1]!=='channels'||!target)return missing();
    if(parts.length===3){
      if(method==='PATCH')Object.assign(target.thread_metadata,body);
      return Response.json(target);
    }
    if(parts[3]==='threads'&&method==='POST'){
      if((target.flags&16)&&!body.applied_tags?.length)return Response.json({},{status:400});
      const newId=String(++this.sequence);
      const thread={id:newId,name:body.name,type:11,parent_id:id,guild_id:this.config.guild,owner_id:this.config.clientId,thread_metadata:{archived:false,locked:false}};
      this.channels.set(newId,thread);
      return Response.json({...thread,message:store(newId,newId,body.message)});
    }
    if(parts[3]==='messages'){
      if(method==='POST'){
        if(target.thread_metadata?.locked||[15,16].includes(target.type))return Response.json({},{status:403});
        if(target.thread_metadata)target.thread_metadata.archived=false;
        const duplicate=body.enforce_nonce&&[...this.messages.values()].find(m=>m.channel_id===id&&m.nonce===body.nonce);
        return Response.json(duplicate||store(id,String(++this.sequence),body));
      }
      const existing=this.messages.get(last);
      if(!existing||existing.channel_id!==id)return missing();
      if(method==='PATCH')return Response.json(store(id,last,body));
      return Response.json(existing);
    }
    throw Error('Unexpected fixture route '+method+' '+path);
  };
  fetch:typeof fetch=async(input,init)=>{const url=new URL(String(input));return this.respond(url.pathname+url.search,init);};
}
