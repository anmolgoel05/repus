export const SEND_INTERRUPT_CHANNEL = 'repus:send-interrupts';

export type SendInterrupt = { scope: 'all' } | { scope: 'campaign'; campaignId: string } | { scope: 'tenant'; tenantId: string } | { scope: 'recipient'; recipientId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSendInterrupt(payload: string): SendInterrupt | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (value.scope === 'all' && Object.keys(value).length === 1) return { scope: 'all' };
    if (value.scope === 'campaign' && typeof value.campaignId === 'string' && uuidPattern.test(value.campaignId) && Object.keys(value).length === 2) {
      return { scope: 'campaign', campaignId: value.campaignId };
    }
    if (value.scope === 'tenant' && typeof value.tenantId === 'string' && uuidPattern.test(value.tenantId) && Object.keys(value).length === 2) {
      return { scope: 'tenant', tenantId: value.tenantId };
    }
    if (value.scope === 'recipient' && typeof value.recipientId === 'string' && uuidPattern.test(value.recipientId) && Object.keys(value).length === 2) {
      return { scope: 'recipient', recipientId: value.recipientId };
    }
  } catch { /* Malformed cross-process signals are ignored. */ }
  return null;
}
