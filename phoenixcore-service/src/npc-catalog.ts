import type { Query, Store } from './db.ts';
import { formArtwork,publishedForm } from './codex.ts';
import forms from '../../phoenixcore/templates.js';

export const azurikId = 'f4aa99d3-4a75-40c7-8737-adb4b7e31300';
const mastery = 'azurik-super-saiyan-grade-4';
const ruleKey = 'races/saiyan/paths/0/forms/1';
export const isAzurik=(id:string,sheet:any)=>id===azurikId || sheet?.npcIdentity==='king-azurik';
export const azurikSheet = {
  name:'King Azurik', alias:'Azurik', characterType:'NPC', lineage:'Saiyan', className:'C-Type Saiyan',
  age:'107', gender:'Male', height:'7′5″', weight:'426 lbs', alignment:'Lawful Good',
  occupation:'King of Sadala · Universal Militia', family:'Son of King Ziex. Aikon is his nephew.',
  bio:'Born in Age 1,630, Azurik refused his father’s demand for another campaign of conquest. At the Battle of the Crimson Peaks he offered King Ziex the chance to surrender. He carries the cost of that battle into his reign. Through King Casuran and the Tuffles of Plant, he helped restore Sadala’s ecosystems and its energy grids. His academies teach strategy and ethics alongside combat. Azurik is alive and reigning at the opening of the reboot.',
  personality:'Azurik speaks with measured precision and a trace of melancholy. In thought, he clasps his hands behind his back. He listens before answering, respects knowledge and restraint, and asks difficult questions of those he mentors. He gives an opponent the opportunity to stand down. When words fail, he acts with calculated precision.',
  strengths:'Diplomatic foresight\nPatient mentorship\nPrecision under pressure',
  weaknesses:'Cannot forgive himself for lives lost\nRevisits decisions long after the moment has passed\nSometimes trusts those who would betray him',
  techniquesItems:'Galick Gun\nOrga Blaster', portrait:'../assets/uploads/king-azurik.png',
  bpl:'10000000', attainedForms:JSON.stringify([{id:mastery,name:'Mastered Super Saiyan',portrait:'',multiplier:'85'}]),
  wallet:'0', gear:[], speed:'',durability:'',intelligence:'',control:''
};

export async function seedAzurik(db:Store, owner:string) {
  await db.transaction(async q=>{
    const inserted=await q("INSERT INTO pc_migrations(name) VALUES('npc-azurik-reboot-v1') ON CONFLICT DO NOTHING RETURNING name");
    if(!inserted.length)return;
    const owned=await q('SELECT id,sheet FROM pc_characters WHERE owner_id=$1 ORDER BY id'+(db.dialect==='postgres'?' FOR UPDATE':''),[owner]);
    const existing=owned.find(row=>{
      const sheet=JSON.parse(row.sheet);
      return sheet.characterType==='NPC' && sheet.name.trim().toLowerCase()===azurikSheet.name.toLowerCase();
    });
    if(existing){
      const original=JSON.parse(existing.sheet);
      const sheet={...azurikSheet,...original,npcIdentity:'king-azurik',bpl:azurikSheet.bpl};
      if(!sheet.portrait)sheet.portrait=azurikSheet.portrait;
      const attained=forms.readForms(original.attainedForms);
      let grade=attained.find((form:any)=>form.id===mastery || /^mastered super saiyan(?: \(grade 4\))?$/i.test(form.name));
      if(!grade){grade=forms.readForms(azurikSheet.attainedForms)[0];attained.push(grade);}
      sheet.npcMasteryId=grade.id;
      sheet.attainedForms=JSON.stringify(attained);
      await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(sheet),existing.id]);
      return;
    }
    await q('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING',[azurikId,owner,JSON.stringify(azurikSheet)]);
  });
}

export async function npcChoices(q:Query, search='') {
  const rows=await q('SELECT id,sheet FROM pc_characters ORDER BY id');
  const query=search.trim().toLowerCase();
  return rows.flatMap(row=>{
    const s=JSON.parse(row.sheet);
    return s.characterType==='NPC' && String(s.name).toLowerCase().includes(query)?[{name:s.name,value:row.id}]:[];
  }).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,25);
}

export async function ruleSheet(q:Query,id:string,sheet:any) {
  if(!isAzurik(id,sheet) || !sheet.attainedForms)return sheet;
  const list=forms.readForms(sheet.attainedForms);
  const form=list.find((f:any)=>f.id===(sheet.npcMasteryId||mastery));
  if(!form)return sheet;
  const html=(await publishedForm(q,ruleKey)).html||'';
  const plain=html.normalize('NFKC').replace(/<[^>]+>/g,' ').replace(/&times;|&#215;/gi,'×');
  const section=plain.split(/multipliers?/i).at(-1) || '';
  const factor=/\bGrade\s*4\s*[:–—-]?\s*(?:[x×]\s*)?([0-9]{1,8}(?:\.[0-9]{1,4})?)\s*(?:[x×]|times)/i;
  const value=section.match(factor)?.[1] || section.match(/\bGrade\s*4\s*[:–—-]?\s*[x×]\s*([0-9]{1,8}(?:\.[0-9]{1,4})?)/i)?.[1];
  if(value && Number(value)>0)form.multiplier=value; else delete form.multiplier;
  return {...sheet,attainedForms:JSON.stringify(list)};
}

export async function loadNpc(q:Query,id:string) {
  const [row]=await q('SELECT sheet FROM pc_characters WHERE id=$1',[id]);
  if(!row)return null;
  const sheet=JSON.parse(row.sheet);
  return sheet.characterType==='NPC'?await ruleSheet(q,id,sheet):null;
}

export function formStats(sheet:any, key:string) {
  const form=forms.readForms(sheet.attainedForms).find((f:any)=>f.id===key);
  return {form,pl:form && form.id===(sheet.npcMasteryId||mastery) && !form.multiplier ? null : forms.effectiveSheet(sheet,form).bpl,portrait:form?.portrait||sheet.portrait};
}

export function npcFormArt(q:Query,id:string,sheet:any,formId:string){
  const mastered=isAzurik(id,sheet)&&formId===(sheet.npcMasteryId||mastery);
  return formArtwork(q,formId,mastered?ruleKey:undefined);
}
