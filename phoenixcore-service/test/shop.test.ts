import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import type {Actor} from '../src/domain.ts';
import {createShop,createShopItem,setShopOpen,setShopLocations,setShopStock,
  listShopCatalog,shopAccess,characterInventory,purchaseShopItem} from '../src/shop.ts';
import {shopCommands,shopInteraction,shopComponent} from '../src/shop-discord.ts';

const guild='890000000000000001',ownerId='890000000000000002',playerId='890000000000000003',
  otherId='890000000000000004',helperId='890000000000000005',channel='890000000000000006',
  outside='890000000000000007',parent='890000000000000008',helperRole='890000000000000009';
const owner:Actor={id:ownerId,isOwner:true,isJudge:true,isPlayer:true},
  helper:Actor={id:helperId,isOwner:false,isJudge:true,isPlayer:true},
  player:Actor={id:playerId,isOwner:false,isJudge:false,isPlayer:true},
  rival:Actor={id:otherId,isOwner:false,isJudge:false,isPlayer:true};
const general=(channelId=channel)=>({channelId,rpEligible:true});
const locked=(channelId=outside,parentId='')=>({channelId,parentId,rpEligible:true});
async function setup(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;
}
async function character(db:any,who=playerId,amount='1000'){
  const id=randomUUID();
  await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',
    [id,who,JSON.stringify({name:who===playerId?'Rin':'Sola',characterType:'OC',wallet:amount,bpl:'100'})]);
  return id;
}
async function shopWithItem(db:any,kind:'general'|'location'='general',remaining:number|null=5){
  const item=await createShopItem(db,helper,{name:'Training Tonic',kind:'consumable',basePrice:'100',description:'RP preparation'});
  const shop=await createShop(db,helper,{name:kind==='general'?'Portal Store':'Faction Bazaar',kind,description:'Merchant stock',ownerName:'Keeper'});
  let revision=shop.revision;
  if(kind==='location')revision=(await setShopLocations(db,helper,shop.id,revision,[channel])).revision;
  revision=(await setShopStock(db,helper,shop.id,item.id,revision,'100',remaining)).revision;
  revision=(await setShopOpen(db,helper,shop.id,revision,true)).revision;
  return {item,shop:{...shop,revision}};
}
test('staff define centrally shared merchandise across distinct shops with versioned configurations',async t=>{
  const db=await setup(t);
  await assert.rejects(createShopItem(db,player,{name:'Unsafe',kind:'equipment',basePrice:'1'}),{status:403});
  await assert.rejects(createShop(db,player,{name:'Unsafe',kind:'general'}),{status:403});
  const item=await createShopItem(db,helper,{name:'Steel Band',kind:'equipment',basePrice:'500'});
  const a=await createShop(db,owner,{name:'Portal Shop',kind:'general',ownerName:'Master'});
  const b=await createShop(db,helper,{name:'Station Armory',kind:'location'});
  assert.equal(a.status,'closed');
  await assert.rejects(setShopStock(db,player,a.id,item.id,1,'200',10),{status:403});
  const first=await setShopStock(db,helper,a.id,item.id,1,'200',null);
  const second=await setShopStock(db,owner,b.id,item.id,1,'800',3);
  assert.equal(first.revision,2);assert.equal(second.revision,2);
  await assert.rejects(setShopStock(db,helper,a.id,item.id,1,'100',9),{status:409});
  await assert.rejects(setShopLocations(db,helper,a.id,2,[channel]),{status:409});
  await setShopLocations(db,helper,b.id,2,[channel]);
  await setShopOpen(db,owner,a.id,2,true);
  const catalog=await listShopCatalog(db);
  assert.equal(catalog.items.length,1);assert.equal(catalog.shops.length,2);
  assert.equal(catalog.shops.find(s=>s.id===a.id)?.stock[0].price,'200');
  assert.equal(catalog.shops.find(s=>s.id===b.id)?.stock[0].price,'800');
  assert.equal(catalog.shops.find(s=>s.id===a.id)?.stock[0].remaining,null);
  assert.deepEqual(catalog.shops.find(s=>s.id===b.id)?.channels,[channel]);
  assert.equal((await db.query('SELECT kind FROM pc_shop_audit')).length,7);
});
test('shop purchase is atomic against stock, cash/bank and character-owned stack inventory',async t=>{
  const db=await setup(t),a=await character(db),b=await character(db),other=await character(db,otherId);
  const {shop,item}=await shopWithItem(db);
  const first={id:randomUUID(),characterId:a,shopId:shop.id,itemId:item.id,quantity:2,payment:'cash'};
  const r=await purchaseShopItem(db,player,first,general());
  assert.equal(r.cost,'200');assert.equal(r.replayed,false);
  const [sheet]=await db.query('SELECT revision,sheet FROM pc_characters WHERE id=$1',[a]);
  assert.equal(JSON.parse(sheet.sheet).wallet,'800');assert.equal(Number(sheet.revision),2);
  assert.deepEqual((await characterInventory(db,player,a)).items.map(x=>[x.id,x.quantity]),[[item.id,2]]);
  assert.equal((await characterInventory(db,player,b)).items.length,0);
  await assert.rejects(characterInventory(db,rival,a),{status:403});
  await assert.rejects(purchaseShopItem(db,player,{...first,id:randomUUID(),characterId:other},general()),{status:403});
  const again=await purchaseShopItem(db,player,first,general());
  assert.equal(again.replayed,true);
  await assert.rejects(purchaseShopItem(db,player,{...first,quantity:1},general()),{status:409});
  const banked={id:randomUUID(),characterId:b,shopId:shop.id,itemId:item.id,quantity:1,payment:'bank'};
  await assert.rejects(purchaseShopItem(db,player,banked,general()),{status:409});
  const {bankAction}=await import('../src/economy.ts');
  await bankAction(db,player,{id:randomUUID(),characterId:b,action:'deposit',amount:'300'});
  const paid=await purchaseShopItem(db,player,banked,general());
  assert.equal(paid.cost,'100');
  const [account]=await db.query('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1',[b]);
  assert.equal(account.cash,'700');assert.equal(account.bank,'200');
  assert.equal((await db.query("SELECT COUNT(*) AS total FROM pc_economy_transactions WHERE kind='shop_purchase'"))[0].total,2);
  const stock=(await listShopCatalog(db)).shops.find(s=>s.id===shop.id)!.stock[0];
  assert.equal(stock.remaining,2);
  const outsider=await characterInventory(db,rival,other);
  assert.equal(outsider.items.length,0);
});
test('restricted shop cannot be bypassed from wrong location, offline context or closed state',async t=>{
  const db=await setup(t),char=await character(db),{shop,item}=await shopWithItem(db,'location',2);
  const purchase=(id=randomUUID())=>({id,characterId:char,shopId:shop.id,itemId:item.id,quantity:1,payment:'cash'});
  await assert.rejects(purchaseShopItem(db,player,purchase(),locked()),{status:403});
  await assert.rejects(purchaseShopItem(db,player,purchase(),{channelId:channel,rpEligible:false}),{status:403});
  const r=await purchaseShopItem(db,player,purchase(),locked(outside,channel));
  assert.equal(r.cost,'100');
  const s=await setShopOpen(db,helper,shop.id,shop.revision,false);
  assert.equal(s.status,'closed');
  await assert.rejects(purchaseShopItem(db,player,purchase(),general()),{status:403});
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM pc_shop_purchases'))[0].total,1);
  const listed=await listShopCatalog(db);
  assert.equal(shopAccess(listed.shops.find(x=>x.id===shop.id),locked()).allowed,false);
  assert.equal((await characterInventory(db,player,char)).items[0].quantity,1);
});
test('stock exhaustion, insufficient funds and mismatched receipt never double-spend or grant items',async t=>{
  const db=await setup(t),char=await character(db,playerId,'100'),{shop,item}=await shopWithItem(db,'general',1);
  const first={id:randomUUID(),characterId:char,shopId:shop.id,itemId:item.id,quantity:1,payment:'cash'};
  assert.equal((await purchaseShopItem(db,player,first,general())).cost,'100');
  const result=await Promise.allSettled([purchaseShopItem(db,player,{...first,id:randomUUID()},general()),
    purchaseShopItem(db,player,{...first,id:randomUUID()},general())]);
  assert.equal(result.filter(x=>x.status==='rejected').length,2);
  assert.equal((await characterInventory(db,player,char)).items[0].quantity,1);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM pc_shop_purchases'))[0].total,1);
  assert.equal((await db.query('SELECT cash FROM pc_economy_accounts WHERE character_id=$1',[char]))[0].cash,'0');
});
test('shop interactive menu lists merchandise, confirms character and debits only after final payment',async t=>{
  const db=await setup(t),char=await character(db),{shop,item}=await shopWithItem(db);
  await db.query('UPDATE pc_config SET value=$1 WHERE slot=1',[JSON.stringify({
    ...(await import('../src/db.ts')).defaultSettings,judgeRole:helperRole,rpChannels:channel
  })]);
  const settings:any={guild,owner:ownerId,clientId:'890000000000000010'};
  const scope:any={interactionEligible:()=>true};
  const discord:any={call:async(path:string)=>{
    if(path.startsWith('/channels/'))return {id:channel,guild_id:guild,type:0};
    throw Error('Unexpected Discord fetch '+path);
  }};
  const slash=(command:string,opts:any[]=[])=>({guild_id:guild,channel_id:channel,channel:{type:0},
    member:{user:{id:playerId},roles:[]},data:{name:'shop',options:[{name:command,options:opts}]}});
  const view:any=await shopInteraction(db,settings,slash('view',[{name:'shop',value:shop.id}]),discord,scope);
  assert.equal(view.data.components[0].components[0].options[0].value,item.id);
  const firstCustom=view.data.components[0].components[0].custom_id;
  const menu=(custom:string,values:string[]=[])=>({guild_id:guild,channel_id:channel,channel:{type:0},
    member:{user:{id:playerId},roles:[]},data:{custom_id:custom,values},id:randomUUID()});
  const select:any=await shopComponent(db,settings,menu(firstCustom,[item.id]),discord,scope);
  assert.equal(select.data.flags,64);
  const characterOption=select.data.components[0].components[0];
  assert.equal(characterOption.options[0].value,char);
  const payment:any=await shopComponent(db,settings,menu(characterOption.custom_id,[char]),discord,scope);
  assert.equal(payment.data.components[0].components.length,2);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM pc_shop_purchases'))[0].total,0);
  const cashButton=payment.data.components[0].components[0].custom_id;
  const paid:any=await shopComponent(db,settings,menu(cashButton),discord,scope);
  assert.match(paid.data.content,/Purchase complete/);
  assert.equal((await characterInventory(db,player,char)).items[0].quantity,1);
  assert.ok(shopCommands().some(x=>x.name==='shop'));
});
test('PostgreSQL shop purchases serialize stock and repeated identical receipts',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href);
  const schema='shop_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const c=await character(db),{shop,item}=await shopWithItem(db,'general',1);
  const input={id:randomUUID(),characterId:c,shopId:shop.id,itemId:item.id,quantity:1,payment:'cash'};
  const repeated=await Promise.all(Array.from({length:8},()=>purchaseShopItem(db,player,input,general())));
  assert.equal(repeated.filter(x=>!x.replayed).length,1);
  assert.equal(repeated.filter(x=>x.replayed).length,7);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM pc_shop_purchases'))[0].total,1);
  assert.equal((await db.query('SELECT quantity FROM pc_inventory_items WHERE character_id=$1',[c]))[0].quantity,1);
  const second={...input,id:randomUUID()};
  await assert.rejects(purchaseShopItem(db,player,second,general()),{status:409});
  assert.equal((await db.query('SELECT cash FROM pc_economy_accounts WHERE character_id=$1',[c]))[0].cash,'900');
});
