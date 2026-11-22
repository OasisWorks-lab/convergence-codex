import {createHash,randomUUID} from 'node:crypto';
import type {Store,Query} from './db.ts';
import {requireThat,textValue,discordId} from './domain.ts';
import {balance,ensureAccount,economyCurrencyId,openingCash} from './economy.ts';
import type {StaffIdentity} from './staff.ts';

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const moneyMax=10n**60n-1n;
const staff=(who:StaffIdentity)=>requireThat(who.isHelper,403,'Only authorized Owner, Admin or Helper may manage shops and item definitions.');
const validateId=(id:string,label='ID')=>requireThat(uuid.test(id),400,'Choose a valid '+label+'.');
const receiptId=(id:string)=>requireThat(/^[\w:-]{8,130}$/.test(id),400,'Unique request receipt required.');
const ids=(x:unknown,label:string,max=60)=>{
  requireThat(Array.isArray(x)&&x.length<=max&&x.every(v=>typeof v==='string'&&discordId.test(v)),400,'Provide valid '+label+' IDs.');
  return [...new Set(x)].sort();
};
const url=(raw:any)=>{
  const value=String(raw||'').trim();
  if(!value)return null;
  requireThat(value.length<=850&&/^https:\/\//i.test(value),400,'Use an HTTPS artwork URL.');
  try{const u=new URL(value);requireThat(!u.username&&!u.password&&u.hostname.includes('.'),400,'Artwork URL invalid.');}
  catch{requireThat(false,400,'Artwork URL invalid.');}
  return value;
};
const audit=async(q:Query,who:string,type:string,id:string,event:string,detail:string)=>{
  await q('INSERT INTO pc_shop_audit(id,actor_id,target_type,target_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),who,type,id,event,detail.slice(0,700),Date.now()]);
};
export type ItemDefinition={receipt:string;name:string;description:string;kind:'consumable'|'equipment';imageUrl?:string;
  stackable:boolean;tradeable:boolean;bound:boolean;raceLimit?:string[];maxDurability?:number;effects?:unknown};
export async function defineItem(db:Store,who:StaffIdentity,input:ItemDefinition){
  staff(who);requireThat(input&&typeof input==='object',400,'Provide an item definition.');
  receiptId(input.receipt);
  requireThat(['consumable','equipment'].includes(input.kind),400,'Only consumables and equipment are supported item classes.');
  const name=textValue(input.name,100,'Item name',true),description=textValue(input.description||'',1200,'Item description');
  const raceLimit=Array.isArray(input.raceLimit)?input.raceLimit.map(v=>textValue(v,65,'Race')).filter(Boolean):[];
  requireThat(raceLimit.length<=20,400,'Too many race limits.');
  const maxDurability=input.maxDurability;
  requireThat(maxDurability===undefined||Number.isInteger(maxDurability)&&maxDurability>=1&&maxDurability<=1000000,400,'Invalid durability.');
  requireThat(input.effects===undefined||JSON.stringify(input.effects).length<=1800,400,'Item effect configuration too large.');
  return db.transaction(async q=>{
    const [existing]=await q('SELECT id,creator_id FROM pc_shop_items WHERE receipt_id=$1',[input.receipt]);
    if(existing){
      requireThat(existing.creator_id===who.id,409,'Receipt belongs to another staff creator.');
      return {id:existing.id,created:false};
    }
    const id=randomUUID(),now=Date.now();
    const inserted=await q('INSERT INTO pc_shop_items(id,receipt_id,name,description,kind,image_url,stackable,tradeable,bound,race_limit,effects,cooldown_ms,max_durability,creator_id,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$14) ON CONFLICT(receipt_id) DO NOTHING RETURNING id',
      [id,input.receipt,name,description,input.kind,url(input.imageUrl),input.stackable?1:0,input.tradeable?1:0,input.bound?1:0,
        JSON.stringify(raceLimit),JSON.stringify(input.effects||{}),maxDurability??null,who.id,now]);
    if(!inserted.length){const [prev]=await q('SELECT id,creator_id FROM pc_shop_items WHERE receipt_id=$1',[input.receipt]);requireThat(prev?.creator_id===who.id,409,'Item receipt collision.');return {id:prev.id,created:false};}
    await audit(q,who.id,'item',id,'created',name+' · '+input.kind);
    return {id,created:true};
  });
}
export type ShopDefinition={receipt:string;name:string;description:string;ownerName:string;imageUrl?:string;isGeneral:boolean;channelIds?:string[]};
export async function createShop(db:Store,who:StaffIdentity,input:ShopDefinition){
  staff(who);receiptId(input.receipt);
  const name=textValue(input.name,110,'Shop name',true),
    description=textValue(input.description||'',1400,'Shop description'),ownerName=textValue(input.ownerName||'',90,'Shop owner name');
  const channels=ids(input.channelIds||[],'RP channel');
  requireThat(input.isGeneral||channels.length>0,400,'A location-restricted shop needs at least one RP channel.');
  requireThat(!input.isGeneral||channels.length===0,400,'The single General Store is unrestricted in valid RP channels.');
  return db.transaction(async q=>{
    const [existing]=await q('SELECT id,creator_id FROM pc_shops WHERE receipt_id=$1',[input.receipt]);
    if(existing){requireThat(existing.creator_id===who.id,409,'A different staff member owns this receipt.');return {id:existing.id,created:false};}
    if(input.isGeneral){
      const [general]=await q('SELECT id FROM pc_shops WHERE is_general=1');
      requireThat(!general,409,'There is already one General Store. Edit that merchant instead of duplicating its catalog.');
    }
    const id=randomUUID(),now=Date.now();
    const inserted=await q('INSERT INTO pc_shops(id,receipt_id,name,description,image_url,owner_name,is_general,channel_ids,creator_id,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(receipt_id) DO NOTHING RETURNING id',
      [id,input.receipt,name,description,url(input.imageUrl),ownerName,input.isGeneral?1:0,JSON.stringify(channels),who.id,now]);
    if(!inserted.length){const [prior]=await q('SELECT id,creator_id FROM pc_shops WHERE receipt_id=$1',[input.receipt]);requireThat(prior?.creator_id===who.id,409,'Shop receipt collision.');return {id:prior.id,created:false};}
    await audit(q,who.id,'shop',id,'created',name+(input.isGeneral?' · General Store':' · location-restricted'));
    return {id,created:true};
  });
}
export async function configureShopStock(db:Store,who:StaffIdentity,shopId:string,itemId:string,input:{price:string;unlimited:boolean;quantity:number;discountBps?:number;restockMode?:'unlimited'|'manual'|'automatic'}){
  staff(who);validateId(shopId,'shop');validateId(itemId,'item');
  const price=balance(input.price);
  requireThat(price<=moneyMax,400,'Item price exceeds supported currency size.');
  requireThat(Number.isSafeInteger(input.quantity)&&input.quantity>=0&&input.quantity<=1000000000,400,'Choose a valid stock quantity.');
  const discount=input.discountBps??0;
  requireThat(Number.isInteger(discount)&&discount>=0&&discount<=10000,400,'Discount must be 0–10000 basis points.');
  const mode=input.restockMode|| (input.unlimited?'unlimited':'manual');
  requireThat(['unlimited','manual','automatic'].includes(mode),400,'Invalid restock mode.');
  requireThat(mode==='unlimited'===input.unlimited,400,'Stock type and restock mode must agree.');
  return db.transaction(async q=>{
    const [shop]=await q('SELECT id FROM pc_shops WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[shopId]);
    const [item]=await q('SELECT id,active FROM pc_shop_items WHERE id=$1',[itemId]);
    requireThat(shop&&item&&Number(item.active)===1,404,'The shop or approved item is unavailable.');
    await q('INSERT INTO pc_shop_stock(shop_id,item_id,price,unlimited,quantity,restock_mode,discount_bps) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(shop_id,item_id) DO UPDATE SET price=excluded.price,unlimited=excluded.unlimited,quantity=excluded.quantity,restock_mode=excluded.restock_mode,discount_bps=excluded.discount_bps,revision=pc_shop_stock.revision+1',
      [shopId,itemId,input.price,input.unlimited?1:0,input.quantity,mode,discount]);
    await audit(q,who.id,'shop',shopId,'stock-set','Item '+itemId+', price '+input.price+', stock '+(input.unlimited?'unlimited':input.quantity));
    return {shopId,itemId};
  });
}
export async function setShopOpen(db:Store,who:StaffIdentity,id:string,open:boolean){
  staff(who);validateId(id,'shop');
  return db.transaction(async q=>{
    const changed=await q('UPDATE pc_shops SET is_open=$1,version=version+1,updated_ms=$2 WHERE id=$3 RETURNING id',
      [open?1:0,Date.now(),id]);
    requireThat(changed.length===1,404,'Shop unavailable.');
    await audit(q,who.id,'shop',id,open?'opened':'closed','Staff-controlled storefront status');
    return {id,open};
  });
}
export async function setInventoryCapacity(db:Store,who:StaffIdentity,characterId:string,slots:number){
  staff(who);validateId(characterId,'character');
  requireThat(Number.isInteger(slots)&&slots>=0&&slots<=10000,400,'Inventory slot count must be between 0 and 10000.');
  return db.transaction(async q=>{
    const [character]=await q('SELECT id FROM pc_characters WHERE id=$1',[characterId]);
    requireThat(character,404,'Approved character unavailable.');
    const [used]=await q('SELECT COUNT(*) AS count FROM pc_inventory_stacks WHERE character_id=$1',[characterId]);
    requireThat(slots>=Number(used.count),409,'Cannot reduce capacity below the number of currently occupied slots.');
    await q('INSERT INTO pc_inventory_capacities(character_id,slots,set_by,updated_ms) VALUES($1,$2,$3,$4) ON CONFLICT(character_id) DO UPDATE SET slots=excluded.slots,set_by=excluded.set_by,updated_ms=excluded.updated_ms,revision=pc_inventory_capacities.revision+1',
      [characterId,slots,who.id,Date.now()]);
    await audit(q,who.id,'character',characterId,'inventory-capacity','Slots set to '+slots);
    return {characterId,slots};
  });
}
export function shopAccessible(shop:any,channelId:string,parentId:string|undefined,eligibleRp:boolean){
  if(!eligibleRp)return {canBuy:false,why:'Purchases are available only from an eligible roleplay channel.'};
  if(Number(shop.is_open)!==1)return {canBuy:false,why:'This shop is closed by staff.'};
  const channels:string[]=JSON.parse(shop.channel_ids);
  if(Number(shop.is_general)===1||[channelId,parentId].some(x=>x&&channels.includes(x)))return {canBuy:true,why:''};
  return {canBuy:false,why:'Visit one of the shop’s configured in-character locations to buy items.'};
}
export async function listShops(db:Store){
  const rows=await db.query('SELECT id,name,description,image_url,owner_name,is_general,is_open,channel_ids,version FROM pc_shops ORDER BY is_general DESC,name');
  return rows.map(x=>({id:x.id,name:x.name,description:x.description,imageUrl:x.image_url,ownerName:x.owner_name,
    general:Number(x.is_general)===1,open:Number(x.is_open)===1,channelIds:JSON.parse(x.channel_ids),version:Number(x.version)}));
}
export async function listShopItems(db:Store,shopId:string){
  validateId(shopId,'shop');
  return db.query('SELECT i.id,i.name,i.description,i.kind,i.image_url,i.stackable,i.bound,i.tradeable,i.race_limit,i.max_durability,s.price,s.unlimited,s.quantity,s.discount_bps,s.restock_mode FROM pc_shop_stock s JOIN pc_shop_items i ON i.id=s.item_id WHERE s.shop_id=$1 AND i.active=1 ORDER BY i.name,i.id',[shopId]);
}
export async function shopView(db:Store,shopId:string,channelId:string,parentId:string|undefined,eligibleRp:boolean){
  const [shop]=await db.query('SELECT * FROM pc_shops WHERE id=$1',[shopId]);
  requireThat(shop,404,'Shop unavailable.');
  return {id:shop.id,name:shop.name,description:shop.description,ownerName:shop.owner_name,
    general:Number(shop.is_general)===1,open:Number(shop.is_open)===1,version:Number(shop.version),
    channelIds:JSON.parse(shop.channel_ids),availability:shopAccessible(shop,channelId,parentId,eligibleRp),
    items:(await listShopItems(db,shopId)).map(i=>({id:i.id,name:i.name,description:i.description,kind:i.kind,
      imageUrl:i.image_url,price:i.price,unlimited:Number(i.unlimited)===1,stock:Number(i.quantity),discountBps:Number(i.discount_bps),
      stackable:Number(i.stackable)===1,bound:Number(i.bound)===1,tradeable:Number(i.tradeable)===1,restockMode:i.restock_mode}))};
}
export async function inventoryFor(db:Store,userId:string,characterId:string,staffView=false){
  validateId(characterId,'character');
  const [char]=await db.query('SELECT owner_id FROM pc_characters WHERE id=$1',[characterId]);
  requireThat(char&&(char.owner_id===userId||staffView),403,'You may inspect only your own character inventory.');
  const [capacity]=await db.query('SELECT slots FROM pc_inventory_capacities WHERE character_id=$1',[characterId]);
  const stacks=await db.query('SELECT s.id,s.item_id,s.stack_key,s.quantity,s.durability,s.expires_ms,i.name,i.kind,i.tradeable,i.bound FROM pc_inventory_stacks s JOIN pc_shop_items i ON i.id=s.item_id WHERE s.character_id=$1 ORDER BY i.name,s.id',[characterId]);
  return {characterId,slots:capacity?Number(capacity.slots):null,used:stacks.length,
    items:stacks.map(x=>({instanceId:x.id,itemId:x.item_id,name:x.name,kind:x.kind,quantity:Number(x.quantity),
      durability:x.durability===null?null:Number(x.durability),expiresMs:x.expires_ms===null?null:Number(x.expires_ms),
      tradeable:Number(x.tradeable)===1,bound:Number(x.bound)===1}))};
}
export type ShopPurchase={receipt:string;characterId:string;shopId:string;itemId:string;quantity:number;payFrom:'cash'|'bank';
  channelId:string;parentId?:string;eligibleRp:boolean};
export async function buyFromShop(db:Store,userId:string,input:ShopPurchase,now=Date.now()){
  receiptId(input.receipt);validateId(input.characterId,'character');validateId(input.shopId,'shop');validateId(input.itemId,'item');
  requireThat(discordId.test(userId)&&discordId.test(input.channelId),400,'Discord user and RP channel required.');
  requireThat(input.payFrom==='cash'||input.payFrom==='bank',400,'Choose cash or bank for this purchase.');
  requireThat(Number.isInteger(input.quantity)&&input.quantity>=1&&input.quantity<=100,400,'Choose 1–100 items per purchase.');
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['shop:'+input.shopId]);
    const [existing]=await q('SELECT * FROM pc_shop_sales WHERE receipt_id=$1',[input.receipt]);
    if(existing){
      requireThat(existing.actor_id===userId&&existing.shop_id===input.shopId&&existing.item_id===input.itemId&&
        existing.character_id===input.characterId&&Number(existing.quantity)===input.quantity&&existing.pay_from===input.payFrom,
        409,'This purchase receipt belongs to a different action.');
      return {receipt:input.receipt,replayed:true,total:existing.total};
    }
    const [shop]=await q('SELECT * FROM pc_shops WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.shopId]);
    requireThat(shop,404,'Shop unavailable.');
    const access=shopAccessible(shop,input.channelId,input.parentId,input.eligibleRp);
    requireThat(access.canBuy,403,access.why);
    const [item]=await q('SELECT * FROM pc_shop_items WHERE id=$1',[input.itemId]);
    requireThat(item&&Number(item.active)===1,404,'This item is unavailable.');
    const [stock]=await q('SELECT * FROM pc_shop_stock WHERE shop_id=$1 AND item_id=$2'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.shopId,input.itemId]);
    requireThat(stock,404,'This shop does not stock that item.');
    requireThat(Number(stock.unlimited)===1||Number(stock.quantity)>=input.quantity,409,'Not enough stock remains.');
    const total=balance(stock.price)*BigInt(input.quantity)*(10000n-BigInt(stock.discount_bps))/10000n;
    requireThat(total>=0n&&total<=moneyMax,409,'Calculated item price is outside supported currency precision.');
    const [character]=await q('SELECT owner_id,sheet FROM pc_characters WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]);
    requireThat(character&&character.owner_id===userId&&JSON.parse(character.sheet).characterType!=='NPC',403,
      'Explicitly choose an approved player character you own.');
    const sheet=JSON.parse(character.sheet);
    const [capacity]=await q('SELECT slots FROM pc_inventory_capacities WHERE character_id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]);
    requireThat(capacity,409,'Inventory capacity is not yet configured for this character. Ask staff to set an approved slot count.');
    const [used]=await q('SELECT COUNT(*) AS slots FROM pc_inventory_stacks WHERE character_id=$1',[input.characterId]);
    const stackable=Number(item.stackable)===1;
    const [same]=stackable?await q("SELECT id FROM pc_inventory_stacks WHERE character_id=$1 AND item_id=$2 AND stack_key='stack'",
      [input.characterId,input.itemId]):[];
    const slotsRequired=stackable?(same?0:1):input.quantity;
    requireThat(Number(used.slots)+slotsRequired<=Number(capacity.slots),409,'Your inventory does not have enough available slots.');
    await ensureAccount(q,input.characterId,sheet);
    const [account]=await q('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]);
    requireThat(account,409,'Unable to load the character’s authoritative bank account.');
    if(input.payFrom==='cash')requireThat(openingCash(sheet)===account.cash,409,'Wallet needs a balance reconciliation before spending.');
    const before=BigInt(input.payFrom==='cash'?account.cash:account.bank);
    requireThat(before>=total,409,'Insufficient available funds; overdraft policy has not been approved.');
    const after=(before-total).toString(),beforeCash=account.cash,beforeBank=account.bank;
    const nextCash=input.payFrom==='cash'?after:account.cash,nextBank=input.payFrom==='bank'?after:account.bank;
    if(input.payFrom==='cash'){
      sheet.wallet=nextCash;
      await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(sheet),input.characterId]);
    }
    await q('UPDATE pc_economy_accounts SET cash=$1,bank=$2,revision=revision+1 WHERE character_id=$3',[nextCash,nextBank,input.characterId]);
    if(!Number(stock.unlimited))
      await q('UPDATE pc_shop_stock SET quantity=quantity-$1,revision=revision+1 WHERE shop_id=$2 AND item_id=$3',
        [input.quantity,input.shopId,input.itemId]);
    if(stackable){
      await q('INSERT INTO pc_inventory_stacks(id,character_id,item_id,stack_key,quantity,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(character_id,item_id,stack_key) DO UPDATE SET quantity=pc_inventory_stacks.quantity+excluded.quantity,updated_ms=excluded.updated_ms',
        [randomUUID(),input.characterId,input.itemId,'stack',input.quantity,now]);
    }else for(let i=0;i<input.quantity;i++){
      const id=randomUUID();
      await q('INSERT INTO pc_inventory_stacks(id,character_id,item_id,stack_key,quantity,durability,created_ms,updated_ms) VALUES($1,$2,$3,$4,1,$5,$6,$6)',
        [id,input.characterId,input.itemId,id,item.max_durability||null,now]);
    }
    const transactionId='shop:'+input.receipt,fingerprint=createHash('sha256').update(
      JSON.stringify([userId,input.characterId,input.shopId,input.itemId,input.quantity,input.payFrom,total.toString()])).digest('hex');
    const posted=await q('INSERT INTO pc_economy_transactions(id,actor_id,kind,reason,amount,currency_id,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id',
      [transactionId,userId,'shop_purchase','Purchased '+item.name+' from '+shop.name,total.toString(),economyCurrencyId,fingerprint,now]);
    requireThat(posted.length===1,409,'This purchase has already been charged.');
    await q('INSERT INTO pc_economy_entries(transaction_id,character_id,cash_before,cash_after,bank_before,bank_after) VALUES($1,$2,$3,$4,$5,$6)',
      [transactionId,input.characterId,beforeCash,nextCash,beforeBank,nextBank]);
    const sold=await q('INSERT INTO pc_shop_sales(receipt_id,shop_id,item_id,character_id,actor_id,quantity,unit_price,discount_bps,total,pay_from,channel_id,transaction_id,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(receipt_id) DO NOTHING RETURNING receipt_id',
      [input.receipt,input.shopId,input.itemId,input.characterId,userId,input.quantity,stock.price,stock.discount_bps,total.toString(),
        input.payFrom,input.channelId,transactionId,now]);
    requireThat(sold.length===1,409,'Purchase receipt reused during a transaction.');
    await audit(q,userId,'shop',input.shopId,'purchased','Character '+input.characterId+' bought '+input.quantity+' x '+item.name);
    return {receipt:input.receipt,replayed:false,total:total.toString(),paidFrom:input.payFrom,
      cash:nextCash,bank:nextBank,stockLeft:Number(stock.unlimited)===1?null:Number(stock.quantity)-input.quantity};
  });
}
