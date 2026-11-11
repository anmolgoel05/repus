'use client';
import {useCallback,useEffect,useState} from 'react';
import {AlertTriangle,Check,RefreshCw} from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
type UncertainSend={id:string;tenantId:string;campaignId:string;email:string;sendStartedAt:string;providerMessageId:string|null;quotaReserved:boolean;campaign:{name:string;tenant:{name:string}}};
async function request(path:string,init?:RequestInit){const response=await fetch(`${API}/api/v1${path}`,{credentials:'include',...init});const body=await response.json();if(!response.ok)throw new Error(body.message??'Could not update uncertain sends.');return body.data;}
export default function UncertainSendsPanel(){
 const[items,setItems]=useState<UncertainSend[]>([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{const data=await request('/admin/uncertain-sends');setItems(data.items);setTotal(data.total);}catch(e){setError(e instanceof Error?e.message:'Could not load uncertain sends.');}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 async function resolve(item:UncertainSend,outcome:'accepted'|'not_accepted'){
  let messageId:string|undefined;
  if(outcome==='accepted'){
   messageId=window.prompt('SES message ID from the provider evidence:')?.trim();
   if(!messageId)return;
   if(!window.confirm('Confirm this message was accepted by SES? Repus will count it as sent and release its reserved quota.'))return;
  }else if(!window.confirm('Confirm SES did not accept this message? Repus will mark it failed and release its reserved quota.'))return;
  const evidence=window.prompt('Add an audit note identifying the evidence checked (minimum 10 characters):')?.trim();
  if(!evidence||evidence.length<10){setError('Add an evidence note of at least 10 characters to continue.');return;}
  setSaving(item.id);setError('');
  try{await request(`/admin/uncertain-sends/${item.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome,evidence,...(messageId?{messageId}:{})})});await load();}
  catch(e){setError(e instanceof Error?e.message:'Could not resolve this send.');}
  finally{setSaving('');}
 }
 return <section className="card" style={{marginTop:18}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><div style={{display:'flex',alignItems:'center',gap:9}}><AlertTriangle size={18} color="#b7791f"/><div className="card-title">Provider review needed</div><span className="badge neutral">{total}</span></div><button className="button secondary" disabled={loading} onClick={()=>void load()}><RefreshCw size={14}/>{loading?'Refreshing…':'Refresh'}</button></div><p className="muted small" style={{margin:'8px 0 14px'}}>These sends may have reached SES before Repus lost the response. Check SES message history before resolving one. Each decision releases its reservation or records provider acceptance and is written to the platform audit log.</p>{error&&<div className="error" style={{marginBottom:12}}>{error}</div>}{loading&&!items.length?<div className="muted small">Loading sends…</div>:!items.length?<div className="muted small">No sends are waiting for review.</div>:<div style={{display:'grid',gap:10}}>{items.map(item=><div key={item.id} style={{border:'1px solid #e8edf4',borderRadius:10,padding:13,display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:12,alignItems:'center'}}><div><b>{item.email}</b><div className="muted small">{item.campaign.tenant.name} · {item.campaign.name}</div><div className="muted small">Started {new Date(item.sendStartedAt).toLocaleString()} · {item.quotaReserved?'quota reserved':'no quota reservation'}{item.providerMessageId?` · provider ID ${item.providerMessageId}`:''}</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}><button className="button secondary" disabled={saving===item.id} onClick={()=>void resolve(item,'not_accepted')}>Confirm not accepted</button><button className="button" disabled={saving===item.id} onClick={()=>void resolve(item,'accepted')}><Check size={14}/>{saving===item.id?'Saving…':'Confirm accepted'}</button></div></div>)}</div>}</section>;
}
