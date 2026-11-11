'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Mail } from 'lucide-react';

export default function Login() {
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const body=Object.fromEntries(new FormData(e.currentTarget));try{const r=await fetch(`${process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000'}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.message??'Could not sign in.');location.href='/dashboard'}catch(err){setError(err instanceof Error?err.message:'Could not sign in.')}finally{setBusy(false)}}
  return <main className="auth-wrap"><form className="auth-card" method="post" onSubmit={submit}><Link href="/" className="brand" style={{padding:0,textDecoration:'none',color:'inherit'}}><span className="brand-icon"><Mail size={18}/></span>repus</Link><h1 className="auth-title">Welcome back</h1><p className="muted" style={{margin:'0 0 22px'}}>Sign in to your workspace.</p>{error&&<div className="error">{error}</div>}<div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" required autoComplete="email"/></div><div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password"/></div><div style={{textAlign:'right',margin:'-6px 0 12px'}}><Link href="/forgot-password" className="small" style={{color:'#2563eb'}}>Forgot password?</Link></div><button className="button full" disabled={busy}>{busy?'Signing in…':'Log in'}</button><p className="muted small" style={{textAlign:'center',marginTop:22}}>New to Repus? <Link href="/register" style={{color:'#2563eb',fontWeight:700}}>Create an account</Link></p></form></main>
}
