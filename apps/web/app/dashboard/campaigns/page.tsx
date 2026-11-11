'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight,Plus,Send} from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';

type Campaign={id:string;name:string;subject:string|null;status:string;updatedAt:string;_count:{recipients:number}};

async function read<T>(path:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(`${API}/api/v1/${path}`,{credentials:'include',signal});
 if(!response.ok)throw new Error('Could not load campaigns. Try refreshing the page.');
 return response.json();
}

export default function Campaigns(){
 const [data,setData]=useState<Campaign[]|null>(null);
 const [canCreate,setCanCreate]=useState(false);
 const [page,setPage]=useState(1);
 const [hasNext,setHasNext]=useState(false);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void Promise.all([
   read<{data:Campaign[];hasNext:boolean}>(`campaigns?view=summary&page=${page}`,controller.signal),
   read<{data:{role:string}}>('auth/me',controller.signal),
  ]).then(([campaigns,user])=>{
   if(controller.signal.aborted)return;
   setData(campaigns.data);
   setHasNext(campaigns.hasNext);
   setCanCreate(['OWNER','ADMIN','MARKETER'].includes(user.data.role));
  }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
  return ()=>controller.abort();
 },[page,retry]);
 function changePage(next:number){setError('');setData(null);setPage(next);}

 return <div className="content">
  <div className="welcome">
   <div>
    <div className="muted small" style={{marginBottom:8}}>Email</div>
    <h1 className="font-display" style={{fontSize:27,margin:'0 0 7px'}}>Campaigns</h1>
    <div className="muted">{canCreate?'Create, schedule, and learn from your email campaigns.':'Browse campaigns and review their results.'}</div>
   </div>
   {canCreate&&<Link className="button" href="/dashboard/campaigns/new"><Plus size={16}/>Create campaign</Link>}
  </div>
  {error?<div className="error" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={()=>{setError('');setRetry(value=>value+1);}}>Try again</button>{page>1&&<button type="button" className="button secondary" onClick={()=>changePage(page-1)}>Previous page</button>}</div>:data===null?<div className="card muted" role="status">Loading campaigns…</div>:
   <div className="card" style={{overflowX:'auto'}}>
    {data.length?<table className="table">
     <thead><tr><th>Campaign</th><th>Status</th><th>Recipients</th><th>Updated</th><th></th></tr></thead>
     <tbody>{data.map(c=><tr key={c.id}>
      <td><b>{c.name}</b><div className="muted small">{c.subject||'No subject yet'}</div></td>
      <td><span className="pill" style={{background:c.status==='COMPLETED'?'#e9f8ef':c.status==='FAILED'?'#fff0ef':'#eef4ff',color:c.status==='FAILED'?'#b42318':'#3569d4'}}>{c.status.toLowerCase()}</span></td>
      <td>{c._count.recipients}</td>
      <td className="muted">{new Date(c.updatedAt).toLocaleDateString()}</td>
      <td><Link href={`/dashboard/campaigns/${c.id}`} aria-label={`Open ${c.name}`} style={{color:'#2563eb'}}><ArrowRight size={16}/></Link></td>
     </tr>)}</tbody>
    </table>:<div className="empty">
     <Send size={25} color="#7390bc"/><h3>{page===1?'No campaigns yet':'No campaigns on this page'}</h3>
     <div>{canCreate?'Create your first email campaign and start connecting with your subscribers.':'Campaigns in this workspace will appear here.'}</div>
     {canCreate&&<Link className="button" style={{marginTop:16}} href="/dashboard/campaigns/new"><Plus size={15}/>Create your first campaign</Link>}
    </div>}
    {(page>1||hasNext)&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:14}}>
     <span className="muted small">Page {page}</span>
     <div style={{display:'flex',gap:8}}><button className="button secondary" disabled={page===1} onClick={()=>changePage(page-1)}>Previous</button><button className="button secondary" disabled={!hasNext} onClick={()=>changePage(page+1)}>Next</button></div>
    </div>}
   </div>}
 </div>;
}
