'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Globe, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type Domain = { id: string; domain: string; verificationStatus: string; dkimStatus: string; spfStatus: string; dmarcStatus: string };
type DnsSetup = { dkim: { type: string; name: string; value: string }[]; spf: { instructions: string }; dmarc: { name: string; value: string } };

export default function DomainsPage() {
  const [items, setItems] = useState<Domain[]>([]);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const [dns, setDns] = useState<DnsSetup | null>(null);
  const [dev, setDev] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`${API}/api/v1/domains`, { credentials: 'include' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? 'Could not load sending domains.');
    setItems(body.data);
  }

  useEffect(() => { void load().catch(e => setError(e.message)); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/v1/domains`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Could not add domain.');
      setDns(body.data.dns);
      setDev(body.data.developmentMode);
      setDomain('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add domain.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setError('');
    try {
      const response = await fetch(`${API}/api/v1/domains/${id}/verify`, { method: 'POST', credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Could not check domain.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check domain.');
    }
  }

  return <div className="content">
    <div className="welcome"><div><div className="muted small" style={{ marginBottom: 8 }}>Deliverability</div><h1 className="font-display" style={{ fontSize: 27, margin: '0 0 7px' }}>Sending domains</h1><div className="muted">Use your own domain so subscribers recognize your emails.</div></div></div>
    {error && <div className="error" role="alert">{error}</div>}

    <section className="card" style={{ maxWidth: 750 }} aria-labelledby="warmup-heading">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}><TrendingUp size={18} color="#527fc6"/><h2 id="warmup-heading" className="card-title" style={{ margin: 0 }}>Warm up a new sending domain</h2></div>
      <p className="muted small" style={{ margin: '0 0 12px', lineHeight: 1.6 }}>Build a steady sending history before you send to your full audience. Start with a small group of recently engaged subscribers who gave permission, then increase volume gradually across consistent campaigns. There is no safe universal daily target; stay within your SES account quota and your workspace limits.</p>
      <div className="small" style={{ display: 'grid', gap: 8, lineHeight: 1.5 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><ShieldCheck size={15} color="#527fc6" style={{ flexShrink: 0, marginTop: 2 }}/><span>Use permission-based contacts, remove stale or invalid addresses, and avoid purchased or unverified lists.</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><ShieldCheck size={15} color="#527fc6" style={{ flexShrink: 0, marginTop: 2 }}/><span>Watch delivery, hard-bounce, and complaint trends in Analytics. If reputation signals worsen or a campaign pauses automatically, stop increasing volume and resolve the cause first.</span></div>
      </div>
    </section>

    <section className="card" style={{ maxWidth: 750, marginTop: 14 }}>
      <div className="card-title">Add a domain</div>
      <p className="muted small">We’ll show the DNS records needed for sender verification, DKIM, SPF, and DMARC.</p>
      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}><input value={domain} onChange={e => setDomain(e.target.value)} placeholder="yourdomain.com" required style={{ flex: 1, minWidth: 0, padding: 11, border: '1px solid #dce3ed', borderRadius: 8 }}/><button className="button" disabled={busy}>{busy ? 'Adding…' : 'Add domain'}</button></form>
    </section>

    {dns && <section className="card" style={{ marginTop: 14, maxWidth: 750 }}><div className="card-title">DNS setup {dev && <span className="pill" style={{ marginLeft: 8, background: '#fff5e7', color: '#93620d' }}>Development adapter</span>}</div><p className="muted small">{dev ? 'Local development marks this domain ready only for simulated delivery.' : 'Add these records with your DNS provider, then check verification.'}</p>{dns.dkim.map(record => <div key={record.name} className="small" style={{ padding: '10px 0', borderTop: '1px solid #eef1f5' }}><b>DKIM CNAME</b><div className="muted">{record.name} → {record.value}</div></div>)}<div className="small" style={{ padding: '10px 0', borderTop: '1px solid #eef1f5' }}><b>SPF guidance</b><div className="muted">{dns.spf.instructions}</div></div><div className="small" style={{ padding: '10px 0', borderTop: '1px solid #eef1f5' }}><b>DMARC TXT</b><div className="muted">{dns.dmarc.name} → {dns.dmarc.value}</div></div></section>}

    {items.map(item => <section key={item.id} className="card" style={{ marginTop: 14, maxWidth: 750 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><b><Globe size={15} style={{ verticalAlign: 'middle', marginRight: 8 }}/>{item.domain}</b><div className="muted small" style={{ marginTop: 8 }}>Domain {item.verificationStatus} · DKIM {item.dkimStatus} · SPF {item.spfStatus} · DMARC {item.dmarcStatus}</div></div><button type="button" className="button secondary" onClick={() => void verify(item.id)}><RefreshCw size={14}/>Check DNS</button></div></section>)}
    {!items.length && <div className="empty" style={{ marginTop: 16 }}>Your sender domain will appear here once added.</div>}
  </div>;
}
