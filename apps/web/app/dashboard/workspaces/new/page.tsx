'use client';
import { FormEvent,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft,Building2 } from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';

export default function NewWorkspacePage(){
 const router=useRouter();
 const[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function createWorkspace(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError('');
  const form=new FormData(event.currentTarget);
  try{
   const response=await fetch(`${API}/api/v1/organizations`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.get('name'),timezone:form.get('timezone')})});
   const body=await response.json();if(!response.ok)throw Error(body.message??'Could not create this workspace.');
   const switched=await fetch(`${API}/api/v1/auth/switch-workspace`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:body.data.id})});
   if(!switched.ok)throw Error('Workspace created, but we could not switch to it. Choose it from the workspace menu.');
   window.location.assign('/dashboard');
  }catch(reason){setError(reason instanceof Error?reason.message:'Could not create this workspace.');setBusy(false);}
 }
 return <div className="content"><div className="welcome"><div><Link href="/dashboard" className="muted small" style={{display:'inline-flex',alignItems:'center',gap:6,textDecoration:'none',marginBottom:10}}><ArrowLeft size={14}/>Back to workspace</Link><h1 className="font-display" style={{fontSize:27,margin:'0 0 7px'}}>Create a workspace</h1><p className="muted">Start a separate home for another brand, project, or team.</p></div></div>
  <form className="card" onSubmit={createWorkspace} style={{maxWidth:560}}>
   <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:18}}><Building2 size={18} color="#527fc6"/><div className="card-title">Workspace details</div></div>
   {error&&<div className="error" role="alert">{error}</div>}
   <div className="field"><label htmlFor="workspace-name">Workspace name</label><input id="workspace-name" name="name" required minLength={2} maxLength={160} placeholder="Studio North" autoFocus/></div>
   <div className="field"><label htmlFor="workspace-timezone">Timezone</label><input id="workspace-timezone" name="timezone" required maxLength={80} defaultValue="Asia/Kolkata"/><div className="muted small" style={{marginTop:5}}>Use an IANA timezone, such as America/New_York.</div></div>
   <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18}}><button type="button" className="button secondary" onClick={()=>router.back()}>Cancel</button><button className="button" disabled={busy}>{busy?'Creating…':'Create and switch'}</button></div>
  </form>
 </div>;
}
