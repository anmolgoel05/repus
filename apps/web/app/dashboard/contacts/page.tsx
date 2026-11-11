'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Download, Plus, Search, Upload, Users, Trash2, UserMinus, Tag, ListPlus } from 'lucide-react';
import {triggerBlobDownload} from '../../../lib/browser-download';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.message ?? 'The request could not be completed.');
  return body.data;
}

export default function ContactsPage() {
  const [data, setData] = useState<any>(null);
  const [lists, setLists] = useState<any[]>([]);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<any[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [message, setMessage] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkListId, setBulkListId] = useState('');
  const [tagText, setTagText] = useState('');
  const pageIds = useMemo(() => (data?.items ?? []).map((item: any) => item.id), [data]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id: string) => selectedIds.includes(id));

  async function refresh(query = q, pageNumber = page, tagFilter = tag) {
    const result = await jsonResponse(await fetch(`${API}/api/v1/contacts?q=${encodeURIComponent(query)}&page=${pageNumber}&tag=${encodeURIComponent(tagFilter)}`, { credentials: 'include' }));
    setData(result);
  }
  useEffect(() => { fetch(`${API}/api/v1/lists`, { credentials: 'include' }).then(jsonResponse).then(value => setLists(value ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch(`${API}/api/v1/custom-fields`, { credentials: 'include' }).then(jsonResponse).then(value => setCustomFieldDefinitions((value ?? []).filter((field: any) => !field.archived))).catch(() => {}); }, []);
  async function refreshTags() { try { const available: string[] = await jsonResponse(await fetch(`${API}/api/v1/contacts/tags`, { credentials: 'include' })); setTags(available); if (tag && !available.includes(tag)) setTag(''); } catch { /* Keep the contacts list usable if tag suggestions fail. */ } }
  useEffect(() => { void refreshTags(); }, []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => fetch(`${API}/api/v1/contacts?q=${encodeURIComponent(q)}&page=${page}&tag=${encodeURIComponent(tag)}`, { credentials: 'include' }).then(jsonResponse).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(e.message); }), 180);
    return () => { live = false; clearTimeout(timer); };
  }, [q, tag, page]);

  async function downloadResponse(response: Response, filename: string) {
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.message ?? 'Could not export contacts.'); }
    triggerBlobDownload(await response.blob(),filename);
  }
  async function exportCsv() {
    setExporting(true); setError('');
    try { await downloadResponse(await fetch(`${API}/api/v1/contacts/export?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`, { credentials: 'include' }), 'repus-contacts.csv'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not export contacts.'); }
    finally { setExporting(false); }
  }
  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    const contactIds = [...new Set(selectedIds)];
    if (!contactIds.length) return;
    if (action === 'delete' && !confirm(`Delete ${contactIds.length} selected contact profiles? Pending campaign sends will be cancelled; campaign history is retained.`)) return;
    if (action === 'unsubscribe' && !confirm(`Unsubscribe ${contactIds.length} selected contacts? They will be added to the suppression list and will not receive future campaigns.`)) return;
    setBulkBusy(true); setError(''); setMessage('');
    try {
      if (action === 'export') {
        await downloadResponse(await fetch(`${API}/api/v1/contacts/bulk/export`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactIds }) }), 'repus-selected-contacts.csv');
        setMessage(`Exported ${contactIds.length} selected contacts.`);
      } else {
        const result = await jsonResponse(await fetch(`${API}/api/v1/contacts/bulk`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactIds, action, ...extra }) }));
        setMessage(`${result.affectedCount} contact${result.affectedCount === 1 ? '' : 's'} updated.`);
        setSelectedIds([]);
        await refresh();
        if (action === 'add_tags' || action === 'remove_tags' || action === 'delete') await refreshTags();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The bulk action failed.'); }
    finally { setBulkBusy(false); }
  }
  function setPageSelection(checked: boolean) {
    const next = checked ? [...new Set([...selectedIds, ...pageIds])] : selectedIds.filter(id => !pageIds.includes(id));
    if (next.length > 500) setError('Bulk actions support up to 500 selected contacts at a time.');
    setSelectedIds(next.slice(0, 500));
  }
  function toggleContact(id: string, checked: boolean) {
    if (!checked) { setSelectedIds(selectedIds.filter(value => value !== id)); return; }
    if (selectedIds.length >= 500) { setError('Bulk actions support up to 500 selected contacts at a time.'); return; }
    setSelectedIds([...new Set([...selectedIds, id])]);
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setCreateError('');
    const form = new FormData(e.currentTarget); const values = Object.fromEntries(form); const listId = String(values.listId ?? ''); delete values.listId;
    const customFields: Record<string, string | number | boolean> = {};
    for (const definition of customFieldDefinitions) { const input = e.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-custom-field="${definition.key}"]`); if (!input) continue; if (definition.type === 'BOOLEAN') { if (input.value !== '') customFields[definition.key] = input.value === 'true'; } else if (input.value !== '') customFields[definition.key] = definition.type === 'NUMBER' ? Number(input.value) : input.value; }
    try {
      const contact = await jsonResponse(await fetch(`${API}/api/v1/contacts`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, customFields, consentAt: new Date().toISOString() }) }));
      if (listId) await jsonResponse(await fetch(`${API}/api/v1/lists/${listId}/contacts`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactIds: [contact.id] }) }));
      if (contact.confirmationRequired) setMessage('Contact added as pending. A confirmation email will be sent before they can receive campaigns.');
      setShow(false); setPage(1); await refresh(q, 1, tag);
    } catch (e) { setCreateError(e instanceof Error ? e.message : 'Could not add contact.'); }
    finally { setSaving(false); }
  }

  return <div className="content">
    <div className="welcome"><div><div className="muted small" style={{ marginBottom: 8 }}>Audience</div><h1 className="font-display" style={{ fontSize: 27, margin: '0 0 7px' }}>Contacts</h1><div className="muted">Keep your subscriber list organized and permission-based.</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="button secondary" onClick={() => void exportCsv()} disabled={exporting}><Download size={16} />{exporting ? 'Exporting…' : 'Export CSV'}</button><Link className="button secondary" href="/dashboard/contacts/import"><Upload size={16} />Import CSV</Link><button className="button" onClick={() => setShow(true)}><Plus size={16} />Add contact</button></div></div>
    {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
    {message && <div style={{ background: '#eaf7ef', color: '#167544', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{message}</div>}
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: 340, flex: 1 }}><Search size={16} color="#8894a6" style={{ position: 'absolute', top: 12, left: 12 }} /><input value={q} onChange={e => { setPage(1); setQ(e.target.value); }} placeholder="Search contacts" style={{ border: '1px solid #e2e7ef', borderRadius: 8, padding: '10px 12px 10px 36px', width: '100%', fontSize: 13 }} /></div>
        <select value={tag} onChange={e => { setPage(1); setTag(e.target.value); }} aria-label="Filter by tag" style={{ padding: 10, border: '1px solid #e2e7ef', borderRadius: 8, color: tag ? '#17243b' : '#68758b' }}><option value="">All tags</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <Link href="/dashboard/lists" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>Manage lists</Link>
      </div>
      {!!selectedIds.length && <div style={{ background: '#f4f7fc', border: '1px solid #e4eaf3', padding: 12, borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}><b className="small">{selectedIds.length} selected</b><button className="button secondary" onClick={() => setSelectedIds([])} disabled={bulkBusy}>Clear selection</button></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={bulkListId} onChange={e => setBulkListId(e.target.value)} style={{ padding: 9, border: '1px solid #dce3ed', borderRadius: 8, minWidth: 150 }}><option value="">Choose list…</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
          <button className="button secondary" disabled={bulkBusy || !bulkListId} onClick={() => void bulk('add_to_list', { listId: bulkListId })}><ListPlus size={15} />Add to list</button>
          <button className="button secondary" disabled={bulkBusy || !bulkListId} onClick={() => void bulk('remove_from_list', { listId: bulkListId })}>Remove from list</button>
          <input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="Tags, separated by commas" style={{ padding: 9, border: '1px solid #dce3ed', borderRadius: 8, minWidth: 180 }} />
          <button className="button secondary" disabled={bulkBusy || !tagText.trim()} onClick={() => void bulk('add_tags', { tags: tagText.split(',').map(tag => tag.trim()).filter(Boolean) })}><Tag size={15} />Add tags</button>
          <button className="button secondary" disabled={bulkBusy || !tagText.trim()} onClick={() => void bulk('remove_tags', { tags: tagText.split(',').map(tag => tag.trim()).filter(Boolean) })}>Remove tags</button>
          <button className="button secondary" disabled={bulkBusy} onClick={() => void bulk('export')}><Download size={15} />Export selected</button>
          <button className="button secondary" disabled={bulkBusy} onClick={() => void bulk('unsubscribe')}><UserMinus size={15} />Unsubscribe</button>
          <button className="button secondary" style={{ color: '#b42318' }} disabled={bulkBusy} onClick={() => void bulk('delete')}><Trash2 size={15} />Delete</button>
        </div>
      </div>}
      {data?.items?.length ? <>
        <div style={{ overflowX: 'auto' }}><table className="table"><thead><tr><th><input type="checkbox" aria-label="Select this page" checked={allPageSelected} onChange={e => setPageSelection(e.target.checked)} /></th><th>Email</th><th>Name</th><th>Status</th><th>Tags</th>{customFieldDefinitions.map(field=><th key={field.id}>{field.label}</th>)}<th>Added</th></tr></thead><tbody>{data.items.map((contact: any) => { const tags = Array.isArray(contact.customFields?.tags) ? contact.customFields.tags : []; return <tr key={contact.id}><td><input type="checkbox" aria-label={`Select ${contact.email}`} checked={selectedIds.includes(contact.id)} onChange={e => toggleContact(contact.id, e.target.checked)} /></td><td style={{ fontWeight: 600 }}><Link href={`/dashboard/contacts/${contact.id}`} style={{color:'inherit',textDecoration:'none'}}>{contact.email}</Link></td><td>{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}</td><td><span className="pill" style={contact.status === 'SUBSCRIBED' ? {} : { background: '#fff5e7', color: '#93620d' }}>{contact.status.toLowerCase().replace('_', ' ')}</span></td><td>{tags.length ? tags.map((tag: string) => <span key={tag} className="pill" style={{ marginRight: 4, background: '#f1f4f9', color: '#526078' }}>{tag}</span>) : '—'}</td>{customFieldDefinitions.map(field=>{const value=contact.customFields?.[field.key];return <td key={field.id}>{value===undefined||value===null||value===''?'—':typeof value==='boolean'?value?'Yes':'No':String(value)}</td>})}<td className="muted">{new Date(contact.createdAt).toLocaleDateString()}</td></tr>; })}</tbody></table></div>
        <div style={{ paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div className="muted small">{data.total} contacts · page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</div><div style={{ display: 'flex', gap: 8 }}><button className="button secondary" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button><button className="button secondary" disabled={data.page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(data.page + 1)}>Next</button></div></div>
      </> : <div className="empty"><Users size={25} color="#7390bc" /><h3>{q ? 'No contacts match your search' : 'No contacts yet'}</h3><div>{q ? 'Try another name or email address.' : 'Add subscribers who have given you permission to email them.'}</div>{!q && <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}><Link className="button secondary" href="/dashboard/contacts/import"><Upload size={15} />Import CSV</Link><button className="button" onClick={() => setShow(true)}><Plus size={15} />Add contact</button></div>}</div>}
    </div>
    {show && <div role="dialog" aria-modal="true" aria-label="Add contact" style={{ position: 'fixed', inset: 0, background: '#17243b66', display: 'grid', placeItems: 'center', padding: 18, zIndex: 20 }}><form className="auth-card" onSubmit={create}><h2 className="font-display" style={{ marginTop: 0 }}>Add a subscriber</h2><p className="muted small">Only add people who have given permission to receive your emails.</p>{createError && <div role="alert" className="error" style={{ marginBottom: 14 }}>{createError}</div>}<div className="field"><label htmlFor="repus-dashboard-contacts-page-field-1">Email address</label><input name="email" type="email" required id="repus-dashboard-contacts-page-field-1" /></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="field"><label htmlFor="repus-dashboard-contacts-page-field-2">First name</label><input name="firstName" id="repus-dashboard-contacts-page-field-2" /></div><div className="field"><label htmlFor="repus-dashboard-contacts-page-field-3">Last name</label><input name="lastName" id="repus-dashboard-contacts-page-field-3" /></div></div>{customFieldDefinitions.map(definition=><div className="field" key={definition.id}><label>{definition.label}{definition.required?' *':''}</label>{definition.type==='BOOLEAN'?<select data-custom-field={definition.key} required={definition.required} defaultValue=""><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>:<input data-custom-field={definition.key} type={definition.type==='NUMBER'?'number':definition.type==='DATE'?'date':'text'} required={definition.required}/>}</div>)}<div className="field"><label htmlFor="repus-dashboard-contacts-page-field-4">How did they subscribe?</label><input name="consentSource" required maxLength={240} placeholder="Website signup form, event registration…" id="repus-dashboard-contacts-page-field-4" /></div><div className="field"><label htmlFor="repus-dashboard-contacts-page-field-5">Add to a list <span className="muted">(optional)</span></label><select name="listId" style={{ width: '100%', padding: 11, border: '1px solid #dce3ed', borderRadius: 8 }} id="repus-dashboard-contacts-page-field-5"><option value="">No list yet</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><button type="button" className="button secondary" onClick={() => { setShow(false); setCreateError(''); }}>Cancel</button><button className="button" disabled={saving}>{saving ? 'Adding…' : 'Add subscriber'}</button></div></form></div>}
  </div>;
}
