function normalizedTxtRecords(records:string[][]){
 return records.map(chunks=>chunks.join('').trim().toLowerCase());
}

export function hasSesSpfRecord(records:string[][]){
 const policies=normalizedTxtRecords(records).filter(value=>/^v=spf1(?:\s|$)/.test(value));
 if(policies.length!==1)return false;
 return policies[0].split(/\s+/).slice(1).some(mechanism=>/^include:amazonses\.com\.?$/.test(mechanism.replace(/^[+?~-]/,'')));
}

export function hasDmarcPolicyRecord(records:string[][]){
 const policies=normalizedTxtRecords(records).filter(value=>/^v=dmarc1(?:;|\s|$)/.test(value));
 if(policies.length!==1)return false;
 const tags=policies[0].split(';').map(value=>value.trim()).filter(Boolean);
 if(tags[0]!=='v=dmarc1')return false;
 const values=new Map<string,string>();
 for(const tag of tags){
  const match=/^([a-z][a-z0-9_]*)\s*=\s*(\S(?:.*\S)?)$/.exec(tag);
  if(!match||values.has(match[1]))return false;
  values.set(match[1],match[2]);
 }
 const policy=values.get('p');
 return policy==='none'||policy==='quarantine'||policy==='reject';
}
