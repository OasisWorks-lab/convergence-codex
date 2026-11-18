import forms from '../../phoenixcore/templates.js';

const words=(s:string)=>s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)||[];
export function assess(r:any,settings:any){
  const checks:{label:string;state:string;detail:string}[]=[];
  const add=(label:string,ok:boolean,detail:string)=>checks.push({label,state:ok?'met':'attention',detail});
  const manual=(label:string,detail:string)=>checks.push({label,state:'review',detail});
  if(r.status==='needs_details')add('Discord intake',false,'Complete the structured submission using the original Discord post.');
  const kind=r.kind==='edit'?'create':r.kind, fields=r.kind==='training'?r.details||{}:r.after||{};
  if(forms.forms[kind]){
    const missing=forms.allFields(kind).filter((f:any)=>f.required&&!String(fields[f.key]??'').trim()).map((f:any)=>f.label);
    add('Required template fields',!missing.length,missing.length?'Missing '+missing.join(', '):'All required fields are present.');
  }
  if(kind==='create'){
    for(const field of ['strengths','weaknesses']){
      const count=new Set(String(fields[field]||'').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(Boolean)).size;
      add('Personal '+field,count>=3,count+' distinct entries. The template requires three.');
    }
    const paragraphs=String(fields.bio||'').trim().split(/\n\s*\n/).filter(p=>p.trim());
    const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
    const sentences=paragraphs.map(p=>[...segmenter.segment(p)].map(s=>s.segment).filter(s=>words(s).length));
    const count=sentences.flat().length;
    manual('Backstory length',paragraphs.length+' paragraphs · '+count+' sentences · '+words(fields.bio||'').length+' words.');
    if(Number(settings.loreParagraphs))add('Paragraph minimum',paragraphs.length>=Number(settings.loreParagraphs),'Configured minimum of '+settings.loreParagraphs+' paragraphs.');
    if(Number(settings.loreSentences))add('Sentences per paragraph',!!paragraphs.length&&sentences.every(s=>s.length>=Number(settings.loreSentences)),'Configured minimum of '+settings.loreSentences+' sentences per paragraph.');
    if(Number(settings.loreWords))add('Words per sentence',count>0&&sentences.flat().every(s=>words(s).length>=Number(settings.loreWords)),'Configured minimum of '+settings.loreWords+' words per sentence. Read dialogue and fragments in context.');
    manual('Character balance','Check that the strengths are personal, the flaws affect play, and the attained forms are earned.');
  }else if(kind==='item'){
    if(fields.currentInt&&fields.requiredInt)add('Intelligence tier',Number(fields.currentInt)>=Number(fields.requiredInt),'Current '+fields.currentInt+' · required '+fields.requiredInt+'. Check any mentorship or staff assistance.');
    manual('Item balance','Compare the effects with the stated limitations and cooldown.');
  }else if(kind==='training')manual('Training evidence','Compare the scene, claimed boosts and calculation with the approved sheet before judging the award.');
  else if(kind==='technique'||kind==='transformation')manual('Power and limitations','Compare the requirements, drawbacks and effects with the current server rules.');
  else if(kind==='race')manual('Race mechanics','Check the base roll, distinct traits and transformation access.');
  if(settings.reviewGuidance)manual('Owner guidance',settings.reviewGuidance);
  return {summary:checks.some(c=>c.state==='attention')?'Needs attention':'Ready for staff review',checks};
}
