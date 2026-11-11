'use client';
import { FormEvent,useEffect,useRef,useState } from 'react';
import Link from 'next/link';

const api=`${process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000'}/api/v1/auth`;

export default function VerifyEmail(){
 const[state,setState]=useState('Verifying your email…');
 const[failed,setFailed]=useState(false);
 const[email,setEmail]=useState('');
 const[resending,setResending]=useState(false);
 const[resent,setResent]=useState(false);
 const[error,setError]=useState('');
 const submittedToken=useRef<string|null>(null);
 useEffect(()=>{
  const token=new URLSearchParams(window.location.search).get('token');
  if(!token){setFailed(true);setState('This verification link is missing its token.');return;}
  if(submittedToken.current===token)return;
  submittedToken.current=token;
  fetch(`${api}/verify-email`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})
   .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.message);setState('Your email is verified. Your workspace is ready.');})
   .catch(reason=>{setFailed(true);setState(reason instanceof Error?reason.message:'This verification link could not be used.');});
 },[]);
 async function resend(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setResending(true);setError('');
  try{
   const response=await fetch(`${api}/verification/resend`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
   const body=await response.json();if(!response.ok)throw Error(body.message??'Could not request a new link.');
   if(body.data.developmentVerificationUrl){window.location.assign(body.data.developmentVerificationUrl);return;}
   setResent(true);
  }catch(reason){setError(reason instanceof Error?reason.message:'Could not request a new link. Try again.');}
  finally{setResending(false);}
 }
 return <main className="auth-wrap"><section className="auth-card" aria-live="polite">
  <h1 className="auth-title">Email verification</h1><p className="muted">{state}</p>
  {failed&&!resent&&<form onSubmit={resend} style={{marginTop:18}}>
   <p className="muted small">If your account is still waiting for verification, enter its email address and we’ll send a fresh link.</p>
   {error&&<div className="error" role="alert">{error}</div>}
   <div className="field"><label htmlFor="verification-email">Email address</label><input id="verification-email" type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></div>
   <button className="button full" disabled={resending}>{resending?'Sending…':'Send a new verification link'}</button>
  </form>}
  {resent&&<p className="muted" role="status">If an account is waiting for verification, we’ve sent a fresh link.</p>}
  <Link href="/login" className="button secondary full" style={{marginTop:12}}>Continue to sign in</Link>
 </section></main>;
}
