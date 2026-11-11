'use client';

import {useState} from 'react';
import {reportPageSize, useCampaignReportPage} from './use-campaign-report-page';

const statuses: Record<string, string> = {
  PENDING: 'Pending', QUEUED: 'Queued', SENDING: 'Sending', SENT: 'Sent',
  DELIVERED: 'Delivered', BOUNCED: 'Bounced', COMPLAINED: 'Complaint',
  FAILED: 'Failed', SUPPRESSED: 'Suppressed',
};
const failureLabels: Record<string, string> = {reject: 'Provider rejected the message', rendering_failure: 'Provider could not render the email'};
type Recipient = {id: string; email: string; status: string; sentAt: string | null; deliveredAt: string | null; failureType?: string | null};
const dateLabel = (date: string | null) => date ? new Date(date).toLocaleString() : '—';

export default function CampaignRecipients({campaignId, revision}: {campaignId: string; revision: number}) {
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const filters = new URLSearchParams({...status && {status}, ...search && {q: search}}).toString();
  const {page, result, error, navigate, reload} = useCampaignReportPage<Recipient>(campaignId, 'recipients', filters, revision);

  return <section className="card" aria-label="Campaign recipients">
    <h2 className="card-title">Campaign recipients</h2>
    <form className="card-head" style={{flexWrap: 'wrap', gap: 12}} onSubmit={event => {
      event.preventDefault();
      const nextSearch = searchInput.trim();
      if (nextSearch === search && page === 1) return;
      setSearch(nextSearch);
      navigate(1);
    }}>
      <label>Recipient status <select value={status} onChange={event => {setStatus(event.target.value); navigate(1);}}>
        <option value="">All statuses</option>
        {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Search recipient email <input type="search" maxLength={150} value={searchInput} onChange={event => setSearchInput(event.target.value)} /></label>
      <button className="btn btn-secondary" type="submit">Search</button>
    </form>
    {error && <p role="alert">{error} <button className="btn btn-secondary" onClick={reload}>Retry</button></p>}
    {!result && !error && <p role="status">Loading campaign recipients…</p>}
    {result && (result.items.length ? <div style={{overflowX: 'auto'}}>
      <table className="table"><thead><tr><th>Email</th><th>Status</th><th>Sent</th><th>Delivered</th></tr></thead>
        <tbody>{result.items.map(recipient => <tr key={recipient.id}>
          <td>{recipient.email}</td><td>{statuses[recipient.status] ?? recipient.status}
            {recipient.failureType && failureLabels[recipient.failureType] && <div className="muted small">{failureLabels[recipient.failureType]}</div>}
          </td>
          <td>{dateLabel(recipient.sentAt)}</td><td>{dateLabel(recipient.deliveredAt)}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="empty">{status || search ? 'No recipients match these filters.' : 'Recipient results will appear after the campaign is scheduled or sent.'}</p>)}
    {(page > 1 || (result?.total ?? 0) > reportPageSize) && <div className="card-head" style={{marginTop: 12}}>
      <button className="btn btn-secondary" disabled={page === 1} onClick={() => navigate(page - 1)}>Previous</button>
      <span className="muted small" aria-live="polite">Page {page}</span>
      <button className="btn btn-secondary" disabled={!result || page >= 1_000 || page * reportPageSize >= result.total} onClick={() => navigate(page + 1)}>Next</button>
    </div>}
  </section>;
}
