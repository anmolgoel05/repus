REPUS — Complete Product Requirements & Engineering Specification

Product name: Repus
Product category: Multi-tenant Email Marketing SaaS
Tagline: Email marketing, made simple.
Document type: Product Requirements Document + Technical Architecture + Implementation Instructions
Primary development agent: OpenAI Codex
Initial infrastructure budget: ₹5,000/month
Initial platform-wide sending target: 2,500 emails/day
Primary email provider: Amazon Simple Email Service (Amazon SES)

1. Instructions to Codex

You are the lead software architect, senior full-stack engineer, UI/UX designer, database engineer, DevOps engineer and QA engineer responsible for building Repus.

Build a complete, production-oriented, multi-tenant email marketing platform called Repus.

Do not build just a landing page, static dashboard or UI prototype.

Build a functional application with:

Working authentication.
Multi-tenant organizations.
Contact management.
CSV importing.
Email campaign creation.
Email templates.
Manual email sending.
Scheduled email sending.
Amazon SES integration.
Background email processing.
Daily sending quotas.
Delivery tracking.
Open tracking.
Click tracking.
Bounce tracking.
Complaint tracking.
Unsubscribe management.
Analytics dashboard.
Organization settings.
Admin dashboard.
Production deployment configuration.

All frontend functionality must connect to actual backend functionality.

Critical development instructions
First inspect the repository and identify existing files and technologies.
If the repository is empty, initialize the project using the stack defined below.
Create a detailed implementation plan.
Implement the application incrementally.
Create database migrations instead of relying on automatic schema synchronization.
Implement authentication and tenant isolation before business features.
Implement actual SES integration using AWS SDK.
Use background queues for email sending.
Write automated tests.
Never hardcode AWS credentials, API keys or passwords.
Use environment variables for configuration.
Do not use fake analytics or mock sending in production.
Do not mark a feature as completed until its backend functionality and tests exist.
Maintain a clear README with installation and deployment instructions.
Run tests, linting and type checking after implementation.

If AWS credentials are unavailable during development, implement a development email adapter that logs simulated delivery events. Clearly identify it as development-only. Production must use the real provider.

Do not ask the user to approve every small implementation decision. Use sensible engineering defaults and continue.

2. Product Vision

Repus is a simple, modern and affordable email marketing platform.

Its purpose is to help individuals, creators, entrepreneurs, digital product sellers and businesses send marketing emails to subscribers.

The product should feel simple enough for a non-technical user while providing reliable infrastructure underneath.

Repus should focus exclusively on email.

Do not build:

SMS marketing.
WhatsApp marketing.
Push notifications.
Social media management.
CRM sales pipelines.
Complex enterprise marketing automation.
Unnecessary AI features.

The primary product experience should revolve around:

Contacts.
Email campaigns.
Email templates.
Scheduling.
Delivery.
Analytics.
Product philosophy

The user should be able to register, import subscribers, create an email campaign and send it without understanding SMTP, DNS infrastructure, queues or AWS.

Make technical concepts accessible through simple explanations and helpful onboarding.

3. Technology Stack

Use the following technologies.

Frontend
Next.js with App Router.
TypeScript.
Tailwind CSS.
shadcn/ui.
Lucide icons.
TanStack Query.
React Hook Form.
Zod.
Recharts for analytics.
Backend
Node.js.
NestJS.
TypeScript.
REST APIs.
Swagger/OpenAPI.
Zod or class-validator for request validation.
Database
PostgreSQL.
Prisma ORM or TypeORM with migrations.
PostgreSQL JSONB for flexible custom fields.
PostgreSQL Row-Level Security for tenant isolation.

Prefer Prisma if it can support the required database constraints and migrations cleanly. Use SQL migrations for advanced PostgreSQL functionality where needed.

Background processing
Redis.
BullMQ.
Separate worker processes.
Email delivery
Amazon Simple Email Service.
AWS SDK for JavaScript v3.
SES configuration sets.
SNS/SQS or EventBridge for event processing.
SES message tags for tenant and campaign attribution.
Infrastructure
Docker.
Docker Compose.
AWS Lightsail initially.
Amazon S3.
Amazon SES.
Amazon SNS/SQS.
CloudWatch.
Cloudflare for DNS, CDN and basic security.
Email editor

Use GrapesJS or another actively maintained email editor that generates responsive email HTML.

The editor must support:

Text blocks.
Images.
Buttons.
Columns.
Background colors.
Links.
HTML preview.
Mobile preview.
Desktop preview.
Saving reusable templates.

Ensure generated emails work in Gmail, Outlook and Apple Mail as far as practical.

4. Application Architecture

Build the following logical applications:

text
repus/
│
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── event-worker/
│
├── packages/
│   ├── database/
│   ├── shared-types/
│   ├── validation/
│   └── email-renderer/
│
├── infrastructure/
│   ├── docker/
│   ├── aws/
│   └── scripts/
│
├── docs/
│
├── docker-compose.yml
├── package.json
└── README.md

Application responsibilities
Web application

Responsible for:

Landing page.
Registration.
Login.
Dashboard.
Contact management.
CSV imports.
Campaign editor.
Campaign scheduling.
Analytics.
Organization settings.
User profile.
API application

Responsible for:

Authentication.
Organizations.
User management.
Contacts.
Lists.
Imports.
Campaigns.
Templates.
Sending quota management.
Domains.
Analytics.
Unsubscribe management.
Billing foundations.
Worker application

Responsible for:

CSV processing.
Campaign audience preparation.
Email rendering.
Sending jobs.
Rate limiting.
Retry management.
Campaign scheduling.
Daily quota enforcement.
Event worker

Responsible for:

Delivery events.
Bounce events.
Complaint events.
Open events.
Click events.
Unsubscribe events.
Analytics aggregation.
Suppression management.
5. Multi-Tenant Architecture

Repus must support multiple organizations.

Each registered user should belong to an organization.

One organization can have multiple users.

Each organization must have its own:

Contacts.
Lists.
Campaigns.
Templates.
Sending domains.
Analytics.
Suppression records.
Sending quotas.
API keys.
Roles

Implement:

Owner
Full organization access.
Manage members.
Manage domains.
Manage campaigns.
Manage contacts.
View analytics.
Manage organization settings.
Admin
Manage contacts.
Manage campaigns.
Manage templates.
View analytics.
Manage team members subject to permissions.
Marketer
Create campaigns.
Import contacts.
Send campaigns.
Manage templates.
View analytics.
Viewer
Read-only access to campaigns, contacts and analytics.
Tenant isolation

Every tenant-owned database entity must have a tenant ID.

Never trust tenant IDs submitted by the frontend.

Derive the tenant from the authenticated session.

Implement PostgreSQL Row-Level Security as an additional protection layer.

Use tenant-aware composite foreign keys to prevent cross-tenant relationships.

Write automated tests that attempt to access another organization's data and verify that access is denied.

6. Authentication

Implement:

Registration.
Login.
Logout.
Email verification.
Password reset.
Secure session handling.
Session expiration.
Organization creation.
Organization invitations.
Role-based permissions.

Use secure, HTTP-only cookies.

Hash passwords with Argon2id.

Add login rate limiting.

Do not store plaintext passwords.

Registration flow:

User visits Repus.
User clicks Get Started.
User enters name, email and password.
User verifies email.
Organization is created.
User becomes organization owner.
User is redirected to onboarding.
7. Database Schema

Create proper migrations for all database tables.

Use UUID primary keys where appropriate.

Use TIMESTAMPTZ for timestamps.

Add indexes for frequently queried columns.

Core tables:

tenants
id
name
slug
plan
status
timezone
created_at
updated_at
users
id
tenant_id
name
email
password_hash
role
status
email_verified_at
created_at
updated_at
contacts
id
tenant_id
email
first_name
last_name
status
consent_source
consent_at
custom_fields JSONB
created_at
updated_at

Unique constraint:

(tenant_id, normalized_email)

Contact statuses:

subscribed
unsubscribed
bounced
complained
pending_confirmation
contact_lists
id
tenant_id
name
description
created_at
list_contacts
tenant_id
list_id
contact_id
created_at
templates
id
tenant_id
name
subject
html_content
text_content
editor_json JSONB
created_at
updated_at
campaigns
id
tenant_id
name
subject
from_name
from_email
reply_to
template_id
html_content
text_content
status
scheduled_at
started_at
completed_at
created_at
updated_at

Campaign statuses:

draft
scheduled
preparing
queued
sending
paused
completed
cancelled
failed
campaign_recipients
id
tenant_id
campaign_id
contact_id
email
status
provider_message_id
sent_at
delivered_at
created_at

Unique constraint:

(campaign_id, contact_id)

Recipient statuses:

pending
queued
sending
sent
delivered
bounced
complained
failed
suppressed
email_events
id
tenant_id
recipient_id
event_type
event_key
url
event_data JSONB
occurred_at

Event types:

accepted
delivered
open
click
bounce
complaint
reject
delivery_delay
unsubscribe
suppressions
id
tenant_id
email
reason
source
created_at

Reasons:

unsubscribe
hard_bounce
complaint
manual
unsubscribes
id
tenant_id
contact_id
email
reason
created_at
import_jobs
id
tenant_id
file_key
status
total_rows
imported_rows
duplicate_rows
rejected_rows
suppressed_rows
created_at
completed_at
sending_domains
id
tenant_id
domain
verification_status
dkim_status
spf_status
dmarc_status
created_at
tenant_sending_limits
id
tenant_id
daily_limit
monthly_limit
contact_limit
enabled
updated_at
daily_usage
id
tenant_id
usage_date
sent_count
reserved_count
created_at

Unique constraint:

(tenant_id, usage_date)

api_keys
id
tenant_id
name
key_hash
last_used_at
expires_at
revoked_at
created_at
webhook_deliveries
id
provider
provider_event_id
payload JSONB
status
attempts
processed_at
created_at
audit_logs
id
tenant_id
user_id
action
entity_type
entity_id
metadata JSONB
created_at
billing_subscriptions
id
tenant_id
provider
provider_customer_id
subscription_id
plan
status
created_at
updated_at

Add additional tables where needed for reliable production operation.

Important database requirements
Never permanently delete unsubscribe records.
Store consent source and timestamp.
Normalize emails before deduplication.
Preserve provider event IDs for idempotency.
Store raw provider events durably.
Use monthly partitioning for email_events when volume justifies it.
Keep campaign recipient records separate from event records.
Never allow tenant A to access tenant B records.
8. CSV Contact Import

CSV import is the primary contact acquisition method.

Supported columns:

csv
email,first_name,last_name,company
alice@example.com,Alice,Sharma,Company A
bob@example.com,Bob,Kumar,Company B


Users should be able to map arbitrary CSV columns to Repus contact fields.

Import experience
Click Import Contacts.
Upload CSV.
Preview the first rows.
Map CSV columns.
Confirm marketing permission.
Select destination contact list.
Start import.
View progress.
Download rejected records.
Import validation

Validate:

Email format.
Duplicate emails.
Empty addresses.
Invalid rows.
Existing contacts.
Suppressed addresses.
Consent requirements.

Use streaming CSV parsing.

Never load the complete CSV into server memory.

Use S3 for temporary storage.

Use BullMQ for processing.

Use batch database inserts.

Support:

Import progress.
Cancellation.
Error reports.
Duplicate detection.
Retry of failed imports.

Do not allow purchased, scraped or otherwise unauthorized contact lists.

9. Contact Management

Build a consumer-friendly contacts interface.

Features:

Contact search.
Pagination.
Filters.
Contact details.
Contact editing.
Contact deletion.
Custom fields.
Tags.
Contact lists.
Import history.
Export CSV.
Subscriber status.

Provide a bulk action menu.

Users should be able to:

Add to list.
Remove from list.
Export selected contacts.
Unsubscribe selected contacts.
Delete selected contacts.

Display contact status clearly.

Never allow re-importing a suppressed address to silently restore marketing permission.

10. Campaign Management

Users must be able to create campaigns easily.

Campaign creation flow

Step 1: Campaign name.

Step 2: Select audience.

Step 3: Email sender details.

Step 4: Subject line and preview text.

Step 5: Design email.

Step 6: Preview.

Step 7: Send test email.

Step 8: Choose Send Now or Schedule.

Step 9: Confirm sending.

Campaign builder

Build a clean visual email editor.

Support:

Rich text.
Headings.
Paragraphs.
Images.
Buttons.
Columns.
Links.
Divider.
Background colors.
Mobile-responsive layouts.
HTML source preview.
Desktop preview.
Mobile preview.

Support template saving.

Provide personalization variables:

{{first_name}}
{{last_name}}
{{email}}

Provide sensible fallback values for missing contact data.

Never send unescaped user-controlled values into raw HTML.

Campaign validation

Before sending, verify:

Sender domain is verified.
Subject is present.
HTML content exists.
Audience is selected.
At least one eligible recipient exists.
Unsubscribe link is included.
Daily quota is available.
Monthly quota is available.
Sending domain is approved.
Marketing consent requirements are satisfied.

Show a confirmation screen before launching campaigns.

11. Manual and Scheduled Sending

Support both sending methods.

Manual sending

User clicks Send Now.

Backend:

Validates campaign.
Resolves recipients.
Checks suppression records.
Creates recipient records.
Reserves sending capacity.
Creates queue jobs.
Worker processes jobs.
SES delivers emails.
Event processor updates statuses.
Scheduled sending

User selects:

Date.
Time.
Timezone.

Store schedule in UTC.

Display schedule in the user's timezone.

Use a scheduler that reliably discovers due campaigns.

Scheduled jobs must survive server restarts.

Support:

Schedule.
Edit schedule.
Cancel schedule.
Pause active campaign.
Resume campaign where safe.

Do not duplicate sending when a scheduled job is retried.

Use idempotency keys.

12. Sending Quota System

This is a critical requirement.

Initial platform-wide target:

2,500 accepted marketing email submissions per day.

This is a configurable platform setting.

Each tenant also has its own:

Daily sending quota.
Monthly sending quota.
Contact storage quota.
Campaign limits.

Example:

Platform daily limit: 2,500.

Tenant A: 1,000/day.

Tenant B: 1,000/day.

Tenant C: 500/day.

Total: 2,500/day.

These values are illustrative and must be configurable.

Implement:

Atomic quota reservation.
Quota release for jobs that fail before provider acceptance.
Daily reset using the platform timezone.
Tenant-level quota checks.
Platform-level quota checks.
Monthly quota checks.
Usage reporting.
Admin overrides.
Concurrency protection.

Never rely solely on Redis counters for permanent quota accounting.

Use database transactions and reconciliation.

If the quota is reached, show:

"You've reached today's email sending limit. Your next sending window begins at midnight."

Never silently discard campaign jobs.

13. Amazon SES Integration

Amazon SES is the email delivery provider.

Use AWS SDK for JavaScript v3.

Implement an abstraction:

typescript
interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
  verifyDomain(domain: string): Promise<DomainVerificationResult>;
  getSendingQuota(): Promise<SendingQuota>;
}


Create:

AmazonSesProvider.
DevelopmentEmailProvider.
SES integration requirements
Domain verification.
DKIM.
SPF guidance.
DMARC guidance.
Configuration sets.
Message tags.
Sending rate management.
Bounce events.
Complaint events.
Delivery events.
Open tracking.
Click tracking.
Delivery delay events.

Use SES configuration sets for tracking.

Tag each message with:

tenant_id
campaign_id
recipient_id

Do not place personal email addresses in public event URLs or tracking tokens.

SES production access

Document the process of requesting SES production access.

The application must show a clear warning when SES is still in sandbox mode.

Do not assume that production sending access or a 2,500/day quota is automatically granted.

Deliverability

Implement:

Verified sender domains.
DKIM checks.
SPF guidance.
DMARC guidance.
Bounce monitoring.
Complaint monitoring.
Sending warm-up guidance.
Rate limits.
Automatic suppression.

Do not implement automatic high-volume sending to newly imported contacts without consent validation and sender reputation safeguards.

14. Open Tracking

Add a unique tracking pixel to every HTML email.

Example:

HTML
<img
  src="https://track.example.com/t/open/TOKEN"
  width="1"
  height="1"
  alt=""
/>


When requested:

Validate token.
Record event.
Deduplicate where appropriate.
Return a transparent pixel.
Avoid exposing the underlying contact ID.

Store both raw and unique open counts.

Important: open tracking is approximate because of image proxies and privacy features.

Display a small explanation in analytics.

15. Click Tracking

Rewrite links during email rendering.

Original:

text
https://example.com/product


Tracked:

text
https://track.example.com/t/click/TOKEN/LINK_ID


When clicked:

Validate signed token.
Resolve original destination.
Record click.
Redirect to destination.
Record timestamp.

Protect against open redirect vulnerabilities.

Only redirect to destinations originally present in the campaign HTML.

Track:

Total clicks.
Unique clicks.
Clicked links.
Click rate.
16. Delivery and Bounce Tracking

Receive SES events.

Support:

Accepted.
Delivered.
Hard bounce.
Soft bounce.
Complaint.
Rejected.
Delivery delay.

Use SNS/SQS or EventBridge for durable event processing.

Verify provider event authenticity where applicable.

Use idempotency keys to prevent duplicate event processing.

Hard bounces should enter the suppression list.

Spam complaints should immediately suppress future marketing sends.

Temporary failures may be retried according to a controlled retry policy.

17. Unsubscribe Management

This is mandatory.

Every marketing email must contain an unsubscribe link.

Implement:

Public unsubscribe page.
One-click unsubscribe.
Unsubscribe confirmation.
Unsubscribe timestamp.
Optional reason.
Contact status update.
Tenant suppression record.
Future campaign exclusion.

Include:

text
List-Unsubscribe
List-Unsubscribe-Post


headers where supported.

Process unsubscribe requests immediately.

Never re-subscribe someone simply because they appear in a newly imported CSV.

Require fresh, documented permission before reactivation.

18. Analytics Dashboard

Create a professional analytics dashboard.

Global statistics:

Total contacts.
Active subscribers.
Unsubscribed contacts.
Total campaigns.
Emails sent.
Emails delivered.
Unique opens.
Unique clicks.
Bounce rate.
Complaint rate.

Campaign-specific statistics:

Recipients.
Accepted sends.
Delivered.
Opens.
Clicks.
Bounces.
Complaints.
Unsubscribes.
Failed sends.

Create charts for:

Daily sending volume.
Delivery trends.
Open trends.
Click trends.
Bounce trends.

Display unique and total events separately.

Never represent provider acceptance as inbox placement.

Clearly explain that opens and clicks can include automated activity.

Use Recharts.

19. Admin Dashboard

Repus must include a platform-level admin area separate from tenant dashboards.

Only platform administrators can access it.

Features:

Overview
Total tenants.
Active tenants.
Total contacts.
Emails sent today.
Monthly email volume.
Provider delivery rate.
Bounce rate.
Complaint rate.
Queue status.
Tenant management
View organizations.
View account status.
View usage.
Configure limits.
Suspend organizations.
Reactivate organizations.
Review abuse alerts.
Sending infrastructure
SES connection status.
SES production/sandbox status.
Daily sending quota.
Monthly sending volume.
Queue depth.
Failed jobs.
Event processing delays.
System controls
Global daily sending limit.
Global monthly sending limit.
Default tenant quotas.
Emergency sending pause.
Tenant-specific sending suspension.

All administrative actions must be audited.

20. Consumer-Friendly UI/UX Design

The interface is extremely important.

Repus must feel simple, modern, friendly and trustworthy.

Avoid making it look like a complex developer tool.

Design direction

Use a clean SaaS dashboard inspired by the usability of Linear, Stripe and modern email marketing applications.

Visual style:

White and very light grey backgrounds.
Deep navy or dark charcoal text.
Blue primary actions.
Green success states.
Subtle borders.
Soft shadows.
Rounded cards.
Generous spacing.
Clear typography.
Lucide icons.

Use a consistent spacing system.

Avoid excessive gradients and decorative animations.

Use responsive layouts.

Desktop and mobile must both work.

Brand identity

Name: Repus.

Tagline:

"Email marketing, made simple."

Suggested primary color:

#2563EB

Suggested secondary color:

#0F172A

Suggested background:

#F8FAFC

Suggested success:

#16A34A

Create a simple, recognizable logo using a mail-inspired icon.

Do not use a generic template appearance.

Main navigation

Sidebar:

Overview
Contacts
Campaigns
Templates
Analytics
Sending Domains
Settings

Bottom:

Help Center
User Profile
Dashboard screen

Display:

Welcome back!

"Here's how your email marketing is performing."

Cards:

Total contacts.
Emails sent today.
Delivery rate.
Unique open rate.
Unique click rate.

Below:

Recent campaigns.
Sending activity chart.
Subscriber growth.
Recent events.

Provide a prominent button:

"Create Campaign"

Empty states

Every empty screen should be helpful.

Example:

No campaigns yet.

"Create your first email campaign and start connecting with your subscribers."

Button:

"Create Your First Campaign"

Onboarding experience

After registration, guide the customer through:

Organization name.
Business information.
Sending domain.
Domain verification.
Import subscribers.
Create first campaign.
Send test email.

Show progress.

Allow users to skip nonessential steps and return later.

User-friendly error handling

Never show raw stack traces or database errors.

Examples:

Instead of:

"SMTP error 554"

Show:

"Your email could not be accepted by the delivery provider. Please check your sending domain and account sending status."

Instead of:

"Quota exceeded"

Show:

"You've reached today's sending allowance. You can schedule the remaining emails for your next sending window."

21. Email Templates

Create a template library with:

Welcome email.
Product announcement.
Promotional offer.
Newsletter.
Digital product launch.
Educational email.
Discount announcement.

Allow users to:

Preview.
Edit.
Duplicate.
Save.
Delete.

Templates must be mobile responsive.

Use HTML sanitization.

Provide plain-text alternatives.

22. API Structure

Use versioned REST endpoints.

Base URL:

text
/api/v1


Authentication:

text
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
GET  /auth/me


Organizations:

text
GET  /organizations
GET  /organizations/current
PATCH /organizations/current
POST /organizations/invite
GET  /organizations/members


Contacts:

text
GET    /contacts
POST   /contacts
GET    /contacts/:id
PATCH  /contacts/:id
DELETE /contacts/:id
POST   /contacts/import
GET    /contacts/import/:id
GET    /contacts/import/:id/errors


Lists:

text
GET    /lists
POST   /lists
GET    /lists/:id
PATCH  /lists/:id
DELETE /lists/:id
POST   /lists/:id/contacts


Campaigns:

text
GET    /campaigns
POST   /campaigns
GET    /campaigns/:id
PATCH  /campaigns/:id
DELETE /campaigns/:id
POST   /campaigns/:id/preview
POST   /campaigns/:id/test
POST   /campaigns/:id/send
POST   /campaigns/:id/schedule
POST   /campaigns/:id/pause
POST   /campaigns/:id/resume
POST   /campaigns/:id/cancel


Templates:

text
GET    /templates
POST   /templates
GET    /templates/:id
PATCH  /templates/:id
DELETE /templates/:id


Domains:

text
GET  /domains
POST /domains
GET  /domains/:id
POST /domains/:id/verify


Analytics:

text
GET /analytics/overview
GET /analytics/daily
GET /campaigns/:id/stats
GET /campaigns/:id/events
GET /campaigns/:id/recipients


Public endpoints:

text
GET  /t/open/:token
GET  /t/click/:token/:linkId
GET  /unsubscribe/:token
POST /unsubscribe/:token


Provider webhooks:

text
POST /webhooks/ses
POST /webhooks/sns


Create Swagger documentation for all authenticated APIs.

Validate all inputs.

Apply rate limits.

Use consistent response formats.

23. Queue Architecture

Create separate BullMQ queues.

text
repus-csv-import
repus-campaign-preparation
repus-email-sending
repus-scheduled-campaigns
repus-provider-events
repus-analytics
repus-retries


Implement:

Retry with exponential backoff.
Dead-letter handling.
Idempotency.
Job monitoring.
Graceful shutdown.
Worker health checks.
Concurrency limits.
Sending rate limits.

Do not mark an email as delivered immediately after SES accepts the send request.

Maintain separate states for provider acceptance and actual delivery confirmation.

24. Infrastructure and Deployment

Use Docker Compose for the initial deployment.

Services:

text
web
api
worker
event-worker
postgres
redis


AWS services:

Amazon SES.
Amazon S3.
Amazon SNS/SQS.
CloudWatch.
Initial server

Start with a 2–4 GB RAM VPS.

Use a separate database volume.

Configure persistent Redis storage or ensure jobs are safely recoverable.

Configure automated PostgreSQL backups.

Use private S3 buckets.

Use TLS.

Use Docker restart policies.

Configure firewall rules.

Never expose PostgreSQL or Redis publicly.

Environment variables

Create .env.example.

Include:

env
NODE_ENV=development

DATABASE_URL=
REDIS_URL=

NEXT_PUBLIC_APP_URL=
API_URL=

SESSION_SECRET=

AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

AWS_SES_CONFIGURATION_SET=
AWS_S3_BUCKET=

TRACKING_BASE_URL=

EMAIL_FROM_NAME=
EMAIL_FROM_ADDRESS=

PLATFORM_DAILY_SEND_LIMIT=2500
PLATFORM_MONTHLY_SEND_LIMIT=75000

DEFAULT_TENANT_DAILY_LIMIT=500
DEFAULT_TENANT_MONTHLY_LIMIT=15000


Never commit actual .env files.

Use IAM roles in AWS production rather than long-lived static credentials whenever possible.

Production infrastructure

Document how to deploy:

Domain and DNS.
TLS.
Application containers.
PostgreSQL.
Redis.
S3.
SES.
SNS/SQS.
Monitoring.
Backups.
25. Security Requirements

Implement:

Argon2id password hashing.
Secure session cookies.
CSRF protection where applicable.
XSS protection.
SQL injection prevention.
Rate limiting.
API authentication.
Role-based access control.
Tenant isolation.
S3 access controls.
Secrets management.
Audit logging.
Secure webhook verification.
CSV upload validation.
HTML sanitization.
Open redirect protection.
Database backup encryption.

Never expose AWS credentials to the frontend.

Never allow users to access another tenant's contacts or campaign data.

Use signed tracking tokens.

Avoid storing unnecessary sensitive personal information.

26. Email Compliance

Repus is an email marketing platform.

Implement compliance as a core feature, not an optional addition.

Requirements:

Documented subscriber permission.
Consent source.
Consent timestamp.
Unsubscribe link.
One-click unsubscribe.
List-Unsubscribe headers.
Bounce suppression.
Complaint suppression.
No purchased or scraped lists.
No unauthorized bulk imports.
Clear sender identity.
Accurate subject lines.
Privacy policy.
Terms of service.
Acceptable use policy.

Support double opt-in as an option.

Provide an abuse-reporting mechanism.

Automatically pause campaigns or accounts that exceed configured bounce or complaint thresholds.

Ensure the platform supports applicable Indian data-protection and relevant international email marketing requirements.

27. Testing Strategy

Create automated tests.

Unit tests
Contact normalization.
Email validation.
Quota calculation.
Campaign validation.
Suppression checking.
Tracking token validation.
Unsubscribe processing.
Integration tests
Registration.
Login.
CSV import.
Campaign creation.
Campaign scheduling.
Sending queue.
SES adapter.
Webhook processing.
Analytics aggregation.
Security tests
Cross-tenant access attempts.
Unauthorized campaign access.
Invalid tracking tokens.
Malicious CSV files.
HTML injection.
Open redirect attempts.
API rate limits.
End-to-end tests

Complete user journey:

Register.
Create organization.
Import CSV.
Create campaign.
Select subscribers.
Send test email.
Send campaign using development adapter.
Generate simulated delivery events.
View analytics.
Unsubscribe a recipient.
Verify the recipient cannot receive another campaign.

Use Playwright for frontend end-to-end testing.

Use Testcontainers or equivalent for database and Redis integration tests where practical.

28. Development Phases

Implement in the following order.

Phase 1: Foundation
Monorepo.
Next.js.
NestJS.
PostgreSQL.
Redis.
Docker.
Authentication.
Multi-tenancy.
User roles.
Phase 2: Contacts
Contact management.
CSV import.
Lists.
Duplicate detection.
Consent validation.
Suppression.
Phase 3: Campaigns
Campaign CRUD.
Email editor.
Templates.
Preview.
Test sending.
Phase 4: Sending engine
Amazon SES integration.
BullMQ.
Quota management.
Manual sending.
Scheduling.
Retry handling.
Phase 5: Analytics
Delivery tracking.
Open tracking.
Click tracking.
Bounce tracking.
Complaint tracking.
Campaign reporting.
Phase 6: Administration
Admin dashboard.
Tenant management.
Quota controls.
System health.
Usage analytics.
Phase 7: Production readiness
Security review.
Load testing.
Monitoring.
Backups.
Deployment.
Documentation.
29. Acceptance Criteria

Repus is not complete until all the following are true.

Authentication
A new user can register.
A user can verify their email.
A user can log in.
Users can create organizations.
Users can invite team members.
Roles are enforced.
Contacts
CSV uploads work.
Invalid records are reported.
Duplicate contacts are detected.
Contact lists work.
Suppression records are respected.
Campaigns
Users can create campaigns.
Users can create templates.
Users can edit HTML email content.
Users can preview campaigns.
Users can send test emails.
Users can send campaigns.
Users can schedule campaigns.
Users can cancel scheduled campaigns.
Delivery
SES integration works.
Provider message IDs are saved.
Sending limits are enforced.
Queue jobs survive process restarts.
Duplicate sending is prevented.
Failed sends are handled correctly.
Tracking
Delivery events update recipient status.
Open events are stored.
Click events are stored.
Bounce events are stored.
Complaint events are stored.
Unsubscribes work immediately.
Analytics
Campaign statistics are accurate.
Unique opens are calculated.
Unique clicks are calculated.
Bounce rates are calculated.
Delivery rates are calculated.
Security
Cross-tenant access is denied.
Secrets are not exposed.
Unsubscribe records are preserved.
Uploaded files are private.
Webhooks are safely processed.
User experience
All main pages work.
All forms validate.
Loading states exist.
Empty states exist.
Errors are understandable.
Mobile layout works.
Dashboard data is real.
30. Codex Execution Instructions

Follow this execution strategy.

First task

Inspect the repository.

Create:

README.md
AGENTS.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/API.md
docs/DEPLOYMENT.md
docs/SECURITY.md
docs/IMPLEMENTATION_PLAN.md

Create the project skeleton.

Create Docker Compose for local development.

Make sure PostgreSQL and Redis start successfully.

Second task

Implement:

Database schema.
Migrations.
Authentication.
Organizations.
Tenant isolation.
User roles.

Add tests before moving forward.

Third task

Implement contacts, CSV imports and lists.

Fourth task

Implement campaigns, templates and email editor.

Fifth task

Implement SES, sending workers, quotas and scheduling.

Sixth task

Implement tracking, event processing and analytics.

Seventh task

Implement admin tools, monitoring and deployment.

Important working rules
Work in small, verifiable increments.
Keep the application runnable after each phase.
Run tests after meaningful changes.
Do not leave major features as TODOs.
Do not use hardcoded demo analytics.
Do not silently ignore failures.
Do not implement fake production integrations.
Document external services that require credentials or approval.
Maintain a checklist in docs/IMPLEMENTATION_PLAN.md.
Update the README whenever setup or functionality changes.
Prioritize security, deliverability and correctness over unnecessary features.

When the repository is first opened, begin by producing an implementation plan and initializing the application foundation. Then continue implementing the complete product phase by phase.

31. Final Product Goal

The finished Repus application should let a non-technical customer:

Register for Repus.
Create an organization.
Verify a sending domain.
Import subscribers using CSV.
Organize subscribers into lists.
Design a professional email.
Select recipients.
Send immediately or schedule.
Track delivery.
See opens and clicks.
Monitor bounces and complaints.
Manage unsubscribes.
View campaign analytics.

The entire experience should feel simple and intuitive.

Repus should be a reliable, email-only marketing platform, not a complicated enterprise marketing suite.

Build the actual product, not merely a visual demonstration of it.