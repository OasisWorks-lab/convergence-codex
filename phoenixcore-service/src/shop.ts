import {createHash,randomUUID} from 'node:crypto';
import type {Store,Query} from './db.ts';
import {requireThat,textValue,discordId,type Actor} from './domain.ts';
import {balance,economyCurrencyId,ensureAccount,openingCash} from './economy.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId=(id:unknown,label:string)=>{
  requireThat(typeof id==='string'&&uuid.test(id),400,'Choose a valid '+label+' ID.');
  return id;
};
const staff=(actor:Actor)=>requireThat(actor.isJudge,403,'Only the Convergence Owner or configured Helper can manage shops.');
const checksum=(values:unknown[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
const maxAmount=10n**60n-1n;
const maxQuantity=100;
const count=(value:unknown,max:number,label:string)=>{
  requireThat(Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max,400,'Invalid '+label+'.');
  return Number(value);
};
const positivePrice=(value:unknown)=>{const b=balance(value);requireThat(b>0n,400,'Item price must be greater than zero.');return String(value);};
const audit=async(q:Query,actor:string,kind:string,id:string,detail:string)=>
  q('INSERT INTO pc_shop_audit(id,actor_id,kind,subject_id,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(),actor,kind,id,detail.slice(0,350),Date.now()]);

export async function createShopItem(db:Store,actor:Actor,data:any){
  staff(actor);
  requireThat(data&&typeof data==='object'&&!Array.isArray(data),400,'Provide an item.');
  const name=textValue(data.name,100,'Item name',true),
    description=textValue(data.description||'',1200,'Item description');
  requireThat(['consumable','equipment'].includes(data.kind),400,'Choose a consumable or equipment item.');
  const basePrice=positivePrice(data.basePrice);
  const id=randomUUID();
  await db.transaction(async q=>{
    await q('INSERT INTO pc_shop_items(id,name,description,kind,base_price,created_by,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id,name,description,data.kind,basePrice,actor.id,Date.now()]);
    await audit(q,actor.id,'item-created',id,name);
  });
  return {id,name,kind:data.kind,basePrice};
}
export async function createShop(db:Store,actor:Actor,data:any){
  staff(actor);
  requireThat(data&&typeof data==='object'&&!Array.isArray(data),400,'Provide a shop.');
  const name=textValue(data.name,100,'Shop name',true),
    description=textValue(data.description||'',1200,'Shop description'),
    ownerName=textValue(data.ownerName||'',100,'Shopkeeper name');
  requireThat(['general','location'].includes(data.kind),400,'Choose general or location-restricted shop.');
  const id=randomUUID();
  await db.transaction(async q=>{
    await q("INSERT INTO pc_shops(id,name,description,owner_name,kind,status,created_by,created_ms) VALUES($1,$2,$3,$4,$5,'closed',$6,$7)",
      [id,name,description,ownerName,data.kind,actor.id,Date.now()]);
    await audit(q,actor.id,'shop-created',id,name);
  });
  return {id,name,status:'closed',revision:1};
}
async function shopForWrite(q:Query,db:Store,id:string){
  const [shop]=await q('SELECT * FROM pc_shops WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
  requireThat(shop,404,'Shop not found.');
  return shop;
}
const revision=(expected:number,shop:any)=>{
  requireThat(Number.isSafeInteger(expected)&&expected>=1,400,'Provide the current shop revision.');
  requireThat(Number(shop.revision)===expected,409,'Shop has changed. Refresh before saving.');
};
export async function setShopOpen(db:Store,actor:Actor,id:string,expected:number,open:boolean){
  staff(actor);requireId(id,'shop');requireThat(typeof open==='boolean',400,'Choose open or closed.');
  return db.transaction(async q=>{
    const shop=await shopForWrite(q,db,id);revision(expected,shop);
    const status=open?'open':'closed';
    if(shop.status===status)return {id,status,revision:expected,changed:false};
    await q('UPDATE pc_shops SET status=$1,revision=revision+1 WHERE id=$2',[status,id]);
    await audit(q,actor.id,'shop-status',id,status);
    return {id,status,revision:expected+1,changed:true};
  });
}
export async function setShopLocations(db:Store,actor:Actor,id:string,expected:number,ids:string[]){
  staff(actor);requireId(id,'shop');
  requireThat(Array.isArray(ids)&&ids.length<=50&&ids.every(x=>typeof x==='string'&&discordId.test(x)),400,'Provide up to 50 valid Discord RP channel IDs.');
  const channels=[...new Set(ids)].sort();
  return db.transaction(async q=>{
    const shop=await shopForWrite(q,db,id);revision(expected,shop);
    requireThat(shop.kind==='location'||!channels.length,409,'General Store access is unrestricted within eligible RP channels.');
    await q('DELETE FROM pc_shop_channels WHERE shop_id=$1',[id]);
    for(const channel of channels)await q('INSERT INTO pc_shop_channels(shop_id,channel_id) VALUES($1,$2)',[id,channel]);
    await q('UPDATE pc_shops SET revision=revision+1 WHERE id=$1',[id]);
    await audit(q,actor.id,'shop-locations',id,'Configured '+channels.length+' RP channel(s).');
    return {id,channels,revision:expected+1};
  });
}
export async function setShopStock(db:Store,actor:Actor,shopId:string,itemId:string,expected:number,price:unknown,remaining:unknown){
  staff(actor);requireId(shopId,'shop');requireId(itemId,'item');
  const unit=positivePrice(price);
  requireThat(remaining===null||(Number.isSafeInteger(remaining)&&Number(remaining)>=0&&Number(remaining)<=1_000_000_000),
    400,'Stock must be unlimited or a whole number between zero and one billion.');
  return db.transaction(async q=>{
    const shop=await shopForWrite(q,db,shopId);revision(expected,shop);
    const [item]=await q('SELECT id FROM pc_shop_items WHERE id=$1',[itemId]);
    requireThat(item,404,'Item not found.');
    await q('INSERT INTO pc_shop_stock(shop_id,item_id,price,remaining) VALUES($1,$2,$3,$4) ON CONFLICT(shop_id,item_id) DO UPDATE SET price=excluded.price,remaining=excluded.remaining',
      [shopId,itemId,unit,remaining as number|null]);
    await q('UPDATE pc_shops SET revision=revision+1 WHERE id=$1',[shopId]);
    await audit(q,actor.id,'stock-configured',shopId,'Item '+itemId+' price '+unit+' remaining '+String(remaining));
    return {shopId,itemId,price:unit,remaining,revision:expected+1};
  });
}
export async function listShopCatalog(db:Store){
  const [shops,items,stock,channels]=await Promise.all([
    db.query('SELECT id,name,description,owner_name,kind,status,revision FROM pc_shops ORDER BY name,id'),
    db.query('SELECT id,name,description,kind,base_price,revision FROM pc_shop_items ORDER BY name,id'),
    db.query('SELECT shop_id,item_id,price,remaining FROM pc_shop_stock ORDER BY shop_id,item_id'),
    db.query('SELECT shop_id,channel_id FROM pc_shop_channels ORDER BY shop_id,channel_id')
  ]);
  return {shops:shops.map(s=>({id:s.id,name:s.name,description:s.description,ownerName:s.owner_name,
    kind:s.kind,status:s.status,revision:Number(s.revision),
    channels:channels.filter(c=>c.shop_id===s.id).map(c=>c.channel_id),
    stock:stock.filter(item=>item.shop_id===s.id).map(x=>({itemId:x.item_id,price:x.price,remaining:x.remaining===null?null:Number(x.remaining)}))})),
    items:items.map(i=>({id:i.id,name:i.name,description:i.description,kind:i.kind,basePrice:i.base_price,revision:Number(i.revision)}))};
}
export type ShopContext={channelId:string;parentId?:string;rpEligible:boolean};
export function shopAccess(shop:any,context:ShopContext){
  if(!context.rpEligible)return {allowed:false,reason:'Use this shop from an eligible Convergence RP channel or thread.'};
  if(shop.status!=='open')return {allowed:false,reason:'This shop is closed by staff.'};
  if(shop.kind==='location'&&!((shop.channels||[]) as string[]).some(id=>id===context.channelId||id===context.parentId))
    return {allowed:false,reason:'This shop is not available in your current RP location.'};
  return {allowed:true,reason:''};
}
export async function characterInventory(db:Store,actor:Actor,characterId:string){
  requireId(characterId,'character');
  const [character]=await db.query('SELECT owner_id,sheet FROM pc_characters WHERE id=$1',[characterId]);
  requireThat(character&&(character.owner_id===actor.id||actor.isJudge)&&JSON.parse(character.sheet).characterType!=='NPC',403,
    'Select your own approved player character.');
  const rows=await db.query('SELECT i.item_id,i.quantity,d.name,d.description,d.kind FROM pc_inventory_items i JOIN pc_shop_items d ON d.id=i.item_id WHERE i.character_id=$1 ORDER BY d.name,d.id',[characterId]);
  return {characterId,items:rows.map(r=>({id:r.item_id,name:r.name,description:r.description,kind:r.kind,quantity:Number(r.quantity)}))};
}
export async function purchaseShopItem(db:Store,actor:Actor,input:any,context:ShopContext){
  requireThat(actor.isPlayer||actor.isOwner,403,'A Convergence player is required.');
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),400,'Choose a shop purchase.');
  const id=requireId(input.id,'receipt'),characterId=requireId(input.characterId,'character'),
    shopId=requireId(input.shopId,'shop'),itemId=requireId(input.itemId,'item');
  requireThat(['cash','bank'].includes(input.payment),400,'Choose cash or bank payment.');
  const quantity=count(input.quantity,maxQuantity,'purchase quantity');
  requireThat(quantity>=1,400,'Choose at least one item.');
  requireThat(typeof context?.channelId==='string'&&discordId.test(context.channelId),400,'A real RP channel is required.');
  const fingerprint=checksum([actor.id,characterId,shopId,itemId,quantity,input.payment,context.channelId]);
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['shop-purchase:'+id]);
    const [existing]=await q('SELECT * FROM pc_shop_purchases WHERE id=$1',[id]);
    if(existing){
      requireThat(existing.fingerprint===fingerprint,409,'This purchase receipt was used for another transaction.');
      return {id,cost:existing.total,quantity:existing.quantity,itemId,characterId,replayed:true};
    }
    requireThat(context.rpEligible,403,'Shopping requires a valid Convergence RP channel.');
    const shop=await shopForWrite(q,db,shopId);
    const channels=await q('SELECT channel_id FROM pc_shop_channels WHERE shop_id=$1',[shopId]);
    const access=shopAccess({...shop,channels:channels.map(c=>c.channel_id)},context);
    requireThat(access.allowed,403,access.reason);
    const [character]=await q('SELECT owner_id,revision,sheet FROM pc_characters WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[characterId]);
    requireThat(character&&character.owner_id===actor.id&&JSON.parse(character.sheet).characterType!=='NPC',403,
      'Only the selected character’s Discord owner can purchase items for them.');
    const [stock]=await q('SELECT price,remaining FROM pc_shop_stock WHERE shop_id=$1 AND item_id=$2'+(db.dialect==='postgres'?' FOR UPDATE':''),[shopId,itemId]);
    requireThat(stock,404,'This item is not sold in that shop.');
    requireThat(stock.remaining===null||Number(stock.remaining)>=quantity,409,'The requested quantity exceeds available stock.');
    const cost=balance(stock.price)*BigInt(quantity);
    requireThat(cost>0n&&cost<=maxAmount,409,'Item total is outside the supported Zeni range.');
    const sheet=JSON.parse(character.sheet);
    await ensureAccount(q,characterId,sheet);
    const [account]=await q('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[characterId]);
    requireThat(account&&openingCash(sheet)===account.cash,409,'Character cash balance needs reconciliation before purchase.');
    const cash=BigInt(account.cash),bank=BigInt(account.bank);
    requireThat((input.payment==='cash'?cash:bank)>=cost,409,'Insufficient '+input.payment+' Zeni.');
    const nextCash=(cash-(input.payment==='cash'?cost:0n)).toString(),
      nextBank=(bank-(input.payment==='bank'?cost:0n)).toString();
    const transactionId='shop:'+id;
    const written=await q('INSERT INTO pc_economy_transactions(id,actor_id,kind,reason,amount,currency_id,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id',
      [transactionId,actor.id,'shop_purchase','Shop '+shopId+' item '+itemId, String(cost),economyCurrencyId,fingerprint,Date.now()]);
    requireThat(written.length,409,'Shop receipt already recorded.');
    await q('INSERT INTO pc_economy_entries(transaction_id,character_id,cash_before,cash_after,bank_before,bank_after) VALUES($1,$2,$3,$4,$5,$6)',
      [transactionId,characterId,account.cash,nextCash,account.bank,nextBank]);
    if(input.payment==='cash'){
      sheet.wallet=nextCash;
      await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(sheet),characterId]);
    }
    await q('UPDATE pc_economy_accounts SET cash=$1,bank=$2,revision=revision+1 WHERE character_id=$3',[nextCash,nextBank,characterId]);
    if(stock.remaining!==null)await q('UPDATE pc_shop_stock SET remaining=remaining-$1 WHERE shop_id=$2 AND item_id=$3',
      [quantity,shopId,itemId]);
    const [owned]=await q('SELECT quantity FROM pc_inventory_items WHERE character_id=$1 AND item_id=$2',[characterId,itemId]);
    requireThat(!owned||Number(owned.quantity)+quantity<=1_000_000_000,409,'This inventory stack is at its supported capacity.');
    await q('INSERT INTO pc_inventory_items(character_id,item_id,quantity,updated_ms) VALUES($1,$2,$3,$4) ON CONFLICT(character_id,item_id) DO UPDATE SET quantity=excluded.quantity,updated_ms=excluded.updated_ms',
      [characterId,itemId,Number(owned?.quantity||0)+quantity,Date.now()]);
    await q('INSERT INTO pc_shop_purchases(id,actor_id,character_id,shop_id,item_id,channel_id,payment,quantity,unit_price,total,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id,actor.id,characterId,shopId,itemId,context.channelId,input.payment,quantity,stock.price,String(cost),fingerprint,Date.now()]);
    return {id,cost:String(cost),quantity,itemId,characterId,payment:input.payment,replayed:false};
  });
}
