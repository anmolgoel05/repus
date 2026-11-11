'use client';

import {useCallback,useEffect,useState} from 'react';
import {ShieldAlert} from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
type Report={id:string;senderAddress:string;campaignReference:string|null;messageId:string|null;reporterEmail:string|null;category:string;details:string;status:string;createdAt:string};
type ReportPage={items:Report[];page:number;pageSize:number;total:number;status:string};
async function request(path:string,init?:RequestInit){const response=await fetch(`${API}/api/v1${path}`,{credentials:'include',...init});const body=await response.json();if(!response.ok)throw Error(body.message??'Could not update abuse reports.');return body.data;}

export default function AbuseReportsPanel(){
 const[data,setData]=useState<ReportPage|null>(null);
 const[error,setError]=useState('');
 const[saving,setSaving]=useState('');
 const[page,setPage]=useState(1);
 const[status,setStatus]=useState('active');
 const load=useCallback(async()=>{
  try{setData(await request(`/admin/abuse-reports?page=${page}&pageSize=25&status=${status}`));setError('');}
  catch(e){setError(e instanceof Error?e.message:'Could not load abuse reports.');}
 },[page,status]);
 useEffect(()=>{void load();},[load]);
 async function update(report:Report,nextStatus:string){
  setSaving(report.id);setError('');
  try{await request(`/admin/abuse-reports/${report.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:nextStatus})});if(page===1)await load();else setPage(1);}
  catch(e){setError(e instanceof Error?e.message:'Could not update abuse report.');}
  finally{setSaving('');}
 }
 return <section className="card" style={{marginBottom:16}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:6}}>
   <div style={{display:'flex',alignItems:'center',gap:8}}><ShieldAlert size={17} color="#b65a20"/><div className="card-title">Abuse reports</div></div>
   <select aria-label="Filter abuse reports" value={status} onChange={event=>{setPage(1);setStatus(event.target.value);}}>
    <option value="active">Open and in review</option><option value="all">All reports</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option>
   </select>
  </div>
  <p className="muted small">Active reports appear oldest first so new submissions cannot hide overdue cases. Closed reports are retained for one year.</p>
  {error&&<div className="error" role="alert">{error}</div>}
  {!error&&data?.items.length===0&&<div className="muted small">No reports in this view.</div>}
  <div style={{display:'grid',gap:10}}>{data?.items.map(report=><article key={report.id} style={{border:'1px solid #e8edf4',borderRadius:10,padding:13}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}><div><b style={{fontSize:13}}>{report.senderAddress}</b><div className="muted small" style={{marginTop:3}}>{report.category.replace('_',' ')} · {new Date(report.createdAt).toLocaleString()}</div></div>
    <select aria-label={`Status for report from ${report.senderAddress}`} value={report.status} disabled={saving===report.id} onChange={event=>void update(report,event.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select>
   </div>
   <p style={{fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap',margin:'10px 0'}}>{report.details}</p>
   <div className="muted small">{report.campaignReference&&<>Campaign or subject: {report.campaignReference} · </>}{report.messageId&&<>Message ID: {report.messageId} · </>}{report.reporterEmail?`Reply contact: ${report.reporterEmail}`:'No reply contact provided'}</div>
  </article>)}</div>
  {data&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:14}}><span className="muted small">Showing {data.total===0?0:(data.page-1)*data.pageSize+1}–{Math.min(data.page*data.pageSize,data.total)} of {data.total}</span><div style={{display:'flex',gap:8}}><button type="button" className="button secondary" disabled={data.page<=1} onClick={()=>setPage(value=>value-1)}>Previous</button><button type="button" className="button secondary" disabled={data.page*data.pageSize>=data.total} onClick={()=>setPage(value=>value+1)}>Next</button></div></div>}
 </section>;
}
