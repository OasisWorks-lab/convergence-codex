import type {Store} from './db.ts';
import {requireThat,type Actor} from './domain.ts';
import {listShopCatalog} from './shop.ts';

const idFormat=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day=24*60*60*1000;
type Totals={receipts:bigint;units:bigint;zeni:bigint;cashZeni:bigint;bankZeni:bigint};
const empty=():Totals=>({receipts:0n,units:0n,zeni:0n,cashZeni:0n,bankZeni:0n});
const add=(totals:Totals,row:any)=>{
  const price=BigInt(row.total),quantity=BigInt(row.quantity);
  totals.receipts++;
  totals.units+=quantity;
  totals.zeni+=price;
  if(row.payment==='cash')totals.cashZeni+=price;
  else if(row.payment==='bank')totals.bankZeni+=price;
};
const visible=(totals:Totals)=>({
  receipts:totals.receipts.toString(),units:totals.units.toString(),
  zeni:totals.zeni.toString(),cashZeni:totals.cashZeni.toString(),bankZeni:totals.bankZeni.toString()
});
type ItemTotals={itemId:string;name:string;values:Totals};
type ShopTotals={id:string;name:string;all:Totals;last7:Totals;last30:Totals;items:Map<string,ItemTotals>};
export async function shopSalesReport(db:Store,actor:Actor,shopId?:string,clock=Date.now()){
  requireThat(actor.isJudge,403,'Only the Convergence Owner or configured Helper can review shop sales.');
  requireThat(shopId===undefined||idFormat.test(shopId),400,'Choose a valid shop ID.');
  const catalog=await listShopCatalog(db);
  requireThat(!shopId||catalog.shops.some(s=>s.id===shopId),404,'Shop not found.');
  const itemNames=new Map(catalog.items.map(item=>[item.id,item.name]));
  const aggregates=new Map<string,ShopTotals>(catalog.shops.filter(s=>!shopId||s.id===shopId)
    .map(shop=>[shop.id,{id:shop.id,name:shop.name,all:empty(),last7:empty(),last30:empty(),
      items:new Map<string,ItemTotals>()}]));
  const overall={all:empty(),last7:empty(),last30:empty()};
  const recent:any[]=[];
  let cursorMs=-1,cursorId='',scanned=0;
  const cutoff7=clock-7*day,cutoff30=clock-30*day;
  for(;;){
    const rows=await db.query(`SELECT id,shop_id,item_id,character_id,payment,quantity,total,unit_price,created_ms
      FROM pc_shop_purchases
      WHERE ($1 IS NULL OR shop_id=$1) AND (created_ms>$2 OR (created_ms=$2 AND id>$3))
      ORDER BY created_ms,id LIMIT 500`,[shopId??null,cursorMs,cursorId]);
    if(!rows.length)break;
    for(const row of rows){
      const bucket=aggregates.get(row.shop_id);
      if(!bucket)continue;
      const created=Number(row.created_ms);
      add(bucket.all,row);add(overall.all,row);
      if(created>=cutoff30){add(bucket.last30,row);add(overall.last30,row);}
      if(created>=cutoff7){add(bucket.last7,row);add(overall.last7,row);}
      let item=bucket.items.get(row.item_id);
      if(!item){
        item={itemId:row.item_id,name:itemNames.get(row.item_id)||'Previously registered item',values:empty()};
        bucket.items.set(row.item_id,item);
      }
      add(item.values,row);
      recent.push({receiptId:row.id,shopId:row.shop_id,itemId:row.item_id,
        itemName:item.name,characterId:row.character_id,quantity:Number(row.quantity),
        payment:row.payment,totalZeni:String(row.total),createdMs:created});
      if(recent.length>40)recent.shift();
      scanned++;
    }
    const last=rows[rows.length-1];
    cursorMs=Number(last.created_ms);cursorId=last.id;
    if(rows.length<500)break;
  }
  return {generatedMs:clock,receiptCount:scanned,overall:{
    all:visible(overall.all),last7:visible(overall.last7),last30:visible(overall.last30)},
    shops:[...aggregates.values()].map(shop=>({
      id:shop.id,name:shop.name,all:visible(shop.all),last7:visible(shop.last7),
      last30:visible(shop.last30),
      topItems:[...shop.items.values()].sort((a,b)=>a.values.units===b.values.units?
        a.name.localeCompare(b.name):a.values.units>b.values.units?-1:1).slice(0,10)
        .map(item=>({itemId:item.itemId,name:item.name,...visible(item.values)}))
    })).sort((a,b)=>BigInt(a.all.zeni)===BigInt(b.all.zeni)?
      a.name.localeCompare(b.name):BigInt(a.all.zeni)>BigInt(b.all.zeni)?-1:1),
    recent:recent.reverse()};
}
