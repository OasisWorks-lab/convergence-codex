import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,defaultSettings} from '../src/db.ts';
import type {Actor} from '../src/domain.ts';
import {createShop,createShopItem,setShopStock,setShopOpen,purchaseShopItem,unlistShopItem} from '../src/shop.ts';
import {bankAction} from '../src/economy.ts';
import {shopSalesReport} from '../src/shop-sales.ts';
import {shopInteraction} from '../src/shop-discord.ts';

const guild='730000000000000001',ownerId='730000000000000002',writerId='730000000000000003',
  helperId='730000000000000004',helperRole='730000000000000005',channel='730000000000000006';
const owner:Actor={id:ownerId,isOwner:true,isJudge:true,isPlayer:true},
  helper:Actor={id:helperId,isOwner:false,isJudge:true,isPlayer:true},
  player:Actor={id:writerId,isOwner:false,isJudge:false,isPlayer:true};
async function setup(t:any){
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);return db;
}
async function makeCharacter(db:any,wallet='1000'){
  const id=randomUUID();
  await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',
    [id,writerId,JSON.stringify({name:'Rin',characterType:'OC',wallet,bpl:'5000'})]);
  return id;
}
async function shop(db:any,itemId:string,name:string,price:string){
  const created=await createShop(db,helper,{name,kind:'general',ownerName:'The Keeper'});
  const stocked=await setShopStock(db,helper,created.id, itemId,created.revision,price,10000);
  await setShopOpen(db,helper,created.id,stocked.revision,true);
  return created.id;
}
test('shop sales reports are private, exact, grouped by shop and time period',async t=>{
  const db=await setup(t),c=await makeCharacter(db);
  const item=await createShopItem(db,helper,{name:'Travel Potion',description:'Practice item',kind:'consumable',basePrice:'100'});
  const first=await shop(db,item.id,'Portal Shop','100');
  const second=await shop(db,item.id,'Ocean Shop','50');
  await bankAction(db,player,{id:randomUUID(),characterId:c,action:'deposit',amount:'500'});
  const cashReceipt=randomUUID(),bankReceipt=randomUUID(),otherReceipt=randomUUID();
  await purchaseShopItem(db,player,{id:cashReceipt,characterId:c,shopId:first,itemId:item.id,quantity:2,payment:'cash'},
    {channelId:channel,rpEligible:true});
  await purchaseShopItem(db,player,{id:bankReceipt,characterId:c,shopId:first,itemId:item.id,quantity:1,payment:'bank'},
    {channelId:channel,rpEligible:true});
  await purchaseShopItem(db,player,{id:otherReceipt,characterId:c,shopId:second,itemId:item.id,quantity:3,payment:'cash'},
    {channelId:channel,rpEligible:true});
  const now=Date.now();
  await db.query('UPDATE pc_shop_purchases SET created_ms=$1 WHERE id=$2',[now-20*86400000,cashReceipt]);
  await db.query('UPDATE pc_shop_purchases SET created_ms=$1 WHERE id=$2',[now-40*86400000,otherReceipt]);
  await assert.rejects(shopSalesReport(db,player),{status:403});
  await assert.rejects(shopSalesReport(db,helper,'invalid'),{status:400});
  await assert.rejects(shopSalesReport(db,helper,randomUUID()),{status:404});
  const report=await shopSalesReport(db,helper,undefined,now);
  assert.equal(report.overall.all.receipts,'3');
  assert.equal(report.overall.all.units,'6');
  assert.equal(report.overall.all.zeni,'450');
  assert.equal(report.overall.all.cashZeni,'350');
  assert.equal(report.overall.all.bankZeni,'100');
  assert.equal(report.overall.last7.zeni,'100');
  assert.equal(report.overall.last30.zeni,'300');
  assert.equal(report.shops.find(x=>x.id===first)?.all.zeni,'300');
  assert.equal(report.shops.find(x=>x.id===second)?.all.zeni,'150');
  assert.equal(report.shops.find(x=>x.id===first)?.topItems[0].units,'3');
  assert.equal(report.recent[0].receiptId,bankReceipt);
  assert.equal(report.recent[2].receiptId,otherReceipt);
  assert.equal((await shopSalesReport(db,owner,first,now)).shops.length,1);
  const other=(await shopSalesReport(db,owner,first,now)).overall.all;
  assert.equal(other.zeni,'300');
  const [a]=await db.query('SELECT revision FROM pc_shops WHERE id=$1',[first]);
  await unlistShopItem(db,helper,first,item.id,Number(a.revision));
  assert.equal((await shopSalesReport(db,helper,first,now)).overall.all.zeni,'300');
  await initialize(db,guild);
  assert.equal((await shopSalesReport(db,helper,first,now)).overall.all.receipts,'2');
});
test('shop reporting preserves Zeni amounts beyond IEEE-754 safe number precision',async t=>{
  const db=await setup(t),c=await makeCharacter(db,'9007199254740999');
  const amount='9007199254740993';
  const item=await createShopItem(db,helper,{name:'Ancient Relic',description:'High value',kind:'equipment',basePrice:amount});
  const shopId=await shop(db,item.id,'Antique Shop',amount);
  await purchaseShopItem(db,player,{id:randomUUID(),characterId:c,shopId,itemId:item.id,quantity:1,payment:'cash'},
    {channelId:channel,rpEligible:true});
  const report=await shopSalesReport(db,owner);
  assert.equal(report.overall.all.zeni,amount);
  assert.equal(report.overall.all.cashZeni,amount);
  assert.equal(report.overall.all.bankZeni,'0');
  assert.equal(report.shops[0].topItems[0].zeni,amount);
});
test('reports paginate more than 500 receipts without skipping or double-counting',async t=>{
  const db=await setup(t),c=await makeCharacter(db);
  const item=await createShopItem(db,helper,{name:'Token',kind:'consumable',basePrice:'1'});
  const shopId=await shop(db,item.id,'Ticket Shop','1');
  const now=Date.now();
  for(let i=0;i<515;i++){
    await db.query('INSERT INTO pc_shop_purchases(id,actor_id,character_id,shop_id,item_id,channel_id,payment,quantity,unit_price,total,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [randomUUID(),writerId,c,shopId,item.id,channel,'cash',1,'1','1','test-fixture',now+i]);
  }
  const result=await shopSalesReport(db,owner,shopId,now+520);
  assert.equal(result.receiptCount,515);
  assert.equal(result.overall.all.zeni,'515');
  assert.equal(result.recent.length,40);
  assert.equal(result.shops[0].topItems[0].receipts,'515');
});
test('Discord staff shop sales summary is private and uses real multiline reporting',async t=>{
  const db=await setup(t),c=await makeCharacter(db);
  await db.query('UPDATE pc_config SET value=$1 WHERE slot=1',[JSON.stringify({...defaultSettings,judgeRole:helperRole})]);
  const item=await createShopItem(db,helper,{name:'Tonic',kind:'consumable',basePrice:'60'});
  const shopId=await shop(db,item.id,'Dojo Shop','60');
  await purchaseShopItem(db,player,{id:randomUUID(),characterId:c,shopId,itemId:item.id,quantity:1,payment:'cash'},
    {channelId:channel,rpEligible:true});
  const body={guild_id:guild,member:{user:{id:helperId},roles:[helperRole]},
    data:{name:'shop',options:[{name:'admin-sales',options:[{name:'shop',value:shopId}]}]}};
  const settings:any={guild,owner:ownerId};
  const result:any=await shopInteraction(db,settings,body,{} as any);
  assert.equal(result.data.flags,64);
  assert.match(result.data.content,/60 Zeni spent/);
  assert.ok(result.data.content.includes('\n'));
  const wrong:any=await shopInteraction(db,settings,{...body,member:{user:{id:writerId},roles:[]}},{} as any);
  assert.match(wrong.data.content,/Only Owner and Helper staff/);
});
test('PostgreSQL reports reconcile concurrent shop receipts',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='shop_reports_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const c=await makeCharacter(db,'2000');
  const item=await createShopItem(db,helper,{name:'Whetstone',kind:'consumable',basePrice:'75'});
  const shopId=await shop(db,item.id,'Caravan Shop','75');
  await Promise.all(Array.from({length:12},()=>purchaseShopItem(db,player,{id:randomUUID(),characterId:c,
    shopId,itemId:item.id,quantity:1,payment:'cash'},{channelId:channel,rpEligible:true})));
  const report=await shopSalesReport(db,helper,shopId);
  assert.equal(report.shops[0].all.receipts,'12');
  assert.equal(report.shops[0].all.zeni,'900');
  assert.equal(report.shops[0].all.cashZeni,'900');
});
