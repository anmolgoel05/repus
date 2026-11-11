export type Role='OWNER'|'ADMIN'|'MARKETER'|'VIEWER';
export type ContactStatus='SUBSCRIBED'|'UNSUBSCRIBED'|'BOUNCED'|'COMPLAINED'|'PENDING_CONFIRMATION';
export type CampaignStatus='DRAFT'|'SCHEDULED'|'PREPARING'|'QUEUED'|'SENDING'|'PAUSED'|'COMPLETED'|'CANCELLED'|'FAILED';
export type RecipientStatus='PENDING'|'QUEUED'|'SENDING'|'SENT'|'DELIVERED'|'BOUNCED'|'COMPLAINED'|'FAILED'|'SUPPRESSED';
export interface TenantActor { userId:string;tenantId:string;role:Role; }
export interface ApiEnvelope<T>{data:T;}
