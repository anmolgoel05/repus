'use client';
import { FormEvent,useState } from 'react';
import Link from 'next/link';

export default function ForgotPassword(){
 const[done,setDone]=useState(false);
 const[error,setError]=useState('');
 const[developmentResetUrl,setDevelopmentResetUrl]=useState('');
 const[busy,setBusy]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');setBusy(true);
  try{
   const response=await fetch(`${process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000'}/api/v1/auth/password-reset/request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:new FormData(event.currentTarget).get('email')})});
   const body=await response.json();if(!response.ok)throw Error(body.message??'Could not request a reset. Try again.');
   setDevelopmentResetUrl(body.data.developmentResetUrl??'');setDone(true);
  }catch(reason){setError(reason instanceof Error?reason.message:'Could not request a reset.');}
  finally{setBusy(false);}
 }
 return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}>
  <h1 className="auth-title">Reset your password</h1>
  {done?<><p className="muted">If an account exists for that email, we’ve sent a reset link.</p>{developmentResetUrl&&<a className="button full" href={developmentResetUrl}>Open development reset link</a>}</>:<>
   <p className="muted">Enter your sign-in email and we’ll send a reset link.</p>
   {error&&<div className="error" role="alert">{error}</div>}
   <div className="field"><label htmlFor="reset-email">Email address</label><input id="reset-email" name="email" type="email" required autoComplete="email"/></div>
   <button className="button full" disabled={busy}>{busy?'Sending…':'Send reset link'}</button>
  </>}
  <p className="muted small" style={{textAlign:'center'}}><Link href="/login">Back to login</Link></p>
 </form></main>;
}
