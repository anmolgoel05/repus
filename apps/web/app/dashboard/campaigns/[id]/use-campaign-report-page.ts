'use client';

import {useEffect, useState} from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const reportPageSize = 10;

export function useCampaignReportPage<T>(campaignId: string, resource: 'recipients' | 'events', filters: string, revision: number) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{items: T[]; total: number} | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(filters);
    query.set('page', String(page));
    query.set('pageSize', String(reportPageSize));
    async function load() {
      try {
        const response = await fetch(`${API}/api/v1/campaigns/${campaignId}/${resource}?${query}`, {
          credentials: 'include', signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? `Could not load campaign ${resource}.`);
        if (controller.signal.aborted) return;
        setResult(body.data);
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : `Could not load campaign ${resource}.`);
      }
    }
    void load();
    return () => controller.abort();
  }, [campaignId, resource, filters, page, revision, retry]);

  function navigate(nextPage: number) {
    setResult(null);
    setError('');
    setPage(nextPage);
  }

  return {page, result, error, navigate, reload: () => {setError(''); setRetry(value => value + 1);}};
}
