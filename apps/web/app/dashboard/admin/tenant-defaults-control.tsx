'use client';
import {useEffect,useState,type FormEvent} from 'react';
const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';

export default function TenantDefaultsControl(){
 const[daily,setDaily]=useState(''),[monthly,setMonthly]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const[effective,setEffective]=useState<{dailyLimit:number;monthlyLimit:number}|null>(null);
 useEffect(()=>{fetch(`${API}/api/v1/admin/settings`,{credentials:'include'}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.message??'Could not load workspace defaults.');setDaily(String(body.data.defaultTenantDailyLimit??''));setMonthly(String(body.data.defaultTenantMonthlyLimit??''));setEffective(body.data.tenantDefaults);}).catch(reason=>setError(reason instanceof Error?reason.message:'Could not load workspace defaults.')).finally(()=>setLoading(false));},[]);
 async function save(event:FormEvent){event.preventDefault();setSaving(true);setSaved(false);setError('');try{
  const response=await fetch(`${API}/api/v1/admin/settings`,{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultTenantDailyLimit:daily.trim()===''?null:Number(daily),defaultTenantMonthlyLimit:monthly.trim()===''?null:Number(monthly)})});
  const body=await response.json();if(!response.ok)throw Error(body.message??'Could not save workspace defaults.');setEffective(body.data.tenantDefaults);setSaved(true);
 }catch(reason){setError(reason instanceof Error?reason.message:'Could not save workspace defaults.');}finally{setSaving(false);}}
 return <form className="card" style={{marginBottom:18}} onSubmit={save}>
  <h2 className="card-title" style={{marginTop:0}}>New workspace defaults</h2>
  <p className="muted small" style={{lineHeight:1.8}}>Starting allowances for new registrations and newly created workspaces. Existing workspaces keep their assigned quotas. Leave a field blank to use its environment default; zero gives new workspaces no sending allowance for that period.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
   <div className="field" style={{minWidth:190,margin:0}}><label htmlFor="default-tenant-daily">Default daily allowance</label><input id="default-tenant-daily" type="number" min="0" max="10000000" disabled={loading||saving} value={daily} onChange={event=>setDaily(event.target.value)}/></div>
   <div className="field" style={{minWidth:190,margin:0}}><label htmlFor="default-tenant-monthly">Default monthly allowance</label><input id="default-tenant-monthly" type="number" min="0" max="100000000" disabled={loading||saving} value={monthly} onChange={event=>setMonthly(event.target.value)}/></div>
   <button className="button secondary" disabled={loading||saving||!effective}>{saving?'Saving…':'Save workspace defaults'}</button>
  </div>
  {effective&&<p className="muted small">Effective defaults: {effective.dailyLimit.toLocaleString()} daily · {effective.monthlyLimit.toLocaleString()} monthly.</p>}
  {saved&&<p role="status" className="muted small">Workspace defaults saved. Existing workspace quotas are unchanged.</p>}
 </form>;
}
