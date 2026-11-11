'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {CheckCircle2,Mail} from 'lucide-react';

const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000';
export default function ConfirmSubscriptionPage(){
 const {token}=useParams<{token:string}>();
 const[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 async function confirm(){setBusy(true);setError('');try{const response=await fetch(`${API}/api/v1/confirm-subscription/${encodeURIComponent(token)}`,{method:'POST',headers:{Accept:'application/json'}});const body=await response.json();if(!response.ok)throw Error(body.message??'This confirmation link is invalid or has expired.');setConfirmed(true);}catch(e){setError(e instanceof Error?e.message:'Could not confirm your subscription.');}finally{setBusy(false);}}
 return <main style={{minHeight:'100vh',background:'#f7f9fd',padding:'40px 18px',display:'grid',placeItems:'center'}}><section className="card" style={{maxWidth:480,width:'100%',padding:30,textAlign:'center'}}><div style={{width:46,height:46,margin:'0 auto',borderRadius:13,background:confirmed?'#eaf7ef':'#edf4ff',color:confirmed?'#167544':'#3975df',display:'grid',placeItems:'center'}}>{confirmed?<CheckCircle2 size={22}/>:<Mail size={22}/>}</div><h1 className="font-display" style={{fontSize:26,margin:'18px 0 8px'}}>{confirmed?'Subscription confirmed':'Confirm your subscription'}</h1><p className="muted" style={{fontSize:14,lineHeight:1.7}}>{confirmed?'You are confirmed to receive emails from this sender.':'Please confirm that you want to receive emails from this sender.'}</p>{error&&<div className="error" role="alert" style={{margin:'16px 0'}}>{error}</div>}{!confirmed?<button className="button" onClick={()=>void confirm()} disabled={busy} style={{marginTop:10,justifyContent:'center',width:'100%'}}>{busy?'Confirming…':'Confirm subscription'}</button>:<Link href="/" className="button secondary" style={{marginTop:10,justifyContent:'center',textDecoration:'none'}}>Return to Repus</Link>}<p className="muted small" style={{marginTop:18}}>If you did not expect this message, you can close this page.</p></section></main>;
}
