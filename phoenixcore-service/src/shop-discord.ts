import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import type {RoleplayScope} from './scope.ts';
import {Problem,actorFor,readSettings,requireThat,discordId} from './domain.ts';
import {createShop,createShopItem,setShopOpen,setShopLocations,setShopStock,listShopCatalog,
  shopAccess,characterInventory,purchaseShopItem,type ShopContext} from './shop.ts';

const str=(name:string,description:string,required=true,max_length?:number)=>({name,type:3,description,required,...(max_length?{max_length}:{})});
const number=(name:string,description:string,min:number,max:number,required=true)=>({name,type:4,description,required,min_value:min,max_value:max});
const sub=(name:string,description:string,options:any[]=[])=>({name,type:1,description,options});
const identifier=(name:string,label:string)=>str(name,label,true,36);
export const shopCommands=()=>[{name:'shop',type:1,description:'Convergence shops and character-owned inventory.',options:[
  sub('list','List current shops and their availability.'),
  sub('view','Browse shop stock and purchase with interactive menus.',[identifier('shop','Shop UUID from /shop list')]),
  sub('buy','Buy an item for your chosen character using cash or bank.',[
    identifier('shop','Shop UUID'),identifier('item','Item UUID'),identifier('character','Your approved character UUID'),
    number('quantity','How many items (1–100)',1,100),
    {name:'payment',type:3,description:'Pay from character cash or bank',required:true,choices:[{name:'Cash',value:'cash'},{name:'Bank',value:'bank'}]}]),
  sub('inventory','View an approved character inventory.',[identifier('character','Your character UUID')]),
  sub('admin-item','Owner/Helper: register a staff-created item.',[
    str('name','Item name',true,100),{name:'kind',type:3,description:'Item class',required:true,
      choices:[{name:'Consumable/material',value:'consumable'},{name:'Equipment',value:'equipment'}]},
    str('base-price','Starting Zeni price'),str('description','Item description',false,1200)]),
  sub('admin-create','Owner/Helper: create a shop, closed until opened.',[
    str('name','Shop name',true,100),
    {name:'kind',type:3,description:'Shop location mode',required:true,choices:[{name:'General, all RP channels',value:'general'},{name:'Location restricted',value:'location'}]},
    str('shopkeeper','Display shopkeeper name',false,100),str('description','Shop description',false,1200)]),
  sub('admin-stock','Owner/Helper: list or restock an item.',[
    identifier('shop','Shop UUID'),identifier('item','Item UUID'),number('revision','Current shop revision',1,100000000),
    str('price','Per-item Zeni price'),number('remaining','-1 unlimited, 0 sold out, or quantity',-1,1000000000)]),
  sub('admin-open','Owner/Helper: open or close shop.',[
    identifier('shop','Shop UUID'),number('revision','Current shop revision',1,100000000),
    {name:'open',type:5,description:'Shop should be open',required:true}]),
  sub('admin-location','Owner/Helper: replace location restrictions with one channel.',[
    identifier('shop','Shop UUID'),number('revision','Current shop revision',1,100000000),
    {name:'channel',type:7,description:'Allowed Convergence RP channel/thread',required:true}])
]}];
export const shopCommand=(name:string)=>name==='shop';
const ephemeral=(content:string)=>({type:4,data:{flags:64,content:content.slice(0,1900),allowed_mentions:{parse:[]}}});
const val=(options:any[],name:string)=>options.find((o:any)=>o.name===name)?.value;
const compact=(id:string)=>Buffer.from(id.replaceAll('-',''),'hex').toString('base64url');
const expand=(short:string)=>{
  requireThat(/^[A-Za-z0-9_-]{22}$/.test(short),400,'Invalid shop selector.');
  const hex=Buffer.from(short,'base64url').toString('hex');
  requireThat(hex.length===32,400,'Invalid shop selector.');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
};
const choice=(option:any)=>({label:String(option.name).slice(0,100),value:option.id});
const context=async(config:Config,body:any,discord:Pick<Discord,'call'>,
    scope:Pick<RoleplayScope,'interactionEligible'>|undefined,settings:any):Promise<ShopContext>=>{
  const channelId=String(body.channel_id||'');
  requireThat(discordId.test(channelId),400,'Use this command inside a Convergence channel.');
  let parentId=body.channel?.parent_id;
  if(!parentId){
    const c=await discord.call('/channels/'+channelId);
    requireThat(c?.id===channelId&&c.guild_id===config.guild,403,'This channel is not in Convergence.');
    parentId=c.parent_id;
  }
  return {channelId,parentId:String(parentId||''),rpEligible:!!scope?.interactionEligible(settings,body)};
};
export async function shopInteraction(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>,
  scope?:Pick<RoleplayScope,'interactionEligible'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return ephemeral('Shops are only available in Convergence.');
  try{
    const {value:settings}=await readSettings(db),me=String(body.member.user.id),
      actor=actorFor(me,body.member.roles||[],config.owner,settings),
      command=body.data?.options?.[0],action=String(command?.name||''),opts=command?.options||[];
    const value=(key:string)=>val(opts,key),shopId=String(value('shop')||'');
    if(action.startsWith('admin-'))requireThat(actor.isJudge,403,'Only Owner and Helper staff manage shops.');
    if(action==='admin-item'){
      const r=await createShopItem(db,actor,{name:value('name'),kind:value('kind'),description:value('description')||'',basePrice:value('base-price')});
      return ephemeral('Staff item registered: **'+r.name+'**\nID: '+r.id);
    }
    if(action==='admin-create'){
      const r=await createShop(db,actor,{name:value('name'),kind:value('kind'),ownerName:value('shopkeeper')||'',description:value('description')||''});
      return ephemeral('Shop created **closed**. Configure stock and locations before opening.\nID: '+r.id);
    }
    if(action==='admin-stock'){
      const r=await setShopStock(db,actor,shopId,String(value('item')),Number(value('revision')),String(value('price')),
        Number(value('remaining'))===-1?null:Number(value('remaining')));
      return ephemeral('Stock saved. Revision '+r.revision+'.');
    }
    if(action==='admin-open'){
      const r=await setShopOpen(db,actor,shopId,Number(value('revision')),value('open')===true);
      return ephemeral('Shop is '+r.status+'. Revision '+r.revision+'.');
    }
    if(action==='admin-location'){
      const channelId=String(value('channel')),c=await discord.call('/channels/'+channelId);
      requireThat(c?.id===channelId&&c.guild_id===config.guild,403,'Choose a Convergence RP channel.');
      const r=await setShopLocations(db,actor,shopId,Number(value('revision')),[channelId]);
      return ephemeral('Shop location saved. Revision '+r.revision+'.');
    }
    const catalog=await listShopCatalog(db);
    if(action==='list'){
      return ephemeral(catalog.shops.length?catalog.shops.slice(0,15).map(s=>
        '**'+s.name+'** · '+s.status+' · '+s.kind+'\n'+s.id).join('\n\n'):'No shops have been configured yet.');
    }
    if(action==='inventory'){
      const r=await characterInventory(db,actor,String(value('character')||''));
      return ephemeral('**Character inventory**\n'+r.characterId+'\n'+
        (r.items.length?r.items.map(x=>x.name+' ×'+x.quantity+' ('+x.kind+')').join('\n'):'No purchased items yet.'));
    }
    const ctx=await context(config,body,discord,scope,settings);
    if(action==='buy'){
      const r=await purchaseShopItem(db,actor,{id:String(body.id||randomUUID()),shopId,itemId:String(value('item')),
        characterId:String(value('character')),quantity:Number(value('quantity')),payment:value('payment')},ctx);
      return ephemeral(r.replayed?'Purchase already recorded.':'Purchased '+r.quantity+' item(s) for '+r.cost+
        ' Zeni using '+r.payment+'. The selected character inventory has been updated.');
    }
    if(action==='view'){
      const shop=catalog.shops.find(s=>s.id===shopId);
      requireThat(shop,404,'Shop not found.');
      const access=shopAccess(shop,ctx),
        items=shop.stock.map(stock=>({stock,item:catalog.items.find(x=>x.id===stock.itemId)})).filter(x=>x.item);
      const lines=items.map(x=>'**'+x.item!.name+'** · '+x.stock.price+' Zeni · '+
        (x.stock.remaining===null?'Unlimited':x.stock.remaining+' left'));
      const response:any={type:4,data:{content:'',allowed_mentions:{parse:[]},
        embeds:[{title:shop.name,description:(shop.description||'Shop catalog')+'\n'+
          (access.allowed?'Open for purchases':access.reason)+'\n\n'+(lines.join('\n')||'No merchandise available.'),
          fields:[{name:'Shopkeeper',value:shop.ownerName||'Not listed',inline:true},
            {name:'Revision',value:String(shop.revision),inline:true}]}]}};
      const options=items.filter(x=>x.stock.remaining===null||x.stock.remaining>0).slice(0,25).map(x=>({
        label:x.item!.name.slice(0,100),value:x.item!.id,description:(x.stock.price+' Zeni').slice(0,100)}));
      if(access.allowed&&options.length)
        response.data.components=[{type:1,components:[{type:3,custom_id:'pcshop:item:'+compact(shopId),
          placeholder:'Choose an item (one per purchase)',min_values:1,max_values:1,options}]}];
      return response;
    }
    return ephemeral('Unknown shop action.');
  }catch(e){return ephemeral(e instanceof Problem?e.message:'Shop action could not be completed. Check bot permissions and logs.');}
}
export async function shopComponent(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>,
  scope?:Pick<RoleplayScope,'interactionEligible'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return ephemeral('Use this in Convergence.');
  try{
    const custom=String(body.data?.custom_id||''),parts=custom.split(':'),me=String(body.member.user.id),
      {value:settings}=await readSettings(db),actor=actorFor(me,body.member.roles||[],config.owner,settings),
      ctx=await context(config,body,discord,scope,settings),catalog=await listShopCatalog(db);
    requireThat(parts[0]==='pcshop'&&['item','char','pay'].includes(parts[1]),400,'Invalid shop action.');
    const shopId=expand(parts[2]||''),shop=catalog.shops.find(s=>s.id===shopId);
    requireThat(shop,404,'Shop not found.');
    const access=shopAccess(shop,ctx);requireThat(access.allowed,403,access.reason);
    if(parts[1]==='item'){
      const itemId=String(body.data?.values?.[0]||'');
      requireThat(shop.stock.some(s=>s.itemId===itemId),404,'That item is not sold by this shop.');
      const rows=await db.query('SELECT id,sheet FROM pc_characters WHERE owner_id=$1 ORDER BY id',[me]);
      const characters=rows.filter(r=>JSON.parse(r.sheet).characterType!=='NPC').map(r=>({id:r.id,name:JSON.parse(r.sheet).name||'Character'}));
      requireThat(characters.length,403,'You need an approved player character to buy merchandise.');
      requireThat(characters.length<=25,409,'More than 25 characters: use /shop buy with an explicit character UUID.');
      return {type:4,data:{flags:64,content:'Choose which of **your approved characters** will receive this purchase.',
        components:[{type:1,components:[{type:3,custom_id:'pcshop:char:'+compact(shopId)+':'+compact(itemId),
          placeholder:'Choose your character',min_values:1,max_values:1,options:characters.map(choice)}]}]}};
    }
    if(parts[1]==='char'){
      const itemId=expand(parts[3]||''),characterId=String(body.data?.values?.[0]||'');
      requireThat(shop.stock.some(s=>s.itemId===itemId),404,'Item not sold here.');
      await characterInventory(db,actor,characterId);
      return {type:4,data:{flags:64,content:'Choose a payment source for **one item**. Your character’s wallet and stock will be rechecked on purchase.',
        components:[{type:1,components:['cash','bank'].map(payment=>({type:2,style:payment==='cash'?1:2,
          label:'Pay with '+payment,custom_id:'pcshop:pay:'+compact(shopId)+':'+compact(itemId)+':'+compact(characterId)+':'+payment}))}]}};
    }
    if(parts[1]==='pay'){
      const itemId=expand(parts[3]||''),characterId=expand(parts[4]||''),payment=parts[5];
      const r=await purchaseShopItem(db,actor,{id:String(body.id||randomUUID()),shopId,itemId,characterId,quantity:1,payment},ctx);
      return ephemeral(r.replayed?'Already purchased.':'Purchase complete: 1 item for '+r.cost+' Zeni from character '+characterId+'.');
    }
    return ephemeral('Invalid shop action.');
  }catch(e){return ephemeral(e instanceof Problem?e.message:'Could not validate the shop interaction.');}
}
