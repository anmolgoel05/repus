'use client';

import {useState} from 'react';
import {reportPageSize, useCampaignReportPage} from './use-campaign-report-page';

const eventLabels: Record<string, string> = {
  accepted: 'Accepted', delivered: 'Delivered', open: 'Opened', click: 'Clicked',
  bounce: 'Bounced', complaint: 'Complaint', reject: 'Rejected',
  rendering_failure: 'Rendering failure', delivery_delay: 'Delivery delayed',
  unsubscribe: 'Unsubscribed', suppress: 'Suppressed',
};
type Activity = {id: string; type: string; email: string; occurredAt: string};

export default function CampaignActivity({campaignId, revision}: {campaignId: string; revision: number}) {
  const [type, setType] = useState('');
  const filters = type ? new URLSearchParams({type}).toString() : '';
  const {page, result, error, navigate, reload} = useCampaignReportPage<Activity>(campaignId, 'events', filters, revision);

  return <section className="card" aria-label="Campaign activity">
    <div className="card-head">
      <h2 className="card-title">Campaign activity</h2>
      <label>Event type <select value={type} onChange={event => {setType(event.target.value); navigate(1);}}>
        <option value="">All events</option>
        {Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {error ? <p role="alert">{error} <button className="btn btn-secondary" onClick={reload}>Retry</button></p> : null}
    {!result && !error ? <p role="status">Loading campaign activity…</p> : null}
    {result && (result.items.length ? <div style={{overflowX: 'auto'}}>
      <table className="table"><thead><tr><th>Activity</th><th>Email</th><th>Time</th></tr></thead>
        <tbody>{result.items.map(event => <tr key={event.id}>
          <td>{eventLabels[event.type] ?? event.type.replaceAll('_', ' ')}</td>
          <td>{event.email}</td><td>{new Date(event.occurredAt).toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="empty">{type ? 'No events match this filter.' : 'Delivery and engagement events will appear here.'}</p>)}
    {(page > 1 || (result?.total ?? 0) > reportPageSize) && <div className="card-head" style={{marginTop: 12}}>
      <button className="btn btn-secondary" disabled={page === 1} onClick={() => navigate(page - 1)}>Previous</button>
      <span className="muted small" aria-live="polite">Page {page}</span>
      <button className="btn btn-secondary" disabled={!result || page >= 1_000 || page * reportPageSize >= result.total} onClick={() => navigate(page + 1)}>Next</button>
    </div>}
  </section>;
}

