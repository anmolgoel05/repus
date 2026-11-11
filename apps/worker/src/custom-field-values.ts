export type CustomFieldValue=string|number|boolean;
export type CustomFieldParse={valid:true;empty:boolean;value?:CustomFieldValue}|{valid:false;reason:string};

export function parseCustomFieldValue(type:string,rawValue:string,label:string,required:boolean):CustomFieldParse{
 const raw=rawValue.trim();
 if(!raw)return required?{valid:false,reason:`${label} is required.`}:{valid:true,empty:true};
 if(type==='TEXT')return raw.length<=4000?{valid:true,empty:false,value:raw}:{valid:false,reason:`${label} is too long.`};
 if(type==='NUMBER'){const value=Number(raw);return Number.isFinite(value)?{valid:true,empty:false,value}:{valid:false,reason:`${label} must be a number.`};}
 if(type==='BOOLEAN')return ['true','false'].includes(raw.toLowerCase())?{valid:true,empty:false,value:raw.toLowerCase()==='true'}:{valid:false,reason:`${label} must be true or false.`};
 if(type==='DATE'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return {valid:false,reason:`${label} must be a date in YYYY-MM-DD format.`};
  const date=new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===raw?{valid:true,empty:false,value:raw}:{valid:false,reason:`${label} is not a valid date.`};
 }
 return {valid:false,reason:`${label} has an unsupported field type.`};
}
